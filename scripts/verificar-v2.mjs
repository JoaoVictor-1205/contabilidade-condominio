// Verificação em file:// com Chrome/Edge e perfil descartável próprio; não usa dados do usuário.
// Uso: .tools/node/node.exe scripts/verificar-v2.mjs [chrome|edge|todos]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const saida = join(raiz, '.tools', 'qa-v2')
const perfis = join(saida, 'perfis')
mkdirSync(perfis, { recursive: true })
const navegadores = {
  chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
}
const selecionado = process.argv[2] ?? 'todos'
const esperar = (ms) => new Promise(r => setTimeout(r, ms))
const afirmar = (condicao, mensagem) => { if (!condicao) throw new Error(mensagem) }

async function verificar(nome, exe) {
  afirmar(existsSync(exe), `Navegador ausente: ${exe}`)
  const perfil = mkdtempSync(join(perfis, `qa-${nome}-`))
  const porta = 9600 + Math.floor(Math.random() * 500)
  const processo = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
  const relatorio = { navegador: nome, executavel: exe, iniciadoEm: new Date().toISOString(), viewport: { width: 1440, height: 1000 }, verificacoes: [], rotas: [], logs: [], screenshots: [] }
  let socket
  try {
    let alvo
    for (let i = 0; i < 100; i++) {
      try { alvo = (await (await fetch(`http://127.0.0.1:${porta}/json`)).json()).find(t => t.type === 'page') } catch { /* aguarda o navegador */ }
      if (alvo) break
      await esperar(200)
    }
    afirmar(alvo, 'DevTools não respondeu em 20 segundos.')
    socket = new WebSocket(alvo.webSocketDebuggerUrl)
    await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej })
    let proximoId = 0
    const pendentes = new Map()
    socket.onmessage = ev => {
      const mensagem = JSON.parse(ev.data)
      if (mensagem.id) {
        const pendente = pendentes.get(mensagem.id)
        if (pendente) { clearTimeout(pendente.timer); pendentes.delete(mensagem.id); mensagem.error ? pendente.rejeitar(new Error(JSON.stringify(mensagem.error))) : pendente.resolver(mensagem.result) }
      } else if (mensagem.method === 'Runtime.consoleAPICalled') relatorio.logs.push({ tipo: mensagem.params.type, texto: mensagem.params.args.map(a => a.value ?? a.description ?? '').join(' ') })
      else if (mensagem.method === 'Runtime.exceptionThrown') relatorio.logs.push({ tipo: 'exception', texto: mensagem.params.exceptionDetails.exception?.description ?? mensagem.params.exceptionDetails.text })
    }
    const comando = (method, params = {}) => new Promise((resolver, rejeitar) => {
      const id = ++proximoId
      const timer = setTimeout(() => { pendentes.delete(id); rejeitar(new Error(`Timeout CDP: ${method}`)) }, 30000)
      pendentes.set(id, { resolver, rejeitar, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
    const avaliar = async expressao => {
      const resposta = await comando('Runtime.evaluate', { expression: expressao, returnByValue: true, awaitPromise: true })
      if (resposta.exceptionDetails) throw new Error(resposta.exceptionDetails.exception?.description ?? resposta.exceptionDetails.text)
      return resposta.result?.value
    }
    const aguardar = async (expressao, descricao, tempo = 15000) => {
      const limite = Date.now() + tempo
      while (Date.now() < limite) {
        try { const valor = await avaliar(expressao); if (valor) return valor } catch { /* a página pode estar recarregando */ }
        await esperar(100)
      }
      relatorio.estadoFalha = await avaliar(`({ hash: location.hash, texto: document.body.innerText, dialogos: [...document.querySelectorAll('[role="dialog"]')].map(d => d.outerHTML) })`).catch(() => null)
      const imagemFalha = await comando('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }).catch(() => null)
      if (imagemFalha) { const caminho = join(saida, `${nome}-falha.png`); writeFileSync(caminho, Buffer.from(imagemFalha.data, 'base64')); relatorio.screenshots.push(caminho) }
      throw new Error(`Não ficou pronto: ${descricao}`)
    }
    const checar = (descricao, valor) => {
      afirmar(valor, descricao)
      relatorio.verificacoes.push(descricao)
      console.log(`[${nome}] OK ${descricao}`)
    }
    const clicar = async (texto, emDialogo = false) => {
      const seletor = emDialogo ? '[role="dialog"] button' : 'button'
      await avaliar(`(() => { const botao = [...document.querySelectorAll(${JSON.stringify(seletor)})].find(b => b.textContent.trim() === ${JSON.stringify(texto)}); if (!botao || botao.disabled) throw new Error('Botão indisponível: ' + ${JSON.stringify(texto)}); botao.click(); return true })()`)
      await esperar(120)
    }
    const preencher = (seletor, valor) => avaliar(`(() => { const campo = document.querySelector(${JSON.stringify(seletor)}); if (!campo) throw new Error('Campo ausente'); const proto = campo.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(campo, ${JSON.stringify(valor)}); campo.dispatchEvent(new Event('input', { bubbles: true })); campo.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    const navegar = async hash => {
      await avaliar(`location.hash = ${JSON.stringify(hash)}`)
      await esperar(250)
      return aguardar(`location.hash === ${JSON.stringify(hash)} && document.querySelector('main h1')?.innerText && !document.querySelector('main')?.innerText.includes('Carregando...')`, hash)
    }
    const capturar = async arquivo => {
      await avaliar('window.scrollTo(0, 0)')
      const { data } = await comando('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      const caminho = join(saida, `${nome}-${arquivo}.png`)
      writeFileSync(caminho, Buffer.from(data, 'base64'))
      relatorio.screenshots.push(caminho)
    }
    const restaurarPelaInterface = async (nomeBlob, testarEscape = false) => {
      await navegar('#/backup')
      await avaliar(`(() => {
        const botao = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Escolher arquivo de backup…');
        const campo = botao?.closest('.painel')?.querySelector('input[type=file]');
        if (!campo) throw new Error('Input de restauração ausente');
        const transferencia = new DataTransfer();
        transferencia.items.add(new File([window.__qa[${JSON.stringify(nomeBlob)}]], 'backup-qa.zip', { type: 'application/zip' }));
        campo.files = transferencia.files;
        campo.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`)
      await aguardar(`document.querySelector('[role="dialog"]')?.innerText.includes('Restaurar este backup?')`, 'prévia da restauração pela interface')
      await clicar('Restaurar (substituir tudo)', true)
      await aguardar(`document.querySelectorAll('[role="dialog"]').length === 2 && document.getElementById('confirmacao-texto') !== null`, 'confirmação sobre a prévia')
      if (testarEscape) {
        await comando('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await comando('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await aguardar(`document.querySelectorAll('[role="dialog"]').length === 1 && document.querySelector('[role="dialog"]')?.innerText.includes('Restaurar este backup?')`, 'Escape preserva a prévia')
        checar('Escape fecha apenas a confirmação e preserva a prévia do backup', true)
        await clicar('Restaurar (substituir tudo)', true)
        await aguardar(`document.getElementById('confirmacao-texto') !== null`, 'segunda confirmação da restauração')
      }
      await preencher('#confirmacao-texto', 'RESTAURAR')
      await clicar('Restaurar', true)
    }
    await comando('Runtime.enable')
    await comando('Page.enable')
    await comando('Emulation.setDeviceMetricsOverride', { ...relatorio.viewport, deviceScaleFactor: 1, mobile: false })
    await comando('Page.navigate', { url: pathToFileURL(join(raiz, 'dist', 'index.html')).href + '#/' })
    await aguardar('window.__sindico?.db.isOpen() && window.__sindico.db.condominio.count().then(n => n === 1)', 'seed inicial')
    relatorio.versao = await comando('Browser.getVersion')
    const cenario = await avaliar(`(async () => {
      const { db, servicos: s } = window.__sindico;
      await s.sistema.concluirOnboarding();
      const d = new Date();
      const hoje = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
      const anterior = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const mes = [anterior.getFullYear(), String(anterior.getMonth() + 1).padStart(2, '0')].join('-');
      await s.estrutura.definirInicioContabil(mes);
      await s.estrutura.atualizarCondominio({ nome: 'Condomínio QA v2', diaVencimento: 10 });
      const blocos = await db.blocos.orderBy('ordem').toArray();
      const unidade = await db.unidades.where('blocoId').equals(blocos[0].id).first();
      await s.estrutura.atualizarUnidade(unidade.id, { responsavel: 'Morador de verificação', observacoes: 'Dados fictícios de teste' });
      for (const quartos of new Set(blocos.map(b => b.quartos))) await s.estrutura.definirTaxa({ quartos, vigenteDesde: mes, valorCentavos: quartos * 5000 });
      const categoria = (await db.categorias.toArray()).find(c => c.natureza === 'DESPESA' && !c.sistema);
      const categoriaReceita = (await db.categorias.toArray()).find(c => c.natureza === 'RECEITA' && !c.sistema);
      const despesa = await s.lancamentos.registrar({ natureza: 'DESPESA', data: mes + '-10', descricao: 'Despesa histórica para estorno', valorCentavos: 10000, categoriaId: categoria.id, escopoTipo: 'GERAL', formaPagamento: 'PIX' });
      const receita = await s.lancamentos.registrar({ natureza: 'RECEITA', data: mes + '-11', descricao: 'Receita histórica', valorCentavos: 30000, categoriaId: categoriaReceita.id, escopoTipo: 'BLOCO', blocoId: blocos[0].id });
      await s.lancamentos.registrarTransferencia({ data: mes + '-12', valorCentavos: 900, descricao: 'Transferência de teste', blocoOrigemId: blocos[0].id, blocoDestinoId: blocos[1].id });
      const geracao = await s.cobrancas.gerar(mes);
      const cobranca = await db.cobrancas.where('[unidadeId+competencia]').equals([unidade.id, mes]).first();
      const pagamento = await s.cobrancas.registrarPagamento(cobranca.id, { data: mes + '-15', formaPagamento: 'PIX', jurosCentavos: 500 });
      const arquivo = { nome: 'comprovante.txt', mime: 'text/plain', blob: new Blob(['Comprovante de teste'], { type: 'text/plain' }) };
      await s.documentos.criar({ titulo: 'Ata de teste', categoria: 'ATA', data: hoje }, [arquivo]);
      window.__qa = { hoje, mes, despesa, receita, categoria, unidade, bloco: blocos[0], cobranca, pagamento };
      return { hoje, mes, despesaId: despesa.id, unidadeId: unidade.id, blocoId: blocos[0].id, cobrancaId: cobranca.id, cobrancasGeradas: geracao.criadas };
    })()`)
    relatorio.cenario = cenario
    checar('Seed de 14 blocos e 320 cobranças, início contábil no mês anterior', cenario.cobrancasGeradas === 320)

    await navegar('#/avancado/fechamento')
    await clicar('Fechar mês')
    await aguardar('document.querySelector("[role=dialog]")?.innerText.includes("Fechar")', 'confirmação do fechamento')
    await clicar('Fechar mês', true)
    const fechamento = await aguardar('window.__sindico.db.fechamentos.toArray().then(f => f.length === 1 && f[0])', 'fechamento gravado')
    checar('Fechamento mensal pela interface grava saldo e todos os 14 blocos', fechamento.saldoGeralCentavos === 35500 && fechamento.saldos.length === 14 && fechamento.qtdLancamentos === 5)
    const bloqueios = await avaliar(`(async () => {
      const { servicos: s } = window.__sindico; const q = window.__qa; const resultados = [];
      for (const executar of [
        () => s.lancamentos.registrar({ natureza: 'DESPESA', data: q.mes + '-20', descricao: 'Bloqueada', valorCentavos: 1, categoriaId: q.categoria.id, escopoTipo: 'GERAL' }),
        () => s.lancamentos.atualizar(q.receita.id, { valorCentavos: 1 }),
        () => s.lancamentos.excluir(q.receita.id, 'Teste de proteção')
      ]) { try { await executar(); resultados.push('ACEITO_INDEVIDAMENTE') } catch (e) { resultados.push(e.codigo) } }
      const anexos = await s.anexos.adicionar('LANCAMENTO', q.receita.id, [{ nome: 'apos-fechamento.txt', mime: 'text/plain', blob: new Blob(['Anexo após fechamento'], { type: 'text/plain' }) }]);
      try { await s.anexos.remover(anexos[0].id); resultados.push('ACEITO_INDEVIDAMENTE') } catch (e) { resultados.push(e.codigo) }
      return resultados;
    })()`)
    checar('Mês fechado bloqueia registro, edição, exclusão e remoção de anexo; aceita adicionar anexo', bloqueios.every(c => c === 'MES_FECHADO') && bloqueios.length === 4)
    await navegar(`#/lancamentos/${cenario.despesaId}`)
    checar('Detalhe fechado apresenta aviso e oculta Editar/Excluir', await avaliar(`document.querySelector('main').innerText.includes('Mês fechado') && ![...document.querySelectorAll('main button')].some(b => ['Editar', 'Excluir'].includes(b.textContent.trim()))`))
    await clicar('Estornar')
    await aguardar('!!document.querySelector("[role=dialog] textarea")', 'motivo de estorno')
    await preencher('[role=dialog] textarea', 'Correção verificada em navegador isolado')
    await clicar('Registrar estorno', true)
    const estornoId = await aguardar('window.__sindico.db.lancamentos.get(window.__qa.despesa.id).then(l => l.estornadoPorId)', 'estorno gravado')
    await aguardar(`location.hash === ${JSON.stringify(`#/lancamentos/${estornoId}`)} && !document.querySelector('[role=dialog]')`, 'navegação depois de estornar')
    checar('Estorno pela interface fecha o modal e abre o novo lançamento', await avaliar(`(async () => { const e = await window.__sindico.db.lancamentos.get(${JSON.stringify(estornoId)}); return e.tipo === 'ESTORNO' && e.data === window.__qa.hoje && e.competencia === window.__qa.mes && document.querySelector('main').innerText.includes('Estorna o lançamento') })()`))
    const correcao = await avaliar(`(async () => {
      const { db, servicos: s } = window.__sindico; const q = window.__qa;
      await s.cobrancas.corrigirPagamento(q.cobranca.id, { data: q.hoje, formaPagamento: 'TRANSFERENCIA', jurosCentavos: 200 }, 'Correção após fechamento');
      const c = await db.cobrancas.get(q.cobranca.id);
      const lista = await db.lancamentos.where('cobrancaId').equals(c.id).toArray();
      const problemas = await s.sistema.verificarIntegridade();
      return { status: c.status, data: c.pagaEm, estornos: lista.filter(l => l.tipo === 'ESTORNO').length, normaisAtuais: lista.filter(l => l.tipo === 'NORMAL' && !l.estornadoPorId && l.status === 'ATIVO').length, problemas };
    })()`)
    checar('Corrigir pagamento fechado gera estornos de TAXA/JUROS e novo pagamento no mês aberto', correcao.status === 'PAGA' && correcao.data === cenario.hoje && correcao.estornos === 2 && correcao.normaisAtuais === 2)
    relatorio.integridade = correcao.problemas
    checar('Integridade após fechamento, estorno e correção sem ERRO', correcao.problemas.every(p => p.nivel !== 'ERRO'))

    const rotas = ['#/', '#/lancamentos', '#/lancamentos/novo?natureza=DESPESA', '#/lancamentos/novo?natureza=RECEITA', `#/lancamentos/${cenario.despesaId}`, '#/lancamentos/transferencia', `#/cobrancas?competencia=${cenario.mes}`, '#/inadimplencia', `#/unidades?bloco=${cenario.blocoId}&modo=grade`, `#/unidades?bloco=${cenario.blocoId}&modo=tabela`, `#/unidades/${cenario.unidadeId}`, '#/relatorios', `#/relatorios/unidade/${cenario.unidadeId}`, '#/arquivo', '#/estrutura/condominio', '#/estrutura/blocos', '#/estrutura/taxas', '#/estrutura/categorias', '#/backup', '#/avancado/fechamento', '#/avancado/integridade', '#/avancado/auditoria', '#/avancado/manutencao']
    for (const hash of rotas) {
      const titulo = await navegar(hash)
      const estado = await avaliar(`({ largura: innerWidth, documento: document.documentElement.scrollWidth, temErro: /Algo deu errado|Erro inesperado|Não foi possível carregar/.test(document.querySelector('main')?.innerText ?? ''), texto: document.querySelector('main')?.innerText.slice(0, 200) })`)
      relatorio.rotas.push({ hash, titulo, ...estado })
      checar(`Rota ${hash} renderizada sem erro/overflow externo`, !!titulo && !estado.temErro && estado.documento <= estado.largura)
      if (hash === '#/avancado/integridade') { await clicar('Verificar agora'); await aguardar('document.querySelector("main").innerText.includes("0 erro(s)")', 'integridade na interface') }
      if (hash === '#/avancado/fechamento') await capturar('avancado-fechamento-desktop')
      if (hash === '#/avancado/auditoria') await capturar('avancado-auditoria-desktop')
      if (hash === '#/relatorios') { checar('Relatórios apresentam nota dos estornos', await avaliar(`document.querySelector('main').innerText.includes('Inclui estornos:')`)); await capturar('relatorios-desktop') }
    }

    const preparoCompleto = await avaliar(`(async () => {
      const { db, servicos: s, backup } = window.__sindico;
      const antes = { lancamentos: await db.lancamentos.count(), cobrancas: await db.cobrancas.count(), fechamentos: await db.fechamentos.count(), anexos: await db.anexos.count() };
      const gerado = await backup.gerarBackup(db, { agora: new Date().toISOString() });
      const lido = await backup.lerBackup(gerado.blob);
      window.__qa.backupCompleto = gerado.blob;
      await s.sistema.apagarTudo();
      const apagados = await db.lancamentos.count() === 0 && await db.fechamentos.count() === 0;
      await s.sistema.concluirOnboarding();
      return { antes, apagados, bytes: gerado.blob.size, faltantes: lido.previa.faltantes };
    })()`)
    await restaurarPelaInterface('backupCompleto', true)
    await aguardar(`window.__sindico.db.lancamentos.count().then(n => n === ${preparoCompleto.antes.lancamentos})`, 'restauração completa pela interface')
    await esperar(1200)
    await aguardar('window.__sindico?.db.isOpen() && window.__sindico.db.condominio.count().then(n => n === 1)', 'recarregamento após restauração completa')
    const cicloDepois = await avaliar(`(async () => {
      const { db, servicos: s } = window.__sindico;
      const depois = { lancamentos: await db.lancamentos.count(), cobrancas: await db.cobrancas.count(), fechamentos: await db.fechamentos.count(), anexos: await db.anexos.count() };
      const blobs = await db.anexosBlob.toArray();
      const textos = await Promise.all(blobs.map(a => a.blob.text()));
      const problemas = await s.sistema.verificarIntegridade();
      return { depois, pendente: await db.meta.get('restauracaoEmAndamento'), textos, problemas };
    })()`)
    const ciclo = { ...preparoCompleto, ...cicloDepois }
    relatorio.backup = ciclo
    checar('Backup completo → apagar tudo → restaurar pela interface preserva registros e arquivos', ciclo.apagados && JSON.stringify(ciclo.antes) === JSON.stringify(ciclo.depois) && ciclo.faltantes.length === 0 && !ciclo.pendente && ciclo.textos.includes('Comprovante de teste') && ciclo.textos.includes('Anexo após fechamento'))
    checar('Integridade depois da restauração sem ERRO', ciclo.problemas.every(p => p.nivel !== 'ERRO'))

    // O relógio real não é alterado: apenas este metadado fictício representa um arquivo do ano anterior.
    const preparoParcial = await avaliar(`(async () => {
      const { db, backup } = window.__sindico;
      const ano = new Date().getFullYear();
      const anexos = await db.anexos.toArray();
      await db.anexos.update(anexos[0].id, { criadoEm: (ano - 1) + anexos[0].criadoEm.slice(4) });
      const atual = await backup.gerarBackup(db, { agora: new Date().toISOString(), anoDosAnexos: ano });
      const anterior = await backup.gerarBackup(db, { agora: new Date().toISOString(), anoDosAnexos: ano - 1 });
      const lido = await backup.lerBackup(atual.blob);
      const estranho = await backup.lerBackup(anterior.blob);
      estranho.previa.dados.instalacaoId = 'outra-instalacao-qa';
      estranho.zip.file('dados.json', JSON.stringify(estranho.previa.dados));
      window.__qa = { complementoInvalido: await estranho.zip.generateAsync({ type: 'blob' }), complemento: anterior.blob, backupAnual: atual.blob };
      return { omitidos: lido.previa.omitidosPorAno };
    })()`)
    await restaurarPelaInterface('backupAnual')
    await aguardar(`window.__sindico.db.meta.get('restauracaoEmAndamento').then(p => p?.valor.gravados === 1) && !document.querySelector('[role="dialog"]')`, 'restauração anual pela interface')
    const parcial = { ...preparoParcial, ...await avaliar(`(async () => { const { db } = window.__sindico; return { metadados: await db.anexos.count(), arquivos: await db.anexosBlob.count(), pendente: (await db.meta.get('restauracaoEmAndamento'))?.valor } })()`) }
    relatorio.backupAnual = parcial
    checar('Backup anual preserva todos os metadados e identifica o arquivo do outro ano como pendente', parcial.metadados === 2 && parcial.arquivos === 1 && parcial.omitidos === 1 && parcial.pendente.esperados === 2 && parcial.pendente.gravados === 1)
    await navegar('#/backup')
    await aguardar(`document.querySelector('main').innerText.includes('Continuar restauração')`, 'continuação do backup anual')
    await capturar('backup-anual-pendente-desktop')
    const escolherComplemento = nomeBlob => avaliar(`(() => {
      const botao = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Continuar restauração');
      const campo = botao?.parentElement?.querySelector('input[type=file]');
      if (!campo) throw new Error('Input de continuação ausente');
      const transferencia = new DataTransfer();
      transferencia.items.add(new File([window.__qa[${JSON.stringify(nomeBlob)}]], 'complemento.zip', { type: 'application/zip' }));
      campo.files = transferencia.files;
      campo.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
    await escolherComplemento('complementoInvalido')
    await aguardar(`document.body.innerText.includes('mesma instalação do condomínio')`, 'recusa de outra instalação')
    checar('Complementação pela interface recusa ZIP de outra instalação', await avaliar(`window.__sindico.db.anexosBlob.count().then(n => n === 1)`))
    await escolherComplemento('complemento')
    await aguardar(`window.__sindico.db.meta.get('restauracaoEmAndamento').then(p => !p)`, 'complementação do outro ano')
    await esperar(1200)
    await aguardar('window.__sindico?.db.isOpen() && window.__sindico.db.condominio.count().then(n => n === 1)', 'recarregamento após complementação')
    const anualFinal = await avaliar(`(async () => { const { db, servicos } = window.__sindico; return { metadados: await db.anexos.count(), arquivos: await db.anexosBlob.count(), pendente: await db.meta.get('restauracaoEmAndamento'), problemas: await servicos.sistema.verificarIntegridade() } })()`)
    relatorio.backupAnualFinal = anualFinal
    checar('Complementação do outro ano pela interface restaura todos os arquivos e conclui sem ERRO', anualFinal.metadados === 2 && anualFinal.arquivos === 2 && !anualFinal.pendente && anualFinal.problemas.every(p => p.nivel !== 'ERRO'))
    await navegar('#/avancado/integridade')
    await clicar('Verificar agora')
    await aguardar('document.querySelector("main").innerText.includes("0 erro(s)")', 'integridade final')
    await capturar('avancado-integridade-desktop')
    const erros = relatorio.logs.filter(l => ['error', 'exception', 'assert'].includes(l.tipo))
    checar('Console e exceções sem erros', erros.length === 0)
    relatorio.sucesso = true
  } catch (erro) {
    relatorio.sucesso = false
    relatorio.erro = erro.stack ?? String(erro)
    console.error(`[${nome}] FALHA ${relatorio.erro}`)
  } finally {
    socket?.close()
    if (processo.pid) {
      if (process.platform === 'win32') await new Promise(res => { const fim = spawn('taskkill', ['/PID', String(processo.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); fim.on('exit', res); fim.on('error', res) })
      else processo.kill()
    }
    await esperar(700)
    // Só remove o perfil criado por esta execução, depois de resolver e validar o alvo absoluto.
    const baseReal = realpathSync(perfis)
    const alvoReal = existsSync(perfil) ? realpathSync(perfil) : resolve(perfil)
    const dentro = relative(baseReal, alvoReal)
    afirmar(isAbsolute(alvoReal) && dentro && !dentro.startsWith('..' + sep) && dentro !== '..' && !isAbsolute(dentro) && basename(alvoReal).startsWith(`qa-${nome}-`), 'Perfil fora do diretório de QA; remoção recusada.')
    for (let i = 0; i < 5; i++) {
      try { rmSync(alvoReal, { recursive: true, force: true }); break } catch (erro) { if (i === 4) relatorio.avisoLimpeza = String(erro); else await esperar(500) }
    }
    relatorio.terminadoEm = new Date().toISOString()
    writeFileSync(join(saida, `${nome}-resultado.json`), JSON.stringify(relatorio, null, 2) + '\n')
  }
  return relatorio.sucesso
}

afirmar(selecionado === 'todos' || selecionado in navegadores, 'Escolha chrome, edge ou todos.')
let sucesso = true
for (const [nome, exe] of Object.entries(navegadores)) if (selecionado === 'todos' || selecionado === nome) sucesso = await verificar(nome, exe) && sucesso
process.exitCode = sucesso ? 0 : 1
