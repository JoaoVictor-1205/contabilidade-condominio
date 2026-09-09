import { describe, expect, it } from 'vitest'
import {
  DIA_VENCIMENTO_PADRAO,
  NOME_CONDOMINIO_PADRAO,
  SEED_BLOCOS,
  SEED_CATEGORIAS,
  gerarSeed,
} from './seedPadrao'

const AGORA = '2026-09-04T10:00:00'
const INICIO = '2026-09'

/** Gerador de ids determinístico para os testes. */
function idsSequenciais(): () => string {
  let n = 0
  return () => `id-${++n}`
}

function seed() {
  return gerarSeed({ inicioContabil: INICIO, agora: AGORA, gerarId: idsSequenciais() })
}

describe('SEED_BLOCOS e SEED_CATEGORIAS', () => {
  it('descreve 14 blocos: 1A..4B (3 quartos, 4×4) e 5A..7B (2 quartos, 4×8)', () => {
    expect(SEED_BLOCOS.map((b) => b.nome)).toEqual([
      '1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B',
      '5A', '5B', '6A', '6B', '7A', '7B',
    ])
    for (const b of SEED_BLOCOS.slice(0, 8)) expect(b).toMatchObject({ quartos: 3, andares: 4, aptosPorAndar: 4 })
    for (const b of SEED_BLOCOS.slice(8)) expect(b).toMatchObject({ quartos: 2, andares: 4, aptosPorAndar: 8 })
  })

  it('lista as categorias do plano 4.4 na ordem exata', () => {
    expect(SEED_CATEGORIAS.map((c) => c.nome)).toEqual([
      'Taxa condominial',
      'Juros e multas',
      'Taxa extra',
      'Aluguel de espaços',
      'Rendimentos financeiros',
      'Outras receitas',
      'Água e esgoto',
      'Energia elétrica',
      'Limpeza e conservação',
      'Manutenção e reparos',
      'Pessoal e encargos',
      'Segurança/portaria',
      'Materiais',
      'Serviços e honorários',
      'Tarifas bancárias',
      'Impostos e taxas',
      'Outras despesas',
      'Transferência entre blocos',
    ])
    expect(SEED_CATEGORIAS.filter((c) => c.natureza === 'RECEITA')).toHaveLength(6)
    expect(SEED_CATEGORIAS.filter((c) => c.natureza === 'DESPESA')).toHaveLength(11)
    expect(SEED_CATEGORIAS.filter((c) => c.natureza === 'TRANSFERENCIA')).toHaveLength(1)
  })

  it('marca as categorias de sistema com a natureza correta', () => {
    const sistema = SEED_CATEGORIAS.filter((c) => c.sistema !== null)
    expect(sistema).toEqual([
      { nome: 'Taxa condominial', natureza: 'RECEITA', sistema: 'TAXA' },
      { nome: 'Juros e multas', natureza: 'RECEITA', sistema: 'JUROS' },
      { nome: 'Transferência entre blocos', natureza: 'TRANSFERENCIA', sistema: 'TRANSFERENCIA' },
    ])
  })

  it('expõe os padrões do condomínio', () => {
    expect(NOME_CONDOMINIO_PADRAO).toBe('Meu Condomínio')
    expect(DIA_VENCIMENTO_PADRAO).toBe(10)
  })
})

