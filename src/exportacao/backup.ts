// Backup em ZIP: dados.json (DEFLATE) + anexos/<id>.<ext> (STORE) + LEIA-ME.txt.
// A saída é acumulada em partes. O JSZip mantém os anexos em memória durante a geração.
import JSZip from 'jszip'
import { VERSAO_APP, VERSAO_SCHEMA, type BancoSindico } from '../dados/db'
import type { Anexo } from '../dominio/tipos'
import { ErroDominio } from '../dominio/erros'
import { nomeSeguro } from './download'
import { FORMATO_BACKUP, VERSAO_FORMATO, type AnexoNoBackup, type DadosBackup, type TabelasBackup } from './schemaBackup'

const TAMANHO_PARTE = 64 * 1024 * 1024
export const LIMITE_BACKUP_BYTES = 1536 * 1024 * 1024
export const LIMITE_BACKUP_ANEXOS = 60000

export interface OpcoesBackup {
  /** Só os anexos deste ano (por criadoEm); dados sempre completos. */
  anoDosAnexos?: number | null
  agora: string
  navegador?: string
  onProgresso?: (p: { etapa: string; percentual: number }) => void
}

const EXT_POR_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'text/plain': 'txt',
}

export function extensaoDe(nome: string, mime: string): string {
  const m = /\.([a-z0-9]{1,6})$/i.exec(nome)
  if (m) return m[1]!.toLowerCase()
  return EXT_POR_MIME[mime] ?? 'bin'
}

export function caminhoDoAnexo(a: Anexo): string {
  return `anexos/${a.id}.${extensaoDe(a.nome, a.mime)}`
}

export async function lerTabelas(db: BancoSindico): Promise<Omit<TabelasBackup, 'anexos'> & { anexos: Anexo[] }> {
  return db.transaction('r', db.tables, async () => ({
    condominio: await db.condominio.toArray(),
    blocos: await db.blocos.toArray(),
    unidades: await db.unidades.toArray(),
    taxas: await db.taxas.toArray(),
    categorias: await db.categorias.toArray(),
    lancamentos: await db.lancamentos.toArray(),
    cobrancas: await db.cobrancas.toArray(),
    fechamentos: await db.fechamentos.toArray(),
    auditoria: await db.auditoria.toArray(),
    meta: await db.meta.toArray(),
    documentos: await db.documentos.toArray(),
    anexos: await db.anexos.toArray(),
  }))
}

/** Monta o dados.json (sem os binários). */
export async function montarDadosBackup(db: BancoSindico, opcoes: OpcoesBackup): Promise<DadosBackup> {
  const t = await lerTabelas(db)
  const ano = opcoes.anoDosAnexos ?? null
  const anexos: AnexoNoBackup[] = t.anexos.map((a) => ({ ...a, arquivo: caminhoDoAnexo(a), incluido: ano === null || a.criadoEm.startsWith(`${ano}-`) }))
  const instalacao = t.meta.find((m) => m.chave === 'instalacaoId')?.valor
  const contagens: Record<string, number> = {}
  for (const [nome, lista] of Object.entries({ ...t, anexos })) contagens[nome] = (lista as unknown[]).length
  return {
    formato: FORMATO_BACKUP,
    versaoFormato: VERSAO_FORMATO,
    schemaVersion: VERSAO_SCHEMA,
    appVersao: VERSAO_APP,
    geradoEm: opcoes.agora,
    instalacaoId: typeof instalacao === 'string' ? instalacao : '',
    navegador: opcoes.navegador ?? (typeof navigator !== 'undefined' ? navigator.userAgent : 'node'),
    condominio: { nome: t.condominio[0]?.nome ?? '' },
    anoDosAnexos: ano,
    contagens,
    tabelas: { ...t, anexos },
  }
}

function leiaMe(d: DadosBackup): string {
  return [
    `Backup do sistema de contabilidade do condomínio "${d.condominio.nome}"`,
    `Gerado em ${d.geradoEm} (versão ${d.appVersao}, schema ${d.schemaVersion})`,
    d.anoDosAnexos ? `Contém os dados completos e apenas os anexos de ${d.anoDosAnexos}.` : 'Contém os dados completos e todos os anexos.',
    '',
    'Para restaurar: abra o sistema (Contabilidade-Condominio.html), menu Backup > Restaurar, e escolha este arquivo.',
    'A pasta anexos/ contém os comprovantes e documentos; podem ser abertos diretamente.',
    'O arquivo dados.json contém todos os registros em formato JSON.',
  ].join('\r\n')
}

