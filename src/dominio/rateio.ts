// Rateio por maior resto (método de Hamilton). Módulo PURO: só aritmética inteira, sem Date, sem Dexie.
import type { Bloco, Centavos, CotaRateio, Id, RateioSnapshot, Unidade } from './tipos'
import { somarCentavos } from './dinheiro'

/** Participante do rateio: `chave` identifica a cota; `peso` é um inteiro >= 0. */
export interface Peso {
  chave: string
  peso: number
}

/**
 * Distribui `valor` (centavos) proporcionalmente aos pesos usando SÓ inteiros.
 * base_i = floor(valor·peso_i / N); a sobra (valor − Σ base) vai, 1 centavo por vez, aos maiores
 * restos (valor·peso_i mod N), com empate resolvido pela ordem de entrada. Garante Σ cotas === valor.
 * Lança Error (pt-BR) se valor < 0 ou não inteiro, lista vazia, peso negativo/não inteiro, N === 0
 * ou se valor·peso deixar de ser um inteiro seguro.
 */
export function ratearMaiorResto(
  valor: Centavos,
  pesos: ReadonlyArray<Peso>,
): Array<{ chave: string; valorCentavos: Centavos }> {
  if (typeof valor !== 'number' || !Number.isInteger(valor)) {
    throw new Error('O valor a ratear deve ser um número inteiro de centavos.')
  }
  if (valor < 0) throw new Error('O valor a ratear não pode ser negativo.')
  if (pesos.length === 0) throw new Error('Não há participantes para o rateio.')

  let n = 0
  for (const p of pesos) {
    if (typeof p.peso !== 'number' || !Number.isInteger(p.peso) || p.peso < 0) {
      throw new Error(`O peso de "${p.chave}" deve ser um número inteiro maior ou igual a zero.`)
    }
    n += p.peso
  }
  if (n === 0) throw new Error('A soma dos pesos do rateio deve ser maior que zero.')
  if (!Number.isSafeInteger(n)) throw new Error('A soma dos pesos do rateio é grande demais para ser calculada com segurança.')

  const cotas: number[] = []
  const restos: Array<{ indice: number; resto: number }> = []
  let somaBases = 0
  pesos.forEach((p, indice) => {
    const produto = valor * p.peso
    if (!Number.isSafeInteger(produto)) {
      throw new Error('O valor do rateio é grande demais para ser calculado com segurança.')
    }
    // `%` e a divisão de um múltiplo exato são exatos para inteiros seguros.
    const resto = produto % n
    const base = (produto - resto) / n
    cotas.push(base)
    restos.push({ indice, resto })
    somaBases += base
  })

  // Maiores restos primeiro; empate pela ordem de entrada (índice menor).
  restos.sort((a, b) => b.resto - a.resto || a.indice - b.indice)
  let sobra = valor - somaBases
  for (const r of restos) {
    if (sobra <= 0) break
    cotas[r.indice] = (cotas[r.indice] ?? 0) + 1
    sobra -= 1
  }

  return pesos.map((p, i) => ({ chave: p.chave, valorCentavos: cotas[i] ?? 0 }))
}

/** Ordem de exibição/desempate: `ordem`, depois `nome`, depois `id` (só para ser determinístico). */
function compararBlocos(a: Bloco, b: Bloco): number {
  return a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

type Participante = Omit<CotaRateio, 'valorCentavos'>

function calcularSnapshot(valor: Centavos, participantes: ReadonlyArray<Participante>, agora: string): RateioSnapshot {
  const pesos: Peso[] = participantes.map((p) => ({ chave: p.blocoId, peso: p.unidadesAtivas }))
  const resultado = ratearMaiorResto(valor, pesos)
  const cotas: CotaRateio[] = participantes.map((p, i) => ({
    blocoId: p.blocoId,
    nomeBloco: p.nomeBloco,
    unidadesAtivas: p.unidadesAtivas,
    valorCentavos: resultado[i]?.valorCentavos ?? 0,
  }))
  return {
    criterio: 'POR_UNIDADE',
    totalUnidades: pesos.reduce((soma, p) => soma + p.peso, 0),
    cotas,
    calculadoEm: agora,
  }
}

/**
 * Monta o snapshot de um lançamento GERAL com a estrutura vigente.
 * Participam os blocos `ativo` (ordenados por `ordem`, desempate por `nome`) com >= 1 unidade `ativa`
 * (isentas contam); o peso é a quantidade de unidades ativas do bloco. Não altera as listas recebidas.
 * Lança Error (pt-BR) se nenhum bloco participar.
 */
export function montarRateioGeral(
  valor: Centavos,
  blocos: readonly Bloco[],
  unidades: readonly Unidade[],
  agora: string,
): RateioSnapshot {
  const ativasPorBloco = new Map<Id, number>()
  for (const u of unidades) {
    if (!u.ativa) continue
    ativasPorBloco.set(u.blocoId, (ativasPorBloco.get(u.blocoId) ?? 0) + 1)
  }
  const participantes = blocos
    .filter((b) => b.ativo && (ativasPorBloco.get(b.id) ?? 0) >= 1)
    .sort(compararBlocos)
    .map((b): Participante => ({ blocoId: b.id, nomeBloco: b.nome, unidadesAtivas: ativasPorBloco.get(b.id) ?? 0 }))
  if (participantes.length === 0) {
    throw new Error('Nenhum bloco ativo com unidades ativas para participar do rateio.')
  }
  return calcularSnapshot(valor, participantes, agora)
}

/**
 * Redistribui `novoValor` reaproveitando as cotas do snapshot anterior como pesos (`unidadesAtivas`),
 * preservando blocoId, nomeBloco e ordem. Usado ao editar o valor de um lançamento GERAL.
 */
export function reratearComSnapshot(novoValor: Centavos, anterior: RateioSnapshot, agora: string): RateioSnapshot {
  return calcularSnapshot(novoValor, anterior.cotas, agora)
}

/** Σ valorCentavos das cotas (deve ser igual ao valor do lançamento). */
export function somaCotas(r: RateioSnapshot): Centavos {
  return somarCentavos(r.cotas.map((c) => c.valorCentavos))
}
