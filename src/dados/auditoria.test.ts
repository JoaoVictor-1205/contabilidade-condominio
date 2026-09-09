import { describe, expect, it } from 'vitest'
import { diferencas } from './auditoria'

describe('diferenças para auditoria', () => {
  it('registra somente os campos escolhidos que mudaram, preservando zero e false', () => {
    const antes = { valor: 100, isenta: true, descricao: 'Original', versao: 1 }
    const depois = { valor: 0, isenta: false, descricao: 'Original', versao: 2 }
    expect(diferencas(antes, depois, ['valor', 'isenta', 'descricao'])).toEqual({ valor: { de: 100, para: 0 }, isenta: { de: true, para: false } })
  })

  it('registra inclusão e remoção de campos opcionais como null no JSON', () => {
    const vazio: { observacoes?: string } = {}
    const preenchido = { observacoes: 'Conferido' }
    expect(JSON.parse(JSON.stringify(diferencas(vazio, preenchido, ['observacoes'])))).toEqual({ observacoes: { de: null, para: 'Conferido' } })
    expect(JSON.parse(JSON.stringify(diferencas(preenchido, vazio, ['observacoes'])))).toEqual({ observacoes: { de: 'Conferido', para: null } })
  })

  it('compara snapshots pelo conteúdo e omite alterações quando nada mudou', () => {
    const antes = { rateio: [{ blocoId: 'A', valor: 50 }, { blocoId: 'B', valor: 50 }] }
    expect(diferencas(antes, structuredClone(antes), ['rateio'])).toBeUndefined()
    const depois = { rateio: [{ blocoId: 'A', valor: 60 }, { blocoId: 'B', valor: 40 }] }
    expect(diferencas(antes, depois, ['rateio'])).toEqual({ rateio: { de: antes.rateio, para: depois.rateio } })
  })
})
