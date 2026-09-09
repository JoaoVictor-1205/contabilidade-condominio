// Primeiro uso (~2 min): mês inicial, dados do condomínio, taxas por tipo e saldo inicial por bloco.
import { useEffect, useState } from 'react'
import { servicos } from '../../dados/instancia'
import { formatarMes, mesDe, primeiraDataDoMes } from '../../dominio/datas'
import { formatarBRL } from '../../dominio/dinheiro'
import type { Bloco, Centavos, Condominio, MesISO } from '../../dominio/tipos'
import { Campo, CampoMes, CampoMoeda } from '../componentes/campos'
import { Modal } from '../componentes/comuns'
import { useAcao, useEstrutura } from '../hooks'
import { navegar } from '../rotas'

function nomeDoNavegador(): string {
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return 'Microsoft Edge'
  if (/Chrome\//.test(ua)) return 'Google Chrome'
  if (/Firefox\//.test(ua)) return 'Firefox'
  return 'este navegador'
}

export function Onboarding({ condominio, blocos, onAdiar }: { condominio: Condominio; blocos: Bloco[]; onAdiar: () => void }) {
  const { taxas } = useEstrutura()
  const { executar, ocupado } = useAcao()
  const [passo, setPasso] = useState(0)
  const [mesInicial, setMesInicial] = useState<MesISO>(condominio.inicioContabil)
  const [nome, setNome] = useState(condominio.nome)
  const [sindico, setSindico] = useState(condominio.sindico ?? '')
  const [endereco, setEndereco] = useState(condominio.endereco ?? '')
  const [diaVencimento, setDiaVencimento] = useState(condominio.diaVencimento)
  const tipos = [...new Set(blocos.map((b) => b.quartos))].sort((a, b) => b - a)
  const [valoresTaxa, setValoresTaxa] = useState<Record<number, Centavos>>({})
  const [saldoTotal, setSaldoTotal] = useState<Centavos>(0)
  const [saldos, setSaldos] = useState<Record<string, Centavos>>({})

  useEffect(() => {
    const iniciais: Record<number, Centavos> = {}
    for (const q of tipos) iniciais[q] = taxas.find((t) => t.quartos === q)?.valorCentavos ?? 0
    setValoresTaxa(iniciais)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxas.length])

  async function distribuir() {
    const sugestao = await servicos.estrutura.sugerirDistribuicaoSaldo(saldoTotal)
    const novo: Record<string, Centavos> = {}
    for (const s of sugestao) novo[s.blocoId] = s.valorCentavos
    setSaldos(novo)
  }

  async function concluir() {
    await executar(async () => {
      await servicos.estrutura.definirInicioContabil(mesInicial)
      await servicos.estrutura.atualizarCondominio({ nome, sindico, endereco, diaVencimento })
      for (const q of tipos) {
        const v = valoresTaxa[q] ?? 0
        if (v > 0) await servicos.estrutura.definirTaxa({ quartos: q, valorCentavos: v, vigenteDesde: mesInicial })
      }
      const data = primeiraDataDoMes(mesInicial)
      for (const b of blocos) {
        const v = saldos[b.id] ?? 0
        if (v !== 0) await servicos.estrutura.definirSaldoInicial(b.id, v, data)
      }
      await servicos.sistema.concluirOnboarding()
    }, 'Tudo pronto! Faça um backup em breve.')
  }

  const totalDistribuido = blocos.reduce((s, b) => s + (saldos[b.id] ?? 0), 0)
  const rodape = (
    <>
      {passo > 0 && (
        <button type="button" className="botao" onClick={() => setPasso(passo - 1)} disabled={ocupado}>
          Voltar
        </button>
      )}
      {passo < 4 ? (
        <button type="button" className="botao botao--primario" onClick={() => setPasso(passo + 1)} disabled={passo === 2 && !nome.trim()}>
          Continuar
        </button>
      ) : (
        <button type="button" className="botao botao--primario" onClick={() => void concluir()} disabled={ocupado}>
          Concluir
        </button>
      )}
    </>
  )

  return (
    <Modal titulo={`Bem-vindo(a) — passo ${passo + 1} de 5`} onFechar={() => undefined} fechavel={false} rodape={rodape}>
      {passo === 0 && (
        <div>
          <p>Este sistema guarda todos os dados <strong>neste navegador ({nomeDoNavegador()}) e neste usuário do Windows</strong>. Nada vai para a internet.</p>
          <p>Por isso, faça <strong>backups</strong> regularmente (menu Backup): o arquivo ZIP gerado permite restaurar tudo em outro computador ou navegador.</p>
          <p>Vamos configurar o básico em 2 minutos: mês inicial, dados do condomínio, valores das taxas e o saldo que cada bloco tem hoje.</p>
          <p className="texto-suave texto-pequeno">
            Já usou o sistema em outro navegador ou computador?{' '}
            <a
              href="#/backup"
              onClick={(e) => {
                e.preventDefault()
                onAdiar()
                navegar({ nome: 'backup' })
              }}
            >
              Restaurar um backup
            </a>
            .
          </p>
        </div>
      )}
      {passo === 1 && (
        <div className="formulario">
          <Campo rotulo="A partir de que mês deseja registrar a contabilidade?" ajuda="Pode ser um mês passado. Lançamentos anteriores a esse mês não são aceitos; o saldo inicial de cada bloco representa o que veio antes.">
            <CampoMes valor={mesInicial} onChange={setMesInicial} />
          </Campo>
          <p>
            Início contábil: <strong>{formatarMes(mesInicial)}</strong>
          </p>
        </div>
      )}
      {passo === 2 && (
        <div className="formulario">
          <Campo rotulo="Nome do condomínio">
            <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
          </Campo>
          <div className="linha-campos">
            <Campo rotulo="Síndico(a) (opcional)">
              <input value={sindico} onChange={(e) => setSindico(e.target.value)} />
            </Campo>
            <Campo rotulo="Dia de vencimento da taxa">
              <input type="number" min={1} max={31} value={diaVencimento} onChange={(e) => setDiaVencimento(Number(e.target.value) || 10)} />
            </Campo>
          </div>
          <Campo rotulo="Endereço (opcional)">
            <input value={endereco} onChange={(e) => setEndereco(e.target.value)} />
          </Campo>
        </div>
      )}
      {passo === 3 && (
        <div className="formulario">
          <p>Valor mensal da taxa condominial por tipo de apartamento (pode alterar depois em Estrutura › Taxas):</p>
          {tipos.map((q) => (
            <Campo key={q} rotulo={`Apartamentos de ${q} quartos (${blocos.filter((b) => b.quartos === q).map((b) => b.nome).join(', ')})`}>
              <CampoMoeda valor={valoresTaxa[q] ?? 0} onChange={(v) => setValoresTaxa({ ...valoresTaxa, [q]: v })} />
            </Campo>
          ))}
        </div>
      )}
      {passo === 4 && (
        <div className="formulario">
          <p>
            Quanto cada bloco tem em caixa em <strong>01/{mesDe(primeiraDataDoMes(mesInicial)).slice(5)}/{mesInicial.slice(0, 4)}</strong>? (opcional; pode ajustar depois em Estrutura › Blocos)
          </p>
          <div className="linha-campos" style={{ alignItems: 'flex-end' }}>
            <Campo rotulo="Informar o total e distribuir proporcionalmente aos apartamentos">
              <CampoMoeda valor={saldoTotal} onChange={setSaldoTotal} permitirNegativo />
            </Campo>
            <button type="button" className="botao" onClick={() => void distribuir()}>
              Distribuir
            </button>
          </div>
          <div className="tabela-rolagem" style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table className="tabela tabela--compacta">
              <thead>
                <tr>
                  <th>Bloco</th>
                  <th className="num">Saldo inicial</th>
                </tr>
              </thead>
              <tbody>
                {blocos.map((b) => (
                  <tr key={b.id}>
                    <td>{b.nome}</td>
                    <td className="num">
                      <CampoMoeda valor={saldos[b.id] ?? 0} onChange={(v) => setSaldos({ ...saldos, [b.id]: v })} permitirNegativo />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{formatarBRL(totalDistribuido)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="texto-suave texto-pequeno">A distribuição é uma estimativa; o valor gravado é sempre o de cada bloco.</p>
        </div>
      )}
    </Modal>
  )
}
