// Estrutura: condomínio, blocos (com prévia do diff), taxas (vigências) e categorias.
import { useEffect, useRef, useState } from 'react'
import { servicos } from '../../dados/instancia'
import type { PreviaBloco } from '../../dados/servicos/estrutura'
import { taxaVigente } from '../../dominio/cobrancas'
import { formatarData, formatarMes, formatarMesCurto, mesDe, primeiraDataDoMes } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import type { Bloco, Categoria, Centavos, DataISO, Id, MesISO } from '../../dominio/tipos'
import { Campo, CampoData, CampoMes, CampoMoeda, SeletorCompetencia } from '../componentes/campos'
import { Badge, Modal, Valor } from '../componentes/comuns'
import { useConfirmacao, useToast } from '../contexto/AppProviders'
import { useAcao, useEstrutura } from '../hooks'
import { paraHash, type AbaEstrutura } from '../rotas'
import { relogioApp } from '../../dados/instancia'

const ABAS: Array<{ id: AbaEstrutura; rotulo: string }> = [
  { id: 'blocos', rotulo: 'Blocos' },
  { id: 'taxas', rotulo: 'Taxas' },
  { id: 'categorias', rotulo: 'Categorias' },
  { id: 'condominio', rotulo: 'Condomínio' },
]

export function Estrutura({ aba = 'blocos' }: { aba?: AbaEstrutura }) {
  return (
    <>
      <div className="cabecalho-pagina">
        <h1>Estrutura</h1>
        <div className="chips">
          {ABAS.map((a) => (
            <a key={a.id} href={paraHash({ nome: 'estrutura', aba: a.id })} className={`chip${aba === a.id ? ' chip--ativo' : ''}`}>
              {a.rotulo}
            </a>
          ))}
        </div>
      </div>
      {aba === 'condominio' && <AbaCondominio />}
      {aba === 'blocos' && <AbaBlocos />}
      {aba === 'taxas' && <AbaTaxas />}
      {aba === 'categorias' && <AbaCategorias />}
    </>
  )
}

// ---------------- Condomínio ----------------
function AbaCondominio() {
  const { condominio } = useEstrutura()
  const { executar, ocupado } = useAcao()
  const confirmar = useConfirmacao()
  const [form, setForm] = useState({ nome: '', cnpj: '', endereco: '', sindico: '', diaVencimento: 10 })
  const sincronizado = useRef<typeof form | null>(null)
  const [inicio, setInicio] = useState<MesISO>('')
  useEffect(() => {
    if (!condominio) return
    const proximo = { nome: condominio.nome, cnpj: condominio.cnpj ?? '', endereco: condominio.endereco ?? '', sindico: condominio.sindico ?? '', diaVencimento: condominio.diaVencimento }
    const anterior = sincronizado.current
    setForm(atual => !anterior || JSON.stringify(atual) === JSON.stringify(anterior) ? proximo : atual)
    sincronizado.current = proximo
    setInicio(condominio.inicioContabil)
  }, [condominio])
  if (!condominio) return null
  return (
    <div className="painel">
      <h2>Dados do condomínio</h2>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault()
          void executar(() => servicos.estrutura.atualizarCondominio(form), 'Dados salvos.')
        }}
      >
        <div className="linha-campos">
          <Campo rotulo="Nome">
            <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
          </Campo>
          <Campo rotulo="CNPJ (opcional)">
            <input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} />
          </Campo>
          <Campo rotulo="Dia de vencimento da taxa" ajuda="Ajustado ao último dia em meses mais curtos.">
            <input type="number" min={1} max={31} value={form.diaVencimento} onChange={(e) => setForm({ ...form, diaVencimento: Number(e.target.value) })} />
          </Campo>
        </div>
        <div className="linha-campos">
          <Campo rotulo="Endereço (opcional)">
            <input value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
          </Campo>
          <Campo rotulo="Síndico(a) (opcional)">
            <input value={form.sindico} onChange={(e) => setForm({ ...form, sindico: e.target.value })} />
          </Campo>
        </div>
        <div className="acoes">
          <button className="botao botao--primario" disabled={ocupado}>
            Salvar
          </button>
        </div>
      </form>
      <h2 className="espaco-topo">Início contábil</h2>
      <p className="texto-suave">
        Mês a partir do qual a contabilidade é registrada: <strong>{formatarMes(condominio.inicioContabil)}</strong>. Recuar permite lançar meses passados (o saldo inicial dos blocos acompanha); avançar só é possível sem lançamentos anteriores.
      </p>
      <div className="linha-campos" style={{ alignItems: 'flex-end' }}>
        <Campo rotulo="Novo início">
          <CampoMes valor={inicio} onChange={setInicio} />
        </Campo>
        <button
          type="button"
          className="botao"
          disabled={ocupado || inicio === condominio.inicioContabil}
          onClick={async () => {
            if (await confirmar({ titulo: 'Alterar início contábil', texto: `Mudar o início contábil para ${formatarMes(inicio)}?` }))
              void executar(() => servicos.estrutura.definirInicioContabil(inicio), 'Início contábil alterado.')
          }}
        >
          Alterar início contábil
        </button>
      </div>
    </div>
  )
}

