// Dados iniciais do sistema (plano 4.4): condomínio, 14 blocos, 320 unidades, taxas zeradas e categorias.
// Módulo PURO: `agora` e o gerador de ids chegam por parâmetro. A gravação fica em src/dados/seed.ts.
import type {
  Bloco,
  Categoria,
  CategoriaSistema,
  Condominio,
  Id,
  MesISO,
  Natureza,
  TaxaVigencia,
  Unidade,
} from './tipos'
import { ehMesISO, primeiraDataDoMes } from './datas'
import { novoId } from './ids'
import { gerarPlanoUnidades } from './unidades'

export const NOME_CONDOMINIO_PADRAO = 'Meu Condomínio'
export const DIA_VENCIMENTO_PADRAO = 10

/** 1A..4B: 3 quartos, 4 andares × 4 aptos (16). 5A..7B: 2 quartos, 4 andares × 8 aptos (32). */
export const SEED_BLOCOS: ReadonlyArray<{ nome: string; quartos: number; andares: number; aptosPorAndar: number }> = [
  { nome: '1A', quartos: 3, andares: 4, aptosPorAndar: 4 },
  { nome: '1B', quartos: 3, andares: 4, aptosPorAndar: 4 },
  { nome: '2A', quartos: 3, andares: 4, aptosPorAndar: 4 },
  { nome: '2B', quartos: 3, andares: 4, aptosPorAndar: 4 },
  { nome: '3A', quartos: 3, andares: 4, aptosPorAndar: 4 },
  { nome: '3B', quartos: 3, andares: 4, aptosPorAndar: 4 },
  { nome: '4A', quartos: 3, andares: 4, aptosPorAndar: 4 },
  { nome: '4B', quartos: 3, andares: 4, aptosPorAndar: 4 },
  { nome: '5A', quartos: 2, andares: 4, aptosPorAndar: 8 },
  { nome: '5B', quartos: 2, andares: 4, aptosPorAndar: 8 },
  { nome: '6A', quartos: 2, andares: 4, aptosPorAndar: 8 },
  { nome: '6B', quartos: 2, andares: 4, aptosPorAndar: 8 },
  { nome: '7A', quartos: 2, andares: 4, aptosPorAndar: 8 },
  { nome: '7B', quartos: 2, andares: 4, aptosPorAndar: 8 },
]

/** Categorias padrão na ordem de exibição; as de sistema (TAXA/JUROS/TRANSFERENCIA) vêm marcadas. */
export const SEED_CATEGORIAS: ReadonlyArray<{ nome: string; natureza: Natureza; sistema: CategoriaSistema | null }> = [
  { nome: 'Taxa condominial', natureza: 'RECEITA', sistema: 'TAXA' },
  { nome: 'Juros e multas', natureza: 'RECEITA', sistema: 'JUROS' },
  { nome: 'Taxa extra', natureza: 'RECEITA', sistema: null },
  { nome: 'Aluguel de espaços', natureza: 'RECEITA', sistema: null },
  { nome: 'Rendimentos financeiros', natureza: 'RECEITA', sistema: null },
  { nome: 'Outras receitas', natureza: 'RECEITA', sistema: null },
  { nome: 'Água e esgoto', natureza: 'DESPESA', sistema: null },
  { nome: 'Energia elétrica', natureza: 'DESPESA', sistema: null },
  { nome: 'Limpeza e conservação', natureza: 'DESPESA', sistema: null },
  { nome: 'Manutenção e reparos', natureza: 'DESPESA', sistema: null },
  { nome: 'Pessoal e encargos', natureza: 'DESPESA', sistema: null },
  { nome: 'Segurança/portaria', natureza: 'DESPESA', sistema: null },
  { nome: 'Materiais', natureza: 'DESPESA', sistema: null },
  { nome: 'Serviços e honorários', natureza: 'DESPESA', sistema: null },
  { nome: 'Tarifas bancárias', natureza: 'DESPESA', sistema: null },
  { nome: 'Impostos e taxas', natureza: 'DESPESA', sistema: null },
  { nome: 'Outras despesas', natureza: 'DESPESA', sistema: null },
  { nome: 'Transferência entre blocos', natureza: 'TRANSFERENCIA', sistema: 'TRANSFERENCIA' },
]

export interface SeedInicial {
  condominio: Condominio
  blocos: Bloco[]
  unidades: Unidade[]
  taxas: TaxaVigencia[]
  categorias: Categoria[]
}

/**
 * Monta o seed completo em memória (sem gravar nada).
 * - blocos com `ordem` 1..14, ativos, saldo inicial 0 na abertura do 1º dia de `inicioContabil`;
 * - 320 unidades (`ativa true`, `isenta false`) via `gerarPlanoUnidades`;
 * - uma `TaxaVigencia` zerada por valor distinto de `quartos`, vigente desde `inicioContabil`;
 * - categorias com `ordem` 1..n, ativas.
 * Todos os `criadoEm`/`atualizadoEm` = `agora`.
 */
export function gerarSeed(p: { inicioContabil: MesISO; agora: string; gerarId?: () => Id }): SeedInicial {
  if (!ehMesISO(p.inicioContabil)) {
    throw new Error('Mês de início contábil inválido; informe no formato AAAA-MM.')
  }
  const gerarId = p.gerarId ?? novoId
  const { inicioContabil, agora } = p
  const dataInicio = primeiraDataDoMes(inicioContabil)

  const condominio: Condominio = {
    id: 'unico',
    nome: NOME_CONDOMINIO_PADRAO,
    diaVencimento: DIA_VENCIMENTO_PADRAO,
    inicioContabil,
    criadoEm: agora,
    atualizadoEm: agora,
  }

  const blocos: Bloco[] = []
  const unidades: Unidade[] = []
  SEED_BLOCOS.forEach((s, i) => {
    const bloco: Bloco = {
      id: gerarId(),
      nome: s.nome,
      quartos: s.quartos,
      andares: s.andares,
      aptosPorAndar: s.aptosPorAndar,
      ordem: i + 1,
      ativo: true,
      saldoInicialCentavos: 0,
      dataSaldoInicial: dataInicio,
      criadoEm: agora,
      atualizadoEm: agora,
    }
    blocos.push(bloco)
    for (const u of gerarPlanoUnidades(bloco)) {
      unidades.push({
        id: gerarId(),
        blocoId: bloco.id,
        numero: u.numero,
        andar: u.andar,
        posicao: u.posicao,
        ativa: true,
        isenta: false,
        criadoEm: agora,
        atualizadoEm: agora,
      })
    }
  })

  // Um tipo de taxa por valor distinto de quartos, na ordem em que aparecem nos blocos (3, 2).
  const quartosDistintos = [...new Set(SEED_BLOCOS.map((b) => b.quartos))]
  const taxas: TaxaVigencia[] = quartosDistintos.map((quartos) => ({
    id: gerarId(),
    quartos,
    valorCentavos: 0,
    vigenteDesde: inicioContabil,
    criadoEm: agora,
  }))

  const categorias: Categoria[] = SEED_CATEGORIAS.map((c, i) => ({
    id: gerarId(),
    nome: c.nome,
    natureza: c.natureza,
    ordem: i + 1,
    ativa: true,
    sistema: c.sistema,
  }))

  return { condominio, blocos, unidades, taxas, categorias }
}
