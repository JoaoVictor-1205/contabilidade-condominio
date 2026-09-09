import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { consultas, relogioApp, servicos } from '../../dados/instancia'
import type { PreviaRateios } from '../../dados/servicos/manutencao'
import { formatarData, formatarMes, mesDe, periodoDoMes } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import type { Problema } from '../../dominio/integridade'
import type { Auditoria } from '../../dominio/tipos'
import { Campo, CampoData } from '../componentes/campos'
import { Alerta, Badge, Carregando, Valor } from '../componentes/comuns'
import { MotivoDialogo } from '../componentes/MotivoDialogo'
import { useConfirmacao } from '../contexto/AppProviders'
import { useAcao, useDemonstrativo } from '../hooks'
import { paraHash, type AbaAvancado, type Rota } from '../rotas'

const ABAS: Array<{ id: AbaAvancado; nome: string }> = [
  { id: 'fechamento', nome: 'Fechamento' }, { id: 'integridade', nome: 'Integridade' },
  { id: 'auditoria', nome: 'Auditoria' }, { id: 'manutencao', nome: 'Manutenção' },
]

export function Avancado({ aba = 'fechamento' }: { aba?: AbaAvancado }) {
  return <>
    <div className="cabecalho-pagina"><h1>Avançado</h1></div>
    <nav className="chips espaco-baixo nao-imprimir" aria-label="Ferramentas avançadas">
      {ABAS.map(a => <a key={a.id} className={`chip${a.id === aba ? ' chip--ativo' : ''}`} aria-current={a.id === aba ? 'page' : undefined} href={paraHash({ nome: 'avancado', aba: a.id })}>{a.nome}</a>)}
    </nav>
    {aba === 'fechamento' && <AbaFechamento />}
    {aba === 'integridade' && <AbaIntegridade />}
    {aba === 'auditoria' && <AbaAuditoria />}
    {aba === 'manutencao' && <AbaManutencao />}
  </>
}

function AbaFechamento() {
  const fechamentos = useLiveQuery(() => consultas.fechamentos.listar(), [])
  const proximo = useLiveQuery(() => servicos.fechamento.proximoAFechar(), [])
  const dem = useDemonstrativo(periodoDoMes(proximo ?? mesDe(relogioApp.hoje())), 'data', null)
  const { executar, ocupado } = useAcao()
  const confirmar = useConfirmacao()
  const [reabrindo, setReabrindo] = useState(false)
  if (!fechamentos || proximo === undefined) return <Carregando />
  const ultimo = fechamentos.at(-1)
  return <>
    <Alerta tipo="info">O fechamento protege os lançamentos pela data do movimento. Feche os meses em sequência após a conferência. Correções posteriores usam estorno em mês aberto.</Alerta>
    <div className="painel">
      <h2>{proximo ? `Próximo mês a fechar: ${formatarMes(proximo)}` : 'Nenhum mês pendente de fechamento'}</h2>
      {proximo && dem ? <>
        <p>Receitas: <strong>{formatarBRL(dem.total.receitas)}</strong> · Despesas: <strong>{formatarBRL(dem.total.despesas)}</strong> · Saldo final: <strong>{formatarBRL(dem.total.saldoFinal)}</strong></p>
        <button type="button" className="botao botao--primario" disabled={ocupado} onClick={async () => {
          if (await confirmar({ titulo: `Fechar ${formatarMes(proximo)}?`, texto: `Saldo final: ${formatarBRL(dem.total.saldoFinal)}. Lançamentos deste mês e dos anteriores ficarão protegidos.`, confirmarTexto: 'Fechar mês' })) await executar(() => servicos.fechamento.fechar(proximo), 'Mês fechado.')
        }}>Fechar mês</button>
      </> : <p className="texto-suave">Somente meses já terminados podem ser fechados.</p>}
    </div>
    <div className="painel"><h2>Meses fechados</h2>
      {fechamentos.length ? <div className="tabela-rolagem"><table className="tabela"><thead><tr><th>Mês</th><th>Fechado em</th><th className="num">Saldo geral</th><th className="num">Lançamentos</th></tr></thead><tbody>
        {[...fechamentos].reverse().map(f => <tr key={f.mes}><td>{formatarMes(f.mes)}</td><td>{f.fechadoEm.replace('T', ' ')}</td><td className="num"><Valor centavos={f.saldoGeralCentavos} /></td><td className="num">{f.qtdLancamentos}</td></tr>)}
      </tbody></table></div> : <p className="texto-suave">Nenhum mês fechado.</p>}
      {ultimo && <button type="button" className="botao espaco-topo" disabled={ocupado} onClick={() => setReabrindo(true)}>Reabrir último mês ({formatarMes(ultimo.mes)})</button>}
    </div>
    {reabrindo && ultimo && <MotivoDialogo titulo="Reabrir último mês" texto={`Os lançamentos de ${formatarMes(ultimo.mes)} voltarão a permitir alterações.`} rotuloConfirmar="Reabrir" onFechar={() => setReabrindo(false)} onConfirmar={async motivo => {
      const ok = await executar(async () => { await servicos.fechamento.reabrir(ultimo.mes, motivo); return true }, 'Mês reaberto.')
      if (ok) setReabrindo(false)
    }} />}
  </>
}