/** Gera o ZIP como Blob, acumulando a saída em partes internas de 64 MB. */
export async function gerarBackup(db: BancoSindico, opcoes: OpcoesBackup): Promise<{ blob: Blob; nome: string; dados: DadosBackup }> {
  const progresso = opcoes.onProgresso ?? (() => undefined)
  progresso({ etapa: 'Lendo dados', percentual: 0 })
  const dados = await montarDadosBackup(db, opcoes)
  const json = JSON.stringify(dados)
  const zip = new JSZip()
  const anexos = dados.tabelas.anexos.filter(a => a.incluido !== false)
  if (anexos.length > LIMITE_BACKUP_ANEXOS || anexos.reduce((n, a) => n + a.tamanho, 0) + json.length * 3 > LIMITE_BACKUP_BYTES) {
    throw new ErroDominio('BACKUP', 'Este backup excede o limite de 1,5 GB ou 60.000 anexos por arquivo. Gere backups por ano e guarde todos os arquivos.')
  }
  zip.file('dados.json', json, { compression: 'DEFLATE' })
  zip.file('LEIA-ME.txt', leiaMe(dados))
  for (let i = 0; i < anexos.length; i++) {
    const a = anexos[i]!
    const b = await db.anexosBlob.get(a.id)
    if (b) {
      if (b.blob.size !== a.tamanho) throw new ErroDominio('BACKUP', `O anexo "${a.nome}" tem tamanho diferente do registro. Verifique o arquivo antes de gerar o backup.`)
      // JSZip carrega cada Blob inteiro; a verificação de tamanho acima limita o uso de memória.
      const dado: Blob | ArrayBuffer = typeof FileReader === 'undefined' ? await b.blob.arrayBuffer() : b.blob
      zip.file(a.arquivo, dado, { compression: 'STORE' })
    } else throw new ErroDominio('BACKUP', `O anexo "${a.nome}" está sem arquivo. Complete a restauração antes de gerar um backup que inclua esse anexo.`)
    if (i % 20 === 0) progresso({ etapa: `Adicionando anexos (${i + 1}/${anexos.length})`, percentual: 0 })
  }
  const partes: Blob[] = []
  await new Promise<void>((resolver, rejeitar) => {
    let pedacos: Uint8Array[] = []
    let bytes = 0
    const st = zip.generateInternalStream({ type: 'uint8array', streamFiles: true })
    st.on('data', (chunk, meta) => {
      pedacos.push(chunk)
      bytes += chunk.length
      if (bytes >= TAMANHO_PARTE) {
        partes.push(new Blob(pedacos as BlobPart[]))
        pedacos = []
        bytes = 0
      }
      progresso({ etapa: 'Compactando', percentual: meta.percent })
    })
    st.on('end', () => {
      if (pedacos.length) partes.push(new Blob(pedacos as BlobPart[]))
      resolver()
    })
    st.on('error', rejeitar)
    st.resume()
  })
  const blob = new Blob(partes, { type: 'application/zip' })
  const sufixo = dados.anoDosAnexos ? `-anexos-${dados.anoDosAnexos}` : ''
  const nome = `backup-${nomeSeguro(dados.condominio.nome || 'condominio')}-${dados.geradoEm.slice(0, 10)}${sufixo}.zip`
  progresso({ etapa: 'Concluído', percentual: 100 })
  return { blob, nome, dados }
}

/** Só o dados.json (sem anexos), para inspeção ou migração. */
export async function exportarDadosJson(db: BancoSindico, agora: string): Promise<{ blob: Blob; nome: string }> {
  const dados = await montarDadosBackup(db, { agora })
  return { blob: new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }), nome: `dados-${nomeSeguro(dados.condominio.nome || 'condominio')}-${agora.slice(0, 10)}.json` }
}
