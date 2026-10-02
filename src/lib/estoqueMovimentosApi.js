import { supabase } from './supabase'

// Saldo calculado por frente (migration_v15.sql) — ledger só de inserção, separado do saldo por
// contagem que já existe (`itens_contagem`/Saldo.jsx, intocados). O saldo de cada frente/produto
// é sempre a SOMA das linhas desta tabela (view `saldo_calculado_frente`), nunca um número
// guardado à parte — assim não corre o risco de desviar da própria história.
//
// Reverte conscientemente parte do aviso da v14 ("produção não movimenta estoque") — decisão do
// Felipe: com frentes separadas, ele quer visibilidade de movimentação em tempo real pra achar
// desfalque (contagem sozinha só mostra que mudou, não se foi consumo normal ou sumiço).

export async function registrarMovimento({ frenteId, codigoEverest, quantidade, tipo, producaoId, transferenciaId, requisicaoId, usuario }) {
  const { data, error } = await supabase
    .from('estoque_movimentos')
    .insert({
      frente_id: frenteId,
      codigo_everest: codigoEverest,
      quantidade: Number(quantidade),
      tipo,
      producao_id: producaoId || null,
      transferencia_id: transferenciaId || null,
      requisicao_id: requisicaoId || null,
      usuario: usuario || null
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function buscarSaldoCalculado(frenteId, codigoEverest) {
  const { data, error } = await supabase
    .from('saldo_calculado_frente')
    .select('saldo')
    .eq('frente_id', frenteId)
    .eq('codigo_everest', codigoEverest)
    .maybeSingle()
  if (error) throw error
  return data?.saldo || 0
}

export async function listarSaldosCalculados(frenteId) {
  const { data, error } = await supabase
    .from('saldo_calculado_frente')
    .select('codigo_everest, saldo')
    .eq('frente_id', frenteId)
    .order('codigo_everest')
  if (error) throw error
  return data || []
}