function rotaProblema(p: Problema): Rota | null {
  if (!p.entidadeId) return null
  switch (p.entidade) {
    case 'lancamento': return { nome: 'lancamento', id: p.entidadeId }
    case 'unidade': return { nome: 'unidade', id: p.entidadeId }
    case 'cobranca': return { nome: 'cobrancas' }
    case 'bloco': return { nome: 'estrutura', aba: 'blocos' }
    case 'fechamento': return { nome: 'avancado', aba: 'fechamento' }
    case 'anexo': return { nome: 'backup' }
    default: return null
  }
}

function LinkProblema({ problema }: { problema: Problema }) {
  const cobranca = useLiveQuery(async () => problema.entidade === 'cobranca' && problema.entidadeId ? await consultas.cobrancas.obter(problema.entidadeId) : undefined, [problema.entidade, problema.entidadeId])
  const rota = rotaProblema(problema)
  if (!rota) return null
  if (rota.nome === 'cobrancas' && cobranca) rota.competencia = cobranca.competencia
  return <a href={paraHash(rota)}>Abrir registro</a>
}

function AbaIntegridade() {
  const [problemas, setProblemas] = useState<Problema[] | null>(null)
  const [verificadoEm, setVerificadoEm] = useState('')
  const { executar, ocupado } = useAcao()
  return <div className="painel"><h2>Integridade dos dados</h2>
    <p>Confere rateios, vínculos de pagamentos e estornos, saldos fechados, registros duplicados e arquivos de anexos. A verificação não altera os dados.</p>
    <button className="botao botao--primario" type="button" disabled={ocupado} onClick={async () => {
      const resultado = await executar(() => servicos.sistema.verificarIntegridade())
      if (resultado) { setProblemas(resultado); setVerificadoEm(relogioApp.agora()) }
    }}>{ocupado ? 'Verificando…' : 'Verificar agora'}</button>
    {problemas && <>
      <p className="texto-suave">Verificado em {verificadoEm.replace('T', ' ')} · {problemas.filter(p => p.nivel === 'ERRO').length} erro(s) · {problemas.filter(p => p.nivel === 'AVISO').length} aviso(s)</p>
      {problemas.length === 0 ? <Alerta tipo="sucesso">Nenhuma inconsistência encontrada.</Alerta> : <ul className="lista-integridade">{problemas.map((p, i) =>
        <li key={`${p.codigo}-${p.entidadeId}-${i}`}><Badge tipo={p.nivel === 'ERRO' ? 'erro' : 'aviso'}>{p.nivel === 'ERRO' ? 'Erro' : 'Aviso'}</Badge> {p.mensagem} <LinkProblema problema={p} /><small className="texto-suave"> {p.codigo} · {p.entidadeId}</small></li>
      )}</ul>}
    </>}
  </div>
}

const ENTIDADES: Auditoria['entidade'][] = ['lancamento', 'cobranca', 'bloco', 'unidade', 'taxa', 'categoria', 'condominio', 'anexo', 'documento', 'backup', 'fechamento']
export function AlteracoesAuditoria({ alteracoes }: { alteracoes: Auditoria['alteracoes'] }) {
  const valor = (v: unknown) => v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return alteracoes ? <ul className="alteracoes-auditoria">{Object.entries(alteracoes).map(([campo, a]) => <li key={campo}><strong>{campo}:</strong> {valor(a.de)} → {valor(a.para)}</li>)}</ul> : <>—</>
}
function AbaAuditoria() {
  const [entidade, setEntidade] = useState<Auditoria['entidade'] | ''>('')
  const [texto, setTexto] = useState('')
  const [limite, setLimite] = useState(200)
  const lista = useLiveQuery(() => consultas.auditoria.listar({ entidade: entidade || undefined, texto, limite: limite + 1 }), [entidade, texto, limite])
  return <div className="painel"><h2>Auditoria</h2>
    <div className="linha-campos"><Campo rotulo="Entidade"><select value={entidade} onChange={e => { setEntidade(e.target.value as typeof entidade); setLimite(200) }}><option value="">Todas</option>{ENTIDADES.map(v => <option key={v} value={v}>{v}</option>)}</select></Campo>
      <Campo rotulo="Buscar na auditoria"><input type="search" value={texto} onChange={e => { setTexto(e.target.value); setLimite(200) }} placeholder="Resumo, motivo, identificador ou alteração" /></Campo></div>
    {!lista ? <Carregando /> : lista.length === 0 ? <p>Nenhum registro corresponde aos filtros.</p> : <>
      <div className="tabela-rolagem"><table className="tabela tabela--compacta"><thead><tr><th>Data</th><th>Entidade</th><th>Ação</th><th>Resumo</th><th>Motivo</th><th>Alterações</th></tr></thead><tbody>{lista.slice(0, limite).map(a => <tr key={a.seq}><td>{a.em.replace('T', ' ')}</td><td>{a.entidade}</td><td>{a.acao}</td><td>{a.resumo}</td><td>{a.motivo ?? '—'}</td><td><AlteracoesAuditoria alteracoes={a.alteracoes} /></td></tr>)}</tbody></table></div>
      {lista.length > limite && <button className="botao" onClick={() => setLimite(l => l + 200)}>Carregar mais registros</button>}
    </>}
  </div>
}

