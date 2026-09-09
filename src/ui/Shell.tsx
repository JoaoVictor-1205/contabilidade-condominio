// Casca: menu lateral + área de conteúdo.
import type { ReactNode } from 'react'
import { VERSAO_APP } from '../dados/db'
import { formatarData } from '../dominio/datas'
import { relogioApp } from '../dados/instancia'
import { useEstrutura, useLembreteBackup } from './hooks'
import { paraHash, useRota, type Rota } from './rotas'

const ITENS: Array<{ rota: Rota; rotulo: string; grupo: Rota['nome'][] }> = [
  { rota: { nome: 'inicio' }, rotulo: 'Início', grupo: ['inicio'] },
  { rota: { nome: 'lancamentos' }, rotulo: 'Lançamentos', grupo: ['lancamentos', 'lancamentoNovo', 'lancamento', 'transferenciaNova'] },
  { rota: { nome: 'cobrancas' }, rotulo: 'Cobranças', grupo: ['cobrancas'] },
  { rota: { nome: 'inadimplencia' }, rotulo: 'Inadimplência', grupo: ['inadimplencia'] },
  { rota: { nome: 'unidades' }, rotulo: 'Apartamentos', grupo: ['unidades', 'unidade'] },
  { rota: { nome: 'relatorios' }, rotulo: 'Relatórios', grupo: ['relatorios', 'extratoUnidade'] },
  { rota: { nome: 'arquivo' }, rotulo: 'Arquivo', grupo: ['arquivo'] },
  { rota: { nome: 'estrutura' }, rotulo: 'Estrutura', grupo: ['estrutura'] },
  { rota: { nome: 'backup' }, rotulo: 'Backup', grupo: ['backup'] },
  { rota: { nome: 'avancado' }, rotulo: 'Avançado', grupo: ['avancado'] },
]

export function Shell({ children }: { children: ReactNode }) {
  const rota = useRota()
  const { condominio } = useEstrutura()
  const lembrete = useLembreteBackup()
  return (
    <div className="shell">
      <nav className="menu nao-imprimir" aria-label="Menu principal">
        <div className="menu__titulo">
          {condominio?.nome ?? 'Condomínio'}
          <small>Contabilidade do síndico</small>
        </div>
        {ITENS.map((item) => (
          <a key={item.rotulo} href={paraHash(item.rota)} className={`menu__link${item.grupo.includes(rota.nome) ? ' menu__link--ativo' : ''}`}>
            {item.rotulo}
            {item.rota.nome === 'backup' && lembrete.nivel && <span aria-label="Backup pendente" style={{ float: 'right' }}>{lembrete.nivel === 'critico' ? '🔴' : '🟡'}</span>}
          </a>
        ))}
        <div className="menu__rodape">
          v{VERSAO_APP} · {formatarData(relogioApp.hoje())}
        </div>
      </nav>
      <main className="conteudo">{children}</main>
    </div>
  )
}
