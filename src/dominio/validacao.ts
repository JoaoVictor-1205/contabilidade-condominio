// Validação ESTRUTURAL das entradas (DTOs) usadas pelos serviços. Módulo PURO (zod 4).
// Aqui só se verifica forma e coerência interna (tipos, faixas, escopo). Existência de ids,
// regra do saldo inicial, categoria ativa/de sistema etc. são responsabilidade dos serviços.
// Textos saem com trim; texto opcional vazio ('' ou null) sai como undefined.
import { z } from 'zod'
import type { CategoriaDocumento, Centavos, DataISO, EscopoTipo, FormaPagamento, Id, MesISO, Natureza } from './tipos'
import { ehDataISO, ehMesISO } from './datas'
import { ErroDominio } from './erros'

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

/** Erro de um campo. `campo` = caminho do campo ('' quando o erro é da entrada inteira). */
export interface ErroCampo {
  campo: string
  mensagem: string
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; erros: ErroCampo[] }

/** Mensagens dos erros, na ordem dos campos. Lista vazia quando ok. */
export function mensagensDe(r: Resultado<unknown>): string[] {
  return r.ok ? [] : r.erros.map((e) => e.mensagem)
}

/** Devolve o valor validado ou lança ErroDominio('VALIDACAO') com `detalhes` = erros. */
export function exigirValido<T>(r: Resultado<T>): T {
  if (r.ok) return r.valor
  throw new ErroDominio('VALIDACAO', mensagensDe(r).join(' '), r.erros)
}

// ---------------------------------------------------------------------------
// Tipos de entrada (DTOs)
// ---------------------------------------------------------------------------

export interface NovoLancamento {
  natureza: 'RECEITA' | 'DESPESA'
  data: DataISO
  /** Default (no serviço) = mês de `data`. */
  competencia?: MesISO
  valorCentavos: Centavos
  descricao: string
  categoriaId: Id
  escopoTipo: EscopoTipo
  /** GERAL: null/ausente. BLOCO: obrigatório. UNIDADE: opcional (o serviço preenche pela unidade). */
  blocoId?: Id | null
  /** UNIDADE: obrigatório. GERAL/BLOCO: null/ausente. */
  unidadeId?: Id | null
  formaPagamento?: FormaPagamento | null
  observacoes?: string
}

/**
 * Alteração parcial. Só os campos presentes são validados; a coerência do escopo é verificada
 * apenas quando `escopoTipo` vem no patch (campos ausentes são tolerados, `null` explícito não).
 * O serviço deve mesclar com o lançamento atual e validar o resultado com `validarNovoLancamento`.
 */
export type PatchLancamento = Partial<NovoLancamento>

export interface NovaTransferencia {
  data: DataISO
  competencia?: MesISO
  valorCentavos: Centavos
  descricao: string
  blocoOrigemId: Id
  blocoDestinoId: Id
  observacoes?: string
}

export interface DadosCondominio {
  nome: string
  cnpj?: string
  endereco?: string
  sindico?: string
  /** 1..31 */
  diaVencimento: number
}

export interface DadosBloco {
  nome: string
  /** 1..10 */
  quartos: number
  /** 1..50 */
  andares: number
  /** 1..99 */
  aptosPorAndar: number
  /** Pode ser negativo. */
  saldoInicialCentavos?: Centavos
  dataSaldoInicial?: DataISO
}

export interface DadosUnidade {
  responsavel?: string
  telefone?: string
  email?: string
  isenta?: boolean
  observacoes?: string
}

export interface NovaTaxa {
  /** 1..10 */
  quartos: number
  valorCentavos: Centavos
  vigenteDesde: MesISO
}

export interface DadosPagamento {
  data: DataISO
  /** Default (no serviço) = valor cobrado. */
  valorCentavos?: Centavos
  formaPagamento: FormaPagamento
  /** >= 0 */
  jurosCentavos?: Centavos
  observacoes?: string
}

export interface DadosDocumento {
  titulo: string
  categoria: CategoriaDocumento
  data: DataISO
  descricao?: string
}

