// Serviço de cobranças: ÚNICO caminho que cria/exclui lançamentos nas categorias de sistema TAXA e JUROS.
import { planejarCobrancas, taxaVigente, type PlanoCobrancas } from '../../dominio/cobrancas'
import { ehMesISO, formatarMesCurto, mesDe } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import { ErroDominio } from '../../dominio/erros'
import { novoId } from '../../dominio/ids'
import type { Centavos, Cobranca, DataISO, FormaPagamento, Id, Lancamento, MesISO } from '../../dominio/tipos'
import { exigirValido, validarAlteracaoCobranca, validarDadosPagamento, type DadosPagamento } from '../../dominio/validacao'
import { diferencas, registrarAuditoria } from '../auditoria'
import type { BancoSindico } from '../db'
import { assertMesAberto, categoriaDeSistema, exigirBloco, exigirCobranca, exigirUnidade, obterCondominio, ultimoMesFechadoNoBanco, validarDataContraSaldoInicial } from '../regras'
import type { Relogio } from '../relogio'
import { gravarAnexos, type ArquivoAnexo } from './anexos'
import { gravarEstorno } from './estorno'

export interface ResultadoGeracao {
  criadas: number
  jaExistentes: number
  semTaxa: PlanoCobrancas['semTaxa']
  resumo: PlanoCobrancas['resumo']
}

export interface ResultadoLote {
  ok: Id[]
  erros: Array<{ cobrancaId: Id; mensagem: string }>
}

