import { mesDe, mesSeguinte, periodoDoMes } from './datas'
import { calcularDemonstrativo } from './demonstrativo'
import type { Anexo, Bloco, Categoria, Cobranca, Condominio, DataISO, Fechamento, Id, Lancamento, TaxaVigencia, Unidade } from './tipos'

export interface Problema {
  nivel: 'ERRO' | 'AVISO'
  codigo: string
  mensagem: string
  entidade?: 'lancamento' | 'cobranca' | 'unidade' | 'bloco' | 'anexo' | 'fechamento' | 'taxa' | 'categoria'
  entidadeId?: Id
}

export interface SnapshotIntegridade {
  condominio: Condominio | undefined
  blocos: readonly Bloco[]
  unidades: readonly Unidade[]
  taxas: readonly TaxaVigencia[]
  categorias: readonly Categoria[]
  lancamentos: readonly Lancamento[]
  cobrancas: readonly Cobranca[]
  anexos: readonly Anexo[]
  idsAnexosBlob: readonly Id[]
  fechamentos: readonly Fechamento[]
  hoje: DataISO
}

/** Diagnóstico puro: aponta inconsistências sem alterar nem reconstruir registros. */
export function verificarIntegridade(s: SnapshotIntegridade): Problema[] {
  const problemas: Problema[] = []
  function apontar(codigo: string, mensagem: string, entidade?: Problema['entidade'], entidadeId?: Id, nivel: Problema['nivel'] = 'ERRO') {
    problemas.push({ codigo, mensagem, entidade, entidadeId, nivel })
  }
  const blocos = new Map(s.blocos.map(b => [b.id, b]))
  const unidades = new Map(s.unidades.map(u => [u.id, u]))
  const categorias = new Map(s.categorias.map(c => [c.id, c]))
  const lancamentos = new Map(s.lancamentos.map(l => [l.id, l]))
  const cobrancas = new Map(s.cobrancas.map(c => [c.id, c]))
  const estornos = new Map<Id, Lancamento[]>()
  const juros = new Map<Id, number>()
  const vigente = (l: Lancamento) => l.status === 'ATIVO' && l.tipo === 'NORMAL' && !l.estornadoPorId
  if (!s.condominio) apontar('CONDOMINIO_AUSENTE', 'Cadastro do condomínio ausente.')
  for (const sistema of ['TAXA', 'JUROS', 'TRANSFERENCIA'] as const) {
    if (s.categorias.filter(c => c.sistema === sistema).length !== 1) apontar('CATEGORIA_SISTEMA', `Deve existir uma categoria de sistema ${sistema}.`, 'categoria')
  }
  for (const l of s.lancamentos) {
    if (l.status !== 'ATIVO') continue
    const erro = (codigo: string, mensagem: string) => apontar(codigo, mensagem, 'lancamento', l.id)
    const afetados: Id[] = []
    if (l.natureza === 'TRANSFERENCIA') {
      if (!l.blocoId || !l.blocoOrigemId || l.blocoId === l.blocoOrigemId || !blocos.has(l.blocoId) || !blocos.has(l.blocoOrigemId)) erro('TRANSFERENCIA_INVALIDA', 'Transferência exige dois blocos distintos existentes.')
      if (l.blocoId) afetados.push(l.blocoId)
      if (l.blocoOrigemId) afetados.push(l.blocoOrigemId)
    } else if (l.escopoTipo === 'GERAL') {
      if (!l.rateio || l.rateio.cotas.length === 0 || l.rateio.cotas.reduce((n, c) => n + c.valorCentavos, 0) !== l.valorCentavos) erro('RATEIO_DIVERGENTE', 'A soma das cotas do rateio deve ser igual ao valor do lançamento.')
      const ids = l.rateio?.cotas.map(c => c.blocoId) ?? []
      if (new Set(ids).size !== ids.length || ids.some(id => !blocos.has(id))) erro('RATEIO_BLOCOS', 'Rateio com bloco inexistente ou repetido.')
      afetados.push(...ids)
    } else {
      if (!l.blocoId || !blocos.has(l.blocoId)) erro('BLOCO_AUSENTE', 'Bloco do lançamento inexistente.')
      if (l.blocoId) afetados.push(l.blocoId)
      if (l.escopoTipo === 'UNIDADE' && (!l.unidadeId || !unidades.has(l.unidadeId) || unidades.get(l.unidadeId)?.blocoId !== l.blocoId)) erro('UNIDADE_BLOCO', 'Apartamento inexistente ou pertencente a outro bloco.')
    }
    if (s.condominio && l.data < `${s.condominio.inicioContabil}-01`) erro('ANTES_INICIO_CONTABIL', 'Lançamento anterior ao início contábil.')
    if (afetados.some(id => { const b = blocos.get(id); return b && l.data < b.dataSaldoInicial })) erro('ANTES_SALDO_INICIAL', 'Lançamento anterior ao saldo inicial de um bloco afetado.')
    if (l.mes !== mesDe(l.data)) erro('MES_DIVERGENTE', 'Mês do lançamento diferente do mês de sua data.')
    const categoria = categorias.get(l.categoriaId)
    if (!categoria || categoria.natureza !== l.natureza) erro('CATEGORIA_INVALIDA', 'Categoria inexistente ou com natureza diferente do lançamento.')
    if (categoria?.sistema === 'TAXA' || categoria?.sistema === 'JUROS') {
      if (!l.cobrancaId) apontar('PAGAMENTO_SEM_COBRANCA', 'Taxa ou juros sem vínculo com cobrança.', 'lancamento', l.id, 'AVISO')
      else if (vigente(l)) {
        const c = cobrancas.get(l.cobrancaId)
        if (!c || c.status !== 'PAGA' || c.blocoId !== l.blocoId || c.unidadeId !== l.unidadeId) erro('PAGAMENTO_COBRANCA', 'Pagamento sem cobrança paga correspondente.')
        if (categoria.sistema === 'TAXA' && (c?.lancamentoId !== l.id || c.valorPagoCentavos !== l.valorCentavos || c.pagaEm !== l.data)) erro('TAXA_DIVERGENTE', 'Vínculo, valor ou data da taxa divergente da cobrança.')
        if (categoria.sistema === 'JUROS') juros.set(l.cobrancaId, (juros.get(l.cobrancaId) ?? 0) + l.valorCentavos)
      }
    }
    if (l.tipo === 'ESTORNO') {
      const original = l.estornaLancamentoId ? lancamentos.get(l.estornaLancamentoId) : undefined
      if (!original || original.status !== 'ATIVO' || original.tipo !== 'NORMAL' || original.estornadoPorId !== l.id || l.estornadoPorId) erro('ESTORNO_VINCULO', 'Estorno sem vínculo recíproco com um original ativo.')
      if (original) {
        if (l.data < original.data) erro('ESTORNO_DATA', 'Estorno anterior ao lançamento original.')
        const campos = ['natureza', 'escopoTipo', 'blocoId', 'blocoOrigemId', 'unidadeId', 'valorCentavos', 'categoriaId', 'competencia', 'cobrancaId', 'rateio'] as const
        if (campos.some(c => JSON.stringify(l[c]) !== JSON.stringify(original[c]))) erro('ESTORNO_CONTEUDO', 'Estorno não reproduz os valores, competência e rateio do original.')
        estornos.set(original.id, [...(estornos.get(original.id) ?? []), l])
      }
    } else {
      if (l.estornaLancamentoId) erro('ORIGINAL_VINCULO', 'Lançamento normal não pode estornar outro lançamento.')
      if (l.estornadoPorId) {
        const e = lancamentos.get(l.estornadoPorId)
        if (!e || e.status !== 'ATIVO' || e.tipo !== 'ESTORNO' || e.estornaLancamentoId !== l.id) erro('ORIGINAL_ESTORNO', 'Original aponta para estorno ausente, excluído ou não recíproco.')
      }
    }
    const fechamento = s.fechamentos.find(f => f.mes === l.mes)
    if (fechamento && l.atualizadoEm > fechamento.fechadoEm) apontar('ALTERADO_APOS_FECHAMENTO', 'Registro atualizado depois do fechamento; confira a auditoria (pode ser vínculo de estorno).', 'lancamento', l.id, 'AVISO')
  }
  for (const [id, lista] of estornos) if (lista.length > 1) apontar('ESTORNO_DUPLICADO', 'Original com mais de um estorno ativo.', 'lancamento', id)
  for (const c of s.cobrancas) {
    if (c.status === 'PAGA') {
      const l = c.lancamentoId ? lancamentos.get(c.lancamentoId) : undefined
      if (!l || !vigente(l) || l.cobrancaId !== c.id || categorias.get(l.categoriaId)?.sistema !== 'TAXA' || c.valorPagoCentavos !== l.valorCentavos || c.pagaEm !== l.data) apontar('COBRANCA_PAGA', 'Cobrança paga sem lançamento de taxa válido com mesmo valor e data.', 'cobranca', c.id)
    }
    if ((juros.get(c.id) ?? 0) !== c.jurosCentavos) apontar('JUROS_DIVERGENTES', 'Juros da cobrança diferentes da soma dos lançamentos de juros vigentes.', 'cobranca', c.id)
  }
  function duplicados<T extends { id: Id }>(lista: readonly T[], chave: (item: T) => string, codigo: string, entidade: Problema['entidade']) {
    const vistos = new Set<string>()
    for (const item of lista) {
      const k = chave(item)
      if (vistos.has(k)) apontar(codigo, `Registro duplicado: ${k}.`, entidade, item.id)
      vistos.add(k)
    }
  }
  duplicados(s.unidades, u => `${u.blocoId}/${u.numero}`, 'UNIDADE_DUPLICADA', 'unidade')
  duplicados(s.taxas, t => `${t.quartos}/${t.vigenteDesde}`, 'TAXA_DUPLICADA', 'taxa')
  duplicados(s.cobrancas, c => `${c.unidadeId}/${c.competencia}`, 'COBRANCA_DUPLICADA', 'cobranca')
  const blobs = new Set(s.idsAnexosBlob)
  const anexos = new Set(s.anexos.map(a => a.id))
  for (const a of s.anexos) if (!blobs.has(a.id)) apontar('ANEXO_SEM_BLOB', `Arquivo ausente: ${a.nome}. Complete a restauração com o backup correspondente.`, 'anexo', a.id)
  for (const id of blobs) if (!anexos.has(id)) apontar('BLOB_ORFAO', 'Arquivo binário sem metadados de anexo.', 'anexo', id)
  let esperado = s.condominio?.inicioContabil
  for (const f of [...s.fechamentos].sort((a, b) => a.mes.localeCompare(b.mes))) {
    if (f.mes !== esperado || f.mes >= mesDe(s.hoje)) apontar('FECHAMENTO_SEQUENCIA', 'Fechamentos fora da sequência ou mês ainda não encerrado.', 'fechamento', f.mes)
    esperado = mesSeguinte(f.mes)
    const dem = calcularDemonstrativo({ blocos: s.blocos.map(b => ({ ...b, ativo: true })), categorias: s.categorias, lancamentos: s.lancamentos, periodo: periodoDoMes(f.mes), base: 'data', hoje: s.hoje, agora: f.fechadoEm })
    const saldos = new Map(dem.linhas.map(l => [l.blocoId, l.saldoFinal]))
    const gravados = new Set(f.saldos.map(l => l.blocoId))
    if (dem.total.saldoFinal !== f.saldoGeralCentavos || dem.lancamentos.length !== f.qtdLancamentos || dem.conferenciaCentavos !== 0 || gravados.size !== f.saldos.length || f.saldos.some(l => saldos.get(l.blocoId) !== l.saldoFinalCentavos) || dem.linhas.some(l => !gravados.has(l.blocoId) && l.saldoFinal !== 0)) {
      apontar('FECHAMENTO_DIVERGENTE', 'Saldos ou quantidade de lançamentos diferentes do fechamento gravado.', 'fechamento', f.mes)
    }
  }
  return problemas
}
