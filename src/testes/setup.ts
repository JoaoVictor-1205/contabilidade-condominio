// Setup global do Vitest: IndexedDB falso em todos os testes; jest-dom só onde há DOM.
import 'fake-indexeddb/auto'

if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  // Sem globals do Vitest, o cleanup entre testes de componentes precisa ser registrado à mão.
  const { cleanup } = await import('@testing-library/react')
  const { afterEach } = await import('vitest')
  afterEach(() => cleanup())
}
