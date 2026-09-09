import { describe, expect, it } from 'vitest'
import { dataEstaEmMesFechado, mesEstaFechado, podeReabrir, proximoMesAFechar, ultimoMesFechado } from './fechamento'
import type { Fechamento } from './tipos'
const f = (mes: string): Fechamento => ({ mes, fechadoEm: '2026-09-01T00:00:00', base: 'data', saldos: [], saldoGeralCentavos: 0, qtdLancamentos: 0 })
describe('fechamento mensal', () => {
  it('sem fechamentos permite somente início já encerrado', () => {
    expect(ultimoMesFechado([])).toBeNull()
    expect(mesEstaFechado([], '2026-01')).toBe(false)
    expect(podeReabrir([], '2026-01')).toBe(false)
    expect(proximoMesAFechar([], '2026-09', '2026-09-30')).toBeNull()
    expect(proximoMesAFechar([], '2026-09', '2026-10-01')).toBe('2026-09')
  })
  it('ordena logicamente, protege anteriores e atravessa a virada do ano', () => {
    const fs = [f('2026-12'), f('2026-11')]
    expect(ultimoMesFechado(fs)).toBe('2026-12')
    expect(proximoMesAFechar(fs, '2026-11', '2027-02-01')).toBe('2027-01')
    expect(mesEstaFechado(fs, '2026-01')).toBe(true)
    expect(dataEstaEmMesFechado(fs, '2026-12-31')).toBe(true)
    expect(dataEstaEmMesFechado(fs, '2027-01-01')).toBe(false)
    expect(podeReabrir(fs, '2026-12')).toBe(true)
    expect(podeReabrir(fs, '2026-11')).toBe(false)
  })
})
