// Seed inicial: executado UMA vez, no evento `populate` do Dexie (banco recém-criado).
import { mesDe } from '../dominio/datas'
import { novoId } from '../dominio/ids'
import { gerarSeed } from '../dominio/seedPadrao'
import type { BancoSindico } from './db'
import type { Relogio } from './relogio'

export async function aplicarSeedInicial(db: BancoSindico, relogio: Relogio): Promise<void> {
  const agora = relogio.agora()
  const seed = gerarSeed({ inicioContabil: mesDe(relogio.hoje()), agora })
  await db.condominio.add(seed.condominio)
  await db.blocos.bulkAdd(seed.blocos)
  await db.unidades.bulkAdd(seed.unidades)
  await db.taxas.bulkAdd(seed.taxas)
  await db.categorias.bulkAdd(seed.categorias)
  await db.meta.bulkAdd([
    { chave: 'schemaVersion', valor: 2 },
    { chave: 'appVersao', valor: '2.0.0' },
    { chave: 'instalacaoId', valor: novoId() },
    { chave: 'onboardingConcluido', valor: false },
    { chave: 'alteracoesDesdeBackup', valor: 0 },
  ])
}
