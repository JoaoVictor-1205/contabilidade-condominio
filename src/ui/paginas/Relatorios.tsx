// Demonstrativo por período: todos os blocos ou um bloco; base caixa (padrão) ou competência.
import { useEffect, useMemo, useState } from 'react'
import { relogioApp } from '../../dados/instancia'
import type { BaseDemonstrativo, Demonstrativo } from '../../dominio/demonstrativo'
import { formatarMesCurto, mesDe } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import type { Id } from '../../dominio/tipos'
import { exportarDemonstrativoCsv, type LancamentoExportavel } from '../../exportacao/csv'
import { exportarDemonstrativoExcel } from '../../exportacao/excel'
import { Campo, periodoDe, SeletorPeriodo, tituloDoPeriodo, type PeriodoSelecionado } from '../componentes/campos'
import { BarraProporcional, Carregando, Valor } from '../componentes/comuns'
import { BotaoImprimir, CabecalhoImpressao, RodapeImpressao } from '../componentes/impressao'
import { useDemonstrativo, useEstrutura } from '../hooks'
import { navegar, paraHash } from '../rotas'
import { porId, rotuloEscopo } from '../rotulos'
import { TabelaLancamentos } from './Lancamentos'

export function TabelaDemonstrativo({ dem, nomesBlocos }: { dem: Demonstrativo; nomesBlocos?: ReadonlyMap<Id, string> }) {
  const mostrarSaldoInicial = dem.linhas.some((l) => l.saldoInicialNoPeriodo !== 0) || dem.total.saldoInicialNoPeriodo !== 0
  const linhas = [...dem.linhas, dem.total]
  const rotuloFinal = dem.base === 'data' ? 'Caixa final' : 'Resultado acumulado'
  return (
    <div className="tabela-rolagem">
      <table className="tabela tabela--compacta">
        <thead>
          <tr>
            <th>Bloco</th>
            <th className="num">Aptos</th>
            <th className="num">Saldo anterior</th>
            {mostrarSaldoInicial && <th className="num">Saldo inicial</th>}
            <th className="num">Receitas próprias</th>
            <th className="num">Receitas rateadas</th>
            <th className="num">Despesas próprias</th>
            <th className="num">Despesas rateadas</th>
            <th className="num">Transferências</th>
            <th className="num">Saldo do período</th>
            <th className="num">{rotuloFinal}</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.blocoId} className={l.blocoId === 'TOTAL' ? 'tabela__total' : ''}>
              <td>
                {nomesBlocos?.get(l.blocoId) ?? l.nome}
                {!l.ativo && l.blocoId !== 'TOTAL' && <span className="texto-suave texto-pequeno"> (inativo)</span>}
              </td>
              <td className="num">{l.unidades}</td>
              <td className="num">
                <Valor centavos={l.saldoAnterior} neutro />
              </td>
              {mostrarSaldoInicial && (
                <td className="num">
                  <Valor centavos={l.saldoInicialNoPeriodo} neutro />
                </td>
              )}
              <td className="num">{formatarBRL(l.receitasProprias)}</td>
              <td className="num">{formatarBRL(l.receitasRateadas)}</td>
              <td className="num">{formatarBRL(l.despesasProprias)}</td>
              <td className="num">{formatarBRL(l.despesasRateadas)}</td>
              <td className="num">
                <Valor centavos={l.transferencias} neutro={l.transferencias === 0} />
              </td>
              <td className="num">
                <Valor centavos={l.saldoPeriodo} />
              </td>
              <td className="num">
                <Valor centavos={l.saldoFinal} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(dem.total.estornosReceita !== 0 || dem.total.estornosDespesa !== 0) && <p className="texto-pequeno">Inclui estornos: receitas {formatarBRL(dem.total.estornosReceita)}, despesas {formatarBRL(dem.total.estornosDespesa)}. Os totais já estão líquidos desses valores.</p>}
      <p className={`texto-pequeno ${dem.conferenciaCentavos === 0 ? 'texto-suave' : 'negativo'}`}>
        Conferência: {formatarBRL(dem.conferenciaCentavos)} {dem.conferenciaCentavos === 0 ? '(a soma dos blocos fecha com o total do condomínio)' : '(DIVERGÊNCIA — verifique os lançamentos)'}
      </p>
    </div>
  )
}

