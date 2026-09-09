// Demonstrativo financeiro por bloco e resumo de cobranças (plano 4.2 e 5.4).
// Módulo PURO: sem React, sem Dexie, sem Date.now(); "hoje" e "agora" chegam por parâmetro.
// Dinheiro em centavos inteiros; saldos podem ser negativos. Regras explicadas em docs/regras-contabeis.md.
import type { Bloco, Categoria, Centavos, Cobranca, DataISO, Id, Lancamento, MesISO, Natureza, Periodo } from './tipos'
import { mesDe, mesesEntre, primeiraDataDoMes } from './datas'
import { formatarBRL } from './dinheiro'
import { situacaoCobranca } from './cobrancas'

/** Base de apuração: 'data' = regime de caixa (padrão); 'competencia' = visão gerencial ("Resultado acumulado"). */
export type BaseDemonstrativo = 'data' | 'competencia'

/** Uma linha do demonstrativo: um bloco ou o total (`blocoId: 'TOTAL'`). */
export interface LinhaDemonstrativo {
  blocoId: Id | 'TOTAL'
  nome: string
  ativo: boolean
  /** Quantidade de unidades informada em `unidadesPorBloco` (0 quando ausente). */
  unidades: number
  /** Saldo inicial anterior ao período + efeito dos lançamentos ATIVOS anteriores ao período. */
  saldoAnterior: Centavos
  /** Saldo inicial do bloco quando `dataSaldoInicial` cai dentro do período. NÃO é receita. */
  saldoInicialNoPeriodo: Centavos
  /** Receitas de escopo BLOCO/UNIDADE. */
  receitasProprias: Centavos
  /** Cotas de receitas GERAIS (snapshot do rateio). */
  receitasRateadas: Centavos
  despesasProprias: Centavos
  despesasRateadas: Centavos
  /** Líquido de transferências: recebido − enviado. */
  transferencias: Centavos
  /** Informativo (v2): valor bruto dos estornos de receita no período (já descontado de receitasProprias/Rateadas). */
  estornosReceita: Centavos
  /** Informativo (v2): valor bruto dos estornos de despesa no período (já descontado de despesasProprias/Rateadas). */
  estornosDespesa: Centavos
  /** receitasProprias + receitasRateadas (líquidas de estornos) */
  receitas: Centavos
  /** despesasProprias + despesasRateadas */
  despesas: Centavos
  /** receitas − despesas + transferencias */
  saldoPeriodo: Centavos
  /** saldoAnterior + saldoInicialNoPeriodo + saldoPeriodo */
  saldoFinal: Centavos
}

/** Resumo das cobranças de um conjunto de competências. */
export interface ResumoCobrancas {
  competencias: MesISO[]
  /** Todas as cobranças das competências, qualquer status. */
  geradas: number
  pagas: number
  /** Status ABERTA (a vencer + vencidas). */
  abertas: number
  /** ABERTA já vencida segundo `situacaoCobranca` (vencimento < hoje). */
  vencidas: number
  canceladas: number
  isentas: number
  /** Σ valorCentavos das não canceladas/isentas (abertas + pagas). */
  valorCobradoCentavos: Centavos
  /** Σ valorPagoCentavos das PAGAS (sem juros). */
  valorRecebidoCentavos: Centavos
  /** Σ jurosCentavos das PAGAS. */
  valorJurosCentavos: Centavos
  /** Σ (valorCentavos − valorPagoCentavos) das PAGAS, quando positivo. */
  valorDescontosCentavos: Centavos
  /** Σ valorCentavos das ABERTAS. */
  valorEmAbertoCentavos: Centavos
  porBloco: Record<Id, ResumoCobrancasBloco>
}

/** Mesmo resumo, por bloco. */
export type ResumoCobrancasBloco = Omit<ResumoCobrancas, 'competencias' | 'porBloco'>

/** Agregado por categoria (valores absolutos atribuídos). */
export interface ItemCategoria {
  categoriaId: Id
  nome: string
  natureza: Natureza
  valorCentavos: Centavos
}

/** Lançamento do período com o valor que ele representa na visão exibida. */
export interface LancamentoAtribuido {
  lancamento: Lancamento
  /**
   * Sem filtro: efeitoNoCaixa (transferência = 0).
   * Com filtro de bloco: cota × sinal (GERAL), valor × sinal (BLOCO/UNIDADE), ±valor (TRANSFERENCIA).
   */
  valorAtribuidoCentavos: Centavos
  /** Só em GERAL com filtro: "cota de R$ 50,00 de R$ 1.000,00 (16/320 aptos)". */
  descricaoCota?: string
}

