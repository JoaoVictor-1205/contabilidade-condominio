# Arquitetura e guia de desenvolvimento

## 1. Decisões de arquitetura

| Tema | Decisão | Motivo |
|------|---------|--------|
| Distribuição | Um único arquivo HTML (`vite-plugin-singlefile`) aberto via `file://` | Sem servidor, sem instalação; o síndico copia um arquivo. |
| Persistência | IndexedDB do navegador, via Dexie 4 (schema versão 2) | Suporta anexos binários e transações; funciona em `file://`. |
| Backup | ZIP com `dados.json` + pasta `anexos/` (jszip), completo ou por ano | Os dados vivem no navegador; o ZIP é a cópia de segurança e o meio de migração. |
| Exportação | Excel (SheetJS 0.20.3), CSV com BOM e impressão/PDF pelo próprio navegador | Compartilhar relatórios sem depender do sistema. |
| Interface | React 19 + TypeScript 5.9, roteador por hash próprio, CSS puro | Botão voltar e links funcionam em `file://`; sem dependências de UI. |
| Validação | zod 4 nos DTOs de entrada dos serviços | Mensagens em português e regras centralizadas. |
| Testes | Vitest 5 com `fake-indexeddb` (dados) e `happy-dom` (componentes); verificação em Chrome/Edge headless | Regras contábeis testadas com cenário numérico; telas verificadas no navegador real. |
| Ambiente | Node 24 portátil em `.tools/node` (script `scripts/setup-node.ps1`) | Não altera o Node global da máquina. |

## 2. Camadas

A dependência aponta sempre "para dentro": **ui → exportacao → dados → dominio**. O domínio não conhece
React, Dexie nem o relógio do sistema.

| Camada | Pasta | Responsabilidade |
|--------|-------|------------------|
| Domínio | `src/dominio/` | Tipos, dinheiro em centavos, datas ISO, rateio por maior resto, demonstrativo, cobranças, unidades, fechamento, integridade, validação (zod), erros com código. Funções puras e testadas. |
| Dados | `src/dados/` | Banco Dexie (`db.ts`), seed, relógio injetável, auditoria, regras (existência, saldo inicial, mês aberto), consultas para `useLiveQuery` e serviços de escrita (`servicos/`). |
| Exportação | `src/exportacao/` | CSV, Excel, download, backup em streaming, restauração validada/retomável e schema do backup com migração v1→v2. |
| Interface | `src/ui/` | Rotas, hooks, provedores (toasts/confirmação), componentes (campos, comuns, anexos, impressão), páginas e estilos (tokens, global, impressão). |

### 2.1 Domínio (`src/dominio`)

- `tipos.ts`: entidades (`Condominio`, `Bloco`, `Unidade`, `TaxaVigencia`, `Categoria`, `Lancamento`,
  `Cobranca`, `Anexo`, `Documento`, `Fechamento`, `Auditoria`, `Meta`).
- `dinheiro.ts`: centavos inteiros e formatação BRL. `datas.ts`: strings `AAAA-MM-DD` e `AAAA-MM`, sem
  `new Date('AAAA-MM-DD')`.
- `rateio.ts`: divisão proporcional às unidades ativas pelo método do maior resto; grava snapshot.
- `demonstrativo.ts`: saldos por bloco e período (base caixa ou competência), conferência, estornos
  líquidos e resumo de cobranças.
- `cobrancas.ts`: taxa vigente, vencimento, planejamento da geração e situação (a vencer/vencida).
- `unidades.ts`: numeração andar + posição e diferença de estrutura ao editar um bloco.
- `fechamento.ts`: último mês fechado, próximo mês a fechar (sequencial, só mês terminado), reabertura.
- `integridade.ts`: verificação completa de rateios, vínculos, datas, saldos fechados, duplicidades e anexos.
- `validacao.ts`: DTOs (`NovoLancamento`, `NovaTransferencia`, `DadosBloco`, `DadosPagamento` etc.).

### 2.2 Dados (`src/dados`)

- `db.ts`: classe `BancoSindico` (Dexie) com as tabelas `condominio`, `blocos`, `unidades`, `taxas`,
  `categorias`, `lancamentos`, `anexos`, `anexosBlob`, `documentos`, `cobrancas`, `fechamentos`,
  `auditoria` e `meta`. A versão 2 do schema acrescenta `fechamentos` e os campos `tipo`,
  `estornaLancamentoId` e `estornadoPorId` nos lançamentos, com migração automática dos registros antigos.
- `servicos/`: `lancamentos` (registrar, atualizar, excluir, estornar, recalcular rateio, transferir),
  `cobrancas` (gerar, pagar, lote, desfazer, corrigir, cancelar, isentar, reabrir, alterar, reemitir),
  `estrutura` (condomínio, blocos, unidades, taxas, categorias, saldos iniciais), `documentos`, `anexos`,
  `fechamento` (fechar, reabrir), `manutencao` (prévia e aplicação de rateios), `sistema` (integridade,
  onboarding, estado do backup, apagar tudo). `criarServicos` monta tudo sobre um banco e um relógio.
- `consultas.ts`: leituras reativas usadas pelas páginas com `useLiveQuery`.
- `auditoria.ts`: toda escrita grava um registro com entidade, ação, resumo, motivo e alterações de→para.

### 2.3 Exportação (`src/exportacao`)

