# Regras contábeis do demonstrativo

Este documento explica como o sistema calcula o demonstrativo financeiro por bloco
(`src/dominio/demonstrativo.ts`) e apresenta o **cenário de referência** usado nos testes
automatizados (`src/dominio/demonstrativo.test.ts`). Todos os números abaixo foram calculados
à mão; os testes conferem que o código reproduz exatamente esta tabela.

## 1. Princípios

1. **Dinheiro em centavos inteiros.** Nunca há ponto flutuante. `valorCentavos` de um lançamento é sempre
   maior que zero; saldos (anterior, do período, final) podem ser negativos.
2. **Regime de caixa por padrão.** Um lançamento representa dinheiro que entrou ou saiu na sua `data`.
   A `competencia` (mês de referência) fica registrada e alimenta a visão gerencial (seção 6).
3. **Só lançamentos ATIVOS contam.** Exclusão é lógica (`status: 'EXCLUIDO'`, com motivo) e o lançamento
   excluído fica fora de todos os somatórios, embora continue visível no histórico.
4. **Todo dinheiro pertence a algum bloco.** O caixa do condomínio é a soma dos caixas dos blocos.
   Por isso o demonstrativo tem uma linha por bloco e uma linha de total.
5. **Relatórios históricos não mudam por alteração de estrutura.** O rateio de cada lançamento geral
   é gravado no próprio lançamento (snapshot, seção 3). Só a edição explícita do lançamento (ou a ação
   "Recalcular rateio") muda o passado.

## 2. Sinal e efeito no caixa

| Natureza      | `sinal` | Efeito no caixa do condomínio | Efeito por bloco                                 |
|---------------|:------:|-------------------------------|--------------------------------------------------|
| RECEITA       |   +1   | `+valor`                      | BLOCO/UNIDADE: `+valor` no bloco; GERAL: `+cota` em cada bloco do snapshot |
| DESPESA       |   −1   | `−valor`                      | BLOCO/UNIDADE: `−valor` no bloco; GERAL: `−cota` em cada bloco do snapshot |
| TRANSFERENCIA |    0   | `0`                           | `−valor` no bloco de origem e `+valor` no bloco de destino |

- `efeitoNoCaixa(l) = sinal(l) × valorCentavos`.
- A tabela acima descreve lançamentos `NORMAL`. Em `ESTORNO`, receita e despesa invertem o sinal;
  transferências devolvem o valor ao bloco de origem e retiram do destino (seção 10).
- `efeitoPorBloco(l)` devolve a lista `{ blocoId, valorCentavos }` já com sinal. A soma de
  `efeitoPorBloco` é sempre igual a `efeitoNoCaixa` (para transferências, `−v + v = 0`).

## 3. Rateio e snapshot

Um lançamento de escopo **GERAL** é dividido entre os blocos **ativos** proporcionalmente ao número de
**unidades ativas** de cada um (unidades isentas contam; unidades desativadas não). A divisão usa o
método do **maior resto** com inteiros: cada bloco recebe `floor(valor × peso / N)` centavos e os
centavos que sobram vão, um a um, aos blocos com maior resto, desempatando pela `ordem` do bloco.
Exemplo: R$ 1,00 entre três blocos de mesmo peso → 34, 33 e 33 centavos (o primeiro na ordem leva o
centavo extra). A soma das cotas é sempre exatamente o valor do lançamento.

O resultado é gravado no lançamento (`rateio: RateioSnapshot`, com `totalUnidades` e uma cota por
bloco). **O demonstrativo nunca recalcula o rateio: ele soma as cotas do snapshot.** Assim, se um bloco
for desativado ou unidades forem criadas depois, os relatórios de meses passados continuam iguais.
No cenário de referência o bloco C está inativo na data do relatório, mas participou do rateio da
despesa de 10/09 porque estava ativo naquele dia; sua cota continua aparecendo.

## 4. Saldo inicial

O saldo inicial é um **atributo do bloco** (`saldoInicialCentavos` na abertura do dia
`dataSaldoInicial`). Ele **nunca é receita**. Dependendo da posição da data em relação ao período:

