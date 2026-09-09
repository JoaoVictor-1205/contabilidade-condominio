import { describe, expect, it } from 'vitest'
import type { FormaPagamento } from './tipos'
import { ErroDominio, ehErroDominio } from './erros'
import {
  analisarColagemUnidades,
  exigirValido,
  mensagensDe,
  validarDadosBloco,
  validarDadosCategoria,
  validarDadosCondominio,
  validarDadosDocumento,
  validarDadosPagamento,
  validarDadosUnidade,
  validarNovaTaxa,
  validarNovaTransferencia,
  validarNovoLancamento,
  validarPatchLancamento,
  type Resultado,
} from './validacao'

/** Mensagem do campo (ou undefined se o campo não tem erro). */
function erroDe(r: Resultado<unknown>, campo: string): string | undefined {
  if (r.ok) return undefined
  return r.erros.find((e) => e.campo === campo)?.mensagem
}

function camposComErro(r: Resultado<unknown>): string[] {
  return r.ok ? [] : r.erros.map((e) => e.campo)
}

function esperarOk<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(`Esperava ok, veio: ${JSON.stringify(r.erros)}`)
  return r.valor
}

const RE_INGLES = /invalid input|expected|received|required|must be/i

function esperarMensagensEmPortugues(r: Resultado<unknown>): void {
  expect(r.ok).toBe(false)
  for (const m of mensagensDe(r)) expect(m).not.toMatch(RE_INGLES)
}

// ---------------------------------------------------------------------------

describe('ErroDominio', () => {
  it('é um Error com name, codigo, mensagem e detalhes', () => {
    const e = new ErroDominio('REGRA', 'Não permitido.', { id: 'x' })
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(ErroDominio)
    expect(e.name).toBe('ErroDominio')
    expect(e.codigo).toBe('REGRA')
    expect(e.message).toBe('Não permitido.')
    expect(e.detalhes).toEqual({ id: 'x' })
  })

  it('detalhes é opcional', () => {
    const e = new ErroDominio('NAO_ENCONTRADO', 'Bloco não encontrado.')
    expect(e.detalhes).toBeUndefined()
    expect(e.codigo).toBe('NAO_ENCONTRADO')
  })

  it('ehErroDominio reconhece instâncias e objetos com a mesma forma', () => {
    expect(ehErroDominio(new ErroDominio('VALIDACAO', 'x'))).toBe(true)
    expect(ehErroDominio({ name: 'ErroDominio', codigo: 'BACKUP', message: 'x' })).toBe(true)
  })

  it('ehErroDominio rejeita outros valores', () => {
    expect(ehErroDominio(new Error('x'))).toBe(false)
    expect(ehErroDominio(null)).toBe(false)
    expect(ehErroDominio(undefined)).toBe(false)
    expect(ehErroDominio('ErroDominio')).toBe(false)
    expect(ehErroDominio({ name: 'ErroDominio' })).toBe(false)
  })

  it('funciona com try/catch e narrowing', () => {
    try {
      throw new ErroDominio('COBRANCA_ESTADO', 'Cobrança já paga.')
    } catch (e) {
      expect(ehErroDominio(e)).toBe(true)
      if (ehErroDominio(e)) expect(e.codigo).toBe('COBRANCA_ESTADO')
    }
  })
})

// ---------------------------------------------------------------------------

describe('mensagensDe / exigirValido', () => {
  it('mensagensDe devolve lista vazia quando ok', () => {
    expect(mensagensDe({ ok: true, valor: 1 })).toEqual([])
  })

  it('mensagensDe devolve as mensagens na ordem', () => {
    expect(mensagensDe({ ok: false, erros: [{ campo: 'a', mensagem: 'Um.' }, { campo: 'b', mensagem: 'Dois.' }] })).toEqual([
      'Um.',
      'Dois.',
    ])
  })

  it('exigirValido devolve o valor quando ok', () => {
    expect(exigirValido({ ok: true, valor: 'v' })).toBe('v')
  })

  it('exigirValido lança ErroDominio VALIDACAO com os erros em detalhes', () => {
    const erros = [{ campo: 'nome', mensagem: 'Informe o nome.' }]
    let capturado: unknown
    try {
      exigirValido({ ok: false, erros })
    } catch (e) {
      capturado = e
    }
    expect(ehErroDominio(capturado)).toBe(true)
    if (ehErroDominio(capturado)) {
      expect(capturado.codigo).toBe('VALIDACAO')
      expect(capturado.message).toBe('Informe o nome.')
      expect(capturado.detalhes).toEqual(erros)
    }
  })
})

// ---------------------------------------------------------------------------

const lancamentoGeral = {
  natureza: 'DESPESA',
  data: '2026-09-04',
  competencia: '2026-09',
  valorCentavos: 100_000,
  descricao: '  Conta de água  ',
  categoriaId: 'cat-agua',
  escopoTipo: 'GERAL',
  formaPagamento: 'PIX',
  observacoes: '',
}