function AbaManutencao() {
  const [periodo, setPeriodo] = useState(() => periodoDoMes(mesDe(relogioApp.hoje())))
  const [previa, setPrevia] = useState<PreviaRateios | null>(null)
  const { executar, ocupado } = useAcao()
  const confirmar = useConfirmacao()
  return <>
    <div className="painel"><h2>Recalcular rateios do período</h2>
      <p>Usa a estrutura atual nos lançamentos gerais ativos, sem estorno e em meses abertos. Confira as cotas antes de aplicar.</p>
      <div className="linha-campos"><Campo rotulo="Data inicial"><CampoData valor={periodo.inicio} onChange={inicio => { setPeriodo(p => ({ ...p, inicio })); setPrevia(null) }} /></Campo><Campo rotulo="Data final"><CampoData valor={periodo.fim} onChange={fim => { setPeriodo(p => ({ ...p, fim })); setPrevia(null) }} /></Campo></div>
      <button className="botao" disabled={ocupado} onClick={async () => { const r = await executar(() => servicos.manutencao.previaRateios(periodo)); if (r) setPrevia(r) }}>Gerar prévia dos rateios</button>
      {previa && <>
        <p><strong>{previa.itens.length} lançamento(s)</strong> de {formatarData(previa.periodo.inicio)} a {formatarData(previa.periodo.fim)}.</p>
        {previa.itens.map(i => <details key={i.lancamento.id}><summary>{formatarData(i.lancamento.data)} · {i.lancamento.descricao} · {formatarBRL(i.lancamento.valorCentavos)}</summary><table className="tabela tabela--compacta"><thead><tr><th>Bloco</th><th className="num">Cota atual</th><th className="num">Nova cota</th></tr></thead><tbody>
          {[...new Set([...(i.lancamento.rateio?.cotas.map(c => c.blocoId) ?? []), ...i.novoRateio.cotas.map(c => c.blocoId)])].map(id => {
            const antes = i.lancamento.rateio?.cotas.find(c => c.blocoId === id)
            const depois = i.novoRateio.cotas.find(c => c.blocoId === id)
            return <tr key={id}><td>{depois?.nomeBloco ?? antes?.nomeBloco}</td><td className="num">{formatarBRL(antes?.valorCentavos ?? 0)}</td><td className="num">{formatarBRL(depois?.valorCentavos ?? 0)}</td></tr>
          })}</tbody></table></details>)}
        <button className="botao botao--primario espaco-topo" disabled={ocupado || !previa.itens.length} onClick={async () => {
          if (await confirmar({ titulo: 'Aplicar os novos rateios?', texto: `Os relatórios dos ${previa.itens.length} lançamentos exibidos serão recalculados.`, confirmarTexto: 'Recalcular rateios' })) {
            const r = await executar(() => servicos.manutencao.recalcularRateios(previa), 'Rateios recalculados.')
            if (r !== undefined) setPrevia(null)
          }
        }}>Aplicar rateios da prévia</button>
      </>}
    </div>
    <div className="painel"><h2>Apagar tudo</h2><p>Remove todos os dados deste navegador e volta ao estado inicial (14 blocos). Gere um backup antes.</p>
      <a href={paraHash({ nome: 'backup' })}>Ir para Backup</a>
      <div className="espaco-topo"><button className="botao botao--perigo" disabled={ocupado} onClick={async () => {
        if (await confirmar({ titulo: 'Apagar todos os dados', texto: 'Esta ação não pode ser desfeita.', perigo: true, exigirTexto: 'APAGAR', confirmarTexto: 'Apagar tudo' })) {
          const ok = await executar(async () => { await servicos.sistema.apagarTudo(); return true }, 'Dados apagados.')
          if (ok) location.reload()
        }
      }}>Apagar tudo</button></div>
    </div>
  </>
}
