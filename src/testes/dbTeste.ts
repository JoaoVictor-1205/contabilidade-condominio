// Banco isolado por teste (fake-indexeddb), com relógio fixo e serviços/consultas próprios.
import { criarConsultas } from '../dados/consultas'
import { BancoSindico } from '../dados/db'
import { definirRelogio, relogioFixo } from '../dados/relogio'
import { criarServicos } from '../dados/servicos/criarServicos'
import { novoId } from '../dominio/ids'
import type { Bloco, Categoria, Id, Unidade } from '../dominio/tipos'

/** 04/09/2026 10:00 → seed com inicioContabil '2026-09'. */
export const AGORA_TESTE = '2026-09-04T10:00:00'

export function criarBancoTeste(agora: string = AGORA_TESTE) {
  const relogio = relogioFixo(agora)
  definirRelogio(relogio)
  const db = new BancoSindico('teste-' + novoId())
  const servicos = criarServicos(db, relogio)
  const consultas = criarConsultas(db)
  return {
    db,
    servicos,
    consultas,
    relogio,
    async fechar() {
      await db.delete()
    },
    async bloco(nome: string): Promise<Bloco> {
      const b = await db.blocos.filter((x) => x.nome === nome).first()
      if (!b) throw new Error(`Bloco ${nome} não encontrado no teste`)
      return b
    },
    async unidade(nomeBloco: string, numero: string): Promise<Unidade> {
      const b = await db.blocos.filter((x) => x.nome === nomeBloco).first()
      const u = b ? await db.unidades.where('[blocoId+numero]').equals([b.id, numero]).first() : undefined
      if (!u) throw new Error(`Unidade ${nomeBloco}-${numero} não encontrada no teste`)
      return u
    },
    async categoria(nome: string): Promise<Categoria> {
      const c = await db.categorias.filter((x) => x.nome === nome).first()
      if (!c) throw new Error(`Categoria ${nome} não encontrada no teste`)
      return c
    },
    async categoriaId(nome: string): Promise<Id> {
      return (await this.categoria(nome)).id
    },
  }
}

export type BancoTeste = ReturnType<typeof criarBancoTeste>
