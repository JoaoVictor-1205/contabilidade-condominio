import { afterEach, describe, expect, it, vi } from 'vitest'
import { novoId } from './ids'

/** UUID v4: terceiro grupo começa com 4; quarto grupo começa com 8, 9, a ou b. */
const RE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('novoId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('gera UUID v4 em minúsculas', () => {
    expect(novoId()).toMatch(RE_UUID_V4)
  })

  it('gera 1000 ids distintos', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const id = novoId()
      expect(id).toMatch(RE_UUID_V4)
      ids.add(id)
    }
    expect(ids.size).toBe(1000)
  })

  it('cai para getRandomValues quando randomUUID não existe', () => {
    const original = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => original.getRandomValues(arr),
    })
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const id = novoId()
      expect(id).toMatch(RE_UUID_V4)
      ids.add(id)
    }
    expect(ids.size).toBe(100)
  })

  it('força os bits de versão e variante no caminho sem randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: (arr: Uint8Array) => arr.fill(0) })
    expect(novoId()).toBe('00000000-0000-4000-8000-000000000000')

    vi.stubGlobal('crypto', { getRandomValues: (arr: Uint8Array) => arr.fill(0xff) })
    expect(novoId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })
})
