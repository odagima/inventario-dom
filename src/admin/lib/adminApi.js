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
    const { data, error } = await supabase.from('fichas_tecnicas').select('id, codigo_everest, quantidade_producao, custo_producao').in('codigo_everest', lote)
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
  if (!linhasBrutas.length) return { notas: 0, itens: 0, semCorrespondencia: 0, notasDuplicadas: 0, foraDoSubgrupo: 0, foraDoCMV: 0, linhasIgnoradas: 0 }

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

  // Evita duplicar: busca quais dessas notas (número + empresa) já existem antes de inserir.
  const numerosNota = notas.map((n) => n.numeroNota).filter(Boolean)
  const existentesPorChave = new Set()
  const tamanhoLoteCheck = 300
  for (let i = 0; i < numerosNota.length; i += tamanhoLoteCheck) {
    const lote = numerosNota.slice(i, i + tamanhoLoteCheck)
    const { data: jaExistentes, error: erroCheck } = await supabase
      .from('notas_importadas')
      .select('numero_nota, cnpj_destinatario, fantasia')
      .in('numero_nota', lote)
    if (erroCheck) throw erroCheck
    for (const e of jaExistentes) existentesPorChave.add(`${e.numero_nota}|${e.fantasia || e.cnpj_destinatario || ''}`)
  }

  let notasSalvas = 0
  let itensSalvos = 0
  let semCorrespondencia = 0
  let notasDuplicadas = 0
  let foraDoCMV = 0

  for (const nota of notas) {
    const chaveNota = `${nota.numeroNota}|${nota.fantasia || ''}`
    if (existentesPorChave.has(chaveNota)) {
      notasDuplicadas += 1
      continue
    }

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

    const itensParaSalvar = nota.itens.map((it) => ({
      nota_id: notaSalva.id,
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

    notasSalvas += 1
    itensSalvos += itensParaSalvar.length
    semCorrespondencia += itensParaSalvar.filter((i) => !i.produto_id).length
    foraDoCMV += itensParaSalvar.filter((i) => !i.calcula_cmv).length
    onProgresso?.({ feito: notasSalvas, total: notas.length })
    if (notasSalvas % 20 === 0) await new Promise((r) => setTimeout(r, 0))
  }

  return { notas: notasSalvas, itens: itensSalvos, semCorrespondencia, notasDuplicadas, foraDoSubgrupo, foraDoCMV, linhasIgnoradas }
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
      custoUnitario: linha[FICHA_COL.ING_CUSTO_UNIT] != null ? Number(linha[FICHA_COL.ING_CUSTO_UNIT]) : null
    })

    if (i % 500 === 0) await new Promise((r) => setTimeout(r, 0))
    onProgresso?.({ feito: i + 1, total: resto.length })
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
    const ingredientesDeConsumo = f.ingredientes.filter((ing) => ehLinhaDeConsumo(ing.tipoBaixa))
    const semLinhaConsumo = ingredientesDeConsumo.length === 0 && f.ingredientes.length > 0
    if (semLinhaConsumo) fichasSemLinhaConsumo += 1
    const baseDeCusto = semLinhaConsumo ? f.ingredientes : ingredientesDeConsumo
    const custoTeoricoUnidade = baseDeCusto.reduce((acc, ing) => acc + (Number(ing.custoUnitario) || 0), 0)

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

    // Substitui os ingredientes antigos dessa ficha pelos novos (evita duplicar em reimportações)
    await supabase.from('fichas_tecnicas_ingredientes').delete().eq('ficha_id', fichaSalva.id)

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
      const { error: erroIng } = await supabase.from('fichas_tecnicas_ingredientes').insert(ingredientesParaSalvar)
      if (erroIng) throw erroIng
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

  return { fichas: fichasSalvas, ingredientes: ingredientesSalvos, semCorrespondencia, linhasIgnoradas, fichasSemLinhaConsumo, historicoIndisponivel }
}

