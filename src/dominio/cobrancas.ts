// Cobranças — parte PURA do domínio (plano 5.7): taxa vigente, vencimento, situação,
// planejamento da geração mensal e agrupamento de inadimplência.
// Sem React, sem Dexie, sem relógio: `agora`/`hoje` sempre chegam por parâmetro.
import type { Bloco, Centavos, Cobranca, DataISO, Id, MesISO, TaxaVigencia, Unidade } from './tipos'
import { compararDatas, montarData, partesDoMes, ultimoDiaDoMes } from './datas'
import { novoId } from './ids'

/**
 * Taxa que vale para `quartos` na `competencia`: a de maior `vigenteDesde` <= competencia.
 * Empate em `vigenteDesde` (não deveria ocorrer pelo índice único) → a de `criadoEm` mais recente.
 * Vigências retroativas (vigenteDesde anterior à competência) cobrem competências anteriores.
 */
export function taxaVigente(taxas: readonly TaxaVigencia[], quartos: number, competencia: MesISO): TaxaVigencia | undefined {
  let melhor: TaxaVigencia | undefined
  for (const t of taxas) {
    if (t.quartos !== quartos || t.vigenteDesde > competencia) continue
    if (
      melhor === undefined ||
      t.vigenteDesde > melhor.vigenteDesde ||
      (t.vigenteDesde === melhor.vigenteDesde && t.criadoEm > melhor.criadoEm)
    ) {
      melhor = t
    }
  }
  return melhor
}

/**
 * Data de vencimento da competência: `diaVencimento` ajustado ao último dia do mês.
 * ('2026-02', 31) → '2026-02-28'; dia < 1 (ou inválido) → dia 1.
 */
export function calcularVencimento(competencia: MesISO, diaVencimento: number): DataISO {
  const { ano, mes } = partesDoMes(competencia)
  const ultimo = ultimoDiaDoMes(competencia)
  const dia = Number.isFinite(diaVencimento) ? Math.trunc(diaVencimento) : 1
  return montarData(ano, mes, Math.min(Math.max(dia, 1), ultimo))
}

export type SituacaoCobranca = 'PAGA' | 'CANCELADA' | 'ISENTA' | 'A_VENCER' | 'VENCIDA'

/** PAGA/CANCELADA/ISENTA pelo status; ABERTA com vencimento < hoje = VENCIDA, senão A_VENCER (vence hoje ainda não está vencida). */
export function situacaoCobranca(c: Cobranca, hoje: DataISO): SituacaoCobranca {
  if (c.status !== 'ABERTA') return c.status
  return c.vencimento < hoje ? 'VENCIDA' : 'A_VENCER'
}

export interface PlanoCobrancas {
  /** Cobranças ABERTAS prontas para gravar (ordem: bloco.ordem, depois número da unidade). */
  criar: Cobranca[]
  /** Cobranças que já existiam na competência (qualquer status). */
  jaExistentes: number
  /** Tipos (por quartos) com unidades a cobrar mas sem taxa vigente > 0; `blocos` = nomes dos blocos afetados. */
  semTaxa: Array<{ quartos: number; blocos: string[] }>
  /** Resumo do que será criado, por quartos; `valorCentavos` = valor de CADA cobrança (a taxa aplicada). */
  resumo: Array<{ quartos: number; quantidade: number; valorCentavos: Centavos }>
}

export interface ParametrosPlanejamento {
  competencia: MesISO
  blocos: readonly Bloco[]
  unidades: readonly Unidade[]
  taxas: readonly TaxaVigencia[]
  /** Cobranças já existentes da competência (as de outra competência são ignoradas). */
  existentes: readonly Cobranca[]
  diaVencimento: number
  /** Timestamp ISO usado em criadoEm/atualizadoEm. */
  agora: string
  gerarId?: () => Id
}

/** Ordena unidades pelo número de forma numérica ('101' < '112' < '201'; '2' < '10'). */
function compararNumeroUnidade(a: Unidade, b: Unidade): number {
  return a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true })
}

/**
 * Planeja a geração de cobranças da competência (idempotente): para cada unidade ativa e não isenta
 * de bloco ativo SEM cobrança na competência, cria uma ABERTA com a taxa vigente do tipo (quartos) do bloco.
 * Tipo sem taxa vigente > 0 → nada criado para ele; entra em `semTaxa`. Não grava nada: só devolve o plano.
 */
