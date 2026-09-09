# Visão geral do sistema

**Contabilidade do Condomínio** é um sistema de contabilidade e administração para o síndico de um
condomínio residencial com vários blocos (o cenário de referência tem 14 blocos e 320 apartamentos,
tudo editável). Ele registra receitas e despesas, controla a taxa condominial de cada apartamento,
arquiva comprovantes e documentos e emite o demonstrativo financeiro com o caixa de cada bloco e do
condomínio.

O sistema é um **aplicativo web local de arquivo único**: `Contabilidade-Condominio.html` abre por duplo
clique no Google Chrome ou no Microsoft Edge, sem servidor, sem instalação e sem internet. Os dados
ficam no armazenamento do próprio navegador (IndexedDB) e são protegidos por backups em ZIP.

## Objetivos

1. Registrar **todas** as entradas e saídas do condomínio com comprovante, categoria e forma de pagamento.
2. Saber, a qualquer momento, **quanto cada bloco tem em caixa** e quanto o condomínio tem no total.
3. Controlar **quem pagou a taxa condominial** em cada mês e listar os inadimplentes.
4. Emitir o **demonstrativo do período** (mês, ano ou intervalo) para todos os blocos ou para um bloco só,
   em PDF e Excel.
5. Manter o **histórico íntegro**: exclusão lógica com motivo, auditoria de toda alteração, fechamento
   mensal, estorno em vez de edição do passado e verificação de integridade.

## Funcionalidades

| Área | O que faz |
|------|-----------|
| Início | Painel do mês: receitas, despesas, saldo, caixa por bloco, andamento das taxas, últimos lançamentos e avisos (backup pendente, mês que pode ser fechado). |
| Lançamentos | Despesas e receitas com escopo geral (rateado entre os blocos), por bloco ou por apartamento; transferências entre blocos; anexos; edição, exclusão lógica e estorno. |
| Cobranças | Geração mensal da taxa por apartamento com a taxa vigente; pagamento individual (com desconto, juros e comprovante) ou em lote; cancelamento, isenção, correção e desfazer pagamento. |
| Inadimplência | Lista de cobranças em atraso por bloco e apartamento, com versão sem nomes para o quadro de avisos. |
| Apartamentos | Grade colorida e tabela por bloco; cadastro do responsável, telefone, e-mail e isenção; extrato do apartamento como declaração de quitação. |
| Relatórios | Demonstrativo por período e bloco, base caixa ou competência, com conferência automática; exportação para Excel, CSV e impressão/PDF. |
| Arquivo | Documentos avulsos (atas, convenção, regimento, contratos, orçamentos) com anexos de qualquer tipo. |
| Estrutura | Condomínio, blocos (nome, quartos, andares, apartamentos por andar, saldo inicial), taxas por tipo de apartamento com vigência e categorias. |
| Backup | Backup completo ou por ano em ZIP (registros + anexos), restauração validada e retomável, exportação JSON. |
| Avançado | Fechamento e reabertura de meses, verificação de integridade, auditoria detalhada com alterações de→para e manutenção (recálculo de rateios com prévia, apagar tudo). |

## Tecnologia em uma frase

Vite 8 + React 19 + TypeScript 5.9 compilados em um único HTML; Dexie 4 sobre IndexedDB; jszip para
backups; SheetJS para Excel; zod para validação; Vitest para os 600 testes automatizados. Detalhes no
capítulo **Arquitetura e guia de desenvolvimento**.

## Telas principais

As capturas abaixo foram feitas em Chrome headless com **dados fictícios** gerados pelo script
`scripts/capturar-telas.mjs` (três meses de movimento, dois meses fechados e um estorno).

![Primeiro uso: assistente de configuração](capturas/01-primeiro-uso.png)

![Início: painel do mês com caixa por bloco e últimos lançamentos](capturas/02-inicio.png)

![Lançamentos: lista com filtros, badges de estorno e anexos](capturas/03-lancamentos.png)

![Detalhe de um lançamento estornado, com o vínculo entre original e estorno](capturas/04-lancamento-detalhe-estornado.png)

![Nova despesa: escopo geral com prévia do rateio entre os blocos](capturas/05-lancamento-novo.png)

![Cobranças do mês: pagamento individual ou em lote](capturas/06-cobrancas.png)

![Inadimplência por bloco e apartamento](capturas/07-inadimplencia.png)

![Apartamentos: grade colorida do bloco](capturas/08-apartamentos-grade.png)

![Apartamento: cadastro e histórico de cobranças](capturas/09-apartamento-detalhe.png)

![Relatórios: demonstrativo por bloco com conferência](capturas/10-relatorios.png)

![Extrato do apartamento (declaração de quitação)](capturas/11-extrato-apartamento.png)

![Arquivo de documentos](capturas/12-arquivo.png)

![Estrutura: blocos e saldos iniciais](capturas/13-estrutura-blocos.png)

![Estrutura: taxas por tipo de apartamento e vigência](capturas/14-estrutura-taxas.png)

![Backup e restauração](capturas/15-backup.png)

![Avançado: fechamento mensal](capturas/16-avancado-fechamento.png)

![Avançado: verificação de integridade](capturas/17-avancado-integridade.png)

![Avançado: auditoria com alterações de→para](capturas/18-avancado-auditoria.png)

![Avançado: manutenção (recálculo de rateios com prévia e apagar tudo)](capturas/19-avancado-manutencao.png)