describe('validarNovoLancamento', () => {
  it('aceita lançamento GERAL válido, com trim e observações vazias removidas', () => {
    const v = esperarOk(validarNovoLancamento({ ...lancamentoGeral, extra: 'ignorado' }))
    expect(v).toEqual({
      natureza: 'DESPESA',
      data: '2026-09-04',
      competencia: '2026-09',
      valorCentavos: 100_000,
      descricao: 'Conta de água',
      categoriaId: 'cat-agua',
      escopoTipo: 'GERAL',
      formaPagamento: 'PIX',
      observacoes: undefined,
    })
    expect('extra' in v).toBe(false)
  })

  it('aceita GERAL com blocoId/unidadeId null ou vazios', () => {
    expect(validarNovoLancamento({ ...lancamentoGeral, blocoId: null, unidadeId: '' }).ok).toBe(true)
  })

  it('aceita BLOCO válido sem competência e sem forma de pagamento', () => {
    const v = esperarOk(
      validarNovoLancamento({
        natureza: 'RECEITA',
        data: '2028-02-29',
        valorCentavos: 1,
        descricao: 'Aluguel do salão',
        categoriaId: 'cat',
        escopoTipo: 'BLOCO',
        blocoId: ' b1 ',
        formaPagamento: null,
      }),
    )
    expect(v.blocoId).toBe('b1')
    expect(v.competencia).toBeUndefined()
    expect(v.formaPagamento).toBeNull()
    expect('observacoes' in v).toBe(false)
  })

  it('aceita UNIDADE válido com ou sem blocoId', () => {
    const base = { ...lancamentoGeral, escopoTipo: 'UNIDADE', unidadeId: 'u1' }
    expect(validarNovoLancamento(base).ok).toBe(true)
    expect(validarNovoLancamento({ ...base, blocoId: 'b1' }).ok).toBe(true)
  })

  it('aceita todas as formas de pagamento', () => {
    const todas: Record<FormaPagamento, true> = {
      DINHEIRO: true,
      PIX: true,
      TRANSFERENCIA: true,
      BOLETO: true,
      CARTAO: true,
      CHEQUE: true,
      OUTRO: true,
    }
    for (const forma of Object.keys(todas)) {
      expect(validarNovoLancamento({ ...lancamentoGeral, formaPagamento: forma }).ok).toBe(true)
    }
  })

  it('rejeita natureza TRANSFERENCIA ou ausente', () => {
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, natureza: 'TRANSFERENCIA' }), 'natureza')).toBe(
      'A natureza deve ser receita ou despesa.',
    )
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, natureza: undefined }), 'natureza')).toBe(
      'A natureza deve ser receita ou despesa.',
    )
  })

  it('rejeita data inválida', () => {
    for (const data of ['2026-02-30', '04/09/2026', '', undefined, 20260904]) {
      expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, data }), 'data')).toBe('Informe uma data válida.')
    }
  })

  it('rejeita competência inválida, mas aceita ausente/vazia', () => {
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, competencia: '2026-13' }), 'competencia')).toBe(
      'Informe uma competência válida (mês/ano).',
    )
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, competencia: '09/2026' }), 'competencia')).toBeDefined()
    expect(validarNovoLancamento({ ...lancamentoGeral, competencia: undefined }).ok).toBe(true)
    expect(validarNovoLancamento({ ...lancamentoGeral, competencia: '' }).ok).toBe(true)
    expect(validarNovoLancamento({ ...lancamentoGeral, competencia: null }).ok).toBe(true)
  })

  it('rejeita valor zero, negativo, fracionário, texto ou ausente', () => {
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, valorCentavos: 0 }), 'valorCentavos')).toBe(
      'O valor deve ser maior que zero.',
    )
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, valorCentavos: -5 }), 'valorCentavos')).toBe(
      'O valor deve ser maior que zero.',
    )
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, valorCentavos: 10.5 }), 'valorCentavos')).toBe(
      'O valor deve ser em centavos inteiros.',
    )
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, valorCentavos: '100' }), 'valorCentavos')).toBe(
      'Informe o valor.',
    )
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, valorCentavos: undefined }), 'valorCentavos')).toBe(
      'Informe o valor.',
    )
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, valorCentavos: NaN }), 'valorCentavos')).toBeDefined()
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, valorCentavos: 1e20 }), 'valorCentavos')).toBeDefined()
  })

  it('rejeita descrição vazia ou longa', () => {
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, descricao: '   ' }), 'descricao')).toBe('Informe a descrição.')
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, descricao: undefined }), 'descricao')).toBe(
      'Informe a descrição.',
    )
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, descricao: 'a'.repeat(201) }), 'descricao')).toBe(
      'A descrição deve ter no máximo 200 caracteres.',
    )
    expect(validarNovoLancamento({ ...lancamentoGeral, descricao: 'a'.repeat(200) }).ok).toBe(true)
  })

  it('rejeita categoria ausente ou vazia', () => {
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, categoriaId: '' }), 'categoriaId')).toBe('Informe a categoria.')
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, categoriaId: undefined }), 'categoriaId')).toBe(
      'Informe a categoria.',
    )
  })

  it('rejeita escopo desconhecido', () => {
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, escopoTipo: 'TUDO' }), 'escopoTipo')).toBe(
      'Informe o escopo do lançamento.',
    )
  })

  it('rejeita forma de pagamento desconhecida', () => {
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, formaPagamento: 'VALE' }), 'formaPagamento')).toBe(
      'Forma de pagamento inválida.',
    )
  })

  it('rejeita observações longas', () => {
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, observacoes: 'x'.repeat(2001) }), 'observacoes')).toBe(
      'As observações devem ter no máximo 2000 caracteres.',
    )
  })

  it('escopo GERAL não aceita bloco nem unidade', () => {
    const r = validarNovoLancamento({ ...lancamentoGeral, blocoId: 'b1', unidadeId: 'u1' })
    expect(erroDe(r, 'blocoId')).toBe('Lançamento geral não pode ter bloco.')
    expect(erroDe(r, 'unidadeId')).toBe('Lançamento geral não pode ter unidade.')
  })

  it('escopo BLOCO exige bloco e não aceita unidade', () => {
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, escopoTipo: 'BLOCO' }), 'blocoId')).toBe('Informe o bloco.')
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, escopoTipo: 'BLOCO', blocoId: null }), 'blocoId')).toBe(
      'Informe o bloco.',
    )
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, escopoTipo: 'BLOCO', blocoId: '  ' }), 'blocoId')).toBe(
      'Informe o bloco.',
    )
    const r = validarNovoLancamento({ ...lancamentoGeral, escopoTipo: 'BLOCO', blocoId: 'b1', unidadeId: 'u1' })
    expect(erroDe(r, 'unidadeId')).toBe('Lançamento de bloco não pode ter unidade.')
    expect(erroDe(r, 'blocoId')).toBeUndefined()
  })

  it('escopo UNIDADE exige unidade', () => {
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, escopoTipo: 'UNIDADE' }), 'unidadeId')).toBe(
      'Informe a unidade.',
    )
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, escopoTipo: 'UNIDADE', unidadeId: '' }), 'unidadeId')).toBe(
      'Informe a unidade.',
    )
  })

  it('rejeita ids com tipo errado', () => {
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, blocoId: 7 }), 'blocoId')).toBe('Bloco inválido.')
    expect(erroDe(validarNovoLancamento({ ...lancamentoGeral, unidadeId: {} }), 'unidadeId')).toBe('Unidade inválida.')
  })

  it('entrada que não é objeto gera erro geral', () => {
    for (const x of [null, undefined, 'texto', 42, []]) {
      const r = validarNovoLancamento(x)
      expect(r.ok).toBe(false)
      expect(erroDe(r, '')).toBe('Dados do lançamento inválidos.')
    }
  })

  it('mantém uma mensagem por campo e todas em português', () => {
    const r = validarNovoLancamento({ natureza: 5, data: 5, valorCentavos: -1.5, descricao: 5, categoriaId: 5, escopoTipo: 5 })
    esperarMensagensEmPortugues(r)
    const campos = camposComErro(r)
    expect(new Set(campos).size).toBe(campos.length)
    expect(campos).toEqual(['natureza', 'data', 'valorCentavos', 'descricao', 'categoriaId', 'escopoTipo'])
  })
})

