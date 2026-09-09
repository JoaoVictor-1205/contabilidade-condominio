// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarBancoTeste, type BancoTeste } from '../../testes/dbTeste'
import { AppProviders, useConfirmacao } from '../contexto/AppProviders'
import { Modal } from '../componentes/comuns'
import { LancamentoForm } from './LancamentoForm'
import { Avancado } from './Avancado'
import { LancamentoDetalhe } from './LancamentoDetalhe'
import { Unidades } from './Unidades'
import { PagamentoDialogo } from './Cobrancas'
import { useRota } from '../rotas'
import { TabelaDemonstrativo } from './Relatorios'
import { calcularDemonstrativo } from '../../dominio/demonstrativo'
import { periodoDoMes } from '../../dominio/datas'

let t: BancoTeste
vi.mock('../../dados/instancia', () => ({
  get consultas() { return t.consultas }, get servicos() { return t.servicos }, get db() { return t.db },
  relogioApp: { hoje: () => t.relogio.hoje(), agora: () => t.relogio.agora() },
}))
beforeEach(async () => { t = criarBancoTeste('2026-11-04T10:00:00'); await t.db.open(); await t.servicos.estrutura.definirInicioContabil('2026-09') })
afterEach(async () => { cleanup(); await t.fechar() })

describe('telas da v2 e regressões da revisão', () => {
  it('renderiza as quatro abas de Avançado e verifica integridade', async () => {
    const { rerender } = render(<AppProviders><Avancado /></AppProviders>)
    expect(screen.getByRole('heading', { name: 'Avançado' })).toBeInTheDocument()
    await screen.findByRole('button', { name: 'Fechar mês' })
    expect(screen.getByRole('link', { name: 'Manutenção' })).toHaveAttribute('href', '#/avancado/manutencao')
    rerender(<AppProviders><Avancado aba="integridade" /></AppProviders>)
    fireEvent.click(screen.getByRole('button', { name: 'Verificar agora' }))
    await screen.findByText('Nenhuma inconsistência encontrada.')
    rerender(<AppProviders><Avancado aba="auditoria" /></AppProviders>)
    expect(screen.getByLabelText('Buscar na auditoria')).toBeInTheDocument()
    await screen.findByText('Início contábil alterado para 09/2026')
    rerender(<AppProviders><Avancado aba="manutencao" /></AppProviders>)
    expect(screen.getByRole('button', { name: 'Gerar prévia dos rateios' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apagar tudo' })).toBeInTheDocument()
  })
  it('excluir fecha o diálogo e navega para a lista', async () => {
    const l = await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', escopoTipo: 'GERAL', data: '2026-09-10', valorCentavos: 10000, descricao: 'Água', categoriaId: await t.categoriaId('Água e esgoto') })
    location.hash = `#/lancamentos/${l.id}`
    render(<AppProviders><LancamentoDetalhe id={l.id} /></AppProviders>)
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    const dialogo = screen.getByRole('dialog', { name: 'Excluir lançamento' })
    fireEvent.change(within(dialogo).getByLabelText('Motivo'), { target: { value: 'Duplicado' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(location.hash).toBe('#/lancamentos'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect((await t.db.lancamentos.get(l.id))?.status).toBe('EXCLUIDO')
  })
  it('meses fechados oferecem estorno e bloqueiam ações de edição na tela', async () => {
    const l = await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', escopoTipo: 'GERAL', data: '2026-09-10', valorCentavos: 10000, descricao: 'Água', categoriaId: await t.categoriaId('Água e esgoto') })
    await t.servicos.fechamento.fechar('2026-09')
    render(<AppProviders><LancamentoDetalhe id={l.id} /></AppProviders>)
    await screen.findByRole('button', { name: 'Estornar' })
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Estornar' }))
    fireEvent.change(screen.getByLabelText('Motivo do estorno'), { target: { value: 'Reembolso' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar estorno' }))
    await waitFor(async () => expect(await t.db.lancamentos.count()).toBe(2))
    expect((await t.db.lancamentos.get(l.id))?.estornadoPorId).not.toBeNull()
  })
  it('preserva edição de apartamento oculto pela busca e salva todos os editados', async () => {
    const b = await t.bloco('1A')
    render(<AppProviders><Unidades blocoId={b.id} modo="tabela" /></AppProviders>)
    const nome = await screen.findByLabelText('Responsável do apartamento 101')
    fireEvent.change(nome, { target: { value: 'Maria' } })
    expect(screen.getByRole('button', { name: 'Salvar tudo (1)' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: '304' } })
    expect(screen.queryByLabelText('Responsável do apartamento 101')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar tudo (1)' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar tudo (1)' }))
    await waitFor(async () => expect((await t.unidade('1A', '101')).responsavel).toBe('Maria'))
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: '' } })
    await waitFor(() => expect(screen.getByLabelText('Responsável do apartamento 101')).toHaveValue('Maria'))
  })
  it('corrigir apenas a data mantém forma e observações originais', async () => {
    await t.servicos.estrutura.definirTaxa({ quartos: 3, valorCentavos: 45000, vigenteDesde: '2026-09' })
    await t.servicos.cobrancas.gerar('2026-09')
    const c = (await t.consultas.cobrancas.daCompetencia('2026-09'))[0]!
    const { cobranca } = await t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-10', formaPagamento: 'DINHEIRO', observacoes: 'Portaria' })
    const fechar = vi.fn()
    render(<AppProviders><PagamentoDialogo cobranca={cobranca} modo="corrigir" formaPadrao="PIX" onFechar={fechar} /></AppProviders>)
    await screen.findByText(/Forma atual: Dinheiro/)
    expect(screen.getByLabelText('Forma de pagamento')).toHaveValue('DINHEIRO')
    expect(screen.getByLabelText('Observações')).toHaveValue('Portaria')
    fireEvent.change(screen.getByLabelText('Data do pagamento'), { target: { value: '2026-09-11' } })
    fireEvent.change(screen.getByLabelText('Motivo da correção'), { target: { value: 'Ajustar data' } })
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir' }))
    await waitFor(() => expect(fechar).toHaveBeenCalledOnce())
    const atualizado = await t.consultas.cobrancas.obter(c.id)
    expect(await t.consultas.lancamentos.obter(atualizado!.lancamentoId!)).toMatchObject({ data: '2026-09-11', formaPagamento: 'DINHEIRO', observacoes: 'Portaria' })
  })
  it('a edição de pagamento mostra data e competência bloqueadas e preserva o formulário com Escape', async () => {
    await t.servicos.estrutura.definirTaxa({ quartos: 3, valorCentavos: 45000, vigenteDesde: '2026-09' })
    await t.servicos.cobrancas.gerar('2026-09')
    const c = (await t.consultas.cobrancas.daCompetencia('2026-09'))[0]!
    const { cobranca } = await t.servicos.cobrancas.registrarPagamento(c.id, { data: '2026-09-10', formaPagamento: 'PIX' })
    render(<AppProviders><LancamentoForm id={cobranca.lancamentoId!} /></AppProviders>)
    expect(await screen.findByLabelText('Data do pagamento/recebimento')).toBeDisabled()
    expect(screen.getByLabelText('Competência (mês de referência)')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Observações (opcional)'), { target: { value: 'Conferido' } })
    const hash = location.hash
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(location.hash).toBe(hash)
    expect(screen.getByLabelText('Observações (opcional)')).toHaveValue('Conferido')
  })
  it('o formulário mantém selecionado o apartamento de um bloco desativado ao editar o histórico', async () => {
    const u = await t.unidade('1A', '101')
    const l = await t.servicos.lancamentos.registrar({ natureza: 'DESPESA', escopoTipo: 'UNIDADE', unidadeId: u.id, data: '2026-09-10', valorCentavos: 1000, descricao: 'Reparo', categoriaId: await t.categoriaId('Água e esgoto') })
    await t.db.blocos.update(u.blocoId, { ativo: false })
    await t.db.unidades.update(u.id, { ativa: false })
    render(<AppProviders><LancamentoForm id={l.id} /></AppProviders>)
    await waitFor(() => expect(screen.getByLabelText('Bloco')).toHaveValue(u.blocoId))
    expect(screen.getByLabelText('Apartamento')).toHaveValue(u.id)
    expect(screen.getByRole('option', { name: '101 (desativado)' })).toBeInTheDocument()
  })
  it('Escape fecha apenas a confirmação superior e mantém a prévia aberta', async () => {
    const fecharPrevia = vi.fn()
    const resposta = vi.fn()
    function PreviaTeste() {
      const confirmar = useConfirmacao()
      return <Modal titulo="Prévia do backup" onFechar={fecharPrevia}><button onClick={async () => resposta(await confirmar({ titulo: 'Substituir dados?', exigirTexto: 'RESTAURAR' }))}>Restaurar</button></Modal>
    }
    render(<AppProviders><PreviaTeste /></AppProviders>)
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }))
    const superior = screen.getByRole('dialog', { name: 'Substituir dados?' })
    expect(within(superior).getByLabelText('Digite RESTAURAR para confirmar')).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(resposta).toHaveBeenCalledWith(false))
    expect(fecharPrevia).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Prévia do backup' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Substituir dados?' })).not.toBeInTheDocument()
  })
  it('useRota acompanha o hash e a tabela informa estornos e conferência', async () => {
    function RotaTeste() { return <output data-testid="rota">{useRota().nome}</output> }
    location.hash = '#/avancado/integridade'
    render(<RotaTeste />)
    expect(screen.getByTestId('rota')).toHaveTextContent('avancado')
    await act(async () => { location.hash = '#/relatorios'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    expect(screen.getByTestId('rota')).toHaveTextContent('relatorios')
    cleanup()
    const insumos = await t.consultas.relatorios.insumosDemonstrativo(periodoDoMes('2026-09'))
    const dem = calcularDemonstrativo({ ...insumos, periodo: periodoDoMes('2026-09'), hoje: t.relogio.hoje(), agora: t.relogio.agora() })
    dem.total.estornosReceita = 1000
    render(<TabelaDemonstrativo dem={dem} />)
    expect(screen.getByText(/Inclui estornos: receitas/)).toBeInTheDocument()
    expect(screen.getByText(/Conferência:/)).toHaveTextContent('0,00')
    expect(screen.queryByRole('columnheader', { name: 'Saldo inicial' })).not.toBeInTheDocument()
  })
})
