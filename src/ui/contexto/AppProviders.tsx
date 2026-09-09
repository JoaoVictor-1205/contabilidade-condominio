// Toasts e diálogo de confirmação, disponíveis em toda a aplicação.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Modal } from '../componentes/comuns'
import { ehErroDominio } from '../../dominio/erros'

export type TipoToast = 'sucesso' | 'erro' | 'aviso' | 'info'

interface Toast {
  id: number
  tipo: TipoToast
  texto: string
}

export interface OpcoesConfirmacao {
  titulo: string
  texto?: ReactNode
  confirmarTexto?: string
  cancelarTexto?: string
  perigo?: boolean
  /** Exige digitar exatamente este texto para habilitar a confirmação (ex.: 'APAGAR'). */
  exigirTexto?: string
}

interface ContextoApp {
  toast: (tipo: TipoToast, texto: string) => void
  confirmar: (opcoes: OpcoesConfirmacao) => Promise<boolean>
}

const Contexto = createContext<ContextoApp | null>(null)

export function mensagemDeErro(e: unknown): string {
  if (ehErroDominio(e)) return e.message
  if (e instanceof Error) {
    if (e.name === 'QuotaExceededError' || /quota/i.test(e.message)) return 'O navegador ficou sem espaço para guardar os dados. Faça um backup e libere espaço.'
    return e.message || 'Erro inesperado.'
  }
  return String(e)
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const [confirmacao, setConfirmacao] = useState<(OpcoesConfirmacao & { resolver: (ok: boolean) => void }) | null>(null)
  const [textoDigitado, setTextoDigitado] = useState('')
  const confirmacaoPendente = useRef(false)

  const toast = useCallback((tipo: TipoToast, texto: string) => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, tipo, texto }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === 'erro' ? 8000 : 4000)
  }, [])

  const confirmar = useCallback((opcoes: OpcoesConfirmacao) => {
    if (confirmacaoPendente.current) return Promise.resolve(false)
    confirmacaoPendente.current = true
    setTextoDigitado('')
    return new Promise<boolean>((resolver) => setConfirmacao({ ...opcoes, resolver }))
  }, [])

  const valor = useMemo(() => ({ toast, confirmar }), [toast, confirmar])

  function responder(ok: boolean) {
    confirmacaoPendente.current = false
    confirmacao?.resolver(ok)
    setConfirmacao(null)
  }

  const habilitado = !confirmacao?.exigirTexto || textoDigitado.trim() === confirmacao.exigirTexto

  return (
    <Contexto.Provider value={valor}>
      {children}
      <div className="toasts nao-imprimir" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tipo}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
            {t.texto}
          </div>
        ))}
      </div>
      {confirmacao && (
        <Modal titulo={confirmacao.titulo} onFechar={() => responder(false)}>
            {confirmacao.texto && <div>{confirmacao.texto}</div>}
            {confirmacao.exigirTexto && (
              <div className="campo espaco-topo">
                <label htmlFor="confirmacao-texto" className="campo__rotulo">
                  Digite <strong>{confirmacao.exigirTexto}</strong> para confirmar
                </label>
                <input id="confirmacao-texto" autoFocus value={textoDigitado} onChange={(e) => setTextoDigitado(e.target.value)} />
              </div>
            )}
            <div className="modal__rodape">
              <button type="button" className="botao" onClick={() => responder(false)}>
                {confirmacao.cancelarTexto ?? 'Cancelar'}
              </button>
              <button type="button" className={`botao ${confirmacao.perigo ? 'botao--perigo' : 'botao--primario'}`} disabled={!habilitado} onClick={() => responder(true)} autoFocus={!confirmacao.exigirTexto}>
                {confirmacao.confirmarTexto ?? 'Confirmar'}
              </button>
            </div>
        </Modal>
      )}
    </Contexto.Provider>
  )
}

export function useApp(): ContextoApp {
  const c = useContext(Contexto)
  if (!c) throw new Error('useApp fora de AppProviders')
  return c
}

export function useToast() {
  const { toast } = useApp()
  return useMemo(
    () => ({
      sucesso: (t: string) => toast('sucesso', t),
      erro: (t: string) => toast('erro', t),
      aviso: (t: string) => toast('aviso', t),
      info: (t: string) => toast('info', t),
      deErro: (e: unknown) => toast('erro', mensagemDeErro(e)),
    }),
    [toast],
  )
}

export function useConfirmacao() {
  return useApp().confirmar
}
