import { supabase } from './supabase'
import { registrarMovimento } from './estoqueMovimentosApi'
import { exigirPracaAbertaHoje } from './turnosLeitura'

// Recebimento de mercadoria (migration_v21.sql) — pedido do Felipe (06/10/2026): lançamento rápido
// de "chegou material", antes da nota fiscal ser processada no Admin (que pode levar dias). Credita
// o saldo calculado na hora (mesmo ledger de Produção/Requisição/Transferência).
//
// Reconciliação com a NF de verdade (casar pelo número da nota quando ela for importada no Admin)
// fica pra depois — por ora, o único jeito de evitar contar 2x é a checagem de "parecido" abaixo
// (mesmo fornecedor + mesma quantidade + mesmo item), feita na hora do lançamento.

export async function buscarRecebimentoParecido({ fornecedor, quantidade, codigoEverest }) {
  const { data, error } = await supabase
    .from('recebimentos')
    .select('*')
    .ilike('fornecedor', fornecedor.trim())
    .eq('quantidade', Number(quantidade))
    .eq('codigo_everest', codigoEverest)
    .order('registrado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// Usado pela Limpeza de teste (Admin), 11/10/2026 — faltava listar recebimento pra apagar, as
// outras 3 (produção/requisição/transferência) já tinham.
export async function listarRecebimentosHistorico(limite = 200) {
  const { data, error } = await supabase
    .from('recebimentos')
    .select('*')
    .order('registrado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  return data || []
}

// `unidadeId` (migration_v29.sql, 11/10/2026) é a Loja/CNPJ de verdade (DOM ou Dalva) — separado
// do Setor: "os itens vão entrar por DOM ou Dalva e tudo entra direto pelo estoque" (pedido do
// Felipe). Guarda pra quando a reconciliação com a NF de verdade (`notas_importadas`) acontecer.
export async function criarRecebimento({ localEstoqueId, unidadeId, codigoEverest, quantidade, fornecedor, numeroNota, usuario }) {
  // Pedido do Felipe (09/10/2026): precisa estar com a operação do Setor aberta hoje pra registrar
  // recebimento (antes não tinha nenhuma trava de praça aqui).
  await exigirPracaAbertaHoje(localEstoqueId)
  const base = {
    local_estoque_id: localEstoqueId,
    codigo_everest: codigoEverest,
    quantidade: Number(quantidade),
    fornecedor: fornecedor.trim(),
    numero_nota: numeroNota?.trim() || null,
    usuario: usuario || null
  }
  let { data, error } = await supabase.from('recebimentos').insert({ ...base, unidade_id: unidadeId || null }).select().single()
  // migration_v29.sql ainda não rodou: grava sem a Loja em vez de travar o lançamento.
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    ;({ data, error } = await supabase.from('recebimentos').insert(base).select().single())
  }
  if (error) throw error

  await registrarMovimento({
    localEstoqueId, codigoEverest, quantidade: Number(quantidade),
    tipo: 'recebimento', recebimentoId: data.id, usuario
  })
  return data
}

// Apaga o recebimento antigo E o movimento de saldo ligado a ele — usado quando a tela detecta um
// parecido e a pessoa confirma que é lançamento duplicado.
export async function excluirRecebimento(id) {
  await supabase.from('estoque_movimentos').delete().eq('recebimento_id', id)
  const { error } = await supabase.from('recebimentos').delete().eq('id', id)
  if (error) throw error
}
