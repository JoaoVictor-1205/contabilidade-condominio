// Serviço de lançamentos (receitas, despesas e transferências entre blocos).
import { mesDe } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import { ErroDominio } from '../../dominio/erros'
import { novoId } from '../../dominio/ids'
import { montarRateioGeral, reratearComSnapshot } from '../../dominio/rateio'
import type { Bloco, Categoria, DataISO, Id, Lancamento, RateioSnapshot } from '../../dominio/tipos'
import {
  exigirValido,
  validarNovaTransferencia,
  validarNovoLancamento,
  validarPatchLancamento,
  type NovaTransferencia,
  type NovoLancamento,
  type PatchLancamento,
} from '../../dominio/validacao'
import { diferencas, registrarAuditoria } from '../auditoria'
import type { BancoSindico } from '../db'
import { assertMesAberto, categoriaDeSistema, exigirBloco, exigirCategoria, exigirLancamento, exigirUnidade, obterCondominio, validarDataContraSaldoInicial } from '../regras'
import type { Relogio } from '../relogio'
import { gravarAnexos, type ArquivoAnexo } from './anexos'
import { gravarEstorno } from './estorno'

export interface DependenciasLancamentos {
  /** Excluir um lançamento de TAXA delega ao serviço de cobranças (reabre a cobrança e trata os juros). */
  desfazerPagamento: (cobrancaId: Id, motivo: string) => Promise<unknown>
}

interface EscopoResolvido {
  blocoId: Id | null
  unidadeId: Id | null
  rateio: RateioSnapshot | null
  afetados: Bloco[]
}

