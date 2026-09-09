import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calcularDemonstrativo } from '../../dominio/demonstrativo'
import { periodoDoMes } from '../../dominio/datas'
import { criarBancoTeste, type BancoTeste } from '../../testes/dbTeste'
import type { Auditoria } from '../../dominio/tipos'

describe('fechamento e ciclo contábil de estornos', () => {
  let t: BancoTeste
  beforeEach(async () => {
    t = criarBancoTeste('2026-11-04T10:00:00')
    await t.servicos.estrutura.definirInicioContabil('2026-09')
  })
  afterEach(async () => { await t.fechar() })
  async function lancar(data = '2026-09-10') {
    return t.servicos.lancamentos.registrar({ natureza: 'DESPESA', escopoTipo: 'GERAL', categoriaId: await t.categoriaId('Água e esgoto'), descricao: 'Água', valorCentavos: 10001, data })
  }
  async function pagar() {
    await t.servicos.estrutura.definirTaxa({ quartos: 3, valorCentavos: 45000, vigenteDesde: '2026-09' })
    await t.servicos.cobrancas.gerar('2026-09')
    const c = (await t.consultas.cobrancas.daUnidade((await t.unidade('1A', '101')).id))[0]!
    return t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-10', formaPagamento: 'DINHEIRO', jurosCentavos: 2000 })
  }
  it('fecha sequencialmente, grava todos os saldos e não fecha o mês corrente', async () => {
    await lancar()
    await expect(t.servicos.fechamento.fechar('2026-10')).rejects.toMatchObject({ codigo: 'REGRA' })
    const f = await t.servicos.fechamento.fechar('2026-09')
    expect(f.saldos).toHaveLength(14)
    expect(f.saldoGeralCentavos).toBe(-10001)
    expect(f.qtdLancamentos).toBe(1)
    expect(f.saldos.reduce((n, s) => n + s.saldoFinalCentavos, 0)).toBe(-10001)
    await t.servicos.fechamento.fechar('2026-10')
    expect(await t.servicos.fechamento.proximoAFechar()).toBeNull()
    await expect(t.servicos.fechamento.fechar('2026-11')).rejects.toMatchObject({ codigo: 'REGRA' })
    await expect(t.servicos.fechamento.reabrir('2026-09', 'Revisão')).rejects.toMatchObject({ codigo: 'REGRA' })
    await expect(t.servicos.fechamento.reabrir('2026-10', '')).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    await t.servicos.fechamento.reabrir('2026-10', 'Conferência')
    expect(await t.servicos.fechamento.proximoAFechar()).toBe('2026-10')
  })
  it('bloqueia todas as mutações retroativas e aceita competência fechada com data aberta', async () => {
    const l = await lancar()
    const aberto = await lancar('2026-10-01')
    await t.servicos.fechamento.fechar('2026-09')
    const b = await t.bloco('1A')
    for (const operacao of [
      () => lancar(), () => t.servicos.lancamentos.atualizar(l.id, { data: '2026-10-01' }),
      () => t.servicos.lancamentos.atualizar(aberto.id, { data: '2026-09-20' }),
      () => t.servicos.lancamentos.excluir(l.id, 'Erro'), () => t.servicos.lancamentos.recalcularRateio(l.id),
      () => t.servicos.estrutura.definirSaldoInicial(b.id, 1, '2026-10-01'),
      () => t.servicos.estrutura.definirInicioContabil('2026-08'),
      () => t.servicos.estrutura.criarBloco({ nome: 'Novo', quartos: 2, andares: 1, aptosPorAndar: 1, dataSaldoInicial: '2026-09-01' }),
      () => t.servicos.lancamentos.registrarTransferencia({ data: '2026-09-12', blocoOrigemId: b.id, blocoDestinoId: aberto.rateio!.cotas[1]!.blocoId, valorCentavos: 100, descricao: 'Transferência' }),
    ]) await expect(operacao()).rejects.toMatchObject({ codigo: 'MES_FECHADO' })
    const novo = await t.servicos.lancamentos.atualizar(aberto.id, { competencia: '2026-09' })
    expect(novo.competencia).toBe('2026-09')
    const [anexo] = await t.servicos.anexos.adicionar('LANCAMENTO', l.id, [{ nome: 'agua.pdf', mime: 'application/pdf', blob: new Blob(['pdf']) }])
    await expect(t.servicos.anexos.remover(anexo!.id)).rejects.toMatchObject({ codigo: 'MES_FECHADO' })
  })
  it.each(['fechar', 'reabrir'] as const)('%s mantém fechamento e trilha anteriores se a auditoria falhar', async acao => {
    await lancar()
    if (acao === 'reabrir') await t.servicos.fechamento.fechar('2026-09')
    const antes = {
      fechamentos: await t.db.fechamentos.toArray(),
      lancamentos: await t.db.lancamentos.toArray(),
      auditoria: await t.db.auditoria.toArray(),
      contador: await t.db.meta.get('alteracoesDesdeBackup'),
    }
    const falhar = () => { throw new Error('Falha no registro do fechamento') }
    t.db.auditoria.hook('creating', falhar)
    try {
      const operacao = acao === 'fechar'
        ? t.servicos.fechamento.fechar('2026-09')
        : t.servicos.fechamento.reabrir('2026-09', 'Conferência')
      await expect(operacao).rejects.toThrow('Falha no registro do fechamento')
    } finally {
      t.db.auditoria.hook('creating').unsubscribe(falhar)
    }
    expect(await t.db.fechamentos.toArray()).toEqual(antes.fechamentos)
    expect(await t.db.lancamentos.toArray()).toEqual(antes.lancamentos)
    expect(await t.db.auditoria.toArray()).toEqual(antes.auditoria)
    expect(await t.db.meta.get('alteracoesDesdeBackup')).toEqual(antes.contador)
  })
  it('estorno conserva competência, snapshot e fechamento; exclusão limpa o vínculo e permite novo estorno', async () => {
    const l = await lancar()
    const f = await t.servicos.fechamento.fechar('2026-09')
    const estorno = (await t.servicos.lancamentos.estornar(l.id, '2026-10-02', 'Duplicado'))!
    expect(estorno).toMatchObject({ tipo: 'ESTORNO', estornaLancamentoId: l.id, competencia: l.competencia, rateio: l.rateio })
    expect((await t.consultas.lancamentos.obter(l.id))?.estornadoPorId).toBe(estorno.id)
    const periodo = periodoDoMes('2026-09')
    const insumos = await t.consultas.relatorios.insumosDemonstrativo(periodo, 'competencia')
    const dem = calcularDemonstrativo({ ...insumos, periodo, base: 'competencia', hoje: t.relogio.hoje(), agora: t.relogio.agora() })
    expect(dem.total.despesas).toBe(0)
    expect(dem.total.estornosDespesa).toBe(10001)
    expect(await t.consultas.fechamentos.ultimo()).toEqual(f)
    expect((await t.servicos.sistema.verificarIntegridade()).filter(p => p.nivel === 'ERRO')).toEqual([])
    await expect(t.servicos.lancamentos.estornar(l.id, '2026-10-03', 'Outra vez')).rejects.toMatchObject({ codigo: 'REGRA' })
    await expect(t.servicos.lancamentos.estornar(estorno.id, '2026-10-03', 'Outro')).rejects.toMatchObject({ codigo: 'REGRA' })
    await expect(t.servicos.lancamentos.atualizar(estorno.id, { valorCentavos: 2 })).rejects.toMatchObject({ codigo: 'REGRA' })
    await t.servicos.lancamentos.atualizar(estorno.id, { observacoes: 'Conferido' })
    await t.servicos.lancamentos.excluir(estorno.id, 'Estorno indevido')
    expect((await t.consultas.lancamentos.obter(l.id))?.estornadoPorId).toBeNull()
    await t.servicos.lancamentos.estornar(l.id, '2026-10-04', 'Correção')
  })
  it('recusa data inválida/anterior e faz rollback quando a auditoria falha', async () => {
    const l = await lancar()
    await expect(t.servicos.lancamentos.estornar(l.id, 'inválida', 'Erro')).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    await expect(t.servicos.lancamentos.estornar(l.id, '2026-09-09', 'Erro')).rejects.toMatchObject({ codigo: 'REGRA' })
    const falhar = () => { throw new Error('Falha simulada na auditoria') }
    t.db.auditoria.hook('creating', falhar)
    await expect(t.servicos.lancamentos.estornar(l.id, '2026-10-01', 'Erro')).rejects.toThrow('Falha simulada')
    t.db.auditoria.hook('creating').unsubscribe(falhar)
    expect(await t.db.lancamentos.count()).toBe(1)
    expect((await t.db.lancamentos.get(l.id))?.estornadoPorId).toBeNull()
  })

  it('em mês aberto permite apenas observações no original estornado e no estorno e pode limpá-las', async () => {
    const l = await lancar('2026-10-01')
    const estorno = (await t.servicos.lancamentos.estornar(l.id, '2026-10-02', 'Duplicado'))!
    await expect(t.servicos.lancamentos.excluir(l.id, 'Excluir original')).rejects.toMatchObject({ codigo: 'REGRA' })
    await expect(t.servicos.lancamentos.recalcularRateio(l.id)).rejects.toMatchObject({ codigo: 'REGRA' })
    for (const id of [l.id, estorno.id]) {
      await expect(t.servicos.lancamentos.atualizar(id, { descricao: 'Mudar conteúdo' })).rejects.toMatchObject({ codigo: 'REGRA' })
      expect(await t.servicos.lancamentos.atualizar(id, { observacoes: 'Conferido' })).toMatchObject({ observacoes: 'Conferido' })
      expect(await t.servicos.lancamentos.atualizar(id, { observacoes: '' })).not.toHaveProperty('observacoes')
    }
    expect(await t.servicos.sistema.verificarIntegridade()).toEqual([])
  })

  it('excluir um estorno faz rollback do vínculo do original se a auditoria falhar', async () => {
    const l = await lancar()
    await t.servicos.fechamento.fechar('2026-09')
    const estorno = (await t.servicos.lancamentos.estornar(l.id, '2026-10-02', 'Duplicado'))!
    const antes = await t.db.lancamentos.toArray()
    const metaAntes = await t.db.meta.get('alteracoesDesdeBackup')
    const falhar = () => { throw new Error('Falha na exclusão auditada') }
    t.db.auditoria.hook('creating', falhar)
    try {
      await expect(t.servicos.lancamentos.excluir(estorno.id, 'Estorno indevido')).rejects.toThrow('Falha na exclusão auditada')
    } finally {
      t.db.auditoria.hook('creating').unsubscribe(falhar)
    }
    expect(await t.db.lancamentos.toArray()).toEqual(antes)
    expect(await t.db.meta.get('alteracoesDesdeBackup')).toEqual(metaAntes)
  })

  it('desfazer pagamento fechado é atômico mesmo se falhar ao criar o segundo estorno', async () => {
    const { cobranca } = await pagar()
    await t.servicos.fechamento.fechar('2026-09')
    const antes = await t.db.lancamentos.toArray()
    const auditoriaAntes = await t.db.auditoria.toArray()
    const metaAntes = await t.db.meta.get('alteracoesDesdeBackup')
    let estornos = 0
    const falhar = (_chave: unknown, a: Auditoria) => {
      if (a.acao === 'estornado' && ++estornos === 2) throw new Error('Falha no segundo estorno')
    }
    t.db.auditoria.hook('creating', falhar)
    try {
      await expect(t.servicos.cobrancas.desfazerPagamento(cobranca.id, 'Pagamento indevido')).rejects.toThrow('Falha no segundo estorno')
    } finally {
      t.db.auditoria.hook('creating').unsubscribe(falhar)
    }
    expect(await t.db.lancamentos.toArray()).toEqual(antes)
    expect(await t.db.cobrancas.get(cobranca.id)).toEqual(cobranca)
    expect(await t.db.auditoria.toArray()).toEqual(auditoriaAntes)
    expect(await t.db.meta.get('alteracoesDesdeBackup')).toEqual(metaAntes)
  })
  it('desfaz pagamento fechado estornando TAXA e JUROS; novo pagamento não altera o histórico', async () => {
    const { cobranca } = await pagar()
    await t.servicos.fechamento.fechar('2026-09')
    const desfeito = await t.servicos.cobrancas.desfazerPagamento(cobranca.id, 'Pagamento indevido')
    expect(desfeito).toMatchObject({ status: 'ABERTA', estornoGerado: true, lancamentoId: null })
    const historico = await t.consultas.lancamentos.daCobranca(cobranca.id)
    expect(historico).toHaveLength(4)
    expect(historico.filter(l => l.tipo === 'ESTORNO').map(l => l.valorCentavos).sort((a, b) => a - b)).toEqual([2000, 45000])
    const e = historico.find(l => l.tipo === 'ESTORNO')!
    await expect(t.servicos.lancamentos.excluir(e.id, 'Erro')).rejects.toMatchObject({ codigo: 'REGRA' })
    await expect(t.servicos.cobrancas.registrarPagamento(cobranca.id, { data: '2026-09-25', formaPagamento: 'PIX' })).rejects.toMatchObject({ codigo: 'MES_FECHADO' })
    await t.servicos.cobrancas.registrarPagamento(cobranca.id, { data: '2026-11-04', formaPagamento: 'PIX' })
    await t.servicos.cobrancas.desfazerPagamento(cobranca.id, 'Desfazer novo')
    expect((await t.consultas.lancamentos.daCobranca(cobranca.id)).filter(l => l.status === 'ATIVO')).toHaveLength(4)
    expect((await t.servicos.sistema.verificarIntegridade()).filter(p => p.nivel === 'ERRO')).toEqual([])
  })
  it('corrige após fechamento e reverte integralmente uma correção inválida', async () => {
    const { cobranca } = await pagar()
    await t.servicos.fechamento.fechar('2026-09')
    await expect(t.servicos.cobrancas.corrigirPagamento(cobranca.id, { data: '2026-09-20', formaPagamento: 'PIX' }, 'Data')).rejects.toMatchObject({ codigo: 'MES_FECHADO' })
    expect(await t.db.lancamentos.count()).toBe(2)
    expect((await t.db.cobrancas.get(cobranca.id))?.status).toBe('PAGA')
    const corrigido = await t.servicos.cobrancas.corrigirPagamento(cobranca.id, { data: '2026-10-01', formaPagamento: 'DINHEIRO', valorCentavos: 40000, observacoes: 'Desconto' }, 'Correção')
    expect(corrigido.lancamento.formaPagamento).toBe('DINHEIRO')
    expect(await t.db.lancamentos.count()).toBe(5)
    expect((await t.servicos.sistema.verificarIntegridade()).filter(p => p.nivel === 'ERRO')).toEqual([])
  })
})
