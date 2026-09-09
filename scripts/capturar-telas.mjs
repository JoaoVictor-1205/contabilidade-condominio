// Captura telas do sistema (dist/index.html) em Chrome headless, com perfil descartável e dados fictícios,
// para ilustrar a documentação (docs/capturas). Não usa perfis nem dados do usuário.
// Uso: node scripts/capturar-telas.mjs [caminho-do-chrome]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const saida = join(raiz, 'docs', 'capturas')
const exe = process.argv[2] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const viewport = { width: 1366, height: 900 }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const afirmar = (condicao, mensagem) => { if (!condicao) throw new Error(mensagem) }

async function main() {
  afirmar(existsSync(exe), `Navegador ausente: ${exe}`)
  afirmar(existsSync(join(raiz, 'dist', 'index.html')), 'Rode npm run build antes.')
  mkdirSync(saida, { recursive: true })
  const perfil = mkdtempSync(join(tmpdir(), 'capturas-condominio-'))
  const porta = 9700 + Math.floor(Math.random() * 200)
  const processo = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--hide-scrollbars', `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
  let socket
  const logs = []
  try {
    let alvo
    for (let i = 0; i < 100 && !alvo; i++) {
      try { alvo = (await (await fetch(`http://127.0.0.1:${porta}/json`)).json()).find((t) => t.type === 'page') } catch { /* aguarda */ }
      if (!alvo) await esperar(200)
    }
    afirmar(alvo, 'DevTools não respondeu.')
    socket = new WebSocket(alvo.webSocketDebuggerUrl)
    await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej })
    let proximoId = 0
    const pendentes = new Map()
    socket.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id) {
        const p = pendentes.get(m.id)
        if (p) { pendentes.delete(m.id); m.error ? p.rejeitar(new Error(JSON.stringify(m.error))) : p.resolver(m.result) }
      } else if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
    const comando = (method, params = {}) => new Promise((resolver, rejeitar) => {
      const id = ++proximoId
      pendentes.set(id, { resolver, rejeitar })
      socket.send(JSON.stringify({ id, method, params }))
    })
    const avaliar = async (expressao) => {
      const r = await comando('Runtime.evaluate', { expression: expressao, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result?.value
    }
    const aguardar = async (expressao, descricao, tempo = 20000) => {
      const limite = Date.now() + tempo
      while (Date.now() < limite) {
        try { const v = await avaliar(expressao); if (v) return v } catch { /* recarregando */ }
        await esperar(100)
      }
      throw new Error(`Não ficou pronto: ${descricao}`)
    }
    const navegar = async (hash) => {
      await avaliar(`location.hash = ${JSON.stringify(hash)}`)
      await esperar(300)
      await aguardar(`location.hash === ${JSON.stringify(hash)} && document.querySelector('main h1')?.innerText && !document.querySelector('main')?.innerText.includes('Carregando...')`, hash)
      await esperar(400)
    }
    const clicar = async (texto, emDialogo = false) => {
      const seletor = emDialogo ? '[role="dialog"] button' : 'button'
      await avaliar(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(seletor)})].find(b => b.textContent.trim() === ${JSON.stringify(texto)}); if (!b || b.disabled) throw new Error('Botão indisponível: ' + ${JSON.stringify(texto)}); b.click(); return true })()`)
      await esperar(300)
    }
    const capturar = async (arquivo) => {
      await avaliar('window.scrollTo(0, 0)')
      await esperar(150)
      const { data } = await comando('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(join(saida, `${arquivo}.png`), Buffer.from(data, 'base64'))
      console.log(`captura: ${arquivo}.png`)
    }

    await comando('Runtime.enable')
    await comando('Page.enable')
    await comando('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
    await comando('Page.navigate', { url: pathToFileURL(join(raiz, 'dist', 'index.html')).href + '#/' })
    await aguardar('window.__sindico?.db.isOpen() && window.__sindico.db.condominio.count().then(n => n === 1)', 'seed inicial')
    await aguardar(`document.querySelector('main h1, h1')?.innerText`, 'primeira tela')
    await esperar(500)
    await capturar('01-primeiro-uso')

    // Cenário fictício: 3 meses fechados/abertos, cobranças, despesas rateadas, transferência, estorno.
    const cenario = await avaliar(`(async () => {
      const { db, servicos: s } = window.__sindico;
      const mesDe = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0')].join('-');
      const hojeD = new Date();
      const hoje = mesDe(hojeD) + '-' + String(hojeD.getDate()).padStart(2, '0');
      const meses = [3, 2, 1, 0].map(n => mesDe(new Date(hojeD.getFullYear(), hojeD.getMonth() - n, 1)));
      const inicio = meses[0];
      await s.sistema.concluirOnboarding();
      await s.estrutura.definirInicioContabil(inicio);
      await s.estrutura.atualizarCondominio({ nome: 'Condomínio Residencial Exemplo', diaVencimento: 10, sindico: 'Síndico(a) de demonstração', endereco: 'Rua Fictícia, 100 — Cidade/UF' });
      const blocos = await db.blocos.orderBy('ordem').toArray();
      await s.estrutura.definirSaldosIniciaisEmLote(blocos.map((b, i) => ({ blocoId: b.id, valorCentavos: 120000 + i * 8750, data: inicio + '-01' })));
      for (const quartos of new Set(blocos.map(b => b.quartos))) await s.estrutura.definirTaxa({ quartos, vigenteDesde: inicio, valorCentavos: quartos === 2 ? 32000 : 42000 });
      const categorias = await db.categorias.toArray();
      const cat = (nome) => categorias.find(c => c.nome === nome).id;
      const unidades = await db.unidades.toArray();
      const nomes = ['Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Diego Rocha', 'Elaine Costa', 'Fábio Nunes', 'Gabriela Reis', 'Heitor Alves', 'Isabela Pires', 'João Ferreira', 'Karina Melo', 'Lucas Prado', 'Marina Dias', 'Nelson Braga', 'Olívia Ramos', 'Paulo Teixeira'];
      const primeiroBloco = blocos[0];
      const unidadesPrimeiro = unidades.filter(u => u.blocoId === primeiroBloco.id).sort((a, b) => a.numero.localeCompare(b.numero));
      await s.estrutura.atualizarUnidadesEmLote(unidadesPrimeiro.map((u, i) => ({ id: u.id, dados: { responsavel: nomes[i % nomes.length], telefone: '(47) 9 9999-00' + String(i + 10).slice(-2) } })));
      const despesasFixas = [
        ['Energia elétrica', 'Energia elétrica das áreas comuns', 248000, 5],
        ['Água e esgoto', 'Conta de água e esgoto', 315000, 7],
        ['Limpeza e conservação', 'Serviço de limpeza mensal', 420000, 8],
        ['Segurança/portaria', 'Portaria terceirizada', 980000, 12],
        ['Manutenção e reparos', 'Manutenção dos elevadores', 135000, 15],
      ];
      let despesaParaEstorno = null;
      let despesaComAnexo = null;
      for (const [i, mes] of meses.entries()) {
        const emCurso = mes === meses[meses.length - 1];
        for (const [categoria, descricao, valor, dia] of despesasFixas) {
          if (emCurso && dia > hojeD.getDate()) continue;
          const l = await s.lancamentos.registrar({ natureza: 'DESPESA', data: mes + '-' + String(dia).padStart(2, '0'), descricao, valorCentavos: valor + i * 1500, categoriaId: cat(categoria), escopoTipo: 'GERAL', formaPagamento: 'BOLETO' });
          if (i === 2 && categoria === 'Manutenção e reparos') despesaParaEstorno = l;
          if (i === 2 && categoria === 'Energia elétrica') despesaComAnexo = l;
        }
        if (!emCurso) {
          await s.lancamentos.registrar({ natureza: 'DESPESA', data: mes + '-18', descricao: 'Reparo no portão do bloco', valorCentavos: 78000, categoriaId: cat('Manutenção e reparos'), escopoTipo: 'BLOCO', blocoId: blocos[2].id, formaPagamento: 'PIX' });
          await s.lancamentos.registrar({ natureza: 'RECEITA', data: mes + '-20', descricao: 'Aluguel do salão de festas', valorCentavos: 30000, categoriaId: cat('Aluguel de espaços'), escopoTipo: 'BLOCO', blocoId: blocos[0].id, formaPagamento: 'PIX' });
        }
        const geracao = await s.cobrancas.gerar(mes);
        const cobrancas = await db.cobrancas.where('competencia').equals(mes).toArray();
        const proporcaoPaga = emCurso ? 0.55 : 0.93;
        const pagas = cobrancas.filter((c, idx) => (idx * 7919) % 100 < proporcaoPaga * 100);
        const diaPagamento = emCurso ? String(Math.max(1, Math.min(hojeD.getDate(), 8))).padStart(2, '0') : '08';
        await s.cobrancas.registrarPagamentosEmLote(pagas.map(c => c.id), { data: mes + '-' + diaPagamento, formaPagamento: 'PIX' });
        if (!emCurso) {
          const atrasadas = cobrancas.filter(c => !pagas.includes(c)).slice(0, 4);
          for (const c of atrasadas) await s.cobrancas.registrarPagamento(c.id, { data: mes + '-25', formaPagamento: 'DINHEIRO', jurosCentavos: 1500, observacoes: 'Pago com atraso' });
        }
        if (i === 1) await s.lancamentos.registrarTransferencia({ data: mes + '-22', valorCentavos: 50000, descricao: 'Reforço de caixa para o bloco 1B', blocoOrigemId: blocos[0].id, blocoDestinoId: blocos[1].id });
      }
      const nota = { nome: 'nota-fiscal-energia.txt', mime: 'text/plain', blob: new Blob(['Nota fiscal fictícia de demonstração'], { type: 'text/plain' }) };
      await s.anexos.adicionar('LANCAMENTO', despesaComAnexo.id, [nota]);
      await s.documentos.criar({ titulo: 'Ata da assembleia ordinária', categoria: 'ATA', data: meses[1] + '-15', descricao: 'Aprovação das contas e do orçamento' }, [{ nome: 'ata-assembleia.txt', mime: 'text/plain', blob: new Blob(['Ata fictícia'], { type: 'text/plain' }) }]);
      await s.documentos.criar({ titulo: 'Contrato de portaria', categoria: 'CONTRATO', data: inicio + '-02' }, []);
      await s.fechamento.fechar(meses[0]);
      await s.fechamento.fechar(meses[1]);
      const estorno = await s.lancamentos.estornar(despesaParaEstorno.id, hoje, 'Fornecedor cobrou a manutenção em duplicidade; valor devolvido.');
      const unidadeExtrato = unidadesPrimeiro[0];
      return { hoje, meses, blocoId: primeiroBloco.id, unidadeId: unidadeExtrato.id, despesaId: despesaParaEstorno.id, estornoId: estorno?.id ?? null, despesaComAnexoId: despesaComAnexo.id };
    })()`)
    console.log('cenário:', JSON.stringify(cenario))
    const mesAtual = cenario.meses[cenario.meses.length - 1]

    await navegar('#/')
    await capturar('02-inicio')
    await navegar('#/lancamentos')
    await capturar('03-lancamentos')
    await navegar(`#/lancamentos/${cenario.despesaId}`)
    await capturar('04-lancamento-detalhe-estornado')
    await navegar('#/lancamentos/novo?natureza=DESPESA')
    await capturar('05-lancamento-novo')
    await navegar(`#/cobrancas?competencia=${mesAtual}`)
    await capturar('06-cobrancas')
    await navegar('#/inadimplencia')
    await capturar('07-inadimplencia')
    await navegar(`#/unidades?bloco=${cenario.blocoId}&modo=grade`)
    await capturar('08-apartamentos-grade')
    await navegar(`#/unidades/${cenario.unidadeId}`)
    await capturar('09-apartamento-detalhe')
    await navegar('#/relatorios')
    await capturar('10-relatorios')
    await navegar(`#/relatorios/unidade/${cenario.unidadeId}`)
    await capturar('11-extrato-apartamento')
    await navegar('#/arquivo')
    await capturar('12-arquivo')
    await navegar('#/estrutura/blocos')
    await capturar('13-estrutura-blocos')
    await navegar('#/estrutura/taxas')
    await capturar('14-estrutura-taxas')
    await navegar('#/backup')
    await capturar('15-backup')
    await navegar('#/avancado/fechamento')
    await capturar('16-avancado-fechamento')
    await navegar('#/avancado/integridade')
    await clicar('Verificar agora')
    await aguardar(`document.querySelector('main').innerText.includes('Verificado em')`, 'resultado da integridade')
    await esperar(400)
    await capturar('17-avancado-integridade')
    await navegar('#/avancado/auditoria')
    await capturar('18-avancado-auditoria')
    await navegar('#/avancado/manutencao')
    await capturar('19-avancado-manutencao')

    if (logs.length) {
      console.log('Ocorrências no console:')
      for (const l of logs) console.log(' -', l)
      process.exitCode = 1
    } else console.log('Sem erros de console.')
  } finally {
    try { socket?.close() } catch { /* ignorar */ }
    processo.kill()
    await esperar(1500)
    for (let i = 0; i < 5; i++) {
      try { rmSync(perfil, { recursive: true, force: true }); break } catch { await esperar(1000) }
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
