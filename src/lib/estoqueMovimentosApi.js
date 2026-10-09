import { supabase } from './supabase'
import { buscarProdutosPorCodigosEverest } from './api'
import { buscarFatoresCorrecao, buscarDescendentes } from './fatoresCorrecaoApi'

// Saldo calculado por local de estoque (migration_v15.sql, renomeado de "frente" na
// migration_v19.sql) — ledger só de inserção, separado do saldo por contagem que já existe
// (`itens_contagem`/Saldo.jsx, intocados). O saldo de cada local/produto é sempre a SOMA das
// linhas desta tabela (view `saldo_calculado_local`), nunca um número guardado à parte — assim
// não corre o risco de desviar da própria história.
//
// Reverte conscientemente parte do aviso da v14 ("produção não movimenta estoque") — decisão do
// Felipe: com locais de estoque separados, ele quer visibilidade de movimentação em tempo real
// pra achar desfalque (contagem sozinha só mostra que mudou, não se foi consumo normal ou sumiço).

export async function registrarMovimento({ localEstoqueId, codigoEverest, quantidade, tipo, producaoId, transferenciaId, requisicaoId, recebimentoId, turnoId, usuario }) {
  const { data, error } = await supabase
    .from('estoque_movimentos')
    .insert({
      local_estoque_id: localEstoqueId,
      codigo_everest: codigoEverest,
      quantidade: Number(quantidade),
      tipo,
      producao_id: producaoId || null,
      transferencia_id: transferenciaId || null,
      requisicao_id: requisicaoId || null,
      recebimento_id: recebimentoId || null,
      turno_id: turnoId || null,
      usuario: usuario || null
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function buscarSaldoCalculado(localEstoqueId, codigoEverest) {
  const { data, error } = await supabase
    .from('saldo_calculado_local')
    .select('saldo')
    .eq('local_estoque_id', localEstoqueId)
    .eq('codigo_everest', codigoEverest)
    .maybeSingle()
  if (error) throw error
  return data?.saldo || 0
}

export async function listarSaldosCalculados(localEstoqueId) {
  const { data, error } = await supabase
    .from('saldo_calculado_local')
    .select('codigo_everest, saldo')
    .eq('local_estoque_id', localEstoqueId)
    .order('codigo_everest')
  if (error) throw error
  return data || []
}

// Apagar de verdade (não cancelar/marcar) — exceção à regra de "não sumir com nada" do resto do
// app, porque esta tabela é um ledger só de soma: uma linha de teste errada (ex.: 10 milhões de kg
// digitado num teste) PRECISA sumir da soma, não só ser marcada. Pedido do Felipe (06/10/2026):
// "estou fazendo vários testes, e depois preciso apagar" — só pra DEV (ver `usuario.ehDesenvolvedor`
// na tela, `src/admin/pages/LocaisEstoque.jsx`), não existe em nenhuma tela operacional.
export async function removerMovimento(movimentoId) {
  const { error } = await supabase.from('estoque_movimentos').delete().eq('id', movimentoId)
  if (error) throw error
}

// Atividade recente de TODOS os locais (painel de acompanhamento, 07/10/2026) — diferente do
// histórico por item abaixo, que exige escolher um produto primeiro.
export async function listarMovimentosRecentes(limite = 30) {
  const { data, error } = await supabase
    .from('estoque_movimentos')
    .select('*')
    .order('registrado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  return data || []
}

// Saldo virtual de um item JUNTO com todos os derivados dele (árvore de porcionamento, ver
// `buscarDescendentes` em fatoresCorrecaoApi.js) — calculado por Setor (`porLocal`) dentro dos
// `locaisAlvo` informados (quem chama decide o recorte mais amplo: todos os setores, ou só os de
// uma Loja) — quem usa decide depois se soma tudo ou mostra só 1 Setor, sem precisar buscar de
// novo (pedido do Felipe, 09/10/2026: filtro de Setor só deve oferecer Setor com dado, e separar
// o que tem saldo do que está zerado — os dois precisam do detalhe por Setor, não só o total).
// Usado tanto no Admin (que soma preço depois) quanto no Painel de Controle operacional (só
// quantidade) — pra não duplicar essa conta em dois lugares e um dia desalinhar.
export async function buscarEstoqueVirtualComDerivados({ codigoEverestRaiz, locaisAlvo }) {
  const [mapa, saldosPorLocal] = await Promise.all([
    buscarFatoresCorrecao(),
    Promise.all(locaisAlvo.map((l) => listarSaldosCalculados(l.id)))
  ])

  const descendentes = buscarDescendentes(mapa, codigoEverestRaiz)
  const todosCodigos = [codigoEverestRaiz, ...descendentes]
  const todosCodigosSet = new Set(todosCodigos)

  const porLocalPorCodigo = {} // { codigo: { localId: saldo } }
  todosCodigos.forEach((c) => { porLocalPorCodigo[c] = {} })
  const locaisComSaldo = []
  locaisAlvo.forEach((l, i) => {
    let somaLocal = 0
    ;(saldosPorLocal[i] || []).forEach((linha) => {
      if (!todosCodigosSet.has(linha.codigo_everest)) return
      const saldo = Number(linha.saldo)
      porLocalPorCodigo[linha.codigo_everest][l.id] = saldo
      somaLocal += saldo
    })
    if (Math.abs(somaLocal) > 0.0001) locaisComSaldo.push(l.id)
  })

  const produtos = await buscarProdutosPorCodigosEverest(todosCodigos)
  const nomePorCodigo = Object.fromEntries(produtos.map((p) => [p.codigo_everest, p.nome]))

  const itens = todosCodigos.map((codigo, i) => ({
    codigo_everest: codigo,
    nome: nomePorCodigo[codigo] || codigo,
    raiz: i === 0,
    porLocal: porLocalPorCodigo[codigo]
  }))

  return { itens, locaisComSaldo }
}

// Soma `item.porLocal` restrito a um Setor (ou a todos, se `setorId` vier vazio) — usado pelas
// telas depois de `buscarEstoqueVirtualComDerivados` pra exibir o número já filtrado.
export function saldoFiltrado(item, setorId) {
  if (setorId) return item.porLocal[setorId] || 0
  return Object.values(item.porLocal).reduce((a, v) => a + v, 0)
}

// Histórico de movimentação de UM item — pedido do Felipe (06/10/2026): "ter um histórico da
// movimentação do item, sem ficar a lista corrida". Busca SEM filtro de data inicial de propósito
// (só até `dataFim`) — o saldo acumulado precisa somar desde o início pra não mentir; quem filtra
// a partir de uma data só corta o que é MOSTRADO depois, em `LocaisEstoque.jsx`.
export async function buscarHistoricoMovimentos({ codigoEverest, localEstoqueId, dataFim }) {
  let q = supabase
    .from('estoque_movimentos')
    .select('*')
    .eq('codigo_everest', codigoEverest)
    .order('registrado_em', { ascending: true })
  if (localEstoqueId) q = q.eq('local_estoque_id', localEstoqueId)
  if (dataFim) q = q.lte('registrado_em', dataFim + 'T23:59:59')
  const { data, error } = await q
  if (error) throw error
  return data || []
}
