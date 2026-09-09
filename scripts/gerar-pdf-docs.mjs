// Gera a documentação em PDF (docs/Documentacao-Contabilidade-Condominio.pdf) a partir dos arquivos Markdown
// do projeto, usando o Chrome instalado em modo headless. Sem dependências além do Node.
// Uso: node scripts/gerar-pdf-docs.mjs [caminho-do-chrome]
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exe = process.argv[2] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const versao = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version
const dataHoje = new Date().toLocaleDateString('pt-BR')
const REPOSITORIO = 'https://github.com/JoaoVictor-1205/contabilidade-condominio'

/** Capítulos, na ordem do documento. Cada arquivo começa com um título de nível 1. */
const CAPITULOS = [
  { arquivo: 'docs/visao-geral.md' },
  { arquivo: 'LEIAME.md' },
  { arquivo: 'docs/regras-contabeis.md' },
  { arquivo: 'docs/arquitetura.md' },
  { arquivo: 'docs/validacao-v2.md' },
]

// ---------- Conversor Markdown → HTML (subconjunto usado nos documentos do projeto) ----------

const escapar = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slug = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' }

function imagemEmbutida(src, baseDir) {
  if (/^(https?:|data:)/.test(src)) return src
  const caminho = resolve(baseDir, src)
  if (!existsSync(caminho)) throw new Error(`Imagem não encontrada: ${caminho}`)
  return `data:${MIME[extname(caminho).toLowerCase()] ?? 'application/octet-stream'};base64,${readFileSync(caminho).toString('base64')}`
}

function inline(texto, ctx) {
  return texto.split(/(`[^`]+`)/).map((parte) => {
    if (parte.startsWith('`') && parte.endsWith('`') && parte.length > 1) return `<code>${escapar(parte.slice(1, -1))}</code>`
    let t = escapar(parte)
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${imagemEmbutida(src, ctx.baseDir)}" alt="${alt}">`)
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, rotulo, url) => `<a href="${url}">${rotulo}</a>`)
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/(^|[\s(>])\*([^*\s][^*]*?)\*(?=[\s.,;:)!?<]|$)/g, '$1<em>$2</em>')
    return t
  }).join('')
}

function converterTabela(linhas, ctx) {
  const celulas = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const cabecalho = celulas(linhas[0])
  const alinhamentos = celulas(linhas[1]).map((a) => (a.startsWith(':') && a.endsWith(':') ? 'center' : a.endsWith(':') ? 'right' : 'left'))
  const estilo = (i) => (alinhamentos[i] && alinhamentos[i] !== 'left' ? ` style="text-align:${alinhamentos[i]}"` : '')
  const classe = cabecalho.length >= 10 ? ' class="larga"' : cabecalho.length >= 7 ? ' class="media"' : ''
  let html = `<table${classe}><thead><tr>${cabecalho.map((c, i) => `<th${estilo(i)}>${inline(c, ctx)}</th>`).join('')}</tr></thead><tbody>`
  for (const linha of linhas.slice(2)) html += `<tr>${celulas(linha).map((c, i) => `<td${estilo(i)}>${inline(c, ctx)}</td>`).join('')}</tr>`
  return html + '</tbody></table>'
}

