// Início: visão do mês, caixa por bloco, taxas do mês, atalhos e lembrete de backup.
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { consultas, relogioApp, servicos } from '../../dados/instancia'
import { formatarData, formatarMes, formatarMesCurto, mesDe, periodoDoMes } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import type { MesISO } from '../../dominio/tipos'
import { SeletorCompetencia } from '../componentes/campos'
import { Alerta, BarraProporcional, Carregando, Valor } from '../componentes/comuns'
import { useDemonstrativo, useEstrutura, useLembreteBackup } from '../hooks'
import { paraHash } from '../rotas'
import { porId, rotuloEscopo, valorComSinal } from '../rotulos'

export function Inicio() {
  const hoje = relogioApp.hoje()
  const [mes, setMes] = useState<MesISO>(mesDe(hoje))
  const { blocos, unidades } = useEstrutura()
  const dem = useDemonstrativo(periodoDoMes(mes), 'data', null)
  const ultimos = useLiveQuery(() => consultas.lancamentos.ultimos(10), [])
  const proximoFechamento = useLiveQuery(() => servicos.fechamento.proximoAFechar(), [])
  const lembrete = useLembreteBackup()
  const blocosPorId = useMemo(() => porId(blocos), [blocos])
  const unidadesPorId = useMemo(() => porId(unidades), [unidades])
  const cob = dem?.cobrancas
  const pct = cob && cob.geradas > 0 ? Math.round((cob.pagas / cob.geradas) * 100) : 0
  const maiorSaldo = Math.max(1, ...(dem?.linhas.map((l) => Math.abs(l.saldoFinal)) ?? [1]))
  return (
    <>
      <div className="cabecalho-pagina">
        <h1>Início</h1>
        <SeletorCompetencia valor={mes} onChange={setMes} />
      </div>
      {proximoFechamento && <Alerta tipo="info" acao={<a className="botao" href={paraHash({ nome: 'avancado', aba: 'fechamento' })}>Conferir fechamento</a>}>O mês {formatarMes(proximoFechamento)} pode ser fechado.</Alerta>}
      {lembrete.nivel && (
        <Alerta tipo={lembrete.nivel === 'critico' ? 'erro' : 'aviso'} acao={<a className="botao botao--primario" href={paraHash({ nome: 'backup' })}>Fazer backup</a>}>
          {lembrete.ultimoBackupEm ? `Último backup em ${formatarData(lembrete.ultimoBackupEm.slice(0, 10))}` : 'Nenhum backup feito ainda'} — {lembrete.alteracoes} alteração(ões) desde então. Os dados ficam só neste navegador.
        </Alerta>
      )}
      <div className="acoes espaco-baixo">
        <a className="botao botao--perigo" href={paraHash({ nome: 'lancamentoNovo', natureza: 'DESPESA' })}>
          + Nova despesa
        </a>
        <a className="botao botao--sucesso" href={paraHash({ nome: 'lancamentoNovo', natureza: 'RECEITA' })}>
          + Nova receita
        </a>
        <a className="botao" href={paraHash({ nome: 'cobrancas', competencia: mes })}>
          Registrar pagamentos de taxa
        </a>
        {cob && cob.geradas === 0 && (
          <a className="botao botao--primario" href={paraHash({ nome: 'cobrancas', competencia: mes })}>
            Gerar cobranças de {formatarMesCurto(mes)}
          </a>
        )}
      </div>
      {!dem ? (
        <Carregando />
      ) : (
        <>
          <div className="cards">
            <div className="card">
              <div className="card__titulo">Receitas em {formatarMesCurto(mes)}</div>
              <div className="card__valor positivo">{formatarBRL(dem.total.receitas)}</div>
            </div>
            <div className="card">
              <div className="card__titulo">Despesas em {formatarMesCurto(mes)}</div>
              <div className="card__valor negativo">{formatarBRL(dem.total.despesas)}</div>
            </div>
            <div className="card">
              <div className="card__titulo">Saldo do mês</div>
              <div className="card__valor">
                <Valor centavos={dem.total.saldoPeriodo} />
              </div>
            </div>
            <div className="card">
              <div className="card__titulo">Caixa total (fim de {formatarMesCurto(mes)})</div>
              <div className="card__valor">
                <Valor centavos={dem.total.saldoFinal} />
              </div>
            </div>
          </div>
          {cob && cob.geradas > 0 && (
            <div className="painel">
              <div className="painel__cabecalho">
                <h2>
                  Taxas de {formatarMes(mes)}: {cob.pagas} de {cob.geradas} pagas ({pct}%)
                </h2>
                <span>
                  {formatarBRL(cob.valorEmAbertoCentavos)} em aberto{cob.vencidas ? ` · ${cob.vencidas} vencida(s)` : ''}
                </span>
              </div>
              <BarraProporcional valor={cob.pagas} total={cob.geradas} tipo="receita" />
            </div>
          )}
          <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
            <div className="painel">
              <h2>Caixa por bloco</h2>
              <table className="tabela tabela--compacta">
                <thead>
                  <tr>
                    <th>Bloco</th>
                    <th className="num">Saldo do mês</th>
                    <th className="num">Caixa</th>
                    <th style={{ width: '30%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {dem.linhas.map((l) => (
                    <tr key={l.blocoId}>
                      <td>{l.nome}</td>
                      <td className="num">
                        <Valor centavos={l.saldoPeriodo} />
                      </td>
                      <td className="num">
                        <Valor centavos={l.saldoFinal} />
                      </td>
                      <td>
                        <BarraProporcional valor={Math.abs(l.saldoFinal)} total={maiorSaldo} tipo={l.saldoFinal < 0 ? 'despesa' : 'receita'} />
                      </td>
                    </tr>
                  ))}
                  <tr className="tabela__total">
                    <td>Total</td>
                    <td className="num">
                      <Valor centavos={dem.total.saldoPeriodo} />
                    </td>
                    <td className="num">
                      <Valor centavos={dem.total.saldoFinal} />
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="painel">
              <div className="painel__cabecalho">
                <h2>Últimos lançamentos</h2>
                <a href={paraHash({ nome: 'lancamentos' })}>ver todos</a>
              </div>
              <table className="tabela tabela--compacta">
                <tbody>
                  {(ultimos ?? []).map((l) => (
                    <tr key={l.id}>
                      <td className="num">{formatarData(l.data)}</td>
                      <td>
                        <a href={paraHash({ nome: 'lancamento', id: l.id })}>{l.descricao}</a>
                        <div className="texto-suave texto-pequeno">{rotuloEscopo(l, blocosPorId, unidadesPorId)}</div>
                      </td>
                      <td className="num">{l.natureza === 'TRANSFERENCIA' ? <Valor centavos={l.valorCentavos} neutro /> : <Valor centavos={valorComSinal(l)} />}</td>
                    </tr>
                  ))}
                  {ultimos && ultimos.length === 0 && (
                    <tr>
                      <td className="texto-suave">Nenhum lançamento ainda.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  )
}
