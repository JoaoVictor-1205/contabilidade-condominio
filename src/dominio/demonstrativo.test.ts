// Testes do demonstrativo. Reproduzem o cenário de referência de docs/regras-contabeis.md (seções 8 e 9).
import { describe, expect, it } from 'vitest'
import type { Bloco, Categoria, Centavos, Cobranca, Id, Lancamento, RateioSnapshot } from './tipos'
import { mesDe, periodoDoAno, periodoDoMes } from './datas'
import {
  calcularDemonstrativo,
  campoBase,
  efeitoNoCaixa,
  efeitoPorBloco,
  resumirCobrancas,
  sinal,
} from './demonstrativo'
import type { Demonstrativo, LinhaDemonstrativo, ParametrosDemonstrativo } from './demonstrativo'

const T0 = '2026-01-01T00:00:00'
const HOJE = '2026-09-20'
const AGORA = '2026-09-20T10:00:00'

// ---------------------------------------------------------------------------
// Fábricas locais (src/testes/fabricas.ts ainda não existe)
// ---------------------------------------------------------------------------

function bloco(p: Partial<Bloco> & Pick<Bloco, 'id' | 'ordem'>): Bloco {
  return {
    nome: `Bloco ${p.id}`,
    quartos: 2,
    andares: 1,
    aptosPorAndar: 1,
    ativo: true,
    saldoInicialCentavos: 0,
    dataSaldoInicial: '2026-01-01',
    criadoEm: T0,
    atualizadoEm: T0,
    ...p,
  }
}

function categoria(p: Partial<Categoria> & Pick<Categoria, 'id' | 'nome' | 'natureza'>): Categoria {
  return { ordem: 1, ativa: true, sistema: null, ...p }
}

/** Snapshot a partir de [blocoId, unidadesAtivas, valorCentavos]. */
function rateio(cotas: ReadonlyArray<readonly [Id, number, Centavos]>): RateioSnapshot {
  return {
    criterio: 'POR_UNIDADE',
    totalUnidades: cotas.reduce((soma, c) => soma + c[1], 0),
    cotas: cotas.map(([blocoId, unidadesAtivas, valorCentavos]) => ({
      blocoId,
      nomeBloco: `Bloco ${blocoId}`,
      unidadesAtivas,
      valorCentavos,
    })),
    calculadoEm: T0,
  }
}

function lancamento(
  p: Partial<Lancamento> & Pick<Lancamento, 'id' | 'natureza' | 'data' | 'valorCentavos'>,
): Lancamento {
  const mes = mesDe(p.data)
  return {
    tipo: 'NORMAL',
    status: 'ATIVO',
    escopoTipo: 'BLOCO',
    blocoId: null,
    unidadeId: null,
    blocoOrigemId: null,
    mes,
    competencia: mes,
    categoriaId: 'cat-limpeza',
    descricao: p.id,
    formaPagamento: 'PIX',
    rateio: null,
    cobrancaId: null,
    estornaLancamentoId: null,
    estornadoPorId: null,
    versao: 1,
    criadoEm: `${p.data}T10:00:00`,
    atualizadoEm: `${p.data}T10:00:00`,
    ...p,
  }
}

function cobranca(p: Partial<Cobranca> & Pick<Cobranca, 'id' | 'unidadeId' | 'blocoId'>): Cobranca {
  return {
    competencia: '2026-09',
    valorCentavos: 250_00,
    vencimento: '2026-09-10',
    status: 'ABERTA',
    taxaVigenciaId: 'taxa-2q',
    origemValor: 'TAXA',
    lancamentoId: null,
    pagaEm: null,
    valorPagoCentavos: null,
    jurosCentavos: 0,
    criadoEm: T0,
    atualizadoEm: T0,
    ...p,
  }
}

function linhaEsperada(
  p: Partial<LinhaDemonstrativo> & Pick<LinhaDemonstrativo, 'blocoId' | 'nome'>,
): LinhaDemonstrativo {
  return {
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
    ...p,
  }
}

// ---------------------------------------------------------------------------
// Cenário de referência (docs/regras-contabeis.md, seção 8)
// ---------------------------------------------------------------------------

const CATEGORIAS: Categoria[] = [
  categoria({ id: 'cat-limpeza', nome: 'Limpeza e conservação', natureza: 'DESPESA' }),
  categoria({ id: 'cat-agua', nome: 'Água e esgoto', natureza: 'DESPESA' }),
  categoria({ id: 'cat-aluguel', nome: 'Aluguel de espaços', natureza: 'RECEITA' }),
  categoria({ id: 'cat-extra', nome: 'Taxa extra', natureza: 'RECEITA' }),
  categoria({
    id: 'cat-transf',
    nome: 'Transferência entre blocos',
    natureza: 'TRANSFERENCIA',
    sistema: 'TRANSFERENCIA',
  }),
]

function blocosDoCenario(): Bloco[] {
  return [
    bloco({ id: 'A', ordem: 1, saldoInicialCentavos: 1_000_00, dataSaldoInicial: '2026-08-01' }),
    bloco({ id: 'B', ordem: 2, saldoInicialCentavos: 500_00, dataSaldoInicial: '2026-09-01' }),
    bloco({
      id: 'C',
      ordem: 3,
      ativo: false,
      desativadoEm: '2026-09-25T10:00:00',
      saldoInicialCentavos: 700_00,
      dataSaldoInicial: '2026-08-01',
    }),
  ]
}

function lancamentosDoCenario(): Lancamento[] {
  return [
    lancamento({
      id: 'L1',
      natureza: 'DESPESA',
      escopoTipo: 'GERAL',
      data: '2026-09-10',
      valorCentavos: 1_000_00,
      categoriaId: 'cat-limpeza',
      rateio: rateio([
        ['A', 2, 200_00],
        ['B', 3, 300_00],
        ['C', 5, 500_00],
      ]),
    }),
    lancamento({
      id: 'L2',
      natureza: 'RECEITA',
      escopoTipo: 'BLOCO',
      blocoId: 'B',
      data: '2026-09-05',
      valorCentavos: 150_00,
      categoriaId: 'cat-aluguel',
    }),
    lancamento({
      id: 'L3',
      natureza: 'RECEITA',
      escopoTipo: 'UNIDADE',
      blocoId: 'A',
      unidadeId: 'A-101',
      data: '2026-09-12',
      competencia: '2026-08',
      valorCentavos: 80_00,
      categoriaId: 'cat-extra',
    }),
    lancamento({
      id: 'L4',
      natureza: 'TRANSFERENCIA',
      escopoTipo: 'BLOCO',
      blocoOrigemId: 'A',
      blocoId: 'B',
      data: '2026-09-15',
      valorCentavos: 100_00,
      categoriaId: 'cat-transf',
    }),
    lancamento({
      id: 'L5',
      natureza: 'DESPESA',
      escopoTipo: 'BLOCO',
      blocoId: 'A',
      data: '2026-09-20',
      valorCentavos: 999_00,
      categoriaId: 'cat-limpeza',
      status: 'EXCLUIDO',
      excluidoEm: '2026-09-21T10:00:00',
      motivoExclusao: 'lançado em duplicidade',
    }),
    lancamento({
      id: 'L6',
      natureza: 'DESPESA',
      escopoTipo: 'BLOCO',
      blocoId: 'A',
      data: '2026-08-20',
      valorCentavos: 30_00,
      categoriaId: 'cat-limpeza',
    }),
    lancamento({
      id: 'L7',
      natureza: 'RECEITA',
      escopoTipo: 'BLOCO',
      blocoId: 'B',
      data: '2026-10-03',
      valorCentavos: 70_00,
      categoriaId: 'cat-aluguel',
    }),
    lancamento({
      id: 'L8',
      natureza: 'DESPESA',
      escopoTipo: 'BLOCO',
      blocoId: 'B',
      data: '2026-10-02',
      competencia: '2026-09',
      valorCentavos: 40_00,
      categoriaId: 'cat-agua',
    }),
  ]
}

