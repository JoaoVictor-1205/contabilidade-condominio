// Exportação .xlsx com SheetJS (só escrita). Dinheiro como número com formato BRL; datas como serial com formato dd/mm/yyyy.
import * as XLSX from 'xlsx'
import { valorComSinal, type Demonstrativo } from '../dominio/demonstrativo'
import { partesDe } from '../dominio/datas'
import type { Centavos, DataISO } from '../dominio/tipos'
import { linhasLancamentos, type LancamentoExportavel } from './csv'
import { baixarBlob, nomeSeguro } from './download'

export const FORMATO_BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00'

type Celula = XLSX.CellObject | string | number | null | undefined

export function moeda(c: Centavos): XLSX.CellObject {
  return { t: 'n', v: c / 100, z: FORMATO_BRL }
}

export function data(d: DataISO): XLSX.CellObject {
  const p = partesDe(d)
  return { t: 'd', v: new Date(Date.UTC(p.ano, p.mes - 1, p.dia)), z: 'dd/mm/yyyy' }
}

/** Monta uma planilha a partir de linhas de células (strings, números ou CellObject), com larguras opcionais. */
export function planilha(linhas: ReadonlyArray<ReadonlyArray<Celula>>, larguras?: readonly number[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  let maxCol = 0
  linhas.forEach((linha, r) => {
    linha.forEach((v, c) => {
      if (v === null || v === undefined || v === '') return
      maxCol = Math.max(maxCol, c)
      const ref = XLSX.utils.encode_cell({ r, c })
      ws[ref] = typeof v === 'object' ? v : typeof v === 'number' ? { t: 'n', v } : { t: 's', v }
    })
  })
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, linhas.length - 1), c: maxCol } })
  if (larguras) ws['!cols'] = larguras.map((wch) => ({ wch }))
  return ws
}