// ---------------------------------------------------------------------------

describe('validarPatchLancamento', () => {
  it('aceita patch vazio e patch parcial', () => {
    expect(esperarOk(validarPatchLancamento({}))).toEqual({})
    const v = esperarOk(validarPatchLancamento({ descricao: ' Nova ', valorCentavos: 5 }))
    expect(v).toEqual({ descricao: 'Nova', valorCentavos: 5 })
    expect('blocoId' in v).toBe(false)
    expect('formaPagamento' in v).toBe(false)
  })

  it('observações vazias no patch ficam presentes como undefined (limpeza ao mesclar)', () => {
    const v = esperarOk(validarPatchLancamento({ observacoes: '' }))
    expect('observacoes' in v).toBe(true)
    expect(v.observacoes).toBeUndefined()
  })

  it('valida os campos presentes', () => {
    expect(erroDe(validarPatchLancamento({ valorCentavos: 0 }), 'valorCentavos')).toBe('O valor deve ser maior que zero.')
    expect(erroDe(validarPatchLancamento({ data: '2026-00-01' }), 'data')).toBe('Informe uma data válida.')
    expect(erroDe(validarPatchLancamento({ descricao: ' ' }), 'descricao')).toBe('Informe a descrição.')
    expect(erroDe(validarPatchLancamento({ natureza: 'TRANSFERENCIA' }), 'natureza')).toBe(
      'A natureza deve ser receita ou despesa.',
    )
    expect(erroDe(validarPatchLancamento({ formaPagamento: 'X' }), 'formaPagamento')).toBe('Forma de pagamento inválida.')
  })

  it('confere escopo quando escopoTipo vem no patch', () => {
    expect(erroDe(validarPatchLancamento({ escopoTipo: 'GERAL', blocoId: 'b1' }), 'blocoId')).toBe(
      'Lançamento geral não pode ter bloco.',
    )
    expect(validarPatchLancamento({ escopoTipo: 'GERAL', blocoId: null, unidadeId: null }).ok).toBe(true)
    expect(validarPatchLancamento({ escopoTipo: 'BLOCO' }).ok).toBe(true) // bloco pode vir do lançamento atual
    expect(erroDe(validarPatchLancamento({ escopoTipo: 'BLOCO', blocoId: null }), 'blocoId')).toBe('Informe o bloco.')
    expect(erroDe(validarPatchLancamento({ escopoTipo: 'BLOCO', blocoId: 'b1', unidadeId: 'u1' }), 'unidadeId')).toBe(
      'Lançamento de bloco não pode ter unidade.',
    )
    expect(validarPatchLancamento({ escopoTipo: 'UNIDADE', unidadeId: 'u1' }).ok).toBe(true)
    expect(erroDe(validarPatchLancamento({ escopoTipo: 'UNIDADE', unidadeId: null }), 'unidadeId')).toBe(
      'Informe a unidade.',
    )
  })

  it('sem escopoTipo não confere coerência (fica para o serviço após mesclar)', () => {
    expect(validarPatchLancamento({ blocoId: 'b1', unidadeId: 'u1' }).ok).toBe(true)
  })

  it('entrada que não é objeto gera erro geral', () => {
    expect(erroDe(validarPatchLancamento('x'), '')).toBe('Dados do lançamento inválidos.')
  })
})

