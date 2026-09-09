// Campos de formulário: moeda (caixa eletrônico), data, competência, período.
import { Children, cloneElement, isValidElement, useId, type ReactNode } from 'react'
import { relogioApp } from '../../dados/instancia'
import { formatarData, formatarMes, mesAnterior, mesDe, mesSeguinte, montarMes, partesDoMes, periodoDoAno, periodoDoMes } from '../../dominio/datas'
import { centavosDeDigitos, formatarValor } from '../../dominio/dinheiro'
import type { Centavos, DataISO, MesISO, Periodo } from '../../dominio/tipos'

export function Campo({ rotulo, erro, ajuda, children, inline }: { rotulo: ReactNode; erro?: string; ajuda?: ReactNode; children: ReactNode; inline?: boolean }) {
  const id = useId()
  let controleId: string | undefined
  function vincular(nos: ReactNode): ReactNode {
    return Children.map(nos, no => {
      if (!isValidElement<{ id?: string; children?: ReactNode }>(no) || controleId) return no
      if (no.type === 'input' || no.type === 'select' || no.type === 'textarea' || no.type === CampoMoeda || no.type === CampoData || no.type === CampoMes) {
        controleId = no.props.id ?? id
        return cloneElement(no, { id: controleId })
      }
      if (no.props.children) return cloneElement(no, { children: vincular(no.props.children) })
      return no
    })
  }
  const conteudo = vincular(children)
  return (
    <div role={controleId ? undefined : 'group'} aria-labelledby={controleId ? undefined : `${id}-rotulo`} className={`campo${erro ? ' campo--erro' : ''}${inline ? ' campo--inline' : ''}`}>
      <label id={`${id}-rotulo`} htmlFor={controleId} className="campo__rotulo">{rotulo}</label>
      {conteudo}
      {erro && <span className="campo__erro">{erro}</span>}
      {!erro && ajuda && <span className="campo__ajuda">{ajuda}</span>}
    </div>
  )
}

/** Digita-se só números: "12345" vira R$ 123,45. Nunca usa ponto flutuante. */
export function CampoMoeda({
  valor,
  onChange,
  autoFocus,
  id,
  permitirNegativo,
  disabled,
}: {
  valor: Centavos
  onChange: (c: Centavos) => void
  autoFocus?: boolean
  id?: string
  permitirNegativo?: boolean
  disabled?: boolean
}) {
  const negativo = valor < 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="texto-suave">R$</span>
      <input
        id={id}
        className="campo-moeda"
        inputMode="numeric"
        autoFocus={autoFocus}
        disabled={disabled}
        value={formatarValor(Math.abs(valor))}
        onChange={(e) => {
          const c = centavosDeDigitos(e.target.value)
          onChange(c === 0 ? 0 : negativo ? -c : c)
        }}
        onKeyDown={(e) => {
          if (permitirNegativo && e.key === '-') {
            e.preventDefault()
            onChange(valor === 0 ? 0 : -valor)
          }
        }}
        aria-label={id ? undefined : 'Valor em reais'}
      />
      {permitirNegativo && (
        <button type="button" className="botao botao--pequeno" onClick={() => onChange(valor === 0 ? 0 : -valor)} title="Inverter sinal">
          {negativo ? '−' : '+'}
        </button>
      )}
    </div>
  )
}

/** <input type=date> nativo + texto dd/mm/aaaa ao lado (o nativo segue o idioma do navegador). */
export function CampoData({ valor, onChange, id, min, max, autoFocus, disabled }: { valor: DataISO; onChange: (d: DataISO) => void; id?: string; min?: DataISO; max?: DataISO; autoFocus?: boolean; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input id={id} type="date" value={valor} min={min} max={max} autoFocus={autoFocus} disabled={disabled} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <span className="texto-suave texto-pequeno">{valor ? formatarData(valor) : ''}</span>
    </div>
  )
}

