import { ehDataISO } from '../../dominio/datas'
import { ErroDominio } from '../../dominio/erros'
import { montarRateioGeral } from '../../dominio/rateio'
import type { Lancamento, Periodo, RateioSnapshot } from '../../dominio/tipos'
import { criarConsultas } from '../consultas'
import type { BancoSindico } from '../db'
import { ultimoMesFechadoNoBanco } from '../regras'
import type { ServicoLancamentos } from './lancamentos'

export interface PreviaRateios {
  periodo: Periodo
  itens: Array<{ lancamento: Lancamento; novoRateio: RateioSnapshot }>
  assinatura: string
}

export function criarServicoManutencao(db: BancoSindico, lancamentos: ServicoLancamentos) {
  async function previaRateios(periodo: Periodo): Promise<PreviaRateios> {
    if (!ehDataISO(periodo.inicio) || !ehDataISO(periodo.fim) || periodo.inicio > periodo.fim) throw new ErroDominio('VALIDACAO', 'Informe um período válido.')
    return db.transaction('r', db.tables, async () => {
      const [lista, blocos, unidades, ultimo] = await Promise.all([
        criarConsultas(db).lancamentos.listar({ ...periodo, escopoTipo: 'GERAL' }), db.blocos.orderBy('ordem').toArray(), db.unidades.toArray(), ultimoMesFechadoNoBanco(db),
      ])
      const itens = lista.filter(l => l.tipo === 'NORMAL' && !l.estornadoPorId && (!ultimo || l.mes > ultimo)).map(lancamento => ({ lancamento, novoRateio: montarRateioGeral(lancamento.valorCentavos, blocos, unidades, '') }))
      return { periodo, itens, assinatura: JSON.stringify(itens.map(i => [i.lancamento.id, i.lancamento.versao, i.novoRateio.cotas])) }
    })
  }
  return {
    previaRateios,
    async recalcularRateios(previa: PreviaRateios): Promise<number> {
      return db.transaction('rw', db.tables, async () => {
        const atual = await previaRateios(previa.periodo)
        if (atual.assinatura !== previa.assinatura) throw new ErroDominio('REGRA', 'Os dados mudaram desde a prévia. Gere uma nova prévia antes de aplicar.')
        for (const item of atual.itens) await lancamentos.recalcularRateio(item.lancamento.id)
        return atual.itens.length
      })
    },
  }
}
