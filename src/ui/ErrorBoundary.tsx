// Última linha de defesa: erro de renderização não pode esconder os dados do síndico.
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Estado {
  erro: Error | null
  erroBackup?: string
  exportando?: boolean
}

export class ErrorBoundary extends Component<{ children: ReactNode; onExportarBackup?: () => Promise<void> }, Estado> {
  override state: Estado = { erro: null }

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro }
  }

  override componentDidCatch(erro: Error, info: ErrorInfo): void {
    console.error('Erro na interface', erro, info.componentStack)
  }

  override render() {
    if (!this.state.erro) return this.props.children
    return (
      <main className="conteudo">
        <div className="painel">
          <h1>Algo deu errado</h1>
          <p>A tela encontrou um erro inesperado. Seus dados continuam guardados no navegador.</p>
          <pre className="mono texto-pequeno" style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.erro.message}
          </pre>
          <div className="acoes">
            <button type="button" className="botao botao--primario" onClick={() => location.reload()}>
              Recarregar
            </button>
            <button type="button" className="botao" onClick={() => (location.hash = '#/')}>
              Ir para o Início
            </button>
            {this.props.onExportarBackup && (
              <button type="button" className="botao" disabled={this.state.exportando} onClick={async () => {
                this.setState({ exportando: true, erroBackup: '' })
                try { await this.props.onExportarBackup?.() }
                catch (e) { this.setState({ erroBackup: e instanceof Error ? e.message : String(e) }) }
                finally { this.setState({ exportando: false }) }
              }}>
                Exportar backup
              </button>
            )}
          </div>
          {this.state.erroBackup && <p role="alert">Não foi possível gerar o backup: {this.state.erroBackup}</p>}
        </div>
      </main>
    )
  }
}