// ---------------- Blocos ----------------
function AbaBlocos() {
  const { blocos, unidades } = useEstrutura()
  const { executar, ocupado } = useAcao()
  const confirmar = useConfirmacao()
  const [editando, setEditando] = useState<Bloco | 'novo' | null>(null)
  const [desativando, setDesativando] = useState<{ bloco: Bloco; saldo: Centavos } | null>(null)
  const [distribuindo, setDistribuindo] = useState(false)
  const ativasPorBloco = new Map<Id, number>()
  for (const u of unidades) if (u.ativa) ativasPorBloco.set(u.blocoId, (ativasPorBloco.get(u.blocoId) ?? 0) + 1)
  const totalAtivas = blocos.filter((b) => b.ativo).reduce((s, b) => s + (ativasPorBloco.get(b.id) ?? 0), 0)

  async function mover(b: Bloco, delta: number) {
    const ordenados = [...blocos].sort((x, y) => x.ordem - y.ordem)
    const i = ordenados.findIndex((x) => x.id === b.id)
    const j = i + delta
    if (j < 0 || j >= ordenados.length) return
    ;[ordenados[i], ordenados[j]] = [ordenados[j]!, ordenados[i]!]
    await executar(() => servicos.estrutura.reordenarBlocos(ordenados.map((x) => x.id)))
  }

  return (
    <>
      <div className="painel">
        <div className="painel__cabecalho">
          <h2>Blocos</h2>
          <div className="acoes">
            <button type="button" className="botao" onClick={() => setDistribuindo(true)}>
              Distribuir saldo total
            </button>
            <button type="button" className="botao botao--primario" onClick={() => setEditando('novo')}>
              Novo bloco
            </button>
          </div>
        </div>
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Ordem</th>
                <th>Bloco</th>
                <th>Quartos</th>
                <th>Andares × aptos</th>
                <th className="num">Aptos ativos</th>
                <th className="num">Peso no rateio</th>
                <th className="num">Saldo inicial</th>
                <th>Situação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {blocos.map((b) => (
                <tr key={b.id}>
                  <td>
                    <button type="button" className="botao botao--link botao--pequeno" onClick={() => void mover(b, -1)} title="Subir">
                      ▲
                    </button>
                    <button type="button" className="botao botao--link botao--pequeno" onClick={() => void mover(b, 1)} title="Descer">
                      ▼
                    </button>
                  </td>
                  <td>
                    <strong>{b.nome}</strong>
                  </td>
                  <td>{b.quartos}</td>
                  <td>
                    {b.andares} × {b.aptosPorAndar}
                  </td>
                  <td className="num">{ativasPorBloco.get(b.id) ?? 0}</td>
                  <td className="num">{b.ativo && totalAtivas > 0 ? `${(((ativasPorBloco.get(b.id) ?? 0) / totalAtivas) * 100).toFixed(1)}%` : '—'}</td>
                  <td className="num">
                    <Valor centavos={b.saldoInicialCentavos} neutro /> <span className="texto-suave texto-pequeno">em {formatarData(b.dataSaldoInicial)}</span>
                  </td>
                  <td>{b.ativo ? <Badge tipo="sucesso">Ativo</Badge> : <Badge tipo="inativo">Desativado</Badge>}</td>
                  <td className="acoes-celula">
                    <button type="button" className="botao botao--link botao--pequeno" onClick={() => setEditando(b)}>
                      Editar
                    </button>
                    {b.ativo ? (
                      <button
                        type="button"
                        className="botao botao--link botao--pequeno"
                        onClick={async () => {
                          const saldo = await executar(() => servicos.estrutura.saldoAtual(b.id))
                          if (saldo !== undefined) setDesativando({ bloco: b, saldo })
                        }}
                      >
                        Desativar
                      </button>
                    ) : (
                      <button type="button" className="botao botao--link botao--pequeno" onClick={() => void executar(() => servicos.estrutura.reativarBloco(b.id), `Bloco ${b.nome} reativado.`)}>
                        Reativar
                      </button>
                    )}
                    <button
                      type="button"
                      className="botao botao--link botao--pequeno"
                      onClick={async () => {
                        if (await confirmar({ titulo: 'Excluir bloco', texto: `Excluir o bloco ${b.nome} e seus apartamentos? Só é possível se não houver histórico.`, perigo: true, confirmarTexto: 'Excluir' }))
                          void executar(() => servicos.estrutura.excluirBloco(b.id), `Bloco ${b.nome} excluído.`)
                      }}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total</td>
                <td className="num">{totalAtivas}</td>
                <td className="num">100%</td>
                <td className="num">
                  <Valor centavos={blocos.reduce((s, b) => s + b.saldoInicialCentavos, 0)} neutro />
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="texto-suave texto-pequeno espaco-topo">
          Regra de ouro: relatórios históricos nunca mudam por alteração da estrutura. Lançamentos gerais guardam o rateio do momento em que foram registrados. Nenhum lançamento pode ter data anterior ao saldo inicial do bloco.
        </p>
      </div>
      {editando && <BlocoForm bloco={editando === 'novo' ? null : editando} onFechar={() => setEditando(null)} />}
      {desativando && (
        <DesativarBlocoDialogo
          bloco={desativando.bloco}
          saldo={desativando.saldo}
          blocos={blocos.filter((b) => b.ativo && b.id !== desativando.bloco.id)}
          onFechar={() => setDesativando(null)}
        />
      )}
      {distribuindo && <DistribuirSaldoDialogo blocos={blocos.filter((b) => b.ativo)} onFechar={() => setDistribuindo(false)} />}
      {ocupado && <p className="texto-suave">Salvando...</p>}
    </>
  )
}

function BlocoForm({ bloco, onFechar }: { bloco: Bloco | null; onFechar: () => void }) {
  const { condominio } = useEstrutura()
  const { executar, ocupado } = useAcao()
  const inicio = condominio ? primeiraDataDoMes(condominio.inicioContabil) : relogioApp.hoje()
  const [form, setForm] = useState({
    nome: bloco?.nome ?? '',
    quartos: bloco?.quartos ?? 2,
    andares: bloco?.andares ?? 4,
    aptosPorAndar: bloco?.aptosPorAndar ?? 4,
    saldoInicialCentavos: bloco?.saldoInicialCentavos ?? 0,
    dataSaldoInicial: (bloco?.dataSaldoInicial ?? inicio) as DataISO,
  })
  const [previa, setPrevia] = useState<PreviaBloco | null>(null)
  const estruturaMudou = !!bloco && (form.andares !== bloco.andares || form.aptosPorAndar !== bloco.aptosPorAndar)
  useEffect(() => {
    if (!bloco || !estruturaMudou || form.andares < 1 || form.aptosPorAndar < 1) {
      setPrevia(null)
      return
    }
    let ativo = true
    servicos.estrutura
      .previaAtualizacaoBloco(bloco.id, { andares: form.andares, aptosPorAndar: form.aptosPorAndar })
      .then((p) => ativo && setPrevia(p))
      .catch(() => ativo && setPrevia(null))
    return () => {
      ativo = false
    }
  }, [bloco, estruturaMudou, form.andares, form.aptosPorAndar])

  async function salvar() {
    const r = await executar(async () => {
      if (bloco) return servicos.estrutura.atualizarBloco(bloco.id, form)
      return servicos.estrutura.criarBloco(form)
    }, bloco ? 'Bloco alterado.' : 'Bloco criado.')
    if (r) onFechar()
  }

  const numeros = (lista: Array<{ numero: string }>) => lista.map((x) => x.numero).join(', ')
  return (
    <Modal titulo={bloco ? `Editar bloco ${bloco.nome}` : 'Novo bloco'} onFechar={onFechar} rodape={<><button type="button" className="botao" onClick={onFechar}>Cancelar</button><button type="button" className="botao botao--primario" onClick={() => void salvar()} disabled={ocupado}>Salvar</button></>}>
      <div className="formulario">
        <div className="linha-campos">
          <Campo rotulo="Nome">
            <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
          </Campo>
          <Campo rotulo="Quartos" ajuda="Define a taxa aplicada (Estrutura › Taxas).">
            <input type="number" min={1} max={10} value={form.quartos} onChange={(e) => setForm({ ...form, quartos: Number(e.target.value) })} />
          </Campo>
        </div>
        <div className="linha-campos">
          <Campo rotulo="Andares">
            <input type="number" min={1} max={50} value={form.andares} onChange={(e) => setForm({ ...form, andares: Number(e.target.value) })} />
          </Campo>
          <Campo rotulo="Apartamentos por andar" ajuda="Numeração: andar + posição (101, 102… 112).">
            <input type="number" min={1} max={99} value={form.aptosPorAndar} onChange={(e) => setForm({ ...form, aptosPorAndar: Number(e.target.value) })} />
          </Campo>
        </div>
        <p className="texto-suave texto-pequeno">
          {form.andares * form.aptosPorAndar} apartamentos: 101 a {form.andares}
          {String(form.aptosPorAndar).padStart(2, '0')}
        </p>
        {previa && (
          <div className="alerta alerta--info" style={{ display: 'block' }}>
            <strong>Prévia da mudança:</strong>
            {previa.diff.criar.length > 0 && <div>Criar {previa.diff.criar.length}: {numeros(previa.diff.criar)}</div>}
            {previa.diff.reativar.length > 0 && <div>Reativar {previa.diff.reativar.length}: {numeros(previa.diff.reativar)}</div>}
            {previa.diff.desativar.length > 0 && <div>Desativar (têm histórico) {previa.diff.desativar.length}: {numeros(previa.diff.desativar)}</div>}
            {previa.diff.excluir.length > 0 && <div>Excluir (sem histórico) {previa.diff.excluir.length}: {numeros(previa.diff.excluir)}</div>}
            {previa.cobrancasAbertasAfetadas > 0 && <div><strong>{previa.cobrancasAbertasAfetadas} cobrança(s) em aberto</strong> nos apartamentos a desativar continuarão cobráveis.</div>}
          </div>
        )}
        <div className="linha-campos">
          <Campo rotulo="Saldo inicial do caixa" ajuda="Quanto o bloco tinha na abertura da data ao lado. Não é receita.">
            <CampoMoeda valor={form.saldoInicialCentavos} onChange={(v) => setForm({ ...form, saldoInicialCentavos: v })} permitirNegativo />
          </Campo>
          <Campo rotulo="Data do saldo inicial" ajuda="Nenhum lançamento do bloco pode ser anterior a esta data.">
            <CampoData valor={form.dataSaldoInicial} onChange={(d) => setForm({ ...form, dataSaldoInicial: d })} min={inicio} />
          </Campo>
        </div>
      </div>
    </Modal>
  )
}

function DesativarBlocoDialogo({ bloco, saldo, blocos, onFechar }: { bloco: Bloco; saldo: Centavos; blocos: Bloco[]; onFechar: () => void }) {
  const { executar, ocupado } = useAcao()
  const [destino, setDestino] = useState<Id>(blocos[0]?.id ?? '')
  return (
    <Modal
      titulo={`Desativar bloco ${bloco.nome}`}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao botao--perigo"
            disabled={ocupado || (saldo !== 0 && !destino)}
            onClick={async () => {
              const r = await executar(() => servicos.estrutura.desativarBloco(bloco.id, { transferirParaBlocoId: saldo !== 0 ? destino : null }), `Bloco ${bloco.nome} desativado.`)
              if (r) onFechar()
            }}
          >
            {saldo !== 0 ? 'Transferir saldo e desativar' : 'Desativar'}
          </button>
        </>
      }
    >
      <p>O bloco deixa de receber cobranças e sai dos próximos rateios. O histórico é mantido e ele pode ser reativado depois.</p>
      <p>
        Saldo atual do bloco: <strong>{formatarBRL(saldo)}</strong>
      </p>
      {saldo !== 0 && (
        <Campo rotulo="Transferir o saldo para o bloco">
          <select value={destino} onChange={(e) => setDestino(e.target.value)}>
            {blocos.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </select>
        </Campo>
      )}
    </Modal>
  )
}

function DistribuirSaldoDialogo({ blocos, onFechar }: { blocos: Bloco[]; onFechar: () => void }) {
  const { condominio } = useEstrutura()
  const { executar, ocupado } = useAcao()
  const confirmar = useConfirmacao()
  const [total, setTotal] = useState<Centavos>(blocos.reduce((n, b) => n + b.saldoInicialCentavos, 0))
  const [data, setData] = useState<DataISO>(blocos[0]?.dataSaldoInicial ?? (condominio ? primeiraDataDoMes(condominio.inicioContabil) : relogioApp.hoje()))
  const [valores, setValores] = useState<Record<Id, Centavos>>(() => Object.fromEntries(blocos.map(b => [b.id, b.saldoInicialCentavos])))
  async function sugerir() {
    const s = await executar(() => servicos.estrutura.sugerirDistribuicaoSaldo(total))
    if (!s) return
    const v: Record<Id, Centavos> = {}
    for (const x of s) v[x.blocoId] = x.valorCentavos
    setValores(v)
  }
  async function aplicar() {
    const itens = blocos.map(b => ({ blocoId: b.id, valorCentavos: valores[b.id] ?? b.saldoInicialCentavos, data }))
    if (!await confirmar({ titulo: 'Gravar saldos iniciais?', texto: `${itens.length} blocos, total ${formatarBRL(itens.reduce((n, b) => n + b.valorCentavos, 0))} em ${formatarData(data)}. Esta data será aplicada a todos os blocos.`, confirmarTexto: 'Gravar saldos' })) return
    const r = await executar(() => servicos.estrutura.definirSaldosIniciaisEmLote(itens), 'Saldos iniciais gravados.')
    if (r) onFechar()
  }
  return (
    <Modal titulo="Distribuir saldo inicial" onFechar={onFechar} rodape={<><button type="button" className="botao" onClick={onFechar}>Cancelar</button><button type="button" className="botao botao--primario" disabled={ocupado} onClick={() => void aplicar()}>Gravar em todos os blocos</button></>}>
      <div className="linha-campos" style={{ alignItems: 'flex-end' }}>
        <Campo rotulo="Saldo total do condomínio">
          <CampoMoeda valor={total} onChange={setTotal} permitirNegativo />
        </Campo>
        <Campo rotulo="Na data">
          <CampoData valor={data} onChange={setData} />
        </Campo>
        <button type="button" className="botao" onClick={() => void sugerir()}>
          Sugerir proporcional
        </button>
      </div>
      <table className="tabela tabela--compacta espaco-topo">
        <tbody>
          {blocos.map((b) => (
            <tr key={b.id}>
              <td>{b.nome}</td>
              <td className="num">
                <CampoMoeda valor={valores[b.id] ?? 0} onChange={(v) => setValores({ ...valores, [b.id]: v })} permitirNegativo />
              </td>
            </tr>
          ))}
          <tr className="tabela__total">
            <td>Total</td>
            <td className="num">{formatarBRL(blocos.reduce((s, b) => s + (valores[b.id] ?? 0), 0))}</td>
          </tr>
        </tbody>
      </table>
    </Modal>
  )
}

// ---------------- Taxas ----------------
function AbaTaxas() {
  const { blocos, taxas } = useEstrutura()
  const { executar, ocupado } = useAcao()
  const toast = useToast()
  const confirmar = useConfirmacao()
  const tipos = [...new Set(blocos.map((b) => b.quartos))].sort((a, b) => b - a)
  const mesAtual = mesDe(relogioApp.hoje())
  const [form, setForm] = useState({ quartos: tipos[0] ?? 2, valorCentavos: 0 as Centavos, vigenteDesde: mesAtual as MesISO })
  const [competencia, setCompetencia] = useState<MesISO>(mesAtual)
  return (
    <>
      <div className="painel">
        <h2>Taxa condominial por tipo de apartamento</h2>
        <div className="cards">
          {tipos.map((q) => {
            const vigente = taxaVigente(taxas, q, mesAtual)
            return (
              <div key={q} className="card">
                <div className="card__titulo">{q} quartos</div>
                <div className="card__valor">{vigente ? formatarBRL(vigente.valorCentavos) : '—'}</div>
                <div className="card__detalhe">
                  {blocos.filter((b) => b.quartos === q).map((b) => b.nome).join(', ')}
                  {vigente && ` · desde ${formatarMesCurto(vigente.vigenteDesde)}`}
                </div>
              </div>
            )
          })}
        </div>
        <h3>Nova vigência</h3>
        <form
          className="linha-campos"
          style={{ alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault()
            void executar(() => servicos.estrutura.definirTaxa(form), 'Taxa gravada.')
          }}
        >
          <Campo rotulo="Tipo">
            <select value={form.quartos} onChange={(e) => setForm({ ...form, quartos: Number(e.target.value) })}>
              {tipos.map((q) => (
                <option key={q} value={q}>
                  {q} quartos
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Valor mensal">
            <CampoMoeda valor={form.valorCentavos} onChange={(v) => setForm({ ...form, valorCentavos: v })} />
          </Campo>
          <Campo rotulo="Vale a partir de" ajuda="Pode ser retroativo. Cobranças já emitidas não mudam.">
            <CampoMes valor={form.vigenteDesde} onChange={(m) => setForm({ ...form, vigenteDesde: m })} />
          </Campo>
          <button className="botao botao--primario" disabled={ocupado || form.valorCentavos <= 0}>
            Gravar
          </button>
        </form>
        <h3 className="espaco-topo">Histórico de vigências</h3>
        <table className="tabela tabela--compacta">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Desde</th>
              <th className="num">Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...taxas]
              .sort((a, b) => b.quartos - a.quartos || b.vigenteDesde.localeCompare(a.vigenteDesde))
              .map((t) => (
                <tr key={t.id}>
                  <td>{t.quartos} quartos</td>
                  <td>{formatarMesCurto(t.vigenteDesde)}</td>
                  <td className="num">{formatarBRL(t.valorCentavos)}</td>
                  <td className="acoes-celula">
                    <button
                      type="button"
                      className="botao botao--link botao--pequeno"
                      onClick={async () => {
                        if (await confirmar({ titulo: 'Remover vigência', texto: 'Remover esta vigência? Só é possível se nenhuma cobrança a usou.', perigo: true }))
                          void executar(() => servicos.estrutura.removerTaxa(t.id), 'Vigência removida.')
                      }}
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="painel">
        <h2>Reemitir cobranças em aberto</h2>
        <p className="texto-suave">Recalcula as cobranças ainda em aberto de uma competência com a taxa vigente atual. Cobranças com valor alterado manualmente são puladas.</p>
        <div className="acoes">
          <SeletorCompetencia valor={competencia} onChange={setCompetencia} />
          <button
            type="button"
            className="botao"
            disabled={ocupado}
            onClick={async () => {
              const r = await executar(() => servicos.cobrancas.reemitirAbertas(competencia))
              if (r) toast.sucesso(`${r.atualizadas} cobrança(s) atualizada(s); ${r.puladas} pulada(s) por valor manual.`)
            }}
          >
            Reemitir abertas de {formatarMesCurto(competencia)}
          </button>
        </div>
      </div>
    </>
  )
}

// ---------------- Categorias ----------------
function AbaCategorias() {
  const { categorias } = useEstrutura()
  const { executar, ocupado } = useAcao()
  const confirmar = useConfirmacao()
  const [nome, setNome] = useState('')
  const [natureza, setNatureza] = useState<'RECEITA' | 'DESPESA'>('DESPESA')
  const [editando, setEditando] = useState<Categoria | null>(null)
  const [novoNome, setNovoNome] = useState('')
  function lista(n: Categoria['natureza']) {
    return categorias.filter((c) => c.natureza === n)
  }
  return (
    <>
      <div className="painel">
        <h2>Nova categoria</h2>
        <form
          className="linha-campos"
          style={{ alignItems: 'flex-end' }}
          onSubmit={async (e) => {
            e.preventDefault()
            const r = await executar(() => servicos.estrutura.criarCategoria({ nome, natureza }), 'Categoria criada.')
            if (r) setNome('')
          }}
        >
          <Campo rotulo="Nome">
            <input value={nome} onChange={(e) => setNome(e.target.value)} required />
          </Campo>
          <Campo rotulo="Tipo">
            <select value={natureza} onChange={(e) => setNatureza(e.target.value as 'RECEITA' | 'DESPESA')}>
              <option value="DESPESA">Despesa</option>
              <option value="RECEITA">Receita</option>
            </select>
          </Campo>
          <button className="botao botao--primario" disabled={ocupado}>
            Criar
          </button>
        </form>
      </div>
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        {(['RECEITA', 'DESPESA', 'TRANSFERENCIA'] as const).map((n) => (
          <div key={n} className="painel">
            <h2>{n === 'RECEITA' ? 'Receitas' : n === 'DESPESA' ? 'Despesas' : 'Transferências'}</h2>
            <table className="tabela tabela--compacta">
              <tbody>
                {lista(n).map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.nome} {c.sistema && <Badge tipo="info">sistema</Badge>} {!c.ativa && <Badge tipo="inativo">desativada</Badge>}
                    </td>
                    <td className="acoes-celula">
                      <button type="button" className="botao botao--link botao--pequeno" onClick={() => { setEditando(c); setNovoNome(c.nome) }}>
                        Renomear
                      </button>
                      {!c.sistema && (
                        <button type="button" className="botao botao--link botao--pequeno" onClick={() => void executar(() => servicos.estrutura.definirCategoriaAtiva(c.id, !c.ativa))}>
                          {c.ativa ? 'Desativar' : 'Reativar'}
                        </button>
                      )}
                      {!c.sistema && (
                        <button
                          type="button"
                          className="botao botao--link botao--pequeno"
                          onClick={async () => {
                            if (await confirmar({ titulo: 'Excluir categoria', texto: `Excluir "${c.nome}"?`, perigo: true, confirmarTexto: 'Excluir' }))
                              void executar(() => servicos.estrutura.excluirCategoria(c.id), 'Categoria excluída.')
                          }}
                        >
                          Excluir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {editando && (
        <Modal
          titulo="Renomear categoria"
          onFechar={() => setEditando(null)}
          rodape={
            <>
              <button type="button" className="botao" onClick={() => setEditando(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="botao botao--primario"
                disabled={ocupado}
                onClick={async () => {
                  const r = await executar(() => servicos.estrutura.atualizarCategoria(editando.id, { nome: novoNome, natureza: editando.natureza }), 'Categoria renomeada.')
                  if (r) setEditando(null)
                }}
              >
                Salvar
              </button>
            </>
          }
        >
          <Campo rotulo="Nome">
            <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} autoFocus />
          </Campo>
        </Modal>
      )}
    </>
  )
}
