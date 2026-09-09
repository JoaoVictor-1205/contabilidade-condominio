// Datas como strings ISO. NUNCA usar `new Date('AAAA-MM-DD')` (interpreta como UTC e muda o dia no fuso do Brasil).
import type { DataISO, MesISO, Periodo } from './tipos'

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/
const RE_MES = /^(\d{4})-(\d{2})$/

export const NOMES_MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

export function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0
}

export function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) return ehBissexto(ano) ? 29 : 28
  return [4, 6, 9, 11].includes(mes) ? 30 : 31
}

export function ehMesISO(s: unknown): s is MesISO {
  if (typeof s !== 'string') return false
  const m = RE_MES.exec(s)
  if (!m) return false
  const mes = Number(m[2])
  return mes >= 1 && mes <= 12
}

export function ehDataISO(s: unknown): s is DataISO {
  if (typeof s !== 'string') return false
  const m = RE_DATA.exec(s)
  if (!m) return false
  const ano = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  if (mes < 1 || mes > 12) return false
  return dia >= 1 && dia <= diasNoMes(ano, mes)
}

export function partesDe(data: DataISO): { ano: number; mes: number; dia: number } {
  return { ano: Number(data.slice(0, 4)), mes: Number(data.slice(5, 7)), dia: Number(data.slice(8, 10)) }
}

export function partesDoMes(mes: MesISO): { ano: number; mes: number } {
  return { ano: Number(mes.slice(0, 4)), mes: Number(mes.slice(5, 7)) }
}

export function montarData(ano: number, mes: number, dia: number): DataISO {
  return `${ano.toString().padStart(4, '0')}-${pad2(mes)}-${pad2(dia)}`
}

export function montarMes(ano: number, mes: number): MesISO {
  return `${ano.toString().padStart(4, '0')}-${pad2(mes)}`
}

/** '2026-09-04' → '2026-09' */
export function mesDe(data: DataISO): MesISO {
  return data.slice(0, 7)
}

export function ultimoDiaDoMes(mes: MesISO): number {
  const p = partesDoMes(mes)
  return diasNoMes(p.ano, p.mes)
}

export function primeiraDataDoMes(mes: MesISO): DataISO {
  return `${mes}-01`
}

export function ultimaDataDoMes(mes: MesISO): DataISO {
  return `${mes}-${pad2(ultimoDiaDoMes(mes))}`
}

export function mesAnterior(mes: MesISO): MesISO {
  const p = partesDoMes(mes)
  return p.mes === 1 ? montarMes(p.ano - 1, 12) : montarMes(p.ano, p.mes - 1)
}

export function mesSeguinte(mes: MesISO): MesISO {
  const p = partesDoMes(mes)
  return p.mes === 12 ? montarMes(p.ano + 1, 1) : montarMes(p.ano, p.mes + 1)
}

/** Lista de meses de `de` até `ate` (inclusive), em ordem. Vazia se de > ate. */
export function mesesEntre(de: MesISO, ate: MesISO): MesISO[] {
  const lista: MesISO[] = []
  let m = de
  while (m <= ate) {
    lista.push(m)
    m = mesSeguinte(m)
  }
  return lista
}

/** Comparação lexicográfica funciona para ISO: negativo se a < b. */
export function compararDatas(a: DataISO, b: DataISO): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function periodoDoMes(mes: MesISO): Periodo {
  return { inicio: primeiraDataDoMes(mes), fim: ultimaDataDoMes(mes) }
}

export function periodoDoAno(ano: number): Periodo {
  return { inicio: montarData(ano, 1, 1), fim: montarData(ano, 12, 31) }
}

export function dataNoPeriodo(data: DataISO, periodo: Periodo): boolean {
  return data >= periodo.inicio && data <= periodo.fim
}

/** Dias corridos de `a` até `b` (b − a); usa UTC para não sofrer com horário de verão. */
export function diasEntre(a: DataISO, b: DataISO): number {
  const pa = partesDe(a)
  const pb = partesDe(b)
  const ua = Date.UTC(pa.ano, pa.mes - 1, pa.dia)
  const ub = Date.UTC(pb.ano, pb.mes - 1, pb.dia)
  return Math.round((ub - ua) / 86_400_000)
}

export function adicionarDias(data: DataISO, dias: number): DataISO {
  const p = partesDe(data)
  const d = new Date(Date.UTC(p.ano, p.mes - 1, p.dia + dias))
  return montarData(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Data local (fuso do usuário) de um Date. */
export function dataISODe(d: Date): DataISO {
  return montarData(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** Data local (fuso do usuário) de um timestamp ISO completo ('2026-09-04T10:00:00'). */
export function dataISODeTimestamp(ts: string): DataISO {
  return dataISODe(new Date(ts))
}

/** '2026-09-04' → '04/09/2026' */
export function formatarData(data: DataISO): string {
  const p = partesDe(data)
  return `${pad2(p.dia)}/${pad2(p.mes)}/${p.ano}`
}

/** '2026-09' → 'Setembro/2026' */
export function formatarMes(mes: MesISO): string {
  const p = partesDoMes(mes)
  return `${NOMES_MESES[p.mes - 1] ?? mes}/${p.ano}`
}

/** '2026-09' → '09/2026' */
export function formatarMesCurto(mes: MesISO): string {
  const p = partesDoMes(mes)
  return `${pad2(p.mes)}/${p.ano}`
}

/** '04/09/2026' → '2026-09-04'; null se inválida. */
export function dataDeTextoBR(texto: string): DataISO | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(texto)
  if (!m) return null
  const data = montarData(Number(m[3]), Number(m[2]), Number(m[1]))
  return ehDataISO(data) ? data : null
}

/** '09/2026' ou '2026-09' → '2026-09'; null se inválido. */
export function mesDeTexto(texto: string): MesISO | null {
  const t = texto.trim()
  if (ehMesISO(t)) return t
  const m = /^(\d{1,2})\/(\d{4})$/.exec(t)
  if (!m) return null
  const mes = montarMes(Number(m[2]), Number(m[1]))
  return ehMesISO(mes) ? mes : null
}