describe('gerarSeed', () => {
  it('monta o condomínio com nome e vencimento padrão e o início contábil informado', () => {
    expect(seed().condominio).toEqual({
      id: 'unico',
      nome: 'Meu Condomínio',
      diaVencimento: 10,
      inicioContabil: INICIO,
      criadoEm: AGORA,
      atualizadoEm: AGORA,
    })
  })

  it('cria 14 blocos com nomes exatos, ordem 1..14, ativos, saldo inicial 0 no 1º dia do início contábil', () => {
    const { blocos } = seed()
    expect(blocos).toHaveLength(14)
    expect(blocos.map((b) => b.nome)).toEqual(SEED_BLOCOS.map((b) => b.nome))
    expect(blocos.map((b) => b.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    for (const b of blocos) {
      expect(b.ativo).toBe(true)
      expect(b.saldoInicialCentavos).toBe(0)
      expect(b.dataSaldoInicial).toBe('2026-09-01')
      expect(b.criadoEm).toBe(AGORA)
      expect(b.atualizadoEm).toBe(AGORA)
      expect(b.desativadoEm).toBeUndefined()
    }
    expect(blocos[0]).toMatchObject({ nome: '1A', quartos: 3, andares: 4, aptosPorAndar: 4 })
    expect(blocos[13]).toMatchObject({ nome: '7B', quartos: 2, andares: 4, aptosPorAndar: 8 })
  })

  it('gera 128 + 192 = 320 unidades ativas e não isentas, sem duplicidade de [blocoId+numero]', () => {
    const { blocos, unidades } = seed()
    expect(unidades).toHaveLength(320)

    const porBloco = new Map<string, number>()
    for (const u of unidades) porBloco.set(u.blocoId, (porBloco.get(u.blocoId) ?? 0) + 1)
    const blocos3q = blocos.filter((b) => b.quartos === 3)
    const blocos2q = blocos.filter((b) => b.quartos === 2)
    expect(blocos3q.reduce((s, b) => s + (porBloco.get(b.id) ?? 0), 0)).toBe(128)
    expect(blocos2q.reduce((s, b) => s + (porBloco.get(b.id) ?? 0), 0)).toBe(192)
    for (const b of blocos3q) expect(porBloco.get(b.id)).toBe(16)
    for (const b of blocos2q) expect(porBloco.get(b.id)).toBe(32)

    const chaves = new Set(unidades.map((u) => `${u.blocoId}+${u.numero}`))
    expect(chaves.size).toBe(320)

    for (const u of unidades) {
      expect(u.ativa).toBe(true)
      expect(u.isenta).toBe(false)
      expect(u.criadoEm).toBe(AGORA)
      expect(u.atualizadoEm).toBe(AGORA)
      expect(u.desativadaEm).toBeUndefined()
    }
  })

  it('numera as unidades pelo plano do bloco (4×4 → 101..404; 4×8 → 101..408)', () => {
    const { blocos, unidades } = seed()
    const bloco1A = blocos[0]
    const bloco5A = blocos[8]
    if (!bloco1A || !bloco5A) throw new Error('seed sem blocos')
    const numeros1A = unidades.filter((u) => u.blocoId === bloco1A.id).map((u) => u.numero)
    const numeros5A = unidades.filter((u) => u.blocoId === bloco5A.id).map((u) => u.numero)
    expect(numeros1A).toEqual([
      '101', '102', '103', '104', '201', '202', '203', '204',
      '301', '302', '303', '304', '401', '402', '403', '404',
    ])
    expect(numeros5A).toHaveLength(32)
    expect(numeros5A[0]).toBe('101')
    expect(numeros5A[7]).toBe('108')
    expect(numeros5A[31]).toBe('408')
    const u404 = unidades.find((u) => u.blocoId === bloco1A.id && u.numero === '404')
    expect(u404).toMatchObject({ andar: 4, posicao: 4 })
  })

  it('cria uma vigência zerada por tipo de quartos (3 e 2) a partir do início contábil', () => {
    const { taxas } = seed()
    expect(taxas).toHaveLength(2)
    expect(new Set(taxas.map((t) => t.quartos))).toEqual(new Set([3, 2]))
    for (const t of taxas) {
      expect(t.valorCentavos).toBe(0)
      expect(t.vigenteDesde).toBe(INICIO)
      expect(t.criadoEm).toBe(AGORA)
    }
    expect(new Set(taxas.map((t) => `${t.quartos}+${t.vigenteDesde}`)).size).toBe(2)
  })

  it('cria as categorias com ordem 1..n, ativas, e as de sistema TAXA/JUROS/TRANSFERENCIA presentes', () => {
    const { categorias } = seed()
    expect(categorias).toHaveLength(SEED_CATEGORIAS.length)
    expect(categorias.map((c) => c.nome)).toEqual(SEED_CATEGORIAS.map((c) => c.nome))
    expect(categorias.map((c) => c.ordem)).toEqual(SEED_CATEGORIAS.map((_, i) => i + 1))
    for (const c of categorias) expect(c.ativa).toBe(true)

    const porSistema = (s: string) => categorias.find((c) => c.sistema === s)
    expect(porSistema('TAXA')).toMatchObject({ nome: 'Taxa condominial', natureza: 'RECEITA' })
    expect(porSistema('JUROS')).toMatchObject({ nome: 'Juros e multas', natureza: 'RECEITA' })
    expect(porSistema('TRANSFERENCIA')).toMatchObject({ nome: 'Transferência entre blocos', natureza: 'TRANSFERENCIA' })
    expect(categorias.filter((c) => c.sistema !== null)).toHaveLength(3)
  })

  it('usa o gerador de ids injetado e não repete ids entre as entidades', () => {
    const s = seed()
    const ids = [
      ...s.blocos.map((b) => b.id),
      ...s.unidades.map((u) => u.id),
      ...s.taxas.map((t) => t.id),
      ...s.categorias.map((c) => c.id),
    ]
    expect(ids).toHaveLength(14 + 320 + 2 + 18)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^id-\d+$/.test(id))).toBe(true)
    // Toda unidade aponta para um bloco do próprio seed.
    const idsBlocos = new Set(s.blocos.map((b) => b.id))
    expect(s.unidades.every((u) => idsBlocos.has(u.blocoId))).toBe(true)
  })

  it('sem gerarId usa UUID v4 (novoId)', () => {
    const s = gerarSeed({ inicioContabil: INICIO, agora: AGORA })
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(s.blocos.every((b) => re.test(b.id))).toBe(true)
    expect(s.unidades.every((u) => re.test(u.id))).toBe(true)
    expect(new Set(s.unidades.map((u) => u.id)).size).toBe(320)
  })

  it('respeita outro início contábil (datas derivadas) e é determinístico', () => {
    const a = gerarSeed({ inicioContabil: '2025-02', agora: '2025-02-10T08:00:00', gerarId: idsSequenciais() })
    const b = gerarSeed({ inicioContabil: '2025-02', agora: '2025-02-10T08:00:00', gerarId: idsSequenciais() })
    expect(a).toEqual(b)
    expect(a.condominio.inicioContabil).toBe('2025-02')
    expect(a.blocos.every((bl) => bl.dataSaldoInicial === '2025-02-01')).toBe(true)
    expect(a.taxas.every((t) => t.vigenteDesde === '2025-02')).toBe(true)
    expect(a.condominio.criadoEm).toBe('2025-02-10T08:00:00')
  })

  it('rejeita início contábil fora do formato AAAA-MM com mensagem em pt-BR', () => {
    expect(() => gerarSeed({ inicioContabil: '2026-13', agora: AGORA })).toThrow(/início contábil inválido/)
    expect(() => gerarSeed({ inicioContabil: '09/2026', agora: AGORA })).toThrow(/AAAA-MM/)
    expect(() => gerarSeed({ inicioContabil: '', agora: AGORA })).toThrow()
  })
})
