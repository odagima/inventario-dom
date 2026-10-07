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

// Cadastro (07/10/2026, pedido do Felipe) — até aqui só existia leitura; criar um local novo
// exigia SQL direto. Mesmo molde de `unidades`: lista todos (inclusive inativo), cria, edita.
export async function listarLocaisEstoqueTodos() {
  const { data, error } = await supabase.from('locais_estoque').select('*').order('nome')
  if (error) throw error
  return data
}

export async function criarLocalEstoque({ nome, unidadeId }) {
  const { data, error } = await supabase
    .from('locais_estoque')
    .insert({ nome, unidade_id: unidadeId || null })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function atualizarLocalEstoque(id, campos) {
  const { error } = await supabase.from('locais_estoque').update(campos).eq('id', id)
  if (error) throw error
}
