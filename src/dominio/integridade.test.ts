import { describe, expect, it } from 'vitest'
import { verificarIntegridade, type SnapshotIntegridade } from './integridade'
import { gerarSeed } from './seedPadrao'
import { montarRateioGeral } from './rateio'
import type { Cobranca, Lancamento } from './tipos'
import { calcularDemonstrativo } from './demonstrativo'
import { periodoDoMes } from './datas'

function snapshot(): SnapshotIntegridade {
  let n = 0
  return { ...gerarSeed({ inicioContabil: '2026-09', agora: '2026-09-01T00:00:00', gerarId: () => `id-${++n}` }), lancamentos: [], cobrancas: [], anexos: [], idsAnexosBlob: [], fechamentos: [], hoje: '2026-11-04' }
}
function lancamento(s: SnapshotIntegridade, patch: Partial<Lancamento> = {}): Lancamento {
  return { id: 'l', tipo: 'NORMAL', natureza: 'DESPESA', status: 'ATIVO', escopoTipo: 'GERAL', blocoId: null, unidadeId: null, blocoOrigemId: null, data: '2026-09-10', mes: '2026-09', competencia: '2026-09', categoriaId: s.categorias.find(c => c.natureza === 'DESPESA')!.id, descricao: 'Água', valorCentavos: 1000, formaPagamento: 'PIX', rateio: montarRateioGeral(1000, s.blocos, s.unidades, '2026-09-10T10:00:00'), cobrancaId: null, estornaLancamentoId: null, estornadoPorId: null, versao: 1, criadoEm: '2026-09-10T10:00:00', atualizadoEm: '2026-09-10T10:00:00', ...patch }
}
function pagamento(s: SnapshotIntegridade) {
  const u = s.unidades[0]!
  const l = lancamento(s, { natureza: 'RECEITA', escopoTipo: 'UNIDADE', blocoId: u.blocoId, unidadeId: u.id, rateio: null, cobrancaId: 'c', categoriaId: s.categorias.find(c => c.sistema === 'TAXA')!.id })
  const c: Cobranca = { id: 'c', unidadeId: u.id, blocoId: u.blocoId, competencia: '2026-09', valorCentavos: 1000, vencimento: '2026-09-10', status: 'PAGA', taxaVigenciaId: s.taxas[0]!.id, origemValor: 'TAXA', lancamentoId: l.id, pagaEm: l.data, valorPagoCentavos: 1000, jurosCentavos: 0, criadoEm: l.criadoEm, atualizadoEm: l.criadoEm }
  s.lancamentos = [l]; s.cobrancas = [c]
  return { l, c }
}