// ---------------------------------------------------------------------------

const transferencia = {
  data: '2026-09-04',
  valorCentavos: 5000,
  descricao: 'Cobrir despesa do 5A',
  blocoOrigemId: 'b1',
  blocoDestinoId: 'b2',
}

describe('validarNovaTransferencia', () => {
  it('aceita transferência válida', () => {
    const v = esperarOk(validarNovaTransferencia({ ...transferencia, competencia: '2026-08', observacoes: ' ok ' }))
    expect(v).toEqual({ ...transferencia, competencia: '2026-08', observacoes: 'ok' })
  })

  it('rejeita origem igual ao destino', () => {
    const r = validarNovaTransferencia({ ...transferencia, blocoDestinoId: 'b1' })
    expect(erroDe(r, 'blocoDestinoId')).toBe('O bloco de destino deve ser diferente do bloco de origem.')
    expect(camposComErro(r)).toEqual(['blocoDestinoId'])
  })

  it('rejeita origem/destino ausentes', () => {
    const r = validarNovaTransferencia({ ...transferencia, blocoOrigemId: '', blocoDestinoId: undefined })
    expect(erroDe(r, 'blocoOrigemId')).toBe('Informe o bloco de origem.')
    expect(erroDe(r, 'blocoDestinoId')).toBe('Informe o bloco de destino.')
  })

  it('rejeita valor, data, competência e descrição inválidos', () => {
    const r = validarNovaTransferencia({ ...transferencia, valorCentavos: 0, data: 'ontem', competencia: 'x', descricao: '' })
    expect(erroDe(r, 'valorCentavos')).toBe('O valor deve ser maior que zero.')
    expect(erroDe(r, 'data')).toBe('Informe uma data válida.')
    expect(erroDe(r, 'competencia')).toBe('Informe uma competência válida (mês/ano).')
    expect(erroDe(r, 'descricao')).toBe('Informe a descrição.')
    esperarMensagensEmPortugues(r)
  })

  it('entrada que não é objeto gera erro geral', () => {
    expect(erroDe(validarNovaTransferencia(null), '')).toBe('Dados da transferência inválidos.')
  })
})

// ---------------------------------------------------------------------------

describe('validarDadosCondominio', () => {
  it('aceita dados válidos com trim e opcionais vazios removidos', () => {
    const v = esperarOk(
      validarDadosCondominio({ nome: ' Residencial Vivências ', cnpj: '', endereco: ' Rua A, 1 ', sindico: null, diaVencimento: 10 }),
    )
    expect(v).toEqual({ nome: 'Residencial Vivências', cnpj: undefined, endereco: 'Rua A, 1', sindico: undefined, diaVencimento: 10 })
  })

  it('aceita o mínimo (nome e dia)', () => {
    expect(validarDadosCondominio({ nome: 'X', diaVencimento: 31 }).ok).toBe(true)
    expect(validarDadosCondominio({ nome: 'X', diaVencimento: 1 }).ok).toBe(true)
  })

  it('rejeita nome vazio ou longo', () => {
    expect(erroDe(validarDadosCondominio({ nome: '  ', diaVencimento: 10 }), 'nome')).toBe('Informe o nome.')
    expect(erroDe(validarDadosCondominio({ nome: 'a'.repeat(201), diaVencimento: 10 }), 'nome')).toBe(
      'O nome deve ter no máximo 200 caracteres.',
    )
  })

  it('rejeita dia de vencimento fora de 1..31, fracionário ou ausente', () => {
    expect(erroDe(validarDadosCondominio({ nome: 'X', diaVencimento: 0 }), 'diaVencimento')).toBe(
      'O dia de vencimento deve estar entre 1 e 31.',
    )
    expect(erroDe(validarDadosCondominio({ nome: 'X', diaVencimento: 32 }), 'diaVencimento')).toBe(
      'O dia de vencimento deve estar entre 1 e 31.',
    )
    expect(erroDe(validarDadosCondominio({ nome: 'X', diaVencimento: 10.5 }), 'diaVencimento')).toBe(
      'O dia de vencimento deve ser um número inteiro.',
    )
    expect(erroDe(validarDadosCondominio({ nome: 'X' }), 'diaVencimento')).toBe('Informe o dia de vencimento.')
    expect(erroDe(validarDadosCondominio({ nome: 'X', diaVencimento: '10' }), 'diaVencimento')).toBe(
      'Informe o dia de vencimento.',
    )
  })

  it('rejeita opcionais longos', () => {
    const r = validarDadosCondominio({
      nome: 'X',
      diaVencimento: 5,
      cnpj: '1'.repeat(21),
      endereco: 'e'.repeat(201),
      sindico: 's'.repeat(201),
    })
    expect(erroDe(r, 'cnpj')).toBe('O CNPJ deve ter no máximo 20 caracteres.')
    expect(erroDe(r, 'endereco')).toBe('O endereço deve ter no máximo 200 caracteres.')
    expect(erroDe(r, 'sindico')).toBe('O nome do síndico deve ter no máximo 200 caracteres.')
  })

  it('entrada que não é objeto gera erro geral', () => {
    expect(erroDe(validarDadosCondominio(1), '')).toBe('Dados do condomínio inválidos.')
  })
})

