import { afterEach, describe, expect, it } from 'vitest'
import { criarBancoTeste, type BancoTeste } from '../testes/dbTeste'

describe('seed inicial e banco', () => {
  let t: BancoTeste
  afterEach(async () => {
    await t?.fechar()
  })

  it('semeia 14 blocos, 320 unidades, taxas zeradas e categorias de sistema', async () => {
    t = criarBancoTeste()
    const blocos = await t.consultas.blocos()
    expect(blocos.map((b) => b.nome)).toEqual(['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B', '5A', '5B', '6A', '6B', '7A', '7B'])
    expect(blocos.filter((b) => b.quartos === 3)).toHaveLength(8)
    expect(await t.db.unidades.count()).toBe(320)
    expect((await t.consultas.unidadesDoBloco(blocos[0]!.id)).map((u) => u.numero).slice(0, 5)).toEqual(['101', '102', '103', '104', '201'])
    expect((await t.consultas.unidadesDoBloco(blocos[8]!.id)).at(-1)?.numero).toBe('408')
    const taxas = await t.consultas.taxas()
    expect(taxas).toHaveLength(2)
    expect(taxas.every((x) => x.valorCentavos === 0 && x.vigenteDesde === '2026-09')).toBe(true)
    const categorias = await t.consultas.categorias()
    expect(categorias.map((c) => c.sistema).filter(Boolean).sort()).toEqual(['JUROS', 'TAXA', 'TRANSFERENCIA'])
    const cond = await t.consultas.condominio()
    expect(cond?.inicioContabil).toBe('2026-09')
    expect(await t.consultas.meta<boolean>('onboardingConcluido')).toBe(false)
    expect(await t.consultas.meta<number>('schemaVersion')).toBe(2)
  })

  it('não repopula ao reabrir o banco', async () => {
    t = criarBancoTeste()
    const instalacao = await t.consultas.meta<string>('instalacaoId')
    await t.servicos.estrutura.atualizarCondominio({ nome: 'Residencial Teste', diaVencimento: 5 })
    t.db.close()
    await t.db.open()
    expect(await t.db.blocos.count()).toBe(14)
    expect(await t.consultas.meta<string>('instalacaoId')).toBe(instalacao)
    expect((await t.consultas.condominio())?.nome).toBe('Residencial Teste')
  })

  it('grava e lê Blob (round-trip)', async () => {
    t = criarBancoTeste()
    const blob = new Blob(['comprovante ção'], { type: 'text/plain' })
    await t.db.anexosBlob.put({ id: 'b1', blob })
    const lido = await t.db.anexosBlob.get('b1')
    expect(await lido?.blob.text()).toBe('comprovante ção')
    expect(lido?.blob.type).toBe('text/plain')
  })

  it('apagarTudo volta ao seed e marcarBackupFeito zera o contador', async () => {
    t = criarBancoTeste()
    const cat = await t.categoriaId('Água e esgoto')
    await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', data: '2026-09-10', valorCentavos: 1000, descricao: 'x', categoriaId: cat, escopoTipo: 'GERAL' })
    expect((await t.servicos.sistema.estadoBackup()).alteracoesDesdeBackup).toBe(1)
    await t.servicos.sistema.marcarBackupFeito()
    expect(await t.servicos.sistema.estadoBackup()).toEqual({ ultimoBackupEm: '2026-09-04T10:00:00', alteracoesDesdeBackup: 0 })
    await t.servicos.sistema.apagarTudo()
    expect(await t.db.lancamentos.count()).toBe(0)
    expect(await t.db.blocos.count()).toBe(14)
    expect(await t.servicos.sistema.onboardingConcluido()).toBe(false)
  })
  it('marcar backup preserva alterações posteriores ao snapshot e ignora uma instalação substituída', async () => {
    t = criarBancoTeste()
    await t.servicos.estrutura.atualizarCondominio({ nome: 'Nome no backup', diaVencimento: 10 })
    const snapshot = { instalacaoId: (await t.consultas.meta<string>('instalacaoId'))!, geradoEm: t.relogio.agora(), ultimaAuditoria: (await t.db.auditoria.orderBy('seq').last())!.seq! }
    await t.servicos.estrutura.atualizarCondominio({ nome: 'Nome depois do backup', diaVencimento: 10 })
    await t.servicos.sistema.marcarBackupFeito(snapshot)
    expect((await t.servicos.sistema.estadoBackup()).alteracoesDesdeBackup).toBe(1)
    await t.servicos.sistema.apagarTudo()
    const estadoNovo = await t.servicos.sistema.estadoBackup()
    await t.servicos.sistema.marcarBackupFeito(snapshot)
    expect(await t.servicos.sistema.estadoBackup()).toEqual(estadoNovo)
  })
})
