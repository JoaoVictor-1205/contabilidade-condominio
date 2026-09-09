import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportarDemonstrativoCsv, exportarLancamentosCsv, gerarCsv, linhasDemonstrativo, linhasLancamentos, moedaCsv, type LancamentoExportavel } from './csv'
import { data, exportarCobrancasExcel, exportarDemonstrativoExcel, exportarInadimplenciaExcel, exportarLancamentosExcel, FORMATO_BRL, moeda, planilha } from './excel'
import type { Lancamento } from '../dominio/tipos'
import { calcularDemonstrativo } from '../dominio/demonstrativo'
import { gerarSeed } from '../dominio/seedPadrao'
import { baixarBlob } from './download'

vi.mock('./download', async (importar) => ({ ...await importar<typeof import('./download')>(), baixarBlob: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

async function lerDownload() {
  const [blob, nome] = vi.mocked(baixarBlob).mock.calls.at(-1)!
  expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  return { nome, pasta: XLSX.read(await blob.arrayBuffer(), { type: 'array', cellDates: false, cellNF: true }) }
}

const lanc: Lancamento = {
  id: 'l1',
  natureza: 'DESPESA',
  tipo: 'NORMAL',
  status: 'ATIVO',
  escopoTipo: 'GERAL',
  blocoId: null,
  unidadeId: null,
  blocoOrigemId: null,
  data: '2026-09-10',
  mes: '2026-09',
  competencia: '2026-09',
  categoriaId: 'c1',
  descricao: 'Água; "hall"',
  valorCentavos: 123456,
  formaPagamento: 'PIX',
  rateio: null,
  cobrancaId: null,
  estornaLancamentoId: null,
  estornadoPorId: null,
  versao: 1,
  criadoEm: '2026-09-10T10:00:00',
  atualizadoEm: '2026-09-10T10:00:00',
}

function demonstrativoComEstornos() {
  const seed = gerarSeed({ inicioContabil: '2026-09', agora: '2026-09-01T00:00:00' })
  const blocos = seed.blocos.slice(0, 2)
  const receita = seed.categorias.find(c => c.natureza === 'RECEITA')!
  const despesa = seed.categorias.find(c => c.natureza === 'DESPESA')!
  const gasto: Lancamento = { ...lanc, categoriaId: despesa.id, valorCentavos: 30000, estornadoPorId: 'ed', rateio: {
    criterio: 'POR_UNIDADE', totalUnidades: 3, calculadoEm: '2026-09-10T10:00:00', cotas: [
      { blocoId: blocos[0]!.id, nomeBloco: blocos[0]!.nome, unidadesAtivas: 1, valorCentavos: 10000 },
      { blocoId: blocos[1]!.id, nomeBloco: blocos[1]!.nome, unidadesAtivas: 2, valorCentavos: 20000 },
    ],
  } }
  const entrada: Lancamento = { ...lanc, id: 'r1', natureza: 'RECEITA', categoriaId: receita.id, escopoTipo: 'BLOCO', blocoId: blocos[0]!.id, valorCentavos: 10000, estornadoPorId: 'er' }
  const lancamentos: Lancamento[] = [gasto, entrada,
    { ...gasto, id: 'ed', tipo: 'ESTORNO', estornaLancamentoId: gasto.id, estornadoPorId: null },
    { ...entrada, id: 'er', tipo: 'ESTORNO', estornaLancamentoId: entrada.id, estornadoPorId: null },
    { ...entrada, id: 'r2', blocoId: blocos[1]!.id, valorCentavos: 25000, estornadoPorId: null },
  ]
  const dem = calcularDemonstrativo({ periodo: { inicio: '2026-09-01', fim: '2026-09-30' }, blocos, categorias: seed.categorias, lancamentos, cobrancas: [], hoje: '2026-10-01', agora: '2026-10-01T10:00:00' })
  const itens: LancamentoExportavel[] = dem.lancamentos.map(l => ({ ...l, categoria: seed.categorias.find(c => c.id === l.lancamento.categoriaId)!.nome, escopo: 'Condomínio' }))
  return { dem, itens, nomesBlocos: new Map(blocos.map(b => [b.id, b.nome])) }
}

describe('CSV', () => {
  it('usa BOM, ponto e vírgula, vírgula decimal e escapa aspas', () => {
    const csv = gerarCsv(linhasLancamentos([{ lancamento: lanc, escopo: 'Condomínio', categoria: 'Água' }]))
    expect(csv.startsWith('﻿')).toBe(true)
    const linhas = csv.trim().split('\r\n')
    expect(linhas[0]).toBe('Data;Descrição;Categoria;Tipo;Escopo;Valor;Competência;Forma;Situação;Observações')
    expect(linhas[1]).toBe('10/09/2026;"Água; ""hall""";Água;Despesa;Condomínio;-1234,56;09/2026;PIX;Ativo;')
    expect(moedaCsv(-5)).toBe('-0,05')
  })

  it('informa estornos com sinal invertido e respeita o valor atribuído ao bloco', () => {
    const estorno: Lancamento = { ...lanc, tipo: 'ESTORNO', estornaLancamentoId: 'original' }
    const linhas = linhasLancamentos([
      { lancamento: estorno, escopo: 'Condomínio', categoria: 'Água' },
      { lancamento: { ...estorno, natureza: 'RECEITA' }, escopo: 'Condomínio', categoria: 'Outras receitas' },
      { lancamento: { ...estorno, natureza: 'TRANSFERENCIA' }, escopo: 'Bloco A', categoria: 'Transferência', valorAtribuidoCentavos: 0 },
    ])
    expect(linhas[1]?.[3]).toBe('Despesa (Estorno)')
    expect(linhas[1]?.[5]).toBe('1234,56')
    expect(linhas[2]?.[5]).toBe('-1234,56')
    expect(linhas[3]?.[5]).toBe('0,00')
  })

  it('exporta receitas/despesas líquidas e colunas informativas dos estornos', () => {
    const { dem } = demonstrativoComEstornos()
    const linhas = linhasDemonstrativo(dem)
    expect(linhas[0]?.slice(-2)).toEqual(['Estornos receita', 'Estornos despesa'])
    expect(linhas[3]?.slice(8)).toEqual(['0,00', '250,00', '250,00', '100,00', '300,00'])
    expect(linhas.at(-1)).toEqual(['Conferência', '', '0,00'])
    const semEstorno = { ...dem, total: { ...dem.total, estornosReceita: 0, estornosDespesa: 0 } }
    expect(linhasDemonstrativo(semEstorno)[0]).toHaveLength(11)
  })

  it('gera downloads CSV com BOM em bytes, nomes seguros e valores de estorno', async () => {
    const { dem, itens } = demonstrativoComEstornos()
    exportarLancamentosCsv(itens, 'Lançamentos: setembro')
    const [lancamentos, nome] = vi.mocked(baixarBlob).mock.calls.at(-1)!
    expect(nome).toBe('Lançamentos- setembro.csv')
    expect(lancamentos.type).toBe('text/csv;charset=utf-8')
    expect(Array.from(new Uint8Array(await lancamentos.arrayBuffer()).slice(0, 3))).toEqual([239, 187, 191])
    expect(await lancamentos.text()).toContain('Despesa (Estorno);Condomínio;300,00;')
    exportarDemonstrativoCsv(dem, 'Demonstrativo')
    const [demonstrativo, nomeDem] = vi.mocked(baixarBlob).mock.calls.at(-1)!
    expect(nomeDem).toBe('Demonstrativo.csv')
    expect(await demonstrativo.text()).toContain('Estornos receita;Estornos despesa\r\n')
    expect(await demonstrativo.text()).toContain('Conferência;;0,00\r\n')
  })
})

describe('Excel', () => {
  it('grava dinheiro como número com formato BRL e datas no dia correto', () => {
    const ws = planilha([['Descrição', 'Data', 'Valor'], ['Água', data('2026-02-28'), moeda(123456)], ['Total', '', moeda(-100)]], [30, 12, 14])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Teste')
    const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
    const lido = XLSX.read(bytes, { type: 'array', cellDates: true, cellNF: true })
    const s = lido.Sheets['Teste']!
    expect(s['C2']?.v).toBe(1234.56)
    expect(s['C2']?.z).toBe(FORMATO_BRL)
    expect(s['C3']?.v).toBe(-1)
    const d = s['B2']?.v as Date
    expect(d instanceof Date).toBe(true)
    expect(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`).toBe('2026-2-28')
    const serial = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: true }).Sheets['Teste']!['B2']!
    expect(Number.isInteger(serial.v)).toBe(true)
    expect(serial.w).toBe('28/02/2026')
    expect(s['!ref']).toBe('A1:C3')
  })

  it('gera o arquivo de lançamentos com datas inteiras, estornos e valores do filtro', async () => {
    exportarLancamentosExcel([
      { lancamento: lanc, escopo: 'Condomínio', categoria: 'Água' },
      { lancamento: { ...lanc, tipo: 'ESTORNO', estornaLancamentoId: 'original' }, escopo: 'Condomínio', categoria: 'Água' },
      { lancamento: { ...lanc, natureza: 'TRANSFERENCIA' }, escopo: 'Bloco A', categoria: 'Transferência', valorAtribuidoCentavos: -5000 },
    ], 'Lançamentos: setembro')
    const { nome, pasta } = await lerDownload()
    expect(nome).toBe('Lançamentos- setembro.xlsx')
    expect(pasta.SheetNames).toEqual(['Lançamentos'])
    const ws = pasta.Sheets['Lançamentos']!
    expect(ws.F2).toMatchObject({ t: 'n', v: -1234.56, z: FORMATO_BRL })
    expect(ws.F3?.v).toBe(1234.56)
    expect(ws.F4?.v).toBe(-50)
    expect(ws.D3?.v).toBe('Despesa (Estorno)')
    expect(ws.A2?.w).toBe('10/09/2026')
    expect(Number.isInteger(ws.A2?.v)).toBe(true)
  })

  it('gera as abas do demonstrativo, totais numéricos e colunas de estornos', async () => {
    const { dem, itens, nomesBlocos } = demonstrativoComEstornos()
    exportarDemonstrativoExcel(dem, { nomeCondominio: 'Condomínio', tituloPeriodo: 'Setembro/2026', nomesBlocos, lancamentos: itens }, 'Demonstrativo')
    const { pasta } = await lerDownload()
    expect(pasta.SheetNames).toEqual(['Demonstrativo', 'Por categoria', 'Lançamentos', 'Rateio', 'Cobranças'])
    const ws = pasta.Sheets.Demonstrativo!
    expect(ws.L4?.v).toBe('Estornos receita')
    expect(ws.M4?.v).toBe('Estornos despesa')
    expect(ws.K7).toMatchObject({ t: 'n', v: 250, z: FORMATO_BRL })
    expect(ws.K7?.v).toBe(Number(ws.K5?.v) + Number(ws.K6?.v))
    expect(ws.L7?.v).toBe(100)
    expect(ws.M7?.v).toBe(300)
    expect(ws.C9?.v).toBe(0)
    expect(pasta.Sheets['Por categoria']?.C2?.v).toBe(250)
    expect(pasta.Sheets['Por categoria']?.C3?.v).toBe(0)
    expect(pasta.Sheets['Lançamentos']?.['!ref']).toBe('A1:J6')
    const rateio = pasta.Sheets.Rateio!
    expect(rateio.C1?.v).toBe('Tipo')
    const cotas = XLSX.utils.sheet_to_json<Array<string | number>>(rateio, { header: 1 }).slice(1)
    expect(cotas).toHaveLength(4)
    expect(cotas.map(c => [c[2], c[5]])).toEqual(expect.arrayContaining([['Normal', 100], ['Normal', 200], ['Estorno', -100], ['Estorno', -200]]))
    expect(cotas.reduce((soma, c) => soma + Number(c[5]), 0)).toBe(0)
    expect(pasta.Sheets.Cobranças?.A2?.v).toBe('Total')
    expect(pasta.Sheets.Cobranças?.F2).toMatchObject({ t: 'n', v: 0, z: FORMATO_BRL })
  })

  it('gera cobranças e inadimplência com valores numéricos e pagamentos ausentes em branco', async () => {
    exportarCobrancasExcel([
      { bloco: '1A', apto: '101', responsavel: 'Maria', competencia: '09/2026', vencimento: '2026-09-10', cobradoCentavos: 45000, pagoCentavos: 42000, jurosCentavos: 1000, pagaEm: '2026-09-11', situacao: 'Paga' },
      { bloco: '1A', apto: '102', responsavel: 'João', competencia: '09/2026', vencimento: '2026-09-10', cobradoCentavos: 45000, pagoCentavos: null, jurosCentavos: 0, pagaEm: null, situacao: 'Vencida' },
    ], 'Cobranças')
    const ws = (await lerDownload()).pasta.Sheets.Cobranças!
    expect(ws.E2?.w).toBe('10/09/2026')
    expect(Number.isInteger(ws.E2?.v)).toBe(true)
    expect(ws.F2).toMatchObject({ t: 'n', v: 450, z: FORMATO_BRL })
    expect(ws.G2?.v).toBe(420)
    expect(ws.H2?.v).toBe(10)
    expect(ws.I2?.w).toBe('11/09/2026')
    expect(ws.G3).toBeUndefined()
    expect(ws.I3).toBeUndefined()
    exportarInadimplenciaExcel([{ bloco: '1A', apto: '102', responsavel: 'João', competencias: '08/2026, 09/2026', quantidade: 2, totalCentavos: 90000 }], 'Inadimplência')
    const atrasos = (await lerDownload()).pasta
    expect(atrasos.SheetNames).toEqual(['Inadimplência'])
    expect(atrasos.Sheets.Inadimplência?.E2?.v).toBe(2)
    expect(atrasos.Sheets.Inadimplência?.F2).toMatchObject({ t: 'n', v: 900, z: FORMATO_BRL })
  })
})
