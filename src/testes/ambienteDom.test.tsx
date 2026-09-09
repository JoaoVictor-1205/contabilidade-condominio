// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('ambiente de testes (happy-dom)', () => {
  it('renderiza React e tem jest-dom', () => {
    render(<p>Olá, síndico</p>)
    expect(screen.getByText('Olá, síndico')).toBeInTheDocument()
  })
  it('tem IndexedDB falso disponível', () => {
    expect(typeof indexedDB).toBe('object')
  })
})
