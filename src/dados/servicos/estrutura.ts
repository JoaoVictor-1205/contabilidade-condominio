// Serviço de estrutura: condomínio, blocos, unidades, taxas e categorias.
// Regra de ouro: relatórios históricos nunca mudam por alteração de estrutura (rateios ficam em snapshot).
import { ehDataISO, ehMesISO, formatarData, formatarMesCurto, primeiraDataDoMes } from '../../dominio/datas'
import { efeitoPorBloco } from '../../dominio/demonstrativo'
import { formatarBRL } from '../../dominio/dinheiro'
import { ErroDominio } from '../../dominio/erros'
import { novoId } from '../../dominio/ids'
import { ratearMaiorResto } from '../../dominio/rateio'
import type { Bloco, Categoria, Centavos, DataISO, Id, Lancamento, MesISO, TaxaVigencia, Unidade } from '../../dominio/tipos'
import { diffUnidades, gerarPlanoUnidades, type DiffUnidades } from '../../dominio/unidades'
import {
  exigirValido,
  validarDadosBloco,
  validarDadosCategoria,
  validarDadosCondominio,
  validarDadosUnidade,
  validarNovaTaxa,
  type DadosBloco,
  type DadosCategoria,
  type DadosCondominio,
  type DadosUnidade,
  type LinhaColagemUnidade,
  type NovaTaxa,
  type NovaTransferencia,
} from '../../dominio/validacao'
import { diferencas, registrarAuditoria } from '../auditoria'
import type { BancoSindico } from '../db'
import { assertMesAberto, blocoReferenciado, exigirBloco, exigirCategoria, exigirUnidade, idsBlocosAfetados, obterCondominio, unidadesReferenciadas } from '../regras'
import type { Relogio } from '../relogio'

export interface DependenciasEstrutura {
  registrarTransferencia: (entrada: NovaTransferencia) => Promise<Lancamento>
}

export interface PreviaBloco {
  diff: DiffUnidades
  /** Cobranças ABERTAS nas unidades que seriam desativadas. */
  cobrancasAbertasAfetadas: number
}

function normalizarNome(nome: string): string {
  return nome.trim().toLocaleLowerCase('pt-BR')
}

