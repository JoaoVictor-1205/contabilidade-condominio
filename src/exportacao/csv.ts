// CSV para Excel brasileiro: UTF-8 com BOM, separador ';', vírgula decimal, datas dd/mm/aaaa.
import { formatarData, formatarMesCurto } from '../dominio/datas'
import { formatarValor } from '../dominio/dinheiro'
import { valorComSinal, type Demonstrativo } from '../dominio/demonstrativo'
import type { Centavos, Lancamento } from '../dominio/tipos'
import { baixarBlob, nomeSeguro } from './download'

export type CelulaCsv = string | number | null | undefined

function escapar(v: CelulaCsv): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function gerarCsv(linhas: ReadonlyArray<ReadonlyArray<CelulaCsv>>): string {
  return '\uFEFF' + linhas.map((l) => l.map(escapar).join(';')).join('\r\n') + '\r\n'
}

/** 123456 → '1234,56' (sem separador de milhar, para o Excel reconhecer como número). */
export function moedaCsv(c: Centavos): string {
  return formatarValor(c).replace(/\./g, '')
}

export function baixarCsv(nomeBase: string, linhas: ReadonlyArray<ReadonlyArray<CelulaCsv>>): void {
  baixarBlob(new Blob([gerarCsv(linhas)], { type: 'text/csv;charset=utf-8' }), `${nomeSeguro(nomeBase)}.csv`)
}

export interface LancamentoExportavel {
  lancamento: Lancamento
  escopo: string
  categoria: string
  /** Valor atribuído ao bloco (relatório filtrado); ausente = valor cheio com sinal. */
  valorAtribuidoCentavos?: Centavos
}

const ROTULO: Record<Lancamento['natureza'], string> = { RECEITA: 'Receita', DESPESA: 'Despesa', TRANSFERENCIA: 'Transferência' }

export function linhasLancamentos(itens: readonly LancamentoExportavel[]): CelulaCsv[][] {
  const cab = ['Data', 'Descrição', 'Categoria', 'Tipo', 'Escopo', 'Valor', 'Competência', 'Forma', 'Situação', 'Observações']
  const corpo = itens.map(({ lancamento: l, escopo, categoria, valorAtribuidoCentavos }) => {
    const valor = valorAtribuidoCentavos ?? valorComSinal(l)
    return [formatarData(l.data), l.descricao, categoria, `${ROTULO[l.natureza]}${l.tipo === 'ESTORNO' ? ' (Estorno)' : ''}`, escopo, moedaCsv(valor), formatarMesCurto(l.competencia), l.formaPagamento ?? '', l.status === 'ATIVO' ? 'Ativo' : 'Excluído', l.observacoes ?? '']
  })
  return [cab, ...corpo]
}

export function exportarLancamentosCsv(itens: readonly LancamentoExportavel[], nomeBase: string): void {
  baixarCsv(nomeBase, linhasLancamentos(itens))
}

export function linhasDemonstrativo(dem: Demonstrativo): CelulaCsv[][] {
  const estornos = !!(dem.total.estornosReceita || dem.total.estornosDespesa)
  const cab = ['Bloco', 'Aptos', 'Saldo anterior', 'Saldo inicial', 'Receitas próprias', 'Receitas rateadas', 'Despesas próprias', 'Despesas rateadas', 'Transferências', 'Saldo do período', 'Saldo final']
  if (estornos) cab.push('Estornos receita', 'Estornos despesa')
  const linha = (l: Demonstrativo['linhas'][number]) => [
    l.nome + (l.ativo ? '' : ' (inativo)'),
    l.unidades,
    moedaCsv(l.saldoAnterior),
    moedaCsv(l.saldoInicialNoPeriodo),
    moedaCsv(l.receitasProprias),
    moedaCsv(l.receitasRateadas),
    moedaCsv(l.despesasProprias),
    moedaCsv(l.despesasRateadas),
    moedaCsv(l.transferencias),
    moedaCsv(l.saldoPeriodo),
    moedaCsv(l.saldoFinal),
    ...(estornos ? [moedaCsv(l.estornosReceita), moedaCsv(l.estornosDespesa)] : []),
  ]
  return [cab, ...dem.linhas.map(linha), linha(dem.total), [], ['Conferência', '', moedaCsv(dem.conferenciaCentavos)]]
}

export function exportarDemonstrativoCsv(dem: Demonstrativo, nomeBase: string): void {
  baixarCsv(nomeBase, linhasDemonstrativo(dem))
}
