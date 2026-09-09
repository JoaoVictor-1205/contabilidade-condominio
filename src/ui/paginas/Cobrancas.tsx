// Cobranças da competência: gerar, pagar (1 clique, detalhado ou em lote), desfazer, corrigir, cancelar/isentar, editar.
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { consultas, relogioApp, servicos } from '../../dados/instancia'
import type { ArquivoAnexo } from '../../dados/servicos/anexos'
import { situacaoCobranca, type PlanoCobrancas, type SituacaoCobranca } from '../../dominio/cobrancas'
import { formatarData, formatarMes, formatarMesCurto, mesDe } from '../../dominio/datas'
import { resumirCobrancas } from '../../dominio/demonstrativo'
import { formatarBRL } from '../../dominio/dinheiro'
import type { Bloco, Centavos, Cobranca, DataISO, FormaPagamento, Id, MesISO, Unidade } from '../../dominio/tipos'
import { FORMAS_PAGAMENTO } from '../../dominio/validacao'
import { exportarCobrancasExcel } from '../../exportacao/excel'
import { Dropzone, ListaAnexosPendentes } from '../componentes/anexos'
import { Campo, CampoData, CampoMoeda, SeletorCompetencia } from '../componentes/campos'
import { Modal } from '../componentes/comuns'
import { BotaoImprimir, CabecalhoImpressao } from '../componentes/impressao'
import { MotivoDialogo } from '../componentes/MotivoDialogo'
import { useToast } from '../contexto/AppProviders'
import { useAcao, useEstrutura } from '../hooks'
import { navegar, paraHash } from '../rotas'
import { porId, ROTULO_FORMA } from '../rotulos'
import { BadgeSituacao } from './Unidades'

const ROTULO_SITUACAO: Record<SituacaoCobranca, string> = { PAGA: 'Paga', A_VENCER: 'A vencer', VENCIDA: 'Vencida', CANCELADA: 'Cancelada', ISENTA: 'Isenta' }
type FiltroSituacao = '' | 'ABERTA' | 'VENCIDA' | 'PAGA' | 'OUTRAS'