| Posição de `dataSaldoInicial`        | Onde entra                              |
|--------------------------------------|-----------------------------------------|
| antes do início do período           | coluna **Saldo anterior**               |
| dentro do período (inclusive bordas) | coluna **Saldo inicial** (`saldoInicialNoPeriodo`) |
| depois do fim do período             | em lugar nenhum (o bloco ainda "não existia") |

Nenhum lançamento pode ter data anterior à `dataSaldoInicial` de um bloco afetado; isso evita contar o
mesmo dinheiro duas vezes (no saldo inicial e no lançamento).

## 5. Transferências entre blocos

Uma transferência move dinheiro do caixa de um bloco para o de outro. Não é receita nem despesa: aparece
na coluna **Transferências** como `recebido − enviado` de cada bloco. No total do condomínio a coluna
soma sempre zero (o que sai de um entra no outro). Com filtro por bloco, o total exibido é a própria
linha do bloco, portanto a coluna mostra o líquido daquele bloco (por exemplo, −R$ 100,00 para quem
enviou). A origem pode ser um bloco inativo, para que nenhum saldo fique preso.

## 6. Base caixa × base competência

| Base           | Data que situa o lançamento no período | Uso                                      |
|----------------|----------------------------------------|------------------------------------------|
| `data` (padrão)| `l.data` — o dia em que o dinheiro se moveu | "Caixa": quanto há de fato em cada bloco |
| `competencia`  | 1º dia de `l.competencia` — o mês a que se refere | "Resultado acumulado": visão gerencial |

As mesmas fórmulas valem nas duas bases; muda apenas qual data é comparada com o período. Um lançamento
pago em outubro com competência setembro entra em setembro na base competência e em outubro na base
caixa. O resumo de cobranças (seção 9) independe da base: usa a competência da cobrança.

## 7. Fórmulas por linha

Para cada bloco (todos, ativos ou não), com `inicio`/`fim` do período e `d = campoBase(l, base)`:

- `saldoAnterior = (dataSaldoInicial < inicio ? saldoInicial : 0) + Σ efeitoPorBloco(l)` dos ATIVOS com `d < inicio`
- `saldoInicialNoPeriodo = (inicio ≤ dataSaldoInicial ≤ fim ? saldoInicial : 0)`
- No período (`inicio ≤ d ≤ fim`): `receitasProprias` (RECEITA BLOCO/UNIDADE), `receitasRateadas` (cotas de RECEITA GERAL),
  `despesasProprias`, `despesasRateadas`, `transferencias = recebido − enviado`
- `receitas = receitasProprias + receitasRateadas`; `despesas = despesasProprias + despesasRateadas`
- `saldoPeriodo = receitas − despesas + transferencias`
- `saldoFinal = saldoAnterior + saldoInicialNoPeriodo + saldoPeriodo`

Linhas exibidas: sem filtro, todos os blocos ativos mais os inativos que tiveram movimento no período ou
têm `saldoFinal ≠ 0` (marcados "(inativo)"); com filtro, só o bloco filtrado. As linhas seguem
`bloco.ordem`. **Total** = soma das linhas exibidas.

**Conferência** = `Σ saldoPeriodo de TODOS os blocos − Σ efeitoNoCaixa dos ATIVOS do período`. É calculada
sobre todos os blocos mesmo com filtro e deve ser sempre R$ 0,00; qualquer outro valor indica dado
inconsistente (por exemplo, cota apontando para bloco inexistente).

**Lançamentos**: os ATIVOS do período em ordem de `campoBase` e depois `criadoEm`. Na base caixa isso é
a ordem de data; na base competência todos os lançamentos de uma mesma competência empatam (1º dia do
mês) e ficam em ordem de criação. Sem filtro, cada um traz
`valorAtribuido = efeitoNoCaixa` (transferência = 0). Com filtro por bloco, traz só a parcela que afeta o
bloco: a cota (GERAL, com a legenda "cota de R$ 200,00 de R$ 1.000,00 (2/10 aptos)"), o valor
(BLOCO/UNIDADE) ou ±valor (TRANSFERENCIA).

