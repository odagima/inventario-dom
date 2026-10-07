import { supabase } from './supabase'
import { criarTransferenciaImediata } from './requisicaoTransferenciaApi'

// Turno de operação por local de estoque (migration_v23.sql) — pedido do Felipe: "tipo caixa...
// abre, opera, precisa fechar pra operar o próximo turno". Abrir = transferência de saída
// (origem → local, ex.: Estoque Central → Confeitaria). Fechar = transferência de volta (local →
// destino, "tudo volta pra câmara fria"). As duas são imediatas (mesma pessoa manda e recebe, ver
// `criarTransferenciaImediata`).
//
// Período (almoço/jantar) não é escolhido por ninguém — é só etiqueta calculada pelo horário de
// abertura, pra relatório (`periodoDoTurno`).
//
// Trava das 3h (pedido do Felipe, 07/10/2026): "se esquecer aberto, depois das 3h da manhã não
// consegue mais lançar no dia anterior, só fechando e abrindo um novo turno." `turnoVencido`
// calcula isso no cliente (não trava no banco) — fácil de ajustar o horário de corte sem migração.
// Um turno vencido só pode ser FECHADO, nunca usado pra lançar.

export async function buscarTurnoAberto(localEstoqueId) {
  const { data, error } = await supabase
    .from('turnos')
    .select('*')
    .eq('local_estoque_id', localEstoqueId)
    .eq('status', 'aberto')
    .order('aberto_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function listarTurnosAbertos() {
  const { data, error } = await supabase
    .from('turnos')
    .select('*, local:local_estoque_id(id, nome)')
    .eq('status', 'aberto')
    .order('aberto_em', { ascending: true })
  if (error) throw error
  return data || []
}

export async function listarTurnosHistorico(localEstoqueId, limite = 100) {
  let q = supabase.from('turnos').select('*').order('aberto_em', { ascending: false }).limit(limite)
  if (localEstoqueId) q = q.eq('local_estoque_id', localEstoqueId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Próxima virada das 3h depois de um horário — 3h da manhã funciona como "virada do dia" pro
// turno, não meia-noite. Se abriu antes das 3h, a virada é hoje às 3h; se abriu depois, é amanhã.
function proximaVirada(dataHora) {
  const d = new Date(dataHora)
  const virada = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 3, 0, 0, 0)
  if (d >= virada) virada.setDate(virada.getDate() + 1)
  return virada
}

export function turnoVencido(turno) {
  if (!turno || turno.status !== 'aberto') return false
  return new Date() >= proximaVirada(turno.aberto_em)
}

export function periodoDoTurno(abertoEm) {
  const hora = new Date(abertoEm).getHours()
  return (hora >= 10 && hora < 16) ? 'almoco' : 'jantar'
}

export const LABEL_PERIODO = { almoco: 'Almoço', jantar: 'Jantar' }

// `itens` = [{ codigoEverest, quantidade }] — tudo que está sendo levado pra praça de uma vez.
export async function abrirTurno({ localEstoqueId, localOrigemId, itens, usuario }) {
  const existente = await buscarTurnoAberto(localEstoqueId)
  if (existente) {
    throw new Error(
      turnoVencido(existente)
        ? 'A praça anterior passou das 3h e venceu — feche ela antes de abrir uma nova.'
        : 'Essa praça já está aberta.'
    )
  }

  const { data: turno, error } = await supabase
    .from('turnos')
    .insert({ local_estoque_id: localEstoqueId, aberto_por: usuario || null })
    .select()
    .single()
  if (error) throw error

  for (const item of itens) {
    await criarTransferenciaImediata({
      localOrigemId, localDestinoId: localEstoqueId,
      codigoEverest: item.codigoEverest, quantidade: item.quantidade,
      usuario, turnoId: turno.id
    })
  }
  return turno
}

// `itens` = o que está voltando da praça pro estoque. Fecha mesmo se vazio (praça que não trouxe
// nada de volta, ou já devolveu tudo via Transferência avulsa durante o turno).
export async function fecharTurno({ turnoId, localDestinoId, itens, usuario }) {
  const { data: turno, error: erroT } = await supabase.from('turnos').select('*').eq('id', turnoId).single()
  if (erroT) throw erroT
  if (turno.status !== 'aberto') throw new Error('Essa praça já está fechada.')

  for (const item of itens) {
    await criarTransferenciaImediata({
      localOrigemId: turno.local_estoque_id, localDestinoId,
      codigoEverest: item.codigoEverest, quantidade: item.quantidade,
      usuario, turnoId
    })
  }

  const { error } = await supabase
    .from('turnos')
    .update({ status: 'fechado', fechado_em: new Date().toISOString(), fechado_por: usuario || null })
    .eq('id', turnoId)
  if (error) throw error
}

// Usado pelas telas de lançamento (Produção, Requisição) pra travar sem turno aberto — pedido do
// Felipe: "se não abrir, não consegue lançar". Devolve o turno utilizável, ou null (sem turno /
// turno vencido — os dois casos bloqueiam igual, a mensagem é que muda).
export async function turnoUtilizavel(localEstoqueId) {
  const turno = await buscarTurnoAberto(localEstoqueId)
  if (!turno || turnoVencido(turno)) return null
  return turno
}
