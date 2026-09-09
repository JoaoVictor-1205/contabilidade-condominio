import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { criarBancoTeste, type BancoTeste } from '../../testes/dbTeste'

describe('serviço de documentos e anexos', () => {
  let t: BancoTeste
  beforeEach(() => {
    t = criarBancoTeste()
  })
  afterEach(async () => {
    await t.fechar()
  })

  it('cria documento com anexos, edita e exclui removendo os binários', async () => {
    const d = await t.servicos.documentos.criar({ titulo: 'Ata da assembleia', categoria: 'ATA', data: '2026-09-01', descricao: 'Ordinária' }, [
      { nome: 'ata.pdf', mime: 'application/pdf', blob: new Blob(['pdf']) },
      { nome: 'lista.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', blob: new Blob(['docx']) },
    ])
    expect(await t.consultas.anexos.de('DOCUMENTO', d.id)).toHaveLength(2)
    expect(await t.db.anexosBlob.count()).toBe(2)
    const e = await t.servicos.documentos.atualizar(d.id, { titulo: 'Ata 2026', categoria: 'ATA', data: '2026-09-02' })
    expect(e.descricao).toBeUndefined()
    expect((await t.consultas.documentos.listar())[0]?.titulo).toBe('Ata 2026')
    await t.servicos.anexos.adicionar('DOCUMENTO', d.id, [{ nome: 'foto.png', mime: 'image/png', blob: new Blob(['png']) }])
    const anexos = await t.servicos.anexos.listar('DOCUMENTO', d.id)
    expect(anexos).toHaveLength(3)
    await t.servicos.anexos.remover(anexos[0]!.id)
    expect(await t.db.anexosBlob.count()).toBe(2)
    await t.servicos.documentos.excluir(d.id)
    expect(await t.db.documentos.count()).toBe(0)
    expect(await t.db.anexos.count()).toBe(0)
    expect(await t.db.anexosBlob.count()).toBe(0)
    expect((await t.consultas.anexos.total()).bytes).toBe(0)
  })

  it('anexo de lançamento: não anexa em excluído; não remove comprovante de taxa paga', async () => {
    const cat = await t.categoriaId('Materiais')
    const l = await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 100, descricao: 'x', categoriaId: cat, escopoTipo: 'GERAL' })
    await t.servicos.anexos.adicionar('LANCAMENTO', l.id, [{ nome: 'nf.pdf', mime: 'application/pdf', blob: new Blob(['x']) }])
    await t.servicos.lancamentos.excluir(l.id, 'teste')
    await expect(t.servicos.anexos.adicionar('LANCAMENTO', l.id, [{ nome: 'b.pdf', mime: 'application/pdf', blob: new Blob(['y']) }])).rejects.toMatchObject({ codigo: 'REGRA' })

    await t.servicos.estrutura.definirTaxa({ quartos: 3, valorCentavos: 100, vigenteDesde: '2026-09' })
    await t.servicos.estrutura.definirTaxa({ quartos: 2, valorCentavos: 100, vigenteDesde: '2026-09' })
    await t.servicos.cobrancas.gerar('2026-09')
    const u = await t.unidade('1A', '101')
    const c = (await t.consultas.cobrancas.daUnidade(u.id))[0]!
    const r = await t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-09', formaPagamento: 'PIX' }, [{ nome: 'comp.jpg', mime: 'image/jpeg', blob: new Blob(['j']) }])
    const [anexo] = await t.servicos.anexos.listar('LANCAMENTO', r.lancamento.id)
    await expect(t.servicos.anexos.remover(anexo!.id)).rejects.toMatchObject({ codigo: 'REGRA' })
  })
})
