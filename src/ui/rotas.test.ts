import { describe, expect, it } from 'vitest'
import { lerRota, paraHash, type Rota } from './rotas'

describe('rotas por hash', () => {
  const casos: Rota[] = [
    { nome: 'inicio' },
    { nome: 'lancamentos' },
    { nome: 'lancamentoNovo' },
    { nome: 'lancamentoNovo', natureza: 'RECEITA' },
    { nome: 'lancamento', id: 'abc-123' },
    { nome: 'transferenciaNova' },
    { nome: 'cobrancas' },
    { nome: 'cobrancas', competencia: '2026-09' },
    { nome: 'inadimplencia' },
    { nome: 'unidades' },
    { nome: 'unidades', blocoId: 'b1', modo: 'tabela' },
    { nome: 'unidade', id: 'u1' },
    { nome: 'relatorios' },
    { nome: 'extratoUnidade', id: 'u2' },
    { nome: 'arquivo' },
    { nome: 'estrutura' },
    { nome: 'estrutura', aba: 'taxas' },
    { nome: 'backup' },
    { nome: 'avancado' },
    { nome: 'avancado', aba: 'fechamento' },
    { nome: 'avancado', aba: 'integridade' },
    { nome: 'avancado', aba: 'auditoria' },
    { nome: 'avancado', aba: 'manutencao' },
  ]

  it('paraHash e lerRota são inversos', () => {
    for (const r of casos) expect(lerRota(paraHash(r))).toEqual(r)
  })

  it('hash vazio, desconhecido ou malformado cai no início', () => {
    expect(lerRota('')).toEqual({ nome: 'inicio' })
    expect(lerRota('#/')).toEqual({ nome: 'inicio' })
    expect(lerRota('#/nada')).toEqual({ nome: 'inicio' })
    expect(lerRota('#/estrutura/xyz')).toEqual({ nome: 'estrutura' })
    expect(lerRota('#/lancamentos/novo?natureza=OUTRA')).toEqual({ nome: 'lancamentoNovo' })
    expect(lerRota('#/unidades?modo=errado')).toEqual({ nome: 'unidades' })
  })
})