export function SeletorCompetencia({ valor, onChange, permitirFuturo = true }: { valor: MesISO; onChange: (m: MesISO) => void; permitirFuturo?: boolean }) {
  const hoje = mesDe(relogioApp.hoje())
  return (
    <div className="seletor-competencia">
      <button type="button" className="botao botao--pequeno" onClick={() => onChange(mesAnterior(valor))} aria-label="Mês anterior">
        ‹
      </button>
      <span className="seletor-competencia__mes">{formatarMes(valor)}</span>
      <button type="button" className="botao botao--pequeno" disabled={!permitirFuturo && valor >= hoje} onClick={() => onChange(mesSeguinte(valor))} aria-label="Próximo mês">
        ›
      </button>
    </div>
  )
}

export function CampoMes({ valor, onChange, id, disabled }: { valor: MesISO; onChange: (m: MesISO) => void; id?: string; disabled?: boolean }) {
  return <input id={id} type="month" value={valor} disabled={disabled} onChange={(e) => e.target.value && onChange(e.target.value)} />
}

export type PeriodoSelecionado = { tipo: 'mes'; mes: MesISO } | { tipo: 'ano'; ano: number } | { tipo: 'intervalo'; inicio: DataISO; fim: DataISO }

export function periodoDe(sel: PeriodoSelecionado): Periodo {
  if (sel.tipo === 'mes') return periodoDoMes(sel.mes)
  if (sel.tipo === 'ano') return periodoDoAno(sel.ano)
  return { inicio: sel.inicio, fim: sel.fim }
}

export function tituloDoPeriodo(sel: PeriodoSelecionado): string {
  if (sel.tipo === 'mes') return formatarMes(sel.mes)
  if (sel.tipo === 'ano') return `Ano ${sel.ano}`
  return `${formatarData(sel.inicio)} a ${formatarData(sel.fim)}`
}

export function SeletorPeriodo({ valor, onChange }: { valor: PeriodoSelecionado; onChange: (p: PeriodoSelecionado) => void }) {
  const id = useId()
  const mesBase = valor.tipo === 'mes' ? valor.mes : valor.tipo === 'ano' ? montarMes(valor.ano, 1) : mesDe(valor.inicio)
  const { ano } = partesDoMes(mesBase)
  return (
    <div className="linha-campos" style={{ alignItems: 'flex-end' }}>
      <Campo rotulo="Período">
        <div className="chips">
          {(['mes', 'ano', 'intervalo'] as const).map((tipo) => (
            <button
              key={tipo}
              type="button"
              className={`chip${valor.tipo === tipo ? ' chip--ativo' : ''}`}
              onClick={() => {
                if (tipo === 'mes') onChange({ tipo, mes: mesBase })
                else if (tipo === 'ano') onChange({ tipo, ano })
                else onChange({ tipo, inicio: periodoDoMes(mesBase).inicio, fim: periodoDoMes(mesBase).fim })
              }}
            >
              {tipo === 'mes' ? 'Mês' : tipo === 'ano' ? 'Ano' : 'Intervalo'}
            </button>
          ))}
        </div>
      </Campo>
      {valor.tipo === 'mes' && (
        <Campo rotulo="Mês">
          <SeletorCompetencia valor={valor.mes} onChange={(mes) => onChange({ tipo: 'mes', mes })} />
        </Campo>
      )}
      {valor.tipo === 'ano' && (
        <Campo rotulo="Ano">
          <input id={id} type="number" min={2000} max={2100} value={valor.ano} onChange={(e) => onChange({ tipo: 'ano', ano: Number(e.target.value) || ano })} style={{ width: 100 }} />
        </Campo>
      )}
      {valor.tipo === 'intervalo' && (
        <>
          <Campo rotulo="De">
            <CampoData valor={valor.inicio} onChange={(inicio) => onChange({ ...valor, inicio })} />
          </Campo>
          <Campo rotulo="Até">
            <CampoData valor={valor.fim} onChange={(fim) => onChange({ ...valor, fim })} />
          </Campo>
        </>
      )}
    </div>
  )
}
