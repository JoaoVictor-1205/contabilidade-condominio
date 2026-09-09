// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { Centavos, DataISO } from '../../dominio/tipos'
import { CampoData, CampoMoeda, periodoDe, tituloDoPeriodo } from './campos'

function MoedaTeste({ inicial = 0 }: { inicial?: Centavos }) {
  const [v, setV] = useState<Centavos>(inicial)
  return (
    <>
      <CampoMoeda valor={v} onChange={setV} permitirNegativo />
      <output data-testid="centavos">{v}</output>
    </>
  )
}

describe('CampoMoeda (caixa eletrônico)', () => {
  it('"12345" vira R$ 123,45 e guarda 12345 centavos', () => {
    render(<MoedaTeste />)
    const input = screen.getByLabelText('Valor em reais') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12345' } })
    expect(screen.getByTestId('centavos').textContent).toBe('12345')
    expect(input.value).toBe('123,45')
    fireEvent.change(input, { target: { value: '123,456' } })
    expect(screen.getByTestId('centavos').textContent).toBe('123456')
    expect(input.value).toBe('1.234,56')
  })

  it('inverte o sinal pelo botão', () => {
    render(<MoedaTeste inicial={500} />)
    fireEvent.click(screen.getByTitle('Inverter sinal'))
    expect(screen.getByTestId('centavos').textContent).toBe('-500')
  })
})

describe('CampoData', () => {
  it('mostra dd/mm/aaaa ao lado do input nativo e devolve ISO', () => {
    function T() {
      const [d, setD] = useState<DataISO>('2026-09-04')
      return (
        <>
          <CampoData valor={d} onChange={setD} id="d" />
          <output data-testid="iso">{d}</output>
        </>
      )
    }
    render(<T />)
    expect(screen.getByText('04/09/2026')).toBeInTheDocument()
    fireEvent.change(document.getElementById('d')!, { target: { value: '2026-02-28' } })
    expect(screen.getByTestId('iso').textContent).toBe('2026-02-28')
    expect(screen.getByText('28/02/2026')).toBeInTheDocument()
  })
})

describe('período selecionado', () => {
  it('converte mês, ano e intervalo', () => {
    expect(periodoDe({ tipo: 'mes', mes: '2026-02' })).toEqual({ inicio: '2026-02-01', fim: '2026-02-28' })
    expect(periodoDe({ tipo: 'ano', ano: 2026 })).toEqual({ inicio: '2026-01-01', fim: '2026-12-31' })
    expect(tituloDoPeriodo({ tipo: 'mes', mes: '2026-09' })).toBe('Setembro/2026')
    expect(tituloDoPeriodo({ tipo: 'intervalo', inicio: '2026-01-05', fim: '2026-01-20' })).toBe('05/01/2026 a 20/01/2026')
  })
})
