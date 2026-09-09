import { describe, expect, it } from 'vitest'
import type { Bloco, RateioSnapshot, Unidade } from './tipos'
import { montarRateioGeral, ratearMaiorResto, reratearComSnapshot, somaCotas } from './rateio'
import { gerarSeed } from './seedPadrao'

const AGORA = '2026-09-04T10:00:00'

// ---------- Fixtures (estrutura do seed: 8 blocos de 16 aptos + 6 blocos de 32 = 320 unidades) ----------

function criarBloco(nome: string, ordem: number, aptosPorAndar: number, extra: Partial<Bloco> = {}): Bloco {
  return {
    id: `bloco-${nome}`,
    nome,
    quartos: aptosPorAndar === 4 ? 3 : 2,
    andares: 4,
    aptosPorAndar,
    ordem,
    ativo: true,
    saldoInicialCentavos: 0,
    dataSaldoInicial: '2026-09-01',
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    ...extra,
  }
}

function criarUnidades(bloco: Bloco): Unidade[] {
  const unidades: Unidade[] = []
  for (let andar = 1; andar <= bloco.andares; andar++) {
    for (let posicao = 1; posicao <= bloco.aptosPorAndar; posicao++) {
      const numero = `${andar}${String(posicao).padStart(2, '0')}`
      unidades.push({
        id: `${bloco.id}-${numero}`,
        blocoId: bloco.id,
        numero,
        andar,
        posicao,
        ativa: true,
        isenta: false,
        criadoEm: AGORA,
        atualizadoEm: AGORA,
      })
    }
  }
  return unidades
}

const NOMES_16 = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B']
const NOMES_32 = ['5A', '5B', '6A', '6B', '7A', '7B']

function criarSeed(): { blocos: Bloco[]; unidades: Unidade[] } {
  const blocos = [
    ...NOMES_16.map((nome, i) => criarBloco(nome, i + 1, 4)),
    ...NOMES_32.map((nome, i) => criarBloco(nome, NOMES_16.length + i + 1, 8)),
  ]
  const unidades = blocos.flatMap(criarUnidades)
  return { blocos, unidades }
}

function pesosIguais(qtd: number, peso = 1) {
  return Array.from({ length: qtd }, (_, i) => ({ chave: `p${i}`, peso }))
}

// ---------- ratearMaiorResto ----------