export interface Demonstrativo {
  periodo: Periodo
  base: BaseDemonstrativo
  filtroBlocoId: Id | null
  /** Timestamp recebido em `agora`. */
  emitidoEm: string
  /** Linhas exibidas, ordenadas por `bloco.ordem`. */
  linhas: LinhaDemonstrativo[]
  /** Soma das linhas exibidas. */
  total: LinhaDemonstrativo
  /** Σ saldoPeriodo de TODOS os blocos (não só os exibidos) − Σ efeitoNoCaixa dos ATIVOS do período. Sempre 0. */
  conferenciaCentavos: Centavos
  /** Só RECEITA/DESPESA; RECEITA primeiro, depois valor decrescente. */
  porCategoria: ItemCategoria[]
  /** ATIVOS do período (com filtro: só os que afetam o bloco), por campoBase e depois criadoEm. */
  lancamentos: LancamentoAtribuido[]
  /** null quando `cobrancas` não foi informado. */
  cobrancas: ResumoCobrancas | null
}

export interface ParametrosDemonstrativo {
  periodo: Periodo
  /** Default 'data'. */
  base?: BaseDemonstrativo
  filtroBlocoId?: Id | null
  /** Todos os blocos, ativos ou não. */
  blocos: readonly Bloco[]
  categorias: readonly Categoria[]
  /** Pode conter EXCLUÍDOS e lançamentos posteriores ao fim do período: o cálculo ignora ambos. */
  lancamentos: readonly Lancamento[]
  /** Ausente → `cobrancas: null` no resultado. */
  cobrancas?: readonly Cobranca[]
  /** Quantidade de unidades por bloco para a coluna `unidades` (default 0). */
  unidadesPorBloco?: ReadonlyMap<Id, number>
  hoje: DataISO
  agora: string
}

/** +1 receita, −1 despesa, 0 transferência; um ESTORNO inverte o sinal do original. */
export function sinal(l: Lancamento): 1 | -1 | 0 {
  const base: 1 | -1 | 0 = l.natureza === 'RECEITA' ? 1 : l.natureza === 'DESPESA' ? -1 : 0
  if (l.tipo !== 'ESTORNO') return base
  return base === 1 ? -1 : base === -1 ? 1 : 0
}

/** Multiplica sem produzir -0 (que quebraria comparações com Object.is). */
function aplicarSinal(s: 1 | -1 | 0, valor: Centavos): Centavos {
  return s === 1 ? valor : s === -1 ? 0 - valor : 0
}

/** Efeito no caixa do condomínio: sinal × valor (transferência = 0). */
export function efeitoNoCaixa(l: Lancamento): Centavos {
  return aplicarSinal(sinal(l), l.valorCentavos)
}

/** Valor de exibição/exportação; transferência exibe o montante, embora seja neutra no caixa geral. */
export function valorComSinal(l: Lancamento): Centavos {
  return l.natureza === 'TRANSFERENCIA' ? (l.tipo === 'ESTORNO' ? -l.valorCentavos : l.valorCentavos) : efeitoNoCaixa(l)
}

/**
 * Efeito no caixa de cada bloco.
 * GERAL: cada cota do snapshot × sinal; BLOCO/UNIDADE: valor × sinal no bloco;
 * TRANSFERENCIA: −valor na origem e +valor no destino.
 * Referências nulas (dados inconsistentes) são omitidas — a conferência do demonstrativo acusa a diferença.
 */
export function efeitoPorBloco(l: Lancamento): Array<{ blocoId: Id; valorCentavos: Centavos }> {
  if (l.natureza === 'TRANSFERENCIA') {
    // ESTORNO de transferência devolve o dinheiro: origem recebe, destino paga.
    const inverter = l.tipo === 'ESTORNO'
    const efeitos: Array<{ blocoId: Id; valorCentavos: Centavos }> = []
    if (l.blocoOrigemId !== null) efeitos.push({ blocoId: l.blocoOrigemId, valorCentavos: inverter ? l.valorCentavos : 0 - l.valorCentavos })
    if (l.blocoId !== null) efeitos.push({ blocoId: l.blocoId, valorCentavos: inverter ? 0 - l.valorCentavos : l.valorCentavos })
    return efeitos
  }
  const s = sinal(l)
  if (l.escopoTipo === 'GERAL') {
    return (l.rateio?.cotas ?? []).map((c) => ({ blocoId: c.blocoId, valorCentavos: aplicarSinal(s, c.valorCentavos) }))
  }
  return l.blocoId === null ? [] : [{ blocoId: l.blocoId, valorCentavos: aplicarSinal(s, l.valorCentavos) }]
}