function cobrancasDoCenario(): Cobranca[] {
  return [
    cobranca({
      id: 'c1',
      unidadeId: 'A-101',
      blocoId: 'A',
      valorCentavos: 300_00,
      status: 'PAGA',
      pagaEm: '2026-09-08',
      valorPagoCentavos: 300_00,
      lancamentoId: 'LT1',
    }),
    cobranca({
      id: 'c2',
      unidadeId: 'A-102',
      blocoId: 'A',
      valorCentavos: 300_00,
      status: 'PAGA',
      pagaEm: '2026-09-15',
      valorPagoCentavos: 300_00,
      jurosCentavos: 10_00,
      lancamentoId: 'LT2',
    }),
    cobranca({
      id: 'c3',
      unidadeId: 'B-201',
      blocoId: 'B',
      status: 'PAGA',
      pagaEm: '2026-09-09',
      valorPagoCentavos: 240_00,
      lancamentoId: 'LT3',
    }),
    cobranca({ id: 'c4', unidadeId: 'B-202', blocoId: 'B' }),
    cobranca({ id: 'c5', unidadeId: 'B-203', blocoId: 'B', vencimento: '2026-09-30' }),
    cobranca({ id: 'c6', unidadeId: 'C-301', blocoId: 'C', valorCentavos: 200_00, status: 'CANCELADA' }),
    cobranca({ id: 'c7', unidadeId: 'C-302', blocoId: 'C', valorCentavos: 200_00, status: 'ISENTA' }),
  ]
}

const UNIDADES_POR_BLOCO: ReadonlyMap<Id, number> = new Map([
  ['A', 2],
  ['B', 3],
  ['C', 5],
])

function parametros(extra: Partial<ParametrosDemonstrativo> = {}): ParametrosDemonstrativo {
  return {
    periodo: periodoDoMes('2026-09'),
    blocos: blocosDoCenario(),
    categorias: CATEGORIAS,
    lancamentos: lancamentosDoCenario(),
    unidadesPorBloco: UNIDADES_POR_BLOCO,
    hoje: HOJE,
    agora: AGORA,
    ...extra,
  }
}

function calcular(extra: Partial<ParametrosDemonstrativo> = {}): Demonstrativo {
  return calcularDemonstrativo(parametros(extra))
}

function linha(d: Demonstrativo, blocoId: string): LinhaDemonstrativo {
  const l = d.linhas.find((x) => x.blocoId === blocoId)
  if (!l) throw new Error(`linha do bloco ${blocoId} não encontrada`)
  return l
}

function ids(d: Demonstrativo): string[] {
  return d.lancamentos.map((a) => a.lancamento.id)
}

function valores(d: Demonstrativo): Centavos[] {
  return d.lancamentos.map((a) => a.valorAtribuidoCentavos)
}

const LINHA_A = linhaEsperada({
  blocoId: 'A',
  nome: 'Bloco A',
  unidades: 2,
  saldoAnterior: 970_00,
  receitasProprias: 80_00,
  despesasRateadas: 200_00,
  transferencias: -100_00,
  receitas: 80_00,
  despesas: 200_00,
  saldoPeriodo: -220_00,
  saldoFinal: 750_00,
})

const LINHA_B = linhaEsperada({
  blocoId: 'B',
  nome: 'Bloco B',
  unidades: 3,
  saldoInicialNoPeriodo: 500_00,
  receitasProprias: 150_00,
  despesasRateadas: 300_00,
  transferencias: 100_00,
  receitas: 150_00,
  despesas: 300_00,
  saldoPeriodo: -50_00,
  saldoFinal: 450_00,
})

const LINHA_C = linhaEsperada({
  blocoId: 'C',
  nome: 'Bloco C',
  ativo: false,
  unidades: 5,
  saldoAnterior: 700_00,
  despesasRateadas: 500_00,
  despesas: 500_00,
  saldoPeriodo: -500_00,
  saldoFinal: 200_00,
})

const LINHA_TOTAL = linhaEsperada({
  blocoId: 'TOTAL',
  nome: 'Total',
  unidades: 10,
  saldoAnterior: 1_670_00,
  saldoInicialNoPeriodo: 500_00,
  receitasProprias: 230_00,
  despesasRateadas: 1_000_00,
  transferencias: 0,
  receitas: 230_00,
  despesas: 1_000_00,
  saldoPeriodo: -770_00,
  saldoFinal: 1_400_00,
})

// ---------------------------------------------------------------------------

