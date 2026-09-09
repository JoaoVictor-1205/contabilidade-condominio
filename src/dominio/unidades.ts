// Estrutura física dos blocos: numeração dos apartamentos, plano de unidades e diff ao alterar
// andares/aptos por andar (plano 5.9). Módulo PURO: sem React, sem Dexie, sem relógio.
import type { Bloco, Id, Unidade } from './tipos'

/** Uma posição do plano físico de um bloco (ainda sem id nem bloco). */
export interface PlanoUnidade {
  andar: number
  posicao: number
  /** Ex.: '101', '112', '1001'. */
  numero: string
}

/** Resultado de `diffUnidades`: o que fazer com cada unidade ao aplicar um novo plano. */
export interface DiffUnidades {
  /** Posições do plano sem unidade existente. */
  criar: PlanoUnidade[]
  /** Ativas que continuam no plano + inativas fora do plano com histórico (continuam inativas). */
  manter: Unidade[]
  /** Inativas que voltaram ao plano. */
  reativar: Unidade[]
  /** Ativas fora do plano COM lançamentos/cobranças (histórico preservado). */
  desativar: Unidade[]
  /** Fora do plano SEM nenhuma referência (exclusão física segura). */
  excluir: Unidade[]
}

function ehInteiroPositivo(n: number): boolean {
  return Number.isInteger(n) && n >= 1
}

/** Lança Error (pt-BR) se andares/aptosPorAndar não forem inteiros >= 1. */
export function validarEstruturaBloco(bloco: Pick<Bloco, 'andares' | 'aptosPorAndar'>): void {
  if (!ehInteiroPositivo(bloco.andares)) {
    throw new Error('O número de andares deve ser um inteiro maior ou igual a 1.')
  }
  if (!ehInteiroPositivo(bloco.aptosPorAndar)) {
    throw new Error('O número de apartamentos por andar deve ser um inteiro maior ou igual a 1.')
  }
}

/**
 * Número do apartamento: andar + posição com 2 dígitos (3 se o bloco tiver 100+ aptos por andar).
 * (1,1) → '101'; (1,12) → '112'; (4,4) → '404'; (10,1) → '1001'.
 */
export function gerarNumeroUnidade(andar: number, posicao: number, aptosPorAndar: number): string {
  return `${andar}${String(posicao).padStart(aptosPorAndar >= 100 ? 3 : 2, '0')}`
}

/** Plano completo do bloco na ordem andar 1..n, posição 1..m. 4×4 → 101..104, 201..204, ..., 401..404. */
export function gerarPlanoUnidades(bloco: Pick<Bloco, 'andares' | 'aptosPorAndar'>): PlanoUnidade[] {
  validarEstruturaBloco(bloco)
  const plano: PlanoUnidade[] = []
  for (let andar = 1; andar <= bloco.andares; andar++) {
    for (let posicao = 1; posicao <= bloco.aptosPorAndar; posicao++) {
      plano.push({ andar, posicao, numero: gerarNumeroUnidade(andar, posicao, bloco.aptosPorAndar) })
    }
  }
  return plano
}

/**
 * Compara as unidades existentes de UM bloco com o novo plano, casando por `numero`.
 * - no plano: ativa → manter; inativa → reativar; sem existente → criar.
 * - fora do plano: ativa referenciada → desativar; inativa referenciada → manter (segue inativa);
 *   não referenciada (ativa ou não) → excluir.
 * `idsReferenciados` = ids de unidades com lançamentos ou cobranças.
 */
export function diffUnidades(
  existentes: readonly Unidade[],
  plano: readonly PlanoUnidade[],
  idsReferenciados: ReadonlySet<Id>,
): DiffUnidades {
  const porNumero = new Map<string, Unidade>()
  for (const u of existentes) {
    if (porNumero.has(u.numero)) {
      throw new Error(`Existe mais de uma unidade com o número ${u.numero} no bloco.`)
    }
    porNumero.set(u.numero, u)
  }

  const numerosDoPlano = new Set<string>()
  for (const p of plano) {
    if (numerosDoPlano.has(p.numero)) {
      throw new Error(`O plano de unidades repete o número ${p.numero}.`)
    }
    numerosDoPlano.add(p.numero)
  }

  const diff: DiffUnidades = { criar: [], manter: [], reativar: [], desativar: [], excluir: [] }

  for (const p of plano) {
    const u = porNumero.get(p.numero)
    if (!u) diff.criar.push(p)
    else if (u.ativa) diff.manter.push(u)
    else diff.reativar.push(u)
  }

  for (const u of existentes) {
    if (numerosDoPlano.has(u.numero)) continue
    const referenciada = idsReferenciados.has(u.id)
    if (!referenciada) diff.excluir.push(u)
    else if (u.ativa) diff.desativar.push(u)
    else diff.manter.push(u)
  }

  return diff
}