// 10/08/2026, pedido do Felipe (aba "Importar dados" → Ficha técnica): resumo de todas as fichas
// já importadas, agrupado por ficha — clicando numa ficha mostra os insumos que compõem ela e o
// custo de cada um. `custoTotal` já é o mesmo `custo_producao` calculado no import (linhas de
// "Consumo" já filtradas — ver ehLinhaDeConsumo); os ingredientes vêm todos (inclui os fora do
// filtro, marcados com `foraDoCalculo`), pra transparência de quem quer auditar a ficha.
export async function buscarResumoFichasTecnicas() {
  const { data: fichas, error } = await supabase
    .from('fichas_tecnicas')
    .select('id, codigo_everest, nome, fantasia, situacao, custo_producao, atualizado_em')
    .order('nome')
  if (error) throw error
  if (!fichas.length) return []

  const idsFichas = fichas.map((f) => f.id)
  const ingredientes = await buscarTodasAsLinhas(() =>
    supabase.from('fichas_tecnicas_ingredientes')
      .select('ficha_id, nome, custo_unitario, custo_medio, tipo_baixa')
      .in('ficha_id', idsFichas)
  )
  const ingredientesPorFicha = new Map()
  for (const ing of ingredientes) {
    if (!ingredientesPorFicha.has(ing.ficha_id)) ingredientesPorFicha.set(ing.ficha_id, [])
    ingredientesPorFicha.get(ing.ficha_id).push(ing)
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
  if (!ficha) return { indisponivel: false, linhas: [] }

  const { data: ingredientesRaw, error: erroIng } = await supabase
    .from('fichas_tecnicas_ingredientes')
    .select('codigo_everest, quantidade_baixa_estoque, quantidade_aplicada, tipo_baixa')
    .eq('ficha_id', fichaId)
  if (erroIng) throw erroIng

  const consumo = selecionarIngredientesDeConsumo(ingredientesRaw || [])
  const itensParaRastrear = consumo.length
    ? consumo.map((i) => ({ codigo: i.codigo_everest, quantidade: Number(i.quantidade_baixa_estoque) || Number(i.quantidade_aplicada) || 0 }))
    : (ficha.codigo_everest ? [{ codigo: ficha.codigo_everest, quantidade: 1 }] : [])
  const codigosUnicos = [...new Set(itensParaRastrear.map((i) => i.codigo).filter(Boolean))]
  if (!codigosUnicos.length) return { indisponivel: false, linhas: [] }

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
  if (!compras.length) return { indisponivel: false, linhas: [] }

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
  if (!todosMeses.size) return { indisponivel: false, linhas: [] }

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
      custoTotal += precoConhecido * item.quantidade
    }
    return { mes, custo: Math.round(custoTotal * 100) / 100, incompleto, temCompraNoMes }
  })

  return { indisponivel: false, linhas }
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
      .select('produto_id, codigo_everest, nome_original, grupo_venda, fantasia, quantidade, valor_total, valor_unitario, cancelado')
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
    const temFicha = !!(produtoIdAtual && ficha?.quantidade_producao && ficha?.custo_producao)
    const chaveCobertura = produtoIdAtual || it.codigo_everest || it.nome_original
    const balde = temFicha ? 'comFicha' : produtoIdAtual ? 'semFicha' : 'semCorrespondencia'
    coberturaGeral[balde].add(chaveCobertura)
    if (!coberturaPorLoja.has(lojaDoItem)) coberturaPorLoja.set(lojaDoItem, { comFicha: new Set(), semFicha: new Set(), semCorrespondencia: new Set() })
    coberturaPorLoja.get(lojaDoItem)[balde].add(chaveCobertura)

    if (loja && lojaDoItem !== loja) continue
    const chave = it.codigo_everest || it.nome_original
    if (!porItem.has(chave)) porItem.set(chave, { codigo: it.codigo_everest, nome: it.nome_original, grupo: it.grupo_venda, quantidade: 0, valorTotal: 0, custoTeorico: 0, semFicha: !temFicha })
    const g = porItem.get(chave)
    g.quantidade += Number(it.quantidade) || 0
    // 11/08/2026, pedido do Felipe: usa o valor bruto de venda (item + gorjeta de 13%), não só o
    // valor do item — ver `valorVenda`.
    g.valorTotal += valorVenda(it)
    if (temFicha) {
      const custoPorUnidade = Number(ficha.custo_producao) / Number(ficha.quantidade_producao)
      g.custoTeorico += custoPorUnidade * (Number(it.quantidade) || 0)
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
    // §29.21). O valor por unidade divide o gorjeta de volta pra fora antes de calcular a média —
    // senão o número por unidade sai maior que o preço de tabela real, confundindo quem olha a
    // tabela e compara com o preço do cardápio/Everest.
    const valorUnitario = item.quantidade > 0 ? Math.round((item.valorTotal / FATOR_GORJETA / item.quantidade) * 100) / 100 : null
    const custoUnitario = (item.quantidade > 0 && !item.semFicha) ? Math.round((item.custoTeorico / item.quantidade) * 100) / 100 : null
    return {
      ...item,
      custoTeorico: Math.round(item.custoTeorico * 100) / 100,
      custoTeoricoPercentual,
      valorUnitario,
      custoUnitario,
      farol: corFarolCmv(custoTeoricoPercentual),
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
    const itensCompraPeriodo = await buscarTodasAsLinhas(() =>
      supabase.from('notas_importadas_itens').select('nota_id, valor_total, calcula_cmv').in('nota_id', idsNotasPeriodo)
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

  const idsFichas = fichas.map((f) => f.id)
  const ingredientes = await buscarTodasAsLinhas(() =>
    supabase.from('fichas_tecnicas_ingredientes').select('ficha_id, codigo_everest, nome, unidade_medida, quantidade_aplicada, quantidade_baixa_estoque, custo_unitario, custo_medio, tipo_baixa').in('ficha_id', idsFichas)
  )
  const ingredientesPorFicha = new Map()
  for (const ing of ingredientes) {
    if (!ingredientesPorFicha.has(ing.ficha_id)) ingredientesPorFicha.set(ing.ficha_id, [])
    ingredientesPorFicha.get(ing.ficha_id).push(ing)
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

  const idsProdutosVendidos = Array.from(vendidoPorProduto.keys())
  const { data: fichas, error: e2 } = await supabase
    .from('fichas_tecnicas')
    .select('id, produto_id, quantidade_producao')
    .in('produto_id', idsProdutosVendidos)
  if (e2) throw e2

  const produtoIdsComFicha = new Set((fichas || []).map((f) => f.produto_id))
  const idsFichas = (fichas || []).map((f) => f.id)
  const ingredientesPorFicha = new Map()
  if (idsFichas.length) {
    const ingredientes = await buscarTodasAsLinhas(() =>
      supabase.from('fichas_tecnicas_ingredientes').select('ficha_id, codigo_everest, nome, unidade_medida, quantidade_aplicada, quantidade_baixa_estoque, custo_unitario, custo_medio, tipo_baixa').in('ficha_id', idsFichas)
    )
    for (const ing of ingredientes) {
      if (!ingredientesPorFicha.has(ing.ficha_id)) ingredientesPorFicha.set(ing.ficha_id, [])
      ingredientesPorFicha.get(ing.ficha_id).push(ing)
    }
  }

  // Unidade dos produtos sem ficha (pra exibir junto da quantidade — ex. "un", "kg").
  const idsSemFicha = idsProdutosVendidos.filter((id) => !produtoIdsComFicha.has(id))
  const unidadePorProduto = new Map()
  if (idsSemFicha.length) {
    const { data: prods } = await supabase.from('produtos').select('id, unidade_medida').in('id', idsSemFicha)
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
  const { data: fichas } = idsProdutosVendidos.length
    ? await supabase.from('fichas_tecnicas').select('produto_id, quantidade_producao, custo_producao').in('produto_id', idsProdutosVendidos)
    : { data: [] }
  const fichaPorProduto = new Map((fichas || []).map((f) => [f.produto_id, f]))

  const porItem = new Map()
  for (const it of itensVendidos) {
    const chave = it.produto_id || it.codigo_everest || it.nome_original
    if (!porItem.has(chave)) porItem.set(chave, { nome: it.nome_original, codigo: it.codigo_everest, vendas: 0, custoTeorico: 0, quantidade: 0, semFicha: false })
    const g = porItem.get(chave)
    // 11/08/2026, pedido do Felipe: valor bruto de venda (item + gorjeta) — ver `valorVenda`.
    g.vendas += valorVenda(it)
    g.quantidade += Number(it.quantidade) || 0

    const ficha = fichaPorProduto.get(it.produto_id)
    if (ficha?.quantidade_producao && ficha?.custo_producao) {
      const custoPorUnidade = Number(ficha.custo_producao) / Number(ficha.quantidade_producao)
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
    ? await buscarTodasAsLinhas(() => supabase.from('notas_importadas_itens').select('produto_id, valor_total, valor_unitario, calcula_cmv').in('nota_id', idsNotas))
    : []
  // "Calcula CMV = NÃO" é o próprio Everest marcando item fora do custo (ex.: administrativo) — excluído do CMV Real.
  const comprasItens = comprasItensBrutos.filter((c) => c.calcula_cmv !== false)

  // Vendas filtradas por data_movimento no ITEM (não pelo header do arquivo importado — ver nota
  // em buscarCurvaDeVendas), excluindo canceladas.
  const vendasItensBrutos = await buscarTodasAsLinhas(() =>
    supabase.from('vendas_importadas_itens')
      .select('produto_id, grupo_venda, quantidade, valor_total, valor_unitario, cancelado')
      .gte('data_movimento', inicioMes).lte('data_movimento', fimMes)
  )
  const vendasItens = vendasItensBrutos.filter((v) => !v.cancelado)

  // Custo médio por produto — usado pra valorizar o estoque contado (que só tem quantidade)
  const idsProdutos = [...new Set([...estoqueInicial.keys(), ...estoqueFinal.keys(), ...comprasItens.map((c) => c.produto_id)].filter(Boolean))]
  const produtos = idsProdutos.length
    ? (await supabase.from('produtos').select('id, grupo_everest').in('id', idsProdutos)).data
    : []
  const grupoPorProduto = new Map(produtos.map((p) => [p.id, p.grupo_everest || 'Sem grupo']))

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
    const grupo = grupoPorProduto.get(c.produto_id) || 'Sem grupo'
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

  const totalItensSemCusto = [...estoqueInicial.keys(), ...estoqueFinal.keys()]
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .filter((id) => !custoMedioPorProduto.has(id)).length

  return { linhas, totalItensSemCusto, mesAnterior, anoAnterior }
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
  const { data: fichas } = idsProdutosVendidos.length
    ? await supabase.from('fichas_tecnicas').select('produto_id, quantidade_producao, custo_producao').in('produto_id', idsProdutosVendidos)
    : { data: [] }
  const fichaPorProduto = new Map((fichas || []).map((f) => [f.produto_id, f]))

  const porGrupo = new Map()
  for (const it of itensVendidos) {
    const grupo = it.grupo_venda || 'Sem grupo'
    if (!porGrupo.has(grupo)) porGrupo.set(grupo, { vendas: 0, custoTeorico: 0, semFicha: 0 })
    const g = porGrupo.get(grupo)
    // 11/08/2026, pedido do Felipe: valor bruto de venda (item + gorjeta) — ver `valorVenda`.
    g.vendas += valorVenda(it)

    const ficha = fichaPorProduto.get(it.produto_id)
    if (ficha?.quantidade_producao && ficha?.custo_producao) {
      const custoPorUnidade = Number(ficha.custo_producao) / Number(ficha.quantidade_producao)
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
export async function listarGruposAdmin() {
  const { data, error } = await supabase
    .from('grupos_contagem')
    .select('id, nome, grupos_contagem_itens(count)')
    .order('nome')
  if (error) throw error
  return data.map((g) => ({ id: g.id, nome: g.nome, totalItens: g.grupos_contagem_itens?.[0]?.count || 0 }))
}

export async function criarGrupo(nome) {
  const { data, error } = await supabase.from('grupos_contagem').insert({ nome }).select().single()
  if (error) throw error
  return data
}

export async function deletarGrupo(grupoId) {
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
function colunaNaoExiste(error, nomeColuna) {
  if (!error) return false
  if (error.code === '42703') return true
  const msg = String(error.message || '')
  return msg.includes(nomeColuna) && /column|coluna/i.test(msg)
}

export async function listarSessoes(tipoFiltro = null) {
  async function consultar(comDataReferencia) {
    let query = supabase
      .from('sessoes_contagem')
      .select(
        comDataReferencia
          ? 'id, unidade_id, grupo_id, tipo, status, iniciada_em, finalizada_em, usuario, mes_referencia, ano_referencia, data_referencia, unidades(nome), grupos_contagem(nome)'
          : 'id, unidade_id, grupo_id, tipo, status, iniciada_em, finalizada_em, usuario, mes_referencia, ano_referencia, unidades(nome), grupos_contagem(nome)'
      )
      .order('iniciada_em', { ascending: false })
      .limit(200)
    if (tipoFiltro) query = query.eq('tipo', tipoFiltro)
    return query
  }
  let { data, error } = await consultar(true)
  if (error && colunaNaoExiste(error, 'data_referencia')) {
    // Ainda não rodou a migration_v4.sql — segue sem a coluna em vez de sumir com o histórico.
    ;({ data, error } = await consultar(false))
    if (!error) data = (data || []).map((s) => ({ ...s, data_referencia: null }))
  }
  if (error) throw error
  return data
}

export async function atualizarReferenciaSessao(sessaoId, mesReferencia, anoReferencia) {
  const { error } = await supabase
    .from('sessoes_contagem')
    .update({ mes_referencia: mesReferencia, ano_referencia: anoReferencia })
    .eq('id', sessaoId)
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

export async function buscarRelatorioSessao(sessaoId) {
  const [esperados, contados] = await Promise.all([
    buscarTodasAsLinhas(() => supabase.from('itens_esperados_sessao').select('produtos(*)').eq('sessao_id', sessaoId)),
    buscarTodasAsLinhas(() => supabase.from('itens_contagem').select('produto_id, quantidade, produtos(*)').eq('sessao_id', sessaoId))
  ])

  const contadoPorProduto = new Map(contados.map((c) => [c.produto_id, c]))
  const idsEsperados = new Set(esperados.map((e) => e.produtos.id))

  const linhas = esperados.map((e) => {
    const c = contadoPorProduto.get(e.produtos.id)
    return {
      produto_id: e.produtos.id,
      nome: e.produtos.nome,
      codigo_everest: e.produtos.codigo_everest,
      unidade_medida: e.produtos.unidade_medida,
      quantidade: c ? c.quantidade : null,
      status: c ? 'contado' : 'pendente'
    }
  })

  const extras = contados
    .filter((c) => !idsEsperados.has(c.produto_id))
    .map((c) => ({
      produto_id: c.produto_id,
      nome: c.produtos.nome,
      codigo_everest: c.produtos.codigo_everest,
      unidade_medida: c.produtos.unidade_medida,
      quantidade: c.quantidade,
      status: 'extra'
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
// Venda unitária = soma(valor_total) / soma(quantidade) no período. CMV% = custo / venda.
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
        .select('codigo_everest, quantidade, valor_total, valor_unitario, cancelado')
        .gte('data_movimento', ini).lte('data_movimento', fim)
    )
    const mapa = new Map()
    for (const it of itens) {
      if (!it.codigo_everest || it.cancelado) continue
      const cur = mapa.get(it.codigo_everest) || { qtd: 0, valor: 0 }
      cur.qtd += Number(it.quantidade) || 0
      // 11/08/2026, pedido do Felipe: valor bruto de venda (item + gorjeta) — ver `valorVenda`.
      cur.valor += valorVenda(it)
      mapa.set(it.codigo_everest, cur)
    }
    return mapa
  }

  const atual = await vendasPorProduto(mes, ano)
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

  function custoUnit(codigo) {
    const f = fichaPorCodigo.get(codigo)
    if (f && Number(f.quantidade_producao) && f.custo_producao != null) return Number(f.custo_producao) / Number(f.quantidade_producao)
    return null
  }
  function cmvDe(codigo, mapa) {
    const v = mapa.get(codigo); const c = custoUnit(codigo)
    if (!v || !v.qtd || c == null) return null
    const vu = v.valor / v.qtd
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
    const vu = v && v.qtd ? v.valor / v.qtd : null
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
      cmv: cmv != null ? Math.round(cmv * 10) / 10 : null,
      cmvAnterior: cmvAnt != null ? Math.round(cmvAnt * 10) / 10 : null,
      tendencia: (cmv != null && cmvAnt != null)
        ? (cmv > cmvAnt + 0.5 ? 'subiu' : cmv < cmvAnt - 0.5 ? 'caiu' : 'estavel')
        : null
    }
  }).filter((l) => l.temFicha)

  const cmvs = linhas.map((l) => l.cmv).filter((v) => v != null)
  const media = cmvs.length ? cmvs.reduce((a, b) => a + b, 0) / cmvs.length : null
  const limiteVermelho = media != null ? media * 1.3 : null // 30% acima da média dos pratos
  for (const l of linhas) l.acimaMedia = (limiteVermelho != null && l.cmv != null && l.cmv >= limiteVermelho)

  linhas.sort((a, b) => (b.cmv ?? -1) - (a.cmv ?? -1))
  return {
    linhas,
    media: media != null ? Math.round(media * 10) / 10 : null,
    limiteVermelho: limiteVermelho != null ? Math.round(limiteVermelho * 10) / 10 : null
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
      .select('nome, codigo_everest, unidade_medida, quantidade_aplicada, quantidade_baixa_estoque, custo_medio, custo_unitario')
      .eq('ficha_id', ficha.id)
  )
  const ingredientes = ings.map((i) => {
    const qtd = Number(i.quantidade_baixa_estoque) || Number(i.quantidade_aplicada) || 0
    const cu = Number(i.custo_unitario) || Number(i.custo_medio) || 0
    return {
      nome: i.nome,
      codigo_everest: i.codigo_everest,
      unidade_medida: i.unidade_medida,
      quantidade: qtd,
      custo_unitario: cu,
      custo_linha: Math.round(cu * qtd * 100) / 100
    }
  })
  return { ficha, ingredientes }
}

// Reverso: quais fichas usam um insumo (por código Everest). Ex.: filet mignon -> PP PICADINHO...
export async function buscarFichasQueUsamInsumo(codigoEverest) {
  if (!codigoEverest) return []
  const ings = await buscarTodasAsLinhas(() =>
    supabase.from('fichas_tecnicas_ingredientes')
      .select('ficha_id, quantidade_aplicada, unidade_medida')
      .eq('codigo_everest', codigoEverest)
  )
  const ids = [...new Set(ings.map((i) => i.ficha_id))]
  if (!ids.length) return []
  const { data: fichas } = await supabase.from('fichas_tecnicas').select('id, nome, codigo_everest').in('id', ids)
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

  return { inventario, semanal, vendasCobertura, comprasCobertura, fichas }
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
    const itens = await buscarTodasAsLinhas(() => supabase.from('notas_importadas_itens').select('nota_id, produto_id, valor_total, valor_unitario, calcula_cmv').in('nota_id', nIds))
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
  const { data: produtosCmv } = idsProdutosCmv.length
    ? await supabase.from('produtos').select('id, grupo_everest').in('id', idsProdutosCmv)
    : { data: [] }
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
async function converterParaInsumos(codigoEverest, categoria, nome, unidade, quantidade) {
  if (!quantidade) return { insumos: [], gap: false }
  if (categoria === 'insumo') {
    return { insumos: [{ codigoEverest, nome, unidade, quantidade }], gap: false }
  }
  const folhas = await buscarInsumosEmNatura(codigoEverest)
  if (folhas === null) {
    // Só é gap de verdade quando a categoria É de se esperar ficha técnica (pré-preparo).
    // Limpeza/uniforme, embalagem, equipamento e revenda direta (categoria "venda", ex.: vinho
    // vendido de garrafa fechada) nunca vão ter ficha — não é falta de cadastro, é a conta não
    // se aplicar a esse item. Mesma regra já usada no Consolidado da contagem
    // (buscarConsolidadoPorData) — antes dessa correção, qualquer compra de descartável,
    // material de limpeza ou vinho no período virava "gap" sem motivo, poluindo a lista.
    return { insumos: [], gap: categoria === 'pre_preparo' }
  }
  return {
    insumos: folhas.map((f) => ({ codigoEverest: f.codigoEverest, nome: f.nome, unidade: f.unidade, quantidade: f.quantidadePorUnidade * quantidade })),
    gap: false
  }
}

export async function buscarCMVSemanal({ grupoId, dataInicio = null, dataFim = null }) {
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

  const acc = new Map() // codigoEverest -> { nome, unidade, ei, ef, compras, comprasValor, teorico }
  const get = (codigo, nome, unidade) => {
    if (!acc.has(codigo)) acc.set(codigo, { codigoEverest: codigo, nome, unidade, ei: 0, ef: 0, compras: 0, comprasValor: 0, teorico: 0 })
    return acc.get(codigo)
  }
  const gapsContagem = new Set()
  const gapsCompras = new Set()

  async function acumularContagem(idsSessoes, campo) {
    if (!idsSessoes.length) return
    const itens = await buscarTodasAsLinhas(() =>
      supabase.from('itens_contagem')
        .select('produto_id, quantidade, produtos(nome, codigo_everest, unidade_medida, categoria)')
        .in('sessao_id', idsSessoes)
    )
    const porProduto = new Map()
    for (const it of itens) {
      if (!it.produto_id || !it.produtos?.codigo_everest) continue
      if (!porProduto.has(it.produto_id)) porProduto.set(it.produto_id, { ...it.produtos, quantidade: 0 })
      porProduto.get(it.produto_id).quantidade += Number(it.quantidade) || 0
    }
    for (const p of porProduto.values()) {
      const { insumos, gap } = await converterParaInsumos(p.codigo_everest, p.categoria, p.nome, p.unidade_medida, p.quantidade)
      if (gap) { gapsContagem.add(`${p.nome} (${p.codigo_everest})`); continue }
      for (const ins of insumos) get(ins.codigoEverest, ins.nome, ins.unidade)[campo] += ins.quantidade
    }
  }

  await acumularContagem(diaIni ? diaIni.sessoes.map((s) => s.id) : [], 'ei')
  await acumularContagem(diaFim ? diaFim.sessoes.map((s) => s.id) : [], 'ef')

  if (dataInicio && dataFim) {
    const { data: notas } = await supabase.from('notas_importadas').select('id').gte('data_emissao', dataInicio).lte('data_emissao', dataFim)
    const nIds = (notas || []).map((n) => n.id)
    if (nIds.length) {
      const itensCompra = await buscarTodasAsLinhas(() =>
        supabase.from('notas_importadas_itens')
          .select('produto_id, quantidade, valor_total, calcula_cmv, produtos(nome, codigo_everest, unidade_medida, categoria)')
          .in('nota_id', nIds)
      )
      const porProdutoCompra = new Map()
      for (const it of itensCompra) {
        if (!it.produto_id || !it.produtos?.codigo_everest || it.calcula_cmv === false) continue
        if (!porProdutoCompra.has(it.produto_id)) porProdutoCompra.set(it.produto_id, { ...it.produtos, quantidade: 0, valor: 0 })
        const pc = porProdutoCompra.get(it.produto_id)
        pc.quantidade += Number(it.quantidade) || 0
        pc.valor += Number(it.valor_total) || 0
      }
      for (const p of porProdutoCompra.values()) {
        const { insumos, gap } = await converterParaInsumos(p.codigo_everest, p.categoria, p.nome, p.unidade_medida, p.quantidade)
        if (gap) { gapsCompras.add(`${p.nome} (${p.codigo_everest})`); continue }
        for (const ins of insumos) {
          if (insumosRastreados.size && !insumosRastreados.has(ins.codigoEverest)) continue // fora do grupo escolhido
          const linha = get(ins.codigoEverest, ins.nome, ins.unidade)
          linha.compras += ins.quantidade
          // Valor da compra: só atribui quando a compra vira 1 insumo só (caso comum — insumo comprado
          // direto). Quando 1 produto comprado se abre em vários insumos (receita composta, raro em
          // compra), não dá pra saber quanto do valor pago é de cada um — não atribui (custo desse
          // insumo cai pro fallback via ficha técnica, ver abaixo).
          if (insumos.length === 1) linha.comprasValor += p.valor
        }
      }
    }

    // Filtra por data_movimento no item — ver nota em buscarCurvaDeVendas. Compras e Vendas são
    // sempre da empresa toda (sem filtro de loja — nem o Everest separa compra por loja); o que
    // restringe ao grupo escolhido é o filtro por insumosRastreados logo abaixo.
    const vitens = await buscarTodasAsLinhas(() =>
      supabase.from('vendas_importadas_itens')
        .select('produto_id, codigo_everest, quantidade, cancelado')
        .gte('data_movimento', dataInicio).lte('data_movimento', dataFim)
    )
    const vendidoPorPrato = new Map()
    for (const vi of vitens) {
      if (!vi.produto_id || vi.cancelado || !vi.codigo_everest) continue
      vendidoPorPrato.set(vi.codigo_everest, (vendidoPorPrato.get(vi.codigo_everest) || 0) + (Number(vi.quantidade) || 0))
    }
    for (const [codigoPrato, qtdVendida] of vendidoPorPrato) {
      if (!qtdVendida) continue
      const folhas = await buscarInsumosEmNatura(codigoPrato)
      if (!folhas) continue // prato sem ficha (ex. revenda direta) — não gera consumo teórico de insumo
      for (const f of folhas) {
        if (insumosRastreados.size && !insumosRastreados.has(f.codigoEverest)) continue // fora do grupo escolhido
        get(f.codigoEverest, f.nome, f.unidade).teorico += f.quantidadePorUnidade * qtdVendida
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
        .select('codigo_everest, custo_unitario, custo_medio, fichas_tecnicas(data_versao)').in('codigo_everest', lote)
      for (const ing of (ings || [])) {
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
  const linhas = Array.from(acc.values())
    .map((v) => {
      const real = v.ei + v.compras - v.ef
      const diferenca = v.teorico - real
      const custoUnitario = custoUnitarioPorCodigo.get(v.codigoEverest) || null
      return {
        codigoEverest: v.codigoEverest, nome: v.nome, unidade: v.unidade,
        subgrupoEverest: subgrupoEverestPorCodigo.get(v.codigoEverest) || null,
        estoqueInicial: r3(v.ei), compras: r3(v.compras), estoqueFinal: r3(v.ef),
        real: r3(real), teorico: r3(v.teorico), diferenca: r3(diferenca),
        custoUnitario,
        custoOrigem: custoOrigemPorCodigo.get(v.codigoEverest) || null,
        diferencaValor: custoUnitario != null ? Math.round(diferenca * custoUnitario * 100) / 100 : null
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
    gapsCompras: Array.from(gapsCompras)
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

function dataDaSessao(s) {
  return s.data_referencia || (s.iniciada_em ? String(s.iniciada_em).slice(0, 10) : null)
}

// Lista as datas exatas que têm pelo menos 1 sessão de contagem semanal desse grupo de
// contagem (em qualquer loja) — pra popular o seletor da tela de revisão e do CMV Real × Teórico.
export async function listarDatasContagemPorGrupo(grupoId) {
  if (!grupoId) return []
  const { data: sessoes, error } = await supabase
    .from('sessoes_contagem')
    .select('id, data_referencia, iniciada_em, status')
    .eq('grupo_id', grupoId)
    .eq('tipo', 'semanal')
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
async function carregarFichasParaConversao() {
  if (_cacheFichasConversao) return _cacheFichasConversao
  const fichas = await buscarTodasAsLinhas(() => supabase.from('fichas_tecnicas').select('id, codigo_everest'))
  const codigosComFicha = new Set(fichas.map((f) => f.codigo_everest).filter(Boolean))
  const fichaIdPorCodigo = new Map(fichas.filter((f) => f.codigo_everest).map((f) => [f.codigo_everest, f.id]))
  const fichaIds = fichas.map((f) => f.id)
  const ingredientesPorFicha = new Map()
  for (let i = 0; i < fichaIds.length; i += 300) {
    const lote = fichaIds.slice(i, i + 300)
    const ings = await buscarTodasAsLinhas(() =>
      supabase.from('fichas_tecnicas_ingredientes').select('ficha_id, codigo_everest, nome, unidade_medida, quantidade_baixa_estoque').in('ficha_id', lote)
    )
    for (const ing of ings) {
      if (!ingredientesPorFicha.has(ing.ficha_id)) ingredientesPorFicha.set(ing.ficha_id, [])
      ingredientesPorFicha.get(ing.ficha_id).push(ing)
    }
  }
  _cacheFichasConversao = { codigosComFicha, fichaIdPorCodigo, ingredientesPorFicha }
  return _cacheFichasConversao
}

// Retorna a lista de insumos em natura (folhas) por 1 unidade do produto `codigoEverest` —
// já com a cadeia inteira resolvida (pode ter mais de 1 insumo, em receita composta).
// Retorna null se esse código não tem ficha técnica cadastrada (gap, não zero).
export async function buscarInsumosEmNatura(codigoEverest) {
  if (!codigoEverest) return null
  const { codigosComFicha, fichaIdPorCodigo, ingredientesPorFicha } = await carregarFichasParaConversao()
  const fichaId = fichaIdPorCodigo.get(codigoEverest)
  if (!fichaId) return null
  const ingredientes = ingredientesPorFicha.get(fichaId) || []
  const folhas = ingredientes.filter((ing) => ing.codigo_everest && !codigosComFicha.has(ing.codigo_everest))
  return folhas.map((f) => ({
    codigoEverest: f.codigo_everest, nome: f.nome, unidade: f.unidade_medida,
    quantidadePorUnidade: Number(f.quantidade_baixa_estoque) || 0
  }))
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
