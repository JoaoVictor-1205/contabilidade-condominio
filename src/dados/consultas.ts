// Consultas (leituras) usadas pela UI via useLiveQuery. Nenhuma escrita aqui.
import { mesDe, primeiraDataDoMes } from '../dominio/datas'
import type { Anexo, Auditoria, Bloco, Categoria, Cobranca, DataISO, Documento, EscopoTipo, Id, Lancamento, MesISO, Natureza, Periodo, TaxaVigencia, Unidade } from '../dominio/tipos'
import type { BaseDemonstrativo } from '../dominio/demonstrativo'
import { lerMeta, type BancoSindico } from './db'

export interface FiltroLancamentos {
  inicio?: DataISO
  fim?: DataISO
  natureza?: Natureza
  escopoTipo?: EscopoTipo
  blocoId?: Id
  unidadeId?: Id
  categoriaId?: Id
  /** Default 'ATIVO'. */
  status?: 'ATIVO' | 'EXCLUIDO' | 'TODOS'
  texto?: string
  limite?: number
}

export interface InsumosDemonstrativo {
  blocos: Bloco[]
  categorias: Categoria[]
  lancamentos: Lancamento[]
  cobrancas: Cobranca[]
  unidadesPorBloco: Map<Id, number>
}

function compararNumero(a: Unidade, b: Unidade): number {
  return a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true })
}

