// Backup (ZIP com anexos), exportação JSON e restauração com prévia.
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import type JSZip from 'jszip'
import { consultas, db, relogioApp, servicos } from '../../dados/instancia'
import { formatarData } from '../../dominio/datas'
import { exportarDadosJson, gerarBackup } from '../../exportacao/backup'
import { baixarBlob, tamanhoLegivel } from '../../exportacao/download'
import { continuarRestauracao, lerBackup, restauracaoPendente, restaurarBackup, type PreviaRestauracao, type ProgressoRestauracao } from '../../exportacao/restaurar'
import { Campo } from '../componentes/campos'
import { Alerta, Modal } from '../componentes/comuns'
import { mensagemDeErro, useConfirmacao, useToast } from '../contexto/AppProviders'
import { useAcao, useLembreteBackup } from '../hooks'

function nomeDoNavegador(): string {
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return 'Microsoft Edge'
  if (/Chrome\//.test(ua)) return 'Google Chrome'
  if (/Firefox\//.test(ua)) return 'Firefox'
  return 'este navegador'
}

export async function baixarBackupCompleto(onProgresso?: (texto: string) => void): Promise<void> {
  const { blob, nome, dados } = await gerarBackup(db, { agora: relogioApp.agora(), onProgresso: (p) => onProgresso?.(`${p.etapa} ${p.percentual ? Math.round(p.percentual) + '%' : ''}`) })
  baixarBlob(blob, nome)
  await servicos.sistema.marcarBackupFeito({ instalacaoId: dados.instalacaoId, geradoEm: dados.geradoEm, ultimaAuditoria: dados.tabelas.auditoria.reduce((n, a) => Math.max(n, a.seq ?? 0), 0) })
}

export function Backup() {
  const lembrete = useLembreteBackup()
  const totalAnexos = useLiveQuery(() => consultas.anexos.total(), [])
  const anosAnexos = useLiveQuery(async () => [...new Set((await db.anexos.toArray()).map(a => a.criadoEm.slice(0, 4)))].sort(), [])
  const pendente = useLiveQuery(() => restauracaoPendente(db), [])
  const toast = useToast()
  const confirmar = useConfirmacao()
  const { executar, ocupado } = useAcao()
  const [progresso, setProgresso] = useState('')
  const [ano, setAno] = useState<string>('')
  const [previa, setPrevia] = useState<{ zip: JSZip; previa: PreviaRestauracao; arquivo: File } | null>(null)
  const [restaurando, setRestaurando] = useState<ProgressoRestauracao | null>(null)
  const inputRestaurar = useRef<HTMLInputElement>(null)
  const inputContinuar = useRef<HTMLInputElement>(null)
  const [uso, setUso] = useState<{ usage?: number; quota?: number } | null>(null)
  useEffect(() => {
    navigator.storage?.estimate?.().then(setUso).catch(() => setUso(null))
  }, [])
  const anos = anosAnexos ?? []

  async function gerar(anoDosAnexos: number | null) {
    await executar(async () => {
      const { blob, nome, dados } = await gerarBackup(db, { agora: relogioApp.agora(), anoDosAnexos, onProgresso: (p) => setProgresso(`${p.etapa}${p.percentual ? ` ${Math.round(p.percentual)}%` : ''}`) })
      baixarBlob(blob, nome)
      if (anoDosAnexos === null) await servicos.sistema.marcarBackupFeito({ instalacaoId: dados.instalacaoId, geradoEm: dados.geradoEm, ultimaAuditoria: dados.tabelas.auditoria.reduce((n, a) => Math.max(n, a.seq ?? 0), 0) })
      setProgresso(`Arquivo ${nome} gerado (${tamanhoLegivel(blob.size)}).`)
    }, 'Backup gerado. Guarde o arquivo em um pendrive ou na nuvem.')
  }

  async function escolherArquivo(arquivo: File | undefined) {
    if (!arquivo) return
    await executar(async () => {
      setProgresso('Lendo e validando arquivo de backup…')
      const r = await lerBackup(arquivo)
      setPrevia({ ...r, arquivo })
      setProgresso('Arquivo validado. Confira a prévia antes de restaurar.')
    })
  }

  async function restaurar() {
    if (!previa) return
    await executar(async () => {
    const ok = await confirmar({
      titulo: 'Substituir TODOS os dados atuais?',
      texto: 'Os dados deste navegador serão apagados e substituídos pelo backup. Se tiver dúvida, gere um backup dos dados atuais antes.',
      perigo: true,
      exigirTexto: 'RESTAURAR',
      confirmarTexto: 'Restaurar',
    })
    if (!ok) return
    const selecionado = previa
    setPrevia(null)
    try {
      setRestaurando({ etapa: 'Iniciando', feito: 0, total: 1 })
      await restaurarBackup(db, selecionado.zip, selecionado.previa.dados, relogioApp.agora(), setRestaurando)
      const restante = await restauracaoPendente(db)
      if (restante) { setRestaurando(null); toast.aviso(`Dados restaurados. Faltam ${restante.esperados - restante.gravados} anexos; use Continuar restauração.`); return }
      toast.sucesso('Backup restaurado. Recarregando...')
      window.setTimeout(() => location.reload(), 800)
    } catch (e) {
      setRestaurando(null)
      const pendencia = await restauracaoPendente(db)
      toast.erro(`Falha na restauração: ${mensagemDeErro(e)}. ${pendencia ? 'Use Continuar restauração com o mesmo arquivo.' : 'Nada foi alterado; os dados atuais continuam válidos.'}`)
    }
    })
  }

  async function continuar(arquivo: File | undefined) {
    if (!arquivo) return
    await executar(async () => {
    try {
      setRestaurando({ etapa: 'Lendo e validando arquivo', feito: 0, total: 1 })
      const { zip, previa: p } = await lerBackup(arquivo)
      setRestaurando({ etapa: 'Continuando', feito: 0, total: 1 })
      await continuarRestauracao(db, zip, p.dados, relogioApp.agora(), setRestaurando)
      const restante = await restauracaoPendente(db)
      if (restante) { setRestaurando(null); toast.aviso(`Ainda faltam ${restante.esperados - restante.gravados} anexos. Escolha os arquivos dos demais anos.`); return }
      toast.sucesso('Restauração concluída. Recarregando...')
      window.setTimeout(() => location.reload(), 800)
    } catch (e) {
      setRestaurando(null)
      toast.deErro(e)
    }
    })
  }

  return (
    <>
      <div className="cabecalho-pagina">
        <h1>Backup</h1>
      </div>
      <Alerta tipo="info">
        Os dados ficam guardados <strong>neste navegador ({nomeDoNavegador()})</strong> e neste usuário do Windows. Use sempre o mesmo navegador e faça backups regularmente; o arquivo ZIP restaura tudo em qualquer computador.
      </Alerta>
      {pendente && (
        <Alerta
          tipo="aviso"
          acao={
            <>
              <input ref={inputContinuar} type="file" accept=".zip" style={{ display: 'none' }} onChange={(e) => { const arquivo = e.target.files?.[0]; e.target.value = ''; void continuar(arquivo) }} />
              <button type="button" className="botao botao--primario" disabled={ocupado || !!restaurando} onClick={() => inputContinuar.current?.click()}>
                Continuar restauração
              </button>
            </>
          }
        >
          Restauração com anexos pendentes: {pendente.gravados} de {pendente.esperados} anexos gravados (backup de {pendente.geradoEm.slice(0, 10)}). {typeof pendente.anoDosAnexos === 'number' ? 'Escolha backups dos demais anos da mesma instalação para completar os arquivos faltantes.' : 'Escolha o mesmo arquivo para completar.'}
        </Alerta>
      )}
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
        <div className="painel">
          <h2>Gerar backup</h2>
          <p>
            Último backup: <strong>{lembrete.ultimoBackupEm ? formatarData(lembrete.ultimoBackupEm.slice(0, 10)) : 'nunca'}</strong> · {lembrete.alteracoes} alteração(ões) desde então.
          </p>
          <p className="texto-suave texto-pequeno">
            Anexos guardados: {totalAnexos ? `${totalAnexos.quantidade} arquivo(s), ${tamanhoLegivel(totalAnexos.bytes)}` : '—'}
            {uso?.usage !== undefined && uso.quota ? ` · navegador: ${tamanhoLegivel(uso.usage)} de ${tamanhoLegivel(uso.quota)}` : ''}
          </p>
          <div className="acoes">
            <button type="button" className="botao botao--primario" disabled={ocupado} onClick={() => void gerar(null)}>
              Gerar backup completo (.zip)
            </button>
            <button type="button" className="botao" disabled={ocupado} onClick={() => void executar(async () => { const { blob, nome } = await exportarDadosJson(db, relogioApp.agora()); baixarBlob(blob, nome) })}>
              Exportar dados sem anexos (.json)
            </button>
          </div>
          {anos.length > 0 && (
            <div className="linha-campos espaco-topo" style={{ alignItems: 'flex-end' }}>
              <Campo rotulo="Backup só dos anexos de um ano (dados sempre completos)" ajuda="Útil quando o arquivo completo fica muito grande.">
                <select value={ano} onChange={(e) => setAno(e.target.value)}>
                  <option value="">Escolha o ano…</option>
                  {anos.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </Campo>
              <button type="button" className="botao" disabled={ocupado || !ano} onClick={() => void gerar(Number(ano))}>
                Gerar backup de {ano || 'ano'}
              </button>
            </div>
          )}
          {progresso && <p className="texto-suave texto-pequeno espaco-topo">{progresso}</p>}
        </div>
        <div className="painel">
          <h2>Restaurar backup</h2>
          <p>Substitui todos os dados deste navegador pelos do arquivo. Use para trocar de computador/navegador ou voltar a um estado anterior.</p>
          <input ref={inputRestaurar} type="file" accept=".zip" style={{ display: 'none' }} onChange={(e) => { const arquivo = e.target.files?.[0]; e.target.value = ''; void escolherArquivo(arquivo) }} />
          <div className="acoes">
            <button type="button" className="botao" onClick={() => inputRestaurar.current?.click()} disabled={ocupado || !!restaurando}>
              Escolher arquivo de backup…
            </button>
          </div>
          {restaurando && (
            <p className="espaco-topo">
              {restaurando.etapa}… {restaurando.total > 1 ? `${restaurando.feito}/${restaurando.total}` : ''}
            </p>
          )}
        </div>
      </div>
      {restaurando && <Modal titulo="Restaurando backup" onFechar={() => undefined} fechavel={false}><p role="status">{restaurando.etapa}… {restaurando.feito}/{restaurando.total}</p><p>Aguarde a conclusão sem fechar esta janela.</p></Modal>}
      {previa && (
        <Modal
          titulo="Restaurar este backup?"
          onFechar={() => setPrevia(null)}
          fechavel={!ocupado}
          rodape={
            <>
              <button type="button" className="botao" disabled={ocupado} onClick={() => setPrevia(null)}>
                Cancelar
              </button>
              <button type="button" className="botao" onClick={() => void gerar(null)} disabled={ocupado}>
                Baixar backup atual antes
              </button>
              <button type="button" className="botao botao--perigo" onClick={() => void restaurar()} disabled={ocupado || !!restaurando}>
                Restaurar (substituir tudo)
              </button>
            </>
          }
        >
          <table className="tabela tabela--compacta">
            <tbody>
              <tr>
                <th>Condomínio</th>
                <td>{previa.previa.dados.condominio.nome}</td>
              </tr>
              <tr>
                <th>Gerado em</th>
                <td>
                  {previa.previa.dados.geradoEm.replace('T', ' ')} · versão {previa.previa.dados.appVersao}
                </td>
              </tr>
              <tr>
                <th>Navegador de origem</th>
                <td className="texto-pequeno">{previa.previa.dados.navegador}</td>
              </tr>
              <tr>
                <th>Conteúdo</th>
                <td>
                  {previa.previa.dados.contagens['blocos'] ?? 0} blocos · {previa.previa.dados.contagens['unidades'] ?? 0} apartamentos · {previa.previa.dados.contagens['lancamentos'] ?? 0} lançamentos · {previa.previa.dados.contagens['cobrancas'] ?? 0} cobranças · {previa.previa.dados.contagens['documentos'] ?? 0} documentos · {previa.previa.anexosNoZip} anexos
                </td>
              </tr>
              <tr>
                <th>Tamanho</th>
                <td>{tamanhoLegivel(previa.previa.tamanhoBytes)}</td>
              </tr>
            </tbody>
          </table>
          {previa.previa.dados.anoDosAnexos && <div className="alerta alerta--aviso">Este backup contém só os anexos de {previa.previa.dados.anoDosAnexos}. Os demais anexos precisarão ser restaurados de outro arquivo com "Continuar restauração".</div>}
          {previa.previa.omitidosPorAno > 0 && <p>{previa.previa.omitidosPorAno} anexo(s) de outros anos serão mantidos como pendentes até serem completados.</p>}
          {previa.previa.faltantes.length > 0 && <div className="alerta alerta--aviso">{previa.previa.faltantes.length} anexo(s) que deveriam estar neste arquivo estão ausentes.</div>}
        </Modal>
      )}
    </>
  )
}
