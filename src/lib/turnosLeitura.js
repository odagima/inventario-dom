import { supabase } from './supabase'

// Parte de leitura/cálculo de turnos.js, separada num arquivo próprio SEM NENHUMA dependência de
// requisicaoTransferenciaApi.js (ao contrário de turnosApi.js, que importa `criarTransferenciaImediata`
// de lá pra `abrirTurno`/`fecharTurno`) — só assim `exigirPracaAbertaHoje` pode ser chamada de
// DENTRO de requisicaoTransferenciaApi.js (criarRequisicao/criarTransferencia) sem criar import
// circular (requisicaoTransferenciaApi → turnosApi → requisicaoTransferenciaApi). `turnosApi.js`
// reexporta tudo daqui pra quem já importava de lá continuar funcionando sem mudar nada.

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

// Pedido do Felipe (09/10/2026, revertendo a decisão de 08/10 documentada em turnosApi.js): turno
// volta a TRAVAR Produção/Requisição/Transferência/Recebimento — "ele consegue movimentar pra
// operações fechadas, mas pra ele movimentar precisa abrir/fechar a operação do dia." Sem
// exceção de Setor (nem Estoque Central). Mensagem distingue duas causas: nunca abriu hoje, ou
// esqueceu aberto de ontem (vencido, passou das 3h).
export async function exigirPracaAbertaHoje(localEstoqueId, nomeLocal) {
  if (!localEstoqueId) return
  const turno = await buscarTurnoAberto(localEstoqueId)
  const label = nomeLocal ? `da praça "${nomeLocal}"` : 'da sua praça'
  if (!turno) throw new Error(`Abra a operação ${label} antes de continuar.`)
  if (turnoVencido(turno)) throw new Error(`Feche o dia anterior ${label} antes de continuar — passou das 3h e venceu.`)
}
