import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Ambiente padrão: node (domínio, dados, exportação) com fake-indexeddb.
// Testes de componentes declaram `// @vitest-environment happy-dom` na primeira linha.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    pool: 'forks',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/testes/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/dominio/**', 'src/dados/**', 'src/exportacao/**'],
      exclude: ['**/*.test.*'],
    },
  },
})