describe('sinal, efeitoNoCaixa e efeitoPorBloco', () => {
  const receita = lancamento({ id: 'r', natureza: 'RECEITA', blocoId: 'A', data: '2026-09-01', valorCentavos: 10_00 })
  const despesa = lancamento({ id: 'd', natureza: 'DESPESA', blocoId: 'A', data: '2026-09-01', valorCentavos: 10_00 })
  const transferencia = lancamento({
    id: 't',
    natureza: 'TRANSFERENCIA',
    blocoOrigemId: 'A',
    blocoId: 'B',
    data: '2026-09-01',
    valorCentavos: 10_00,
  })

  it('sinal: +1 receita, -1 despesa, 0 transferência', () => {
    expect(sinal(receita)).toBe(1)
    expect(sinal(despesa)).toBe(-1)
    expect(sinal(transferencia)).toBe(0)
  })

  it('efeitoNoCaixa aplica o sinal ao valor; transferência é 0', () => {
    expect(efeitoNoCaixa(receita)).toBe(10_00)
    expect(efeitoNoCaixa(despesa)).toBe(-10_00)
    expect(efeitoNoCaixa(transferencia)).toBe(0)
  })

  it('BLOCO e UNIDADE: valor com sinal no bloco', () => {
    expect(efeitoPorBloco(receita)).toEqual([{ blocoId: 'A', valorCentavos: 10_00 }])
    expect(efeitoPorBloco(despesa)).toEqual([{ blocoId: 'A', valorCentavos: -10_00 }])
    const unidade = lancamento({
      id: 'u',
      natureza: 'RECEITA',
      escopoTipo: 'UNIDADE',
      blocoId: 'B',
      unidadeId: 'B-201',
      data: '2026-09-01',
      valorCentavos: 5_00,
    })
    expect(efeitoPorBloco(unidade)).toEqual([{ blocoId: 'B', valorCentavos: 5_00 }])
  })

  it('GERAL: cada cota do snapshot com sinal', () => {
    const geral = lancamento({
      id: 'g',
      natureza: 'DESPESA',
      escopoTipo: 'GERAL',
      data: '2026-09-01',
      valorCentavos: 1_00,
      rateio: rateio([
        ['A', 1, 34],
        ['B', 1, 33],
        ['C', 1, 33],
      ]),
    })
    expect(efeitoPorBloco(geral)).toEqual([
      { blocoId: 'A', valorCentavos: -34 },
      { blocoId: 'B', valorCentavos: -33 },
      { blocoId: 'C', valorCentavos: -33 },
    ])
    expect(efeitoPorBloco({ ...geral, natureza: 'RECEITA' }).map((e) => e.valorCentavos)).toEqual([34, 33, 33])
  })

  it('TRANSFERENCIA: -valor na origem e +valor no destino', () => {
    expect(efeitoPorBloco(transferencia)).toEqual([
      { blocoId: 'A', valorCentavos: -10_00 },
      { blocoId: 'B', valorCentavos: 10_00 },
    ])
  })

  it('soma de efeitoPorBloco é igual a efeitoNoCaixa', () => {
    for (const l of [...lancamentosDoCenario(), receita, despesa, transferencia]) {
      const soma = efeitoPorBloco(l).reduce((s, e) => s + e.valorCentavos, 0)
      expect(soma).toBe(efeitoNoCaixa(l))
    }
  })

  it('referências ausentes são omitidas (dados inconsistentes não derrubam o relatório)', () => {
    const geralSemRateio = lancamento({
      id: 'g0',
      natureza: 'DESPESA',
      escopoTipo: 'GERAL',
      data: '2026-09-01',
      valorCentavos: 1_00,
    })
    expect(efeitoPorBloco(geralSemRateio)).toEqual([])
    expect(efeitoPorBloco({ ...despesa, blocoId: null })).toEqual([])
    expect(efeitoPorBloco({ ...transferencia, blocoOrigemId: null })).toEqual([{ blocoId: 'B', valorCentavos: 10_00 }])
  })

  it('nunca produz -0 (cota de zero centavos em despesa)', () => {
    const geral = lancamento({
      id: 'g1',
      natureza: 'DESPESA',
      escopoTipo: 'GERAL',
      data: '2026-09-01',
      valorCentavos: 1,
      rateio: rateio([
        ['A', 1, 1],
        ['B', 1, 0],
      ]),
    })
    const efeitos = efeitoPorBloco(geral)
    expect(Object.is(efeitos[1]?.valorCentavos, 0)).toBe(true)
    expect(Object.is(efeitoNoCaixa({ ...despesa, valorCentavos: 0 }), 0)).toBe(true)
  })
})

describe('campoBase', () => {
  const l = lancamento({
    id: 'x',
    natureza: 'RECEITA',
    blocoId: 'A',
    data: '2026-09-12',
    competencia: '2026-08',
    valorCentavos: 1_00,
  })

  it("'data' usa a data do lançamento", () => {
    expect(campoBase(l, 'data')).toBe('2026-09-12')
  })

  it("'competencia' usa o primeiro dia da competência", () => {
    expect(campoBase(l, 'competencia')).toBe('2026-08-01')
  })
})

describe('cenário de referência: Setembro/2026, base caixa, sem filtro', () => {
  const d = calcular()

  it('linhas A, B e C conferem com a tabela 8.3, na ordem dos blocos', () => {
    expect(d.linhas.map((l) => l.blocoId)).toEqual(['A', 'B', 'C'])
    expect(linha(d, 'A')).toEqual(LINHA_A)
    expect(linha(d, 'B')).toEqual(LINHA_B)
    expect(linha(d, 'C')).toEqual(LINHA_C)
  })

  it('total é a soma das linhas exibidas e as transferências somam zero', () => {
    expect(d.total).toEqual(LINHA_TOTAL)
    expect(d.total.saldoFinal).toBe(LINHA_A.saldoFinal + LINHA_B.saldoFinal + LINHA_C.saldoFinal)
    expect(d.total.transferencias).toBe(0)
  })

  it('conferência é zero', () => {
    expect(d.conferenciaCentavos).toBe(0)
  })

  it('metadados: período, base padrão, sem filtro, emitido em `agora`', () => {
    expect(d.periodo).toEqual({ inicio: '2026-09-01', fim: '2026-09-30' })
    expect(d.base).toBe('data')
    expect(d.filtroBlocoId).toBeNull()
    expect(d.emitidoEm).toBe(AGORA)
  })

  it('lançamentos do período em ordem de data, com efeito no caixa (transferência = 0)', () => {
    expect(ids(d)).toEqual(['L2', 'L1', 'L3', 'L4'])
    expect(valores(d)).toEqual([150_00, -1_000_00, 80_00, 0])
    expect(d.lancamentos.every((a) => a.descricaoCota === undefined)).toBe(true)
  })

  it('ignora o excluído (L5) e os posteriores ao período (L7, L8); L6 só compõe o saldo anterior', () => {
    expect(ids(d)).not.toContain('L5')
    expect(ids(d)).not.toContain('L6')
    expect(ids(d)).not.toContain('L7')
    expect(ids(d)).not.toContain('L8')
    expect(linha(d, 'A').despesasProprias).toBe(0)
    expect(linha(d, 'A').saldoAnterior).toBe(1_000_00 - 30_00)
  })

  it('porCategoria: receitas primeiro, valor decrescente, sem transferências', () => {
    expect(d.porCategoria).toEqual([
      { categoriaId: 'cat-aluguel', nome: 'Aluguel de espaços', natureza: 'RECEITA', valorCentavos: 150_00 },
      { categoriaId: 'cat-extra', nome: 'Taxa extra', natureza: 'RECEITA', valorCentavos: 80_00 },
      { categoriaId: 'cat-limpeza', nome: 'Limpeza e conservação', natureza: 'DESPESA', valorCentavos: 1_000_00 },
    ])
  })

  it('cobrancas é null sem o parâmetro e traz o resumo quando informado', () => {
    expect(d.cobrancas).toBeNull()
    const com = calcular({ cobrancas: cobrancasDoCenario() })
    expect(com.cobrancas?.competencias).toEqual(['2026-09'])
    expect(com.cobrancas?.geradas).toBe(7)
    expect(com.cobrancas?.valorRecebidoCentavos).toBe(840_00)
  })

  it('não altera os parâmetros de entrada', () => {
    const p = parametros()
    const copia = JSON.parse(JSON.stringify(p)) as unknown
    calcularDemonstrativo(p)
    expect(JSON.parse(JSON.stringify(p))).toEqual(copia)
  })

  it('unidades vale 0 quando unidadesPorBloco não é informado', () => {
    const sem = calcular({ unidadesPorBloco: undefined })
    expect(sem.linhas.map((l) => l.unidades)).toEqual([0, 0, 0])
    expect(sem.total.unidades).toBe(0)
  })
})

