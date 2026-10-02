import { supabase } from './supabase'
import { calcularFCTeorico } from './fatoresCorrecaoApi'

// ── PRODUÇÃO (migration_v14.sql, com frente desde migration_v15.sql) ─────────
// Registro da etapa de transformação: o que entrou, o que saiu, e quanto rendeu de verdade.
//
// O saldo por CONTAGEM continua exatamente como sempre foi: MEDIDO pela contagem, nunca calculado
// por movimento (`itens_contagem`/`Saldo.jsx`, intocados por este módulo).
//
// Desde a v15, quando a produção tem `frente_id`, finalizar TAMBÉM lança movimento no saldo
// CALCULADO por frente (`estoque_movimentos`/`saldo_calculado_frente`, ver `estoqueMovimentosApi.js`)
// — ledger próprio, separado do saldo por contagem, pra não arriscar duplicar contagem. Produção
// sem frente (lançamento antigo, ou alguém sem frente escolhida) não lança nenhum movimento.
//
// Módulo próprio (e não dentro de api.js) porque produção não tem nada a ver com o fluxo de
// sessão/contagem: não tem itens esperados, não tem loja (tem frente), não finaliza no mesmo dia.

const SELECT_PRODUCAO = `
  id, data, turno, status, usuario_inicio, usuario_fim, iniciada_em, finalizada_em,
  planejada, meta_quantidade, meta_codigo_everest, observacao, frente_id, producao_origem_id,
  frentes ( nome ),
  producoes_itens ( id, papel, codigo_everest, produto_id, quantidade, unidade, usuario, registrado_em, produtos ( nome, unidade_medida ) )
`

// Produção em andamento pertence à COZINHA, não a quem abriu: quem inicia pode não ser quem
// finaliza (troca de turno, preparo que atravessa dias). Por isso a lista NÃO filtra por usuário.
// `frenteId` é opcional — filtra pra só a frente de quem está vendo, quando fizer sentido na tela.
// Só traz produções que JÁ têm pelo menos uma entrada (as "planejadas" sem item vivem em
// `listarProducoesPlanejadas`, pra não misturar "a fazer" com "sendo feita agora") E que sejam
// RAIZ da cadeia (sem `producao_origem_id`) — desde que a tela de Produção passou a mostrar a
// cadeia inteira numa página só (§ pedido do Felipe, 02/10/2026, ver `buscarCadeiaProducao`), uma
// etapa intermediária não aparece mais como item separado aqui, só dentro da cadeia da sua raiz.
export async function listarProducoesEmAndamento(frenteId) {
  let q = supabase
    .from('producoes')
    .select(SELECT_PRODUCAO)
    .eq('status', 'em_andamento')
    .is('producao_origem_id', null)
  if (frenteId) q = q.eq('frente_id', frenteId)
  const { data, error } = await q.order('iniciada_em', { ascending: true }) // a mais antiga primeiro: é a que está esperando há mais tempo
  if (error) throw error
  return (data || []).filter((p) => (p.producoes_itens || []).length > 0)
}

// "A fazer": linhas planejadas (campos que já existiam desde a v14, sem tela até agora — pedido
// do Felipe) que ainda não têm nenhum item lançado. Viram "em andamento" assim que alguém usa
// `iniciarProducaoPlanejada`.
export async function listarProducoesPlanejadas(frenteId) {
  let q = supabase
    .from('producoes')
    .select(SELECT_PRODUCAO)
    .eq('planejada', true)
    .eq('status', 'em_andamento')
  if (frenteId) q = q.eq('frente_id', frenteId)
  const { data, error } = await q.order('iniciada_em', { ascending: true })
  if (error) throw error
  return (data || []).filter((p) => (p.producoes_itens || []).length === 0)
}

export async function criarProducaoPlanejada({ data, frenteId, metaCodigoEverest, metaQuantidade, observacao, usuario }) {
  const { data: producao, error } = await supabase
    .from('producoes')
    .insert({
      data,
      frente_id: frenteId || null,
      planejada: true,
      meta_codigo_everest: metaCodigoEverest,
      meta_quantidade: metaQuantidade != null ? Number(metaQuantidade) : null,
      observacao: observacao || null,
      usuario_inicio: usuario || null
    })
    .select()
    .single()
  if (error) throw error
  return producao
}