export interface DadosCategoria {
  nome: string
  /** Categorias manuais só podem ser de RECEITA ou DESPESA (TRANSFERENCIA é exclusiva do sistema). */
  natureza: Natureza
}

export interface LinhaColagemUnidade {
  numero: string
  responsavel?: string
  telefone?: string
  email?: string
}

// ---------------------------------------------------------------------------
// Constantes e blocos de construção
// ---------------------------------------------------------------------------

export const TAMANHO_MAX_TEXTO = 200
export const TAMANHO_MAX_OBSERVACOES = 2000
export const TAMANHO_MAX_TELEFONE = 30
export const TAMANHO_MAX_CNPJ = 20

export const FORMAS_PAGAMENTO = [
  'DINHEIRO',
  'PIX',
  'TRANSFERENCIA',
  'BOLETO',
  'CARTAO',
  'CHEQUE',
  'OUTRO',
] as const satisfies readonly FormaPagamento[]

export const CATEGORIAS_DOCUMENTO = [
  'ATA',
  'CONVENCAO',
  'REGIMENTO',
  'CONTRATO',
  'ORCAMENTO',
  'OUTRO',
] as const satisfies readonly CategoriaDocumento[]

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Texto em branco e null viram undefined antes de validar; chave ausente continua ausente. */
function opcional<S extends z.ZodType>(esquema: S) {
  return z.preprocess(
    (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
    esquema.optional(),
  )
}

function textoObrigatorio(msgVazio: string, msgLongo: string, max = TAMANHO_MAX_TEXTO) {
  return z.string({ error: msgVazio }).trim().min(1, msgVazio).max(max, msgLongo)
}

function textoOpcional(msgLongo: string, max = TAMANHO_MAX_TEXTO) {
  return opcional(z.string({ error: 'Texto inválido.' }).trim().max(max, msgLongo))
}

function idObrigatorio(msg: string) {
  return z.string({ error: msg }).trim().min(1, msg)
}

/** Id opcional: '' vira null (sem valor); ausente continua ausente (relevante para patch). */
function idOpcional(msg: string) {
  return z
    .string({ error: msg })
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
}

function inteiroEntre(min: number, max: number, msgAusente: string, msgInteiro: string, msgFaixa: string) {
  return z.number({ error: msgAusente }).int(msgInteiro).min(min, msgFaixa).max(max, msgFaixa)
}

const valorPositivo = z
  .number({ error: 'Informe o valor.' })
  .int('O valor deve ser em centavos inteiros.')
  .positive('O valor deve ser maior que zero.')

const jurosNaoNegativos = z
  .number({ error: 'Informe os juros.' })
  .int('Os juros devem ser em centavos inteiros.')
  .nonnegative('Os juros não podem ser negativos.')

const saldoInicial = z.number({ error: 'Informe o saldo inicial.' }).int('O saldo inicial deve ser em centavos inteiros.')

const dataISO = z.string({ error: 'Informe uma data válida.' }).refine(ehDataISO, 'Informe uma data válida.')
const mesISO = z
  .string({ error: 'Informe uma competência válida (mês/ano).' })
  .refine(ehMesISO, 'Informe uma competência válida (mês/ano).')

const email = opcional(
  z
    .string({ error: 'Informe um e-mail válido.' })
    .trim()
    .max(TAMANHO_MAX_TEXTO, `O e-mail deve ter no máximo ${TAMANHO_MAX_TEXTO} caracteres.`)
    .refine((v) => RE_EMAIL.test(v), 'Informe um e-mail válido.'),
)

const observacoes = textoOpcional(
  `As observações devem ter no máximo ${TAMANHO_MAX_OBSERVACOES} caracteres.`,
  TAMANHO_MAX_OBSERVACOES,
)
const descricao = textoObrigatorio('Informe a descrição.', `A descrição deve ter no máximo ${TAMANHO_MAX_TEXTO} caracteres.`)
const nome = textoObrigatorio('Informe o nome.', `O nome deve ter no máximo ${TAMANHO_MAX_TEXTO} caracteres.`)
const quartos = inteiroEntre(
  1,
  10,
  'Informe o número de quartos.',
  'O número de quartos deve ser um número inteiro.',
  'O número de quartos deve estar entre 1 e 10.',
)
const formaPagamento = z.enum(FORMAS_PAGAMENTO, { error: 'Forma de pagamento inválida.' })

/** Mensagem de reserva (pt-BR) para qualquer issue sem mensagem própria. */
function mensagemPadrao(issue: { code: string; input?: unknown }): string {
  return issue.code === 'invalid_type' && issue.input === undefined ? 'Campo obrigatório.' : 'Valor inválido.'
}

/** Executa o esquema e converte para Resultado; mantém só a primeira mensagem de cada campo. */
function executar<S extends z.ZodType>(esquema: S, x: unknown): Resultado<z.output<S>> {
  const r = esquema.safeParse(x, { error: mensagemPadrao })
  if (r.success) return { ok: true, valor: r.data }
  const erros: ErroCampo[] = []
  const vistos = new Set<string>()
  for (const issue of r.error.issues) {
    const campo = issue.path.map(String).join('.')
    if (vistos.has(campo)) continue
    vistos.add(campo)
    erros.push({ campo, mensagem: issue.message })
  }
  return { ok: false, erros }
}

// ---------------------------------------------------------------------------
// Escopo do lançamento
// ---------------------------------------------------------------------------

type CamposEscopo = { escopoTipo?: EscopoTipo | undefined; blocoId?: Id | null | undefined; unidadeId?: Id | null | undefined }

/**
 * GERAL: sem bloco e sem unidade. BLOCO: bloco obrigatório, sem unidade. UNIDADE: unidade obrigatória.
 * `estrito` = false (patch): campo ausente é tolerado; `null` explícito não.
 */
function conferirEscopo(v: CamposEscopo, estrito: boolean, erro: (campo: string, mensagem: string) => void): void {
  const temBloco = typeof v.blocoId === 'string'
  const temUnidade = typeof v.unidadeId === 'string'
  const faltaBloco = estrito ? !temBloco : v.blocoId === null
  const faltaUnidade = estrito ? !temUnidade : v.unidadeId === null
  switch (v.escopoTipo) {
    case 'GERAL':
      if (temBloco) erro('blocoId', 'Lançamento geral não pode ter bloco.')
      if (temUnidade) erro('unidadeId', 'Lançamento geral não pode ter unidade.')
      break
    case 'BLOCO':
      if (faltaBloco) erro('blocoId', 'Informe o bloco.')
      if (temUnidade) erro('unidadeId', 'Lançamento de bloco não pode ter unidade.')
      break
    case 'UNIDADE':
      if (faltaUnidade) erro('unidadeId', 'Informe a unidade.')
      break
    default:
      break
  }
}

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

const camposLancamento = {
  natureza: z.enum(['RECEITA', 'DESPESA'], { error: 'A natureza deve ser receita ou despesa.' }),
  data: dataISO,
  competencia: opcional(mesISO),
  valorCentavos: valorPositivo,
  descricao,
  categoriaId: idObrigatorio('Informe a categoria.'),
  escopoTipo: z.enum(['GERAL', 'BLOCO', 'UNIDADE'], { error: 'Informe o escopo do lançamento.' }),
  blocoId: idOpcional('Bloco inválido.'),
  unidadeId: idOpcional('Unidade inválida.'),
  formaPagamento: formaPagamento.nullable().optional(),
  observacoes,
}

const esquemaNovoLancamento = z
  .object(camposLancamento, { error: 'Dados do lançamento inválidos.' })
  .superRefine((v, ctx) =>
    conferirEscopo(v, true, (campo, message) => ctx.addIssue({ code: 'custom', message, path: [campo] })),
  )

const esquemaPatchLancamento = z
  .object(camposLancamento, { error: 'Dados do lançamento inválidos.' })
  .partial()
  .superRefine((v, ctx) =>
    conferirEscopo(v, false, (campo, message) => ctx.addIssue({ code: 'custom', message, path: [campo] })),
  )

const esquemaNovaTransferencia = z
  .object(
    {
      data: dataISO,
      competencia: opcional(mesISO),
      valorCentavos: valorPositivo,
      descricao,
      blocoOrigemId: idObrigatorio('Informe o bloco de origem.'),
      blocoDestinoId: idObrigatorio('Informe o bloco de destino.'),
      observacoes,
    },
    { error: 'Dados da transferência inválidos.' },
  )
  .superRefine((v, ctx) => {
    if (v.blocoOrigemId === v.blocoDestinoId) {
      ctx.addIssue({
        code: 'custom',
        message: 'O bloco de destino deve ser diferente do bloco de origem.',
        path: ['blocoDestinoId'],
      })
    }
  })

const esquemaDadosCondominio = z.object(
  {
    nome,
    cnpj: textoOpcional(`O CNPJ deve ter no máximo ${TAMANHO_MAX_CNPJ} caracteres.`, TAMANHO_MAX_CNPJ),
    endereco: textoOpcional(`O endereço deve ter no máximo ${TAMANHO_MAX_TEXTO} caracteres.`),
    sindico: textoOpcional(`O nome do síndico deve ter no máximo ${TAMANHO_MAX_TEXTO} caracteres.`),
    diaVencimento: inteiroEntre(
      1,
      31,
      'Informe o dia de vencimento.',
      'O dia de vencimento deve ser um número inteiro.',
      'O dia de vencimento deve estar entre 1 e 31.',
    ),
  },
  { error: 'Dados do condomínio inválidos.' },
)

const esquemaDadosBloco = z.object(
  {
    nome,
    quartos,
    andares: inteiroEntre(
      1,
      50,
      'Informe o número de andares.',
      'O número de andares deve ser um número inteiro.',
      'O número de andares deve estar entre 1 e 50.',
    ),
    aptosPorAndar: inteiroEntre(
      1,
      99,
      'Informe o número de apartamentos por andar.',
      'O número de apartamentos por andar deve ser um número inteiro.',
      'O número de apartamentos por andar deve estar entre 1 e 99.',
    ),
    saldoInicialCentavos: opcional(saldoInicial),
    dataSaldoInicial: opcional(dataISO),
  },
  { error: 'Dados do bloco inválidos.' },
)

const esquemaDadosUnidade = z.object(
  {
    responsavel: textoOpcional(`O responsável deve ter no máximo ${TAMANHO_MAX_TEXTO} caracteres.`),
    telefone: textoOpcional(`O telefone deve ter no máximo ${TAMANHO_MAX_TELEFONE} caracteres.`, TAMANHO_MAX_TELEFONE),
    email,
    isenta: opcional(z.boolean({ error: 'Isenção inválida (use sim ou não).' })),
    observacoes,
  },
  { error: 'Dados da unidade inválidos.' },
)

const esquemaNovaTaxa = z.object(
  {
    quartos,
    valorCentavos: valorPositivo,
    vigenteDesde: mesISO,
  },
  { error: 'Dados da taxa inválidos.' },
)

const esquemaDadosPagamento = z.object(
  {
    data: dataISO,
    valorCentavos: opcional(valorPositivo),
    formaPagamento,
    jurosCentavos: opcional(jurosNaoNegativos),
    observacoes,
  },
  { error: 'Dados do pagamento inválidos.' },
)

const esquemaDadosDocumento = z.object(
  {
    titulo: textoObrigatorio('Informe o título.', `O título deve ter no máximo ${TAMANHO_MAX_TEXTO} caracteres.`),
    categoria: z.enum(CATEGORIAS_DOCUMENTO, { error: 'Categoria do documento inválida.' }),
    data: dataISO,
    descricao: textoOpcional(
      `A descrição deve ter no máximo ${TAMANHO_MAX_OBSERVACOES} caracteres.`,
      TAMANHO_MAX_OBSERVACOES,
    ),
  },
  { error: 'Dados do documento inválidos.' },
)

const esquemaDadosCategoria = z.object(
  {
    nome,
    natureza: z.enum(['RECEITA', 'DESPESA'], { error: 'A categoria deve ser de receita ou de despesa.' }),
  },
  { error: 'Dados da categoria inválidos.' },
)

// ---------------------------------------------------------------------------
// Validadores públicos
// ---------------------------------------------------------------------------

export function validarNovoLancamento(x: unknown): Resultado<NovoLancamento> {
  return executar(esquemaNovoLancamento, x)
}

export function validarPatchLancamento(x: unknown): Resultado<PatchLancamento> {
  return executar(esquemaPatchLancamento, x)
}

export function validarNovaTransferencia(x: unknown): Resultado<NovaTransferencia> {
  return executar(esquemaNovaTransferencia, x)
}

export function validarDadosCondominio(x: unknown): Resultado<DadosCondominio> {
  return executar(esquemaDadosCondominio, x)
}

export function validarDadosBloco(x: unknown): Resultado<DadosBloco> {
  return executar(esquemaDadosBloco, x)
}

export function validarDadosUnidade(x: unknown): Resultado<DadosUnidade> {
  return executar(esquemaDadosUnidade, x)
}

export function validarNovaTaxa(x: unknown): Resultado<NovaTaxa> {
  return executar(esquemaNovaTaxa, x)
}

export function validarDadosPagamento(x: unknown): Resultado<DadosPagamento> {
  return executar(esquemaDadosPagamento, x)
}

export function validarAlteracaoCobranca(x: unknown): Resultado<{ valorCentavos?: Centavos; vencimento?: DataISO; observacoes?: string }> {
  return executar(z.object({ valorCentavos: valorPositivo.optional(), vencimento: dataISO.optional(), observacoes }), x)
}

export function validarDadosDocumento(x: unknown): Resultado<DadosDocumento> {
  return executar(esquemaDadosDocumento, x)
}

export function validarDadosCategoria(x: unknown): Resultado<DadosCategoria> {
  return executar(esquemaDadosCategoria, x)
}

// ---------------------------------------------------------------------------
// Colagem de planilha de unidades
// ---------------------------------------------------------------------------

const RE_NUMERO_UNIDADE = /^\d+$/

/**
 * Interpreta texto colado de uma planilha: uma unidade por linha; colunas separadas por TAB
 * (ou por ';' quando não há TAB): número, responsável, telefone, e-mail.
 * Ignora linhas vazias e uma linha de cabeçalho (1ª linha com número não numérico).
 * Linhas inválidas (número ausente/repetido, e-mail inválido, texto longo) vão para `erros`
 * com o número da linha e ficam fora de `linhas`.
 */
export function analisarColagemUnidades(texto: string): { linhas: LinhaColagemUnidade[]; erros: string[] } {
  const linhas: LinhaColagemUnidade[] = []
  const erros: string[] = []
  const separador = texto.includes('\t') ? '\t' : ';'
  const vistos = new Map<string, number>()
  let primeiraComConteudo = true

  texto.split(/\r\n|\r|\n/).forEach((bruta, indice) => {
    const numeroLinha = indice + 1
    const colunas = bruta.split(separador).map((c) => c.trim())
    if (colunas.every((c) => c === '')) return
    const [numero = '', responsavel = '', telefone = '', email = ''] = colunas
    const ehPrimeira = primeiraComConteudo
    primeiraComConteudo = false

    if (!RE_NUMERO_UNIDADE.test(numero)) {
      if (ehPrimeira) return // cabeçalho
      erros.push(
        numero === ''
          ? `Linha ${numeroLinha}: número da unidade ausente.`
          : `Linha ${numeroLinha}: número da unidade inválido ("${numero}").`,
      )
      return
    }
    const repetidaEm = vistos.get(numero)
    if (repetidaEm !== undefined) {
      erros.push(`Linha ${numeroLinha}: número ${numero} repetido (já informado na linha ${repetidaEm}).`)
      return
    }
    const dados = validarDadosUnidade({ responsavel, telefone, email })
    if (!dados.ok) {
      erros.push(`Linha ${numeroLinha}: ${mensagensDe(dados).join(' ')}`)
      return
    }
    vistos.set(numero, numeroLinha)
    const linha: LinhaColagemUnidade = { numero }
    if (dados.valor.responsavel !== undefined) linha.responsavel = dados.valor.responsavel
    if (dados.valor.telefone !== undefined) linha.telefone = dados.valor.telefone
    if (dados.valor.email !== undefined) linha.email = dados.valor.email
    linhas.push(linha)
  })

  return { linhas, erros }
}