describe('saldo inicial', () => {
  it('antes do período entra no saldo anterior (bloco A)', () => {
    const a = linha(calcular(), 'A')
    expect(a.saldoAnterior).toBe(970_00)
    expect(a.saldoInicialNoPeriodo).toBe(0)
  })

  it('dentro do período entra em saldoInicialNoPeriodo, não no saldo anterior nem nas receitas (bloco B)', () => {
    const b = linha(calcular(), 'B')
    expect(b.saldoAnterior).toBe(0)
    expect(b.saldoInicialNoPeriodo).toBe(500_00)
    expect(b.receitas).toBe(150_00)
    expect(b.saldoFinal).toBe(500_00 - 50_00)
  })

  it('no último dia do período ainda conta como dentro', () => {
    const blocos = [bloco({ id: 'X', ordem: 1, saldoInicialCentavos: 123_45, dataSaldoInicial: '2026-09-30' })]
    const x = linha(calcular({ blocos, lancamentos: [] }), 'X')
    expect(x.saldoInicialNoPeriodo).toBe(123_45)
    expect(x.saldoAnterior).toBe(0)
    expect(x.saldoFinal).toBe(123_45)
  })

  it('depois do período não entra em lugar nenhum', () => {
    const blocos = [bloco({ id: 'X', ordem: 1, saldoInicialCentavos: 999_00, dataSaldoInicial: '2026-10-01' })]
    const d = calcular({ blocos, lancamentos: [] })
    const x = linha(d, 'X')
    expect(x.saldoAnterior).toBe(0)
    expect(x.saldoInicialNoPeriodo).toBe(0)
    expect(x.saldoFinal).toBe(0)
    expect(d.conferenciaCentavos).toBe(0)
  })

  it('saldo inicial negativo é aceito', () => {
    const blocos = [bloco({ id: 'X', ordem: 1, saldoInicialCentavos: -50_00, dataSaldoInicial: '2026-01-01' })]
    const x = linha(calcular({ blocos, lancamentos: [] }), 'X')
    expect(x.saldoAnterior).toBe(-50_00)
    expect(x.saldoFinal).toBe(-50_00)
  })
})

describe('base competência (tabela 8.5)', () => {
  const d = calcular({ base: 'competencia' })

  it('L3 (competência 08) vai para o saldo anterior de A; saldo final de A não muda', () => {
    const a = linha(d, 'A')
    expect(a.saldoAnterior).toBe(1_050_00)
    expect(a.receitasProprias).toBe(0)
    expect(a.saldoPeriodo).toBe(-300_00)
    expect(a.saldoFinal).toBe(750_00)
  })

  it('L8 (competência 09, pago em outubro) entra como despesa própria de B', () => {
    const b = linha(d, 'B')
    expect(b.despesasProprias).toBe(40_00)
    expect(b.saldoPeriodo).toBe(-90_00)
    expect(b.saldoFinal).toBe(410_00)
  })

  it('total e conferência da tabela 8.5', () => {
    expect(d.base).toBe('competencia')
    expect(d.total.saldoAnterior).toBe(1_750_00)
    expect(d.total.saldoPeriodo).toBe(-890_00)
    expect(d.total.saldoFinal).toBe(1_360_00)
    expect(d.conferenciaCentavos).toBe(0)
    expect(d.porCategoria.find((c) => c.categoriaId === 'cat-agua')?.valorCentavos).toBe(40_00)
  })

  it('lançamentos da mesma competência empatam no campoBase (1º dia) e ficam por criadoEm', () => {
    expect(ids(d)).toEqual(['L2', 'L1', 'L4', 'L8'])
    expect(ids(d)).not.toContain('L3')
    expect(valores(d)).toEqual([150_00, -1_000_00, 0, -40_00])
  })

  it('competências diferentes dentro do período ordenam pelo 1º dia de cada uma', () => {
    const blocos = [bloco({ id: 'A', ordem: 1 })]
    const lancamentos = [
      lancamento({ id: 'set', natureza: 'RECEITA', blocoId: 'A', data: '2026-11-01', competencia: '2026-09', valorCentavos: 1_00 }),
      lancamento({ id: 'ago', natureza: 'RECEITA', blocoId: 'A', data: '2026-11-02', competencia: '2026-08', valorCentavos: 1_00 }),
      lancamento({ id: 'out', natureza: 'RECEITA', blocoId: 'A', data: '2026-10-05', competencia: '2026-10', valorCentavos: 1_00 }),
    ]
    const ano = calcular({ base: 'competencia', periodo: periodoDoAno(2026), blocos, lancamentos })
    expect(ids(ano)).toEqual(['ago', 'set', 'out'])
  })

  it("base 'data' explícita é igual ao padrão", () => {
    expect(calcular({ base: 'data' })).toEqual(calcular())
  })
})

