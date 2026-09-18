import { supabase } from './supabase'

export const PRACAS = ['Proteína', 'Guarnição', 'Mercadinho', 'Produção']
export const TURNOS = ['Manhã', 'Tarde', 'Noite']

export function turnoAtual() {
  const hora = new Date().getHours()
  if (hora < 12) return 'Manhã'
  if (hora < 18) return 'Tarde'
  return 'Noite'
}

export async function listarProducoesCadastradas() {
  const { data, error } = await supabase.from('producoes_cadastradas').select('id, nome, praca_padrao').eq('ativo', true).order('nome')
  if (error) throw error
  return data
}

export async function criarProducaoCadastrada(nome, pracaPadrao) {
  const { error } = await supabase.from('producoes_cadastradas').insert({ nome, praca_padrao: pracaPadrao })
  if (error) throw error
}

export async function iniciarProducao({ unidadeId, praca, insumo, producao, funcionario, turno }) {
  const { data, error } = await supabase
    .from('producoes_andamento')
    .insert({ unidade_id: unidadeId, praca, insumo, producao, funcionario, turno })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listarAndamentos(unidadeId) {
  const { data, error } = await supabase
    .from('producoes_andamento')
    .select('*')
    .eq('unidade_id', unidadeId)
    .eq('status', 'em_andamento')
    .order('iniciado_em', { ascending: false })
  if (error) throw error
  return data
}

export async function pararProducao(andamentoId) {
  const { data, error } = await supabase
    .from('producoes_andamento')
    .update({ parado_em: new Date().toISOString() })
    .eq('id', andamentoId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function cancelarProducao(andamentoId) {
  const { error } = await supabase.from('producoes_andamento').update({ status: 'cancelado' }).eq('id', andamentoId)
  if (error) throw error
}

export async function finalizarProducao(andamento, produzidos, obs) {
  const tempoMin = andamento.parado_em
    ? Math.round((new Date(andamento.parado_em) - new Date(andamento.iniciado_em)) / 60000)
    : null

  const registros = produzidos.map((p, i) => ({
    andamento_id: andamento.id,
    unidade_id: andamento.unidade_id,
    praca: andamento.praca,
    insumo: andamento.insumo,
    producao: andamento.producao,
    produzido: p.nome,
    funcionario: andamento.funcionario,
    turno: andamento.turno,
    inicio: andamento.iniciado_em,
    fim: andamento.parado_em,
    tempo_min: i === 0 ? tempoMin : null,
    kg: p.kg,
    porcoes: p.porcoes,
    obs: i === 0 ? obs : null,
    origem: 'cronometrado'
  }))

  const { error: erroRegistros } = await supabase.from('producoes_registros').insert(registros)
  if (erroRegistros) throw erroRegistros

  const { error: erroStatus } = await supabase.from('producoes_andamento').update({ status: 'finalizado' }).eq('id', andamento.id)
  if (erroStatus) throw erroStatus
}

export async function registrarManual({ unidadeId, praca, insumo, producao, funcionario, turno, tempoMin, produzidos, obs }) {
  const registros = produzidos.map((p, i) => ({
    unidade_id: unidadeId,
    praca, insumo, producao, funcionario, turno,
    tempo_min: i === 0 ? tempoMin : null,
    kg: p.kg,
    porcoes: p.porcoes,
    obs: i === 0 ? obs : null,
    origem: 'manual'
  }))
  const { error } = await supabase.from('producoes_registros').insert(registros)
  if (error) throw error
}

export async function listarRegistrosRecentes(unidadeId, limite = 30) {
  const { data, error } = await supabase
    .from('producoes_registros')
    .select('*')
    .eq('unidade_id', unidadeId)
    .order('registrado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  return data
}
