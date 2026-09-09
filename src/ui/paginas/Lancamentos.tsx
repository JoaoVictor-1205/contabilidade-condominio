// Lista de lançamentos com filtros, totais e exportação.
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { consultas, relogioApp } from '../../dados/instancia'
import { formatarData, mesDe } from '../../dominio/datas'
import type { Id, Lancamento, Natureza } from '../../dominio/tipos'
import { exportarLancamentosCsv } from '../../exportacao/csv'
import { exportarLancamentosExcel } from '../../exportacao/excel'
import { Campo, periodoDe, SeletorPeriodo, tituloDoPeriodo, type PeriodoSelecionado } from '../componentes/campos'
import { Badge, EstadoVazio, Valor, type TipoBadge } from '../componentes/comuns'
import { BotaoImprimir, CabecalhoImpressao } from '../componentes/impressao'
import { useEstrutura } from '../hooks'
import { paraHash } from '../rotas'
import { porId, ROTULO_NATUREZA, rotuloEscopo, valorComSinal } from '../rotulos'

const PASSO = 200

export function Lancamentos() {
  const { blocos, unidades, categorias } = useEstrutura()
  const [periodo, setPeriodo] = useState<PeriodoSelecionado>({ tipo: 'mes', mes: mesDe(relogioApp.hoje()) })
  const [natureza, setNatureza] = useState<Natureza | ''>('')
  const [blocoId, setBlocoId] = useState<Id | ''>('')
  const [categoriaId, setCategoriaId] = useState<Id | ''>('')
  const [status, setStatus] = useState<'ATIVO' | 'EXCLUIDO' | 'TODOS'>('ATIVO')
  const [texto, setTexto] = useState('')
  const [limite, setLimite] = useState(PASSO)
  const p = periodoDe(periodo)
  const lista = useLiveQuery(
    () => consultas.lancamentos.listar({ inicio: p.inicio, fim: p.fim, natureza: natureza || undefined, blocoId: blocoId || undefined, categoriaId: categoriaId || undefined, status, texto }),
    [p.inicio, p.fim, natureza, blocoId, categoriaId, status, texto],
  )
  const anexosPorDono = useLiveQuery(() => consultas.anexos.contagemPorDono('LANCAMENTO'), [])
  const blocosPorId = useMemo(() => porId(blocos), [blocos])
  const unidadesPorId = useMemo(() => porId(unidades), [unidades])
  const categoriasPorId = useMemo(() => porId(categorias), [categorias])
  const totais = useMemo(() => {
    let receitas = 0
    let despesas = 0
    for (const l of lista ?? []) {
      if (l.status !== 'ATIVO') continue
      if (l.natureza === 'RECEITA') receitas += valorComSinal(l)
      if (l.natureza === 'DESPESA') despesas -= valorComSinal(l)
    }
    return { receitas, despesas, saldo: receitas - despesas }
  }, [lista])
  const visiveis = (lista ?? []).slice(0, limite)
  const nomeArquivo = `lancamentos-${p.inicio}-a-${p.fim}`
  const exportaveis = () => (lista ?? []).map((l) => ({ lancamento: l, escopo: rotuloEscopo(l, blocosPorId, unidadesPorId), categoria: categoriasPorId.get(l.categoriaId)?.nome ?? '' }))

  return (
    <>
      <CabecalhoImpressao titulo="Lançamentos" subtitulo={tituloDoPeriodo(periodo)} />
      <div className="cabecalho-pagina">
        <h1>Lançamentos</h1>
        <div className="acoes">
          <a className="botao botao--perigo" href={paraHash({ nome: 'lancamentoNovo', natureza: 'DESPESA' })}>
            + Despesa
          </a>
          <a className="botao botao--sucesso" href={paraHash({ nome: 'lancamentoNovo', natureza: 'RECEITA' })}>
            + Receita
          </a>
          <a className="botao" href={paraHash({ nome: 'transferenciaNova' })}>
            Transferir entre blocos
          </a>
          <button type="button" className="botao" onClick={() => exportarLancamentosExcel(exportaveis(), nomeArquivo)}>
            Excel
          </button>
          <button type="button" className="botao" onClick={() => exportarLancamentosCsv(exportaveis(), nomeArquivo)}>
            CSV
          </button>
          <BotaoImprimir />
        </div>
      </div>
      <div className="filtros">
        <SeletorPeriodo valor={periodo} onChange={setPeriodo} />
        <Campo rotulo="Tipo">
          <select value={natureza} onChange={(e) => setNatureza(e.target.value as Natureza | '')}>
            <option value="">Todos</option>
            <option value="RECEITA">Receitas</option>
            <option value="DESPESA">Despesas</option>
            <option value="TRANSFERENCIA">Transferências</option>
          </select>
        </Campo>
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
        <Campo rotulo="Categoria">
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Situação">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="ATIVO">Ativos</option>
            <option value="EXCLUIDO">Excluídos</option>
            <option value="TODOS">Todos</option>
          </select>
        </Campo>
        <Campo rotulo="Buscar">
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="descrição" />
        </Campo>
      </div>
      <div className="cards">
        <div className="card">
          <div className="card__titulo">Receitas</div>
          <div className="card__valor positivo">
            <Valor centavos={totais.receitas} neutro />
          </div>
        </div>
        <div className="card">
          <div className="card__titulo">Despesas</div>
          <div className="card__valor negativo">
            <Valor centavos={totais.despesas} neutro />
          </div>
        </div>
        <div className="card">
          <div className="card__titulo">Saldo do período</div>
          <div className="card__valor">
            <Valor centavos={totais.saldo} />
          </div>
        </div>
        <div className="card">
          <div className="card__titulo">Lançamentos</div>
          <div className="card__valor">{lista?.length ?? 0}</div>
        </div>
      </div>
      {lista && lista.length === 0 ? (
        <EstadoVazio titulo="Nenhum lançamento no período" texto="Registre uma despesa ou receita, ou mude os filtros.">
          <a className="botao botao--primario" href={paraHash({ nome: 'lancamentoNovo', natureza: 'DESPESA' })}>
            Nova despesa
          </a>
        </EstadoVazio>
      ) : (
        <div className="painel">
          <div className="nao-imprimir"><TabelaLancamentos lista={visiveis} blocos={blocosPorId} unidades={unidadesPorId} categorias={categoriasPorId} anexos={anexosPorDono} /></div>
          <div className="somente-impressao"><TabelaLancamentos lista={lista ?? []} blocos={blocosPorId} unidades={unidadesPorId} categorias={categoriasPorId} /></div>
          {lista && lista.length > limite && (
            <div className="acoes espaco-topo nao-imprimir">
              <button type="button" className="botao" onClick={() => setLimite(limite + PASSO)}>
                Carregar mais ({lista.length - limite} restantes)
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}

const BADGE_NATUREZA: Record<Natureza, TipoBadge> = { RECEITA: 'receita', DESPESA: 'despesa', TRANSFERENCIA: 'transferencia' }

export function TabelaLancamentos({
  lista,
  blocos,
  unidades,
  categorias,
  anexos,
  valorAtribuido,
}: {
  lista: Lancamento[]
  blocos: ReadonlyMap<string, { nome: string }>
  unidades: ReadonlyMap<string, { numero: string }>
  categorias: ReadonlyMap<string, { nome: string }>
  anexos?: ReadonlyMap<string, number>
  /** Quando informado (relatório filtrado por bloco), mostra o valor atribuído ao bloco. */
  valorAtribuido?: ReadonlyMap<string, number>
}) {
  return (
    <div className="tabela-rolagem">
      <table className="tabela">
        <thead>
          <tr>
            <th>Data</th>
            <th>Descrição</th>
            <th>Categoria</th>
            <th>Escopo</th>
            <th className="num">{valorAtribuido ? 'Valor no bloco' : 'Valor'}</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((l) => (
            <tr key={l.id} className={l.status === 'EXCLUIDO' ? 'texto-suave' : ''}>
              <td className="num">{formatarData(l.data)}</td>
              <td>
                <a href={paraHash({ nome: 'lancamento', id: l.id })}>{l.descricao}</a>{' '}
                {anexos?.get(l.id) ? <span title={`${anexos.get(l.id)} anexo(s)`}>📎</span> : null}{' '}
                {l.status === 'EXCLUIDO' && <Badge tipo="excluido">Excluído</Badge>}
                {l.tipo === 'ESTORNO' && <Badge tipo="aviso">Estorno</Badge>}
              </td>
              <td>{categorias.get(l.categoriaId)?.nome ?? '—'}</td>
              <td>
                <Badge tipo={l.natureza === 'TRANSFERENCIA' ? 'transferencia' : l.escopoTipo === 'GERAL' ? 'geral' : l.escopoTipo === 'BLOCO' ? 'bloco' : 'unidade'}>
                  {rotuloEscopo(l, blocos, unidades)}
                </Badge>
              </td>
              <td className="num">
                {valorAtribuido ? <Valor centavos={valorAtribuido.get(l.id) ?? 0} /> : l.natureza === 'TRANSFERENCIA' ? <Valor centavos={l.valorCentavos} neutro /> : <Valor centavos={valorComSinal(l)} />}{' '}
                <Badge tipo={BADGE_NATUREZA[l.natureza]}>{ROTULO_NATUREZA[l.natureza]}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