describe('filtro por bloco', () => {
  it('reproduz a linha do bloco A e o total é a própria linha', () => {
    const d = calcular({ filtroBlocoId: 'A' })
    expect(d.filtroBlocoId).toBe('A')
    expect(d.linhas).toEqual([LINHA_A])
    expect(d.total).toEqual({ ...LINHA_A, blocoId: 'TOTAL', nome: 'Total', ativo: true })
    expect(d.total.transferencias).toBe(-100_00)
  })

  it('lançamentos atribuídos ao bloco A: cota, valor próprio e transferência enviada', () => {
    const d = calcular({ filtroBlocoId: 'A' })
    expect(ids(d)).toEqual(['L1', 'L3', 'L4'])
    expect(valores(d)).toEqual([-200_00, 80_00, -100_00])
    expect(d.lancamentos[0]?.descricaoCota).toBe('cota de R$ 200,00 de R$ 1.000,00 (2/10 aptos)')
    expect(d.lancamentos[1]?.descricaoCota).toBeUndefined()
    expect(d.lancamentos[2]?.descricaoCota).toBeUndefined()
  })

  it('bloco B recebe a transferência e a cota de 3/10', () => {
    const d = calcular({ filtroBlocoId: 'B' })
    expect(d.linhas).toEqual([LINHA_B])
    expect(ids(d)).toEqual(['L2', 'L1', 'L4'])
    expect(valores(d)).toEqual([150_00, -300_00, 100_00])
    expect(d.lancamentos[1]?.descricaoCota).toBe('cota de R$ 300,00 de R$ 1.000,00 (3/10 aptos)')
  })

  it('bloco inativo pode ser filtrado', () => {
    const d = calcular({ filtroBlocoId: 'C' })
    expect(d.linhas).toEqual([LINHA_C])
    expect(ids(d)).toEqual(['L1'])
    expect(valores(d)).toEqual([-500_00])
  })

  it('conferência continua zero com filtro (calculada sobre todos os blocos)', () => {
    expect(calcular({ filtroBlocoId: 'A' }).conferenciaCentavos).toBe(0)
    expect(calcular({ filtroBlocoId: 'B' }).conferenciaCentavos).toBe(0)
    expect(calcular({ filtroBlocoId: 'C' }).conferenciaCentavos).toBe(0)
  })

  it('porCategoria agrega o valor atribuído ao bloco', () => {
    expect(calcular({ filtroBlocoId: 'A' }).porCategoria).toEqual([
      { categoriaId: 'cat-extra', nome: 'Taxa extra', natureza: 'RECEITA', valorCentavos: 80_00 },
      { categoriaId: 'cat-limpeza', nome: 'Limpeza e conservação', natureza: 'DESPESA', valorCentavos: 200_00 },
    ])
  })

  it('cobranças são filtradas pelo bloco', () => {
    const d = calcular({ filtroBlocoId: 'A', cobrancas: cobrancasDoCenario() })
    expect(d.cobrancas?.geradas).toBe(2)
    expect(d.cobrancas?.pagas).toBe(2)
    expect(d.cobrancas?.valorJurosCentavos).toBe(10_00)
    expect(Object.keys(d.cobrancas?.porBloco ?? {})).toEqual(['A'])
  })

  it('filtro por bloco inexistente devolve linhas vazias e total zerado', () => {
    const d = calcular({ filtroBlocoId: 'Z' })
    expect(d.linhas).toEqual([])
    expect(d.total).toEqual(linhaEsperada({ blocoId: 'TOTAL', nome: 'Total' }))
    expect(d.lancamentos).toEqual([])
    expect(d.porCategoria).toEqual([])
    expect(d.conferenciaCentavos).toBe(0)
  })

  it('filtroBlocoId null equivale a sem filtro', () => {
    expect(calcular({ filtroBlocoId: null })).toEqual(calcular())
  })
})

describe('transferências', () => {
  it('origem −valor, destino +valor, total zero', () => {
    const d = calcular()
    expect(linha(d, 'A').transferencias).toBe(-100_00)
    expect(linha(d, 'B').transferencias).toBe(100_00)
    expect(d.total.transferencias).toBe(0)
    expect(d.total.receitas).toBe(230_00)
    expect(d.total.despesas).toBe(1_000_00)
  })

  it('anterior ao período entra no saldo anterior dos dois blocos', () => {
    const blocos = [bloco({ id: 'A', ordem: 1 }), bloco({ id: 'B', ordem: 2 })]
    const lancamentos = [
      lancamento({
        id: 't0',
        natureza: 'TRANSFERENCIA',
        blocoOrigemId: 'A',
        blocoId: 'B',
        data: '2026-08-31',
        valorCentavos: 25_00,
        categoriaId: 'cat-transf',
      }),
    ]
    const d = calcular({ blocos, lancamentos })
    expect(linha(d, 'A').saldoAnterior).toBe(-25_00)
    expect(linha(d, 'B').saldoAnterior).toBe(25_00)
    expect(d.total.saldoAnterior).toBe(0)
    expect(d.conferenciaCentavos).toBe(0)
  })

  it('bloco inativo pode ser origem (saldo não fica preso) e aparece por ter movimento', () => {
    const blocos = [
      bloco({ id: 'A', ordem: 1 }),
      bloco({ id: 'D', ordem: 2, ativo: false, saldoInicialCentavos: 60_00, dataSaldoInicial: '2026-01-01' }),
    ]
    const lancamentos = [
      lancamento({
        id: 't1',
        natureza: 'TRANSFERENCIA',
        blocoOrigemId: 'D',
        blocoId: 'A',
        data: '2026-09-02',
        valorCentavos: 60_00,
        categoriaId: 'cat-transf',
      }),
    ]
    const d = calcular({ blocos, lancamentos })
    expect(d.linhas.map((l) => l.blocoId)).toEqual(['A', 'D'])
    expect(linha(d, 'D').transferencias).toBe(-60_00)
    expect(linha(d, 'D').saldoFinal).toBe(0)
    expect(linha(d, 'A').saldoFinal).toBe(60_00)
    expect(d.total.transferencias).toBe(0)
  })

  it('transferência não entra em porCategoria', () => {
    expect(calcular().porCategoria.some((c) => c.natureza === 'TRANSFERENCIA')).toBe(false)
  })
})

