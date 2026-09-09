import { describe, it, expect } from 'vitest'
import type { Bloco, Cobranca, TaxaVigencia, Unidade } from './tipos'
import {
  agruparInadimplencia,
  calcularVencimento,
  planejarCobrancas,
  situacaoCobranca,
  taxaVigente,
  totalInadimplencia,
} from './cobrancas'
import { gerarSeed } from './seedPadrao'

const AGORA = '2026-09-04T10:00:00'
const HOJE = '2026-09-04'

// ---------- fábricas locais ----------

function bloco(p: Partial<Bloco> & { id: string; ordem: number; quartos: number }): Bloco {
  return {
    nome: p.id,
    andares: 4,
    aptosPorAndar: 4,
    ativo: true,
    saldoInicialCentavos: 0,
    dataSaldoInicial: '2026-01-01',
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    ...p,
  }
}

function unidade(p: Partial<Unidade> & { id: string; blocoId: string; numero: string }): Unidade {
  return {
    andar: Number(p.numero.slice(0, -2)) || 1,
    posicao: Number(p.numero.slice(-2)) || 1,
    ativa: true,
    isenta: false,
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    ...p,
  }
}

function taxa(p: Partial<TaxaVigencia> & { id: string; quartos: number; valorCentavos: number; vigenteDesde: string }): TaxaVigencia {
  return { criadoEm: AGORA, ...p }
}

function cobranca(p: Partial<Cobranca> & { id: string; unidadeId: string; blocoId: string; competencia: string }): Cobranca {
  return {
    valorCentavos: 35000,
    vencimento: `${p.competencia}-10`,
    status: 'ABERTA',
    taxaVigenciaId: 't3',
    origemValor: 'TAXA',
    lancamentoId: null,
    pagaEm: null,
    valorPagoCentavos: null,
    jurosCentavos: 0,
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    ...p,
  }
}

/**
 * Estrutura REAL do seed (src/dominio/seedPadrao): 1A..4B (3q, 4×4 = 16) e 5A..7B (2q, 4×8 = 32)
 * → 128 + 192 = 320 unidades. As taxas do seed nascem zeradas; aqui recebem a "primeira definição"
 * (3q = R$ 350,00; 2q = R$ 280,00), como faria a aba Taxas. Os ids vêm de novoId, por isso os testes
 * localizam blocos, unidades e taxas por nome, número e quartos.
 */
interface CenarioSeed {
  blocos: Bloco[]
  unidades: Unidade[]
  taxas: TaxaVigencia[]
  blocoDe: (nome: string) => Bloco
  unidadeDe: (nomeBloco: string, numero: string) => Unidade
  taxaDe: (quartos: number) => TaxaVigencia
}

function cenarioSeed(): CenarioSeed {
  const seed = gerarSeed({ inicioContabil: '2026-01', agora: AGORA })
  const taxas = seed.taxas.map((t) => ({ ...t, valorCentavos: t.quartos === 3 ? 35000 : 28000 }))
  const blocoDe = (nome: string): Bloco => {
    const b = seed.blocos.find((x) => x.nome === nome)
    if (!b) throw new Error(`Bloco ${nome} não existe no seed.`)
    return b
  }
  const unidadeDe = (nomeBloco: string, numero: string): Unidade => {
    const blocoId = blocoDe(nomeBloco).id
    const u = seed.unidades.find((x) => x.blocoId === blocoId && x.numero === numero)
    if (!u) throw new Error(`Unidade ${numero} do bloco ${nomeBloco} não existe no seed.`)
    return u
  }
  const taxaDe = (quartos: number): TaxaVigencia => {
    const t = taxas.find((x) => x.quartos === quartos)
    if (!t) throw new Error(`Não há taxa de ${quartos} quartos no seed.`)
    return t
  }
  return { blocos: seed.blocos, unidades: seed.unidades, taxas, blocoDe, unidadeDe, taxaDe }
}

function idsSequenciais(): () => string {
  let n = 0
  return () => `cob-${++n}`
}

// ---------- taxaVigente ----------

