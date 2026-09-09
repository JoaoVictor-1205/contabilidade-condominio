// Rótulos em pt-BR para enums e escopos.
import type { FormaPagamento, Lancamento, Natureza } from '../dominio/tipos'

export const ROTULO_NATUREZA: Record<Natureza, string> = { RECEITA: 'Receita', DESPESA: 'Despesa', TRANSFERENCIA: 'Transferência' }

export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'Pix',
  TRANSFERENCIA: 'Transferência bancária',
  BOLETO: 'Boleto',
  CARTAO: 'Cartão',
  CHEQUE: 'Cheque',
  OUTRO: 'Outro',
}

export const ROTULO_CATEGORIA_DOCUMENTO = {
  ATA: 'Ata',
  CONVENCAO: 'Convenção',
  REGIMENTO: 'Regimento interno',
  CONTRATO: 'Contrato',
  ORCAMENTO: 'Orçamento',
  OUTRO: 'Outro',
} as const

export function rotuloEscopo(l: Lancamento, blocos: ReadonlyMap<string, { nome: string }>, unidades: ReadonlyMap<string, { numero: string }>): string {
  if (l.natureza === 'TRANSFERENCIA') {
    return `${blocos.get(l.blocoOrigemId ?? '')?.nome ?? '?'} → ${blocos.get(l.blocoId ?? '')?.nome ?? '?'}`
  }
  if (l.escopoTipo === 'GERAL') return `Condomínio (${l.rateio?.cotas.length ?? 0} blocos)`
  const bloco = blocos.get(l.blocoId ?? '')?.nome ?? '?'
  if (l.escopoTipo === 'UNIDADE') return `Bloco ${bloco} apto ${unidades.get(l.unidadeId ?? '')?.numero ?? '?'}`
  return `Bloco ${bloco}`
}

/** Valor com sinal para exibição: receita +, despesa −, transferência sem sinal. */
export { valorComSinal } from '../dominio/demonstrativo'

export function porId<T extends { id: string }>(lista: readonly T[]): Map<string, T> {
  return new Map(lista.map((x) => [x.id, x]))
}