export function criarConsultas(db: BancoSindico) {
  async function unidadesAtivasPorBloco(): Promise<Map<Id, number>> {
    const mapa = new Map<Id, number>()
    await db.unidades.each((u) => {
      if (u.ativa) mapa.set(u.blocoId, (mapa.get(u.blocoId) ?? 0) + 1)
    })
    return mapa
  }

  return {
    condominio: () => db.condominio.get('unico'),
    blocos: () => db.blocos.orderBy('ordem').toArray(),
    blocosAtivos: async () => (await db.blocos.orderBy('ordem').toArray()).filter((b) => b.ativo),
    bloco: (id: Id) => db.blocos.get(id),
    unidades: async () => (await db.unidades.toArray()).sort(compararNumero),
    unidadesDoBloco: async (blocoId: Id) => (await db.unidades.where('blocoId').equals(blocoId).toArray()).sort(compararNumero),
    unidade: (id: Id) => db.unidades.get(id),
    unidadesAtivasPorBloco,
    taxas: (): Promise<TaxaVigencia[]> => db.taxas.toArray(),
    categorias: (): Promise<Categoria[]> => db.categorias.orderBy('ordem').toArray(),
    meta: <T = unknown>(chave: string) => lerMeta<T>(db, chave),

    lancamentos: {
      async listar(filtro: FiltroLancamentos = {}): Promise<Lancamento[]> {
        const status = filtro.status ?? 'ATIVO'
        let colecao =
          filtro.inicio && filtro.fim
            ? db.lancamentos.where('data').between(filtro.inicio, filtro.fim, true, true)
            : filtro.inicio
              ? db.lancamentos.where('data').aboveOrEqual(filtro.inicio)
              : filtro.fim
                ? db.lancamentos.where('data').belowOrEqual(filtro.fim)
                : db.lancamentos.toCollection()
        const texto = filtro.texto?.trim().toLocaleLowerCase('pt-BR')
        colecao = colecao.filter((l) => {
          if (status !== 'TODOS' && l.status !== status) return false
          if (filtro.natureza && l.natureza !== filtro.natureza) return false
          if (filtro.escopoTipo && l.escopoTipo !== filtro.escopoTipo) return false
          if (filtro.blocoId && l.blocoId !== filtro.blocoId && l.blocoOrigemId !== filtro.blocoId && !l.rateio?.cotas.some((c) => c.blocoId === filtro.blocoId)) return false
          if (filtro.unidadeId && l.unidadeId !== filtro.unidadeId) return false
          if (filtro.categoriaId && l.categoriaId !== filtro.categoriaId) return false
          if (texto && !`${l.descricao} ${l.observacoes ?? ''}`.toLocaleLowerCase('pt-BR').includes(texto)) return false
          return true
        })
        const lista = await colecao.toArray()
        lista.sort((a, b) => (a.data === b.data ? b.criadoEm.localeCompare(a.criadoEm) : b.data.localeCompare(a.data)))
        return filtro.limite ? lista.slice(0, filtro.limite) : lista
      },
      obter: (id: Id) => db.lancamentos.get(id),
      daUnidade: (unidadeId: Id) => db.lancamentos.where('unidadeId').equals(unidadeId).filter((l) => l.status === 'ATIVO').toArray(),
      daCobranca: (cobrancaId: Id) => db.lancamentos.where('cobrancaId').equals(cobrancaId).toArray(),
      ultimos: async (n: number) => (await db.lancamentos.where('status').equals('ATIVO').toArray()).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).slice(0, n),
    },

    anexos: {
      de: (donoTipo: Anexo['donoTipo'], donoId: Id) => db.anexos.where('[donoTipo+donoId]').equals([donoTipo, donoId]).toArray(),
      contagemPorDono: async (donoTipo: Anexo['donoTipo']): Promise<Map<Id, number>> => {
        const mapa = new Map<Id, number>()
        await db.anexos.each((a) => {
          if (a.donoTipo === donoTipo) mapa.set(a.donoId, (mapa.get(a.donoId) ?? 0) + 1)
        })
        return mapa
      },
      blob: async (anexoId: Id) => (await db.anexosBlob.get(anexoId))?.blob,
      total: async () => {
        let bytes = 0
        let quantidade = 0
        await db.anexos.each((a) => {
          bytes += a.tamanho
          quantidade++
        })
        return { bytes, quantidade }
      },
    },

    cobrancas: {
      daCompetencia: (competencia: MesISO) => db.cobrancas.where('competencia').equals(competencia).toArray(),
      daUnidade: (unidadeId: Id) => db.cobrancas.where('unidadeId').equals(unidadeId).sortBy('competencia'),
      abertas: () => db.cobrancas.where('status').equals('ABERTA').toArray(),
      obter: (id: Id) => db.cobrancas.get(id),
      competencias: async (): Promise<MesISO[]> => {
        const set = new Set<MesISO>()
        await db.cobrancas.each((c) => set.add(c.competencia))
        return [...set].sort()
      },
      entreCompetencias: (de: MesISO, ate: MesISO) => db.cobrancas.where('competencia').between(de, ate, true, true).toArray(),
    },

    documentos: {
      listar: () => db.documentos.orderBy('data').reverse().toArray(),
      obter: (id: Id) => db.documentos.get(id),
    },

    auditoria: {
      listar: (filtro: { entidade?: Auditoria['entidade']; texto?: string; limite?: number } = {}): Promise<Auditoria[]> => {
        const texto = filtro.texto?.trim().toLocaleLowerCase('pt-BR')
        return db.auditoria.orderBy('seq').reverse().filter(a =>
          (!filtro.entidade || a.entidade === filtro.entidade) &&
          (!texto || `${a.entidadeId} ${a.acao} ${a.resumo} ${a.motivo ?? ''} ${JSON.stringify(a.alteracoes ?? {})}`.toLocaleLowerCase('pt-BR').includes(texto)),
        ).limit(filtro.limite ?? 200).toArray()
      },
      ultimas: (n: number): Promise<Auditoria[]> => db.auditoria.orderBy('seq').reverse().limit(n).toArray(),
      de: (entidadeId: Id): Promise<Auditoria[]> => db.auditoria.where('entidadeId').equals(entidadeId).reverse().sortBy('seq'),
    },

    fechamentos: {
      listar: () => db.fechamentos.orderBy('mes').toArray(),
      ultimo: () => db.fechamentos.orderBy('mes').last(),
    },

    relatorios: {
      /** Tudo o que `calcularDemonstrativo` precisa (exceto hoje/agora), lido com índices. */
      async insumosDemonstrativo(periodo: Periodo, base: BaseDemonstrativo = 'data'): Promise<InsumosDemonstrativo> {
        const [blocos, categorias, lancamentos, cobrancas, unidadesPorBloco] = await Promise.all([
          db.blocos.orderBy('ordem').toArray(),
          db.categorias.orderBy('ordem').toArray(),
          db.lancamentos
            .where('status')
            .equals('ATIVO')
            .filter((l) => (base === 'data' ? l.data : primeiraDataDoMes(l.competencia)) <= periodo.fim)
            .toArray(),
          db.cobrancas.where('competencia').between(mesDe(periodo.inicio), mesDe(periodo.fim), true, true).toArray(),
          unidadesAtivasPorBloco(),
        ])
        return { blocos, categorias, lancamentos, cobrancas, unidadesPorBloco }
      },
    },

    documentosDoTipo: (categoria: Documento['categoria']) => db.documentos.where('categoria').equals(categoria).toArray(),
  }
}

export type Consultas = ReturnType<typeof criarConsultas>
