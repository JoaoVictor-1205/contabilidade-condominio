// Tipos do domínio. Módulo PURO: sem React, sem Dexie, sem Date.now().
// Dinheiro sempre em CENTAVOS inteiros. Datas como strings ISO ('AAAA-MM-DD' / 'AAAA-MM').

export type Id = string
export type Centavos = number
export type DataISO = string // 'AAAA-MM-DD'
export type MesISO = string // 'AAAA-MM'

export type Natureza = 'RECEITA' | 'DESPESA' | 'TRANSFERENCIA'
/** ESTORNO: lançamento espelho (mesma natureza/escopo/valor) que anula o original em mês fechado. */
export type TipoLancamento = 'NORMAL' | 'ESTORNO'
export type StatusLancamento = 'ATIVO' | 'EXCLUIDO'
export type EscopoTipo = 'GERAL' | 'BLOCO' | 'UNIDADE'
export type StatusCobranca = 'ABERTA' | 'PAGA' | 'CANCELADA' | 'ISENTA'
export type FormaPagamento = 'DINHEIRO' | 'PIX' | 'TRANSFERENCIA' | 'BOLETO' | 'CARTAO' | 'CHEQUE' | 'OUTRO'
export type CategoriaSistema = 'TAXA' | 'JUROS' | 'TRANSFERENCIA'
export type CategoriaDocumento = 'ATA' | 'CONVENCAO' | 'REGIMENTO' | 'CONTRATO' | 'ORCAMENTO' | 'OUTRO'

export interface Periodo {
  inicio: DataISO
  fim: DataISO
}

export interface Condominio {
  id: 'unico'
  nome: string
  cnpj?: string
  endereco?: string
  sindico?: string
  /** 1..31; ajustado ao último dia do mês quando necessário. */
  diaVencimento: number
  /** Primeiro mês registrado no sistema. Definido no onboarding; pode ser recuado. */
  inicioContabil: MesISO
  criadoEm: string
  atualizadoEm: string
}

export interface Bloco {
  id: Id
  nome: string
  quartos: number
  andares: number
  aptosPorAndar: number
  /** Ordem de exibição e de desempate no rateio (1..n). */
  ordem: number
  /** false = desativado (mantido por histórico); reativável. */
  ativo: boolean
  /** Saldo do caixa do bloco na ABERTURA do dia `dataSaldoInicial`. Pode ser negativo. NÃO é receita. */
  saldoInicialCentavos: Centavos
  /** Nenhum lançamento que afete este bloco pode ter data anterior a esta. */
  dataSaldoInicial: DataISO
  criadoEm: string
  atualizadoEm: string
  desativadoEm?: string
}

export interface Unidade {
  id: Id
  blocoId: Id
  /** Ex.: '101', '112'. Único por bloco. */
  numero: string
  andar: number
  posicao: number
  /** false SÓ via edição da estrutura (diffUnidades). Inativa não pesa no rateio nem recebe cobrança nova. */
  ativa: boolean
  /** Ativa (conta no rateio) mas não recebe cobrança (ex.: zelador, unidade do condomínio). */
  isenta: boolean
  responsavel?: string
  telefone?: string
  email?: string
  observacoes?: string
  criadoEm: string
  atualizadoEm: string
  desativadaEm?: string
}

export interface TaxaVigencia {
  id: Id
  quartos: number
  valorCentavos: Centavos
  /** Competência a partir da qual vale (inclusive). Única por `quartos`. */
  vigenteDesde: MesISO
  criadoEm: string
}

export interface Categoria {
  id: Id
  nome: string
  natureza: Natureza
  ordem: number
  ativa: boolean
  /** Categorias de sistema não podem ser removidas nem trocar de natureza; TAXA/JUROS não são selecionáveis manualmente. */
  sistema: CategoriaSistema | null
}

export interface CotaRateio {
  blocoId: Id
  nomeBloco: string
  unidadesAtivas: number
  valorCentavos: Centavos
}

