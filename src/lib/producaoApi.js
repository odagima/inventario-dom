import { supabase } from './supabase'

// ── PRODUÇÃO (migration_v14.sql) ─────────────────────────────────────────────
// Registro da etapa de transformação: o que entrou, o que saiu, e quanto rendeu de verdade.
//
// ⚠️ NADA AQUI MOVIMENTA ESTOQUE. O estoque é MEDIDO pela contagem, não calculado por movimento —
// a contagem já captura a transformação sozinha (peça a menos, PP a mais). O valor deste módulo
// é medir o RENDIMENTO REAL, que hoje só existe como suposição dentro do fator da ficha.
//
// Módulo próprio (e não dentro de api.js) porque produção não tem nada a ver com o fluxo de
// sessão/contagem: não tem itens esperados, não tem loja, não finaliza no mesmo dia.

const SELECT_PRODUCAO = `
  id, data, turno, status, usuario_inicio, usuario_fim, iniciada_em, finalizada_em,
  planejada, meta_quantidade, meta_codigo_everest, observacao,
  producoes_itens ( id, papel, codigo_everest, produto_id, quantidade, unidade, usuario, registrado_em, produtos ( nome, unidade_medida ) )
`

// Produção em andamento pertence à COZINHA, não a quem abriu: quem inicia pode não ser quem
// finaliza (troca de turno, preparo que atravessa dias). Por isso a lista NÃO filtra por usuário.
export async function listarProducoesEmAndamento() {
  const { data, error } = await supabase
    .from('producoes')
    .select(SELECT_PRODUCAO)
    .eq('status', 'em_andamento')
    .order('iniciada_em', { ascending: true }) // a mais antiga primeiro: é a que está esperando há mais tempo
  if (error) throw error
  return data || []
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
export async function abrirProducao({ data, turno, usuario, entrada, observacao }) {
  if (!entrada?.codigoEverest) throw new Error('Produção precisa de pelo menos um item de entrada.')
  if (!(Number(entrada.quantidade) > 0)) throw new Error('A quantidade de entrada precisa ser maior que zero.')

  const { data: producao, error } = await supabase
    .from('producoes')
    .insert({ data, turno: turno || null, usuario_inicio: usuario || null, observacao: observacao || null })
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
