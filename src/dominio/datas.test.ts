import { describe, expect, it } from 'vitest'
import {
  NOMES_MESES,
  adicionarDias,
  compararDatas,
  dataDeTextoBR,
  dataISODe,
  dataISODeTimestamp,
  dataNoPeriodo,
  diasEntre,
  diasNoMes,
  ehBissexto,
  ehDataISO,
  ehMesISO,
  formatarData,
  formatarMes,
  formatarMesCurto,
  mesAnterior,
  mesDe,
  mesDeTexto,
  mesSeguinte,
  mesesEntre,
  montarData,
  montarMes,
  partesDe,
  partesDoMes,
  periodoDoAno,
  periodoDoMes,
  primeiraDataDoMes,
  ultimaDataDoMes,
  ultimoDiaDoMes,
} from './datas'

describe('NOMES_MESES', () => {
  it('tem os 12 meses em português, de Janeiro a Dezembro', () => {
    expect(NOMES_MESES).toHaveLength(12)
    expect(NOMES_MESES[0]).toBe('Janeiro')
    expect(NOMES_MESES[2]).toBe('Março')
    expect(NOMES_MESES[11]).toBe('Dezembro')
  })
})

describe('ehBissexto', () => {
  it.each([
    [2024, true],
    [2023, false],
    [2026, false],
    [2000, true],
    [1900, false],
    [2100, false],
  ])('%i → %s', (ano, esperado) => {
    expect(ehBissexto(ano)).toBe(esperado)
  })
})

describe('diasNoMes', () => {
  it.each([
    [2024, 2, 29],
    [2023, 2, 28],
    [2026, 1, 31],
    [2026, 2, 28],
    [2026, 4, 30],
    [2026, 6, 30],
    [2026, 8, 31],
    [2026, 9, 30],
    [2026, 11, 30],
    [2026, 12, 31],
  ])('%i-%i tem %i dias', (ano, mes, esperado) => {
    expect(diasNoMes(ano, mes)).toBe(esperado)
  })
})

describe('ehDataISO', () => {
  it.each([['2026-09-04'], ['2024-02-29'], ['2000-02-29'], ['2026-01-01'], ['2026-12-31']])(
    'aceita %s',
    (s) => {
      expect(ehDataISO(s)).toBe(true)
    },
  )

  it.each([
    ['2023-02-29'],
    ['2026-13-01'],
    ['2026-00-10'],
    ['2026-9-4'],
    ['2026-04-31'],
    ['2026-09-00'],
    ['2026-09-32'],
    ['04/09/2026'],
    ['2026-09-04T00:00:00'],
    ['2026-09'],
    [''],
    ['abc'],
  ])('rejeita %j', (s) => {
    expect(ehDataISO(s)).toBe(false)
  })

  it('rejeita valores que não são string', () => {
    expect(ehDataISO(null)).toBe(false)
    expect(ehDataISO(undefined)).toBe(false)
    expect(ehDataISO(20260904)).toBe(false)
    expect(ehDataISO({})).toBe(false)
  })
})

describe('ehMesISO', () => {
  it.each([['2026-09'], ['2026-01'], ['2026-12']])('aceita %s', (s) => {
    expect(ehMesISO(s)).toBe(true)
  })

  it.each([['2026-13'], ['2026-00'], ['2026-9'], ['2026-09-04'], ['09/2026'], [''], ['abc']])(
    'rejeita %j',
    (s) => {
      expect(ehMesISO(s)).toBe(false)
    },
  )

  it('rejeita valores que não são string', () => {
    expect(ehMesISO(null)).toBe(false)
    expect(ehMesISO(undefined)).toBe(false)
    expect(ehMesISO(202609)).toBe(false)
  })
})

describe('partesDe, partesDoMes, montarData e montarMes', () => {
  it('decompõe data e mês', () => {
    expect(partesDe('2026-09-04')).toEqual({ ano: 2026, mes: 9, dia: 4 })
    expect(partesDoMes('2026-09')).toEqual({ ano: 2026, mes: 9 })
  })

  it('monta com zeros à esquerda', () => {
    expect(montarData(2026, 9, 4)).toBe('2026-09-04')
    expect(montarData(999, 1, 1)).toBe('0999-01-01')
    expect(montarMes(2026, 9)).toBe('2026-09')
    expect(montarMes(2026, 12)).toBe('2026-12')
  })

  it('faz ida e volta', () => {
    for (const d of ['2026-09-04', '2024-02-29', '2025-12-31', '2026-01-01']) {
      const p = partesDe(d)
      expect(montarData(p.ano, p.mes, p.dia)).toBe(d)
    }
    for (const m of ['2026-09', '2025-12', '2026-01']) {
      const p = partesDoMes(m)
      expect(montarMes(p.ano, p.mes)).toBe(m)
    }
  })
})

describe('mesDe', () => {
  it('extrai o mês da data', () => {
    expect(mesDe('2026-09-04')).toBe('2026-09')
    expect(mesDe('2025-12-31')).toBe('2025-12')
  })
})