describe('ratearMaiorResto', () => {
  it('R$ 1.000,00 no seed: blocos de 16 aptos recebem R$ 50,00 e de 32 recebem R$ 100,00', () => {
    const pesos = [...NOMES_16.map((c) => ({ chave: c, peso: 16 })), ...NOMES_32.map((c) => ({ chave: c, peso: 32 }))]
    const cotas = ratearMaiorResto(100_000, pesos)
    expect(cotas).toHaveLength(14)
    for (const c of cotas.slice(0, 8)) expect(c.valorCentavos).toBe(5000)
    for (const c of cotas.slice(8)) expect(c.valorCentavos).toBe(10_000)
    expect(cotas.reduce((s, c) => s + c.valorCentavos, 0)).toBe(100_000)
  })

  it('R$ 100,01 no seed: o centavo extra vai ao primeiro bloco de peso 32 na ordem (5A)', () => {
    const pesos = [...NOMES_16.map((c) => ({ chave: c, peso: 16 })), ...NOMES_32.map((c) => ({ chave: c, peso: 32 }))]
    const cotas = ratearMaiorResto(10_001, pesos)
    for (const c of cotas.slice(0, 8)) expect(c.valorCentavos).toBe(500)
    expect(cotas[8]).toEqual({ chave: '5A', valorCentavos: 1001 })
    for (const c of cotas.slice(9)) expect(c.valorCentavos).toBe(1000)
    expect(cotas.reduce((s, c) => s + c.valorCentavos, 0)).toBe(10_001)
  })

  it('R$ 0,01 no seed: o único centavo vai ao primeiro de maior resto (5A)', () => {
    const pesos = [...NOMES_16.map((c) => ({ chave: c, peso: 16 })), ...NOMES_32.map((c) => ({ chave: c, peso: 32 }))]
    const cotas = ratearMaiorResto(1, pesos)
    expect(cotas.map((c) => c.valorCentavos)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0])
    expect(cotas[8]?.chave).toBe('5A')
  })

  it('R$ 1,00 entre 3 pesos iguais → 34/33/33 (desempate pela ordem de entrada)', () => {
    const cotas = ratearMaiorResto(100, pesosIguais(3))
    expect(cotas.map((c) => c.valorCentavos)).toEqual([34, 33, 33])
  })

  it('preserva as chaves e a ordem de entrada', () => {
    const cotas = ratearMaiorResto(7, [
      { chave: 'z', peso: 1 },
      { chave: 'a', peso: 1 },
      { chave: 'm', peso: 1 },
    ])
    expect(cotas.map((c) => c.chave)).toEqual(['z', 'a', 'm'])
    expect(cotas.map((c) => c.valorCentavos)).toEqual([3, 2, 2])
  })

  it('valor 0 → todas as cotas 0', () => {
    const cotas = ratearMaiorResto(0, pesosIguais(4, 7))
    expect(cotas.map((c) => c.valorCentavos)).toEqual([0, 0, 0, 0])
  })

  it('peso 0 → cota 0, e o resto é distribuído entre os demais', () => {
    const cotas = ratearMaiorResto(100, [
      { chave: 'a', peso: 0 },
      { chave: 'b', peso: 1 },
      { chave: 'c', peso: 1 },
    ])
    expect(cotas.map((c) => c.valorCentavos)).toEqual([0, 50, 50])
  })

  it('peso 0 nunca recebe o centavo da sobra, mesmo sendo o primeiro', () => {
    const cotas = ratearMaiorResto(1, [
      { chave: 'a', peso: 0 },
      { chave: 'b', peso: 3 },
      { chave: 'c', peso: 3 },
    ])
    expect(cotas.map((c) => c.valorCentavos)).toEqual([0, 1, 0])
  })

  it('exemplo clássico de maior resto: 1000 entre pesos 47/27/26', () => {
    // exatas: 470 / 270 / 260 → sem sobra
    expect(ratearMaiorResto(1000, [{ chave: 'a', peso: 47 }, { chave: 'b', peso: 27 }, { chave: 'c', peso: 26 }]).map((c) => c.valorCentavos)).toEqual([470, 270, 260])
    // 1001: exatas 470,47 / 270,27 / 260,26 → sobra 1 vai ao maior resto (a)
    expect(ratearMaiorResto(1001, [{ chave: 'a', peso: 47 }, { chave: 'b', peso: 27 }, { chave: 'c', peso: 26 }]).map((c) => c.valorCentavos)).toEqual([471, 270, 260])
  })

  it('não altera a lista de pesos recebida', () => {
    const pesos = [
      { chave: 'b', peso: 2 },
      { chave: 'a', peso: 5 },
    ]
    const copia = pesos.map((p) => ({ ...p }))
    ratearMaiorResto(101, pesos)
    expect(pesos).toEqual(copia)
  })

  describe('erros (mensagens em pt-BR)', () => {
    it('valor negativo', () => {
      expect(() => ratearMaiorResto(-1, pesosIguais(2))).toThrow('não pode ser negativo')
    })

    it('valor não inteiro', () => {
      expect(() => ratearMaiorResto(10.5, pesosIguais(2))).toThrow('inteiro')
      expect(() => ratearMaiorResto(Number.NaN, pesosIguais(2))).toThrow('inteiro')
      expect(() => ratearMaiorResto(Number.POSITIVE_INFINITY, pesosIguais(2))).toThrow('inteiro')
    })

    it('lista vazia', () => {
      expect(() => ratearMaiorResto(100, [])).toThrow('Não há participantes')
    })

    it('soma dos pesos igual a zero', () => {
      expect(() => ratearMaiorResto(100, pesosIguais(3, 0))).toThrow('maior que zero')
    })

    it('peso negativo ou não inteiro', () => {
      expect(() => ratearMaiorResto(100, [{ chave: 'x', peso: -1 }, { chave: 'y', peso: 2 }])).toThrow('"x"')
      expect(() => ratearMaiorResto(100, [{ chave: 'x', peso: 1.5 }])).toThrow('inteiro')
      expect(() => ratearMaiorResto(100, [{ chave: 'x', peso: Number.NaN }])).toThrow('inteiro')
    })

    it('valor·peso fora do intervalo seguro', () => {
      expect(() => ratearMaiorResto(Number.MAX_SAFE_INTEGER, [{ chave: 'a', peso: 2 }, { chave: 'b', peso: 1 }])).toThrow('grande demais')
    })

    it('soma dos pesos fora do intervalo seguro', () => {
      expect(() =>
        ratearMaiorResto(1, [{ chave: 'a', peso: Number.MAX_SAFE_INTEGER }, { chave: 'b', peso: 1 }]),
      ).toThrow('A soma dos pesos do rateio é grande demais')
    })

    it('valor no limite seguro com peso 1 ainda funciona', () => {
      const cotas = ratearMaiorResto(Number.MAX_SAFE_INTEGER, [{ chave: 'a', peso: 1 }])
      expect(cotas).toEqual([{ chave: 'a', valorCentavos: Number.MAX_SAFE_INTEGER }])
    })
  })
})

