// Roda o Vitest sempre a partir do caminho CANÔNICO do projeto.
// No Windows, se o Vitest for iniciado por um caminho com caixa diferente da real (ex.: c:\ em vez de C:\),
// o Node carrega duas cópias do runner e todos os testes falham com
// "TypeError: Cannot read properties of undefined (reading 'config')". Este wrapper evita isso.
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = realpathSync.native(fileURLToPath(new URL('../', import.meta.url)))
const vitest = join(raiz, 'node_modules', 'vitest', 'vitest.mjs')
const r = spawnSync(process.execPath, [vitest, ...process.argv.slice(2)], { cwd: raiz, stdio: 'inherit' })
process.exit(r.status ?? 1)