describe('taxaVigente', () => {
  const taxas = [
    taxa({ id: 'a', quartos: 3, valorCentavos: 30000, vigenteDesde: '2026-01', criadoEm: '2026-01-01T00:00:00' }),
    taxa({ id: 'b', quartos: 3, valorCentavos: 35000, vigenteDesde: '2026-05', criadoEm: '2026-04-20T00:00:00' }),
    taxa({ id: 'c', quartos: 2, valorCentavos: 28000, vigenteDesde: '2026-03', criadoEm: '2026-02-01T00:00:00' }),
  ]

  it('escolhe a maior vigência <= competência', () => {
    expect(taxaVigente(taxas, 3, '2026-07')?.id).toBe('b')
    expect(taxaVigente(taxas, 3, '2026-03')?.id).toBe('a')
  })

  it('fronteira: vigenteDesde igual à competência vale', () => {
    expect(taxaVigente(taxas, 3, '2026-05')?.id).toBe('b')
    expect(taxaVigente(taxas, 2, '2026-03')?.id).toBe('c')
  })

  it('vigência posterior à competência não vale', () => {
    expect(taxaVigente(taxas, 3, '2026-04')?.id).toBe('a')
    expect(taxaVigente(taxas, 2, '2026-02')).toBeUndefined()
  })

  it('sem vigência para o tipo ou lista vazia → undefined', () => {
    expect(taxaVigente(taxas, 1, '2026-09')).toBeUndefined()
    expect(taxaVigente([], 3, '2026-09')).toBeUndefined()
    expect(taxaVigente(taxas, 3, '2025-12')).toBeUndefined()
  })

  it('desempata por criadoEm mais recente quando vigenteDesde é igual', () => {
    const empate = [
      taxa({ id: 'antiga', quartos: 3, valorCentavos: 100, vigenteDesde: '2026-01', criadoEm: '2026-01-01T00:00:00' }),
      taxa({ id: 'nova', quartos: 3, valorCentavos: 200, vigenteDesde: '2026-01', criadoEm: '2026-02-01T00:00:00' }),
    ]
    expect(taxaVigente(empate, 3, '2026-06')?.id).toBe('nova')
    expect(taxaVigente([...empate].reverse(), 3, '2026-06')?.id).toBe('nova')
  })

  it('vigência retroativa (criada depois) cobre competência anterior', () => {
    const comRetroativa = [
      ...taxas,
      taxa({ id: 'retro', quartos: 3, valorCentavos: 32000, vigenteDesde: '2026-02', criadoEm: '2026-08-01T00:00:00' }),
    ]
    expect(taxaVigente(comRetroativa, 3, '2026-03')?.id).toBe('retro')
    expect(taxaVigente(comRetroativa, 3, '2026-01')?.id).toBe('a')
    expect(taxaVigente(comRetroativa, 3, '2026-06')?.id).toBe('b')
  })

  it('não altera a lista recebida', () => {
    const copia = taxas.map((t) => ({ ...t }))
    taxaVigente(taxas, 3, '2026-09')
    expect(taxas).toEqual(copia)
  })
})

// ---------- calcularVencimento ----------

describe('calcularVencimento', () => {
  it('ajusta ao último dia do mês', () => {
    expect(calcularVencimento('2026-02', 31)).toBe('2026-02-28')
    expect(calcularVencimento('2024-02', 30)).toBe('2024-02-29')
    expect(calcularVencimento('2026-04', 31)).toBe('2026-04-30')
  })

  it('mantém o dia quando cabe no mês', () => {
    expect(calcularVencimento('2026-09', 10)).toBe('2026-09-10')
    expect(calcularVencimento('2026-01', 31)).toBe('2026-01-31')
    expect(calcularVencimento('2026-09', 30)).toBe('2026-09-30')
  })

  it('dia < 1 ou inválido vira dia 1; fração é truncada', () => {
    expect(calcularVencimento('2026-09', 0)).toBe('2026-09-01')
    expect(calcularVencimento('2026-09', -5)).toBe('2026-09-01')
    expect(calcularVencimento('2026-09', Number.NaN)).toBe('2026-09-01')
    expect(calcularVencimento('2026-09', 15.9)).toBe('2026-09-15')
  })
})

// ---------- situacaoCobranca ----------