// ---------- montarRateioGeral ----------

describe('montarRateioGeral', () => {
  it('seed completo: 320 unidades, cotas na ordem dos blocos, R$ 1.000,00 → 5000/10000', () => {
    const { blocos, unidades } = criarSeed()
    const r = montarRateioGeral(100_000, blocos, unidades, AGORA)
    expect(r.criterio).toBe('POR_UNIDADE')
    expect(r.calculadoEm).toBe(AGORA)
    expect(r.totalUnidades).toBe(320)
    expect(r.cotas.map((c) => c.nomeBloco)).toEqual([...NOMES_16, ...NOMES_32])
    expect(r.cotas.map((c) => c.blocoId)).toEqual([...NOMES_16, ...NOMES_32].map((n) => `bloco-${n}`))
    expect(r.cotas.map((c) => c.unidadesAtivas)).toEqual([16, 16, 16, 16, 16, 16, 16, 16, 32, 32, 32, 32, 32, 32])
    expect(r.cotas.map((c) => c.valorCentavos)).toEqual([
      5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
    ])
    expect(somaCotas(r)).toBe(100_000)
  })

  it('seed: R$ 100,01 → centavo extra no 5A; R$ 0,01 → 5A', () => {
    const { blocos, unidades } = criarSeed()
    const r1 = montarRateioGeral(10_001, blocos, unidades, AGORA)
    const cota5A = r1.cotas.find((c) => c.nomeBloco === '5A')
    expect(cota5A?.valorCentavos).toBe(1001)
    expect(r1.cotas.filter((c) => c.valorCentavos === 1001)).toHaveLength(1)
    expect(somaCotas(r1)).toBe(10_001)

    const r2 = montarRateioGeral(1, blocos, unidades, AGORA)
    expect(r2.cotas.filter((c) => c.valorCentavos > 0)).toEqual([
      { blocoId: 'bloco-5A', nomeBloco: '5A', unidadesAtivas: 32, valorCentavos: 1 },
    ])
  })

  it('ordena por `ordem` mesmo que os blocos cheguem embaralhados; desempate por nome', () => {
    const b3 = criarBloco('C', 3, 4)
    const b1 = criarBloco('A', 1, 4)
    const b2b = criarBloco('Bz', 2, 4)
    const b2a = criarBloco('Ba', 2, 4)
    const blocos = [b3, b2b, b1, b2a]
    const unidades = blocos.flatMap(criarUnidades)
    const r = montarRateioGeral(100, blocos, unidades, AGORA)
    expect(r.cotas.map((c) => c.nomeBloco)).toEqual(['A', 'Ba', 'Bz', 'C'])
    // 100 entre 4 pesos iguais → 25 cada
    expect(r.cotas.map((c) => c.valorCentavos)).toEqual([25, 25, 25, 25])
    // a lista original não foi reordenada
    expect(blocos.map((b) => b.nome)).toEqual(['C', 'Bz', 'A', 'Ba'])
  })

  it('mesma ordem e mesmo nome: desempate determinístico pelo id', () => {
    const b2 = criarBloco('Anexo', 1, 4, { id: 'bloco-2' })
    const b1 = criarBloco('Anexo', 1, 4, { id: 'bloco-1' })
    const blocos = [b2, b1]
    const unidades = blocos.flatMap(criarUnidades)
    const r = montarRateioGeral(100, blocos, unidades, AGORA)
    expect(r.cotas.map((c) => c.blocoId)).toEqual(['bloco-1', 'bloco-2'])
    expect(r.cotas.map((c) => c.valorCentavos)).toEqual([50, 50])
  })

  it('seed real (gerarSeed): R$ 1.000,00 → 5000/10000 na ordem 1A..7B; R$ 100,01 → centavo extra no 5A', () => {
    const seed = gerarSeed({ inicioContabil: '2026-09', agora: AGORA })
    const r = montarRateioGeral(100_000, seed.blocos, seed.unidades, AGORA)
    expect(r.totalUnidades).toBe(320)
    expect(r.cotas.map((c) => c.nomeBloco)).toEqual([...NOMES_16, ...NOMES_32])
    expect(r.cotas.map((c) => c.blocoId)).toEqual(seed.blocos.map((b) => b.id))
    expect(r.cotas.map((c) => c.valorCentavos)).toEqual([
      5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
    ])
    const r2 = montarRateioGeral(10_001, seed.blocos, seed.unidades, AGORA)
    expect(r2.cotas.find((c) => c.nomeBloco === '5A')?.valorCentavos).toBe(1001)
    expect(somaCotas(r2)).toBe(10_001)
  })

  it('bloco inativo é excluído do rateio (e suas unidades não contam)', () => {
    const { blocos, unidades } = criarSeed()
    const inativos = blocos.map((b) => (b.nome === '1A' ? { ...b, ativo: false, desativadoEm: AGORA } : b))
    const r = montarRateioGeral(100_000, inativos, unidades, AGORA)
    expect(r.totalUnidades).toBe(304)
    expect(r.cotas.map((c) => c.nomeBloco)).not.toContain('1A')
    expect(r.cotas).toHaveLength(13)
    expect(somaCotas(r)).toBe(100_000)
  })

  it('bloco sem nenhuma unidade ativa é excluído', () => {
    const { blocos, unidades } = criarSeed()
    const semUnidades = criarBloco('8A', 15, 4) // bloco novo sem unidades
    const unidadesTodasInativas = unidades.map((u) => (u.blocoId === 'bloco-2B' ? { ...u, ativa: false } : u))
    const r = montarRateioGeral(100_000, [...blocos, semUnidades], unidadesTodasInativas, AGORA)
    expect(r.cotas.map((c) => c.nomeBloco)).not.toContain('8A')
    expect(r.cotas.map((c) => c.nomeBloco)).not.toContain('2B')
    expect(r.cotas).toHaveLength(13)
    expect(r.totalUnidades).toBe(304)
  })

  it('unidade desativada reduz o peso do bloco (16 → 15)', () => {
    const { blocos, unidades } = criarSeed()
    const alteradas = unidades.map((u) => (u.id === 'bloco-1A-101' ? { ...u, ativa: false, desativadaEm: AGORA } : u))
    const r = montarRateioGeral(100_000, blocos, alteradas, AGORA)
    expect(r.totalUnidades).toBe(319)
    const cota1A = r.cotas[0]
    expect(cota1A?.nomeBloco).toBe('1A')
    expect(cota1A?.unidadesAtivas).toBe(15)
    // 100000·15/319 = 4702,19…; 100000·16/319 = 5015,67…
    expect(cota1A?.valorCentavos).toBe(4702)
    expect(somaCotas(r)).toBe(100_000)
  })

  it('unidade isenta continua contando no peso', () => {
    const { blocos, unidades } = criarSeed()
    const comIsenta = unidades.map((u) => (u.id === 'bloco-1A-101' ? { ...u, isenta: true } : u))
    const r = montarRateioGeral(100_000, blocos, comIsenta, AGORA)
    expect(r.totalUnidades).toBe(320)
    expect(r.cotas[0]?.unidadesAtivas).toBe(16)
  })

  it('unidades de bloco desconhecido são ignoradas', () => {
    const { blocos, unidades } = criarSeed()
    const orfa: Unidade = { ...(unidades[0] as Unidade), id: 'orfa', blocoId: 'bloco-inexistente' }
    const r = montarRateioGeral(100_000, blocos, [...unidades, orfa], AGORA)
    expect(r.totalUnidades).toBe(320)
    expect(r.cotas).toHaveLength(14)
  })

  it('valor 0 → snapshot com todas as cotas 0', () => {
    const { blocos, unidades } = criarSeed()
    const r = montarRateioGeral(0, blocos, unidades, AGORA)
    expect(r.cotas.every((c) => c.valorCentavos === 0)).toBe(true)
    expect(somaCotas(r)).toBe(0)
  })

  it('erro se nenhum bloco participa', () => {
    const { blocos, unidades } = criarSeed()
    expect(() => montarRateioGeral(100, [], [], AGORA)).toThrow('Nenhum bloco')
    expect(() => montarRateioGeral(100, blocos, [], AGORA)).toThrow('Nenhum bloco')
    const todosInativos = blocos.map((b) => ({ ...b, ativo: false }))
    expect(() => montarRateioGeral(100, todosInativos, unidades, AGORA)).toThrow('Nenhum bloco')
  })

  it('propaga os erros de valor do ratearMaiorResto', () => {
    const { blocos, unidades } = criarSeed()
    expect(() => montarRateioGeral(-5, blocos, unidades, AGORA)).toThrow('negativo')
    expect(() => montarRateioGeral(1.5, blocos, unidades, AGORA)).toThrow('inteiro')
  })
})