**Por categoria**: soma dos valores absolutos atribuídos por categoria (só RECEITA/DESPESA), receitas
primeiro e depois por valor decrescente. Categoria não encontrada aparece como "Categoria removida".

## 8. Cenário de referência (Setembro/2026)

Período: 01/09/2026 a 30/09/2026. Hoje: 20/09/2026. Base: caixa (`data`), salvo onde indicado.

### 8.1 Estrutura

| Bloco | Ordem | Unidades | Situação | Saldo inicial | Data do saldo inicial |
|-------|:-----:|:--------:|----------|--------------:|-----------------------|
| A     | 1     | 2 (101, 102) | ativo | R$ 1.000,00 | 01/08/2026 (antes do período → Saldo anterior) |
| B     | 2     | 3 (201–203)  | ativo | R$ 500,00   | 01/09/2026 (dentro do período → Saldo inicial) |
| C     | 3     | 5 (301–305)  | **inativo desde 25/09/2026** (estava ativo em 10/09) | R$ 700,00 | 01/08/2026 |

Categorias: "Limpeza e conservação" e "Água e esgoto" (DESPESA), "Aluguel de espaços" e "Taxa extra"
(RECEITA), "Transferência entre blocos" (TRANSFERENCIA, de sistema).

### 8.2 Lançamentos

| Id | Natureza / escopo | Bloco | Data | Compet. | Valor | Categoria | Observação |
|----|-------------------|-------|------|---------|------:|-----------|------------|
| L1 | DESPESA GERAL | A, B, C | 10/09/2026 | 09/2026 | R$ 1.000,00 | Limpeza e conservação | Rateio 2/3/5 de 10 unidades: A R$ 200,00; B R$ 300,00; C R$ 500,00 |
| L2 | RECEITA BLOCO | B | 05/09/2026 | 09/2026 | R$ 150,00 | Aluguel de espaços | |
| L3 | RECEITA UNIDADE | A (apto 101) | 12/09/2026 | **08/2026** | R$ 80,00 | Taxa extra | competência diferente da data |
| L4 | TRANSFERENCIA | A → B | 15/09/2026 | 09/2026 | R$ 100,00 | Transferência entre blocos | |
| L5 | DESPESA BLOCO | A | 20/09/2026 | 09/2026 | R$ 999,00 | Limpeza e conservação | **EXCLUÍDO** (ignorado) |
| L6 | DESPESA BLOCO | A | 20/08/2026 | 08/2026 | R$ 30,00 | Limpeza e conservação | anterior ao período → Saldo anterior |
| L7 | RECEITA BLOCO | B | 03/10/2026 | 10/2026 | R$ 70,00 | Aluguel de espaços | posterior ao período (ignorado) |
| L8 | DESPESA BLOCO | B | 02/10/2026 | **09/2026** | R$ 40,00 | Água e esgoto | água de setembro paga em outubro |

Rateio de L1: `N = 2 + 3 + 5 = 10`; `1.000,00 × 2/10 = 200,00`, `× 3/10 = 300,00`, `× 5/10 = 500,00`
(sem sobra). Soma das cotas = R$ 1.000,00.

### 8.3 Demonstrativo de Setembro/2026 — base caixa, sem filtro

Cálculo de cada linha:

- **A**: saldo anterior = 1.000,00 (saldo inicial de 01/08) − 30,00 (L6) = **970,00**; receitas próprias
  80,00 (L3); despesas rateadas 200,00 (cota de L1); transferências −100,00 (L4 enviada);
  saldo do período = 80,00 − 200,00 − 100,00 = **−220,00**; saldo final = 970,00 + 0 − 220,00 = **750,00**.
- **B**: saldo anterior 0 (saldo inicial é de 01/09, dentro do período); saldo inicial no período
  **500,00**; receitas próprias 150,00 (L2); despesas rateadas 300,00; transferências +100,00;
  saldo do período = 150,00 − 300,00 + 100,00 = **−50,00**; saldo final = 0 + 500,00 − 50,00 = **450,00**.
