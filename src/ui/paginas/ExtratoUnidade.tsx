// Extrato imprimível de um apartamento (para entregar ao morador / declaração de quitação).
import { useLiveQuery } from 'dexie-react-hooks'
import { consultas, relogioApp } from '../../dados/instancia'
import { situacaoCobranca } from '../../dominio/cobrancas'
import { formatarData, formatarMes } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import type { Id } from '../../dominio/tipos'
import { BotaoImprimir, CabecalhoImpressao, RodapeImpressao } from '../componentes/impressao'
import { useEstrutura } from '../hooks'
import { paraHash } from '../rotas'
import { valorComSinal } from '../rotulos'
import { BadgeSituacao } from './Unidades'

export function ExtratoUnidade({ id }: { id: Id }) {
  const hoje = relogioApp.hoje()
  const unidade = useLiveQuery(() => consultas.unidade(id), [id])
  const cobrancas = useLiveQuery(() => consultas.cobrancas.daUnidade(id), [id])
  const lancamentos = useLiveQuery(() => consultas.lancamentos.daUnidade(id), [id])
  const { blocos, categorias } = useEstrutura()
  if (!unidade || !cobrancas || !lancamentos) return null
  const bloco = blocos.find((b) => b.id === unidade.blocoId)
  const abertas = cobrancas.filter((c) => c.status === 'ABERTA')
  const vencidas = abertas.filter((c) => situacaoCobranca(c, hoje) === 'VENCIDA')
  const devido = abertas.reduce((s, c) => s + c.valorCentavos, 0)
  const outros = lancamentos.filter((l) => !l.cobrancaId)
  return (
    <>
      <CabecalhoImpressao titulo={`Extrato do apartamento ${unidade.numero} — Bloco ${bloco?.nome ?? ''}`} subtitulo={unidade.responsavel ? `Responsável: ${unidade.responsavel}` : undefined} />
      <div className="cabecalho-pagina">
        <h1>
          Extrato — Bloco {bloco?.nome} apto {unidade.numero}
        </h1>
        <div className="acoes">
          <BotaoImprimir />
          <a className="botao botao--link" href={paraHash({ nome: 'unidade', id })}>
            Voltar
          </a>
        </div>
      </div>
      <div className="cards">
        <div className="card">
          <div className="card__titulo">Em aberto</div>
          <div className="card__valor">{abertas.length}</div>
        </div>
        <div className="card">
          <div className="card__titulo">Vencidas</div>
          <div className={`card__valor ${vencidas.length ? 'negativo' : ''}`}>{vencidas.length}</div>
        </div>
        <div className="card">
          <div className="card__titulo">Saldo devedor</div>
          <div className={`card__valor ${devido ? 'negativo' : 'positivo'}`}>{formatarBRL(devido)}</div>
        </div>
      </div>
      <div className="painel">
        <h2>Taxas condominiais</h2>
        <table className="tabela tabela--compacta">
          <thead>
            <tr>
              <th>Competência</th>
              <th>Vencimento</th>
              <th className="num">Cobrado</th>
              <th className="num">Pago</th>
              <th className="num">Desconto</th>
              <th className="num">Juros</th>
              <th>Situação</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {cobrancas.map((c) => (
              <tr key={c.id}>
                <td>{formatarMes(c.competencia)}</td>
                <td>{formatarData(c.vencimento)}</td>
                <td className="num">{formatarBRL(c.valorCentavos)}</td>
                <td className="num">{c.valorPagoCentavos !== null ? formatarBRL(c.valorPagoCentavos) : '—'}</td>
                <td className="num">{c.valorPagoCentavos !== null && c.valorCentavos > c.valorPagoCentavos ? formatarBRL(c.valorCentavos - c.valorPagoCentavos) : '—'}</td>
                <td className="num">{c.jurosCentavos ? formatarBRL(c.jurosCentavos) : '—'}</td>
                <td>
                  <BadgeSituacao cobranca={c} />
                </td>
                <td>{c.pagaEm ? formatarData(c.pagaEm) : ''}</td>
              </tr>
            ))}
            {cobrancas.length === 0 && (
              <tr>
                <td colSpan={8} className="texto-suave">
                  Nenhuma cobrança registrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {abertas.length === 0 ? (
          <p className="espaco-topo">
            <strong>Nada consta em aberto</strong> para este apartamento até {formatarData(hoje)}.
          </p>
        ) : (
          <p className="espaco-topo">
            Saldo devedor em {formatarData(hoje)}: <strong>{formatarBRL(devido)}</strong> ({abertas.length} competência(s)).
          </p>
        )}
      </div>
      {outros.length > 0 && (
        <div className="painel">
          <h2>Outros lançamentos do apartamento</h2>
          <table className="tabela tabela--compacta">
            <tbody>
              {outros.map((l) => (
                <tr key={l.id}>
                  <td>{formatarData(l.data)}</td>
                  <td>{l.descricao}</td>
                  <td>{categorias.find((c) => c.id === l.categoriaId)?.nome ?? ''}</td>
                  <td className="num">{formatarBRL(valorComSinal(l))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RodapeImpressao />
    </>
  )
}
