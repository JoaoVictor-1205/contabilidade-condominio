// Garante que dist/ contém UM único index.html sem referências externas (funciona em file://).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const LIMITE_AVISO = 1_300_000

const arquivos = readdirSync(dist)
const erros = []

if (arquivos.length !== 1 || arquivos[0] !== 'index.html') {
  erros.push(`dist/ deveria conter apenas index.html, mas contém: ${arquivos.join(', ')}`)
}

const caminho = join(dist, 'index.html')
const html = readFileSync(caminho, 'utf8')

// Remove o CONTEÚDO de <script> e <style> (mantendo as tags) para inspecionar só a estrutura do HTML.
const estrutura = html
  .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2')
  .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2')

const verificacoes = [
  [/<script[^>]*\ssrc=/i, 'há <script src=...> externo'],
  [/<link[^>]*rel=["']stylesheet["'][^>]*href=/i, 'há <link rel="stylesheet" href=...> externo'],
  [/<link[^>]*rel=["']modulepreload["']/i, 'há <link rel="modulepreload">'],
  [/\b(src|href)=["']https?:\/\//i, 'há src/href apontando para http(s)://'],
]
for (const [re, msg] of verificacoes) {
  if (re.test(estrutura)) erros.push(msg)
}

const tamanho = statSync(caminho).size
const kb = (tamanho / 1024).toFixed(0)

if (erros.length) {
  console.error('verificar-build: FALHOU')
  for (const e of erros) console.error(' - ' + e)
  process.exit(1)
}

console.log(`verificar-build: OK — dist/index.html com ${kb} KB`)
if (tamanho > LIMITE_AVISO) {
  console.warn(`verificar-build: AVISO — tamanho acima de ${(LIMITE_AVISO / 1024).toFixed(0)} KB`)
}