// Puxa uma produção planejada pra "em andamento de verdade" — preenche a primeira entrada. Depois
// disso ela some de `listarProducoesPlanejadas` e passa a aparecer em `listarProducoesEmAndamento`.
export async function iniciarProducaoPlanejada(producaoId, entrada, usuario) {
  await adicionarItemProducao({ producaoId, papel: 'entrada', ...entrada, usuario })
  const { error } = await supabase
    .from('producoes')
    .update({ usuario_inicio: usuario || null })
    .eq('id', producaoId)
  if (error) throw error
}

export async function listarProducoes({ status, dataInicio, dataFim, limite = 200 } = {}) {
  let q = supabase.from('producoes').select(SELECT_PRODUCAO)
  if (status) q = q.eq('status', status)
  if (dataInicio) q = q.gte('data', dataInicio)
  if (dataFim) q = q.lte('data', dataFim)
  const { data, error } = await q.order('data', { ascending: false }).order('iniciada_em', { ascending: false }).limit(limite)
  if (error) throw error
  return data || []
}

// Abre a produção JÁ COM a entrada. Abrir vazio permitiria uma produção sem nada dentro ocupando
// o painel — e "o que estou produzindo" sem dizer de quê não ajuda ninguém.
export async function abrirProducao({ data, turno, usuario, entrada, observacao, frenteId, producaoOrigemId }) {
  if (!entrada?.codigoEverest) throw new Error('Produção precisa de pelo menos um item de entrada.')
  if (!(Number(entrada.quantidade) > 0)) throw new Error('A quantidade de entrada precisa ser maior que zero.')

  const { data: producao, error } = await supabase
    .from('producoes')
    .insert({
      data, turno: turno || null, usuario_inicio: usuario || null, observacao: observacao || null,
      frente_id: frenteId || null,
      producao_origem_id: producaoOrigemId || null
    })
    .select()
    .single()
  if (error) throw error

  try {
    await adicionarItemProducao({ producaoId: producao.id, papel: 'entrada', ...entrada, usuario })
  } catch (e) {
    // Produção sem entrada é lixo no painel: se a linha falhou, desfaz o cabeçalho em vez de
    // deixar um registro pela metade que alguém vai ter que limpar depois.
    await supabase.from('producoes').delete().eq('id', producao.id)
    throw e
  }
  return producao
}

