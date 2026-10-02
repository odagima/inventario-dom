import { supabase } from './supabase'

// Frentes (migration_v15.sql): áreas operacionais onde se produz/estoca — diferente de
// `unidades` (CNPJ/loja legal). Uma frente pode pertencer a uma unidade ou não.

export async function listarFrentes() {
  const { data, error } = await supabase
    .from('frentes')
    .select('*')
    .eq('ativo', true)
    .order('nome')
  if (error) throw error
  return data
}