describe('situacaoCobranca', () => {
  const base = { id: 'c1', unidadeId: 'u1', blocoId: 'b1', competencia: '2026-08' }

  it('status final prevalece sobre o vencimento', () => {
    expect(situacaoCobranca(cobranca({ ...base, status: 'PAGA', vencimento: '2026-08-10' }), HOJE)).toBe('PAGA')
    expect(situacaoCobranca(cobranca({ ...base, status: 'CANCELADA', vencimento: '2026-08-10' }), HOJE)).toBe('CANCELADA')
    expect(situacaoCobranca(cobranca({ ...base, status: 'ISENTA', vencimento: '2026-08-10' }), HOJE)).toBe('ISENTA')
    expect(situacaoCobranca(cobranca({ ...base, status: 'PAGA', vencimento: '2026-12-10' }), HOJE)).toBe('PAGA')
  })

  it('ABERTA com vencimento antes de hoje = VENCIDA', () => {
    expect(situacaoCobranca(cobranca({ ...base, vencimento: '2026-09-03' }), HOJE)).toBe('VENCIDA')
    expect(situacaoCobranca(cobranca({ ...base, vencimento: '2025-12-31' }), HOJE)).toBe('VENCIDA')
  })

  it('ABERTA vencendo hoje ou depois = A_VENCER', () => {
    expect(situacaoCobranca(cobranca({ ...base, vencimento: '2026-09-04' }), HOJE)).toBe('A_VENCER')
    expect(situacaoCobranca(cobranca({ ...base, vencimento: '2026-09-05' }), HOJE)).toBe('A_VENCER')
  })
})

// ---------- planejarCobrancas ----------

