import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Auditoria } from '../../dominio/tipos'
import { criarBancoTeste, type BancoTeste } from '../../testes/dbTeste'

describe('serviço de cobranças', () => {
  let t: BancoTeste
  beforeEach(async () => {
    t = criarBancoTeste()
  })
  afterEach(async () => {
    await t.fechar()
  })

  async function definirTaxas() {
    await t.servicos.estrutura.definirTaxa({ quartos: 3, valorCentavos: 45000, vigenteDesde: '2026-09' })
    await t.servicos.estrutura.definirTaxa({ quartos: 2, valorCentavos: 35000, vigenteDesde: '2026-09' })
  }

  it('sem taxa definida não gera nada e aponta os tipos sem taxa', async () => {
    const r = await t.servicos.cobrancas.gerar('2026-09')
    expect(r.criadas).toBe(0)
    expect(r.semTaxa.map((s) => s.quartos).sort()).toEqual([2, 3])
    expect(await t.db.cobrancas.count()).toBe(0)
  })

  it('gera 320 cobranças (128 × 3q + 192 × 2q), é idempotente e aceita competência futura', async () => {
    await definirTaxas()
    const r = await t.servicos.cobrancas.gerar('2026-09')
    expect(r.criadas).toBe(320)
    expect(r.resumo).toEqual(expect.arrayContaining([
      expect.objectContaining({ quartos: 3, quantidade: 128, valorCentavos: 45000 }),
      expect.objectContaining({ quartos: 2, quantidade: 192, valorCentavos: 35000 }),
    ]))
    const c = (await t.consultas.cobrancas.daCompetencia('2026-09'))[0]!
    expect(c).toMatchObject({ status: 'ABERTA', vencimento: '2026-09-10', origemValor: 'TAXA', jurosCentavos: 0, valorPagoCentavos: null })
    const r2 = await t.servicos.cobrancas.gerar('2026-09')
    expect(r2).toMatchObject({ criadas: 0, jaExistentes: 320 })
    expect((await t.servicos.cobrancas.gerar('2026-12')).criadas).toBe(320)
    await expect(t.servicos.cobrancas.gerar('2026-08')).rejects.toMatchObject({ codigo: 'REGRA' })
    expect((await t.servicos.cobrancas.previaGeracao('2027-01')).criar).toHaveLength(320)
    expect(await t.db.cobrancas.count()).toBe(640)
  })

  it('unidade isenta e bloco desativado não recebem cobrança', async () => {
    await definirTaxas()
    const u = await t.unidade('1A', '101')
    await t.servicos.estrutura.atualizarUnidade(u.id, { isenta: true })
    const b7b = await t.bloco('7B')
    await t.servicos.estrutura.desativarBloco(b7b.id)
    expect((await t.servicos.cobrancas.gerar('2026-09')).criadas).toBe(320 - 1 - 32)
  })

  it('pagamento em 1 clique cria lançamento TAXA vinculado e marca PAGA', async () => {
    await definirTaxas()
    await t.servicos.cobrancas.gerar('2026-09')
    const u = await t.unidade('1A', '101')
    const c = (await t.consultas.cobrancas.daUnidade(u.id))[0]!
    const { cobranca, lancamento } = await t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-08', formaPagamento: 'PIX' })
    expect(cobranca).toMatchObject({ status: 'PAGA', pagaEm: '2026-09-08', valorPagoCentavos: 45000, jurosCentavos: 0, lancamentoId: lancamento.id })
    expect(lancamento).toMatchObject({ natureza: 'RECEITA', escopoTipo: 'UNIDADE', unidadeId: u.id, blocoId: u.blocoId, valorCentavos: 45000, competencia: '2026-09', cobrancaId: c.id })
    expect(lancamento.descricao).toBe('Taxa condominial 09/2026 — Bloco 1A apto 101')
    expect((await t.db.categorias.get(lancamento.categoriaId))?.sistema).toBe('TAXA')
    await expect(t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-08', formaPagamento: 'PIX' })).rejects.toMatchObject({ codigo: 'COBRANCA_ESTADO' })
  })

  it('valor diferente exige observação; juros geram segundo lançamento; resumo do demonstrativo bate', async () => {
    await definirTaxas()
    await t.servicos.cobrancas.gerar('2026-09')
    const u = await t.unidade('5A', '408')
    const c = (await t.consultas.cobrancas.daUnidade(u.id))[0]!
    await expect(t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-20', formaPagamento: 'DINHEIRO', valorCentavos: 30000 })).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    const r = await t.servicos.cobrancas.registrarPagamento(
      c.id,
      { data: '2026-10-02', formaPagamento: 'DINHEIRO', valorCentavos: 30000, jurosCentavos: 2000, observacoes: 'acordo' },
      [{ nome: 'foto.jpg', mime: 'image/jpeg', blob: new Blob(['jpg']) }],
    )
    expect(r.cobranca).toMatchObject({ valorPagoCentavos: 30000, jurosCentavos: 2000 })
    const vinculados = await t.consultas.lancamentos.daCobranca(c.id)
    expect(vinculados).toHaveLength(2)
    const juros = vinculados.find((l) => l.valorCentavos === 2000)!
    expect(juros.competencia).toBe('2026-10')
    expect((await t.db.categorias.get(juros.categoriaId))?.sistema).toBe('JUROS')
    expect(await t.consultas.anexos.de('LANCAMENTO', r.lancamento.id)).toHaveLength(1)
    const insumos = await t.consultas.relatorios.insumosDemonstrativo({ inicio: '2026-09-01', fim: '2026-09-30' })
    const { calcularDemonstrativo } = await import('../../dominio/demonstrativo')
    const dem = calcularDemonstrativo({ periodo: { inicio: '2026-09-01', fim: '2026-09-30' }, ...insumos, hoje: '2026-10-05', agora: '2026-10-05T10:00:00' })
    expect(dem.cobrancas).toMatchObject({ geradas: 320, pagas: 1, valorRecebidoCentavos: 30000, valorJurosCentavos: 2000, valorDescontosCentavos: 5000 })
  })

  it('lote paga várias e reporta erros sem abortar as demais', async () => {
    await definirTaxas()
    await t.servicos.cobrancas.gerar('2026-09')
    const b1a = await t.bloco('1A')
    const ids = (await t.consultas.cobrancas.daCompetencia('2026-09')).filter((c) => c.blocoId === b1a.id).map((c) => c.id)
    expect(ids).toHaveLength(16)
    const r = await t.servicos.cobrancas.registrarPagamentosEmLote(ids, { data: '2026-09-09', formaPagamento: 'BOLETO' })
    expect(r.ok).toHaveLength(16)
    const r2 = await t.servicos.cobrancas.registrarPagamentosEmLote(ids.slice(0, 3), { data: '2026-09-09', formaPagamento: 'BOLETO' })
    expect(r2.ok).toHaveLength(0)
    expect(r2.erros).toHaveLength(3)
    expect(await t.db.lancamentos.where('status').equals('ATIVO').count()).toBe(16)
  })

  it('lote reverte por inteiro o item cuja auditoria falha e continua com os demais, sem repetir IDs', async () => {
    await definirTaxas()
    await t.servicos.cobrancas.gerar('2026-09')
    const [primeira, falha, ultima] = (await t.consultas.cobrancas.daCompetencia('2026-09')).slice(0, 3)
    const auditoriaAntes = await t.db.auditoria.count()
    const metaAntes = (await t.db.meta.get('alteracoesDesdeBackup'))!.valor as number
    const falhar = (_chave: unknown, a: Auditoria) => { if (a.entidadeId === falha!.id && a.acao === 'paga') throw new Error('Falha de gravação simulada') }
    t.db.auditoria.hook('creating', falhar)
    try {
      const resultado = await t.servicos.cobrancas.registrarPagamentosEmLote([primeira!.id, falha!.id, ultima!.id, primeira!.id], { data: '2026-09-09', formaPagamento: 'PIX' })
      expect(resultado.ok).toEqual([primeira!.id, ultima!.id])
      expect(resultado.erros).toEqual([{ cobrancaId: falha!.id, mensagem: 'Falha de gravação simulada' }])
    } finally {
      t.db.auditoria.hook('creating').unsubscribe(falhar)
    }
    expect(await t.db.cobrancas.get(falha!.id)).toEqual(falha)
    expect(await t.consultas.lancamentos.daCobranca(falha!.id)).toEqual([])
    expect(await t.db.lancamentos.count()).toBe(2)
    expect(await t.db.auditoria.count()).toBe(auditoriaAntes + 2)
    expect((await t.db.meta.get('alteracoesDesdeBackup'))?.valor).toBe(metaAntes + 2)
    expect(await t.servicos.sistema.verificarIntegridade()).toEqual([])
  })

  it('recusa pagamento anterior ao início contábil ou ao saldo inicial e preserva a cobrança', async () => {
    await definirTaxas()
    await t.servicos.cobrancas.gerar('2026-09')
    const u = await t.unidade('1A', '101')
    const c = (await t.consultas.cobrancas.daUnidade(u.id))[0]!
    await expect(t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-08-31', formaPagamento: 'PIX' })).rejects.toMatchObject({ codigo: 'DATA_ANTERIOR_AO_SALDO_INICIAL' })
    await t.servicos.estrutura.definirSaldoInicial(u.blocoId, 1000, '2026-09-10')
    await expect(t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-09', formaPagamento: 'PIX' })).rejects.toMatchObject({ codigo: 'DATA_ANTERIOR_AO_SALDO_INICIAL' })
    expect(await t.db.cobrancas.get(c.id)).toEqual(c)
    expect(await t.db.lancamentos.count()).toBe(0)
  })

  it('limpa observações de cobrança aberta e valida os dados antes de gravar', async () => {
    await definirTaxas()
    await t.servicos.cobrancas.gerar('2026-09')
    const c = (await t.consultas.cobrancas.daCompetencia('2026-09'))[0]!
    await t.servicos.cobrancas.alterarAberta(c.id, { observacoes: 'Acordo a confirmar' })
    await expect(t.servicos.cobrancas.alterarAberta(c.id, { vencimento: '2026-02-30' })).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    expect(await t.servicos.cobrancas.alterarAberta(c.id, { observacoes: '  ' })).not.toHaveProperty('observacoes')
    expect(await t.consultas.auditoria.de(c.id)).toContainEqual(expect.objectContaining({ alteracoes: { observacoes: { de: 'Acordo a confirmar', para: null } } }))
  })

  it('desfazer reabre e exclui os lançamentos; corrigir deixa exatamente um TAXA ativo', async () => {
    await definirTaxas()
    await t.servicos.cobrancas.gerar('2026-09')
    const u = await t.unidade('3B', '202')
    const c = (await t.consultas.cobrancas.daUnidade(u.id))[0]!
    await t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-08', formaPagamento: 'PIX', jurosCentavos: 500, valorCentavos: 45000 })
    await expect(t.servicos.cobrancas.desfazerPagamento(c.id, '')).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    const reaberta = await t.servicos.cobrancas.desfazerPagamento(c.id, 'pagou outro apto')
    expect(reaberta).toMatchObject({ status: 'ABERTA', lancamentoId: null, pagaEm: null, valorPagoCentavos: null, jurosCentavos: 0 })
    expect((await t.consultas.lancamentos.daCobranca(c.id)).every((l) => l.status === 'EXCLUIDO')).toBe(true)
    await expect(t.servicos.cobrancas.desfazerPagamento(c.id, 'x')).rejects.toMatchObject({ codigo: 'COBRANCA_ESTADO' })

    await t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-08', formaPagamento: 'PIX' })
    const corrigido = await t.servicos.cobrancas.corrigirPagamento(c.id, { data: '2026-09-11', formaPagamento: 'DINHEIRO' }, 'data errada')
    expect(corrigido.cobranca).toMatchObject({ status: 'PAGA', pagaEm: '2026-09-11' })
    const ativos = (await t.consultas.lancamentos.daCobranca(c.id)).filter((l) => l.status === 'ATIVO')
    expect(ativos).toHaveLength(1)
    expect(ativos[0]?.data).toBe('2026-09-11')
  })

  it('excluir lançamento de TAXA pelo serviço de lançamentos reabre a cobrança; excluir só JUROS zera os juros', async () => {
    await definirTaxas()
    await t.servicos.cobrancas.gerar('2026-09')
    const u = await t.unidade('6A', '105')
    const c = (await t.consultas.cobrancas.daUnidade(u.id))[0]!
    const r = await t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-15', formaPagamento: 'PIX', jurosCentavos: 300 })
    const juros = (await t.consultas.lancamentos.daCobranca(c.id)).find((l) => l.id !== r.lancamento.id)!
    await t.servicos.lancamentos.excluir(juros.id, 'juros perdoados')
    expect(await t.consultas.cobrancas.obter(c.id)).toMatchObject({ status: 'PAGA', jurosCentavos: 0 })
    await expect(t.servicos.lancamentos.atualizar(r.lancamento.id, { valorCentavos: 1 })).rejects.toMatchObject({ codigo: 'REGRA' })
    await t.servicos.lancamentos.atualizar(r.lancamento.id, { observacoes: 'ok' })
    await t.servicos.lancamentos.excluir(r.lancamento.id, 'errado')
    expect(await t.consultas.cobrancas.obter(c.id)).toMatchObject({ status: 'ABERTA', lancamentoId: null })
  })

  it('cancelar / isentar / reabrir / alterar aberta / reemitir', async () => {
    await definirTaxas()
    await t.servicos.cobrancas.gerar('2026-09')
    const lista = await t.consultas.cobrancas.daCompetencia('2026-09')
    const [c1, c2, c3] = lista as [typeof lista[0], typeof lista[0], typeof lista[0]]
    await t.servicos.cobrancas.cancelar(c1.id, 'unidade vazia')
    await t.servicos.cobrancas.isentar(c2.id, 'zelador')
    expect(await t.consultas.cobrancas.obter(c1.id)).toMatchObject({ status: 'CANCELADA', motivo: 'unidade vazia' })
    await expect(t.servicos.cobrancas.cancelar(c1.id, 'x')).rejects.toMatchObject({ codigo: 'COBRANCA_ESTADO' })
    await t.servicos.cobrancas.reabrir(c1.id)
    expect(await t.consultas.cobrancas.obter(c1.id)).toMatchObject({ status: 'ABERTA' })
    const alterada = await t.servicos.cobrancas.alterarAberta(c3.id, { valorCentavos: 40000, vencimento: '2026-09-20' })
    expect(alterada).toMatchObject({ valorCentavos: 40000, origemValor: 'MANUAL', vencimento: '2026-09-20' })
    await t.servicos.estrutura.definirTaxa({ quartos: 3, valorCentavos: 47000, vigenteDesde: '2026-09' })
    await t.servicos.estrutura.definirTaxa({ quartos: 2, valorCentavos: 36000, vigenteDesde: '2026-09' })
    const r = await t.servicos.cobrancas.reemitirAbertas('2026-09')
    expect(r.puladas).toBe(1)
    expect(r.atualizadas).toBe(320 - 1 - 1) // menos a isenta e a MANUAL
    expect((await t.consultas.cobrancas.obter(c3.id))?.valorCentavos).toBe(40000)
  })

  it('cobrança de apartamento desativado continua cobrável', async () => {
    await definirTaxas()
    await t.servicos.cobrancas.gerar('2026-09')
    const b1a = await t.bloco('1A')
    const { bloco } = await t.servicos.estrutura.atualizarBloco(b1a.id, { nome: '1A', quartos: 3, andares: 3, aptosPorAndar: 4 })
    expect(bloco.andares).toBe(3)
    const u = await t.unidade('1A', '401')
    expect(u.ativa).toBe(false)
    const c = (await t.consultas.cobrancas.daUnidade(u.id))[0]!
    await expect(t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-09', formaPagamento: 'PIX' })).resolves.toBeTruthy()
    expect((await t.servicos.cobrancas.gerar('2026-10')).criadas).toBe(320 - 4)
  })
})
