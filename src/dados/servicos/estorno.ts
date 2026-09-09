import { ehDataISO, mesDe } from '../../dominio/datas'
import { ErroDominio } from '../../dominio/erros'
import { novoId } from '../../dominio/ids'
import type { DataISO, Lancamento } from '../../dominio/tipos'
import { registrarAuditoria } from '../auditoria'
import type { BancoSindico } from '../db'
import { assertMesAberto, idsBlocosAfetados, obterCondominio, validarDataContraSaldoInicial } from '../regras'

/** Uso interno, sempre na transação que também atualiza a cobrança (quando houver). */
export async function gravarEstorno(db: BancoSindico, original: Lancamento, data: DataISO, motivo: string, agora: string): Promise<Lancamento> {
  if (!motivo.trim() || !ehDataISO(data)) throw new ErroDominio('VALIDACAO', 'Informe uma data válida e o motivo do estorno.')
  if (original.status !== 'ATIVO' || original.tipo !== 'NORMAL' || original.estornadoPorId) {
    throw new ErroDominio('REGRA', 'Só um lançamento ativo, normal e ainda não estornado pode ser estornado.')
  }
  if (data < original.data) throw new ErroDominio('REGRA', 'O estorno não pode ser anterior ao lançamento original.')
  await assertMesAberto(db, data)
  const ids = new Set(idsBlocosAfetados(original))
  validarDataContraSaldoInicial(data, (await db.blocos.toArray()).filter(b => ids.has(b.id)), await obterCondominio(db))
  const estorno: Lancamento = {
    ...original, id: novoId(), tipo: 'ESTORNO', data, mes: mesDe(data),
    descricao: `Estorno: ${original.descricao}`, observacoes: motivo.trim(),
    rateio: original.rateio ? structuredClone(original.rateio) : null,
    estornaLancamentoId: original.id, estornadoPorId: null,
    versao: 1, criadoEm: agora, atualizadoEm: agora,
  }
  await db.lancamentos.add(estorno)
  await db.lancamentos.put({ ...original, estornadoPorId: estorno.id, versao: original.versao + 1, atualizadoEm: agora })
  await registrarAuditoria(db, { entidade: 'lancamento', entidadeId: original.id, acao: 'estornado', resumo: `Estorno ${estorno.id} em ${data}: ${original.descricao}`, motivo: motivo.trim() }, agora)
  return estorno
}