describe('planejarCobrancas', () => {
  it('seed completo: 128 × 3q + 192 × 2q com valores diferentes e resumo correto', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    expect(unidades).toHaveLength(320)
    const plano = planejarCobrancas({
      competencia: '2026-09',
      blocos,
      unidades,
      taxas: seed.taxas,
      existentes: [],
      diaVencimento: 10,
      agora: AGORA,
      gerarId: idsSequenciais(),
    })

    expect(plano.criar).toHaveLength(320)
    expect(plano.jaExistentes).toBe(0)
    expect(plano.semTaxa).toEqual([])
    expect(plano.resumo).toEqual([
      { quartos: 2, quantidade: 192, valorCentavos: 28000 },
      { quartos: 3, quantidade: 128, valorCentavos: 35000 },
    ])

    const de3q = plano.criar.filter((c) => c.valorCentavos === 35000)
    const de2q = plano.criar.filter((c) => c.valorCentavos === 28000)
    expect(de3q).toHaveLength(128)
    expect(de2q).toHaveLength(192)
    expect(de3q.every((c) => c.taxaVigenciaId === seed.taxaDe(3).id)).toBe(true)
    expect(de2q.every((c) => c.taxaVigenciaId === seed.taxaDe(2).id)).toBe(true)

    // uma cobrança por unidade, ids únicos, valor total
    expect(new Set(plano.criar.map((c) => c.unidadeId)).size).toBe(320)
    expect(new Set(plano.criar.map((c) => c.id)).size).toBe(320)
    expect(plano.criar.reduce((s, c) => s + c.valorCentavos, 0)).toBe(128 * 35000 + 192 * 28000)

    // blocoId coerente com a unidade
    const blocoDaUnidade = new Map(unidades.map((u) => [u.id, u.blocoId]))
    expect(plano.criar.every((c) => blocoDaUnidade.get(c.unidadeId) === c.blocoId)).toBe(true)
  })

  it('seed real (taxas ainda zeradas): nada é criado e semTaxa aponta os dois tipos com todos os blocos', () => {
    const seed = gerarSeed({ inicioContabil: '2026-09', agora: AGORA })
    const plano = planejarCobrancas({
      competencia: '2026-09',
      blocos: seed.blocos,
      unidades: seed.unidades,
      taxas: seed.taxas,
      existentes: [],
      diaVencimento: seed.condominio.diaVencimento,
      agora: AGORA,
    })
    expect(seed.unidades).toHaveLength(320)
    expect(plano.criar).toEqual([])
    expect(plano.resumo).toEqual([])
    expect(plano.jaExistentes).toBe(0)
    expect(plano.semTaxa).toEqual([
      { quartos: 2, blocos: ['5A', '5B', '6A', '6B', '7A', '7B'] },
      { quartos: 3, blocos: ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'] },
    ])
  })

  it('preenche todos os campos da cobrança ABERTA', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const plano = planejarCobrancas({
      competencia: '2026-09',
      blocos,
      unidades,
      taxas: seed.taxas,
      existentes: [],
      diaVencimento: 10,
      agora: AGORA,
      gerarId: idsSequenciais(),
    })
    const primeira = plano.criar[0]
    expect(primeira).toEqual({
      id: 'cob-1',
      unidadeId: seed.unidadeDe('1A', '101').id,
      blocoId: seed.blocoDe('1A').id,
      competencia: '2026-09',
      valorCentavos: 35000,
      vencimento: '2026-09-10',
      status: 'ABERTA',
      taxaVigenciaId: seed.taxaDe(3).id,
      origemValor: 'TAXA',
      lancamentoId: null,
      pagaEm: null,
      valorPagoCentavos: null,
      jurosCentavos: 0,
      criadoEm: AGORA,
      atualizadoEm: AGORA,
    })
    expect(plano.criar.every((c) => c.vencimento === '2026-09-10' && c.status === 'ABERTA')).toBe(true)
  })

  it('ordena por bloco.ordem e depois pelo número da unidade', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const embaralhados = [...unidades].reverse()
    const blocosEmbaralhados = [...blocos].reverse()
    const plano = planejarCobrancas({
      competencia: '2026-09',
      blocos: blocosEmbaralhados,
      unidades: embaralhados,
      taxas: seed.taxas,
      existentes: [],
      diaVencimento: 10,
      agora: AGORA,
      gerarId: idsSequenciais(),
    })
    const id = (nomeBloco: string, numero: string): string => seed.unidadeDe(nomeBloco, numero).id
    expect(plano.criar.slice(0, 5).map((c) => c.unidadeId)).toEqual([
      id('1A', '101'),
      id('1A', '102'),
      id('1A', '103'),
      id('1A', '104'),
      id('1A', '201'),
    ])
    expect(plano.criar[16]?.unidadeId).toBe(id('1B', '101'))
    expect(plano.criar[128]?.unidadeId).toBe(id('5A', '101'))
    expect(plano.criar[319]?.unidadeId).toBe(id('7B', '408'))
  })

  it('é idempotente: 2ª chamada com as existentes não cria nada e conta 320 já existentes', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const parametros = { competencia: '2026-09', blocos, unidades, taxas: seed.taxas, diaVencimento: 10, agora: AGORA }
    const primeiro = planejarCobrancas({ ...parametros, existentes: [] })
    const segundo = planejarCobrancas({ ...parametros, existentes: primeiro.criar })
    expect(segundo.criar).toEqual([])
    expect(segundo.jaExistentes).toBe(320)
    expect(segundo.semTaxa).toEqual([])
    expect(segundo.resumo).toEqual([])
  })

  it('existente de qualquer status bloqueia nova cobrança da unidade; só completa as que faltam', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const u1A101 = seed.unidadeDe('1A', '101')
    const u1A102 = seed.unidadeDe('1A', '102')
    const u5A101 = seed.unidadeDe('5A', '101')
    const existentes = [
      cobranca({ id: 'x1', unidadeId: u1A101.id, blocoId: u1A101.blocoId, competencia: '2026-09', status: 'PAGA' }),
      cobranca({ id: 'x2', unidadeId: u1A102.id, blocoId: u1A102.blocoId, competencia: '2026-09', status: 'CANCELADA' }),
      cobranca({ id: 'x3', unidadeId: u5A101.id, blocoId: u5A101.blocoId, competencia: '2026-09', status: 'ISENTA' }),
    ]
    const plano = planejarCobrancas({
      competencia: '2026-09',
      blocos,
      unidades,
      taxas: seed.taxas,
      existentes,
      diaVencimento: 10,
      agora: AGORA,
    })
    expect(plano.criar).toHaveLength(317)
    expect(plano.jaExistentes).toBe(3)
    const ids = new Set(plano.criar.map((c) => c.unidadeId))
    expect(ids.has(u1A101.id)).toBe(false)
    expect(ids.has(u1A102.id)).toBe(false)
    expect(ids.has(u5A101.id)).toBe(false)
    expect(plano.resumo).toEqual([
      { quartos: 2, quantidade: 191, valorCentavos: 28000 },
      { quartos: 3, quantidade: 126, valorCentavos: 35000 },
    ])
  })

  it('ignora existentes de outra competência (não bloqueiam nem contam)', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const u1A101 = seed.unidadeDe('1A', '101')
    const existentes = [cobranca({ id: 'x1', unidadeId: u1A101.id, blocoId: u1A101.blocoId, competencia: '2026-08' })]
    const plano = planejarCobrancas({
      competencia: '2026-09',
      blocos,
      unidades,
      taxas: seed.taxas,
      existentes,
      diaVencimento: 10,
      agora: AGORA,
    })
    expect(plano.criar).toHaveLength(320)
    expect(plano.jaExistentes).toBe(0)
  })

  it('competência futura (adiantamento) usa a taxa vigente e o vencimento do mês futuro', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const plano = planejarCobrancas({
      competencia: '2027-02',
      blocos,
      unidades,
      taxas: seed.taxas,
      existentes: [],
      diaVencimento: 31,
      agora: AGORA,
    })
    expect(plano.criar).toHaveLength(320)
    expect(plano.criar.every((c) => c.competencia === '2027-02' && c.vencimento === '2027-02-28')).toBe(true)
  })

  it('ignora unidades inativas, isentas e blocos inativos', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const bloco2A = seed.blocoDe('2A')
    const u1A101 = seed.unidadeDe('1A', '101')
    const u5B203 = seed.unidadeDe('5B', '203')
    const blocosAjustados = blocos.map((b) => (b.id === bloco2A.id ? { ...b, ativo: false, desativadoEm: AGORA } : b))
    const unidadesAjustadas = unidades.map((u) => {
      if (u.id === u1A101.id) return { ...u, ativa: false, desativadaEm: AGORA }
      if (u.id === u5B203.id) return { ...u, isenta: true }
      return u
    })
    const plano = planejarCobrancas({
      competencia: '2026-09',
      blocos: blocosAjustados,
      unidades: unidadesAjustadas,
      taxas: seed.taxas,
      existentes: [],
      diaVencimento: 10,
      agora: AGORA,
    })
    // 320 − 16 (bloco 2A) − 1 (inativa) − 1 (isenta)
    expect(plano.criar).toHaveLength(302)
    const ids = new Set(plano.criar.map((c) => c.unidadeId))
    expect(ids.has(u1A101.id)).toBe(false)
    expect(ids.has(u5B203.id)).toBe(false)
    expect(plano.criar.some((c) => c.blocoId === bloco2A.id)).toBe(false)
    expect(plano.resumo).toEqual([
      { quartos: 2, quantidade: 191, valorCentavos: 28000 },
      { quartos: 3, quantidade: 111, valorCentavos: 35000 },
    ])
    expect(plano.semTaxa).toEqual([])
  })

  it('tipo com taxa 0 → nada criado para ele; entra em semTaxa com os blocos afetados', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const taxas = [seed.taxaDe(3), { ...seed.taxaDe(2), valorCentavos: 0 }]
    const plano = planejarCobrancas({
      competencia: '2026-09',
      blocos,
      unidades,
      taxas,
      existentes: [],
      diaVencimento: 10,
      agora: AGORA,
    })
    expect(plano.criar).toHaveLength(128)
    expect(plano.criar.every((c) => c.valorCentavos === 35000)).toBe(true)
    expect(plano.semTaxa).toEqual([{ quartos: 2, blocos: ['5A', '5B', '6A', '6B', '7A', '7B'] }])
    expect(plano.resumo).toEqual([{ quartos: 3, quantidade: 128, valorCentavos: 35000 }])
  })

  it('tipo sem nenhuma vigência (ou só vigência futura) também entra em semTaxa', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const soFutura = [{ ...seed.taxaDe(3), vigenteDesde: '2026-10' }, seed.taxaDe(2)]
    const plano = planejarCobrancas({
      competencia: '2026-09',
      blocos,
      unidades,
      taxas: soFutura,
      existentes: [],
      diaVencimento: 10,
      agora: AGORA,
    })
    expect(plano.criar).toHaveLength(192)
    expect(plano.semTaxa).toEqual([{ quartos: 3, blocos: ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'] }])

    const nenhuma = planejarCobrancas({
      competencia: '2026-09',
      blocos,
      unidades,
      taxas: [],
      existentes: [],
      diaVencimento: 10,
      agora: AGORA,
    })
    expect(nenhuma.criar).toEqual([])
    expect(nenhuma.resumo).toEqual([])
    expect(nenhuma.semTaxa.map((s) => s.quartos)).toEqual([2, 3])
  })

  it('semTaxa não lista bloco cujas unidades já têm cobrança nem bloco inativo', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const taxas = [seed.taxaDe(3)]
    const bloco7B = seed.blocoDe('7B')
    const bloco5A = seed.blocoDe('5A')
    const blocosAjustados = blocos.map((b) => (b.id === bloco7B.id ? { ...b, ativo: false } : b))
    const existentes = unidades
      .filter((u) => u.blocoId === bloco5A.id)
      .map((u) => cobranca({ id: `x-${u.id}`, unidadeId: u.id, blocoId: bloco5A.id, competencia: '2026-09', valorCentavos: 28000 }))
    const plano = planejarCobrancas({
      competencia: '2026-09',
      blocos: blocosAjustados,
      unidades,
      taxas,
      existentes,
      diaVencimento: 10,
      agora: AGORA,
    })
    expect(plano.jaExistentes).toBe(32)
    expect(plano.semTaxa).toEqual([{ quartos: 2, blocos: ['5B', '6A', '6B', '7A'] }])
  })

  it('bloco ativo sem unidade elegível não cria nada nem entra em semTaxa', () => {
    const blocos = [
      bloco({ id: 'vazio', nome: 'Vazio', ordem: 1, quartos: 1 }),
      bloco({ id: 'isentos', nome: 'Isentos', ordem: 2, quartos: 1 }),
    ]
    const unidades = [
      unidade({ id: 'isentos-101', blocoId: 'isentos', numero: '101', isenta: true }),
      unidade({ id: 'isentos-102', blocoId: 'isentos', numero: '102', ativa: false }),
    ]
    const plano = planejarCobrancas({ competencia: '2026-09', blocos, unidades, taxas: [], existentes: [], diaVencimento: 10, agora: AGORA })
    expect(plano).toEqual({ criar: [], jaExistentes: 0, semTaxa: [], resumo: [] })
  })

  it('semTaxa não repete o nome quando dois blocos têm o mesmo nome', () => {
    const blocos = [
      bloco({ id: 'b1', nome: 'Anexo', ordem: 1, quartos: 1 }),
      bloco({ id: 'b2', nome: 'Anexo', ordem: 2, quartos: 1 }),
    ]
    const unidades = [
      unidade({ id: 'b1-101', blocoId: 'b1', numero: '101' }),
      unidade({ id: 'b2-101', blocoId: 'b2', numero: '101' }),
    ]
    const plano = planejarCobrancas({ competencia: '2026-09', blocos, unidades, taxas: [], existentes: [], diaVencimento: 10, agora: AGORA })
    expect(plano.criar).toEqual([])
    expect(plano.semTaxa).toEqual([{ quartos: 1, blocos: ['Anexo'] }])
  })

  it('usa a taxa vigente na competência (retroativa e futura) por tipo', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const taxas = [
      taxa({ id: 't3-antiga', quartos: 3, valorCentavos: 30000, vigenteDesde: '2026-01', criadoEm: '2026-01-01T00:00:00' }),
      taxa({ id: 't3-nova', quartos: 3, valorCentavos: 36000, vigenteDesde: '2026-09', criadoEm: '2026-08-15T00:00:00' }),
      seed.taxaDe(2),
    ]
    const agosto = planejarCobrancas({ competencia: '2026-08', blocos, unidades, taxas, existentes: [], diaVencimento: 10, agora: AGORA })
    const setembro = planejarCobrancas({ competencia: '2026-09', blocos, unidades, taxas, existentes: [], diaVencimento: 10, agora: AGORA })
    expect(agosto.resumo.find((r) => r.quartos === 3)).toEqual({ quartos: 3, quantidade: 128, valorCentavos: 30000 })
    expect(setembro.resumo.find((r) => r.quartos === 3)).toEqual({ quartos: 3, quantidade: 128, valorCentavos: 36000 })
    expect(setembro.criar.filter((c) => c.taxaVigenciaId === 't3-nova')).toHaveLength(128)
  })

  it('gera ids com novoId quando gerarId não é informado', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const plano = planejarCobrancas({
      competencia: '2026-09',
      blocos,
      unidades,
      taxas: seed.taxas,
      existentes: [],
      diaVencimento: 10,
      agora: AGORA,
    })
    expect(new Set(plano.criar.map((c) => c.id)).size).toBe(320)
    expect(plano.criar.every((c) => /^[0-9a-f-]{36}$/.test(c.id))).toBe(true)
  })

  it('não altera as listas recebidas', () => {
    const seed = cenarioSeed()
    const { blocos, unidades } = seed
    const blocosInvertidos = [...blocos].reverse()
    const unidadesInvertidas = [...unidades].reverse()
    const copiaBlocos = [...blocosInvertidos]
    const copiaUnidades = [...unidadesInvertidas]
    planejarCobrancas({
      competencia: '2026-09',
      blocos: blocosInvertidos,
      unidades: unidadesInvertidas,
      taxas: seed.taxas,
      existentes: [],
      diaVencimento: 10,
      agora: AGORA,
    })
    expect(blocosInvertidos).toEqual(copiaBlocos)
    expect(unidadesInvertidas).toEqual(copiaUnidades)
  })
})