// ---------------------------------------------------------------------------

const bloco = { nome: '1A', quartos: 3, andares: 4, aptosPorAndar: 4 }

describe('validarDadosBloco', () => {
  it('aceita bloco mínimo e bloco com saldo inicial negativo', () => {
    expect(esperarOk(validarDadosBloco(bloco))).toEqual(bloco)
    const v = esperarOk(validarDadosBloco({ ...bloco, saldoInicialCentavos: -1500, dataSaldoInicial: '2026-01-01' }))
    expect(v.saldoInicialCentavos).toBe(-1500)
    expect(v.dataSaldoInicial).toBe('2026-01-01')
  })

  it('aceita saldo inicial zero e opcionais vazios', () => {
    const v = esperarOk(validarDadosBloco({ ...bloco, saldoInicialCentavos: 0, dataSaldoInicial: '' }))
    expect(v.saldoInicialCentavos).toBe(0)
    expect(v.dataSaldoInicial).toBeUndefined()
  })

  it('aceita os limites das faixas', () => {
    expect(validarDadosBloco({ nome: 'X', quartos: 1, andares: 1, aptosPorAndar: 1 }).ok).toBe(true)
    expect(validarDadosBloco({ nome: 'X', quartos: 10, andares: 50, aptosPorAndar: 99 }).ok).toBe(true)
  })

  it('rejeita nome vazio', () => {
    expect(erroDe(validarDadosBloco({ ...bloco, nome: '' }), 'nome')).toBe('Informe o nome.')
  })

  it('rejeita quartos fora de 1..10', () => {
    expect(erroDe(validarDadosBloco({ ...bloco, quartos: 0 }), 'quartos')).toBe('O número de quartos deve estar entre 1 e 10.')
    expect(erroDe(validarDadosBloco({ ...bloco, quartos: 11 }), 'quartos')).toBe('O número de quartos deve estar entre 1 e 10.')
    expect(erroDe(validarDadosBloco({ ...bloco, quartos: 2.5 }), 'quartos')).toBe('O número de quartos deve ser um número inteiro.')
    expect(erroDe(validarDadosBloco({ ...bloco, quartos: undefined }), 'quartos')).toBe('Informe o número de quartos.')
  })

  it('rejeita andares fora de 1..50', () => {
    expect(erroDe(validarDadosBloco({ ...bloco, andares: 0 }), 'andares')).toBe('O número de andares deve estar entre 1 e 50.')
    expect(erroDe(validarDadosBloco({ ...bloco, andares: 51 }), 'andares')).toBe('O número de andares deve estar entre 1 e 50.')
    expect(erroDe(validarDadosBloco({ ...bloco, andares: '4' }), 'andares')).toBe('Informe o número de andares.')
  })

  it('rejeita apartamentos por andar fora de 1..99', () => {
    expect(erroDe(validarDadosBloco({ ...bloco, aptosPorAndar: 0 }), 'aptosPorAndar')).toBe(
      'O número de apartamentos por andar deve estar entre 1 e 99.',
    )
    expect(erroDe(validarDadosBloco({ ...bloco, aptosPorAndar: 100 }), 'aptosPorAndar')).toBe(
      'O número de apartamentos por andar deve estar entre 1 e 99.',
    )
    expect(erroDe(validarDadosBloco({ ...bloco, aptosPorAndar: 1.5 }), 'aptosPorAndar')).toBe(
      'O número de apartamentos por andar deve ser um número inteiro.',
    )
  })

  it('rejeita saldo inicial fracionário e data inválida', () => {
    expect(erroDe(validarDadosBloco({ ...bloco, saldoInicialCentavos: 10.5 }), 'saldoInicialCentavos')).toBe(
      'O saldo inicial deve ser em centavos inteiros.',
    )
    expect(erroDe(validarDadosBloco({ ...bloco, saldoInicialCentavos: '10' }), 'saldoInicialCentavos')).toBe(
      'Informe o saldo inicial.',
    )
    expect(erroDe(validarDadosBloco({ ...bloco, dataSaldoInicial: '2026-04-31' }), 'dataSaldoInicial')).toBe(
      'Informe uma data válida.',
    )
  })

  it('entrada que não é objeto gera erro geral', () => {
    expect(erroDe(validarDadosBloco([]), '')).toBe('Dados do bloco inválidos.')
  })
})

// ---------------------------------------------------------------------------