/** Data usada para situar o lançamento: 'data' → l.data; 'competencia' → 1º dia de l.competencia. */
export function campoBase(l: Lancamento, base: BaseDemonstrativo): DataISO {
  return base === 'competencia' ? primeiraDataDoMes(l.competencia) : l.data
}

interface Acumulador {
  anterior: Centavos
  receitasProprias: Centavos
  receitasRateadas: Centavos
  despesasProprias: Centavos
  despesasRateadas: Centavos
  transferencias: Centavos
  estornosReceita: Centavos
  estornosDespesa: Centavos
  /** Algum lançamento ATIVO do período afetou o bloco. */
  movimentou: boolean
}

function novoAcumulador(): Acumulador {
  return {
    anterior: 0,
    receitasProprias: 0,
    receitasRateadas: 0,
    despesasProprias: 0,
    despesasRateadas: 0,
    transferencias: 0,
    estornosReceita: 0,
    estornosDespesa: 0,
    movimentou: false,
  }
}

/** Soma ao acumulador o efeito `valor` (já com sinal; estornos chegam com sinal invertido) de um lançamento do período. */
function acumularNoPeriodo(a: Acumulador, l: Lancamento, valor: Centavos): void {
  a.movimentou = true
  if (l.natureza === 'TRANSFERENCIA') {
    a.transferencias += valor
    return
  }
  if (l.tipo === 'ESTORNO') {
    if (l.natureza === 'RECEITA') a.estornosReceita += Math.abs(valor)
    else a.estornosDespesa += Math.abs(valor)
  }
  const rateado = l.escopoTipo === 'GERAL'
  if (l.natureza === 'RECEITA') {
    if (rateado) a.receitasRateadas += valor
    else a.receitasProprias += valor
  } else if (rateado) a.despesasRateadas += 0 - valor
  else a.despesasProprias += 0 - valor
}

function montarLinha(b: Bloco, a: Acumulador, periodo: Periodo, unidades: number): LinhaDemonstrativo {
  const saldoAnterior = (b.dataSaldoInicial < periodo.inicio ? b.saldoInicialCentavos : 0) + a.anterior
  const saldoInicialNoPeriodo =
    b.dataSaldoInicial >= periodo.inicio && b.dataSaldoInicial <= periodo.fim ? b.saldoInicialCentavos : 0
  const receitas = a.receitasProprias + a.receitasRateadas
  const despesas = a.despesasProprias + a.despesasRateadas
  const saldoPeriodo = receitas - despesas + a.transferencias
  return {
    blocoId: b.id,
    nome: b.nome,
    ativo: b.ativo,
    unidades,
    saldoAnterior,
    saldoInicialNoPeriodo,
    receitasProprias: a.receitasProprias,
    receitasRateadas: a.receitasRateadas,
    despesasProprias: a.despesasProprias,
    despesasRateadas: a.despesasRateadas,
    transferencias: a.transferencias,
    estornosReceita: a.estornosReceita,
    estornosDespesa: a.estornosDespesa,
    receitas,
    despesas,
    saldoPeriodo,
    saldoFinal: saldoAnterior + saldoInicialNoPeriodo + saldoPeriodo,
  }
}

function somarLinhas(linhas: readonly LinhaDemonstrativo[]): LinhaDemonstrativo {
  const total: LinhaDemonstrativo = {
    blocoId: 'TOTAL',
    nome: 'Total',
    ativo: true,
    unidades: 0,
    saldoAnterior: 0,
    saldoInicialNoPeriodo: 0,
    receitasProprias: 0,
    receitasRateadas: 0,
    despesasProprias: 0,
    despesasRateadas: 0,
    transferencias: 0,
    estornosReceita: 0,
    estornosDespesa: 0,
    receitas: 0,
    despesas: 0,
    saldoPeriodo: 0,
    saldoFinal: 0,
  }
  for (const l of linhas) {
    total.estornosReceita += l.estornosReceita
    total.estornosDespesa += l.estornosDespesa
    total.unidades += l.unidades
    total.saldoAnterior += l.saldoAnterior
    total.saldoInicialNoPeriodo += l.saldoInicialNoPeriodo
    total.receitasProprias += l.receitasProprias
    total.receitasRateadas += l.receitasRateadas
    total.despesasProprias += l.despesasProprias
    total.despesasRateadas += l.despesasRateadas
    total.transferencias += l.transferencias
    total.receitas += l.receitas
    total.despesas += l.despesas
    total.saldoPeriodo += l.saldoPeriodo
    total.saldoFinal += l.saldoFinal
  }
  return total
}

function compararTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Parcela do lançamento que afeta `blocoId`; null se não o afeta. */
function atribuirAoBloco(l: Lancamento, blocoId: Id): LancamentoAtribuido | null {
  const efeitos = efeitoPorBloco(l).filter((e) => e.blocoId === blocoId)
  if (efeitos.length === 0) return null
  let valor = 0
  for (const e of efeitos) valor += e.valorCentavos
  const atribuido: LancamentoAtribuido = { lancamento: l, valorAtribuidoCentavos: valor }
  if (l.escopoTipo === 'GERAL' && l.rateio) {
    const cota = l.rateio.cotas.find((c) => c.blocoId === blocoId)
    if (cota) {
      atribuido.descricaoCota = `cota de ${formatarBRL(cota.valorCentavos)} de ${formatarBRL(l.valorCentavos)} (${cota.unidadesAtivas}/${l.rateio.totalUnidades} aptos)`
    }
  }
  return atribuido
}

function agruparPorCategoria(atribuidos: readonly LancamentoAtribuido[], categorias: readonly Categoria[]): ItemCategoria[] {
  const nomes = new Map<Id, string>()
  for (const c of categorias) nomes.set(c.id, c.nome)
  const itens = new Map<Id, ItemCategoria>()
  for (const { lancamento: l, valorAtribuidoCentavos } of atribuidos) {
    if (l.natureza === 'TRANSFERENCIA') continue
    let item = itens.get(l.categoriaId)
    if (!item) {
      item = {
        categoriaId: l.categoriaId,
        nome: nomes.get(l.categoriaId) ?? 'Categoria removida',
        natureza: l.natureza,
        valorCentavos: 0,
      }
      itens.set(l.categoriaId, item)
    }
    item.valorCentavos += l.tipo === 'ESTORNO' ? 0 - Math.abs(valorAtribuidoCentavos) : Math.abs(valorAtribuidoCentavos)
  }
  const pesoNatureza = (n: Natureza): number => (n === 'RECEITA' ? 0 : 1)
  return [...itens.values()].sort(
    (a, b) =>
      pesoNatureza(a.natureza) - pesoNatureza(b.natureza) ||
      b.valorCentavos - a.valorCentavos ||
      compararTexto(a.nome, b.nome) ||
      compararTexto(a.categoriaId, b.categoriaId),
  )
}

/**
 * Calcula o demonstrativo do período. Só lançamentos ATIVOS entram; os posteriores ao fim são ignorados;
 * os anteriores ao início compõem o saldo anterior. Blocos inativos aparecem só com movimento no período
 * ou saldo final ≠ 0. Com `filtroBlocoId`, `linhas` traz só aquele bloco e `lancamentos` só o que o afeta.
 */
