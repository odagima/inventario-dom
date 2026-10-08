import { buscarConfiguracao, definirConfiguracao } from './configuracoesApi'

// Rótulos do sistema (08/10/2026, pedido do Felipe: "eu quero ter o poder de mexer nisso... quero
// que todos falem a mesma língua, estejamos na mesma página") — as PALAVRAS que o app usa pra cada
// conceito, editáveis em Admin > Nomenclatura sem precisar mexer em código. `ROTULOS_PADRAO` é o
// que o app usa se a migração v26 ainda não rodou (nunca quebra por falta de configuração).
export const ROTULOS_PADRAO = { loja: 'Loja', setor: 'Setor', usuario: 'Usuário', item: 'Item', turno: 'Turno' }

export async function buscarRotulos() {
  const valor = await buscarConfiguracao('rotulos_sistema')
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return ROTULOS_PADRAO
  return { ...ROTULOS_PADRAO, ...valor }
}

export async function salvarRotulos(rotulos, usuario) {
  const limpo = Object.fromEntries(
    Object.keys(ROTULOS_PADRAO).map((chave) => [chave, String(rotulos[chave] ?? '').trim() || ROTULOS_PADRAO[chave]])
  )
  await definirConfiguracao('rotulos_sistema', limpo, usuario)
  return limpo
}