// ---------- reratearComSnapshot ----------

describe('reratearComSnapshot', () => {
  it('reusa os pesos do snapshot, preserva ordem/blocoId/nomeBloco e fecha a soma', () => {
    const { blocos, unidades } = criarSeed()
    const anterior = montarRateioGeral(100_000, blocos, unidades, AGORA)
    const depois = '2026-09-05T08:00:00'
    const novo = reratearComSnapshot(10_001, anterior, depois)
    expect(novo.criterio).toBe('POR_UNIDADE')
    expect(novo.calculadoEm).toBe(depois)
    expect(novo.totalUnidades).toBe(anterior.totalUnidades)
    expect(novo.cotas.map((c) => c.blocoId)).toEqual(anterior.cotas.map((c) => c.blocoId))
    expect(novo.cotas.map((c) => c.nomeBloco)).toEqual(anterior.cotas.map((c) => c.nomeBloco))
    expect(novo.cotas.map((c) => c.unidadesAtivas)).toEqual(anterior.cotas.map((c) => c.unidadesAtivas))
    expect(novo.cotas[8]).toEqual({ blocoId: 'bloco-5A', nomeBloco: '5A', unidadesAtivas: 32, valorCentavos: 1001 })
    expect(somaCotas(novo)).toBe(10_001)
  })

  it('ignora a estrutura atual: usa a estrutura congelada no snapshot', () => {
    const anterior: RateioSnapshot = {
      criterio: 'POR_UNIDADE',
      totalUnidades: 3,
      cotas: [
        { blocoId: 'b2', nomeBloco: 'Bloco 2 (antigo nome)', unidadesAtivas: 2, valorCentavos: 67 },
        { blocoId: 'b1', nomeBloco: 'Bloco 1', unidadesAtivas: 1, valorCentavos: 33 },
      ],
      calculadoEm: AGORA,
    }
    const novo = reratearComSnapshot(1000, anterior, AGORA)
    expect(novo.cotas).toEqual([
      { blocoId: 'b2', nomeBloco: 'Bloco 2 (antigo nome)', unidadesAtivas: 2, valorCentavos: 667 },
      { blocoId: 'b1', nomeBloco: 'Bloco 1', unidadesAtivas: 1, valorCentavos: 333 },
    ])
    expect(novo.totalUnidades).toBe(3)
    // o snapshot anterior não é alterado
    expect(anterior.cotas.map((c) => c.valorCentavos)).toEqual([67, 33])
  })

  it('rerateio com o mesmo valor reproduz as mesmas cotas', () => {
    const { blocos, unidades } = criarSeed()
    const anterior = montarRateioGeral(123_457, blocos, unidades, AGORA)
    const novo = reratearComSnapshot(123_457, anterior, AGORA)
    expect(novo.cotas).toEqual(anterior.cotas)
  })

  it('erros: snapshot sem cotas ou valor inválido', () => {
    const vazio: RateioSnapshot = { criterio: 'POR_UNIDADE', totalUnidades: 0, cotas: [], calculadoEm: AGORA }
    expect(() => reratearComSnapshot(100, vazio, AGORA)).toThrow('Não há participantes')
    const { blocos, unidades } = criarSeed()
    const anterior = montarRateioGeral(100, blocos, unidades, AGORA)
    expect(() => reratearComSnapshot(-1, anterior, AGORA)).toThrow('negativo')
  })
})