export function Cobrancas({ competencia }: { competencia?: MesISO }) {
  const hoje = relogioApp.hoje()
  const comp = competencia ?? mesDe(hoje)
  const { blocos, unidades } = useEstrutura()
  const cobrancas = useLiveQuery(() => consultas.cobrancas.daCompetencia(comp), [comp])
  const { executar, ocupado } = useAcao()
  const toast = useToast()
  const [blocoId, setBlocoId] = useState<Id | ''>('')
  const [situacao, setSituacao] = useState<FiltroSituacao>('')
  const [busca, setBusca] = useState('')
  const [selecionadas, setSelecionadas] = useState<Set<Id>>(new Set())
  const [formaPadrao, setFormaPadrao] = useState<FormaPagamento>('PIX')
  const [gerando, setGerando] = useState(false)
  const [pagando, setPagando] = useState<{ cobranca: Cobranca; modo: 'pagar' | 'corrigir' } | null>(null)
  const [lote, setLote] = useState<Id[] | null>(null)
  const [motivoPara, setMotivoPara] = useState<{ cobranca: Cobranca; acao: 'desfazer' | 'cancelar' | 'isentar' } | null>(null)
  const [editando, setEditando] = useState<Cobranca | null>(null)
  useEffect(() => setSelecionadas(new Set()), [comp, blocoId, busca, situacao])

  const blocosPorId = useMemo(() => porId(blocos), [blocos])
  const unidadesPorId = useMemo(() => porId(unidades), [unidades])
  const resumo = useMemo(() => resumirCobrancas(cobrancas ?? [], [comp], hoje), [cobrancas, comp, hoje])
  const lista = useMemo(() => {
    const t = busca.trim().toLocaleLowerCase('pt-BR')
    return (cobrancas ?? [])
      .filter((c) => {
        if (blocoId && c.blocoId !== blocoId) return false
        const s = situacaoCobranca(c, hoje)
        if (situacao === 'ABERTA' && c.status !== 'ABERTA') return false
        if (situacao === 'VENCIDA' && s !== 'VENCIDA') return false
        if (situacao === 'PAGA' && s !== 'PAGA') return false
        if (situacao === 'OUTRAS' && s !== 'CANCELADA' && s !== 'ISENTA') return false
        if (t) {
          const u = unidadesPorId.get(c.unidadeId)
          const texto = `${blocosPorId.get(c.blocoId)?.nome ?? ''} ${u?.numero ?? ''} ${u?.responsavel ?? ''}`.toLocaleLowerCase('pt-BR')
          if (!texto.includes(t)) return false
        }
        return true
      })
      .sort((a, b) => (blocosPorId.get(a.blocoId)?.ordem ?? 0) - (blocosPorId.get(b.blocoId)?.ordem ?? 0) || (unidadesPorId.get(a.unidadeId)?.numero ?? '').localeCompare(unidadesPorId.get(b.unidadeId)?.numero ?? '', 'pt-BR', { numeric: true }))
  }, [cobrancas, blocoId, situacao, busca, hoje, blocosPorId, unidadesPorId])
  const abertasVisiveis = lista.filter((c) => c.status === 'ABERTA')
  const selecionadasVisiveis = abertasVisiveis.filter(c => selecionadas.has(c.id)).map(c => c.id)

  async function pagarUmClique(c: Cobranca) {
    await executar(() => servicos.cobrancas.registrarPagamento(c.id, { data: hoje, formaPagamento: formaPadrao }), `Pagamento de ${formatarBRL(c.valorCentavos)} registrado.`)
  }

  function exportar() {
    exportarCobrancasExcel(
      lista.map((c) => {
        const u = unidadesPorId.get(c.unidadeId)
        return {
          bloco: blocosPorId.get(c.blocoId)?.nome ?? '',
          apto: u?.numero ?? '',
          responsavel: u?.responsavel ?? '',
          competencia: formatarMesCurto(c.competencia),
          vencimento: c.vencimento,
          cobradoCentavos: c.valorCentavos,
          pagoCentavos: c.valorPagoCentavos,
          jurosCentavos: c.jurosCentavos,
          pagaEm: c.pagaEm,
          situacao: ROTULO_SITUACAO[situacaoCobranca(c, hoje)],
        }
      }),
      `cobrancas-${comp}`,
    )
  }

  return (
    <>
      <CabecalhoImpressao titulo="Cobranças da taxa condominial" subtitulo={formatarMes(comp)} />
      <div className="cabecalho-pagina">
        <h1>Cobranças</h1>
        <div className="acoes">
          <SeletorCompetencia valor={comp} onChange={(m) => navegar({ nome: 'cobrancas', competencia: m })} />
          <button type="button" className="botao botao--primario" onClick={() => setGerando(true)}>
            Gerar cobranças de {formatarMesCurto(comp)}
          </button>
          <button type="button" className="botao" onClick={exportar} disabled={lista.length === 0}>
            Excel
          </button>
          <BotaoImprimir />
        </div>
      </div>
      <div className="cards">
        <Card titulo="Geradas" valor={String(resumo.geradas)} />
        <Card titulo="Pagas" valor={String(resumo.pagas)} detalhe={resumo.geradas ? `${Math.round((resumo.pagas / resumo.geradas) * 100)}%` : ''} />
        <Card titulo="A vencer" valor={String(resumo.abertas - resumo.vencidas)} />
        <Card titulo="Vencidas" valor={String(resumo.vencidas)} classe={resumo.vencidas ? 'negativo' : ''} />
        <Card titulo="Recebido" valor={formatarBRL(resumo.valorRecebidoCentavos)} detalhe={`juros ${formatarBRL(resumo.valorJurosCentavos)} · descontos ${formatarBRL(resumo.valorDescontosCentavos)}`} classe="positivo" />
        <Card titulo="Em aberto" valor={formatarBRL(resumo.valorEmAbertoCentavos)} detalhe={`${resumo.canceladas} cancelada(s) · ${resumo.isentas} isenta(s)`} />
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
        <Campo rotulo="Situação">
          <select value={situacao} onChange={(e) => setSituacao(e.target.value as FiltroSituacao)}>
            <option value="">Todas</option>
            <option value="ABERTA">Em aberto</option>
            <option value="VENCIDA">Vencidas</option>
            <option value="PAGA">Pagas</option>
            <option value="OUTRAS">Canceladas/isentas</option>
          </select>
        </Campo>
        <Campo rotulo="Buscar">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="1A 304 ou nome" />
        </Campo>
        <Campo rotulo="Forma padrão do 'Pagar'">
          <select value={formaPadrao} onChange={(e) => setFormaPadrao(e.target.value as FormaPagamento)}>
            {FORMAS_PAGAMENTO.map((f) => (
              <option key={f} value={f}>
                {ROTULO_FORMA[f]}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      {cobrancas && cobrancas.length === 0 ? (
        <div className="estado-vazio">
          <h3>Nenhuma cobrança em {formatarMes(comp)}</h3>
          <p>Gere as cobranças do mês para todos os apartamentos (a taxa por tipo fica em Estrutura › Taxas).</p>
          <button type="button" className="botao botao--primario" onClick={() => setGerando(true)}>
            Gerar cobranças
          </button>
        </div>
      ) : (
        <div className="painel">
          <div className="painel__cabecalho nao-imprimir">
            <div className="acoes">
              <button type="button" className="botao botao--pequeno" onClick={() => setSelecionadas(new Set(abertasVisiveis.map((c) => c.id)))} disabled={abertasVisiveis.length === 0}>
                Selecionar todas em aberto ({abertasVisiveis.length})
              </button>
              <button type="button" className="botao botao--pequeno" onClick={() => setSelecionadas(new Set())} disabled={selecionadas.size === 0}>
                Limpar seleção
              </button>
            </div>
            <button type="button" className="botao botao--sucesso" disabled={selecionadasVisiveis.length === 0 || ocupado} onClick={() => setLote([...selecionadasVisiveis])}>
              Registrar pagamento ({selecionadasVisiveis.length})
            </button>
          </div>
          <div className="tabela-rolagem">
            <table className="tabela tabela--compacta">
              <thead>
                <tr>
                  <th className="nao-imprimir"></th>
                  <th>Bloco</th>
                  <th>Apto</th>
                  <th>Responsável</th>
                  <th className="num">Cobrado</th>
                  <th className="num">Pago</th>
                  <th>Vencimento</th>
                  <th>Situação</th>
                  <th className="nao-imprimir"></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => {
                  const u = unidadesPorId.get(c.unidadeId)
                  const aberta = c.status === 'ABERTA'
                  return (
                    <tr key={c.id}>
                      <td className="nao-imprimir">
                        {aberta && (
                          <input
                            type="checkbox"
                            aria-label={`Selecionar cobrança do apartamento ${u?.numero ?? c.unidadeId}`}
                            checked={selecionadas.has(c.id)}
                            onChange={(e) => {
                              const s = new Set(selecionadas)
                              if (e.target.checked) s.add(c.id)
                              else s.delete(c.id)
                              setSelecionadas(s)
                            }}
                          />
                        )}
                      </td>
                      <td>{blocosPorId.get(c.blocoId)?.nome}</td>
                      <td>
                        <a href={paraHash({ nome: 'unidade', id: c.unidadeId })}>{u?.numero}</a>
                        {u && !u.ativa && <span className="texto-suave texto-pequeno"> (desativado)</span>}
                      </td>
                      <td>{u?.responsavel ?? ''}</td>
                      <td className="num">
                        {formatarBRL(c.valorCentavos)}
                        {c.origemValor === 'MANUAL' && <span title="Valor alterado manualmente"> ✎</span>}
                      </td>
                      <td className="num">{c.valorPagoCentavos !== null ? `${formatarBRL(c.valorPagoCentavos)}${c.jurosCentavos ? ` + ${formatarBRL(c.jurosCentavos)}` : ''}` : '—'}</td>
                      <td>{formatarData(c.vencimento)}</td>
                      <td>
                        <BadgeSituacao cobranca={c} />
                        {c.pagaEm && <span className="texto-suave texto-pequeno"> {formatarData(c.pagaEm)}</span>}
                      </td>
                      <td className="acoes-celula nao-imprimir">
                        {aberta && (
                          <>
                            <button type="button" className="botao botao--pequeno botao--sucesso" disabled={ocupado} onClick={() => void pagarUmClique(c)}>
                              Pagar
                            </button>{' '}
                            <button type="button" className="botao botao--pequeno" onClick={() => setPagando({ cobranca: c, modo: 'pagar' })}>
                              Pagar…
                            </button>{' '}
                            <button type="button" className="botao botao--link botao--pequeno" onClick={() => setEditando(c)}>
                              Editar
                            </button>
                            <button type="button" className="botao botao--link botao--pequeno" onClick={() => setMotivoPara({ cobranca: c, acao: 'cancelar' })}>
                              Cancelar
                            </button>
                            <button type="button" className="botao botao--link botao--pequeno" onClick={() => setMotivoPara({ cobranca: c, acao: 'isentar' })}>
                              Isentar
                            </button>
                          </>
                        )}
                        {c.status === 'PAGA' && (
                          <>
                            <button type="button" className="botao botao--link botao--pequeno" onClick={() => setPagando({ cobranca: c, modo: 'corrigir' })}>
                              Corrigir
                            </button>
                            <button type="button" className="botao botao--link botao--pequeno" onClick={() => setMotivoPara({ cobranca: c, acao: 'desfazer' })}>
                              Desfazer
                            </button>
                            {c.lancamentoId && <a className="botao botao--link botao--pequeno" href={paraHash({ nome: 'lancamento', id: c.lancamentoId })}>Recibo</a>}
                          </>
                        )}
                        {(c.status === 'CANCELADA' || c.status === 'ISENTA') && (
                          <button type="button" className="botao botao--link botao--pequeno" onClick={() => void executar(() => servicos.cobrancas.reabrir(c.id), 'Cobrança reaberta.')}>
                            Reabrir
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {gerando && <GerarCobrancasDialogo competencia={comp} onFechar={() => setGerando(false)} />}
      {pagando && (
        <PagamentoDialogo
          cobranca={pagando.cobranca}
          modo={pagando.modo}
          bloco={blocosPorId.get(pagando.cobranca.blocoId)}
          unidade={unidadesPorId.get(pagando.cobranca.unidadeId)}
          formaPadrao={formaPadrao}
          onFechar={() => setPagando(null)}
        />
      )}
      {lote && (
        <LoteDialogo
          ids={lote}
          formaPadrao={formaPadrao}
          onFechar={() => setLote(null)}
          onConcluido={(ok, erros) => {
            setLote(null)
            setSelecionadas(new Set())
            toast.sucesso(`${ok} pagamento(s) registrado(s).${erros ? ` ${erros} com erro.` : ''}`)
          }}
        />
      )}
      {motivoPara && (
        <MotivoDialogo
          titulo={motivoPara.acao === 'desfazer' ? 'Desfazer pagamento' : motivoPara.acao === 'cancelar' ? 'Cancelar cobrança' : 'Isentar cobrança'}
          rotuloConfirmar={motivoPara.acao === 'desfazer' ? 'Desfazer' : motivoPara.acao === 'cancelar' ? 'Cancelar cobrança' : 'Isentar'}
          perigo={motivoPara.acao !== 'isentar'}
          onFechar={() => setMotivoPara(null)}
          onConfirmar={async (motivo) => {
            const { cobranca, acao } = motivoPara
            const r = await executar(
              () => (acao === 'desfazer' ? servicos.cobrancas.desfazerPagamento(cobranca.id, motivo) : acao === 'cancelar' ? servicos.cobrancas.cancelar(cobranca.id, motivo) : servicos.cobrancas.isentar(cobranca.id, motivo)),
            )
            if (r) {
              toast.sucesso('estornoGerado' in r && r.estornoGerado ? 'Pagamento estornado no mês aberto; cobrança reaberta.' : 'Feito.')
              setMotivoPara(null)
            }
          }}
        />
      )}
      {editando && <EditarCobrancaDialogo cobranca={editando} onFechar={() => setEditando(null)} />}
    </>
  )
}

function Card({ titulo, valor, detalhe, classe }: { titulo: string; valor: string; detalhe?: string; classe?: string }) {
  return (
    <div className="card">
      <div className="card__titulo">{titulo}</div>
      <div className={`card__valor ${classe ?? ''}`}>{valor}</div>
      {detalhe && <div className="card__detalhe">{detalhe}</div>}
    </div>
  )
}

function GerarCobrancasDialogo({ competencia, onFechar }: { competencia: MesISO; onFechar: () => void }) {
  const { executar, ocupado } = useAcao()
  const toast = useToast()
  const [previa, setPrevia] = useState<PlanoCobrancas | null>(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    servicos.cobrancas
      .previaGeracao(competencia)
      .then(setPrevia)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : String(e)))
  }, [competencia])
  const vencimento = previa?.criar[0]?.vencimento
  return (
    <Modal
      titulo={`Gerar cobranças de ${formatarMes(competencia)}`}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao botao--primario"
            disabled={ocupado || !previa || previa.criar.length === 0}
            onClick={async () => {
              const r = await executar(() => servicos.cobrancas.gerar(competencia))
              if (r) {
                onFechar()
                toast.sucesso(`${r.criadas} cobrança(s) gerada(s) para ${formatarMes(competencia)}.`)
              }
            }}
          >
            Gerar {previa?.criar.length ?? ''} cobranças
          </button>
        </>
      }
    >
      {erro && <div className="alerta alerta--erro">{erro}</div>}
      {previa && (
        <>
          <p>
            Serão criadas <strong>{previa.criar.length}</strong> cobranças{vencimento ? ` com vencimento em ${formatarData(vencimento)}` : ''}:
          </p>
          <ul>
            {previa.resumo.map((r) => (
              <li key={r.quartos}>
                {r.quantidade} × {formatarBRL(r.valorCentavos)} ({r.quartos} quartos)
              </li>
            ))}
          </ul>
          {previa.jaExistentes > 0 && <p className="texto-suave">{previa.jaExistentes} apartamento(s) já têm cobrança nesta competência e serão mantidos.</p>}
          {previa.semTaxa.length > 0 && (
            <div className="alerta alerta--aviso" style={{ display: 'block' }}>
              Sem taxa definida (nada será gerado para estes blocos): {previa.semTaxa.map((s) => `${s.quartos} quartos (${s.blocos.join(', ')})`).join('; ')}. Defina em{' '}
              <a href={paraHash({ nome: 'estrutura', aba: 'taxas' })}>Estrutura › Taxas</a>.
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

export function PagamentoDialogo({
  cobranca,
  modo,
  bloco,
  unidade,
  formaPadrao = 'PIX',
  onFechar,
}: {
  cobranca: Cobranca
  modo: 'pagar' | 'corrigir'
  bloco?: Bloco
  unidade?: Unidade
  formaPadrao?: FormaPagamento
  onFechar: () => void
}) {
  const { executar, ocupado } = useAcao()
  const toast = useToast()
  const [inicializado, setInicializado] = useState(modo === 'pagar')
  const [erroOriginal, setErroOriginal] = useState('')
  const [formaOriginal, setFormaOriginal] = useState<FormaPagamento | null>(null)
  const [f, setF] = useState({
    data: (cobranca.pagaEm ?? relogioApp.hoje()) as DataISO,
    valorCentavos: (cobranca.valorPagoCentavos ?? cobranca.valorCentavos) as Centavos,
    formaPagamento: formaPadrao,
    jurosCentavos: cobranca.jurosCentavos as Centavos,
    observacoes: cobranca.observacoes ?? '',
    motivo: '',
  })
  const [anexos, setAnexos] = useState<ArquivoAnexo[]>([])
  useEffect(() => {
    if (modo !== 'corrigir') return
    let cancelado = false
    setInicializado(false)
    setErroOriginal('')
    void consultas.lancamentos.obter(cobranca.lancamentoId ?? '').then(l => {
      if (cancelado) return
      if (!l?.formaPagamento) { setErroOriginal('Pagamento original não encontrado. Verifique a integridade.'); return }
      setFormaOriginal(l.formaPagamento)
      setF(atual => ({ ...atual, formaPagamento: l.formaPagamento!, observacoes: l.observacoes ?? '' }))
      setInicializado(true)
    }).catch(e => { if (!cancelado) { setErroOriginal('Não foi possível carregar o pagamento original.'); toast.deErro(e) } })
    return () => { cancelado = true }
  }, [modo, cobranca.lancamentoId, toast])
  const diferente = f.valorCentavos !== cobranca.valorCentavos
  return (
    <Modal
      titulo={`${modo === 'pagar' ? 'Registrar pagamento' : 'Corrigir pagamento'} — ${bloco?.nome ?? ''} apto ${unidade?.numero ?? ''} · ${formatarMesCurto(cobranca.competencia)}`}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao botao--primario"
            disabled={ocupado || !inicializado || (modo === 'corrigir' && !f.motivo.trim())}
            onClick={async () => {
              const dados = { data: f.data, valorCentavos: f.valorCentavos, formaPagamento: f.formaPagamento, jurosCentavos: f.jurosCentavos, observacoes: f.observacoes }
              const r = await executar(
                () => (modo === 'pagar' ? servicos.cobrancas.registrarPagamento(cobranca.id, dados, anexos) : servicos.cobrancas.corrigirPagamento(cobranca.id, dados, f.motivo, anexos)),
                modo === 'pagar' ? 'Pagamento registrado.' : 'Pagamento corrigido.',
              )
              if (r) onFechar()
            }}
          >
            {modo === 'pagar' ? 'Registrar' : 'Corrigir'}
          </button>
        </>
      }
    >
      {erroOriginal && <p role="alert" className="alerta alerta--erro">{erroOriginal}</p>}
      {modo === 'corrigir' && !inicializado && !erroOriginal && <p>Carregando pagamento original…</p>}
      {formaOriginal && <p className="texto-suave">Forma atual: {ROTULO_FORMA[formaOriginal]}. Se o mês original estiver fechado, informe a data corrigida em um mês aberto.</p>}
      <p>
        Valor cobrado: <strong>{formatarBRL(cobranca.valorCentavos)}</strong> · vencimento {formatarData(cobranca.vencimento)}
      </p>
      <div className="formulario">
        <div className="linha-campos">
          <Campo rotulo="Data do pagamento">
            <CampoData valor={f.data} onChange={(d) => setF({ ...f, data: d })} autoFocus />
          </Campo>
          <Campo rotulo="Valor pago" ajuda={diferente ? `Diferença de ${formatarBRL(cobranca.valorCentavos - f.valorCentavos)}: informe o motivo nas observações.` : undefined}>
            <CampoMoeda valor={f.valorCentavos} onChange={(v) => setF({ ...f, valorCentavos: v })} />
          </Campo>
          <Campo rotulo="Juros / multa (opcional)">
            <CampoMoeda valor={f.jurosCentavos} onChange={(v) => setF({ ...f, jurosCentavos: v })} />
          </Campo>
        </div>
        <div className="linha-campos">
          <Campo rotulo="Forma de pagamento">
            <select value={f.formaPagamento} onChange={(e) => setF({ ...f, formaPagamento: e.target.value as FormaPagamento })}>
              {FORMAS_PAGAMENTO.map((fp) => (
                <option key={fp} value={fp}>
                  {ROTULO_FORMA[fp]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo={`Observações${diferente ? ' (obrigatório)' : ''}`}>
            <input value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
          </Campo>
        </div>
        {modo === 'corrigir' && (
          <Campo rotulo="Motivo da correção">
            <input value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />
          </Campo>
        )}
        <Campo rotulo="Comprovante (opcional)">
          <Dropzone accept="application/pdf,image/*" reduzirFotos onArquivos={(a) => setAnexos([...anexos, ...a])} />
          <ListaAnexosPendentes itens={anexos} onRemover={(i) => setAnexos(anexos.filter((_, j) => j !== i))} />
        </Campo>
      </div>
    </Modal>
  )
}

function LoteDialogo({ ids, formaPadrao, onFechar, onConcluido }: { ids: Id[]; formaPadrao: FormaPagamento; onFechar: () => void; onConcluido: (ok: number, erros: number) => void }) {
  const { executar, ocupado } = useAcao()
  const [pendentes, setPendentes] = useState([...ids])
  const [erros, setErros] = useState<Array<{ cobrancaId: Id; mensagem: string }>>([])
  const [concluidos, setConcluidos] = useState(0)
  const [data, setData] = useState<DataISO>(relogioApp.hoje())
  const [forma, setForma] = useState<FormaPagamento>(formaPadrao)
  return (
    <Modal
      titulo={`Registrar ${ids.length} pagamento(s)`}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao botao--primario"
            disabled={ocupado}
            onClick={async () => {
              const r = await executar(() => servicos.cobrancas.registrarPagamentosEmLote([...pendentes], { data, formaPagamento: forma }))
              if (r) {
                setConcluidos(n => n + r.ok.length)
                setErros(r.erros)
                setPendentes(r.erros.map(e => e.cobrancaId))
                if (!r.erros.length) onConcluido(concluidos + r.ok.length, 0)
              }
            }}
          >
            Registrar
          </button>
        </>
      }
    >
      <p>Cada cobrança selecionada será baixada pelo valor cobrado, sem juros.</p>
      {erros.length > 0 && <div role="alert" className="alerta alerta--erro"><div>{concluidos} pagamento(s) registrado(s); {erros.length} pendente(s). Corrija os dados e tente novamente apenas os pendentes.<ul>{erros.map(e => <li key={e.cobrancaId}>{e.cobrancaId}: {e.mensagem}</li>)}</ul></div></div>}
      <div className="linha-campos">
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

function EditarCobrancaDialogo({ cobranca, onFechar }: { cobranca: Cobranca; onFechar: () => void }) {
  const { executar, ocupado } = useAcao()
  const [f, setF] = useState({ valorCentavos: cobranca.valorCentavos, vencimento: cobranca.vencimento, observacoes: cobranca.observacoes ?? '' })
  return (
    <Modal
      titulo="Editar cobrança em aberto"
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao botao--primario"
            disabled={ocupado}
            onClick={async () => {
              const r = await executar(() => servicos.cobrancas.alterarAberta(cobranca.id, f), 'Cobrança alterada.')
              if (r) onFechar()
            }}
          >
            Salvar
          </button>
        </>
      }
    >
      <div className="linha-campos">
        <Campo rotulo="Valor cobrado" ajuda="Valor alterado manualmente não é sobrescrito por 'Reemitir'.">
          <CampoMoeda valor={f.valorCentavos} onChange={(v) => setF({ ...f, valorCentavos: v })} />
        </Campo>
        <Campo rotulo="Vencimento">
          <CampoData valor={f.vencimento} onChange={(d) => setF({ ...f, vencimento: d })} />
        </Campo>
      </div>
      <Campo rotulo="Observações">
        <input value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
      </Campo>
    </Modal>
  )
}
