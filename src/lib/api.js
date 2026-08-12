import { supabase } from './supabase'

// Detecta o erro do Postgrest quando uma coluna ainda não existe (ex.: migração pendente),
// pra dar fallback em vez de travar a tela inteira. Código 42703 = undefined_column.
function colunaNaoExiste(error, nomeColuna) {
  if (!error) return false
  if (error.code === '42703') return true
  const msg = String(error.message || '')
  return msg.includes(nomeColuna) && /column|coluna/i.test(msg)
}

// Busca TODAS as linhas de uma consulta, paginando automaticamente — o Supabase corta em
// 1000 linhas por padrão sem avisar. Crítico pro inventário mensal, que cobre o catálogo inteiro.
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

export async function listarUnidades() {
  const { data, error } = await supabase
    .from('unidades')
    .select('*')
    .eq('ativo', true)
    .order('nome')
  if (error) throw error
  return data
}

export async function buscarProdutosPorNome(termo) {
  const t = (termo || '').trim()
  if (t.length < 2) return []
  const tokens = t.split(/\s+/).filter(Boolean)
  let q = supabase
    .from('produtos')
    .select('*')
    .eq('ativo', true)
    .or('tipo_item.is.null,tipo_item.neq.PRODUTO ACABADO,nome.ilike.MC %')
  // Cada pedaço digitado precisa aparecer (no nome ou no código). Ex.: "bat pal" -> "batata palha".
  for (const tok of tokens) {
    q = q.or(`nome.ilike.%${tok}%,codigo_everest.ilike.%${tok}%`)
  }
  const { data, error } = await q.order('nome').limit(30)
  if (error) throw error
  return data
}

export async function buscarProdutoPorBarcode(codigoBarras) {
  const { data, error } = await supabase
    .from('barcodes')
    .select('codigo_barras, produtos(*)')
    .eq('codigo_barras', codigoBarras)
    .maybeSingle()
  if (error) throw error
  return data // null se não encontrado
}

export async function cadastrarProdutoComBarcode({ nome, unidadeMedida, categoria, codigoEverest, codigoBarras }) {
  const { data: produto, error: erroProduto } = await supabase
    .from('produtos')
    .insert({ nome, unidade_medida: unidadeMedida, categoria, codigo_everest: codigoEverest })
    .select()
    .single()
  if (erroProduto) throw erroProduto

  if (codigoBarras) {
    const { error: erroBarcode } = await supabase
      .from('barcodes')
      .insert({ codigo_barras: codigoBarras, produto_id: produto.id })
    if (erroBarcode) throw erroBarcode
  }

  return produto
}

// Vincula um código de barras escaneado a um produto Everest já existente
// (o caminho normal, já que a maioria dos itens já está cadastrada).
export async function vincularBarcodeExistente(produtoId, codigoBarras) {
  const { error } = await supabase
    .from('barcodes')
    .upsert(
      { codigo_barras: codigoBarras, produto_id: produtoId, origem: 'industrializado' },
      { onConflict: 'codigo_barras' }
    )
  if (error) throw error
}

export async function listarGrupos() {
  const { data, error } = await supabase.from('grupos_contagem').select('id, nome').order('nome')
  if (error) throw error
  return data
}

export async function listarItensDoGrupo(grupoId) {
  const data = await buscarTodasAsLinhas(() =>
    supabase.from('grupos_contagem_itens').select('produtos(*)').eq('grupo_id', grupoId)
  )
  return data.map((r) => r.produtos)
}

// Todos os produtos "físicos" ativos (exclui os itens de venda/cardápio, que não têm estoque contável).
// Todos os produtos ativos — o inventário geral conta tudo mesmo, exceto Produto Acabado
// (prato/bebida servido, sem estoque físico próprio) — a não ser que seja do Mercadinho (MC),
// que é produção própria vendida como mercadoria de verdade, com estoque real.
export async function listarProdutosParaMensal() {
  const data = await buscarTodasAsLinhas(() =>
    supabase.from('produtos').select('id').eq('ativo', true)
      .or('tipo_item.is.null,tipo_item.neq.PRODUTO ACABADO,nome.ilike.MC %')
  )
  return data.map((p) => p.id)
}

