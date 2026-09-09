// Cabeçalho/rodapé que só aparecem na impressão (window.print → "Salvar como PDF").
import { relogioApp } from '../../dados/instancia'
import { formatarData } from '../../dominio/datas'
import { useEstrutura } from '../hooks'

export function CabecalhoImpressao({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  const { condominio } = useEstrutura()
  const agora = relogioApp.agora()
  return (
    <div className="cabecalho-impressao">
      <h1>{condominio?.nome ?? 'Condomínio'}</h1>
      {condominio?.endereco && <p>{condominio.endereco}</p>}
      {condominio?.cnpj && <p>CNPJ {condominio.cnpj}</p>}
      <p>
        <strong>{titulo}</strong>
        {subtitulo ? ` — ${subtitulo}` : ''}
      </p>
      <p>
        Emitido em {formatarData(agora.slice(0, 10))} {agora.slice(11, 16)}
      </p>
    </div>
  )
}

export function RodapeImpressao({ assinatura = true }: { assinatura?: boolean }) {
  const { condominio } = useEstrutura()
  return (
    <div className="rodape-impressao">
      {assinatura && <div className="assinatura">{condominio?.sindico ? `${condominio.sindico} — Síndico(a)` : 'Síndico(a)'}</div>}
      <p>Relatórios históricos não mudam por alterações na estrutura de blocos; rateios são gravados no momento de cada lançamento.</p>
    </div>
  )
}

export function BotaoImprimir({ rotulo = 'Imprimir / PDF' }: { rotulo?: string }) {
  return (
    <button type="button" className="botao nao-imprimir" onClick={() => window.print()}>
      🖨 {rotulo}
    </button>
  )
}