describe('validarDadosUnidade', () => {
  it('aceita objeto vazio e dados completos com trim', () => {
    expect(esperarOk(validarDadosUnidade({}))).toEqual({})
    const v = esperarOk(
      validarDadosUnidade({
        responsavel: ' Maria ',
        telefone: ' (47) 99999-0000 ',
        email: ' maria@exemplo.com ',
        isenta: true,
        observacoes: 'zeladora',
      }),
    )
    expect(v).toEqual({
      responsavel: 'Maria',
      telefone: '(47) 99999-0000',
      email: 'maria@exemplo.com',
      isenta: true,
      observacoes: 'zeladora',
    })
  })

  it('campos vazios, só com espaços ou null viram undefined', () => {
    const v = esperarOk(validarDadosUnidade({ responsavel: '   ', telefone: null, email: '  ', isenta: null, observacoes: '' }))
    expect(v.responsavel).toBeUndefined()
    expect(v.telefone).toBeUndefined()
    expect(v.email).toBeUndefined()
    expect(v.isenta).toBeUndefined()
    expect(v.observacoes).toBeUndefined()
  })

  it('rejeita e-mail em formato inválido', () => {
    for (const email of ['maria', 'maria@', '@exemplo.com', 'maria@exemplo', 'ma ria@exemplo.com', 42]) {
      expect(erroDe(validarDadosUnidade({ email }), 'email')).toBe('Informe um e-mail válido.')
    }
  })

  it('rejeita isenta que não é booleano', () => {
    expect(erroDe(validarDadosUnidade({ isenta: 'sim' }), 'isenta')).toBe('Isenção inválida (use sim ou não).')
    expect(erroDe(validarDadosUnidade({ isenta: 1 }), 'isenta')).toBe('Isenção inválida (use sim ou não).')
  })

  it('rejeita textos longos', () => {
    const r = validarDadosUnidade({ responsavel: 'r'.repeat(201), telefone: '9'.repeat(31), observacoes: 'o'.repeat(2001) })
    expect(erroDe(r, 'responsavel')).toBe('O responsável deve ter no máximo 200 caracteres.')
    expect(erroDe(r, 'telefone')).toBe('O telefone deve ter no máximo 30 caracteres.')
    expect(erroDe(r, 'observacoes')).toBe('As observações devem ter no máximo 2000 caracteres.')
  })

  it('rejeita texto com tipo errado', () => {
    const r = validarDadosUnidade({ responsavel: 5 })
    expect(erroDe(r, 'responsavel')).toBe('Texto inválido.')
    esperarMensagensEmPortugues(r)
  })

  it('entrada que não é objeto gera erro geral', () => {
    expect(erroDe(validarDadosUnidade('x'), '')).toBe('Dados da unidade inválidos.')
  })
})

// ---------------------------------------------------------------------------

describe('validarNovaTaxa', () => {
  it('aceita taxa válida', () => {
    expect(esperarOk(validarNovaTaxa({ quartos: 2, valorCentavos: 35_000, vigenteDesde: '2026-09' }))).toEqual({
      quartos: 2,
      valorCentavos: 35_000,
      vigenteDesde: '2026-09',
    })
  })

  it('rejeita quartos fora da faixa', () => {
    expect(erroDe(validarNovaTaxa({ quartos: 0, valorCentavos: 1, vigenteDesde: '2026-09' }), 'quartos')).toBe(
      'O número de quartos deve estar entre 1 e 10.',
    )
    expect(erroDe(validarNovaTaxa({ quartos: 11, valorCentavos: 1, vigenteDesde: '2026-09' }), 'quartos')).toBe(
      'O número de quartos deve estar entre 1 e 10.',
    )
  })

  it('rejeita valor zero, negativo ou fracionário', () => {
    expect(erroDe(validarNovaTaxa({ quartos: 2, valorCentavos: 0, vigenteDesde: '2026-09' }), 'valorCentavos')).toBe(
      'O valor deve ser maior que zero.',
    )
    expect(erroDe(validarNovaTaxa({ quartos: 2, valorCentavos: -1, vigenteDesde: '2026-09' }), 'valorCentavos')).toBe(
      'O valor deve ser maior que zero.',
    )
    expect(erroDe(validarNovaTaxa({ quartos: 2, valorCentavos: 0.5, vigenteDesde: '2026-09' }), 'valorCentavos')).toBe(
      'O valor deve ser em centavos inteiros.',
    )
  })

  it('rejeita vigência inválida ou ausente', () => {
    expect(erroDe(validarNovaTaxa({ quartos: 2, valorCentavos: 1, vigenteDesde: '2026-09-01' }), 'vigenteDesde')).toBe(
      'Informe uma competência válida (mês/ano).',
    )
    expect(erroDe(validarNovaTaxa({ quartos: 2, valorCentavos: 1 }), 'vigenteDesde')).toBe(
      'Informe uma competência válida (mês/ano).',
    )
  })

  it('entrada que não é objeto gera erro geral', () => {
    expect(erroDe(validarNovaTaxa(undefined), '')).toBe('Dados da taxa inválidos.')
  })
})

// ---------------------------------------------------------------------------

