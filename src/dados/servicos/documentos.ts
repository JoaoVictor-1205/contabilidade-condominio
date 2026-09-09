// Arquivo de documentos avulsos do condomínio (atas, convenção, contratos...).
import { ErroDominio } from '../../dominio/erros'
import { novoId } from '../../dominio/ids'
import type { Documento, Id } from '../../dominio/tipos'
import { exigirValido, validarDadosDocumento, type DadosDocumento } from '../../dominio/validacao'
import { registrarAuditoria } from '../auditoria'
import type { BancoSindico } from '../db'
import type { Relogio } from '../relogio'
import { gravarAnexos, removerAnexosDe, type ArquivoAnexo } from './anexos'

export function criarServicoDocumentos(db: BancoSindico, relogio: Relogio) {
  return {
    async criar(entrada: DadosDocumento, arquivos: readonly ArquivoAnexo[] = []): Promise<Documento> {
      const dados = exigirValido(validarDadosDocumento(entrada))
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        const d: Documento = {
          id: novoId(),
          titulo: dados.titulo,
          categoria: dados.categoria,
          data: dados.data,
          ...(dados.descricao ? { descricao: dados.descricao } : {}),
          criadoEm: agora,
          atualizadoEm: agora,
        }
        await db.documentos.add(d)
        await gravarAnexos(db, 'DOCUMENTO', d.id, arquivos, agora)
        await registrarAuditoria(db, { entidade: 'documento', entidadeId: d.id, acao: 'criado', resumo: `Documento arquivado: ${d.titulo}` }, agora)
        return d
      })
    },

    async atualizar(id: Id, entrada: DadosDocumento): Promise<Documento> {
      const dados = exigirValido(validarDadosDocumento(entrada))
      return db.transaction('rw', db.tables, async () => {
        const atual = await db.documentos.get(id)
        if (!atual) throw new ErroDominio('NAO_ENCONTRADO', 'Documento não encontrado.')
        const agora = relogio.agora()
        const novo: Documento = { ...atual, titulo: dados.titulo, categoria: dados.categoria, data: dados.data, atualizadoEm: agora }
        if (dados.descricao) novo.descricao = dados.descricao
        else delete novo.descricao
        await db.documentos.put(novo)
        await registrarAuditoria(db, { entidade: 'documento', entidadeId: id, acao: 'atualizado', resumo: `Documento alterado: ${novo.titulo}` }, agora)
        return novo
      })
    },

    /** Exclusão física do documento e de seus anexos. */
    async excluir(id: Id): Promise<void> {
      await db.transaction('rw', db.tables, async () => {
        const d = await db.documentos.get(id)
        if (!d) throw new ErroDominio('NAO_ENCONTRADO', 'Documento não encontrado.')
        const n = await removerAnexosDe(db, 'DOCUMENTO', id)
        await db.documentos.delete(id)
        await registrarAuditoria(db, { entidade: 'documento', entidadeId: id, acao: 'excluido', resumo: `Documento excluído: ${d.titulo} (${n} anexo(s))` }, relogio.agora())
      })
    },
  }
}

export type ServicoDocumentos = ReturnType<typeof criarServicoDocumentos>