export function planejarCobrancas(p: ParametrosPlanejamento): PlanoCobrancas {
  const gerarId = p.gerarId ?? novoId
  const existentes = p.existentes.filter((c) => c.competencia === p.competencia)
  const unidadesComCobranca = new Set(existentes.map((c) => c.unidadeId))
  const vencimento = calcularVencimento(p.competencia, p.diaVencimento)

  const unidadesPorBloco = new Map<Id, Unidade[]>()
  for (const u of p.unidades) {
    if (!u.ativa || u.isenta) continue
    const lista = unidadesPorBloco.get(u.blocoId)
    if (lista) lista.push(u)
    else unidadesPorBloco.set(u.blocoId, [u])
  }

  const blocosAtivos = p.blocos.filter((b) => b.ativo).sort((a, b) => a.ordem - b.ordem)
  const criar: Cobranca[] = []
  const semTaxa = new Map<number, string[]>()
  const resumo = new Map<number, { quartos: number; quantidade: number; valorCentavos: Centavos }>()

  for (const bloco of blocosAtivos) {
    const unidades = (unidadesPorBloco.get(bloco.id) ?? []).sort(compararNumeroUnidade)
    const taxa = taxaVigente(p.taxas, bloco.quartos, p.competencia)
    const taxaValida = taxa !== undefined && taxa.valorCentavos > 0 ? taxa : undefined
    for (const u of unidades) {
      if (unidadesComCobranca.has(u.id)) continue
      if (taxaValida === undefined) {
        const nomes = semTaxa.get(bloco.quartos)
        if (nomes === undefined) semTaxa.set(bloco.quartos, [bloco.nome])
        else if (!nomes.includes(bloco.nome)) nomes.push(bloco.nome)
        continue
      }
      criar.push({
        id: gerarId(),
        unidadeId: u.id,
        blocoId: bloco.id,
        competencia: p.competencia,
        valorCentavos: taxaValida.valorCentavos,
        vencimento,
        status: 'ABERTA',
        taxaVigenciaId: taxaValida.id,
        origemValor: 'TAXA',
        lancamentoId: null,
        pagaEm: null,
        valorPagoCentavos: null,
        jurosCentavos: 0,
        criadoEm: p.agora,
        atualizadoEm: p.agora,
      })
      const linha = resumo.get(bloco.quartos)
      if (linha) linha.quantidade += 1
      else resumo.set(bloco.quartos, { quartos: bloco.quartos, quantidade: 1, valorCentavos: taxaValida.valorCentavos })
    }
  }

  return {
    criar,
    jaExistentes: existentes.length,
    semTaxa: [...semTaxa.entries()].sort((a, b) => a[0] - b[0]).map(([quartos, blocos]) => ({ quartos, blocos })),
    resumo: [...resumo.values()].sort((a, b) => a.quartos - b.quartos),
  }
}

export interface GrupoInadimplencia {
  unidade: Unidade
  bloco: Bloco
  /** Cobranças em aberto consideradas (vencidas; ou também a vencer com `incluirAVencer`), por competência. */
  vencidas: Cobranca[]
  totalDevidoCentavos: Centavos
  /** Competência mais antiga em aberto. */
  maisAntiga: MesISO
  /** Unidade desativada com dívida: continua cobrável, marcada na lista. */
  unidadeInativa: boolean
}

export interface OpcoesInadimplencia {
  /** Inclui também as ABERTAS ainda não vencidas (padrão: só VENCIDAS). */
  incluirAVencer?: boolean
  /** Restringe a um bloco; null/undefined = todos. */
  blocoId?: Id | null
}

/**
 * Agrupa as cobranças ABERTAS vencidas (ou também a vencer) por unidade. Inclui unidades inativas
 * (marcadas com `unidadeInativa`). Ordem: bloco.ordem, depois número da unidade; dentro do grupo, por competência.
 * Cobranças cuja unidade ou bloco não seja encontrado são ignoradas.
 */
export function agruparInadimplencia(
  cobrancas: readonly Cobranca[],
  unidades: readonly Unidade[],
  blocos: readonly Bloco[],
  hoje: DataISO,
  opcoes: OpcoesInadimplencia = {},
): GrupoInadimplencia[] {
  const incluirAVencer = opcoes.incluirAVencer ?? false
  const filtroBlocoId = opcoes.blocoId ?? null
  const unidadePorId = new Map(unidades.map((u) => [u.id, u]))
  const blocoPorId = new Map(blocos.map((b) => [b.id, b]))

  const porUnidade = new Map<Id, GrupoInadimplencia>()
  for (const c of cobrancas) {
    const situacao = situacaoCobranca(c, hoje)
    if (situacao !== 'VENCIDA' && !(incluirAVencer && situacao === 'A_VENCER')) continue
    const unidade = unidadePorId.get(c.unidadeId)
    if (unidade === undefined) continue
    if (filtroBlocoId !== null && unidade.blocoId !== filtroBlocoId) continue
    const bloco = blocoPorId.get(unidade.blocoId)
    if (bloco === undefined) continue
    let grupo = porUnidade.get(c.unidadeId)
    if (grupo === undefined) {
      grupo = { unidade, bloco, vencidas: [], totalDevidoCentavos: 0, maisAntiga: c.competencia, unidadeInativa: !unidade.ativa }
      porUnidade.set(c.unidadeId, grupo)
    }
    grupo.vencidas.push(c)
    grupo.totalDevidoCentavos += c.valorCentavos
    if (c.competencia < grupo.maisAntiga) grupo.maisAntiga = c.competencia
  }

  const grupos = [...porUnidade.values()]
  for (const g of grupos) {
    g.vencidas.sort((a, b) => compararDatas(a.competencia, b.competencia))
  }
  grupos.sort((a, b) => a.bloco.ordem - b.bloco.ordem || compararNumeroUnidade(a.unidade, b.unidade))
  return grupos
}

/** Totais da lista de inadimplência: unidades devedoras, quantidade de cobranças e valor devido. */
export function totalInadimplencia(grupos: readonly GrupoInadimplencia[]): {
  unidades: number
  cobrancas: number
  valorCentavos: Centavos
} {
  let cobrancasTotal = 0
  let valor = 0
  for (const g of grupos) {
    cobrancasTotal += g.vencidas.length
    valor += g.totalDevidoCentavos
  }
  return { unidades: grupos.length, cobrancas: cobrancasTotal, valorCentavos: valor }
}
