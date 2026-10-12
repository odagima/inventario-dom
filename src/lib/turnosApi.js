import { supabase } from './supabase'
import { criarTransferenciaImediata } from './requisicaoTransferenciaApi'
import { buscarTurnoAberto, turnoVencido } from './turnosLeitura'
import { listarSaldosCalculados, registrarMovimento } from './estoqueMovimentosApi'

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

// Último fechamento de um Setor — usado só pra SUGERIR a abertura do dia seguinte (mostra o que
// foi contado/devolvido, a pessoa confirma, edita ou adiciona; nunca reabre sozinho sem
// confirmação explícita). `itens_fechamento` é o snapshot gravado por `fecharTurnoComContagem`.
export async function buscarUltimoFechamento(localEstoqueId) {
  const { data, error } = await supabase
    .from('turnos')
    .select('itens_fechamento, fechado_em')
    .eq('local_estoque_id', localEstoqueId)
    .eq('status', 'fechado')
    .order('fechado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// Fechamento COM contagem — só pra Setor tipo 'cozinha' (migration_v30.sql, pedido do Felipe,
// 12/10/2026): recebe porcionado todo dia e precisa devolver a sobra pra câmara à noite, mas sem
// CONTAR de verdade o saldo calculado da praça só cresce, nunca reflete o consumo real do serviço.
//
// `itensContados` = tudo que a pessoa viu fisicamente na praça agora — [{codigoEverest, quantidade}].
// Faz 2 coisas: (1) pra TODO item que hoje tem saldo calculado ali, lança um `ajuste_contagem` com
// a diferença pro contado (quem não aparecer na lista é tratado como contado = 0, de propósito —
// contagem é "o que eu vi agora", não "o que eu lembrei de listar"); (2) devolve pro destino
// (Estoque) exatamente o que foi contado — "tudo volta pra câmara fria", igual ao modelo original
// do turno (ver comentário no topo deste arquivo). Resultado: a praça fecha sempre zerada no
// calculado, igual à realidade física.
export async function fecharTurnoComContagem({ turnoId, localDestinoId, itensContados, usuario }) {
  const { data: turno, error: erroT } = await supabase.from('turnos').select('*').eq('id', turnoId).single()
  if (erroT) throw erroT
  if (turno.status !== 'aberto') throw new Error('Essa praça já está fechada.')

  const saldosAtuais = await listarSaldosCalculados(turno.local_estoque_id)
  const contadoPorCodigo = new Map(itensContados.map((i) => [i.codigoEverest, Number(i.quantidade)]))

  for (const linha of saldosAtuais) {
    const calculado = Number(linha.saldo)
    const contado = contadoPorCodigo.get(linha.codigo_everest) ?? 0
    const diferenca = contado - calculado
    if (Math.abs(diferenca) > 0.001) {
      await registrarMovimento({
        localEstoqueId: turno.local_estoque_id, codigoEverest: linha.codigo_everest,
        quantidade: diferenca, tipo: 'ajuste_contagem', turnoId, usuario
      })
    }
  }
  // Item contado que a praça nunca tinha saldo calculado (ex.: chegou lá sem passar por
  // transferência) também vira ajuste, senão a devolução abaixo ia tentar tirar de onde não tem.
  for (const [codigoEverest, quantidade] of contadoPorCodigo) {
    const jaTinhaSaldo = saldosAtuais.some((l) => l.codigo_everest === codigoEverest)
    if (!jaTinhaSaldo && Math.abs(quantidade) > 0.001) {
      await registrarMovimento({ localEstoqueId: turno.local_estoque_id, codigoEverest, quantidade, tipo: 'ajuste_contagem', turnoId, usuario })
    }
  }

  for (const [codigoEverest, quantidade] of contadoPorCodigo) {
    if (quantidade > 0.001) {
      await criarTransferenciaImediata({
        localOrigemId: turno.local_estoque_id, localDestinoId,
        codigoEverest, quantidade, usuario, turnoId
      })
    }
  }

  const { error } = await supabase
    .from('turnos')
    .update({
      status: 'fechado', fechado_em: new Date().toISOString(), fechado_por: usuario || null,
      itens_fechamento: itensContados
    })
    .eq('id', turnoId)
  if (error) throw error
}

// Exclusão COMPLETA — só DEV, ver LimpezaTeste.jsx (mesmo motivo de `removerProducaoCompleta`/
// `removerTransferenciaCompleta`: "estou fazendo vários testes, e depois preciso apagar", pedido do
// Felipe 06/10/2026). Os movimentos de abrir/fechar já viram `estoque_movimentos` com
// `transferencia_id` preenchido (via `criarTransferenciaImediata`) — excluir a transferência pela
// tela de Transferências já limpa esses. Aqui só apaga o turno em si, mais qualquer movimento
// solto que por algum motivo tenha `turno_id` sem `transferencia_id` (defensivo).
export async function removerTurnoCompleto(turnoId) {
  await supabase.from('estoque_movimentos').delete().eq('turno_id', turnoId).is('transferencia_id', null)
  const { error } = await supabase.from('turnos').delete().eq('id', turnoId)
  if (error) throw error
}
