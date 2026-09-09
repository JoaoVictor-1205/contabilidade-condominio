// Inadimplência: cobranças vencidas agrupadas por apartamento, com baixa direta e versão para o quadro de avisos.
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { consultas, relogioApp, servicos } from '../../dados/instancia'
import { agruparInadimplencia, totalInadimplencia, type GrupoInadimplencia } from '../../dominio/cobrancas'
import { formatarData, formatarMesCurto } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import type { DataISO, FormaPagamento, Id } from '../../dominio/tipos'
import { FORMAS_PAGAMENTO } from '../../dominio/validacao'
import { exportarInadimplenciaExcel } from '../../exportacao/excel'
import { Campo, CampoData } from '../componentes/campos'
import { Badge, EstadoVazio, Modal } from '../componentes/comuns'
import { BotaoImprimir, CabecalhoImpressao } from '../componentes/impressao'
import { useAcao, useEstrutura } from '../hooks'
import { paraHash } from '../rotas'
import { ROTULO_FORMA } from '../rotulos'

export function Inadimplencia() {
  const hoje = relogioApp.hoje()
  const { blocos, unidades } = useEstrutura()
  const abertas = useLiveQuery(() => consultas.cobrancas.abertas(), [])
  const [blocoId, setBlocoId] = useState<Id | ''>('')
  const [incluirAVencer, setIncluirAVencer] = useState(false)
  const [ocultarNomes, setOcultarNomes] = useState(false)
  const [pagando, setPagando] = useState<GrupoInadimplencia | null>(null)
  const grupos = useMemo(() => agruparInadimplencia(abertas ?? [], unidades, blocos, hoje, { incluirAVencer, blocoId: blocoId || null }), [abertas, unidades, blocos, hoje, incluirAVencer, blocoId])
  const total = totalInadimplencia(grupos)
  const porBloco = useMemo(() => {
    const m = new Map<Id, GrupoInadimplencia[]>()
    for (const g of grupos) m.set(g.bloco.id, [...(m.get(g.bloco.id) ?? []), g])
    return m
  }, [grupos])
  return (
    <>
      <CabecalhoImpressao titulo={incluirAVencer ? 'Taxas em aberto' : 'Taxas em atraso'} subtitulo={`posição em ${formatarData(hoje)}`} />
      <div className="cabecalho-pagina">
        <h1>Inadimplência</h1>
        <div className="acoes">
          <button
            type="button"
            className="botao"
            disabled={grupos.length === 0}
            onClick={() =>
              exportarInadimplenciaExcel(
                grupos.map((g) => ({ bloco: g.bloco.nome, apto: g.unidade.numero, responsavel: g.unidade.responsavel ?? '', competencias: g.vencidas.map((c) => formatarMesCurto(c.competencia)).join(', '), quantidade: g.vencidas.length, totalCentavos: g.totalDevidoCentavos })),
                `inadimplencia-${hoje}`,
              )
            }
          >
            Excel
          </button>
          <BotaoImprimir />
        </div>
      </div>
      <div className="filtros nao-imprimir">
        <Campo rotulo="Bloco">
          <select value={blocoId} onChange={(e) => setBlocoId(e.target.value)}>
            <option value="">Todos</option>
            {blocos.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Incluir a vencer" inline>
          <input type="checkbox" checked={incluirAVencer} onChange={(e) => setIncluirAVencer(e.target.checked)} />
        </Campo>
        <Campo rotulo="Ocultar nomes (quadro de avisos)" inline>
          <input type="checkbox" checked={ocultarNomes} onChange={(e) => setOcultarNomes(e.target.checked)} />
        </Campo>
      </div>
      <div className="cards">
        <div className="card">
          <div className="card__titulo">Apartamentos</div>
          <div className="card__valor">{total.unidades}</div>
        </div>
        <div className="card">
          <div className="card__titulo">Cobranças</div>
          <div className="card__valor">{total.cobrancas}</div>
        </div>
        <div className="card">
          <div className="card__titulo">Total devido</div>
          <div className="card__valor negativo">{formatarBRL(total.valorCentavos)}</div>
        </div>
      </div>
      {grupos.length === 0 ? (
        <EstadoVazio titulo="Nenhuma taxa em atraso" texto="Todas as cobranças vencidas estão pagas, canceladas ou isentas." />
      ) : (
        [...porBloco.entries()].map(([id, lista]) => (
          <div key={id} className="painel">
            <h2>
              Bloco {lista[0]!.bloco.nome} <span className="texto-suave texto-pequeno">— {lista.length} apto(s), {formatarBRL(lista.reduce((s, g) => s + g.totalDevidoCentavos, 0))}</span>
            </h2>
            <table className="tabela tabela--compacta">
              <thead>
                <tr>
                  <th>Apto</th>
                  {!ocultarNomes && <th>Responsável</th>}
                  <th>Competências</th>
                  <th className="num">Qtde</th>
                  <th className="num">Total devido</th>
                  <th className="nao-imprimir"></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((g) => (
                  <tr key={g.unidade.id}>
                    <td>
                      <a href={paraHash({ nome: 'unidade', id: g.unidade.id })}>{g.unidade.numero}</a> {g.unidadeInativa && <Badge tipo="inativo">desativado</Badge>}
                    </td>
                    {!ocultarNomes && <td>{g.unidade.responsavel ?? ''}</td>}
                    <td>{g.vencidas.map((c) => formatarMesCurto(c.competencia)).join(', ')}</td>
                    <td className="num">{g.vencidas.length}</td>
                    <td className="num negativo">{formatarBRL(g.totalDevidoCentavos)}</td>
                    <td className="acoes-celula nao-imprimir">
                      <button type="button" className="botao botao--pequeno" onClick={() => setPagando(g)}>
                        Registrar pagamento
                      </button>{' '}
                      <a className="botao botao--link botao--pequeno" href={paraHash({ nome: 'extratoUnidade', id: g.unidade.id })}>
                        Extrato
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
      {pagando && <PagarGrupoDialogo grupo={pagando} onFechar={() => setPagando(null)} />}
    </>
  )
}

function PagarGrupoDialogo({ grupo, onFechar }: { grupo: GrupoInadimplencia; onFechar: () => void }) {
  const { executar, ocupado } = useAcao()
  const [erros, setErros] = useState<Array<{ cobrancaId: Id; mensagem: string }>>([])
  const [concluidos, setConcluidos] = useState<Set<Id>>(new Set())
  const [ids, setIds] = useState<Set<Id>>(new Set(grupo.vencidas.map((c) => c.id)))
  const [data, setData] = useState<DataISO>(relogioApp.hoje())
  const [forma, setForma] = useState<FormaPagamento>('PIX')
  const total = grupo.vencidas.filter((c) => ids.has(c.id)).reduce((s, c) => s + c.valorCentavos, 0)
  return (
    <Modal
      titulo={`Registrar pagamento — ${grupo.bloco.nome} apto ${grupo.unidade.numero}`}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao botao--primario"
            disabled={ocupado || ids.size === 0}
            onClick={async () => {
              const r = await executar(() => servicos.cobrancas.registrarPagamentosEmLote([...ids], { data, formaPagamento: forma }))
              if (r) {
                setConcluidos(atual => new Set([...atual, ...r.ok]))
                setIds(new Set(r.erros.map(e => e.cobrancaId)))
                setErros(r.erros)
                if (!r.erros.length) onFechar()
              }
            }}
          >
            Registrar {formatarBRL(total)}
          </button>
        </>
      }
    >
      <p className="texto-suave">Para pagar com juros, desconto ou comprovante, use Cobranças › Pagar… na competência.</p>
      {erros.length > 0 && <div role="alert" className="alerta alerta--erro"><div>{concluidos.size} pagamento(s) registrado(s); corrija os dados para tentar os pendentes.<ul>{erros.map(e => <li key={e.cobrancaId}>{e.mensagem}</li>)}</ul></div></div>}
      <table className="tabela tabela--compacta">
        <tbody>
          {grupo.vencidas.map((c) => (
            <tr key={c.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Selecionar competência ${formatarMesCurto(c.competencia)}`}
                  disabled={ocupado || concluidos.has(c.id)}
                  checked={ids.has(c.id)}
                  onChange={(e) => {
                    const s = new Set(ids)
                    if (e.target.checked) s.add(c.id)
                    else s.delete(c.id)
                    setIds(s)
                  }}
                />
              </td>
              <td>{formatarMesCurto(c.competencia)}</td>
              <td>venc. {formatarData(c.vencimento)}</td>
              <td className="num">{formatarBRL(c.valorCentavos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="linha-campos espaco-topo">
        <Campo rotulo="Data do pagamento">
          <CampoData valor={data} onChange={setData} />
        </Campo>
        <Campo rotulo="Forma">
          <select value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento)}>
            {FORMAS_PAGAMENTO.map((fp) => (
              <option key={fp} value={fp}>
                {ROTULO_FORMA[fp]}
              </option>
            ))}
          </select>
        </Campo>
      </div>
    </Modal>
  )
}
