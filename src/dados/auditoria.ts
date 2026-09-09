// Trilha de auditoria básica. Chamar SEMPRE dentro da transação que fez a escrita.
import type { Auditoria } from '../dominio/tipos'
import type { BancoSindico } from './db'

export type EntradaAuditoria = Omit<Auditoria, 'seq' | 'em'>

/** Campos ausentes aparecem como null, inclusive no JSON do backup. */
export function diferencas<T extends object>(antes: T, depois: T, campos: readonly (keyof T)[]): Auditoria['alteracoes'] {
  const alteracoes: NonNullable<Auditoria['alteracoes']> = {}
  for (const campo of campos) {
    const de = antes[campo] ?? null
    const para = depois[campo] ?? null
    if (JSON.stringify(de) !== JSON.stringify(para)) alteracoes[String(campo)] = { de, para }
  }
  return Object.keys(alteracoes).length ? alteracoes : undefined
}

export async function registrarAuditoria(db: BancoSindico, entrada: EntradaAuditoria, agora: string): Promise<void> {
  await db.auditoria.add({ ...entrada, em: agora })
  const atual = await db.meta.get('alteracoesDesdeBackup')
  const n = typeof atual?.valor === 'number' ? atual.valor : 0
  await db.meta.put({ chave: 'alteracoesDesdeBackup', valor: n + 1 })
}
