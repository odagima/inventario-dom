import { supabase } from './supabase'

// F.C. real por item, vindo da Ficha Técnica (ver migration_v16.sql/v17.sql e o método
// documentado em PLANO-TRANSFORMACAO.md — coluna "Q. Baixa Estoque" da versão ATIVO). Cada linha
// aponta pro PAI IMEDIATO (não pro insumo-base lá na raiz): `shareEsperadoAcumulado` anda a cadeia
// multiplicando até não achar mais pai.
//
// `fator` em `fatores_correcao` é "quanto de cru por 1 kg de porcionado" (kg cru ÷ kg porcionado)
// — o INVERSO do rendimento. share acumulado (rendimento) = 1 ÷ (fator do item × fator do pai × ...).
//
// Desde a v17, `fator` pode ser NULL: a linha existe só pra marcar a ORDEM do processo (o que vira
// o quê), sem ninguém ter medido o rendimento ainda. Serve pra `filhosDiretos` (navegação da
// Produção) funcionar mesmo sem fator — só os cálculos de F.C. (`calcularFCTeorico`,
// `brutoEquivalente`) é que exigem fator em toda a cadeia.

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
    if (filho && pai) mapa[filho] = { pai, fator: linha.fator != null ? Number(linha.fator) : null }
  })
  return mapa
}

// Rendimento acumulado esperado de um item em relação à base (multiplica a cadeia de rendimentos
// — cada degrau é 1 ÷ fator — até não achar mais pai). Se algum degrau da cadeia ainda não tem
// fator medido, não dá pra estimar — devolve null em vez de inventar um número.
export function shareEsperadoAcumulado(mapa, codigoEverest) {
  let atual = codigoEverest, share = 1
  while (mapa[atual]) {
    if (mapa[atual].fator == null) return null
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
  if (share == null) return null
  const brutoImplicito = brutoTotalReal * share
  if (!(brutoImplicito > 0)) return null
  return liquidoReal / brutoImplicito
}

// Quanto de insumo cru uma quantidade de item porcionado implicaria, seguindo a mesma cadeia —
// é o inverso de `shareEsperadoAcumulado` (que é a razão porcionado/cru esperada). Serve pra
// avisar na hora de digitar: se o peso digitado implicaria um bruto maior do que a entrada real
// da produção, é sinal forte de dedo errado (zero a mais, vírgula no lugar errado) — pega esse
// tipo de erro sem precisar entender "F.C." (§ pedido do Felipe, 02/10/2026).
export function brutoEquivalente(mapa, codigoEverest, quantidade) {
  const share = shareEsperadoAcumulado(mapa, codigoEverest)
  if (share == null || !(share > 0) || share === 1) return null // share 1 = item não mapeado, sem base de comparação
  return quantidade / share
}

// Pedido do Felipe (02/10/2026), depois de ver o filtro antigo (descendentes + nome) misturar
// etapas ("insumo base virando Strogonoff direto") e cruzar espécie (Mignon suíno aparecendo junto
// do bovino): a Produção precisa seguir o PROCESSO REAL, um passo de cada vez — "insumo base vira
// cabeça-e-rabo e limpeza, DESSES vira os outros". `filhosDiretos` devolve só quem tem
// `codigoPai` como pai IMEDIATO (não a cadeia inteira) — cada etapa da tela só oferece o próximo
// passo, nunca pula direto pro produto final.
export function filhosDiretos(mapa, codigoPai) {
  return Object.keys(mapa).filter((filho) => mapa[filho].pai === codigoPai)
}

// Pedido do Felipe (09/10/2026): ver o estoque virtual de um item JUNTO com todos os derivados
// dele (não só o próximo passo) — ex. escolher "Filet Mignon Peça" e já ver Escalope, Medalhão,
// Fumeiro etc., não importa quantos níveis de porcionamento existam até lá. `filhosDiretos` só
// anda um degrau; aqui desce a árvore inteira, nível a nível, com guarda de ciclo (não devia
// existir ciclo num `fatores_correcao` válido, mas um cadastro errado não pode travar a tela) e um
// teto de profundidade por segurança.
const PROFUNDIDADE_MAXIMA_DESCENDENTES = 12

export function buscarDescendentes(mapa, codigoRaiz) {
  const vistos = new Set([codigoRaiz])
  const ordem = []
  let nivelAtual = [codigoRaiz]
  let profundidade = 0
  while (nivelAtual.length > 0 && profundidade < PROFUNDIDADE_MAXIMA_DESCENDENTES) {
    const proximoNivel = []
    for (const codigoPai of nivelAtual) {
      for (const filho of filhosDiretos(mapa, codigoPai)) {
        if (vistos.has(filho)) continue // guarda de ciclo
        vistos.add(filho)
        ordem.push(filho)
        proximoNivel.push(filho)
      }
    }
    nivelAtual = proximoNivel
    profundidade += 1
  }
  return ordem
}