export function criarServicoLancamentos(db: BancoSindico, relogio: Relogio, deps: DependenciasLancamentos) {
  function validarCategoriaManual(categoria: Categoria, natureza: NovoLancamento['natureza']): void {
    if (categoria.sistema === 'TAXA' || categoria.sistema === 'JUROS') {
      throw new ErroDominio('CATEGORIA_DE_SISTEMA', 'Para registrar taxa condominial ou juros use Cobranças > Pagar.')
    }
    if (categoria.sistema === 'TRANSFERENCIA') {
      throw new ErroDominio('CATEGORIA_DE_SISTEMA', 'Para mover dinheiro entre blocos use "Transferir entre blocos".')
    }
    if (!categoria.ativa) throw new ErroDominio('REGRA', `A categoria "${categoria.nome}" está desativada.`)
    if (categoria.natureza !== natureza) {
      throw new ErroDominio('VALIDACAO', `A categoria "${categoria.nome}" é de ${categoria.natureza === 'RECEITA' ? 'receita' : 'despesa'}.`)
    }
  }

  /** Resolve bloco/unidade/rateio conforme o escopo. `rateioAnterior` permite re-ratear com os pesos do snapshot ao editar o valor. */
  async function resolverEscopo(dados: NovoLancamento, agora: string, rateioAnterior: RateioSnapshot | null, exigirAtivo = true): Promise<EscopoResolvido> {
    if (dados.escopoTipo === 'GERAL') {
      const blocos = await db.blocos.toArray()
      let rateio: RateioSnapshot
      if (rateioAnterior) {
        rateio = rateioAnterior.cotas.reduce((s, c) => s + c.valorCentavos, 0) === dados.valorCentavos
          ? rateioAnterior
          : reratearComSnapshot(dados.valorCentavos, rateioAnterior, agora)
      } else {
        const unidades = await db.unidades.toArray()
        rateio = montarRateioGeral(dados.valorCentavos, blocos, unidades, agora)
      }
      const ids = new Set(rateio.cotas.map((c) => c.blocoId))
      return { blocoId: null, unidadeId: null, rateio, afetados: blocos.filter((b) => ids.has(b.id)) }
    }
    if (dados.escopoTipo === 'BLOCO') {
      const bloco = await exigirBloco(db, dados.blocoId as Id)
      if (exigirAtivo && !bloco.ativo) throw new ErroDominio('REGRA', `O bloco ${bloco.nome} está desativado.`)
      return { blocoId: bloco.id, unidadeId: null, rateio: null, afetados: [bloco] }
    }
    const unidade = await exigirUnidade(db, dados.unidadeId as Id)
    if (exigirAtivo && !unidade.ativa) throw new ErroDominio('REGRA', `O apartamento ${unidade.numero} está desativado.`)
    const bloco = await exigirBloco(db, unidade.blocoId)
    if (exigirAtivo && !bloco.ativo) throw new ErroDominio('REGRA', `O bloco ${bloco.nome} está desativado.`)
    return { blocoId: bloco.id, unidadeId: unidade.id, rateio: null, afetados: [bloco] }
  }

  return {
    async registrar(entrada: NovoLancamento, anexos: readonly ArquivoAnexo[] = []): Promise<Lancamento> {
      const dados = exigirValido(validarNovoLancamento(entrada))
      return db.transaction('rw', db.tables, async () => {
        await assertMesAberto(db, dados.data)
        const agora = relogio.agora()
        const condominio = await obterCondominio(db)
        const categoria = await exigirCategoria(db, dados.categoriaId)
        validarCategoriaManual(categoria, dados.natureza)
        const escopo = await resolverEscopo(dados, agora, null)
        validarDataContraSaldoInicial(dados.data, escopo.afetados, condominio)
        const l: Lancamento = {
          id: novoId(),
          natureza: dados.natureza,
          tipo: 'NORMAL',
          status: 'ATIVO',
          escopoTipo: dados.escopoTipo,
          blocoId: escopo.blocoId,
          unidadeId: escopo.unidadeId,
          blocoOrigemId: null,
          data: dados.data,
          mes: mesDe(dados.data),
          competencia: dados.competencia ?? mesDe(dados.data),
          categoriaId: categoria.id,
          descricao: dados.descricao,
          valorCentavos: dados.valorCentavos,
          formaPagamento: dados.formaPagamento ?? null,
          ...(dados.observacoes ? { observacoes: dados.observacoes } : {}),
          rateio: escopo.rateio,
          cobrancaId: null,
          estornaLancamentoId: null,
          estornadoPorId: null,
          versao: 1,
          criadoEm: agora,
          atualizadoEm: agora,
        }
        await db.lancamentos.add(l)
        await gravarAnexos(db, 'LANCAMENTO', l.id, anexos, agora)
        await registrarAuditoria(
          db,
          { entidade: 'lancamento', entidadeId: l.id, acao: 'registrado', resumo: `${l.natureza === 'RECEITA' ? 'Receita' : 'Despesa'} ${formatarBRL(l.valorCentavos)} — ${l.descricao}` },
          agora,
        )
        return l
      })
    },

    /**
     * Edita um lançamento ATIVO. Valor alterado em GERAL → re-rateia com os pesos do snapshot; escopo alterado → novo snapshot.
     * Lançamento de cobrança (TAXA/JUROS): só descrição, observações e forma de pagamento (use "Corrigir pagamento").
     * Trocar a natureza exige motivo.
     */
    async atualizar(id: Id, patch: PatchLancamento, motivo?: string): Promise<Lancamento> {
      const p = exigirValido(validarPatchLancamento(patch))
      return db.transaction('rw', db.tables, async () => {
        const atual = await exigirLancamento(db, id)
        if (atual.status !== 'ATIVO') throw new ErroDominio('REGRA', 'Lançamento excluído não pode ser editado.')
        await assertMesAberto(db, atual.data)
        await assertMesAberto(db, p.data ?? atual.data)
        if (atual.tipo === 'ESTORNO' || atual.estornadoPorId) {
          if (Object.keys(patch).some(k => k !== 'observacoes')) throw new ErroDominio('REGRA', 'Lançamentos estornados e estornos só permitem editar observações.')
          const novo = { ...atual, versao: atual.versao + 1, atualizadoEm: relogio.agora() }
          if ('observacoes' in patch) {
            if (p.observacoes) novo.observacoes = p.observacoes
            else delete novo.observacoes
          }
          await db.lancamentos.put(novo)
          await registrarAuditoria(db, { entidade: 'lancamento', entidadeId: id, acao: 'atualizado', resumo: 'Observações alteradas', alteracoes: diferencas(atual, novo, ['observacoes']) }, novo.atualizadoEm)
          return novo
        }
        if (atual.natureza === 'TRANSFERENCIA') throw new ErroDominio('REGRA', 'Transferências não são editáveis: exclua e registre outra.')
        if (atual.cobrancaId) {
          const permitidos = new Set(['descricao', 'observacoes', 'formaPagamento'])
          const proibidos = Object.keys(p).filter((k) => !permitidos.has(k))
          if (proibidos.length > 0) {
            throw new ErroDominio('REGRA', 'Valor, data e escopo de um pagamento de taxa só mudam por "Corrigir pagamento" em Cobranças.')
          }
        }
        const mesclado: NovoLancamento = {
          natureza: p.natureza ?? (atual.natureza as NovoLancamento['natureza']),
          data: p.data ?? atual.data,
          competencia: p.competencia ?? atual.competencia,
          valorCentavos: p.valorCentavos ?? atual.valorCentavos,
          descricao: p.descricao ?? atual.descricao,
          categoriaId: p.categoriaId ?? atual.categoriaId,
          escopoTipo: p.escopoTipo ?? atual.escopoTipo,
          blocoId: p.escopoTipo && p.escopoTipo !== atual.escopoTipo ? (p.blocoId ?? null) : (p.blocoId ?? atual.blocoId),
          unidadeId: p.escopoTipo && p.escopoTipo !== atual.escopoTipo ? (p.unidadeId ?? null) : (p.unidadeId ?? atual.unidadeId),
          formaPagamento: p.formaPagamento === undefined ? atual.formaPagamento : p.formaPagamento,
          ...('observacoes' in patch ? { observacoes: p.observacoes } : atual.observacoes ? { observacoes: atual.observacoes } : {}),
        }
        if (mesclado.escopoTipo === 'GERAL') {
          mesclado.blocoId = null
          mesclado.unidadeId = null
        }
        const dados = exigirValido(validarNovoLancamento(mesclado))
        if (dados.natureza !== atual.natureza && !motivo?.trim()) {
          throw new ErroDominio('VALIDACAO', 'Informe o motivo para trocar entre receita e despesa.')
        }
        const agora = relogio.agora()
        const condominio = await obterCondominio(db)
        const categoria = await exigirCategoria(db, dados.categoriaId)
        if (!atual.cobrancaId && (categoria.id !== atual.categoriaId || dados.natureza !== atual.natureza)) validarCategoriaManual(categoria, dados.natureza)
        const rateioAnterior = atual.escopoTipo === 'GERAL' && dados.escopoTipo === 'GERAL' ? atual.rateio : null
        const escopoMudou = dados.escopoTipo !== atual.escopoTipo || (dados.blocoId ?? null) !== atual.blocoId || (dados.unidadeId ?? null) !== atual.unidadeId
        const escopo = await resolverEscopo(dados, agora, rateioAnterior, escopoMudou)
        validarDataContraSaldoInicial(dados.data, escopo.afetados, condominio)
        const novo: Lancamento = {
          ...atual,
          natureza: dados.natureza,
          escopoTipo: dados.escopoTipo,
          blocoId: escopo.blocoId,
          unidadeId: escopo.unidadeId,
          data: dados.data,
          mes: mesDe(dados.data),
          competencia: dados.competencia ?? mesDe(dados.data),
          categoriaId: categoria.id,
          descricao: dados.descricao,
          valorCentavos: dados.valorCentavos,
          formaPagamento: dados.formaPagamento ?? null,
          rateio: escopo.rateio,
          versao: atual.versao + 1,
          atualizadoEm: agora,
        }
        if (dados.observacoes) novo.observacoes = dados.observacoes
        else delete novo.observacoes
        await db.lancamentos.put(novo)
        await registrarAuditoria(
          db,
          { entidade: 'lancamento', entidadeId: id, acao: 'atualizado', resumo: `Lançamento alterado (versão ${novo.versao}): ${novo.descricao}`, alteracoes: diferencas(atual, novo, ['natureza', 'data', 'competencia', 'valorCentavos', 'categoriaId', 'descricao', 'escopoTipo', 'blocoId', 'unidadeId', 'formaPagamento', 'observacoes', 'rateio']), ...(motivo ? { motivo } : {}) },
          agora,
        )
        return novo
      })
    },

    /** Exclusão lógica com motivo. Lançamento de TAXA → desfaz o pagamento; de JUROS → zera os juros da cobrança. */
    async excluir(id: Id, motivo: string): Promise<void> {
      const m = motivo.trim()
      if (!m) throw new ErroDominio('VALIDACAO', 'Informe o motivo da exclusão.')
      await db.transaction('rw', db.tables, async () => {
        const l = await exigirLancamento(db, id)
        if (l.status !== 'ATIVO') throw new ErroDominio('REGRA', 'Este lançamento já está excluído.')
        await assertMesAberto(db, l.data)
        if (l.estornadoPorId) throw new ErroDominio('REGRA', 'Um lançamento já estornado não pode ser excluído.')
        if (l.tipo === 'ESTORNO' && l.cobrancaId) throw new ErroDominio('REGRA', 'Estorno de cobrança não pode ser excluído. Registre o novo pagamento em Cobranças.')
        if (l.cobrancaId) {
          const categoria = await exigirCategoria(db, l.categoriaId)
          if (categoria.sistema === 'TAXA') {
            await deps.desfazerPagamento(l.cobrancaId, m)
            return
          }
          if (categoria.sistema === 'JUROS') {
            const c = await db.cobrancas.get(l.cobrancaId)
            if (c) await db.cobrancas.put({ ...c, jurosCentavos: 0, atualizadoEm: relogio.agora() })
          }
        }
        const agora = relogio.agora()
        if (l.tipo === 'ESTORNO' && l.estornaLancamentoId) {
          const original = await exigirLancamento(db, l.estornaLancamentoId)
          if (original.estornadoPorId !== l.id) throw new ErroDominio('REGRA', 'Vínculo de estorno inconsistente. Verifique a integridade.')
          await db.lancamentos.put({ ...original, estornadoPorId: null, versao: original.versao + 1, atualizadoEm: agora })
        }
        await db.lancamentos.put({ ...l, status: 'EXCLUIDO', excluidoEm: agora, motivoExclusao: m, versao: l.versao + 1, atualizadoEm: agora })
        await registrarAuditoria(db, { entidade: 'lancamento', entidadeId: id, acao: 'excluido', resumo: `Excluído: ${l.descricao}`, motivo: m }, agora)
      })
    },

    async estornar(id: Id, dataEstorno: DataISO, motivo: string) {
      return db.transaction('rw', db.tables, async () => {
        const original = await exigirLancamento(db, id)
        if (original.status !== 'ATIVO' || original.tipo !== 'NORMAL' || original.estornadoPorId) throw new ErroDominio('REGRA', 'Este lançamento não pode ser estornado.')
        if (original.cobrancaId) {
          const categoria = await exigirCategoria(db, original.categoriaId)
          if (categoria.sistema === 'TAXA') {
            await deps.desfazerPagamento(original.cobrancaId, motivo)
            return null
          }
          throw new ErroDominio('REGRA', 'Para estornar juros, use Desfazer pagamento em Cobranças.')
        }
        return gravarEstorno(db, original, dataEstorno, motivo, relogio.agora())
      })
    },

    /** Recalcula o rateio de um lançamento GERAL com a estrutura atual (ação explícita do síndico). */
    async recalcularRateio(id: Id): Promise<Lancamento> {
      return db.transaction('rw', db.tables, async () => {
        const l = await exigirLancamento(db, id)
        if (l.status !== 'ATIVO' || l.escopoTipo !== 'GERAL' || l.tipo !== 'NORMAL' || l.estornadoPorId) throw new ErroDominio('REGRA', 'Só lançamentos gerais ativos, sem estorno, podem ter o rateio recalculado.')
        await assertMesAberto(db, l.data)
        const agora = relogio.agora()
        const [blocos, unidades, condominio] = await Promise.all([db.blocos.toArray(), db.unidades.toArray(), obterCondominio(db)])
        const rateio = montarRateioGeral(l.valorCentavos, blocos, unidades, agora)
        const ids = new Set(rateio.cotas.map((c) => c.blocoId))
        validarDataContraSaldoInicial(l.data, blocos.filter((b) => ids.has(b.id)), condominio)
        const novo: Lancamento = { ...l, rateio, versao: l.versao + 1, atualizadoEm: agora }
        await db.lancamentos.put(novo)
        await registrarAuditoria(db, { entidade: 'lancamento', entidadeId: id, acao: 'rateio_recalculado', resumo: `Rateio recalculado com a estrutura atual: ${l.descricao}` }, agora)
        return novo
      })
    },

    /** Transferência entre caixas de blocos. Origem pode estar desativada (saldo nunca fica preso); destino deve estar ativo. */
    async registrarTransferencia(entrada: NovaTransferencia): Promise<Lancamento> {
      const dados = exigirValido(validarNovaTransferencia(entrada))
      return db.transaction('rw', db.tables, async () => {
        await assertMesAberto(db, dados.data)
        const agora = relogio.agora()
        const origem = await exigirBloco(db, dados.blocoOrigemId)
        const destino = await exigirBloco(db, dados.blocoDestinoId)
        if (!destino.ativo) throw new ErroDominio('REGRA', `O bloco de destino ${destino.nome} está desativado.`)
        const condominio = await obterCondominio(db)
        validarDataContraSaldoInicial(dados.data, [origem, destino], condominio)
        const categoria = await categoriaDeSistema(db, 'TRANSFERENCIA')
        const l: Lancamento = {
          id: novoId(),
          natureza: 'TRANSFERENCIA',
          tipo: 'NORMAL',
          status: 'ATIVO',
          escopoTipo: 'BLOCO',
          blocoId: destino.id,
          unidadeId: null,
          blocoOrigemId: origem.id,
          data: dados.data,
          mes: mesDe(dados.data),
          competencia: dados.competencia ?? mesDe(dados.data),
          categoriaId: categoria.id,
          descricao: dados.descricao,
          valorCentavos: dados.valorCentavos,
          formaPagamento: null,
          ...(dados.observacoes ? { observacoes: dados.observacoes } : {}),
          rateio: null,
          cobrancaId: null,
          estornaLancamentoId: null,
          estornadoPorId: null,
          versao: 1,
          criadoEm: agora,
          atualizadoEm: agora,
        }
        await db.lancamentos.add(l)
        await registrarAuditoria(
          db,
          { entidade: 'lancamento', entidadeId: l.id, acao: 'transferencia', resumo: `Transferência ${formatarBRL(l.valorCentavos)} de ${origem.nome} para ${destino.nome}` },
          agora,
        )
        return l
      })
    },
  }
}

export type ServicoLancamentos = ReturnType<typeof criarServicoLancamentos>
