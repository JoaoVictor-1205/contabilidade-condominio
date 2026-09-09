import { describe, expect, it } from 'vitest'

describe('ambiente de testes (node)', () => {
  it('tem IndexedDB falso disponível', () => {
    expect(typeof indexedDB).toBe('object')
  })
  it('não tem DOM', () => {
    expect(typeof document).toBe('undefined')
  })
})
