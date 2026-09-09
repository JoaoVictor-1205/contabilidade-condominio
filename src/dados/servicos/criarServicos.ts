// Monta todos os serviços sobre um banco e um relógio (injeção facilita testes: um banco por teste).
import type { BancoSindico } from '../db'
import type { Relogio } from '../relogio'
import { criarServicoAnexos } from './anexos'
import { criarServicoCobrancas } from './cobrancas'
import { criarServicoDocumentos } from './documentos'
import { criarServicoEstrutura } from './estrutura'
import { criarServicoLancamentos } from './lancamentos'
import { criarServicoSistema } from './sistema'
import { criarServicoFechamento } from './fechamento'
import { criarServicoManutencao } from './manutencao'

export function criarServicos(db: BancoSindico, relogio: Relogio) {
  const anexos = criarServicoAnexos(db, relogio)
  const cobrancas = criarServicoCobrancas(db, relogio)
  const lancamentos = criarServicoLancamentos(db, relogio, { desfazerPagamento: cobrancas.desfazerPagamento })
  const estrutura = criarServicoEstrutura(db, relogio, { registrarTransferencia: lancamentos.registrarTransferencia })
  const documentos = criarServicoDocumentos(db, relogio)
  const sistema = criarServicoSistema(db, relogio)
  const fechamento = criarServicoFechamento(db, relogio)
  const manutencao = criarServicoManutencao(db, lancamentos)
  return { anexos, cobrancas, lancamentos, estrutura, documentos, sistema, fechamento, manutencao }
}

export type Servicos = ReturnType<typeof criarServicos>