describe('validarDadosPagamento', () => {
  it('aceita pagamento mínimo (valor e juros default no serviço)', () => {
    const v = esperarOk(validarDadosPagamento({ data: '2026-09-10', formaPagamento: 'DINHEIRO' }))
    expect(v).toEqual({ data: '2026-09-10', formaPagamento: 'DINHEIRO' })
    expect('valorCentavos' in v).toBe(false)
  })

  it('aceita pagamento completo, com juros zero', () => {
    const v = esperarOk(
      validarDadosPagamento({
        data: '2026-09-10',
        valorCentavos: 30_000,
        formaPagamento: 'PIX',
        jurosCentavos: 0,
        observacoes: ' desconto combinado ',
      }),
    )
    expect(v).toEqual({
      data: '2026-09-10',
      valorCentavos: 30_000,
      formaPagamento: 'PIX',
      jurosCentavos: 0,
      observacoes: 'desconto combinado',
    })
  })

  it('aceita juros positivos e trata vazio como ausente', () => {
    expect(esperarOk(validarDadosPagamento({ data: '2026-09-10', formaPagamento: 'PIX', jurosCentavos: 250 })).jurosCentavos).toBe(250)
    const v = esperarOk(validarDadosPagamento({ data: '2026-09-10', formaPagamento: 'PIX', jurosCentavos: '', valorCentavos: null }))
    expect(v.jurosCentavos).toBeUndefined()
    expect(v.valorCentavos).toBeUndefined()
  })

  it('rejeita valor zero ou fracionário', () => {
    expect(erroDe(validarDadosPagamento({ data: '2026-09-10', formaPagamento: 'PIX', valorCentavos: 0 }), 'valorCentavos')).toBe(
      'O valor deve ser maior que zero.',
    )
    expect(erroDe(validarDadosPagamento({ data: '2026-09-10', formaPagamento: 'PIX', valorCentavos: 1.1 }), 'valorCentavos')).toBe(
      'O valor deve ser em centavos inteiros.',
    )
  })

  it('rejeita juros negativos ou fracionários', () => {
    expect(erroDe(validarDadosPagamento({ data: '2026-09-10', formaPagamento: 'PIX', jurosCentavos: -1 }), 'jurosCentavos')).toBe(
      'Os juros não podem ser negativos.',
    )
    expect(erroDe(validarDadosPagamento({ data: '2026-09-10', formaPagamento: 'PIX', jurosCentavos: 1.5 }), 'jurosCentavos')).toBe(
      'Os juros devem ser em centavos inteiros.',
    )
    expect(erroDe(validarDadosPagamento({ data: '2026-09-10', formaPagamento: 'PIX', jurosCentavos: 'x' }), 'jurosCentavos')).toBe(
      'Informe os juros.',
    )
  })

  it('rejeita forma de pagamento ausente ou desconhecida', () => {
    expect(erroDe(validarDadosPagamento({ data: '2026-09-10' }), 'formaPagamento')).toBe('Forma de pagamento inválida.')
    expect(erroDe(validarDadosPagamento({ data: '2026-09-10', formaPagamento: 'null' }), 'formaPagamento')).toBe(
      'Forma de pagamento inválida.',
    )
  })

  it('rejeita data inválida', () => {
    expect(erroDe(validarDadosPagamento({ data: '10/09/2026', formaPagamento: 'PIX' }), 'data')).toBe('Informe uma data válida.')
  })

  it('entrada que não é objeto gera erro geral', () => {
    expect(erroDe(validarDadosPagamento(null), '')).toBe('Dados do pagamento inválidos.')
  })
})

// ---------------------------------------------------------------------------

describe('validarDadosDocumento', () => {
  it('aceita documento válido', () => {
    const v = esperarOk(validarDadosDocumento({ titulo: ' Ata da assembleia ', categoria: 'ATA', data: '2026-03-15', descricao: '' }))
    expect(v).toEqual({ titulo: 'Ata da assembleia', categoria: 'ATA', data: '2026-03-15', descricao: undefined })
  })

  it('aceita todas as categorias de documento', () => {
    for (const categoria of ['ATA', 'CONVENCAO', 'REGIMENTO', 'CONTRATO', 'ORCAMENTO', 'OUTRO']) {
      expect(validarDadosDocumento({ titulo: 'x', categoria, data: '2026-01-01' }).ok).toBe(true)
    }
  })

  it('rejeita título vazio ou longo', () => {
    expect(erroDe(validarDadosDocumento({ titulo: ' ', categoria: 'ATA', data: '2026-01-01' }), 'titulo')).toBe('Informe o título.')
    expect(erroDe(validarDadosDocumento({ titulo: 't'.repeat(201), categoria: 'ATA', data: '2026-01-01' }), 'titulo')).toBe(
      'O título deve ter no máximo 200 caracteres.',
    )
  })

  it('rejeita categoria desconhecida ou ausente', () => {
    expect(erroDe(validarDadosDocumento({ titulo: 'x', categoria: 'FOTO', data: '2026-01-01' }), 'categoria')).toBe(
      'Categoria do documento inválida.',
    )
    expect(erroDe(validarDadosDocumento({ titulo: 'x', data: '2026-01-01' }), 'categoria')).toBe(
      'Categoria do documento inválida.',
    )
  })

  it('rejeita data inválida e descrição longa', () => {
    const r = validarDadosDocumento({ titulo: 'x', categoria: 'ATA', data: '2026-1-1', descricao: 'd'.repeat(2001) })
    expect(erroDe(r, 'data')).toBe('Informe uma data válida.')
    expect(erroDe(r, 'descricao')).toBe('A descrição deve ter no máximo 2000 caracteres.')
  })

  it('entrada que não é objeto gera erro geral', () => {
    expect(erroDe(validarDadosDocumento(0), '')).toBe('Dados do documento inválidos.')
  })
})

// ---------------------------------------------------------------------------