// tipo: 'parcial' | 'mensal'; itensEsperadosIds: array de produto_id que compõem a sessão
// dataReferencia (opcional, 'YYYY-MM-DD'): dia real da contagem — usado na semanal pra deixar
// lançar hoje uma contagem que na prática aconteceu ontem/anteontem sem falsear "iniciada_em"
// (que continua sendo o timestamp real de criação, usado pra detectar sessão travada/antiga).
export async function iniciarSessao({ unidadeId, usuario, tipo, grupoId, mesReferencia, anoReferencia, dataReferencia, itensEsperadosIds }) {
  let { data: sessao, error: erroSessao } = await supabase
    .from('sessoes_contagem')
    .insert({
      unidade_id: unidadeId || null, // contagem semanal não exige loja (ver migration_v6.sql)
      usuario,
      tipo,
      grupo_id: grupoId || null,
      mes_referencia: mesReferencia,
      ano_referencia: anoReferencia,
      data_referencia: dataReferencia || null
    })
    .select()
    .single()
  // Se a coluna data_referencia ainda não existe (migration_v4.sql não rodou no Supabase),
  // tenta de novo sem ela em vez de travar a criação da sessão inteira.
  if (erroSessao && colunaNaoExiste(erroSessao, 'data_referencia')) {
    ;({ data: sessao, error: erroSessao } = await supabase
      .from('sessoes_contagem')
      .insert({
        unidade_id: unidadeId || null,
        usuario,
        tipo,
        grupo_id: grupoId || null,
        mes_referencia: mesReferencia,
        ano_referencia: anoReferencia
      })
      .select()
      .single())
  }
  if (erroSessao) throw erroSessao

  if (itensEsperadosIds?.length) {
    const linhas = itensEsperadosIds.map((produtoId) => ({ sessao_id: sessao.id, produto_id: produtoId }))
    const tamanhoLote = 500
    for (let i = 0; i < linhas.length; i += tamanhoLote) {
      const { error: erroEsperados } = await supabase.from('itens_esperados_sessao').insert(linhas.slice(i, i + tamanhoLote))
      if (erroEsperados) throw erroEsperados
    }
  }

  return sessao
}

export async function contarProgressoSessao(sessaoId) {
  const { count: esperados, error: erroEsperados } = await supabase
    .from('itens_esperados_sessao')
    .select('*', { count: 'exact', head: true })
    .eq('sessao_id', sessaoId)
  if (erroEsperados) throw erroEsperados

  const contados = await buscarTodasAsLinhas(() =>
    supabase.from('itens_contagem').select('produto_id').eq('sessao_id', sessaoId)
  )

  const distintos = new Set(contados.map((c) => c.produto_id)).size
  return { esperados: esperados || 0, contados: distintos }
}

// Reescrito em 07/08/2026: antes fazia SELECT direto em `usuarios_app` (a tabela toda de PINs
// tinha RLS aberto pra chave anônima — qualquer um conseguia ler todos os PINs de uma vez só via
// API pública). Agora passa por uma function do banco (`verificar_pin_seguro`, SECURITY DEFINER)
// que só devolve nome/nível de UM pin que já bateu, sem expor a tabela — ver migração
// `2026-08-07-travar-senhas-pins.sql`. Requer ter rodado essa migração antes de subir esse código.
export async function verificarPin(pin) {
  const { data, error } = await supabase.rpc('verificar_pin_seguro', { pin_informado: pin })
  if (error) throw error
  const linha = data?.[0]
  if (!linha) return null
  return { nome: linha.nome_completo, nivelAcesso: linha.nivel_acesso }
}

export async function buscarConfiguracaoGeral() {
  const { data, error } = await supabase.from('configuracao_geral').select('chave, valor')
  if (error) throw error
  const mapa = Object.fromEntries(data.map((d) => [d.chave, d.valor]))
  return {
    mesAtivoMensal: mapa.mes_ativo_mensal ? Number(mapa.mes_ativo_mensal) : null,
    anoAtivoMensal: mapa.ano_ativo_mensal ? Number(mapa.ano_ativo_mensal) : null
  }
}

