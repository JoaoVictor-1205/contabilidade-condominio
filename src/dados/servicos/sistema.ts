// Operações de sistema: onboarding, marcação de backup, apagar tudo.
import { gravarMeta, lerMeta, type BancoSindico } from '../db'
import type { Relogio } from '../relogio'
import { aplicarSeedInicial } from '../seed'
import { verificarIntegridade } from '../../dominio/integridade'

export function criarServicoSistema(db: BancoSindico, relogio: Relogio) {
  return {
    async verificarIntegridade() {
      return db.transaction('r', db.tables, async () => {
        const [condominio, blocos, unidades, taxas, categorias, lancamentos, cobrancas, anexos, idsAnexosBlob, fechamentos] = await Promise.all([
          db.condominio.get('unico'), db.blocos.toArray(), db.unidades.toArray(), db.taxas.toArray(), db.categorias.toArray(),
          db.lancamentos.toArray(), db.cobrancas.toArray(), db.anexos.toArray(), db.anexosBlob.toCollection().primaryKeys(), db.fechamentos.toArray(),
        ])
        return verificarIntegridade({ condominio, blocos, unidades, taxas, categorias, lancamentos, cobrancas, anexos, idsAnexosBlob, fechamentos, hoje: relogio.hoje() })
      })
    },
    async onboardingConcluido(): Promise<boolean> {
      return (await lerMeta<boolean>(db, 'onboardingConcluido')) === true
    },

    async concluirOnboarding(): Promise<void> {
      await gravarMeta(db, 'onboardingConcluido', true)
    },

    /** Mantém pendentes as alterações que ocorreram durante a geração do ZIP. */
    async marcarBackupFeito(snapshot?: { instalacaoId: string; geradoEm: string; ultimaAuditoria: number }): Promise<void> {
      await db.transaction('rw', db.meta, db.auditoria, async () => {
        if (snapshot && await lerMeta<string>(db, 'instalacaoId') !== snapshot.instalacaoId) return
        const ultimo = await lerMeta<string>(db, 'ultimoBackupEm')
        if (snapshot && ultimo && ultimo > snapshot.geradoEm) return
        const posteriores = snapshot ? await db.auditoria.where('seq').above(snapshot.ultimaAuditoria).filter(a => a.entidade !== 'backup').count() : 0
        await gravarMeta(db, 'ultimoBackupEm', snapshot?.geradoEm ?? relogio.agora())
        await gravarMeta(db, 'alteracoesDesdeBackup', posteriores)
      })
    },

    async estadoBackup(): Promise<{ ultimoBackupEm: string | null; alteracoesDesdeBackup: number }> {
      const ultimo = await lerMeta<string>(db, 'ultimoBackupEm')
      const n = await lerMeta<number>(db, 'alteracoesDesdeBackup')
      return { ultimoBackupEm: ultimo ?? null, alteracoesDesdeBackup: typeof n === 'number' ? n : 0 }
    },

    /** Apaga TODOS os dados e volta ao seed inicial (a UI exige digitar APAGAR). */
    async apagarTudo(): Promise<void> {
      await db.transaction('rw', db.tables, async () => {
        for (const t of db.tables) await t.clear()
        await aplicarSeedInicial(db, relogio)
      })
    },
  }
}

export type ServicoSistema = ReturnType<typeof criarServicoSistema>
