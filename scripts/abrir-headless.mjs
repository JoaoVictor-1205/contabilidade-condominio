// Abre uma URL num Chromium headless (Chrome/Edge) e avalia uma expressão JS até ela retornar um valor "pronto".
// Uso: node scripts/abrir-headless.mjs <navegador.exe> <url> [expressao] [timeoutMs]
// Saída: JSON { valor, logs } (logs = console e exceções da página). Exit 0 se obteve valor, 1 se não.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [exe, url, expr = 'document.body.innerText', timeoutMs = '20000'] = process.argv.slice(2)
if (!exe || !url) {
  console.error('Uso: node scripts/abrir-headless.mjs <navegador.exe> <url> [expressao] [timeoutMs]')
  process.exit(2)
}
const perfil = mkdtempSync(join(tmpdir(), 'headless-'))
const porta = 9300 + Math.floor(Math.random() * 500)
const proc = spawn(
  exe,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, 'about:blank'],
  { stdio: 'ignore' },
)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function alvo() {
  for (let i = 0; i < 100; i++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${porta}/json`)).json()
      const t = lista.find((x) => x.type === 'page')
      if (t) return t
    } catch {}
    await esperar(200)
  }
  throw new Error('DevTools não respondeu')
}

function encerrar() {
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
  else proc.kill()
  setTimeout(() => { try { rmSync(perfil, { recursive: true, force: true }) } catch {} }, 1500)
}

try {
  const t = await alvo()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pend = new Map()
  const logs = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push(`[console.${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`)
    else if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`)
  }
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url })
  const fim = Date.now() + Number(timeoutMs)
  let valor = null
  while (Date.now() < fim) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    valor = r.result?.result?.value
    if (valor !== null && valor !== undefined && valor !== false && valor !== '') break
    await esperar(250)
  }
  console.log(JSON.stringify({ valor: valor ?? null, logs }, null, 2))
  ws.close()
  encerrar()
  await esperar(500)
  process.exit(valor ? 0 : 1)
} catch (e) {
  console.error(String(e))
  encerrar()
  await esperar(500)
  process.exit(1)
}
