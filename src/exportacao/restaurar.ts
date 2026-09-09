// Restauração de backup: valida ANTES de tocar no banco; tabelas em uma transação; blobs em lotes fora de transação (retomável).
import JSZip from 'jszip'
import { VERSAO_SCHEMA, type BancoSindico } from '../dados/db'
import { ErroDominio } from '../dominio/erros'
import type { Anexo } from '../dominio/tipos'
import { migrarBackup, validarBackup, type DadosBackup } from './schemaBackup'
import { LIMITE_BACKUP_ANEXOS, LIMITE_BACKUP_BYTES } from './backup'

const LOTE_BYTES = 50 * 1024 * 1024

export interface PreviaRestauracao {
  dados: DadosBackup
  tamanhoBytes: number
  anexosNoZip: number
  /** Anexos referenciados no dados.json cujo arquivo não está no ZIP (ex.: backup de um único ano). */
  faltantes: string[]
  omitidosPorAno: number
}

export async function lerBackup(arquivo: Blob): Promise<{ zip: JSZip; previa: PreviaRestauracao }> {
  if (arquivo.size > LIMITE_BACKUP_BYTES) throw new ErroDominio('BACKUP', 'O ZIP excede o limite de 1,5 GB por arquivo.')
  let zip: JSZip
  try {
    // No Node (testes) o jszip não lê Blob (sem FileReader): converter para ArrayBuffer. No navegador, lê o File diretamente.
    zip = await JSZip.loadAsync(typeof FileReader === 'undefined' ? await arquivo.arrayBuffer() : arquivo)
  } catch {
    throw new ErroDominio('BACKUP', 'O arquivo não é um ZIP válido.')
  }
  validarLimitesDoZip(zip)
  const entrada = zip.file('dados.json')
  if (!entrada) throw new ErroDominio('BACKUP', 'O ZIP não contém o arquivo dados.json deste sistema.')
  let json: unknown
  try {
    json = JSON.parse(await entrada.async('string'))
  } catch {
    throw new ErroDominio('BACKUP', 'O dados.json do backup está corrompido.')
  }
  const dados = migrarBackup(validarBackup(json), VERSAO_SCHEMA)
  validarLimitesDoZip(zip, dados)
  const faltantes = dados.tabelas.anexos.filter((a) => a.incluido !== false && !zip.file(a.arquivo)).map((a) => a.nome)
  const omitidosPorAno = dados.tabelas.anexos.filter(a => a.incluido === false).length
  const anexosNoZip = Object.keys(zip.files).filter((k) => k.startsWith('anexos/') && !zip.files[k]!.dir).length
  return { zip, previa: { dados, tamanhoBytes: arquivo.size, anexosNoZip, faltantes, omitidosPorAno } }
}

export interface ProgressoRestauracao {
  etapa: string
  feito: number
  total: number
}

/** Substitui TODOS os dados pelo backup. Se falhar na fase de anexos, `continuarRestauracao` completa o que faltou. */
export async function restaurarBackup(db: BancoSindico, zip: JSZip, dados: DadosBackup, agora: string, onProgresso?: (p: ProgressoRestauracao) => void): Promise<void> {
  dados = migrarBackup(validarBackup(dados), VERSAO_SCHEMA)
  validarLimitesDoZip(zip, dados)
  const t = dados.tabelas
  const anexos: Anexo[] = t.anexos.map(({ arquivo: _arquivo, incluido: _incluido, ...a }) => a)
  onProgresso?.({ etapa: 'Gravando registros', feito: 0, total: 1 })
  await db.transaction('rw', db.tables, async () => {
    for (const tabela of db.tables) await tabela.clear()
    await db.condominio.bulkAdd(t.condominio)
    await db.blocos.bulkAdd(t.blocos)
    await db.unidades.bulkAdd(t.unidades)
    await db.taxas.bulkAdd(t.taxas)
    await db.categorias.bulkAdd(t.categorias)
    await db.lancamentos.bulkAdd(t.lancamentos)
    await db.cobrancas.bulkAdd(t.cobrancas)
    await db.fechamentos.bulkAdd(t.fechamentos ?? [])
    await db.documentos.bulkAdd(t.documentos)
    await db.anexos.bulkAdd(anexos)
    await db.auditoria.bulkAdd(t.auditoria.map(({ seq: _seq, ...a }) => a))
    await db.meta.bulkAdd(t.meta.filter((m) => m.chave !== 'restauracaoEmAndamento' && m.chave !== 'schemaVersion'))
    await db.meta.put({ chave: 'schemaVersion', valor: VERSAO_SCHEMA })
    await db.meta.put({ chave: 'onboardingConcluido', valor: true })
    // A continuação pode ocorrer dias depois, após novas alterações do usuário.
    await db.meta.put({ chave: 'ultimoBackupEm', valor: dados.geradoEm })
    await db.meta.put({ chave: 'alteracoesDesdeBackup', valor: 0 })
    await db.meta.put({ chave: 'restauracaoEmAndamento', valor: { esperados: t.anexos.length, gravados: 0, geradoEm: dados.geradoEm, instalacaoId: dados.instalacaoId, anoDosAnexos: dados.anoDosAnexos } satisfies EstadoRestauracao })
  })
  await gravarBlobs(db, zip, dados, agora, onProgresso)
}

