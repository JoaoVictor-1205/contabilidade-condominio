# Contabilidade do Condomínio — guia do síndico (versão 2)

Sistema para registrar entradas e saídas, controlar a taxa condominial por apartamento, guardar comprovantes e documentos e emitir o demonstrativo com o caixa de cada bloco. Funciona **sem internet e sem instalação**: é um único arquivo que abre no navegador.

## Como abrir

1. Copie o arquivo `Contabilidade-Condominio.html` para uma pasta do seu computador (por exemplo, `Documentos\Condominio`).
2. Abra com **duplo clique**. Use o **Google Chrome** ou o **Microsoft Edge**.
3. Na primeira vez, um assistente pede o mês inicial, o nome do condomínio, o valor da taxa por tipo de apartamento e o saldo de cada bloco. Leva uns 2 minutos.

## Onde ficam os dados (leia isto)

- Os dados ficam guardados **dentro do navegador** (Chrome ou Edge) e **no seu usuário do Windows**. Nada vai para a internet.
- **Use sempre o mesmo navegador e o mesmo usuário do Windows.** Se abrir no outro navegador, ele começará vazio: restaure um backup lá.
- "Limpar dados de navegação" apaga os dados do sistema. Por isso, **faça backups**.
- O arquivo `.html` pode ser copiado à vontade; ele não contém os dados.

## Rotina sugerida

**Início do mês**
- Cobranças › **Gerar cobranças** do mês (uma por apartamento, com a taxa vigente).

**Durante o mês**
- Cobranças › marque as taxas pagas: **Pagar** (1 clique), **Pagar…** (com desconto, juros ou comprovante) ou selecione várias e **Registrar pagamento** em lote.
- Lançamentos › **+ Despesa** / **+ Receita** com o comprovante (PDF ou foto). Escolha se pertence ao condomínio inteiro (dividido entre os blocos proporcionalmente aos apartamentos), a um bloco ou a um apartamento.

**Fim do mês**
- Relatórios › escolha o mês, todos os blocos ou um bloco › **Imprimir / PDF** e **Excel**.
- Inadimplência › lista de quem está em atraso (há versão sem nomes para o quadro de avisos).
- Avançado › **Integridade** › Verificar agora; confira o resultado e, em **Fechamento**, feche o mês terminado.
- Backup › **Gerar backup completo** e guarde o arquivo em um pendrive ou na nuvem.

## Como funciona a contabilidade

- Todo dinheiro pertence a algum bloco. O caixa do condomínio é a soma dos blocos.
- Despesas e receitas "do condomínio inteiro" são divididas entre os blocos **proporcionalmente ao número de apartamentos** de cada um. A divisão é gravada no momento do lançamento e não muda depois, mesmo que a estrutura mude.
- O **saldo inicial** de cada bloco (informado no primeiro uso ou em Estrutura › Blocos) é o que o bloco tinha em caixa na data indicada. Não é receita. Nenhum lançamento pode ser anterior a essa data.
- Taxa condominial e juros só entram pelo menu Cobranças. Assim o sistema sabe exatamente quem pagou e quem não pagou.
- Transferências entre blocos movem dinheiro de um caixa para outro sem alterar o total.
- Lançamentos excluídos não somem: ficam marcados como excluídos, com o motivo.
- O demonstrativo usa **regime de caixa** (data em que o dinheiro entrou/saiu). A visão por competência (mês de referência) é gerencial.

## Estrutura editável

Em Estrutura › Blocos você pode renomear blocos, mudar o número de quartos, andares e apartamentos por andar, criar ou desativar blocos. A numeração dos apartamentos é andar + posição (101, 102… 112). Relatórios antigos não mudam.

## Backup e restauração

