// Formato do dados.json dentro do ZIP de backup, com validação na restauração.
import { z } from 'zod'
import { ehDataISO, ehMesISO } from '../dominio/datas'
import { CATEGORIAS_DOCUMENTO, FORMAS_PAGAMENTO } from '../dominio/validacao'
import { ErroDominio } from '../dominio/erros'
import type { Anexo, Auditoria, Bloco, Categoria, Cobranca, Condominio, Documento, Fechamento, Lancamento, Meta, TaxaVigencia, Unidade } from '../dominio/tipos'

export const FORMATO_BACKUP = 'sindico-backup'
export const VERSAO_FORMATO = 1

export interface AnexoNoBackup extends Anexo {
  /** Caminho dentro do ZIP: anexos/<id>.<ext> */
  arquivo: string
  /** false = binário omitido intencionalmente no backup por ano; metadados sempre presentes. */
  incluido?: boolean
}

export interface TabelasBackup {
  condominio: Condominio[]
  blocos: Bloco[]
  unidades: Unidade[]
  taxas: TaxaVigencia[]
  categorias: Categoria[]
  lancamentos: Lancamento[]
  cobrancas: Cobranca[]
  /** v2 (schema 2). Backups de schema 1 não trazem; a migração preenche []. */
  fechamentos: Fechamento[]
  auditoria: Auditoria[]
  meta: Meta[]
  documentos: Documento[]
  anexos: AnexoNoBackup[]
}

export interface DadosBackup {
  formato: typeof FORMATO_BACKUP
  versaoFormato: number
  schemaVersion: number
  appVersao: string
  geradoEm: string
  instalacaoId: string
  navegador: string
  condominio: { nome: string }
  /** null = backup completo; número = só os anexos daquele ano (dados sempre completos). */
  anoDosAnexos: number | null
  contagens: Record<string, number>
  tabelas: TabelasBackup
}

const id = z.string().min(1)
const data = z.string().refine(ehDataISO, 'Data inválida')
const mes = z.string().refine(ehMesISO, 'Mês inválido')
const inteiro = z.number().int()
const positivo = inteiro.positive()
const texto = z.string()
const tempos = { criadoEm: texto, atualizadoEm: texto }
const natureza = z.enum(['RECEITA', 'DESPESA', 'TRANSFERENCIA'])
const rateio = z.object({
  criterio: z.literal('POR_UNIDADE'), totalUnidades: positivo, calculadoEm: texto,
  cotas: z.array(z.object({ blocoId: id, nomeBloco: texto, unidadesAtivas: inteiro.nonnegative(), valorCentavos: inteiro.nonnegative() })).min(1),
})
const lancamento = z.object({
  id, natureza, tipo: z.enum(['NORMAL', 'ESTORNO']).default('NORMAL'), status: z.enum(['ATIVO', 'EXCLUIDO']),
  escopoTipo: z.enum(['GERAL', 'BLOCO', 'UNIDADE']), blocoId: id.nullable(), unidadeId: id.nullable(), blocoOrigemId: id.nullable(),
  data, mes, competencia: mes, categoriaId: id, descricao: texto, valorCentavos: positivo,
  formaPagamento: z.enum(FORMAS_PAGAMENTO).nullable(), observacoes: texto.optional(), rateio: rateio.nullable(), cobrancaId: id.nullable(),
  estornaLancamentoId: id.nullable().default(null), estornadoPorId: id.nullable().default(null),
  versao: positivo, ...tempos, excluidoEm: texto.optional(), motivoExclusao: texto.optional(),
})