describe('estornos no demonstrativo', () => {
  const blocos = [bloco({ id: 'A', ordem: 1 }), bloco({ id: 'B', ordem: 2 })]
  function estorno(original: Lancamento): Lancamento {
    return { ...original, id: `e-${original.id}`, tipo: 'ESTORNO', data: '2026-10-02', mes: '2026-10', estornaLancamentoId: original.id, estornadoPorId: null, criadoEm: '2026-10-02T10:00:00', atualizadoEm: '2026-10-02T10:00:00' }
  }

  it.each(['RECEITA', 'DESPESA'] as const)('estorno de %s mantém caixa anterior, líquido e informativo por bloco e por competência', natureza => {
    const original = lancamento({ id: 'original', natureza, data: '2026-09-10', valorCentavos: 10001, escopoTipo: 'GERAL', categoriaId: natureza === 'RECEITA' ? 'cat-extra' : 'cat-limpeza', rateio: rateio([['A', 1, 5001], ['B', 1, 5000]]), estornadoPorId: 'e-original' })
    const e = estorno(original)
    const lancamentos = [original, e]
    const direcao = natureza === 'RECEITA' ? 1 : -1
    const coluna = natureza === 'RECEITA' ? 'receitas' : 'despesas'
    const informativo = natureza === 'RECEITA' ? 'estornosReceita' : 'estornosDespesa'
    expect(efeitoNoCaixa(e)).toBe(-direcao * 10001)
    expect(efeitoPorBloco(e)).toEqual([{ blocoId: 'A', valorCentavos: -direcao * 5001 }, { blocoId: 'B', valorCentavos: -direcao * 5000 }])
    for (const filtroBlocoId of [null, 'A', 'B']) {
      const valor = filtroBlocoId === 'A' ? 5001 : filtroBlocoId === 'B' ? 5000 : 10001
      const setembro = calcular({ blocos, lancamentos, filtroBlocoId })
      expect(setembro.total[coluna]).toBe(valor)
      expect(setembro.total[informativo]).toBe(0)
      expect(ids(setembro)).toEqual(['original'])
      const outubro = calcular({ blocos, lancamentos, filtroBlocoId, periodo: periodoDoMes('2026-10') })
      expect(outubro.total.saldoAnterior).toBe(direcao * valor)
      expect(outubro.total[coluna]).toBe(-valor)
      expect(outubro.total[informativo]).toBe(valor)
      expect(outubro.total.saldoFinal).toBe(0)
      expect(outubro.porCategoria[0]?.valorCentavos).toBe(-valor)
      expect(valores(outubro)).toEqual([-direcao * valor])
      expect(outubro.conferenciaCentavos).toBe(0)
      const competencia = calcular({ blocos, lancamentos, filtroBlocoId, base: 'competencia' })
      expect(competencia.total[coluna]).toBe(0)
      expect(competencia.total[informativo]).toBe(valor)
      expect(competencia.total.saldoFinal).toBe(0)
      expect(competencia.porCategoria[0]?.valorCentavos).toBe(0)
      expect(ids(competencia)).toEqual(['original', 'e-original'])
      expect(competencia.conferenciaCentavos).toBe(0)
    }
  })

  it('estorno de transferência devolve a cada caixa e permanece neutro no total e na competência', () => {
    const original = lancamento({ id: 't', natureza: 'TRANSFERENCIA', data: '2026-09-10', valorCentavos: 12345, blocoOrigemId: 'A', blocoId: 'B', categoriaId: 'cat-transf', estornadoPorId: 'e-t' })
    const e = estorno(original)
    const lancamentos = [original, e]
    expect(efeitoNoCaixa(e)).toBe(0)
    expect(efeitoPorBloco(e)).toEqual([{ blocoId: 'A', valorCentavos: 12345 }, { blocoId: 'B', valorCentavos: -12345 }])
    for (const filtroBlocoId of [null, 'A', 'B']) {
      const efeito = filtroBlocoId === 'A' ? 12345 : filtroBlocoId === 'B' ? -12345 : 0
      const outubro = calcular({ blocos, lancamentos, filtroBlocoId, periodo: periodoDoMes('2026-10') })
      expect(outubro.total).toMatchObject({ saldoAnterior: efeito === 0 ? 0 : -efeito, transferencias: efeito, saldoFinal: 0, receitas: 0, despesas: 0, estornosReceita: 0, estornosDespesa: 0 })
      expect(valores(outubro)).toEqual([efeito])
      expect(outubro.porCategoria).toEqual([])
      expect(outubro.conferenciaCentavos).toBe(0)
      const competencia = calcular({ blocos, lancamentos, filtroBlocoId, base: 'competencia' })
      expect(competencia.total.transferencias).toBe(0)
      expect(competencia.total.saldoFinal).toBe(0)
      expect(ids(competencia)).toEqual(['t', 'e-t'])
      expect(competencia.conferenciaCentavos).toBe(0)
    }
  })

  it('estorno de receita própria excluído deixa de reduzir o resultado', () => {
    const original = lancamento({ id: 'r', natureza: 'RECEITA', data: '2026-09-10', valorCentavos: 700, blocoId: 'A', categoriaId: 'cat-extra' })
    const e = estorno(original)
    const ativo = calcular({ blocos, lancamentos: [original, e], base: 'competencia', filtroBlocoId: 'A' })
    expect(ativo.total).toMatchObject({ receitasProprias: 0, receitasRateadas: 0, estornosReceita: 700, saldoFinal: 0 })
    const excluido = calcular({ blocos, lancamentos: [original, { ...e, status: 'EXCLUIDO' }], base: 'competencia', filtroBlocoId: 'A' })
    expect(excluido.total).toMatchObject({ receitasProprias: 700, estornosReceita: 0, saldoFinal: 700 })
  })
})

describe('blocos inativos', () => {
  const inativoSemNada = bloco({ id: 'D', ordem: 4, ativo: false })

  it('sem movimento e com saldo final zero não aparece (mas entra na conferência)', () => {
    const d = calcular({ blocos: [...blocosDoCenario(), inativoSemNada] })
    expect(d.linhas.map((l) => l.blocoId)).toEqual(['A', 'B', 'C'])
    expect(d.total).toEqual(LINHA_TOTAL)
    expect(d.conferenciaCentavos).toBe(0)
  })

  it('com saldo final diferente de zero aparece mesmo sem movimento', () => {
    const d = calcular({
      blocos: [...blocosDoCenario(), { ...inativoSemNada, saldoInicialCentavos: 10_00, dataSaldoInicial: '2026-01-01' }],
    })
    expect(d.linhas.map((l) => l.blocoId)).toEqual(['A', 'B', 'C', 'D'])
    const dLinha = linha(d, 'D')
    expect(dLinha.ativo).toBe(false)
    expect(dLinha.saldoAnterior).toBe(10_00)
    expect(dLinha.saldoFinal).toBe(10_00)
    expect(d.total.saldoFinal).toBe(LINHA_TOTAL.saldoFinal + 10_00)
  })

  it('com movimento no período aparece mesmo que o saldo final seja zero', () => {
    const lancamentos = [
      ...lancamentosDoCenario(),
      lancamento({ id: 'r-d', natureza: 'RECEITA', blocoId: 'D', data: '2026-09-03', valorCentavos: 50_00, categoriaId: 'cat-extra' }),
      lancamento({ id: 'd-d', natureza: 'DESPESA', blocoId: 'D', data: '2026-09-04', valorCentavos: 50_00 }),
    ]
    const d = calcular({ blocos: [...blocosDoCenario(), inativoSemNada], lancamentos })
    expect(d.linhas.map((l) => l.blocoId)).toEqual(['A', 'B', 'C', 'D'])
    expect(linha(d, 'D').saldoFinal).toBe(0)
    expect(linha(d, 'D').receitas).toBe(50_00)
    expect(linha(d, 'D').despesas).toBe(50_00)
  })

  it('inativo com movimento só fora do período não aparece', () => {
    const lancamentos = [
      ...lancamentosDoCenario(),
      lancamento({ id: 'r-d', natureza: 'RECEITA', blocoId: 'D', data: '2026-07-03', valorCentavos: 50_00 }),
      lancamento({ id: 'd-d', natureza: 'DESPESA', blocoId: 'D', data: '2026-08-04', valorCentavos: 50_00 }),
    ]
    const d = calcular({ blocos: [...blocosDoCenario(), inativoSemNada], lancamentos })
    expect(d.linhas.map((l) => l.blocoId)).toEqual(['A', 'B', 'C'])
  })

  it('bloco ativo sem nada aparece com zeros', () => {
    const d = calcular({ blocos: [...blocosDoCenario(), bloco({ id: 'E', ordem: 5 })] })
    expect(linha(d, 'E')).toEqual(linhaEsperada({ blocoId: 'E', nome: 'Bloco E' }))
  })

  it('linhas seguem bloco.ordem, mesmo com a lista fora de ordem', () => {
    const d = calcular({ blocos: blocosDoCenario().reverse() })
    expect(d.linhas.map((l) => l.blocoId)).toEqual(['A', 'B', 'C'])
  })
})

