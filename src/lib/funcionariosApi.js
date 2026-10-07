import { supabase } from './supabase'

// Cadastro simples de funcionários (migration_v22.sql) — nome, cargo, salário, loja, telefone,
// admissão. Sem fluxo nenhum por trás, só consultar/incluir/editar/excluir.

export async function listarFuncionarios() {
  const { data, error } = await supabase
    .from('funcionarios')
    .select('*, unidade:unidade_id(nome)')
    .order('nome')
  if (error) throw error
  return data
}

export async function criarFuncionario({ nome, cargo, salario, unidadeId, telefone, dataAdmissao }) {
  const { data, error } = await supabase
    .from('funcionarios')
    .insert({
      nome,
      cargo: cargo || null,
      salario: salario || null,
      unidade_id: unidadeId || null,
      telefone: telefone || null,
      data_admissao: dataAdmissao || null
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function atualizarFuncionario(id, campos) {
  const { error } = await supabase.from('funcionarios').update(campos).eq('id', id)
  if (error) throw error
}

export async function removerFuncionario(id) {
  const { error } = await supabase.from('funcionarios').delete().eq('id', id)
  if (error) throw error
}
