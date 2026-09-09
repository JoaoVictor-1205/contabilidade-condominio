import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Auditoria } from '../../dominio/tipos'
import { criarBancoTeste, type BancoTeste } from '../../testes/dbTeste'

describe('manutenção dos rateios', () => {
  let t: BancoTeste
  const periodo = { inicio: '2026-09-01', fim: '2026-10-31' }
  beforeEach(async () => {
    t = criarBancoTeste('2026-11-04T10:00:00')
    await t.servicos.estrutura.definirInicioContabil('2026-09')
  })
  afterEach(async () => { await t.fechar() })
  async function lancar(data = '2026-10-10') {
    return t.servicos.lancamentos.registrar({ natureza: 'DESPESA', escopoTipo: 'GERAL', categoriaId: await t.categoriaId('Água e esgoto'), descricao: 'Água', valorCentavos: 10001, data })
  }

  it('prévia seleciona apenas gerais normais ativos, sem estorno e em meses abertos, sem gravar', async () => {
    await lancar('2026-09-10')
    const estornado = await lancar()
    await t.servicos.lancamentos.estornar(estornado.id, '2026-10-20', 'Duplicado')
    const excluido = await lancar()
    await t.servicos.lancamentos.excluir(excluido.id, 'Duplicado')
    const proprio = await lancar()
    await t.servicos.lancamentos.atualizar(proprio.id, { escopoTipo: 'BLOCO', blocoId: (await t.bloco('1A')).id })
    const aberto = await lancar()
    await lancar('2026-11-01')
    await t.servicos.fechamento.fechar('2026-09')
    const auditoriaAntes = await t.db.auditoria.count()
    const previa = await t.servicos.manutencao.previaRateios(periodo)
    expect(previa.itens.map(i => i.lancamento.id)).toEqual([aberto.id])
    expect(await t.db.auditoria.count()).toBe(auditoriaAntes)
    expect((await t.db.lancamentos.get(aberto.id))?.versao).toBe(1)
  })

  it('recusa prévia obsoleta após mudar a estrutura ou o lançamento e aplica uma prévia atual', async () => {
    const l = await lancar()
    const previa = await t.servicos.manutencao.previaRateios(periodo)
    await t.servicos.estrutura.criarBloco({ nome: '8A', quartos: 2, andares: 1, aptosPorAndar: 4, dataSaldoInicial: '2026-09-01' })
    await expect(t.servicos.manutencao.recalcularRateios(previa)).rejects.toThrow('Os dados mudaram desde a prévia')
    const segunda = await t.servicos.manutencao.previaRateios(periodo)
    await t.servicos.lancamentos.atualizar(l.id, { valorCentavos: 12001 })
    await expect(t.servicos.manutencao.recalcularRateios(segunda)).rejects.toThrow('Os dados mudaram desde a prévia')
    const atual = await t.servicos.manutencao.previaRateios(periodo)
    expect(await t.servicos.manutencao.recalcularRateios(atual)).toBe(1)
    expect((await t.db.lancamentos.get(l.id))?.rateio?.cotas).toEqual(atual.itens[0]!.novoRateio.cotas)
    expect((await t.db.lancamentos.get(l.id))?.rateio?.cotas).toHaveLength(15)
    await expect(t.servicos.manutencao.recalcularRateios(atual)).rejects.toThrow('Os dados mudaram desde a prévia')
  })

  it('reverte todo o lote quando falha depois de recalcular o primeiro lançamento', async () => {
    await lancar('2026-10-10')
    await lancar('2026-10-11')
    await t.servicos.estrutura.criarBloco({ nome: '8A', quartos: 2, andares: 1, aptosPorAndar: 4, dataSaldoInicial: '2026-09-01' })
    const previa = await t.servicos.manutencao.previaRateios(periodo)
    const lancamentosAntes = await t.db.lancamentos.toArray()
    const auditoriaAntes = await t.db.auditoria.toArray()
    const metaAntes = await t.db.meta.get('alteracoesDesdeBackup')
    const falhar = (_chave: unknown, a: Auditoria) => { if (a.acao === 'rateio_recalculado' && a.entidadeId === previa.itens[1]!.lancamento.id) throw new Error('Falha no segundo recálculo') }
    t.db.auditoria.hook('creating', falhar)
    try {
      await expect(t.servicos.manutencao.recalcularRateios(previa)).rejects.toThrow('Falha no segundo recálculo')
    } finally {
      t.db.auditoria.hook('creating').unsubscribe(falhar)
    }
    expect(await t.db.lancamentos.toArray()).toEqual(lancamentosAntes)
    expect(await t.db.auditoria.toArray()).toEqual(auditoriaAntes)
    expect(await t.db.meta.get('alteracoesDesdeBackup')).toEqual(metaAntes)
    expect(await t.servicos.manutencao.recalcularRateios(previa)).toBe(2)
  })

  it('recusa períodos inválidos e aceita lote vazio', async () => {
    await expect(t.servicos.manutencao.previaRateios({ inicio: '2026-02-30', fim: '2026-03-31' })).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    await expect(t.servicos.manutencao.previaRateios({ inicio: '2026-10-31', fim: '2026-10-01' })).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    const previa = await t.servicos.manutencao.previaRateios(periodo)
    expect(previa.itens).toEqual([])
    expect(await t.servicos.manutencao.recalcularRateios(previa)).toBe(0)
  })
})
