import { supabase } from './supabase'

// Configurações do sistema (liga/desliga) — migration_v18.sql. Chave/valor simples: cada
// parâmetro novo é uma linha nova, não uma coluna nova — não precisa de migração pra adicionar o
// próximo interruptor.

export async function buscarConfiguracoes() {
  const { data, error } = await supabase.from('configuracoes_sistema').select('*').order('chave')
  if (error) throw error
  return data || []
}

// Lê um interruptor só — usado pelas telas que PRECISAM decidir um comportamento (não só mostrar
// a lista no painel). Se a linha não existir ainda (configuração nova, migração não rodada),
// devolve `false` em vez de quebrar a tela que depende dela.
export async function buscarConfiguracao(chave) {
  const { data, error } = await supabase.from('configuracoes_sistema').select('valor').eq('chave', chave).maybeSingle()
  if (error) throw error
  return data?.valor ?? false
}

export async function definirConfiguracao(chave, valor, usuario) {
  const { error } = await supabase
    .from('configuracoes_sistema')
    .update({ valor, atualizado_em: new Date().toISOString(), atualizado_por: usuario || null })
    .eq('chave', chave)
  if (error) throw error
}