- **Gerar backup completo** cria um `.zip` com todos os registros (`dados.json`) e todos os comprovantes e documentos (pasta `anexos/`). Os comprovantes podem ser abertos direto do ZIP.
- **Restaurar** substitui todos os dados do navegador pelos do arquivo. Use para trocar de computador ou desfazer algo.
- Se o backup ficar muito grande, gere backups **só dos anexos de um ano** e guarde os arquivos de todos os anos. Cada ZIP contém todos os registros e todos os metadados dos anexos, mas apenas os arquivos do ano escolhido (pela data em que foram anexados).
- Para restaurar backups por ano, comece pelo ZIP com os registros mais recentes. Depois use **Continuar restauração** para adicionar os arquivos dos demais anos da mesma instalação. A continuação apenas completa anexos compatíveis; não substitui os registros já restaurados. A tela mostra quantos anexos ainda faltam.
- Se uma restauração completa for interrompida, use **Continuar restauração** com o mesmo arquivo. Não feche a janela durante a gravação. O ZIP é validado antes da substituição dos dados; os arquivos são gravados em lotes que podem ser retomados.
- Arquivos de outra instalação ou com metadados incompatíveis são recusados na continuação. Os backups da versão 1 são migrados ao restaurar. Backups antigos por ano não guardavam os metadados dos demais anos: prefira gerar novos backups na versão 2, a partir da instalação completa.
- Cada ZIP tem limite de 1,5 GB e 60.000 arquivos de anexos. A geração usa memória do navegador; se ele não suportar o volume, divida por ano. O JSON sem anexos serve para consulta/migração e não substitui o backup ZIP.
- O sistema avisa na tela inicial quando há alterações sem backup.

## Fechamento de mês, estorno e integridade

- **Avançado › Fechamento:** fecha os meses em sequência, começando pelo início contábil. Só é possível fechar um mês já terminado. O sistema guarda o saldo de todos os blocos e protege os movimentos pela data do pagamento/recebimento. A competência continua sendo uma visão gerencial.
- Em mês fechado, não é possível registrar, editar, excluir ou recalcular movimentos, nem alterar saldos iniciais que afetem o fechamento. Ainda é permitido adicionar comprovantes; removê-los exige reabrir o mês.
- **Estornar**, no detalhe de um lançamento, registra o efeito contrário em uma data de mês aberto, com motivo obrigatório. O original permanece visível e ligado ao estorno. O estorno conserva a competência e a divisão original entre os blocos. Receitas e despesas dos relatórios ficam líquidas dos estornos, com uma nota informando os valores estornados.
- Em **Cobranças**, desfazer um pagamento de mês fechado gera estornos da taxa e dos juros e reabre a cobrança. Corrigir o pagamento faz isso e registra o novo pagamento em mês aberto, na mesma operação. Se houver falha, a correção inteira é desfeita.
- Um lançamento já estornado e o próprio estorno só permitem editar observações em mês aberto. Excluir um estorno manual em mês aberto devolve a validade ao original; estornos de cobranças são tratados pelo fluxo de pagamentos.
- Para uma revisão excepcional, **Reabrir último mês** exige um motivo. Para alcançar meses anteriores, reabra do mais recente para o mais antigo. Todas essas ações ficam na auditoria.
- **Avançado › Integridade:** verifica rateios, pagamentos, estornos, saldos fechados, duplicidades e anexos. Erros e avisos são exibidos com links. A verificação não modifica dados. Anexos ainda pendentes de um backup parcial aparecem como ausentes até a complementação.
- **Avançado › Auditoria:** permite pesquisar ações, motivos e valores anteriores/novos dos campos alterados.
- **Avançado › Manutenção:** mostra a prévia das cotas antes de recalcular rateios de um período aberto. A aplicação é integral e recusa uma prévia desatualizada. **Apagar tudo** também fica nessa aba e exige digitar `APAGAR`.

## Limitações conhecidas

- Um usuário por vez, sem login. Para compartilhar, envie o PDF/Excel dos relatórios ou o arquivo de backup.
- Não há parcelamento de taxa: informar um valor pago menor quita a cobrança com desconto. O sistema não cria saldo residual nem novas parcelas.
- Pagamentos em lote são independentes: os concluídos permanecem gravados e a tela lista as falhas, permitindo repetir apenas os pendentes.

## Para desenvolvedores

Código-fonte em TypeScript/React na pasta do projeto. Para reconstruir o arquivo:

```
powershell -ExecutionPolicy Bypass -File scripts\setup-node.ps1   (uma vez; baixa o Node 24 portátil em .tools\node)
. .\scripts\use-node.ps1                                          (em cada terminal fora do VS Code)
npm install
npm run typecheck
npm test
npm run build
npm run verificar      (testes em Chrome e Edge, com perfis descartáveis)
npm run empacotar      → entrega\Contabilidade-Condominio.html
npm run capturas       (capturas de tela com dados fictícios em docs\capturas)
npm run docs:pdf       → docs\Documentacao-Contabilidade-Condominio.pdf (e cópia em entrega\)
```

Código-fonte e documentação: https://github.com/JoaoVictor-1205/contabilidade-condominio