/** Grava (ou completa) os binários dos anexos a partir do ZIP, em lotes de ~50 MB, pulando os já gravados. */
export async function continuarRestauracao(db: BancoSindico, zip: JSZip, dados: DadosBackup, agora: string, onProgresso?: (p: ProgressoRestauracao) => void): Promise<void> {
  dados = migrarBackup(validarBackup(dados), VERSAO_SCHEMA)
  validarLimitesDoZip(zip, dados)
  const p = await restauracaoPendente(db)
  if (!p) throw new ErroDominio('BACKUP', 'Não existe restauração pendente.')
  const instalacao = p.instalacaoId ?? (await db.meta.get('instalacaoId'))?.valor
  const parcial = typeof p.anoDosAnexos === 'number'
  if (instalacao !== dados.instalacaoId || (!parcial && p.geradoEm !== dados.geradoEm)) {
    throw new ErroDominio('BACKUP', parcial ? 'Escolha um backup de anexos da mesma instalação do condomínio.' : `Escolha o mesmo arquivo da restauração iniciada (backup de ${p.geradoEm}).`)
  }
  await gravarBlobs(db, zip, dados, agora, onProgresso)
}

async function gravarBlobs(db: BancoSindico, zip: JSZip, dados: DadosBackup, agora: string, onProgresso?: (p: ProgressoRestauracao) => void): Promise<void> {
  const estado = await restauracaoPendente(db)
  if (!estado) throw new ErroDominio('BACKUP', 'Não existe restauração pendente.')
  const metadados = await db.anexos.toArray()
  const porId = new Map(metadados.map(a => [a.id, a]))
  const existentes = new Set(await db.anexosBlob.toCollection().primaryKeys())
  const pendentes = dados.tabelas.anexos.filter(a => porId.has(a.id) && !existentes.has(a.id) && a.incluido !== false && zip.file(a.arquivo))
  // Um arquivo anual antigo pode conter anexos já removidos: ignorá-los evita criar blobs órfãos.
  for (const a of pendentes) {
    const esperado = porId.get(a.id)!
    exigirMesmoAnexo(a, esperado)
  }
  const total = metadados.length
  let feito = metadados.filter(a => existentes.has(a.id)).length
  let lote: Array<{ id: string; blob: Blob }> = []
  let bytes = 0
  const descarregar = async () => {
    if (lote.length === 0) return
    await db.transaction('rw', db.anexos, db.anexosBlob, db.meta, async () => {
      await exigirMesmaRestauracao(db, estado)
      const ids = lote.map(a => a.id)
      const atuais = await db.anexos.bulkGet(ids)
      const jaGravados = new Set(await db.anexosBlob.where(':id').anyOf(ids).primaryKeys())
      const validos = lote.filter((a, i) => {
        const atual = atuais[i]
        if (!atual || jaGravados.has(a.id)) return false
        exigirMesmoAnexo(porId.get(a.id)!, atual)
        return true
      })
      await db.anexosBlob.bulkPut(validos)
      feito += validos.length
      await db.meta.put({ chave: 'restauracaoEmAndamento', valor: { ...estado, esperados: total, gravados: feito } })
    })
    onProgresso?.({ etapa: 'Gravando anexos', feito, total })
    lote = []
    bytes = 0
  }
  for (const a of pendentes) {
    // FORA de transação: jszip é assíncrono e encerraria uma transação Dexie aberta.
    let bruto: Uint8Array
    try {
      bruto = await zip.file(a.arquivo)!.async('uint8array')
    } catch {
      throw new ErroDominio('BACKUP', `Não foi possível ler o anexo "${a.nome}". A restauração pode ser retomada com o arquivo correto.`)
    }
    if (bruto.byteLength !== a.tamanho) throw new ErroDominio('BACKUP', `Tamanho incorreto do anexo "${a.nome}". A restauração pode ser retomada com o arquivo correto.`)
    const blob = new Blob([bruto as BlobPart], { type: a.mime })
    lote.push({ id: a.id, blob })
    bytes += blob.size
    if (bytes >= LOTE_BYTES || lote.length >= 200) await descarregar()
  }
  await descarregar()
  await db.transaction('rw', db.tables, async () => {
    await exigirMesmaRestauracao(db, estado)
    const metadadosAtuais = await db.anexos.toArray()
    const presentes = new Set(await db.anexosBlob.toCollection().primaryKeys())
    const totalAtual = metadadosAtuais.length
    feito = metadadosAtuais.filter(a => presentes.has(a.id)).length
    if (feito === totalAtual) {
      await db.meta.delete('restauracaoEmAndamento')
    } else await db.meta.put({ chave: 'restauracaoEmAndamento', valor: { ...estado, esperados: totalAtual, gravados: feito } })
    await db.auditoria.add({ em: agora, entidade: 'backup', entidadeId: dados.instalacaoId || 'backup', acao: feito === totalAtual ? 'restaurado' : 'restaurado_parcial', resumo: `Backup de ${estado.geradoEm}: ${feito}/${totalAtual} anexos restaurados` })
  })
}