describe('dados inconsistentes: lançamento aponta para bloco fora da lista', () => {
  // Não derruba o relatório: o efeito é ignorado nos acumuladores e a conferência deixa de ser zero,
  // que é o sinal de alerta previsto no plano (5.4).
  it('lançamento BLOCO de bloco desconhecido: linhas intactas e a conferência acusa o valor perdido', () => {
    const blocos = [bloco({ id: 'X', ordem: 1 })]
    const lancamentos = [
      lancamento({ id: 'antes', natureza: 'DESPESA', blocoId: 'fantasma', data: '2026-08-05', valorCentavos: 30_00 }),
      lancamento({ id: 'dentro', natureza: 'DESPESA', blocoId: 'fantasma', data: '2026-09-05', valorCentavos: 100_00 }),
    ]
    const d = calcular({ blocos, lancamentos })
    expect(d.linhas).toEqual([linhaEsperada({ blocoId: 'X', nome: 'Bloco X' })])
    expect(ids(d)).toEqual(['dentro'])
    // Σ saldoPeriodo (0) − Σ efeitoNoCaixa (−100,00) = +100,00
    expect(d.conferenciaCentavos).toBe(100_00)
  })

  it('cota de rateio para bloco desconhecido: a conferência acusa exatamente a cota perdida', () => {
    const blocos = [bloco({ id: 'X', ordem: 1 })]
    const lancamentos = [
      lancamento({
        id: 'geral',
        natureza: 'RECEITA',
        escopoTipo: 'GERAL',
        data: '2026-09-10',
        valorCentavos: 250_00,
        categoriaId: 'cat-extra',
        rateio: rateio([
          ['X', 4, 200_00],
          ['fantasma', 1, 50_00],
        ]),
      }),
    ]
    const d = calcular({ blocos, lancamentos })
    expect(linha(d, 'X').receitasRateadas).toBe(200_00)
    expect(d.total.receitas).toBe(200_00)
    // Σ saldoPeriodo (200,00) − Σ efeitoNoCaixa (250,00) = −50,00
    expect(d.conferenciaCentavos).toBe(-50_00)
  })
})

describe('porCategoria', () => {
  it('categoria não encontrada aparece como "Categoria removida"', () => {
    const d = calcular({ categorias: CATEGORIAS.filter((c) => c.id !== 'cat-extra') })
    expect(d.porCategoria.find((c) => c.categoriaId === 'cat-extra')).toEqual({
      categoriaId: 'cat-extra',
      nome: 'Categoria removida',
      natureza: 'RECEITA',
      valorCentavos: 80_00,
    })
  })

  it('agrega vários lançamentos da mesma categoria e desempata por nome', () => {
    const blocos = [bloco({ id: 'A', ordem: 1 })]
    const lancamentos = [
      lancamento({ id: '1', natureza: 'DESPESA', blocoId: 'A', data: '2026-09-01', valorCentavos: 10_00, categoriaId: 'cat-limpeza' }),
      lancamento({ id: '2', natureza: 'DESPESA', blocoId: 'A', data: '2026-09-02', valorCentavos: 15_00, categoriaId: 'cat-limpeza' }),
      lancamento({ id: '3', natureza: 'DESPESA', blocoId: 'A', data: '2026-09-03', valorCentavos: 25_00, categoriaId: 'cat-agua' }),
      lancamento({ id: '4', natureza: 'RECEITA', blocoId: 'A', data: '2026-09-04', valorCentavos: 1_00, categoriaId: 'cat-extra' }),
    ]
    const d = calcular({ blocos, lancamentos })
    expect(d.porCategoria).toEqual([
      { categoriaId: 'cat-extra', nome: 'Taxa extra', natureza: 'RECEITA', valorCentavos: 1_00 },
      { categoriaId: 'cat-limpeza', nome: 'Limpeza e conservação', natureza: 'DESPESA', valorCentavos: 25_00 },
      { categoriaId: 'cat-agua', nome: 'Água e esgoto', natureza: 'DESPESA', valorCentavos: 25_00 },
    ])
  })

  it('mesmo nome, natureza e valor: desempate determinístico pelo id da categoria', () => {
    const blocos = [bloco({ id: 'A', ordem: 1 })]
    const categorias = [
      categoria({ id: 'cat-2', nome: 'Materiais', natureza: 'DESPESA' }),
      categoria({ id: 'cat-1', nome: 'Materiais', natureza: 'DESPESA' }),
    ]
    const lancamentos = [
      lancamento({ id: '1', natureza: 'DESPESA', blocoId: 'A', data: '2026-09-01', valorCentavos: 10_00, categoriaId: 'cat-2' }),
      lancamento({ id: '2', natureza: 'DESPESA', blocoId: 'A', data: '2026-09-02', valorCentavos: 10_00, categoriaId: 'cat-1' }),
    ]
    const d = calcular({ blocos, categorias, lancamentos })
    expect(d.porCategoria.map((c) => c.categoriaId)).toEqual(['cat-1', 'cat-2'])
  })
})