- **C** (inativo, mas com movimento no período): saldo anterior **700,00**; despesas rateadas 500,00;
  saldo do período **−500,00**; saldo final **200,00**.

| Bloco | Unid. | Saldo anterior | Saldo inicial | Rec. próprias | Rec. rateadas | Desp. próprias | Desp. rateadas | Transf. | Receitas | Despesas | Saldo período | Saldo final |
|-------|:-----:|---------------:|--------------:|--------------:|--------------:|---------------:|---------------:|--------:|---------:|---------:|--------------:|------------:|
| A          | 2  |   970,00 |   0,00 |  80,00 | 0,00 | 0,00 |   200,00 | −100,00 |  80,00 |   200,00 | −220,00 |   750,00 |
| B          | 3  |     0,00 | 500,00 | 150,00 | 0,00 | 0,00 |   300,00 | +100,00 | 150,00 |   300,00 |  −50,00 |   450,00 |
| C (inativo)| 5  |   700,00 |   0,00 |   0,00 | 0,00 | 0,00 |   500,00 |    0,00 |   0,00 |   500,00 | −500,00 |   200,00 |
| **Total**  | 10 | 1.670,00 | 500,00 | 230,00 | 0,00 | 0,00 | 1.000,00 |    0,00 | 230,00 | 1.000,00 | −770,00 | 1.400,00 |

Conferência: Σ saldo do período = −220,00 − 50,00 − 500,00 = −770,00; Σ efeito no caixa dos lançamentos
do período = −1.000,00 (L1) + 150,00 (L2) + 80,00 (L3) + 0 (L4) = −770,00. **Diferença = R$ 0,00.**

Verificação do total: 1.670,00 + 500,00 − 770,00 = 1.400,00 = 750,00 + 450,00 + 200,00.

Lançamentos do período (ordem de data) e valor atribuído: L2 +150,00; L1 −1.000,00; L3 +80,00; L4 0.

Por categoria: Aluguel de espaços R$ 150,00 (receita); Taxa extra R$ 80,00 (receita);
Limpeza e conservação R$ 1.000,00 (despesa).

### 8.4 Filtro pelo bloco A

- Linhas: só a linha de A acima; total = linha de A (transferências −100,00).
- Lançamentos atribuídos: L1 −200,00 com legenda "cota de R$ 200,00 de R$ 1.000,00 (2/10 aptos)";
  L3 +80,00; L4 −100,00. L2 não aparece (é do bloco B).
- Por categoria: Taxa extra R$ 80,00; Limpeza e conservação R$ 200,00.
- Conferência continua R$ 0,00 (calculada sobre todos os blocos).

Filtro pelo bloco B: L2 +150,00; L1 −300,00 (cota 3/10); L4 +100,00.

### 8.5 Base competência (mesmo período)

- L3 tem competência 08/2026: sai do período e passa a compor o **saldo anterior** de A (+80,00).
- L8 tem competência 09/2026: entra no período como despesa própria de B (40,00), embora pago em outubro.

| Bloco | Saldo anterior | Saldo inicial | Rec. próprias | Desp. próprias | Desp. rateadas | Transf. | Saldo período | Saldo final |
|-------|---------------:|--------------:|--------------:|---------------:|---------------:|--------:|--------------:|------------:|
| A          | 1.050,00 |   0,00 |   0,00 |  0,00 |   200,00 | −100,00 | −300,00 |   750,00 |
| B          |     0,00 | 500,00 | 150,00 | 40,00 |   300,00 | +100,00 |  −90,00 |   410,00 |
| C (inativo)|   700,00 |   0,00 |   0,00 |  0,00 |   500,00 |    0,00 | −500,00 |   200,00 |
| **Total**  | 1.750,00 | 500,00 | 150,00 | 40,00 | 1.000,00 |    0,00 | −890,00 | 1.360,00 |

Conferência: −300,00 − 90,00 − 500,00 = −890,00 = −1.000,00 + 150,00 − 40,00. **R$ 0,00.**
Repare que o saldo final de A é o mesmo nas duas bases (L3 conta de um jeito ou de outro); o de B cai
40,00 porque a despesa de água foi atribuída a setembro.

