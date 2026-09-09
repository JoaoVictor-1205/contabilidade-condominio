// Regras e utilitários compartilhados pelos serviços (existência, saldo inicial, categorias de sistema).
import { formatarData, formatarMesCurto, mesDe } from '../dominio/datas'
import { ErroDominio } from '../dominio/erros'
import type { Bloco, Categoria, CategoriaSistema, Cobranca, Condominio, DataISO, Id, Lancamento, MesISO, Unidade } from '../dominio/tipos'
import type { BancoSindico } from './db'

export async function obterCondominio(db: BancoSindico): Promise<Condominio> {
  const c = await db.condominio.get('unico')
  if (!c) throw new ErroDominio('NAO_ENCONTRADO', 'Cadastro do condomínio não encontrado.')
  return c
}

export async function exigirBloco(db: BancoSindico, id: Id): Promise<Bloco> {
  const b = await db.blocos.get(id)
  if (!b) throw new ErroDominio('NAO_ENCONTRADO', 'Bloco não encontrado.', { id })
  return b
}

export async function exigirUnidade(db: BancoSindico, id: Id): Promise<Unidade> {
  const u = await db.unidades.get(id)
  if (!u) throw new ErroDominio('NAO_ENCONTRADO', 'Apartamento não encontrado.', { id })
  return u
}

export async function exigirCategoria(db: BancoSindico, id: Id): Promise<Categoria> {
  const c = await db.categorias.get(id)
  if (!c) throw new ErroDominio('NAO_ENCONTRADO', 'Categoria não encontrada.', { id })
  return c
}

export async function exigirLancamento(db: BancoSindico, id: Id): Promise<Lancamento> {
  const l = await db.lancamentos.get(id)
  if (!l) throw new ErroDominio('NAO_ENCONTRADO', 'Lançamento não encontrado.', { id })
  return l
}

export async function exigirCobranca(db: BancoSindico, id: Id): Promise<Cobranca> {
  const c = await db.cobrancas.get(id)
  if (!c) throw new ErroDominio('NAO_ENCONTRADO', 'Cobrança não encontrada.', { id })
  return c
}

export async function categoriaDeSistema(db: BancoSindico, sistema: CategoriaSistema): Promise<Categoria> {
  const c = await db.categorias.filter((x) => x.sistema === sistema).first()
  if (!c) throw new ErroDominio('NAO_ENCONTRADO', `Categoria de sistema ${sistema} não encontrada.`)
  return c
}

/**
 * Regra 5.1.5: nenhum lançamento pode ter data anterior ao 1º dia do início contábil
 * nem anterior à data do saldo inicial de qualquer bloco afetado (o saldo de abertura já representa o passado).
 */
export function validarDataContraSaldoInicial(data: DataISO, blocosAfetados: readonly Bloco[], condominio: Condominio): void {
  const inicio = `${condominio.inicioContabil}-01`
  if (data < inicio) {
    throw new ErroDominio(
      'DATA_ANTERIOR_AO_SALDO_INICIAL',
      `O sistema começa em ${formatarData(inicio)}. Para registrar antes disso, recue o início contábil em Estrutura > Condomínio.`,
      { data, inicio },
    )
  }
  for (const b of blocosAfetados) {
    if (data < b.dataSaldoInicial) {
      throw new ErroDominio(
        'DATA_ANTERIOR_AO_SALDO_INICIAL',
        `O saldo inicial do bloco ${b.nome} é de ${formatarData(b.dataSaldoInicial)}; para registrar antes disso, recue o saldo inicial em Estrutura > Blocos.`,
        { data, blocoId: b.id, dataSaldoInicial: b.dataSaldoInicial },
      )
    }
  }
}

/** v2: escritas com data em mês fechado (ou anterior) são recusadas; corrija por estorno ou reabra o último mês. */
export async function assertMesAberto(db: BancoSindico, data: DataISO): Promise<void> {
  const ultimo = await db.fechamentos.orderBy('mes').last()
  if (ultimo && mesDe(data) <= ultimo.mes) {
    throw new ErroDominio(
      'MES_FECHADO',
      `O mês ${formatarMesCurto(mesDe(data))} está fechado (último fechamento: ${formatarMesCurto(ultimo.mes)}). Use "Estornar" ou reabra o mês em Avançado › Fechamento.`,
      { data, ultimoMesFechado: ultimo.mes },
    )
  }
}

export async function ultimoMesFechadoNoBanco(db: BancoSindico): Promise<MesISO | null> {
  return (await db.fechamentos.orderBy('mes').last())?.mes ?? null
}

/** Blocos afetados por um lançamento: cotas do rateio (GERAL), o bloco (BLOCO/UNIDADE) ou origem+destino (TRANSFERENCIA). */
export function idsBlocosAfetados(l: Pick<Lancamento, 'escopoTipo' | 'blocoId' | 'blocoOrigemId' | 'rateio' | 'natureza'>): Id[] {
  if (l.natureza === 'TRANSFERENCIA') return [l.blocoOrigemId, l.blocoId].filter((x): x is Id => !!x)
  if (l.escopoTipo === 'GERAL') return (l.rateio?.cotas ?? []).map((c) => c.blocoId)
  return l.blocoId ? [l.blocoId] : []
}

/** Ids de unidades referenciadas por lançamentos ou cobranças (não podem ser excluídas fisicamente). */
export async function unidadesReferenciadas(db: BancoSindico, ids: readonly Id[]): Promise<Set<Id>>{
  const ref = new Set<Id>()
  if (ids.length === 0) return ref
  await db.lancamentos.where('unidadeId').anyOf([...ids]).each((l) => {
    if (l.unidadeId) ref.add(l.unidadeId)
  })
  await db.cobrancas.where('unidadeId').anyOf([...ids]).each((c) => ref.add(c.unidadeId))
  return ref
}

/** Um bloco é referenciado se aparece em lançamentos (bloco, origem ou cota de rateio), cobranças ou unidades com histórico. */
export async function blocoReferenciado(db: BancoSindico, blocoId: Id): Promise<boolean> {
  if ((await db.lancamentos.where('blocoId').equals(blocoId).count()) > 0) return true
  if ((await db.lancamentos.where('blocoOrigemId').equals(blocoId).count()) > 0) return true
  if ((await db.cobrancas.where('blocoId').equals(blocoId).count()) > 0) return true
  const geral = await db.lancamentos.where('escopoTipo').equals('GERAL').toArray()
  return geral.some((l) => l.rateio?.cotas.some((c) => c.blocoId === blocoId))
}
