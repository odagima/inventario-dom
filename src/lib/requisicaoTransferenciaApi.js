import { supabase } from './supabase'
import { registrarMovimento } from './estoqueMovimentosApi'

// Requisição × Transferência (migration_v15.sql), distinguidas pela origem (ver
// PLANO-TRANSFORMACAO.md): se a origem é um estoque/cofre que precisa de liberação (Central,
// Compras) → Requisição, alguém atende antes de sair. Se quem manda já tem o material em mãos
// (Produção mandando pra Serviço, ou devolvendo pro Central) → Transferência, só o destino
// confirma recebimento, sem gate de autorização.
//
// Autorização de verdade (quem aprova requisição) fica fora disso — combinado adiar pra quando
// chegar a fundação de perfil/acesso; por ora todo mundo com acesso à tela pode atender.

const SELECT_REQUISICAO = `
  id, codigo_everest, quantidade_solicitada, quantidade_atendida, status,
  usuario_solicitante, usuario_atendente, solicitado_em, atendido_em, observacao,
  solicitante:frentes!requisicoes_frente_solicitante_id_fkey ( id, nome ),
  atendente:frentes!requisicoes_frente_atendente_id_fkey ( id, nome )
`

export async function listarRequisicoesPendentes(frenteAtendenteId) {
  let q = supabase.from('requisicoes').select(SELECT_REQUISICAO).in('status', ['pendente', 'atendida_parcial'])
  if (frenteAtendenteId) q = q.eq('frente_atendente_id', frenteAtendenteId)
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

export async function criarRequisicao({ frenteSolicitanteId, frenteAtendenteId, codigoEverest, quantidadeSolicitada, usuario, observacao }) {
  if (frenteSolicitanteId === frenteAtendenteId) throw new Error('Origem e destino precisam ser diferentes.')
  if (!(Number(quantidadeSolicitada) > 0)) throw new Error('Informe uma quantidade maior que zero.')
  const { data, error } = await supabase
    .from('requisicoes')
    .insert({
      frente_solicitante_id: frenteSolicitanteId,
      frente_atendente_id: frenteAtendenteId,
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
export async function atenderRequisicao(requisicaoId, { quantidadeAtendidaAgora, usuario }) {
  const { data: req, error: erroReq } = await supabase.from('requisicoes').select('*').eq('id', requisicaoId).single()
  if (erroReq) throw erroReq
  const qtd = Number(quantidadeAtendidaAgora)
  if (!(qtd > 0)) throw new Error('Informe uma quantidade maior que zero.')
  const jaAtendido = Number(req.quantidade_atendida || 0)
  const totalAtendido = jaAtendido + qtd
  if (totalAtendido > Number(req.quantidade_solicitada) + 0.001) {
    throw new Error('Isso passa do que foi solicitado — confira a quantidade.')
  }
  const status = totalAtendido >= Number(req.quantidade_solicitada) - 0.001 ? 'atendida' : 'atendida_parcial'

  await registrarMovimento({
    frenteId: req.frente_atendente_id, codigoEverest: req.codigo_everest, quantidade: -qtd,
    tipo: 'requisicao_saida', requisicaoId, usuario
  })
  await registrarMovimento({
    frenteId: req.frente_solicitante_id, codigoEverest: req.codigo_everest, quantidade: qtd,
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
  origem:frentes!transferencias_frente_origem_id_fkey ( id, nome ),
  destino:frentes!transferencias_frente_destino_id_fkey ( id, nome )
`

export async function listarTransferenciasPendentes(frenteDestinoId) {
  let q = supabase.from('transferencias').select(SELECT_TRANSFERENCIA).eq('status', 'enviada')
  if (frenteDestinoId) q = q.eq('frente_destino_id', frenteDestinoId)
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
export async function criarTransferencia({ frenteOrigemId, frenteDestinoId, codigoEverest, quantidade, usuario }) {
  if (frenteOrigemId === frenteDestinoId) throw new Error('Origem e destino precisam ser diferentes.')
  if (!(Number(quantidade) > 0)) throw new Error('Informe uma quantidade maior que zero.')
  const { data: transferencia, error } = await supabase
    .from('transferencias')
    .insert({
      frente_origem_id: frenteOrigemId, frente_destino_id: frenteDestinoId,
      codigo_everest: codigoEverest, quantidade: Number(quantidade), usuario_envio: usuario || null
    })
    .select()
    .single()
  if (error) throw error

  await registrarMovimento({
    frenteId: frenteOrigemId, codigoEverest, quantidade: -Number(quantidade),
    tipo: 'transferencia_saida', transferenciaId: transferencia.id, usuario
  })
  return transferencia
}

export async function confirmarRecebimentoTransferencia(transferenciaId, usuario) {
  const { data: transferencia, error: erroT } = await supabase.from('transferencias').select('*').eq('id', transferenciaId).single()
  if (erroT) throw erroT
  if (transferencia.status !== 'enviada') throw new Error('Essa transferência já foi recebida ou cancelada.')

  await registrarMovimento({
    frenteId: transferencia.frente_destino_id, codigoEverest: transferencia.codigo_everest, quantidade: Number(transferencia.quantidade),
    tipo: 'transferencia_entrada', transferenciaId, usuario
  })

  const { error } = await supabase
    .from('transferencias')
    .update({ status: 'recebida', usuario_recebimento: usuario || null, recebido_em: new Date().toISOString() })
    .eq('id', transferenciaId)
  if (error) throw error
}
