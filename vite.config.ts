import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Build em UM único index.html que abre por duplo clique (file://) no Chrome/Edge.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile({ useRecommendedBuildConfig: true, removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: false,
  },
})
