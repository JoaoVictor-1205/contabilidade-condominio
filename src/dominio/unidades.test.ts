import { describe, expect, it } from 'vitest'
import type { Unidade } from './tipos'
import {
  diffUnidades,
  gerarNumeroUnidade,
  gerarPlanoUnidades,
  validarEstruturaBloco,
  type PlanoUnidade,
} from './unidades'

const AGORA = '2026-09-04T10:00:00'

function unidade(numero: string, extra: Partial<Unidade> = {}): Unidade {
  return {
    id: `u-${numero}`,
    blocoId: 'b1',
    numero,
    andar: Number(numero.slice(0, -2)),
    posicao: Number(numero.slice(-2)),
    ativa: true,
    isenta: false,
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    ...extra,
  }
}

/** Unidades existentes correspondentes a um plano, todas ativas. */
function unidadesDoPlano(plano: readonly PlanoUnidade[]): Unidade[] {
  return plano.map((p) => unidade(p.numero))
}

function numeros(lista: ReadonlyArray<{ numero: string }>): string[] {
  return lista.map((x) => x.numero)
}

describe('gerarNumeroUnidade', () => {
  it('monta andar + posição com 2 dígitos', () => {
    expect(gerarNumeroUnidade(1, 1, 4)).toBe('101')
    expect(gerarNumeroUnidade(1, 12, 12)).toBe('112')
    expect(gerarNumeroUnidade(4, 4, 4)).toBe('404')
    expect(gerarNumeroUnidade(10, 1, 4)).toBe('1001')
  })

  it('usa 3 dígitos quando o bloco tem 100 ou mais aptos por andar', () => {
    expect(gerarNumeroUnidade(1, 1, 100)).toBe('1001')
    expect(gerarNumeroUnidade(2, 57, 100)).toBe('2057')
    expect(gerarNumeroUnidade(1, 100, 100)).toBe('1100')
    expect(gerarNumeroUnidade(1, 1, 99)).toBe('101')
  })
})

describe('gerarPlanoUnidades', () => {
  it('4×4: 16 unidades na ordem andar 1..4, posição 1..4', () => {
    const plano = gerarPlanoUnidades({ andares: 4, aptosPorAndar: 4 })
    expect(plano).toHaveLength(16)
    expect(numeros(plano)).toEqual([
      '101', '102', '103', '104',
      '201', '202', '203', '204',
      '301', '302', '303', '304',
      '401', '402', '403', '404',
    ])
    expect(plano[0]).toEqual({ andar: 1, posicao: 1, numero: '101' })
    expect(plano[15]).toEqual({ andar: 4, posicao: 4, numero: '404' })
  })

  it('4×8: 32 unidades 101..108 ... 401..408', () => {
    const plano = gerarPlanoUnidades({ andares: 4, aptosPorAndar: 8 })
    expect(plano).toHaveLength(32)
    expect(numeros(plano)).toEqual([
      '101', '102', '103', '104', '105', '106', '107', '108',
      '201', '202', '203', '204', '205', '206', '207', '208',
      '301', '302', '303', '304', '305', '306', '307', '308',
      '401', '402', '403', '404', '405', '406', '407', '408',
    ])
    expect(plano[8]).toEqual({ andar: 2, posicao: 1, numero: '201' })
    expect(plano[31]).toEqual({ andar: 4, posicao: 8, numero: '408' })
  })

  it('1×1 gera apenas o 101', () => {
    expect(gerarPlanoUnidades({ andares: 1, aptosPorAndar: 1 })).toEqual([{ andar: 1, posicao: 1, numero: '101' }])
  })

  it('não repete números mesmo com muitos andares e aptos', () => {
    const plano = gerarPlanoUnidades({ andares: 12, aptosPorAndar: 12 })
    expect(plano).toHaveLength(144)
    expect(new Set(numeros(plano)).size).toBe(144)
  })

  it('rejeita andares ou aptos por andar inválidos com mensagem em pt-BR', () => {
    expect(() => gerarPlanoUnidades({ andares: 0, aptosPorAndar: 4 })).toThrow(/andares/)
    expect(() => gerarPlanoUnidades({ andares: -1, aptosPorAndar: 4 })).toThrow(/andares/)
    expect(() => gerarPlanoUnidades({ andares: 1.5, aptosPorAndar: 4 })).toThrow(/andares/)
    expect(() => gerarPlanoUnidades({ andares: 4, aptosPorAndar: 0 })).toThrow(/apartamentos por andar/)
    expect(() => gerarPlanoUnidades({ andares: 4, aptosPorAndar: Number.NaN })).toThrow(/apartamentos por andar/)
    expect(() => validarEstruturaBloco({ andares: 4, aptosPorAndar: 4 })).not.toThrow()
  })
})