// ---------- somaCotas ----------

describe('somaCotas', () => {
  it('soma os valores das cotas; vazio → 0', () => {
    const r: RateioSnapshot = {
      criterio: 'POR_UNIDADE',
      totalUnidades: 2,
      cotas: [
        { blocoId: 'a', nomeBloco: 'A', unidadesAtivas: 1, valorCentavos: 10 },
        { blocoId: 'b', nomeBloco: 'B', unidadesAtivas: 1, valorCentavos: 15 },
      ],
      calculadoEm: AGORA,
    }
    expect(somaCotas(r)).toBe(25)
    expect(somaCotas({ ...r, cotas: [] })).toBe(0)
  })
})

// ---------- Propriedades com PRNG semeado (sem Math.random) ----------

/** mulberry32: PRNG determinístico de 32 bits. */
function mulberry32(semente: number): () => number {
  let estado = semente >>> 0
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0
    let t = estado
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function inteiroAte(rng: () => number, max: number): number {
  return Math.floor(rng() * (max + 1))
}

describe('invariantes do maior resto (10.000 casos aleatórios, semente fixa)', () => {
  it('soma exata, erro < 1 centavo, determinismo, monotonia pelo peso e cota ∈ {floor, floor+1}', () => {
    const rng = mulberry32(20260904)
    const falhas: string[] = []
    const CASOS = 10_000

    for (let caso = 0; caso < CASOS && falhas.length < 20; caso++) {
      const qtd = 1 + inteiroAte(rng, 19)
      const pesos = Array.from({ length: qtd }, (_, i) => ({ chave: `k${i}`, peso: inteiroAte(rng, 60) }))
      if (pesos.every((p) => p.peso === 0)) (pesos[0] as { peso: number }).peso = 1 + inteiroAte(rng, 60)
      // mistura de valores pequenos (onde a sobra pesa mais) e grandes
      const valor = rng() < 0.25 ? inteiroAte(rng, 500) : inteiroAte(rng, 1_000_000_000)
      const n = pesos.reduce((s, p) => s + p.peso, 0)

      const cotas = ratearMaiorResto(valor, pesos)
      const repeticao = ratearMaiorResto(valor, pesos)
      const descricao = () => `caso ${caso}: valor=${valor} pesos=[${pesos.map((p) => p.peso).join(',')}] cotas=[${cotas.map((c) => c.valorCentavos).join(',')}]`

      if (cotas.length !== qtd) {
        falhas.push(`${descricao()} → quantidade de cotas ${cotas.length} ≠ ${qtd}`)
        continue
      }
      const soma = cotas.reduce((s, c) => s + c.valorCentavos, 0)
      if (soma !== valor) falhas.push(`${descricao()} → soma ${soma} ≠ ${valor}`)
      if (JSON.stringify(repeticao) !== JSON.stringify(cotas)) falhas.push(`${descricao()} → não determinístico`)

      for (let i = 0; i < qtd; i++) {
        const cota = cotas[i]?.valorCentavos ?? Number.NaN
        const peso = pesos[i]?.peso ?? 0
        if (!Number.isInteger(cota) || cota < 0) falhas.push(`${descricao()} → cota[${i}] inválida`)
        const exata = (valor * peso) / n
        if (Math.abs(cota - exata) >= 1) falhas.push(`${descricao()} → |cota[${i}] − exata| = ${Math.abs(cota - exata)}`)
        const piso = Number((BigInt(valor) * BigInt(peso)) / BigInt(n))
        if (cota !== piso && cota !== piso + 1) falhas.push(`${descricao()} → cota[${i}]=${cota} fora de {${piso}, ${piso + 1}}`)
        if (peso === 0 && cota !== 0) falhas.push(`${descricao()} → peso 0 recebeu ${cota}`)
        for (let j = 0; j < qtd; j++) {
          const pesoJ = pesos[j]?.peso ?? 0
          const cotaJ = cotas[j]?.valorCentavos ?? Number.NaN
          if (peso > pesoJ && cota < cotaJ) falhas.push(`${descricao()} → peso maior (${i}) recebeu menos que (${j})`)
          if (peso === pesoJ && i < j && cota < cotaJ) falhas.push(`${descricao()} → empate de peso: índice ${i} recebeu menos que ${j}`)
        }
      }
    }

    expect(falhas).toEqual([])
  })

  it('a sobra distribuída é sempre menor que a quantidade de participantes', () => {
    const rng = mulberry32(42)
    for (let caso = 0; caso < 2000; caso++) {
      const qtd = 1 + inteiroAte(rng, 14)
      const pesos = Array.from({ length: qtd }, (_, i) => ({ chave: `k${i}`, peso: 1 + inteiroAte(rng, 40) }))
      const valor = inteiroAte(rng, 100_000)
      const n = pesos.reduce((s, p) => s + p.peso, 0)
      const cotas = ratearMaiorResto(valor, pesos)
      const comMais1 = cotas.filter((c, i) => c.valorCentavos === Math.floor((valor * (pesos[i]?.peso ?? 0)) / n) + 1).length
      expect(comMais1).toBeLessThan(qtd)
    }
  })
})
