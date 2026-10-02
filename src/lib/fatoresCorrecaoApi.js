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

// Quanto de insumo cru uma quantidade de item porcionado implicaria, seguindo a mesma cadeia —
// é o inverso de `shareEsperadoAcumulado` (que é a razão porcionado/cru esperada). Serve pra
// avisar na hora de digitar: se o peso digitado implicaria um bruto maior do que a entrada real
// da produção, é sinal forte de dedo errado (zero a mais, vírgula no lugar errado) — pega esse
// tipo de erro sem precisar entender "F.C." (§ pedido do Felipe, 02/10/2026).
export function brutoEquivalente(mapa, codigoEverest, quantidade) {
  const share = shareEsperadoAcumulado(mapa, codigoEverest)
  if (!(share > 0) || share === 1) return null // share 1 = item não mapeado em fatores_correcao, sem base de comparação
  return quantidade / share
}

// Pedido do Felipe (02/10/2026): ao escolher "Mignon" na entrada, só mostrar na saída o que de
// fato é derivado do Mignon (toda a família da ficha técnica), não o catálogo de pré-preparo
// inteiro — "eu não vou fazer frango a passarinho". `mapa` é child->{pai, fator} (ver
// `buscarFatoresCorrecao`); aqui andamos na direção CONTRÁRIA (de pai pra filho), olhando se
// `codigoRaiz` aparece em algum ponto da cadeia de pais de cada item do mapa.
export function descendentesDe(mapa, codigoRaiz) {
  const resultado = new Set()
  Object.keys(mapa).forEach((filho) => {
    let atual = filho
    const visitados = new Set()
    while (mapa[atual] && !visitados.has(atual)) {
      visitados.add(atual)
      atual = mapa[atual].pai
      if (atual === codigoRaiz) { resultado.add(filho); break }
    }
  })
  return resultado
}

// Pedido do Felipe (02/10/2026): "PP FILET MIGNON CABECA E RABO PARA LIMPAR" é claramente da
// família do Mignon, mas não tem ficha técnica NEM fator cadastrado ainda — e a preocupação dele é
// que exigir isso de TODO item faria o cadastro virar um projeto gigante e o time abandonar. Esse
// é o reforço automático que não depende de nenhum cadastro: compara palavras do NOME.
//
// Estratégia: tira do nome as palavras genéricas (espécie, unidade, estado de preparo — que mudam
// de um degrau pro outro da ficha, ex. "BOVINO ... PEÇA" vira só "PP ...") e compara o que sobra
// ("núcleo"). Se todo o núcleo da entrada aparece no nome do candidato, ele entra na família.
// Funciona em cima do nome que já existe hoje, sem exigir ninguém cadastrar nada antes.
const PALAVRAS_GENERICAS = new Set([
  'PP', 'KG', 'UN', 'UND', 'CX', 'PC',
  'BOVINO', 'BOVINA', 'SUINO', 'SUINA', 'AVE', 'FRANGO', 'PEIXE',
  'PECA', 'PECAS', 'CRU', 'CRUA', 'CRUS', 'CRUAS',
  'PARA', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'E', 'OU', 'COM', 'SEM',
  'LIMPEZA', 'LIMPAR', 'LIMPO', 'LIMPA',
  'PORCIONADO', 'PORCIONADA', 'PORCIONAMENTO'
])

function nucleoDoNome(nome) {
  return new Set(
    String(nome || '')
      .toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^A-Z0-9]+/)
      .filter((t) => t.length > 1 && !PALAVRAS_GENERICAS.has(t))
  )
}

export function pareceDaMesmaFamilia(nomeEntrada, nomeCandidato) {
  const nucleo = nucleoDoNome(nomeEntrada)
  if (!nucleo.size) return false
  const candidatoTokens = nucleoDoNome(nomeCandidato)
  for (const t of nucleo) if (!candidatoTokens.has(t)) return false
  return true
}

// Busca só o necessário: filtra no banco pela palavra mais específica do núcleo (a mais longa —
// heurística simples, mas evita trazer o catálogo inteiro, o mesmo erro de performance já visto
// antes em `listarGruposEverestComContagem`) e só então confere o núcleo inteiro em JS.
export async function buscarProdutosMesmaFamilia(nomeEntrada, tiposItem) {
  const nucleo = [...nucleoDoNome(nomeEntrada)]
  if (!nucleo.length) return []
  const tokenMaisEspecifico = nucleo.reduce((a, b) => (b.length > a.length ? b : a))
  let q = supabase.from('produtos').select('*').eq('ativo', true).ilike('nome', `%${tokenMaisEspecifico}%`)
  if (tiposItem?.length) q = q.in('tipo_item', tiposItem)
  const { data, error } = await q.limit(100)
  if (error) throw error
  return (data || []).filter((p) => pareceDaMesmaFamilia(nomeEntrada, p.nome))
}