function exigirMesmoAnexo(a: Anexo, esperado: Anexo): void {
  if (a.donoTipo !== esperado.donoTipo || a.donoId !== esperado.donoId || a.nome !== esperado.nome || a.tamanho !== esperado.tamanho || a.mime !== esperado.mime || a.criadoEm !== esperado.criadoEm) {
    throw new ErroDominio('BACKUP', `O anexo "${a.nome}" não corresponde aos metadados da restauração.`)
  }
}

async function exigirMesmaRestauracao(db: BancoSindico, estado: EstadoRestauracao): Promise<void> {
  const atual = await restauracaoPendente(db)
  if (!atual || atual.geradoEm !== estado.geradoEm || atual.instalacaoId !== estado.instalacaoId || atual.anoDosAnexos !== estado.anoDosAnexos) {
    throw new ErroDominio('BACKUP', 'A restauração pendente foi alterada durante a leitura dos anexos. Reabra a tela de backup para continuar.')
  }
}

function validarLimitesDoZip(zip: JSZip, dados?: DadosBackup): void {
  const arquivos = Object.values(zip.files).filter(a => !a.dir)
  const anexos = dados?.tabelas.anexos.filter(a => a.incluido !== false) ?? []
  if (arquivos.length > LIMITE_BACKUP_ANEXOS + 2 || anexos.length > LIMITE_BACKUP_ANEXOS || anexos.reduce((n, a) => n + a.tamanho, 0) > LIMITE_BACKUP_BYTES) {
    throw new ErroDominio('BACKUP', 'Este backup excede o limite de 1,5 GB ou 60.000 anexos por arquivo.')
  }
}

export interface EstadoRestauracao {
  esperados: number
  gravados: number
  geradoEm: string
  instalacaoId?: string
  anoDosAnexos?: number | null
}

export async function restauracaoPendente(db: BancoSindico): Promise<EstadoRestauracao | null> {
  const m = await db.meta.get('restauracaoEmAndamento')
  return (m?.valor as EstadoRestauracao | undefined) ?? null
}