describe('ultimoDiaDoMes, primeiraDataDoMes e ultimaDataDoMes', () => {
  it.each([
    ['2024-02', 29],
    ['2026-02', 28],
    ['2026-04', 30],
    ['2026-12', 31],
    ['1900-02', 28],
    ['2000-02', 29],
  ])('último dia de %s é %i', (mes, esperado) => {
    expect(ultimoDiaDoMes(mes)).toBe(esperado)
  })

  it('monta a primeira e a última data do mês', () => {
    expect(primeiraDataDoMes('2026-09')).toBe('2026-09-01')
    expect(ultimaDataDoMes('2026-09')).toBe('2026-09-30')
    expect(ultimaDataDoMes('2024-02')).toBe('2024-02-29')
    expect(ultimaDataDoMes('2026-02')).toBe('2026-02-28')
  })
})

describe('mesAnterior e mesSeguinte', () => {
  it('vira o ano para trás', () => {
    expect(mesAnterior('2026-01')).toBe('2025-12')
    expect(mesAnterior('2026-09')).toBe('2026-08')
    expect(mesAnterior('2026-12')).toBe('2026-11')
  })

  it('vira o ano para a frente', () => {
    expect(mesSeguinte('2026-12')).toBe('2027-01')
    expect(mesSeguinte('2026-09')).toBe('2026-10')
    expect(mesSeguinte('2026-01')).toBe('2026-02')
  })

  it('são inversos', () => {
    for (const m of ['2026-01', '2026-06', '2026-12', '2024-02']) {
      expect(mesSeguinte(mesAnterior(m))).toBe(m)
      expect(mesAnterior(mesSeguinte(m))).toBe(m)
    }
  })
})

describe('mesesEntre', () => {
  it('lista inclusive, atravessando a virada de ano', () => {
    expect(mesesEntre('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })

  it('devolve um único mês quando de === ate', () => {
    expect(mesesEntre('2026-09', '2026-09')).toEqual(['2026-09'])
  })

  it('devolve vazio quando de > ate', () => {
    expect(mesesEntre('2026-10', '2026-09')).toEqual([])
    expect(mesesEntre('2027-01', '2026-12')).toEqual([])
  })

  it('lista o ano inteiro', () => {
    const ano = mesesEntre('2026-01', '2026-12')
    expect(ano).toHaveLength(12)
    expect(ano[0]).toBe('2026-01')
    expect(ano[11]).toBe('2026-12')
  })
})

describe('periodoDoMes e periodoDoAno', () => {
  it('monta o período do mês respeitando o último dia', () => {
    expect(periodoDoMes('2026-02')).toEqual({ inicio: '2026-02-01', fim: '2026-02-28' })
    expect(periodoDoMes('2024-02')).toEqual({ inicio: '2024-02-01', fim: '2024-02-29' })
    expect(periodoDoMes('2026-09')).toEqual({ inicio: '2026-09-01', fim: '2026-09-30' })
  })

  it('monta o período do ano', () => {
    expect(periodoDoAno(2026)).toEqual({ inicio: '2026-01-01', fim: '2026-12-31' })
  })
})

describe('dataNoPeriodo', () => {
  const setembro = periodoDoMes('2026-09')

  it('inclui as bordas', () => {
    expect(dataNoPeriodo('2026-09-01', setembro)).toBe(true)
    expect(dataNoPeriodo('2026-09-15', setembro)).toBe(true)
    expect(dataNoPeriodo('2026-09-30', setembro)).toBe(true)
  })

  it('exclui datas fora', () => {
    expect(dataNoPeriodo('2026-08-31', setembro)).toBe(false)
    expect(dataNoPeriodo('2026-10-01', setembro)).toBe(false)
    expect(dataNoPeriodo('2025-09-15', setembro)).toBe(false)
  })
})

describe('compararDatas', () => {
  it('compara cronologicamente', () => {
    expect(compararDatas('2026-09-04', '2026-09-05')).toBe(-1)
    expect(compararDatas('2026-09-05', '2026-09-04')).toBe(1)
    expect(compararDatas('2026-09-04', '2026-09-04')).toBe(0)
    expect(compararDatas('2025-12-31', '2026-01-01')).toBe(-1)
  })

  it('serve como comparador de sort', () => {
    const datas = ['2026-10-01', '2025-12-31', '2026-01-15']
    expect([...datas].sort(compararDatas)).toEqual(['2025-12-31', '2026-01-15', '2026-10-01'])
  })
})

describe('diasEntre', () => {
  it.each([
    ['2025-11-01', '2025-11-02', 1], // virada de horário de verão não afeta
    ['2025-12-31', '2026-01-01', 1],
    ['2024-02-28', '2024-03-01', 2],
    ['2023-02-28', '2023-03-01', 1],
    ['2024-01-01', '2025-01-01', 366],
    ['2026-01-01', '2026-12-31', 364],
    ['2026-09-04', '2026-09-04', 0],
    ['2026-09-05', '2026-09-04', -1],
    ['2026-09-04', '2026-08-04', -31],
  ])('de %s até %s = %i', (a, b, esperado) => {
    expect(diasEntre(a, b)).toBe(esperado)
  })
})

describe('adicionarDias', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2024-03-01', -1, '2024-02-29'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2026-09-04', 0, '2026-09-04'],
    ['2026-09-04', 30, '2026-10-04'],
    ['2025-11-01', 1, '2025-11-02'],
    ['2026-09-04', -365, '2025-09-04'],
  ])('%s + %i dias = %s', (data, dias, esperado) => {
    expect(adicionarDias(data, dias)).toBe(esperado)
  })

  it('é coerente com diasEntre', () => {
    const base = '2026-09-04'
    for (const n of [-400, -31, -1, 0, 1, 28, 59, 365, 1000]) {
      expect(diasEntre(base, adicionarDias(base, n))).toBe(n)
    }
  })
})