export async function adicionarItemProducao({ producaoId, papel, codigoEverest, produtoId, quantidade, unidade, usuario }) {
  const { data, error } = await supabase
    .from('producoes_itens')
    .insert({
      producao_id: producaoId,
      papel,
      codigo_everest: codigoEverest, // identidade canônica (§1) — é o que faltava nas tabelas antigas
      produto_id: produtoId || null,
      quantidade: Number(quantidade),
      unidade: unidade || null,
      usuario: usuario || null
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function removerItemProducao(itemId) {
  const { error } = await supabase.from('producoes_itens').delete().eq('id', itemId)
  if (error) throw error
}

// Corrigir um peso já lançado (§ pedido do Felipe, 02/10/2026) — antes só dava pra apagar e
// relançar; editar direto é mais rápido e não perde o horário/usuário do lançamento original.
export async function editarQuantidadeItemProducao(itemId, novaQuantidade) {
  const { error } = await supabase.from('producoes_itens').update({ quantidade: Number(novaQuantidade) }).eq('id', itemId)
  if (error) throw error
}

export async function buscarProducaoPorId(id) {
  const { data, error } = await supabase.from('producoes').select(SELECT_PRODUCAO).eq('id', id).single()
  if (error) throw error
  return data
}

export async function listarProducoesPorOrigem(origemIds) {
  if (!origemIds?.length) return []
  const { data, error } = await supabase.from('producoes').select(SELECT_PRODUCAO).in('producao_origem_id', origemIds)
  if (error) throw error
  return data || []
}

// Monta a cadeia inteira (raiz + todos os descendentes, de qualquer profundidade) a partir de
// QUALQUER produção dela — usado pela tela única de lançamento (§ pedido do Felipe, 02/10/2026:
// "abre a tela, coloca o insumo base, e ele fica como cabeçalho; embaixo ficam os derivados e
// subprodutos"). Sobe até a raiz, depois desce juntando todo mundo que descende dela.
export async function buscarCadeiaProducao(producaoId) {
  let atual = await buscarProducaoPorId(producaoId)
  while (atual.producao_origem_id) atual = await buscarProducaoPorId(atual.producao_origem_id)
  const raiz = atual
  const todas = [raiz]
  let fronteira = [raiz.id]
  while (fronteira.length) {
    const filhos = await listarProducoesPorOrigem(fronteira)
    todas.push(...filhos)
    fronteira = filhos.map((f) => f.id)
  }
  return todas
}

// Finalizar exige pelo menos uma saída — senão o evento não mede nada, que é o único motivo de
// existir deste módulo. Não exige que a conta FECHE: se saiu menos do que entrou, a diferença é o
// rendimento do processo, que é justamente o dado que queremos. Forçar a bater faria o time
// inventar número.
export async function finalizarProducao(producaoId, usuario) {
  const { data: itens, error: erroItens } = await supabase
    .from('producoes_itens').select('id, papel').eq('producao_id', producaoId)
  if (erroItens) throw erroItens
  if (!(itens || []).some((i) => i.papel === 'saida')) {
    throw new Error('Registre pelo menos um item produzido antes de finalizar.')
  }
  const { error } = await supabase
    .from('producoes')
    .update({ status: 'concluida', usuario_fim: usuario || null, finalizada_em: new Date().toISOString() })
    .eq('id', producaoId)
  if (error) throw error
}

// Cancelar em vez de apagar: o registro sai das contas mas não some (§5, "não sumir com nada").
export async function cancelarProducao(producaoId, usuario) {
  const { error } = await supabase
    .from('producoes')
    .update({ status: 'cancelada', usuario_fim: usuario || null, finalizada_em: new Date().toISOString() })
    .eq('id', producaoId)
  if (error) throw error
}

// ── Leitura derivada ─────────────────────────────────────────────────────────

// Rendimento do EVENTO: quanto saiu dividido pelo que entrou.
//
// ⚠️ Só faz sentido quando entradas e saídas estão na MESMA unidade (kg com kg). Misturar kg com
// unidades daria um número sem significado — nesse caso devolve null em vez de um número bonito e
// errado.
export function rendimentoDoEvento(producao) {
  const itens = producao?.producoes_itens || []
  const unidades = new Set(itens.map((i) => String(i.unidade || '').toUpperCase()).filter(Boolean))
  if (unidades.size > 1) return null

  const entrada = itens.filter((i) => i.papel === 'entrada').reduce((a, i) => a + Number(i.quantidade || 0), 0)
  const saida = itens.filter((i) => i.papel === 'saida').reduce((a, i) => a + Number(i.quantidade || 0), 0)
  if (!(entrada > 0)) return null
  return {
    entrada,
    saida,
    perda: entrada - saida,
    aproveitamento: saida / entrada,
    unidade: [...unidades][0] || ''
  }
}

// "Esperado" do F.C. teórico de um item: média de todas as ordens concluídas anteriores pra esse
// mesmo código. Sem histórico ainda, a semente é ~100% (ver `fatoresCorrecaoApi.js` — nunca o
// fator do passo isolado, isso dá número errado). Recalcula na hora em vez de guardar, porque
// `fatores_correcao` pode mudar com o tempo e queremos sempre comparar com o conhecimento atual.
export async function mediaFCTeoricoHistorico(codigoEverest, mapaFatores) {
  const concluidas = await listarProducoes({ status: 'concluida', limite: 500 })
  const valores = []
  concluidas.forEach((p) => {
    const itens = p.producoes_itens || []
    const entradaTotal = itens.filter((i) => i.papel === 'entrada').reduce((a, i) => a + Number(i.quantidade || 0), 0)
    if (!(entradaTotal > 0)) return
    itens
      .filter((i) => i.papel === 'saida' && i.codigo_everest === codigoEverest)
      .forEach((i) => {
        const fc = calcularFCTeorico(mapaFatores, codigoEverest, Number(i.quantidade), entradaTotal)
        if (fc != null) valores.push(fc)
      })
  })
  if (!valores.length) return 1
  return valores.reduce((a, b) => a + b, 0) / valores.length
}
