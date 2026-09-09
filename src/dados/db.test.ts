import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { BancoSindico } from './db'
import { gerarSeed } from '../dominio/seedPadrao'

it('migra banco v1 para v2 preservando lançamentos e preenchendo vínculos', async () => {
  const nome = `teste-migracao-${crypto.randomUUID()}`
  const legado = new Dexie(nome)
  legado.version(1).stores({
    condominio: 'id', blocos: 'id, ordem', unidades: 'id, blocoId, &[blocoId+numero]', taxas: 'id, quartos, &[quartos+vigenteDesde]', categorias: 'id, natureza, ordem',
    lancamentos: 'id, data, mes, competencia, status, natureza, escopoTipo, blocoId, unidadeId, blocoOrigemId, categoriaId, cobrancaId, [status+data], [status+competencia], [blocoId+data], [unidadeId+data]',
    anexos: 'id, [donoTipo+donoId]', anexosBlob: 'id', documentos: 'id, categoria, data',
    cobrancas: 'id, &[unidadeId+competencia], competencia, blocoId, unidadeId, status, vencimento, [competencia+status], [blocoId+competencia], [status+vencimento]', auditoria: '++seq, entidade, entidadeId, em', meta: 'chave',
  })
  const atual = new BancoSindico(nome)
  try {
    const seed = gerarSeed({ inicioContabil: '2026-09', agora: '2026-09-01T00:00:00' })
    await legado.table('condominio').add(seed.condominio)
    await legado.table('meta').put({ chave: 'schemaVersion', valor: 1 })
    await legado.table('lancamentos').add({ id: 'antigo', descricao: 'Registro preservado', valorCentavos: 12345 })
    legado.close()
    await atual.open()
    expect(atual.verno).toBe(2)
    expect(await atual.lancamentos.get('antigo')).toMatchObject({ id: 'antigo', descricao: 'Registro preservado', valorCentavos: 12345, tipo: 'NORMAL', estornaLancamentoId: null, estornadoPorId: null })
    expect(await atual.meta.get('schemaVersion')).toEqual({ chave: 'schemaVersion', valor: 2 })
    expect(await atual.fechamentos.count()).toBe(0)
    expect(await atual.condominio.get('unico')).toEqual(seed.condominio)
    expect(await atual.blocos.count()).toBe(0) // upgrade não reaplica seed
  } finally { legado.close(); await atual.delete() }
})