describe('dataISODe', () => {
  it('usa a data local do Date (sem deslocar pelo fuso)', () => {
    expect(dataISODe(new Date(2026, 8, 4, 23, 59, 59))).toBe('2026-09-04')
    expect(dataISODe(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01')
    expect(dataISODe(new Date(2024, 1, 29, 12, 0, 0))).toBe('2024-02-29')
  })
})

describe('dataISODeTimestamp', () => {
  it('lê timestamps ISO locais sem deslocar o dia', () => {
    expect(dataISODeTimestamp('2026-09-04T10:00:00')).toBe('2026-09-04')
    expect(dataISODeTimestamp('2026-09-04T00:00:00')).toBe('2026-09-04')
    expect(dataISODeTimestamp('2026-09-04T23:59:59')).toBe('2026-09-04')
    expect(dataISODeTimestamp('2025-12-31T23:59:59.999')).toBe('2025-12-31')
  })
})

describe('formatarData', () => {
  it('formata como dd/mm/aaaa', () => {
    expect(formatarData('2026-09-04')).toBe('04/09/2026')
    expect(formatarData('2025-12-31')).toBe('31/12/2025')
    expect(formatarData('2026-01-01')).toBe('01/01/2026')
  })
})

describe('formatarMes e formatarMesCurto', () => {
  it('escreve o nome do mês por extenso', () => {
    expect(formatarMes('2026-09')).toBe('Setembro/2026')
    expect(formatarMes('2026-01')).toBe('Janeiro/2026')
    expect(formatarMes('2026-03')).toBe('Março/2026')
    expect(formatarMes('2026-12')).toBe('Dezembro/2026')
  })

  it('não quebra com mês fora da faixa', () => {
    expect(() => formatarMes('2026-13')).not.toThrow()
    expect(formatarMes('2026-13')).toContain('2026')
  })

  it('formata o mês curto como mm/aaaa', () => {
    expect(formatarMesCurto('2026-09')).toBe('09/2026')
    expect(formatarMesCurto('2026-12')).toBe('12/2026')
  })
})

describe('dataDeTextoBR', () => {
  it.each([
    ['4/9/2026', '2026-09-04'],
    ['04/09/2026', '2026-09-04'],
    ['29/02/2024', '2024-02-29'],
    ['31/12/2025', '2025-12-31'],
    ['  04/09/2026  ', '2026-09-04'],
  ])('interpreta %j como %s', (texto, esperado) => {
    expect(dataDeTextoBR(texto)).toBe(esperado)
  })

  it.each([
    ['31/02/2026'],
    ['29/02/2023'],
    ['04/09/26'],
    ['2026-09-04'],
    ['04-09-2026'],
    [''],
    ['0/9/2026'],
    ['32/01/2026'],
    ['04/13/2026'],
    ['abc'],
    ['04/09/2026x'],
  ])('devolve null para %j', (texto) => {
    expect(dataDeTextoBR(texto)).toBeNull()
  })

  it('faz ida e volta com formatarData', () => {
    for (const d of ['2026-09-04', '2024-02-29', '2025-12-31', '2026-01-01']) {
      expect(dataDeTextoBR(formatarData(d))).toBe(d)
    }
  })
})

describe('mesDeTexto', () => {
  it.each([
    ['9/2026', '2026-09'],
    ['09/2026', '2026-09'],
    ['12/2026', '2026-12'],
    ['2026-09', '2026-09'],
    ['  09/2026  ', '2026-09'],
  ])('interpreta %j como %s', (texto, esperado) => {
    expect(mesDeTexto(texto)).toBe(esperado)
  })

  it.each([['13/2026'], ['0/2026'], ['2026-13'], ['2026-9'], ['09/26'], ['09-2026'], ['2026/09'], [''], ['abc']])(
    'devolve null para %j',
    (texto) => {
      expect(mesDeTexto(texto)).toBeNull()
    },
  )

  it('faz ida e volta com formatarMesCurto', () => {
    for (const m of ['2026-09', '2025-12', '2026-01']) {
      expect(mesDeTexto(formatarMesCurto(m))).toBe(m)
    }
  })
})
