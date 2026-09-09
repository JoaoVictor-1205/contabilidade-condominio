// Relógio injetável: a única fonte de "agora"/"hoje" das camadas de dados e UI (o domínio recebe por parâmetro).
import { dataISODe } from '../dominio/datas'
import type { DataISO } from '../dominio/tipos'

export interface Relogio {
  /** Timestamp local ISO sem milissegundos, ex.: '2026-09-04T10:00:00'. */
  agora(): string
  hoje(): DataISO
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/** Timestamp local (fuso do usuário) de um Date, sem 'Z' e sem milissegundos. */
export function timestampLocal(d: Date): string {
  return `${dataISODe(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function relogioDoSistema(): Relogio {
  return {
    agora: () => timestampLocal(new Date()),
    hoje: () => dataISODe(new Date()),
  }
}

/** Relógio fixo para testes. `agora` no formato '2026-09-04T10:00:00'. */
export function relogioFixo(agora: string): Relogio {
  return { agora: () => agora, hoje: () => agora.slice(0, 10) }
}

let atual: Relogio = relogioDoSistema()

export function definirRelogio(r: Relogio): void {
  atual = r
}

export function relogio(): Relogio {
  return atual
}
