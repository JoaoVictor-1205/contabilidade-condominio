// Download e abertura de Blobs no navegador (funciona em file://).

export function baixarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const VISUALIZAVEIS = /^(application\/pdf|image\/|text\/plain)/

export function ehVisualizavel(mime: string): boolean {
  return VISUALIZAVEIS.test(mime)
}

/** Abre em nova aba quando o navegador consegue exibir; senão baixa. */
export function abrirBlob(blob: Blob, nome: string): void {
  if (!ehVisualizavel(blob.type)) {
    baixarBlob(blob, nome)
    return
  }
  const url = URL.createObjectURL(blob)
  const janela = window.open(url, '_blank')
  if (!janela) baixarBlob(blob, nome)
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** Nome de arquivo seguro para Windows. */
export function nomeSeguro(texto: string): string {
  return texto.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()
}