describe('verificação pura de integridade', () => {
  it('aceita seed, rateio e pagamento válidos sem modificar o snapshot', () => {
    const s = snapshot()
    expect(verificarIntegridade(s)).toEqual([])
    s.lancamentos = [lancamento(s)]
    expect(verificarIntegridade(s)).toEqual([])
    pagamento(s)
    const antes = structuredClone(s)
    expect(verificarIntegridade(s)).toEqual([])
    expect(s).toEqual(antes)
  })
  it.each<[string, Partial<Lancamento>]>([
    ['RATEIO_DIVERGENTE', { rateio: null }],
    ['RATEIO_DIVERGENTE', { valorCentavos: 1001 }],
    ['BLOCO_AUSENTE', { escopoTipo: 'BLOCO', blocoId: 'ausente', rateio: null }],
    ['UNIDADE_BLOCO', { escopoTipo: 'UNIDADE', unidadeId: 'ausente', blocoId: 'id-1', rateio: null }],
    ['TRANSFERENCIA_INVALIDA', { natureza: 'TRANSFERENCIA', escopoTipo: 'BLOCO', blocoId: 'id-1', blocoOrigemId: 'id-1' }],
    ['ANTES_INICIO_CONTABIL', { data: '2026-08-31', mes: '2026-08' }],
    ['MES_DIVERGENTE', { mes: '2026-08' }],
    ['CATEGORIA_INVALIDA', { categoriaId: 'ausente' }],
    ['ESTORNO_VINCULO', { tipo: 'ESTORNO', estornaLancamentoId: 'ausente' }],
    ['ORIGINAL_VINCULO', { estornaLancamentoId: 'outro' }],
    ['ORIGINAL_ESTORNO', { estornadoPorId: 'ausente' }],
  ])('aponta %s', (codigo, patch) => {
    const s = snapshot(); s.lancamentos = [lancamento(s, patch)]
    expect(verificarIntegridade(s)).toContainEqual(expect.objectContaining({ nivel: 'ERRO', codigo, entidadeId: 'l' }))
  })
  it('confere existência dos blocos de rateio e a data de cada saldo inicial', () => {
    const s = snapshot(); const l = lancamento(s); s.lancamentos = [l]
    l.rateio!.cotas[0]!.blocoId = 'ausente'
    expect(verificarIntegridade(s).map(p => p.codigo)).toContain('RATEIO_BLOCOS')
    s.blocos[1]!.dataSaldoInicial = '2026-09-11'
    expect(verificarIntegridade(s).map(p => p.codigo)).toContain('ANTES_SALDO_INICIAL')
  })
  it('confere vínculos de pagamentos nos dois sentidos e valores de juros', () => {
    const s = snapshot(); const { c, l } = pagamento(s)
    c.valorPagoCentavos = 999
    expect(verificarIntegridade(s).map(p => p.codigo)).toEqual(expect.arrayContaining(['COBRANCA_PAGA', 'TAXA_DIVERGENTE']))
    c.valorPagoCentavos = 1000; c.status = 'ABERTA'
    expect(verificarIntegridade(s).map(p => p.codigo)).toContain('PAGAMENTO_COBRANCA')
    c.status = 'PAGA'; c.jurosCentavos = 100
    expect(verificarIntegridade(s).map(p => p.codigo)).toContain('JUROS_DIVERGENTES')
    const j = { ...l, id: 'j', categoriaId: s.categorias.find(c => c.sistema === 'JUROS')!.id, valorCentavos: 100 }
    s.lancamentos = [l, j]
    expect(verificarIntegridade(s)).toEqual([])
    l.cobrancaId = null
    expect(verificarIntegridade(s)).toContainEqual(expect.objectContaining({ codigo: 'PAGAMENTO_SEM_COBRANCA', nivel: 'AVISO' }))
  })
  it('confere reciprocidade, conteúdo, datas e duplicidade de estornos ativos', () => {
    const s = snapshot(); const l = lancamento(s, { estornadoPorId: 'e' })
    const e = { ...l, id: 'e', tipo: 'ESTORNO' as const, data: '2026-10-01', mes: '2026-10', estornaLancamentoId: 'l', estornadoPorId: null }
    s.lancamentos = [l, e]
    expect(verificarIntegridade(s)).toEqual([])
    e.data = '2026-09-09'; e.mes = '2026-09'; e.valorCentavos++
    expect(verificarIntegridade(s).map(p => p.codigo)).toEqual(expect.arrayContaining(['ESTORNO_DATA', 'ESTORNO_CONTEUDO']))
    s.lancamentos = [l, e, { ...e, id: 'e2' }]
    expect(verificarIntegridade(s).map(p => p.codigo)).toContain('ESTORNO_DUPLICADO')
    e.status = 'EXCLUIDO'
    expect(verificarIntegridade(s).map(p => p.codigo)).toContain('ORIGINAL_ESTORNO')
  })
  it('confere saldos e quantidade gravados, sequência e atualização posterior ao fechamento', () => {
    const s = snapshot(); const l = lancamento(s); s.lancamentos = [l]
    const dem = calcularDemonstrativo({ ...s, periodo: periodoDoMes('2026-09'), agora: '2026-10-01T10:00:00' })
    s.fechamentos = [{ mes: '2026-09', base: 'data', fechadoEm: '2026-10-01T10:00:00', saldoGeralCentavos: dem.total.saldoFinal, saldos: dem.linhas.map(l => ({ blocoId: l.blocoId, saldoFinalCentavos: l.saldoFinal })), qtdLancamentos: 1 }]
    expect(verificarIntegridade(s)).toEqual([])
    l.atualizadoEm = '2026-10-02T00:00:00'
    expect(verificarIntegridade(s)).toContainEqual(expect.objectContaining({ codigo: 'ALTERADO_APOS_FECHAMENTO', nivel: 'AVISO' }))
    s.fechamentos[0]!.saldos[0]!.saldoFinalCentavos++
    expect(verificarIntegridade(s).map(p => p.codigo)).toContain('FECHAMENTO_DIVERGENTE')
    s.fechamentos[0]!.mes = '2026-10'
    expect(verificarIntegridade(s).map(p => p.codigo)).toContain('FECHAMENTO_SEQUENCIA')
  })
  it('aponta duplicidades, categoria ausente e arquivo ausente ou órfão', () => {
    const s = snapshot()
    s.unidades = [...s.unidades, { ...s.unidades[0]!, id: 'u-duplicada' }]
    s.taxas = [...s.taxas, { ...s.taxas[0]!, id: 't-duplicada' }]
    s.categorias = s.categorias.filter(c => c.sistema !== 'TAXA')
    s.anexos = [{ id: 'a', donoTipo: 'DOCUMENTO', donoId: 'd', nome: 'ata.pdf', mime: 'application/pdf', tamanho: 3, criadoEm: '2026-09-01T00:00:00' }]
    s.idsAnexosBlob = ['orfao']
    expect(verificarIntegridade(s).map(p => p.codigo)).toEqual(expect.arrayContaining(['UNIDADE_DUPLICADA', 'TAXA_DUPLICADA', 'CATEGORIA_SISTEMA', 'ANEXO_SEM_BLOB', 'BLOB_ORFAO']))
  })
})
