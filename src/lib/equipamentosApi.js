import { supabase } from './supabase'

// Cadastro simples de equipamentos (migration_v22.sql) — nome, local onde está, patrimônio,
// estado, valor, aquisição. Sem fluxo nenhum por trás, só consultar/incluir/editar/excluir.

export async function listarEquipamentos() {
  const { data, error } = await supabase
    .from('equipamentos')
    .select('*, local:local_estoque_id(nome)')
    .order('nome')
  if (error) throw error
  return data
}

export async function criarEquipamento({ nome, localEstoqueId, numeroPatrimonio, estado, valor, dataAquisicao }) {
  const { data, error } = await supabase
    .from('equipamentos')
    .insert({
      nome,
      local_estoque_id: localEstoqueId || null,
      numero_patrimonio: numeroPatrimonio || null,
      estado: estado || 'funcionando',
      valor: valor || null,
      data_aquisicao: dataAquisicao || null
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function atualizarEquipamento(id, campos) {
  const { error } = await supabase.from('equipamentos').update(campos).eq('id', id)
  if (error) throw error
}

export async function removerEquipamento(id) {
  const { error } = await supabase.from('equipamentos').delete().eq('id', id)
  if (error) throw error
}