- `backup.ts`: gera o ZIP em streaming com `dados.json` (todas as tabelas, `schemaVersion`,
  `instalacaoId`, `geradoEm`) e os arquivos em `anexos/`. O backup por ano inclui todos os metadados e
  apenas os arquivos anexados no ano escolhido.
- `restaurar.ts`: valida o `dados.json` com zod antes de tocar no banco, grava as tabelas em uma
  transação e os blobs em lotes fora da transação, com retomada ("Continuar restauração").
- `schemaBackup.ts`: schema zod do backup e `migrarBackup` (v1 → v2).
- `excel.ts` e `csv.ts`: demonstrativo, lançamentos e cobranças; estornos identificados.

### 2.4 Interface (`src/ui`)

- `rotas.ts`: rotas por hash (`#/`, `#/lancamentos`, `#/lancamentos/novo`, `#/lancamentos/:id`,
  `#/lancamentos/transferencia`, `#/cobrancas`, `#/inadimplencia`, `#/unidades`, `#/unidades/:id`,
  `#/relatorios`, `#/relatorios/unidade/:id`, `#/arquivo`, `#/estrutura/:aba`, `#/backup`,
  `#/avancado/:aba`). O estado da tela (competência, bloco, modo, aba) fica na URL.
- `paginas/`: uma página por rota; `Avancado.tsx` reúne fechamento, integridade, auditoria e manutenção.
- `componentes/`: campos monetários e de data sem ponto flutuante, modais, diálogos de motivo, anexos e
  cabeçalho/rodapé de impressão.
- `ErrorBoundary.tsx`: última linha de defesa com a ação "Exportar backup".
- A página expõe `window.__sindico = { db, servicos, consultas, backup }` para os scripts de verificação.

## 3. Regras invioláveis

- Dinheiro em **centavos inteiros**; datas como strings ISO.
- Lançamento GERAL grava o **snapshot do rateio**; relatórios somam snapshots. Só "Recalcular rateio" muda.
- **Saldo inicial é atributo do bloco**; nenhum lançamento pode ser anterior à data do saldo inicial de
  um bloco afetado nem ao início contábil.
- Categorias TAXA/JUROS só entram pelo serviço de cobranças; cobrança única por unidade e competência.
- **Soft delete** com motivo; toda escrita gera auditoria e incrementa o contador de alterações sem backup.
- Dentro de `db.transaction(...)` só se aguardam operações do Dexie (nunca jszip, FileReader, fetch ou timers).
- Booleanos nunca são indexados no Dexie (filtrar em memória).
- Em mês fechado: nada de registrar, editar, excluir ou recalcular; correções por **estorno** em mês aberto.

## 4. Ambiente e comandos

```
powershell -ExecutionPolicy Bypass -File scripts\setup-node.ps1   # uma vez: baixa o Node 24 portátil em .tools\node
. .\scripts\use-node.ps1                                          # em cada terminal fora do VS Code
npm install
npm run typecheck                    # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm test                             # Vitest via scripts/testar.mjs (600 testes)
npm run build                        # tsc + vite build + scripts/verificar-build.mjs
npm run empacotar                    # copia para entrega\Contabilidade-Condominio.html + LEIAME
node scripts/verificar-v2.mjs todos  # verificação ponta a ponta em Chrome e Edge (perfis descartáveis)
node scripts/capturar-telas.mjs      # capturas de tela com dados fictícios em docs/capturas
node scripts/gerar-pdf-docs.mjs      # esta documentação em PDF (docs/ e entrega/)
```

Observações:

- O terminal integrado do VS Code já recebe o PATH do Node portátil por `.vscode/settings.json`.
- Rode os testes sempre por `npm test` (ou `node scripts/testar.mjs run <arquivo>`): no Windows, o
  Vitest falha se for iniciado por um caminho com caixa diferente da real (`c:\` × `C:\`); o wrapper
  normaliza o caminho.
- `scripts/abrir-headless.mjs` abre o HTML em Chrome/Edge headless e avalia uma expressão JavaScript,
  útil para depurar via `window.__sindico`.

## 5. Testes

- Ambiente padrão `node` + `fake-indexeddb`; testes de componentes começam com
  `// @vitest-environment happy-dom`. Setup em `src/testes/setup.ts`.
- Banco isolado por teste com `criarBancoTeste()` (`src/testes/dbTeste.ts`), relógio fixo em
  `2026-09-04T10:00:00` e seed com início contábil `2026-09`.
- 27 arquivos / 600 testes, ao lado dos módulos: domínio (`rateio`, `demonstrativo`, `cobrancas`,
  `fechamento`, `integridade`, `validacao`…), serviços (`lancamentos`, `cobrancas`, `estrutura`,
  `fechamento`, `manutencao`, `documentos`), banco (`db.test.ts` migra um banco v1), exportação
  (`backup`, `excel`) e interface (`rotas`, `campos`, `Avancado`).
- `docs/regras-contabeis.md` traz o cenário numérico que os testes do demonstrativo reproduzem.

## 6. Convenções

- Código, comentários, mensagens e testes em português do Brasil; identificadores sem acento.
- `import type` para tipos; sem `any`; sem barrel files; sem dependências novas sem motivo.
- Versões fixas no `package.json` (`save-exact`), `engine-strict` para o Node 24.
- Nunca editar versões antigas do schema Dexie: adicionar `version(n+1)` com `upgrade`.