### 8.6 Continuidade entre meses

O saldo anterior de Outubro/2026 (base caixa) de cada bloco é igual ao saldo final de Setembro/2026:
A 750,00; B 450,00; C 200,00. Os testes conferem essa continuidade.

## 9. Resumo de cobranças

`resumirCobrancas(cobrancas, competencias, hoje)` considera só as cobranças cuja competência está na
lista (no demonstrativo: todas as competências entre o mês do início e o mês do fim do período):

| Campo | Regra |
|-------|-------|
| geradas | todas as cobranças das competências, qualquer status |
| pagas / canceladas / isentas | contagem por status |
| abertas | status ABERTA |
| vencidas | ABERTA com `vencimento < hoje` (no dia do vencimento ainda está "a vencer"); regra única em `situacaoCobranca` (src/dominio/cobrancas.ts) |
| valorCobrado | Σ valor das não canceladas/isentas (abertas + pagas) |
| valorRecebido | Σ `valorPagoCentavos` das PAGAS (sem juros) |
| valorJuros | Σ `jurosCentavos` das PAGAS |
| valorDescontos | Σ (`valor − valorPago`) das PAGAS, quando positivo |
| valorEmAberto | Σ valor das ABERTAS |
| porBloco | o mesmo cálculo separado por `blocoId` |

### 9.1 Cenário de cobranças (competência 09/2026, vencimento padrão 10/09/2026, hoje 20/09/2026)

Cobranças são geradas para unidades ativas e não isentas de blocos ativos. As unidades 303–305 de C são
isentas (contam no rateio, não recebem cobrança); as cobranças de C foram geradas em 01/09, antes da
desativação. Este sub-cenário serve apenas ao resumo de cobranças; os lançamentos TAXA/JUROS
correspondentes foram omitidos da tabela do demonstrativo para manter o exemplo enxuto.

| Id | Unidade | Bloco | Valor | Vencimento | Status | Paga em | Valor pago | Juros | Situação |
|----|---------|-------|------:|------------|--------|---------|-----------:|------:|----------|
| c1 | 101 | A | 300,00 | 10/09 | PAGA | 08/09 | 300,00 | 0,00 | paga |
| c2 | 102 | A | 300,00 | 10/09 | PAGA | 15/09 | 300,00 | 10,00 | paga com juros |
| c3 | 201 | B | 250,00 | 10/09 | PAGA | 09/09 | 240,00 | 0,00 | paga com desconto de 10,00 |
| c4 | 202 | B | 250,00 | 10/09 | ABERTA | — | — | — | **vencida** (10/09 < 20/09) |
| c5 | 203 | B | 250,00 | 30/09 (prorrogado) | ABERTA | — | — | — | a vencer |
| c6 | 301 | C | 200,00 | 10/09 | CANCELADA | — | — | — | cancelada ao desativar o bloco |
| c7 | 302 | C | 200,00 | 10/09 | ISENTA | — | — | — | isenta |

Resumo esperado:

| Campo | Total | Bloco A | Bloco B | Bloco C |
|-------|------:|--------:|--------:|--------:|
| geradas | 7 | 2 | 3 | 2 |
| pagas | 3 | 2 | 1 | 0 |
| abertas | 2 | 0 | 2 | 0 |
| vencidas | 1 | 0 | 1 | 0 |
| canceladas | 1 | 0 | 0 | 1 |
| isentas | 1 | 0 | 0 | 1 |
| valorCobrado | 1.350,00 | 600,00 | 750,00 | 0,00 |
| valorRecebido | 840,00 | 600,00 | 240,00 | 0,00 |
| valorJuros | 10,00 | 10,00 | 0,00 | 0,00 |
| valorDescontos | 10,00 | 0,00 | 10,00 | 0,00 |
| valorEmAberto | 500,00 | 0,00 | 500,00 | 0,00 |

Com hoje = 10/09/2026 nenhuma cobrança está vencida (c4 vence nesse dia); com hoje = 01/10/2026 as duas
abertas estão vencidas.

