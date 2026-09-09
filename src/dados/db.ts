// Banco IndexedDB via Dexie. Única camada que conhece o IndexedDB.
// REGRA DE OURO: dentro de db.transaction(...) só se aguardam operações do Dexie. Nada de jszip, FileReader,
// fetch ou setTimeout dentro da transação (ela seria encerrada e a escrita seguinte falharia).
import Dexie, { type Table } from 'dexie'
import type {
  Anexo,
  AnexoBlob,
  Auditoria,
  Bloco,
  Categoria,
  Cobranca,
  Condominio,
  Documento,
  Fechamento,
  Id,
  Lancamento,
  Meta,
  TaxaVigencia,
  Unidade,
} from '../dominio/tipos'
import { aplicarSeedInicial } from './seed'
import { relogio } from './relogio'

/** Nome fixo: a origem file:// é compartilhada por todos os HTML locais, então o nome precisa ser específico. */
export const NOME_BANCO = 'SindicoContabil.TrabalhoVivencias.v1'
/** Versão do schema Dexie (v2: fechamentos, estornos). Nunca editar versões antigas; adicionar `version(n+1)`. */
export const VERSAO_SCHEMA = 2
export const VERSAO_APP = '2.0.0'

const STORES_V1 = {
  condominio: 'id',
  blocos: 'id, ordem',
  unidades: 'id, blocoId, &[blocoId+numero]',
  taxas: 'id, quartos, &[quartos+vigenteDesde]',
  categorias: 'id, natureza, ordem',
  lancamentos:
    'id, data, mes, competencia, status, natureza, escopoTipo, blocoId, unidadeId, blocoOrigemId, categoriaId, cobrancaId, [status+data], [status+competencia], [blocoId+data], [unidadeId+data]',
  anexos: 'id, [donoTipo+donoId]',
  anexosBlob: 'id',
  documentos: 'id, categoria, data',
  cobrancas:
    'id, &[unidadeId+competencia], competencia, blocoId, unidadeId, status, vencimento, [competencia+status], [blocoId+competencia], [status+vencimento]',
  auditoria: '++seq, entidade, entidadeId, em',
  meta: 'chave',
}

export class BancoSindico extends Dexie {
  condominio!: Table<Condominio, string>
  blocos!: Table<Bloco, Id>
  unidades!: Table<Unidade, Id>
  taxas!: Table<TaxaVigencia, Id>
  categorias!: Table<Categoria, Id>
  lancamentos!: Table<Lancamento, Id>
  anexos!: Table<Anexo, Id>
  anexosBlob!: Table<AnexoBlob, Id>
  documentos!: Table<Documento, Id>
  cobrancas!: Table<Cobranca, Id>
  fechamentos!: Table<Fechamento, string>
  auditoria!: Table<Auditoria, number>
  meta!: Table<Meta, string>

  constructor(nome: string = NOME_BANCO) {
    super(nome)
    // Booleanos nunca são indexados (não são chave válida no IndexedDB): filtrar em memória.
    this.version(1).stores(STORES_V1)
    // v2: tabela de fechamentos; lançamentos ganham tipo (NORMAL/ESTORNO) e vínculos de estorno.
    this.version(2)
      .stores({
        ...STORES_V1,
        lancamentos: STORES_V1.lancamentos + ', tipo, estornaLancamentoId',
        fechamentos: 'mes',
      })
      .upgrade(async (tx) => {
        await tx
          .table('lancamentos')
          .toCollection()
          .modify((l: Partial<Lancamento>) => {
            l.tipo ??= 'NORMAL'
            l.estornaLancamentoId ??= null
            l.estornadoPorId ??= null
          })
        await tx.table('meta').put({ chave: 'schemaVersion', valor: 2 })
      })
    this.on('populate', () => aplicarSeedInicial(this, relogio()))
  }
}

/** Chaves usadas na tabela `meta`. */
export const META = {
  schemaVersion: 'schemaVersion',
  appVersao: 'appVersao',
  instalacaoId: 'instalacaoId',
  onboardingConcluido: 'onboardingConcluido',
  ultimoBackupEm: 'ultimoBackupEm',
  alteracoesDesdeBackup: 'alteracoesDesdeBackup',
  restauracaoEmAndamento: 'restauracaoEmAndamento',
} as const

export async function lerMeta<T = unknown>(db: BancoSindico, chave: string): Promise<T | undefined> {
  const m = await db.meta.get(chave)
  return m?.valor as T | undefined
}

export async function gravarMeta(db: BancoSindico, chave: string, valor: unknown): Promise<void> {
  await db.meta.put({ chave, valor })
}
