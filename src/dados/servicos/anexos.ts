// Anexos (comprovantes e documentos): metadados em `anexos`, binário em `anexosBlob`.
import { ErroDominio } from '../../dominio/erros'
import { novoId } from '../../dominio/ids'
import type { Anexo, Id } from '../../dominio/tipos'
import { registrarAuditoria } from '../auditoria'
import type { BancoSindico } from '../db'
import type { Relogio } from '../relogio'
import { assertMesAberto } from '../regras'

/** Um `File` de <input type=file> já é Blob: `{ nome: f.name, mime: f.type, blob: f }`. */
export interface ArquivoAnexo {
  nome: string
  mime: string
  blob: Blob
}

export const LIMITE_ANEXO_LANCAMENTO = 15 * 1024 * 1024
export const LIMITE_ANEXO_DOCUMENTO = 50 * 1024 * 1024

/** Grava anexos de um dono. Deve ser chamada DENTRO de uma transação (anexos + anexosBlob). */
export async function gravarAnexos(
  db: BancoSindico,
  donoTipo: Anexo['donoTipo'],
  donoId: Id,
  arquivos: readonly ArquivoAnexo[],
  agora: string,
): Promise<Anexo[]> {
  const limite = donoTipo === 'LANCAMENTO' ? LIMITE_ANEXO_LANCAMENTO : LIMITE_ANEXO_DOCUMENTO
  const criados: Anexo[] = []
  for (const a of arquivos) {
    if (a.blob.size > limite) {
      throw new ErroDominio('VALIDACAO', `O arquivo "${a.nome}" excede o limite de ${Math.round(limite / 1024 / 1024)} MB.`)
    }
    const anexo: Anexo = {
      id: novoId(),
      donoTipo,
      donoId,
      nome: a.nome.trim() || 'arquivo',
      mime: a.mime || 'application/octet-stream',
      tamanho: a.blob.size,
      criadoEm: agora,
    }
    await db.anexos.add(anexo)
    await db.anexosBlob.add({ id: anexo.id, blob: a.blob })
    criados.push(anexo)
  }
  return criados
}

/** Remove todos os anexos de um dono (dentro de transação). */
export async function removerAnexosDe(db: BancoSindico, donoTipo: Anexo['donoTipo'], donoId: Id): Promise<number> {
  const lista = await db.anexos.where('[donoTipo+donoId]').equals([donoTipo, donoId]).toArray()
  const ids = lista.map((a) => a.id)
  await db.anexos.bulkDelete(ids)
  await db.anexosBlob.bulkDelete(ids)
  return ids.length
}

export function criarServicoAnexos(db: BancoSindico, relogio: Relogio) {
  return {
    /** Adiciona anexos a um lançamento ATIVO ou a um documento. */
    async adicionar(donoTipo: Anexo['donoTipo'], donoId: Id, arquivos: readonly ArquivoAnexo[]): Promise<Anexo[]> {
      if (arquivos.length === 0) return []
      return db.transaction('rw', db.tables, async () => {
        if (donoTipo === 'LANCAMENTO') {
          const l = await db.lancamentos.get(donoId)
          if (!l) throw new ErroDominio('NAO_ENCONTRADO', 'Lançamento não encontrado.')
          if (l.status !== 'ATIVO') throw new ErroDominio('REGRA', 'Não é possível anexar a um lançamento excluído.')
        } else {
          const d = await db.documentos.get(donoId)
          if (!d) throw new ErroDominio('NAO_ENCONTRADO', 'Documento não encontrado.')
        }
        const agora = relogio.agora()
        const criados = await gravarAnexos(db, donoTipo, donoId, arquivos, agora)
        await registrarAuditoria(
          db,
          { entidade: 'anexo', entidadeId: donoId, acao: 'adicionado', resumo: `${criados.length} anexo(s) adicionado(s)` },
          agora,
        )
        return criados
      })
    },

    /** Remove um anexo. Anexos de lançamento vinculado a cobrança paga não podem ser removidos. */
    async remover(anexoId: Id): Promise<void> {
      await db.transaction('rw', db.tables, async () => {
        const a = await db.anexos.get(anexoId)
        if (!a) throw new ErroDominio('NAO_ENCONTRADO', 'Anexo não encontrado.')
        if (a.donoTipo === 'LANCAMENTO') {
          const l = await db.lancamentos.get(a.donoId)
          if (l) await assertMesAberto(db, l.data)
          if (l && l.cobrancaId) {
            throw new ErroDominio('REGRA', 'Comprovante de pagamento de taxa não pode ser removido. Use "Corrigir pagamento".')
          }
        }
        await db.anexos.delete(anexoId)
        await db.anexosBlob.delete(anexoId)
        await registrarAuditoria(
          db,
          { entidade: 'anexo', entidadeId: a.donoId, acao: 'removido', resumo: `Anexo "${a.nome}" removido` },
          relogio.agora(),
        )
      })
    },

    async listar(donoTipo: Anexo['donoTipo'], donoId: Id): Promise<Anexo[]> {
      return db.anexos.where('[donoTipo+donoId]').equals([donoTipo, donoId]).toArray()
    },

    async blob(anexoId: Id): Promise<Blob | undefined> {
      return (await db.anexosBlob.get(anexoId))?.blob
    },
  }
}

export type ServicoAnexos = ReturnType<typeof criarServicoAnexos>