export interface RateioSnapshot {
  criterio: 'POR_UNIDADE'
  totalUnidades: number
  cotas: CotaRateio[]
  calculadoEm: string
}

export interface Lancamento {
  id: Id
  natureza: Natureza
  /** NORMAL ou ESTORNO (v2). */
  tipo: TipoLancamento
  status: StatusLancamento
  escopoTipo: EscopoTipo
  /** BLOCO/UNIDADE: o bloco; TRANSFERENCIA: bloco de destino; GERAL: null. */
  blocoId: Id | null
  unidadeId: Id | null
  /** Só em TRANSFERENCIA: bloco de origem. */
  blocoOrigemId: Id | null
  /** Data em que o dinheiro entrou/saiu (regime de caixa). */
  data: DataISO
  /** Derivado de `data`; indexado. */
  mes: MesISO
  /** Mês de referência (visão gerencial). Default = `mes`. */
  competencia: MesISO
  categoriaId: Id
  descricao: string
  valorCentavos: Centavos
  formaPagamento: FormaPagamento | null
  observacoes?: string
  /** Obrigatório em GERAL: Σ cotas === valorCentavos. null nos demais escopos. */
  rateio: RateioSnapshot | null
  /** Receita TAXA/JUROS criada pelos serviços de cobrança. */
  cobrancaId: Id | null
  /** Em ESTORNO: o lançamento original que este anula. */
  estornaLancamentoId: Id | null
  /** No original: o ESTORNO ativo que o anulou. */
  estornadoPorId: Id | null
  versao: number
  criadoEm: string
  atualizadoEm: string
  excluidoEm?: string
  motivoExclusao?: string
}

export interface Anexo {
  id: Id
  donoTipo: 'LANCAMENTO' | 'DOCUMENTO'
  donoId: Id
  nome: string
  mime: string
  tamanho: number
  criadoEm: string
}

export interface AnexoBlob {
  id: Id
  blob: Blob
}

export interface Documento {
  id: Id
  titulo: string
  categoria: CategoriaDocumento
  data: DataISO
  descricao?: string
  criadoEm: string
  atualizadoEm: string
}

export interface Cobranca {
  id: Id
  unidadeId: Id
  blocoId: Id
  competencia: MesISO
  valorCentavos: Centavos
  vencimento: DataISO
  status: StatusCobranca
  taxaVigenciaId: Id
  /** MANUAL após alteração do valor em aberto; "Reemitir" pula MANUAL. */
  origemValor: 'TAXA' | 'MANUAL'
  /** Lançamento TAXA quando PAGA. */
  lancamentoId: Id | null
  pagaEm: DataISO | null
  /** Valor efetivamente recebido (desconto = valorCentavos − valorPagoCentavos). */
  valorPagoCentavos: Centavos | null
  /** Juros/multa recebidos (lançamento JUROS separado); 0 se não houve. */
  jurosCentavos: Centavos
  motivo?: string
  observacoes?: string
  criadoEm: string
  atualizadoEm: string
}

/** Fechamento mensal (v2): a partir dele, escritas com data no mês (ou anterior) são recusadas; correções por estorno. */
export interface Fechamento {
  mes: MesISO
  fechadoEm: string
  /** Base contábil do fechamento: sempre caixa (data). */
  base: 'data'
  saldos: Array<{ blocoId: Id; saldoFinalCentavos: Centavos }>
  saldoGeralCentavos: Centavos
  qtdLancamentos: number
}

export type EntidadeAuditada =
  | 'lancamento'
  | 'cobranca'
  | 'bloco'
  | 'unidade'
  | 'taxa'
  | 'categoria'
  | 'condominio'
  | 'anexo'
  | 'documento'
  | 'backup'
  | 'fechamento'

export interface Auditoria {
  seq?: number
  em: string
  entidade: EntidadeAuditada
  entidadeId: Id
  acao: string
  resumo: string
  motivo?: string
  /** Campos alterados (de → para), quando a ação é uma edição. */
  alteracoes?: Record<string, { de: unknown; para: unknown }>
}

export interface Meta {
  chave: string
  valor: unknown
}
