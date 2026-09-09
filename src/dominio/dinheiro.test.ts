import { describe, expect, it } from 'vitest'
import {
  centavosDeDigitos,
  centavosDeTexto,
  ehCentavos,
  formatarBRL,
  formatarValor,
  somarCentavos,
} from './dinheiro'

describe('ehCentavos', () => {
  it('aceita inteiros seguros, inclusive zero e negativos', () => {
    expect(ehCentavos(0)).toBe(true)
    expect(ehCentavos(1)).toBe(true)
    expect(ehCentavos(-500)).toBe(true)
    expect(ehCentavos(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it('rejeita fracionários, NaN, infinitos e não-números', () => {
    expect(ehCentavos(1.5)).toBe(false)
    expect(ehCentavos(NaN)).toBe(false)
    expect(ehCentavos(Infinity)).toBe(false)
    expect(ehCentavos(-Infinity)).toBe(false)
    expect(ehCentavos(2 ** 53)).toBe(false)
    expect(ehCentavos('100')).toBe(false)
    expect(ehCentavos(null)).toBe(false)
    expect(ehCentavos(undefined)).toBe(false)
  })
})

describe('formatarValor', () => {
  it.each([
    [0, '0,00'],
    [5, '0,05'],
    [99, '0,99'],
    [100, '1,00'],
    [1099, '10,99'],
    [100000, '1.000,00'],
    [123456, '1.234,56'],
    [100000000, '1.000.000,00'],
    [123456789, '1.234.567,89'],
  ])('formata %i como %s', (centavos, esperado) => {
    expect(formatarValor(centavos)).toBe(esperado)
  })

  it('formata negativos com o sinal na frente', () => {
    expect(formatarValor(-100)).toBe('-1,00')
    expect(formatarValor(-5)).toBe('-0,05')
    expect(formatarValor(-123456)).toBe('-1.234,56')
  })
})

describe('formatarBRL', () => {
  it.each([
    [0, 'R$ 0,00'],
    [5, 'R$ 0,05'],
    [100, 'R$ 1,00'],
    [123456, 'R$ 1.234,56'],
    [100000000, 'R$ 1.000.000,00'],
  ])('formata %i como %s', (centavos, esperado) => {
    expect(formatarBRL(centavos)).toBe(esperado)
  })

  it('coloca o sinal antes do símbolo em negativos', () => {
    expect(formatarBRL(-100)).toBe('-R$ 1,00')
    expect(formatarBRL(-5)).toBe('-R$ 0,05')
    expect(formatarBRL(-123456)).toBe('-R$ 1.234,56')
  })
})

describe('centavosDeTexto', () => {
  it.each([
    ['1.234,56', 123456],
    ['R$ 10', 1000],
    ['R$10', 1000],
    ['r$ 10', 1000],
    ['10,5', 1050],
    ['-3,20', -320],
    ['R$ -3,20', -320],
    ['1234.56', 123456],
    ['12.5', 1250],
    ['1.234', 123400],
    ['1.234.567', 123456700],
    ['1.234.567,89', 123456789],
    [',5', 50],
    ['0,5', 50],
    ['1.234,5', 123450],
    ['10', 1000],
    ['0', 0],
    ['1234567', 123456700],
    ['1 234,56', 123456],
    ['  R$ 1.234,56  ', 123456],
  ])('interpreta %j como %i', (texto, esperado) => {
    expect(centavosDeTexto(texto)).toBe(esperado)
  })

  it.each([
    ['abc'],
    [''],
    ['   '],
    ['R$'],
    ['1,234'],
    ['10,999'],
    ['1.2.3'],
    ['1,2,3'],
    ['1.234.56'],
    ['-'],
    ['--5'],
    ['+10'],
    ['1,5x'],
    [','],
  ])('devolve null para %j', (texto) => {
    expect(centavosDeTexto(texto)).toBeNull()
  })

  it('devolve null quando o valor ultrapassa o inteiro seguro', () => {
    expect(centavosDeTexto('99999999999999999,99')).toBeNull()
  })

  it('normaliza "-0" para zero (nunca devolve -0)', () => {
    expect(Object.is(centavosDeTexto('-0,00'), 0)).toBe(true)
    expect(Object.is(centavosDeTexto('-0'), 0)).toBe(true)
  })

  it('faz ida e volta com formatarValor e formatarBRL', () => {
    for (const c of [0, 1, 99, 100, 123456, 100000000, 987654321]) {
      expect(centavosDeTexto(formatarValor(c))).toBe(c)
      expect(centavosDeTexto(formatarBRL(c))).toBe(c)
    }
    for (const c of [1, 99, 100, 123456, 100000000]) {
      expect(centavosDeTexto(formatarValor(-c))).toBe(-c)
      expect(centavosDeTexto(formatarBRL(-c))).toBe(-c)
    }
  })
})

describe('centavosDeDigitos', () => {
  it.each([
    ['12345', 12345],
    ['00012', 12],
    ['R$ 1,2x', 12],
    ['', 0],
    ['abc', 0],
    ['0', 0],
    ['000', 0],
    ['1.234,56', 123456],
    ['R$ 1.000,00', 100000],
  ])('extrai os dígitos de %j como %i', (texto, esperado) => {
    expect(centavosDeDigitos(texto)).toBe(esperado)
  })

  it('satura no maior inteiro seguro', () => {
    expect(centavosDeDigitos('99999999999999999999')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('somarCentavos', () => {
  it('soma zero elementos como 0', () => {
    expect(somarCentavos([])).toBe(0)
  })

  it('soma positivos e negativos', () => {
    expect(somarCentavos([100, -30, 5])).toBe(75)
    expect(somarCentavos([-100, -200])).toBe(-300)
  })

  it('aceita qualquer iterável', () => {
    expect(somarCentavos(new Set([1, 2, 3]))).toBe(6)
    function* gerar(): Generator<number> {
      yield 10
      yield 20
    }
    expect(somarCentavos(gerar())).toBe(30)
  })
})