export function criarServicoEstrutura(db: BancoSindico, relogio: Relogio, deps: DependenciasEstrutura) {
  async function exigirNomeDeBlocoDisponivel(nome: string, ignorarId?: Id): Promise<void> {
    const n = normalizarNome(nome)
    const existente = await db.blocos.filter((b) => b.id !== ignorarId && normalizarNome(b.nome) === n).first()
    if (existente) throw new ErroDominio('VALIDACAO', `Já existe um bloco chamado "${existente.nome}".`)
  }

  async function lancamentosAtivosDoBloco(blocoId: Id): Promise<Lancamento[]> {
    const lista: Lancamento[] = []
    await db.lancamentos.where('status').equals('ATIVO').each((l) => {
      if (idsBlocosAfetados(l).includes(blocoId)) lista.push(l)
    })
    return lista
  }

  async function saldoAtualDoBloco(bloco: Bloco): Promise<Centavos> {
    let saldo = bloco.saldoInicialCentavos
    for (const l of await lancamentosAtivosDoBloco(bloco.id)) {
      for (const e of efeitoPorBloco(l)) if (e.blocoId === bloco.id) saldo += e.valorCentavos
    }
    return saldo
  }

  async function aplicarSaldoInicial(bloco: Bloco, valor: Centavos, data: DataISO, agora: string): Promise<Bloco> {
    if (!Number.isInteger(valor)) throw new ErroDominio('VALIDACAO', 'Saldo inicial inválido.')
    if (!ehDataISO(data)) throw new ErroDominio('VALIDACAO', 'Data do saldo inicial inválida.')
    if (valor !== bloco.saldoInicialCentavos || data !== bloco.dataSaldoInicial) {
      await assertMesAberto(db, bloco.dataSaldoInicial)
      await assertMesAberto(db, data)
    }
    const condominio = await obterCondominio(db)
    const inicio = primeiraDataDoMes(condominio.inicioContabil)
    if (data < inicio) {
      throw new ErroDominio('REGRA', `A data do saldo inicial não pode ser anterior ao início contábil (${formatarData(inicio)}).`)
    }
    if (data !== bloco.dataSaldoInicial) {
      const anteriores = (await lancamentosAtivosDoBloco(bloco.id)).filter((l) => l.data < data)
      if (anteriores.length > 0) {
        const datas = anteriores.map((l) => l.data).sort()
        throw new ErroDominio(
          'REGRA',
          `Existem ${anteriores.length} lançamento(s) entre ${formatarData(datas[0] as DataISO)} e ${formatarData(datas[datas.length - 1] as DataISO)}; exclua-os ou mantenha a data do saldo inicial.`,
        )
      }
    }
    return { ...bloco, saldoInicialCentavos: valor, dataSaldoInicial: data, atualizadoEm: agora }
  }

  async function calcularDiff(bloco: Bloco, andares: number, aptosPorAndar: number): Promise<PreviaBloco> {
    const existentes = await db.unidades.where('blocoId').equals(bloco.id).toArray()
    const plano = gerarPlanoUnidades({ andares, aptosPorAndar })
    const ref = await unidadesReferenciadas(db, existentes.map((u) => u.id))
    const diff = diffUnidades(existentes, plano, ref)
    const idsDesativar = new Set(diff.desativar.map((u) => u.id))
    let abertas = 0
    if (idsDesativar.size > 0) {
      abertas = await db.cobrancas
        .where('blocoId')
        .equals(bloco.id)
        .filter((c) => c.status === 'ABERTA' && idsDesativar.has(c.unidadeId))
        .count()
    }
    return { diff, cobrancasAbertasAfetadas: abertas }
  }

  async function aplicarDiff(blocoId: Id, diff: DiffUnidades, agora: string): Promise<void> {
    if (diff.criar.length > 0) {
      await db.unidades.bulkAdd(
        diff.criar.map<Unidade>((p) => ({ id: novoId(), blocoId, numero: p.numero, andar: p.andar, posicao: p.posicao, ativa: true, isenta: false, criadoEm: agora, atualizadoEm: agora })),
      )
    }
    for (const u of diff.reativar) {
      const nova: Unidade = { ...u, ativa: true, atualizadoEm: agora }
      delete nova.desativadaEm
      await db.unidades.put(nova)
    }
    for (const u of diff.desativar) await db.unidades.put({ ...u, ativa: false, desativadaEm: agora, atualizadoEm: agora })
    if (diff.excluir.length > 0) await db.unidades.bulkDelete(diff.excluir.map((u) => u.id))
  }

  return {
    // ---------- Condomínio ----------
    async atualizarCondominio(entrada: DadosCondominio) {
      const d = exigirValido(validarDadosCondominio(entrada))
      return db.transaction('rw', db.tables, async () => {
        const atual = await obterCondominio(db)
        const agora = relogio.agora()
        const novo = { ...atual, nome: d.nome, diaVencimento: d.diaVencimento, atualizadoEm: agora }
        for (const campo of ['cnpj', 'endereco', 'sindico'] as const) {
          if (d[campo]) novo[campo] = d[campo]
          else delete novo[campo]
        }
        await db.condominio.put(novo)
        await registrarAuditoria(db, { entidade: 'condominio', entidadeId: 'unico', acao: 'atualizado', resumo: `Dados do condomínio alterados (${novo.nome})`, alteracoes: diferencas(atual, novo, ['nome', 'cnpj', 'endereco', 'sindico', 'diaVencimento']) }, agora)
        return novo
      })
    },

    /**
     * Recuar: move a data do saldo inicial dos blocos que estavam no antigo 1º dia e a vigência das taxas iniciais.
     * Avançar: só se não houver lançamentos nem cobranças anteriores ao novo início.
     */
    async definirInicioContabil(mes: MesISO) {
      if (!ehMesISO(mes)) throw new ErroDominio('VALIDACAO', 'Mês inválido.')
      return db.transaction('rw', db.tables, async () => {
        const atual = await obterCondominio(db)
        if (mes === atual.inicioContabil) return atual
        if (await db.fechamentos.count()) throw new ErroDominio('MES_FECHADO', 'Reabra os meses fechados antes de alterar o início contábil.')
        const agora = relogio.agora()
        const antigoInicio = primeiraDataDoMes(atual.inicioContabil)
        const novoInicio = primeiraDataDoMes(mes)
        const blocos = await db.blocos.toArray()
        if (mes > atual.inicioContabil) {
          const n = await db.lancamentos.where('data').below(novoInicio).count()
          if (n > 0) throw new ErroDominio('REGRA', `Existem ${n} lançamento(s) antes de ${formatarData(novoInicio)}; não é possível avançar o início contábil.`)
          const c = await db.cobrancas.where('competencia').below(mes).count()
          if (c > 0) throw new ErroDominio('REGRA', `Existem ${c} cobrança(s) de competências anteriores a ${formatarMesCurto(mes)}.`)
          for (const b of blocos) {
            if (b.dataSaldoInicial < novoInicio) await db.blocos.put({ ...b, dataSaldoInicial: novoInicio, atualizadoEm: agora })
          }
        } else {
          for (const b of blocos) {
            if (b.dataSaldoInicial === antigoInicio) await db.blocos.put({ ...b, dataSaldoInicial: novoInicio, atualizadoEm: agora })
          }
          const taxas = await db.taxas.toArray()
          for (const t of taxas) {
            if (t.vigenteDesde !== atual.inicioContabil) continue
            const conflito = taxas.some((o) => o.quartos === t.quartos && o.vigenteDesde === mes)
            if (!conflito) await db.taxas.put({ ...t, vigenteDesde: mes })
          }
        }
        const novo = { ...atual, inicioContabil: mes, atualizadoEm: agora }
        await db.condominio.put(novo)
        await registrarAuditoria(db, { entidade: 'condominio', entidadeId: 'unico', acao: 'inicio_contabil', resumo: `Início contábil alterado para ${formatarMesCurto(mes)}` }, agora)
        return novo
      })
    },

    // ---------- Blocos ----------
    async criarBloco(entrada: DadosBloco): Promise<Bloco> {
      const d = exigirValido(validarDadosBloco(entrada))
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        const condominio = await obterCondominio(db)
        await exigirNomeDeBlocoDisponivel(d.nome)
        const inicio = primeiraDataDoMes(condominio.inicioContabil)
        const dataSaldo = d.dataSaldoInicial ?? inicio
        await assertMesAberto(db, dataSaldo)
        if (dataSaldo < inicio) throw new ErroDominio('REGRA', `A data do saldo inicial não pode ser anterior ao início contábil (${formatarData(inicio)}).`)
        const ultima = await db.blocos.orderBy('ordem').last()
        const bloco: Bloco = {
          id: novoId(),
          nome: d.nome,
          quartos: d.quartos,
          andares: d.andares,
          aptosPorAndar: d.aptosPorAndar,
          ordem: (ultima?.ordem ?? 0) + 1,
          ativo: true,
          saldoInicialCentavos: d.saldoInicialCentavos ?? 0,
          dataSaldoInicial: dataSaldo,
          criadoEm: agora,
          atualizadoEm: agora,
        }
        await db.blocos.add(bloco)
        const plano = gerarPlanoUnidades(bloco)
        await db.unidades.bulkAdd(
          plano.map<Unidade>((p) => ({ id: novoId(), blocoId: bloco.id, numero: p.numero, andar: p.andar, posicao: p.posicao, ativa: true, isenta: false, criadoEm: agora, atualizadoEm: agora })),
        )
        await registrarAuditoria(db, { entidade: 'bloco', entidadeId: bloco.id, acao: 'criado', resumo: `Bloco ${bloco.nome} criado com ${plano.length} apartamentos` }, agora)
        return bloco
      })
    },

    /** Prévia (sem gravar) do efeito de mudar andares/aptos por andar. */
    async previaAtualizacaoBloco(id: Id, dados: Pick<DadosBloco, 'andares' | 'aptosPorAndar'>): Promise<PreviaBloco> {
      const bloco = await exigirBloco(db, id)
      return calcularDiff(bloco, dados.andares, dados.aptosPorAndar)
    },

    async atualizarBloco(id: Id, entrada: DadosBloco): Promise<{ bloco: Bloco; diff: DiffUnidades | null }> {
      const d = exigirValido(validarDadosBloco(entrada))
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        let bloco = await exigirBloco(db, id)
        const anterior = bloco
        await exigirNomeDeBlocoDisponivel(d.nome, id)
        let diff: DiffUnidades | null = null
        if (d.andares !== bloco.andares || d.aptosPorAndar !== bloco.aptosPorAndar) {
          diff = (await calcularDiff(bloco, d.andares, d.aptosPorAndar)).diff
          await aplicarDiff(bloco.id, diff, agora)
        }
        if (d.saldoInicialCentavos !== undefined || d.dataSaldoInicial !== undefined) {
          bloco = await aplicarSaldoInicial(bloco, d.saldoInicialCentavos ?? bloco.saldoInicialCentavos, d.dataSaldoInicial ?? bloco.dataSaldoInicial, agora)
        }
        bloco = { ...bloco, nome: d.nome, quartos: d.quartos, andares: d.andares, aptosPorAndar: d.aptosPorAndar, atualizadoEm: agora }
        await db.blocos.put(bloco)
        const resumoDiff = diff ? ` (+${diff.criar.length} criadas, ${diff.reativar.length} reativadas, ${diff.desativar.length} desativadas, ${diff.excluir.length} excluídas)` : ''
        await registrarAuditoria(db, { entidade: 'bloco', entidadeId: id, acao: 'atualizado', resumo: `Bloco ${bloco.nome} alterado${resumoDiff}`, alteracoes: diferencas(anterior, bloco, ['nome', 'quartos', 'andares', 'aptosPorAndar', 'saldoInicialCentavos', 'dataSaldoInicial']) }, agora)
        return { bloco, diff }
      })
    },

    async definirSaldoInicial(id: Id, valorCentavos: Centavos, data: DataISO): Promise<Bloco> {
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        const anterior = await exigirBloco(db, id)
        const bloco = await aplicarSaldoInicial(anterior, valorCentavos, data, agora)
        await db.blocos.put(bloco)
        await registrarAuditoria(db, { entidade: 'bloco', entidadeId: id, acao: 'saldo_inicial', resumo: `Saldo inicial do bloco ${bloco.nome}: ${formatarBRL(valorCentavos)} em ${formatarData(data)}`, alteracoes: diferencas(anterior, bloco, ['saldoInicialCentavos', 'dataSaldoInicial']) }, agora)
        return bloco
      })
    },

    /** Sugestão (não grava): distribui um total entre os blocos ativos proporcionalmente aos apartamentos ativos. */
    async definirSaldosIniciaisEmLote(itens: ReadonlyArray<{ blocoId: Id; valorCentavos: Centavos; data: DataISO }>): Promise<number> {
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        for (const item of itens) {
          const anterior = await exigirBloco(db, item.blocoId)
          const bloco = await aplicarSaldoInicial(anterior, item.valorCentavos, item.data, agora)
          await db.blocos.put(bloco)
          await registrarAuditoria(db, { entidade: 'bloco', entidadeId: bloco.id, acao: 'saldo_inicial', resumo: `Saldo inicial do bloco ${bloco.nome} definido em lote`, alteracoes: diferencas(anterior, bloco, ['saldoInicialCentavos', 'dataSaldoInicial']) }, agora)
        }
        return itens.length
      })
    },

    async sugerirDistribuicaoSaldo(totalCentavos: Centavos): Promise<Array<{ blocoId: Id; nome: string; valorCentavos: Centavos }>> {
      if (!Number.isInteger(totalCentavos)) throw new ErroDominio('VALIDACAO', 'Valor inválido.')
      const blocos = (await db.blocos.orderBy('ordem').toArray()).filter((b) => b.ativo)
      const unidades = await db.unidades.toArray()
      const pesos = blocos.map((b) => ({ chave: b.id, peso: unidades.filter((u) => u.blocoId === b.id && u.ativa).length })).filter((p) => p.peso > 0)
      if (pesos.length === 0) return []
      const cotas = ratearMaiorResto(Math.abs(totalCentavos), pesos)
      const sinal = totalCentavos < 0 ? -1 : 1
      return cotas.map((c) => ({ blocoId: c.chave, nome: blocos.find((b) => b.id === c.chave)?.nome ?? '', valorCentavos: c.valorCentavos * sinal }))
    },

    async saldoAtual(id: Id): Promise<Centavos> {
      return saldoAtualDoBloco(await exigirBloco(db, id))
    },

    /** Desativa o bloco. Exige zero cobranças em aberto; se houver saldo, transfere para outro bloco na mesma transação. */
    async desativarBloco(id: Id, opcoes: { transferirParaBlocoId?: Id | null } = {}): Promise<Bloco> {
      return db.transaction('rw', db.tables, async () => {
        const bloco = await exigirBloco(db, id)
        if (!bloco.ativo) throw new ErroDominio('REGRA', `O bloco ${bloco.nome} já está desativado.`)
        const abertas = await db.cobrancas.where('blocoId').equals(id).filter((c) => c.status === 'ABERTA').count()
        if (abertas > 0) throw new ErroDominio('REGRA', `Há ${abertas} cobrança(s) em aberto no bloco ${bloco.nome}. Cancele ou isente antes de desativar.`)
        const saldo = await saldoAtualDoBloco(bloco)
        if (saldo !== 0) {
          const destinoId = opcoes.transferirParaBlocoId
          if (!destinoId) throw new ErroDominio('REGRA', `O bloco ${bloco.nome} tem saldo de ${formatarBRL(saldo)}. Informe o bloco que receberá o saldo.`)
          if (destinoId === id) throw new ErroDominio('VALIDACAO', 'O bloco de destino deve ser outro.')
          const destino = await exigirBloco(db, destinoId)
          if (saldo > 0) {
            await deps.registrarTransferencia({ data: relogio.hoje(), valorCentavos: saldo, descricao: `Saldo do bloco ${bloco.nome} transferido ao desativar`, blocoOrigemId: id, blocoDestinoId: destino.id })
          } else {
            await deps.registrarTransferencia({ data: relogio.hoje(), valorCentavos: -saldo, descricao: `Cobertura do saldo negativo do bloco ${bloco.nome} ao desativar`, blocoOrigemId: destino.id, blocoDestinoId: id })
          }
        }
        const agora = relogio.agora()
        const novo: Bloco = { ...bloco, ativo: false, desativadoEm: agora, atualizadoEm: agora }
        await db.blocos.put(novo)
        await registrarAuditoria(db, { entidade: 'bloco', entidadeId: id, acao: 'desativado', resumo: `Bloco ${bloco.nome} desativado` }, agora)
        return novo
      })
    },

    async reativarBloco(id: Id): Promise<Bloco> {
      return db.transaction('rw', db.tables, async () => {
        const bloco = await exigirBloco(db, id)
        if (bloco.ativo) return bloco
        const agora = relogio.agora()
        const novo: Bloco = { ...bloco, ativo: true, atualizadoEm: agora }
        delete novo.desativadoEm
        await db.blocos.put(novo)
        await registrarAuditoria(db, { entidade: 'bloco', entidadeId: id, acao: 'reativado', resumo: `Bloco ${bloco.nome} reativado` }, agora)
        return novo
      })
    },

    /** Exclusão física: só se nada referenciar o bloco (lançamentos, rateios, cobranças, unidades com histórico). */
    async excluirBloco(id: Id): Promise<void> {
      await db.transaction('rw', db.tables, async () => {
        const bloco = await exigirBloco(db, id)
        if (await blocoReferenciado(db, id)) {
          throw new ErroDominio('REGRA', `O bloco ${bloco.nome} tem lançamentos ou cobranças. Desative-o em vez de excluir.`)
        }
        if ((await db.fechamentos.toArray()).some(f => f.saldos.some(s => s.blocoId === id))) throw new ErroDominio('MES_FECHADO', 'O bloco consta em fechamento. Desative-o em vez de excluir.')
        const unidades = await db.unidades.where('blocoId').equals(id).toArray()
        const ref = await unidadesReferenciadas(db, unidades.map((u) => u.id))
        if (ref.size > 0) throw new ErroDominio('REGRA', `Apartamentos do bloco ${bloco.nome} têm histórico. Desative-o em vez de excluir.`)
        await db.unidades.bulkDelete(unidades.map((u) => u.id))
        await db.blocos.delete(id)
        await registrarAuditoria(db, { entidade: 'bloco', entidadeId: id, acao: 'excluido', resumo: `Bloco ${bloco.nome} excluído` }, relogio.agora())
      })
    },

    async reordenarBlocos(idsNaOrdem: readonly Id[]): Promise<void> {
      await db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        let ordem = 1
        for (const id of idsNaOrdem) {
          const b = await exigirBloco(db, id)
          await db.blocos.put({ ...b, ordem: ordem++, atualizadoEm: agora })
        }
        await registrarAuditoria(db, { entidade: 'bloco', entidadeId: 'ordem', acao: 'reordenados', resumo: 'Ordem dos blocos alterada' }, agora)
      })
    },

    // ---------- Unidades ----------
    async atualizarUnidade(id: Id, entrada: DadosUnidade): Promise<Unidade> {
      const d = exigirValido(validarDadosUnidade(entrada))
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        const anterior = await exigirUnidade(db, id)
        const nova = mesclarUnidade(anterior, d, agora, camposParaLimpar(entrada))
        await db.unidades.put(nova)
        await registrarAuditoria(db, { entidade: 'unidade', entidadeId: id, acao: 'atualizada', resumo: `Apartamento ${nova.numero} alterado`, alteracoes: diferencas(anterior, nova, ['responsavel', 'telefone', 'email', 'isenta', 'observacoes']) }, agora)
        return nova
      })
    },

    /** Vários apartamentos em uma transação (modo tabela). */
    async atualizarUnidadesEmLote(itens: ReadonlyArray<{ id: Id; dados: DadosUnidade }>): Promise<number> {
      const validados = itens.map((i) => ({ id: i.id, dados: exigirValido(validarDadosUnidade(i.dados)), limpar: camposParaLimpar(i.dados) }))
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        for (const i of validados) await db.unidades.put(mesclarUnidade(await exigirUnidade(db, i.id), i.dados, agora, i.limpar))
        if (validados.length > 0) {
          await registrarAuditoria(db, { entidade: 'unidade', entidadeId: 'lote', acao: 'atualizadas', resumo: `${validados.length} apartamento(s) alterado(s) em lote` }, agora)
        }
        return validados.length
      })
    },

    /** Aplica linhas coladas de uma planilha (apto, responsável, telefone, e-mail) nas unidades do bloco. */
    async aplicarColagem(blocoId: Id, linhas: readonly LinhaColagemUnidade[]): Promise<{ aplicadas: number; naoEncontradas: string[] }> {
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        const unidades = await db.unidades.where('blocoId').equals(blocoId).toArray()
        const porNumero = new Map(unidades.map((u) => [u.numero, u]))
        const naoEncontradas: string[] = []
        let aplicadas = 0
        for (const linha of linhas) {
          const u = porNumero.get(linha.numero.trim())
          if (!u) {
            naoEncontradas.push(linha.numero)
            continue
          }
          const dados: DadosUnidade = {}
          if (linha.responsavel?.trim()) dados.responsavel = linha.responsavel.trim()
          if (linha.telefone?.trim()) dados.telefone = linha.telefone.trim()
          if (linha.email?.trim()) dados.email = linha.email.trim()
          await db.unidades.put(mesclarUnidade(u, exigirValido(validarDadosUnidade(dados)), agora))
          aplicadas++
        }
        if (aplicadas > 0) {
          await registrarAuditoria(db, { entidade: 'unidade', entidadeId: blocoId, acao: 'colagem', resumo: `${aplicadas} apartamento(s) atualizado(s) por colagem` }, agora)
        }
        return { aplicadas, naoEncontradas }
      })
    },

    // ---------- Taxas ----------
    /** Cria uma vigência; se já existir a mesma (quartos, vigenteDesde), atualiza o valor in place. */
    async definirTaxa(entrada: NovaTaxa): Promise<TaxaVigencia> {
      const d = exigirValido(validarNovaTaxa(entrada))
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        const existente = await db.taxas.where('[quartos+vigenteDesde]').equals([d.quartos, d.vigenteDesde]).first()
        let taxa: TaxaVigencia
        if (existente) {
          taxa = { ...existente, valorCentavos: d.valorCentavos }
          await db.taxas.put(taxa)
        } else {
          taxa = { id: novoId(), quartos: d.quartos, valorCentavos: d.valorCentavos, vigenteDesde: d.vigenteDesde, criadoEm: agora }
          await db.taxas.add(taxa)
        }
        await registrarAuditoria(db, { entidade: 'taxa', entidadeId: taxa.id, acao: existente ? 'atualizada' : 'criada', resumo: `Taxa ${d.quartos} quartos: ${formatarBRL(d.valorCentavos)} desde ${formatarMesCurto(d.vigenteDesde)}` }, agora)
        return taxa
      })
    },

    async removerTaxa(id: Id): Promise<void> {
      await db.transaction('rw', db.tables, async () => {
        const t = await db.taxas.get(id)
        if (!t) throw new ErroDominio('NAO_ENCONTRADO', 'Vigência de taxa não encontrada.')
        const usada = await db.cobrancas.filter((c) => c.taxaVigenciaId === id).count()
        if (usada > 0) throw new ErroDominio('REGRA', `Esta vigência foi usada em ${usada} cobrança(s) e não pode ser removida.`)
        await db.taxas.delete(id)
        await registrarAuditoria(db, { entidade: 'taxa', entidadeId: id, acao: 'removida', resumo: `Vigência de taxa removida (${t.quartos} quartos desde ${formatarMesCurto(t.vigenteDesde)})` }, relogio.agora())
      })
    },

    // ---------- Categorias ----------
    async criarCategoria(entrada: DadosCategoria): Promise<Categoria> {
      const d = exigirValido(validarDadosCategoria(entrada))
      return db.transaction('rw', db.tables, async () => {
        const agora = relogio.agora()
        await exigirNomeDeCategoriaDisponivel(d.nome, d.natureza)
        const ultima = await db.categorias.orderBy('ordem').last()
        const c: Categoria = { id: novoId(), nome: d.nome, natureza: d.natureza, ordem: (ultima?.ordem ?? 0) + 1, ativa: true, sistema: null }
        await db.categorias.add(c)
        await registrarAuditoria(db, { entidade: 'categoria', entidadeId: c.id, acao: 'criada', resumo: `Categoria "${c.nome}" criada` }, agora)
        return c
      })
    },

    async atualizarCategoria(id: Id, entrada: DadosCategoria): Promise<Categoria> {
      const d = exigirValido(validarDadosCategoria(entrada))
      return db.transaction('rw', db.tables, async () => {
        const atual = await exigirCategoria(db, id)
        if (atual.sistema && d.natureza !== atual.natureza) throw new ErroDominio('CATEGORIA_DE_SISTEMA', 'A natureza de uma categoria de sistema não pode mudar.')
        if (d.natureza !== atual.natureza && await db.lancamentos.where('categoriaId').equals(id).count() > 0) {
          throw new ErroDominio('REGRA', 'A natureza de uma categoria com lançamentos não pode mudar. Crie outra categoria para a nova natureza.')
        }
        await exigirNomeDeCategoriaDisponivel(d.nome, d.natureza, id)
        const nova: Categoria = { ...atual, nome: d.nome, natureza: d.natureza }
        await db.categorias.put(nova)
        await registrarAuditoria(db, { entidade: 'categoria', entidadeId: id, acao: 'atualizada', resumo: `Categoria "${nova.nome}" alterada` }, relogio.agora())
        return nova
      })
    },

    async definirCategoriaAtiva(id: Id, ativa: boolean): Promise<Categoria> {
      return db.transaction('rw', db.tables, async () => {
        const atual = await exigirCategoria(db, id)
        if (atual.sistema && !ativa) throw new ErroDominio('CATEGORIA_DE_SISTEMA', 'Categorias de sistema não podem ser desativadas.')
        const nova: Categoria = { ...atual, ativa }
        await db.categorias.put(nova)
        await registrarAuditoria(db, { entidade: 'categoria', entidadeId: id, acao: ativa ? 'reativada' : 'desativada', resumo: `Categoria "${nova.nome}" ${ativa ? 'reativada' : 'desativada'}` }, relogio.agora())
        return nova
      })
    },

    async excluirCategoria(id: Id): Promise<void> {
      await db.transaction('rw', db.tables, async () => {
        const c = await exigirCategoria(db, id)
        if (c.sistema) throw new ErroDominio('CATEGORIA_DE_SISTEMA', 'Categorias de sistema não podem ser removidas.')
        const usada = await db.lancamentos.where('categoriaId').equals(id).count()
        if (usada > 0) throw new ErroDominio('REGRA', `A categoria "${c.nome}" é usada em ${usada} lançamento(s). Desative-a em vez de excluir.`)
        await db.categorias.delete(id)
        await registrarAuditoria(db, { entidade: 'categoria', entidadeId: id, acao: 'excluida', resumo: `Categoria "${c.nome}" excluída` }, relogio.agora())
      })
    },
  }

  async function exigirNomeDeCategoriaDisponivel(nome: string, natureza: Categoria['natureza'], ignorarId?: Id): Promise<void> {
    const n = normalizarNome(nome)
    const existente = await db.categorias.filter((c) => c.id !== ignorarId && c.natureza === natureza && normalizarNome(c.nome) === n).first()
    if (existente) throw new ErroDominio('VALIDACAO', `Já existe a categoria "${existente.nome}".`)
  }
}

/** Campos textuais enviados como '' ou null na entrada bruta devem ser LIMPOS (o validador os transforma em ausentes). */
function camposParaLimpar(entrada: DadosUnidade): Set<string> {
  const limpar = new Set<string>()
  for (const campo of ['responsavel', 'telefone', 'email', 'observacoes'] as const) {
    const v = (entrada as Record<string, unknown>)[campo]
    if (v === null || (typeof v === 'string' && v.trim() === '')) limpar.add(campo)
  }
  return limpar
}

function mesclarUnidade(u: Unidade, d: DadosUnidade, agora: string, limpar: ReadonlySet<string> = new Set()): Unidade {
  const nova: Unidade = { ...u, atualizadoEm: agora }
  if (d.isenta !== undefined) nova.isenta = d.isenta
  for (const campo of ['responsavel', 'telefone', 'email', 'observacoes'] as const) {
    if (limpar.has(campo)) {
      delete nova[campo]
      continue
    }
    if (d[campo] !== undefined) nova[campo] = d[campo]
  }
  return nova
}

export type ServicoEstrutura = ReturnType<typeof criarServicoEstrutura>
