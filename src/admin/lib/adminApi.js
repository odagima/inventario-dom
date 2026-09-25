import { supabase } from '../../lib/supabase'

// Busca TODAS as linhas de uma consulta, paginando automaticamente — o Supabase corta em
// 1000 linhas por padrão sem avisar, e várias das nossas tabelas (produtos, contagens_historicas,
// itens_esperados_sessao numa mensal) já passam disso facilmente.
async function buscarTodasAsLinhas(construirQuery) {
  const TAMANHO_LOTE = 1000
  let pagina = 0
  let tudo = []
  while (true) {
    const { data, error } = await construirQuery().range(pagina * TAMANHO_LOTE, pagina * TAMANHO_LOTE + TAMANHO_LOTE - 1)
    if (error) throw error
    tudo = tudo.concat(data)
    if (data.length < TAMANHO_LOTE) break
    pagina += 1
  }
  return tudo
}

// 25/08/2026 — QUINTA reincidência do mesmo bug (ver DECISOES-TRAVADAS.md §10, §22.1, §25.1 e
// agora §29): um `.in('coluna', listaGigante)` sem quebrar em lotes gera uma URL que passa do
// limite do PostgREST e volta "Bad Request". O motivo de voltar sempre é que o padrão de lote de
// 300 estava COPIADO À MÃO em ~15 lugares e esquecido em outros ~10 — nunca houve um helper. Este
// é o helper: quebra a lista de ids em lotes de 300 E pagina as linhas de cada lote (as duas coisas
// que precisam acontecer juntas). Toda consulta nova com `.in()` numa lista que cresce com o
// período/cadastro deve passar por aqui, nunca montar o `.in()` na mão.
// 25/08/2026: "coluna não existe" chega em mais de um formato dependendo de onde bate — `42703` é o
// erro do Postgres, mas o PostgREST devolve `PGRST204` ("Could not find the 'x' column ... in the
// schema cache") quando a coluna falta num INSERT/UPDATE. O código só tratava o primeiro, então a
// leitura caía no fallback certinho e a GRAVAÇÃO estourava com a mensagem crua na tela (visto em
// Grupos de contagem → Desativar, 25/08/2026). Ver §31.
function ehColunaAusente(error) {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return /schema cache|column .* does not exist/i.test(error.message || '')
}

// 02/09/2026 (§67) — mesmo problema do helper acima, um nível acima: "tabela não existe" chega como
// `42P01` do Postgres e como `PGRST205` ("Could not find the table 'public.x' in the schema cache")
// do PostgREST. Serve pra telas que dependem de migração ainda não rodada poderem dizer "falta
// rodar a migration_vNN" em vez de mostrar a mensagem genérica de internet — que é exatamente o
// que aconteceu com a tela de Produção antes da v14 ("Could not find the table 'public.producoes'").
// Mesma família: a RPC existe com OUTRA assinatura (parâmetros novos) porque a migração que a
// reescreve ainda não rodou. O PostgREST responde `PGRST202` ("Could not find the function ... with
// parameters"). Sem tratar isso, a tela de usuários fica inutilizável entre subir o código e rodar
// a migração — e a ordem dessas duas coisas nunca é garantida (o Felipe sobe o dist e roda o SQL em
// momentos diferentes).
function ehFuncaoAusente(error) {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true
  return /Could not find the function|function .* does not exist/i.test(error.message || '')
}

function ehTabelaAusente(error) {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /Could not find the table|relation .* does not exist/i.test(error.message || '')
}

const TAMANHO_LOTE_IN = 300
async function buscarPorIdsEmLotes(construirQuery, ids) {
  // Guarda-corpo: esquecer o 2º argumento devolvia [] silenciosamente — foi assim que "Compras no
  // período" zerou na Análise de Custo em 25/08/2026. Lista ausente é bug de código, não "nenhum
  // resultado", então quebra alto em vez de devolver vazio parecendo dado legítimo.
  if (ids === undefined) throw new Error('buscarPorIdsEmLotes: lista de ids não foi passada (2º argumento)')
  const unicos = [...new Set((ids || []).filter((v) => v != null))]
  if (!unicos.length) return []
  let tudo = []
  for (let i = 0; i < unicos.length; i += TAMANHO_LOTE_IN) {
    const lote = unicos.slice(i, i + TAMANHO_LOTE_IN)
    tudo = tudo.concat(await buscarTodasAsLinhas(() => construirQuery(lote)))
  }
  return tudo
}

// Resolve código Everest → id do produto no cadastro ATUAL (`produtos`), em lotes de 300 (URL
// grande estoura em lote maior — mesmo limite já usado nos importadores). Usado pelos relatórios
// que precisam vincular um item já salvo (venda, compra) ao produto de hoje SEM confiar no
// `produto_id` gravado no item na hora do import — esse `produto_id` é um retrato de quando foi
// importado; se `produtos` foi zerado e reimportado depois (Reset → reimport, comum nesta faxina),
// o id antigo referenciado no item não existe mais, e olhar só pra ele faz o item parecer "sem
// produto" mesmo com o cadastro certo hoje. Resolver por código Everest (identidade canônica, §1)
// corrige isso sem precisar reimportar o item de novo.
async function resolverIdsPorCodigoEverest(codigos) {
  const idPorCodigo = new Map()
  const codigosUnicos = [...new Set(codigos.filter(Boolean))]
  const TAMANHO_LOTE = 300
  for (let i = 0; i < codigosUnicos.length; i += TAMANHO_LOTE) {
    const lote = codigosUnicos.slice(i, i + TAMANHO_LOTE)
    const { data, error } = await supabase.from('produtos').select('id, codigo_everest').in('codigo_everest', lote)
    if (error) throw error
    for (const p of data) idPorCodigo.set(p.codigo_everest, p.id)
  }
  return idPorCodigo
}

// 11/08/2026: mesmo problema do helper acima, só que do lado da FICHA TÉCNICA — achado revisando
// o motivo de julho continuar "sem ficha técnica" mesmo depois da correção por código Everest no
// item vendido (Felipe: "ainda não está aparecendo"). `importarFichasTecnicas` grava
// `produto_id: idPorCodigo.get(f.codigo)` na hora do import (upsert por `codigo_everest`, que é a
// chave de conflito — sempre única e sempre atual) — mas esse `produto_id` gravado na ficha É a
// MESMA foto do cadastro daquele momento. Se Produtos foi zerado/reimportado DEPOIS da última
// importação de Ficha Técnica (comum nesta faxina), a ficha continua certinha (custo, ingredientes,
// tudo), só o `produto_id` gravado nela que ficou órfão — e como `buscarCurvaDeVendas`/
// `buscarConsumoTeorico` casavam a ficha pelo `produto_id`, o item aparecia "sem ficha técnica" por
// engano (a ficha existe, o vínculo antigo é que estava furado). Resolver a ficha pelo
// `codigo_everest` (que é justamente a chave de conflito do upsert, então sempre reflete o produto
// certo) evita esse problema pelo mesmo motivo do helper acima.
async function resolverFichasPorCodigoEverest(codigos) {
  const fichaPorCodigo = new Map()
  const codigosUnicos = [...new Set(codigos.filter(Boolean))]
  const TAMANHO_LOTE = 300
  for (let i = 0; i < codigosUnicos.length; i += TAMANHO_LOTE) {
    const lote = codigosUnicos.slice(i, i + TAMANHO_LOTE)
    const { data, error } = await supabase.from('fichas_tecnicas').select('id, codigo_everest, nome, quantidade_producao, custo_producao').in('codigo_everest', lote)
    if (error) throw error
    for (const f of data) fichaPorCodigo.set(f.codigo_everest, f)
  }
  return fichaPorCodigo
}

// 12/08/2026, correção pedida pelo Felipe: a versão anterior deste helper usava `valor_liquido`
// (V.Líquido do Everest) como base do faturamento — mas o Felipe apontou que esse campo é
// FINANCEIRO (carrega desconto do produto), e desconto não deve entrar no cálculo de CMV. O que
// ele quer é: preço de TABELA do item (V.Unitário) × quantidade, com o acréscimo de 13% de
// gorjeta por cima — sem nenhum desconto financeiro misturado.
//
//     valorVenda = valor_unitario × quantidade × 1,13
//
// `valor_unitario` (V.Unitário, col. 13 do relatório "Vendas Integração PDV") é novo — só existe a
// partir da importação feita depois da migração v8 (12/08/2026, ver `migration_v8.sql`). Fallback
// em cascata pra nunca zerar receita em silêncio (mesmo princípio do §5: não calcular no escuro):
//   1. valor_unitario × quantidade × 1,13 — o cálculo certo, pedido pelo Felipe.
//   2. valor_total × 1,13 — pra itens importados antes da migração v8 (sem valor_unitario ainda).
//      `valor_total` (V.Total) é o valor do item ANTES da gorjeta e sem o desconto financeiro que
//      only vive em `valor_liquido` — mesma base de fundo do cálculo novo, só que agregada por
//      linha em vez de unidade × quantidade.
//   3. 0 — só no caso extremo de nem valor_unitario nem valor_total existirem.
// `valor_liquido` deixou de ser usado no cálculo (continua gravado no banco, nunca se apaga dado
// já importado — não precisa reimportar por causa disso, só por causa do valor_unitario faltante).
// NÃO usar em Compras (`notas_importadas_itens.valor_total`) — lá não existe gorjeta nem esse
// conceito de preço de tabela, é um conceito só de Vendas.
const FATOR_GORJETA = 1.13
function valorVenda(it) {
  if (it.valor_unitario != null) return (Number(it.valor_unitario) || 0) * (Number(it.quantidade) || 0) * FATOR_GORJETA
  if (it.valor_total != null) return (Number(it.valor_total) || 0) * FATOR_GORJETA
  return 0
}

// ---------- Produtos / consulta ----------
const TAMANHO_PAGINA = 100


export async function buscarProdutosAdmin(termo, pagina = 0, filtroStatus = 'todos') {
  const t = termo?.trim()
  const de = pagina * TAMANHO_PAGINA
  const ate = de + TAMANHO_PAGINA - 1

  if (filtroStatus === 'sem_codigo') {
    const { data: comBarcode, error: erroBarcodes } = await supabase.from('barcodes').select('produto_id')
    if (erroBarcodes) throw erroBarcodes
    const idsComCodigo = [...new Set(comBarcode.map((b) => b.produto_id))]
    let query = supabase.from('produtos').select('*, barcodes(codigo_barras, origem)').eq('ativo', true).order('nome').range(de, ate)
    if (idsComCodigo.length) query = query.not('id', 'in', `(${idsComCodigo.join(',')})`)
    if (t) query = query.ilike('nome', `%${t}%`)
    const { data, error } = await query
    if (error) throw error
    return data
  }

  if (filtroStatus === 'industrializado' || filtroStatus === 'interno') {
    let query = supabase
      .from('produtos')
      .select('*, barcodes!inner(codigo_barras, origem)')
      .eq('ativo', true)
      .eq('barcodes.origem', filtroStatus)
      .order('nome')
      .range(de, ate)
    if (t) query = query.ilike('nome', `%${t}%`)
    const { data, error } = await query
    if (error) throw error
    return data
  }

  if (!t) {
    const { data, error } = await supabase
      .from('produtos')
      .select('*, barcodes(codigo_barras, origem)')
      .eq('ativo', true)
      .order('nome')
      .range(de, ate)
    if (error) throw error
    return data
  }

  // Duas buscas separadas em vez de .or() — nomes com vírgula, parênteses etc.
  // quebram a sintaxe de filtro combinado do PostgREST.
  const [porNome, porCodigo] = await Promise.all([
    supabase.from('produtos').select('*, barcodes(codigo_barras, origem)').eq('ativo', true).ilike('nome', `%${t}%`).range(de, ate),
    supabase.from('produtos').select('*, barcodes(codigo_barras, origem)').eq('ativo', true).ilike('codigo_everest', `%${t}%`).range(de, ate)
  ])
  if (porNome.error) throw porNome.error
  if (porCodigo.error) throw porCodigo.error

  const porId = new Map()
  for (const p of [...porNome.data, ...porCodigo.data]) porId.set(p.id, p)
  return Array.from(porId.values()).sort((a, b) => a.nome.localeCompare(b.nome))
}

// ---------- Suporte à importação de NF-e em lote (tudo local, sem 1 consulta por item) ----------
export async function carregarProdutosParaMatching() {
  return buscarTodasAsLinhas(() =>
    supabase
      .from('produtos')
      .select('id, nome, codigo_everest, unidade_medida, categoria, barcodes(codigo_barras)')
      .eq('ativo', true)
  )
}

export async function vincularBarcodesEmLote(lista) {
  if (!lista.length) return
  const linhas = lista.map((l) => ({ codigo_barras: l.codigoBarras, produto_id: l.produtoId, origem: l.origem || 'industrializado' }))
  const tamanhoLote = 400
  for (let i = 0; i < linhas.length; i += tamanhoLote) {
    const { error } = await supabase.from('barcodes').upsert(linhas.slice(i, i + tamanhoLote), { onConflict: 'codigo_barras' })
    if (error) throw error
  }
}

export async function registrarNotasImportadas(notas) {
  const numerosNota = notas.map((n) => n.numeroNota).filter(Boolean)
  const existentesPorChave = new Set()
  if (numerosNota.length) {
    const { data: jaExistentes, error: erroCheck } = await supabase
      .from('notas_importadas')
      .select('numero_nota, cnpj_destinatario')
      .in('numero_nota', numerosNota)
    if (erroCheck) throw erroCheck
    for (const e of jaExistentes) existentesPorChave.add(`${e.numero_nota}|${e.cnpj_destinatario || ''}`)
  }

  for (const nota of notas) {
    const chave = `${nota.numeroNota}|${nota.cnpjDestinatario || ''}`
    if (existentesPorChave.has(chave)) continue

    const { data: notaSalva, error: erroNota } = await supabase
      .from('notas_importadas')
      .insert({
        numero_nota: nota.numeroNota,
        fornecedor: nota.fornecedor,
        cnpj_destinatario: nota.cnpjDestinatario,
        data_emissao: nota.dataEmissao
      })
      .select()
      .single()
    if (erroNota) throw erroNota

    const itensParaSalvar = nota.linhas.map((l) => ({
      nota_id: notaSalva.id,
      produto_id: l.escolhido?.id || l.produtoJaVinculado?.id || null,
      nome_xml: l.nome,
      ean: l.cean,
      unidade: l.unidade,
      quantidade: l.quantidade
    }))
    if (itensParaSalvar.length) {
      const { error: erroItens } = await supabase.from('notas_importadas_itens').insert(itensParaSalvar)
      if (erroItens) throw erroItens
    }
  }
}
export async function buscarProdutosSemCodigo(termo) {
  const { data: comBarcode, error: erroBarcodes } = await supabase.from('barcodes').select('produto_id')
  if (erroBarcodes) throw erroBarcodes
  const idsComCodigo = [...new Set(comBarcode.map((b) => b.produto_id))]

  let query = supabase.from('produtos').select('*').eq('ativo', true).order('nome').limit(50)
  if (idsComCodigo.length) query = query.not('id', 'in', `(${idsComCodigo.join(',')})`)
  if (termo?.trim()) query = query.ilike('nome', `%${termo.trim()}%`)

  const { data, error } = await query
  if (error) throw error
  return data
}

// ---------- Histórico antigo (planilhas de antes do app) ----------
function normalizarChave(str) {
  return str.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export async function contarHistoricoExistente() {
  const { count, error } = await supabase.from('contagens_historicas').select('*', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

// Ajusta uma data pro "fechamento do mês": contagens feitas até 10 dias depois do fim do mês,
// ou já nos últimos 10 dias do mês, contam como o último dia daquele mês (sem horário).
// Dias no meio do mês (11 a 20) mantêm a data real, sem esse ajuste.
export function normalizarDataFechamentoMes(data) {
  const dia = data.getDate()
  let mesRef = data.getMonth()
  let anoRef = data.getFullYear()
  if (dia >= 21) {
    // fica no fechamento do mês atual
  } else if (dia <= 10) {
    mesRef -= 1
    if (mesRef < 0) { mesRef = 11; anoRef -= 1 }
  } else {
    return data // dia 11-20: mantém a data real
  }
  return new Date(anoRef, mesRef + 1, 0) // dia 0 do mês seguinte = último dia do mês de referência
}

export async function importarContagensHistoricas(linhas, onProgresso) {
  if (!linhas.length) return { total: 0, comProduto: 0 }

  const produtos = await buscarTodasAsLinhas(() => supabase.from('produtos').select('id, codigo_everest'))
  const idPorCodigo = new Map(produtos.filter((p) => p.codigo_everest).map((p) => [p.codigo_everest, p.id]))

  const cabecalho = Object.keys(linhas[0])
  const achar = (alvo) => cabecalho.find((c) => normalizarChave(c) === alvo)
  const colResponsavel = achar('responsavel')
  const colLocal = achar('local')
  const colItem = achar('item')
  const colCodigo = achar('codigo_everest')
  const colUnidade = achar('unidade medida')
  const colQuantidade = achar('quantidade')
  const colData = achar('data e hora')

  const registros = linhas.map((linha) => {
    const codigo = String(linha[colCodigo] ?? '').trim()
    return {
      produto_id: idPorCodigo.get(codigo) || null,
      codigo_everest: codigo || null,
      nome_original: String(linha[colItem] ?? '').trim() || null,
      responsavel: String(linha[colResponsavel] ?? '').trim() || null,
      local_original: String(linha[colLocal] ?? '').trim() || null,
      unidade_medida: String(linha[colUnidade] ?? '').trim().toLowerCase() || null,
      quantidade: Number(linha[colQuantidade]) || null,
      registrado_em: linha[colData] instanceof Date
        ? normalizarDataFechamentoMes(linha[colData]).toISOString().slice(0, 10)
        : (linha[colData] ? new Date(linha[colData]).toISOString().slice(0, 10) : null)
    }
  })

  const tamanhoLote = 500
  let comProduto = 0
  for (let i = 0; i < registros.length; i += tamanhoLote) {
    const lote = registros.slice(i, i + tamanhoLote)
    const { error: erroInsert } = await supabase.from('contagens_historicas').insert(lote)
    if (erroInsert) throw erroInsert
    comProduto += lote.filter((r) => r.produto_id).length
    onProgresso?.({ feito: Math.min(i + tamanhoLote, registros.length), total: registros.length })
    // yield pro navegador respirar entre lotes (evita a tela travar em planilhas grandes)
    await new Promise((r) => setTimeout(r, 0))
  }

  return { total: registros.length, comProduto }
}

export async function buscarEtiquetasGeradas(termo) {
  let query = supabase
    .from('barcodes')
    .select('codigo_barras, created_at, produtos(*)')
    .eq('origem', 'interno')
    .order('created_at', { ascending: false })
    .limit(100)

  const { data, error } = await query
  if (error) throw error

  const t = termo?.trim().toLowerCase()
  const filtrado = t
    ? data.filter((b) => b.produtos?.nome?.toLowerCase().includes(t) || b.produtos?.codigo_everest?.includes(t))
    : data

  return filtrado.map((b) => ({ ...b.produtos, codigo_barras_gerado: b.codigo_barras, gerado_em: b.created_at }))
}

// ---------- Reset / zerar dados (uso administrativo, com cautela) ----------
export async function contarParaReset() {
  const [barcodesIndustrializados, barcodesInternos, historico] = await Promise.all([
    supabase.from('barcodes').select('*', { count: 'exact', head: true }).eq('origem', 'industrializado'),
    supabase.from('barcodes').select('*', { count: 'exact', head: true }).eq('origem', 'interno'),
    supabase.from('contagens_historicas').select('*', { count: 'exact', head: true })
  ])
  return {
    barcodesIndustrializados: barcodesIndustrializados.count || 0,
    barcodesInternos: barcodesInternos.count || 0,
    historico: historico.count || 0
  }
}

export async function resetarVinculosNFe() {
  // Remove só os códigos de barras vindos de NF-e/import (industrializado). Preserva as
  // etiquetas internas geradas manualmente.
  // Correção 05/08/2026: esta função ANTES também apagava notas_importadas por completo — fazia
  // sentido quando NF-e era a única fonte dessa tabela, mas hoje "Compras no Período" (fonte
  // única de compras, §1 do doc de decisões) grava nas mesmas tabelas. Zerar aqui apagaria compras
  // reais pensando que era só limpeza de NF-e. Ver resetarComprasImportadas() pra isso, em separado.
  const { error } = await supabase.from('barcodes').delete().eq('origem', 'industrializado')
  if (error) throw error
}

export async function resetarEtiquetasInternas() {
  const { error } = await supabase.from('barcodes').delete().eq('origem', 'interno')
  if (error) throw error
}

export async function resetarHistoricoAntigo() {
  const { error } = await supabase.from('contagens_historicas').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (error) throw error
}

// ---------- Zerar bases do Everest (produtos/fichas/vendas/compras) — faxina de dados ----------
// Guarda-corpo importante: itens_contagem e saidas_contagem apontam pra produtos SEM cascade de
// propósito (protege o histórico real de contagem). Isso significa que "zerar produtos" por
// completo é estruturalmente inseguro — ou falha (produto com contagem real bloqueia o delete),
// ou, se forçado via cascade, destruiria contagens reais. Por isso produtos só tem a opção
// "órfãos" (sem nenhuma contagem/saída associada) — o resto se corrige reimportando (upsert por
// codigo_everest, já feito em importarProdutosEverest). fichas_tecnicas, vendas_importadas e
// notas_importadas não têm esse problema (nada de real/app-origin referencia essas tabelas como
// pai) — podem ser zeradas por completo com segurança antes de reimportar.
export async function contarBasesEverestParaReset() {
  const [{ count: produtos }, { count: fichasTecnicas }, { count: vendasImportadas }, { count: notasImportadas }] = await Promise.all([
    supabase.from('produtos').select('*', { count: 'exact', head: true }),
    supabase.from('fichas_tecnicas').select('*', { count: 'exact', head: true }),
    supabase.from('vendas_importadas').select('*', { count: 'exact', head: true }),
    supabase.from('notas_importadas').select('*', { count: 'exact', head: true })
  ])
  const idsComContagem = await buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('produto_id'))
  const idsComSaida = await buscarTodasAsLinhas(() => supabase.from('saidas_contagem').select('produto_id'))
  const protegidos = new Set([...idsComContagem.map((r) => r.produto_id), ...idsComSaida.map((r) => r.produto_id)])
  return {
    produtos: produtos || 0,
    produtosProtegidos: protegidos.size, // têm contagem/saída real — nunca apagados
    produtosOrfaos: Math.max((produtos || 0) - protegidos.size, 0),
    fichasTecnicas: fichasTecnicas || 0,
    vendasImportadas: vendasImportadas || 0,
    notasImportadas: notasImportadas || 0
  }
}

export async function resetarFichasTecnicas() {
  // Cascade cuida de fichas_tecnicas_ingredientes.
  const { error } = await supabase.from('fichas_tecnicas').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (error) throw error
  // Zerar as fichas sem limpar o cache era ainda pior que o caso do import: os relatórios
  // continuariam calculando em cima de fichas que não existem mais.
  invalidarCacheFichas()
}

export async function resetarVendasImportadas() {
  // Cascade cuida de vendas_importadas_itens.
  const { error } = await supabase.from('vendas_importadas').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (error) throw error
}

export async function resetarComprasImportadas() {
  // Cascade cuida de notas_importadas_itens.
  const { error } = await supabase.from('notas_importadas').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (error) throw error
}

export async function resetarProdutosOrfaos() {
  const idsComContagem = await buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('produto_id'))
  const idsComSaida = await buscarTodasAsLinhas(() => supabase.from('saidas_contagem').select('produto_id'))
  const protegidos = new Set([...idsComContagem.map((r) => r.produto_id), ...idsComSaida.map((r) => r.produto_id)])
  const todos = await buscarTodasAsLinhas(() => supabase.from('produtos').select('id'))
  const idsParaApagar = todos.map((p) => p.id).filter((id) => !protegidos.has(id))

  let apagados = 0
  const tamanhoLote = 300
  for (let i = 0; i < idsParaApagar.length; i += tamanhoLote) {
    const lote = idsParaApagar.slice(i, i + tamanhoLote)
    const { error } = await supabase.from('produtos').delete().in('id', lote)
    if (error) throw error
    apagados += lote.length
  }
  return { apagados, protegidos: protegidos.size }
}

// ---------- Configuração geral (só acessível de dentro do admin) ----------
// A aba "Senhas de acesso" (papéis Owner/Gerente/Cadastro, tabela `senhas_acesso`) foi removida
// em 07/08/2026: nunca esteve ligada a nenhum login real do app (nada chamava `verificarSenha`),
// e a tabela ficava com RLS aberto (qualquer um com a chave anônima lia/escrevia direto) — ver
// migração `2026-08-07-travar-senhas-pins.sql` e DECISOES-TRAVADAS.md. Manter a UI funcionando
// só ia dar a falsa impressão de que esse controle de acesso existia.

export async function setConfiguracaoGeral(mesAtivoMensal, anoAtivoMensal) {
  const { error: e1 } = await supabase
    .from('configuracao_geral')
    .upsert({ chave: 'mes_ativo_mensal', valor: String(mesAtivoMensal) }, { onConflict: 'chave' })
  if (e1) throw e1
  const { error: e2 } = await supabase
    .from('configuracao_geral')
    .upsert({ chave: 'ano_ativo_mensal', valor: String(anoAtivoMensal) }, { onConflict: 'chave' })
  if (e2) throw e2
}

// ---------- Unidades ----------
export async function listarUnidadesAdmin() {
  const { data, error } = await supabase.from('unidades').select('id, nome, cnpj, codigo_deposito, ativo').order('nome')
  if (error) throw error
  return data
}

export async function criarUnidade({ nome, cnpj, codigoDeposito }) {
  const { data, error } = await supabase
    .from('unidades')
    .insert({ nome, cnpj: cnpj || null, codigo_deposito: codigoDeposito || null })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function atualizarUnidade(id, { cnpj, codigoDeposito }) {
  const { error } = await supabase.from('unidades').update({ cnpj: cnpj || null, codigo_deposito: codigoDeposito || null }).eq('id', id)
  if (error) throw error
}

// ---------- Siglas internas ----------
export async function listarSiglas() {
  const { data, error } = await supabase.from('siglas_internas').select('sigla, significado').order('sigla')
  if (error) throw error
  return data
}

export async function criarSigla(sigla, significado) {
  const { error } = await supabase.from('siglas_internas').insert({ sigla: sigla.toUpperCase(), significado })
  if (error) throw error
}

// Escaneia os nomes dos produtos em busca de candidatos a sigla que ainda não estão
// mapeados. É só uma sugestão pra você revisar — não é gravado em lugar nenhum sozinho,
// então pode ter falso positivo (palavra comum de 2-3 letras que não é sigla de verdade).
export async function editarSigla(sigla, novoSignificado) {
  const { error } = await supabase.from('siglas_internas').update({ significado: novoSignificado }).eq('sigla', sigla)
  if (error) throw error
}

export async function deletarSigla(sigla) {
  const { error } = await supabase.from('siglas_internas').delete().eq('sigla', sigla)
  if (error) throw error
}

export async function ignorarSigla(sigla) {
  const { error } = await supabase.from('siglas_ignoradas').insert({ sigla })
  if (error) throw error
}

export async function buscarSiglasNaoMapeadas() {
  const [{ data: siglasConhecidas, error: e1 }, { data: ignoradas, error: e1b }] = await Promise.all([
    supabase.from('siglas_internas').select('sigla'),
    supabase.from('siglas_ignoradas').select('sigla')
  ])
  if (e1) throw e1
  if (e1b) throw e1b
  const conhecidas = new Set([...siglasConhecidas.map((s) => s.sigla), ...ignoradas.map((s) => s.sigla)])

  const produtos = await buscarTodasAsLinhas(() => supabase.from('produtos').select('nome').eq('ativo', true))

  const contagem = new Map()
  for (const p of produtos) {
    const candidata = extrairSigla(p.nome)
    if (!candidata || conhecidas.has(candidata)) continue
    contagem.set(candidata, (contagem.get(candidata) || 0) + 1)
  }
  return Array.from(contagem.entries())
    .map(([sigla, total]) => ({ sigla, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 30) // só as 30 mais frequentes, pra não virar uma lista infinita de ruído
}

// Recalcula a sigla de produtos já importados antes dessa funcionalidade existir.
export async function reprocessarSiglasExistentes(onProgresso) {
  const { data: siglasExistentes, error: erroSiglas } = await supabase.from('siglas_internas').select('sigla')
  if (erroSiglas) throw erroSiglas
  const siglasConhecidas = new Set(siglasExistentes.map((s) => s.sigla))

  const produtos = await buscarTodasAsLinhas(() => supabase.from('produtos').select('id, nome').is('sigla', null))

  const atualizacoes = produtos
    .map((p) => ({ id: p.id, sigla: extrairSiglaConhecida(p.nome, siglasConhecidas) }))
    .filter((p) => p.sigla)

  const tamanhoLote = 200
  for (let i = 0; i < atualizacoes.length; i += tamanhoLote) {
    const lote = atualizacoes.slice(i, i + tamanhoLote)
    await Promise.all(lote.map((p) => supabase.from('produtos').update({ sigla: p.sigla }).eq('id', p.id)))
    onProgresso?.({ feito: Math.min(i + tamanhoLote, atualizacoes.length), total: atualizacoes.length })
    await new Promise((r) => setTimeout(r, 0))
  }
  return atualizacoes.length
}

// ---------- Saldo comparativo (item / grupo ao longo das sessões) ----------
export async function buscarSaldoItem(produtoId) {
  const [{ data: contagensAtuais, error: e1 }, { data: historico, error: e2 }] = await Promise.all([
    supabase.from('itens_contagem').select('quantidade, sessoes_contagem(id, iniciada_em, tipo, unidades(nome))').eq('produto_id', produtoId),
    supabase.from('contagens_historicas').select('quantidade, registrado_em, local_original').eq('produto_id', produtoId)
  ])
  if (e1) throw e1
  if (e2) throw e2

  const daAtual = contagensAtuais
    .filter((d) => d.sessoes_contagem)
    .map((d) => ({
      sessaoId: d.sessoes_contagem.id,
      data: d.sessoes_contagem.iniciada_em,
      tipo: d.sessoes_contagem.tipo,
      unidade: d.sessoes_contagem.unidades?.nome,
      quantidade: Number(d.quantidade)
    }))

  const doHistorico = historico
    .filter((h) => h.registrado_em)
    .map((h) => ({
      sessaoId: null,
      data: h.registrado_em,
      tipo: 'histórico',
      unidade: h.local_original || 'histórico',
      quantidade: Number(h.quantidade)
    }))

  return [...daAtual, ...doHistorico].sort((a, b) => new Date(a.data) - new Date(b.data))
}

export async function listarGruposEverest() {
  const produtos = await buscarTodasAsLinhas(() =>
    supabase.from('produtos').select('grupo_everest').not('grupo_everest', 'is', null)
  )
  return [...new Set(produtos.map((p) => p.grupo_everest))].sort()
}

export async function buscarSaldoPorGrupoEverest(grupoEverest) {
  const produtos = await buscarTodasAsLinhas(() =>
    supabase.from('produtos').select('id, nome, codigo_everest').eq('grupo_everest', grupoEverest)
  )
  const resultados = await Promise.all(produtos.map(async (p) => ({ produto: p, serie: await buscarSaldoItem(p.id) })))
  return resultados
}

export async function buscarSaldoGrupo(grupoId) {
  const { data: itensGrupo, error } = await supabase
    .from('grupos_contagem_itens')
    .select('produtos(id, nome, unidade_medida)')
    .eq('grupo_id', grupoId)
  if (error) throw error

  const produtos = itensGrupo.map((r) => r.produtos)
  const resultados = await Promise.all(
    produtos.map(async (p) => ({ produto: p, serie: await buscarSaldoItem(p.id) }))
  )
  return resultados
}

// ---------- Importar Compras consolidado do Everest (mais confiável que NF-e: código já vem certo) ----------
// Subgrupos relevantes pro comparativo de compras (definido pelo Felipe) — o resto (uniformes,
// manutenção, informática, móveis etc.) é despesa/imobilizado, não item de estoque comparável.
const SUBGRUPOS_RELEVANTES = new Set([
  'MP - SECOS', 'VINHOS TINTOS', 'MATERIAIS DESCARTAVEIS', 'MP - PEIXES E FRUTOS DO MAR',
  'MP - FRIOS E LATICINIOS', 'MP - HORTIFRUTIS', 'MP - CARNES VERMELHAS', 'DESTILADOS - LICORES',
  'DESTILADOS - WHISKIES', 'HIGIENE E LIMPEZA', 'MP - MASSAS E PAES', 'GELOS',
  'MP - POLPAS E FRUTAS CONGELADAS', 'MATERIAIS DE ESCRITORIO', 'MP - CARNES BRANCAS', 'AGUAS',
  'VINHOS SOBREMESAS', 'VINHOS BRANCOS', 'MP - EMBUTIDOS E DEFUMADOS', 'CERVEJAS CONVENCIONAIS',
  'REFRIGERANTES', 'DESTILADOS - CACHACA E AGUARDENTES', 'DESTILADOS - CONHAQUES', 'DESTILADOS - GINS',
  'MC - PRODUTOS TERCEIROS AEB', 'VINHOS ESPUMANTES', 'VINHOS LARANJAS', 'DESTILADOS - SAQUES',
  'VINHOS ROSES', 'VINHOS LICOROSOS', 'UTENSILIOS - BAR', 'UTENSILIOS - SALAO',
  'DESTILADOS - APERITIVOS', 'DECORACAO', 'CERVEJAS ARTESANAIS', 'MATERIAIS DE EMBALAGENS',
  'MC - CASA E DECORACAO', 'DESTILADOS - VERMUTES', 'COMERCIALIZACAO ITENS REVENDA',
  'DESTILADOS - VODKAS', 'VINHOS CHAMPAGNES', 'VINHOS FORTIFICADOS', 'DESTILADOS - TEQUILAS',
  'DESTILADOS - RUMS', 'EV - EVENTOS E MENUS ESPECIAIS'
])

// Colunas pelo NOME do cabeçalho, não pela posição — o Everest já mudou a ordem/quantidade de
// colunas desse relatório mais de uma vez (última vez em 11/08/2026: a planilha real tinha 151
// colunas e quase todo índice fixo apontava pra coisa errada — ex. "Fantasia" tinha ido pra posição
// 134, "Item" pra 22, "Calcula CMV" pra 143, mas o código ainda lia posições antigas de uma versão
// bem menor do relatório, então CODIGO lia "Nome Cidade Entrega" e nunca batia com produto nenhum).
// Resolver por nome (como já fazíamos pra N. Nota/Razão Emitente/Subgrupo) deixa a importação
// resistente a isso — se o Everest mudar de novo, o pior caso é um erro claro, não dado errado calado.
// A planilha entrega a quantidade CONVERTIDA pra unidade de estoque ("Q. Estoque") e o custo já
// calculado nessa unidade ("V. Unitário Convertido" = V.Total ÷ Q.Estoque). Usamos as duas prontas,
// e guardamos a quantidade/unidade de compra (embalagem) bruta ao lado, pra auditoria (§2 do doc de
// decisões: "guardar bruto + convertido lado a lado").
const COL_NOMES = {
  EMPRESA: 'empresa',
  FANTASIA: 'fantasia',
  DATA: 'd. emissão',
  CODIGO: 'item',
  DESCRICAO: 'descrição item',
  UM_COMPRA: 'um',
  UM_ESTOQUE: 'um padrão de estoque',
  Q_EMBALAGENS: 'q. embalagens',
  Q_ESTOQUE: 'q. estoque',
  VALOR_UNITARIO_CONVERTIDO: 'v. unitário convertido',
  VALOR_TOTAL: 'v. total',
  CALCULA_CMV: 'calcula cmv'
}
// Colunas sem as quais a importação não tem como funcionar corretamente (viram custo/vínculo
// errado em silêncio) — essas têm que existir, senão erro claro em vez de dado errado calado.
const COL_OBRIGATORIAS = ['CODIGO', 'Q_ESTOQUE', 'VALOR_TOTAL']

export async function importarComprasEverest(linhasBrutas, onProgresso) {
  // linhasBrutas: array de arrays (linha 0 = cabeçalho), como sai de
  // XLSX.utils.sheet_to_json(sheet, {header:1}).
  if (!linhasBrutas.length) return { notas: 0, notasAtualizadas: 0, itens: 0, semCorrespondencia: 0, foraDoSubgrupo: 0, foraDoCMV: 0, linhasIgnoradas: 0 }

  const cabecalho = linhasBrutas[0]
  const resto = linhasBrutas.slice(1)
  const norm = (s) => String(s || '').trim().toLowerCase()
  const colNota = cabecalho.findIndex((c) => norm(c) === 'n. nota')
  const colFornecedor = cabecalho.findIndex((c) => norm(c) === 'razão emitente')
  const colSubgrupo = cabecalho.findIndex((c) => norm(c) === 'subgrupo')

  if (colNota === -1) {
    throw new Error('Não encontrei a coluna "N. Nota" nessa planilha — confere se é o relatório certo.')
  }

  const COL = {}
  for (const [chave, nome] of Object.entries(COL_NOMES)) {
    COL[chave] = cabecalho.findIndex((c) => norm(c) === nome)
  }
  const faltando = COL_OBRIGATORIAS.filter((chave) => COL[chave] === -1)
  if (faltando.length) {
    const nomesFaltando = faltando.map((chave) => `"${COL_NOMES[chave]}"`).join(', ')
    throw new Error(`Não encontrei a(s) coluna(s) ${nomesFaltando} nessa planilha — o layout do relatório do Everest pode ter mudado. Confere se é o relatório "Compras no Período" puro, sem alteração de colunas.`)
  }

  // Busca os produtos pelos códigos Everest únicos que aparecem na planilha — vínculo exato, sem fuzzy.
  const codigosUnicos = [...new Set(resto.map((l) => String(l[COL.CODIGO] ?? '').trim()).filter(Boolean))]
  const idPorCodigo = new Map()
  const tamanhoLoteBusca = 300
  for (let i = 0; i < codigosUnicos.length; i += tamanhoLoteBusca) {
    const lote = codigosUnicos.slice(i, i + tamanhoLoteBusca)
    const { data, error } = await supabase.from('produtos').select('id, codigo_everest').in('codigo_everest', lote)
    if (error) throw error
    for (const p of data) idPorCodigo.set(p.codigo_everest, p.id)
  }

  // Agrupa por nota
  const notasPorNumero = new Map()
  let foraDoSubgrupo = 0
  let linhasIgnoradas = 0
  for (const linha of resto) {
    // Rodapé do relatório (linha de totais no fim, sem N. Nota nem Item — só números somados nas
    // colunas de valor) não é uma compra de verdade. 11/08/2026: confirmado no arquivo real do
    // Felipe, a última linha vinha com a coluna "Origem" preenchida com a contagem de linhas (nº),
    // não "ENTRADA" — sinal claro de linha de totais, não de compra.
    const numeroNota = String(linha[colNota] ?? '').trim()
    if (!numeroNota) { linhasIgnoradas += 1; continue }

    if (colSubgrupo !== -1) {
      const subgrupo = String(linha[colSubgrupo] ?? '').trim().toUpperCase()
      if (subgrupo && !SUBGRUPOS_RELEVANTES.has(subgrupo)) {
        foraDoSubgrupo += 1
        continue
      }
    }

    if (!notasPorNumero.has(numeroNota)) {
      const dataBruta = linha[COL.DATA]
      const dataEmissao = dataBruta instanceof Date ? dataBruta.toISOString().slice(0, 10) : String(dataBruta || '').slice(0, 10)
      const empresaNum = String(linha[COL.EMPRESA] ?? '').trim()
      const fantasia = String(linha[COL.FANTASIA] ?? '').trim()
      notasPorNumero.set(numeroNota, {
        numeroNota,
        fornecedor: colFornecedor !== -1 ? String(linha[colFornecedor] ?? '').trim() : null,
        empresaNum,
        fantasia,
        dataEmissao,
        itens: []
      })
    }
    const codigo = String(linha[COL.CODIGO] ?? '').trim()
    const quantidade = Number(linha[COL.Q_ESTOQUE]) || 0
    const quantidadeEmbalagens = linha[COL.Q_EMBALAGENS] != null ? Number(linha[COL.Q_EMBALAGENS]) || null : null
    const valorTotal = Number(linha[COL.VALOR_TOTAL]) || null
    const valorUnitarioConvertido = linha[COL.VALOR_UNITARIO_CONVERTIDO] != null && linha[COL.VALOR_UNITARIO_CONVERTIDO] !== ''
      ? Number(linha[COL.VALOR_UNITARIO_CONVERTIDO])
      : (valorTotal && quantidade ? valorTotal / quantidade : null)
    const calculaCmvTexto = String(linha[COL.CALCULA_CMV] ?? '').trim().toLowerCase()
    const calculaCmv = calculaCmvTexto !== 'não' && calculaCmvTexto !== 'nao'
    notasPorNumero.get(numeroNota).itens.push({
      codigo,
      nome: String(linha[COL.DESCRICAO] ?? '').trim(),
      quantidade,
      unidade: String(linha[COL.UM_ESTOQUE] ?? '').trim().toLowerCase(),
      quantidadeEmbalagens,
      unidadeCompra: String(linha[COL.UM_COMPRA] ?? '').trim().toLowerCase() || null,
      valorTotal,
      valorUnitario: valorUnitarioConvertido,
      calculaCmv,
      produtoId: idPorCodigo.get(codigo) || null
    })
  }

  const notas = Array.from(notasPorNumero.values())

  // 25/09/2026, correção pedida pelo Felipe: uma compra de R$33.000 tinha sido importada como
  // R$33.000.000 (erro no arquivo do Everest), foi corrigida lá e reenviada aqui — mas a versão
  // anterior deste código só CONFERIA se a nota (número + empresa) já existia e, se sim, ignorava
  // a nota inteira (`continue`, contava em `notasDuplicadas`), sem nunca olhar se os valores
  // mudaram. Reimportar a correção não tinha efeito nenhum. Agora, nota já existente = itens são
  // substituídos pelos do arquivo novo (a fonte de verdade é sempre o Everest); só usa `insert`
  // puro quando a nota é realmente inédita.
  const numerosNota = notas.map((n) => n.numeroNota).filter(Boolean)
  const idExistentePorChave = new Map()
  const tamanhoLoteCheck = 300
  for (let i = 0; i < numerosNota.length; i += tamanhoLoteCheck) {
    const lote = numerosNota.slice(i, i + tamanhoLoteCheck)
    const { data: jaExistentes, error: erroCheck } = await supabase
      .from('notas_importadas')
      .select('id, numero_nota, cnpj_destinatario, fantasia')
      .in('numero_nota', lote)
    if (erroCheck) throw erroCheck
    for (const e of jaExistentes) idExistentePorChave.set(`${e.numero_nota}|${e.fantasia || e.cnpj_destinatario || ''}`, e.id)
  }

  let notasSalvas = 0
  let notasAtualizadas = 0
  let itensSalvos = 0
  let semCorrespondencia = 0
  let foraDoCMV = 0

  for (const nota of notas) {
    const chaveNota = `${nota.numeroNota}|${nota.fantasia || ''}`
    const idExistente = idExistentePorChave.get(chaveNota)

    let notaId
    if (idExistente) {
      const { error: erroUpdate } = await supabase
        .from('notas_importadas')
        .update({ fornecedor: nota.fornecedor, data_emissao: nota.dataEmissao || null })
        .eq('id', idExistente)
      if (erroUpdate) throw erroUpdate
      // Substitui os itens da nota em vez de acumular — reimportar a mesma nota nunca deve somar
      // valores/quantidades em dobro, só refletir o que o arquivo tem agora.
      const { error: erroDelItens } = await supabase.from('notas_importadas_itens').delete().eq('nota_id', idExistente)
      if (erroDelItens) throw erroDelItens
      notaId = idExistente
      notasAtualizadas += 1
    } else {
      const { data: notaSalva, error: erroNota } = await supabase
        .from('notas_importadas')
        .insert({
          numero_nota: nota.numeroNota,
          fornecedor: nota.fornecedor,
          fantasia: nota.fantasia || null,
          data_emissao: nota.dataEmissao || null
        })
        .select()
        .single()
      if (erroNota) throw erroNota
      notaId = notaSalva.id
      notasSalvas += 1
    }

    const itensParaSalvar = nota.itens.map((it) => ({
      nota_id: notaId,
      produto_id: it.produtoId,
      // 12/08/2026, migration_v9: guarda o código Everest bruto da linha (já lido do relatório,
      // ver `codigo` acima) — não só o `produto_id` resolvido na hora do import. Precisa disso pra
      // montar a linha do tempo de preço por mês (Histórico de Ficha Técnica, pedido do Felipe) de
      // forma confiável mesmo depois de `produtos` ser zerado/reimportado (mesma FK órfã do §5).
      codigo_everest: it.codigo || null,
      nome_xml: it.nome,
      ean: null,
      unidade: it.unidade,
      quantidade: it.quantidade,
      quantidade_embalagens: it.quantidadeEmbalagens,
      unidade_compra: it.unidadeCompra,
      valor_unitario: it.valorUnitario,
      valor_total: it.valorTotal,
      custo_medio: null,
      calcula_cmv: it.calculaCmv
    }))
    if (itensParaSalvar.length) {
      const { error: erroItens } = await supabase.from('notas_importadas_itens').insert(itensParaSalvar)
      if (erroItens) throw erroItens
    }

    itensSalvos += itensParaSalvar.length
    semCorrespondencia += itensParaSalvar.filter((i) => !i.produto_id).length
    foraDoCMV += itensParaSalvar.filter((i) => !i.calcula_cmv).length
    const feito = notasSalvas + notasAtualizadas
    onProgresso?.({ feito, total: notas.length })
    if (feito % 20 === 0) await new Promise((r) => setTimeout(r, 0))
  }

  return { notas: notasSalvas, notasAtualizadas, itens: itensSalvos, semCorrespondencia, foraDoSubgrupo, foraDoCMV, linhasIgnoradas }
}

// ---------- Importar Vendas (relatório "Vendas Integração PDV" do Everest — formato novo,
// tabular limpo, 1 linha por venda, 28 colunas, data por linha) ----------
const VENDA_COL = {
  DATA: 0, EMPRESA: 1, FANTASIA: 2, CODIGO: 6, DESCRICAO: 7,
  GRUPO_GRANDE: 8, GRUPO: 9, SUBGRUPO: 10, Q_ITEM: 12, V_UNITARIO: 13, V_TOTAL: 14,
  CANCELADO: 18, V_LIQUIDO: 23, CONTA: 24
}

// Valores que o Everest usa pra marcar uma venda cancelada — 10/08/2026: alargado além de "sim"
// puro (o Felipe reportou faturamento de julho aparentando alto demais; se o export gravar
// "Sim"/"S"/"Cancelado"/"X" em vez do exato "sim" que o código só reconhecia, a venda cancelada
// entrava no total sem avisar). Continua sendo um match exato contra uma lista de marcadores
// afirmativos — nunca "qualquer texto não-vazio" — pra não arriscar marcar uma venda válida como
// cancelada por engano.
const MARCADORES_CANCELADO = new Set(['sim', 's', 'x', 'true', '1', 'cancelado', 'cancelada'])
function vendaEstaCancelada(valorBruto) {
  return MARCADORES_CANCELADO.has(String(valorBruto || '').trim().toLowerCase())
}

export async function importarVendasEverest(nomeArquivo, linhasBrutas) {
  if (!linhasBrutas.length) return { itens: 0, semCorrespondencia: 0, linhasIgnoradas: 0 }

  const cabecalho = linhasBrutas[0]
  const resto = linhasBrutas.slice(1)
  const norm = (s) => String(s || '').trim().toLowerCase()
  if (norm(cabecalho?.[VENDA_COL.DATA]) !== 'd. movimento' || norm(cabecalho?.[VENDA_COL.CODIGO]) !== 'item') {
    throw new Error('Não reconheci o layout dessa planilha de vendas — confere se é o export "Vendas Integração PDV" do Everest.')
  }

  const itens = []
  let linhasIgnoradas = 0
  for (const linha of resto) {
    const codigo = String(linha[VENDA_COL.CODIGO] ?? '').trim()
    const dataBruta = linha[VENDA_COL.DATA]
    const dataMovimento = dataBruta instanceof Date ? dataBruta.toISOString().slice(0, 10) : null
    // Rodapé do relatório (linha de totais no fim) não tem código nem data válida — ignora.
    if (!codigo || !dataMovimento) { linhasIgnoradas += 1; continue }

    const grupo = [linha[VENDA_COL.GRUPO_GRANDE], linha[VENDA_COL.GRUPO], linha[VENDA_COL.SUBGRUPO]]
      .map((v) => String(v ?? '').trim()).filter(Boolean).join(' / ') || null

    itens.push({
      dataMovimento,
      fantasia: String(linha[VENDA_COL.FANTASIA] ?? '').trim() || null,
      codigo,
      nome: String(linha[VENDA_COL.DESCRICAO] ?? '').trim(),
      grupo,
      quantidade: Number(linha[VENDA_COL.Q_ITEM]) || 0,
      valorTotal: Number(linha[VENDA_COL.V_TOTAL]) || 0,
      // 12/08/2026: valor_unitario (preço de tabela do item, sem desconto) — passa a ser a base do
      // cálculo de faturamento (`valorVenda`, ver comentário lá). valor_liquido continua sendo
      // guardado (não se apaga dado), só deixou de ser usado no cálculo.
      valorUnitario: linha[VENDA_COL.V_UNITARIO] != null ? Number(linha[VENDA_COL.V_UNITARIO]) : null,
      valorLiquido: linha[VENDA_COL.V_LIQUIDO] != null ? Number(linha[VENDA_COL.V_LIQUIDO]) : null,
      cancelado: vendaEstaCancelada(linha[VENDA_COL.CANCELADO]),
      conta: linha[VENDA_COL.CONTA] != null ? String(linha[VENDA_COL.CONTA]) : null
    })
  }

  // Vincula por código Everest — exato, sem fuzzy.
  const codigosUnicos = [...new Set(itens.map((it) => it.codigo).filter(Boolean))]
  const idPorCodigo = new Map()
  const tamanhoLoteBusca = 300
  for (let i = 0; i < codigosUnicos.length; i += tamanhoLoteBusca) {
    const lote = codigosUnicos.slice(i, i + tamanhoLoteBusca)
    const { data, error } = await supabase.from('produtos').select('id, codigo_everest').in('codigo_everest', lote)
    if (error) throw error
    for (const p of data) idPorCodigo.set(p.codigo_everest, p.id)
  }

  const datas = itens.map((it) => it.dataMovimento).filter(Boolean).sort()
  const novoInicio = datas[0] || null
  const novoFim = datas[datas.length - 1] || null

  // 10/08/2026: proteção contra duplicar vendas — o Felipe reportou faturamento de julho parecendo
  // alto demais, e o import de vendas não tinha NENHUMA trava contra reimportar o mesmo período
  // (diferente de Compras, que já ignora nota repetida). Reimportar o mesmo arquivo (ou um período
  // que se sobrepõe) sempre substitui o que já existia nesse intervalo de datas, em vez de somar em
  // cima — mesmo espírito de "upsert" já usado em Produtos/Ficha Técnica. Isso corrige tanto o
  // import de agora quanto qualquer duplicata que já esteja na base hoje (basta reimportar).
  let lotesSubstituidos = 0
  let itensRemovidos = 0
  if (novoInicio && novoFim) {
    const { data: lotesExistentes, error: erroBusca } = await supabase
      .from('vendas_importadas')
      .select('id, nome_arquivo, data_inicio, data_fim')
      .lte('data_inicio', novoFim)
      .gte('data_fim', novoInicio)
    if (erroBusca) throw erroBusca
    if (lotesExistentes?.length) {
      const idsParaRemover = lotesExistentes.map((l) => l.id)
      const { count, error: erroConta } = await supabase
        .from('vendas_importadas_itens')
        .select('id', { count: 'exact', head: true })
        .in('venda_id', idsParaRemover)
      if (erroConta) throw erroConta
      itensRemovidos = count || 0
      // Apaga o(s) lote(s) antigo(s) cujo período se sobrepõe ao novo — cascata apaga os itens
      // (venda_id ... on delete cascade). Sem isso, reimportar o mesmo mês duas vezes soma o
      // faturamento em dobro sem avisar.
      const { error: erroDelete } = await supabase.from('vendas_importadas').delete().in('id', idsParaRemover)
      if (erroDelete) throw erroDelete
      lotesSubstituidos = lotesExistentes.length
    }
  }

  const { data: vendaSalva, error: erroVenda } = await supabase
    .from('vendas_importadas')
    // loja/turno não existem mais nesse formato (o arquivo mistura DOM+Dalva e o período todo
    // de uma vez) — quem manda agora é data_movimento por item, guardado abaixo.
    .insert({ loja: null, turno: null, data_inicio: novoInicio, data_fim: novoFim, nome_arquivo: nomeArquivo })
    .select()
    .single()
  if (erroVenda) throw erroVenda

  const itensParaSalvar = itens.map((it) => ({
    venda_id: vendaSalva.id,
    produto_id: idPorCodigo.get(it.codigo) || null,
    codigo_everest: it.codigo,
    nome_original: it.nome,
    grupo_venda: it.grupo,
    fantasia: it.fantasia,
    quantidade: it.quantidade,
    valor_total: it.valorTotal,
    valor_unitario: it.valorUnitario,
    valor_liquido: it.valorLiquido,
    data_movimento: it.dataMovimento,
    cancelado: it.cancelado,
    numero_conta: it.conta
  }))

  const tamanhoLoteInsert = 400
  for (let i = 0; i < itensParaSalvar.length; i += tamanhoLoteInsert) {
    const { error } = await supabase.from('vendas_importadas_itens').insert(itensParaSalvar.slice(i, i + tamanhoLoteInsert))
    if (error) throw error
  }

  return {
    dataInicio: novoInicio,
    dataFim: novoFim,
    itens: itensParaSalvar.length,
    canceladas: itensParaSalvar.filter((i) => i.cancelado).length,
    semCorrespondencia: itensParaSalvar.filter((i) => !i.produto_id).length,
    linhasIgnoradas,
    lotesSubstituidos,
    itensRemovidos
  }
}

// ---------- Importar Fichas Técnicas (formato novo, tabular limpo, 26 colunas, cabeçalho na
// linha 1) ----------
// 1 linha por ingrediente; agrupa por "Item Ficha" (código do prato). Confirmado com o Felipe:
// as colunas Q.Produção/V.Custo Produção (24/25) variam linha a linha e, pra matéria-prima
// direta, duplicam Q.Baixa Estoque/V.Custo Unitário — a ficha já vem por 1 UNIDADE VENDIDA do
// prato (sem "lote" pra dividir), então não são usadas; em vez disso guardamos, por prato, o
// custo teórico somado dos ingredientes (ver custo_producao abaixo, agora "custo por 1 unidade").
const FICHA_COL = {
  FANTASIA: 1, PRATO_CODIGO: 2, PRATO_NOME: 3, PRATO_UM: 4, PRATO_TIPO: 6, PRATO_VERSAO: 8, PRATO_D_VERSAO: 9, PRATO_SITUACAO: 10,
  ING_CODIGO: 12, ING_NOME: 13, ING_UM: 14, ING_EMBALAGEM: 15, ING_TIPO: 16, ING_TIPO_BAIXA: 17,
  ING_APROVEITAMENTO: 18, ING_FATOR: 19, ING_Q_BAIXA: 20, ING_Q_UTILIZADA: 21, ING_CUSTO_MEDIO: 22, ING_CUSTO_UNIT: 23
}

// 10/08/2026, a pedido do Felipe: a coluna "Tipo de Baixa" (ING_TIPO_BAIXA) tem, entre outros
// valores, a palavra "Consumo" — e só essa linha deveria entrar na conta de custo do prato. Isso
// bate com o que já tinha sido investigado no §18/19 do doc de decisões: o export do Everest
// "achata" a cadeia de ficha técnica multi-nível pra dentro da mesma ficha, listando junto a linha
// do ingrediente direto e a do insumo de base por trás dele — se somar tudo sem filtrar, o mesmo
// custo entra 2x e o CMV fica artificialmente alto (o "muito alto" que o Felipe reportou).
function ehLinhaDeConsumo(tipoBaixa) {
  return String(tipoBaixa || '').trim().toLowerCase().includes('consumo')
}

// Mesmo filtro, reaproveitado por quem lê `fichas_tecnicas_ingredientes` já salvo (Consumo Teórico
// e Consumo Teórico × Venda) — se nenhuma linha da ficha estiver marcada "Consumo", não zera:
// volta pra lista inteira (comportamento antigo) em vez de sumir com o consumo dessa ficha.
function selecionarIngredientesDeConsumo(lista) {
  const deConsumo = lista.filter((ing) => ehLinhaDeConsumo(ing.tipo_baixa))
  return deConsumo.length ? deConsumo : lista
}

// 13/08/2026, pedido do Felipe: "DOM MN DEGUSTAÇÃO" é o prato mais vendido do grupo e o que mais
// pesa no CMV ponderado — enquanto a ficha dele não vier com o custo certo dos ingredientes (fica
// zerado quando nenhuma linha vem marcada "Consumo", ou os custos unitários chegam vazios do
// Everest), deixar o custo cair pra R$0 subestima o CMV real do grupo inteiro (o prato pesa muito
// no total). Trava em R$325,00 só nesse caso — no dia que a ficha subir com um custo > 0 de
// verdade, o travamento para de valer sozinho (a condição é "custo calculado = 0", nunca "sempre
// usa 325"). Pedido só pra essa ficha, pelo NOME (Felipe não passou o código Everest ainda — se
// mandar, troca pra casar por código, mais seguro que nome). Ver DECISOES-TRAVADAS.md §8.
const FICHAS_COM_CUSTO_TRAVADO = {
  'DOM MN DEGUSTACAO': 325
}

function normalizarNomeFicha(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()
}

// Centraliza "custo por unidade da ficha, com trava de fallback" — usado tanto no import (grava o
// valor já travado em `custo_producao`, efeito permanente) quanto em cada tela que lê
// `custo_producao` direto do banco (efeito imediato, sem esperar reimportação da Ficha Técnica).
//
// 14/08/2026 (4), pedido do Felipe: a trava só disparava quando a SOMA total dos ingredientes
// vinha exatamente 0 — mas uma ficha pode vir PARCIALMENTE preenchida (ex.: 2 de 3 ingredientes de
// Consumo com custo unitário zerado/vazio no Everest) e a soma parcial dá um número > 0 (ex.
// R$150) que passava batido pela trava, mesmo sendo um custo incompleto/subestimado. Agora recebe
// também `fichaIncompleta` (true = achou pelo menos 1 linha de Consumo com custo zerado/vazio
// nessa ficha) — se vier true, usa o valor travado mesmo com soma > 0. "Custo calculado = 0" e
// "ficha incompleta" viram os 2 gatilhos (qualquer um dos dois já ativa a trava).
function aplicarTravaDeCusto(nomeFicha, custoCalculado, fichaIncompleta = false) {
  const custo = Number(custoCalculado) || 0
  const travado = FICHAS_COM_CUSTO_TRAVADO[normalizarNomeFicha(nomeFicha)]
  if (travado == null) return custo
  if (custo <= 0 || fichaIncompleta) return travado
  return custo
}

// 14/08/2026 (4): descobre, só pras fichas que têm trava cadastrada (`FICHAS_COM_CUSTO_TRAVADO` —
// hoje só "DOM MN DEGUSTACAO"), se alguma linha de Consumo está com custo unitário zerado/vazio —
// sinal de ficha incompleta (import parcial, Everest não trouxe o valor daquele ingrediente). Usado
// pelas telas que leem `custo_producao` já salvo, pra pegar esse caso mesmo sem reimportar a Ficha
// Técnica. Calculado 1x (2 queries pequenas, só pra essa(s) ficha(s) nomeada(s)) e cacheado durante
// a sessão do navegador — se o Felipe reimportar Ficha Técnica e quiser ver o efeito imediato desse
// diagnóstico específico.
// 28/08/2026: este cache tinha a MESMA falha de `carregarFichasParaConversao` — e o comentário
// antigo aqui registrava isso como "limitação aceita: recarregue a página". Não é aceitável:
// significa mostrar número velho depois de um import bem-sucedido, sem avisar ninguém. Os dois
// passaram a ser limpos por `invalidarCacheFichas()`, chamada em todo caminho que escreve ou
// apaga fichas técnicas.
let _cacheFichasTravadasIncompletas = null
async function fichasTravadasIncompletas() {
  if (_cacheFichasTravadasIncompletas) return _cacheFichasTravadasIncompletas
  const resultado = new Set() // nomes normalizados com pelo menos 1 linha de Consumo com custo zerado/vazio
  const nomesTravados = Object.keys(FICHAS_COM_CUSTO_TRAVADO)
  if (nomesTravados.length) {
    const { data: fichas } = await supabase.from('fichas_tecnicas').select('id, nome')
    const fichasTravadas = (fichas || []).filter((f) => nomesTravados.includes(normalizarNomeFicha(f.nome)))
    const idsTravados = fichasTravadas.map((f) => f.id)
    if (idsTravados.length) {
      const nomePorId = new Map(fichasTravadas.map((f) => [f.id, normalizarNomeFicha(f.nome)]))
      const { data: ings } = await supabase.from('fichas_tecnicas_ingredientes')
        .select('ficha_id, custo_unitario, tipo_baixa')
        .in('ficha_id', idsTravados)
      const porFicha = new Map()
      for (const ing of (ings || [])) {
        if (!porFicha.has(ing.ficha_id)) porFicha.set(ing.ficha_id, [])
        porFicha.get(ing.ficha_id).push(ing)
      }
      for (const [fichaId, linhas] of porFicha) {
        const consumo = selecionarIngredientesDeConsumo(linhas)
        const temZerada = consumo.some((l) => !(Number(l.custo_unitario) > 0))
        if (temZerada) resultado.add(nomePorId.get(fichaId))
      }
    }
  }
  _cacheFichasTravadasIncompletas = resultado
  return resultado
}

export async function importarFichasTecnicas(linhasBrutas, onProgresso) {
  if (!linhasBrutas.length) return { fichas: 0, ingredientes: 0, semCorrespondencia: 0, linhasIgnoradas: 0 }

  const cabecalho = linhasBrutas[0]
  const resto = linhasBrutas.slice(1)
  const norm = (s) => String(s || '').trim().toLowerCase()
  if (norm(cabecalho?.[FICHA_COL.PRATO_CODIGO]) !== 'item ficha' || norm(cabecalho?.[FICHA_COL.ING_CODIGO]) !== 'item componente') {
    throw new Error('Não reconheci o layout dessa planilha de ficha técnica — confere se é o export "Ficha Técnica de Produto" do Everest.')
  }

  const pratosMap = new Map()
  let linhasIgnoradas = 0

  for (let i = 0; i < resto.length; i++) {
    const linha = resto[i]
    const codigoPrato = String(linha[FICHA_COL.PRATO_CODIGO] ?? '').trim()
    const codigoIng = String(linha[FICHA_COL.ING_CODIGO] ?? '').trim()
    if (!codigoPrato || !codigoIng) { linhasIgnoradas += 1; continue } // linha em branco/rodapé

    if (!pratosMap.has(codigoPrato)) {
      const dVersaoBruta = linha[FICHA_COL.PRATO_D_VERSAO]
      pratosMap.set(codigoPrato, {
        codigo: codigoPrato,
        nome: String(linha[FICHA_COL.PRATO_NOME] ?? '').trim() || null,
        fantasia: String(linha[FICHA_COL.FANTASIA] ?? '').trim() || null,
        unidadeMedida: String(linha[FICHA_COL.PRATO_UM] ?? '').trim().toLowerCase() || null,
        tipoItem: String(linha[FICHA_COL.PRATO_TIPO] ?? '').trim() || null,
        situacao: String(linha[FICHA_COL.PRATO_SITUACAO] ?? '').trim() || null,
        versao: linha[FICHA_COL.PRATO_VERSAO] != null ? String(linha[FICHA_COL.PRATO_VERSAO]) : null,
        dataVersao: dVersaoBruta instanceof Date ? dVersaoBruta.toISOString().slice(0, 10) : null,
        ingredientes: []
      })
    }

    // 24/08/2026, achado do Felipe ("as fichas técnicas estão triplicando ou até mais os itens"):
    // guardo a versão/data-versão DESSA LINHA (não só a do cabeçalho da ficha) — usada abaixo, após
    // o loop, pra filtrar ingrediente repetido quando o relatório do Everest traz mais de uma
    // versão da mesma ficha na mesma exportação (ver `removerIngredientesDuplicados`).
    const dVersaoLinhaBruta = linha[FICHA_COL.PRATO_D_VERSAO]
    pratosMap.get(codigoPrato).ingredientes.push({
      codigo: codigoIng,
      nome: String(linha[FICHA_COL.ING_NOME] ?? '').trim() || null,
      unidadeMedida: String(linha[FICHA_COL.ING_UM] ?? '').trim().toLowerCase() || null,
      embalagem: String(linha[FICHA_COL.ING_EMBALAGEM] ?? '').trim() || null,
      tipoItem: String(linha[FICHA_COL.ING_TIPO] ?? '').trim() || null,
      tipoBaixa: String(linha[FICHA_COL.ING_TIPO_BAIXA] ?? '').trim() || null,
      percentualAproveitamento: linha[FICHA_COL.ING_APROVEITAMENTO] != null ? Number(linha[FICHA_COL.ING_APROVEITAMENTO]) : null,
      fatorAplicacao: linha[FICHA_COL.ING_FATOR] != null ? Number(linha[FICHA_COL.ING_FATOR]) : null,
      quantidadeBaixaEstoque: Number(linha[FICHA_COL.ING_Q_BAIXA]) || 0,
      quantidadeAplicada: Number(linha[FICHA_COL.ING_Q_UTILIZADA]) || 0,
      custoMedio: linha[FICHA_COL.ING_CUSTO_MEDIO] != null ? Number(linha[FICHA_COL.ING_CUSTO_MEDIO]) : null,
      custoUnitario: linha[FICHA_COL.ING_CUSTO_UNIT] != null ? Number(linha[FICHA_COL.ING_CUSTO_UNIT]) : null,
      _versaoLinha: linha[FICHA_COL.PRATO_VERSAO] != null ? String(linha[FICHA_COL.PRATO_VERSAO]) : '',
      _dataVersaoLinha: dVersaoLinhaBruta instanceof Date ? dVersaoLinhaBruta.toISOString().slice(0, 10) : ''
    })

    if (i % 500 === 0) await new Promise((r) => setTimeout(r, 0))
    onProgresso?.({ feito: i + 1, total: resto.length })
  }

  // 24/08/2026 — corrige o achado do Felipe: reimportar a Ficha Técnica (mesmo no mesmo dia,
  // repetidas vezes) estava fazendo os ingredientes de uma ficha aparecerem 2-4x na tela (ex.:
  // "PP FILET MIGNON LIMPEZA" repetido 3x com o MESMO valor dentro da ficha "DD PR ALIGOT COM
  // FILET"). O import já apagava os ingredientes antigos antes de inserir os novos (linha ~1196,
  // `delete().eq('ficha_id', ...)` antes do insert) — reimportar sozinho não deveria acumular.
  // A causa real: o relatório "Ficha Técnica de Produto" do Everest pode trazer, dentro de UM
  // MESMO arquivo, mais de uma VERSÃO da mesma ficha (ex.: a ficha foi revisada no Everest e o
  // export ainda inclui as linhas da versão antiga junto com a nova) — o código anterior juntava
  // as linhas de TODAS as versões no mesmo prato, duplicando o ingrediente. Correção em 2 camadas,
  // por ficha:
  //  1) Duplicata EXATA (mesmo código de ingrediente + mesmos números/tipo de baixa) — colapsa pra
  //     1 linha só. Cobre o caso da mesma linha repetida ao pé da letra.
  //  2) Quando sobra mais de 1 linha pro MESMO código de ingrediente com valores DIFERENTES (ex.:
  //     % aproveitamento mudou entre versões) e as linhas têm data/versão diferentes — mantém só
  //     as linhas da versão MAIS RECENTE (maior data; se a data faltar/empatar, maior número de
  //     versão). Isso preserva o caso legítimo já documentado (§19.1): o mesmo ingrediente
  //     aparecendo 2x com custo diferente por ser de empresas diferentes (D.O.M./Dalva) DENTRO DA
  //     MESMA versão — só corta quando dá pra identificar uma versão mais nova de verdade.
  let fichasComDuplicataRemovida = 0
  let ingredientesDuplicadosRemovidos = 0
  // §46: fichas que vieram no arquivo sem nenhuma linha de ingrediente. Ficam listadas pro Felipe
  // ver na tela — antes elas passavam batido e zeravam a ficha no banco.
  const fichasSemIngredientes = []
  for (const f of pratosMap.values()) {
    const totalAntes = f.ingredientes.length
    // Camada 1 — duplicata exata.
    const vistos = new Set()
    let semExatas = f.ingredientes.filter((ing) => {
      const chave = [ing.codigo, ing.quantidadeBaixaEstoque, ing.quantidadeAplicada, ing.fatorAplicacao, ing.percentualAproveitamento, ing.custoUnitario, ing.custoMedio, ing.tipoBaixa].join('|')
      if (vistos.has(chave)) return false
      vistos.add(chave)
      return true
    })
    // Camada 2 — mesmo código de ingrediente, valores diferentes, mas dá pra saber qual versão é
    // mais nova (data ou nº de versão) → mantém só a mais recente por código.
    const porCodigo = new Map()
    for (const ing of semExatas) {
      if (!porCodigo.has(ing.codigo)) porCodigo.set(ing.codigo, [])
      porCodigo.get(ing.codigo).push(ing)
    }
    const resultado = []
    for (const linhas of porCodigo.values()) {
      if (linhas.length <= 1) { resultado.push(...linhas); continue }
      const temInfoDeVersao = linhas.some((l) => l._dataVersaoLinha || l._versaoLinha)
      if (!temInfoDeVersao) { resultado.push(...linhas); continue } // sem como distinguir — não arrisca cortar dado legítimo (ex. custo por empresa)
      const maisRecente = linhas.slice().sort((a, b) => {
        if (a._dataVersaoLinha !== b._dataVersaoLinha) return a._dataVersaoLinha < b._dataVersaoLinha ? 1 : -1
        return (Number(b._versaoLinha) || 0) - (Number(a._versaoLinha) || 0)
      })[0]
      const versaoEscolhida = maisRecente._dataVersaoLinha + '|' + maisRecente._versaoLinha
      resultado.push(...linhas.filter((l) => (l._dataVersaoLinha + '|' + l._versaoLinha) === versaoEscolhida))
    }
    f.ingredientes = resultado.map(({ _versaoLinha, _dataVersaoLinha, ...resto }) => resto)
    if (f.ingredientes.length < totalAntes) {
      fichasComDuplicataRemovida += 1
      ingredientesDuplicadosRemovidos += totalAntes - f.ingredientes.length
    }
  }

  const fichas = Array.from(pratosMap.values())

  // Vincula por código Everest — exato.
  const todosOsCodigos = new Set()
  for (const f of fichas) {
    if (f.codigo) todosOsCodigos.add(f.codigo)
    for (const ing of f.ingredientes) if (ing.codigo) todosOsCodigos.add(ing.codigo)
  }
  const idPorCodigo = new Map()
  const codigosArray = Array.from(todosOsCodigos)
  const tamanhoLoteBusca = 300
  for (let i = 0; i < codigosArray.length; i += tamanhoLoteBusca) {
    const lote = codigosArray.slice(i, i + tamanhoLoteBusca)
    const { data, error } = await supabase.from('produtos').select('id, codigo_everest').in('codigo_everest', lote)
    if (error) throw error
    for (const p of data) idPorCodigo.set(p.codigo_everest, p.id)
  }

  let fichasSalvas = 0
  let ingredientesSalvos = 0
  let semCorrespondencia = 0
  let fichasSemLinhaConsumo = 0
  let historicoIndisponivel = false

  // Antes de tocar no banco: o que estiver em memória já está obsoleto a partir daqui. Limpo
  // no início E no fim — se o import falhar no meio, o cache também não pode continuar valendo,
  // porque parte das fichas já foi gravada.
  invalidarCacheFichas()

  for (const f of fichas) {
    // custo_producao agora representa o custo TEÓRICO de 1 unidade do prato (soma do custo
    // unitário de cada ingrediente); quantidade_producao fica fixo em 1 — mantém compatível
    // com as telas que já fazem custo_producao ÷ quantidade_producao (Margem, CMV Ponderado,
    // CMV Semanal) sem precisar tocar nelas.
    // 10/08/2026: só soma as linhas marcadas "Consumo" em Tipo de Baixa (ver ehLinhaDeConsumo
    // acima) — as demais são desmontagens redundantes do mesmo insumo (achatamento do Everest) e
    // somar todas duplicava o custo. Se NENHUMA linha da ficha vier marcada "Consumo" (planilha
    // sem essa informação, ou nomenclatura diferente da esperada), não zera o custo em silêncio —
    // cai pro comportamento antigo (soma tudo) e sinaliza a ficha como gap pra revisão manual.
    // 12/08/2026: cheguei a mudar essa soma pra multiplicar por quantidade (pensando que
    // `custoUnitario` fosse sempre "preço por kg/lt/un"), mas o Felipe confirmou que o número de
    // ANTES (só a soma de `custoUnitario`, sem multiplicar) é o que bate com o custo real do
    // prato — revertido. `custo_unitario`/"V. Custo Unitário" nas linhas de Consumo da ficha já
    // vem do Everest como a contribuição de custo daquele ingrediente pra 1 unidade do prato,
    // não como preço por unidade de medida — por isso NÃO se multiplica por quantidade aqui.
    const ingredientesDeConsumo = f.ingredientes.filter((ing) => ehLinhaDeConsumo(ing.tipoBaixa))
    const semLinhaConsumo = ingredientesDeConsumo.length === 0 && f.ingredientes.length > 0
    if (semLinhaConsumo) fichasSemLinhaConsumo += 1
    const baseDeCusto = semLinhaConsumo ? f.ingredientes : ingredientesDeConsumo
    // Trava de custo (ver `aplicarTravaDeCusto` acima) — entra em ação se a soma dos ingredientes
    // vier 0 OU se algum ingrediente de Consumo vier com custo unitário zerado/vazio (ficha
    // incompleta — 14/08/2026 (4), pedido do Felipe: "sempre que tiver algum valor zerado na
    // ficha desse item, considerar 325", não só quando a soma total dá 0).
    const temIngredienteZerado = baseDeCusto.some((ing) => !(Number(ing.custoUnitario) > 0))
    const custoTeoricoUnidade = aplicarTravaDeCusto(f.nome, baseDeCusto.reduce((acc, ing) => acc + (Number(ing.custoUnitario) || 0), 0), temIngredienteZerado)

    const { data: fichaSalva, error: erroFicha } = await supabase
      .from('fichas_tecnicas')
      .upsert({
        codigo_everest: f.codigo,
        produto_id: idPorCodigo.get(f.codigo) || null,
        nome: f.nome,
        unidade_medida: f.unidadeMedida,
        tipo_item: f.tipoItem,
        situacao: f.situacao,
        fantasia: f.fantasia,
        versao: f.versao,
        data_versao: f.dataVersao,
        quantidade_producao: 1,
        custo_producao: custoTeoricoUnidade,
        atualizado_em: new Date().toISOString()
      }, { onConflict: 'codigo_everest' })
      .select()
      .single()
    if (erroFicha) throw erroFicha

    // 28/08/2026 (§46) — BUG CORRIGIDO. O `delete` rodava SEMPRE e o `insert` só acontecia se
    // houvesse linhas: uma ficha que chegasse ao import sem nenhum ingrediente APAGAVA os
    // ingredientes que já existiam e deixava a ficha vazia, sem avisar. Foi assim que o
    // "DD PR EXEC CARNE" (1826) ficou com "ficha: sim, 0 linhas" no banco — a ficha existe, não
    // resolve para insumo nenhum, e sumiu do consumo teórico levando 42 vendas junto (7,861 kg de
    // filet numa única semana). Ninguém tinha como perceber: a tela de importação dizia sucesso.
    //
    // Agora, ficha sem ingrediente NÃO apaga o que já está gravado — é contabilizada e reportada.
    // Substituir dado bom por nada nunca é o comportamento certo; na dúvida, preserva.
    const ingredientesParaSalvar = f.ingredientes.map((ing) => ({
      ficha_id: fichaSalva.id,
      produto_id: idPorCodigo.get(ing.codigo) || null,
      codigo_everest: ing.codigo,
      nome: ing.nome,
      unidade_medida: ing.unidadeMedida,
      embalagem: ing.embalagem,
      tipo_item: ing.tipoItem,
      quantidade_aplicada: ing.quantidadeAplicada,
      percentual_aproveitamento: ing.percentualAproveitamento,
      fator_aplicacao: ing.fatorAplicacao,
      quantidade_baixa_estoque: ing.quantidadeBaixaEstoque,
      custo_medio: ing.custoMedio,
      custo_unitario: ing.custoUnitario,
      tipo_baixa: ing.tipoBaixa
    }))
    if (ingredientesParaSalvar.length) {
      // Só apaga quando há algo novo pra colocar no lugar.
      await supabase.from('fichas_tecnicas_ingredientes').delete().eq('ficha_id', fichaSalva.id)
      const { error: erroIng } = await supabase.from('fichas_tecnicas_ingredientes').insert(ingredientesParaSalvar)
      if (erroIng) throw erroIng
    } else {
      fichasSemIngredientes.push(`${f.codigo} — ${f.nome || 'sem nome'}`)
    }

    // 10/08/2026, pedido do Felipe ("queremos ter o histórico do preço das FT no tempo"): cada
    // import grava um retrato do custo dessa ficha nesse momento, numa tabela separada que só
    // acumula (nunca é sobrescrita) — diferente de `fichas_tecnicas`, que sempre reflete só o
    // custo ATUAL. Depende de `migration_v7.sql` já ter sido rodada no Supabase; se ainda não foi,
    // ignora silenciosamente (erro 42P01 = tabela não existe) sem travar o import de verdade — o
    // que importa (ficha + ingredientes) já foi salvo acima.
    const { error: erroHistorico } = await supabase.from('fichas_tecnicas_historico').insert({
      ficha_id: fichaSalva.id,
      codigo_everest: f.codigo,
      nome: f.nome,
      custo_producao: custoTeoricoUnidade
    })
    if (erroHistorico) historicoIndisponivel = true

    fichasSalvas += 1
    ingredientesSalvos += ingredientesParaSalvar.length
    semCorrespondencia += ingredientesParaSalvar.filter((ing) => !ing.produto_id).length
    if (!idPorCodigo.get(f.codigo)) semCorrespondencia += 1
  }

  // De novo no fim: agora o banco tem as fichas novas, e a próxima tela que pedir conversão
  // precisa reler do zero em vez de reaproveitar o que ficou em memória durante o import.
  invalidarCacheFichas()

  return { fichas: fichasSalvas, ingredientes: ingredientesSalvos, semCorrespondencia, linhasIgnoradas, fichasSemLinhaConsumo, historicoIndisponivel, fichasComDuplicataRemovida, ingredientesDuplicadosRemovidos, fichasSemIngredientes }
}

// 10/08/2026, pedido do Felipe (aba "Importar dados" → Ficha técnica): resumo de todas as fichas
// já importadas, agrupado por ficha — clicando numa ficha mostra os insumos que compõem ela e o
// custo de cada um. `custoTotal` já é o mesmo `custo_producao` calculado no import (linhas de
// "Consumo" já filtradas — ver ehLinhaDeConsumo); os ingredientes vêm todos (inclui os fora do
// filtro, marcados com `foraDoCalculo`), pra transparência de quem quer auditar a ficha.
export async function buscarResumoFichasTecnicas() {
  // 24/08/2026 — corrigido o mesmo bug de sempre (§10/§22.1/§23): a lista de fichas cresce (hoje
  // ~600 entre DOM+Dalva, ver §16.1) e `.in('ficha_id', idsFichas)` COM A LISTA INTEIRA de uma vez
  // estoura o limite de URL do PostgREST — o Felipe reportou "as fichas não estão aparecendo", que
  // é exatamente o sintoma (a consulta falha e a tela cai pro "erro"/lista vazia, mesma classe do
  // bug corrigido na Exportação Contábil). Também troquei a 1ª consulta (lista de fichas em si) pra
  // `buscarTodasAsLinhas` — sem paginação de linhas, uma base acima de 1000 fichas devolveria só as
  // 1000 primeiras em silêncio (limite padrão do PostgREST), mesmo sem dar erro nenhum.
  const fichas = await buscarTodasAsLinhas(() =>
    supabase.from('fichas_tecnicas')
      .select('id, codigo_everest, nome, fantasia, situacao, custo_producao, atualizado_em')
      .order('nome')
  )
  if (!fichas.length) return []

  const idsFichas = fichas.map((f) => f.id)
  const ingredientesPorFicha = new Map()
  for (let i = 0; i < idsFichas.length; i += 300) {
    const lote = idsFichas.slice(i, i + 300)
    const ingredientesDoLote = await buscarTodasAsLinhas(() =>
      supabase.from('fichas_tecnicas_ingredientes')
        .select('ficha_id, nome, custo_unitario, custo_medio, tipo_baixa')
        .in('ficha_id', lote)
    )
    for (const ing of ingredientesDoLote) {
      if (!ingredientesPorFicha.has(ing.ficha_id)) ingredientesPorFicha.set(ing.ficha_id, [])
      ingredientesPorFicha.get(ing.ficha_id).push(ing)
    }
  }

  return fichas.map((f) => {
    const todos = ingredientesPorFicha.get(f.id) || []
    return {
      id: f.id,
      codigo: f.codigo_everest,
      nome: f.nome || f.codigo_everest,
      fantasia: f.fantasia,
      situacao: f.situacao,
      custoTotal: Math.round((Number(f.custo_producao) || 0) * 100) / 100,
      atualizadoEm: f.atualizado_em,
      ingredientes: todos
        .map((ing) => ({
          nome: ing.nome,
          custo: Math.round(((Number(ing.custo_unitario) || Number(ing.custo_medio) || 0)) * 100) / 100,
          foraDoCalculo: !ehLinhaDeConsumo(ing.tipo_baixa) && todos.some((o) => ehLinhaDeConsumo(o.tipo_baixa))
        }))
        .sort((a, b) => b.custo - a.custo)
    }
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

// 10/08/2026, pedido do Felipe (Base de dados → Histórico Ficha Técnica): busca de fichas pra
// abrir o histórico de preço de uma delas. Lista vem do cadastro atual (`fichas_tecnicas`), não da
// tabela de histórico — a busca em si não depende da migration_v7 ter rodado.
export async function buscarFichasParaHistorico(termo) {
  let query = supabase.from('fichas_tecnicas').select('id, codigo_everest, nome, custo_producao').order('nome')
  if (termo?.trim()) query = query.ilike('nome', `%${termo.trim()}%`)
  const { data, error } = await query
  if (error) throw error
  return data
}

// 12/08/2026, correção pedida pelo Felipe: a versão anterior desta função lia
// `fichas_tecnicas_historico` — um retrato do custo tirado a cada REIMPORTAÇÃO da Ficha Técnica
// (§29.5/migration_v7). O Felipe apontou que a data que importa não é essa: "o que importa para
// mim é o mês que foi comprado o item" — ex. AGUA: Jan 2,50 / Fev 2,60 / Mar 2,60 (repete o
// último preço se não houver compra em março). Reescrita pra calcular a linha do tempo a partir
// das COMPRAS reais de cada insumo da ficha (`notas_importadas_itens`), não mais das reimportações
// da Ficha Técnica:
// - Pra cada insumo de "consumo" da ficha (mesmo filtro do §29.4 — `selecionarIngredientesDeConsumo`;
//   ficha sem ingrediente nenhum cai no fallback de se tratar como o próprio código da ficha, caso
//   de item de revenda direta sem receita de verdade, ex. água vendida como ela mesma), busca todas
//   as compras desse insumo em `notas_importadas_itens`, casando pelo `codigo_everest` GRAVADO NA
//   COMPRA (coluna nova, `migration_v9.sql`) — não pelo `produto_id`, que sofre da mesma FK órfã já
//   documentada no §5/§29.10/§29.13 (se `produtos` for zerado/reimportado depois da compra, o id
//   antigo fica sem dono).
// - Pra cada mês, usa o preço da ÚLTIMA compra daquele insumo dentro do mês (pedido explícito do
//   Felipe — não é média do mês, é o preço mais recente dentro dele).
// - Mês sem compra desse insumo REPETE o último preço conhecido (forward-fill, pedido explícito do
//   Felipe) — nunca zera, nunca pula.
// - Ficha com mais de 1 insumo: custo do mês = soma de (preço do insumo naquele mês × quantidade
//   usada na ficha), com cada insumo repetindo seu próprio último preço de forma independente. Se
//   ALGUM insumo ainda não teve nenhuma compra registrada até aquele mês (preço genuinamente
//   desconhecido, não "esqueceram de comprar"), o mês fica marcado `incompleto: true` em vez de
//   contar esse insumo como custo zero — mesmo princípio de "não calcular no escuro" do §5.
// Depende de `notas_importadas_itens.codigo_everest` existir (`migration_v9.sql`) — se a coluna
// ainda não existir (erro 42703), devolve `indisponivel: true` com mensagem clara, em vez de
// quebrar a tela.
export async function buscarHistoricoDeFicha(fichaId) {
  const { data: ficha, error: erroFicha } = await supabase
    .from('fichas_tecnicas')
    .select('id, codigo_everest')
    .eq('id', fichaId)
    .maybeSingle()
  if (erroFicha) throw erroFicha
  if (!ficha) return { indisponivel: false, linhas: [], semPreco: [] }

  const { data: ingredientesRaw, error: erroIng } = await supabase
    .from('fichas_tecnicas_ingredientes')
    .select('codigo_everest, nome, quantidade_baixa_estoque, quantidade_aplicada, tipo_baixa')
    .eq('ficha_id', fichaId)
  if (erroIng) throw erroIng

  const consumo = selecionarIngredientesDeConsumo(ingredientesRaw || [])

  // 25/08/2026 — BUG CORRIGIDO (ver DECISOES-TRAVADAS.md §29). Antes, esta função procurava preço
  // de compra para o código de CADA INGREDIENTE DIRETO da ficha. Só que num prato o ingrediente
  // direto costuma ser um PREPARO (ex. "PP Filet Mignon Medalhão Porcionado") — e preparo NUNCA é
  // comprado, não existe em `notas_importadas_itens`. Resultado: o insumo caro (a carne) não achava
  // preço nenhum e caía no `incompleto`, enquanto os poucos ingredientes em natura baratos (sal,
  // manteiga) eram os únicos somados. Daí o absurdo de "EV PR Filet Mignon com Aligot" aparecer
  // custando R$ 0,12/mês, com todo mês marcado "(parcial)", enquanto a própria ficha diz R$ 29,18.
  //
  // Correção: cada ingrediente que tem ficha própria é resolvido pelo motor já existente
  // (`buscarInsumosEmNatura`, §19.2) até o insumo em natura de verdade — o que é comprado e tem
  // preço. A quantidade é multiplicada ao longo do caminho (qtd do ingrediente na ficha × qtd do
  // insumo por unidade do ingrediente). Ingrediente que já é folha continua entrando direto.
  const itensParaRastrear = []
  if (consumo.length) {
    for (const ing of consumo) {
      const codigo = ing.codigo_everest
      if (!codigo) continue
      const quantidade = Number(ing.quantidade_baixa_estoque) || Number(ing.quantidade_aplicada) || 0
      const folhas = await buscarInsumosEmNatura(codigo)
      if (folhas === null) {
        // Sem ficha própria = já é insumo em natura (o caso comum: comprado direto).
        itensParaRastrear.push({ codigo, nome: ing.nome || codigo, quantidade, via: null })
      } else if (!folhas.length) {
        // Tem ficha, mas nenhuma folha identificável — gap real, não some como zero.
        itensParaRastrear.push({ codigo, nome: ing.nome || codigo, quantidade, via: null, semFolha: true })
      } else {
        for (const f of folhas) {
          itensParaRastrear.push({
            codigo: f.codigoEverest,
            nome: f.nome || f.codigoEverest,
            quantidade: quantidade * (Number(f.quantidadePorUnidade) || 0),
            via: ing.nome || codigo
          })
        }
      }
    }
  } else if (ficha.codigo_everest) {
    itensParaRastrear.push({ codigo: ficha.codigo_everest, nome: ficha.codigo_everest, quantidade: 1, via: null })
  }
  const codigosUnicos = [...new Set(itensParaRastrear.map((i) => i.codigo).filter(Boolean))]
  if (!codigosUnicos.length) return { indisponivel: false, linhas: [], semPreco: [] }

  const TAMANHO_LOTE = 300
  let compras = []
  for (let i = 0; i < codigosUnicos.length; i += TAMANHO_LOTE) {
    const lote = codigosUnicos.slice(i, i + TAMANHO_LOTE)
    const { data, error } = await supabase
      .from('notas_importadas_itens')
      .select('codigo_everest, valor_unitario, valor_total, quantidade, calcula_cmv, notas_importadas(data_emissao)')
      .in('codigo_everest', lote)
    if (error) {
      if (error.code === '42703') return { indisponivel: true, linhas: [] }
      throw error
    }
    compras.push(...(data || []))
  }
  compras = compras.filter((c) => c.calcula_cmv !== false && c.notas_importadas?.data_emissao)
  if (!compras.length) return { indisponivel: false, linhas: [], semPreco: itensParaRastrear.filter((i) => Number(i.quantidade) > 0).map((i) => ({ nome: i.nome, codigo: i.codigo, via: i.via, motivo: 'nenhuma compra desse insumo foi importada ainda' })) }

  // Preço unitário da compra — mesma prioridade já usada em outros lugares do app (ver §24.3):
  // `valor_unitario` (V. Unitário Convertido, já na unidade de estoque) com fallback pro cálculo
  // manual valor_total ÷ quantidade.
  function precoUnitario(c) {
    if (c.valor_unitario != null) return Number(c.valor_unitario)
    if (c.valor_total != null && c.quantidade) return Number(c.valor_total) / Number(c.quantidade)
    return null
  }

  // insumo → mês ('YYYY-MM') → { data, preco } da ÚLTIMA compra desse insumo dentro do mês.
  const ultimaCompraPorInsumoMes = new Map()
  for (const c of compras) {
    const preco = precoUnitario(c)
    if (preco == null) continue
    const data = c.notas_importadas.data_emissao
    const mes = String(data).slice(0, 7)
    if (!ultimaCompraPorInsumoMes.has(c.codigo_everest)) ultimaCompraPorInsumoMes.set(c.codigo_everest, new Map())
    const porMes = ultimaCompraPorInsumoMes.get(c.codigo_everest)
    const atual = porMes.get(mes)
    if (!atual || data > atual.data) porMes.set(mes, { data, preco })
  }

  const todosMeses = new Set()
  for (const porMes of ultimaCompraPorInsumoMes.values()) for (const mes of porMes.keys()) todosMeses.add(mes)
  if (!todosMeses.size) return { indisponivel: false, linhas: [], semPreco: itensParaRastrear.filter((i) => Number(i.quantidade) > 0).map((i) => ({ nome: i.nome, codigo: i.codigo, via: i.via, motivo: 'nenhuma compra desse insumo foi importada ainda' })) }

  // Eixo contínuo de meses, do 1º mês com QUALQUER compra de QUALQUER insumo da ficha até o mês
  // atual — sem eixo contínuo o "repete o último preço" não teria como funcionar (precisa saber
  // quais meses existem entre uma compra e outra, mesmo os sem nenhuma compra).
  const mesInicial = [...todosMeses].sort()[0]
  const hoje = new Date()
  const mesFinal = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
  const eixoMeses = []
  let [a, m] = mesInicial.split('-').map(Number)
  const [aFim, mFim] = mesFinal.split('-').map(Number)
  while (a < aFim || (a === aFim && m <= mFim)) {
    eixoMeses.push(`${a}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; a += 1 }
  }

  // 25/08/2026: além do flag "(parcial)", devolve QUAIS insumos nunca tiveram preço conhecido —
  // antes a tela só dizia "parcial" sem nunca revelar o que estava faltando, o que fazia um custo
  // de R$ 0,12 parecer um número calculado em vez de um número com 90% dos ingredientes de fora.
  const semPrecoNunca = new Set(itensParaRastrear.map((i) => i.codigo))
  const linhas = eixoMeses.map((mes) => {
    let custoTotal = 0
    let incompleto = false
    let temCompraNoMes = false
    for (const item of itensParaRastrear) {
      const porMes = ultimaCompraPorInsumoMes.get(item.codigo)
      if (porMes?.has(mes)) temCompraNoMes = true
      let precoConhecido = null
      if (porMes) {
        for (const m2 of eixoMeses) {
          if (m2 > mes) break
          if (porMes.has(m2)) precoConhecido = porMes.get(m2).preco
        }
      }
      if (precoConhecido == null) { incompleto = true; continue }
      semPrecoNunca.delete(item.codigo)
      custoTotal += precoConhecido * item.quantidade
    }
    return { mes, custo: Math.round(custoTotal * 100) / 100, incompleto, temCompraNoMes }
  })

  // 25/08/2026, pedido do Felipe ("se forem aqueles itens que não entram na ficha por causa do
  // consumo, não precisa mostrar"): só entra nesse aviso o insumo que de fato MUDARIA a conta.
  // Linha com quantidade 0 não soma nada mesmo tendo ou não preço — reportá-la só gera ruído. O que
  // sobra aqui é insumo com quantidade real na ficha que nunca teve nenhuma compra importada.
  const semPreco = itensParaRastrear
    .filter((i) => semPrecoNunca.has(i.codigo))
    .filter((i) => Number(i.quantidade) > 0)
    .map((i) => ({
      nome: i.nome,
      codigo: i.codigo,
      via: i.via,
      motivo: i.semFolha
        ? 'tem ficha própria, mas nenhum insumo em natura identificável nela'
        : 'nenhuma compra desse insumo foi importada ainda'
    }))

  return { indisponivel: false, linhas, semPreco }
}

// ---------- Análise de custo (curva de vendas, consumo teórico, CMV) ----------

// "Loja" pedida pelo Felipe: DD (Dalva), DOM (D.O.M.), RB (Resid Bar), EV (Eventos), MC
// (Mercadinho), DL (Delivery Dalva). Fantasia só distingue D.O.M./DALVA (2 valores) — as outras 4
// são setores dentro da Dalva, identificados pelo prefixo "XX - " que o Everest grava no campo
// Grupo (2º trecho do grupo_venda salvo, formato "Grande Grupo / Grupo / Subgrupo"). Confirmado
// nos dados: MC-/RB-/EV-/DL- só aparecem sob Empresa=2 (Dalva); quando não tem esses prefixos,
// cai no DD/DOM pela fantasia.
// 09/08/2026: DL (Delivery) já existia como prefixo nos dados mas não tinha loja própria — caía
// dentro de DD sem separar (Felipe pediu pra destrinchar Delivery como fonte de faturamento à parte).
export const LOJAS_VALIDAS = ['DD', 'DOM', 'RB', 'EV', 'MC', 'DL']
export const LOJAS_LABEL = { DD: 'DD - Dalva', DOM: 'DOM - D.O.M.', RB: 'RB - Resid Bar', EV: 'EV - Eventos', MC: 'MC - Mercadinho', DL: 'DL - Delivery Dalva' }

function lojaDeVenda(fantasia, grupoVenda) {
  const g = String(grupoVenda || '').toUpperCase()
  if (/\bMC\s*-/.test(g)) return 'MC'
  if (/\bRB\s*-/.test(g)) return 'RB'
  if (/\bEV\s*-/.test(g)) return 'EV'
  if (/\bDL\s*-/.test(g)) return 'DL'
  return /dalva/i.test(fantasia || '') ? 'DD' : 'DOM'
}

// O Everest grava o prefixo de loja ("MC - ", "RB - ", "EV - ", "DL - ") direto dentro do texto do
// Subgrupo pra algumas categorias — então a mesma categoria de verdade (ex. "EVENTOS E MENUS
// ESPECIAIS") aparece como várias linhas diferentes na tabela "Faturamento por grupo" (uma por
// loja: "EV - EVENTOS E MENUS ESPECIAIS", "RB - EVENTOS E MENUS ESPECIAIS" etc.), mesmo já
// existindo colunas por loja na própria tabela pra mostrar essa separação. Achado pelo Felipe
// (09/08/2026): "temos grupos parecidos, mas com a diferença de DL, MC, DD... podemos unir eles,
// e só deixar separado no faturamento por unidade?" — remove o prefixo antes de agrupar, já que
// a granularidade por loja continua 100% preservada nas colunas DOM/DD/MC/RB/EV/DL/Subtotal/Total.
function limparPrefixoLoja(texto) {
  return String(texto || '').replace(/^(DD|DOM|MC|RB|EV|DL)\s*-\s*/i, '').trim()
}

// Restrição de fundo (não é mais o filtro visível — ver buscarSubgruposDeVenda abaixo): Curva de
// Vendas / Consumo Teórico / CMV Ponderado só fazem sentido pra ALIMENTOS e BEBIDAS (exclui
// MATERIAIS/INSUMOS/VENDAS TERCEIROS, que não são pratos). grupo_venda é salvo como "Grande Grupo
// / Grupo / Subgrupo" — o 1º trecho é o Grande Grupo.
const GRANDES_GRUPOS_VALIDOS = ['ALIMENTOS', 'BEBIDAS']

function grandeGrupoDeVenda(grupoVenda) {
  return String(grupoVenda || '').split('/')[0].trim().toUpperCase()
}

// Filtro de "Grupo" pedido pelo Felipe: em vez de só Alimentos/Bebidas, ele quer escolher pelos
// mesmos subgrupos que aparecem na coluna Grupo da Curva de Vendas (ex. "AGUAS", "PRATOS
// PRINCIPAIS", "MENUS ESPECIAIS") — o último trecho de "Grande Grupo / Grupo / Subgrupo".
export function subgrupoDeVenda(grupoVenda) {
  if (!grupoVenda) return ''
  const partes = grupoVenda.split('/')
  return partes[partes.length - 1].trim()
}

export async function buscarSubgruposDeVenda() {
  const itens = await buscarTodasAsLinhas(() => supabase.from('vendas_importadas_itens').select('grupo_venda'))
  const set = new Set()
  for (const it of itens) {
    if (!GRANDES_GRUPOS_VALIDOS.includes(grandeGrupoDeVenda(it.grupo_venda))) continue
    const sub = subgrupoDeVenda(it.grupo_venda)
    if (sub) set.add(sub)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

// 12/08/2026, pedido do Felipe: os filtros de Loja e Grupo da Análise de Custo (Curva de
// Vendas/CMV Teórico/Consumo Teórico) mostravam sempre a lista INTEIRA (todas as 6 lojas, todos os
// subgrupos já vistos alguma vez) mesmo quando o período escolhido só tem venda de 2 lojas, ou
// quando a loja escolhida só tem 3 dos 10 subgrupos possíveis — mesma ideia que já existe em CMV
// Semanal (filtro de subgrupo do Everest só com o que aparece na consulta) e na Cobertura de Ficha
// Técnica (só lista loja com venda no período), agora replicada aqui: "condicionado com o que está
// aparecendo". Devolve só a loja/grupo que TEM pelo menos 1 venda válida (não cancelada, dentro de
// Alimentos/Bebidas) no período — e, pro grupo, dentro da loja já escolhida (se houver). Consulta
// enxuta (só as 3 colunas que importam pra essa conta), pensada pra rodar toda vez que o período ou
// a loja mudam, antes de clicar em "Buscar".
export async function buscarLojasEGruposDisponiveis(dataInicio, dataFim, loja = null) {
  const itens = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('fantasia, grupo_venda, cancelado')
      .gte('data_movimento', dataInicio).lte('data_movimento', dataFim)
  )
  const lojasComVenda = new Set()
  const gruposComVenda = new Set()
  for (const it of itens) {
    if (it.cancelado) continue
    if (!GRANDES_GRUPOS_VALIDOS.includes(grandeGrupoDeVenda(it.grupo_venda))) continue
    const lojaDoItem = lojaDeVenda(it.fantasia, it.grupo_venda)
    lojasComVenda.add(lojaDoItem)
    if (loja && lojaDoItem !== loja) continue
    const sub = subgrupoDeVenda(it.grupo_venda)
    if (sub) gruposComVenda.add(sub)
  }
  return {
    lojas: LOJAS_VALIDAS.filter((l) => lojasComVenda.has(l)),
    grupos: Array.from(gruposComVenda).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }
}

// 10/08/2026, pedido do Felipe (aba "Importar dados" → Vendas): resumo do que já foi importado —
// Ano → Mês, sempre excluindo cancelado (mesma regra de sempre). É o "ledger" de tudo que subiu,
// não a análise de CMV/curva — por isso NÃO filtra por Alimentos/Bebidas (materiais, insumos e
// revenda de terceiros também entram, é vendas bruta importada).
export async function buscarResumoVendasPorAnoMes() {
  const itens = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens').select('data_movimento, quantidade, valor_total, valor_unitario, cancelado').not('data_movimento', 'is', null)
  )
  const porAno = new Map()
  for (const it of itens) {
    if (it.cancelado) continue
    const ano = it.data_movimento.slice(0, 4)
    const mes = it.data_movimento.slice(5, 7)
    if (!porAno.has(ano)) porAno.set(ano, { ano, valor: 0, meses: new Map() })
    const a = porAno.get(ano)
    const valor = valorVenda(it)
    a.valor += valor
    if (!a.meses.has(mes)) a.meses.set(mes, { mes, valor: 0 })
    a.meses.get(mes).valor += valor
  }
  return Array.from(porAno.values())
    .map((a) => ({
      ano: a.ano,
      valor: Math.round(a.valor * 100) / 100,
      meses: Array.from(a.meses.values())
        .map((m) => ({ ...m, valor: Math.round(m.valor * 100) / 100 }))
        .sort((x, y) => y.mes.localeCompare(x.mes))
    }))
    .sort((a, b) => b.ano.localeCompare(a.ano))
}

// Detalhe Dia + Loja de um mês específico — carregado só quando o Felipe clica no mês (popup), não
// upfront junto do resumo Ano/Mês, pra não puxar toda a base de itens de uma vez.
export async function buscarDetalheVendasDoMes(ano, mes) {
  const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate()
  const inicio = `${ano}-${mes}-01`
  const fim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`
  const itens = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('data_movimento, fantasia, grupo_venda, quantidade, valor_total, valor_unitario, cancelado')
      .gte('data_movimento', inicio).lte('data_movimento', fim)
  )
  const porDiaLoja = new Map()
  for (const it of itens) {
    if (it.cancelado) continue
    const loja = lojaDeVenda(it.fantasia, it.grupo_venda)
    const chave = `${it.data_movimento}|${loja}`
    if (!porDiaLoja.has(chave)) porDiaLoja.set(chave, { data: it.data_movimento, loja, valor: 0 })
    porDiaLoja.get(chave).valor += valorVenda(it)
  }
  return Array.from(porDiaLoja.values())
    .map((r) => ({ ...r, valor: Math.round(r.valor * 100) / 100 }))
    .sort((a, b) => b.data.localeCompare(a.data) || a.loja.localeCompare(b.loja))
}

// Farol de 3 níveis (10/08/2026, pedido do Felipe) pro CMV% de cada item da Curva de Vendas:
// vermelho acima de 35% (alto), amarelo entre 28% e 34% (atenção), verde abaixo de 28% (ok).
// `null` quando não dá pra calcular (item sem ficha técnica, ou sem venda no período).
export function corFarolCmv(cmvPercentual) {
  if (cmvPercentual == null) return null
  if (cmvPercentual > 35) return 'alto'
  if (cmvPercentual >= 28) return 'atencao'
  return 'ok'
}

export async function buscarCurvaDeVendas(dataInicio, dataFim, loja = null, subgrupo = null) {
  // Filtra por data_movimento no ITEM, não pela janela do arquivo importado (data_inicio/fim do
  // header) — o formato novo importa meses de uma vez só, então o header não serve mais pra
  // recortar período (ver §11 do doc de decisões: "guardar data_movimento no item").
  const itens = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('produto_id, codigo_everest, nome_original, grupo_venda, fantasia, quantidade, valor_total, valor_unitario, data_movimento, cancelado')
      .gte('data_movimento', dataInicio).lte('data_movimento', dataFim)
  )

  // 11/08/2026: resolve o produto pelo CÓDIGO EVEREST no cadastro de hoje (`resolverIdsPorCodigoEverest`),
  // em vez de confiar no `produto_id` que foi gravado no item na hora do import — achado a pedido
  // do Felipe ("Análise de custo/Curva de Vendas... parece que as FT ficaram marcadas com os itens
  // do mês de agosto e não com os itens no geral"). Causa raiz: `produto_id` é um retrato de quando
  // a venda foi importada; como Produtos foi zerado/reimportado mais de uma vez durante a faxina
  // desta semana, o id antigo gravado nos itens de meses que não foram reimportados de novo (maio a
  // julho) passou a apontar pra uma linha que não existe mais em `produtos` — só agosto (reimportado
  // por último) tinha um `produto_id` válido, por isso só agosto "achava" ficha técnica. Resolver
  // por código Everest (identidade canônica, §1) revincula todos os meses ao cadastro atual sem
  // precisar reimportar Vendas mês a mês de novo.
  const idAtualPorCodigo = await resolverIdsPorCodigoEverest(itens.map((it) => it.codigo_everest))
  // 11/08/2026: a ficha também é resolvida pelo código Everest do item, não pelo produto_id
  // gravado nela — mesma causa raiz do parágrafo acima, só que do lado da ficha técnica (ver
  // comentário completo em `resolverFichasPorCodigoEverest`). Sem essa segunda correção, meses
  // reimportados antes da última importação de Ficha Técnica continuavam mostrando "sem ficha
  // técnica" mesmo já revinculados ao produto certo.
  const fichaPorCodigo = await resolverFichasPorCodigoEverest(itens.map((it) => it.codigo_everest))
  const fichasIncompletas = await fichasTravadasIncompletas()

  // Cobertura de ficha técnica (10/08/2026, pedido do Felipe): mede, entre os produtos
  // efetivamente vendidos no período/filtro (Alimentos/Bebidas, já sem cancelados), quantos têm
  // ficha técnica cadastrada — total e por loja. Contado ANTES do filtro de loja abaixo pro total
  // geral bater com "todo mundo", e por loja mesmo quando o filtro de loja está ativo.
  // 11/08/2026: separado em 2 motivos de "sem ficha" (o Felipe reportou 0% de cobertura e
  // perguntou por quê) — "semFicha" é item com produto cadastrado mas sem FT vinculada (gap real
  // de cadastro); "semCorrespondencia" é item vendido cujo código Everest nem bateu com nenhum
  // produto do cadastro ATUAL — isso é sintoma de Vendas/Produtos desalinhados (reimportar), não
  // falta de ficha. Antes os dois caíam juntos em "semFicha" e escondiam a causa.
  const coberturaGeral = { comFicha: new Set(), semFicha: new Set(), semCorrespondencia: new Set() }
  const coberturaPorLoja = new Map()

  const porItem = new Map()
  for (const it of itens) {
    if (it.cancelado) continue
    // Curva de vendas é sobre pratos/bebidas — exclui materiais, insumos e revenda de terceiros.
    if (!GRANDES_GRUPOS_VALIDOS.includes(grandeGrupoDeVenda(it.grupo_venda))) continue
    if (subgrupo && subgrupoDeVenda(it.grupo_venda) !== subgrupo) continue
    const lojaDoItem = lojaDeVenda(it.fantasia, it.grupo_venda)

    const produtoIdAtual = idAtualPorCodigo.get(it.codigo_everest) || null
    const ficha = fichaPorCodigo.get(it.codigo_everest)
    // Trava de custo (ver `aplicarTravaDeCusto`) aplicada por unidade — efeito imediato pra quem
    // lê `custo_producao` direto do banco, sem esperar reimportação da Ficha Técnica.
    const custoPorUnidadeFicha = ficha?.quantidade_producao
      ? aplicarTravaDeCusto(ficha.nome, Number(ficha.custo_producao) / Number(ficha.quantidade_producao), fichasIncompletas.has(normalizarNomeFicha(ficha.nome)))
      : 0
    const temFicha = !!(produtoIdAtual && custoPorUnidadeFicha > 0)
    const chaveCobertura = produtoIdAtual || it.codigo_everest || it.nome_original
    const balde = temFicha ? 'comFicha' : produtoIdAtual ? 'semFicha' : 'semCorrespondencia'
    coberturaGeral[balde].add(chaveCobertura)
    if (!coberturaPorLoja.has(lojaDoItem)) coberturaPorLoja.set(lojaDoItem, { comFicha: new Set(), semFicha: new Set(), semCorrespondencia: new Set() })
    coberturaPorLoja.get(lojaDoItem)[balde].add(chaveCobertura)

    if (loja && lojaDoItem !== loja) continue
    const chave = it.codigo_everest || it.nome_original
    if (!porItem.has(chave)) porItem.set(chave, { codigo: it.codigo_everest, nome: it.nome_original, grupo: it.grupo_venda, quantidade: 0, valorTotal: 0, custoTeorico: 0, semFicha: !temFicha, ultimoValorUnitario: null, ultimaData: null })
    const g = porItem.get(chave)
    g.quantidade += Number(it.quantidade) || 0
    // 11/08/2026, pedido do Felipe: usa o valor bruto de venda (item + gorjeta de 13%), não só o
    // valor do item — ver `valorVenda`.
    g.valorTotal += valorVenda(it)
    // 24/08/2026, pedido do Felipe: "Valor unit." (coluna da tabela) deixa de ser a média do
    // período (valorTotal ÷ quantidade) — mesmo achado do "CMV mais alto no período"
    // (`buscarMargemCardapio`): sujeira numa linha de venda distorce a média. Guarda o valor
    // unitário da venda MAIS RECENTE (sem gorjeta, já que essa coluna mostra preço de tabela —
    // ver comentário mais abaixo sobre não levar a gorjeta pro "Valor unit.").
    if (it.valor_unitario != null && (!g.ultimaData || String(it.data_movimento) >= String(g.ultimaData))) {
      g.ultimaData = it.data_movimento
      g.ultimoValorUnitario = Number(it.valor_unitario)
    }
    if (temFicha) {
      g.custoTeorico += custoPorUnidadeFicha * (Number(it.quantidade) || 0)
    } else {
      g.semFicha = true
    }
  }

  const lista = Array.from(porItem.values()).sort((a, b) => b.valorTotal - a.valorTotal)
  const totalGeral = lista.reduce((acc, i) => acc + i.valorTotal, 0)
  let acumulado = 0
  const resultado = lista.map((item) => {
    acumulado += item.valorTotal
    const percentualAcumulado = totalGeral > 0 ? (acumulado / totalGeral) * 100 : 0
    // 10/08/2026: item sem ficha técnica fica com CMV% null (não 0%) — custo 0 por falta de FT
    // não é "CMV ótimo", é "não sei calcular", e não deveria colorir verde no farol.
    const custoTeoricoPercentual = (item.valorTotal > 0 && !item.semFicha) ? Math.round((item.custoTeorico / item.valorTotal) * 10000) / 100 : null
    // 11/08/2026, pedido do Felipe ("colocar valor unitário e custo unitário no analítico"): valor
    // e custo teórico já vinham só como total do período — divide pela quantidade pra mostrar por
    // unidade vendida na tabela detalhada. Custo unitário fica null quando não há ficha (mesmo
    // motivo do CMV% acima: custo 0 por falta de FT não é um custo unitário de verdade).
    // 12/08/2026, pedido do Felipe: "Valor unit." não deve levar a gorjeta de 13% — só os TOTAIS
    // (valorTotal do item, e os totais do cabeçalho) usam o valor de venda com gorjeta (`valorVenda`,
    // §29.21).
    // 24/08/2026, pedido do Felipe: deixou de ser a MÉDIA do período (valorTotal÷quantidade, sem
    // gorjeta) — agora é o valor unitário da venda MAIS RECENTE (já sem gorjeta, guardado acima em
    // `ultimoValorUnitario`) — mesma correção do "CMV mais alto no período" (achado: sujeira numa
    // linha de venda distorcia a média pra baixo). Sem venda com valor_unitario no período (dado
    // antigo, pré-migration_v8), cai pro cálculo antigo só como último recurso.
    const valorUnitario = item.ultimoValorUnitario != null
      ? Math.round(item.ultimoValorUnitario * 100) / 100
      : (item.quantidade > 0 ? Math.round((item.valorTotal / FATOR_GORJETA / item.quantidade) * 100) / 100 : null)
    const custoUnitario = (item.quantidade > 0 && !item.semFicha) ? Math.round((item.custoTeorico / item.quantidade) * 100) / 100 : null
    return {
      ...item,
      custoTeorico: Math.round(item.custoTeorico * 100) / 100,
      custoTeoricoPercentual,
      valorUnitario,
      custoUnitario,
      farol: corFarolCmv(custoTeoricoPercentual),
      // 25/08/2026 (§35), pedido do Felipe: margem de contribuição na Curva ABC.
      // Valor = quanto esse item deixou depois de pagar o próprio custo de matéria-prima
      // (venda − custo teórico, no período). % = margem ÷ venda, ou seja, o complemento do CMV%.
      // Item sem ficha fica null (não dá pra afirmar margem sem custo) — nunca 100%.
      margemContribuicao: item.semFicha ? null : Math.round((item.valorTotal - item.custoTeorico) * 100) / 100,
      margemPercentual: (item.semFicha || !(item.valorTotal > 0))
        ? null
        : Math.round(((item.valorTotal - item.custoTeorico) / item.valorTotal) * 1000) / 10,
      margemUnitaria: (valorUnitario != null && custoUnitario != null)
        ? Math.round((valorUnitario - custoUnitario) * 100) / 100
        : null,
      percentual: totalGeral > 0 ? (item.valorTotal / totalGeral) * 100 : 0,
      percentualAcumulado,
      curva: percentualAcumulado <= 80 ? 'A' : percentualAcumulado <= 95 ? 'B' : 'C'
    }
  })

  // 10/08/2026: agregado "só quem tem ficha" — o que a tela de Análise de Custo (Painel) usa pro
  // resumo/CMV médio de verdade, pra não diluir o CMV com itens de custo 0 por falta de FT (o
  // Felipe reportou exatamente esse erro: "tenho o faturamento, mas ainda não tenho o custo").
  const comFicha = resultado.filter((i) => !i.semFicha)
  const totalVendasComFicha = comFicha.reduce((a, i) => a + i.valorTotal, 0)
  const totalCustoTeoricoComFicha = comFicha.reduce((a, i) => a + i.custoTeorico, 0)

  function resumirCobertura(g) {
    const total = g.comFicha.size + g.semFicha.size + g.semCorrespondencia.size
    return {
      comFicha: g.comFicha.size,
      semFicha: g.semFicha.size,
      semCorrespondencia: g.semCorrespondencia.size,
      total,
      percentual: total > 0 ? Math.round((g.comFicha.size / total) * 1000) / 10 : null
    }
  }
  const cobertura = {
    total: resumirCobertura(coberturaGeral),
    porLoja: Object.fromEntries(LOJAS_VALIDAS.map((l) => [l, coberturaPorLoja.has(l) ? resumirCobertura(coberturaPorLoja.get(l)) : { comFicha: 0, semFicha: 0, semCorrespondencia: 0, total: 0, percentual: null }]))
  }

  // Resumo do período/filtro atual, anexado no array (não muda o formato pra quem já consome
  // isso como lista simples — ver AnaliseProducao.jsx, "Curva de vendas (ABC)": classificação por
  // receita, sem olhar custo/FT — totalVendas/totalCustoTeorico/cmvMedio continuam somando TODOS
  // os itens, com ou sem ficha, pra não alterar o que aquela tela já mostra) pra alimentar o
  // cabeçalho de resumo (Fat. total / Custo total / CMV médio) igual nas telas de Análise de Custo.
  const totalCustoTeoricoGeral = resultado.reduce((a, i) => a + i.custoTeorico, 0)
  // 11/08/2026, pedido do Felipe: "% de fichas explicadas" — diferente da cobertura por CONTAGEM de
  // item (`cobertura.total.percentual`, acima), esta é ponderada por RECEITA: quanto do faturamento
  // total do período (`totalVendas`, com ou sem ficha) já está "explicado" por itens que têm ficha
  // técnica vinculada (`totalVendasComFicha`). Um item de alto volume sem FT pesa mais aqui do que
  // na contagem simples de itens.
  const percentualFichaExplicado = totalGeral > 0 ? Math.round((totalVendasComFicha / totalGeral) * 1000) / 10 : null

  // 11/08/2026, pedido do Felipe: comparar o custo teórico do período com as COMPRAS (CMC — "Custo
  // das Mercadorias Compradas") do mesmo período, pra estimar "custo perdido" (quebra/perda que o
  // teórico não capta).
  // (1) `custoTeoricoExtrapolado` — projeta o custo teórico TOTAL do período (Custo total ÷ %
  //     fichas explicadas) a partir do que já foi medido nos itens com ficha vinculada, assumindo
  //     que o restante do faturamento (ainda sem ficha) tem, em média, o mesmo CMV% do que já foi
  //     medido. É uma ESTIMATIVA/projeção, não um cálculo exato — só existe enquanto a cobertura de
  //     ficha não é 100%; fica null se `percentualFichaExplicado` for 0/null (nada pra projetar).
  //     Esse número CONTINUA respeitando os filtros de loja/grupo (é o custo projetado do que está
  //     sendo visto na tela).
  // (2) `comprasPeriodo` (CMC) — 12/08/2026, pedido do Felipe: "o cmc tem mudado conforme o filtro
  //     de loja... vamos deixar o cmc apenas com filtro de período, desativar os outros filtros".
  //     Antes essa conta seguia o filtro de loja (resolvendo pro bloco DOM/Dalva da nota fiscal —
  //     ver §28.2/§29.19), e por isso oscilava ao trocar de sub-loja mesmo dentro do mesmo bloco.
  //     Agora `comprasPeriodo` SEMPRE soma TODAS as compras (DOM + Dalva) do período — só a data
  //     (`dataInicio`/`dataFim`) filtra; `loja` e `subgrupo` não têm nenhum efeito aqui. Compras não
  //     tem taxonomia de subgrupo por item mesmo (isso já valia antes), e agora também não é mais
  //     recortada por bloco/loja.
  //     ⚠️ Efeito colateral consciente: como `custoTeoricoExtrapolado` (item 1) CONTINUA seguindo o
  //     filtro de loja/grupo, mas `comprasPeriodo` passou a ser sempre a empresa toda, a comparação
  //     "Diferença (custo perdido)" só é 100% equivalente (mesma base dos dois lados) quando o
  //     filtro de loja E de grupo estão em "Todas"/"Todos". Com um filtro de loja/grupo ativo, a
  //     tela mostra um aviso explicando que a Diferença compara um recorte (custo projetado) com o
  //     total da empresa (compras) — não escondido, ver `AnaliseCusto.jsx`.
  const { data: notasPeriodo } = await supabase.from('notas_importadas').select('id').gte('data_emissao', dataInicio).lte('data_emissao', dataFim)
  const idsNotasPeriodo = (notasPeriodo || []).map((n) => n.id)
  let comprasPeriodo = 0
  if (idsNotasPeriodo.length) {
    const itensCompraPeriodo = await buscarPorIdsEmLotes(
      (lote) => supabase.from('notas_importadas_itens').select('nota_id, valor_total, calcula_cmv').in('nota_id', lote),
      idsNotasPeriodo
    )
    for (const it of itensCompraPeriodo) {
      if (it.calcula_cmv === false) continue
      comprasPeriodo += Number(it.valor_total) || 0
    }
  }
  const custoTeoricoExtrapolado = percentualFichaExplicado > 0 ? totalCustoTeoricoComFicha / (percentualFichaExplicado / 100) : null
  const cmcPercentual = totalGeral > 0 ? Math.round((comprasPeriodo / totalGeral) * 10000) / 100 : null
  // Convenção já travada no doc (§24.3): teórico − real. Positiva = gastamos menos comprando do
  // que o teórico projetado precisaria (economia); negativa = compramos mais do que o teórico
  // projetado explica — é o "custo perdido" (quebra/perda/desperdício não capturado pela ficha).
  const diferencaCustoPerdido = custoTeoricoExtrapolado != null ? custoTeoricoExtrapolado - comprasPeriodo : null
  // Aviso de comparação parcial (12/08/2026): CMC agora é sempre empresa toda; se algum filtro de
  // loja/grupo estiver ativo, a Diferença mistura um recorte (custo projetado) com o total da
  // empresa (compras) — sinalizado pra tela avisar, em vez de fingir que os dois lados batem.
  const comparacaoParcialPorFiltro = !!(loja || subgrupo)

  return Object.assign(resultado, {
    totalVendas: Math.round(totalGeral * 100) / 100,
    totalCustoTeorico: Math.round(totalCustoTeoricoGeral * 100) / 100,
    cmvMedio: totalGeral > 0 ? Math.round((totalCustoTeoricoGeral / totalGeral) * 10000) / 100 : null,
    totalVendasComFicha: Math.round(totalVendasComFicha * 100) / 100,
    totalCustoTeoricoComFicha: Math.round(totalCustoTeoricoComFicha * 100) / 100,
    cmvMedioComFicha: totalVendasComFicha > 0 ? Math.round((totalCustoTeoricoComFicha / totalVendasComFicha) * 10000) / 100 : null,
    percentualFichaExplicado,
    custoTeoricoExtrapolado: custoTeoricoExtrapolado != null ? Math.round(custoTeoricoExtrapolado * 100) / 100 : null,
    comprasPeriodo: Math.round(comprasPeriodo * 100) / 100,
    cmcPercentual,
    diferencaCustoPerdido: diferencaCustoPerdido != null ? Math.round(diferencaCustoPerdido * 100) / 100 : null,
    comparacaoParcialPorFiltro,
    cobertura
  })
}

// 14/08/2026 (5), pedido do Felipe: depois de notar 2 meses seguidos com `diferencaCustoPerdido`
// bem negativa (-270k e -40k — compramos mais do que o Custo Teórico previa) e o mês seguinte
// "bater certo", ele perguntou qual a melhor forma de olhar isso NO TEMPO pra saber se sobrou
// saldo em estoque pra abater no mês seguinte. `buscarCurvaDeVendas` já calcula
// `diferencaCustoPerdido` mas só pra 1 período isolado — sem série mensal e sem saldo ACUMULADO,
// não dá pra distinguir "sobrou em estoque de verdade" de "foi perda/quebra não capturada pela
// ficha" (a própria função rotula a diferença negativa como "custo perdido", mas isso é só um
// rótulo/hipótese — o objetivo aqui é testar essa hipótese contra o estoque físico real).
//
// Estratégia: reaproveita as 2 fontes de verdade que já existem (nenhuma conta nova/duplicada) —
// `buscarCurvaDeVendas` (Custo teórico × Compras, 1 chamada por mês do período) e `buscarCMVReal`
// (estoque físico inicial/final valorizado em R$, somado entre os grupos pra virar 1 número só da
// empresa). Pra cada mês da janela, calcula:
//   - `variacaoTeoricaImplicita` = Compras − Custo teórico extrapolado (= −diferencaCustoPerdido).
//     Positiva = o MODELO teórico diz que deveria ter sobrado estoque nesse mês; negativa = diz que
//     consumimos mais do que compramos (bateu no estoque).
//   - `variacaoEstoqueReal` = Estoque final − Estoque inicial (contagem física do mês, em R$).
//   - As 2 são acumuladas (soma corrida) desde o início da janela — como as 2 partem de 0 no mesmo
//     ponto, comparar as 2 linhas acumuladas responde a pergunta: se elas caminham juntas, o saldo
//     "sobrando" no modelo teórico está mesmo virando estoque físico de verdade; se divergem, a
//     diferença é o que o modelo teórico não está capturando (perda/quebra/furto/insumo sem ficha).
//
// ⚠️ `buscarCMVReal` não aceita filtro de loja/grupo (sempre empresa toda, mesma convenção do CMC
// já usada em `buscarCurvaDeVendas`) — por isso, quando `loja`/`subgrupo` estiverem ativos, o
// cruzamento com o estoque físico deixa de ser estritamente comparável (mesmo aviso
// `comparacaoParcialPorFiltro` já usado lá, propagado aqui).
export async function buscarSaldoTeoricoAcumulado({ mesFinal, anoFinal, meses = 6, loja = null, subgrupo = null } = {}) {
  const janela = []
  let m = mesFinal
  let a = anoFinal
  for (let i = 0; i < meses; i++) {
    janela.unshift({ mes: m, ano: a })
    m -= 1
    if (m === 0) { m = 12; a -= 1 }
  }

  let diferencaAcumulada = 0
  let variacaoTeoricaAcumulada = 0
  let variacaoEstoqueRealAcumulada = 0
  let algumaComparacaoParcial = false

  const linhas = []
  for (const { mes, ano } of janela) {
    const inicioMes = `${ano}-${String(mes).padStart(2, '0')}-01`
    const ultimoDia = new Date(ano, mes, 0).getDate()
    const fimMes = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`

    const [curva, real] = await Promise.all([
      buscarCurvaDeVendas(inicioMes, fimMes, loja, subgrupo),
      buscarCMVReal(mes, ano)
    ])

    const custoTeoricoExtrapolado = curva.custoTeoricoExtrapolado
    const comprasPeriodo = curva.comprasPeriodo
    const diferencaCustoPerdido = curva.diferencaCustoPerdido
    if (curva.comparacaoParcialPorFiltro) algumaComparacaoParcial = true

    const estoqueInicialReal = real.linhas.reduce((acc, l) => acc + l.estoqueInicial, 0)
    const estoqueFinalReal = real.linhas.reduce((acc, l) => acc + l.estoqueFinal, 0)
    const variacaoEstoqueReal = Math.round((estoqueFinalReal - estoqueInicialReal) * 100) / 100

    const variacaoTeoricaImplicita = custoTeoricoExtrapolado != null
      ? Math.round((comprasPeriodo - custoTeoricoExtrapolado) * 100) / 100
      : null

    diferencaAcumulada = Math.round((diferencaAcumulada + (diferencaCustoPerdido || 0)) * 100) / 100
    variacaoTeoricaAcumulada = Math.round((variacaoTeoricaAcumulada + (variacaoTeoricaImplicita || 0)) * 100) / 100
    variacaoEstoqueRealAcumulada = Math.round((variacaoEstoqueRealAcumulada + variacaoEstoqueReal) * 100) / 100

    linhas.push({
      mes, ano,
      custoTeoricoExtrapolado, comprasPeriodo, diferencaCustoPerdido,
      variacaoTeoricaImplicita, diferencaAcumulada, variacaoTeoricaAcumulada,
      estoqueInicialReal: Math.round(estoqueInicialReal * 100) / 100,
      estoqueFinalReal: Math.round(estoqueFinalReal * 100) / 100,
      variacaoEstoqueReal, variacaoEstoqueRealAcumulada,
      itensEstoqueSemCusto: real.totalItensSemCusto,
      itensEstoqueOrfaos: real.totalItensOrfaos,
      itensEstoqueTotal: real.totalItensContados
    })
  }

  return { linhas, comparacaoParcialPorFiltro: algumaComparacaoParcial || !!(loja || subgrupo) }
}

export async function buscarConsumoTeorico(dataInicio, dataFim, loja = null, subgrupo = null) {
  // Filtra por data_movimento no ITEM, não pelo header do arquivo importado — ver nota em
  // buscarCurvaDeVendas.
  const itensVendidos = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('produto_id, codigo_everest, quantidade, valor_total, valor_unitario, cancelado, fantasia, grupo_venda')
      .gte('data_movimento', dataInicio).lte('data_movimento', dataFim)
  )
  // 11/08/2026: mesma correção da buscarCurvaDeVendas — resolve o produto pelo código Everest no
  // cadastro atual em vez do `produto_id` gravado no item na hora do import (ver comentário
  // completo lá).
  const idAtualPorCodigo = await resolverIdsPorCodigoEverest(itensVendidos.map((it) => it.codigo_everest))
  const vendidoPorCodigo = new Map()
  let totalVendas = 0
  for (const it of itensVendidos) {
    const produtoIdAtual = idAtualPorCodigo.get(it.codigo_everest) || null
    if (!produtoIdAtual || it.cancelado) continue
    if (loja && lojaDeVenda(it.fantasia, it.grupo_venda) !== loja) continue
    if (!GRANDES_GRUPOS_VALIDOS.includes(grandeGrupoDeVenda(it.grupo_venda))) continue
    if (subgrupo && subgrupoDeVenda(it.grupo_venda) !== subgrupo) continue
    vendidoPorCodigo.set(it.codigo_everest, (vendidoPorCodigo.get(it.codigo_everest) || 0) + (Number(it.quantidade) || 0))
    // 11/08/2026, pedido do Felipe: valor bruto de venda (item + gorjeta) — ver `valorVenda`.
    totalVendas += valorVenda(it)
  }
  totalVendas = Math.round(totalVendas * 100) / 100
  if (!vendidoPorCodigo.size) return Object.assign([], { totalVendas, totalCustoTeorico: 0, cmvMedio: null })

  // 11/08/2026: mesma correção do lado da ficha — casa por código Everest, não por produto_id
  // gravado nela (ver `resolverFichasPorCodigoEverest`). Antes disso, meses reimportados antes da
  // última importação de Ficha Técnica continuavam sem consumo teórico mesmo já revinculados.
  const fichaPorCodigo = await resolverFichasPorCodigoEverest(Array.from(vendidoPorCodigo.keys()))
  const fichas = Array.from(fichaPorCodigo.values())
  if (!fichas.length) return Object.assign([], { totalVendas, totalCustoTeorico: 0, cmvMedio: null })

  // 24/08/2026: batched em lotes de 300 (mesma correção do §22.1/§23 aplicada aqui de forma
  // preventiva — `idsFichas` cresce com o nº de pratos distintos vendidos no período; período
  // largo ou cardápio grande pode passar do limite de URL do PostgREST, mesmo sintoma do bug
  // achado em `buscarResumoFichasTecnicas`).
  const idsFichas = fichas.map((f) => f.id)
  const ingredientesPorFicha = new Map()
  for (let i = 0; i < idsFichas.length; i += 300) {
    const lote = idsFichas.slice(i, i + 300)
    const ingredientesDoLote = await buscarTodasAsLinhas(() =>
      supabase.from('fichas_tecnicas_ingredientes').select('ficha_id, codigo_everest, nome, unidade_medida, quantidade_aplicada, quantidade_baixa_estoque, custo_unitario, custo_medio, tipo_baixa').in('ficha_id', lote)
    )
    for (const ing of ingredientesDoLote) {
      if (!ingredientesPorFicha.has(ing.ficha_id)) ingredientesPorFicha.set(ing.ficha_id, [])
      ingredientesPorFicha.get(ing.ficha_id).push(ing)
    }
  }

  const consumoPorInsumo = new Map()
  for (const ficha of fichas) {
    const qtdVendida = vendidoPorCodigo.get(ficha.codigo_everest) || 0
    if (!qtdVendida || !ficha.quantidade_producao) continue
    // 10/08/2026: só as linhas "Consumo" — ver ehLinhaDeConsumo/selecionarIngredientesDeConsumo.
    const ingredientesDaFicha = selecionarIngredientesDeConsumo(ingredientesPorFicha.get(ficha.id) || [])
    for (const ing of ingredientesDaFicha) {
      // Consumo real de estoque: usa a quantidade de BAIXA (já na unidade de estoque do Everest
      // e já com aproveitamento aplicado). Fallback pra quantidade_aplicada se a baixa vier vazia.
      const qtdConsumo = Number(ing.quantidade_baixa_estoque) || Number(ing.quantidade_aplicada) || 0
      const teorico = (qtdConsumo / Number(ficha.quantidade_producao)) * qtdVendida
      const custoUnitario = Number(ing.custo_unitario) || Number(ing.custo_medio) || 0
      const chave = ing.codigo_everest || ing.nome
      if (!consumoPorInsumo.has(chave)) consumoPorInsumo.set(chave, { codigo: ing.codigo_everest, nome: ing.nome, unidade: ing.unidade_medida, quantidadeTeorica: 0, valorTeorico: 0 })
      const c = consumoPorInsumo.get(chave)
      c.quantidadeTeorica += teorico
      c.valorTeorico += teorico * custoUnitario
    }
  }

  const linhas = Array.from(consumoPorInsumo.values())
    .map((c) => ({ ...c, valorTeorico: Math.round(c.valorTeorico * 100) / 100 }))
    .sort((a, b) => b.quantidadeTeorica - a.quantidadeTeorica)
  const totalCustoTeorico = Math.round(linhas.reduce((a, c) => a + c.valorTeorico, 0) * 100) / 100
  return Object.assign(linhas, {
    totalVendas,
    totalCustoTeorico,
    cmvMedio: totalVendas > 0 ? Math.round((totalCustoTeorico / totalVendas) * 10000) / 100 : null
  })
}

// Consumo Teórico × Venda — pedido do Felipe pra "tirar a prova" se o motor de conversão bate com
// a venda real, principalmente em itens simples (ex. refrigerante), que hoje ficam INVISÍVEIS no
// buscarConsumoTeorico acima: aquela função só expande insumos que aparecem DENTRO de uma ficha
// técnica de um prato vendido — um item de revenda direta, sem ficha (a própria unidade vendida É
// o insumo, não passa por transformação), nunca aparece na lista.
//
// Aqui, além da expansão normal (prato com ficha → ingredientes), toda venda de um produto SEM
// ficha técnica entra como "consumo teórico" dele mesmo, 1:1 (vendeu 10 refrigerantes = consumiu
// teoricamente 10 refrigerantes). Depois, pra cada insumo/código Everest, comparamos esse consumo
// teórico total com a quantidade que ELE MESMO teve de venda direta no período (quando aplicável —
// só faz sentido pra quem é vendido diretamente, não pra insumo que só existe dentro de receita,
// tipo farinha). Pra item simples, teórico e vendido batem exatamente — essa é a prova. Pra item
// usado em receita além de vendido puro (ex. refrigerante que também entra num drink), o teórico
// fica maior que o vendido direto, e a diferença é justamente o quanto foi consumido via receita.
export async function buscarConsumoXVenda(dataInicio, dataFim, loja = null, subgrupo = null) {
  const itensVendidos = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('produto_id, codigo_everest, nome_original, quantidade, valor_total, valor_unitario, cancelado, fantasia, grupo_venda')
      .gte('data_movimento', dataInicio).lte('data_movimento', dataFim)
  )

  const vendidoPorProduto = new Map() // produto_id -> { codigo, nome, quantidade, valorTotal }
  let totalVendas = 0
  for (const it of itensVendidos) {
    if (!it.produto_id || it.cancelado) continue
    if (loja && lojaDeVenda(it.fantasia, it.grupo_venda) !== loja) continue
    if (!GRANDES_GRUPOS_VALIDOS.includes(grandeGrupoDeVenda(it.grupo_venda))) continue
    if (subgrupo && subgrupoDeVenda(it.grupo_venda) !== subgrupo) continue
    if (!vendidoPorProduto.has(it.produto_id)) {
      vendidoPorProduto.set(it.produto_id, { codigo: it.codigo_everest, nome: it.nome_original, quantidade: 0, valorTotal: 0 })
    }
    const v = vendidoPorProduto.get(it.produto_id)
    // 11/08/2026, pedido do Felipe: valor bruto de venda (item + gorjeta) — ver `valorVenda`.
    const valor = valorVenda(it)
    v.quantidade += Number(it.quantidade) || 0
    v.valorTotal += valor
    totalVendas += valor
  }
  totalVendas = Math.round(totalVendas * 100) / 100
  if (!vendidoPorProduto.size) return Object.assign([], { totalVendas, totalCustoTeorico: 0, cmvMedio: null })

  // Venda direta por código Everest — pra comparar depois com o consumo teórico de cada insumo.
  const vendaDiretaPorCodigo = new Map()
  for (const v of vendidoPorProduto.values()) {
    const chave = v.codigo || v.nome
    if (!vendaDiretaPorCodigo.has(chave)) vendaDiretaPorCodigo.set(chave, { codigo: v.codigo, nome: v.nome, quantidade: 0, valorTotal: 0 })
    const acc = vendaDiretaPorCodigo.get(chave)
    acc.quantidade += v.quantidade
    acc.valorTotal += v.valorTotal
  }

  // 24/08/2026: os 3 `.in()` abaixo (fichas por produto, ingredientes por ficha, unidade dos sem-
  // ficha) agora vão em lotes de 300 — mesma correção preventiva aplicada em `buscarConsumoTeorico`
  // e `buscarResumoFichasTecnicas` (§22.1/§23): `idsProdutosVendidos` cresce com o período/cardápio
  // e pode passar do limite de URL do PostgREST.
  const idsProdutosVendidos = Array.from(vendidoPorProduto.keys())
  const fichas = []
  for (let i = 0; i < idsProdutosVendidos.length; i += 300) {
    const lote = idsProdutosVendidos.slice(i, i + 300)
    const { data, error: e2 } = await supabase
      .from('fichas_tecnicas')
      .select('id, produto_id, quantidade_producao')
      .in('produto_id', lote)
    if (e2) throw e2
    fichas.push(...(data || []))
  }

  const produtoIdsComFicha = new Set(fichas.map((f) => f.produto_id))
  const idsFichas = fichas.map((f) => f.id)
  const ingredientesPorFicha = new Map()
  for (let i = 0; i < idsFichas.length; i += 300) {
    const lote = idsFichas.slice(i, i + 300)
    const ingredientesDoLote = await buscarTodasAsLinhas(() =>
      supabase.from('fichas_tecnicas_ingredientes').select('ficha_id, codigo_everest, nome, unidade_medida, quantidade_aplicada, quantidade_baixa_estoque, custo_unitario, custo_medio, tipo_baixa').in('ficha_id', lote)
    )
    for (const ing of ingredientesDoLote) {
      if (!ingredientesPorFicha.has(ing.ficha_id)) ingredientesPorFicha.set(ing.ficha_id, [])
      ingredientesPorFicha.get(ing.ficha_id).push(ing)
    }
  }

  // Unidade dos produtos sem ficha (pra exibir junto da quantidade — ex. "un", "kg").
  const idsSemFicha = idsProdutosVendidos.filter((id) => !produtoIdsComFicha.has(id))
  const unidadePorProduto = new Map()
  for (let i = 0; i < idsSemFicha.length; i += 300) {
    const lote = idsSemFicha.slice(i, i + 300)
    const { data: prods } = await supabase.from('produtos').select('id, unidade_medida').in('id', lote)
    for (const p of prods || []) unidadePorProduto.set(p.id, p.unidade_medida)
  }

  const consumoPorInsumo = new Map()
  function acumular(chave, dados, quantidade, valor) {
    if (!consumoPorInsumo.has(chave)) consumoPorInsumo.set(chave, { codigo: dados.codigo, nome: dados.nome, unidade: dados.unidade || '', quantidadeTeorica: 0, valorTeorico: 0 })
    const c = consumoPorInsumo.get(chave)
    c.quantidadeTeorica += quantidade
    c.valorTeorico += valor
    if (!c.unidade && dados.unidade) c.unidade = dados.unidade
  }

  // 1) Pratos/receitas com ficha técnica → expande pros ingredientes (mesma lógica do
  // buscarConsumoTeorico).
  for (const ficha of fichas || []) {
    const qtdVendida = vendidoPorProduto.get(ficha.produto_id)?.quantidade || 0
    if (!qtdVendida || !ficha.quantidade_producao) continue
    // 10/08/2026: só as linhas "Consumo" — ver ehLinhaDeConsumo/selecionarIngredientesDeConsumo.
    const ingredientesDaFicha = selecionarIngredientesDeConsumo(ingredientesPorFicha.get(ficha.id) || [])
    for (const ing of ingredientesDaFicha) {
      const qtdConsumo = Number(ing.quantidade_baixa_estoque) || Number(ing.quantidade_aplicada) || 0
      const teorico = (qtdConsumo / Number(ficha.quantidade_producao)) * qtdVendida
      const custoUnitario = Number(ing.custo_unitario) || Number(ing.custo_medio) || 0
      const chave = ing.codigo_everest || ing.nome
      acumular(chave, { codigo: ing.codigo_everest, nome: ing.nome, unidade: ing.unidade_medida }, teorico, teorico * custoUnitario)
    }
  }

  // 2) Itens vendidos SEM ficha técnica → o próprio item É o insumo, consumo teórico = venda, 1:1.
  for (const [produtoId, v] of vendidoPorProduto.entries()) {
    if (produtoIdsComFicha.has(produtoId)) continue
    const chave = v.codigo || v.nome
    acumular(chave, { codigo: v.codigo, nome: v.nome, unidade: unidadePorProduto.get(produtoId) }, v.quantidade, v.valorTotal)
  }

  const linhas = Array.from(consumoPorInsumo.values()).map((c) => {
    const chave = c.codigo || c.nome
    const vendaDireta = vendaDiretaPorCodigo.get(chave)
    const temVendaDireta = !!vendaDireta
    const quantidadeVendida = temVendaDireta ? Math.round(vendaDireta.quantidade * 1000) / 1000 : null
    const diferenca = temVendaDireta ? Math.round((c.quantidadeTeorica - vendaDireta.quantidade) * 1000) / 1000 : null
    const percentualDivergencia = temVendaDireta && vendaDireta.quantidade > 0
      ? Math.round((diferenca / vendaDireta.quantidade) * 10000) / 100
      : null
    return {
      ...c,
      quantidadeTeorica: Math.round(c.quantidadeTeorica * 1000) / 1000,
      valorTeorico: Math.round(c.valorTeorico * 100) / 100,
      quantidadeVendida,
      diferenca,
      percentualDivergencia
    }
  }).sort((a, b) => b.quantidadeTeorica - a.quantidadeTeorica)

  const totalCustoTeorico = Math.round(linhas.reduce((a, c) => a + c.valorTeorico, 0) * 100) / 100
  return Object.assign(linhas, {
    totalVendas,
    totalCustoTeorico,
    cmvMedio: totalVendas > 0 ? Math.round((totalCustoTeorico / totalVendas) * 10000) / 100 : null
  })
}

export async function buscarCMVPonderadoPorItem(dataInicio, dataFim, loja = null, subgrupo = null) {
  // Mesma ideia do buscarCMVPonderado (custo teórico da ficha × qtd vendida ÷ vendas em valor),
  // mas por ITEM/prato — não por grupo. O "peso" de cada prato na conta geral vem naturalmente
  // do valor de venda de cada um: somando custo teórico e vendas de todos os itens antes de
  // dividir, quem vende mais pesa mais no CMV ponderado geral.
  const itensVendidosBrutos = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('produto_id, codigo_everest, nome_original, grupo_venda, fantasia, quantidade, valor_total, valor_unitario, cancelado')
      .gte('data_movimento', dataInicio).lte('data_movimento', dataFim)
  )
  const itensVendidos = itensVendidosBrutos.filter((v) => {
    if (v.cancelado) return false
    if (loja && lojaDeVenda(v.fantasia, v.grupo_venda) !== loja) return false
    if (!GRANDES_GRUPOS_VALIDOS.includes(grandeGrupoDeVenda(v.grupo_venda))) return false
    if (subgrupo && subgrupoDeVenda(v.grupo_venda) !== subgrupo) return false
    return true
  })
  if (!itensVendidos.length) return { linhas: [], totalVendas: 0, totalCustoTeorico: 0, cmvPonderadoGeral: null }

  const idsProdutosVendidos = [...new Set(itensVendidos.map((i) => i.produto_id).filter(Boolean))]
  const fichas = await buscarPorIdsEmLotes(
    (lote) => supabase.from('fichas_tecnicas').select('produto_id, nome, quantidade_producao, custo_producao').in('produto_id', lote),
    idsProdutosVendidos
  )
  const fichaPorProduto = new Map((fichas || []).map((f) => [f.produto_id, f]))
  const fichasIncompletas = await fichasTravadasIncompletas()

  const porItem = new Map()
  for (const it of itensVendidos) {
    const chave = it.produto_id || it.codigo_everest || it.nome_original
    if (!porItem.has(chave)) porItem.set(chave, { nome: it.nome_original, codigo: it.codigo_everest, vendas: 0, custoTeorico: 0, quantidade: 0, semFicha: false })
    const g = porItem.get(chave)
    // 11/08/2026, pedido do Felipe: valor bruto de venda (item + gorjeta) — ver `valorVenda`.
    g.vendas += valorVenda(it)
    g.quantidade += Number(it.quantidade) || 0

    const ficha = fichaPorProduto.get(it.produto_id)
    // Trava de custo (ver `aplicarTravaDeCusto`) — efeito imediato, sem esperar reimportação.
    const custoPorUnidade = ficha?.quantidade_producao
      ? aplicarTravaDeCusto(ficha.nome, Number(ficha.custo_producao) / Number(ficha.quantidade_producao), fichasIncompletas.has(normalizarNomeFicha(ficha.nome)))
      : 0
    if (custoPorUnidade > 0) {
      g.custoTeorico += custoPorUnidade * (Number(it.quantidade) || 0)
    } else {
      g.semFicha = true
    }
  }

  const linhasBrutas = Array.from(porItem.values()).map((l) => ({
    ...l,
    vendas: Math.round(l.vendas * 100) / 100,
    custoTeorico: Math.round(l.custoTeorico * 100) / 100,
    cmvPonderado: l.vendas > 0 ? Math.round((l.custoTeorico / l.vendas) * 10000) / 100 : null
  })).sort((a, b) => b.vendas - a.vendas)

  const totalVendas = linhasBrutas.reduce((a, l) => a + l.vendas, 0)
  const totalCustoTeorico = linhasBrutas.reduce((a, l) => a + l.custoTeorico, 0)
  // "Média ponderada" = o próprio CMV ponderado geral (pesado pelas vendas de cada item, não uma
  // média simples) — mesmo número mostrado no resumo do cabeçalho. Item acima disso é destacado.
  const cmvPonderadoGeral = totalVendas > 0 ? Math.round((totalCustoTeorico / totalVendas) * 10000) / 100 : null

  const linhas = linhasBrutas.map((l) => ({
    ...l,
    acimaDaMedia: cmvPonderadoGeral !== null && l.cmvPonderado !== null && l.cmvPonderado > cmvPonderadoGeral
  }))

  return {
    linhas,
    totalVendas: Math.round(totalVendas * 100) / 100,
    totalCustoTeorico: Math.round(totalCustoTeorico * 100) / 100,
    cmvPonderadoGeral
  }
}


export async function buscarResumoParaExportEverest(mes, ano, unidadeIds = null) {
  let query = supabase
    .from('sessoes_contagem')
    .select('id, unidade_id, unidades(nome)')
    .eq('tipo', 'mensal')
    .eq('mes_referencia', mes)
    .eq('ano_referencia', ano)
    .eq('status', 'finalizada')
  if (unidadeIds?.length) query = query.in('unidade_id', unidadeIds)
  const { data: sessoes, error: e1 } = await query
  if (e1) throw e1

  const idsSessoes = sessoes.map((s) => s.id)
  const itens = idsSessoes.length
    ? await buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('sessao_id').in('sessao_id', idsSessoes))
    : []
  const itensPorSessao = new Map()
  for (const it of itens) itensPorSessao.set(it.sessao_id, (itensPorSessao.get(it.sessao_id) || 0) + 1)

  const inicioMes = `${ano}-${String(mes).padStart(2, '0')}-01`
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const fimMes = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
  const { count: totalHistorico, error: e2 } = await supabase
    .from('contagens_historicas')
    .select('*', { count: 'exact', head: true })
    .gte('registrado_em', inicioMes)
    .lte('registrado_em', fimMes)
  if (e2) throw e2

  return {
    sessoes: sessoes.map((s) => ({ loja: s.unidades?.nome || '—', itens: itensPorSessao.get(s.id) || 0 })),
    totalHistorico: unidadeIds?.length ? 0 : (totalHistorico || 0) // histórico não tem loja, só faz sentido quando exporta todas
  }
}

export async function buscarDadosParaExportEverest(mes, ano, incluirHistorico = false, unidadeIds = null) {
  const { data: unidadesData, error: e0 } = await supabase.from('unidades').select('id, nome, cnpj, codigo_deposito').eq('ativo', true)
  if (e0) throw e0

  let query = supabase
    .from('sessoes_contagem')
    .select('id, unidade_id')
    .eq('tipo', 'mensal')
    .eq('mes_referencia', mes)
    .eq('ano_referencia', ano)
    .eq('status', 'finalizada')
  if (unidadeIds?.length) query = query.in('unidade_id', unidadeIds)
  const { data: sessoes, error: e1 } = await query
  if (e1) throw e1
  const unidadePorSessao = new Map(sessoes.map((s) => [s.id, s.unidade_id]))
  const idsSessoes = sessoes.map((s) => s.id)

  const itens = idsSessoes.length
    ? await buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('sessao_id, produto_id, quantidade').in('sessao_id', idsSessoes))
    : []

  // Histórico antigo do mesmo mês/ano — só entra se explicitamente pedido, e só faz sentido
  // quando exportando todas as lojas juntas (o histórico não tem loja pra filtrar).
  let historico = []
  if (incluirHistorico && !unidadeIds?.length) {
    const inicioMes = `${ano}-${String(mes).padStart(2, '0')}-01`
    const ultimoDia = new Date(ano, mes, 0).getDate()
    const fimMes = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
    historico = await buscarTodasAsLinhas(() =>
      supabase.from('contagens_historicas').select('produto_id, quantidade').gte('registrado_em', inicioMes).lte('registrado_em', fimMes)
    )
  }

  const idsProdutos = [...new Set([...itens.map((i) => i.produto_id), ...historico.map((h) => h.produto_id)].filter(Boolean))]
  // Busca em LOTES: o Dalva soma 4 lojas e pode ter milhares de produtos distintos. Um único
  // .in() com todos os ids gera URL gigante e trava/timeout. Chunkar resolve.
  const produtos = []
  for (let i = 0; i < idsProdutos.length; i += 300) {
    const lote = idsProdutos.slice(i, i + 300)
    const { data, error: eP } = await supabase
      .from('produtos')
      .select('id, codigo_everest, nome, unidade_medida, grupo_everest, categoria')
      .in('id', lote)
    if (eP) throw eP
    if (data) produtos.push(...data)
  }
  const produtoPorId = new Map(produtos.map((p) => [p.id, p]))

  // Agrupa por EMPRESA (CNPJ) — o Everest só aceita 2 empresas (Dalva e DOM), não as 4 lojas
  // individuais. Várias lojas (Dalva e Dito, Mercadinho, RESID, Eventos) compartilham o mesmo CNPJ.
  const cnpjPorUnidade = new Map(unidadesData.map((u) => [u.id, u.cnpj]))
  const depositoPorCnpj = new Map(unidadesData.filter((u) => u.cnpj).map((u) => [u.cnpj, u.codigo_deposito]))
  function nomeEmpresa(cnpj) {
    if (!cnpj) return 'Sem CNPJ definido'
    return cnpj.replace(/\D/g, '') === '03306282000148' ? 'DOM' : 'Dalva'
  }

  const porEmpresa = new Map() // cnpj -> Map(produto_id -> quantidade)
  for (const it of itens) {
    const unidadeId = unidadePorSessao.get(it.sessao_id)
    const cnpj = cnpjPorUnidade.get(unidadeId)
    if (!cnpj) continue
    if (!porEmpresa.has(cnpj)) porEmpresa.set(cnpj, new Map())
    const mapa = porEmpresa.get(cnpj)
    mapa.set(it.produto_id, (mapa.get(it.produto_id) || 0) + (Number(it.quantidade) || 0))
  }

  // Saídas registradas durante a contagem descontam do estoque efetivo (à parte, rastreável).
  // Resiliente: se a tabela saidas_contagem ainda não existe no banco, segue sem descontar.
  let saidas = []
  if (idsSessoes.length) {
    try {
      saidas = await buscarTodasAsLinhas(() => supabase.from('saidas_contagem').select('sessao_id, produto_id, quantidade').in('sessao_id', idsSessoes))
    } catch (err) {
      console.warn('saidas_contagem indisponível; export segue sem descontar saídas.', err?.message)
      saidas = []
    }
  }
  for (const sd of saidas) {
    const unidadeId = unidadePorSessao.get(sd.sessao_id)
    const cnpj = cnpjPorUnidade.get(unidadeId)
    if (!cnpj || !porEmpresa.has(cnpj)) continue
    const mapa = porEmpresa.get(cnpj)
    if (mapa.has(sd.produto_id)) {
      mapa.set(sd.produto_id, mapa.get(sd.produto_id) - (Number(sd.quantidade) || 0))
    }
  }

  const semLoja = new Map()
  for (const h of historico) {
    if (!h.produto_id) continue
    semLoja.set(h.produto_id, (semLoja.get(h.produto_id) || 0) + (Number(h.quantidade) || 0))
  }

  function montarLinhas(mapaProdutoQtd) {
    return Array.from(mapaProdutoQtd.entries()).map(([produtoId, quantidade]) => {
      const p = produtoPorId.get(produtoId)
      return {
        grupo: p?.grupo_everest || p?.categoria || '',
        item: p?.codigo_everest || '',
        descricao: p?.nome || '',
        undM: (p?.unidade_medida || '').toUpperCase(),
        contagem: Math.max(0, Math.round(quantidade * 1000) / 1000)
      }
    })
  }

  const resultado = Array.from(porEmpresa.entries()).map(([cnpj, mapaProdutos]) => ({
    loja: nomeEmpresa(cnpj),
    cnpj,
    deposito: depositoPorCnpj.get(cnpj) || '',
    linhas: montarLinhas(mapaProdutos)
  }))

  if (semLoja.size > 0) {
    resultado.push({ loja: 'Histórico (sem loja definida)', cnpj: '', deposito: '', linhas: montarLinhas(semLoja) })
  }

  return resultado
}

// ---------- Migração do histórico antigo pro modelo novo (sessões reais com loja) ----------
const MAPA_LOCAL_PARA_LOJA = {
  'CONFEITARIA PRODUCAO DD': 'Dalva e Dito',
  'MERCADINHO SALAO': 'Mercadinho Dalva',
  'DOM BAR SALAO': 'DOM',
  'VINHOS ADEGA DD': 'Dalva e Dito',
  'CAMARA RESFRIADA HORTI': 'Dalva e Dito',
  'CAMARA CONGELADA SUPERIOR DD': 'Dalva e Dito',
  'DOM AREA 2 COZINHA': 'DOM',
  'EVENTOS SALAO SUB-SOLO': 'Eventos',
  'VINHOS BAR DD': 'Dalva e Dito',
  'EVENTOS SALAO GERAL': 'Eventos',
  'MERCADINHO ADEGA': 'Mercadinho Dalva',
  'ESTOQUE LIMPEZA DD': 'Dalva e Dito',
  'DOM CAIXA': 'DOM',
  'DOM LAVAGEM DE TACAS': 'DOM',
  'PRACA PASSE DD': 'Dalva e Dito',
  'FUNCIONARIOS COZINHA DD': 'Dalva e Dito',
  'DOM BAR ESTOQUE SUPERIOR': 'DOM',
  'DOM COZINHA LIMPEZA': 'DOM',
  'GERAL TODOS OS': 'Dalva e Dito',
  'DOM AREA 1 COZINHA': 'DOM',
  'PRODUCAO AQUARIO DD': 'Dalva e Dito',
  'EVENTOS': 'Eventos',
  'BAR DALVA SALAO': 'Dalva e Dito',
  'PRACA CONFEITARIA SERVICO DD': 'Dalva e Dito',
  'GERAL TODOS OS LOCAIS': 'Dalva e Dito'
}

export async function migrarHistoricoParaSessoes(onProgresso) {
  // Garante que a loja "Eventos" existe, compartilhando o CNPJ do Dalva.
  const { data: dalva } = await supabase.from('unidades').select('id, cnpj').eq('nome', 'Dalva e Dito').maybeSingle()
  const { data: eventosExistente } = await supabase.from('unidades').select('id').eq('nome', 'Eventos').maybeSingle()
  if (!eventosExistente) {
    await supabase.from('unidades').insert({ nome: 'Eventos', cnpj: dalva?.cnpj || null })
  }

  const { data: todasUnidades } = await supabase.from('unidades').select('id, nome')
  const idPorNomeLoja = new Map(todasUnidades.map((u) => [u.nome, u.id]))

  const historico = await buscarTodasAsLinhas(() =>
    supabase.from('contagens_historicas').select('produto_id, local_original, quantidade, registrado_em').not('registrado_em', 'is', null)
  )

  // Agrupa por (loja, ano, mes)
  const grupos = new Map()
  let semMapeamento = 0
  for (const h of historico) {
    const lojaNome = MAPA_LOCAL_PARA_LOJA[h.local_original]
    const unidadeId = lojaNome ? idPorNomeLoja.get(lojaNome) : null
    if (!unidadeId) { semMapeamento += 1; continue }
    const d = new Date(h.registrado_em)
    const chave = `${unidadeId}|${d.getFullYear()}|${d.getMonth() + 1}`
    if (!grupos.has(chave)) grupos.set(chave, { unidadeId, ano: d.getFullYear(), mes: d.getMonth() + 1, itens: [] })
    grupos.get(chave).itens.push(h)
  }

  let sessoesCriadas = 0
  let itensMigrados = 0
  let itensSemProduto = 0
  const totalGrupos = grupos.size
  let feito = 0

  for (const grupo of grupos.values()) {
    const { data: sessaoSalva, error: erroSessao } = await supabase
      .from('sessoes_contagem')
      .insert({
        unidade_id: grupo.unidadeId,
        usuario: 'Histórico (migrado)',
        tipo: 'mensal',
        mes_referencia: grupo.mes,
        ano_referencia: grupo.ano,
        status: 'finalizada',
        finalizada_em: new Date(grupo.ano, grupo.mes - 1, 28).toISOString()
      })
      .select()
      .single()
    if (erroSessao) throw erroSessao
    sessoesCriadas += 1

    const itensParaSalvar = grupo.itens
      .filter((it) => it.produto_id)
      .map((it) => ({
        sessao_id: sessaoSalva.id,
        produto_id: it.produto_id,
        modo_entrada: 'direto',
        quantidade: Number(it.quantidade) || 0
      }))
    itensSemProduto += grupo.itens.length - itensParaSalvar.length

    const tamanhoLote = 400
    for (let i = 0; i < itensParaSalvar.length; i += tamanhoLote) {
      const { error } = await supabase.from('itens_contagem').insert(itensParaSalvar.slice(i, i + tamanhoLote))
      if (error) throw error
    }
    itensMigrados += itensParaSalvar.length

    feito += 1
    onProgresso?.({ feito, total: totalGrupos })
    await new Promise((r) => setTimeout(r, 0))
  }

  return { sessoesCriadas, itensMigrados, itensSemProduto, semMapeamento }
}

export async function contarSessoesMigradas() {
  const { count, error } = await supabase.from('sessoes_contagem').select('*', { count: 'exact', head: true }).eq('usuario', 'Histórico (migrado)')
  if (error) throw error
  return count || 0
}

export async function buscarCMVReal(mes, ano) {
  let mesAnterior = mes - 1
  let anoAnterior = ano
  if (mesAnterior === 0) { mesAnterior = 12; anoAnterior = ano - 1 }

  async function buscarEstoque(mesRef, anoRef) {
    const { data: sessoes } = await supabase
      .from('sessoes_contagem').select('id')
      .eq('tipo', 'mensal').eq('mes_referencia', mesRef).eq('ano_referencia', anoRef).eq('status', 'finalizada')
    const ids = (sessoes || []).map((s) => s.id)
    if (!ids.length) return new Map()
    const itens = await buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('produto_id, quantidade').in('sessao_id', ids))
    const mapa = new Map()
    for (const it of itens) mapa.set(it.produto_id, (mapa.get(it.produto_id) || 0) + (Number(it.quantidade) || 0))
    return mapa
  }

  const [estoqueInicial, estoqueFinal] = await Promise.all([
    buscarEstoque(mesAnterior, anoAnterior),
    buscarEstoque(mes, ano)
  ])

  const inicioMes = `${ano}-${String(mes).padStart(2, '0')}-01`
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const fimMes = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`

  const { data: notas } = await supabase.from('notas_importadas').select('id').gte('data_emissao', inicioMes).lte('data_emissao', fimMes)
  const idsNotas = (notas || []).map((n) => n.id)
  const comprasItensBrutos = idsNotas.length
    ? await buscarPorIdsEmLotes((lote) => supabase.from('notas_importadas_itens').select('produto_id, codigo_everest, valor_total, valor_unitario, calcula_cmv').in('nota_id', lote), idsNotas)
    : []
  // "Calcula CMV = NÃO" é o próprio Everest marcando item fora do custo (ex.: administrativo) — excluído do CMV Real.
  const comprasItensFiltrados = comprasItensBrutos.filter((c) => c.calcula_cmv !== false)
  // 14/08/2026 (6): mesma FK órfã já corrigida em Curva de Vendas/Consumo Teórico/Margem por Prato
  // (ver §5/§8), agora aplicada aqui — `notas_importadas_itens.produto_id` é um retrato de qual
  // produto existia no momento do import; se `produtos` foi zerado/reimportado depois (comum na
  // faxina de agosto), o id gravado fica órfão mesmo a compra estando certa. Resolve pelo
  // `codigo_everest` (gravado por linha desde `migration_v9.sql`, ver `importarComprasEverest`) no
  // cadastro ATUAL — com fallback pro `produto_id` gravado só nas linhas antigas, importadas antes
  // da migração, que ainda não têm `codigo_everest` salvo.
  const idAtualPorCodigoCompra = await resolverIdsPorCodigoEverest(comprasItensFiltrados.map((c) => c.codigo_everest))
  const comprasItens = comprasItensFiltrados.map((c) => ({
    ...c,
    produtoIdAtual: (c.codigo_everest && idAtualPorCodigoCompra.get(c.codigo_everest)) || c.produto_id
  }))

  // Vendas filtradas por data_movimento no ITEM (não pelo header do arquivo importado — ver nota
  // em buscarCurvaDeVendas), excluindo canceladas.
  const vendasItensBrutos = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('produto_id, grupo_venda, quantidade, valor_total, valor_unitario, cancelado')
      .gte('data_movimento', inicioMes).lte('data_movimento', fimMes)
  )
  const vendasItens = vendasItensBrutos.filter((v) => !v.cancelado)

  // Custo médio por produto — usado pra valorizar o estoque contado (que só tem quantidade)
  // 14/08/2026 (5): essa consulta não era paginada em lotes (diferente de resolverIdsPorCodigoEverest/
  // resolverFichasPorCodigoEverest, que já batiam nesse mesmo limite antes) e não checava `error` —
  // com a empresa toda (sem filtro de loja/grupo, convenção já usada aqui) e vários meses somados
  // (a nova aba "Saldo no tempo" chama isso 6x, 1 por mês), a lista de ids passou do limite de URL
  // do PostgREST numa consulta única, o Supabase devolveu `data: null` com erro, e sem o `if (error)`
  // isso ia direto pro `.map` de um valor null — exatamente o "Cannot read properties of null
  // (reading 'map')" que o Felipe viu. Agora bate em lotes de 300 (mesmo tamanho já usado nos outros
  // dois resolvers) e propaga erro de verdade em vez de deixar `data` virar null em silêncio.
  const idsProdutos = [...new Set([...estoqueInicial.keys(), ...estoqueFinal.keys(), ...comprasItens.map((c) => c.produtoIdAtual)].filter(Boolean))]
  const produtos = []
  const TAMANHO_LOTE_PRODUTOS = 300
  for (let i = 0; i < idsProdutos.length; i += TAMANHO_LOTE_PRODUTOS) {
    const lote = idsProdutos.slice(i, i + TAMANHO_LOTE_PRODUTOS)
    const { data, error } = await supabase.from('produtos').select('id, grupo_everest').in('id', lote)
    if (error) throw error
    produtos.push(...(data || []))
  }
  const grupoPorProduto = new Map(produtos.map((p) => [p.id, p.grupo_everest || 'Sem grupo']))
  // 14/08/2026 (6): quem existe HOJE em `produtos`, entre os ids referenciados pela contagem física
  // — usado abaixo pra separar "sem custo por falta de compra recente" de "produto_id órfão"
  // (contagem antiga referenciando um produto que não existe mais no cadastro atual, ver §8).
  const idsProdutosExistentes = new Set(produtos.map((p) => p.id))

  // 17/08/2026: o custo usado pra valorizar o estoque CONTADO não pode ficar restrito só às
  // compras DESSE mês (era assim antes — `custoPorProduto` só olhava `comprasItens`, já filtrado
  // por inicioMes..fimMes). Um insumo sem compra no mês exato ficava sem preço e `valorizar()`
  // pulava ele inteiro (`if (custo == null) continue`) — fazendo esse item "desaparecer" do
  // estoque valorizado num mês e "voltar" com valor cheio no mês seguinte só porque a compra caiu
  // num mês e não no outro. Isso é um ARTEFATO DE CÁLCULO, não uma variação real de estoque — e foi
  // a causa real dos saltos de R$1M+ no "Saldo no tempo" que o Felipe reportou (a FK-órfã corrigida
  // em 14/08 (6)/(7) era um problema de verdade, mas secundário; os saltos continuaram do mesmo
  // jeito depois daquele fix, o que devia ter sido o sinal de que a causa principal era outra).
  // Corrigido aplicando o MESMO princípio já usado em `buscarHistoricoDeFicha` (pedido original do
  // Felipe lá: "o que importa é o mês que foi comprado o item... repete o último preço se não
  // houver compra no mês") — preço = da compra MAIS RECENTE conhecida até o fim do mês analisado
  // (`fimMes`), forward-fill, casado por `codigo_everest` (não por `produto_id`, mesma razão da
  // FK-órfã de sempre). Sem limite inferior de data de propósito — histórico de compras dessa
  // empresa ainda é curto; se um dia isso pesar, dá pra limitar a uns 12 meses pra trás.
  const { data: notasAteFim, error: erroNotasAteFim } = await supabase
    .from('notas_importadas').select('id, data_emissao').lte('data_emissao', fimMes)
  if (erroNotasAteFim) throw erroNotasAteFim
  const dataEmissaoPorNota = new Map((notasAteFim || []).map((n) => [n.id, n.data_emissao]))
  const idsNotasAteFim = [...dataEmissaoPorNota.keys()]
  // 19/08/2026: essa consulta não era paginada em lotes (o comentário acima até apostava que o
  // histórico "ainda é curto" — não é mais) e o Felipe bateu exatamente no mesmo problema já
  // documentado no comentário de 14/08/2026 (5) acima: `idsNotasAteFim` cresce com TODO o
  // histórico de notas (sem limite inferior de data), passou do limite de URL do PostgREST numa
  // consulta única, e voltou "Bad Request" ao clicar em Calcular na Exportação contábil. Corrigido
  // batendo em lotes de 300 (mesmo tamanho já usado em `resolverIdsPorCodigoEverest` e no bloco de
  // produtos acima) — mesmo princípio, outra consulta que cresce sem filtro de mês.
  const comprasParaCustoBrutas = []
  const TAMANHO_LOTE_NOTAS = 300
  for (let i = 0; i < idsNotasAteFim.length; i += TAMANHO_LOTE_NOTAS) {
    const loteNotas = idsNotasAteFim.slice(i, i + TAMANHO_LOTE_NOTAS)
    const linhasLote = await buscarTodasAsLinhas(() =>
      supabase.from('notas_importadas_itens').select('nota_id, produto_id, codigo_everest, valor_unitario, calcula_cmv').in('nota_id', loteNotas)
    )
    comprasParaCustoBrutas.push(...linhasLote)
  }
  const comprasParaCustoFiltradas = comprasParaCustoBrutas.filter((c) => c.calcula_cmv !== false && c.valor_unitario != null)
  const idAtualPorCodigoCusto = await resolverIdsPorCodigoEverest(comprasParaCustoFiltradas.map((c) => c.codigo_everest))
  const ultimaCompraPorProduto = new Map() // produtoIdAtual -> { data, preco } da compra mais recente conhecida
  for (const c of comprasParaCustoFiltradas) {
    const produtoIdAtual = (c.codigo_everest && idAtualPorCodigoCusto.get(c.codigo_everest)) || c.produto_id
    const data = dataEmissaoPorNota.get(c.nota_id)
    if (!produtoIdAtual || !data) continue
    const atual = ultimaCompraPorProduto.get(produtoIdAtual)
    if (!atual || data > atual.data) ultimaCompraPorProduto.set(produtoIdAtual, { data, preco: Number(c.valor_unitario) })
  }
  const custoMedioPorProduto = new Map()
  for (const [produtoId, { preco }] of ultimaCompraPorProduto) custoMedioPorProduto.set(produtoId, preco)

  function valorizar(mapaQuantidade) {
    const porGrupo = new Map()
    for (const [produtoId, qtd] of mapaQuantidade) {
      const custo = custoMedioPorProduto.get(produtoId)
      if (custo == null) continue // sem compra recente pra saber o custo, não dá pra valorizar esse item ainda
      const grupo = grupoPorProduto.get(produtoId) || 'Sem grupo'
      porGrupo.set(grupo, (porGrupo.get(grupo) || 0) + qtd * custo)
    }
    return porGrupo
  }

  const inicialPorGrupo = valorizar(estoqueInicial)
  const finalPorGrupo = valorizar(estoqueFinal)

  const comprasPorGrupo = new Map()
  for (const c of comprasItens) {
    const grupo = grupoPorProduto.get(c.produtoIdAtual) || 'Sem grupo'
    comprasPorGrupo.set(grupo, (comprasPorGrupo.get(grupo) || 0) + (Number(c.valor_total) || 0))
  }

  const vendasPorGrupo = new Map()
  for (const v of vendasItens) {
    const grupo = v.grupo_venda || 'Sem grupo'
    // 11/08/2026, pedido do Felipe: valor bruto de venda (item + gorjeta) — ver `valorVenda`.
    vendasPorGrupo.set(grupo, (vendasPorGrupo.get(grupo) || 0) + valorVenda(v))
  }

  const grupos = new Set([...inicialPorGrupo.keys(), ...finalPorGrupo.keys(), ...comprasPorGrupo.keys(), ...vendasPorGrupo.keys()])
  const linhas = Array.from(grupos).map((grupo) => {
    const inicial = inicialPorGrupo.get(grupo) || 0
    const compras = comprasPorGrupo.get(grupo) || 0
    const final = finalPorGrupo.get(grupo) || 0
    const vendasValor = vendasPorGrupo.get(grupo) || 0
    const cmvValor = inicial + compras - final
    return {
      grupo,
      estoqueInicial: Math.round(inicial * 100) / 100,
      compras: Math.round(compras * 100) / 100,
      estoqueFinal: Math.round(final * 100) / 100,
      vendas: Math.round(vendasValor * 100) / 100,
      cmvValor: Math.round(cmvValor * 100) / 100,
      cmvPercentual: vendasValor > 0 ? Math.round((cmvValor / vendasValor) * 10000) / 100 : null
    }
  }).sort((a, b) => b.vendas - a.vendas)

  const idsContadosUnicos = [...new Set([...estoqueInicial.keys(), ...estoqueFinal.keys()])]
  const totalItensSemCusto = idsContadosUnicos.filter((id) => !custoMedioPorProduto.has(id)).length
  // 14/08/2026 (6): dos itens contados sem custo, quantos são por um motivo mais grave — o
  // `produto_id` gravado na contagem nem existe mais no cadastro atual de Produtos (órfão de
  // verdade, ver §5/§8) — versus só não ter tido compra recente (produto existe, só falta preço
  // fresco). `itens_contagem` nunca grava `codigo_everest` por linha (diferente de Vendas/Compras),
  // então esse caso não tem como ser corrigido só resolvendo por código — se o produto foi
  // zerado/reimportado depois da contagem, o vínculo daquela linha antiga se perde de vez. Contar
  // e mostrar esse número (em vez de deixar ele escondido dentro de "sem custo médio" genérico) é o
  // jeito de saber se vale a pena investigar mais ou não.
  const totalItensOrfaos = idsContadosUnicos.filter((id) => !idsProdutosExistentes.has(id)).length
  // 14/08/2026 (8): total de itens contados no mês (denominador) — junto com `totalItensOrfaos`,
  // dá pra calcular um PERCENTUAL de itens órfãos por mês (não só a contagem absoluta), usado pela
  // aba "Saldo no tempo" pra decidir/deixar o Felipe decidir quais meses marcar como pouco confiáveis.
  const totalItensContados = idsContadosUnicos.length

  return { linhas, totalItensSemCusto, totalItensOrfaos, totalItensContados, mesAnterior, anoAnterior }
}

// ---------------------------------------------------------------------------
// 18/08/2026 — Exportação contábil (Resumo A&B), pedido do Felipe: todo mês ele manda pro
// contador uma planilha ("01 - CMV Inventário DOM") com Estoque Inicial/Compras/Estoque
// Final/Custo Bruto/Vendas/%CMV, por 4 categorias (Alimentos, Bebidas Leves, Bebidas Alcoólicas,
// Vinhos) — hoje montada manualmente, com dado que ele mesmo já disse não confiar 100%. Pedido:
// "gerar algo parecido com os dados que temos na nossa base". A planilha original classifica cada
// item numa dessas 4 categorias através de uma tabela de apoio (aba "Apoio" da planilha que ele
// mandou como exemplo) — replicada abaixo como 2 mapas fixos: 1 pro subgrupo_everest (usado por
// Estoque e Compras, que compartilham a mesma taxonomia de produto) e 1 pro grupo de venda (usado
// só por Vendas, que tem sua própria taxonomia comercial, ex. "Aguas"/"Cervejas"/"Vinho Tinto" —
// diferente do subgrupo do cadastro). Normalização (maiúsculo, sem acento, pontuação -> espaço)
// porque a mesma taxonomia aparece com separador diferente em cada lugar (ex. "MP | SECOS" na
// planilha do Felipe vs "MP - SECOS" no nosso `subgrupo_everest`, ver §22 do doc principal) —
// comparar só a "essência" alfanumérica evita que isso quebre o casamento.
//
// Decisão do Felipe (18/08/2026): por agora, Créditos ao custo (Perda PDV, Perdas Almoxarifado,
// Consumo Interno, Cortesias, Teste Cozinha, Alimentação Equipe) ficam DE FORA do cálculo — a
// tela mostra Custo BRUTO (sem descontar nada disso), não "Custo Líquido". Quando/se ele quiser
// que isso entre (ver §8 do doc principal — Perdas ainda não tem valorização em R$ nem separa
// PDV de Almoxarifado), essa conta pode ser somada aqui como um desconto adicional.
function normalizarChaveTipoAB(texto) {
  return String(texto || '')
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

// subgrupo_everest -> Tipo A&B (null = fora do escopo Alimentos&Bebidas, ex. limpeza/descartável —
// não é erro, a planilha original também só tem essas 4 categorias, o resto nunca entrava na conta).
const TIPOS_AB_POR_SUBGRUPO_RAW = [
  ['BEBIDAS QUENTES | CAFES E CHAS', 'Bebidas Leves'],
  ['BEBIDAS SOFT | AGUAS', 'Bebidas Leves'],
  ['BEBIDAS SOFT | REFRIGERANTES', 'Bebidas Leves'],
  ['CERVEJAS', 'Bebidas Alcoólicas'],
  ['DESTILADOS | APERITIVOS', 'Bebidas Alcoólicas'],
  ['DESTILADOS | CACHACAS E AGUARDENTES', 'Bebidas Alcoólicas'],
  ['DESTILADOS | CONHAQUES', 'Bebidas Alcoólicas'],
  ['DESTILADOS | GINS', 'Bebidas Alcoólicas'],
  ['DESTILADOS | LICORES', 'Bebidas Alcoólicas'],
  ['DESTILADOS | RUMS', 'Bebidas Alcoólicas'],
  ['DESTILADOS | TEQUILAS', 'Bebidas Alcoólicas'],
  ['DESTILADOS | VERMUTES', 'Bebidas Alcoólicas'],
  ['DESTILADOS | VODKAS', 'Bebidas Alcoólicas'],
  ['DESTILADOS | WHISKIES', 'Bebidas Alcoólicas'],
  ['DESTILADOS | BRANDY', 'Bebidas Alcoólicas'],
  ['DESTILADOS | SAQUES', 'Bebidas Alcoólicas'],
  ['GELO', 'Bebidas Alcoólicas'],
  ['HIGIENE E LIMPEZA', null],
  ['ITEM PARADO EM ESTOQUE | FORA DE USO', 'Alimentos'],
  ['ITEM PARADO EM ESTOQUE | SOBRA EVENTO', 'Alimentos'],
  ['ITEM PARADO EM ESTOQUE | SOBRA MENU', 'Alimentos'],
  ['ITEM PARADO EM ESTOQUE | TESTE', null],
  ['MATERIAIS DESCARTAVEIS', null],
  ['MC | CASA E DECORACAO', null],
  ['MC | CONFEITARIA E PANIFICACAO', 'Alimentos'],
  ['MC | PRODUTOS TERCEIROS AEB', null],
  ['MP | CARNES BRANCAS', 'Alimentos'],
  ['MP | CARNES VERMELHAS', 'Alimentos'],
  ['MP | FRIOS E LATICINIOS', 'Alimentos'],
  ['MP | HORTIFRUTIS', 'Alimentos'],
  ['MP | MASSAS E PAES', 'Alimentos'],
  ['MP | PEIXES E FRUTOS DO MAR', 'Alimentos'],
  ['MP | SECOS', 'Alimentos'],
  ['MP | SUCOS E POLPAS', 'Bebidas Leves'],
  ['PRE PREPARO', 'Alimentos'],
  ['PRE PREPARO BAR', 'Bebidas Leves'],
  ['VINHOS BRANCOS', 'Vinhos'],
  ['VINHOS CHAMPAGNES', 'Vinhos'],
  ['VINHOS ESPUMANTES', 'Vinhos'],
  ['VINHOS LARANJAS', 'Vinhos'],
  ['VINHOS LICOROSOS', 'Vinhos'],
  ['VINHOS ROSES', 'Vinhos'],
  ['VINHOS SOBREMESA', 'Vinhos'],
  ['VINHOS TINTOS', 'Vinhos'],
  ['VINHOS FORTIFICADOS', 'Vinhos'],
  ['TINTOS | RED', 'Vinhos']
]
const MAPA_TIPO_AB_POR_SUBGRUPO = new Map(TIPOS_AB_POR_SUBGRUPO_RAW.map(([k, v]) => [normalizarChaveTipoAB(k), v]))

export function tipoContabilPorSubgrupo(subgrupoEverest) {
  const chave = normalizarChaveTipoAB(subgrupoEverest)
  if (!chave || !MAPA_TIPO_AB_POR_SUBGRUPO.has(chave)) return null
  return MAPA_TIPO_AB_POR_SUBGRUPO.get(chave)
}

// grupo de venda (mesmo texto que já aparece na coluna "Grupo" da Curva de Vendas — ver
// `subgrupoDeVenda`) -> Tipo A&B. Taxonomia comercial, diferente da taxonomia de cadastro acima.
const TIPOS_AB_POR_GRUPO_VENDA_RAW = [
  ['Acompanhamentos', 'Alimentos'], ['Aguardentes e Cachacas', 'Bebidas Alcoólicas'], ['Aguas', 'Bebidas Leves'],
  ['Base para Drinks', 'Bebidas Alcoólicas'], ['BEBIDAS LEVES RB', 'Bebidas Leves'], ['Cafes', 'Bebidas Leves'],
  ['Carnes', 'Alimentos'], ['Cervejas', 'Bebidas Alcoólicas'], ['Cervejas RB', 'Bebidas Alcoólicas'],
  ['Condimentos / Ervas / Especiar', 'Alimentos'], ['Confeitaria Producao Interna', 'Alimentos'],
  ['Destilados Geral', 'Bebidas Alcoólicas'], ['Drinks', 'Bebidas Alcoólicas'], ['Drinks RB', 'Bebidas Alcoólicas'],
  ['Entradas', 'Alimentos'], ['Espumantes e Champagne', 'Vinhos'], ['Espumantes e Champagne RB', 'Vinhos'],
  ['Frutas Frescas', 'Alimentos'], ['Guarnições', 'Alimentos'], ['Itens de Mercearia', 'Alimentos'],
  ['MENU DALVA', 'Alimentos'], ['Outros', 'Alimentos'], ['Outros materiais', 'Alimentos'],
  ['Padaria Producao Interna', 'Alimentos'], ['PORÇOES RB', 'Alimentos'], ['Principais', 'Alimentos'],
  ['Principais Mercadinho', 'Alimentos'], ['Produtos de Terceiros', 'Alimentos'], ['Refrigerantes', 'Bebidas Leves'],
  ['Salgados', 'Alimentos'], ['Sanduiches', 'Alimentos'], ['Sobremesa', 'Alimentos'], ['SOBREMESA RB', 'Alimentos'],
  ['Sucos', 'Bebidas Leves'], ['Sucos RB', 'Bebidas Leves'], ['Take Away', 'Alimentos'],
  ['Vinho Branco', 'Vinhos'], ['Vinho Branco RB', 'Vinhos'], ['Vinho Rose', 'Vinhos'], ['Vinho Tinto', 'Vinhos'],
  ['Vinho Tinto RB', 'Vinhos'], ['Whiskies', 'Bebidas Alcoólicas'], ['Bebidas para Cozinha e Bar', 'Bebidas Alcoólicas'],
  ['EVENTO RB', 'Alimentos'], ['Menu Eventos', 'Alimentos'], ['Paes', 'Alimentos'], ['Vinho Rose e Laranja RB', 'Vinhos'],
  ['Assados', 'Alimentos'], ['Chas', 'Bebidas Leves'], ['Compotas e Geleias', 'Alimentos'], ['Especial do Dia', 'Alimentos'],
  ['Grao e Cereais', 'Alimentos'], ['Menu Executivo', 'Alimentos'], ['Nossos Pratos', 'Alimentos'],
  ['Páscoa Mercadinho', 'Alimentos'], ['Saladas', 'Alimentos'], ['Sobremesas', 'Alimentos'], ['Harmonização', 'Vinhos'],
  ['Vinho Sobremesa e Fortificado', 'Vinhos'], ['Eventos Dom', 'Alimentos'], ['TINTOS | RED', 'Vinhos']
]
const MAPA_TIPO_AB_POR_GRUPO_VENDA = new Map(TIPOS_AB_POR_GRUPO_VENDA_RAW.map(([k, v]) => [normalizarChaveTipoAB(k), v]))

export function tipoContabilPorGrupoVenda(grupoVenda) {
  const chave = normalizarChaveTipoAB(subgrupoDeVenda(grupoVenda))
  if (!chave || !MAPA_TIPO_AB_POR_GRUPO_VENDA.has(chave)) return null
  return MAPA_TIPO_AB_POR_GRUPO_VENDA.get(chave)
}

export const TIPOS_AB_ORDEM = ['Alimentos', 'Bebidas Leves', 'Bebidas Alcoólicas', 'Vinhos']
const SEM_CATEGORIA_AB = 'Fora de Alimentos & Bebidas'

export async function buscarResumoContabil(mes, ano) {
  let mesAnterior = mes - 1
  let anoAnterior = ano
  if (mesAnterior === 0) { mesAnterior = 12; anoAnterior = ano - 1 }

  async function buscarEstoque(mesRef, anoRef) {
    const { data: sessoes } = await supabase
      .from('sessoes_contagem').select('id')
      .eq('tipo', 'mensal').eq('mes_referencia', mesRef).eq('ano_referencia', anoRef).eq('status', 'finalizada')
    const ids = (sessoes || []).map((s) => s.id)
    if (!ids.length) return new Map()
    const itens = await buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('produto_id, quantidade').in('sessao_id', ids))
    const mapa = new Map()
    for (const it of itens) mapa.set(it.produto_id, (mapa.get(it.produto_id) || 0) + (Number(it.quantidade) || 0))
    return mapa
  }

  const [estoqueInicial, estoqueFinal] = await Promise.all([
    buscarEstoque(mesAnterior, anoAnterior),
    buscarEstoque(mes, ano)
  ])

  const inicioMes = `${ano}-${String(mes).padStart(2, '0')}-01`
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const fimMes = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`

  const { data: notas } = await supabase.from('notas_importadas').select('id').gte('data_emissao', inicioMes).lte('data_emissao', fimMes)
  const idsNotas = (notas || []).map((n) => n.id)
  const comprasItensBrutos = idsNotas.length
    ? await buscarPorIdsEmLotes((lote) => supabase.from('notas_importadas_itens').select('produto_id, codigo_everest, valor_total, calcula_cmv').in('nota_id', lote), idsNotas)
    : []
  const comprasItensFiltrados = comprasItensBrutos.filter((c) => c.calcula_cmv !== false)
  const idAtualPorCodigoCompra = await resolverIdsPorCodigoEverest(comprasItensFiltrados.map((c) => c.codigo_everest))
  const comprasItens = comprasItensFiltrados.map((c) => ({
    ...c,
    produtoIdAtual: (c.codigo_everest && idAtualPorCodigoCompra.get(c.codigo_everest)) || c.produto_id
  }))

  // Vendas filtradas por data_movimento no ITEM, excluindo canceladas — mesmo padrão de sempre.
  const vendasItensBrutos = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('grupo_venda, valor_total, valor_unitario, quantidade, cancelado')
      .gte('data_movimento', inicioMes).lte('data_movimento', fimMes)
  )
  const vendasItens = vendasItensBrutos.filter((v) => !v.cancelado)

  const idsProdutos = [...new Set([...estoqueInicial.keys(), ...estoqueFinal.keys(), ...comprasItens.map((c) => c.produtoIdAtual)].filter(Boolean))]
  const produtos = []
  const TAMANHO_LOTE_PRODUTOS = 300
  for (let i = 0; i < idsProdutos.length; i += TAMANHO_LOTE_PRODUTOS) {
    const lote = idsProdutos.slice(i, i + TAMANHO_LOTE_PRODUTOS)
    const { data, error } = await supabase.from('produtos').select('id, subgrupo_everest').in('id', lote)
    if (error) throw error
    produtos.push(...(data || []))
  }
  const tipoPorProduto = new Map(produtos.map((p) => [p.id, tipoContabilPorSubgrupo(p.subgrupo_everest) || SEM_CATEGORIA_AB]))
  const idsProdutosExistentes = new Set(produtos.map((p) => p.id))

  // Custo médio por produto (forward-fill — mesmo princípio de `buscarCMVReal`, ver comentário lá:
  // preço da compra mais recente conhecida até o fim do mês, casado por `codigo_everest`) pra
  // valorizar o estoque contado (que só tem quantidade).
  const { data: notasAteFim, error: erroNotasAteFim } = await supabase
    .from('notas_importadas').select('id, data_emissao').lte('data_emissao', fimMes)
  if (erroNotasAteFim) throw erroNotasAteFim
  const dataEmissaoPorNota = new Map((notasAteFim || []).map((n) => [n.id, n.data_emissao]))
  const idsNotasAteFim = [...dataEmissaoPorNota.keys()]
  // 19/08/2026: essa consulta não era paginada em lotes (o comentário acima até apostava que o
  // histórico "ainda é curto" — não é mais) e o Felipe bateu exatamente no mesmo problema já
  // documentado no comentário de 14/08/2026 (5) acima: `idsNotasAteFim` cresce com TODO o
  // histórico de notas (sem limite inferior de data), passou do limite de URL do PostgREST numa
  // consulta única, e voltou "Bad Request" ao clicar em Calcular na Exportação contábil. Corrigido
  // batendo em lotes de 300 (mesmo tamanho já usado em `resolverIdsPorCodigoEverest` e no bloco de
  // produtos acima) — mesmo princípio, outra consulta que cresce sem filtro de mês.
  const comprasParaCustoBrutas = []
  const TAMANHO_LOTE_NOTAS = 300
  for (let i = 0; i < idsNotasAteFim.length; i += TAMANHO_LOTE_NOTAS) {
    const loteNotas = idsNotasAteFim.slice(i, i + TAMANHO_LOTE_NOTAS)
    const linhasLote = await buscarTodasAsLinhas(() =>
      supabase.from('notas_importadas_itens').select('nota_id, produto_id, codigo_everest, valor_unitario, calcula_cmv').in('nota_id', loteNotas)
    )
    comprasParaCustoBrutas.push(...linhasLote)
  }
  const comprasParaCustoFiltradas = comprasParaCustoBrutas.filter((c) => c.calcula_cmv !== false && c.valor_unitario != null)
  const idAtualPorCodigoCusto = await resolverIdsPorCodigoEverest(comprasParaCustoFiltradas.map((c) => c.codigo_everest))
  const ultimaCompraPorProduto = new Map()
  for (const c of comprasParaCustoFiltradas) {
    const produtoIdAtual = (c.codigo_everest && idAtualPorCodigoCusto.get(c.codigo_everest)) || c.produto_id
    const data = dataEmissaoPorNota.get(c.nota_id)
    if (!produtoIdAtual || !data) continue
    const atual = ultimaCompraPorProduto.get(produtoIdAtual)
    if (!atual || data > atual.data) ultimaCompraPorProduto.set(produtoIdAtual, { data, preco: Number(c.valor_unitario) })
  }
  const custoMedioPorProduto = new Map()
  for (const [produtoId, { preco }] of ultimaCompraPorProduto) custoMedioPorProduto.set(produtoId, preco)

  function valorizarPorTipo(mapaQuantidade) {
    const porTipo = new Map()
    for (const [produtoId, qtd] of mapaQuantidade) {
      const custo = custoMedioPorProduto.get(produtoId)
      if (custo == null) continue // sem compra recente pra saber o custo — não dá pra valorizar ainda
      const tipo = tipoPorProduto.get(produtoId) || SEM_CATEGORIA_AB
      porTipo.set(tipo, (porTipo.get(tipo) || 0) + qtd * custo)
    }
    return porTipo
  }

  const inicialPorTipo = valorizarPorTipo(estoqueInicial)
  const finalPorTipo = valorizarPorTipo(estoqueFinal)

  const comprasPorTipo = new Map()
  for (const c of comprasItens) {
    const tipo = tipoPorProduto.get(c.produtoIdAtual) || SEM_CATEGORIA_AB
    comprasPorTipo.set(tipo, (comprasPorTipo.get(tipo) || 0) + (Number(c.valor_total) || 0))
  }

  const vendasPorTipo = new Map()
  for (const v of vendasItens) {
    const tipo = tipoContabilPorGrupoVenda(v.grupo_venda) || SEM_CATEGORIA_AB
    // Valor bruto de venda (item + gorjeta de 13%) — mesma convenção já usada em todo o app, ver `valorVenda`.
    vendasPorTipo.set(tipo, (vendasPorTipo.get(tipo) || 0) + valorVenda(v))
  }

  const todosOsTipos = [...TIPOS_AB_ORDEM, SEM_CATEGORIA_AB]
  const linhas = todosOsTipos.map((tipo) => {
    const inicial = inicialPorTipo.get(tipo) || 0
    const compras = comprasPorTipo.get(tipo) || 0
    const final = finalPorTipo.get(tipo) || 0
    const vendas = vendasPorTipo.get(tipo) || 0
    const custoBruto = inicial + compras - final
    return {
      tipo,
      estoqueInicial: Math.round(inicial * 100) / 100,
      compras: Math.round(compras * 100) / 100,
      estoqueFinal: Math.round(final * 100) / 100,
      custoBruto: Math.round(custoBruto * 100) / 100,
      vendas: Math.round(vendas * 100) / 100,
      percentualCusto: vendas > 0 ? Math.round((custoBruto / vendas) * 10000) / 100 : null
    }
  })

  const linhasAB = linhas.filter((l) => l.tipo !== SEM_CATEGORIA_AB)
  const linhaSemCategoria = linhas.find((l) => l.tipo === SEM_CATEGORIA_AB)
  const total = linhasAB.reduce((acc, l) => ({
    estoqueInicial: acc.estoqueInicial + l.estoqueInicial,
    compras: acc.compras + l.compras,
    estoqueFinal: acc.estoqueFinal + l.estoqueFinal,
    custoBruto: acc.custoBruto + l.custoBruto,
    vendas: acc.vendas + l.vendas
  }), { estoqueInicial: 0, compras: 0, estoqueFinal: 0, custoBruto: 0, vendas: 0 })
  for (const k of ['estoqueInicial', 'compras', 'estoqueFinal', 'custoBruto', 'vendas']) total[k] = Math.round(total[k] * 100) / 100
  total.percentualCusto = total.vendas > 0 ? Math.round((total.custoBruto / total.vendas) * 10000) / 100 : null

  const idsContadosUnicos = [...new Set([...estoqueInicial.keys(), ...estoqueFinal.keys()])]
  const totalItensSemCusto = idsContadosUnicos.filter((id) => !custoMedioPorProduto.has(id)).length
  const totalItensOrfaos = idsContadosUnicos.filter((id) => !idsProdutosExistentes.has(id)).length

  return { linhas: linhasAB, linhaSemCategoria, total, totalItensSemCusto, totalItensOrfaos, mesAnterior, anoAnterior }
}

// ---------------------------------------------------------------------------
// 18/08/2026 — Import de NCM por produto (pedido do Felipe, junto com a Exportação contábil acima:
// "acho que a parte do ncm tbm"). A planilha que ele mandou como exemplo (aba "NCM" de um arquivo
// maior, "Registro de Inventário") não tem cabeçalho de coluna nomeado — é um cabeçalho de empresa
// (razão social/endereço/inscrição estadual) seguido direto das linhas de dado. Por isso, diferente
// dos outros imports (que casam coluna por NOME), este reconhece a linha de dado pelo FORMATO:
// alguma célula é um código de produto (dígitos, 4 a 8 caracteres — bate com codigo_everest) e
// alguma célula bate com o padrão de NCM (dígitos com ponto, ex. "2008.20.10"). Linha que não bate
// nesse formato é ignorada — e contada, nunca some em silêncio (mesmo princípio de sempre).
const REGEX_NCM = /^\d{4}\.\d{2}(\.\d{2})?$/
const REGEX_CODIGO_PRODUTO = /^\d{4,8}$/

export async function importarNcm(linhasPlanilha, onProgresso) {
  const porCodigo = new Map()
  let linhasIgnoradas = 0
  for (const linha of linhasPlanilha) {
    if (!Array.isArray(linha) || linha.length === 0) continue
    const celulas = linha.map((c) => (c == null ? '' : String(c).trim()))
    const codigo = celulas.find((c) => REGEX_CODIGO_PRODUTO.test(c))
    const ncm = celulas.find((c) => REGEX_NCM.test(c))
    if (!codigo || !ncm) {
      if (celulas.some((c) => c)) linhasIgnoradas++
      continue
    }
    porCodigo.set(codigo, ncm)
  }
  if (porCodigo.size === 0) {
    throw new Error('Não encontrei nenhuma linha no formato código + NCM nessa planilha.')
  }

  let atualizados = 0
  let semCorrespondencia = 0
  let feito = 0
  const total = porCodigo.size
  for (const [codigo, ncm] of porCodigo) {
    const { data, error } = await supabase.from('produtos').update({ ncm }).eq('codigo_everest', codigo).select('id')
    if (error) throw error
    if (data && data.length > 0) atualizados++
    else semCorrespondencia++
    feito++
    if (onProgresso && feito % 20 === 0) onProgresso({ feito, total })
  }
  if (onProgresso) onProgresso({ feito: total, total })

  return { linhasLidas: linhasPlanilha.length, codigosEncontrados: porCodigo.size, atualizados, semCorrespondencia, linhasIgnoradas }
}

// Lista de produtos de venda (pratos/bebidas — a categoria que entra em nota fiscal) com o NCM já
// importado — usada pela aba NCM da Exportação contábil. Ordenada por nome pra ficar fácil de
// revisar/exportar. Não filtra por `ncm is not null` de propósito — quem ainda não tem NCM
// cadastrado precisa aparecer também, pra ficar visível o que falta (nunca escondido em silêncio).
export async function buscarProdutosParaNcm() {
  const produtos = await buscarTodasAsLinhas(() =>
    supabase.from('produtos').select('codigo_everest, nome, ncm, categoria').eq('categoria', 'venda').order('nome')
  )
  return produtos
}

export async function buscarCMVPonderado(mes, ano) {
  const inicioMes = `${ano}-${String(mes).padStart(2, '0')}-01`
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const fimMes = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`

  const itensVendidosBrutos = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('produto_id, grupo_venda, quantidade, valor_total, valor_unitario, cancelado')
      .gte('data_movimento', inicioMes).lte('data_movimento', fimMes)
  )
  const itensVendidos = itensVendidosBrutos.filter((v) => !v.cancelado)
  if (!itensVendidos.length) return { linhas: [], totalVendas: 0, totalCustoTeorico: 0 }

  const idsProdutosVendidos = [...new Set(itensVendidos.map((i) => i.produto_id).filter(Boolean))]
  const fichas = await buscarPorIdsEmLotes(
    (lote) => supabase.from('fichas_tecnicas').select('produto_id, nome, quantidade_producao, custo_producao').in('produto_id', lote),
    idsProdutosVendidos
  )
  const fichaPorProduto = new Map((fichas || []).map((f) => [f.produto_id, f]))
  const fichasIncompletas = await fichasTravadasIncompletas()

  const porGrupo = new Map()
  for (const it of itensVendidos) {
    const grupo = it.grupo_venda || 'Sem grupo'
    if (!porGrupo.has(grupo)) porGrupo.set(grupo, { vendas: 0, custoTeorico: 0, semFicha: 0 })
    const g = porGrupo.get(grupo)
    // 11/08/2026, pedido do Felipe: valor bruto de venda (item + gorjeta) — ver `valorVenda`.
    g.vendas += valorVenda(it)

    const ficha = fichaPorProduto.get(it.produto_id)
    // Trava de custo (ver `aplicarTravaDeCusto`) — efeito imediato, sem esperar reimportação.
    const custoPorUnidade = ficha?.quantidade_producao
      ? aplicarTravaDeCusto(ficha.nome, Number(ficha.custo_producao) / Number(ficha.quantidade_producao), fichasIncompletas.has(normalizarNomeFicha(ficha.nome)))
      : 0
    if (custoPorUnidade > 0) {
      g.custoTeorico += custoPorUnidade * (Number(it.quantidade) || 0)
    } else {
      g.semFicha += 1
    }
  }

  const linhas = Array.from(porGrupo.entries()).map(([grupo, v]) => ({
    grupo,
    vendas: Math.round(v.vendas * 100) / 100,
    custoTeorico: Math.round(v.custoTeorico * 100) / 100,
    cmvPonderado: v.vendas > 0 ? Math.round((v.custoTeorico / v.vendas) * 10000) / 100 : null,
    itensSemFicha: v.semFicha
  })).sort((a, b) => b.vendas - a.vendas)

  return {
    linhas,
    totalVendas: linhas.reduce((a, l) => a + l.vendas, 0),
    totalCustoTeorico: linhas.reduce((a, l) => a + l.custoTeorico, 0)
  }
}

export async function reabrirSessao(sessaoId) {
  const { error } = await supabase.from('sessoes_contagem').update({ status: 'em_andamento', finalizada_em: null }).eq('id', sessaoId)
  if (error) throw error
}

// 09/09/2026 (§2 do combinado com o Felipe): o caminho inverso do `reabrirSessao` acima. Faltava
// um jeito de tirar uma sessão travada em 'em_andamento' — esquecida, celular trocado, ninguém
// nunca mais vai voltar nela — sem precisar excluir os itens já contados. `usuario_finalizou`
// fica null de propósito: foi o ADMIN que forçou o fechamento, não a pessoa que estava contando,
// e essa distinção já é lida em outro lugar (ver comentário de `finalizarSessao` em `lib/api.js`).
export async function finalizarSessaoAdmin(sessaoId) {
  const { error } = await supabase
    .from('sessoes_contagem')
    .update({ status: 'finalizada', finalizada_em: new Date().toISOString() })
    .eq('id', sessaoId)
  if (error) throw error
}

export async function atualizarUnidadeSessao(sessaoId, unidadeId) {
  const { error } = await supabase.from('sessoes_contagem').update({ unidade_id: unidadeId }).eq('id', sessaoId)
  if (error) throw error
}

export async function apagarSessao(sessaoId) {
  const { error } = await supabase.from('sessoes_contagem').delete().eq('id', sessaoId)
  if (error) throw error
}

// ---------- Resumo geral (menu lateral / cabeçalho) ----------
export async function buscarResumoGeral() {
  const { data: configData, error: erroConfig } = await supabase.from('configuracao_geral').select('chave, valor')
  if (erroConfig) throw erroConfig
  const mapa = Object.fromEntries(configData.map((d) => [d.chave, d.valor]))
  const mesAtivo = mapa.mes_ativo_mensal ? Number(mapa.mes_ativo_mensal) : null
  const anoAtivo = mapa.ano_ativo_mensal ? Number(mapa.ano_ativo_mensal) : null

  if (!mesAtivo || !anoAtivo) {
    return { mesAtivo: null, anoAtivo: null, totalItensContados: 0, totalPessoas: 0, lojasCompletas: 0, totalLojas: 0 }
  }

  const { data: sessoesMes, error: erroSessoes } = await supabase
    .from('sessoes_contagem')
    .select('id, usuario, status, unidade_id')
    .eq('tipo', 'mensal')
    .eq('mes_referencia', mesAtivo)
    .eq('ano_referencia', anoAtivo)
  if (erroSessoes) throw erroSessoes

  const idsSessoes = sessoesMes.map((s) => s.id)
  let totalItensContados = 0
  if (idsSessoes.length) {
    const itens = await buscarTodasAsLinhas(() =>
      supabase.from('itens_contagem').select('produto_id, sessao_id').in('sessao_id', idsSessoes)
    )
    totalItensContados = new Set(itens.map((i) => `${i.sessao_id}|${i.produto_id}`)).size
  }

  const { count: totalLojas } = await supabase.from('unidades').select('*', { count: 'exact', head: true }).eq('ativo', true)
  const lojasCompletas = new Set(sessoesMes.filter((s) => s.status === 'finalizada').map((s) => s.unidade_id)).size
  const totalPessoas = new Set(sessoesMes.map((s) => s.usuario).filter(Boolean)).size

  return { mesAtivo, anoAtivo, totalItensContados, totalPessoas, lojasCompletas, totalLojas: totalLojas || 0 }
}

// ---------- Bases de dados (visualização tipo planilha) ----------
const TAMANHO_PAGINA_BASE = 100

export async function buscarBaseProdutos(termo, pagina = 0) {
  const de = pagina * TAMANHO_PAGINA_BASE
  const ate = de + TAMANHO_PAGINA_BASE - 1
  let query = supabase
    .from('produtos')
    .select('id, codigo_everest, nome, unidade_medida, grande_grupo, grupo_everest, subgrupo_everest, ativo, venda, barcodes(codigo_barras, origem)')
    .order('nome')
    .range(de, ate)
  if (termo?.trim()) query = query.ilike('nome', `%${termo.trim()}%`)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function buscarBaseHistorico(termo, pagina = 0) {
  const de = pagina * TAMANHO_PAGINA_BASE
  const ate = de + TAMANHO_PAGINA_BASE - 1
  let query = supabase
    .from('contagens_historicas')
    .select('id, responsavel, local_original, nome_original, codigo_everest, quantidade, unidade_medida, registrado_em, produto_id')
    .order('registrado_em', { ascending: false })
    .range(de, ate)
  if (termo?.trim()) query = query.ilike('nome_original', `%${termo.trim()}%`)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function contarBaseHistorico() {
  const { count, error } = await supabase.from('contagens_historicas').select('*', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

export async function buscarResumoNotasPorLojaMes() {
  const { data: unidadesData, error: e0 } = await supabase.from('unidades').select('nome, cnpj')
  if (e0) throw e0
  const cnpjParaLoja = new Map(unidadesData.filter((u) => u.cnpj).map((u) => [u.cnpj.padStart(14, '0'), u.nome]))

  const notas = await buscarTodasAsLinhas(() => supabase.from('notas_importadas').select('id, cnpj_destinatario, fantasia, data_emissao'))
  const itens = await buscarTodasAsLinhas(() => supabase.from('notas_importadas_itens').select('nota_id'))
  const itensPorNota = new Map()
  for (const i of itens) itensPorNota.set(i.nota_id, (itensPorNota.get(i.nota_id) || 0) + 1)

  const grupos = new Map()
  for (const n of notas) {
    if (!n.data_emissao) continue
    const loja = n.fantasia || cnpjParaLoja.get((n.cnpj_destinatario || '').padStart(14, '0')) || 'CNPJ não mapeado'
    const chaveMes = n.data_emissao.slice(0, 7) // "AAAA-MM"
    const chave = `${loja}|${chaveMes}`
    if (!grupos.has(chave)) {
      grupos.set(chave, { loja, chaveMes, dataMin: n.data_emissao, dataMax: n.data_emissao, totalNotas: 0, totalItens: 0 })
    }
    const g = grupos.get(chave)
    g.totalNotas += 1
    g.totalItens += itensPorNota.get(n.id) || 0
    if (n.data_emissao < g.dataMin) g.dataMin = n.data_emissao
    if (n.data_emissao > g.dataMax) g.dataMax = n.data_emissao
  }

  return Array.from(grupos.values()).sort((a, b) => b.chaveMes.localeCompare(a.chaveMes) || a.loja.localeCompare(b.loja))
}

// 10/08/2026, pedido do Felipe (aba "Importar dados" → Entradas): resumo em valor (R$) — Ano →
// Mês → Loja, com a data da última compra de cada loja naquele mês. Complementa
// `buscarResumoNotasPorLojaMes` (que conta notas/itens, não R$) sem alterar aquela função — a tela
// antiga "Notas Importadas" continua existindo (só saiu do menu, ver DECISOES-TRAVADAS.md).
export async function buscarResumoComprasPorAnoMesLoja() {
  const { data: unidadesData, error: e0 } = await supabase.from('unidades').select('nome, cnpj')
  if (e0) throw e0
  const cnpjParaLoja = new Map((unidadesData || []).filter((u) => u.cnpj).map((u) => [u.cnpj.padStart(14, '0'), u.nome]))

  const notas = await buscarTodasAsLinhas(() => supabase.from('notas_importadas').select('id, cnpj_destinatario, fantasia, data_emissao'))
  const notaPorId = new Map(notas.map((n) => [n.id, n]))
  const itens = await buscarTodasAsLinhas(() => supabase.from('notas_importadas_itens').select('nota_id, valor_total'))

  const porAno = new Map()
  for (const it of itens) {
    const nota = notaPorId.get(it.nota_id)
    if (!nota?.data_emissao) continue
    const loja = nota.fantasia || cnpjParaLoja.get((nota.cnpj_destinatario || '').padStart(14, '0')) || 'CNPJ não mapeado'
    const ano = nota.data_emissao.slice(0, 4)
    const mes = nota.data_emissao.slice(5, 7)
    const valor = Number(it.valor_total) || 0

    if (!porAno.has(ano)) porAno.set(ano, { ano, valor: 0, meses: new Map() })
    const a = porAno.get(ano)
    a.valor += valor
    if (!a.meses.has(mes)) a.meses.set(mes, { mes, valor: 0, lojas: new Map() })
    const m = a.meses.get(mes)
    m.valor += valor
    if (!m.lojas.has(loja)) m.lojas.set(loja, { loja, valor: 0, ultimaCompra: null })
    const l = m.lojas.get(loja)
    l.valor += valor
    if (!l.ultimaCompra || nota.data_emissao > l.ultimaCompra) l.ultimaCompra = nota.data_emissao
  }

  return Array.from(porAno.values())
    .map((a) => ({
      ano: a.ano,
      valor: Math.round(a.valor * 100) / 100,
      meses: Array.from(a.meses.values())
        .map((m) => ({
          mes: m.mes,
          valor: Math.round(m.valor * 100) / 100,
          lojas: Array.from(m.lojas.values())
            .map((l) => ({ ...l, valor: Math.round(l.valor * 100) / 100 }))
            .sort((x, y) => y.valor - x.valor)
        }))
        .sort((x, y) => y.mes.localeCompare(x.mes))
    }))
    .sort((a, b) => b.ano.localeCompare(a.ano))
}

export async function listarNotasImportadas() {
  const notas = await buscarTodasAsLinhas(() =>
    supabase.from('notas_importadas').select('id, numero_nota, fornecedor, cnpj_destinatario, fantasia, data_emissao, importado_em').order('data_emissao', { ascending: false })
  )
  return notas
}

export async function buscarItensDaNota(notaId) {
  const { data, error } = await supabase
    .from('notas_importadas_itens')
    .select('nome_xml, ean, unidade, quantidade, valor_total, produto_id, produtos(nome)')
    .eq('nota_id', notaId)
  if (error) throw error
  return data
}

export async function buscarStatusMensalPorMes() {
  const { data: unidadesAtivas, error: e0 } = await supabase.from('unidades').select('id, nome').eq('ativo', true).order('nome')
  if (e0) throw e0

  const sessoes = await buscarTodasAsLinhas(() =>
    supabase.from('sessoes_contagem').select('mes_referencia, ano_referencia, status, unidade_id, unidades(nome)').eq('tipo', 'mensal')
  )

  const porMes = new Map() // chave "ano-mes" -> Map(unidade_id -> status)
  for (const s of sessoes) {
    const chave = `${s.ano_referencia}-${String(s.mes_referencia).padStart(2, '0')}`
    if (!porMes.has(chave)) porMes.set(chave, new Map())
    const mapaLojas = porMes.get(chave)
    // se já tem finalizada pra essa loja, não deixa uma em_andamento sobrescrever
    if (s.status === 'finalizada' || !mapaLojas.has(s.unidade_id)) {
      mapaLojas.set(s.unidade_id, s.status)
    }
  }

  return Array.from(porMes.entries())
    .map(([chave, mapaLojas]) => {
      const [ano, mes] = chave.split('-').map(Number)
      const lojas = unidadesAtivas.map((u) => ({
        nome: u.nome,
        status: mapaLojas.get(u.id) === 'finalizada' ? 'completo' : mapaLojas.has(u.id) ? 'pendente' : 'nao_iniciado'
      }))
      return { chave, ano, mes, lojas }
    })
    .sort((a, b) => b.chave.localeCompare(a.chave))
}

// ---------- Usuários do app (PIN) ----------
// Reescrito em 07/08/2026: antes lia/escrevia direto em `usuarios_app`, tabela com RLS aberto
// pra chave anônima (qualquer um com a chave pública do app conseguia ler/alterar todos os PINs
// via API, sem passar por tela nenhuma). Agora passa por functions do banco (SECURITY DEFINER,
// ver migração `2026-08-07-travar-senhas-pins.sql`) — a tabela em si não tem mais grant direto
// pra ninguém. Isso NÃO resolve 100% (ainda não tem login real de admin, então essas functions
// continuam abertas pra chave anônima também), mas fecha o buraco de dar a tabela inteira de
// bandeja por uma query livre — só quem sabe o nome exato da function e os parâmetros certos
// consegue algo, e cada operação já vem validada no próprio banco.
export async function listarUsuariosApp() {
  const { data, error } = await supabase.rpc('listar_usuarios_seguro')
  if (error) throw error
  return data
}

// ---------- Perfis de acesso (§67, migration_v15) ----------
// A tabela `perfis_acesso` é lida direto (não por function): ao contrário de `usuarios_app`, ela
// não guarda nada sensível — é uma lista de nomes e permissões. O que ela NÃO deixa fazer pela
// tela é virar desenvolvedor: `eh_desenvolvedor` é coluna e nunca é escrita aqui (só por SQL), de
// propósito — se fosse marcável, quem abre esta tela podia se promover.
export async function listarPerfisAcesso({ incluirInativos = true } = {}) {
  let q = supabase.from('perfis_acesso').select('id, nome, descricao, permissoes, eh_desenvolvedor, protegido, ativo').order('nome')
  if (!incluirInativos) q = q.eq('ativo', true)
  const { data, error } = await q
  if (error) {
    // A v15 ainda não rodou: a tela avisa em vez de mostrar "confere sua internet" (o erro
    // genérico que já mandou caçar problema no lugar errado — ver guarda-corpos do documento).
    if (ehTabelaAusente(error)) return null
    throw error
  }
  return (data || []).map((p) => ({ ...p, permissoes: Array.isArray(p.permissoes) ? p.permissoes : [] }))
}

export async function criarPerfilAcesso(nome, descricao, permissoes = []) {
  const limpo = (nome || '').trim()
  if (!limpo) throw new Error('O perfil precisa de um nome.')
  const { error } = await supabase.from('perfis_acesso').insert({
    nome: limpo, descricao: (descricao || '').trim() || null, permissoes
  })
  if (error) throw error
}

export async function atualizarPerfilAcesso(id, { nome, descricao, permissoes, ativo } = {}) {
  const dados = {}
  if (nome !== undefined) {
    const limpo = (nome || '').trim()
    if (!limpo) throw new Error('O perfil precisa de um nome.')
    dados.nome = limpo
  }
  if (descricao !== undefined) dados.descricao = (descricao || '').trim() || null
  if (permissoes !== undefined) dados.permissoes = permissoes
  if (ativo !== undefined) dados.ativo = !!ativo
  if (!Object.keys(dados).length) return
  const { error } = await supabase.from('perfis_acesso').update(dados).eq('id', id)
  if (error) throw error
}

// Vincula pessoa ↔ perfil, loja e PIN. Passa pela RPC (SECURITY DEFINER) porque é ela que valida o
// PIN e que segura a trava do último desenvolvedor ativo — validação no banco, não na tela.
export async function atualizarAcessoUsuario(id, { perfilId, unidadeId, limparUnidade, pin, ativo, nivel } = {}) {
  const { error } = await supabase.rpc('atualizar_usuario_seguro', {
    usuario_id: id,
    novo_nivel: nivel ?? null,
    novo_ativo: ativo ?? null,
    novo_pin: pin ?? null,
    novo_perfil_id: perfilId ?? null,
    nova_unidade_id: unidadeId ?? null,
    limpar_unidade: !!limparUnidade
  })
  if (!error) return
  if (!ehFuncaoAusente(error)) throw error
  // v15 ainda não rodada: cai na assinatura antiga (só nível e ativo). Trocar PIN, perfil e loja
  // precisa da migração — dizer isso é melhor que falhar com a mensagem crua do PostgREST.
  const { error: e2 } = await supabase.rpc('atualizar_usuario_seguro', {
    usuario_id: id, novo_nivel: nivel ?? null, novo_ativo: ativo ?? null
  })
  if (e2) throw e2
  if (pin || perfilId || unidadeId || limparUnidade) {
    throw new Error('Nome e ativo foram salvos. PIN, perfil e loja exigem rodar a migration_v15.sql no Supabase.')
  }
}

export async function criarUsuarioComPerfil({ nomeCompleto, pin, perfilId = null, unidadeId = null, nivelAcesso = 'operacao' }) {
  const nome = (nomeCompleto || '').trim()
  if (!nome) throw new Error('O nome não pode ficar vazio.')
  const { error } = await supabase.rpc('criar_usuario_seguro', {
    nome_completo_in: nome,
    pin_in: pin,
    nivel_in: nivelAcesso,
    perfil_id_in: perfilId,
    unidade_id_in: unidadeId
  })
  if (!error) return
  if (!ehFuncaoAusente(error)) throw error
  // v15 ainda não rodada: cria pela assinatura antiga (sem perfil/loja) em vez de não criar nada.
  const { error: e2 } = await supabase.rpc('criar_usuario_seguro', {
    nome_completo_in: nome, pin_in: pin, nivel_in: nivelAcesso
  })
  if (e2) throw e2
  if (perfilId || unidadeId) {
    throw new Error('Pessoa criada, mas sem perfil e loja: isso exige rodar a migration_v15.sql no Supabase.')
  }
}

export async function criarUsuarioApp(nomeCompleto, pin, nivelAcesso = 'operacao') {
  const { error } = await supabase.rpc('criar_usuario_seguro', { nome_completo_in: nomeCompleto, pin_in: pin, nivel_in: nivelAcesso })
  if (error) throw error
}

export async function atualizarUsuarioApp(id, dados) {
  const { error } = await supabase.rpc('atualizar_usuario_seguro', {
    usuario_id: id,
    novo_nivel: dados.nivel_acesso ?? null,
    novo_ativo: dados.ativo ?? null
  })
  if (error) throw error
}

// 27/08/2026 (§42), pedido do Felipe: editar a quantidade de um lançamento de contagem direto no
// histórico. Erro de digitação na contagem hoje só se resolve apagando a sessão inteira e
// recontando — desproporcional pra um dígito errado.
//
// A troca é registrada: `usuario` recebe quem corrigiu e `registrado_em` é atualizado, então o
// histórico não passa a mentir dizendo que a pessoa original lançou aquele valor.
export async function editarQuantidadeItemContagem(itemId, novaQuantidade, quemEditou = null) {
  const q = Number(novaQuantidade)
  if (!itemId) throw new Error('Lançamento não identificado.')
  if (!Number.isFinite(q) || q < 0) throw new Error('Quantidade inválida.')
  const dados = { quantidade: q }
  if (quemEditou) dados.usuario = `${quemEditou} (corrigido)`
  const { error } = await supabase.from('itens_contagem').update(dados).eq('id', itemId)
  if (error) {
    // `usuario` só existe depois da migration_v10 — se faltar, grava só a quantidade.
    if (ehColunaAusente(error)) {
      const { error: e2 } = await supabase.from('itens_contagem').update({ quantidade: q }).eq('id', itemId)
      if (e2) throw e2
      return
    }
    throw error
  }
}

// 27/08/2026 (§42), pedido do Felipe: editar o nome do funcionário em Configuração → Usuários.
// Não usa a RPC `atualizar_usuario_seguro` porque ela só aceita nível e ativo — incluir o nome ali
// exigiria alterar a função no banco (nova migração). Como o nome não é campo sensível (o PIN
// continua intocado, e é ele que a RPC protege), o update direto resolve sem migração.
export async function editarNomeUsuarioApp(id, nomeCompleto) {
  const nome = (nomeCompleto || '').trim()
  if (!nome) throw new Error('O nome não pode ficar vazio.')
  const { error } = await supabase.from('usuarios_app').update({ nome_completo: nome }).eq('id', id)
  if (error) throw error
}

export async function deletarUsuarioApp(id) {
  const { error } = await supabase.rpc('deletar_usuario_seguro', { usuario_id: id })
  if (error) throw error
}

export function statusBarcode(produto) {
  const vinculos = produto.barcodes || []
  if (vinculos.length === 0) return 'sem_codigo'
  return vinculos.some((b) => b.origem === 'industrializado') ? 'industrializado' : 'interno'
}

export async function contarProdutos() {
  const { count, error } = await supabase
    .from('produtos')
    .select('*', { count: 'exact', head: true })
    .eq('ativo', true)
  if (error) throw error
  return count
}

export async function buscarProdutoPorBarcodeAdmin(codigoBarras) {
  const { data, error } = await supabase
    .from('barcodes')
    .select('codigo_barras, produtos(*)')
    .eq('codigo_barras', codigoBarras)
    .maybeSingle()
  if (error) throw error
  return data
}

// ---------- Etiquetas / vínculo de barcode ----------
export async function vincularBarcode(produtoId, codigoBarras, origem = 'industrializado') {
  const { error } = await supabase
    .from('barcodes')
    .upsert({ codigo_barras: codigoBarras, produto_id: produtoId, origem }, { onConflict: 'codigo_barras' })
  if (error) throw error
}

export async function removerVinculoProduto(produtoId) {
  const { error } = await supabase.from('barcodes').delete().eq('produto_id', produtoId)
  if (error) throw error
}

// Remove só UM código específico — importante quando o produto tem vários códigos
// vinculados (ex: "arroz tipo 1" genérico, onde várias marcas/EANs apontam pro mesmo item).
export async function removerBarcodeEspecifico(codigoBarras) {
  const { error } = await supabase.from('barcodes').delete().eq('codigo_barras', codigoBarras)
  if (error) throw error
}

export async function registrarEtiquetaInterna(produtoId, codigoEverest) {
  return vincularBarcode(produtoId, codigoEverest, 'interno')
}

// ---------- Grupos de contagem parcial ----------
// `ativo` (migration_v12.sql, 24/08/2026) — banco que ainda não rodou a migração não tem a coluna;
// nesse caso o select com `ativo` falharia com 42703 (undefined_column). Pra não travar a tela,
// tenta com `ativo` e cai pro select sem ela, assumindo `ativo: true` (comportamento de antes da
// migração — todo grupo aparecia sempre).
export async function listarGruposAdmin() {
  let data, error
  ;({ data, error } = await supabase
    .from('grupos_contagem')
    .select('id, nome, ativo, grupos_contagem_itens(count)')
    .order('nome'))
  if (ehColunaAusente(error)) {
    ;({ data, error } = await supabase
      .from('grupos_contagem')
      .select('id, nome, grupos_contagem_itens(count)')
      .order('nome'))
  }
  if (error) throw error
  return data.map((g) => ({ id: g.id, nome: g.nome, ativo: g.ativo !== false, totalItens: g.grupos_contagem_itens?.[0]?.count || 0 }))
}

export async function criarGrupo(nome) {
  const { data, error } = await supabase.from('grupos_contagem').insert({ nome }).select().single()
  if (error) throw error
  return data
}

// Renomear grupo (24/08/2026, pedido do Felipe) — só atualiza o nome, itens e status ativo/inativo
// não são tocados aqui.
export async function editarNomeGrupo(grupoId, nome) {
  const { error } = await supabase.from('grupos_contagem').update({ nome }).eq('id', grupoId)
  if (error) throw error
}

// Ativar/desativar grupo (24/08/2026, pedido do Felipe) — não apaga nada, só some dos filtros que
// devem listar apenas grupos ativos (ex.: CMV Real x Teórico em CMVSemanal.jsx). Se o banco ainda
// não tiver a coluna `ativo` (migração não rodou), o update falha com 42703 — deixa o erro subir
// pra tela avisar o Felipe em vez de mascarar silenciosamente.
export async function ativarDesativarGrupo(grupoId, ativo) {
  const { error } = await supabase.from('grupos_contagem').update({ ativo }).eq('id', grupoId)
  if (ehColunaAusente(error)) {
    throw new Error('Ativar/desativar grupo precisa da migração v12. Rode `supabase/migration_v12.sql` no SQL Editor do Supabase e recarregue a página.')
  }
  if (error) throw error
}

// Trava de exclusão (24/08/2026, pedido do Felipe: "Se tiver contagem no grupo, não pode mais
// apagar ele, só se apagar as contagens"). A FK `fk_sessoes_grupo` é ON DELETE SET NULL — sem essa
// checagem, apagar o grupo simplesmente desvincularia as sessões existentes em silêncio, perdendo a
// referência de qual grupo foi usado em cada contagem já feita. Em vez disso, bloqueia a exclusão
// enquanto existir qualquer `sessoes_contagem` (finalizada ou não) apontando pro grupo.
export async function deletarGrupo(grupoId) {
  const { count, error: erroContagem } = await supabase
    .from('sessoes_contagem')
    .select('id', { count: 'exact', head: true })
    .eq('grupo_id', grupoId)
  if (erroContagem) throw erroContagem
  if (count > 0) {
    throw new Error(`Esse grupo tem ${count} contagem${count === 1 ? '' : 'ns'} registrada${count === 1 ? '' : 's'}. Apague as contagens desse grupo antes de excluí-lo.`)
  }
  const { error } = await supabase.from('grupos_contagem').delete().eq('id', grupoId)
  if (error) throw error
}

export async function listarItensDoGrupoAdmin(grupoId) {
  const data = await buscarTodasAsLinhas(() =>
    supabase.from('grupos_contagem_itens').select('produtos(*)').eq('grupo_id', grupoId)
  )
  return data.map((r) => r.produtos)
}

export async function adicionarItemGrupo(grupoId, produtoId) {
  const { error } = await supabase.from('grupos_contagem_itens').insert({ grupo_id: grupoId, produto_id: produtoId })
  if (error && error.code !== '23505') throw error
}

export async function removerItemGrupo(grupoId, produtoId) {
  const { error } = await supabase
    .from('grupos_contagem_itens')
    .delete()
    .eq('grupo_id', grupoId)
    .eq('produto_id', produtoId)
  if (error) throw error
}

// ---------- Relatório ----------

// Detecta o erro do Postgrest quando uma coluna ainda não existe (ex.: migration_v4.sql
// não rodou ainda no Supabase), pra dar fallback em vez de travar a tela inteira.
// Código 42703 = undefined_column.
// 28/08/2026: este helper existia em paralelo com `ehColunaAusente` (topo do arquivo) e era mais
// fraco — não reconhecia `PGRST204`, o formato que o PostgREST usa em INSERT/UPDATE (§31). Dois
// critérios diferentes pra mesma pergunta é exatamente como um deles fica pra trás. Agora delega,
// mantendo só o extra de checar o nome da coluna quando informado.
function colunaNaoExiste(error, nomeColuna) {
  if (!error) return false
  if (ehColunaAusente(error)) {
    if (!nomeColuna) return true
    const msg = String(error.message || '')
    // Mensagem sem o nome da coluna (acontece) não pode virar "não é essa" — na dúvida, aceita.
    return !/["']([a-z_]+)["']/i.test(msg) || msg.includes(nomeColuna)
  }
  return false
}

// 17/08/2026: `usuario_finalizou` (migration_v10.sql) somado à coluna `data_referencia`
// (migration_v4.sql) — em vez de 1 fallback booleano, agora tenta em camadas (mais completa →
// mais básica), caindo pra próxima só quando a coluna de fato não existe (42703). Cobre bancos que
// já rodaram só até a v4, só até a v9, ou já estão na v10 — nenhum trava a tela de Relatório.
export async function listarSessoes(tipoFiltro = null) {
  const colunasBase = 'id, unidade_id, grupo_id, tipo, status, iniciada_em, finalizada_em, usuario, mes_referencia, ano_referencia, unidades(nome), grupos_contagem(nome)'
  // Ordem das tentativas: da consulta mais completa pra mais enxuta. Cada degrau cobre uma
  // migração que pode não ter rodado ainda (v13 = turno, v10 = usuario_finalizou, v4 =
  // data_referencia) — a tela nunca fica em branco só por causa disso.
  const tentativas = [
    `${colunasBase}, data_referencia, usuario_finalizou, turno`,
    `${colunasBase}, data_referencia, usuario_finalizou`,
    `${colunasBase}, data_referencia`,
    colunasBase
  ]
  async function consultar(colunas) {
    let query = supabase.from('sessoes_contagem').select(colunas).order('iniciada_em', { ascending: false }).limit(200)
    if (tipoFiltro) query = query.eq('tipo', tipoFiltro)
    return query
  }
  let data, error
  for (let i = 0; i < tentativas.length; i++) {
    ;({ data, error } = await consultar(tentativas[i]))
    if (!error || !colunaNaoExiste(error) || i === tentativas.length - 1) break
  }
  if (error) throw error
  // Garante as duas colunas novas sempre presentes (null quando a migração ainda não rodou),
  // sem sobrescrever valor real quando a query completa funcionou.
  return (data || []).map((s) => ({ data_referencia: null, usuario_finalizou: null, turno: null, ...s }))
}

export async function atualizarReferenciaSessao(sessaoId, mesReferencia, anoReferencia) {
  const { error } = await supabase
    .from('sessoes_contagem')
    .update({ mes_referencia: mesReferencia, ano_referencia: anoReferencia })
    .eq('id', sessaoId)
  if (error) throw error
}

// Turno da sessão de perdas (migration_v13.sql). Mesmo padrão da data de referência: correção
// depois do fato, no histórico. Erro de coluna ausente vira mensagem explicando a migração em vez
// do texto cru do PostgREST.
export async function atualizarTurnoSessao(sessaoId, turno) {
  const { error } = await supabase
    .from('sessoes_contagem')
    .update({ turno: turno || null })
    .eq('id', sessaoId)
  if (error && ehColunaAusente(error)) {
    throw new Error('Falta rodar a migration_v13.sql no Supabase (coluna `turno` em sessoes_contagem).')
  }
  if (error) throw error
}

export async function atualizarDataReferenciaSessao(sessaoId, dataReferencia) {
  const { error } = await supabase
    .from('sessoes_contagem')
    .update({ data_referencia: dataReferencia || null })
    .eq('id', sessaoId)
  if (error && colunaNaoExiste(error, 'data_referencia')) {
    throw new Error('Ainda não rodei a migração no Supabase (migration_v4.sql) — roda ela no SQL Editor pra poder editar a data da contagem.')
  }
  if (error) throw error
}

// 17/08/2026: `usuario`/`registrado_em` por item (ver migration_v10.sql) passaram a ser
// selecionados e devolvidos aqui — antes só existia o `usuario` da SESSÃO (quem abriu), sem jeito
// de saber quem contou cada item individual quando mais de 1 pessoa participa da mesma sessão.
// Pedido do Felipe, depois de encontrar uma contagem com o nome dele que ele não lembra de ter
// feito.
export async function buscarRelatorioSessao(sessaoId) {
  // `motivo_perda`/`modo_perda` (migration_v13.sql) só são preenchidos em sessão tipo 'perdas' —
  // vêm nulos em contagem/inventário e são ignorados pela tela. Estão no mesmo select porque o
  // relatório é o mesmo componente pros dois casos.
  let contadosPromise = buscarTodasAsLinhas(() =>
    supabase.from('itens_contagem').select('id, produto_id, quantidade, usuario, registrado_em, motivo_perda, modo_perda, produtos(*)').eq('sessao_id', sessaoId)
  ).catch(async (error) => {
    // Migração pendente nesse Supabase (v10 = `usuario`; v13 = colunas de perda) — cai pro
    // conjunto mínimo de colunas em vez de deixar o relatório inteiro em branco.
    if (colunaNaoExiste(error, 'motivo_perda') || colunaNaoExiste(error, 'modo_perda')) {
      return buscarTodasAsLinhas(() =>
        supabase.from('itens_contagem').select('id, produto_id, quantidade, usuario, registrado_em, produtos(*)').eq('sessao_id', sessaoId)
      ).catch((erroInterno) => {
        if (colunaNaoExiste(erroInterno, 'usuario')) {
          return buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('id, produto_id, quantidade, produtos(*)').eq('sessao_id', sessaoId))
        }
        throw erroInterno
      })
    }
    if (colunaNaoExiste(error, 'usuario')) {
      return buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('id, produto_id, quantidade, produtos(*)').eq('sessao_id', sessaoId))
    }
    throw error
  })
  const [esperados, contados] = await Promise.all([
    buscarTodasAsLinhas(() => supabase.from('itens_esperados_sessao').select('produtos(*)').eq('sessao_id', sessaoId)),
    contadosPromise
  ])

  const contadoPorProduto = new Map(contados.map((c) => [c.produto_id, c]))
  const idsEsperados = new Set(esperados.map((e) => e.produtos.id))

  const linhas = esperados.map((e) => {
    const c = contadoPorProduto.get(e.produtos.id)
    return {
      // 28/08/2026: `id` (da linha em itens_contagem) era buscado no select mas NUNCA chegava
      // aqui. A tela usa `l.id` pra habilitar a edição da quantidade ("clique na quantidade para
      // corrigir") — sem ele, `disabled={!l.id}` deixava o botão morto em toda linha, ou seja, a
      // edição entregue em 26-28/08 nunca funcionou de fato. Item pendente (nunca contado) segue
      // sem id, que é o correto: não há linha pra editar.
      id: c ? c.id : null,
      produto_id: e.produtos.id,
      nome: e.produtos.nome,
      codigo_everest: e.produtos.codigo_everest,
      unidade_medida: e.produtos.unidade_medida,
      quantidade: c ? c.quantidade : null,
      status: c ? 'contado' : 'pendente',
      usuario: c ? c.usuario : null,
      registrado_em: c ? c.registrado_em : null,
      motivo_perda: c ? c.motivo_perda : null,
      modo_perda: c ? c.modo_perda : null
    }
  })

  const extras = contados
    .filter((c) => !idsEsperados.has(c.produto_id))
    .map((c) => ({
      id: c.id,
      produto_id: c.produto_id,
      nome: c.produtos.nome,
      codigo_everest: c.produtos.codigo_everest,
      unidade_medida: c.produtos.unidade_medida,
      quantidade: c.quantidade,
      status: 'extra',
      usuario: c.usuario,
      registrado_em: c.registrado_em,
      motivo_perda: c.motivo_perda,
      modo_perda: c.modo_perda
    }))

  return [...linhas, ...extras]
}

// ---------- Import Everest (upload direto pelo navegador) ----------
function categoriaPorCodigo(codigo) {
  const c = Number(codigo)
  if (!Number.isFinite(c)) return 'outro'
  if (c >= 7000000) return 'equipamento'
  if (c >= 6000000) return 'limpeza_uniforme'
  if (c >= 4000000) return 'pre_preparo'
  if (c >= 3000000) return 'embalagem'
  if (c >= 2000000) return 'insumo'
  return 'venda'
}

// Extrai o candidato a sigla do começo do nome (ex: "MC BOLO GELADO DE COCO" -> "MC").
// Só considera tokens de 2 a 3 letras maiúsculas — nenhuma das siglas reais tem 4 letras,
// e isso já evita pegar palavras comuns de 4+ letras (ex: "AGUA", "ALHO").
export function extrairSigla(nome) {
  const primeiraPalavra = String(nome || '').trim().split(/\s+/)[0]
  if (primeiraPalavra && /^[A-ZÀ-Ú]{2,3}$/.test(primeiraPalavra)) return primeiraPalavra
  return null
}

// Como o catálogo inteiro do Everest é em CAIXA ALTA, muita palavra comum (ex: "OVO", "SAL")
// também bate no padrão de 2-3 letras — por isso só GRAVAMOS a sigla no produto quando ela já
// existe na lista conhecida (siglas_internas). Um candidato desconhecido nunca é salvo sozinho;
// ele só aparece como sugestão pra você decidir (ver buscarSiglasNaoMapeadas).
function extrairSiglaConhecida(nome, conhecidas) {
  const candidata = extrairSigla(nome)
  return candidata && conhecidas.has(candidata) ? candidata : null
}

// Mapeia o "Tipo do Item" real do Everest pra nossa categoria interna (usada em telas antigas).
// Serve só de complemento — tipo_item/grupo_everest/venda são os dados de verdade agora.
function categoriaPorTipoItem(tipoItem) {
  const mapa = {
    'MATERIA PRIMA': 'insumo',
    'PRODUTO EM PROCESSO': 'pre_preparo',
    'PRODUTO ACABADO': 'insumo',
    'MERCADORIA PARA REVENDA': 'insumo',
    'MATERIAL DE USO E CONSUMO': 'limpeza_uniforme',
    'EMBALAGEM': 'embalagem',
    'ATIVO IMOBILIZADO': 'equipamento'
  }
  return mapa[tipoItem] || null
}

export async function importarProdutosEverest(linhasPlanilha, onProgresso) {
  // linhasPlanilha: array de arrays (linha 0 = cabeçalho), como sai do XLSX.utils.sheet_to_json(sheet, {header:1})
  const [cabecalho, ...resto] = linhasPlanilha
  const norm = (s) => String(s || '').trim().toLowerCase()
  const idxItem = cabecalho.findIndex((c) => norm(c) === 'item')
  const idxDescricao = cabecalho.findIndex((c) => norm(c).startsWith('descri'))
  const idxUm = cabecalho.findIndex((c) => norm(c) === 'um')
  const idxBarcode = cabecalho.findIndex((c) => {
    const t = norm(c)
    return t.includes('barra') || t.includes('ean') || t.includes('gtin')
  })
  // Colunas do formato rico (planilha "Itens (Produtos)" com os grupos) — opcionais,
  // se não existirem o import funciona igual ao formato simples de antes.
  const idxTipoItem = cabecalho.findIndex((c) => norm(c).startsWith('tipo do item'))
  const idxGrandeGrupo = cabecalho.findIndex((c) => norm(c) === 'grande grupo')
  const idxGrupo = cabecalho.findIndex((c) => norm(c) === 'grupo')
  const idxSubgrupo = cabecalho.findIndex((c) => norm(c).startsWith('subgrupo'))
  const idxVenda = cabecalho.findIndex((c) => norm(c) === 'venda')
  const idxCompra = cabecalho.findIndex((c) => norm(c) === 'compra')
  const idxFantasia = cabecalho.findIndex((c) => norm(c) === 'fantasia')

  if (idxItem === -1 || idxDescricao === -1 || idxUm === -1) {
    throw new Error('Não encontrei as colunas Item / Descrição do Item / UM nessa planilha.')
  }

  const { data: siglasExistentes, error: erroSiglas } = await supabase.from('siglas_internas').select('sigla')
  if (erroSiglas) throw erroSiglas
  const siglasConhecidas = new Set(siglasExistentes.map((s) => s.sigla))

  const porCodigo = new Map()
  for (const linha of resto) {
    const codigo = String(linha[idxItem] ?? '').trim()
    const nome = String(linha[idxDescricao] ?? '').trim()
    const um = String(linha[idxUm] ?? '').trim().toLowerCase()
    const barcode = idxBarcode !== -1 ? String(linha[idxBarcode] ?? '').trim() : ''
    if (!codigo || !nome) continue

    const tipoItem = idxTipoItem !== -1 ? String(linha[idxTipoItem] ?? '').trim() || null : null
    const fantasia = idxFantasia !== -1 ? String(linha[idxFantasia] ?? '').trim() : ''
    const existente = porCodigo.get(codigo)
    // Mesmo código pode aparecer 1x por empresa (DOM e Dalva) — junta os dois nomes numa "empresa" só.
    const empresaNova = fantasia || null
    const empresaFinal = existente?.empresa && empresaNova && existente.empresa !== empresaNova ? 'ambas' : (empresaNova || existente?.empresa || null)

    porCodigo.set(codigo, {
      codigo,
      nome,
      um,
      barcode: barcode || existente?.barcode || '',
      tipoItem: tipoItem || existente?.tipoItem || null,
      grandeGrupo: idxGrandeGrupo !== -1 ? (String(linha[idxGrandeGrupo] ?? '').trim() || existente?.grandeGrupo || null) : (existente?.grandeGrupo || null),
      grupoEverest: idxGrupo !== -1 ? (String(linha[idxGrupo] ?? '').trim() || existente?.grupoEverest || null) : (existente?.grupoEverest || null),
      subgrupoEverest: idxSubgrupo !== -1 ? (String(linha[idxSubgrupo] ?? '').trim() || existente?.subgrupoEverest || null) : (existente?.subgrupoEverest || null),
      venda: idxVenda !== -1 ? norm(linha[idxVenda]) === 'sim' : (existente?.venda ?? null),
      compra: idxCompra !== -1 ? norm(linha[idxCompra]) === 'sim' : (existente?.compra ?? null),
      empresa: empresaFinal
    })
  }

  const produtos = Array.from(porCodigo.values()).map((p) => ({
    codigo_everest: p.codigo,
    nome: p.nome,
    unidade_medida: p.um || 'un',
    categoria: p.tipoItem ? categoriaPorTipoItem(p.tipoItem) || categoriaPorCodigo(p.codigo) : categoriaPorCodigo(p.codigo),
    sigla: extrairSiglaConhecida(p.nome, siglasConhecidas),
    tipo_item: p.tipoItem,
    grande_grupo: p.grandeGrupo,
    grupo_everest: p.grupoEverest,
    subgrupo_everest: p.subgrupoEverest,
    venda: p.venda,
    compra: p.compra,
    empresa: p.empresa
  }))

  const tamanhoLote = 400
  for (let i = 0; i < produtos.length; i += tamanhoLote) {
    const lote = produtos.slice(i, i + tamanhoLote)
    const { error } = await supabase.from('produtos').upsert(lote, { onConflict: 'codigo_everest' })
    if (error) throw error
    onProgresso?.({ etapa: 'produtos', feito: Math.min(i + tamanhoLote, produtos.length), total: produtos.length })
  }

  const comBarcode = Array.from(porCodigo.values()).filter((p) => p.barcode)
  let vinculados = 0
  for (let i = 0; i < comBarcode.length; i += tamanhoLote) {
    const lote = comBarcode.slice(i, i + tamanhoLote)
    const codigosEverest = lote.map((p) => p.codigo)
    const { data: produtosDb, error: erroSelect } = await supabase
      .from('produtos')
      .select('id, codigo_everest')
      .in('codigo_everest', codigosEverest)
    if (erroSelect) throw erroSelect
    const idPorCodigo = new Map(produtosDb.map((p) => [p.codigo_everest, p.id]))
    const barcodesParaSalvar = lote
      .filter((p) => idPorCodigo.has(p.codigo))
      .map((p) => ({ codigo_barras: p.barcode, produto_id: idPorCodigo.get(p.codigo), origem: 'industrializado' }))
    if (barcodesParaSalvar.length) {
      const { error: erroBarcode } = await supabase.from('barcodes').upsert(barcodesParaSalvar, { onConflict: 'codigo_barras' })
      if (erroBarcode) throw erroBarcode
    }
    vinculados += barcodesParaSalvar.length
    onProgresso?.({ etapa: 'barcodes', feito: vinculados, total: comBarcode.length })
  }

  return {
    totalProdutos: produtos.length,
    totalBarcodes: comBarcode.length,
    linhasLidas: resto.length,
    codigosUnicos: porCodigo.size
  }
}

// ---------- Dashboard ----------
// ---------- Dashboard ----------
export async function buscarComparativoNFeInventario() {
  const { data: unidadesData, error: e0 } = await supabase.from('unidades').select('id, nome, cnpj')
  if (e0) {
    // Coluna cnpj pode não existir ainda se a migração não rodou — não derruba o resto do dashboard.
    console.warn('Comparativo NF-e indisponível:', e0.message)
    return []
  }
  const cnpjParaUnidade = new Map(unidadesData.filter((u) => u.cnpj).map((u) => [u.cnpj, u.nome]))

  const notas = await buscarTodasAsLinhas(() => supabase.from('notas_importadas').select('id, cnpj_destinatario, fantasia, data_emissao'))
  const itensNotas = await buscarTodasAsLinhas(() => supabase.from('notas_importadas_itens').select('nota_id, quantidade'))

  const notaPorId = new Map(notas.map((n) => [n.id, n]))
  const compradoPorChave = new Map() // chave: "AAAA-MM|unidade"
  for (const item of itensNotas) {
    const nota = notaPorId.get(item.nota_id)
    if (!nota?.data_emissao) continue
    const d = new Date(nota.data_emissao)
    const chaveMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const unidade = nota.fantasia || cnpjParaUnidade.get(nota.cnpj_destinatario) || 'CNPJ não mapeado'
    const chave = `${chaveMes}|${unidade}`
    compradoPorChave.set(chave, (compradoPorChave.get(chave) || 0) + (Number(item.quantidade) || 0))
  }

  const { data: sessoes, error: e3 } = await supabase.from('sessoes_contagem').select('id, mes_referencia, ano_referencia, unidades(nome)')
  if (e3) throw e3
  const itensContagem = await buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('sessao_id, quantidade'))
  const sessaoPorId = new Map(sessoes.map((s) => [s.id, s]))
  const contadoPorChave = new Map()
  for (const item of itensContagem) {
    const sessao = sessaoPorId.get(item.sessao_id)
    if (!sessao?.mes_referencia) continue
    const chaveMes = `${sessao.ano_referencia}-${String(sessao.mes_referencia).padStart(2, '0')}`
    const unidade = sessao.unidades?.nome || '—'
    const chave = `${chaveMes}|${unidade}`
    contadoPorChave.set(chave, (contadoPorChave.get(chave) || 0) + (Number(item.quantidade) || 0))
  }

  // Histórico antigo entra também (sem loja definida, agrupado à parte) — assim ele passa
  // a aparecer no comparativo, batendo com as entradas de NF-e do mesmo período.
  const historico = await buscarTodasAsLinhas(() => supabase.from('contagens_historicas').select('registrado_em, quantidade'))
  for (const h of historico) {
    if (!h.registrado_em) continue
    const d = new Date(h.registrado_em)
    const chaveMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const chave = `${chaveMes}|Histórico`
    contadoPorChave.set(chave, (contadoPorChave.get(chave) || 0) + (Number(h.quantidade) || 0))
  }

  const chaves = new Set([...compradoPorChave.keys(), ...contadoPorChave.keys()])
  return Array.from(chaves)
    .map((chave) => {
      const [chaveMes, unidade] = chave.split('|')
      const mes = new Date(`${chaveMes}-01T00:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
      return {
        chaveMes,
        mes,
        unidade,
        comprado: Math.round(compradoPorChave.get(chave) || 0),
        contado: Math.round(contadoPorChave.get(chave) || 0)
      }
    })
    .sort((a, b) => a.chaveMes.localeCompare(b.chaveMes))
}

export async function buscarDadosDashboard(tipoFiltro = 'mensal') {
  let query = supabase
    .from('sessoes_contagem')
    .select('id, tipo, status, iniciada_em, mes_referencia, ano_referencia, unidades(nome)')
    .order('iniciada_em', { ascending: true })
  if (tipoFiltro) query = query.eq('tipo', tipoFiltro)
  const { data: sessoes, error } = await query
  if (error) throw error

  const idsSessoes = sessoes.map((s) => s.id)
  const itensPorSessao = idsSessoes.length
    ? await buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('sessao_id, produto_id').in('sessao_id', idsSessoes))
    : []
  const esperadosPorSessao = idsSessoes.length
    ? await buscarTodasAsLinhas(() => supabase.from('itens_esperados_sessao').select('sessao_id, produto_id').in('sessao_id', idsSessoes))
    : []

  const contadosPorSessaoMap = new Map()
  for (const i of itensPorSessao) {
    if (!contadosPorSessaoMap.has(i.sessao_id)) contadosPorSessaoMap.set(i.sessao_id, new Set())
    contadosPorSessaoMap.get(i.sessao_id).add(i.produto_id)
  }
  const esperadosPorSessaoMap = new Map()
  for (const e of esperadosPorSessao) {
    esperadosPorSessaoMap.set(e.sessao_id, (esperadosPorSessaoMap.get(e.sessao_id) || 0) + 1)
  }

  return sessoes
    .map((s) => {
      const ano = s.ano_referencia || new Date(s.iniciada_em).getFullYear()
      const mesNum = s.mes_referencia || new Date(s.iniciada_em).getMonth() + 1
      const chave = `${ano}-${String(mesNum).padStart(2, '0')}`
      const mes = new Date(ano, mesNum - 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
      const esperados = esperadosPorSessaoMap.get(s.id) || 0
      const contados = contadosPorSessaoMap.get(s.id)?.size || 0
      return {
        chave,
        mes,
        unidade: s.unidades?.nome || '—',
        tipo: s.tipo,
        status: s.status,
        esperados,
        contados,
        conclusao: esperados > 0 ? Math.round((contados / esperados) * 100) : 0
      }
    })
    .sort((a, b) => a.chave.localeCompare(b.chave))
}

// ── Cardápio / Margem ──────────────────────────────────────────────────────
// Painel de margem por prato: custo (da ficha) x venda real (das vendas do Everest).
// Venda unitária = valor unitário da venda MAIS RECENTE do prato no período (não mais a média
// soma(valor)/soma(quantidade) — ver `vendasPorProduto`/achado do Felipe, 24/08/2026). CMV% = custo / venda.
// Tendência = compara com a média móvel dos 3 meses anteriores (mesmo prato) — trocado de
// "só o mês anterior" pra isso a pedido do Felipe: com só 1 mês de base, prato que não vendeu
// no mês anterior (comum em canal novo, ex. Delivery) ficava sempre sem seta ("–"); com 3 meses
// de janela, basta ter vendido em pelo menos 1 desses 3 pra ter base de comparação, e a média
// fica menos sensível a um mês atípico isolado. "acimaMedia" = CMV% muito acima da média dos pratos.
export async function buscarMargemCardapio(mes, ano) {
  function rangeMes(m, a) {
    const ini = `${a}-${String(m).padStart(2, '0')}-01`
    const ud = new Date(a, m, 0).getDate()
    const fim = `${a}-${String(m).padStart(2, '0')}-${String(ud).padStart(2, '0')}`
    return { ini, fim }
  }
  function mesesAntes(m, a, n) {
    let mm = m - n, aa = a
    while (mm < 1) { mm += 12; aa -= 1 }
    return { m: mm, a: aa }
  }
  // 12/08/2026, correção pedida pelo Felipe ("a FT não está fazendo sentido" ao clicar no prato em
  // Margem por prato): esta função agrupava vendas e casava a ficha pelo `produto_id` gravado no
  // item/na ficha — a mesma FK órfã já corrigida em `buscarCurvaDeVendas`/`buscarConsumoTeorico`
  // (§29.10/§29.13), mas que tinha ficado de fora daquela correção (flagada como pendência no §8).
  // Se `produtos` foi zerado/reimportado depois da venda ou da ficha serem importadas, o
  // `produto_id` antigo fica órfão — e como ids são reatribuídos numa tabela nova, o pior caso não
  // é "não achar nada", é achar a ficha ERRADA (de outro produto que por acaso ficou com aquele id
  // na reimportação), o que combina exatamente com "a FT não está fazendo sentido". Corrigido
  // agrupando por `codigo_everest` (identidade canônica, §1) em vez de `produto_id`, e resolvendo
  // produto/ficha atuais pelo mesmo código com os helpers já usados em Análise de Custo.
  async function vendasPorProduto(m, a) {
    const { ini, fim } = rangeMes(m, a)
    // Filtra por data_movimento no item — ver nota em buscarCurvaDeVendas.
    const itens = await buscarTodasAsLinhas(() =>
      supabase.from('vendas_importadas_itens')
        .select('codigo_everest, quantidade, valor_total, valor_unitario, data_movimento, cancelado')
        .gte('data_movimento', ini).lte('data_movimento', fim)
    )
    const mapa = new Map()
    for (const it of itens) {
      if (!it.codigo_everest || it.cancelado) continue
      const cur = mapa.get(it.codigo_everest) || { qtd: 0, valor: 0, ultimoValorUnitario: null, ultimaData: null }
      cur.qtd += Number(it.quantidade) || 0
      // 11/08/2026, pedido do Felipe: valor bruto de venda (item + gorjeta) — ver `valorVenda`.
      cur.valor += valorVenda(it)
      // 24/08/2026, pedido do Felipe: a "venda unitária" usada pra comparar com o custo (CMV%) NÃO
      // é mais soma(valor)÷soma(quantidade) — uma linha de venda com sujeira (preço ou quantidade
      // fora do padrão, ex. ajuste/erro de digitação no PDV) distorcia essa média pra baixo e
      // estourava o CMV% pra centenas/milhares de % (visto no card "CMV mais alto no período" —
      // ex. 1.934,4%). Passa a usar o valor unitário da venda MAIS RECENTE do período (mesma
      // cascata de `valorVenda`: valor_unitario primeiro, valor_total÷quantidade só se faltar).
      // Isso limita o efeito de uma linha ruim a "só se ela for a mais recente", em vez de puxar a
      // média de TODO o período pra baixo.
      const puUnitLinha = it.valor_unitario != null
        ? Number(it.valor_unitario) * FATOR_GORJETA
        : (it.valor_total != null && it.quantidade ? (Number(it.valor_total) / Number(it.quantidade)) * FATOR_GORJETA : null)
      if (puUnitLinha != null) {
        // 25/08/2026: guarda TODOS os preços unitários do período, não só o mais recente. Motivo:
        // usar cegamente "o mais recente" resolve a média suja, mas não resolve o caso da PRÓPRIA
        // última venda ser a linha suja — e era isso que ainda estourava o CMV% de alguns pratos
        // (média dos pratos em 1.586%). Com a lista completa dá pra validar o último valor contra a
        // mediana do período (ver `precoRepresentativo`).
        if (!cur.precos) cur.precos = []
        cur.precos.push(puUnitLinha)
      }
      if (puUnitLinha != null && (!cur.ultimaData || String(it.data_movimento) >= String(cur.ultimaData))) {
        cur.ultimaData = it.data_movimento
        cur.ultimoValorUnitario = puUnitLinha
      }
      mapa.set(it.codigo_everest, cur)
    }
    return mapa
  }

  const atual = await vendasPorProduto(mes, ano)

  // 25/08/2026 — "valor de venda" (responde à pergunta do Felipe: "vai ficar entrando a média?").
  // NÃO é média. A regra é: vale o preço da venda MAIS RECENTE do período — é isso que faz um
  // aumento de preço aparecer no mesmo dia em que passa a valer. Só existe uma trava: se esse
  // último valor estiver absurdamente fora da mediana do período (menos da metade ou mais do dobro),
  // ele é tratado como linha suja de PDV e cai pra mediana, com o item marcado `vendaSuspeita` pra
  // aparecer na tela. Um aumento real (mesmo de 50%) passa pela trava e é adotado na hora; só um
  // valor descolado por ordem de grandeza — o que gerava CMV% de milhares por cento — é barrado.
  function precoRepresentativo(v) {
    if (!v) return { preco: null, suspeito: false }
    const precos = (v.precos || []).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
    if (!precos.length) return { preco: v.ultimoValorUnitario ?? null, suspeito: false }
    const meio = Math.floor(precos.length / 2)
    const mediana = precos.length % 2 ? precos[meio] : (precos[meio - 1] + precos[meio]) / 2
    const ultimo = v.ultimoValorUnitario
    if (ultimo == null || !(ultimo > 0)) return { preco: mediana, suspeito: false }
    if (mediana > 0 && (ultimo < mediana * 0.5 || ultimo > mediana * 2)) {
      return { preco: mediana, suspeito: true, ultimoDescartado: ultimo }
    }
    return { preco: ultimo, suspeito: false }
  }
  // Janela de comparação = últimos 3 meses ANTES do mês escolhido (não inclui o mês atual).
  const janela = [1, 2, 3].map((n) => mesesAntes(mes, ano, n))
  const mapasJanela = await Promise.all(janela.map(({ m, a }) => vendasPorProduto(m, a)))

  const codigosVendidos = [...atual.keys()]
  if (!codigosVendidos.length) return { linhas: [], media: null, limiteVermelho: null }

  const idAtualPorCodigo = await resolverIdsPorCodigoEverest(codigosVendidos)
  const fichaPorCodigo = await resolverFichasPorCodigoEverest(codigosVendidos)

  const idsAtuais = [...new Set([...idAtualPorCodigo.values()])]
  const produtos = []
  for (let i = 0; i < idsAtuais.length; i += 300) {
    const lote = idsAtuais.slice(i, i + 300)
    const { data: pData } = await supabase.from('produtos').select('id, nome, codigo_everest, grupo_everest').in('id', lote)
    if (pData) produtos.push(...pData)
  }
  const produtoPorCodigo = new Map(produtos.map((p) => [p.codigo_everest, p]))
  const fichasIncompletas = await fichasTravadasIncompletas()

  function custoUnit(codigo) {
    const f = fichaPorCodigo.get(codigo)
    if (!f || !Number(f.quantidade_producao) || f.custo_producao == null) return null
    // Trava de custo (ver `aplicarTravaDeCusto`) — efeito imediato, sem esperar reimportação.
    return aplicarTravaDeCusto(f.nome, Number(f.custo_producao) / Number(f.quantidade_producao), fichasIncompletas.has(normalizarNomeFicha(f.nome)))
  }
  function cmvDe(codigo, mapa) {
    const v = mapa.get(codigo); const c = custoUnit(codigo)
    if (!v || !v.qtd || c == null) return null
    const vu = precoRepresentativo(v).preco
    return vu ? (c / vu) * 100 : null
  }
  // Média móvel: só entra no cálculo o(s) mês(es) da janela em que o prato de fato vendeu — não
  // trata mês sem venda como 0 (senão puxaria a média pra baixo artificialmente).
  function cmvMediaJanela(codigo) {
    const valores = mapasJanela.map((mapa) => cmvDe(codigo, mapa)).filter((v) => v != null)
    if (!valores.length) return null
    return valores.reduce((a, b) => a + b, 0) / valores.length
  }

  let linhas = codigosVendidos.map((codigo) => {
    const p = produtoPorCodigo.get(codigo)
    const v = atual.get(codigo)
    const c = custoUnit(codigo)
    const rep = precoRepresentativo(v)
    const vu = rep.preco
    const cmv = (c != null && vu) ? (c / vu) * 100 : null
    const cmvAnt = cmvMediaJanela(codigo)
    return {
      produto_id: idAtualPorCodigo.get(codigo) || null,
      codigo_everest: codigo,
      nome: p?.nome || '—',
      grupo: p?.grupo_everest || '',
      temFicha: fichaPorCodigo.has(codigo),
      custo: c != null ? Math.round(c * 100) / 100 : null,
      venda: vu != null ? Math.round(vu * 100) / 100 : null,
      qtdVendida: Math.round((v?.qtd || 0) * 100) / 100,
      vendaSuspeita: !!rep.suspeito,
      cmv: cmv != null ? Math.round(cmv * 10) / 10 : null,
      cmvAnterior: cmvAnt != null ? Math.round(cmvAnt * 10) / 10 : null,
      tendencia: (cmv != null && cmvAnt != null)
        ? (cmv > cmvAnt + 0.5 ? 'subiu' : cmv < cmvAnt - 0.5 ? 'caiu' : 'estavel')
        : null
    }
  }).filter((l) => l.temFicha)

  // 25/08/2026 — a "média dos pratos" deixou de ser média aritmética simples. A simples tratava
  // "DD PR Galinhada" (80% de CMV, centenas de vendas) e um prato com 1 venda de preço sujo
  // (50.000% de CMV) com o MESMO peso, e por isso o número saía em 1.586,3% — sem relação com o
  // negócio. Agora é PONDERADA pelo faturamento: custo total ÷ venda total do período (a mesma
  // conta que o resto do app chama de "CMV ponderado"). Um prato com 1 venda pesa o que
  // representa: quase nada. O limite do vermelho passa a sair da MEDIANA (não da média), que é
  // insensível a outlier por construção — assim "acima da média" volta a significar
  // "caro em relação aos outros pratos", não "acima de um número inflado por sujeira".
  let custoPonderado = 0
  let vendaPonderada = 0
  for (const l of linhas) {
    if (l.custo == null || l.venda == null || !l.qtdVendida) continue
    custoPonderado += l.custo * l.qtdVendida
    vendaPonderada += l.venda * l.qtdVendida
  }
  const media = vendaPonderada > 0 ? (custoPonderado / vendaPonderada) * 100 : null

  const cmvsOrdenados = linhas.map((l) => l.cmv).filter((v) => v != null).sort((a, b) => a - b)
  const meioCmv = Math.floor(cmvsOrdenados.length / 2)
  const medianaCmv = cmvsOrdenados.length
    ? (cmvsOrdenados.length % 2 ? cmvsOrdenados[meioCmv] : (cmvsOrdenados[meioCmv - 1] + cmvsOrdenados[meioCmv]) / 2)
    : null
  const limiteVermelho = medianaCmv != null ? medianaCmv * 1.3 : null // 30% acima da mediana dos pratos
  for (const l of linhas) l.acimaMedia = (limiteVermelho != null && l.cmv != null && l.cmv >= limiteVermelho)

  linhas.sort((a, b) => (b.cmv ?? -1) - (a.cmv ?? -1))
  return {
    linhas,
    media: media != null ? Math.round(media * 10) / 10 : null,
    mediana: medianaCmv != null ? Math.round(medianaCmv * 10) / 10 : null,
    limiteVermelho: limiteVermelho != null ? Math.round(limiteVermelho * 10) / 10 : null,
    vendasSuspeitas: linhas.filter((l) => l.vendaSuspeita).length
  }
}

// Composição de um prato (pro popup): ingredientes da ficha com custo por linha.
// 12/08/2026, correção pedida pelo Felipe ("a FT não está fazendo sentido" ao clicar no prato em
// Cardápio → Margem por prato): esta função casava a ficha pelo `produto_id` recebido — mesmo tipo
// de FK órfã já corrigido em §29.10/§29.13 (`resolverFichasPorCodigoEverest`), só que esse fix não
// tinha alcançado esta função (ela não fazia parte daquele pedido). Se `produtos` foi zerado e
// reimportado depois da última importação de Ficha Técnica, o `produto_id` gravado na ficha fica
// órfão — e como IDs são reciclados/reatribuídos numa tabela nova, `.eq('produto_id', produtoId)`
// tanto podia não achar nada ("Sem ficha técnica cadastrada", mesmo com a ficha existindo) quanto,
// pior, achar a ficha de OUTRO produto que por acaso ficou com aquele id na nova importação — daí a
// composição "não fazer sentido". Corrigido casando por `codigo_everest` (chave de conflito do
// upsert em `importarFichasTecnicas` — sempre atual, sempre única), a mesma identidade canônica do
// produto (§1), em vez do id gravado na ficha.
// 12/08/2026, 2ª correção pedida pelo Felipe no mesmo popup ("as FTs estão aparecendo muitos itens
// e não parece estar certo o valor do kg e as quantidades"): esta função devolvia TODAS as linhas
// de `fichas_tecnicas_ingredientes` sem aplicar o mesmo filtro "Tipo de Baixa = Consumo" que
// `importarFichasTecnicas`/`buscarResumoFichasTecnicas`/`buscarConsumoTeorico` já usam — então o
// popup misturava o ingrediente real da receita (ex. "PP ROTI DE BOI", uma redução já pronta) COM
// as próprias linhas de base por trás dele que o Everest "achata" pra dentro da mesma ficha (ex.
// "BOVINO MOCOTO", "BOVINO OSSO DE CANELA", "FRANGO PE" — os insumos crus daquela redução), dando a
// impressão de itens demais e de quantidades que não faziam sentido pro prato. Agora usa o mesmo
// `selecionarIngredientesDeConsumo` (cai pra lista inteira só se NENHUMA linha estiver marcada
// "Consumo" — mesma rede de segurança das outras funções).
// 12/08/2026 (2): `custo_linha` multiplicava `custo_unitario × quantidade` — revertido junto com o
// fix de `custo_producao` em `importarFichasTecnicas`: `custo_unitario`/`custo_medio` numa linha de
// Consumo já É a contribuição de custo daquele ingrediente pra 1 unidade do prato (o Everest já
// aplica a quantidade internamente), não um preço por kg/lt que precise ser multiplicado de novo —
// multiplicar de novo é o que fazia o popup mostrar valores errados. `quantidade`/`unidade_medida`
// continuam voltando só pra informar quanto daquele ingrediente entra na receita (não entram na
// conta de custo). Com isso a soma de `custo_linha` volta a bater com `ficha.custo_producao`.
export async function buscarComposicaoFicha(codigoEverest) {
  if (!codigoEverest) return { ficha: null, ingredientes: [] }
  const { data: ficha } = await supabase
    .from('fichas_tecnicas')
    .select('id, nome, quantidade_producao, custo_producao')
    .eq('codigo_everest', codigoEverest)
    .maybeSingle()
  if (!ficha) return { ficha: null, ingredientes: [] }
  const ings = await buscarTodasAsLinhas(() =>
    supabase.from('fichas_tecnicas_ingredientes')
      .select('nome, codigo_everest, unidade_medida, quantidade_aplicada, quantidade_baixa_estoque, custo_medio, custo_unitario, tipo_baixa')
      .eq('ficha_id', ficha.id)
  )
  const ingredientes = selecionarIngredientesDeConsumo(ings).map((i) => {
    const qtd = Number(i.quantidade_baixa_estoque) || Number(i.quantidade_aplicada) || 0
    const cu = Number(i.custo_unitario) || Number(i.custo_medio) || 0
    return {
      nome: i.nome,
      codigo_everest: i.codigo_everest,
      unidade_medida: i.unidade_medida,
      quantidade: qtd,
      custo_unitario: cu,
      custo_linha: Math.round(cu * 100) / 100
    }
  }).sort((a, b) => b.custo_linha - a.custo_linha)
  return { ficha, ingredientes }
}

// Reverso: quais fichas usam um insumo (por código Everest). Ex.: filet mignon -> PP PICADINHO...
// 12/08/2026: aplicado o mesmo filtro "Tipo de Baixa = Consumo" das demais funções (ver
// `ehLinhaDeConsumo`/`selecionarIngredientesDeConsumo`) — sem ele, uma ficha podia aparecer como
// "usa esse insumo" só por causa da linha de achatamento/desmontagem redundante do Everest, mesmo
// quando esse insumo não entra de fato no custo daquela ficha.
export async function buscarFichasQueUsamInsumo(codigoEverest) {
  if (!codigoEverest) return []
  const todasAsLinhas = await buscarTodasAsLinhas(() =>
    supabase.from('fichas_tecnicas_ingredientes')
      .select('ficha_id, quantidade_aplicada, unidade_medida, tipo_baixa')
      .eq('codigo_everest', codigoEverest)
  )
  const ings = selecionarIngredientesDeConsumo(todasAsLinhas)
  const ids = [...new Set(ings.map((i) => i.ficha_id))]
  if (!ids.length) return []
  const fichas = await buscarPorIdsEmLotes(
    (lote) => supabase.from('fichas_tecnicas').select('id, nome, codigo_everest').in('id', lote),
    ids
  )
  const porFicha = new Map((fichas || []).map((f) => [f.id, f]))
  return ings.map((i) => ({
    ficha_id: i.ficha_id,
    ficha_nome: porFicha.get(i.ficha_id)?.nome || '—',
    ficha_codigo: porFicha.get(i.ficha_id)?.codigo_everest || '',
    quantidade: i.quantidade_aplicada,
    unidade: i.unidade_medida
  })).sort((a, b) => a.ficha_nome.localeCompare(b.ficha_nome))
}

// ── Cobertura de dados ("o que já subimos e até quando") ───────────────────
export async function buscarCoberturaDados() {
  const [uRes, gRes, sessoes, vendas, notas, fRes] = await Promise.all([
    supabase.from('unidades').select('id, nome, cnpj'),
    supabase.from('grupos_contagem').select('id, nome'),
    buscarTodasAsLinhas(() => supabase.from('sessoes_contagem').select('tipo, status, unidade_id, usuario, grupo_id, mes_referencia, ano_referencia, iniciada_em, finalizada_em')),
    // Formato novo não tem mais "loja" por header — cobertura por empresa vem da fantasia no item.
    buscarTodasAsLinhas(() => supabase.from('vendas_importadas_itens').select('fantasia, data_movimento')),
    buscarTodasAsLinhas(() => supabase.from('notas_importadas').select('fantasia, data_emissao')),
    supabase.from('fichas_tecnicas').select('atualizado_em')
  ])

  // 28/08/2026 (§48), pedido do Felipe: mostrar QUANDO cada base foi importada pela última vez.
  // Sem isso, uma base desatualizada (ou uma reimportação que não pegou) fica indistinguível de
  // uma base correta — foi exatamente o que atrasou a investigação do filet mignon: eu supunha
  // que as fichas do app eram as mesmas dos arquivos, e não eram.
  //
  // Cada tabela usa a coluna de tempo que já tem, e o rótulo diz exatamente o que ela significa —
  // "produtos" é o único caso onde só existe `created_at`, ou seja, marca o último produto NOVO
  // criado, não a última reimportação (upsert de produto existente não mexe nesse campo).
  const ultimoDe = async (tabela, coluna, extras = '') => {
    const { data } = await supabase
      .from(tabela)
      .select(`${coluna}${extras ? ', ' + extras : ''}`)
      .order(coluna, { ascending: false })
      .limit(1)
    const linha = (data || [])[0]
    return linha ? { quando: linha[coluna], arquivo: linha.nome_arquivo || null } : null
  }
  const [impVendas, impCompras, impFichas, impProdutos] = await Promise.all([
    ultimoDe('vendas_importadas', 'importado_em', 'nome_arquivo'),
    ultimoDe('notas_importadas', 'importado_em', 'nome_arquivo'),
    ultimoDe('fichas_tecnicas', 'atualizado_em'),
    ultimoDe('produtos', 'created_at')
  ])
  const ultimasImportacoes = [
    { base: 'Vendas', ...(impVendas || {}), observacao: 'último arquivo de vendas importado' },
    { base: 'Compras', ...(impCompras || {}), observacao: 'último relatório "Compras no Período" importado' },
    { base: 'Fichas técnicas', ...(impFichas || {}), observacao: 'ficha atualizada mais recentemente' },
    { base: 'Produtos', ...(impProdutos || {}), observacao: 'último produto NOVO criado — reimportar produto já existente não muda esta data' }
  ]
  const nomeUnidade = new Map((uRes.data || []).map((u) => [u.id, u.nome]))
  const cnpjUnidade = new Map((uRes.data || []).map((u) => [u.id, u.cnpj]))
  const CNPJ_DOM = '03306282000148'
  const empresaDe = (unidadeId) => (cnpjUnidade.get(unidadeId) === CNPJ_DOM ? 'DOM' : 'Dalva')
  const nomeGrupo = new Map((gRes.data || []).map((g) => [g.id, g.nome]))

  // Inventário geral: mensal finalizada, agrupado por mês de referência x empresa (Dalva/DOM)
  const invMap = new Map()
  for (const s of sessoes) {
    if (s.tipo !== 'mensal' || s.status !== 'finalizada') continue
    const chave = `${s.ano_referencia}-${String(s.mes_referencia).padStart(2, '0')}`
    if (!invMap.has(chave)) invMap.set(chave, { ano: s.ano_referencia, mes: s.mes_referencia, empresas: new Map() })
    const emp = invMap.get(chave).empresas
    const nome = empresaDe(s.unidade_id)
    const cur = emp.get(nome) || { empresa: nome, contagens: 0, ultima: null }
    cur.contagens += 1
    if (s.finalizada_em && (!cur.ultima || s.finalizada_em > cur.ultima)) cur.ultima = s.finalizada_em
    emp.set(nome, cur)
  }
  const inventario = [...invMap.values()]
    .map((m) => ({ ano: m.ano, mes: m.mes, empresas: [...m.empresas.values()].sort((a, b) => a.empresa.localeCompare(b.empresa)) }))
    .sort((a, b) => (b.ano - a.ano) || (b.mes - a.mes))

  // Contagem semanal
  const semanal = sessoes
    .filter((s) => s.tipo === 'semanal')
    .map((s) => ({
      data: s.finalizada_em || s.iniciada_em,
      grupo: nomeGrupo.get(s.grupo_id) || '—',
      loja: nomeUnidade.get(s.unidade_id) || '—',
      status: s.status
    }))
    .sort((a, b) => new Date(b.data) - new Date(a.data))

  // Vendas por empresa/fantasia (menor -> maior data_movimento, já que cada item carrega a
  // própria data e fantasia no formato novo)
  const vMap = new Map()
  for (const v of vendas) {
    const loja = v.fantasia || '—'
    const cur = vMap.get(loja) || { de: null, ate: null }
    if (v.data_movimento && (!cur.de || v.data_movimento < cur.de)) cur.de = v.data_movimento
    if (v.data_movimento && (!cur.ate || v.data_movimento > cur.ate)) cur.ate = v.data_movimento
    vMap.set(loja, cur)
  }
  const vendasCobertura = [...vMap.entries()].map(([loja, r]) => ({ loja, ...r })).sort((a, b) => a.loja.localeCompare(b.loja))

  // Compras por fantasia (data_emissao)
  const cMap = new Map()
  for (const n of notas) {
    const loja = n.fantasia || 'Sem loja'
    const cur = cMap.get(loja) || { de: null, ate: null }
    if (n.data_emissao) {
      if (!cur.de || n.data_emissao < cur.de) cur.de = n.data_emissao
      if (!cur.ate || n.data_emissao > cur.ate) cur.ate = n.data_emissao
    }
    cMap.set(loja, cur)
  }
  const comprasCobertura = [...cMap.entries()].map(([loja, r]) => ({ loja, ...r })).sort((a, b) => a.loja.localeCompare(b.loja))

  const fichasArr = fRes.data || []
  const fichas = {
    total: fichasArr.length,
    atualizadoEm: fichasArr.reduce((max, f) => (f.atualizado_em && (!max || f.atualizado_em > max)) ? f.atualizado_em : max, null)
  }

  return { inventario, semanal, vendasCobertura, comprasCobertura, fichas, ultimasImportacoes }
}

// ── Painel (resumo em widgets) ─────────────────────────────────────────────
// Reescrito em 07/08/2026 a pedido do Felipe: (1) Faturamento por Grupo x Loja, nas 5 lojas
// (DOM, Dalva e Dito, Mercadinho, RESID Bar, Eventos) — granularidade que só existe do lado da
// venda; (2) CMV correto = Estoque Inicial + Compras − Estoque Final, valorizado a custo médio
// de compra, por Grupo; (3) período livre (data-a-data), não mais só mês fechado.
//
// Limitação de dado (não de código): a nota fiscal do Everest só distingue 2 CNPJs — DOM e
// "Dalva" (Mercadinho/RESID Bar/Eventos compartilham o CNPJ da Dalva) — então Compras, mesmo com
// período livre, só podem ser auditadas nesses 2 blocos, mesmo que o Faturamento apareça nas 5
// lojas. Decisão do Felipe em 07/08/2026: manter Compras em 2 blocos (DOM/Dalva) em vez de ratear
// a compra por estimativa entre as sub-lojas.
//
// Estoque inicial/final do CMV ainda depende da contagem MENSAL finalizada — é o único ritmo
// físico que existe — então, mesmo com período livre, o EI usa a sessão mensal fechada do mês
// anterior ao início do período, e o EF usa a do mês em que o período termina. Faturamento e
// Compras já usam as datas exatas escolhidas (dado diário, sem essa limitação).
const BLOCO_DA_LOJA = { DOM: 'DOM', DD: 'Dalva', MC: 'Dalva', RB: 'Dalva', EV: 'Dalva', DL: 'Dalva' }
const blocoDaUnidade = (nome) => (String(nome || '').trim() === 'DOM' ? 'DOM' : 'Dalva')

// 10/08/2026: popup do CMV Real (Painel) pedido pelo Felipe com a quebra em 5 sub-lojas dentro da
// Dalva. Diferente de Compras (bloqueado em 2 blocos, ver acima), o Estoque (contagem mensal) SIM
// tem como ir mais fundo — cada sessão de contagem já aponta pra uma `unidade_id` (loja física
// cadastrada em Configuração > Lojas), então dá pra classificar por nome, igual já se faz com
// `blocoDaUnidade`. Como "unidades" é cadastro livre (sem coluna de "tipo de loja"), a classificação
// é por palavra-chave no nome. Se uma sub-loja não tiver unidade cadastrada com nome reconhecível,
// o Estoque dela fica 0 de verdade (não inventa número) — mesmo espírito de "não ratear" do §CMV.
// Combinado com o Felipe: Compras de cada sub-loja segue zerada (exceto "Dalva e Dito", que carrega
// o total do bloco Dalva inteiro — é o mesmo limite de dado, só que agora explícito por sub-loja em
// vez de escondido dentro do bloco) e o Consumo sai do cálculo normal (EI + Compras − EF) em cima
// desses números — onde Compras é zero, o Consumo reflete isso (pode até ficar negativo, é o
// retrato real da limitação, não escondido).
function sublocaDaUnidade(nome) {
  const n = String(nome || '').toUpperCase()
  if (n.includes('DOM')) return 'DOM'
  if (n.includes('MERCADINHO')) return 'MC'
  if (n.includes('RESID')) return 'RB'
  if (n.includes('EVENTO')) return 'EV'
  if (n.includes('DELIVERY')) return 'DL'
  return 'DD' // Dalva e Dito — padrão de qualquer unidade da Dalva sem palavra-chave mais específica
}

export async function buscarPainelResumo(dataInicio, dataFim) {
  // Fantasia vem sempre como "D.O.M." ou "DALVA" (nunca "DOM" puro) — /dom/i.test("D.O.M.")
  // dá FALSE por causa dos pontos, então detecta "DALVA" (sem pontos, casa sempre) e trata o
  // resto como DOM. Usado só pra Compras, que não tem grupo_venda pra achar sub-loja.
  const empDom = (txt) => /dalva/i.test(txt || '') ? 'Dalva' : 'DOM'

  // ---------- Faturamento por Grupo x Loja (5 lojas) ----------
  const itensVenda = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('quantidade, valor_total, valor_unitario, fantasia, grupo_venda, cancelado')
      .gte('data_movimento', dataInicio).lte('data_movimento', dataFim)
  )
  const fatPorGrupoLoja = new Map() // grupo -> { DD, DOM, RB, EV, MC, DL }
  const fatPorLoja = { DD: 0, DOM: 0, RB: 0, EV: 0, MC: 0, DL: 0 }
  for (const it of itensVenda) {
    if (it.cancelado) continue
    const loja = lojaDeVenda(it.fantasia, it.grupo_venda)
    const grupo = limparPrefixoLoja(subgrupoDeVenda(it.grupo_venda)) || 'Sem grupo'
    // 11/08/2026, pedido do Felipe: valor bruto de venda (item + gorjeta) — ver `valorVenda`.
    const valor = valorVenda(it)
    if (!fatPorGrupoLoja.has(grupo)) fatPorGrupoLoja.set(grupo, { DD: 0, DOM: 0, RB: 0, EV: 0, MC: 0, DL: 0 })
    fatPorGrupoLoja.get(grupo)[loja] += valor
    fatPorLoja[loja] += valor
  }
  const fatTotal = Object.values(fatPorLoja).reduce((a, b) => a + b, 0)
  const faturamentoLinhas = Array.from(fatPorGrupoLoja.entries())
    .map(([grupo, porLoja]) => ({ grupo, ...porLoja, total: LOJAS_VALIDAS.reduce((s, l) => s + porLoja[l], 0) }))
    .sort((a, b) => b.total - a.total)
  const fatPorBloco = {
    DOM: fatPorLoja.DOM,
    Dalva: fatPorLoja.DD + fatPorLoja.MC + fatPorLoja.RB + fatPorLoja.EV + fatPorLoja.DL
  }

  // ---------- Compras por bloco (DOM x Dalva) — mesma granularidade de sempre ----------
  const { data: notas } = await supabase.from('notas_importadas').select('id, fantasia').gte('data_emissao', dataInicio).lte('data_emissao', dataFim)
  const nIds = (notas || []).map((n) => n.id)
  const empPorNota = new Map((notas || []).map((n) => [n.id, empDom(n.fantasia)]))
  const comp = { DOM: 0, Dalva: 0 }
  const comprasItens = []
  if (nIds.length) {
    const itens = await buscarPorIdsEmLotes(
      (lote) => supabase.from('notas_importadas_itens').select('nota_id, produto_id, valor_total, valor_unitario, calcula_cmv').in('nota_id', lote),
      nIds
    )
    for (const it of itens) {
      if (it.calcula_cmv === false) continue
      const bloco = empPorNota.get(it.nota_id) || 'Dalva'
      comp[bloco] += Number(it.valor_total) || 0
      comprasItens.push({ ...it, bloco })
    }
  }
  const compTotal = comp.DOM + comp.Dalva

  // ---------- CMV correto (EI + Compras − EF) por Grupo x Bloco ----------
  const inicioRef = new Date(dataInicio + 'T00:00:00')
  const fimRef = new Date(dataFim + 'T00:00:00')
  let mesAnterior = inicioRef.getMonth() // já é o mês anterior em base 1 (jan=0 → dez do ano-1)
  let anoAnterior = inicioRef.getFullYear()
  if (mesAnterior === 0) { mesAnterior = 12; anoAnterior -= 1 }
  const mesFim = fimRef.getMonth() + 1
  const anoFim = fimRef.getFullYear()

  const { data: unidadesData } = await supabase.from('unidades').select('id, nome')
  const blocoPorUnidadeId = new Map((unidadesData || []).map((u) => [u.id, blocoDaUnidade(u.nome)]))
  const sublocaPorUnidadeId = new Map((unidadesData || []).map((u) => [u.id, sublocaDaUnidade(u.nome)]))

  async function buscarEstoquePorBloco(mesRef, anoRef) {
    const { data: sessoes } = await supabase.from('sessoes_contagem').select('id, unidade_id, status')
      .eq('tipo', 'mensal').eq('mes_referencia', mesRef).eq('ano_referencia', anoRef)
    const finalizadas = (sessoes || []).filter((s) => s.status === 'finalizada')
    const ids = finalizadas.map((s) => s.id)
    const blocoPorSessao = new Map(finalizadas.map((s) => [s.id, blocoPorUnidadeId.get(s.unidade_id) || 'Dalva']))
    const sublocaPorSessao = new Map(finalizadas.map((s) => [s.id, sublocaPorUnidadeId.get(s.unidade_id) || 'DD']))
    const mapa = new Map() // produto_id -> { DOM: qtd, Dalva: qtd }
    const mapaSubloja = new Map() // produto_id -> { DOM, DD, MC, RB, EV, DL }
    if (ids.length) {
      const itens = await buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('sessao_id, produto_id, quantidade').in('sessao_id', ids))
      for (const it of itens) {
        const bloco = blocoPorSessao.get(it.sessao_id) || 'Dalva'
        const subloja = sublocaPorSessao.get(it.sessao_id) || 'DD'
        if (!mapa.has(it.produto_id)) mapa.set(it.produto_id, { DOM: 0, Dalva: 0 })
        mapa.get(it.produto_id)[bloco] += Number(it.quantidade) || 0
        if (!mapaSubloja.has(it.produto_id)) mapaSubloja.set(it.produto_id, { DOM: 0, DD: 0, MC: 0, RB: 0, EV: 0, DL: 0 })
        mapaSubloja.get(it.produto_id)[subloja] += Number(it.quantidade) || 0
      }
    }
    return { mapa, mapaSubloja, lojasCompletas: new Set(finalizadas.map((s) => s.unidade_id)).size }
  }

  const [estoqueInicialInfo, estoqueFinalInfo] = await Promise.all([
    buscarEstoquePorBloco(mesAnterior, anoAnterior),
    buscarEstoquePorBloco(mesFim, anoFim)
  ])
  const { count: totalLojas } = await supabase.from('unidades').select('*', { count: 'exact', head: true }).eq('ativo', true)

  const idsProdutosCmv = [...new Set([
    ...estoqueInicialInfo.mapa.keys(), ...estoqueFinalInfo.mapa.keys(), ...comprasItens.map((c) => c.produto_id)
  ].filter(Boolean))]
  const produtosCmv = await buscarPorIdsEmLotes(
    (lote) => supabase.from('produtos').select('id, grupo_everest').in('id', lote),
    idsProdutosCmv
  )
  const grupoPorProduto = new Map((produtosCmv || []).map((p) => [p.id, p.grupo_everest || 'Sem grupo']))

  const custoPorProduto = new Map()
  for (const c of comprasItens) {
    if (!c.produto_id || !c.valor_unitario) continue
    if (!custoPorProduto.has(c.produto_id)) custoPorProduto.set(c.produto_id, [])
    custoPorProduto.get(c.produto_id).push(Number(c.valor_unitario))
  }
  const custoMedioPorProduto = new Map()
  for (const [produtoId, valores] of custoPorProduto) {
    custoMedioPorProduto.set(produtoId, valores.reduce((a, b) => a + b, 0) / valores.length)
  }

  function valorizarPorBlocoGrupo(mapaQuantidadePorBloco) {
    const porChave = new Map() // "bloco|grupo" -> valor
    for (const [produtoId, porBloco] of mapaQuantidadePorBloco) {
      const custo = custoMedioPorProduto.get(produtoId)
      if (custo == null) continue // sem compra recente pra saber o custo, não dá pra valorizar ainda
      const grupo = grupoPorProduto.get(produtoId) || 'Sem grupo'
      for (const bloco of ['DOM', 'Dalva']) {
        const qtd = porBloco[bloco] || 0
        if (!qtd) continue
        const chave = `${bloco}|${grupo}`
        porChave.set(chave, (porChave.get(chave) || 0) + qtd * custo)
      }
    }
    return porChave
  }

  const inicialPorChave = valorizarPorBlocoGrupo(estoqueInicialInfo.mapa)
  const finalPorChave = valorizarPorBlocoGrupo(estoqueFinalInfo.mapa)

  // Estoque por sub-loja (DOM, DD, MC, RB, EV, DL) — pro popup do "CMV Real" (Painel), separado da
  // quebra por bloco x grupo acima (essa aqui não olha grupo, só soma tudo por sub-loja mesmo).
  function valorizarPorSubloja(mapaSubloja) {
    const porSubloja = { DOM: 0, DD: 0, MC: 0, RB: 0, EV: 0, DL: 0 }
    for (const [produtoId, porLoja] of mapaSubloja) {
      const custo = custoMedioPorProduto.get(produtoId)
      if (custo == null) continue
      for (const loja of Object.keys(porSubloja)) porSubloja[loja] += (porLoja[loja] || 0) * custo
    }
    return porSubloja
  }
  const estoqueInicialPorSubloja = valorizarPorSubloja(estoqueInicialInfo.mapaSubloja)
  const estoqueFinalPorSubloja = valorizarPorSubloja(estoqueFinalInfo.mapaSubloja)

  const comprasPorChave = new Map()
  for (const c of comprasItens) {
    const grupo = grupoPorProduto.get(c.produto_id) || 'Sem grupo'
    const chave = `${c.bloco}|${grupo}`
    comprasPorChave.set(chave, (comprasPorChave.get(chave) || 0) + (Number(c.valor_total) || 0))
  }

  // Vendas (denominador do CMV%) por bloco x grupo — mesma taxonomia de venda usada no CMV Real
  // de Produção (grupo_venda), que pode não bater 1:1 com o grupo_everest do cadastro do produto
  // usado acima pra Estoque/Compras — são 2 classificações diferentes que o próprio Everest
  // exporta separadas (cadastro x venda). Consistente com o que já existe em Produção → CMV Real.
  const vendasPorChave = new Map()
  for (const it of itensVenda) {
    if (it.cancelado) continue
    const loja = lojaDeVenda(it.fantasia, it.grupo_venda)
    const bloco = BLOCO_DA_LOJA[loja] || 'Dalva'
    const grupo = it.grupo_venda || 'Sem grupo'
    const chave = `${bloco}|${grupo}`
    // 11/08/2026, pedido do Felipe: valor bruto de venda (item + gorjeta) — ver `valorVenda`.
    vendasPorChave.set(chave, (vendasPorChave.get(chave) || 0) + valorVenda(it))
  }

  const chavesCmv = new Set([...inicialPorChave.keys(), ...finalPorChave.keys(), ...comprasPorChave.keys(), ...vendasPorChave.keys()])
  const cmvLinhas = Array.from(chavesCmv).map((chave) => {
    const [bloco, grupo] = chave.split('|')
    const inicial = inicialPorChave.get(chave) || 0
    const comprasValor = comprasPorChave.get(chave) || 0
    const final = finalPorChave.get(chave) || 0
    const vendasValor = vendasPorChave.get(chave) || 0
    const cmvValor = inicial + comprasValor - final
    return {
      bloco,
      grupo,
      estoqueInicial: Math.round(inicial * 100) / 100,
      compras: Math.round(comprasValor * 100) / 100,
      estoqueFinal: Math.round(final * 100) / 100,
      vendas: Math.round(vendasValor * 100) / 100,
      cmvValor: Math.round(cmvValor * 100) / 100,
      cmvPercentual: vendasValor > 0 ? Math.round((cmvValor / vendasValor) * 10000) / 100 : null
    }
  }).sort((a, b) => b.vendas - a.vendas)

  const cmvPorBloco = { DOM: { cmvValor: 0, vendas: 0 }, Dalva: { cmvValor: 0, vendas: 0 } }
  for (const l of cmvLinhas) {
    cmvPorBloco[l.bloco].cmvValor += l.cmvValor
    cmvPorBloco[l.bloco].vendas += l.vendas
  }
  const cmvValorTotal = cmvPorBloco.DOM.cmvValor + cmvPorBloco.Dalva.cmvValor
  const vendasCmvTotal = cmvPorBloco.DOM.vendas + cmvPorBloco.Dalva.vendas
  const cmvPct = (valor, vendas) => (vendas > 0 ? Math.round((valor / vendas) * 10000) / 100 : null)

  const totalItensSemCusto = [...estoqueInicialInfo.mapa.keys(), ...estoqueFinalInfo.mapa.keys()]
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .filter((id) => !custoMedioPorProduto.has(id)).length

  // "CMV Real" por sub-loja — pedido do Felipe (10/08/2026) pro popup do widget CMV do Painel.
  // Regra combinada com ele: Estoque Inicial/Final vem da contagem de verdade de cada sub-loja
  // (via `sublocaDaUnidade`); Compras não tem granularidade menor que o bloco Dalva, então o total
  // de Compras do bloco entra inteiro em "DD" (Dalva e Dito) e as outras 4 sub-lojas ficam com
  // Compras = 0 (não ratear/inventar); Consumo = Estoque Inicial + Compras − Estoque Final, cálculo
  // normal em cima desses números (onde Compras é 0, o Consumo reflete isso, mesmo que fique
  // diferente do que a sub-loja "deveria" consumir — é o retrato real da limitação de dado, não
  // escondido). Vendas (denominador do CMV%) reaproveita `fatPorLoja`, já calculado acima.
  const comprasPorSubloja = { DOM: comp.DOM, DD: comp.Dalva, MC: 0, RB: 0, EV: 0, DL: 0 }
  const cmvPct2 = (consumo, vendas) => (vendas > 0 ? Math.round((consumo / vendas) * 10000) / 100 : null)
  function linhaCmvReal(loja) {
    const estoqueInicial = Math.round((estoqueInicialPorSubloja[loja] || 0) * 100) / 100
    const compras = Math.round((comprasPorSubloja[loja] || 0) * 100) / 100
    const estoqueFinal = Math.round((estoqueFinalPorSubloja[loja] || 0) * 100) / 100
    const vendas = fatPorLoja[loja] || 0
    const consumo = Math.round((estoqueInicial + compras - estoqueFinal) * 100) / 100
    return { estoqueInicial, compras, estoqueFinal, consumo, cmvPercentual: cmvPct2(consumo, vendas) }
  }
  const cmvPorLoja = { DOM: linhaCmvReal('DOM'), DD: linhaCmvReal('DD'), MC: linhaCmvReal('MC'), RB: linhaCmvReal('RB'), EV: linhaCmvReal('EV'), DL: linhaCmvReal('DL') }
  const cmvDalvaBloco = ['DD', 'MC', 'RB', 'EV', 'DL'].reduce((acc, loja) => {
    acc.estoqueInicial += cmvPorLoja[loja].estoqueInicial
    acc.compras += cmvPorLoja[loja].compras
    acc.estoqueFinal += cmvPorLoja[loja].estoqueFinal
    acc.consumo += cmvPorLoja[loja].consumo
    return acc
  }, { estoqueInicial: 0, compras: 0, estoqueFinal: 0, consumo: 0 })
  cmvDalvaBloco.cmvPercentual = cmvPct2(cmvDalvaBloco.consumo, fatPorBloco.Dalva)
  const cmvPorBlocoReal = { DOM: cmvPorLoja.DOM, Dalva: cmvDalvaBloco }

  return {
    periodo: { dataInicio, dataFim },
    faturamento: { total: fatTotal, DOM: fatPorBloco.DOM, Dalva: fatPorBloco.Dalva, porLoja: fatPorLoja, linhas: faturamentoLinhas },
    compras: { total: compTotal, DOM: comp.DOM, Dalva: comp.Dalva },
    cmv: {
      total: cmvPct(cmvValorTotal, vendasCmvTotal),
      DOM: cmvPct(cmvPorBloco.DOM.cmvValor, cmvPorBloco.DOM.vendas),
      Dalva: cmvPct(cmvPorBloco.Dalva.cmvValor, cmvPorBloco.Dalva.vendas),
      linhas: cmvLinhas,
      porBloco: cmvPorBlocoReal,
      porLoja: cmvPorLoja,
      totalItensSemCusto
    },
    // Selo de completude: contagem mensal finalizada do mês em que o período termina.
    dadosCompletos: { lojasCompletas: estoqueFinalInfo.lojasCompletas, totalLojas: totalLojas || 0, mes: mesFim, ano: anoFim }
  }
}

// 11/08/2026, pedido do Felipe pro que substituiu o widget removido do Painel ("Dados do
// período"): tendência de Faturamento e CMV Real dos últimos N meses (default 6), pra ver
// evolução mês a mês em vez de só o retrato do período escolhido nos cards de cima. Reaproveita
// `buscarPainelResumo` mês a mês (mesma conta que já alimenta os cards, sem duplicar lógica) — o
// mês atual entra parcial (até hoje), os anteriores fecham no último dia do mês.
const NOMES_MES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export async function buscarTendenciaPainel(mesesQtd = 6) {
  const hoje = new Date()
  const meses = []
  for (let i = mesesQtd - 1; i >= 0; i--) {
    let m = hoje.getMonth() + 1 - i
    let a = hoje.getFullYear()
    while (m < 1) { m += 12; a -= 1 }
    meses.push({ m, a })
  }
  const resultados = await Promise.all(meses.map(async ({ m, a }) => {
    const ini = `${a}-${String(m).padStart(2, '0')}-01`
    const ehMesAtual = m === hoje.getMonth() + 1 && a === hoje.getFullYear()
    const ultimoDia = new Date(a, m, 0).getDate()
    const fim = ehMesAtual ? hoje.toISOString().slice(0, 10) : `${a}-${String(m).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
    const resumo = await buscarPainelResumo(ini, fim)
    return {
      mes: m,
      ano: a,
      label: `${NOMES_MES_ABREV[m - 1]}/${String(a).slice(2)}`,
      faturamento: resumo.faturamento.total,
      cmvPercentual: resumo.cmv.total
    }
  }))
  return resultados
}

// Média móvel de faturamento (13/08/2026, pedido do Felipe: "gráfico de média móvel de
// faturamento... só um seletor por loja"). Diferente de `buscarTendenciaPainel` (1 ponto por MÊS,
// últimos 6 meses) — aqui é 1 ponto por DIA, pra dar base pra uma média móvel de verdade (a
// oscilação dia-a-dia de um restaurante é grande: fim de semana x meio de semana, por isso a MM7 é
// mais útil que o dado bruto). `loja` é o único filtro (nenhum período/grupo — pedido explícito de
// deixar só o seletor de loja) — null/'' = todas as lojas somadas. Preenche dias sem venda com 0
// (nunca pula um dia) pra não distorcer a média móvel com buracos.
export async function buscarFaturamentoDiario(loja = null, dias = 90) {
  const hoje = new Date()
  const cutoff = new Date(hoje)
  cutoff.setDate(cutoff.getDate() - (dias - 1))
  const cutoffIso = cutoff.toISOString().slice(0, 10)

  const itens = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('data_movimento, quantidade, valor_total, valor_unitario, fantasia, grupo_venda, cancelado')
      .gte('data_movimento', cutoffIso)
  )

  const porDia = new Map() // 'YYYY-MM-DD' -> faturamento
  for (const it of itens) {
    if (it.cancelado) continue
    if (loja && lojaDeVenda(it.fantasia, it.grupo_venda) !== loja) continue
    const dia = String(it.data_movimento).slice(0, 10)
    porDia.set(dia, (porDia.get(dia) || 0) + valorVenda(it))
  }

  // Preenche todos os dias do intervalo, mesmo sem venda — buraco no meio da série quebraria a
  // média móvel (ex.: um dia de sistema fora do ar não pode "desaparecer" da conta).
  const serie = []
  for (let i = 0; i < dias; i++) {
    const d = new Date(cutoff)
    d.setDate(d.getDate() + i)
    const iso = d.toISOString().slice(0, 10)
    serie.push({ data: iso, faturamento: Math.round((porDia.get(iso) || 0) * 100) / 100 })
  }
  return serie
}

// Widget da barra lateral (13/08/2026, pedido do Felipe: "fat total dia anterior por loja, seta
// pra saber se estamos indo bem ou mal por loja"). Compara o faturamento de ONTEM de cada loja com
// a MÉDIA DIÁRIA dos 7 dias ANTES de ontem — de propósito NÃO inclui o próprio ontem no cálculo da
// média, senão a média "absorve" o dia que está sendo comparado contra ela e a variação sempre fica
// perto de zero (comparar um número com uma média que já contém esse número amortece o sinal).
// Preenche dia sem venda com 0, mesmo princípio de `buscarFaturamentoDiario`.
export async function buscarComparativoFaturamentoOntem() {
  const hoje = new Date()
  const ontem = new Date(hoje)
  ontem.setDate(ontem.getDate() - 1)
  const inicioBaseline = new Date(ontem)
  inicioBaseline.setDate(inicioBaseline.getDate() - 7) // 7 dias antes de ontem
  const inicioIso = inicioBaseline.toISOString().slice(0, 10)
  const ontemIso = ontem.toISOString().slice(0, 10)

  const itens = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('data_movimento, quantidade, valor_total, valor_unitario, fantasia, grupo_venda, cancelado')
      .gte('data_movimento', inicioIso).lte('data_movimento', ontemIso)
  )

  const zeroPorLoja = () => ({ DD: 0, DOM: 0, RB: 0, EV: 0, MC: 0, DL: 0 })
  const porDiaLoja = new Map() // 'YYYY-MM-DD' -> { DD, DOM, RB, EV, MC, DL }
  for (const it of itens) {
    if (it.cancelado) continue
    const dia = String(it.data_movimento).slice(0, 10)
    const loja = lojaDeVenda(it.fantasia, it.grupo_venda)
    if (!porDiaLoja.has(dia)) porDiaLoja.set(dia, zeroPorLoja())
    porDiaLoja.get(dia)[loja] += valorVenda(it)
  }

  const diasBaseline = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(inicioBaseline)
    d.setDate(d.getDate() + i)
    diasBaseline.push(d.toISOString().slice(0, 10))
  }

  const valoresOntem = porDiaLoja.get(ontemIso) || zeroPorLoja()
  const porLoja = {}
  for (const loja of LOJAS_VALIDAS) {
    const somaBaseline = diasBaseline.reduce((acc, dia) => acc + (porDiaLoja.get(dia)?.[loja] || 0), 0)
    const baseline = somaBaseline / diasBaseline.length
    const valorOntem = valoresOntem[loja] || 0
    const variacaoPercentual = baseline > 0 ? ((valorOntem - baseline) / baseline) * 100 : (valorOntem > 0 ? 100 : 0)
    porLoja[loja] = { ontem: valorOntem, baseline, variacaoPercentual }
  }
  return { data: ontemIso, porLoja }
}

// ── Fatores de correção (porcionado -> insumo cru) ─────────────────────────
// Busca ampla: inclui PRODUTO ACABADO (os PP/porcionados costumam ser acabados).
export async function buscarProdutosParaFator(termo) {
  const t = (termo || '').trim()
  if (t.length < 2) return []
  const tokens = t.split(/\s+/).filter(Boolean)
  let q = supabase.from('produtos').select('id, nome, codigo_everest, unidade_medida').eq('ativo', true)
  for (const tok of tokens) q = q.or(`nome.ilike.%${tok}%,codigo_everest.ilike.%${tok}%`)
  const { data, error } = await q.order('nome').limit(30)
  if (error) throw error
  return data || []
}

// 26/08/2026 (§39) — CRITÉRIO DE "INSUMO BASE" REFEITO, a pedido do Felipe.
//
// A 1ª versão (§38) usava só "não tem ficha própria". Não funcionou: PP e prato SEM ficha cadastrada
// no Everest — e existem 111 deles só entre os "PP " (§19.1) — passavam pelo filtro como se fossem
// insumo base. Era um critério por AUSÊNCIA de dado, e ausência de dado não prova nada.
//
// O critério agora é o que o Felipe sugeriu, e é empírico: **insumo base é o que aparece em
// COMPRAS**. Se a casa compra, é matéria-prima entrando; pré-preparo e prato nunca são comprados,
// são produzidos. Isso não depende do cadastro de ficha estar completo.
//
// Os dois critérios se somam: precisa ter compra registrada E não ter ficha própria. O segundo
// pega o caso raro do item que é comprado pronto e ainda assim tem ficha cadastrada (ex.: molho
// comprado que alguém também cadastrou como receita) — aí não é insumo base para esta análise.
export async function buscarProdutosInsumoBase(termo) {
  const encontrados = await buscarProdutosParaFator(termo)
  if (!encontrados.length) return []

  const { codigosComFicha } = await carregarFichasParaConversao()
  const codigos = encontrados.map((p) => p.codigo_everest).filter(Boolean)

  // Quais desses códigos realmente aparecem em compras.
  const linhasCompra = await buscarPorIdsEmLotes(
    (lote) => supabase.from('notas_importadas_itens').select('codigo_everest').in('codigo_everest', lote),
    codigos
  )
  const comprados = new Set((linhasCompra || []).map((l) => l.codigo_everest).filter(Boolean))

  return encontrados
    .filter((p) => comprados.has(p.codigo_everest) && !codigosComFicha.has(p.codigo_everest))
    .map((p) => ({ ...p, insumoBase: true }))
}

export async function listarFatoresCorrecao() {
  const { data, error } = await supabase
    .from('fatores_correcao')
    .select('id, fator, criado_em, porcionado:porcionado_id(id, nome, codigo_everest, unidade_medida), cru:cru_id(id, nome, codigo_everest, unidade_medida)')
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data || []
}

export async function criarFatorCorrecao({ porcionadoId, cruId, fator }) {
  const { data, error } = await supabase
    .from('fatores_correcao')
    .insert({ porcionado_id: porcionadoId, cru_id: cruId, fator })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function removerFatorCorrecao(id) {
  const { error } = await supabase.from('fatores_correcao').delete().eq('id', id)
  if (error) throw error
}

// ── CMV Real x Teórico (por insumo cru, entre 2 datas exatas de contagem) ──────────────────
// CMV Real × Teórico (Contagem Semanal), por insumo em natura — migrado em 07/08/2026 pra usar
// o motor automático (§19.2, `buscarInsumosEmNatura`) e o consolidado por data (§19.3) em vez
// da tabela manual antiga `fatores_correcao` (1 nível só, descartava produto sem fator cadastrado
// sem avisar). Ver DECISOES-TRAVADAS.md §19.5.
//
// Reescrito de novo em 07/08/2026 (2ª vez no mesmo dia): a 1ª versão consolidava por SEMANA ISO
// (segunda a domingo), e o Felipe voltou atrás — a contagem acontece num DIA certo (ex.: toda
// segunda-feira), então juntar a semana inteira escondia contagem fora do dia esperado e não
// deixava escolher livremente 2 datas específicas pra comparar (ver exemplo do Filet Mignon:
// EI do dia 27/07 + Compras no intervalo − EF do dia 03/08). Agora EI e EF vêm de uma DATA EXATA
// escolhida (não de uma semana), e o intervalo de Compras/Vendas é exatamente entre essas 2 datas.
//
// Real = estoque inicial (consolidado de TODAS as sessões do dia exato de início) + compras (no
// intervalo entre as duas datas) − estoque final (consolidado do dia exato de fim), já convertido
// pro insumo em natura de origem. Teórico = o que as vendas do mesmo intervalo deveriam ter
// consumido, segundo a ficha técnica de cada prato vendido — usando o MESMO motor direto no
// código do prato (a ficha do Everest já vem achatada com a cadeia inteira, não só o 1º nível).
// 14/08/2026 (3), pedido do Felipe (aba "Contagem" com memória de cálculo, igual à aba "Vendas" do
// popup de detalhe): além da quantidade, também devolve `fatorCorrecao`/`fatorOrigem`/
// `preparoIntermediario` de cada folha, pra dar pra mostrar a mesma auditoria já feita do lado das
// vendas também do lado da contagem (estoque inicial/final). `fatorOrigem: 'direto'` quando o
// produto contado JÁ É o insumo em natura (categoria 'insumo') — não passou por nenhuma ficha, não
// tem "fator" pra auditar, é só a quantidade contada mesmo.
async function converterParaInsumos(codigoEverest, categoria, nome, unidade, quantidade) {
  if (!quantidade) return { insumos: [], gap: false, motivo: 'quantidade zero' }
  if (categoria === 'insumo') {
    return { insumos: [{ codigoEverest, nome, unidade, quantidade, quantidadeLiquida: quantidade, fatorCorrecao: null, fatorOrigem: 'direto', preparoIntermediario: null }], gap: false }
  }
  const folhas = await buscarInsumosEmNatura(codigoEverest)
  if (folhas === null) {
    // Só é gap de verdade quando a categoria É de se esperar ficha técnica (pré-preparo).
    // Limpeza/uniforme, embalagem, equipamento e revenda direta (categoria "venda", ex.: vinho
    // vendido de garrafa fechada) nunca vão ter ficha — não é falta de cadastro, é a conta não
    // se aplicar a esse item. Mesma regra já usada no Consolidado da contagem
    // (buscarConsolidadoPorData) — antes dessa correção, qualquer compra de descartável,
    // material de limpeza ou vinho no período virava "gap" sem motivo, poluindo a lista.
    //
    // 25/08/2026 (§32): passa a devolver `motivo` SEMPRE. Antes, item sem ficha e sem categoria
    // 'pre_preparo' voltava `{insumos: [], gap: false}` e sumia do cálculo sem deixar rastro —
    // inclusive item com `categoria` VAZIA (produto não classificado), que é o caso mais fácil de
    // acontecer e o mais difícil de perceber. Agora todo descarte tem motivo registrável.
    return {
      insumos: [],
      gap: categoria === 'pre_preparo',
      motivo: categoria === 'pre_preparo'
        ? 'pré-preparo sem ficha técnica cadastrada'
        : (!categoria
            ? 'produto sem categoria definida no cadastro e sem ficha técnica'
            : `categoria "${categoria}" não se converte em insumo (sem ficha técnica)`)
    }
  }
  return {
    insumos: folhas.map((f) => ({
      codigoEverest: f.codigoEverest, nome: f.nome, unidade: f.unidade, quantidade: f.quantidadePorUnidade * quantidade,
      quantidadeLiquida: f.quantidadeLiquidaPorUnidade * quantidade,
      fatorCorrecao: f.fatorCorrecao, fatorOrigem: f.fatorOrigem, preparoIntermediario: f.preparoIntermediario,
      // §65: aviso quando o aproveitamento saiu 100% por não ter dado pra conferir o elo.
      eloIncompleto: f.eloIncompleto || null,
      // 02/09/2026: estes dois JÁ eram lidos em `acumularContagem` (aba Contagem do relatório) mas
      // nunca eram repassados aqui — chegavam sempre undefined, então a aba Contagem nunca mostrava
      // gap de ficha nem o % registrado, ao contrário da aba Vendas. Não é campo novo, é vazamento.
      terminalPorFaltaDeFicha: !!f.terminalPorFaltaDeFicha,
      percentualAproveitamentoRegistrado: f.percentualAproveitamentoRegistrado ?? null
    })),
    gap: false
  }
}

export async function buscarCMVSemanal({ grupoId, dataInicio = null, dataFim = null, insumosExtras = [] }) {
  const datas = grupoId ? await listarDatasContagemPorGrupo(grupoId) : []
  const acharData = (data) => (data ? datas.find((d) => d.data === data) : null)
  const diaIni = acharData(dataInicio)
  const diaFim = acharData(dataFim)

  // Insumos rastreados por esse grupo de contagem (ex.: "Proteínas") — Compras e Vendas são
  // sempre da empresa toda (não dá pra separar por loja no Everest, e não faz sentido inventar
  // separação por grupo de contagem nelas também), então só entram no confronto os insumos que
  // vêm dos produtos que esse grupo de fato conta. Sem isso, qualquer compra/venda de insumo de
  // fora do grupo escolhido apareceria misturada na tabela.
  const produtosDoGrupo = grupoId ? await listarItensDoGrupoAdmin(grupoId) : []
  const insumosRastreados = new Set()
  for (const p of produtosDoGrupo) {
    const { insumos } = await converterParaInsumos(p.codigo_everest, p.categoria, p.nome, p.unidade_medida, 1)
    for (const ins of insumos) insumosRastreados.add(ins.codigoEverest)
  }

  // 28/08/2026 (§50) — DUAS FONTES A MAIS, a pedido do Felipe ("não posso refazer a contagem, o
  // processo já está em andamento... não podemos colocar apenas uma flag no item de compra?").
  //
  // O problema: esta lista saía SÓ dos itens CADASTRADOS no grupo. Um insumo que não está
  // cadastrado nunca entra no relatório — nem as compras dele —, mesmo que a equipe o tenha
  // contado. Foi assim que o filet mignon sumiu de um grupo chamado "CTG Filet Mignon".
  //
  // (1) Produtos EFETIVAMENTE CONTADOS nas sessões escolhidas também passam a rastrear. Se alguém
  //     contou, o relatório tem que enxergar — cadastro desatualizado não pode apagar dado real.
  // (2) `insumosExtras` deixa incluir um insumo na hora do cálculo, sem tocar no grupo. É a
  //     "flag" que o Felipe pediu: resolve agora, no meio do processo, sem mudar a rotina da
  //     equipe nem obrigar ninguém a recontar.
  for (const codigo of (insumosExtras || [])) {
    if (codigo) insumosRastreados.add(String(codigo))
  }
  const idsSessoesRastreio = [...(diaIni?.sessoes || []), ...(diaFim?.sessoes || [])].map((x) => x.id || x).filter(Boolean)
  if (idsSessoesRastreio.length) {
    const contadosReais = await buscarPorIdsEmLotes(
      (lote) => supabase.from('itens_contagem')
        .select('produtos(codigo_everest, nome, unidade_medida, categoria)')
        .in('sessao_id', lote),
      idsSessoesRastreio
    )
    const jaVistos = new Set()
    for (const it of contadosReais) {
      const pr = it.produtos
      if (!pr?.codigo_everest || jaVistos.has(pr.codigo_everest)) continue
      jaVistos.add(pr.codigo_everest)
      const { insumos } = await converterParaInsumos(pr.codigo_everest, pr.categoria, pr.nome, pr.unidade_medida, 1)
      for (const ins of insumos) insumosRastreados.add(ins.codigoEverest)
    }
  }

  // 13/08/2026, pedido do Felipe ("mapear o que aconteceu com o filet mignon no período"): além do
  // total teórico por insumo, guarda `porPrato` — de qual prato veio cada pedaço desse consumo
  // teórico (nome, quantidade vendida do prato, quantidade de insumo que isso gerou). Antes esse
  // detalhe era descartado na hora de somar; sem ele não dava pra responder "quais pratos usaram
  // esse insumo e quanto cada um pesou" — só o total agregado.
  const acc = new Map() // codigoEverest -> { nome, unidade, ei, ef, compras, comprasValor, teorico, perda, porPrato, porContagem }
  const get = (codigo, nome, unidade) => {
    if (!acc.has(codigo)) acc.set(codigo, { codigoEverest: codigo, nome, unidade, ei: 0, ef: 0, compras: 0, comprasValor: 0, teorico: 0, perda: 0, perdaPorMotivo: new Map(), porPrato: new Map(), porContagem: new Map() })
    return acc.get(codigo)
  }
  const gapsContagem = new Set()
  const gapsCompras = new Set()

  // 25/08/2026 (§34), pedido do Felipe: "é possível usar o consumo teórico das vendas nessa
  // contagem?" — ou seja, teórico POR ITEM CONTADO (ex.: quanto de "PP Filet Mignon Aparas" as
  // vendas do período deveriam ter consumido), não só por insumo em natura.
  //
  // O teórico do relatório é calculado saltando direto do prato pro insumo em natura
  // (`buscarInsumosEmNatura`), o que ACHATA a cadeia e perde os PPs do meio — justamente os itens
  // que aparecem na contagem. Para ter o número por item contado é preciso olhar os ingredientes
  // DIRETOS da ficha de cada prato vendido, e descer nos PPs a partir dali.
  //
  // Cuidado com dupla contagem: como o Everest já achata (§19.1), a ficha do prato costuma trazer
  // o PP intermediário E o insumo em natura lado a lado. Por isso, para cada prato, a linha DIRETA
  // manda: um código que aparece direto na ficha não recebe nada da descida recursiva.
  const teoricoPorItemContado = new Map() // codigo_everest do item -> quantidade na unidade dele
  async function acumularTeoricoPorItem(codigoPrato, qtdVendida) {
    const { codigosComFicha, fichaIdPorCodigo, ingredientesPorFicha } = await carregarFichasParaConversao()
    const doPrato = new Map()
    const diretos = new Set()
    const fichaPrato = fichaIdPorCodigo.get(codigoPrato)
    if (!fichaPrato) return
    for (const ing of (ingredientesPorFicha.get(fichaPrato) || [])) {
      if (!ing.codigo_everest) continue
      diretos.add(ing.codigo_everest)
      const q = (Number(ing.quantidade_baixa_estoque) || 0) * qtdVendida
      doPrato.set(ing.codigo_everest, (doPrato.get(ing.codigo_everest) || 0) + q)
    }
    // Desce nos PPs pra alcançar itens contados que estejam mais fundo na cadeia.
    const descer = (codigo, mult, profundidade, visitados) => {
      if (profundidade > 6 || visitados.has(codigo)) return
      const id = fichaIdPorCodigo.get(codigo)
      if (!id) return
      const proximos = new Set([...visitados, codigo])
      for (const ing of (ingredientesPorFicha.get(id) || [])) {
        if (!ing.codigo_everest) continue
        const q = (Number(ing.quantidade_baixa_estoque) || 0) * mult
        if (!diretos.has(ing.codigo_everest)) {
          doPrato.set(ing.codigo_everest, (doPrato.get(ing.codigo_everest) || 0) + q)
        }
        if (codigosComFicha.has(ing.codigo_everest)) descer(ing.codigo_everest, q, profundidade + 1, proximos)
      }
    }
    for (const codigo of [...diretos]) {
      if (codigosComFicha.has(codigo)) descer(codigo, doPrato.get(codigo) || 0, 1, new Set([codigoPrato]))
    }
    for (const [codigo, q] of doPrato) {
      teoricoPorItemContado.set(codigo, (teoricoPorItemContado.get(codigo) || 0) + q)
    }
  }

  // 25/08/2026 (§32), pedido do Felipe: "achei um item que não apareceu no relatório... será que
  // estamos puxando os dados corretos?". Resposta: existiam descartes SILENCIOSOS em 3 pontos
  // (produto sem categoria/sem ficha, venda com produto_id órfão, e o filtro por grupo de
  // contagem). A partir daqui, TODO item lido é contabilizado: ou entra na conta, ou entra em
  // `conferencia.<fonte>.descartados` com o motivo. A tela mostra isso como "Conferência dos
  // dados", pra nunca mais um item sumir sem deixar rastro.
  const conferencia = {
    contagem: { lidos: 0, produtosDistintos: 0, entraram: 0, descartados: [] },
    compras: { lidos: 0, produtosDistintos: 0, entraram: 0, descartados: [] },
    vendas: { lidos: 0, pratosDistintos: 0, entraram: 0, descartados: [] }
  }
  const registrarDescarte = (fonte, item) => {
    // Evita repetir o mesmo produto várias vezes na lista (ex.: contado no inicial E no final).
    const ja = conferencia[fonte].descartados.find((d) => d.codigo === item.codigo && d.motivo === item.motivo)
    if (ja) { ja.ocorrencias += 1; return }
    conferencia[fonte].descartados.push({ ...item, ocorrencias: 1 })
  }

  // 14/08/2026 (3), pedido do Felipe: quer uma aba "Contagem" no popup, do mesmo jeito que já existe
  // a aba "Vendas" (de onde veio o TEÓRICO) — mas mostrando de onde veio o REAL: quais produtos
  // contados geraram o estoque inicial/final desse insumo, e a mesma memória de cálculo (fator de
  // correção) já usada do lado das vendas. `porContagem` guarda, por campo ('ei'/'ef'), 1 linha por
  // produto contado que contribuiu pra esse insumo nesse campo.
  async function acumularContagem(idsSessoes, campo) {
    if (!idsSessoes.length) return
    const itens = await buscarTodasAsLinhas(() =>
      supabase.from('itens_contagem')
        .select('produto_id, quantidade, produtos(nome, codigo_everest, unidade_medida, categoria)')
        .in('sessao_id', idsSessoes)
    )
    const porProduto = new Map()
    conferencia.contagem.lidos += itens.length
    for (const it of itens) {
      if (!it.produto_id || !it.produtos?.codigo_everest) {
        registrarDescarte('contagem', {
          nome: it.produtos?.nome || '(produto não encontrado no cadastro)',
          codigo: it.produtos?.codigo_everest || '—',
          quantidade: Number(it.quantidade) || 0,
          motivo: 'lançamento sem produto válido no cadastro atual'
        })
        continue
      }
      if (!porProduto.has(it.produto_id)) porProduto.set(it.produto_id, { ...it.produtos, quantidade: 0 })
      porProduto.get(it.produto_id).quantidade += Number(it.quantidade) || 0
    }
    conferencia.contagem.produtosDistintos += porProduto.size
    for (const p of porProduto.values()) {
      const { insumos, gap, motivo } = await converterParaInsumos(p.codigo_everest, p.categoria, p.nome, p.unidade_medida, p.quantidade)
      if (gap) { gapsContagem.add(`${p.nome} (${p.codigo_everest})`); continue }
      if (!insumos.length) {
        registrarDescarte('contagem', {
          nome: p.nome, codigo: p.codigo_everest, quantidade: p.quantidade,
          unidade: p.unidade_medida, categoria: p.categoria || null,
          motivo: motivo || 'ficha cadastrada, mas nenhum ingrediente dela (nem descendo a cadeia) é insumo em natura'
        })
        continue
      }
      conferencia.contagem.entraram += 1
      for (const ins of insumos) {
        const linha = get(ins.codigoEverest, ins.nome, ins.unidade)
        linha[campo] += ins.quantidade
        if (!linha.porContagem.has(campo)) linha.porContagem.set(campo, new Map())
        const porProdutoDoCampo = linha.porContagem.get(campo)
        if (!porProdutoDoCampo.has(p.codigo_everest)) {
          porProdutoDoCampo.set(p.codigo_everest, {
            codigoProduto: p.codigo_everest, nome: p.nome, unidadeProduto: p.unidade_medida,
            quantidadeContada: p.quantidade, quantidadeGerada: 0, quantidadeLiquidaGerada: 0,
            fatorCorrecao: ins.fatorCorrecao, fatorOrigem: ins.fatorOrigem, preparoIntermediario: ins.preparoIntermediario,
            terminalPorFaltaDeFicha: !!ins.terminalPorFaltaDeFicha,
            percentualAproveitamentoRegistrado: ins.percentualAproveitamentoRegistrado ?? null,
            eloIncompleto: ins.eloIncompleto || null // §65
          })
        }
        porProdutoDoCampo.get(p.codigo_everest).quantidadeGerada += ins.quantidade
        porProdutoDoCampo.get(p.codigo_everest).quantidadeLiquidaGerada += ins.quantidadeLiquida
      }
    }
  }

  await acumularContagem(diaIni ? diaIni.sessoes.map((s) => s.id) : [], 'ei')
  await acumularContagem(diaFim ? diaFim.sessoes.map((s) => s.id) : [], 'ef')

  // ── PERDAS DO PERÍODO (§55) ────────────────────────────────────────────────
  // Pedido do Felipe: ver, ao lado da diferença, quanto desse insumo foi desperdiçado — no total
  // e por item contado.
  //
  // ⚠️ NÃO ENTRA NA CONTA. `real`, `teorico` e `diferenca` continuam exatamente como estavam.
  // Decisão travada no §55: nesta 1ª versão a perda é só informação, porque perda mal lançada
  // entrando no CMV estragaria um número que hoje está confiável. Quando o time estiver lançando
  // com qualidade, a decisão de abater se toma com dado na mão.
  //
  // A perda é gravada nas MESMAS tabelas da contagem (sessão tipo 'perdas'), então este bloco é
  // deliberadamente separado dos acumuladores de contagem — misturar seria somar perda ao estoque.
  const perdaPorItemContado = new Map() // codigo_everest do item lançado -> quantidade crua perdida
  const perdaDetalhePorInsumo = new Map() // codigoEverest do insumo -> linhas de origem da perda
  if (dataInicio && dataFim) {
    // Não dá pra filtrar a data no banco: sessão antiga pode ter `data_referencia` nula e cair no
    // fallback `iniciada_em` (mesma cadeia usada em todo o resto — `dataDaSessao`).
    const { data: sessoesPerda, error: erroPerda } = await supabase
      .from('sessoes_contagem')
      .select('id, data_referencia, iniciada_em')
      .eq('tipo', 'perdas')
    if (erroPerda) throw erroPerda
    const idsPerda = (sessoesPerda || [])
      .filter((sp) => { const d = dataDaSessao(sp); return d && d >= dataInicio && d <= dataFim })
      .map((sp) => sp.id)

    if (idsPerda.length) {
      const itensPerda = await buscarPorIdsEmLotes(
        (lote) => supabase.from('itens_contagem')
          .select('produto_id, quantidade, motivo_perda, modo_perda, produtos(nome, codigo_everest, unidade_medida, categoria)')
          .in('sessao_id', lote),
        idsPerda
      )
      // Agrupa por produto + motivo: o mesmo item pode ter sido lançado várias vezes no período
      // (turnos diferentes, motivos diferentes) e cada motivo merece linha própria no detalhe.
      const porProdutoPerda = new Map()
      for (const it of itensPerda) {
        const cod = it.produtos?.codigo_everest
        if (!cod) continue // sem código canônico não há como converter — §1
        const chave = `${cod}|${it.motivo_perda || '—'}`
        if (!porProdutoPerda.has(chave)) {
          porProdutoPerda.set(chave, { ...it.produtos, motivo: it.motivo_perda || null, modo: it.modo_perda || 'peso', quantidade: 0 })
        }
        porProdutoPerda.get(chave).quantidade += Number(it.quantidade) || 0
      }
      for (const p of porProdutoPerda.values()) {
        perdaPorItemContado.set(p.codigo_everest, (perdaPorItemContado.get(p.codigo_everest) || 0) + p.quantidade)
        // Prato lançado por porções resolve pela ficha; matéria-prima e PP, pelo mesmo conversor
        // que a contagem já usa. Uma perda que não converte NÃO é descartada em silêncio: entra
        // como gap, igual a qualquer outro item que o motor não consegue resolver.
        const { insumos, gap } = await converterParaInsumos(p.codigo_everest, p.categoria, p.nome, p.unidade_medida, p.quantidade)
        if (gap || !insumos.length) {
          gapsContagem.add(`${p.nome} (${p.codigo_everest}) — perda não convertida`)
          continue
        }
        for (const ins of insumos) {
          const v = get(ins.codigoEverest, ins.nome, ins.unidade)
          v.perda += ins.quantidade
          // Quebra por motivo: é o que permite mostrar a diferença DECOMPOSTA (estragado /
          // sobra / erro de preparo) em vez de um total solto que não explica nada.
          const chaveMotivo = p.motivo || 'sem_motivo'
          v.perdaPorMotivo.set(chaveMotivo, (v.perdaPorMotivo.get(chaveMotivo) || 0) + ins.quantidade)
          if (!perdaDetalhePorInsumo.has(ins.codigoEverest)) perdaDetalhePorInsumo.set(ins.codigoEverest, [])
          perdaDetalhePorInsumo.get(ins.codigoEverest).push({
            codigoProduto: p.codigo_everest,
            nome: p.nome,
            motivo: p.motivo,
            modo: p.modo,
            unidadeLancada: p.modo === 'prato' ? 'porções' : p.unidade_medida,
            quantidadeLancada: Math.round(p.quantidade * 1000) / 1000,
            quantidadeInsumo: Math.round(ins.quantidade * 1000) / 1000,
            fatorCorrecao: ins.fatorCorrecao != null ? Math.round(ins.fatorCorrecao * 10000) / 10000 : null
          })
        }
      }
    }
  }

  if (dataInicio && dataFim) {
    const { data: notas } = await supabase.from('notas_importadas').select('id').gte('data_emissao', dataInicio).lte('data_emissao', dataFim)
    const nIds = (notas || []).map((n) => n.id)
    if (nIds.length) {
      const itensCompra = await buscarPorIdsEmLotes(
        (lote) => supabase.from('notas_importadas_itens')
          .select('produto_id, quantidade, valor_total, calcula_cmv, produtos(nome, codigo_everest, unidade_medida, categoria)')
          .in('nota_id', lote),
        nIds
      )
      const porProdutoCompra = new Map()
      conferencia.compras.lidos += itensCompra.length
      for (const it of itensCompra) {
        if (it.calcula_cmv === false) continue // o próprio Everest marcou fora do custo — exclusão intencional (§4)
        if (!it.produto_id || !it.produtos?.codigo_everest) {
          registrarDescarte('compras', {
            nome: it.produtos?.nome || '(produto não encontrado no cadastro)',
            codigo: it.produtos?.codigo_everest || '—',
            quantidade: Number(it.quantidade) || 0,
            motivo: 'compra sem produto válido no cadastro atual'
          })
          continue
        }
        if (!porProdutoCompra.has(it.produto_id)) porProdutoCompra.set(it.produto_id, { ...it.produtos, quantidade: 0, valor: 0 })
        const pc = porProdutoCompra.get(it.produto_id)
        pc.quantidade += Number(it.quantidade) || 0
        pc.valor += Number(it.valor_total) || 0
      }
      conferencia.compras.produtosDistintos += porProdutoCompra.size
      for (const p of porProdutoCompra.values()) {
        const { insumos, gap, motivo } = await converterParaInsumos(p.codigo_everest, p.categoria, p.nome, p.unidade_medida, p.quantidade)
        if (gap) { gapsCompras.add(`${p.nome} (${p.codigo_everest})`); continue }
        if (!insumos.length) {
          registrarDescarte('compras', {
            nome: p.nome, codigo: p.codigo_everest, quantidade: p.quantidade,
            unidade: p.unidade_medida, categoria: p.categoria || null,
            motivo: motivo || 'ficha cadastrada, mas nenhum ingrediente dela (nem descendo a cadeia) é insumo em natura'
          })
          continue
        }
        let entrouAlgum = false
        for (const ins of insumos) {
          if (insumosRastreados.size && !insumosRastreados.has(ins.codigoEverest)) continue // fora do grupo escolhido
          const linha = get(ins.codigoEverest, ins.nome, ins.unidade)
          linha.compras += ins.quantidade
          // Valor da compra: só atribui quando a compra vira 1 insumo só (caso comum — insumo comprado
          // direto). Quando 1 produto comprado se abre em vários insumos (receita composta, raro em
          // compra), não dá pra saber quanto do valor pago é de cada um — não atribui (custo desse
          // insumo cai pro fallback via ficha técnica, ver abaixo).
          if (insumos.length === 1) linha.comprasValor += p.valor
          entrouAlgum = true
        }
        if (entrouAlgum) conferencia.compras.entraram += 1
        else {
          registrarDescarte('compras', {
            nome: p.nome, codigo: p.codigo_everest, quantidade: p.quantidade,
            unidade: p.unidade_medida, categoria: p.categoria || null,
            motivo: 'insumo fora do grupo de contagem escolhido'
          })
        }
      }
    }

    // Filtra por data_movimento no item — ver nota em buscarCurvaDeVendas. Compras e Vendas são
    // sempre da empresa toda (sem filtro de loja — nem o Everest separa compra por loja); o que
    // restringe ao grupo escolhido é o filtro por insumosRastreados logo abaixo.
    const vitens = await buscarTodasAsLinhas(() =>
      supabase.from('vendas_importadas_itens')
        .select('produto_id, codigo_everest, nome_original, quantidade, cancelado')
        .gte('data_movimento', dataInicio).lte('data_movimento', dataFim)
    )
    const vendidoPorPrato = new Map()
    const nomePratoPorCodigo = new Map()
    conferencia.vendas.lidos += vitens.length
    for (const vi of vitens) {
      if (vi.cancelado) continue // exclusão intencional e já documentada (§4)
      // 25/08/2026 (§32) — FURO CORRIGIDO: aqui exigia-se `vi.produto_id` além do código Everest.
      // `vendas_importadas_itens.produto_id` é NULLABLE e é um retrato de quando a venda foi
      // importada: se `produtos` foi zerado/reimportado depois (o que aconteceu na faxina de
      // agosto), ele fica nulo/órfão — e a venda inteira era descartada em silêncio, mesmo com
      // `codigo_everest` preenchido. E o teórico só precisa do código Everest, que é a identidade
      // canônica (§1). A exigência de produto_id foi removida.
      if (!vi.codigo_everest) {
        registrarDescarte('vendas', {
          nome: vi.nome_original || '(sem nome)', codigo: '—',
          quantidade: Number(vi.quantidade) || 0,
          motivo: 'venda sem código Everest'
        })
        continue
      }
      vendidoPorPrato.set(vi.codigo_everest, (vendidoPorPrato.get(vi.codigo_everest) || 0) + (Number(vi.quantidade) || 0))
      if (!nomePratoPorCodigo.has(vi.codigo_everest)) nomePratoPorCodigo.set(vi.codigo_everest, vi.nome_original)
    }
    conferencia.vendas.pratosDistintos = vendidoPorPrato.size
    for (const [codigoPrato, qtdVendida] of vendidoPorPrato) {
      const nomePrato = nomePratoPorCodigo.get(codigoPrato) || codigoPrato
      if (!qtdVendida) continue
      const folhas = await buscarInsumosEmNatura(codigoPrato)
      if (!folhas) {
        // Prato sem ficha (ex.: revenda direta) — continua sem gerar consumo teórico, mas agora
        // aparece na conferência em vez de sumir.
        registrarDescarte('vendas', {
          nome: nomePrato, codigo: codigoPrato, quantidade: qtdVendida,
          motivo: 'prato vendido sem ficha técnica cadastrada'
        })
        continue
      }
      await acumularTeoricoPorItem(codigoPrato, qtdVendida)
      let entrouAlgumPrato = false
      for (const f of folhas) {
        if (insumosRastreados.size && !insumosRastreados.has(f.codigoEverest)) continue // fora do grupo escolhido
        const linha = get(f.codigoEverest, f.nome, f.unidade)
        const quantidadeInsumo = f.quantidadePorUnidade * qtdVendida // bruto (o que sai do estoque)
        const quantidadeLiquida = f.quantidadeLiquidaPorUnidade * qtdVendida // líquido (o que vai pro prato)
        linha.teorico += quantidadeInsumo
        // Detalhe por prato (ver comentário no `acc` acima) — soma se o mesmo prato aparecer mais
        // de uma vez (não deveria, `vendidoPorPrato` já agrupa por código, mas protege mesmo assim).
        // 13/08/2026, pedido do Felipe: guarda também a quantidade LÍQUIDA e o fator de correção
        // (ver `buscarInsumosEmNatura`) — o fator é fixo por par prato/insumo (vem da ficha), não
        // precisa somar, só grava 1 vez.
        if (!linha.porPrato.has(codigoPrato)) {
          linha.porPrato.set(codigoPrato, {
            codigoPrato, nome: nomePrato, quantidadeVendida: 0, quantidadeInsumo: 0, quantidadeLiquida: 0,
            fatorCorrecao: f.fatorCorrecao, fatorOrigem: f.fatorOrigem,
            fatorRegistrado: f.fatorRegistrado, percentualAproveitamentoRegistrado: f.percentualAproveitamentoRegistrado,
            preparoIntermediario: f.preparoIntermediario,
            eloIncompleto: f.eloIncompleto || null, // §65
            terminalPorFaltaDeFicha: !!f.terminalPorFaltaDeFicha
          })
        }
        const pp = linha.porPrato.get(codigoPrato)
        pp.quantidadeVendida += qtdVendida
        pp.quantidadeInsumo += quantidadeInsumo
        pp.quantidadeLiquida += quantidadeLiquida
        entrouAlgumPrato = true
      }
      if (entrouAlgumPrato) conferencia.vendas.entraram += 1
      else {
        registrarDescarte('vendas', {
          nome: nomePrato, codigo: codigoPrato, quantidade: qtdVendida,
          motivo: 'nenhum insumo desse prato pertence ao grupo de contagem escolhido'
        })
      }
    }
  }

  // Subgrupo do Everest (cadastro do produto) de cada insumo em natura — pedido do Felipe pra poder
  // filtrar a tabela por esse subgrupo (ex.: só "CARNES BOVINAS"), já que ela pode trazer bastante
  // insumo de uma vez (tudo que aparece na ficha técnica dos itens contados/vendidos do período).
  // Trocado de "grupo_everest" pra "subgrupo_everest" (mais específico — grupo é genérico demais).
  const codigosLinha = Array.from(acc.keys())
  const subgrupoEverestPorCodigo = new Map()
  if (codigosLinha.length) {
    const lotes = []
    for (let i = 0; i < codigosLinha.length; i += 300) lotes.push(codigosLinha.slice(i, i + 300))
    for (const lote of lotes) {
      const { data: prods } = await supabase.from('produtos').select('codigo_everest, subgrupo_everest').in('codigo_everest', lote)
      for (const p of (prods || [])) subgrupoEverestPorCodigo.set(p.codigo_everest, p.subgrupo_everest || null)
    }
  }

  // Custo unitário de cada insumo em natura — usado só pra dar a "diferença em valor" (R$) no popup
  // de detalhe do item (pedido do Felipe, 09/08/2026).
  //
  // ⚠️ Corrigido em 09/08/2026: a 1ª versão pegava o "primeiro custo não-nulo" achado em
  // fichas_tecnicas_ingredientes pra cada código — mas o mesmo insumo aparece em VÁRIAS fichas
  // (1 por prato que o usa), cada uma com o custo que estava vigente da ÚLTIMA VEZ que aquela ficha
  // específica foi importada/atualizada no Everest. Se uma ficha antiga nunca foi reimportada desde
  // que o preço do insumo subiu, ela carrega um custo velho — e como a query não tinha ordenação,
  // "o primeiro que a consulta devolvesse" podia ser justamente essa ficha desatualizada (foi o caso
  // do filet mignon aparecendo a R$ 25,99/kg, quando o preço real de compra gira em R$ 80+/kg).
  //
  // Fonte agora preferida: o custo médio de COMPRA do próprio insumo NO PERÍODO analisado
  // (comprasValor ÷ compras, calculado acima) — é o preço que de fato foi pago, no mesmo intervalo
  // do relatório, sem depender de quando alguma ficha foi atualizada por último. Só cai pro fallback
  // (ficha técnica, pegando a ficha com `data_versao` mais recente pra cada código) quando o insumo
  // não teve nenhuma compra direta nesse período (ex.: só saiu do estoque, não foi comprado agora).
  const custoUnitarioPorCodigo = new Map()
  const custoOrigemPorCodigo = new Map() // 'compras' | 'ficha' — pra ser transparente na tela sobre de onde veio o custo
  for (const v of acc.values()) {
    if (v.compras > 0 && v.comprasValor > 0) {
      custoUnitarioPorCodigo.set(v.codigoEverest, v.comprasValor / v.compras)
      custoOrigemPorCodigo.set(v.codigoEverest, 'compras')
    }
  }
  const codigosSemCusto = codigosLinha.filter((c) => !custoUnitarioPorCodigo.has(c))
  if (codigosSemCusto.length) {
    const lotes = []
    for (let i = 0; i < codigosSemCusto.length; i += 300) lotes.push(codigosSemCusto.slice(i, i + 300))
    const melhorPorCodigo = new Map() // codigo -> { custo, dataVersao }
    for (const lote of lotes) {
      const { data: ings } = await supabase.from('fichas_tecnicas_ingredientes')
        .select('codigo_everest, custo_unitario, custo_medio, tipo_baixa, fichas_tecnicas(data_versao)').in('codigo_everest', lote)
      // 12/08/2026: prioriza linhas marcadas "Consumo" (ver ehLinhaDeConsumo) — sem isso, uma linha
      // de achatamento/desmontagem redundante do Everest podia ser escolhida como "o preço" desse
      // insumo. Continua sendo só um fallback de último caso (compras reais do período são
      // preferidas acima) — se nenhuma linha do insumo estiver marcada "Consumo", usa qualquer uma
      // em vez de não achar preço nenhum.
      const consumo = (ings || []).filter((ing) => ehLinhaDeConsumo(ing.tipo_baixa))
      const candidatas = consumo.length ? consumo : (ings || [])
      for (const ing of candidatas) {
        const cu = Number(ing.custo_unitario) || Number(ing.custo_medio) || 0
        if (cu <= 0) continue
        const dataVersao = ing.fichas_tecnicas?.data_versao || ''
        const atual = melhorPorCodigo.get(ing.codigo_everest)
        if (!atual || dataVersao > atual.dataVersao) melhorPorCodigo.set(ing.codigo_everest, { custo: cu, dataVersao })
      }
    }
    for (const [codigo, m] of melhorPorCodigo) {
      custoUnitarioPorCodigo.set(codigo, m.custo)
      custoOrigemPorCodigo.set(codigo, 'ficha')
    }
  }

  // Diferença = TEÓRICO − REAL (não o contrário) — convenção acertada com o Felipe em 09/08/2026:
  // positiva = consumimos MENOS que o esperado pelas fichas (economia, sinaliza em verde); negativa =
  // consumimos MAIS que o esperado (perda/quebra, sinaliza em vermelho). Mesma direção já usada em
  // "Consumo teórico × Venda" (buscarConsumoXVenda, §19.4) — teórico sempre vem primeiro na conta.
  const r3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000
  // Detalhe "de onde veio esse consumo" (pedido do Felipe, 13/08/2026) — mostra no máximo os 20
  // pratos que mais pesaram no teórico desse insumo; se tiver mais, avisa quantos ficaram de fora
  // em vez de esconder em silêncio (a lista já vem ordenada, então quem ficou de fora é sempre o
  // que menos pesou).
  const LIMITE_PRATOS_POPUP = 20
  const linhas = Array.from(acc.values())
    .map((v) => {
      const real = v.ei + v.compras - v.ef
      const diferenca = v.teorico - real
      const custoUnitario = custoUnitarioPorCodigo.get(v.codigoEverest) || null
      const pratosOrdenados = Array.from(v.porPrato.values()).sort((a, b) => b.quantidadeInsumo - a.quantidadeInsumo)
      // 14/08/2026 (3) — mesma ideia do `pratosOrdenados` acima, só que pro lado da CONTAGEM (estoque
      // inicial/final) em vez das vendas (teórico). Cada entrada = 1 produto contado que gerou parte
      // desse insumo nesse campo, já com a memória de cálculo (fator de correção) pronta pro popup.
      const contagemPorCampo = (campo) => {
        const porProdutoMap = v.porContagem.get(campo)
        if (!porProdutoMap) return []
        return Array.from(porProdutoMap.values())
          .sort((a, b) => b.quantidadeGerada - a.quantidadeGerada)
          .map((p) => ({
            codigoProduto: p.codigoProduto, nome: p.nome, unidadeProduto: p.unidadeProduto,
            quantidadeContada: r3(p.quantidadeContada),
            quantidadeGerada: r3(p.quantidadeGerada),
            quantidadeLiquidaGerada: r3(p.quantidadeLiquidaGerada),
            fatorCorrecao: p.fatorCorrecao != null ? Math.round(p.fatorCorrecao * 10000) / 10000 : null,
            fatorOrigem: p.fatorOrigem,
            terminalPorFaltaDeFicha: !!p.terminalPorFaltaDeFicha,
            percentualAproveitamentoRegistrado: p.percentualAproveitamentoRegistrado ?? null,
            preparoIntermediario: p.preparoIntermediario || null,
            eloIncompleto: p.eloIncompleto || null, // §65

            // §34: quanto as vendas do período deveriam ter consumido DESTE item contado,
            // na unidade dele. null = esse item não aparece na ficha de nenhum prato vendido
            // (não dá pra atribuir teórico a ele — não é o mesmo que zero).
            teoricoDoItem: teoricoPorItemContado.has(p.codigoProduto)
              ? Math.round(teoricoPorItemContado.get(p.codigoProduto) * 1000) / 1000
              : null,
            // §55: quanto DESTE item foi lançado como perda no período, na unidade dele (o mesmo
            // número que a pessoa digitou no celular). null = nenhuma perda lançada — diferente
            // de zero, que aqui não existe: ninguém lança perda de 0.
            perdaDoItem: perdaPorItemContado.has(p.codigoProduto)
              ? Math.round(perdaPorItemContado.get(p.codigoProduto) * 1000) / 1000
              : null
          }))
      }
      return {
        codigoEverest: v.codigoEverest, nome: v.nome, unidade: v.unidade,
        subgrupoEverest: subgrupoEverestPorCodigo.get(v.codigoEverest) || null,
        estoqueInicial: r3(v.ei), compras: r3(v.compras), estoqueFinal: r3(v.ef),
        real: r3(real), teorico: r3(v.teorico), diferenca: r3(diferenca),
        // §55: perda do período convertida pro insumo base. NÃO é abatida de `real`, `teorico`
        // nem `diferenca` — é informação ao lado, pra ajudar a explicar a diferença.
        perda: r3(v.perda),
        perdaValor: custoUnitario != null ? Math.round((v.perda || 0) * custoUnitario * 100) / 100 : null,
        // [{ motivo, quantidade, valor }] — ordenado do maior pro menor, que é a ordem em que a
        // pergunta "de onde vem a diferença?" quer ser respondida.
        perdaPorMotivo: Array.from(v.perdaPorMotivo.entries())
          .map(([motivo, q]) => ({
            motivo,
            quantidade: r3(q),
            valor: custoUnitario != null ? Math.round(q * custoUnitario * 100) / 100 : null
          }))
          .sort((x, y) => y.quantidade - x.quantidade),
        perdaItens: perdaDetalhePorInsumo.get(v.codigoEverest) || [],
        custoUnitario,
        custoOrigem: custoOrigemPorCodigo.get(v.codigoEverest) || null,
        diferencaValor: custoUnitario != null ? Math.round(diferenca * custoUnitario * 100) / 100 : null,
        // 14/08/2026, pedido do Felipe: pra achar as proteínas (os itens mais caros do prato), o que
        // importa é o quanto esse insumo pesou no custo do período — não o quanto ele desviou do
        // teórico. `custoTotalReal` = valor de fato consumido (Real × custo unitário) — maior valor
        // aqui = maior impacto no custo, tenha ele desviado do teórico ou não.
        custoTotalReal: custoUnitario != null ? Math.round(real * custoUnitario * 100) / 100 : null,
        // 24/08/2026, pedido do Felipe: pra achar os insumos de maior PESO EM VALOR NA RECEITA (não
        // no que foi de fato contado/comprado no período — isso é `custoTotalReal`, ruidoso quando o
        // insumo tem pouco movimento físico no recorte, mesmo sendo um item caro/importante nos
        // pratos). Exemplo dele: filet mignon não aparecia no ranking por `custoTotalReal` porque o
        // real desse período específico ficou baixo, mesmo ele estando presente em todas as
        // contagens. `custoTotalTeorico` usa TEÓRICO (o que as fichas dos pratos vendidos nesse
        // período esperavam consumir) × custo unitário — reflete o peso do insumo na composição das
        // receitas vendidas, não a oscilação de estoque/contagem.
        custoTotalTeorico: custoUnitario != null ? Math.round(v.teorico * custoUnitario * 100) / 100 : null,
        pratos: pratosOrdenados.slice(0, LIMITE_PRATOS_POPUP).map((p) => ({
          codigoPrato: p.codigoPrato, nome: p.nome,
          quantidadeVendida: r3(p.quantidadeVendida),
          quantidadeInsumo: r3(p.quantidadeInsumo), // bruto — o que sai do estoque
          quantidadeLiquida: r3(p.quantidadeLiquida), // líquido — o que vai pro prato
          fatorCorrecao: p.fatorCorrecao != null ? Math.round(p.fatorCorrecao * 100) / 100 : null,
          // Memória de cálculo (14/08/2026, pedido do Felipe) — de onde saiu o fator acima, pra dar
          // pra auditar em vez de só confiar num número. 'registrado' = veio pronto da ficha
          // (`fator_aplicacao`); 'calculado' = essa função calculou bruto÷líquido porque a ficha não
          // tinha o fator cadastrado; null = nem isso, porque o líquido também veio 0/vazio.
          fatorOrigem: p.fatorOrigem,
          fatorRegistrado: p.fatorRegistrado != null ? Math.round(p.fatorRegistrado * 100) / 100 : null,
          percentualAproveitamentoRegistrado: p.percentualAproveitamentoRegistrado,
          // 14/08/2026 (2) — só vem preenchido quando `fatorOrigem === 'calculado_via_preparo'`: nome
          // do preparo intermediário (ex. "PP FILET MIGNON LIMPEZA") usado pra achar o fator de
          // verdade, já que o cadastrado nessa linha da ficha estava sabidamente errado (ver
          // `buscarInsumosEmNatura`).
          preparoIntermediario: p.preparoIntermediario || null,
          // §65: qual preparo ao lado na ficha não pôde ser conferido (ficha ausente/vazia no banco)
          eloIncompleto: p.eloIncompleto || null,
          terminalPorFaltaDeFicha: !!p.terminalPorFaltaDeFicha,
          valorEstimado: custoUnitario != null ? Math.round(p.quantidadeInsumo * custoUnitario * 100) / 100 : null,
          percentualDoTeorico: v.teorico > 0 ? Math.round((p.quantidadeInsumo / v.teorico) * 1000) / 10 : null
        })),
        pratosOcultos: Math.max(0, pratosOrdenados.length - LIMITE_PRATOS_POPUP),
        // 17/08/2026 (3), pedido do Felipe ("total consumido líquido e bruto, vendas e contagem"):
        // total de líquido somando TODOS os pratos (não só os 20 exibidos em `pratos` — por isso
        // soma direto de `pratosOrdenados`, a lista completa, antes do corte). O total de bruto do
        // lado de Vendas não precisa de campo novo: já existe como `teorico` (soma de
        // `quantidadeInsumo` de todos os pratos, sempre a lista completa — ver comentário no cálculo
        // de `real`/`diferenca` acima).
        pratosTotalLiquido: r3(pratosOrdenados.reduce((soma, p) => soma + p.quantidadeLiquida, 0)),
        // 14/08/2026 (3), pedido do Felipe: aba "Contagem" no popup, espelhando a aba "Vendas"
        // (`pratos`) — de onde veio o estoque INICIAL e o estoque FINAL desse insumo (quais produtos
        // contados, quanto cada um gerou, e a memória de cálculo do fator de correção).
        contagemInicial: contagemPorCampo('ei'),
        contagemFinal: contagemPorCampo('ef')
      }
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  return {
    linhas,
    dataInicio,
    dataFim,
    sessoesInicio: diaIni ? diaIni.totalSessoes : 0,
    sessoesFim: diaFim ? diaFim.totalSessoes : 0,
    gapsContagem: Array.from(gapsContagem),
    gapsCompras: Array.from(gapsCompras),
    conferencia
  }
}

// 25/08/2026 (§32), pedido do Felipe: mesma ideia do "ver contagens", mas do lado das vendas —
// clicar num prato dentro de "de onde vem o teórico" e ver as vendas dele no período, linha a
// linha. Casa por `codigo_everest` (identidade canônica, §1), NUNCA por `produto_id`, que é um
// retrato do momento do import e fica órfão quando `produtos` é reimportado.
export async function buscarVendasDoProduto(codigoEverest, { dataInicio = null, dataFim = null } = {}) {
  if (!codigoEverest) return { linhas: [], total: 0, totalValor: 0 }
  let q = supabase.from('vendas_importadas_itens')
    .select('data_movimento, nome_original, quantidade, valor_unitario, valor_total, cancelado, fantasia, grupo_venda')
    .eq('codigo_everest', codigoEverest)
  if (dataInicio) q = q.gte('data_movimento', dataInicio)
  if (dataFim) q = q.lte('data_movimento', dataFim)
  const itens = await buscarTodasAsLinhas(() => q)

  // Agrupa por DIA: uma venda de restaurante gera dezenas de linhas por dia (uma por comanda) —
  // listar linha a linha viraria um paredão ilegível. Canceladas ficam de fora do total, mas são
  // contadas à parte pra não parecerem "dado sumido" (mesma regra do §4).
  const porDia = new Map()
  let canceladas = 0
  for (const it of itens) {
    if (it.cancelado) { canceladas += 1; continue }
    const dia = String(it.data_movimento || '').slice(0, 10)
    if (!porDia.has(dia)) porDia.set(dia, { data: dia, quantidade: 0, valor: 0, lancamentos: 0, loja: new Set() })
    const g = porDia.get(dia)
    g.quantidade += Number(it.quantidade) || 0
    g.valor += Number(it.valor_total) || 0
    g.lancamentos += 1
    g.loja.add(lojaDeVenda(it.fantasia, it.grupo_venda))
  }

  const linhas = [...porDia.values()]
    .map((g) => ({ ...g, loja: [...g.loja].join(', ') }))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)))

  return {
    nome: itens[0]?.nome_original || codigoEverest,
    linhas,
    canceladas,
    total: Math.round(linhas.reduce((a, l) => a + l.quantidade, 0) * 1000) / 1000,
    totalValor: Math.round(linhas.reduce((a, l) => a + l.valor, 0) * 100) / 100
  }
}

// ── Consolidado por data (contagem semanal) ─────────────────────────────────
// Motivo (Felipe, 07/08/2026): hoje, se 3 pessoas contam o mesmo produto no mesmo
// dia, isso pode virar 3 sessões (ou 3 lançamentos) diferentes — nada soma
// automaticamente. Pra comparar Compras × Produção × Venda de forma correta, e pra dar
// "a volta" de cada produto contado pro insumo em natura (fator de correção), primeiro
// precisamos de UM número por produto, por dia. Ver DECISOES-TRAVADAS.md §19.
//
// Regras travadas com o Felipe (revisado 2x no mesmo dia):
// - 1ª volta: consolidar pelo DIA EXATO da contagem, não pela semana ISO inteira.
// - 2ª volta: não filtrar por LOJA — Compras não dá pra separar por loja no Everest, então a
//   Contagem passa a somar todas as lojas juntas também. Quem escopa a conta agora é o GRUPO DE
//   CONTAGEM (ex.: "Proteínas") — cada grupo já define quais produtos ele conta, então escolher
//   o grupo já restringe a lista certa de insumos, sem precisar de loja nem de outro filtro.
// - Data = data_referencia da sessão (fallback: iniciada_em, pra sessão antiga sem esse campo).
// - Soma SEMPRE todo lançamento do mesmo produto, mesmo grupo, mesma data — sem excluir
//   nada, sem tentar detectar "duplicidade" (contagem física de gente diferente é aditiva).
// - Isso alimenta uma tela própria de revisão antes de qualquer coisa — não é silencioso.

// A data que VALE de uma sessão é sempre a que a pessoa INFORMOU, nunca o dia em que ela digitou.
//
// 02/09/2026, pedido do Felipe: "tem gente que lançou depois do dia correto, mas fez a contagem no
// dia certo. Nenhum relatório deve levar em consideração o dia da contagem, e sim a data que eles
// informam."
//
// A cadeia, em ordem de confiança:
//  1. `data_referencia` — o dia informado no lançamento (semanal e perdas). É o mais preciso.
//  2. `mes_referencia`/`ano_referencia` — o mês informado. É o que o INVENTÁRIO MENSAL tem: ele não
//     pede dia nenhum, só o mês ativo. Devolvo o dia 1º como representante do mês.
//  3. `iniciada_em` — o timestamp de criação. Último recurso, e apenas para não devolver nulo em
//     sessão antiga sem nenhuma referência.
//
// ⚠️ O passo 2 é a correção. Antes, `data_referencia` ausente caía DIRETO no `iniciada_em`, então
// todo inventário mensal era datado pelo dia da digitação — um inventário de agosto lançado em 2 de
// setembro contava como setembro. `mesDaSessao` abaixo é o que os relatórios devem usar para
// agrupar por mês.
function dataDaSessao(s) {
  if (s.data_referencia) return s.data_referencia
  if (s.ano_referencia && s.mes_referencia) {
    return `${s.ano_referencia}-${String(s.mes_referencia).padStart(2, '0')}-01`
  }
  return s.iniciada_em ? String(s.iniciada_em).slice(0, 10) : null
}

// Mês de referência no formato AAAA-MM. Prioriza o mês INFORMADO (`mes_referencia`) sobre o mês da
// `data_referencia`: nas contagens semanais os dois sempre batem (a data escolhida alimenta o
// mês — §18.1), e no inventário mensal só o primeiro existe.
function mesDaSessao(s) {
  if (s.ano_referencia && s.mes_referencia) {
    return `${s.ano_referencia}-${String(s.mes_referencia).padStart(2, '0')}`
  }
  const d = dataDaSessao(s)
  return d ? d.slice(0, 7) : null
}

// Distingue a data informada da inferida — pra tela poder avisar em vez de apresentar um dia que
// ninguém digitou como se fosse fato.
function origemDaDataDaSessao(s) {
  if (s.data_referencia) return 'informada'
  if (s.ano_referencia && s.mes_referencia) return 'mes_referencia'
  return 'criacao'
}

// Lista as datas exatas que têm pelo menos 1 sessão de contagem semanal desse grupo de
// contagem (em qualquer loja) — pra popular o seletor da tela de revisão e do CMV Real × Teórico.
export async function listarDatasContagemPorGrupo(grupoId) {
  if (!grupoId) return []
  // 09/09/2026: passou a filtrar `status = 'finalizada'`. Antes, uma sessão 'em_andamento' —
  // alguém começou a contar, não terminou, e nunca mais voltou — entrava na soma junto com a
  // sessão de verdade da mesma data, porque cada item já é gravado no banco assim que a pessoa
  // digita (não só no envio final). Isso inflava estoque inicial/final sem nenhuma compra ou
  // contagem física explicando a diferença — foi exatamente o padrão investigado com o Felipe
  // (estoque final maior que inicial + compras).
  //
  // Esta função alimenta só as CONTAS (`buscarCMVSemanal`, `buscarConsolidadoPorData`) e os
  // seletores de data dessas duas telas — nunca o Histórico de sessões do admin (que usa
  // `listarSessoes`, sem esse filtro, de propósito: é lá que se precisa VER e agir sobre sessão
  // em andamento, não escondê-la).
  const { data: sessoes, error } = await supabase
    .from('sessoes_contagem')
    .select('id, data_referencia, iniciada_em, status')
    .eq('grupo_id', grupoId)
    .eq('tipo', 'semanal')
    .eq('status', 'finalizada')
  if (error) throw error
  const porData = new Map()
  for (const s of (sessoes || [])) {
    const data = dataDaSessao(s)
    if (!data) continue
    if (!porData.has(data)) porData.set(data, { data, sessoes: [] })
    porData.get(data).sessoes.push(s)
  }
  // Ordem: mais antigo pro mais novo (pedido do Felipe — listas suspensas de data, mais antigo primeiro).
  return Array.from(porData.values())
    .map((d) => ({ ...d, totalSessoes: d.sessoes.length }))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))
}

// Motor do "fator de correção automático": acha, dentro da própria ficha técnica de um
// produto, a(s) linha(s) de ingrediente que são insumo em natura de verdade — ou seja,
// cujo código Everest NUNCA aparece como ficha própria de outro produto (não é ele mesmo
// "achatado" em outro lugar dentro da mesma ficha). O Everest já traz essa linha pronta;
// não precisamos recursão manual nem montar tabela par-a-par. Ver DECISOES-TRAVADAS.md §19
// (exemplo completo, testado com o Filet Mignon).
let _cacheFichasConversao = null

// 28/08/2026 — BUG: o cache acima nunca era invalidado. Ele é carregado na PRIMEIRA vez que
// qualquer tela pede conversão (CMV, Diagnóstico, Árvore, Consolidado) e vive enquanto a aba
// estiver aberta. Importar fichas técnicas na mesma sessão gravava tudo certo no banco, mas todo
// relatório continuava lendo o retrato ANTERIOR ao import — a ficha nova simplesmente não
// existia para o motor. Foi o que aconteceu com o `EV PR FILET PURE MANDIOCA` (1869): import
// reportou sucesso (755 fichas), e o Diagnóstico seguiu dizendo "SEM FICHA TÉCNICA".
//
// Sintoma traiçoeiro: some sozinho ao recarregar a página, o que faz parecer problema de import
// ou de vínculo do produto. Agora todo caminho que ESCREVE em fichas_tecnicas limpa o cache.
export function invalidarCacheFichas() {
  _cacheFichasConversao = null
  _cacheFichasTravadasIncompletas = null
}

async function carregarFichasParaConversao() {
  if (_cacheFichasConversao) return _cacheFichasConversao
  const fichas = await buscarTodasAsLinhas(() => supabase.from('fichas_tecnicas').select('id, codigo_everest, nome, unidade_medida'))
  const codigosComFicha = new Set(fichas.map((f) => f.codigo_everest).filter(Boolean))
  const fichaIdPorCodigo = new Map(fichas.filter((f) => f.codigo_everest).map((f) => [f.codigo_everest, f.id]))
  // 20/08/2026: reverso de `fichaIdPorCodigo` (ficha -> código do produto que ELA representa) +
  // nome/unidade direto da própria ficha — usado pela Árvore de Usos (`buscarArvoreDeUsos`) pra
  // andar PRA FRENTE (de um insumo pra tudo que é feito a partir dele), sem precisar de uma 2ª
  // consulta a `fichas_tecnicas`.
  const codigoPorFichaId = new Map(fichas.filter((f) => f.codigo_everest).map((f) => [f.id, f.codigo_everest]))
  const nomePorCodigoFicha = new Map(fichas.filter((f) => f.codigo_everest).map((f) => [f.codigo_everest, f.nome]))
  const unidadePorCodigoFicha = new Map(fichas.filter((f) => f.codigo_everest).map((f) => [f.codigo_everest, f.unidade_medida]))
  const fichaIds = fichas.map((f) => f.id)
  const ingredientesPorFicha = new Map()
  for (let i = 0; i < fichaIds.length; i += 300) {
    const lote = fichaIds.slice(i, i + 300)
    const ings = await buscarTodasAsLinhas(() =>
      // 28/08/2026 (§49) — `tipo_item` FALTAVA neste select, e é ele que o motor usa desde §44 para
      // saber o que é comprado (MATERIA PRIMA) e o que é produzido (PRODUTO EM PROCESSO). Sem o
      // campo, `tipoPorCodigo` nascia vazio: a decisão de "insumo base" caía o tempo todo no
      // fallback ("não tem ficha própria"), e a busca do preparo que dá o LÍQUIDO rejeitava todos
      // os irmãos — por isso líquido saía igual ao bruto e o FC dava 1 na tela do Felipe.
      // `tipo_baixa` vem junto porque distingue ingrediente direto (CONSUMO) da explosão da cadeia
      // no formato novo de export.
      supabase.from('fichas_tecnicas_ingredientes').select('ficha_id, codigo_everest, nome, unidade_medida, tipo_item, tipo_baixa, quantidade_baixa_estoque, quantidade_aplicada, fator_aplicacao, percentual_aproveitamento').in('ficha_id', lote)
    )
    for (const ing of ings) {
      if (!ingredientesPorFicha.has(ing.ficha_id)) ingredientesPorFicha.set(ing.ficha_id, [])
      ingredientesPorFicha.get(ing.ficha_id).push(ing)
    }
  }
  _cacheFichasConversao = { codigosComFicha, fichaIdPorCodigo, ingredientesPorFicha, codigoPorFichaId, nomePorCodigoFicha, unidadePorCodigoFicha }
  return _cacheFichasConversao
}

// Retorna a lista de insumos em natura (folhas) por 1 unidade do produto `codigoEverest` —
// já com a cadeia inteira resolvida (pode ter mais de 1 insumo, em receita composta).
// Retorna null se esse código não tem ficha técnica cadastrada (gap, não zero).
//
// 13/08/2026, pedido do Felipe (no popup "de onde veio o teórico" do CMV Semanal, ver
// `buscarCMVSemanal`): além da quantidade BRUTA (`quantidade_baixa_estoque` — o que sai do estoque,
// já contando a perda de limpeza/preparo), também devolve a quantidade LÍQUIDA (`quantidade_aplicada`
// — o que de fato vai pro prato) e o fator de correção daquele ingrediente NESSA ficha. Fator de
// correção = bruto ÷ líquido (quanto comprar pra sobrar o líquido necessário depois da limpeza) —
// prefere o `fator_aplicacao` já calculado pelo Everest (coluna "Fator" da Ficha Técnica); só
// calcula na mão (bruto ÷ líquido) se essa coluna vier vazia, pra nunca ficar sem o número.
//
// 14/08/2026, pedido do Felipe ("não faz sentido termos fator de correção 1... precisamos enxergar
// a memória de cálculo"): quando o fator sai 1 (bruto = líquido), isso quase sempre significa que a
// LINHA DESSA FICHA não tem `fator_aplicacao`/`percentual_aproveitamento` cadastrado no Everest —
// não é um bug de conta, é uma lacuna no cadastro dessa ficha específica. Pra deixar isso visível em
// vez de só entregar um "1" sem explicação, também devolve os valores BRUTOS registrados
// (`percentualAproveitamentoRegistrado`, `fatorRegistrado` — null quando vazio/zero, nunca 0 fingindo
// que foi cadastrado) e `fatorOrigem` ('registrado' = veio pronto do Everest; 'calculado' = essa
// função calculou bruto÷líquido porque a coluna Fator não veio preenchida; null = nem bruto÷líquido
// deu pra calcular, líquido zerado).
//
// 14/08/2026 (2) — Felipe mandou a base de Ficha Técnica (DOM + Dalva) pra investigar o filet mignon
// especificamente, e a causa raiz achada foi mais funda que "campo vazio": a ficha do PREPARO
// INTERMEDIÁRIO (ex. "PP FILET MIGNON LIMPEZA", que representa o filet DEPOIS da limpeza) tem a
// quantidade BRUTA certa cadastrada (ex. 1,247829 kg de peça crua pra produzir 1 kg de filet limpo —
// os ~80% de rendimento real estão implícitos nessa conta), mas os campos "% Aproveitamento"/"Fator"
// dessa MESMA linha ficam travados em 100%/1 em toda a árvore — nunca foram preenchidos de verdade no
// Everest (confirmado em 25 fichas diferentes, sempre com a mesma razão ~1,2478, o que descarta
// coincidência). Como esse número errado (1) também aparece "herdado" na linha informativa do insumo
// em natura (ex. BOVINO FILET MIGNON PECA) dentro da ficha do PRATO final, a função original acabava
// devolvendo Fator=1 mesmo quando a quantidade cadastrada já provava que havia perda real.
// A correção: quando o fator "normal" (registrado ou bruto÷líquido da própria linha) dá EXATAMENTE 1
// — o sintoma que motivou a investigação — procura, na mesma ficha, uma linha-irmã que seja um
// preparo intermediário feito só a partir dessa mesma folha (tem ficha própria, e a ficha dele só
// consome esse insumo). Achando, ignora o Fator/%Aproveitamento cadastrado (sabidamente quebrado
// nessa cadeia) e calcula o fator de verdade como bruto (a quantidade da folha, já correta) ÷ líquido
// (a quantidade do preparo intermediário de fato usada nessa ficha) — ex. 0,311957 ÷ 0,250000 = 1,2478
// pro filet mignon na ficha "DD PR ALIGOT COM FILET". Ver DECISOES-TRAVADAS.md §3/§5 (achado completo).
// ---------------------------------------------------------------------------
// 27/08/2026 (§44) — MOTOR REESCRITO NO MODELO DE GRAFO DE CÓDIGOS.
//
// O Felipe descreveu o modelo certo, e ele é mais simples do que o que estava aqui:
//   "a ficha técnica é uma aresta: o código X consome Q do código Y. Código de compra é o fim da
//    linha. Código de venda ou de processo se desmembra até chegar num código de compra."
//
// O que estava errado no motor anterior:
//   1. "Insumo base" era definido por AUSÊNCIA de dado — "linha que não tem ficha própria". Isso
//      fazia sal e manteiga pararem a busca, e fazia PP sem ficha ser tratado como matéria-prima.
//      Agora o critério é o que o próprio Everest declara na coluna "Tipo do Item"
//      (`tipo_item`): MATERIA PRIMA / MERCADORIA PARA REVENDA / EMBALAGEM / MATERIAL DE USO E
//      CONSUMO são comprados; PRODUTO EM PROCESSO / PRODUTO ACABADO são produzidos.
//   2. A descida na cadeia só acontecia quando NENHUMA folha era encontrada (§33) — meia correção.
//      Agora desce sempre, em todo ingrediente produzido.
//   3. Existia uma muleta (`acharPreparoIntermediario`) que, quando o fator dava 1, procurava um
//      preparo vizinho e recalculava o fator. Ela acertava o número pelo motivo errado. REMOVIDA:
//      a quantidade que converte um preparo no insumo de origem já está na ficha do próprio
//      preparo (ex.: 1,247829 kg de peça por kg de PP Filet Mignon Limpeza).
//
// Guarda-corpo contra dupla contagem — "LINHA DIRETA MANDA": o export do Everest costuma trazer,
// na mesma ficha, o preparo intermediário E o insumo de origem já achatado (validado com os dois
// arquivos reais em 27/08: nas 25 fichas que chegam na peça de filet, todas as 25 têm a peça
// escrita nelas mesmas). Se um código aparece escrito na ficha, ele NÃO recebe nada do que a
// recursão trouxer — senão o insumo seria contado duas vezes.
//
// Terminal por falta de ficha: produto declarado como produzido mas sem ficha cadastrada não é
// descartado (66 casos na base real) — entra como terminal e fica marcado com
// `terminalPorFaltaDeFicha`, pra aparecer como gap na tela em vez de sumir da conta.
//
// VALIDADO contra os dois exports reais (DOM 186 fichas + Dalva 417): o consumo calculado pelo
// grafo reproduz a linha achatada do Everest nos 14 pratos vendáveis que usam filet, com precisão
// de 6 casas; e o resultado é idêntico ao do motor anterior em toda a base (0 divergências
// materiais). Ou seja: é uma correção de ROBUSTEZ, não de números — nesta base o antigo já
// acertava, porque o Everest achata tudo. Se um dia o Everest deixar de achatar, o antigo erraria
// e este não.
const TIPOS_COMPRAVEIS = new Set(['MATERIA PRIMA', 'MERCADORIA PARA REVENDA', 'EMBALAGEM', 'MATERIAL DE USO E CONSUMO'])
const PROFUNDIDADE_MAXIMA_GRAFO = 8

function normalizarTipoItem(t) {
  return String(t || '').trim().toUpperCase()
}

export async function buscarInsumosEmNatura(codigoEverest) {
  if (!codigoEverest) return null
  const { fichaIdPorCodigo, ingredientesPorFicha } = await carregarFichasParaConversao()
  if (!fichaIdPorCodigo.get(codigoEverest)) return null

  // tipo_item declarado pelo Everest, por código — colhido de todas as linhas de ingrediente.
  const tipoPorCodigo = new Map()
  for (const lista of ingredientesPorFicha.values()) {
    for (const ing of lista) {
      if (ing.codigo_everest && !tipoPorCodigo.has(ing.codigo_everest)) {
        tipoPorCodigo.set(ing.codigo_everest, normalizarTipoItem(ing.tipo_item))
      }
    }
  }
  const ehCompravel = (codigo) => {
    const t = tipoPorCodigo.get(codigo)
    // Sem tipo declarado e sem ficha própria: trata como comprado (é o comportamento seguro —
    // é onde ficam itens antigos importados antes de `tipo_item` existir no schema).
    if (!t) return !fichaIdPorCodigo.get(codigo)
    return TIPOS_COMPRAVEIS.has(t)
  }

  const infoPorCodigo = new Map()
  for (const lista of ingredientesPorFicha.values()) {
    for (const ing of lista) {
      if (ing.codigo_everest && !infoPorCodigo.has(ing.codigo_everest)) {
        infoPorCodigo.set(ing.codigo_everest, { nome: ing.nome, unidade: ing.unidade_medida })
      }
    }
  }

  // Desce o grafo somando quantidade BRUTA (`quantidade_baixa_estoque`) e LÍQUIDA
  // (`quantidade_aplicada`) por código terminal.
  function descer(codigo, profundidade, visitados) {
    const fichaId = fichaIdPorCodigo.get(codigo)
    if (!fichaId || profundidade > PROFUNDIDADE_MAXIMA_GRAFO || visitados.has(codigo)) return null
    const linhas = ingredientesPorFicha.get(fichaId) || []
    if (!linhas.length) return null
    const proximos = new Set([...visitados, codigo])

    // Dedupe da duplicação por empresa (§30): a mesma linha vem uma vez por empresa (D.O.M. e
    // Dalva), com quantidades idênticas e só o custo diferente. Colapsa quando bruto E líquido
    // batem; quantidades diferentes são uso legítimo repetido e continuam somando.
    const vistas = new Set()
    const linhasUnicas = []
    for (const ing of linhas) {
      if (!ing.codigo_everest) continue
      const assinatura = `${ing.codigo_everest}|${ing.quantidade_baixa_estoque}|${ing.quantidade_aplicada}`
      if (vistas.has(assinatura)) continue
      vistas.add(assinatura)
      linhasUnicas.push(ing)
    }

    const escritosNaFicha = new Set(linhasUnicas.map((i) => i.codigo_everest))
    const acumulado = new Map() // codigo terminal -> { bruto, liquido, terminalPorFaltaDeFicha }
    const somar = (cod, bruto, liquido, gap) => {
      if (!acumulado.has(cod)) acumulado.set(cod, { bruto: 0, liquido: 0, terminalPorFaltaDeFicha: false })
      const a = acumulado.get(cod)
      a.bruto += bruto
      a.liquido += liquido
      if (gap) a.terminalPorFaltaDeFicha = true
    }

    for (const ing of linhasUnicas) {
      const bruto = Number(ing.quantidade_baixa_estoque) || 0
      const liquidoLinha = Number(ing.quantidade_aplicada) || 0
      const quantidade = bruto > 0 ? bruto : liquidoLinha
      if (quantidade <= 0) continue

      if (ehCompravel(ing.codigo_everest)) {
        somar(ing.codigo_everest, bruto || quantidade, liquidoLinha || quantidade, false)
        continue
      }
      const sub = descer(ing.codigo_everest, profundidade + 1, proximos)
      if (!sub) {
        // Produzido, mas sem ficha cadastrada — vira terminal sinalizado, nunca desaparece.
        somar(ing.codigo_everest, bruto || quantidade, liquidoLinha || quantidade, true)
        continue
      }
      for (const [cod, a] of sub) {
        if (escritosNaFicha.has(cod)) continue // LINHA DIRETA MANDA (anti-achatamento duplicado)
        somar(cod, a.bruto * quantidade, a.liquido * quantidade, a.terminalPorFaltaDeFicha)
      }
    }
    return acumulado
  }

  const resultado = descer(codigoEverest, 0, new Set())
  if (!resultado) return []

  // 28/08/2026 (§49), correção apontada pelo Felipe: "o valor líquido já é o valor bruto e o FC não
  // faz sentido... pensando em unidade, o líquido seria 0,150 e o bruto 0,187; o FC seria 80%".
  //
  // Ele está certo, e a causa é estrutural: o motor pega a linha ACHATADA do insumo (0,187174 kg de
  // peça) e nunca olha o preparo que está ao lado dela na mesma ficha (0,150 kg de PP Filet Mignon
  // Limpeza). Sem esse elo, líquido e bruto viram o mesmo número e o "fator" acabava exibindo a
  // própria quantidade — 0,19 — que não é fator de coisa nenhuma.
  //
  // Agora, para cada insumo encontrado, procura na MESMA ficha o preparo irmão que o origina. A
  // quantidade dele é o LÍQUIDO; o aproveitamento é líquido ÷ bruto.
  //
  // Dois guarda-corpos, ambos aprendidos testando contra as fichas reais (28/08):
  //   1. O irmão precisa ser PRODUTO EM PROCESSO. Sem isso, o "DD MN Fechado Namorados 26" casava
  //      com outro PRATO do menu e devolvia 707% de aproveitamento.
  //   2. O irmão precisa resolver para ESSE insumo e mais nenhum — ou seja, ser feito só dele.
  //      Sem isso, o Picadinho casava com "PP Picadinho Final Produção" (que leva outros
  //      ingredientes) e devolvia 115%, o que é impossível numa etapa de limpeza.
  //   3. E o produto (qtd do preparo × rendimento dele) tem que reproduzir o bruto, com 2% de
  //      tolerância — é o que confirma que o elo achado é mesmo o caminho daquele insumo.
  // Com as três travas, os 22 pratos com filet da base real dão 80,1%, e o Exec Carne dá
  // exatamente 0,150 → 0,187174. Sem elo identificável, líquido = bruto e aproveitamento = 100%,
  // que é o correto para prato que usa o insumo cru direto.
  const linhasDaFicha = ingredientesPorFicha.get(fichaIdPorCodigo.get(codigoEverest)) || []

  // 02/09/2026 (§65) — 100% NÃO PODE SAIR CALADO.
  //
  // O comentário acima diz que "sem elo identificável, líquido = bruto e aproveitamento = 100%, que
  // é o correto para prato que usa o insumo cru direto". Isso é verdade para UM dos casos e falso
  // para o outro, e os dois saíam iguais na tela:
  //   (a) a ficha realmente não tem preparo nenhum ao lado — o prato usa a peça crua. 100% correto.
  //   (b) a ficha TEM o preparo ao lado (ex.: `PP FILET MIGNON LIMPEZA` 0,25 junto de
  //       `BOVINO FILET MIGNON PECA` 0,311957), mas a ficha DESSE preparo não pôde ser conferida —
  //       ela não existe no banco, ou existe sem nenhuma linha de ingrediente (o rastro do §46:
  //       delete que rodava sem insert). Aí o elo não é achado, o líquido cai no bruto, e a tela
  //       afirma 100% de aproveitamento numa etapa de limpeza — que é justamente onde a perda mora.
  //
  // O caso (b) é o sintoma que o Felipe reportou no build 51 (`DD PR ALIGOT COM FILET`, 68
  // vendidos, líquido = bruto = 21,213 kg) e que o motor rodado aqui contra os ARQUIVOS de ficha
  // devolvia certo (80,1%) — ou seja, a diferença está no banco, não na conta.
  //
  // Esta função agora devolve, além do elo achado, a lista dos irmãos que ERAM candidatos e não
  // deram pra conferir, com o motivo. Nada disso entra no cálculo (continuar sem elo é o
  // comportamento seguro — inventar 80,1% seria chutar); serve pra tela poder dizer QUAL código
  // precisa ser reimportado, em vez de mostrar um número redondo sem explicação.
  async function acharLiquidoDoElo(codigoBase, bruto) {
    let melhor = null
    const incompletos = []
    for (const irmao of linhasDaFicha) {
      const cod = irmao.codigo_everest
      if (!cod || cod === codigoBase) continue
      if (normalizarTipoItem(tipoPorCodigo.get(cod)) !== 'PRODUTO EM PROCESSO') continue
      const qtd = Number(irmao.quantidade_baixa_estoque) || Number(irmao.quantidade_aplicada) || 0
      if (qtd <= 0) continue
      const sub = descer(cod, 1, new Set([codigoEverest]))
      if (!sub) {
        // `descer` devolve null nos dois casos que impedem a conferência: sem ficha cadastrada, e
        // com ficha mas sem linha de ingrediente. A distinção importa porque a ação é diferente
        // (cadastrar no Everest vs. reimportar a ficha), então vai separada.
        const temFicha = !!fichaIdPorCodigo.get(cod)
        incompletos.push({
          codigo: cod,
          nome: irmao.nome,
          quantidade: Math.round(qtd * 1000000) / 1000000,
          motivo: temFicha ? 'ficha_vazia' : 'sem_ficha',
          // O que o aproveitamento passaria a ser se esse elo fosse conferido — a quantidade do
          // preparo na ficha do prato dividida pelo bruto do insumo. É a medida do impacto, não um
          // número usado na conta.
          aproveitamentoProvavel: bruto > 0 ? Math.round((qtd / bruto) * 1000) / 10 : null
        })
        continue
      }
      if (sub.size !== 1 || !sub.has(codigoBase)) continue
      const previsto = sub.get(codigoBase).bruto * qtd
      const erro = Math.abs(previsto - bruto)
      if (erro <= Math.max(0.0005, bruto * 0.02) && (!melhor || erro < melhor.erro)) {
        melhor = { quantidade: qtd, erro, nome: irmao.nome, codigo: cod }
      }
    }
    // Ordena só pra escolher qual mostrar primeiro: primeiro os que dariam um aproveitamento
    // possível (acima de 0% e até 100%), depois pelo maior. Nenhum entra no cálculo.
    incompletos.sort((a, b) => {
      const plausivel = (x) => (x.aproveitamentoProvavel > 0 && x.aproveitamentoProvavel <= 100 ? 1 : 0)
      if (plausivel(a) !== plausivel(b)) return plausivel(b) - plausivel(a)
      return (b.aproveitamentoProvavel || 0) - (a.aproveitamentoProvavel || 0)
    })
    return { melhor, incompletos }
  }

  const saida = []
  for (const [cod, a] of resultado.entries()) {
    const info = infoPorCodigo.get(cod) || {}
    const bruto = Math.round(a.bruto * 1000000) / 1000000
    const achado = bruto > 0 ? await acharLiquidoDoElo(cod, a.bruto) : null
    const elo = achado ? achado.melhor : null
    // §65: só vale como aviso quando NÃO houve elo. Achando o elo, o número está conferido e um
    // candidato descartado no meio do caminho não interessa a ninguém.
    const eloIncompleto = !elo && achado && achado.incompletos.length ? achado.incompletos[0] : null
    const liquido = elo
      ? Math.round(elo.quantidade * 1000000) / 1000000
      : Math.round(a.liquido * 1000000) / 1000000
    // O "fator de correção" deixa de ser um campo próprio: ele É a quantidade do insumo de origem
    // por 1 unidade deste produto (ex.: 1,247829 kg de peça por kg de PP Filet Mignon Limpeza).
    // Quando o produto É o próprio insumo, dá 1 naturalmente.
    saida.push({
      codigoEverest: cod,
      nome: info.nome || cod,
      unidade: info.unidade || null,
      quantidadePorUnidade: bruto,
      quantidadeLiquidaPorUnidade: liquido,
      // O fator agora é o MULTIPLICADOR de verdade (bruto ÷ líquido = 1,2478), e a tela mostra o
      // aproveitamento (80,1%). Antes aqui vinha a própria quantidade, que virava "FC 0,19".
      fatorCorrecao: liquido > 0 ? Math.round((bruto / liquido) * 1000000) / 1000000 : null,
      fatorOrigem: elo ? 'via_preparo' : 'insumo_direto',
      fatorRegistrado: null,
      percentualAproveitamentoRegistrado: liquido > 0 && bruto > 0 ? Math.round((liquido / bruto) * 1000) / 10 : null,
      preparoIntermediario: elo ? { codigo: elo.codigo, nome: elo.nome, quantidade: liquido } : null,
      // §65: preenchido quando o aproveitamento saiu 100% NÃO por o prato usar o insumo cru, mas
      // porque o preparo que está ao lado dele na ficha não pôde ser conferido (ficha ausente ou
      // vazia no banco). { codigo, nome, quantidade, motivo, aproveitamentoProvavel }.
      eloIncompleto,
      elosIncompletos: achado ? achado.incompletos : [],
      terminalPorFaltaDeFicha: a.terminalPorFaltaDeFicha,
      duplicatasPorEmpresaRemovidas: 0,
      multiplasLinhas: false,
      resolvidoPorCadeia: true
    })
  }
  return saida
}

// 25/08/2026, pedido do Felipe (substitui o "ver transformação" do CMV Real × Teórico, que ele
// disse não fazer sentido ali): a partir de um produto contado, listar TODA contagem registrada
// dele — data, quem contou, quantidade — com a soma no fim. Objetivo é rastreabilidade: ver de
// onde saiu o número que o relatório está usando, lançamento por lançamento.
//
// `usuario` do item (coluna criada na migration_v10) é quem de fato LANÇOU aquela linha; a sessão
// tem seu próprio `usuario`, que é só quem ABRIU a contagem — pode ser outra pessoa. Mostra o do
// item e cai pro da sessão só quando o item não tem (lançamento anterior à v10).
export async function buscarContagensDoProduto(codigoEverest, { dataInicio = null, dataFim = null, grupoId = null } = {}) {
  if (!codigoEverest) return { linhas: [], total: 0 }

  const { data: produto } = await supabase
    .from('produtos').select('id, nome, unidade_medida').eq('codigo_everest', codigoEverest).maybeSingle()
  if (!produto) return { linhas: [], total: 0, semProduto: true }

  // Nome da loja vem por join na própria consulta (`unidades(nome)`), não por uma 2ª consulta +
  // Map — era assim antes e a coluna Loja saía vazia em todas as linhas (25/08/2026).
  let qSessoes = supabase.from('sessoes_contagem').select('id, usuario, tipo, status, unidade_id, data_referencia, iniciada_em, unidades(nome)')
  if (grupoId) qSessoes = qSessoes.eq('grupo_id', grupoId)
  const { data: sessoes, error: erroSessoes } = await qSessoes
  if (erroSessoes) throw erroSessoes

  const dentroDoPeriodo = (s) => {
    if (!dataInicio && !dataFim) return true
    const d = dataDaSessao(s)
    if (!d) return false
    if (dataInicio && d < dataInicio) return false
    if (dataFim && d > dataFim) return false
    return true
  }
  const sessoesFiltradas = (sessoes || []).filter(dentroDoPeriodo)
  if (!sessoesFiltradas.length) return { linhas: [], total: 0 }

  const infoSessao = new Map(sessoesFiltradas.map((s) => [s.id, s]))
  const itens = await buscarPorIdsEmLotes(
    (lote) => supabase.from('itens_contagem')
      .select('sessao_id, quantidade, usuario, registrado_em')
      .eq('produto_id', produto.id)
      .in('sessao_id', lote),
    sessoesFiltradas.map((s) => s.id)
  )

  const linhas = itens.map((it) => {
    const s = infoSessao.get(it.sessao_id) || {}
    return {
      data: dataDaSessao(s) || String(it.registrado_em || '').slice(0, 10),
      registradoEm: it.registrado_em,
      usuario: it.usuario || s.usuario || '—',
      loja: s.unidades?.nome || '—',
      tipo: s.tipo || '—',
      status: s.status || '—',
      quantidade: Number(it.quantidade) || 0
    }
  }).sort((a, b) => (String(b.registradoEm || b.data)).localeCompare(String(a.registradoEm || a.data)))

  return {
    produto: { nome: produto.nome, unidade: produto.unidade_medida, codigoEverest },
    linhas,
    total: Math.round(linhas.reduce((a, l) => a + l.quantidade, 0) * 1000) / 1000
  }
}

// --------------------------------------------------------------------------- A partir de 1
// insumo em natura (ou de qualquer PP), mostra tudo que já foi registrado como "feito a partir
// dele", em quantos níveis o Everest tiver ficha cadastrada. Pedido do Felipe (exercício da peça
// de filet mignon → PP limpo → Medalhão/Aparas → pratos vendidos), validado com um mockup antes de
// implementar (ver DECISOES-TRAVADAS.md).
//
// Modelo confirmado com o Felipe — importante, mudou depois do mockup inicial:
// - Cada ficha registra "quanto do ingrediente-pai é preciso pra fazer 1 unidade do produto-filho"
//   — é uma RECEITA, não um retrato de como um lote físico se repartiu de verdade. Se o mesmo
//   código aparece como ingrediente em 2 fichas diferentes (ex.: PP Limpo usado tanto na ficha do
//   Medalhão quanto na ficha das Aparas), são 2 USOS POSSÍVEIS registrados — ramos alternativos,
//   cada um seu próprio caminho isolado, NÃO uma divisão simultânea do mesmo lote físico.
// - Dentro de CADA caminho (pai → filho): a perda absorve no custo por kg — o valor total em R$
//   se mantém igual do pai pro filho, só concentrado em menos unidades (por isso o R$/kg sobe).
// - Fim de linha: código que nunca aparece como ingrediente de nenhuma outra ficha (prato vendido,
//   ou insumo/PP sem uso registrado ainda).
// - Fator ausente numa ficha (gap de cadastro, mesmo princípio de `buscarInsumosEmNatura` acima):
//   nunca tratado como 1 escondido — o ramo vem marcado `fatorAusente: true`, sem número inventado,
//   e a árvore não desce mais além desse ponto (sem fator, a quantidade do filho é desconhecida).

const PROFUNDIDADE_MAXIMA_ARVORE_USOS = 6
// Guarda-corpo: um insumo genérico (ex. "Sal") usado em dezenas de fichas não devia gerar uma
// árvore gigante sem avisar — trunca e sinaliza em vez de travar a tela.
const MAX_RAMOS_POR_NO_ARVORE_USOS = 40

// Preço mais recente conhecido de compra (mesmo princípio de forward-fill já usado em
// `buscarCMVReal`/`buscarResumoContabil`, só que pra 1 produto só, sob demanda — não precisa
// carregar o histórico inteiro da empresa pra montar a árvore de 1 insumo).
async function buscarCustoMedioAtual(codigoEverest) {
  const { data: itens, error } = await supabase
    .from('notas_importadas_itens').select('nota_id, valor_unitario, calcula_cmv').eq('codigo_everest', codigoEverest)
  if (error) throw error
  const validos = (itens || []).filter((i) => i.calcula_cmv !== false && i.valor_unitario != null)
  if (!validos.length) return null
  const idsNotas = [...new Set(validos.map((i) => i.nota_id))]
  const notas = []
  for (let i = 0; i < idsNotas.length; i += 300) {
    const lote = idsNotas.slice(i, i + 300)
    const { data, error: erroNotas } = await supabase.from('notas_importadas').select('id, data_emissao').in('id', lote)
    if (erroNotas) throw erroNotas
    notas.push(...(data || []))
  }
  const dataPorNota = new Map(notas.map((n) => [n.id, n.data_emissao]))
  let melhor = null
  for (const item of validos) {
    const data = dataPorNota.get(item.nota_id)
    if (!data) continue
    if (!melhor || data > melhor.data) melhor = { data, preco: Number(item.valor_unitario) }
  }
  return melhor ? melhor.preco : null
}

// Retorna a árvore completa de usos a partir de 1 código Everest (o insumo/PP escolhido no admin).
// `null` se o código nem existe no cadastro atual de Produtos.
export async function buscarArvoreDeUsos(codigoEverestRaiz) {
  if (!codigoEverestRaiz) return null
  const { ingredientesPorFicha, codigoPorFichaId, nomePorCodigoFicha, unidadePorCodigoFicha } = await carregarFichasParaConversao()

  const usosPorCodigoIngrediente = new Map()
  for (const [fichaId, ingredientes] of ingredientesPorFicha) {
    const codigoFilho = codigoPorFichaId.get(fichaId)
    if (!codigoFilho) continue
    for (const ing of ingredientes) {
      if (!ing.codigo_everest) continue
      if (!usosPorCodigoIngrediente.has(ing.codigo_everest)) usosPorCodigoIngrediente.set(ing.codigo_everest, [])
      usosPorCodigoIngrediente.get(ing.codigo_everest).push({
        codigoFilho,
        quantidadeBaixaEstoque: Number(ing.quantidade_baixa_estoque) || 0,
        quantidadeAplicada: Number(ing.quantidade_aplicada) || 0,
        fatorAplicacao: Number(ing.fator_aplicacao) || 0
      })
    }
  }

  // Nome/unidade/categoria da raiz — pode não ter ficha própria (é insumo cru), então busca em
  // `produtos` (cadastro atual), não em `fichas_tecnicas`.
  const { data: raiz, error: erroRaiz } = await supabase
    .from('produtos').select('codigo_everest, nome, unidade_medida, categoria').eq('codigo_everest', codigoEverestRaiz).maybeSingle()
  if (erroRaiz) throw erroRaiz
  if (!raiz) return null

  const custoPorKgRaiz = await buscarCustoMedioAtual(codigoEverestRaiz)
  const codigosVisitados = new Set([codigoEverestRaiz])
  // 26/08/2026 (§40) — dedupe GLOBAL. A proteção contra ciclo era por CAMINHO
  // (`caminhoAncestral`), então um código alcançável por várias rotas — e no filet mignon quase
  // todos são, porque a ficha do Everest vem achatada — tinha a subárvore inteira reconstruída a
  // cada rota. Resultado: "PP Picadinho Final Cozinha" e companhia repetidos dezenas de vezes, uma
  // árvore ilegível. Agora cada código é EXPANDIDO uma vez só; nas demais ocorrências o nó aparece
  // marcado como `jaExpandido` (mostra o item e a quantidade daquele caminho, mas não repete os
  // descendentes).
  const jaExpandidos = new Set()

  function construir(codigoEverest, nome, unidadeMedida, quantidade, custoPorKg, profundidade, caminhoAncestral) {
    const valorTotal = custoPorKg != null ? Math.round(quantidade * custoPorKg * 100) / 100 : null
    const no = {
      codigoEverest, nome, unidadeMedida,
      quantidade: quantidade != null ? Math.round(quantidade * 10000) / 10000 : null,
      custoPorKg: custoPorKg != null ? Math.round(custoPorKg * 100) / 100 : null,
      valorTotal,
      filhos: [],
      fatorAusente: false,
      truncadoPorProfundidade: false,
      truncadoPorExcessoDeRamos: false
    }
    if (profundidade >= PROFUNDIDADE_MAXIMA_ARVORE_USOS) { no.truncadoPorProfundidade = true; return no }
    if (caminhoAncestral.has(codigoEverest)) return no // guarda-corpo contra ciclo (não devia existir, mas não trava a tela)
    if (jaExpandidos.has(codigoEverest)) { no.jaExpandido = true; return no }
    jaExpandidos.add(codigoEverest)

    const usos = usosPorCodigoIngrediente.get(codigoEverest) || []
    const usosConsiderados = usos.slice(0, MAX_RAMOS_POR_NO_ARVORE_USOS)
    no.truncadoPorExcessoDeRamos = usos.length > MAX_RAMOS_POR_NO_ARVORE_USOS

    for (const uso of usosConsiderados) {
      const nomeFilho = nomePorCodigoFicha.get(uso.codigoFilho) || uso.codigoFilho
      const unidadeFilho = unidadePorCodigoFicha.get(uso.codigoFilho) || unidadeMedida
      codigosVisitados.add(uso.codigoFilho)

      // 26/08/2026 (§40) — FATOR DE RENDIMENTO CORRIGIDO.
      // Estava usando `fator_aplicacao` (o FC de limpeza) ou `bruto ÷ líquido`. Nenhum dos dois
      // converte pai em filho: o que faz isso é `quantidade_baixa_estoque` — quanto do PAI entra em
      // 1 unidade do FILHO. Como na maioria das fichas bruto ≈ líquido, aquele cálculo dava fator 1
      // e a quantidade saía IGUAL em todos os níveis — foi o "1,000 un" que apareceu em toda a
      // árvore. Ex.: se "DD PR Picadinho" consome 0,2 kg de PP Picadinho, 1 kg rende 5 pratos
      // (1 ÷ 0,2), não 1 prato.
      const fator = uso.quantidadeBaixaEstoque > 0
        ? uso.quantidadeBaixaEstoque
        : (uso.quantidadeAplicada > 0 ? uso.quantidadeAplicada : null)

      if (!fator || fator <= 0) {
        no.filhos.push({
          codigoEverest: uso.codigoFilho, nome: nomeFilho, unidadeMedida: unidadeFilho,
          quantidade: null, custoPorKg: null, valorTotal: null, filhos: [],
          fatorAusente: true, truncadoPorProfundidade: false, truncadoPorExcessoDeRamos: false
        })
        continue
      }

      const quantidadeFilho = quantidade / fator
      const custoPorKgFilho = custoPorKg != null ? (valorTotal / quantidadeFilho) : null
      no.filhos.push(construir(uso.codigoFilho, nomeFilho, unidadeFilho, quantidadeFilho, custoPorKgFilho, profundidade + 1, new Set([...caminhoAncestral, codigoEverest])))
    }
    return no
  }

  const arvore = construir(codigoEverestRaiz, raiz.nome, raiz.unidade_medida, 1, custoPorKgRaiz, 0, new Set())

  // Categoria (venda/pre_preparo/insumo/...) de cada código visitado — pra tela rotular "prato
  // vendido" vs. "PP sem próximo uso registrado" no fim de cada ramo.
  const categoriaPorCodigo = new Map()
  const listaCodigos = [...codigosVisitados]
  for (let i = 0; i < listaCodigos.length; i += 300) {
    const lote = listaCodigos.slice(i, i + 300)
    const { data, error } = await supabase.from('produtos').select('codigo_everest, categoria').in('codigo_everest', lote)
    if (error) throw error
    for (const p of (data || [])) categoriaPorCodigo.set(p.codigo_everest, p.categoria)
  }
  function anotarCategoria(no) {
    no.categoria = categoriaPorCodigo.get(no.codigoEverest) || null
    no.filhos.forEach(anotarCategoria)
  }
  anotarCategoria(arvore)

  return arvore
}

// ---------------------------------------------------------------------------
// 20/08/2026 — Árvore de Origem: a "conta inversa" da Árvore de Usos acima, pedida pelo Felipe pra
// mostrar pro chefe dele COMO a conta de um prato/PP é feita, voltando nível por nível até o(s)
// insumo(s) em natura — em vez do salto direto de `buscarInsumosEmNatura` (que já achata tudo pro
// resultado final, sem mostrar os PPs no meio do caminho).
//
// Diferença de modelo importante em relação à Árvore de Usos: aqui os filhos de um nó são os
// INGREDIENTES da MESMA ficha — usados JUNTOS pra fazer o produto pai (é uma receita), não usos
// alternativos. Por isso o valor do pai é a SOMA dos valores dos filhos (e não um valor que se
// mantém igual, caminho por caminho, como na Árvore de Usos).
//
// Cuidado herdado de `buscarInsumosEmNatura`/§19.1: a mesma ficha pode trazer, lado a lado, a linha
// de um preparo intermediário (que tem ficha própria) E a linha "achatada" do insumo em natura que
// ele consome — são o MESMO caminho contado 2x, não 2 ingredientes diferentes. Marcado como
// `possivelDuplicata: true` (mostrado, mas excluído da soma) em vez de escondido ou somado errado.
const PROFUNDIDADE_MAXIMA_ARVORE_ORIGEM = 6

export async function buscarArvoreDeOrigem(codigoEverestRaiz) {
  if (!codigoEverestRaiz) return null
  const { fichaIdPorCodigo, ingredientesPorFicha } = await carregarFichasParaConversao()

  const { data: raiz, error: erroRaiz } = await supabase
    .from('produtos').select('codigo_everest, nome, unidade_medida, categoria').eq('codigo_everest', codigoEverestRaiz).maybeSingle()
  if (erroRaiz) throw erroRaiz
  if (!raiz) return null

  const codigosVisitados = new Set([codigoEverestRaiz])

  // Mesmo padrão de `acharPreparoIntermediario` em `buscarInsumosEmNatura` (mesma limitação
  // também: só pega duplicata de 1 nível de indireção — um preparo cuja ficha própria consome
  // ESSA folha DIRETAMENTE. Não pega o caso de 2+ níveis, ex.: Medalhão usa PP Limpo, que por sua
  // vez usa Filet Peça — se "Filet Peça" aparecesse achatado direto ao lado de "Medalhão" na mesma
  // ficha, isso NÃO seria pego aqui. Mesma lacuna aceita no original; não resolvida por ora).
  function achaPreparoQueConsomeSoEssaFolha(ingredientes, folhaCodigo) {
    for (const outro of ingredientes) {
      if (!outro.codigo_everest || outro.codigo_everest === folhaCodigo) continue
      const fichaOutroId = fichaIdPorCodigo.get(outro.codigo_everest)
      if (!fichaOutroId) continue
      const ingredientesOutro = ingredientesPorFicha.get(fichaOutroId) || []
      const feitoSoDessaFolha = ingredientesOutro.length > 0 && ingredientesOutro.every((i) => i.codigo_everest === folhaCodigo)
      if (feitoSoDessaFolha) return outro
    }
    return null
  }

  async function construir(codigoEverest, nome, unidadeMedida, quantidade, profundidade, caminhoAncestral) {
    const no = {
      codigoEverest, nome, unidadeMedida,
      quantidade: quantidade != null ? Math.round(quantidade * 10000) / 10000 : null,
      custoPorKg: null, valorTotal: null, valorIncompleto: false,
      filhos: [], possivelDuplicata: false, fatorAusente: false, fatorSuspeito: false,
      truncadoPorProfundidade: false, semFichaPropria: false
    }

    if (profundidade >= PROFUNDIDADE_MAXIMA_ARVORE_ORIGEM) { no.truncadoPorProfundidade = true; return no }
    if (caminhoAncestral.has(codigoEverest)) return no // guarda-corpo contra ciclo

    const fichaId = fichaIdPorCodigo.get(codigoEverest)
    if (!fichaId) {
      // Sem ficha própria: fim da linha — ou é insumo em natura de verdade (esperado), ou é um "PP"
      // sem ficha cadastrada (gap real de dado, já documentado em §19.1 — 111 casos conhecidos).
      no.semFichaPropria = true
      const custoPorKg = await buscarCustoMedioAtual(codigoEverest)
      no.custoPorKg = custoPorKg != null ? Math.round(custoPorKg * 100) / 100 : null
      no.valorTotal = (custoPorKg != null && quantidade != null) ? Math.round(quantidade * custoPorKg * 100) / 100 : null
      no.valorIncompleto = custoPorKg == null
      return no
    }

    const ingredientes = ingredientesPorFicha.get(fichaId) || []
    for (const ing of ingredientes) {
      if (!ing.codigo_everest) continue
      const ehFolhaAqui = !fichaIdPorCodigo.get(ing.codigo_everest)
      const preparoQueJaConsome = ehFolhaAqui ? achaPreparoQueConsomeSoEssaFolha(ingredientes, ing.codigo_everest) : null
      codigosVisitados.add(ing.codigo_everest)

      const bruto = Number(ing.quantidade_baixa_estoque) || 0
      const liquido = Number(ing.quantidade_aplicada) || 0
      const fatorRegistrado = Number(ing.fator_aplicacao) || 0
      const fator = fatorRegistrado > 0 ? fatorRegistrado : (liquido > 0 ? bruto / liquido : null)
      // 20/08/2026, achado pedindo pro Felipe validar um exemplo real (PP Filet Mignon Aparas →
      // Limpeza → Bovino Filet Mignon Peça): ele esperava quantidade CRESCENDO nível a nível
      // (4,00 → 4,20 → 4,60 kg) e a árvore mostrou 1kg em todo nível — ou seja, fator = 1 exato
      // nos 2 elos. Mesmo sintoma já documentado em `MemoriaCalculoFator` (CMVSemanal.jsx): fator
      // exatamente 1 quase sempre é sinal de bruto=líquido cadastrados iguais no Everest (lacuna),
      // não uma perda real de 0%. Sinalizado aqui pra não passar batido como se fosse um número
      // confirmado — a correção de verdade é no cadastro da ficha no Everest, não no código.
      const fatorSuspeito = fator === 1

      // 21/08/2026, pedido direto do Felipe: "me mostra como está aparecendo na ficha?" — ele quer
      // ver os números CRUS cadastrados na linha da ficha (não só o resultado calculado), pra poder
      // confrontar com o que ele espera sem precisar confiar só na minha conta. Carrego os 4 campos
      // exatamente como estão em `fichas_tecnicas_ingredientes` pra essa linha (ficha de `no`,
      // ingrediente = este `ing`) e devolvo junto do nó filho — a tela mostra isso lado a lado com
      // o valor calculado, sempre (não só quando fica suspeito), pra não depender da minha inferência.
      const cadastroNaFicha = {
        fichaPaiNome: no.nome, fichaPaiCodigo: codigoEverest,
        brutoCadastrado: ing.quantidade_baixa_estoque != null ? Number(ing.quantidade_baixa_estoque) : null,
        liquidoCadastrado: ing.quantidade_aplicada != null ? Number(ing.quantidade_aplicada) : null,
        fatorCadastrado: ing.fator_aplicacao != null ? Number(ing.fator_aplicacao) : null,
        percentualAproveitamentoCadastrado: ing.percentual_aproveitamento != null ? Number(ing.percentual_aproveitamento) : null
      }

      if (!fator || fator <= 0) {
        no.filhos.push({
          codigoEverest: ing.codigo_everest, nome: ing.nome, unidadeMedida: ing.unidade_medida,
          quantidade: null, custoPorKg: null, valorTotal: null, valorIncompleto: true, filhos: [],
          fatorAusente: true, possivelDuplicata: !!preparoQueJaConsome, truncadoPorProfundidade: false, semFichaPropria: ehFolhaAqui,
          cadastroNaFicha
        })
        continue
      }

      const quantidadeIngrediente = quantidade * fator
      const noFilho = await construir(ing.codigo_everest, ing.nome, ing.unidade_medida, quantidadeIngrediente, profundidade + 1, new Set([...caminhoAncestral, codigoEverest]))
      noFilho.fatorSuspeito = fatorSuspeito
      noFilho.cadastroNaFicha = cadastroNaFicha
      if (preparoQueJaConsome) noFilho.possivelDuplicata = true
      no.filhos.push(noFilho)
    }

    // Valor do nó = soma dos ingredientes (usados JUNTOS, ver comentário no topo) — exclui
    // duplicatas sinalizadas da soma (mas continua mostrando elas na árvore).
    const filhosParaSomar = no.filhos.filter((f) => !f.possivelDuplicata)
    const filhosComValor = filhosParaSomar.filter((f) => f.valorTotal != null)
    no.valorIncompleto = filhosParaSomar.some((f) => f.valorTotal == null)
    if (filhosComValor.length) {
      no.valorTotal = Math.round(filhosComValor.reduce((s, f) => s + f.valorTotal, 0) * 100) / 100
      no.custoPorKg = quantidade > 0 ? Math.round((no.valorTotal / quantidade) * 100) / 100 : null
    }
    return no
  }

  const arvore = await construir(codigoEverestRaiz, raiz.nome, raiz.unidade_medida, 1, 0, new Set())

  // Categoria (venda/pre_preparo/insumo/...) de cada código visitado, mesmo propósito de sempre:
  // rotular "prato vendido" vs. "insumo em natura" vs. "PP sem ficha (gap)" na tela.
  const categoriaPorCodigo = new Map([[codigoEverestRaiz, raiz.categoria]])
  const listaCodigos = [...codigosVisitados]
  for (let i = 0; i < listaCodigos.length; i += 300) {
    const lote = listaCodigos.slice(i, i + 300)
    const { data, error } = await supabase.from('produtos').select('codigo_everest, categoria').in('codigo_everest', lote)
    if (error) throw error
    for (const p of (data || [])) categoriaPorCodigo.set(p.codigo_everest, p.categoria)
  }
  function anotarCategoriaOrigem(no) {
    no.categoria = categoriaPorCodigo.get(no.codigoEverest) || null
    no.filhos.forEach(anotarCategoriaOrigem)
  }
  anotarCategoriaOrigem(arvore)

  return arvore
}

// Consolida a contagem semanal de 1 grupo de contagem (em qualquer loja) num dia exato: soma
// TODO lançamento do mesmo produto (não importa em qual sessão/lançamento caiu) e, quando
// possível, já converte pro insumo em natura de origem.
export async function buscarConsolidadoPorData(grupoId, data) {
  const datas = await listarDatasContagemPorGrupo(grupoId)
  const doDia = datas.find((d) => d.data === data)
  if (!doDia) return { linhas: [], totalLancamentos: 0, totalProdutos: 0, sessoes: [], data }
  const idsSessoes = doDia.sessoes.map((s) => s.id)

  const itens = await buscarTodasAsLinhas(() =>
    supabase.from('itens_contagem')
      .select('sessao_id, produto_id, quantidade, produtos(nome, codigo_everest, unidade_medida, categoria)')
      .in('sessao_id', idsSessoes)
  )

  const porProduto = new Map()
  for (const it of itens) {
    if (!it.produto_id) continue
    if (!porProduto.has(it.produto_id)) {
      porProduto.set(it.produto_id, {
        produtoId: it.produto_id,
        nome: it.produtos?.nome || '—',
        codigoEverest: it.produtos?.codigo_everest || null,
        unidade: it.produtos?.unidade_medida || '',
        categoria: it.produtos?.categoria || null,
        quantidade: 0,
        lancamentos: 0,
        sessoesIds: new Set()
      })
    }
    const g = porProduto.get(it.produto_id)
    g.quantidade += Number(it.quantidade) || 0
    g.lancamentos += 1
    g.sessoesIds.add(it.sessao_id)
  }

  const linhas = []
  for (const g of porProduto.values()) {
    const quantidade = Math.round(g.quantidade * 1000) / 1000
    let statusConversao = 'nao_aplicavel'
    let insumosEmNatura = []
    if (g.categoria === 'insumo') {
      statusConversao = 'insumo_direto'
      insumosEmNatura = [{ codigoEverest: g.codigoEverest, nome: g.nome, unidade: g.unidade, quantidadeEquivalente: quantidade }]
    } else {
      const folhas = await buscarInsumosEmNatura(g.codigoEverest)
      if (folhas === null) {
        statusConversao = g.categoria === 'pre_preparo' ? 'gap_sem_ficha' : 'nao_aplicavel'
      } else {
        statusConversao = 'convertido'
        insumosEmNatura = folhas.map((f) => ({ ...f, quantidadeEquivalente: Math.round(f.quantidadePorUnidade * g.quantidade * 1000) / 1000 }))
      }
    }
    linhas.push({
      produtoId: g.produtoId,
      nome: g.nome,
      codigoEverest: g.codigoEverest,
      unidade: g.unidade,
      categoria: g.categoria,
      quantidade,
      lancamentos: g.lancamentos,
      sessoesEnvolvidas: g.sessoesIds.size,
      statusConversao,
      insumosEmNatura
    })
  }
  linhas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  return {
    linhas,
    totalLancamentos: itens.length,
    totalProdutos: linhas.length,
    sessoes: doDia.sessoes.map((s) => ({ id: s.id, status: s.status })),
    data
  }
}

// ── Backup dos dados do APP (o que não vem do Everest e não dá pra reimportar) ──
export const TABELAS_BACKUP_APP = [
  'unidades', 'usuarios_app', 'siglas_internas', 'siglas_ignoradas', 'barcodes',
  'configuracao_geral', 'grupos_contagem', 'grupos_contagem_itens', 'sessoes_contagem',
  'itens_esperados_sessao', 'itens_contagem', 'saidas_contagem', 'fatores_correcao',
  'contagens_historicas', 'producoes_cadastradas', 'producoes_andamento', 'producoes_registros'
]

export async function gerarBackupApp() {
  const backup = { _meta: { gerado_em: new Date().toISOString(), versao: 1, tipo: 'app-origin' }, tabelas: {} }
  const resumo = {}
  for (const t of TABELAS_BACKUP_APP) {
    try {
      const linhas = await buscarTodasAsLinhas(() => supabase.from(t).select('*'))
      backup.tabelas[t] = linhas
      resumo[t] = linhas.length
    } catch (e) {
      backup.tabelas[t] = []
      resumo[t] = 'erro: ' + e.message
    }
  }
  return { backup, resumo }
}

// ---------------------------------------------------------------------------
// 26/08/2026 (§37), pedido do Felipe: histórico completo de UM produto, na Base de dados.
// Junta num lugar só o que hoje está espalhado por 4 telas: compras (quantidade e preço médio),
// consumo teórico vindo das vendas, e a conta de estoque mês a mês
// (Est. inicial + Compras − Est. final = Consumo real, contra o Teórico).
//
// Granularidade: MÊS. É o recorte que o inventário usa (sessões mensais), então é o único em que
// "Est. inicial" e "Est. final" existem de verdade. As médias por dia/semana/ano são derivadas do
// total do período coberto — não são séries próprias, e a tela diz isso.
// ---------------------------------------------------------------------------
export async function buscarHistoricoDoProduto(codigoEverest) {
  if (!codigoEverest) return null

  const { data: produto } = await supabase
    .from('produtos')
    .select('id, codigo_everest, nome, unidade_medida, categoria, grupo_everest, subgrupo_everest')
    .eq('codigo_everest', codigoEverest)
    .maybeSingle()
  if (!produto) return null

  const chaveMes = (d) => String(d || '').slice(0, 7) // 'YYYY-MM'
  const meses = new Map()
  const garantirMes = (m) => {
    if (!meses.has(m)) meses.set(m, { mes: m, comprasQtd: 0, comprasValor: 0, teorico: 0, estoqueInicial: null, estoqueFinal: null })
    return meses.get(m)
  }

  // ---- COMPRAS (fonte única: "Compras no Período" do Everest, §1) --------------------
  const notas = await buscarTodasAsLinhas(() =>
    supabase.from('notas_importadas').select('id, data_emissao')
  )
  const dataDaNota = new Map((notas || []).map((n) => [n.id, n.data_emissao]))
  const itensCompra = await buscarPorIdsEmLotes(
    (lote) => supabase.from('notas_importadas_itens')
      .select('nota_id, quantidade, valor_total, calcula_cmv, codigo_everest, produto_id')
      .eq('codigo_everest', codigoEverest)
      .in('nota_id', lote),
    (notas || []).map((n) => n.id)
  )
  let totalCompraQtd = 0
  let totalCompraValor = 0
  for (const it of itensCompra) {
    if (it.calcula_cmv === false) continue // fora do custo por decisão do próprio Everest (§4)
    const m = chaveMes(dataDaNota.get(it.nota_id))
    if (!m) continue
    const g = garantirMes(m)
    const q = Number(it.quantidade) || 0
    const v = Number(it.valor_total) || 0
    g.comprasQtd += q
    g.comprasValor += v
    totalCompraQtd += q
    totalCompraValor += v
  }

  // ---- CONSUMO TEÓRICO (vendas × fichas, convertido pro insumo) ----------------------
  const vendas = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('data_movimento, codigo_everest, quantidade, cancelado')
  )
  // Agrupa vendas por prato/mês antes de resolver ficha — evita resolver a mesma ficha N vezes.
  const vendidoPorPratoMes = new Map()
  for (const v of vendas) {
    if (v.cancelado || !v.codigo_everest) continue
    const m = chaveMes(v.data_movimento)
    if (!m) continue
    const k = `${v.codigo_everest}|${m}`
    vendidoPorPratoMes.set(k, (vendidoPorPratoMes.get(k) || 0) + (Number(v.quantidade) || 0))
  }
  let totalTeorico = 0
  for (const [k, qtd] of vendidoPorPratoMes) {
    const [codigoPrato, m] = k.split('|')
    if (codigoPrato === codigoEverest) {
      // Revenda direta: o próprio produto foi vendido, 1 pra 1.
      const g = garantirMes(m)
      g.teorico += qtd
      totalTeorico += qtd
      continue
    }
    const folhas = await buscarInsumosEmNatura(codigoPrato)
    if (!folhas) continue
    for (const f of folhas) {
      if (f.codigoEverest !== codigoEverest) continue
      const g = garantirMes(m)
      const q = qtd * (Number(f.quantidadePorUnidade) || 0)
      g.teorico += q
      totalTeorico += q
    }
  }

  // ---- ESTOQUE (inventário mensal finalizado) ----------------------------------------
  const sessoes = await buscarTodasAsLinhas(() =>
    supabase.from('sessoes_contagem')
      .select('id, tipo, status, mes_referencia, ano_referencia, data_referencia, iniciada_em')
      .eq('tipo', 'mensal')
      .eq('status', 'finalizada')
  )
  // Renomeado em 02/09/2026: chamava-se `mesDaSessao` e fazia shadow da função global de mesmo
  // nome, criada agora. A lógica aqui já era a correta (mês INFORMADO primeiro) — passa a delegar
  // pra função única, pra não haver duas definições de "qual é o mês desta sessão".
  const mesPorSessaoId = new Map()
  for (const ss of sessoes) {
    const m = mesDaSessao(ss)
    if (m) mesPorSessaoId.set(ss.id, m)
  }
  // 26/08/2026 (§38) — TUDO VOLTA PRO INSUMO BASE, a pedido do Felipe. Antes esta consulta somava
  // só os lançamentos do PRÓPRIO produto (`produto_id = X`), o que subestimava o estoque de forma
  // grave: uma peça de filet mignon que já virou "PP Aparas" ou "PP Medalhão" continua sendo filet
  // mignon no depósito, mas não era contabilizada aqui. Agora todo produto contado é convertido
  // pelo mesmo motor do CMV (`buscarInsumosEmNatura`) e só as parcelas que resolvem PARA ESTE
  // insumo entram, já em quantidade bruta (fator de correção aplicado) — a mesma unidade das
  // compras e do teórico, que é o que permite a conta fechar.
  const itensEstoque = await buscarPorIdsEmLotes(
    (lote) => supabase.from('itens_contagem')
      .select('sessao_id, quantidade, produtos(codigo_everest, categoria)')
      .in('sessao_id', lote),
    [...mesPorSessaoId.keys()]
  )
  const estoquePorMes = new Map()
  const cacheConversao = new Map() // codigo contado -> fator pro insumo (0 = não converte)
  const itensQueGeram = new Map() // codigo -> nome, só pra transparência na tela
  for (const it of itensEstoque) {
    const m = mesPorSessaoId.get(it.sessao_id)
    const codigoContado = it.produtos?.codigo_everest
    if (!m || !codigoContado) continue
    const qtd = Number(it.quantidade) || 0
    if (!qtd) continue

    if (!cacheConversao.has(codigoContado)) {
      let fator = 0
      if (codigoContado === codigoEverest) {
        fator = 1 // o próprio insumo base, contado direto
      } else {
        const folhas = await buscarInsumosEmNatura(codigoContado)
        if (folhas) {
          for (const f of folhas) {
            if (f.codigoEverest === codigoEverest) fator += Number(f.quantidadePorUnidade) || 0
          }
        }
      }
      cacheConversao.set(codigoContado, fator)
    }
    const fator = cacheConversao.get(codigoContado)
    if (!fator) continue
    if (!itensQueGeram.has(codigoContado)) itensQueGeram.set(codigoContado, { codigo: codigoContado, fator })
    estoquePorMes.set(m, (estoquePorMes.get(m) || 0) + qtd * fator)
  }

  // ---- MONTA A SÉRIE ------------------------------------------------------------------
  for (const m of estoquePorMes.keys()) garantirMes(m)
  const ordenados = [...meses.keys()].sort()
  const linhas = ordenados.map((m, i) => {
    const g = meses.get(m)
    // Estoque final do mês = a contagem daquele mês. Estoque inicial = a do mês anterior da série.
    const estoqueFinal = estoquePorMes.has(m) ? estoquePorMes.get(m) : null
    const mesAnterior = i > 0 ? ordenados[i - 1] : null
    const estoqueInicial = mesAnterior && estoquePorMes.has(mesAnterior) ? estoquePorMes.get(mesAnterior) : null
    const temEstoque = estoqueInicial != null && estoqueFinal != null
    const consumo = temEstoque ? estoqueInicial + g.comprasQtd - estoqueFinal : null
    const diferenca = consumo != null ? g.teorico - consumo : null
    const precoMedio = g.comprasQtd > 0 ? g.comprasValor / g.comprasQtd : null
    return {
      mes: m,
      comprasQtd: Math.round(g.comprasQtd * 1000) / 1000,
      comprasValor: Math.round(g.comprasValor * 100) / 100,
      precoMedio: precoMedio != null ? Math.round(precoMedio * 100) / 100 : null,
      teorico: Math.round(g.teorico * 1000) / 1000,
      estoqueInicial: estoqueInicial != null ? Math.round(estoqueInicial * 1000) / 1000 : null,
      estoqueFinal: estoqueFinal != null ? Math.round(estoqueFinal * 1000) / 1000 : null,
      consumo: consumo != null ? Math.round(consumo * 1000) / 1000 : null,
      diferenca: diferenca != null ? Math.round(diferenca * 1000) / 1000 : null,
      diferencaValor: (diferenca != null && precoMedio != null) ? Math.round(diferenca * precoMedio * 100) / 100 : null
    }
  })

  // ---- MÉDIAS DE COMPRA --------------------------------------------------------------
  // Derivadas do período efetivamente coberto pelas compras (1ª à última), não de datas fixas —
  // dividir por "12 meses" quando só há 4 meses de dado daria uma média artificialmente baixa.
  const datasCompra = itensCompra
    .filter((it) => it.calcula_cmv !== false)
    .map((it) => dataDaNota.get(it.nota_id))
    .filter(Boolean)
    .sort()
  const primeira = datasCompra[0] || null
  const ultima = datasCompra[datasCompra.length - 1] || null
  const dias = (primeira && ultima)
    ? Math.max(1, Math.round((new Date(ultima) - new Date(primeira)) / 86400000) + 1)
    : 0
  const medias = dias > 0 ? {
    dia: totalCompraQtd / dias,
    semana: totalCompraQtd / (dias / 7),
    mes: totalCompraQtd / (dias / 30.44),
    ano: totalCompraQtd / (dias / 365.25)
  } : null

  return {
    produto: {
      codigoEverest: produto.codigo_everest, nome: produto.nome, unidade: produto.unidade_medida,
      categoria: produto.categoria, grupo: produto.grupo_everest, subgrupo: produto.subgrupo_everest
    },
    periodoCompras: { primeira, ultima, dias },
    // Quais produtos contados alimentam este insumo (e com que fator) — pra tela poder mostrar que
    // o estoque não é só o item cru, mas tudo que se converte nele.
    itensQueGeramEstoque: [...itensQueGeram.values()].sort((a, b) => b.fator - a.fator),
    medias,
    totais: {
      comprasQtd: Math.round(totalCompraQtd * 1000) / 1000,
      comprasValor: Math.round(totalCompraValor * 100) / 100,
      precoMedio: totalCompraQtd > 0 ? Math.round((totalCompraValor / totalCompraQtd) * 100) / 100 : null,
      teorico: Math.round(totalTeorico * 1000) / 1000
    },
    linhas
  }
}

// ---------------------------------------------------------------------------
// 28/08/2026 (§45) — DIAGNÓSTICO DE PRATO.
//
// Nasceu de uma pergunta que eu não conseguia responder de fora: "o DD PR EXEC CARNE vendeu 42
// unidades e não aparece no teórico — por quê?". Sem acesso ao banco, eu só podia listar hipóteses
// (venda sob outro código, ficha diferente da do export, venda cancelada) e pedir pro Felipe
// investigar. Errado: a verificação tem que estar no app.
//
// Esta função pega um termo de busca e devolve, para cada produto que casa, TUDO que decide se ele
// entra ou não no consumo teórico — o cadastro, a ficha, as vendas do período e o que o motor
// resolve — lado a lado. Serve pra qualquer prato, não só pro caso do filet.
// ---------------------------------------------------------------------------
export async function diagnosticarPrato(termo, { dataInicio = null, dataFim = null } = {}) {
  const t = (termo || '').trim()
  if (t.length < 2) return []

  // 1) O que existe no CADASTRO com esse nome/código.
  const tokens = t.split(/\s+/).filter(Boolean)
  let q = supabase.from('produtos').select('id, codigo_everest, nome, unidade_medida, categoria, tipo_item, ativo')
  for (const tok of tokens) q = q.or(`nome.ilike.%${tok}%,codigo_everest.ilike.%${tok}%`)
  const { data: produtos, error } = await q.order('nome').limit(20)
  if (error) throw error

  // 2) Vendas do período — casadas por NOME também, pra pegar o caso de a venda estar gravada
  //    sob um código diferente do que a ficha usa (uma das hipóteses do caso EXEC CARNE).
  let qv = supabase.from('vendas_importadas_itens')
    .select('codigo_everest, nome_original, quantidade, cancelado, data_movimento')
  if (dataInicio) qv = qv.gte('data_movimento', dataInicio)
  if (dataFim) qv = qv.lte('data_movimento', dataFim)
  const vendasPeriodo = await buscarTodasAsLinhas(() => qv)

  const normaliza = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const termoNorm = normaliza(t)
  const porNomeParecido = new Map() // codigo -> { nome, qtd, canceladas, dias }
  const codigosDoCadastro = new Set((produtos || []).map((p) => p.codigo_everest).filter(Boolean))
  for (const v of vendasPeriodo) {
    const n = normaliza(v.nome_original)
    // 28/08/2026 (§46): casa por NOME **ou por CÓDIGO**. Buscando "1826" a tela dizia "nenhuma
    // venda" mesmo havendo 42 — porque só comparava o termo contra o nome da venda. Falso negativo
    // no exato momento em que a resposta importava.
    const casaCodigo = (v.codigo_everest && (v.codigo_everest === t || codigosDoCadastro.has(v.codigo_everest)))
    const casaNome = tokens.every((tok) => n.includes(normaliza(tok))) || n.includes(termoNorm)
    if (!casaCodigo && !casaNome) continue
    const k = v.codigo_everest || '(sem código)'
    if (!porNomeParecido.has(k)) porNomeParecido.set(k, { codigo: k, nome: v.nome_original, qtd: 0, canceladas: 0, dias: new Set() })
    const g = porNomeParecido.get(k)
    if (v.cancelado) g.canceladas += Number(v.quantidade) || 0
    else { g.qtd += Number(v.quantidade) || 0; g.dias.add(String(v.data_movimento).slice(0, 10)) }
  }
  const vendasPorCodigo = [...porNomeParecido.values()]
    .map((g) => ({ ...g, dias: g.dias.size }))
    .sort((a, b) => b.qtd - a.qtd)

  // 3) Para cada produto: ficha, ingredientes e o que o motor resolve.
  const { fichaIdPorCodigo, ingredientesPorFicha } = await carregarFichasParaConversao()
  const linhas = []
  for (const p of (produtos || [])) {
    const fichaId = fichaIdPorCodigo.get(p.codigo_everest)
    const ingredientes = fichaId ? (ingredientesPorFicha.get(fichaId) || []) : []
    let resolvido = null
    if (p.categoria === 'insumo' && !fichaId) {
      // 09/09/2026, correção de bug: a versão anterior aplicava essa regra pra QUALQUER
      // categoria='insumo', mesmo quando o item TINHA ficha própria (ex.: "DD PR ALIGOT COM
      // FILET" é categoria='insumo' — é um prato vendido — mas tem ficha de 40 linhas). Isso
      // fazia a tela mostrar "resolve pra ele mesmo" em vez de abrir a ficha de verdade,
      // escondendo justamente o caso que essa tela existe pra investigar. A regra só faz sentido
      // quando NÃO existe ficha pra abrir (matéria-prima comprada, ou revenda direta como o
      // vinho que motivou a correção original).
      resolvido = [{
        codigoEverest: p.codigo_everest, nome: p.nome, unidade: p.unidade_medida,
        quantidadePorUnidade: 1, terminalPorFaltaDeFicha: false, eloIncompleto: null
      }]
    } else {
      try { resolvido = await buscarInsumosEmNatura(p.codigo_everest) } catch { resolvido = null }
    }

    const vendaDoCodigo = porNomeParecido.get(p.codigo_everest) || null
    // Diagnóstico em uma frase — a razão pela qual entra ou não no teórico.
    let veredito
    if (!fichaId && p.categoria !== 'insumo') veredito = 'SEM FICHA TÉCNICA — nunca gera consumo teórico'
    else if (!resolvido || !resolvido.length) veredito = 'Tem ficha, mas nenhum ingrediente dela chega a um insumo comprado'
    else if (!vendaDoCodigo || vendaDoCodigo.qtd <= 0) {
      // 09/09/2026: item categoria 'pre_preparo' NUNCA tem venda própria por desenho — só é
      // consumido como ingrediente dentro da ficha de um prato final (ex.: "PP PICADINHO FINAL
      // PRODUCAO" não é vendido no caixa, só "DD PR PICADINHO" é). O veredito vermelho de "sem
      // venda" fazia esse caso ler como problema quando é o esperado. Categoria != pre_preparo
      // continua vermelho — aí sim é sinal de item cadastrado como prato vendável que não vendeu.
      veredito = p.categoria === 'pre_preparo'
        ? 'OK — é pré-preparo, não tem venda própria por natureza; consumo entra pelo prato final que o usa'
        : (p.categoria === 'insumo' && !fichaId
            ? 'OK — insumo comprado direto, resolve pra ele mesmo; sem venda registrada nesse código/período'
            : 'Tem ficha e resolve, mas NÃO tem venda registrada nesse código/período')
    }
    else veredito = 'OK — tem ficha, resolve e tem venda no período'

    linhas.push({
      codigoEverest: p.codigo_everest,
      nome: p.nome,
      unidade: p.unidade_medida,
      categoria: p.categoria,
      tipoItem: p.tipo_item,
      ativo: p.ativo,
      temFicha: !!fichaId,
      totalIngredientes: ingredientes.length,
      ingredientes: ingredientes.map((i) => ({
        codigo: i.codigo_everest, nome: i.nome, tipoItem: i.tipo_item,
        bruto: i.quantidade_baixa_estoque, liquido: i.quantidade_aplicada
      })),
      insumosResolvidos: (resolvido || []).map((r) => ({
        codigo: r.codigoEverest, nome: r.nome, quantidadePorUnidade: r.quantidadePorUnidade,
        terminalPorFaltaDeFicha: r.terminalPorFaltaDeFicha,
        // 09/09/2026: `buscarInsumosEmNatura` já calcula isso (§65) mas essa função descartava o
        // campo antes de devolver — o próprio Diagnóstico de prato, feito pra conferir exatamente
        // esse tipo de coisa, não conseguia mostrar o aviso que motivou construí-lo.
        eloIncompleto: r.eloIncompleto || null
      })),
      venda: vendaDoCodigo ? { qtd: vendaDoCodigo.qtd, canceladas: vendaDoCodigo.canceladas, dias: vendaDoCodigo.dias.size ?? vendaDoCodigo.dias } : null,
      veredito
    })
  }

  return { linhas, vendasPorCodigo, periodo: { dataInicio, dataFim } }
}

// ── LANÇAMENTOS (tabela dinâmica) ────────────────────────────────────────────
// 01/09/2026, pedido do Felipe: "inventário tem mais de 30 sessões lançadas de agosto... preciso
// ver isso de forma fácil e agrupada... é possível o usuário montar da forma que ele quiser e
// exportar?"
//
// Contexto que define o desenho: lançar em VÁRIAS sessões é o comportamento normal aqui — a
// pessoa lança um pedaço, envia, e depois lança outros itens numa sessão nova. Isso é aditivo, não
// é erro (§19.3: "soma sempre, toda contagem física de gente diferente é aditiva"). Logo a SESSÃO
// não pode ser a unidade de análise; ela é só mais uma dimensão disponível.
//
// Esta função devolve as linhas CRUAS, uma por lançamento, com todas as dimensões já resolvidas.
// O agrupamento acontece na tela, client-side, porque é lá que o Felipe escolhe como quer ver —
// fazer o pivô no banco exigiria uma consulta diferente por combinação.
export async function buscarLancamentos({ tipos, dataInicio, dataFim, unidadeId, usuario, grupoId } = {}) {
  const base = 'id, tipo, status, usuario, mes_referencia, ano_referencia, iniciada_em, unidade_id, grupo_id, unidades(nome), grupos_contagem(nome)'
  // `data_referencia` (v4) e `turno` (v13) dependem de migração. Tenta da consulta mais completa
  // pra mais enxuta — nunca deixa a tela vazia só porque uma migração ficou pendente (mesmo
  // padrão de `listarSessoes`).
  let sessoes = null
  for (const extras of [`${base}, data_referencia, turno`, `${base}, data_referencia`, base]) {
    let q = supabase.from('sessoes_contagem').select(extras)
    if (tipos?.length) q = q.in('tipo', tipos)
    if (unidadeId) q = q.eq('unidade_id', unidadeId)
    if (grupoId) q = q.eq('grupo_id', grupoId)
    const { data, error } = await q
    if (!error) { sessoes = data; break }
    if (!colunaNaoExiste(error)) throw error
  }

  sessoes = (sessoes || []).filter((s) => {
    if (tipos?.length && !tipos.includes(s.tipo)) return false
    if (unidadeId && s.unidade_id !== unidadeId) return false
    if (grupoId && s.grupo_id !== grupoId) return false
    const d = dataDaSessao(s)
    if (dataInicio && (!d || d < dataInicio)) return false
    if (dataFim && (!d || d > dataFim)) return false
    return true
  })
  if (!sessoes.length) return []

  const porId = new Map(sessoes.map((s) => [s.id, s]))
  // Lotes de 300: a lista de ids cresce com o período e um `.in()` sem paginar já estourou o
  // limite de URL do PostgREST três vezes neste app (§10, §22.1, §25.1).
  let itens = await buscarPorIdsEmLotes(
    (lote) => supabase.from('itens_contagem')
      .select('id, sessao_id, produto_id, quantidade, usuario, registrado_em, motivo_perda, modo_perda, produtos(nome, codigo_everest, unidade_medida, grupo_everest, subgrupo_everest, tipo_item)')
      .in('sessao_id', lote),
    sessoes.map((s) => s.id)
  ).catch(async (error) => {
    if (!colunaNaoExiste(error)) throw error
    return buscarPorIdsEmLotes(
      (lote) => supabase.from('itens_contagem')
        .select('id, sessao_id, produto_id, quantidade, usuario, registrado_em, produtos(nome, codigo_everest, unidade_medida, grupo_everest, subgrupo_everest, tipo_item)')
        .in('sessao_id', lote),
      sessoes.map((s) => s.id)
    )
  })

  const linhas = []
  for (const it of itens) {
    const s = porId.get(it.sessao_id)
    if (!s) continue
    const data = dataDaSessao(s)
    // Quem lançou o ITEM manda; a sessão é o fallback (itens gravados antes da migration_v10 não
    // têm usuário próprio).
    if (usuario && (it.usuario || s.usuario) !== usuario) continue
    linhas.push({
      itemId: it.id,
      sessaoId: s.id,
      tipo: s.tipo,
      status: s.status,
      data,
      // Mês de REFERÊNCIA (o informado), não o mês em que a linha foi digitada.
      mes: mesDaSessao(s) || '—',
      origemData: origemDaDataDaSessao(s),
      turno: s.turno || null,
      loja: s.unidades?.nome || '—',
      grupoContagem: s.grupos_contagem?.nome || '—',
      quem: it.usuario || s.usuario || '—',
      codigoEverest: it.produtos?.codigo_everest || '—',
      produto: it.produtos?.nome || '(produto removido)',
      unidade: it.produtos?.unidade_medida || '',
      grupoEverest: it.produtos?.grupo_everest || '—',
      subgrupoEverest: it.produtos?.subgrupo_everest || '—',
      tipoItem: it.produtos?.tipo_item || '—',
      motivoPerda: it.motivo_perda || null,
      modoPerda: it.modo_perda || null,
      quantidade: Number(it.quantidade) || 0,
      registradoEm: it.registrado_em
    })
  }
  return linhas
}
