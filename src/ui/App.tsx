import { useState } from 'react'
import { Shell } from './Shell'
import { useEstrutura, useOnboardingConcluido } from './hooks'
import { Arquivo } from './paginas/Arquivo'
import { Backup } from './paginas/Backup'
import { Avancado } from './paginas/Avancado'
import { Cobrancas } from './paginas/Cobrancas'
import { ExtratoUnidade } from './paginas/ExtratoUnidade'
import { Inicio } from './paginas/Inicio'
import { Relatorios } from './paginas/Relatorios'
import { Estrutura } from './paginas/Estrutura'
import { Inadimplencia } from './paginas/Inadimplencia'
import { LancamentoDetalhe } from './paginas/LancamentoDetalhe'
import { LancamentoForm } from './paginas/LancamentoForm'
import { Lancamentos } from './paginas/Lancamentos'
import { TransferenciaForm } from './paginas/TransferenciaForm'
import { Onboarding } from './paginas/Onboarding'
import { UnidadeDetalhe, Unidades } from './paginas/Unidades'
import { useRota, type Rota } from './rotas'

const CHAVE_ADIADO = 'sindico:onboardingAdiado'

function Pagina({ rota }: { rota: Rota }) {
  switch (rota.nome) {
    case 'inicio':
      return <Inicio />
    case 'lancamentos':
      return <Lancamentos />
    case 'lancamentoNovo':
      return <LancamentoForm key={rota.natureza ?? 'DESPESA'} natureza={rota.natureza} />
    case 'lancamento':
      return <LancamentoDetalhe key={rota.id} id={rota.id} />
    case 'transferenciaNova':
      return <TransferenciaForm />
    case 'cobrancas':
      return <Cobrancas competencia={rota.competencia} />
    case 'inadimplencia':
      return <Inadimplencia />
    case 'unidades':
      return <Unidades blocoId={rota.blocoId} modo={rota.modo} />
    case 'unidade':
      return <UnidadeDetalhe id={rota.id} />
    case 'relatorios':
      return <Relatorios />
    case 'extratoUnidade':
      return <ExtratoUnidade id={rota.id} />
    case 'arquivo':
      return <Arquivo />
    case 'estrutura':
      return <Estrutura aba={rota.aba} />
    case 'backup':
      return <Backup />
    case 'avancado':
      return <Avancado aba={rota.aba} />
  }
}

export function App() {
  const rota = useRota()
  const concluido = useOnboardingConcluido()
  const { condominio, blocos, carregando } = useEstrutura()
  const [adiado, setAdiado] = useState(() => {
    try {
      return sessionStorage.getItem(CHAVE_ADIADO) === '1'
    } catch {
      return false
    }
  })
  function adiar() {
    try {
      sessionStorage.setItem(CHAVE_ADIADO, '1')
    } catch {
      /* ignorado */
    }
    setAdiado(true)
  }
  return (
    <Shell>
      <Pagina rota={rota} />
      {concluido === false && !adiado && !carregando && condominio && <Onboarding condominio={condominio} blocos={blocos} onAdiar={adiar} />}
    </Shell>
  )
}