export function criarServicoCobrancas(db: BancoSindico, relogio: Relogio) {
  async function planejar(competencia: MesISO, agora: string): Promise<PlanoCobrancas> {
    if (!ehMesISO(competencia)) throw new ErroDominio('VALIDACAO', 'Competência inválida.')
    const condominio = await obterCondominio(db)
    if (competencia < condominio.inicioContabil) {
      throw new ErroDominio('REGRA', `A competência ${formatarMesCurto(competencia)} é anterior ao início contábil (${formatarMesCurto(condominio.inicioContabil)}).`)
    }
    const [blocos, unidades, taxas, existentes] = await Promise.all([
      db.blocos.toArray(),
      db.unidades.toArray(),
      db.taxas.toArray(),
      db.cobrancas.where('competencia').equals(competencia).toArray(),
    ])
    return planejarCobrancas({ competencia, blocos, unidades, taxas, existentes, diaVencimento: condominio.diaVencimento, agora })
  }

  /** Registra o pagamento. Deve rodar dentro de uma transação. */
  async function registrarInterno(
    cobrancaId: Id,
    dados: DadosPagamento,
    anexos: readonly ArquivoAnexo[],
    agora: string,
  ): Promise<{ cobranca: Cobranca; lancamento: Lancamento }> {
    await assertMesAberto(db, dados.data)
    const cobranca = await exigirCobranca(db, cobrancaId)
    if (cobranca.status !== 'ABERTA') {
      throw new ErroDominio('COBRANCA_ESTADO', `A cobrança não está em aberto (situação atual: ${cobranca.status}).`)
    }
    const bloco = await exigirBloco(db, cobranca.blocoId)
    const unidade = await exigirUnidade(db, cobranca.unidadeId)
    const condominio = await obterCondominio(db)
    validarDataContraSaldoInicial(dados.data, [bloco], condominio)
    const valorPago = dados.valorCentavos ?? cobranca.valorCentavos
    if (valorPago !== cobranca.valorCentavos && !dados.observacoes?.trim()) {
      throw new ErroDominio('VALIDACAO', 'Informe uma observação ao registrar valor diferente do cobrado (desconto ou pagamento parcial).')
    }
    const juros = dados.jurosCentavos ?? 0
    const catTaxa = await categoriaDeSistema(db, 'TAXA')
    const rotulo = `${formatarMesCurto(cobranca.competencia)} — Bloco ${bloco.nome} apto ${unidade.numero}`
    const base = {
      tipo: 'NORMAL' as const,
      status: 'ATIVO' as const,
      escopoTipo: 'UNIDADE' as const,
      blocoId: bloco.id,
      unidadeId: unidade.id,
      blocoOrigemId: null,
      data: dados.data,
      mes: mesDe(dados.data),
      formaPagamento: dados.formaPagamento,
      rateio: null,
      cobrancaId: cobranca.id,
      estornaLancamentoId: null,
      estornadoPorId: null,
      versao: 1,
      criadoEm: agora,
      atualizadoEm: agora,
    }
    const lancamento: Lancamento = {
      ...base,
      id: novoId(),
      natureza: 'RECEITA',
      competencia: cobranca.competencia,
      categoriaId: catTaxa.id,
      descricao: `Taxa condominial ${rotulo}`,
      valorCentavos: valorPago,
      ...(dados.observacoes ? { observacoes: dados.observacoes } : {}),
    }
    await db.lancamentos.add(lancamento)
    if (juros > 0) {
      const catJuros = await categoriaDeSistema(db, 'JUROS')
      await db.lancamentos.add({
        ...base,
        id: novoId(),
        natureza: 'RECEITA',
        competencia: mesDe(dados.data),
        categoriaId: catJuros.id,
        descricao: `Juros/multa da taxa ${rotulo}`,
        valorCentavos: juros,
      })
    }
    await gravarAnexos(db, 'LANCAMENTO', lancamento.id, anexos, agora)
    const atualizada: Cobranca = {
      ...cobranca,
      status: 'PAGA',
      lancamentoId: lancamento.id,
      pagaEm: dados.data,
      valorPagoCentavos: valorPago,
      jurosCentavos: juros,
      atualizadoEm: agora,
    }
    await db.cobrancas.put(atualizada)
    await registrarAuditoria(
      db,
      {
        entidade: 'cobranca',
        entidadeId: cobranca.id,
        acao: 'paga',
        resumo: `Pagamento de ${formatarBRL(valorPago)}${juros > 0 ? ` + juros ${formatarBRL(juros)}` : ''} — ${rotulo}`,
      },
      agora,
    )
    return { cobranca: atualizada, lancamento }
  }

  /** Desfaz o pagamento: exclui (soft) os lançamentos TAXA/JUROS e reabre a cobrança. Dentro de transação. */
  async function desfazerInterno(cobrancaId: Id, motivo: string, agora: string): Promise<Cobranca & { estornoGerado: boolean }> {
    const cobranca = await exigirCobranca(db, cobrancaId)
    if (cobranca.status !== 'PAGA') throw new ErroDominio('COBRANCA_ESTADO', 'A cobrança não está paga.')
    const vinculados = await db.lancamentos.where('cobrancaId').equals(cobranca.id).toArray()
    const taxa = vinculados.find(l => l.id === cobranca.lancamentoId && l.status === 'ATIVO' && l.tipo === 'NORMAL' && !l.estornadoPorId)
    if (!taxa) throw new ErroDominio('REGRA', 'Pagamento sem lançamento válido. Verifique a integridade.')
    const ultimo = await ultimoMesFechadoNoBanco(db)
    const estornoGerado = ultimo !== null && taxa.mes <= ultimo
    for (const l of vinculados) {
      if (l.status !== 'ATIVO' || l.tipo !== 'NORMAL' || l.estornadoPorId) continue
      if (estornoGerado) await gravarEstorno(db, l, relogio.hoje(), motivo, agora)
      else {
        await assertMesAberto(db, l.data)
        await db.lancamentos.put({ ...l, status: 'EXCLUIDO', excluidoEm: agora, motivoExclusao: motivo, versao: l.versao + 1, atualizadoEm: agora })
      }
    }
    const reaberta: Cobranca = {
      ...cobranca,
      status: 'ABERTA',
      lancamentoId: null,
      pagaEm: null,
      valorPagoCentavos: null,
      jurosCentavos: 0,
      atualizadoEm: agora,
    }
    await db.cobrancas.put(reaberta)
    await registrarAuditoria(
      db,
      { entidade: 'cobranca', entidadeId: cobranca.id, acao: 'pagamento_desfeito', resumo: estornoGerado ? 'Pagamento estornado no mês aberto; cobrança reaberta' : 'Pagamento desfeito; cobrança reaberta', motivo },
      agora,
    )
    return { ...reaberta, estornoGerado }
  }

  function exigirMotivo(motivo: string): string {
    const m = motivo.trim()
    if (!m) throw new ErroDominio('VALIDACAO', 'Informe o motivo.')
    return m
  }

  return {
    /** Prévia (sem gravar) do que "Gerar cobranças" faria. */
    async previaGeracao(competencia: MesISO): Promise<PlanoCobrancas> {
      return planejar(competencia, relogio.agora())
    },

    /** Gera as cobranças da competência (idempotente; aceita competência passada ou futura). */
    async gerar(competencia: MesISO): Promise<ResultadoGeracao> {
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        const plano = await planejar(competencia, agora)
        if (plano.criar.length > 0) {
          await db.cobrancas.bulkAdd(plano.criar)
          await registrarAuditoria(
            db,
            { entidade: 'cobranca', entidadeId: competencia, acao: 'geradas', resumo: `${plano.criar.length} cobrança(s) gerada(s) para ${formatarMesCurto(competencia)}` },
            agora,
          )
        }
        return { criadas: plano.criar.length, jaExistentes: plano.jaExistentes, semTaxa: plano.semTaxa, resumo: plano.resumo }
      })
    },

    async registrarPagamento(cobrancaId: Id, dados: DadosPagamento, anexos: readonly ArquivoAnexo[] = []) {
      const d = exigirValido(validarDadosPagamento(dados))
      return db.transaction('rw', db.tables, async () => await registrarInterno(cobrancaId, d, anexos, relogio.agora()))
    },

    /** Baixa em lote (valor cobrado, sem juros). Cobranças com erro são puladas e reportadas. */
    async registrarPagamentosEmLote(ids: readonly Id[], dados: { data: DataISO; formaPagamento: FormaPagamento }): Promise<ResultadoLote> {
      const d = exigirValido(validarDadosPagamento(dados))
      const resultado: ResultadoLote = { ok: [], erros: [] }
      // Cada item tem rollback próprio; uma falha depois de criar TAXA não deixa meia baixa gravada.
      for (const id of [...new Set(ids)]) {
        try {
          await db.transaction('rw', db.tables, async () => await registrarInterno(id, d, [], relogio.agora()))
          resultado.ok.push(id)
        } catch (e) {
          resultado.erros.push({ cobrancaId: id, mensagem: e instanceof Error ? e.message : String(e) })
        }
      }
      return resultado
    },

    async desfazerPagamento(cobrancaId: Id, motivo: string) {
      const m = exigirMotivo(motivo)
      return db.transaction('rw', db.tables, async () => await desfazerInterno(cobrancaId, m, relogio.agora()))
    },

    /** Única forma de alterar valor/data/forma de uma baixa: desfaz e registra de novo na mesma transação. */
    async corrigirPagamento(cobrancaId: Id, dados: DadosPagamento, motivo: string, anexos: readonly ArquivoAnexo[] = []) {
      const m = exigirMotivo(motivo)
      const d = exigirValido(validarDadosPagamento(dados))
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        await desfazerInterno(cobrancaId, `Correção: ${m}`, agora)
        return registrarInterno(cobrancaId, d, anexos, agora)
      })
    },

    async cancelar(cobrancaId: Id, motivo: string): Promise<Cobranca> {
      return mudarStatusAberta(cobrancaId, 'CANCELADA', exigirMotivo(motivo))
    },

    async isentar(cobrancaId: Id, motivo: string): Promise<Cobranca> {
      return mudarStatusAberta(cobrancaId, 'ISENTA', exigirMotivo(motivo))
    },

    /** CANCELADA/ISENTA → ABERTA. */
    async reabrir(cobrancaId: Id): Promise<Cobranca> {
      return db.transaction('rw', db.tables, async () => {
        const c = await exigirCobranca(db, cobrancaId)
        if (c.status !== 'CANCELADA' && c.status !== 'ISENTA') {
          throw new ErroDominio('COBRANCA_ESTADO', 'Só cobranças canceladas ou isentas podem ser reabertas.')
        }
        const agora = relogio.agora()
        const nova: Cobranca = { ...c, status: 'ABERTA', atualizadoEm: agora }
        delete nova.motivo
        await db.cobrancas.put(nova)
        await registrarAuditoria(db, { entidade: 'cobranca', entidadeId: c.id, acao: 'reaberta', resumo: 'Cobrança reaberta' }, agora)
        return nova
      })
    },

    /** Altera valor/vencimento/observações de uma cobrança ABERTA. Valor alterado → origemValor MANUAL. */
    async alterarAberta(cobrancaId: Id, dados: { valorCentavos?: Centavos; vencimento?: DataISO; observacoes?: string }): Promise<Cobranca> {
      const entrada = dados
      dados = exigirValido(validarAlteracaoCobranca(dados))
      return db.transaction('rw', db.tables, async () => {
        const c = await exigirCobranca(db, cobrancaId)
        if (c.status !== 'ABERTA') throw new ErroDominio('COBRANCA_ESTADO', 'Só cobranças em aberto podem ser alteradas.')
        const agora = relogio.agora()
        const nova: Cobranca = { ...c, atualizadoEm: agora }
        if (dados.valorCentavos !== undefined && dados.valorCentavos !== c.valorCentavos) {
          if (!Number.isInteger(dados.valorCentavos) || dados.valorCentavos <= 0) throw new ErroDominio('VALIDACAO', 'Valor inválido.')
          nova.valorCentavos = dados.valorCentavos
          nova.origemValor = 'MANUAL'
        }
        if (dados.vencimento !== undefined) nova.vencimento = dados.vencimento
        if ('observacoes' in entrada) {
          if (dados.observacoes) nova.observacoes = dados.observacoes
          else delete nova.observacoes
        }
        await db.cobrancas.put(nova)
        await registrarAuditoria(db, { entidade: 'cobranca', entidadeId: c.id, acao: 'alterada', resumo: `Cobrança alterada (${formatarBRL(nova.valorCentavos)})`, alteracoes: diferencas(c, nova, ['valorCentavos', 'vencimento', 'observacoes', 'origemValor']) }, agora)
        return nova
      })
    },

    /** Recalcula as ABERTAS de origem TAXA da competência com a taxa vigente atual; MANUAL são puladas. */
    async reemitirAbertas(competencia: MesISO): Promise<{ atualizadas: number; puladas: number }> {
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        const [abertas, blocos, taxas] = await Promise.all([
          db.cobrancas.where('[competencia+status]').equals([competencia, 'ABERTA']).toArray(),
          db.blocos.toArray(),
          db.taxas.toArray(),
        ])
        const blocoPorId = new Map(blocos.map((b) => [b.id, b]))
        let atualizadas = 0
        let puladas = 0
        for (const c of abertas) {
          if (c.origemValor !== 'TAXA') {
            puladas++
            continue
          }
          const bloco = blocoPorId.get(c.blocoId)
          if (!bloco) continue
          const taxa = taxaVigente(taxas, bloco.quartos, competencia)
          if (!taxa || taxa.valorCentavos <= 0) continue
          if (taxa.id === c.taxaVigenciaId && taxa.valorCentavos === c.valorCentavos) continue
          await db.cobrancas.put({ ...c, valorCentavos: taxa.valorCentavos, taxaVigenciaId: taxa.id, atualizadoEm: agora })
          atualizadas++
        }
        if (atualizadas > 0) {
          await registrarAuditoria(
            db,
            { entidade: 'cobranca', entidadeId: competencia, acao: 'reemitidas', resumo: `${atualizadas} cobrança(s) reemitida(s) em ${formatarMesCurto(competencia)}` },
            agora,
          )
        }
        return { atualizadas, puladas }
      })
    },
  }

  async function mudarStatusAberta(cobrancaId: Id, status: 'CANCELADA' | 'ISENTA', motivo: string): Promise<Cobranca> {
    return db.transaction('rw', db.tables, async () => {
      const c = await exigirCobranca(db, cobrancaId)
      if (c.status !== 'ABERTA') throw new ErroDominio('COBRANCA_ESTADO', 'Só cobranças em aberto podem ser canceladas ou isentadas.')
      const agora = relogio.agora()
      const nova: Cobranca = { ...c, status, motivo, atualizadoEm: agora }
      await db.cobrancas.put(nova)
      await registrarAuditoria(
        db,
        { entidade: 'cobranca', entidadeId: c.id, acao: status === 'CANCELADA' ? 'cancelada' : 'isenta', resumo: `Cobrança ${status.toLowerCase()}`, motivo },
        agora,
      )
      return nova
    })
  }
}

export type ServicoCobrancas = ReturnType<typeof criarServicoCobrancas>
