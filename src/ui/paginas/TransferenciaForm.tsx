// Transferência de caixa entre blocos (não é receita nem despesa do condomínio).
import { useState } from 'react'
import { relogioApp, servicos } from '../../dados/instancia'
import { mesDe } from '../../dominio/datas'
import type { Centavos, DataISO, Id } from '../../dominio/tipos'
import { Campo, CampoData, CampoMoeda } from '../componentes/campos'
import { useAcao, useEstrutura } from '../hooks'
import { navegar, voltar } from '../rotas'

export function TransferenciaForm() {
  const { blocos, blocosAtivos } = useEstrutura()
  const { executar, ocupado } = useAcao()
  const [f, setF] = useState({ blocoOrigemId: '' as Id, blocoDestinoId: '' as Id, valorCentavos: 0 as Centavos, data: relogioApp.hoje() as DataISO, descricao: '', observacoes: '' })
  return (
    <form
      className="formulario"
      onSubmit={async (e) => {
        e.preventDefault()
        const r = await executar(() => servicos.lancamentos.registrarTransferencia({ ...f, competencia: mesDe(f.data) }), 'Transferência registrada.')
        if (r) navegar({ nome: 'lancamento', id: r.id })
      }}
    >
      <div className="cabecalho-pagina">
        <h1>Transferir entre blocos</h1>
      </div>
      <p className="texto-suave">Move dinheiro do caixa de um bloco para outro. Não altera o total do condomínio.</p>
      <div className="linha-campos">
        <Campo rotulo="Do bloco (origem)">
          <select value={f.blocoOrigemId} onChange={(e) => setF({ ...f, blocoOrigemId: e.target.value })} required>
            <option value="">Selecione…</option>
            {blocos.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
                {b.ativo ? '' : ' (desativado)'}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Para o bloco (destino)">
          <select value={f.blocoDestinoId} onChange={(e) => setF({ ...f, blocoDestinoId: e.target.value })} required>
            <option value="">Selecione…</option>
            {blocosAtivos
              .filter((b) => b.id !== f.blocoOrigemId)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nome}
                </option>
              ))}
          </select>
        </Campo>
      </div>
      <div className="linha-campos">
        <Campo rotulo="Valor">
          <CampoMoeda valor={f.valorCentavos} onChange={(v) => setF({ ...f, valorCentavos: v })} autoFocus />
        </Campo>
        <Campo rotulo="Data">
          <CampoData valor={f.data} onChange={(d) => setF({ ...f, data: d })} />
        </Campo>
      </div>
      <Campo rotulo="Descrição">
        <input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} required placeholder="Ex.: Ajuste de caixa após obra" />
      </Campo>
      <Campo rotulo="Observações (opcional)">
        <textarea rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
      </Campo>
      <div className="acoes">
        <button className="botao botao--primario" disabled={ocupado}>
          Registrar transferência
        </button>
        <button type="button" className="botao botao--link" onClick={voltar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
