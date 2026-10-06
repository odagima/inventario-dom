import { supabase } from './supabase'
import { registrarMovimento } from './estoqueMovimentosApi'

// Requisição × Transferência (migration_v15.sql), distinguidas pela origem (ver
// PLANO-TRANSFORMACAO.md): se a origem é um estoque/cofre que precisa de liberação (Central,
// Compras) → Requisição, alguém atende antes de sair. Se quem manda já tem o material em mãos
// (Produção mandando pra Serviço, ou devolvendo pro Central) → Transferência, só o destino
// confirma recebimento, sem gate de autorização.
//
// Atender requisição exige permissão (ver `podeAtenderRequisicao` em src/lib/permissoes.js) —
// transferência continua sem gate, por design (quem manda já tem o material em mãos).

const SELECT_REQUISICAO = `
  id, codigo_everest, quantidade_solicitada, quantidade_atendida, status,
  usuario_solicitante, usuario_atendente, solicitado_em, atendido_em, observacao,
  solicitante:locais_estoque!requisicoes_local_solicitante_id_fkey ( id, nome ),
  atendente:locais_estoque!requisicoes_local_atendente_id_fkey ( id, nome )
`

export async function listarRequisicoesPendentes(localAtendenteId) {
  let q = supabase.from('requisicoes').select(SELECT_REQUISICAO).in('status', ['pendente', 'atendida_parcial'])
  if (localAtendenteId) q = q.eq('local_atendente_id', localAtendenteId)
  const { data, error } = await q.order('solicitado_em', { ascending: true })
  if (error) throw error
  return data || []
}

export async function listarRequisicoesHistorico(limite = 200) {
  const { data, error } = await supabase
    .from('requisicoes')
    .select(SELECT_REQUISICAO)
    .order('solicitado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  return data || []
}

export async function criarRequisicao({ localSolicitanteId, localAtendenteId, codigoEverest, quantidadeSolicitada, usuario, observacao }) {
  if (localSolicitanteId === localAtendenteId) throw new Error('Origem e destino precisam ser diferentes.')
  if (!(Number(quantidadeSolicitada) > 0)) throw new Error('Informe uma quantidade maior que zero.')
  const { data, error } = await supabase
    .from('requisicoes')
    .insert({
      local_solicitante_id: localSolicitanteId,
      local_atendente_id: localAtendenteId,
      codigo_everest: codigoEverest,
      quantidade_solicitada: Number(quantidadeSolicitada),
      usuario_solicitante: usuario || null
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Atendimento parcial é normal: fecha com o que de fato foi enviado, sem travar a requisição.
// Atender com MAIS do que foi pedido também é normal (ex.: arredondar pro tamanho da embalagem) —
// pedido do Felipe (06/10/2026): "não aceitou com valor diferente do requisitado, nem maior nem
// menor". Quem decide o quanto enviar é o estoquista que está atendendo (ver `podeAtenderRequisicao`
// em src/lib/permissoes.js), não uma trava de quantidade.
export async function atenderRequisicao(requisicaoId, { quantidadeAtendidaAgora, usuario }) {
  const { data: req, error: erroReq } = await supabase.from('requisicoes').select('*').eq('id', requisicaoId).single()
  if (erroReq) throw erroReq
  const qtd = Number(quantidadeAtendidaAgora)
  if (!(qtd > 0)) throw new Error('Informe uma quantidade maior que zero.')
  const jaAtendido = Number(req.quantidade_atendida || 0)
  const totalAtendido = jaAtendido + qtd
  const status = totalAtendido >= Number(req.quantidade_solicitada) - 0.001 ? 'atendida' : 'atendida_parcial'

  await registrarMovimento({
    localEstoqueId: req.local_atendente_id, codigoEverest: req.codigo_everest, quantidade: -qtd,
    tipo: 'requisicao_saida', requisicaoId, usuario
  })
  await registrarMovimento({
    localEstoqueId: req.local_solicitante_id, codigoEverest: req.codigo_everest, quantidade: qtd,
    tipo: 'requisicao_entrada', requisicaoId, usuario
  })

  const { error } = await supabase
    .from('requisicoes')
    .update({
      quantidade_atendida: totalAtendido, status,
      usuario_atendente: usuario || null,
      atendido_em: status === 'atendida' ? new Date().toISOString() : req.atendido_em
    })
    .eq('id', requisicaoId)
  if (error) throw error
}

const SELECT_TRANSFERENCIA = `
  id, codigo_everest, quantidade, status, usuario_envio, usuario_recebimento, enviado_em, recebido_em,
  origem:locais_estoque!transferencias_local_origem_id_fkey ( id, nome ),
  destino:locais_estoque!transferencias_local_destino_id_fkey ( id, nome )
`

export async function listarTransferenciasPendentes(localDestinoId) {
  let q = supabase.from('transferencias').select(SELECT_TRANSFERENCIA).eq('status', 'enviada')
  if (localDestinoId) q = q.eq('local_destino_id', localDestinoId)
  const { data, error } = await q.order('enviado_em', { ascending: true })
  if (error) throw error
  return data || []
}

export async function listarTransferenciasHistorico(limite = 200) {
  const { data, error } = await supabase
    .from('transferencias')
    .select(SELECT_TRANSFERENCIA)
    .order('enviado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  return data || []
}

// Debita a origem no envio — fica "em trânsito" (nem origem nem destino têm o produto nesse
// meio-tempo) até o destino confirmar recebimento, que credita de verdade.
export async function criarTransferencia({ localOrigemId, localDestinoId, codigoEverest, quantidade, usuario }) {
  if (localOrigemId === localDestinoId) throw new Error('Origem e destino precisam ser diferentes.')
  if (!(Number(quantidade) > 0)) throw new Error('Informe uma quantidade maior que zero.')
  const { data: transferencia, error } = await supabase
    .from('transferencias')
    .insert({
      local_origem_id: localOrigemId, local_destino_id: localDestinoId,
      codigo_everest: codigoEverest, quantidade: Number(quantidade), usuario_envio: usuario || null
    })
    .select()
    .single()
  if (error) throw error

  await registrarMovimento({
    localEstoqueId: localOrigemId, codigoEverest, quantidade: -Number(quantidade),
    tipo: 'transferencia_saida', transferenciaId: transferencia.id, usuario
  })
  return transferencia
}

export async function confirmarRecebimentoTransferencia(transferenciaId, usuario) {
  const { data: transferencia, error: erroT } = await supabase.from('transferencias').select('*').eq('id', transferenciaId).single()
  if (erroT) throw erroT
  if (transferencia.status !== 'enviada') throw new Error('Essa transferência já foi recebida ou cancelada.')

  await registrarMovimento({
    localEstoqueId: transferencia.local_destino_id, codigoEverest: transferencia.codigo_everest, quantidade: Number(transferencia.quantidade),
    tipo: 'transferencia_entrada', transferenciaId, usuario
  })

  const { error } = await supabase
    .from('transferencias')
    .update({ status: 'recebida', usuario_recebimento: usuario || null, recebido_em: new Date().toISOString() })
    .eq('id', transferenciaId)
  if (error) throw error
}
