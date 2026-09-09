// Dropzone (arrastar/soltar ou clicar), lista de anexos pendentes (formulários) e lista de anexos gravados.
import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { consultas, servicos } from '../../dados/instancia'
import type { ArquivoAnexo } from '../../dados/servicos/anexos'
import type { Anexo, Id } from '../../dominio/tipos'
import { abrirBlob, baixarBlob, tamanhoLegivel } from '../../exportacao/download'
import { useConfirmacao, useToast } from '../contexto/AppProviders'

const LIMITE_REDUCAO = 1_500_000
const LADO_MAXIMO = 1600

/** Reduz fotos grandes (JPEG 85%, lado máximo 1600px). Se o navegador não decodificar, mantém o original. */
async function reduzirImagem(arquivo: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(arquivo)
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height))
    if (escala === 1 && arquivo.size <= LIMITE_REDUCAO) return arquivo
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * escala)
    canvas.height = Math.round(bitmap.height * escala)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
    return blob && blob.size < arquivo.size ? blob : arquivo
  } catch {
    return arquivo
  }
}

export async function arquivosParaAnexos(arquivos: Iterable<File>, reduzirFotos: boolean): Promise<ArquivoAnexo[]> {
  const saida: ArquivoAnexo[] = []
  for (const f of arquivos) {
    if (reduzirFotos && f.type.startsWith('image/') && f.size > LIMITE_REDUCAO) {
      const blob = await reduzirImagem(f)
      const nome = blob === f ? f.name : f.name.replace(/\.[^.]+$/, '') + '.jpg'
      saida.push({ nome, mime: blob.type || f.type, blob })
    } else {
      saida.push({ nome: f.name, mime: f.type, blob: f })
    }
  }
  return saida
}

export function Dropzone({
  onArquivos,
  accept,
  reduzirFotos = false,
  texto = 'Arraste arquivos aqui ou clique para escolher',
}: {
  onArquivos: (arquivos: ArquivoAnexo[]) => void
  accept?: string
  reduzirFotos?: boolean
  texto?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [ativa, setAtiva] = useState(false)
  async function receber(lista: FileList | null) {
    if (!lista || lista.length === 0) return
    onArquivos(await arquivosParaAnexos(Array.from(lista), reduzirFotos))
  }
  return (
    <div
      className={`dropzone${ativa ? ' dropzone--ativa' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setAtiva(true)
      }}
      onDragLeave={() => setAtiva(false)}
      onDrop={(e) => {
        e.preventDefault()
        setAtiva(false)
        void receber(e.dataTransfer.files)
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
    >
      {texto}
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          void receber(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

export function ListaAnexosPendentes({ itens, onRemover }: { itens: ArquivoAnexo[]; onRemover: (indice: number) => void }) {
  if (itens.length === 0) return null
  return (
    <ul className="lista-anexos">
      {itens.map((a, i) => (
        <li key={`${a.nome}-${i}`}>
          <span>📎</span>
          <span style={{ flex: 1 }}>
            {a.nome} <span className="texto-suave texto-pequeno">({tamanhoLegivel(a.blob.size)})</span>
          </span>
          <button type="button" className="botao botao--link botao--pequeno" onClick={() => onRemover(i)}>
            Remover
          </button>
        </li>
      ))}
    </ul>
  )
}

export function ListaAnexos({ donoTipo, donoId, permitirRemover = true, compacta }: { donoTipo: Anexo['donoTipo']; donoId: Id; permitirRemover?: boolean; compacta?: boolean }) {
  const anexos = useLiveQuery(() => consultas.anexos.de(donoTipo, donoId), [donoTipo, donoId])
  const toast = useToast()
  const confirmar = useConfirmacao()
  if (!anexos || anexos.length === 0) return compacta ? null : <p className="texto-suave texto-pequeno">Sem anexos.</p>
  async function abrir(a: Anexo, baixar: boolean) {
    const blob = await consultas.anexos.blob(a.id)
    if (!blob) return toast.erro('Arquivo não encontrado.')
    const b = blob.type ? blob : new Blob([blob], { type: a.mime })
    if (baixar) baixarBlob(b, a.nome)
    else abrirBlob(b, a.nome)
  }
  async function remover(a: Anexo) {
    if (!(await confirmar({ titulo: 'Remover anexo', texto: `Remover "${a.nome}"?`, perigo: true, confirmarTexto: 'Remover' }))) return
    try {
      await servicos.anexos.remover(a.id)
      toast.sucesso('Anexo removido.')
    } catch (e) {
      toast.deErro(e)
    }
  }
  return (
    <ul className="lista-anexos">
      {anexos.map((a) => (
        <li key={a.id}>
          <span>📎</span>
          <span style={{ flex: 1 }}>
            {a.nome} <span className="texto-suave texto-pequeno">({tamanhoLegivel(a.tamanho)})</span>
          </span>
          <button type="button" className="botao botao--link botao--pequeno nao-imprimir" onClick={() => void abrir(a, false)}>
            Abrir
          </button>
          <button type="button" className="botao botao--link botao--pequeno nao-imprimir" onClick={() => void abrir(a, true)}>
            Baixar
          </button>
          {permitirRemover && (
            <button type="button" className="botao botao--link botao--pequeno nao-imprimir" onClick={() => void remover(a)}>
              Remover
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