// Contagem semanal não tem loja (ver migration_v6.sql) — por isso essa checagem passa a aceitar
// procurar por grupoId em vez de unidadeId quando não há loja envolvida. Mensal/outros tipos
// continuam checando por loja, como sempre.
export async function buscarSessaoEmAndamento({ unidadeId, grupoId, tipo }) {
  let query = supabase
    .from('sessoes_contagem')
    .select('*')
    .eq('tipo', tipo)
    .eq('status', 'em_andamento')
  if (unidadeId) query = query.eq('unidade_id', unidadeId)
  else if (grupoId) query = query.eq('grupo_id', grupoId)
  else return null
  const { data, error } = await query
    .order('iniciada_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function finalizarSessao(sessaoId) {
  const { error } = await supabase
    .from('sessoes_contagem')
    .update({ status: 'finalizada', finalizada_em: new Date().toISOString() })
    .eq('id', sessaoId)
  if (error) throw error
}

// Apaga a sessão inteira (e, por cascade no banco, os itens contados, itens esperados e saídas
// vinculados a ela) — usado no botão "Excluir" da tela de lançamento, pra quem abriu a contagem
// errada ou quer descartar ela sem enviar. Não confundir com "remover item" (1 produto só).
export async function excluirSessao(sessaoId) {
  const { error } = await supabase.from('sessoes_contagem').delete().eq('id', sessaoId)
  if (error) throw error
}

// modoEntrada: 'embalagem' -> { qtdEmbalagens, pesoEmbalagem }; 'direto' -> { quantidade }
export async function registrarItemContagem({ sessaoId, produtoId, codigoBarrasUsado, modoEntrada, qtdEmbalagens, pesoEmbalagem, quantidade }) {
  const { data, error } = await supabase
    .from('itens_contagem')
    .insert({
      sessao_id: sessaoId,
      produto_id: produtoId,
      codigo_barras_usado: codigoBarrasUsado || null,
      modo_entrada: modoEntrada,
      qtd_embalagens: modoEntrada === 'embalagem' ? qtdEmbalagens : null,
      peso_embalagem: modoEntrada === 'embalagem' ? pesoEmbalagem : null,
      quantidade
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function atualizarItemContagem(itemId, { modoEntrada, qtdEmbalagens, pesoEmbalagem, quantidade }) {
  const { error } = await supabase
    .from('itens_contagem')
    .update({
      modo_entrada: modoEntrada,
      qtd_embalagens: modoEntrada === 'embalagem' ? qtdEmbalagens : null,
      peso_embalagem: modoEntrada === 'embalagem' ? pesoEmbalagem : null,
      quantidade
    })
    .eq('id', itemId)
  if (error) throw error
}

// Sempre busca do banco — garante que a lista sobrevive a um refresh de página.
export async function listarItensDaSessao(sessaoId) {
  const data = await buscarTodasAsLinhas(() =>
    supabase
      .from('itens_contagem')
      .select('*, produtos(nome, unidade_medida, codigo_everest)')
      .eq('sessao_id', sessaoId)
      .order('registrado_em', { ascending: false })
  )
  return data
}

export async function removerItemContagem(itemId) {
  const { error } = await supabase.from('itens_contagem').delete().eq('id', itemId)
  if (error) throw error
}

// Saídas registradas durante a contagem (item retirado/usado no momento). A contagem original
// fica intacta; a saída é um movimento à parte, rastreável. Estoque efetivo = contado - saídas.
export async function registrarSaidaContagem({ sessaoId, produtoId, quantidade, motivo, usuario }) {
  const { data, error } = await supabase
    .from('saidas_contagem')
    .insert({ sessao_id: sessaoId, produto_id: produtoId, quantidade, motivo: motivo || null, usuario: usuario || null })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listarSaidasDaSessao(sessaoId) {
  const data = await buscarTodasAsLinhas(() =>
    supabase
      .from('saidas_contagem')
      .select('*, produtos(nome, unidade_medida, codigo_everest)')
      .eq('sessao_id', sessaoId)
      .order('registrado_em', { ascending: false })
  )
  return data
}

export async function removerSaidaContagem(saidaId) {
  const { error } = await supabase.from('saidas_contagem').delete().eq('id', saidaId)
  if (error) throw error
}

// Itens esperados de uma sessão (ex.: os itens fixos de um grupo de contagem semanal).
export async function listarEsperadosDaSessao(sessaoId) {
  const data = await buscarTodasAsLinhas(() =>
    supabase.from('itens_esperados_sessao').select('produto_id, produtos(*)').eq('sessao_id', sessaoId)
  )
  return (data || []).map((r) => r.produtos).filter(Boolean).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
}
