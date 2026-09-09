import { ehMesISO, periodoDoMes } from '../../dominio/datas'
import { calcularDemonstrativo } from '../../dominio/demonstrativo'
import { ErroDominio } from '../../dominio/erros'
import { podeReabrir, proximoMesAFechar } from '../../dominio/fechamento'
import type { Fechamento, MesISO } from '../../dominio/tipos'
import { registrarAuditoria } from '../auditoria'
import { criarConsultas } from '../consultas'
import type { BancoSindico } from '../db'
import { obterCondominio } from '../regras'
import type { Relogio } from '../relogio'

export function criarServicoFechamento(db: BancoSindico, relogio: Relogio) {
  async function proximoAFechar() {
    const [fechamentos, condominio] = await Promise.all([db.fechamentos.toArray(), obterCondominio(db)])
    return proximoMesAFechar(fechamentos, condominio.inicioContabil, relogio.hoje())
  }
  return {
    listar: () => db.fechamentos.orderBy('mes').toArray(),
    proximoAFechar,
    async fechar(mes: MesISO): Promise<Fechamento> {
      return db.transaction('rw', db.tables, async () => {
        if (!ehMesISO(mes) || mes !== await proximoAFechar()) {
          throw new ErroDominio('REGRA', 'Feche apenas o próximo mês da sequência, depois de seu término.')
        }
        const periodo = periodoDoMes(mes)
        const insumos = await criarConsultas(db).relatorios.insumosDemonstrativo(periodo)
        const agora = relogio.agora()
        // Inclui também blocos inativos sem movimento: o fechamento guarda todos os saldos.
        const dem = calcularDemonstrativo({ ...insumos, blocos: insumos.blocos.map(b => ({ ...b, ativo: true })), periodo, base: 'data', hoje: relogio.hoje(), agora })
        if (dem.conferenciaCentavos !== 0) throw new ErroDominio('REGRA', 'A conferência não fecha. Verifique a integridade antes de fechar o mês.')
        const fechamento: Fechamento = {
          mes, fechadoEm: agora, base: 'data',
          saldos: dem.linhas.map(l => ({ blocoId: l.blocoId, saldoFinalCentavos: l.saldoFinal })),
          saldoGeralCentavos: dem.total.saldoFinal, qtdLancamentos: dem.lancamentos.length,
        }
        await db.fechamentos.add(fechamento)
        await registrarAuditoria(db, { entidade: 'fechamento', entidadeId: mes, acao: 'fechado', resumo: `Mês ${mes} fechado` }, agora)
        return fechamento
      })
    },
    async reabrir(mes: MesISO, motivo: string): Promise<void> {
      if (!motivo.trim()) throw new ErroDominio('VALIDACAO', 'Informe o motivo da reabertura.')
      await db.transaction('rw', db.tables, async () => {
        if (!podeReabrir(await db.fechamentos.toArray(), mes)) throw new ErroDominio('REGRA', 'Só o último mês fechado pode ser reaberto.')
        await db.fechamentos.delete(mes)
        await registrarAuditoria(db, { entidade: 'fechamento', entidadeId: mes, acao: 'reaberto', resumo: `Mês ${mes} reaberto`, motivo: motivo.trim() }, relogio.agora())
      })
    },
  }
}