// ---------- agruparInadimplencia / totalInadimplencia ----------

describe('agruparInadimplencia', () => {
  // Bloco B tem ordem 1 (aparece antes de A, ordem 2), para testar a ordenação por `ordem`.
  const blocos = [
    bloco({ id: 'A', nome: 'Bloco A', ordem: 2, quartos: 3 }),
    bloco({ id: 'B', nome: 'Bloco B', ordem: 1, quartos: 2 }),
  ]
  const unidades = [
    unidade({ id: 'A-112', blocoId: 'A', numero: '112' }),
    unidade({ id: 'A-101', blocoId: 'A', numero: '101' }),
    unidade({ id: 'A-201', blocoId: 'A', numero: '201', ativa: false, desativadaEm: AGORA }),
    unidade({ id: 'B-10', blocoId: 'B', numero: '10' }),
    unidade({ id: 'B-2', blocoId: 'B', numero: '2' }),
  ]
  const cobrancas = [
    // A-101: duas vencidas (fora de ordem) + uma a vencer + uma paga
    cobranca({ id: 'c1', unidadeId: 'A-101', blocoId: 'A', competencia: '2026-08', vencimento: '2026-08-10', valorCentavos: 35000 }),
    cobranca({ id: 'c2', unidadeId: 'A-101', blocoId: 'A', competencia: '2026-06', vencimento: '2026-06-10', valorCentavos: 30000 }),
    cobranca({ id: 'c3', unidadeId: 'A-101', blocoId: 'A', competencia: '2026-09', vencimento: '2026-09-10', valorCentavos: 35000 }),
    cobranca({ id: 'c4', unidadeId: 'A-101', blocoId: 'A', competencia: '2026-07', vencimento: '2026-07-10', status: 'PAGA' }),
    // A-112: só a vencer (vence hoje)
    cobranca({ id: 'c5', unidadeId: 'A-112', blocoId: 'A', competencia: '2026-09', vencimento: '2026-09-04' }),
    // A-201 (inativa): uma vencida
    cobranca({ id: 'c6', unidadeId: 'A-201', blocoId: 'A', competencia: '2026-05', vencimento: '2026-05-10', valorCentavos: 30000 }),
    // B-10 e B-2: uma vencida cada; B-2 também tem cancelada e isenta
    cobranca({ id: 'c7', unidadeId: 'B-10', blocoId: 'B', competencia: '2026-08', vencimento: '2026-08-10', valorCentavos: 28000 }),
    cobranca({ id: 'c8', unidadeId: 'B-2', blocoId: 'B', competencia: '2026-08', vencimento: '2026-08-10', valorCentavos: 28000 }),
    cobranca({ id: 'c9', unidadeId: 'B-2', blocoId: 'B', competencia: '2026-07', vencimento: '2026-07-10', status: 'CANCELADA' }),
    cobranca({ id: 'c10', unidadeId: 'B-2', blocoId: 'B', competencia: '2026-06', vencimento: '2026-06-10', status: 'ISENTA' }),
    // unidade desconhecida: ignorada
    cobranca({ id: 'c11', unidadeId: 'Z-999', blocoId: 'Z', competencia: '2026-01', vencimento: '2026-01-10' }),
  ]

  it('agrupa só as vencidas por unidade, incluindo unidade inativa marcada', () => {
    const grupos = agruparInadimplencia(cobrancas, unidades, blocos, HOJE)
    expect(grupos.map((g) => g.unidade.id)).toEqual(['B-2', 'B-10', 'A-101', 'A-201'])
    expect(grupos.map((g) => g.vencidas.map((c) => c.id))).toEqual([['c8'], ['c7'], ['c2', 'c1'], ['c6']])
    expect(grupos.map((g) => g.unidadeInativa)).toEqual([false, false, false, true])
    expect(grupos.map((g) => g.bloco.id)).toEqual(['B', 'B', 'A', 'A'])
  })

  it('calcula total devido e competência mais antiga por unidade', () => {
    const grupos = agruparInadimplencia(cobrancas, unidades, blocos, HOJE)
    const a101 = grupos.find((g) => g.unidade.id === 'A-101')
    expect(a101?.totalDevidoCentavos).toBe(65000)
    expect(a101?.maisAntiga).toBe('2026-06')
    expect(a101?.vencidas.map((c) => c.competencia)).toEqual(['2026-06', '2026-08'])
    const b2 = grupos.find((g) => g.unidade.id === 'B-2')
    expect(b2?.totalDevidoCentavos).toBe(28000)
    expect(b2?.maisAntiga).toBe('2026-08')
  })

  it('ordena por bloco.ordem e depois pelo número da unidade (numérico)', () => {
    const grupos = agruparInadimplencia(cobrancas, unidades, blocos, HOJE, { incluirAVencer: true })
    expect(grupos.map((g) => `${g.bloco.id}/${g.unidade.numero}`)).toEqual(['B/2', 'B/10', 'A/101', 'A/112', 'A/201'])
  })

  it('incluirAVencer traz também as abertas ainda não vencidas', () => {
    const grupos = agruparInadimplencia(cobrancas, unidades, blocos, HOJE, { incluirAVencer: true })
    expect(grupos.map((g) => g.unidade.id)).toEqual(['B-2', 'B-10', 'A-101', 'A-112', 'A-201'])
    const a101 = grupos.find((g) => g.unidade.id === 'A-101')
    expect(a101?.vencidas.map((c) => c.id)).toEqual(['c2', 'c1', 'c3'])
    expect(a101?.totalDevidoCentavos).toBe(100000)
    const a112 = grupos.find((g) => g.unidade.id === 'A-112')
    expect(a112?.vencidas.map((c) => c.id)).toEqual(['c5'])
  })

  it('filtra por bloco; null/undefined = todos', () => {
    const soA = agruparInadimplencia(cobrancas, unidades, blocos, HOJE, { blocoId: 'A' })
    expect(soA.map((g) => g.unidade.id)).toEqual(['A-101', 'A-201'])
    const soB = agruparInadimplencia(cobrancas, unidades, blocos, HOJE, { blocoId: 'B', incluirAVencer: true })
    expect(soB.map((g) => g.unidade.id)).toEqual(['B-2', 'B-10'])
    expect(agruparInadimplencia(cobrancas, unidades, blocos, HOJE, { blocoId: null })).toHaveLength(4)
    expect(agruparInadimplencia(cobrancas, unidades, blocos, HOJE, { blocoId: 'inexistente' })).toEqual([])
  })

  it('a data de hoje muda o que é vencido', () => {
    expect(agruparInadimplencia(cobrancas, unidades, blocos, '2026-05-01')).toEqual([])
    const depois = agruparInadimplencia(cobrancas, unidades, blocos, '2026-09-11')
    const a101 = depois.find((g) => g.unidade.id === 'A-101')
    expect(a101?.vencidas.map((c) => c.id)).toEqual(['c2', 'c1', 'c3'])
    expect(depois.some((g) => g.unidade.id === 'A-112')).toBe(true)
  })

  it('pagas, canceladas, isentas e cobranças sem unidade/bloco conhecidos ficam de fora', () => {
    const grupos = agruparInadimplencia(cobrancas, unidades, blocos, HOJE, { incluirAVencer: true })
    const ids = grupos.flatMap((g) => g.vencidas.map((c) => c.id))
    expect(ids).not.toContain('c4')
    expect(ids).not.toContain('c9')
    expect(ids).not.toContain('c10')
    expect(ids).not.toContain('c11')
    // bloco desconhecido (unidade existe, bloco não)
    const semBloco = agruparInadimplencia(cobrancas, unidades, [blocos[0] as Bloco], HOJE)
    expect(semBloco.map((g) => g.unidade.id)).toEqual(['A-101', 'A-201'])
  })

  it('lista vazia → nenhum grupo', () => {
    expect(agruparInadimplencia([], unidades, blocos, HOJE)).toEqual([])
  })

  it('totalInadimplencia soma unidades, cobranças e valor', () => {
    const grupos = agruparInadimplencia(cobrancas, unidades, blocos, HOJE)
    expect(totalInadimplencia(grupos)).toEqual({ unidades: 4, cobrancas: 5, valorCentavos: 65000 + 30000 + 28000 + 28000 })
    expect(totalInadimplencia([])).toEqual({ unidades: 0, cobrancas: 0, valorCentavos: 0 })
    const comAVencer = agruparInadimplencia(cobrancas, unidades, blocos, HOJE, { incluirAVencer: true })
    expect(totalInadimplencia(comAVencer)).toEqual({ unidades: 5, cobrancas: 7, valorCentavos: 100000 + 35000 + 30000 + 28000 + 28000 })
  })
})
