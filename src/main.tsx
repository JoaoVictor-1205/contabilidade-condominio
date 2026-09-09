import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/estilos/global.css'
import './ui/estilos/print.css'
import { App } from './ui/App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { AppProviders } from './ui/contexto/AppProviders'
import { consultas, db, servicos } from './dados/instancia'
import { baixarBackupCompleto } from './ui/paginas/Backup'
import { gerarBackup } from './exportacao/backup'
import { lerBackup, restaurarBackup } from './exportacao/restaurar'

// Acesso para diagnóstico e testes automatizados (console do navegador): window.__sindico
declare global {
  interface Window {
    __sindico?: { db: typeof db; servicos: typeof servicos; consultas: typeof consultas; backup: { gerarBackup: typeof gerarBackup; lerBackup: typeof lerBackup; restaurarBackup: typeof restaurarBackup } }
  }
}
window.__sindico = { db, servicos, consultas, backup: { gerarBackup, lerBackup, restaurarBackup } }

// Pede ao navegador para não descartar o IndexedDB sob pressão de disco (best effort; em file:// pode retornar false).
void navigator.storage?.persist?.().catch(() => undefined)

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ErrorBoundary onExportarBackup={() => baixarBackupCompleto()}>
      <AppProviders>
        <App />
      </AppProviders>
    </ErrorBoundary>
  </StrictMode>,
)
