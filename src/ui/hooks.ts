// Hooks de leitura reativa (useLiveQuery) e de execução de ações com feedback.
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useRef, useState } from 'react'
import { consultas, relogioApp, servicos } from '../dados/instancia'
import { calcularDemonstrativo, type BaseDemonstrativo, type Demonstrativo } from '../dominio/demonstrativo'
import type { Id, Periodo } from '../dominio/tipos'
import { useToast } from './contexto/AppProviders'

export function useEstrutura() {
  const condominio = useLiveQuery(() => consultas.condominio(), [])
  const blocos = useLiveQuery(() => consultas.blocos(), [])
  const unidades = useLiveQuery(() => consultas.unidades(), [])
  const categorias = useLiveQuery(() => consultas.categorias(), [])
  const taxas = useLiveQuery(() => consultas.taxas(), [])
  return {
    condominio,
    blocos: blocos ?? [],
    blocosAtivos: (blocos ?? []).filter((b) => b.ativo),
    unidades: unidades ?? [],
    categorias: categorias ?? [],
    taxas: taxas ?? [],
    carregando: !condominio || !blocos || !unidades || !categorias || !taxas,
  }
}

export function useDemonstrativo(periodo: Periodo, base: BaseDemonstrativo, filtroBlocoId: Id | null): Demonstrativo | undefined {
  return useLiveQuery(async () => {
    const insumos = await consultas.relatorios.insumosDemonstrativo(periodo, base)
    return calcularDemonstrativo({ periodo, base, filtroBlocoId, ...insumos, hoje: relogioApp.hoje(), agora: relogioApp.agora() })
  }, [periodo.inicio, periodo.fim, base, filtroBlocoId])
}

/** Executa uma ação assíncrona com toast de erro/sucesso e estado "ocupado". */
export function useAcao() {
  const toast = useToast()
  const [ocupado, setOcupado] = useState(false)
  const emExecucao = useRef(false)
  const executar = useCallback(
    async <T,>(fn: () => Promise<T>, sucesso?: string): Promise<T | undefined> => {
      if (emExecucao.current) return undefined
      emExecucao.current = true
      setOcupado(true)
      try {
        const r = await fn()
        if (sucesso) toast.sucesso(sucesso)
        return r
      } catch (e) {
        toast.deErro(e)
        return undefined
      } finally {
        emExecucao.current = false
        setOcupado(false)
      }
    },
    [toast],
  )
  return { executar, ocupado }
}

export type NivelLembrete = null | 'aviso' | 'critico'

export function useLembreteBackup(): { nivel: NivelLembrete; ultimoBackupEm: string | null; alteracoes: number } {
  const estado = useLiveQuery(() => servicos.sistema.estadoBackup(), [])
  if (!estado) return { nivel: null, ultimoBackupEm: null, alteracoes: 0 }
  const dias = estado.ultimoBackupEm ? (Date.parse(relogioApp.agora()) - Date.parse(estado.ultimoBackupEm)) / 86_400_000 : Infinity
  let nivel: NivelLembrete = null
  if (estado.alteracoesDesdeBackup > 0) {
    if (dias > 30 || !estado.ultimoBackupEm) nivel = 'critico'
    else if (dias > 7 || estado.alteracoesDesdeBackup >= 50) nivel = 'aviso'
  }
  return { nivel, ultimoBackupEm: estado.ultimoBackupEm, alteracoes: estado.alteracoesDesdeBackup }
}

export function useOnboardingConcluido(): boolean | undefined {
  return useLiveQuery(() => servicos.sistema.onboardingConcluido(), [])
}
