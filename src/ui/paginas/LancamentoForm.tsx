// Formulário de receita/despesa (novo ou edição) com prévia do rateio e anexos.
import { useEffect, useMemo, useState } from 'react'
import { consultas, relogioApp, servicos } from '../../dados/instancia'
import type { ArquivoAnexo } from '../../dados/servicos/anexos'
import { adicionarDias, mesDe } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import { montarRateioGeral, reratearComSnapshot } from '../../dominio/rateio'
import type { Bloco, Centavos, DataISO, EscopoTipo, FormaPagamento, Id, Lancamento, MesISO, RateioSnapshot, Unidade } from '../../dominio/tipos'
import { FORMAS_PAGAMENTO, type NovoLancamento } from '../../dominio/validacao'
import { Dropzone, ListaAnexosPendentes } from '../componentes/anexos'
import { Carregando, EstadoVazio } from '../componentes/comuns'
import { Campo, CampoData, CampoMes, CampoMoeda } from '../componentes/campos'
import { useToast } from '../contexto/AppProviders'
import { useAcao, useEstrutura } from '../hooks'
import { navegar, voltar } from '../rotas'
import { ROTULO_FORMA } from '../rotulos'

export function PreviaRateio({ valor, blocos, unidades, anterior }: { valor: Centavos; blocos: Bloco[]; unidades: Unidade[]; anterior?: RateioSnapshot | null }) {
  const rateio = useMemo(() => {
    if (valor <= 0) return null
    try {
      return anterior ? reratearComSnapshot(valor, anterior, '') : montarRateioGeral(valor, blocos, unidades, '')
    } catch {
      return null
    }
  }, [valor, blocos, unidades, anterior])
  if (!rateio) return <p className="texto-suave texto-pequeno">Informe o valor para ver a divisão entre os blocos.</p>
  return (
    <div className="tabela-rolagem" style={{ maxHeight: 220, overflowY: 'auto' }}>
      <table className="tabela tabela--compacta">
        <thead>
          <tr>
            <th>Bloco</th>
            <th className="num">Aptos</th>
            <th className="num">Cota</th>
          </tr>
        </thead>
        <tbody>
          {rateio.cotas.map((c) => (
            <tr key={c.blocoId}>
              <td>{c.nomeBloco}</td>
              <td className="num">
                {c.unidadesAtivas}/{rateio.totalUnidades}
              </td>
              <td className="num">{formatarBRL(c.valorCentavos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface Estado {
  natureza: 'RECEITA' | 'DESPESA'
  valorCentavos: Centavos
  data: DataISO
  competencia: MesISO
  competenciaManual: boolean
  descricao: string
  categoriaId: Id
  escopoTipo: EscopoTipo
  blocoId: Id
  unidadeId: Id
  formaPagamento: FormaPagamento | ''
  observacoes: string
}

export function LancamentoForm({ id, natureza = 'DESPESA', embutido, onSalvo }: { id?: Id; natureza?: 'RECEITA' | 'DESPESA'; embutido?: boolean; onSalvo?: () => void }) {
  const { blocos, blocosAtivos, unidades, categorias, carregando: carregandoEstrutura } = useEstrutura()
  const { executar, ocupado } = useAcao()
  const toast = useToast()
  const hoje = relogioApp.hoje()
  const [existente, setExistente] = useState<Lancamento | null>(null)
  const [carregando, setCarregando] = useState(!!id)
  const [f, setF] = useState<Estado>({
    natureza,
    valorCentavos: 0,
    data: hoje,
    competencia: mesDe(hoje),
    competenciaManual: false,
    descricao: '',
    categoriaId: '',
    escopoTipo: 'GERAL',
    blocoId: '',
    unidadeId: '',
    formaPagamento: '',
    observacoes: '',
  })
  const [anexos, setAnexos] = useState<ArquivoAnexo[]>([])
  const [buscaUnidade, setBuscaUnidade] = useState('')

  useEffect(() => {
    if (!id) return
    let cancelado = false
    setCarregando(true)
    void consultas.lancamentos.obter(id).then(async (l) => {
      if (!l || l.natureza === 'TRANSFERENCIA') return
      const unidade = l.unidadeId ? await consultas.unidade(l.unidadeId) : undefined
      if (cancelado) return
      setExistente(l)
      setF({
        natureza: l.natureza,
        valorCentavos: l.valorCentavos,
        data: l.data,
        competencia: l.competencia,
        competenciaManual: l.competencia !== mesDe(l.data),
        descricao: l.descricao,
        categoriaId: l.categoriaId,
        escopoTipo: l.escopoTipo,
        blocoId: l.blocoId ?? unidade?.blocoId ?? '',
        unidadeId: l.unidadeId ?? '',
        formaPagamento: l.formaPagamento ?? '',
        observacoes: l.observacoes ?? '',
      })
    }).catch(e => { if (!cancelado) toast.deErro(e) }).finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [id, toast])

  const categoriasDaNatureza = categorias.filter((c) => c.natureza === f.natureza && (c.ativa || c.id === existente?.categoriaId) && c.sistema !== 'TAXA' && c.sistema !== 'JUROS')
  const vinculadoACobranca = !!existente?.cobrancaId
  const blocoOriginal = existente?.blocoId ?? unidades.find(u => u.id === existente?.unidadeId)?.blocoId
  const blocosDisponiveis = blocos.filter(b => b.ativo || b.id === blocoOriginal)
  const unidadesDoBloco = unidades.filter((u) => u.blocoId === f.blocoId && ((u.ativa && blocosAtivos.some(b => b.id === u.blocoId)) || u.id === existente?.unidadeId))
  const sugestoesUnidade = useMemo(() => {
    const t = buscaUnidade.trim().toLocaleLowerCase('pt-BR')
    if (!t) return []
    return unidades
      .filter((u) => u.ativa)
      .map((u) => ({ u, bloco: blocos.find((b) => b.id === u.blocoId && b.ativo) }))
      .filter(({ u, bloco }) => bloco && `${bloco.nome.toLocaleLowerCase('pt-BR')} ${u.numero}`.includes(t))
      .slice(0, 8)
  }, [buscaUnidade, unidades, blocos])

  function montarEntrada(): NovoLancamento {
    return {
      natureza: f.natureza,
      data: f.data,
      competencia: f.competencia,
      valorCentavos: f.valorCentavos,
      descricao: f.descricao,
      categoriaId: f.categoriaId,
      escopoTipo: f.escopoTipo,
      blocoId: f.escopoTipo === 'BLOCO' ? f.blocoId : null,
      unidadeId: f.escopoTipo === 'UNIDADE' ? f.unidadeId : null,
      formaPagamento: f.formaPagamento || null,
      observacoes: f.observacoes,
    }
  }

  async function salvar(outro: boolean) {
    if (id && (!existente || carregando)) return
    const r = await executar(async () => {
      if (existente) {
        if (vinculadoACobranca) return servicos.lancamentos.atualizar(existente.id, { descricao: f.descricao, observacoes: f.observacoes, formaPagamento: f.formaPagamento || null })
        return servicos.lancamentos.atualizar(existente.id, montarEntrada())
      }
      return servicos.lancamentos.registrar(montarEntrada(), anexos)
    }, existente ? 'Lançamento alterado.' : 'Lançamento registrado.')
    if (!r) return
    if (onSalvo) return onSalvo()
    if (outro) {
      setF({ ...f, valorCentavos: 0, descricao: '', observacoes: '' })
      setAnexos([])
      toast.info('Pronto para o próximo lançamento.')
      return
    }
    navegar({ nome: 'lancamento', id: r.id })
  }

  const travado = vinculadoACobranca
  if (carregando || carregandoEstrutura) return <Carregando />
  if (id && !existente) return <EstadoVazio titulo="Lançamento indisponível para edição" />
  return (
    <form
      className="formulario"
      onSubmit={(e) => {
        e.preventDefault()
        void salvar(false)
      }}
    >
      {!embutido && (
        <div className="cabecalho-pagina">
          <h1>{existente ? 'Editar lançamento' : f.natureza === 'DESPESA' ? 'Nova despesa' : 'Nova receita'}</h1>
        </div>
      )}
      {travado && <div className="alerta alerta--info">Este é um pagamento de taxa. Valor, data e apartamento só mudam por "Corrigir pagamento" em Cobranças.</div>}
      {!existente && (
        <div className="chips">
          <button type="button" className={`chip${f.natureza === 'DESPESA' ? ' chip--ativo' : ''}`} onClick={() => setF({ ...f, natureza: 'DESPESA', categoriaId: '' })}>
            Despesa (saída)
          </button>
          <button type="button" className={`chip${f.natureza === 'RECEITA' ? ' chip--ativo' : ''}`} onClick={() => setF({ ...f, natureza: 'RECEITA', categoriaId: '' })}>
            Receita (entrada)
          </button>
        </div>
      )}
      <div className="linha-campos">
        <Campo rotulo="Valor">
          <CampoMoeda valor={f.valorCentavos} onChange={(v) => setF({ ...f, valorCentavos: v })} autoFocus={!existente} disabled={travado} />
        </Campo>
        <Campo rotulo="Data do pagamento/recebimento">
          <CampoData valor={f.data} disabled={travado} onChange={(d) => setF({ ...f, data: d, competencia: f.competenciaManual ? f.competencia : mesDe(d) })} />
          {!travado && (
            <div className="chips">
              <button type="button" className="chip" onClick={() => setF({ ...f, data: hoje, competencia: f.competenciaManual ? f.competencia : mesDe(hoje) })}>
                Hoje
              </button>
              <button type="button" className="chip" onClick={() => setF({ ...f, data: adicionarDias(hoje, -1), competencia: f.competenciaManual ? f.competencia : mesDe(adicionarDias(hoje, -1)) })}>
                Ontem
              </button>
            </div>
          )}
        </Campo>
        <Campo rotulo="Competência (mês de referência)" ajuda="Normalmente igual ao mês da data.">
          <CampoMes valor={f.competencia} disabled={travado} onChange={(m) => setF({ ...f, competencia: m, competenciaManual: true })} />
        </Campo>
      </div>
      <div className="linha-campos">
        <Campo rotulo="Descrição">
          <input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} required maxLength={200} placeholder="Ex.: Conta de água setembro" />
        </Campo>
        <Campo rotulo="Categoria">
          <select value={f.categoriaId} onChange={(e) => setF({ ...f, categoriaId: e.target.value })} required disabled={travado}>
            <option value="">Selecione…</option>
            {travado && existente && <option value={existente.categoriaId}>{categorias.find(c => c.id === existente.categoriaId)?.nome}</option>}
            {categoriasDaNatureza.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}{!c.ativa ? ' (desativada)' : ''}
              </option>
            ))}
          </select>
          {f.natureza === 'RECEITA' && <span className="campo__ajuda">Taxa condominial e juros são registrados em Cobranças › Pagar.</span>}
        </Campo>
      </div>
      {!travado && (
        <Campo rotulo="A quem pertence este lançamento?">
          <div className="opcoes-radio">
            <label>
              <input type="radio" checked={f.escopoTipo === 'GERAL'} onChange={() => setF({ ...f, escopoTipo: 'GERAL' })} /> Condomínio inteiro (dividir entre os blocos proporcionalmente aos apartamentos)
            </label>
            <label>
              <input type="radio" checked={f.escopoTipo === 'BLOCO'} onChange={() => setF({ ...f, escopoTipo: 'BLOCO' })} /> Um bloco
            </label>
            <label>
              <input type="radio" checked={f.escopoTipo === 'UNIDADE'} onChange={() => setF({ ...f, escopoTipo: 'UNIDADE' })} /> Um apartamento
            </label>
          </div>
        </Campo>
      )}
      {!travado && f.escopoTipo === 'GERAL' && (
        <Campo rotulo="Prévia do rateio">
          {existente?.rateio && <p className="texto-suave">Mantém a divisão original; use Recalcular rateio no detalhe para usar a estrutura atual.</p>}
          <PreviaRateio valor={f.valorCentavos} blocos={blocos} unidades={unidades} anterior={existente?.rateio} />
        </Campo>
      )}
      {!travado && f.escopoTipo === 'BLOCO' && (
        <Campo rotulo="Bloco">
          <select value={f.blocoId} onChange={(e) => setF({ ...f, blocoId: e.target.value })} required>
            <option value="">Selecione…</option>
            {blocosDisponiveis.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}{!b.ativo ? ' (desativado)' : ''}
              </option>
            ))}
          </select>
        </Campo>
      )}
      {!travado && f.escopoTipo === 'UNIDADE' && (
        <div className="linha-campos">
          <Campo rotulo="Buscar apartamento" ajuda='Digite bloco e número, ex.: "1A 304".'>
            <input value={buscaUnidade} onChange={(e) => setBuscaUnidade(e.target.value)} />
            {sugestoesUnidade.length > 0 && (
              <div className="chips">
                {sugestoesUnidade.map(({ u, bloco }) => (
                  <button
                    key={u.id}
                    type="button"
                    className={`chip${f.unidadeId === u.id ? ' chip--ativo' : ''}`}
                    onClick={() => {
                      setF({ ...f, unidadeId: u.id, blocoId: u.blocoId })
                      setBuscaUnidade('')
                    }}
                  >
                    {bloco?.nome} {u.numero}
                  </button>
                ))}
              </div>
            )}
          </Campo>
          <Campo rotulo="Bloco">
            <select value={f.blocoId} onChange={(e) => setF({ ...f, blocoId: e.target.value, unidadeId: '' })}>
              <option value="">Selecione…</option>
              {blocosDisponiveis.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}{!b.ativo ? ' (desativado)' : ''}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Apartamento">
            <select value={f.unidadeId} onChange={(e) => setF({ ...f, unidadeId: e.target.value })} required>
              <option value="">Selecione…</option>
              {unidadesDoBloco.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.numero}
                  {!u.ativa ? ' (desativado)' : ''}
                  {u.responsavel ? ` — ${u.responsavel}` : ''}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      )}
      <div className="linha-campos">
        <Campo rotulo="Forma de pagamento (opcional)">
          <select value={f.formaPagamento} onChange={(e) => setF({ ...f, formaPagamento: e.target.value as FormaPagamento | '' })}>
            <option value="">—</option>
            {FORMAS_PAGAMENTO.map((fp) => (
              <option key={fp} value={fp}>
                {ROTULO_FORMA[fp]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Observações (opcional)">
          <textarea rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
        </Campo>
      </div>
      {!existente && (
        <Campo rotulo="Comprovantes (PDF ou foto; até 15 MB cada)">
          <Dropzone accept="application/pdf,image/*" reduzirFotos onArquivos={(a) => setAnexos([...anexos, ...a])} />
          <ListaAnexosPendentes itens={anexos} onRemover={(i) => setAnexos(anexos.filter((_, j) => j !== i))} />
        </Campo>
      )}
      <div className="acoes">
        <button className="botao botao--primario" disabled={ocupado}>
          Salvar
        </button>
        {!existente && (
          <button type="button" className="botao" disabled={ocupado} onClick={() => void salvar(true)}>
            Salvar e lançar outra
          </button>
        )}
        <button type="button" className="botao botao--link" onClick={() => (onSalvo ? onSalvo() : voltar())}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