export function baixarPasta(abas: ReadonlyArray<{ nome: string; ws: XLSX.WorkSheet }>, nomeBase: string): void {
  const wb = XLSX.utils.book_new()
  for (const a of abas) XLSX.utils.book_append_sheet(wb, a.ws, a.nome.slice(0, 31))
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  baixarBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${nomeSeguro(nomeBase)}.xlsx`)
}

export function exportarLancamentosExcel(itens: readonly LancamentoExportavel[], nomeBase: string): void {
  baixarPasta([{ nome: 'Lançamentos', ws: planilhaLancamentos(itens) }], nomeBase)
}

export function exportarDemonstrativoExcel(
  dem: Demonstrativo,
  info: { nomeCondominio: string; tituloPeriodo: string; nomesBlocos: ReadonlyMap<string, string>; lancamentos: readonly LancamentoExportavel[] },
  nomeBase: string,
): void {
  const estornos = !!(dem.total.estornosReceita || dem.total.estornosDespesa)
  const cab = ['Bloco', 'Aptos', 'Saldo anterior', 'Saldo inicial', 'Receitas próprias', 'Receitas rateadas', 'Despesas próprias', 'Despesas rateadas', 'Transferências', 'Saldo do período', 'Saldo final']
  if (estornos) cab.push('Estornos receita', 'Estornos despesa')
  const linha = (l: Demonstrativo['linhas'][number]): Celula[] => [
    l.nome + (l.ativo ? '' : ' (inativo)'),
    l.unidades,
    moeda(l.saldoAnterior),
    moeda(l.saldoInicialNoPeriodo),
    moeda(l.receitasProprias),
    moeda(l.receitasRateadas),
    moeda(l.despesasProprias),
    moeda(l.despesasRateadas),
    moeda(l.transferencias),
    moeda(l.saldoPeriodo),
    moeda(l.saldoFinal),
    ...(estornos ? [moeda(l.estornosReceita), moeda(l.estornosDespesa)] : []),
  ]
  const demonstrativo: Celula[][] = [
    [info.nomeCondominio],
    [`Demonstrativo — ${info.tituloPeriodo} — base ${dem.base === 'data' ? 'caixa' : 'competência'}`],
    [],
    cab,
    ...dem.linhas.map(linha),
    linha(dem.total),
    [],
    ['Conferência', '', moeda(dem.conferenciaCentavos)],
  ]
  const categorias: Celula[][] = [['Categoria', 'Tipo', 'Valor'], ...dem.porCategoria.map((c) => [c.nome, c.natureza === 'RECEITA' ? 'Receita' : 'Despesa', moeda(c.valorCentavos)])]
  const rateio: Celula[][] = [['Data', 'Lançamento', 'Tipo', 'Bloco', 'Aptos', 'Cota']]
  for (const { lancamento: l } of dem.lancamentos) {
    if (!l.rateio) continue
    const estorno = l.tipo === 'ESTORNO'
    for (const c of l.rateio.cotas) rateio.push([data(l.data), l.descricao, estorno ? 'Estorno' : 'Normal', info.nomesBlocos.get(c.blocoId) ?? c.nomeBloco, c.unidadesAtivas, moeda(estorno ? -c.valorCentavos : c.valorCentavos)])
  }
  const abas = [
    { nome: 'Demonstrativo', ws: planilha(demonstrativo, [22, 8, 16, 16, 16, 16, 16, 16, 16, 16, 16]) },
    { nome: 'Por categoria', ws: planilha(categorias, [30, 10, 16]) },
    { nome: 'Lançamentos', ws: planilhaLancamentos(info.lancamentos) },
    { nome: 'Rateio', ws: planilha(rateio, [12, 40, 12, 12, 8, 14]) },
  ]
  if (dem.cobrancas) {
    const c = dem.cobrancas
    const cabC = ['Bloco', 'Geradas', 'Pagas', 'Em aberto', 'Vencidas', 'Cobrado', 'Recebido', 'Juros', 'Descontos', 'Em aberto (R$)']
    const linhasC: Celula[][] = [cabC]
    for (const [blocoId, r] of Object.entries(c.porBloco)) {
      linhasC.push([info.nomesBlocos.get(blocoId) ?? blocoId, r.geradas, r.pagas, r.abertas, r.vencidas, moeda(r.valorCobradoCentavos), moeda(r.valorRecebidoCentavos), moeda(r.valorJurosCentavos), moeda(r.valorDescontosCentavos), moeda(r.valorEmAbertoCentavos)])
    }
    linhasC.push(['Total', c.geradas, c.pagas, c.abertas, c.vencidas, moeda(c.valorCobradoCentavos), moeda(c.valorRecebidoCentavos), moeda(c.valorJurosCentavos), moeda(c.valorDescontosCentavos), moeda(c.valorEmAbertoCentavos)])
    abas.push({ nome: 'Cobranças', ws: planilha(linhasC, [12, 9, 9, 10, 9, 14, 14, 12, 12, 14]) })
  }
  baixarPasta(abas, nomeBase)
}

function planilhaLancamentos(itens: readonly LancamentoExportavel[]): XLSX.WorkSheet {
  const [cab, ...corpo] = linhasLancamentos(itens)
  const linhas: Celula[][] = [cab as string[]]
  itens.forEach(({ lancamento: l, valorAtribuidoCentavos }, i) => {
    const o = corpo[i] as string[]
    const valor = valorAtribuidoCentavos ?? valorComSinal(l)
    linhas.push([data(l.data), o[1], o[2], o[3], o[4], moeda(valor), o[6], o[7], o[8], o[9]])
  })
  return planilha(linhas, [12, 40, 22, 12, 28, 14, 12, 14, 10, 40])
}

export interface CobrancaExportavel {
  bloco: string
  apto: string
  responsavel: string
  competencia: string
  vencimento: DataISO
  cobradoCentavos: Centavos
  pagoCentavos: Centavos | null
  jurosCentavos: Centavos
  pagaEm: DataISO | null
  situacao: string
}

export function exportarCobrancasExcel(itens: readonly CobrancaExportavel[], nomeBase: string): void {
  const linhas: Celula[][] = [['Bloco', 'Apto', 'Responsável', 'Competência', 'Vencimento', 'Cobrado', 'Pago', 'Juros', 'Pago em', 'Situação']]
  for (const c of itens) {
    linhas.push([c.bloco, c.apto, c.responsavel, c.competencia, data(c.vencimento), moeda(c.cobradoCentavos), c.pagoCentavos === null ? '' : moeda(c.pagoCentavos), moeda(c.jurosCentavos), c.pagaEm ? data(c.pagaEm) : '', c.situacao])
  }
  baixarPasta([{ nome: 'Cobranças', ws: planilha(linhas, [8, 8, 28, 12, 12, 14, 14, 12, 12, 12]) }], nomeBase)
}

export interface InadimplenciaExportavel {
  bloco: string
  apto: string
  responsavel: string
  competencias: string
  quantidade: number
  totalCentavos: Centavos
}

export function exportarInadimplenciaExcel(itens: readonly InadimplenciaExportavel[], nomeBase: string): void {
  const linhas: Celula[][] = [['Bloco', 'Apto', 'Responsável', 'Competências em atraso', 'Qtde', 'Total devido'], ...itens.map((i) => [i.bloco, i.apto, i.responsavel, i.competencias, i.quantidade, moeda(i.totalCentavos)])]
  baixarPasta([{ nome: 'Inadimplência', ws: planilha(linhas, [8, 8, 28, 40, 6, 16]) }], nomeBase)
}
