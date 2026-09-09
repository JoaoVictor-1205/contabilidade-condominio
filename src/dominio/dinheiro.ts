// Dinheiro em centavos inteiros. Formatação pt-BR sem ponto flutuante.
import type { Centavos } from './tipos'

export function ehCentavos(v: unknown): v is Centavos {
  return typeof v === 'number' && Number.isInteger(v) && Number.isSafeInteger(v)
}

function separarMilhares(inteiro: number): string {
  return inteiro.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** 123456 → '1.234,56'; -5 → '-0,05'. */
export function formatarValor(c: Centavos): string {
  const negativo = c < 0
  const abs = Math.abs(c)
  const reais = Math.floor(abs / 100)
  const centavos = abs % 100
  return `${negativo ? '-' : ''}${separarMilhares(reais)},${centavos.toString().padStart(2, '0')}`
}

/** 123456 → 'R$ 1.234,56'; -100 → '-R$ 1,00'. */
export function formatarBRL(c: Centavos): string {
  return `${c < 0 ? '-' : ''}R$ ${formatarValor(Math.abs(c))}`
}

/**
 * Converte texto digitado ('1.234,56', 'R$ 10', '10,5', '-3,20', '1234.56') em centavos.
 * Retorna null se não for um valor reconhecível.
 */
export function centavosDeTexto(texto: string): Centavos | null {
  let t = texto.trim().replace(/R\$/gi, '').replace(/\s/g, '')
  if (t === '') return null
  let negativo = false
  if (t.startsWith('-')) {
    negativo = true
    t = t.slice(1)
  }
  if (!/^[\d.,]+$/.test(t)) return null
  const temVirgula = t.includes(',')
  const temPonto = t.includes('.')
  let inteiro: string
  let fracao: string
  if (temVirgula) {
    // formato BR: '.' milhar, ',' decimal
    const partes = t.split(',')
    if (partes.length !== 2) return null
    inteiro = (partes[0] ?? '').replace(/\./g, '')
    fracao = partes[1] ?? ''
  } else if (temPonto) {
    const partes = t.split('.')
    const ultima = partes[partes.length - 1] ?? ''
    if (partes.length === 2 && ultima.length !== 3) {
      // '1234.56' → decimal com ponto
      inteiro = partes[0] ?? ''
      fracao = ultima
    } else {
      // '1.234' ou '1.234.567' → separadores de milhar
      if (!partes.every((p, i) => (i === 0 ? p.length >= 1 && p.length <= 3 : p.length === 3))) return null
      inteiro = partes.join('')
      fracao = ''
    }
  } else {
    inteiro = t
    fracao = ''
  }
  if (inteiro === '' && fracao === '') return null
  if (inteiro === '') inteiro = '0'
  if (!/^\d+$/.test(inteiro)) return null
  if (fracao.length > 2 || !/^\d*$/.test(fracao)) return null
  const centavos = Number(inteiro) * 100 + Number((fracao + '00').slice(0, 2))
  if (!Number.isSafeInteger(centavos)) return null
  return negativo && centavos !== 0 ? -centavos : centavos // evita -0
}

/** Modo "caixa eletrônico": só os dígitos importam. '12345' → 12345 (R$ 123,45); 'R$ 1,2x' → 12. */
export function centavosDeDigitos(texto: string): Centavos {
  const digitos = texto.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  if (digitos === '') return 0
  const n = Number(digitos)
  return Number.isSafeInteger(n) ? n : Number.MAX_SAFE_INTEGER
}

export function somarCentavos(valores: Iterable<Centavos>): Centavos {
  let total = 0
  for (const v of valores) total += v
  return total
}
