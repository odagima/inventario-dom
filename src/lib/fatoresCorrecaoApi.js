import { supabase } from './supabase'

// F.C. real por item, vindo da Ficha Técnica (ver migration_v16.sql e o método documentado em
// PLANO-TRANSFORMACAO.md — coluna "Q. Baixa Estoque" da versão ATIVO). Cada linha aponta pro PAI
// IMEDIATO (não pro insumo-base lá na raiz): `shareEsperadoAcumulado` anda a cadeia multiplicando
// até não achar mais pai.
//
// `fator` em `fatores_correcao` é "quanto de cru por 1 kg de porcionado" (kg cru ÷ kg porcionado)
// — o INVERSO do rendimento. share acumulado (rendimento) = 1 ÷ (fator do item × fator do pai × ...).

export async function buscarFatoresCorrecao() {
  const { data, error } = await supabase
    .from('fatores_correcao')
    .select(`
      fator,
      porcionado:produtos!fatores_correcao_porcionado_id_fkey ( codigo_everest ),
      cru:produtos!fatores_correcao_cru_id_fkey ( codigo_everest )
    `)
  if (error) throw error
  const mapa = {}
  ;(data || []).forEach((linha) => {
    const filho = linha.porcionado?.codigo_everest
    const pai = linha.cru?.codigo_everest
    if (filho && pai) mapa[filho] = { pai, fator: Number(linha.fator) }
  })
  return mapa
}

// Rendimento acumulado esperado de um item em relação à base (multiplica a cadeia de rendimentos
// — cada degrau é 1 ÷ fator — até não achar mais pai).
export function shareEsperadoAcumulado(mapa, codigoEverest) {
  let atual = codigoEverest, share = 1
  while (mapa[atual]) {
    share *= 1 / mapa[atual].fator
    atual = mapa[atual].pai
  }
  return share
}

// F.C. teórico do item = líquido real ÷ bruto implícito (bruto real da ordem × share esperado
// acumulado daquele item) — repartir o bruto real pela cadeia esperada da ficha técnica sem
// precisar pesar bruto item a item. Comparar sempre contra ~100% (nunca contra o fator do passo
// isolado): 100% = bateu o esperado de ponta a ponta; abaixo = esse item puxou mais perda do que
// devia; acima = rendeu melhor que o previsto.
export function calcularFCTeorico(mapa, codigoEverest, liquidoReal, brutoTotalReal) {
  const share = shareEsperadoAcumulado(mapa, codigoEverest)
  const brutoImplicito = brutoTotalReal * share
  if (!(brutoImplicito > 0)) return null
  return liquidoReal / brutoImplicito
}
