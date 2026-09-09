// Pede um motivo (obrigatório) antes de uma ação: excluir, desfazer pagamento, cancelar cobrança...
import { useState } from 'react'
import { Campo } from './campos'
import { Modal } from './comuns'

export function MotivoDialogo({
  titulo,
  texto,
  rotuloConfirmar = 'Confirmar',
  perigo,
  onConfirmar,
  onFechar,
}: {
  titulo: string
  texto?: string
  rotuloConfirmar?: string
  perigo?: boolean
  onConfirmar: (motivo: string) => Promise<unknown> | void
  onFechar: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  return (
    <Modal
      titulo={titulo}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className={`botao ${perigo ? 'botao--perigo' : 'botao--primario'}`}
            disabled={ocupado || !motivo.trim()}
            onClick={async () => {
              setOcupado(true)
              try {
                await onConfirmar(motivo.trim())
              } finally {
                setOcupado(false)
              }
            }}
          >
            {rotuloConfirmar}
          </button>
        </>
      }
    >
      {texto && <p>{texto}</p>}
      <Campo rotulo="Motivo">
        <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
      </Campo>
    </Modal>
  )
}