const esquema = z.looseObject({
  formato: z.literal(FORMATO_BACKUP),
  versaoFormato: z.literal(VERSAO_FORMATO),
  schemaVersion: positivo,
  appVersao: z.string(),
  geradoEm: z.string(),
  instalacaoId: z.string(),
  navegador: z.string(),
  condominio: z.looseObject({ nome: z.string() }),
  anoDosAnexos: z.number().int().nullable(),
  contagens: z.record(z.string(), inteiro.nonnegative()),
  tabelas: z.looseObject({
    condominio: z.array(z.object({ id: z.literal('unico'), nome: texto, inicioContabil: mes, diaVencimento: inteiro.min(1).max(31), cnpj: texto.optional(), endereco: texto.optional(), sindico: texto.optional(), ...tempos })).length(1),
    blocos: z.array(z.object({ id, nome: texto, quartos: positivo, andares: positivo, aptosPorAndar: positivo, ordem: inteiro, ativo: z.boolean(), saldoInicialCentavos: inteiro, dataSaldoInicial: data, ...tempos, desativadoEm: texto.optional() })),
    unidades: z.array(z.object({ id, blocoId: id, numero: texto, andar: positivo, posicao: positivo, ativa: z.boolean(), isenta: z.boolean(), responsavel: texto.optional(), telefone: texto.optional(), email: texto.optional(), observacoes: texto.optional(), ...tempos, desativadaEm: texto.optional() })),
    taxas: z.array(z.object({ id, quartos: positivo, valorCentavos: inteiro.nonnegative(), vigenteDesde: mes, criadoEm: texto })),
    categorias: z.array(z.object({ id, nome: texto, natureza, ordem: inteiro, ativa: z.boolean(), sistema: z.enum(['TAXA', 'JUROS', 'TRANSFERENCIA']).nullable() })),
    lancamentos: z.array(lancamento),
    cobrancas: z.array(z.object({ id, unidadeId: id, blocoId: id, competencia: mes, valorCentavos: positivo, vencimento: data, status: z.enum(['ABERTA', 'PAGA', 'CANCELADA', 'ISENTA']), taxaVigenciaId: id, origemValor: z.enum(['TAXA', 'MANUAL']), lancamentoId: id.nullable(), pagaEm: data.nullable(), valorPagoCentavos: positivo.nullable(), jurosCentavos: inteiro.nonnegative(), motivo: texto.optional(), observacoes: texto.optional(), ...tempos })),
    fechamentos: z.array(z.object({ mes, fechadoEm: texto, base: z.literal('data'), saldos: z.array(z.object({ blocoId: id, saldoFinalCentavos: inteiro })), saldoGeralCentavos: inteiro, qtdLancamentos: inteiro.nonnegative() })).default([]),
    auditoria: z.array(z.object({ seq: positivo.optional(), em: texto, entidade: z.enum(['lancamento', 'cobranca', 'bloco', 'unidade', 'taxa', 'categoria', 'condominio', 'anexo', 'documento', 'backup', 'fechamento']), entidadeId: id, acao: texto, resumo: texto, motivo: texto.optional(), alteracoes: z.record(texto, z.object({ de: z.unknown(), para: z.unknown() })).optional() })),
    meta: z.array(z.object({ chave: id, valor: z.unknown() })),
    documentos: z.array(z.object({ id, titulo: texto, categoria: z.enum(CATEGORIAS_DOCUMENTO), data, descricao: texto.optional(), ...tempos })),
    anexos: z.array(z.object({ id, arquivo: z.string().regex(/^anexos\/[a-z0-9_-]+\.[a-z0-9]{1,6}$/i), incluido: z.boolean().optional(), donoTipo: z.enum(['LANCAMENTO', 'DOCUMENTO']), donoId: id, nome: texto, mime: texto, tamanho: inteiro.nonnegative(), criadoEm: texto })),
  }),
})

export function validarBackup(x: unknown): DadosBackup {
  const r = esquema.safeParse(x)
  if (!r.success) {
    const primeiro = r.error.issues[0]
    throw new ErroDominio('BACKUP', `O arquivo não é um backup válido deste sistema${primeiro ? ` (${primeiro.path.join('.')}: ${primeiro.message})` : ''}.`, r.error.issues)
  }
  const dados: DadosBackup = r.data
  for (const [nome, lista] of Object.entries(dados.tabelas)) {
    if (Array.isArray(lista) && dados.contagens[nome] !== undefined && dados.contagens[nome] !== lista.length) throw new ErroDominio('BACKUP', `Contagem divergente na tabela ${nome}.`)
  }
  return dados
}

/** Migrações do JSON de backup entre versões de schema (encadeadas até a atual). */
export function migrarBackup(dados: DadosBackup, schemaAtual: number): DadosBackup {
  if (dados.schemaVersion > schemaAtual) {
    throw new ErroDominio('BACKUP', `Este backup foi gerado por uma versão mais nova do sistema (schema ${dados.schemaVersion}). Atualize o sistema para restaurá-lo.`)
  }
  let d = dados
  if (d.schemaVersion < 2) {
    // v1 → v2: lançamentos ganham tipo/estorno; tabela de fechamentos vazia.
    d = {
      ...d,
      schemaVersion: 2,
      tabelas: {
        ...d.tabelas,
        lancamentos: d.tabelas.lancamentos.map((l) => ({ ...l, tipo: l.tipo ?? 'NORMAL', estornaLancamentoId: l.estornaLancamentoId ?? null, estornadoPorId: l.estornadoPorId ?? null })),
        fechamentos: d.tabelas.fechamentos ?? [],
      },
    }
  }
  if (!d.tabelas.fechamentos) d = { ...d, tabelas: { ...d.tabelas, fechamentos: [] } }
  return d
}
