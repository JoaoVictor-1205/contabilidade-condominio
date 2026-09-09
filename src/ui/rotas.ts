// Roteador por hash (#/...): funciona em file:// e mantém o botão voltar. Sem biblioteca.
import { useMemo, useSyncExternalStore } from 'react'
import type { Id, MesISO } from '../dominio/tipos'

export type AbaEstrutura = 'condominio' | 'blocos' | 'taxas' | 'categorias'
export type AbaAvancado = 'fechamento' | 'integridade' | 'auditoria' | 'manutencao'

export type Rota =
  | { nome: 'inicio' }
  | { nome: 'lancamentos' }
  | { nome: 'lancamentoNovo'; natureza?: 'RECEITA' | 'DESPESA' }
  | { nome: 'lancamento'; id: Id }
  | { nome: 'transferenciaNova' }
  | { nome: 'cobrancas'; competencia?: MesISO }
  | { nome: 'inadimplencia' }
  | { nome: 'unidades'; blocoId?: Id; modo?: 'grade' | 'tabela' }
  | { nome: 'unidade'; id: Id }
  | { nome: 'relatorios' }
  | { nome: 'extratoUnidade'; id: Id }
  | { nome: 'arquivo' }
  | { nome: 'estrutura'; aba?: AbaEstrutura }
  | { nome: 'backup' }
  | { nome: 'avancado'; aba?: AbaAvancado }

const ABAS: ReadonlySet<string> = new Set(['condominio', 'blocos', 'taxas', 'categorias'])

export function lerRota(hash: string): Rota {
  const limpo = hash.replace(/^#\/?/, '')
  const [caminho = '', query = ''] = limpo.split('?')
  const partes = caminho.split('/').filter(Boolean)
  const q = new URLSearchParams(query)
  const p1 = partes[1]
  switch (partes[0]) {
    case undefined:
      return { nome: 'inicio' }
    case 'lancamentos': {
      if (p1 === 'novo') {
        const n = q.get('natureza')
        return n === 'RECEITA' || n === 'DESPESA' ? { nome: 'lancamentoNovo', natureza: n } : { nome: 'lancamentoNovo' }
      }
      if (p1 === 'transferencia') return { nome: 'transferenciaNova' }
      if (p1) return { nome: 'lancamento', id: p1 }
      return { nome: 'lancamentos' }
    }
    case 'cobrancas': {
      const c = q.get('competencia')
      return c ? { nome: 'cobrancas', competencia: c } : { nome: 'cobrancas' }
    }
    case 'inadimplencia':
      return { nome: 'inadimplencia' }
    case 'unidades': {
      if (p1) return { nome: 'unidade', id: p1 }
      const r: Rota = { nome: 'unidades' }
      const b = q.get('bloco')
      const m = q.get('modo')
      if (b) r.blocoId = b
      if (m === 'grade' || m === 'tabela') r.modo = m
      return r
    }
    case 'relatorios':
      if (p1 === 'unidade' && partes[2]) return { nome: 'extratoUnidade', id: partes[2] }
      return { nome: 'relatorios' }
    case 'arquivo':
      return { nome: 'arquivo' }
    case 'estrutura':
      return p1 && ABAS.has(p1) ? { nome: 'estrutura', aba: p1 as AbaEstrutura } : { nome: 'estrutura' }
    case 'backup':
      return { nome: 'backup' }
    case 'avancado':
      return p1 && ['fechamento', 'integridade', 'auditoria', 'manutencao'].includes(p1) ? { nome: 'avancado', aba: p1 as AbaAvancado } : { nome: 'avancado' }
    default:
      return { nome: 'inicio' }
  }
}

export function paraHash(r: Rota): string {
  switch (r.nome) {
    case 'inicio':
      return '#/'
    case 'lancamentos':
      return '#/lancamentos'
    case 'lancamentoNovo':
      return r.natureza ? `#/lancamentos/novo?natureza=${r.natureza}` : '#/lancamentos/novo'
    case 'lancamento':
      return `#/lancamentos/${r.id}`
    case 'transferenciaNova':
      return '#/lancamentos/transferencia'
    case 'cobrancas':
      return r.competencia ? `#/cobrancas?competencia=${r.competencia}` : '#/cobrancas'
    case 'inadimplencia':
      return '#/inadimplencia'
    case 'unidades': {
      const q = new URLSearchParams()
      if (r.blocoId) q.set('bloco', r.blocoId)
      if (r.modo) q.set('modo', r.modo)
      const s = q.toString()
      return s ? `#/unidades?${s}` : '#/unidades'
    }
    case 'unidade':
      return `#/unidades/${r.id}`
    case 'relatorios':
      return '#/relatorios'
    case 'extratoUnidade':
      return `#/relatorios/unidade/${r.id}`
    case 'arquivo':
      return '#/arquivo'
    case 'estrutura':
      return r.aba ? `#/estrutura/${r.aba}` : '#/estrutura'
    case 'backup':
      return '#/backup'
    case 'avancado':
      return r.aba ? `#/avancado/${r.aba}` : '#/avancado'
  }
}

export function navegar(r: Rota): void {
  location.hash = paraHash(r)
}

export function voltar(): void {
  history.back()
}

function inscrever(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

/** Snapshot primitivo (string) para não disparar o aviso "getSnapshot should be cached" do React 19. */
export function useRota(): Rota {
  const hash = useSyncExternalStore(inscrever, () => location.hash, () => '')
  return useMemo(() => lerRota(hash), [hash])
}