## 10. Estorno (versão 2)

O original permanece `ATIVO` e recebe `estornadoPorId`. O novo lançamento `ESTORNO` aponta para ele
em `estornaLancamentoId`. Ambos participam dos cálculos, cada um com seu sinal e sua data. O estorno
conserva valor positivo, natureza, categoria, escopo, competência e snapshot de rateio do original;
o cálculo é que inverte seu efeito. Nunca é calculado um rateio novo para estornar um movimento geral.

| Movimento | Caixa de setembro | Caixa de outubro | Competência setembro |
|-----------|-------------------:|-----------------:|---------------------:|
| Despesa R$ 100 em 10/09, competência 09 | −100,00 | 0,00 | −100,00 |
| Estorno dessa despesa em 05/10 | 0,00 | +100,00 | +100,00 |
| Efeito líquido dos dois | −100,00 | +100,00 | 0,00 |

Em outubro, essa devolução aparece em **despesas = −100,00**, resultando em saldo do período +100,00.
A coluna informativa `estornosDespesa` mostra 100,00; ela não é somada novamente ao saldo. Receitas
seguem a mesma lógica inversa. Totais, categorias, filtro por bloco e exportações usam valores líquidos.
Um estorno de transferência inverte os efeitos nos dois blocos e continua com efeito geral zero.

A data do estorno deve ser igual ou posterior à do original, respeitar os saldos iniciais e pertencer
a mês aberto. O motivo é obrigatório. Só um original normal ativo ainda não estornado admite estorno.
Originais estornados e estornos só admitem editar observações, em mês aberto. Excluir um estorno
manual em mês aberto limpa o vínculo no original na mesma transação; estornos de cobranças não
podem ser excluídos isoladamente.

Desfazer pagamento em mês aberto exclui logicamente o ciclo atual de TAXA/JUROS e reabre a cobrança.
Se a data do pagamento estiver fechada, gera estornos desse ciclo com data de hoje em mês aberto.
Correção de pagamento faz o desfazimento e o novo registro em uma transação: qualquer falha reverte
a operação inteira. Ciclos de pagamentos anteriores já estornados permanecem intactos.
O resumo de cobranças mostra a situação atual de cada cobrança; o histórico financeiro permanece
nos lançamentos originais e nos estornos.

## 11. Fechamento e proteção do histórico

O fechamento é sequencial a partir de `inicioContabil` e só alcança meses terminados. Grava o saldo
final de **todos** os blocos (inclusive inativos e zerados), o saldo geral e a quantidade de lançamentos,
sempre pela base `data`, sem filtro. A conferência deve ser zero. A gravação do fechamento e de sua
auditoria ocorre na mesma transação.

Movimentos cuja data esteja no último mês fechado ou em meses anteriores não podem ser registrados,
editados, excluídos nem ter rateio recalculado. Edições verificam a data antiga e a nova, evitando mover
um lançamento para escapar da proteção. Competência fechada com data em mês aberto continua aceita.
Alterações de saldo inicial verificam as datas antiga e nova; alterar o início contábil exige ausência
de fechamentos. Anexar comprovantes continua permitido e auditado, mas removê-los exige mês aberto.

Reabrir exige motivo e só é permitido para o último fechamento. A integridade recalcula os saldos
fechados pela mesma base, compara-os ao snapshot e aponta divergências. Também verifica vínculos
de estorno/pagamento, rateios, datas, duplicidades, categorias e anexos ausentes/órfãos. Atualização
de um registro após fechar seu mês gera aviso para conferência, inclusive quando decorre de um
vínculo de estorno autorizado; o aviso não equivale a divergência de saldo.

Categorias com lançamentos vinculados, inclusive excluídos, não podem mudar de receita para despesa
ou vice-versa; a renomeação permanece disponível. Manutenção em lote só recalcula rateios gerais
normais ativos, ainda não estornados e em meses abertos. A prévia é validada novamente ao aplicar;
se mudou ou ocorreu falha, nenhum item do lote é gravado.
