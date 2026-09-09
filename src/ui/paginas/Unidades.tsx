// Apartamentos: grade por andar (situação da taxa do mês), tabela editável em lote, colagem de planilha e detalhe.
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { consultas, relogioApp, servicos } from '../../dados/instancia'
import { situacaoCobranca, type SituacaoCobranca } from '../../dominio/cobrancas'
import { formatarData, formatarMes, formatarMesCurto, mesDe } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import type { Bloco, Cobranca, Id, MesISO, Unidade } from '../../dominio/tipos'
import { analisarColagemUnidades, type DadosUnidade, type LinhaColagemUnidade } from '../../dominio/validacao'
import { Campo, SeletorCompetencia } from '../componentes/campos'
import { Badge, Carregando, EstadoVazio, Modal, Valor, type TipoBadge } from '../componentes/comuns'
import { useToast } from '../contexto/AppProviders'
import { useAcao, useEstrutura } from '../hooks'
import { navegar, paraHash } from '../rotas'
import { valorComSinal } from '../rotulos'

const BADGE_SITUACAO: Record<SituacaoCobranca, { tipo: TipoBadge; rotulo: string }> = {
  PAGA: { tipo: 'paga', rotulo: 'Paga' },
  A_VENCER: { tipo: 'a-vencer', rotulo: 'A vencer' },
  VENCIDA: { tipo: 'vencida', rotulo: 'Vencida' },
  CANCELADA: { tipo: 'cancelada', rotulo: 'Cancelada' },
  ISENTA: { tipo: 'isenta', rotulo: 'Isenta' },
}

export function BadgeSituacao({ cobranca }: { cobranca: Cobranca }) {
  const s = BADGE_SITUACAO[situacaoCobranca(cobranca, relogioApp.hoje())]
  return <Badge tipo={s.tipo}>{s.rotulo}</Badge>
}

