import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { criarBancoTeste, type BancoTeste } from '../../testes/dbTeste'

describe('serviço de estrutura', () => {
  let t: BancoTeste
  let catDespesa: string
  beforeEach(async () => {
    t = criarBancoTeste()
    catDespesa = await t.categoriaId('Água e esgoto')
  })
  afterEach(async () => {
    await t.fechar()
  })

  it('cria bloco com unidades, ordem sequencial e nome único', async () => {
    const b = await t.servicos.estrutura.criarBloco({ nome: '8A', quartos: 2, andares: 2, aptosPorAndar: 4 })
    expect(b).toMatchObject({ ordem: 15, ativo: true, saldoInicialCentavos: 0, dataSaldoInicial: '2026-09-01' })
    expect((await t.consultas.unidadesDoBloco(b.id)).map((u) => u.numero)).toEqual(['101', '102', '103', '104', '201', '202', '203', '204'])
    await expect(t.servicos.estrutura.criarBloco({ nome: ' 8a ', quartos: 2, andares: 1, aptosPorAndar: 1 })).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    await expect(t.servicos.estrutura.criarBloco({ nome: '9A', quartos: 2, andares: 1, aptosPorAndar: 1, dataSaldoInicial: '2026-08-01' })).rejects.toMatchObject({ codigo: 'REGRA' })
  })

  it('altera andares/aptos com diff: cria, exclui sem histórico, desativa com histórico e reativa', async () => {
    const b1a = await t.bloco('1A')
    const previa = await t.servicos.estrutura.previaAtualizacaoBloco(b1a.id, { andares: 5, aptosPorAndar: 4 })
    expect(previa.diff.criar.map((p) => p.numero)).toEqual(['501', '502', '503', '504'])
    const r1 = await t.servicos.estrutura.atualizarBloco(b1a.id, { nome: '1A', quartos: 3, andares: 5, aptosPorAndar: 4 })
    expect(r1.diff?.criar).toHaveLength(4)
    expect(await t.db.unidades.where('blocoId').equals(b1a.id).count()).toBe(20)

    // histórico em 501 (lançamento) → ao voltar para 4x4: 501 desativa, 502-504 excluem
    const u501 = await t.unidade('1A', '501')
    await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'UNIDADE', unidadeId: u501.id })
    const r2 = await t.servicos.estrutura.atualizarBloco(b1a.id, { nome: '1A', quartos: 3, andares: 4, aptosPorAndar: 4 })
    expect(r2.diff?.desativar.map((u) => u.numero)).toEqual(['501'])
    expect(r2.diff?.excluir).toHaveLength(3)
    expect((await t.unidade('1A', '501')).ativa).toBe(false)
    expect(await t.db.unidades.where('blocoId').equals(b1a.id).count()).toBe(17)

    const r3 = await t.servicos.estrutura.atualizarBloco(b1a.id, { nome: '1A', quartos: 3, andares: 5, aptosPorAndar: 4 })
    expect(r3.diff?.reativar.map((u) => u.numero)).toEqual(['501'])
    expect(r3.diff?.criar).toHaveLength(3)
    expect((await t.unidade('1A', '501')).ativa).toBe(true)
  })

  it('saldo inicial: data não pode "pular" lançamentos do bloco', async () => {
    const b = await t.bloco('2B')
    await t.servicos.estrutura.definirSaldoInicial(b.id, 123456, '2026-09-01')
    await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-15', valorCentavos: 100, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'BLOCO', blocoId: b.id })
    await expect(t.servicos.estrutura.definirSaldoInicial(b.id, 5, '2026-09-20')).rejects.toMatchObject({ codigo: 'REGRA' })
    await expect(t.servicos.estrutura.definirSaldoInicial(b.id, 5, '2026-09-10')).resolves.toMatchObject({ saldoInicialCentavos: 5 })
    expect(await t.servicos.estrutura.saldoAtual(b.id)).toBe(5 - 100)
    const sugestao = await t.servicos.estrutura.sugerirDistribuicaoSaldo(100001)
    expect(sugestao).toHaveLength(14)
    expect(sugestao.reduce((s, x) => s + x.valorCentavos, 0)).toBe(100001)
  })

  it('lote de saldos iniciais reverte blocos, auditoria e contador se um item posterior for inválido', async () => {
    const primeiro = await t.bloco('1A')
    const segundo = await t.bloco('1B')
    await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100, descricao: 'Água', categoriaId: catDespesa, escopoTipo: 'BLOCO', blocoId: segundo.id })
    const auditoriaAntes = await t.db.auditoria.toArray()
    const metaAntes = await t.db.meta.get('alteracoesDesdeBackup')
    await expect(t.servicos.estrutura.definirSaldosIniciaisEmLote([
      { blocoId: primeiro.id, valorCentavos: 12345, data: '2026-09-01' },
      { blocoId: segundo.id, valorCentavos: -500, data: '2026-09-11' },
    ])).rejects.toMatchObject({ codigo: 'REGRA' })
    expect(await t.db.blocos.get(primeiro.id)).toEqual(primeiro)
    expect(await t.db.blocos.get(segundo.id)).toEqual(segundo)
    expect(await t.db.auditoria.toArray()).toEqual(auditoriaAntes)
    expect(await t.db.meta.get('alteracoesDesdeBackup')).toEqual(metaAntes)
    expect(await t.servicos.estrutura.definirSaldosIniciaisEmLote([
      { blocoId: primeiro.id, valorCentavos: 12345, data: '2026-09-01' },
      { blocoId: segundo.id, valorCentavos: -500, data: '2026-09-01' },
    ])).toBe(2)
    expect((await t.db.blocos.get(primeiro.id))?.saldoInicialCentavos).toBe(12345)
    expect((await t.db.blocos.get(segundo.id))?.saldoInicialCentavos).toBe(-500)
  })

  it('prévia conta apenas cobranças abertas das unidades afetadas, sem alterar a estrutura', async () => {
    const b = await t.bloco('1A')
    await t.servicos.estrutura.definirTaxa({ quartos: 3, valorCentavos: 45000, vigenteDesde: '2026-09' })
    await t.servicos.cobrancas.gerar('2026-09')
    const u401 = await t.unidade('1A', '401')
    const c401 = (await t.consultas.cobrancas.daUnidade(u401.id))[0]!
    await t.servicos.cobrancas.cancelar(c401.id, 'Isolamento do cenário')
    const previa = await t.servicos.estrutura.previaAtualizacaoBloco(b.id, { andares: 3, aptosPorAndar: 4 })
    expect(previa.diff.desativar.map(u => u.numero).sort()).toEqual(['401', '402', '403', '404'])
    expect(previa.cobrancasAbertasAfetadas).toBe(3)
    expect((await t.db.unidades.get(u401.id))?.ativa).toBe(true)
    expect((await t.db.blocos.get(b.id))?.andares).toBe(4)
  })

  it('desativar exige zero cobranças abertas e transfere o saldo; reativar; excluir só sem referências', async () => {
    const a = await t.bloco('4A')
    const b = await t.bloco('4B')
    await t.servicos.estrutura.definirTaxa({ quartos: 3, valorCentavos: 100, vigenteDesde: '2026-09' })
    await t.servicos.estrutura.definirTaxa({ quartos: 2, valorCentavos: 100, vigenteDesde: '2026-09' })
    await t.servicos.cobrancas.gerar('2026-09')
    await expect(t.servicos.estrutura.desativarBloco(a.id)).rejects.toMatchObject({ codigo: 'REGRA' })
    for (const c of (await t.consultas.cobrancas.daCompetencia('2026-09')).filter((c) => c.blocoId === a.id)) await t.servicos.cobrancas.cancelar(c.id, 'teste')
    await t.servicos.lancamentos.registrarTransferencia({ data: '2026-09-05', valorCentavos: 7000, descricao: 'x', blocoOrigemId: b.id, blocoDestinoId: a.id })
    await expect(t.servicos.estrutura.desativarBloco(a.id)).rejects.toMatchObject({ codigo: 'REGRA' })
    const desativado = await t.servicos.estrutura.desativarBloco(a.id, { transferirParaBlocoId: b.id })
    expect(desativado.ativo).toBe(false)
    expect(await t.servicos.estrutura.saldoAtual(a.id)).toBe(0)
    expect(await t.servicos.estrutura.saldoAtual(b.id)).toBe(0)
    expect(await t.db.lancamentos.where('natureza').equals('TRANSFERENCIA').count()).toBe(2)
    await expect(t.servicos.estrutura.excluirBloco(a.id)).rejects.toMatchObject({ codigo: 'REGRA' })
    expect((await t.servicos.estrutura.reativarBloco(a.id)).ativo).toBe(true)

    const novo = await t.servicos.estrutura.criarBloco({ nome: 'Temp', quartos: 1, andares: 1, aptosPorAndar: 2 })
    await t.servicos.estrutura.excluirBloco(novo.id)
    expect(await t.db.blocos.get(novo.id)).toBeUndefined()
    expect(await t.db.unidades.where('blocoId').equals(novo.id).count()).toBe(0)
  })

  it('início contábil: recuar move saldos iniciais e taxas; avançar exige não haver histórico anterior', async () => {
    await t.servicos.estrutura.definirInicioContabil('2026-07')
    expect((await t.consultas.blocos()).every((b) => b.dataSaldoInicial === '2026-07-01')).toBe(true)
    expect((await t.consultas.taxas()).every((x) => x.vigenteDesde === '2026-07')).toBe(true)
    await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-07-15', valorCentavos: 100, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'GERAL' })
    await expect(t.servicos.estrutura.definirInicioContabil('2026-08')).rejects.toMatchObject({ codigo: 'REGRA' })
    await t.servicos.estrutura.definirInicioContabil('2026-07') // idempotente
    expect((await t.consultas.condominio())?.inicioContabil).toBe('2026-07')
  })

  it('unidades: edição, lote e colagem de planilha', async () => {
    const u = await t.unidade('1B', '203')
    const nova = await t.servicos.estrutura.atualizarUnidade(u.id, { responsavel: 'Maria', telefone: '(11) 99999-0000', isenta: true })
    expect(nova).toMatchObject({ responsavel: 'Maria', isenta: true })
    await t.servicos.estrutura.atualizarUnidade(u.id, { responsavel: '' })
    expect((await t.consultas.unidade(u.id))?.responsavel).toBeUndefined()
    const b1b = await t.bloco('1B')
    const lista = await t.consultas.unidadesDoBloco(b1b.id)
    const n = await t.servicos.estrutura.atualizarUnidadesEmLote(lista.slice(0, 3).map((x) => ({ id: x.id, dados: { responsavel: 'Lote ' + x.numero } })))
    expect(n).toBe(3)
    const r = await t.servicos.estrutura.aplicarColagem(b1b.id, [
      { numero: '101', responsavel: 'Ana', email: 'ana@x.com' },
      { numero: '999', responsavel: 'Ninguém' },
    ])
    expect(r).toEqual({ aplicadas: 1, naoEncontradas: ['999'] })
    expect(await t.unidade('1B', '101')).toMatchObject({ responsavel: 'Ana', email: 'ana@x.com' })
  })

  it('taxas: primeira definição atualiza in place; vigência retroativa; remoção só se não usada', async () => {
    const t1 = await t.servicos.estrutura.definirTaxa({ quartos: 3, valorCentavos: 45000, vigenteDesde: '2026-09' })
    expect(await t.db.taxas.count()).toBe(2)
    expect(t1.valorCentavos).toBe(45000)
    const retro = await t.servicos.estrutura.definirTaxa({ quartos: 3, valorCentavos: 40000, vigenteDesde: '2026-01' })
    expect(await t.db.taxas.count()).toBe(3)
    await t.servicos.estrutura.definirTaxa({ quartos: 2, valorCentavos: 35000, vigenteDesde: '2026-09' })
    await t.servicos.cobrancas.gerar('2026-09')
    await expect(t.servicos.estrutura.removerTaxa(t1.id)).rejects.toMatchObject({ codigo: 'REGRA' })
    await t.servicos.estrutura.removerTaxa(retro.id)
    expect(await t.db.taxas.count()).toBe(2)
  })

  it('categorias: criar, duplicada, sistema protegida, usada não exclui', async () => {
    const c = await t.servicos.estrutura.criarCategoria({ nome: 'Jardinagem', natureza: 'DESPESA' })
    expect(c.sistema).toBeNull()
    await expect(t.servicos.estrutura.criarCategoria({ nome: 'jardinagem', natureza: 'DESPESA' })).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    const taxa = await t.categoria('Taxa condominial')
    await expect(t.servicos.estrutura.excluirCategoria(taxa.id)).rejects.toMatchObject({ codigo: 'CATEGORIA_DE_SISTEMA' })
    await expect(t.servicos.estrutura.definirCategoriaAtiva(taxa.id, false)).rejects.toMatchObject({ codigo: 'CATEGORIA_DE_SISTEMA' })
    await expect(t.servicos.estrutura.atualizarCategoria(taxa.id, { nome: 'Taxa', natureza: 'DESPESA' })).rejects.toMatchObject({ codigo: 'CATEGORIA_DE_SISTEMA' })
    await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100, descricao: 'x', categoriaId: c.id, escopoTipo: 'GERAL' })
    await expect(t.servicos.estrutura.excluirCategoria(c.id)).rejects.toMatchObject({ codigo: 'REGRA' })
    expect((await t.servicos.estrutura.definirCategoriaAtiva(c.id, false)).ativa).toBe(false)
    await expect(
      t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100, descricao: 'x', categoriaId: c.id, escopoTipo: 'GERAL' }),
    ).rejects.toMatchObject({ codigo: 'REGRA' })
  })

  it.each(['ATIVO', 'EXCLUIDO'] as const)('categoria com lançamento %s preserva natureza e permite renomear', async status => {
    const categoria = await t.servicos.estrutura.criarCategoria({ nome: 'Jardinagem', natureza: 'DESPESA' })
    const lancamento = await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100, descricao: 'Jardim', categoriaId: categoria.id, escopoTipo: 'GERAL' })
    if (status === 'EXCLUIDO') await t.servicos.lancamentos.excluir(lancamento.id, 'Duplicado')
    const auditoriaAntes = await t.db.auditoria.toArray()
    const contadorAntes = await t.db.meta.get('alteracoesDesdeBackup')
    await expect(t.servicos.estrutura.atualizarCategoria(categoria.id, { nome: 'Jardim', natureza: 'RECEITA' })).rejects.toMatchObject({ codigo: 'REGRA' })
    expect(await t.db.categorias.get(categoria.id)).toEqual(categoria)
    expect(await t.db.auditoria.toArray()).toEqual(auditoriaAntes)
    expect(await t.db.meta.get('alteracoesDesdeBackup')).toEqual(contadorAntes)
    expect(await t.servicos.estrutura.atualizarCategoria(categoria.id, { nome: 'Jardim', natureza: 'DESPESA' })).toMatchObject({ nome: 'Jardim', natureza: 'DESPESA' })
    expect((await t.db.lancamentos.get(lancamento.id))?.natureza).toBe('DESPESA')
    expect(await t.servicos.sistema.verificarIntegridade()).toEqual([])
  })

  it('categoria ainda não utilizada pode mudar de natureza', async () => {
    const categoria = await t.servicos.estrutura.criarCategoria({ nome: 'Jardinagem', natureza: 'DESPESA' })
    expect(await t.servicos.estrutura.atualizarCategoria(categoria.id, { nome: 'Jardim', natureza: 'RECEITA' })).toMatchObject({ id: categoria.id, nome: 'Jardim', natureza: 'RECEITA' })
    expect((await t.db.categorias.get(categoria.id))?.natureza).toBe('RECEITA')
  })
})
