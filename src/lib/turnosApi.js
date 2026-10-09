import { supabase } from './supabase'
import { criarTransferenciaImediata } from './requisicaoTransferenciaApi'
import { buscarTurnoAberto, turnoVencido } from './turnosLeitura'

export { buscarTurnoAberto, listarTurnosAbertos, listarTurnosHistorico, turnoVencido, periodoDoTurno, LABEL_PERIODO, exigirPracaAbertaHoje } from './turnosLeitura'

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
// Um turno vencido só pode ser FECHADO, nunca ABERTO de novo (essa trava é só sobre o turno em
// si — abrir/fechar a praça — e continua valendo).
//
// 08/10/2026 (pedido do Felipe, revendo a trava anterior): turno NÃO trava mais Produção/
// Requisição/Transferência — "aqui é um controle, não é um impeditivo da pessoa pegar. Se não ela
// vai pegar e não vai anotar." Virou só rastreio/status (alimenta o Painel de Controle), não
// bloqueia lançamento de ninguém. `turnoUtilizavel` (que fazia essa trava) foi removida.
//
// 09/10/2026 (pedido do Felipe, revendo DE NOVO): volta a travar — ver `exigirPracaAbertaHoje` em
// turnosLeitura.js, chamada de dentro de producaoApi.js/requisicaoTransferenciaApi.js/
// recebimentosApi.js. Esse arquivo (turnosApi.js) ficou só com abrir/fechar a praça em si — o
// resto (leitura + a trava nova) mora em turnosLeitura.js pra evitar import circular (este arquivo
// já importa `criarTransferenciaImediata` de requisicaoTransferenciaApi.js; a trava precisa ser
// chamada DE DENTRO desse mesmo arquivo, então não pode morar aqui).

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
