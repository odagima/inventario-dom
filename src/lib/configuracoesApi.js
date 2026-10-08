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

// Upsert (08/10/2026): se a migração que semeia a linha ainda não rodou, um `update` simples não
// dá erro NENHUM — só não afeta nenhuma linha, e a tela acima acha que salvou (mentira silenciosa).
// Com upsert, a primeira gravação cria a linha sozinha se precisar.
export async function definirConfiguracao(chave, valor, usuario) {
  const { error } = await supabase
    .from('configuracoes_sistema')
    .upsert({ chave, valor, atualizado_em: new Date().toISOString(), atualizado_por: usuario || null }, { onConflict: 'chave' })
  if (error) throw error
}
