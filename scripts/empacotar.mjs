// Copia o build final para entrega/ com o nome amigável e o LEIAME.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('../', import.meta.url))
const origem = join(raiz, 'dist', 'index.html')
const entrega = join(raiz, 'entrega')

if (!existsSync(origem)) {
  console.error('empacotar: dist/index.html não existe. Rode "npm run build" antes.')
  process.exit(1)
}
mkdirSync(entrega, { recursive: true })
copyFileSync(origem, join(entrega, 'Contabilidade-Condominio.html'))
const leiame = join(raiz, 'LEIAME.md')
if (existsSync(leiame)) copyFileSync(leiame, join(entrega, 'LEIAME.md'))
console.log('empacotar: OK — entrega/Contabilidade-Condominio.html')
