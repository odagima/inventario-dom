import { supabase } from './supabase'

// Configurações do sistema (liga/desliga) — migration_v18.sql. Chave/valor simples: cada
// parâmetro novo é uma linha nova, não uma coluna nova — não precisa de migração pra adicionar o
// próximo interruptor.

export async function buscarConfiguracoes() {
  const { data, error } = await supabase.from('configuracoes_sistema').select('*').order('chave')
  if (error) throw error
  return data || []
}

export async function definirConfiguracao(chave, valor, usuario) {
  const { error } = await supabase
    .from('configuracoes_sistema')
    .update({ valor, atualizado_em: new Date().toISOString(), atualizado_por: usuario || null })
    .eq('chave', chave)
  if (error) throw error
}