describe('outros períodos', () => {
  it('ano de 2026 inclui tudo que é ATIVO (saldos iniciais caem dentro do período)', () => {
    const d = calcular({ periodo: periodoDoAno(2026) })
    expect(ids(d)).toEqual(['L6', 'L2', 'L1', 'L3', 'L4', 'L8', 'L7'])
    expect(d.total.saldoAnterior).toBe(0)
    expect(d.total.saldoInicialNoPeriodo).toBe(2_200_00)
    expect(d.total.receitas).toBe(300_00)
    expect(d.total.despesas).toBe(1_070_00)
    expect(d.total.saldoFinal).toBe(2_200_00 + 300_00 - 1_070_00)
    expect(d.conferenciaCentavos).toBe(0)
  })

  it('intervalo dentro do mês: o que vem antes vira saldo anterior', () => {
    const d = calcular({ periodo: { inicio: '2026-09-10', fim: '2026-09-14' } })
    expect(ids(d)).toEqual(['L1', 'L3'])
    expect(linha(d, 'A').saldoAnterior).toBe(970_00)
    expect(linha(d, 'B').saldoAnterior).toBe(500_00 + 150_00)
    expect(linha(d, 'B').saldoInicialNoPeriodo).toBe(0)
    expect(linha(d, 'A').transferencias).toBe(0)
    expect(d.conferenciaCentavos).toBe(0)
  })

  it('saldo anterior de outubro é o saldo final de setembro (continuidade)', () => {
    const setembro = calcular()
    const outubro = calcular({ periodo: periodoDoMes('2026-10') })
    for (const id of ['A', 'B', 'C']) {
      expect(linha(outubro, id).saldoAnterior).toBe(linha(setembro, id).saldoFinal)
    }
    expect(ids(outubro)).toEqual(['L8', 'L7'])
    expect(outubro.conferenciaCentavos).toBe(0)
  })

  it('lançamentos na mesma data são ordenados por criadoEm', () => {
    const blocos = [bloco({ id: 'A', ordem: 1 })]
    const lancamentos = [
      lancamento({ id: 'tarde', natureza: 'RECEITA', blocoId: 'A', data: '2026-09-05', valorCentavos: 1_00, criadoEm: '2026-09-05T18:00:00' }),
      lancamento({ id: 'cedo', natureza: 'RECEITA', blocoId: 'A', data: '2026-09-05', valorCentavos: 1_00, criadoEm: '2026-09-05T08:00:00' }),
    ]
    expect(ids(calcular({ blocos, lancamentos }))).toEqual(['cedo', 'tarde'])
  })

  it('mesma data e mesmo criadoEm: desempate determinístico pelo id', () => {
    const blocos = [bloco({ id: 'A', ordem: 1 })]
    const lancamentos = [
      lancamento({ id: 'b', natureza: 'RECEITA', blocoId: 'A', data: '2026-09-05', valorCentavos: 1_00, criadoEm: '2026-09-05T08:00:00' }),
      lancamento({ id: 'a', natureza: 'RECEITA', blocoId: 'A', data: '2026-09-05', valorCentavos: 1_00, criadoEm: '2026-09-05T08:00:00' }),
    ]
    expect(ids(calcular({ blocos, lancamentos }))).toEqual(['a', 'b'])
  })
})

describe('resumirCobrancas (tabela 9.1)', () => {
  const cobrancas = cobrancasDoCenario()

  it('cenário de referência com hoje = 20/09/2026', () => {
    expect(resumirCobrancas(cobrancas, ['2026-09'], HOJE)).toEqual({
      competencias: ['2026-09'],
      geradas: 7,
      pagas: 3,
      abertas: 2,
      vencidas: 1,
      canceladas: 1,
      isentas: 1,
      valorCobradoCentavos: 1_350_00,
      valorRecebidoCentavos: 840_00,
      valorJurosCentavos: 10_00,
      valorDescontosCentavos: 10_00,
      valorEmAbertoCentavos: 500_00,
      porBloco: {
        A: {
          geradas: 2,
          pagas: 2,
          abertas: 0,
          vencidas: 0,
          canceladas: 0,
          isentas: 0,
          valorCobradoCentavos: 600_00,
          valorRecebidoCentavos: 600_00,
          valorJurosCentavos: 10_00,
          valorDescontosCentavos: 0,
          valorEmAbertoCentavos: 0,
        },
        B: {
          geradas: 3,
          pagas: 1,
          abertas: 2,
          vencidas: 1,
          canceladas: 0,
          isentas: 0,
          valorCobradoCentavos: 750_00,
          valorRecebidoCentavos: 240_00,
          valorJurosCentavos: 0,
          valorDescontosCentavos: 10_00,
          valorEmAbertoCentavos: 500_00,
        },
        C: {
          geradas: 2,
          pagas: 0,
          abertas: 0,
          vencidas: 0,
          canceladas: 1,
          isentas: 1,
          valorCobradoCentavos: 0,
          valorRecebidoCentavos: 0,
          valorJurosCentavos: 0,
          valorDescontosCentavos: 0,
          valorEmAbertoCentavos: 0,
        },
      },
    })
  })

  it('vencida só quando vencimento < hoje; no dia do vencimento ainda está a vencer', () => {
    expect(resumirCobrancas(cobrancas, ['2026-09'], '2026-09-10').vencidas).toBe(0)
    expect(resumirCobrancas(cobrancas, ['2026-09'], '2026-09-11').vencidas).toBe(1)
    expect(resumirCobrancas(cobrancas, ['2026-09'], '2026-10-01').vencidas).toBe(2)
    expect(resumirCobrancas(cobrancas, ['2026-09'], '2026-10-01').abertas).toBe(2)
  })

  it('competências fora da lista são ignoradas', () => {
    const outubro = cobranca({ id: 'c8', unidadeId: 'A-101', blocoId: 'A', competencia: '2026-10', vencimento: '2026-10-10' })
    const todas = [...cobrancas, outubro]
    expect(resumirCobrancas(todas, ['2026-09'], HOJE).geradas).toBe(7)
    const dois = resumirCobrancas(todas, ['2026-09', '2026-10'], HOJE)
    expect(dois.geradas).toBe(8)
    expect(dois.abertas).toBe(3)
    expect(dois.vencidas).toBe(1)
    expect(dois.valorEmAbertoCentavos).toBe(750_00)
    expect(dois.porBloco['A']?.abertas).toBe(1)
    expect(resumirCobrancas(todas, [], HOJE).geradas).toBe(0)
  })

  it('lista vazia devolve zeros e porBloco vazio', () => {
    const r = resumirCobrancas([], ['2026-09'], HOJE)
    expect(r.geradas).toBe(0)
    expect(r.valorCobradoCentavos).toBe(0)
    expect(r.porBloco).toEqual({})
  })

  it('PAGA sem valorPagoCentavos assume pagamento integral; pagar a mais não gera desconto', () => {
    const semValor = cobranca({ id: 'p1', unidadeId: 'A-101', blocoId: 'A', status: 'PAGA', pagaEm: '2026-09-01' })
    const aMais = cobranca({ id: 'p2', unidadeId: 'A-102', blocoId: 'A', status: 'PAGA', pagaEm: '2026-09-01', valorPagoCentavos: 260_00 })
    const r = resumirCobrancas([semValor, aMais], ['2026-09'], HOJE)
    expect(r.valorRecebidoCentavos).toBe(250_00 + 260_00)
    expect(r.valorDescontosCentavos).toBe(0)
    expect(r.valorCobradoCentavos).toBe(500_00)
  })

  it('devolve uma cópia da lista de competências', () => {
    const competencias = ['2026-09']
    const r = resumirCobrancas(cobrancas, competencias, HOJE)
    expect(r.competencias).toEqual(competencias)
    expect(r.competencias).not.toBe(competencias)
  })

  it('no demonstrativo, as competências vão do mês do início ao mês do fim', () => {
    const d = calcular({ periodo: { inicio: '2026-08-15', fim: '2026-10-05' }, cobrancas })
    expect(d.cobrancas?.competencias).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(d.cobrancas?.geradas).toBe(7)
  })
})
