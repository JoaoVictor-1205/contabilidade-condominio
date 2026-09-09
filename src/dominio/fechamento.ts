// Fechamento mensal (v2): sequencial a partir do início contábil; só meses já terminados; reabre-se apenas o último.
import { mesDe, mesSeguinte } from './datas'
import type { DataISO, Fechamento, MesISO } from './tipos'

export function ultimoMesFechado(fechamentos: readonly Fechamento[]): MesISO | null {
  let ultimo: MesISO | null = null
  for (const f of fechamentos) if (ultimo === null || f.mes > ultimo) ultimo = f.mes
  return ultimo
}

/** Um mês está fechado se é igual ou anterior ao último fechamento. */
export function mesEstaFechado(fechamentos: readonly Fechamento[], mes: MesISO): boolean {
  const ultimo = ultimoMesFechado(fechamentos)
  return ultimo !== null && mes <= ultimo
}

export function dataEstaEmMesFechado(fechamentos: readonly Fechamento[], data: DataISO): boolean {
  return mesEstaFechado(fechamentos, mesDe(data))
}

/** Próximo mês que pode ser fechado: o seguinte ao último fechado (ou o início contábil), desde que já tenha terminado. */
export function proximoMesAFechar(fechamentos: readonly Fechamento[], inicioContabil: MesISO, hoje: DataISO): MesISO | null {
  const ultimo = ultimoMesFechado(fechamentos)
  const candidato = ultimo === null ? inicioContabil : mesSeguinte(ultimo)
  return candidato < mesDe(hoje) ? candidato : null
}

/** Só o último fechamento pode ser reaberto (para manter a sequência). */
export function podeReabrir(fechamentos: readonly Fechamento[], mes: MesISO): boolean {
  return ultimoMesFechado(fechamentos) === mes
}
