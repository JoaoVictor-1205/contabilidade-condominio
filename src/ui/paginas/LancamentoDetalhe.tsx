// Detalhe de um lançamento: dados, rateio gravado, anexos, histórico e ações.
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { consultas, relogioApp, servicos } from '../../dados/instancia'
import { formatarData, formatarMes } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import { montarRateioGeral } from '../../dominio/rateio'
import type { Id } from '../../dominio/tipos'
import { Dropzone, ListaAnexos } from '../componentes/anexos'
import { Alerta, Badge, Carregando, Modal, Valor } from '../componentes/comuns'
import { Campo, CampoData } from '../componentes/campos'
import { BotaoImprimir, CabecalhoImpressao } from '../componentes/impressao'
import { MotivoDialogo } from '../componentes/MotivoDialogo'
import { useConfirmacao, useToast } from '../contexto/AppProviders'
import { useAcao, useEstrutura } from '../hooks'
import { navegar, paraHash } from '../rotas'
import { porId, ROTULO_FORMA, ROTULO_NATUREZA, rotuloEscopo, valorComSinal } from '../rotulos'
import { LancamentoForm } from './LancamentoForm'

export function LancamentoDetalhe({ id }: { id: Id }) {
  const l = useLiveQuery(async () => (await consultas.lancamentos.obter(id)) ?? null, [id])
  const fechamento = useLiveQuery(async () => (await consultas.fechamentos.ultimo()) ?? null, [])
  const auditoria = useLiveQuery(() => consultas.auditoria.de(id), [id])
  const cobranca = useLiveQuery(() => (l?.cobrancaId ? consultas.cobrancas.obter(l.cobrancaId) : undefined), [l?.cobrancaId])
  const { blocos, unidades, categorias } = useEstrutura()
  const { executar, ocupado } = useAcao()
  const toast = useToast()
  const confirmar = useConfirmacao()
  const [editando, setEditando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [desfazendo, setDesfazendo] = useState(false)
  const [estornando, setEstornando] = useState(false)
  const [dataEstorno, setDataEstorno] = useState(relogioApp.hoje())
  const [motivoEstorno, setMotivoEstorno] = useState('')
  const [observacoes, setObservacoes] = useState('')
  if (l === undefined || fechamento === undefined) return <Carregando />
  if (!l) return <p className="texto-suave">Lançamento não encontrado.</p>
  const blocosPorId = porId(blocos)
  const unidadesPorId = porId(unidades)
  const categoria = categorias.find((c) => c.id === l.categoriaId)
  const deTaxa = !!l.cobrancaId && categoria?.sistema === 'TAXA'
  const ativo = l.status === 'ATIVO'
  const fechado = !!fechamento && l.mes <= fechamento.mes
  const normal = l.tipo === 'NORMAL' && !l.estornadoPorId
  return (
    <>
      <CabecalhoImpressao titulo="Recibo / comprovante de lançamento" />
      <div className="cabecalho-pagina">
        <h1>
          {ROTULO_NATUREZA[l.natureza]} · {formatarBRL(l.valorCentavos)} {l.status === 'EXCLUIDO' && <Badge tipo="excluido">Excluído</Badge>}
          {l.tipo === 'ESTORNO' && <Badge tipo="aviso">Estorno</Badge>}
        </h1>
        <div className="acoes">
          {ativo && !fechado && (!deTaxa || !normal) && (l.natureza !== 'TRANSFERENCIA' || !normal) && (
            <button type="button" className="botao" disabled={ocupado} onClick={() => { setObservacoes(l.observacoes ?? ''); setEditando(true) }}>
              {normal ? 'Editar' : 'Editar observações'}
            </button>
          )}
          {ativo && deTaxa && normal && (
            <>
              <button type="button" className="botao" onClick={() => setDesfazendo(true)}>
                Desfazer pagamento
              </button>
              <a className="botao" href={paraHash({ nome: 'cobrancas', competencia: cobranca?.competencia })}>
                Corrigir em Cobranças
              </a>
            </>
          )}
          {ativo && !fechado && normal && l.escopoTipo === 'GERAL' && (
            <button
              type="button"
              className="botao"
              onClick={async () => {
                const novo = await executar(async () => montarRateioGeral(l.valorCentavos, blocos, unidades, ''))
                if (!novo) return
                const ids = [...new Set([...(l.rateio?.cotas.map(c => c.blocoId) ?? []), ...novo.cotas.map(c => c.blocoId)])]
                if (await confirmar({ titulo: 'Recalcular rateio', texto: <><p>O relatório histórico deste lançamento mudará.</p><table className="tabela tabela--compacta"><thead><tr><th>Bloco</th><th>Cota atual</th><th>Nova cota</th></tr></thead><tbody>{ids.map(id => <tr key={id}><td>{blocosPorId.get(id)?.nome}</td><td>{formatarBRL(l.rateio?.cotas.find(c => c.blocoId === id)?.valorCentavos ?? 0)}</td><td>{formatarBRL(novo.cotas.find(c => c.blocoId === id)?.valorCentavos ?? 0)}</td></tr>)}</tbody></table></> }))
                  void executar(() => servicos.lancamentos.recalcularRateio(l.id), 'Rateio recalculado.')
              }}
            >
              Recalcular rateio
            </button>
          )}
          {ativo && !fechado && !deTaxa && !l.estornadoPorId && !(l.tipo === 'ESTORNO' && l.cobrancaId) && (
            <button type="button" className="botao botao--perigo" onClick={() => setExcluindo(true)}>
              Excluir
            </button>
          )}
          {ativo && normal && !l.cobrancaId && <button type="button" className="botao" disabled={ocupado} onClick={() => setEstornando(true)}>Estornar</button>}
          <BotaoImprimir rotulo="Imprimir recibo" />
          <a className="botao botao--link" href={paraHash({ nome: 'lancamentos' })}>
            Voltar
          </a>
        </div>
      </div>
      {ativo && fechado && <Alerta tipo="info">Mês fechado: {normal ? <>use {l.cobrancaId ? 'Desfazer pagamento em Cobranças' : 'Estornar'} para corrigir em um mês aberto.</> : 'este registro faz parte de um estorno. Consulte os lançamentos vinculados abaixo; para revisar o mês, use Avançado › Fechamento.'}</Alerta>}
      {l.estornaLancamentoId && <p>Estorna o lançamento <a href={paraHash({ nome: 'lancamento', id: l.estornaLancamentoId })}>{l.estornaLancamentoId}</a>.</p>}
      {l.estornadoPorId && <p>Estornado por <a href={paraHash({ nome: 'lancamento', id: l.estornadoPorId })}>{l.estornadoPorId}</a>.</p>}
      {l.status === 'EXCLUIDO' && (
        <div className="alerta alerta--aviso">
          Excluído em {l.excluidoEm ? formatarData(l.excluidoEm.slice(0, 10)) : '—'}: {l.motivoExclusao}
        </div>
      )}
      <div className="cards" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="painel">
          <h2>Dados</h2>
          <table className="tabela tabela--compacta">
            <tbody>
              <tr>
                <th>Descrição</th>
                <td>{l.descricao}</td>
              </tr>
              <tr>
                <th>Valor</th>
                <td>
                  <Valor centavos={l.natureza === 'TRANSFERENCIA' ? l.valorCentavos : valorComSinal(l)} neutro={l.natureza === 'TRANSFERENCIA'} />
                </td>
              </tr>
              <tr>
                <th>Data</th>
                <td>{formatarData(l.data)}</td>
              </tr>
              <tr>
                <th>Competência</th>
                <td>{formatarMes(l.competencia)}</td>
              </tr>
              <tr>
                <th>Categoria</th>
                <td>{categoria?.nome ?? '—'}</td>
              </tr>
              <tr>
                <th>Escopo</th>
                <td>{rotuloEscopo(l, blocosPorId, unidadesPorId)}</td>
              </tr>
              <tr>
                <th>Forma</th>
                <td>{l.formaPagamento ? ROTULO_FORMA[l.formaPagamento] : '—'}</td>
              </tr>
              {l.observacoes && (
                <tr>
                  <th>Observações</th>
                  <td>{l.observacoes}</td>
                </tr>
              )}
              {cobranca && (
                <tr>
                  <th>Cobrança</th>
                  <td>
                    <a href={paraHash({ nome: 'cobrancas', competencia: cobranca.competencia })}>Taxa {formatarMes(cobranca.competencia)}</a> — cobrado {formatarBRL(cobranca.valorCentavos)}
                  </td>
                </tr>
              )}
              <tr>
                <th>Registrado</th>
                <td className="texto-suave texto-pequeno">
                  {l.criadoEm.replace('T', ' ')} · versão {l.versao}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="painel">
          <h2>Comprovantes</h2>
          <ListaAnexos donoTipo="LANCAMENTO" donoId={l.id} permitirRemover={ativo && !fechado && !l.cobrancaId} />
          {ativo && (
            <div className="nao-imprimir espaco-topo">
              <Dropzone accept="application/pdf,image/*" reduzirFotos texto="Adicionar comprovante" onArquivos={(a) => void executar(() => servicos.anexos.adicionar('LANCAMENTO', l.id, a), 'Anexo adicionado.')} />
            </div>
          )}
        </div>
      </div>
      {l.rateio && (
        <div className="painel">
          <h2>Rateio entre os blocos (gravado em {formatarData(l.rateio.calculadoEm.slice(0, 10))})</h2>
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th>Bloco</th>
                <th className="num">Aptos</th>
                <th className="num">Cota</th>
              </tr>
            </thead>
            <tbody>
              {l.rateio.cotas.map((c) => (
                <tr key={c.blocoId}>
                  <td>{blocosPorId.get(c.blocoId)?.nome ?? c.nomeBloco}</td>
                  <td className="num">
                    {c.unidadesAtivas}/{l.rateio!.totalUnidades}
                  </td>
                  <td className="num">{formatarBRL(c.valorCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {auditoria && auditoria.length > 0 && (
        <div className="painel nao-imprimir">
          <h2>Histórico</h2>
          <ul className="texto-pequeno">
            {auditoria.map((a) => (
              <li key={a.seq}>
                {a.em.replace('T', ' ')} — {a.acao}: {a.resumo}
                {a.motivo ? ` (motivo: ${a.motivo})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {editando && (
        <Modal titulo="Editar lançamento" onFechar={() => setEditando(false)} largo>
          {normal ? <LancamentoForm id={l.id} embutido onSalvo={() => setEditando(false)} /> : <>
            <Campo rotulo="Observações"><textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} maxLength={2000} /></Campo>
            <button className="botao botao--primario" disabled={ocupado} onClick={async () => { const r = await executar(() => servicos.lancamentos.atualizar(l.id, { observacoes }), 'Observações alteradas.'); if (r) setEditando(false) }}>Salvar observações</button>
          </>}
        </Modal>
      )}
      {excluindo && (
        <MotivoDialogo
          titulo="Excluir lançamento"
          texto="O lançamento sai dos relatórios, mas fica registrado como excluído (com o motivo)."
          rotuloConfirmar="Excluir"
          perigo
          onFechar={() => setExcluindo(false)}
          onConfirmar={async (motivo) => {
            const r = await executar(async () => { await servicos.lancamentos.excluir(l.id, motivo); return true }, 'Lançamento excluído.')
            if (r !== undefined) {
              setExcluindo(false)
              navegar({ nome: 'lancamentos' })
            }
          }}
        />
      )}
      {desfazendo && l.cobrancaId && (
        <MotivoDialogo
          titulo="Desfazer pagamento"
          texto={fechado ? 'A cobrança volta a ficar em aberto e serão gerados estornos de taxa e juros no mês aberto.' : 'A cobrança volta a ficar em aberto e este lançamento (e os juros, se houver) são excluídos.'}
          rotuloConfirmar="Desfazer"
          perigo
          onFechar={() => setDesfazendo(false)}
          onConfirmar={async (motivo) => {
            const r = await executar(() => servicos.cobrancas.desfazerPagamento(l.cobrancaId!, motivo))
            if (r) { toast.sucesso(r.estornoGerado ? 'Pagamento estornado no mês aberto; cobrança reaberta.' : 'Pagamento desfeito.'); setDesfazendo(false) }
          }}
        />
      )}
      {estornando && <Modal titulo="Estornar lançamento" onFechar={() => setEstornando(false)} fechavel={!ocupado} rodape={<button className="botao botao--primario" disabled={ocupado || !motivoEstorno.trim()} onClick={async () => {
        const r = await executar(() => servicos.lancamentos.estornar(l.id, dataEstorno, motivoEstorno), 'Estorno registrado.')
        if (r) { setEstornando(false); navegar({ nome: 'lancamento', id: r.id }) }
      }}>Registrar estorno</button>}>
        <p>O lançamento original será preservado e seu valor será revertido na data abaixo, mantendo a competência e a divisão original.</p>
        <Campo rotulo="Data do estorno"><CampoData valor={dataEstorno} min={l.data} onChange={setDataEstorno} /></Campo>
        <Campo rotulo="Motivo do estorno"><textarea value={motivoEstorno} onChange={e => setMotivoEstorno(e.target.value)} maxLength={2000} /></Campo>
      </Modal>}
    </>
  )
}
