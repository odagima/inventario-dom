import { supabase } from './supabase'

// Locais de estoque (migration_v15.sql, renomeado de "frente" na migration_v19.sql — pedido do
// Felipe: "frente" não comunicava bem, e "praça" já é usado pra outra coisa na operação, o posto
// de trabalho da cozinha): áreas operacionais onde se produz/estoca — diferente de `unidades`
// (CNPJ/loja legal). Um local de estoque pode pertencer a uma unidade ou não.

export async function listarLocaisEstoque() {
  const { data, error } = await supabase
    .from('locais_estoque')
    .select('*')
    .eq('ativo', true)
    .order('nome')
  if (error) throw error
  return data
}
