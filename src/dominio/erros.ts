// Erro padrão do domínio e dos serviços. Módulo PURO.
// Serviços lançam ErroDominio com um `codigo` estável; a UI decide a apresentação pela mensagem/código.

export type CodigoErro =
  | 'VALIDACAO'
  | 'NAO_ENCONTRADO'
  | 'REGRA'
  | 'DATA_ANTERIOR_AO_SALDO_INICIAL'
  | 'CATEGORIA_DE_SISTEMA'
  | 'COBRANCA_ESTADO'
  | 'ESTRUTURA'
  | 'BACKUP'
  | 'MES_FECHADO'

/** Erro de negócio com código estável e mensagem em pt-BR pronta para o usuário. */
export class ErroDominio extends Error {
  readonly codigo: CodigoErro
  /** Dados extras (ex.: lista de erros de validação, ids envolvidos). */
  readonly detalhes?: unknown

  constructor(codigo: CodigoErro, mensagem: string, detalhes?: unknown) {
    super(mensagem)
    this.name = 'ErroDominio'
    this.codigo = codigo
    this.detalhes = detalhes
  }
}

/** Reconhece um ErroDominio (por instância ou pela forma, caso o erro tenha atravessado outro realm/wrapper). */
export function ehErroDominio(e: unknown): e is ErroDominio {
  if (e instanceof ErroDominio) return true
  if (typeof e !== 'object' || e === null) return false
  const o = e as { name?: unknown; codigo?: unknown; message?: unknown }
  return o.name === 'ErroDominio' && typeof o.codigo === 'string' && typeof o.message === 'string'
}
