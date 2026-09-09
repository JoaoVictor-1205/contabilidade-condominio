import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { somaCotas } from '../../dominio/rateio'
import { criarBancoTeste, type BancoTeste } from '../../testes/dbTeste'

describe('serviço de lançamentos', () => {
  let t: BancoTeste
  let catDespesa: string
  let catReceita: string
  beforeEach(async () => {
    t = criarBancoTeste()
    catDespesa = await t.categoriaId('Água e esgoto')
    catReceita = await t.categoriaId('Taxa extra')
  })
  afterEach(async () => {
    await t.fechar()
  })

  it('registra despesa GERAL com snapshot de rateio proporcional e auditoria', async () => {
    const l = await t.servicos.lancamentos.registrar({
      natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100000, descricao: 'Água', categoriaId: catDespesa, escopoTipo: 'GERAL',
    })
    expect(l.rateio?.cotas).toHaveLength(14)
    expect(somaCotas(l.rateio!)).toBe(100000)
    const cota1A = l.rateio!.cotas.find((c) => c.nomeBloco === '1A')!
    const cota5A = l.rateio!.cotas.find((c) => c.nomeBloco === '5A')!
    expect(cota1A).toMatchObject({ unidadesAtivas: 16, valorCentavos: 5000 })
    expect(cota5A).toMatchObject({ unidadesAtivas: 32, valorCentavos: 10000 })
    expect(l).toMatchObject({ mes: '2026-09', competencia: '2026-09', status: 'ATIVO', blocoId: null, versao: 1 })
    const aud = await t.consultas.auditoria.de(l.id)
    expect(aud).toHaveLength(1)
    expect(aud[0]).toMatchObject({ entidade: 'lancamento', acao: 'registrado', em: '2026-09-04T10:00:00' })
  })

  it('registra receita de UNIDADE preenchendo o bloco e grava anexos', async () => {
    const u = await t.unidade('2A', '304')
    const l = await t.servicos.lancamentos.registrar(
      { natureza: 'RECEITA', data: '2026-09-12', valorCentavos: 5000, descricao: 'Taxa extra', categoriaId: catReceita, escopoTipo: 'UNIDADE', unidadeId: u.id, competencia: '2026-10' },
      [{ nome: 'recibo.pdf', mime: 'application/pdf', blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }) }],
    )
    expect(l.blocoId).toBe(u.blocoId)
    expect(l.competencia).toBe('2026-10')
    const anexos = await t.consultas.anexos.de('LANCAMENTO', l.id)
    expect(anexos).toHaveLength(1)
    expect(anexos[0]).toMatchObject({ nome: 'recibo.pdf', mime: 'application/pdf', tamanho: 8 })
    expect(await (await t.consultas.anexos.blob(anexos[0]!.id))?.text()).toBe('%PDF-1.4')
  })

  it('limpa observações sem recriar o campo e registra a remoção na auditoria', async () => {
    const l = await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 1000, descricao: 'Água', categoriaId: catDespesa, escopoTipo: 'GERAL', observacoes: 'Conferir recibo' })
    const editado = await t.servicos.lancamentos.atualizar(l.id, { descricao: 'Água do mês' })
    expect(editado.observacoes).toBe('Conferir recibo')
    const limpo = await t.servicos.lancamentos.atualizar(l.id, { observacoes: '   ' })
    expect(limpo).not.toHaveProperty('observacoes')
    expect(await t.db.lancamentos.get(l.id)).not.toHaveProperty('observacoes')
    expect(await t.consultas.auditoria.de(l.id)).toContainEqual(expect.objectContaining({ alteracoes: { observacoes: { de: 'Conferir recibo', para: null } } }))
  })

  it('permite editar histórico de apartamento desativado e recusa mover outro lançamento para ele', async () => {
    const u = await t.unidade('1A', '401')
    const b = await t.bloco('1A')
    const l = await t.servicos.lancamentos.registrar({ natureza: 'RECEITA', data: '2026-09-10', valorCentavos: 1000, descricao: 'Taxa extra', categoriaId: catReceita, escopoTipo: 'UNIDADE', unidadeId: u.id })
    await t.servicos.estrutura.atualizarBloco(b.id, { nome: b.nome, quartos: b.quartos, andares: 3, aptosPorAndar: 4 })
    expect((await t.db.unidades.get(u.id))?.ativa).toBe(false)
    expect(await t.servicos.lancamentos.atualizar(l.id, { valorCentavos: 1200 })).toMatchObject({ unidadeId: u.id, valorCentavos: 1200 })
    const geral = await t.servicos.lancamentos.registrar({ natureza: 'RECEITA', data: '2026-09-10', valorCentavos: 1000, descricao: 'Outra taxa', categoriaId: catReceita, escopoTipo: 'GERAL' })
    await expect(t.servicos.lancamentos.atualizar(geral.id, { escopoTipo: 'UNIDADE', unidadeId: u.id })).rejects.toMatchObject({ codigo: 'REGRA' })
    expect((await t.db.lancamentos.get(geral.id))?.escopoTipo).toBe('GERAL')
  })

  it('mantém a edição histórica no bloco inativo e recusa novos lançamentos em suas unidades ainda ativas', async () => {
    const b = await t.bloco('1A')
    const destino = await t.bloco('1B')
    const u = await t.unidade('1A', '101')
    const l = await t.servicos.lancamentos.registrar({ natureza: 'RECEITA', data: '2026-09-04', valorCentavos: 1000, descricao: 'Taxa extra', categoriaId: catReceita, escopoTipo: 'BLOCO', blocoId: b.id })
    await t.servicos.estrutura.desativarBloco(b.id, { transferirParaBlocoId: destino.id })
    expect((await t.db.unidades.get(u.id))?.ativa).toBe(true)
    expect(await t.servicos.lancamentos.atualizar(l.id, { descricao: 'Histórico conferido' })).toMatchObject({ descricao: 'Histórico conferido', blocoId: b.id })
    await expect(t.servicos.lancamentos.registrar({ natureza: 'RECEITA', data: '2026-09-10', valorCentavos: 1000, descricao: 'Taxa extra', categoriaId: catReceita, escopoTipo: 'UNIDADE', unidadeId: u.id })).rejects.toMatchObject({ codigo: 'REGRA' })
  })

  it('recusa categorias de sistema, categoria de natureza diferente e bloco desativado', async () => {
    const taxa = await t.categoriaId('Taxa condominial')
    await expect(
      t.servicos.lancamentos.registrar({ natureza: 'RECEITA', data: '2026-09-10', valorCentavos: 100, descricao: 'x', categoriaId: taxa, escopoTipo: 'GERAL' }),
    ).rejects.toMatchObject({ codigo: 'CATEGORIA_DE_SISTEMA' })
    await expect(
      t.servicos.lancamentos.registrar({ natureza: 'RECEITA', data: '2026-09-10', valorCentavos: 100, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'GERAL' }),
    ).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    const b = await t.bloco('7B')
    await t.servicos.estrutura.desativarBloco(b.id)
    await expect(
      t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'BLOCO', blocoId: b.id }),
    ).rejects.toMatchObject({ codigo: 'REGRA' })
    // bloco desativado sai do rateio
    const geral = await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'GERAL' })
    expect(geral.rateio?.cotas).toHaveLength(13)
  })

  it('recusa data anterior ao início contábil e ao saldo inicial do bloco afetado', async () => {
    await expect(
      t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-08-31', valorCentavos: 100, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'GERAL' }),
    ).rejects.toMatchObject({ codigo: 'DATA_ANTERIOR_AO_SALDO_INICIAL' })
    const b1a = await t.bloco('1A')
    await t.servicos.estrutura.definirSaldoInicial(b1a.id, 10000, '2026-09-10')
    await expect(
      t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-05', valorCentavos: 100, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'BLOCO', blocoId: b1a.id }),
    ).rejects.toMatchObject({ codigo: 'DATA_ANTERIOR_AO_SALDO_INICIAL' })
    // GERAL também afeta 1A
    await expect(
      t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-05', valorCentavos: 100, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'GERAL' }),
    ).rejects.toMatchObject({ codigo: 'DATA_ANTERIOR_AO_SALDO_INICIAL' })
    // outro bloco segue livre
    const b1b = await t.bloco('1B')
    await expect(
      t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-05', valorCentavos: 100, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'BLOCO', blocoId: b1b.id }),
    ).resolves.toBeTruthy()
  })

  it('edita: valor re-rateia com os pesos do snapshot; escopo novo limpa o rateio; natureza exige motivo', async () => {
    const l = await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100000, descricao: 'Água', categoriaId: catDespesa, escopoTipo: 'GERAL' })
    const b7b = await t.bloco('7B')
    const b7a = await t.bloco('7A')
    // 7B tem saldo negativo pela cota do rateio: desativar exige transferir o saldo. A estrutura muda, mas o snapshot mantém os 14 pesos.
    await t.servicos.estrutura.desativarBloco(b7b.id, { transferirParaBlocoId: b7a.id })
    const v2 = await t.servicos.lancamentos.atualizar(l.id, { valorCentavos: 50001 })
    expect(v2.versao).toBe(2)
    expect(v2.rateio?.cotas).toHaveLength(14)
    expect(somaCotas(v2.rateio!)).toBe(50001)
    const b1a = await t.bloco('1A')
    const v3 = await t.servicos.lancamentos.atualizar(l.id, { escopoTipo: 'BLOCO', blocoId: b1a.id })
    expect(v3.rateio).toBeNull()
    expect(v3.blocoId).toBe(b1a.id)
    await expect(t.servicos.lancamentos.atualizar(l.id, { natureza: 'RECEITA', categoriaId: catReceita })).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    const v4 = await t.servicos.lancamentos.atualizar(l.id, { natureza: 'RECEITA', categoriaId: catReceita }, 'lançado errado')
    expect(v4.natureza).toBe('RECEITA')
  })

  it('exclui logicamente com motivo, preservando anexos; não exclui duas vezes', async () => {
    const l = await t.servicos.lancamentos.registrar(
      { natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 1000, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'GERAL' },
      [{ nome: 'a.txt', mime: 'text/plain', blob: new Blob(['a']) }],
    )
    await expect(t.servicos.lancamentos.excluir(l.id, '  ')).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    await t.servicos.lancamentos.excluir(l.id, 'duplicado')
    const e = await t.consultas.lancamentos.obter(l.id)
    expect(e).toMatchObject({ status: 'EXCLUIDO', motivoExclusao: 'duplicado', versao: 2 })
    expect(await t.consultas.anexos.de('LANCAMENTO', l.id)).toHaveLength(1)
    await expect(t.servicos.lancamentos.excluir(l.id, 'de novo')).rejects.toMatchObject({ codigo: 'REGRA' })
    expect(await t.consultas.lancamentos.listar()).toHaveLength(0)
    expect(await t.consultas.lancamentos.listar({ status: 'TODOS' })).toHaveLength(1)
    await expect(t.servicos.lancamentos.atualizar(l.id, { descricao: 'y' })).rejects.toMatchObject({ codigo: 'REGRA' })
  })

  it('é atômico: anexo acima do limite desfaz o lançamento', async () => {
    const grande = new Blob([new Uint8Array(16 * 1024 * 1024)])
    await expect(
      t.servicos.lancamentos.registrar(
        { natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 1000, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'GERAL' },
        [{ nome: 'grande.bin', mime: 'application/octet-stream', blob: grande }],
      ),
    ).rejects.toMatchObject({ codigo: 'VALIDACAO' })
    expect(await t.db.lancamentos.count()).toBe(0)
    expect(await t.db.anexos.count()).toBe(0)
  })

  it('recalcula o rateio com a estrutura atual só por ação explícita', async () => {
    const l = await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100000, descricao: 'x', categoriaId: catDespesa, escopoTipo: 'GERAL' })
    await t.servicos.estrutura.criarBloco({ nome: '8A', quartos: 2, andares: 2, aptosPorAndar: 4 })
    expect((await t.consultas.lancamentos.obter(l.id))?.rateio?.cotas).toHaveLength(14)
    const novo = await t.servicos.lancamentos.recalcularRateio(l.id)
    expect(novo.rateio?.cotas).toHaveLength(15)
    expect(novo.rateio?.totalUnidades).toBe(328)
    expect(somaCotas(novo.rateio!)).toBe(100000)
  })

  it('transferência entre blocos: origem pode estar desativada, destino não', async () => {
    const a = await t.bloco('1A')
    const b = await t.bloco('1B')
    const tr = await t.servicos.lancamentos.registrarTransferencia({ data: '2026-09-15', valorCentavos: 5000, descricao: 'Ajuste', blocoOrigemId: a.id, blocoDestinoId: b.id })
    expect(tr).toMatchObject({ natureza: 'TRANSFERENCIA', escopoTipo: 'BLOCO', blocoOrigemId: a.id, blocoId: b.id, rateio: null })
    const cat = await t.db.categorias.get(tr.categoriaId)
    expect(cat?.sistema).toBe('TRANSFERENCIA')
    expect(await t.servicos.estrutura.saldoAtual(a.id)).toBe(-5000)
    expect(await t.servicos.estrutura.saldoAtual(b.id)).toBe(5000)
    const c = await t.bloco('7B')
    await t.servicos.estrutura.desativarBloco(c.id)
    await expect(
      t.servicos.lancamentos.registrarTransferencia({ data: '2026-09-15', valorCentavos: 100, descricao: 'x', blocoOrigemId: a.id, blocoDestinoId: c.id }),
    ).rejects.toMatchObject({ codigo: 'REGRA' })
    await expect(
      t.servicos.lancamentos.registrarTransferencia({ data: '2026-09-15', valorCentavos: 100, descricao: 'x', blocoOrigemId: c.id, blocoDestinoId: a.id }),
    ).resolves.toBeTruthy()
    await expect(t.servicos.lancamentos.atualizar(tr.id, { descricao: 'y' })).rejects.toMatchObject({ codigo: 'REGRA' })
  })

  it('consultas: filtros por período, bloco (inclui cotas), texto e limite', async () => {
    const b1a = await t.bloco('1A')
    const b1b = await t.bloco('1B')
    await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100, descricao: 'Luz do hall', categoriaId: catDespesa, escopoTipo: 'GERAL' })
    await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-20', valorCentavos: 200, descricao: 'Portão', categoriaId: catDespesa, escopoTipo: 'BLOCO', blocoId: b1b.id })
    await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-10-01', valorCentavos: 300, descricao: 'Tinta', categoriaId: catDespesa, escopoTipo: 'BLOCO', blocoId: b1a.id })
    expect(await t.consultas.lancamentos.listar({ inicio: '2026-09-01', fim: '2026-09-30' })).toHaveLength(2)
    expect((await t.consultas.lancamentos.listar({ blocoId: b1a.id })).map((l) => l.descricao)).toEqual(['Tinta', 'Luz do hall'])
    expect(await t.consultas.lancamentos.listar({ texto: 'portão' })).toHaveLength(1)
    expect(await t.consultas.lancamentos.listar({ limite: 1 })).toHaveLength(1)
    const insumos = await t.consultas.relatorios.insumosDemonstrativo({ inicio: '2026-09-01', fim: '2026-09-30' })
    expect(insumos.lancamentos).toHaveLength(2)
    expect(insumos.unidadesPorBloco.get(b1a.id)).toBe(16)
  })
})