export function calcularDemonstrativo(p: ParametrosDemonstrativo): Demonstrativo {
  const base: BaseDemonstrativo = p.base ?? 'data'
  const filtroBlocoId: Id | null = p.filtroBlocoId ?? null
  const { inicio, fim } = p.periodo

  const acumuladores = new Map<Id, Acumulador>()
  for (const b of p.blocos) acumuladores.set(b.id, novoAcumulador())

  const noPeriodo: Lancamento[] = []
  let somaEfeitoNoCaixa = 0
  for (const l of p.lancamentos) {
    if (l.status !== 'ATIVO') continue
    const data = campoBase(l, base)
    if (data > fim) continue
    if (data < inicio) {
      for (const e of efeitoPorBloco(l)) {
        const a = acumuladores.get(e.blocoId)
        if (a) a.anterior += e.valorCentavos
      }
      continue
    }
    noPeriodo.push(l)
    somaEfeitoNoCaixa += efeitoNoCaixa(l)
    for (const e of efeitoPorBloco(l)) {
      const a = acumuladores.get(e.blocoId)
      if (a) acumularNoPeriodo(a, l, e.valorCentavos)
    }
  }

  const blocosOrdenados = [...p.blocos].sort((a, b) => a.ordem - b.ordem || compararTexto(a.id, b.id))
  const linhasPorBloco = new Map<Id, LinhaDemonstrativo>()
  let somaSaldoPeriodo = 0
  const exibidas: LinhaDemonstrativo[] = []
  for (const b of blocosOrdenados) {
    const a = acumuladores.get(b.id) ?? novoAcumulador()
    const linha = montarLinha(b, a, p.periodo, p.unidadesPorBloco?.get(b.id) ?? 0)
    linhasPorBloco.set(b.id, linha)
    somaSaldoPeriodo += linha.saldoPeriodo
    const exibir =
      filtroBlocoId !== null
        ? b.id === filtroBlocoId
        : b.ativo || a.movimentou || linha.saldoInicialNoPeriodo !== 0 || linha.saldoFinal !== 0
    if (exibir) exibidas.push(linha)
  }

  const ordenados = [...noPeriodo].sort(
    (a, b) =>
      compararTexto(campoBase(a, base), campoBase(b, base)) ||
      compararTexto(a.criadoEm, b.criadoEm) ||
      compararTexto(a.id, b.id),
  )
  const atribuidos: LancamentoAtribuido[] = []
  for (const l of ordenados) {
    if (filtroBlocoId === null) {
      atribuidos.push({ lancamento: l, valorAtribuidoCentavos: efeitoNoCaixa(l) })
    } else {
      const atribuido = atribuirAoBloco(l, filtroBlocoId)
      if (atribuido) atribuidos.push(atribuido)
    }
  }

  let cobrancas: ResumoCobrancas | null = null
  if (p.cobrancas) {
    const competencias = mesesEntre(mesDe(inicio), mesDe(fim))
    const lista = filtroBlocoId === null ? p.cobrancas : p.cobrancas.filter((c) => c.blocoId === filtroBlocoId)
    cobrancas = resumirCobrancas(lista, competencias, p.hoje)
  }

  return {
    periodo: { inicio, fim },
    base,
    filtroBlocoId,
    emitidoEm: p.agora,
    linhas: exibidas,
    total: somarLinhas(exibidas),
    conferenciaCentavos: somaSaldoPeriodo - somaEfeitoNoCaixa,
    porCategoria: agruparPorCategoria(atribuidos, p.categorias),
    lancamentos: atribuidos,
    cobrancas,
  }
}

function resumoVazio(): ResumoCobrancasBloco {
  return {
    geradas: 0,
    pagas: 0,
    abertas: 0,
    vencidas: 0,
    canceladas: 0,
    isentas: 0,
    valorCobradoCentavos: 0,
    valorRecebidoCentavos: 0,
    valorJurosCentavos: 0,
    valorDescontosCentavos: 0,
    valorEmAbertoCentavos: 0,
  }
}

function acumularCobranca(r: ResumoCobrancasBloco, c: Cobranca, hoje: DataISO): void {
  r.geradas += 1
  switch (c.status) {
    case 'PAGA': {
      r.pagas += 1
      r.valorCobradoCentavos += c.valorCentavos
      // PAGA sem valorPagoCentavos é inconsistência; assume-se pagamento integral.
      const pago = c.valorPagoCentavos ?? c.valorCentavos
      r.valorRecebidoCentavos += pago
      r.valorJurosCentavos += c.jurosCentavos
      const desconto = c.valorCentavos - pago
      if (desconto > 0) r.valorDescontosCentavos += desconto
      break
    }
    case 'ABERTA':
      r.abertas += 1
      if (situacaoCobranca(c, hoje) === 'VENCIDA') r.vencidas += 1
      r.valorCobradoCentavos += c.valorCentavos
      r.valorEmAbertoCentavos += c.valorCentavos
      break
    case 'CANCELADA':
      r.canceladas += 1
      break
    case 'ISENTA':
      r.isentas += 1
      break
  }
}

/**
 * Resume as cobranças cujas competências estão em `competencias` (as demais são ignoradas).
 * `vencidas` = ABERTA com situação VENCIDA (`situacaoCobranca` de ./cobrancas: vencimento < hoje).
 * `porBloco` repete o cálculo por `blocoId`.
 */
export function resumirCobrancas(
  cobrancas: readonly Cobranca[],
  competencias: readonly MesISO[],
  hoje: DataISO,
): ResumoCobrancas {
  const conjunto = new Set(competencias)
  const total = resumoVazio()
  const porBloco: Record<Id, ResumoCobrancasBloco> = {}
  for (const c of cobrancas) {
    if (!conjunto.has(c.competencia)) continue
    let doBloco = porBloco[c.blocoId]
    if (!doBloco) {
      doBloco = resumoVazio()
      porBloco[c.blocoId] = doBloco
    }
    acumularCobranca(total, c, hoje)
    acumularCobranca(doBloco, c, hoje)
  }
  return { competencias: [...competencias], ...total, porBloco }
}
