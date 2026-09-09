// Componentes visuais genéricos (modal, badge, alerta, estado vazio, barra, valor monetário).
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { formatarBRL } from '../../dominio/dinheiro'
import type { Centavos } from '../../dominio/tipos'

export function Modal({
  titulo,
  onFechar,
  children,
  rodape,
  largo,
  fechavel = true,
}: {
  titulo: string
  onFechar: () => void
  children: ReactNode
  rodape?: ReactNode
  largo?: boolean
  fechavel?: boolean
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const anterior = document.activeElement
    const alvo = ref.current?.querySelector<HTMLElement>('[autofocus]')
      ?? ref.current?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled])')
      ?? ref.current?.querySelector<HTMLElement>('button:not([disabled])')
    if (!ref.current?.contains(anterior)) (alvo ?? ref.current)?.focus()
    return () => { if (anterior instanceof HTMLElement && anterior.isConnected) anterior.focus() }
  }, [])
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const modais = document.querySelectorAll('[role="dialog"]')
      if (modais[modais.length - 1] !== ref.current) return
      if (e.key === 'Escape' && fechavel) { e.preventDefault(); onFechar() }
      if (e.key === 'Tab') {
        const itens = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') ?? [])
        const primeiro = itens[0]
        const ultimo = itens.at(-1)
        if (!primeiro) { e.preventDefault(); ref.current?.focus() }
        else if (e.shiftKey && (document.activeElement === primeiro || document.activeElement === ref.current)) { e.preventDefault(); ultimo?.focus() }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus() }
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onFechar, fechavel])
  return (
    <div className="modal-fundo nao-imprimir" onClick={fechavel ? onFechar : undefined}>
      <div ref={ref} tabIndex={-1} className={`modal${largo ? ' modal--largo' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <div className="modal__cabecalho">
          <h2 id={id}>{titulo}</h2>
          {fechavel && <button type="button" className="botao botao--link" onClick={onFechar} aria-label="Fechar">
            ✕
          </button>}
        </div>
        {children}
        {rodape && <div className="modal__rodape">{rodape}</div>}
      </div>
    </div>
  )
}

export type TipoBadge =
  | 'receita'
  | 'despesa'
  | 'transferencia'
  | 'geral'
  | 'bloco'
  | 'unidade'
  | 'paga'
  | 'aberta'
  | 'vencida'
  | 'a-vencer'
  | 'cancelada'
  | 'isenta'
  | 'excluido'
  | 'inativo'
  | 'info'
  | 'aviso'
  | 'sucesso'
  | 'erro'

export function Badge({ tipo, children }: { tipo: TipoBadge; children: ReactNode }) {
  return <span className={`badge badge--${tipo}`}>{children}</span>
}

export function Alerta({ tipo, children, acao }: { tipo: 'info' | 'aviso' | 'erro' | 'sucesso'; children: ReactNode; acao?: ReactNode }) {
  return (
    <div className={`alerta alerta--${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      <div>{children}</div>
      {acao && <div className="acoes">{acao}</div>}
    </div>
  )
}

export function EstadoVazio({ titulo, texto, children }: { titulo: string; texto?: string; children?: ReactNode }) {
  return (
    <div className="estado-vazio">
      <h3>{titulo}</h3>
      {texto && <p>{texto}</p>}
      {children && <div className="acoes" style={{ justifyContent: 'center' }}>{children}</div>}
    </div>
  )
}

export function BarraProporcional({ valor, total, tipo }: { valor: number; total: number; tipo?: 'receita' | 'despesa' }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (valor / total) * 100)) : 0
  return (
    <div className="barra" title={`${pct.toFixed(0)}%`}>
      <div className={`barra__preenchimento${tipo ? ` barra__preenchimento--${tipo}` : ''}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Valor em reais com cor por sinal. `neutro` desliga a cor. */
export function Valor({ centavos, neutro, sinalExplicito }: { centavos: Centavos; neutro?: boolean; sinalExplicito?: boolean }) {
  const classe = neutro ? '' : centavos < 0 ? 'negativo' : centavos > 0 ? 'positivo' : ''
  const texto = sinalExplicito && centavos > 0 ? `+${formatarBRL(centavos)}` : formatarBRL(centavos)
  return <span className={`num ${classe}`}>{texto}</span>
}

export function Carregando({ texto = 'Carregando...' }: { texto?: string }) {
  return <p className="texto-suave">{texto}</p>
}