describe('diffUnidades', () => {
  const SEM_REFERENCIAS: ReadonlySet<string> = new Set()

  it('4×4 → 5×4 cria as 4 unidades do 5º andar e mantém as 16 existentes', () => {
    const existentes = unidadesDoPlano(gerarPlanoUnidades({ andares: 4, aptosPorAndar: 4 }))
    const diff = diffUnidades(existentes, gerarPlanoUnidades({ andares: 5, aptosPorAndar: 4 }), SEM_REFERENCIAS)

    expect(numeros(diff.criar)).toEqual(['501', '502', '503', '504'])
    expect(diff.criar[0]).toEqual({ andar: 5, posicao: 1, numero: '501' })
    expect(diff.manter).toHaveLength(16)
    expect(numeros(diff.manter)).toEqual(numeros(existentes))
    expect(diff.reativar).toEqual([])
    expect(diff.desativar).toEqual([])
    expect(diff.excluir).toEqual([])
  })

  it('5×4 → 4×4 com 2 referenciadas: desativa as 2 com histórico e exclui as 2 sem', () => {
    const existentes = unidadesDoPlano(gerarPlanoUnidades({ andares: 5, aptosPorAndar: 4 }))
    const referenciadas = new Set(['u-501', 'u-503'])
    const diff = diffUnidades(existentes, gerarPlanoUnidades({ andares: 4, aptosPorAndar: 4 }), referenciadas)

    expect(diff.criar).toEqual([])
    expect(diff.manter).toHaveLength(16)
    expect(numeros(diff.manter)).not.toContain('501')
    expect(numeros(diff.desativar)).toEqual(['501', '503'])
    expect(numeros(diff.excluir)).toEqual(['502', '504'])
    expect(diff.reativar).toEqual([])
  })

  it('reduzir aptos por andar (4×4 → 4×3) tira a última posição de cada andar', () => {
    const existentes = unidadesDoPlano(gerarPlanoUnidades({ andares: 4, aptosPorAndar: 4 }))
    const diff = diffUnidades(existentes, gerarPlanoUnidades({ andares: 4, aptosPorAndar: 3 }), new Set(['u-204']))

    expect(numeros(diff.desativar)).toEqual(['204'])
    expect(numeros(diff.excluir)).toEqual(['104', '304', '404'])
    expect(diff.manter).toHaveLength(12)
  })

  it('inativa que volta ao plano é reativada (referenciada ou não)', () => {
    const existentes = [
      ...unidadesDoPlano(gerarPlanoUnidades({ andares: 4, aptosPorAndar: 4 })),
      unidade('501', { ativa: false, desativadaEm: AGORA }),
      unidade('502', { ativa: false, desativadaEm: AGORA }),
    ]
    const diff = diffUnidades(existentes, gerarPlanoUnidades({ andares: 5, aptosPorAndar: 4 }), new Set(['u-501']))

    expect(numeros(diff.reativar)).toEqual(['501', '502'])
    expect(numeros(diff.criar)).toEqual(['503', '504'])
    expect(diff.manter).toHaveLength(16)
    expect(diff.desativar).toEqual([])
    expect(diff.excluir).toEqual([])
  })

  it('inativa fora do plano: referenciada permanece em manter (segue inativa), sem referência é excluída', () => {
    const inativaComHistorico = unidade('501', { ativa: false, desativadaEm: AGORA })
    const inativaSemHistorico = unidade('502', { ativa: false, desativadaEm: AGORA })
    const existentes = [
      ...unidadesDoPlano(gerarPlanoUnidades({ andares: 4, aptosPorAndar: 4 })),
      inativaComHistorico,
      inativaSemHistorico,
    ]
    const diff = diffUnidades(existentes, gerarPlanoUnidades({ andares: 4, aptosPorAndar: 4 }), new Set(['u-501']))

    expect(diff.manter).toHaveLength(17)
    expect(diff.manter).toContain(inativaComHistorico)
    expect(diff.manter.find((u) => u.numero === '501')?.ativa).toBe(false)
    expect(diff.excluir).toEqual([inativaSemHistorico])
    expect(diff.reativar).toEqual([])
    expect(diff.desativar).toEqual([])
    expect(diff.criar).toEqual([])
  })

  it('plano igual à estrutura atual não altera nada', () => {
    const plano = gerarPlanoUnidades({ andares: 4, aptosPorAndar: 8 })
    const existentes = unidadesDoPlano(plano)
    const diff = diffUnidades(existentes, plano, new Set(existentes.map((u) => u.id)))

    expect(diff.manter).toEqual(existentes)
    expect(diff.criar).toEqual([])
    expect(diff.reativar).toEqual([])
    expect(diff.desativar).toEqual([])
    expect(diff.excluir).toEqual([])
  })

  it('bloco novo (sem unidades) cria o plano inteiro', () => {
    const plano = gerarPlanoUnidades({ andares: 4, aptosPorAndar: 8 })
    const diff = diffUnidades([], plano, SEM_REFERENCIAS)
    expect(diff.criar).toEqual(plano)
    expect(diff.manter).toEqual([])
  })

  it('cada unidade existente aparece em exatamente uma lista', () => {
    const existentes = [
      ...unidadesDoPlano(gerarPlanoUnidades({ andares: 5, aptosPorAndar: 4 })),
      unidade('601', { ativa: false }),
      unidade('602', { ativa: false }),
    ]
    const diff = diffUnidades(
      existentes,
      gerarPlanoUnidades({ andares: 4, aptosPorAndar: 4 }),
      new Set(['u-501', 'u-601']),
    )
    const ids = [...diff.manter, ...diff.reativar, ...diff.desativar, ...diff.excluir].map((u) => u.id)
    expect(ids).toHaveLength(existentes.length)
    expect(new Set(ids).size).toBe(existentes.length)
    expect(ids.sort()).toEqual(existentes.map((u) => u.id).sort())
  })

  it('rejeita número duplicado nas existentes ou no plano', () => {
    const plano = gerarPlanoUnidades({ andares: 1, aptosPorAndar: 2 })
    expect(() => diffUnidades([unidade('101'), unidade('101', { id: 'outra' })], plano, SEM_REFERENCIAS)).toThrow(
      /mais de uma unidade com o número 101/,
    )
    expect(() => diffUnidades([], [...plano, { andar: 1, posicao: 1, numero: '101' }], SEM_REFERENCIAS)).toThrow(
      /repete o número 101/,
    )
  })
})
