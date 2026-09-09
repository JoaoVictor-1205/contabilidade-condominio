# Validação da versão 2 — 09/09/2026

Entrega em `entrega/Contabilidade-Condominio.html`, com o guia `entrega/LEIAME.md` e esta documentação
em `entrega/Documentacao-Contabilidade-Condominio.pdf`. Código-fonte publicado em
https://github.com/JoaoVictor-1205/contabilidade-condominio.

## Verificações automatizadas

Ambiente: Windows, Node portátil v24.20.0 em `.tools/node`, testes via `scripts/testar.mjs`.

| Verificação | Resultado |
|-------------|-----------|
| `npm run typecheck` | aprovado |
| `npm test` | 600 testes aprovados, 27 arquivos |
| Testes de UI após ajuste final do link de integridade | 9 aprovados |
| `npm run build` | aprovado, HTML único e sem dependências de rede |
| `npm run empacotar` | aprovado |
| Comparação de espaços com `git -c core.autocrlf=false diff --no-index --check` | sem ocorrências; apenas comparação entre pastas, sem criar Git |

Cobertura adicional inclui fechamento sequencial/reabertura, bloqueio das datas antiga e nova,
rollback de fechamento/estorno/correção de pagamento, estornos em caixa/competência/filtro por bloco,
auditoria de campos, saldos em lote, manutenção com prévia desatualizada, categoria já utilizada,
edição de histórico inativo, falhas por item no lote de pagamentos, campos bloqueados na UI,
preservação da edição ao filtrar apartamentos e Escape em modais sobrepostos.

Backup e exportação: migração v1, validação de registros antes da substituição, restauração
interrompida no segundo lote de 201 anexos e retomada do restante, manutenção dos metadados
dos demais anos, recusa de outra instalação, preservação de alterações posteriores à restauração
e ao snapshot, validação de arquivos ausentes/incompatíveis e leitura dos arquivos Excel/CSV gerados.
Excel verifica valores numéricos, datas integrais, sinais dos estornos e abas; CSV verifica BOM e conteúdo.

## Navegadores reais em arquivo local

Script reproduzível: `node scripts/verificar-v2.mjs todos`, após carregar `scripts/use-node.ps1`.
Execuções headless com perfis exclusivos de teste em `.tools/qa-v2/perfis`; perfis removidos ao final.
Os dados usados são fictícios. Não foram usados perfis ou bases do usuário.

Chrome 152.0.7977.84 e Edge 152.0.4191.66: **23 rotas cada, sem erros de console nem transbordamento
horizontal externo em 1440 × 1000**. Relatórios preservam a rolagem interna de tabelas largas.

Fluxos exercitados: seed de 14 blocos/320 cobranças, fechamento do mês anterior pela interface,
proteções do mês fechado, anexar após fechamento e recusar remoção, estorno pela interface,
correção de TAXA/JUROS após fechamento e conferência de integridade. Também foi verificado
o ciclo de backup completo → apagar → restaurar, backup anual com metadados de ambos os anos,
recusa da complementação de outra instalação e conclusão com o ZIP do ano restante.

A integridade final não apresentou ERRO. Avisos `ALTERADO_APOS_FECHAMENTO` podem aparecer
quando o vínculo do estorno atualiza o original; são previstos na especificação e os saldos
fechados continuam conferindo. A quantidade depende de as operações atravessarem a resolução
de segundos do relógio.

O script grava os resultados detalhados (JSON com cada verificação, versão do navegador e cenário) e
capturas das telas de relatórios, fechamento, auditoria, integridade e backup anual em `.tools/qa-v2/`.
Essa pasta é local (não versionada); os artefatos são regenerados a cada execução.

A varredura foi executada duas vezes em 09/09/2026, com o mesmo artefato: **76 verificações aprovadas
em cada navegador** nas duas execuções, sem exceções nem erros de console.

As capturas de relatórios e telas avançadas foram inspecionadas visualmente. As telas que ilustram
esta documentação (`docs/capturas/`) foram geradas por `scripts/capturar-telas.mjs` com um cenário
fictício independente e também sem erros de console. A validação não incluiu impressão física, uma
instalação com anos de dados reais ou teste de carga no limite de 1,5 GB.

## Artefato conferido

`dist/index.html` e `entrega/Contabilidade-Condominio.html` têm o mesmo SHA-256:

`24E95508CA0287E3D205300839D8CFE17D4EF5FBAF87CA5F111FDDCF3DCDDF13`

Tamanho: **1.068.993 bytes**. Guia e regras atualizados em `LEIAME.md` e `docs/regras-contabeis.md`.
