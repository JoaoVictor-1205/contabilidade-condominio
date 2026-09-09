// Instância única para a UI. Testes criam o próprio banco com src/testes/dbTeste.ts.
import { criarConsultas } from './consultas'
import { BancoSindico } from './db'
import { relogio, type Relogio } from './relogio'
import { criarServicos } from './servicos/criarServicos'

/** Delega ao relógio corrente, para que `definirRelogio` valha mesmo depois da criação dos serviços. */
const relogioDinamico: Relogio = {
  agora: () => relogio().agora(),
  hoje: () => relogio().hoje(),
}

export const db = new BancoSindico()
export const servicos = criarServicos(db, relogioDinamico)
export const consultas = criarConsultas(db)
export { relogioDinamico as relogioApp }
