// Arquivo de documentos do condomínio (atas, convenção, contratos, orçamentos...), qualquer tipo de arquivo.
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { consultas, relogioApp, servicos } from '../../dados/instancia'
import type { ArquivoAnexo } from '../../dados/servicos/anexos'
import { formatarData } from '../../dominio/datas'
import type { CategoriaDocumento, DataISO, Documento } from '../../dominio/tipos'
import { CATEGORIAS_DOCUMENTO } from '../../dominio/validacao'
import { tamanhoLegivel } from '../../exportacao/download'
import { Dropzone, ListaAnexos, ListaAnexosPendentes } from '../componentes/anexos'
import { Campo, CampoData } from '../componentes/campos'
import { Badge, EstadoVazio, Modal } from '../componentes/comuns'
import { useConfirmacao } from '../contexto/AppProviders'
import { useAcao } from '../hooks'
import { ROTULO_CATEGORIA_DOCUMENTO } from '../rotulos'

export function Arquivo() {
  const documentos = useLiveQuery(() => consultas.documentos.listar(), [])
  const totalAnexos = useLiveQuery(() => consultas.anexos.total(), [])
  const { executar } = useAcao()
  const confirmar = useConfirmacao()
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState<CategoriaDocumento | ''>('')
  const [editando, setEditando] = useState<Documento | 'novo' | null>(null)
  const [uso, setUso] = useState<{ usage?: number; quota?: number } | null>(null)
  useEffect(() => {
    navigator.storage?.estimate?.().then(setUso).catch(() => setUso(null))
  }, [documentos?.length])
  const lista = (documentos ?? []).filter((d) => {
    if (categoria && d.categoria !== categoria) return false
    const t = busca.trim().toLocaleLowerCase('pt-BR')
    return !t || `${d.titulo} ${d.descricao ?? ''}`.toLocaleLowerCase('pt-BR').includes(t)
  })
  return (
    <>
      <div className="cabecalho-pagina">
        <h1>Arquivo</h1>
        <button type="button" className="botao botao--primario" onClick={() => setEditando('novo')}>
          Novo documento
        </button>
      </div>
      <div className="filtros">
        <Campo rotulo="Tipo">
          <select value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaDocumento | '')}>
            <option value="">Todos</option>
            {CATEGORIAS_DOCUMENTO.map((c) => (
              <option key={c} value={c}>
                {ROTULO_CATEGORIA_DOCUMENTO[c]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Buscar">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} />
        </Campo>
      </div>
      {documentos && documentos.length === 0 ? (
        <EstadoVazio titulo="Nenhum documento arquivado" texto="Guarde aqui atas, convenção, regimento, contratos e orçamentos. Comprovantes de despesas ficam junto de cada lançamento.">
          <button type="button" className="botao botao--primario" onClick={() => setEditando('novo')}>
            Arquivar documento
          </button>
        </EstadoVazio>
      ) : lista.length === 0 ? <EstadoVazio titulo="Nenhum documento corresponde à busca"><button className="botao" onClick={() => { setBusca(''); setCategoria('') }}>Limpar filtros</button></EstadoVazio> : (
        lista.map((d) => (
          <div key={d.id} className="painel">
            <div className="painel__cabecalho">
              <h2>
                {d.titulo} <Badge tipo="info">{ROTULO_CATEGORIA_DOCUMENTO[d.categoria]}</Badge>
              </h2>
              <div className="acoes">
                <span className="texto-suave texto-pequeno">{formatarData(d.data)}</span>
                <button type="button" className="botao botao--pequeno" onClick={() => setEditando(d)}>
                  Editar
                </button>
                <button
                  type="button"
                  className="botao botao--pequeno botao--perigo"
                  onClick={async () => {
                    if (await confirmar({ titulo: 'Excluir documento', texto: `Excluir "${d.titulo}" e seus arquivos?`, perigo: true, confirmarTexto: 'Excluir' }))
                      void executar(() => servicos.documentos.excluir(d.id), 'Documento excluído.')
                  }}
                >
                  Excluir
                </button>
              </div>
            </div>
            {d.descricao && <p>{d.descricao}</p>}
            <ListaAnexos donoTipo="DOCUMENTO" donoId={d.id} />
            <div className="espaco-topo">
              <Dropzone texto="Adicionar arquivo a este documento" onArquivos={(a) => void executar(() => servicos.anexos.adicionar('DOCUMENTO', d.id, a), 'Arquivo adicionado.')} />
            </div>
          </div>
        ))
      )}
      <p className="texto-suave texto-pequeno">
        Armazenamento: {totalAnexos ? `${totalAnexos.quantidade} arquivo(s), ${tamanhoLegivel(totalAnexos.bytes)}` : '—'}
        {uso?.usage !== undefined && uso.quota ? ` · navegador usando ${tamanhoLegivel(uso.usage)} de ${tamanhoLegivel(uso.quota)} disponíveis` : ''}
        {totalAnexos && totalAnexos.bytes > 500 * 1024 * 1024 ? ' · Acima de 500 MB: prefira PDF e fotos reduzidas; faça backups por ano.' : ''}
      </p>
      {editando && <DocumentoForm documento={editando === 'novo' ? null : editando} onFechar={() => setEditando(null)} />}
    </>
  )
}

function DocumentoForm({ documento, onFechar }: { documento: Documento | null; onFechar: () => void }) {
  const { executar, ocupado } = useAcao()
  const [f, setF] = useState({
    titulo: documento?.titulo ?? '',
    categoria: (documento?.categoria ?? 'ATA') as CategoriaDocumento,
    data: (documento?.data ?? relogioApp.hoje()) as DataISO,
    descricao: documento?.descricao ?? '',
  })
  const [anexos, setAnexos] = useState<ArquivoAnexo[]>([])
  return (
    <Modal
      titulo={documento ? 'Editar documento' : 'Arquivar documento'}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao botao--primario"
            disabled={ocupado || !f.titulo.trim()}
            onClick={async () => {
              const r = await executar(() => (documento ? servicos.documentos.atualizar(documento.id, f) : servicos.documentos.criar(f, anexos)), 'Documento salvo.')
              if (r) onFechar()
            }}
          >
            Salvar
          </button>
        </>
      }
    >
      <div className="formulario">
        <Campo rotulo="Título">
          <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} autoFocus />
        </Campo>
        <div className="linha-campos">
          <Campo rotulo="Tipo">
            <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value as CategoriaDocumento })}>
              {CATEGORIAS_DOCUMENTO.map((c) => (
                <option key={c} value={c}>
                  {ROTULO_CATEGORIA_DOCUMENTO[c]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Data">
            <CampoData valor={f.data} onChange={(d) => setF({ ...f, data: d })} />
          </Campo>
        </div>
        <Campo rotulo="Descrição (opcional)">
          <textarea rows={2} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        </Campo>
        {!documento && (
          <Campo rotulo="Arquivos (qualquer tipo; até 50 MB cada)">
            <Dropzone onArquivos={(a) => setAnexos([...anexos, ...a])} />
            <ListaAnexosPendentes itens={anexos} onRemover={(i) => setAnexos(anexos.filter((_, j) => j !== i))} />
          </Campo>
        )}
      </div>
    </Modal>
  )
}