export function Relatorios() {
  useEffect(() => { document.body.classList.add('impressao-relatorio'); return () => document.body.classList.remove('impressao-relatorio') }, [])
  const hoje = relogioApp.hoje()
  const { blocos, unidades, categorias, condominio } = useEstrutura()
  const [sel, setSel] = useState<PeriodoSelecionado>({ tipo: 'mes', mes: mesDe(hoje) })
  const [blocoId, setBlocoId] = useState<Id | ''>('')
  const [base, setBase] = useState<BaseDemonstrativo>('data')
  const [mostrarLancamentos, setMostrarLancamentos] = useState(true)
  const [unidadeExtrato, setUnidadeExtrato] = useState<Id>('')
  const periodo = periodoDe(sel)
  const dem = useDemonstrativo(periodo, base, blocoId || null)
  const blocosPorId = useMemo(() => porId(blocos), [blocos])
  const unidadesPorId = useMemo(() => porId(unidades), [unidades])
  const categoriasPorId = useMemo(() => porId(categorias), [categorias])
  const nomesBlocos = useMemo(() => new Map(blocos.map((b) => [b.id, b.nome])), [blocos])
  const titulo = tituloDoPeriodo(sel)
  const escopoTitulo = blocoId ? `Bloco ${blocosPorId.get(blocoId)?.nome ?? ''}` : 'Todos os blocos'
  const exportaveis = (): LancamentoExportavel[] =>
    (dem?.lancamentos ?? []).map((la) => ({
      lancamento: la.lancamento,
      escopo: rotuloEscopo(la.lancamento, blocosPorId, unidadesPorId),
      categoria: categoriasPorId.get(la.lancamento.categoriaId)?.nome ?? '',
      ...(blocoId ? { valorAtribuidoCentavos: la.valorAtribuidoCentavos } : {}),
    }))
  const nomeArquivo = `demonstrativo-${periodo.inicio}-a-${periodo.fim}${blocoId ? '-' + (blocosPorId.get(blocoId)?.nome ?? '') : ''}`
  const valorAtribuido = useMemo(() => (blocoId && dem ? new Map(dem.lancamentos.map((la) => [la.lancamento.id, la.valorAtribuidoCentavos])) : undefined), [dem, blocoId])
  const maiorCategoria = Math.max(1, ...(dem?.porCategoria.map((c) => c.valorCentavos) ?? [1]))

  return (
    <>
      <CabecalhoImpressao titulo={`Demonstrativo — ${escopoTitulo}`} subtitulo={`${titulo} · base ${base === 'data' ? 'caixa' : 'competência'}`} />
      <div className="cabecalho-pagina">
        <h1>Relatórios</h1>
        <div className="acoes">
          <button type="button" className="botao" disabled={!dem} onClick={() => dem && exportarDemonstrativoExcel(dem, { nomeCondominio: condominio?.nome ?? '', tituloPeriodo: `${titulo} — ${escopoTitulo}`, nomesBlocos, lancamentos: exportaveis() }, nomeArquivo)}>
            Excel
          </button>
          <button type="button" className="botao" disabled={!dem} onClick={() => dem && exportarDemonstrativoCsv(dem, nomeArquivo)}>
            CSV
          </button>
          <BotaoImprimir />
        </div>
      </div>
      <div className="filtros nao-imprimir">
        <SeletorPeriodo valor={sel} onChange={setSel} />
        <Campo rotulo="Escopo">
          <select value={blocoId} onChange={(e) => setBlocoId(e.target.value)}>
            <option value="">Todos os blocos</option>
            {blocos.map((b) => (
              <option key={b.id} value={b.id}>
                Bloco {b.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Base" ajuda={base === 'competencia' ? 'Visão gerencial por mês de referência; pode mudar quando taxas atrasadas são pagas.' : 'Dinheiro que entrou e saiu no período.'}>
          <select value={base} onChange={(e) => setBase(e.target.value as BaseDemonstrativo)}>
            <option value="data">Caixa (data do pagamento)</option>
            <option value="competencia">Competência (mês de referência)</option>
          </select>
        </Campo>
        <Campo rotulo="Incluir lançamentos" inline>
          <input type="checkbox" checked={mostrarLancamentos} onChange={(e) => setMostrarLancamentos(e.target.checked)} />
        </Campo>
      </div>
      {!dem ? (
        <Carregando />
      ) : (
        <>
          <div className="cards">
            <Card titulo="Saldo anterior" centavos={dem.total.saldoAnterior} neutro />
            {dem.total.saldoInicialNoPeriodo !== 0 && <Card titulo="Saldo inicial" centavos={dem.total.saldoInicialNoPeriodo} neutro />}
            <Card titulo="Receitas" centavos={dem.total.receitas} classe="positivo" />
            <Card titulo="Despesas" centavos={dem.total.despesas} classe="negativo" />
            {blocoId && <Card titulo="Transferências" centavos={dem.total.transferencias} />}
            <Card titulo="Saldo do período" centavos={dem.total.saldoPeriodo} />
            <Card titulo={base === 'data' ? 'Caixa final' : 'Resultado acumulado'} centavos={dem.total.saldoFinal} />
          </div>
          <div className="painel secao">
            <h2>Por bloco</h2>
            <TabelaDemonstrativo dem={dem} nomesBlocos={nomesBlocos} />
          </div>
          <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
            <div className="painel secao">
              <h2>Por categoria{blocoId ? ' (valor no bloco)' : ''}</h2>
              <table className="tabela tabela--compacta">
                <tbody>
                  {dem.porCategoria.map((c) => (
                    <tr key={c.categoriaId}>
                      <td style={{ width: '40%' }}>{c.nome}</td>
                      <td>
                        <BarraProporcional valor={c.valorCentavos} total={maiorCategoria} tipo={c.natureza === 'RECEITA' ? 'receita' : 'despesa'} />
                      </td>
                      <td className="num">
                        <Valor centavos={c.natureza === 'DESPESA' ? -c.valorCentavos : c.valorCentavos} />
                      </td>
                    </tr>
                  ))}
                  {dem.porCategoria.length === 0 && (
                    <tr>
                      <td className="texto-suave">Sem movimento no período.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {dem.cobrancas && (
              <div className="painel secao">
                <h2>Taxas condominiais</h2>
                <p className="texto-suave texto-pequeno">Competências {dem.cobrancas.competencias.map(formatarMesCurto).join(', ')} (independe da base).</p>
                <table className="tabela tabela--compacta">
                  <thead>
                    <tr>
                      <th>Bloco</th>
                      <th className="num">Geradas</th>
                      <th className="num">Pagas</th>
                      <th className="num">Vencidas</th>
                      <th className="num">Recebido</th>
                      <th className="num">Em aberto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(dem.cobrancas.porBloco)
                      .sort(([a], [b]) => (blocosPorId.get(a)?.ordem ?? 0) - (blocosPorId.get(b)?.ordem ?? 0))
                      .map(([id, r]) => (
                        <tr key={id}>
                          <td>{nomesBlocos.get(id) ?? id}</td>
                          <td className="num">{r.geradas}</td>
                          <td className="num">{r.pagas}</td>
                          <td className="num">{r.vencidas}</td>
                          <td className="num">{formatarBRL(r.valorRecebidoCentavos)}</td>
                          <td className="num">{formatarBRL(r.valorEmAbertoCentavos)}</td>
                        </tr>
                      ))}
                    <tr className="tabela__total">
                      <td>Total</td>
                      <td className="num">{dem.cobrancas.geradas}</td>
                      <td className="num">{dem.cobrancas.pagas}</td>
                      <td className="num">{dem.cobrancas.vencidas}</td>
                      <td className="num">{formatarBRL(dem.cobrancas.valorRecebidoCentavos)}</td>
                      <td className="num">{formatarBRL(dem.cobrancas.valorEmAbertoCentavos)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {mostrarLancamentos && (
            <div className="painel secao">
              <h2>Lançamentos do período ({dem.lancamentos.length})</h2>
              <TabelaLancamentos lista={dem.lancamentos.map((la) => la.lancamento)} blocos={blocosPorId} unidades={unidadesPorId} categorias={categoriasPorId} valorAtribuido={valorAtribuido} />
            </div>
          )}
          <div className="painel nao-imprimir">
            <h2>Extrato de um apartamento</h2>
            <div className="linha-campos" style={{ alignItems: 'flex-end' }}>
              <Campo rotulo="Apartamento">
                <select value={unidadeExtrato} onChange={(e) => setUnidadeExtrato(e.target.value)}>
                  <option value="">Selecione…</option>
                  {blocos.map((b) => (
                    <optgroup key={b.id} label={`Bloco ${b.nome}`}>
                      {unidades
                        .filter((u) => u.blocoId === b.id)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.numero}
                            {u.responsavel ? ` — ${u.responsavel}` : ''}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </Campo>
              <a className={`botao${unidadeExtrato ? '' : ' botao--link'}`} href={unidadeExtrato ? paraHash({ nome: 'extratoUnidade', id: unidadeExtrato }) : '#'} onClick={(e) => { if (!unidadeExtrato) e.preventDefault(); else { e.preventDefault(); navegar({ nome: 'extratoUnidade', id: unidadeExtrato }) } }}>
                Abrir extrato
              </a>
            </div>
          </div>
          <RodapeImpressao />
        </>
      )}
    </>
  )
}

function Card({ titulo, centavos, classe, neutro }: { titulo: string; centavos: number; classe?: string; neutro?: boolean }) {
  return (
    <div className="card">
      <div className="card__titulo">{titulo}</div>
      <div className={`card__valor ${classe ?? ''}`}>{classe || neutro ? formatarBRL(centavos) : <Valor centavos={centavos} />}</div>
    </div>
  )
}