export function Unidades({ blocoId, modo = 'grade' }: { blocoId?: Id; modo?: 'grade' | 'tabela' }) {
  const { blocos, unidades: todasUnidades, carregando } = useEstrutura()
  const [edicao, setEdicao] = useState<Record<Id, LinhaEdicao>>({})
  const blocoAtual = blocos.find((b) => b.id === blocoId) ?? blocos[0]
  const [competencia, setCompetencia] = useState<MesISO>(mesDe(relogioApp.hoje()))
  const [busca, setBusca] = useState('')
  const [colando, setColando] = useState(false)
  const unidades = useLiveQuery(() => (blocoAtual ? consultas.unidadesDoBloco(blocoAtual.id) : Promise.resolve([])), [blocoAtual?.id])
  const cobrancas = useLiveQuery(() => consultas.cobrancas.daCompetencia(competencia), [competencia])
  const situacaoPorUnidade = useMemo(() => {
    const m = new Map<Id, Cobranca>()
    for (const c of cobrancas ?? []) m.set(c.unidadeId, c)
    return m
  }, [cobrancas])
  useEffect(() => {
    if (!Object.keys(edicao).length) return
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [edicao])
  if (carregando) return <Carregando />
  if (!blocoAtual) return <EstadoVazio titulo="Nenhum bloco cadastrado" />
  const filtradas = (unidades ?? []).filter((u) => {
    if (!busca.trim()) return true
    const t = busca.trim().toLocaleLowerCase('pt-BR')
    return u.numero.includes(t) || (u.responsavel ?? '').toLocaleLowerCase('pt-BR').includes(t)
  })
  return (
    <>
      <div className="cabecalho-pagina">
        <h1>Apartamentos</h1>
        <div className="acoes">
          <button type="button" className="botao" onClick={() => setColando(true)}>
            Colar da planilha
          </button>
        </div>
      </div>
      <div className="filtros">
        <Campo rotulo="Bloco">
          <select value={blocoAtual.id} onChange={(e) => navegar({ nome: 'unidades', blocoId: e.target.value, modo })}>
            {blocos.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
                {b.ativo ? '' : ' (desativado)'}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Visualização">
          <div className="chips">
            <a href={paraHash({ nome: 'unidades', blocoId: blocoAtual.id, modo: 'grade' })} className={`chip${modo === 'grade' ? ' chip--ativo' : ''}`}>
              Grade
            </a>
            <a href={paraHash({ nome: 'unidades', blocoId: blocoAtual.id, modo: 'tabela' })} className={`chip${modo === 'tabela' ? ' chip--ativo' : ''}`}>
              Tabela
            </a>
          </div>
        </Campo>
        {modo === 'grade' && (
          <Campo rotulo="Situação da taxa em">
            <SeletorCompetencia valor={competencia} onChange={setCompetencia} />
          </Campo>
        )}
        <Campo rotulo="Buscar">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="304 ou nome" />
        </Campo>
      </div>
      {modo === 'grade' ? <><Grade bloco={blocoAtual} unidades={filtradas} situacoes={situacaoPorUnidade} />{Object.keys(edicao).length > 0 && <p className="alerta alerta--aviso">Há alterações pendentes. Volte à Tabela e use Salvar tudo.</p>}</> : <Tabela unidades={filtradas} todas={todasUnidades} edicao={edicao} setEdicao={setEdicao} />}
      {colando && <ColarPlanilhaDialogo bloco={blocoAtual} onFechar={() => setColando(false)} />}
    </>
  )
}

function Grade({ bloco, unidades, situacoes }: { bloco: Bloco; unidades: Unidade[]; situacoes: Map<Id, Cobranca> }) {
  const andares = [...new Set(unidades.map((u) => u.andar))].sort((a, b) => b - a)
  const hoje = relogioApp.hoje()
  return (
    <div className="painel">
      <div className="painel__cabecalho">
        <h2>
          Bloco {bloco.nome} · {unidades.filter((u) => u.ativa).length} apartamentos ativos
        </h2>
        <div className="chips texto-pequeno">
          <span className="unidade-celula unidade-celula--paga">paga</span>
          <span className="unidade-celula unidade-celula--a-vencer">a vencer</span>
          <span className="unidade-celula unidade-celula--vencida">vencida</span>
          <span className="unidade-celula">sem cobrança</span>
        </div>
      </div>
      <div className="grade-unidades">
        {andares.map((andar) => (
          <div key={andar} className="grade-unidades__andar">
            <span className="grade-unidades__rotulo">{andar}º andar</span>
            {unidades
              .filter((u) => u.andar === andar)
              .sort((a, b) => a.posicao - b.posicao)
              .map((u) => {
                const c = situacoes.get(u.id)
                const sit = c ? situacaoCobranca(c, hoje) : null
                const classe = sit === 'PAGA' ? 'paga' : sit === 'VENCIDA' ? 'vencida' : sit === 'A_VENCER' ? 'a-vencer' : ''
                return (
                  <a
                    key={u.id}
                    href={paraHash({ nome: 'unidade', id: u.id })}
                    className={`unidade-celula${classe ? ` unidade-celula--${classe}` : ''}${!u.ativa ? ' unidade-celula--inativa' : ''}${u.isenta ? ' unidade-celula--isenta' : ''}`}
                    title={`${u.numero}${u.responsavel ? ' — ' + u.responsavel : ''}${u.isenta ? ' (isento)' : ''}${!u.ativa ? ' (desativado)' : ''}`}
                  >
                    {u.numero}
                  </a>
                )
              })}
          </div>
        ))}
      </div>
    </div>
  )
}

type LinhaEdicao = { responsavel: string; telefone: string; email: string; isenta: boolean }

function Tabela({ unidades, todas, edicao, setEdicao }: { unidades: Unidade[]; todas: Unidade[]; edicao: Record<Id, LinhaEdicao>; setEdicao: Dispatch<SetStateAction<Record<Id, LinhaEdicao>>> }) {
  const { executar, ocupado } = useAcao()
  function valor(u: Unidade): LinhaEdicao {
    return edicao[u.id] ?? { responsavel: u.responsavel ?? '', telefone: u.telefone ?? '', email: u.email ?? '', isenta: u.isenta }
  }
  function mudar(u: Unidade, patch: Partial<LinhaEdicao>) {
    setEdicao({ ...edicao, [u.id]: { ...valor(u), ...patch } })
  }
  const alteradas = todas.filter((u) => {
    const e = edicao[u.id]
    return e && (e.responsavel !== (u.responsavel ?? '') || e.telefone !== (u.telefone ?? '') || e.email !== (u.email ?? '') || e.isenta !== u.isenta)
  })
  async function salvar() {
    const itens = alteradas.map((u) => ({ id: u.id, dados: valor(u) as DadosUnidade }))
    const r = await executar(() => servicos.estrutura.atualizarUnidadesEmLote(itens), `${itens.length} apartamento(s) salvo(s).`)
    if (r !== undefined) setEdicao(atual => {
      const restante = { ...atual }
      for (const item of itens) if (JSON.stringify(atual[item.id]) === JSON.stringify(item.dados)) delete restante[item.id]
      return restante
    })
  }
  return (
    <div className="painel">
      <div className="painel__cabecalho">
        <h2>Responsáveis e contatos</h2>
        <button type="button" className="botao botao--primario" disabled={ocupado || alteradas.length === 0} onClick={() => void salvar()}>
          Salvar tudo ({alteradas.length})
        </button>
      </div>
      <div className="tabela-rolagem">
        <table className="tabela tabela--compacta">
          <thead>
            <tr>
              <th>Apto</th>
              <th>Responsável</th>
              <th>Telefone</th>
              <th>E-mail</th>
              <th>Isento</th>
              <th>Situação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {unidades.map((u) => {
              const v = valor(u)
              return (
                <tr key={u.id}>
                  <td>
                    <strong>{u.numero}</strong>
                  </td>
                  <td>
                    <input aria-label={`Responsável do apartamento ${u.numero}`} disabled={ocupado} value={v.responsavel} onChange={(e) => mudar(u, { responsavel: e.target.value })} style={{ width: '100%' }} />
                  </td>
                  <td>
                    <input aria-label={`Telefone do apartamento ${u.numero}`} disabled={ocupado} value={v.telefone} onChange={(e) => mudar(u, { telefone: e.target.value })} style={{ width: 140 }} />
                  </td>
                  <td>
                    <input aria-label={`E-mail do apartamento ${u.numero}`} disabled={ocupado} value={v.email} onChange={(e) => mudar(u, { email: e.target.value })} style={{ width: '100%' }} />
                  </td>
                  <td className="centro">
                    <input aria-label={`Isentar apartamento ${u.numero}`} disabled={ocupado} type="checkbox" checked={v.isenta} onChange={(e) => mudar(u, { isenta: e.target.checked })} />
                  </td>
                  <td>{u.ativa ? <Badge tipo="sucesso">Ativo</Badge> : <Badge tipo="inativo">Desativado</Badge>}</td>
                  <td className="acoes-celula">
                    <a href={paraHash({ nome: 'unidade', id: u.id })}>Detalhes</a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ColarPlanilhaDialogo({ bloco, onFechar }: { bloco: Bloco; onFechar: () => void }) {
  const { executar, ocupado } = useAcao()
  const toast = useToast()
  const [texto, setTexto] = useState('')
  const analise = useMemo(() => analisarColagemUnidades(texto), [texto])
  async function aplicar() {
    const r = await executar(() => servicos.estrutura.aplicarColagem(bloco.id, analise.linhas as LinhaColagemUnidade[]))
    if (r) {
      toast.sucesso(`${r.aplicadas} apartamento(s) atualizado(s).`)
      if (r.naoEncontradas.length) toast.aviso(`Não encontrados no bloco: ${r.naoEncontradas.join(', ')}`)
      onFechar()
    }
  }
  return (
    <Modal titulo={`Colar da planilha — bloco ${bloco.nome}`} onFechar={onFechar} largo rodape={<><button type="button" className="botao" onClick={onFechar}>Cancelar</button><button type="button" className="botao botao--primario" disabled={ocupado || analise.linhas.length === 0} onClick={() => void aplicar()}>Aplicar {analise.linhas.length} linha(s)</button></>}>
      <p className="texto-suave">Copie da planilha as colunas <strong>apartamento, responsável, telefone, e-mail</strong> (nessa ordem) e cole abaixo. Separação por tabulação (padrão do Excel) ou ponto e vírgula.</p>
      <textarea rows={8} style={{ width: '100%' }} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'101\tMaria Silva\t(11) 99999-0000\tmaria@email.com'} />
      {analise.erros.length > 0 && (
        <ul className="texto-pequeno negativo">
          {analise.erros.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {analise.linhas.length > 0 && (
        <table className="tabela tabela--compacta espaco-topo">
          <thead>
            <tr>
              <th>Apto</th>
              <th>Responsável</th>
              <th>Telefone</th>
              <th>E-mail</th>
            </tr>
          </thead>
          <tbody>
            {analise.linhas.slice(0, 50).map((l, i) => (
              <tr key={i}>
                <td>{l.numero}</td>
                <td>{l.responsavel}</td>
                <td>{l.telefone}</td>
                <td>{l.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}

export function UnidadeDetalhe({ id }: { id: Id }) {
  const unidade = useLiveQuery(() => consultas.unidade(id), [id])
  const bloco = useLiveQuery(() => (unidade ? consultas.bloco(unidade.blocoId) : undefined), [unidade?.blocoId])
  const cobrancas = useLiveQuery(() => consultas.cobrancas.daUnidade(id), [id])
  const lancamentos = useLiveQuery(() => consultas.lancamentos.daUnidade(id), [id])
  const { executar, ocupado } = useAcao()
  const [form, setForm] = useState({ responsavel: '', telefone: '', email: '', isenta: false, observacoes: '' })
  useEffect(() => {
    if (unidade) setForm({ responsavel: unidade.responsavel ?? '', telefone: unidade.telefone ?? '', email: unidade.email ?? '', isenta: unidade.isenta, observacoes: unidade.observacoes ?? '' })
  }, [unidade])
  if (!unidade || !bloco) return null
  const abertas = (cobrancas ?? []).filter((c) => c.status === 'ABERTA')
  return (
    <>
      <div className="cabecalho-pagina">
        <h1>
          Bloco {bloco.nome} · apto {unidade.numero}
        </h1>
        <div className="acoes">
          <a className="botao" href={paraHash({ nome: 'extratoUnidade', id })}>
            Extrato do apartamento
          </a>
          <a className="botao" href={paraHash({ nome: 'unidades', blocoId: bloco.id })}>
            Voltar ao bloco
          </a>
        </div>
      </div>
      <div className="cards" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="painel">
          <h2>Dados</h2>
          <form
            className="formulario"
            onSubmit={(e) => {
              e.preventDefault()
              void executar(() => servicos.estrutura.atualizarUnidade(id, form), 'Apartamento salvo.')
            }}
          >
            <Campo rotulo="Responsável">
              <input value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} />
            </Campo>
            <div className="linha-campos">
              <Campo rotulo="Telefone">
                <input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
              </Campo>
              <Campo rotulo="E-mail">
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Campo>
            </div>
            <Campo rotulo="Observações">
              <textarea rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
            </Campo>
            <Campo rotulo="Isento de taxa" inline ajuda="Conta no rateio, mas não recebe cobrança (ex.: zelador).">
              <input type="checkbox" checked={form.isenta} onChange={(e) => setForm({ ...form, isenta: e.target.checked })} />
            </Campo>
            <p className="texto-suave texto-pequeno">
              Situação: {unidade.ativa ? 'ativo' : `desativado em ${unidade.desativadaEm ? formatarData(unidade.desativadaEm.slice(0, 10)) : '—'}`} — muda apenas pela estrutura do bloco (andares × apartamentos).
            </p>
            <div className="acoes">
              <button className="botao botao--primario" disabled={ocupado}>
                Salvar
              </button>
            </div>
          </form>
        </div>
        <div className="painel">
          <h2>Taxas</h2>
          {abertas.length > 0 && (
            <p>
              Em aberto: <strong>{abertas.length}</strong> — total <Valor centavos={abertas.reduce((s, c) => s + c.valorCentavos, 0)} neutro />
            </p>
          )}
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th>Competência</th>
                <th className="num">Valor</th>
                <th className="num">Pago</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {(cobrancas ?? []).map((c) => (
                <tr key={c.id}>
                  <td>
                    <a href={paraHash({ nome: 'cobrancas', competencia: c.competencia })}>{formatarMes(c.competencia)}</a>
                  </td>
                  <td className="num">{formatarBRL(c.valorCentavos)}</td>
                  <td className="num">{c.valorPagoCentavos !== null ? `${formatarBRL(c.valorPagoCentavos)}${c.jurosCentavos ? ` + ${formatarBRL(c.jurosCentavos)}` : ''}` : '—'}</td>
                  <td>
                    <BadgeSituacao cobranca={c} />
                  </td>
                </tr>
              ))}
              {(cobrancas ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="texto-suave">
                    Nenhuma cobrança gerada para este apartamento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="painel">
        <h2>Lançamentos do apartamento</h2>
        <table className="tabela tabela--compacta">
          <tbody>
            {(lancamentos ?? []).map((l) => (
              <tr key={l.id}>
                <td>{formatarData(l.data)}</td>
                <td>
                  <a href={paraHash({ nome: 'lancamento', id: l.id })}>{l.descricao}</a> <span className="texto-suave texto-pequeno">({formatarMesCurto(l.competencia)})</span>
                </td>
                <td className="num">
                  <Valor centavos={valorComSinal(l)} />
                </td>
              </tr>
            ))}
            {(lancamentos ?? []).length === 0 && (
              <tr>
                <td className="texto-suave">Nenhum lançamento.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