describe('validarDadosCategoria', () => {
  it('aceita categorias de receita e de despesa', () => {
    expect(esperarOk(validarDadosCategoria({ nome: ' Taxa extra ', natureza: 'RECEITA' }))).toEqual({
      nome: 'Taxa extra',
      natureza: 'RECEITA',
    })
    expect(validarDadosCategoria({ nome: 'Jardinagem', natureza: 'DESPESA' }).ok).toBe(true)
  })

  it('rejeita natureza TRANSFERENCIA (exclusiva do sistema), desconhecida ou ausente', () => {
    expect(erroDe(validarDadosCategoria({ nome: 'x', natureza: 'TRANSFERENCIA' }), 'natureza')).toBe(
      'A categoria deve ser de receita ou de despesa.',
    )
    expect(erroDe(validarDadosCategoria({ nome: 'x', natureza: 'OUTRA' }), 'natureza')).toBe(
      'A categoria deve ser de receita ou de despesa.',
    )
    expect(erroDe(validarDadosCategoria({ nome: 'x' }), 'natureza')).toBe('A categoria deve ser de receita ou de despesa.')
  })

  it('rejeita nome vazio ou longo', () => {
    expect(erroDe(validarDadosCategoria({ nome: '', natureza: 'RECEITA' }), 'nome')).toBe('Informe o nome.')
    expect(erroDe(validarDadosCategoria({ nome: 'n'.repeat(201), natureza: 'RECEITA' }), 'nome')).toBe(
      'O nome deve ter no máximo 200 caracteres.',
    )
  })

  it('entrada que não é objeto gera erro geral', () => {
    expect(erroDe(validarDadosCategoria('x'), '')).toBe('Dados da categoria inválidos.')
  })
})

// ---------------------------------------------------------------------------

describe('analisarColagemUnidades', () => {
  it('lê colunas separadas por TAB', () => {
    const r = analisarColagemUnidades('101\tMaria\t(47) 99999-0000\tmaria@exemplo.com\n102\tJoão')
    expect(r.erros).toEqual([])
    expect(r.linhas).toEqual([
      { numero: '101', responsavel: 'Maria', telefone: '(47) 99999-0000', email: 'maria@exemplo.com' },
      { numero: '102', responsavel: 'João' },
    ])
  })

  it('lê colunas separadas por ; quando não há TAB', () => {
    const r = analisarColagemUnidades('101;Maria;;maria@exemplo.com\n102;;4799990000')
    expect(r.erros).toEqual([])
    expect(r.linhas).toEqual([
      { numero: '101', responsavel: 'Maria', email: 'maria@exemplo.com' },
      { numero: '102', telefone: '4799990000' },
    ])
  })

  it('ignora a linha de cabeçalho quando a 1ª coluna não é numérica', () => {
    const r = analisarColagemUnidades('Apto\tResponsável\tTelefone\tE-mail\n101\tMaria')
    expect(r.erros).toEqual([])
    expect(r.linhas).toEqual([{ numero: '101', responsavel: 'Maria' }])
  })

  it('não trata a 1ª linha como cabeçalho quando ela é numérica', () => {
    const r = analisarColagemUnidades('101\tMaria\n102\tJoão')
    expect(r.linhas).toHaveLength(2)
  })

  it('ignora linhas vazias, só com espaços ou só com separadores (inclusive CRLF)', () => {
    const r = analisarColagemUnidades('\r\n101\tMaria\r\n   \r\n\t\t\r\n102\tJoão\r\n\r\n')
    expect(r.erros).toEqual([])
    expect(r.linhas.map((l) => l.numero)).toEqual(['101', '102'])
  })

  it('só a primeira linha com conteúdo pode ser cabeçalho; as demais não numéricas viram erro', () => {
    const r = analisarColagemUnidades('Apto\tNome\n101\tMaria\nabc\tJoão\n\tSem número\n103\tAna')
    expect(r.linhas.map((l) => l.numero)).toEqual(['101', '103'])
    expect(r.erros).toEqual([
      'Linha 3: número da unidade inválido ("abc").',
      'Linha 4: número da unidade ausente.',
    ])
  })

  it('numera as linhas pela posição no texto original (contando vazias e cabeçalho)', () => {
    const r = analisarColagemUnidades('\n\nApto\n101\n\nx')
    expect(r.linhas).toEqual([{ numero: '101' }])
    expect(r.erros).toEqual(['Linha 6: número da unidade inválido ("x").'])
  })

  it('reporta e-mail inválido com o número da linha e exclui a linha', () => {
    const r = analisarColagemUnidades('101\tMaria\t\tmaria\n102\tJoão\t\tjoao@exemplo.com')
    expect(r.linhas).toEqual([{ numero: '102', responsavel: 'João', email: 'joao@exemplo.com' }])
    expect(r.erros).toEqual(['Linha 1: Informe um e-mail válido.'])
  })

  it('reporta texto longo com o número da linha', () => {
    const r = analisarColagemUnidades(`101\t${'m'.repeat(201)}`)
    expect(r.linhas).toEqual([])
    expect(r.erros).toEqual(['Linha 1: O responsável deve ter no máximo 200 caracteres.'])
  })

  it('reporta número repetido', () => {
    const r = analisarColagemUnidades('101\tMaria\n102\tJoão\n101\tAna')
    expect(r.linhas.map((l) => l.numero)).toEqual(['101', '102'])
    expect(r.erros).toEqual(['Linha 3: número 101 repetido (já informado na linha 1).'])
  })

  it('ignora colunas extras e aplica trim', () => {
    const r = analisarColagemUnidades('  101 \t Maria \t\t\tobs extra')
    expect(r.linhas).toEqual([{ numero: '101', responsavel: 'Maria' }])
  })

  it('texto vazio ou só cabeçalho resulta em nada', () => {
    expect(analisarColagemUnidades('')).toEqual({ linhas: [], erros: [] })
    expect(analisarColagemUnidades('Apto;Nome\n')).toEqual({ linhas: [], erros: [] })
  })

  it('linha com apenas o número é válida', () => {
    expect(analisarColagemUnidades('101\n102')).toEqual({ linhas: [{ numero: '101' }, { numero: '102' }], erros: [] })
  })
})