export function markdownParaHtml(md, ctx) {
  const linhas = md.replace(/\r\n/g, '\n').split('\n')
  const saida = []
  const titulos = []
  let paragrafo = []
  const pilhaListas = [] // { tipo: 'ul'|'ol', indent }
  const fecharParagrafo = () => {
    if (!paragrafo.length) return
    const figura = paragrafo.length === 1 ? /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(paragrafo[0]) : null
    if (figura) saida.push(`<figure><img src="${imagemEmbutida(figura[2], ctx.baseDir)}" alt="${escapar(figura[1])}"><figcaption>${inline(figura[1], ctx)}</figcaption></figure>`)
    else saida.push(`<p>${inline(paragrafo.join(' '), ctx)}</p>`)
    paragrafo = []
  }
  const fecharListasAte = (indent) => { while (pilhaListas.length && pilhaListas[pilhaListas.length - 1].indent >= indent) saida.push(`</li></${pilhaListas.pop().tipo}>`) }
  const fecharListas = () => fecharListasAte(-1)
  const ehSeparadorTabela = (l) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l ?? '')
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    if (linha.startsWith('```')) {
      fecharParagrafo(); fecharListas()
      const corpo = []
      for (i++; i < linhas.length && !linhas[i].startsWith('```'); i++) corpo.push(linhas[i])
      saida.push(`<pre><code>${escapar(corpo.join('\n'))}</code></pre>`)
      continue
    }
    const titulo = /^(#{1,6})\s+(.*?)\s*#*$/.exec(linha)
    if (titulo) {
      fecharParagrafo(); fecharListas()
      const nivel = titulo[1].length
      let id = `${ctx.prefixo}-${slug(titulo[2])}`
      while (ctx.ids.has(id)) id += '-'
      ctx.ids.add(id)
      titulos.push({ nivel, texto: titulo[2].replace(/[`*]/g, ''), id })
      saida.push(`<h${nivel} id="${id}">${inline(titulo[2], ctx)}</h${nivel}>`)
      continue
    }
    if (linha.trim().startsWith('|') && ehSeparadorTabela(linhas[i + 1])) {
      fecharParagrafo(); fecharListas()
      const bloco = [linha, linhas[i + 1]]
      for (i += 2; i < linhas.length && linhas[i].trim().startsWith('|'); i++) bloco.push(linhas[i])
      i--
      saida.push(converterTabela(bloco, ctx))
      continue
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(linha)) { fecharParagrafo(); fecharListas(); saida.push('<hr>'); continue }
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(linha)
    if (item) {
      fecharParagrafo()
      const indent = item[1].length
      const tipo = /\d/.test(item[2]) ? 'ol' : 'ul'
      const topo = pilhaListas[pilhaListas.length - 1]
      if (!topo || indent > topo.indent) { pilhaListas.push({ tipo, indent }); saida.push(`<${tipo}><li>${inline(item[3], ctx)}`) }
      else { fecharListasAte(indent + 1); if (pilhaListas.length && pilhaListas[pilhaListas.length - 1].indent === indent) saida.push(`</li><li>${inline(item[3], ctx)}`); else { pilhaListas.push({ tipo, indent }); saida.push(`<${tipo}><li>${inline(item[3], ctx)}`) } }
      continue
    }
    if (linha.startsWith('>')) {
      fecharParagrafo(); fecharListas()
      const corpo = [linha.replace(/^>\s?/, '')]
      for (; i + 1 < linhas.length && linhas[i + 1].startsWith('>'); i++) corpo.push(linhas[i + 1].replace(/^>\s?/, ''))
      saida.push(`<blockquote><p>${inline(corpo.join(' '), ctx)}</p></blockquote>`)
      continue
    }
    if (linha.trim() === '') { fecharParagrafo(); if (!/^\s+\S/.test(linhas[i + 1] ?? '') || !pilhaListas.length) fecharListas(); continue }
    if (pilhaListas.length && /^\s+\S/.test(linha)) { saida.push(' ' + inline(linha.trim(), ctx)); continue }
    fecharListas()
    paragrafo.push(linha.trim())
  }
  fecharParagrafo(); fecharListas()
  return { html: saida.join('\n'), titulos }
}

// ---------- Montagem do documento ----------

const CSS = `
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
* { box-sizing: border-box; }
html { font-size: 10.5pt; }
body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1a1f2b; line-height: 1.45; margin: 0; }
h1, h2, h3, h4 { color: #1e3a8a; line-height: 1.2; page-break-after: avoid; }
h1 { font-size: 22pt; margin: 0 0 12pt; padding-bottom: 6pt; border-bottom: 2px solid #1e3a8a; }
h2 { font-size: 15pt; margin: 18pt 0 8pt; }
h3 { font-size: 12pt; margin: 14pt 0 6pt; }
h4 { font-size: 10.5pt; margin: 10pt 0 4pt; }
p { margin: 0 0 7pt; text-align: justify; }
ul, ol { margin: 0 0 8pt; padding-left: 20pt; }
li { margin: 0 0 3pt; }
li > ul, li > ol { margin-top: 3pt; }
code { font-family: Consolas, "Courier New", monospace; font-size: 0.9em; background: #f1f4f9; border-radius: 3px; padding: 0 3px; }
pre { background: #f1f4f9; border: 1px solid #d8deea; border-radius: 4px; padding: 8pt; font-size: 8.5pt; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: inherit; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; page-break-inside: auto; }
table.media { font-size: 8pt; }
table.larga { font-size: 7pt; }
th, td { border: 1px solid #cfd6e4; padding: 3pt 5pt; vertical-align: top; }
th { background: #e8eef9; text-align: left; }
tr { page-break-inside: avoid; }
blockquote { border-left: 3px solid #93a4c7; margin: 0 0 8pt; padding: 2pt 10pt; color: #3b4458; }
img { max-width: 100%; height: auto; border: 1px solid #cfd6e4; border-radius: 4px; display: block; margin: 6pt auto; page-break-inside: avoid; }
hr { border: 0; border-top: 1px solid #cfd6e4; margin: 12pt 0; }
figure { margin: 8pt 0 12pt; page-break-inside: avoid; }
figcaption { text-align: center; font-size: 9pt; color: #3b4458; margin-top: 2pt; }
a { color: #1d4ed8; text-decoration: none; }
section.capitulo { page-break-before: always; }
.capa { page-break-after: always; height: 240mm; display: flex; flex-direction: column; justify-content: center; text-align: center; }
.capa h1 { border: 0; font-size: 30pt; margin-bottom: 6pt; }
.capa .sub { font-size: 15pt; color: #3b4458; margin-bottom: 24pt; }
.capa img { max-width: 78%; box-shadow: 0 4px 16px rgba(0,0,0,.15); }
.capa .meta { margin-top: 24pt; color: #3b4458; font-size: 10.5pt; }
.sumario { page-break-after: always; }
.sumario ol { list-style: none; padding: 0; }
.sumario > ol > li { font-weight: 600; margin: 6pt 0 2pt; }
.sumario ol ol { padding-left: 16pt; font-weight: 400; }
.sumario ol ol li { margin: 1pt 0; }
`

function montarDocumento() {
  const ctxBase = { ids: new Set() }
  const capitulos = CAPITULOS.map(({ arquivo }, indice) => {
    const caminho = join(raiz, arquivo)
    const ctx = { ...ctxBase, baseDir: dirname(caminho), prefixo: `c${indice + 1}` }
    const { html, titulos } = markdownParaHtml(readFileSync(caminho, 'utf8'), ctx)
    return { arquivo, html, titulos }
  })
  const capa = `<div class="capa">
    <h1>Contabilidade do Condomínio</h1>
    <div class="sub">Documentação do sistema · versão ${versao}</div>
    <img src="${imagemEmbutida('docs/capturas/02-inicio.png', raiz)}" alt="Tela inicial">
    <div class="meta">Trabalho Vivências · ${dataHoje}<br>Aplicativo web local de arquivo único (React + TypeScript + IndexedDB)<br>${REPOSITORIO}</div>
  </div>`
  const sumario = `<div class="sumario"><h1>Sumário</h1><ol>${capitulos.map((c, i) => {
    const h1 = c.titulos.find((t) => t.nivel === 1)
    const subs = c.titulos.filter((t) => t.nivel === 2)
    return `<li>${i + 1}. <a href="#${h1?.id}">${escapar(h1?.texto ?? c.arquivo)}</a>${subs.length ? `<ol>${subs.map((s) => `<li><a href="#${s.id}">${escapar(s.texto)}</a></li>`).join('')}</ol>` : ''}</li>`
  }).join('')}</ol></div>`
  const corpo = capitulos.map((c) => `<section class="capitulo">${c.html}</section>`).join('\n')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Contabilidade do Condomínio — Documentação v${versao}</title><style>${CSS}</style></head><body>${capa}${sumario}${corpo}</body></html>`
}

// ---------- Impressão com o Chrome headless (protocolo DevTools) ----------

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function imprimirPdf(htmlCaminho, pdfCaminho) {
  if (!existsSync(exe)) throw new Error(`Navegador ausente: ${exe}`)
  const perfil = mkdtempSync(join(tmpdir(), 'pdf-docs-'))
  const porta = 9900 + Math.floor(Math.random() * 90)
  const processo = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
  let socket
  try {
    let alvo
    for (let i = 0; i < 100 && !alvo; i++) {
      try { alvo = (await (await fetch(`http://127.0.0.1:${porta}/json`)).json()).find((t) => t.type === 'page') } catch { /* aguarda */ }
      if (!alvo) await esperar(200)
    }
    if (!alvo) throw new Error('DevTools não respondeu.')
    socket = new WebSocket(alvo.webSocketDebuggerUrl)
    await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej })
    let proximoId = 0
    const pendentes = new Map()
    socket.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pendentes.has(m.id)) { const p = pendentes.get(m.id); pendentes.delete(m.id); m.error ? p.rejeitar(new Error(JSON.stringify(m.error))) : p.resolver(m.result) }
    }
    const comando = (method, params = {}) => new Promise((resolver, rejeitar) => { const id = ++proximoId; pendentes.set(id, { resolver, rejeitar }); socket.send(JSON.stringify({ id, method, params })) })
    await comando('Page.enable')
    await comando('Page.navigate', { url: pathToFileURL(htmlCaminho).href })
    for (let i = 0; i < 100; i++) {
      const r = await comando('Runtime.evaluate', { expression: 'document.readyState === "complete" && document.fonts.status === "loaded"', returnByValue: true })
      if (r.result?.value) break
      await esperar(100)
    }
    await esperar(500)
    const rodape = `<div style="font-size:8px;width:100%;text-align:center;color:#666;font-family:Segoe UI,Arial,sans-serif;">Contabilidade do Condomínio · Documentação v${versao} · página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`
    const { data } = await comando('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: rodape })
    writeFileSync(pdfCaminho, Buffer.from(data, 'base64'))
  } finally {
    try { socket?.close() } catch { /* ignorar */ }
    processo.kill()
    await esperar(1000)
    for (let i = 0; i < 5; i++) { try { rmSync(perfil, { recursive: true, force: true }); break } catch { await esperar(1000) } }
  }
}

async function main() {
  const html = montarDocumento()
  const pastaTemp = mkdtempSync(join(tmpdir(), 'docs-condominio-'))
  const htmlCaminho = join(pastaTemp, 'documentacao.html')
  writeFileSync(htmlCaminho, html)
  const pdf = join(raiz, 'docs', 'Documentacao-Contabilidade-Condominio.pdf')
  await imprimirPdf(htmlCaminho, pdf)
  rmSync(pastaTemp, { recursive: true, force: true })
  const entrega = join(raiz, 'entrega')
  if (existsSync(entrega)) copyFileSync(pdf, join(entrega, 'Documentacao-Contabilidade-Condominio.pdf'))
  console.log(`PDF gerado: ${pdf} (${Math.round(statSync(pdf).size / 1024)} KB)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exitCode = 1 })
