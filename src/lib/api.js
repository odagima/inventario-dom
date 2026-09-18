import { supabase } from './supabase'

// Detecta o erro do Postgrest quando uma coluna ainda não existe (ex.: migração pendente),
// pra dar fallback em vez de travar a tela inteira.
//
// 28/08/2026: o mesmo problema chega em DOIS formatos diferentes, e o código só tratava um deles
// (ver §31 do DECISOES-TRAVADAS.md — o mesmo já tinha sido corrigido no adminApi.js e ficou
// faltando aqui). `42703` (undefined_column) é o erro do Postgres, que vem em LEITURA; `PGRST204`
// é o do PostgREST ("could not find the column ... in the schema cache") e vem em INSERT/UPDATE —
// justamente o caminho do lançamento. Sem cobrir os dois, a gravação estoura com a mensagem crua
// na tela em vez de cair no fallback.
function colunaNaoExiste(error, nomeColuna) {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  const msg = String(error.message || '')
  if (/schema cache/i.test(msg) && (!nomeColuna || msg.includes(nomeColuna))) return true
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
// turno (opcional, 'almoco' | 'jantar'): só usado no registro de perdas, que é lançado uma vez por
// turno no fim do expediente (ver migration_v13.sql). Fica na sessão, não no item.
export async function iniciarSessao({ unidadeId, usuario, tipo, grupoId, mesReferencia, anoReferencia, dataReferencia, turno, itensEsperadosIds }) {
  const base = {
    unidade_id: unidadeId || null, // contagem semanal não exige loja (ver migration_v6.sql)
    usuario,
    tipo,
    grupo_id: grupoId || null,
    mes_referencia: mesReferencia,
    ano_referencia: anoReferencia
  }
  // Campos que dependem de migração: se a coluna ainda não existir no Supabase, a inserção é
  // repetida sem ela em vez de travar a criação da sessão inteira. `data_referencia` veio na
  // migration_v4; `turno`, na v13.
  const opcionais = { data_referencia: dataReferencia || null, turno: turno || null }

  let { data: sessao, error: erroSessao } = await supabase
    .from('sessoes_contagem').insert({ ...base, ...opcionais }).select().single()

  // Tira UMA coluna por tentativa — a que o erro citar pelo nome. As duas mensagens (Postgres e
  // PostgREST) trazem o nome da coluna, então dá pra ser cirúrgico: se só `turno` estiver
  // faltando, a contagem semanal não perde a `data_referencia` junto. Se por algum motivo não der
  // pra identificar qual é, a última tentativa vai sem nenhuma das duas.
  let tentativas = Object.keys(opcionais).length
  while (erroSessao && colunaNaoExiste(erroSessao) && tentativas-- > 0) {
    const msg = String(erroSessao.message || '')
    const citada = Object.keys(opcionais).find((c) => msg.includes(c))
    for (const c of citada ? [citada] : Object.keys(opcionais)) delete opcionais[c]
    ;({ data: sessao, error: erroSessao } = await supabase
      .from('sessoes_contagem').insert({ ...base, ...opcionais }).select().single())
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
// 02/09/2026 (§67): a `verificar_pin_seguro` da migration_v15 devolve, além do nome/nível, o
// perfil da pessoa com a lista de permissões já resolvida — assim o app monta o menu sem uma
// segunda consulta e sem precisar de leitura em `perfis_acesso`.
//
// ⚠️ Compatibilidade em duas direções, de propósito:
//   - Se a v15 ainda NÃO foi rodada, a função antiga (3 colunas) responde e os campos novos vêm
//     `undefined` — `permissoes` cai em `[]` e o app se comporta exatamente como antes (ninguém
//     restringido). Nada quebra por rodar este código antes da migração.
//   - Se a v15 já rodou mas a pessoa não tem perfil vinculado, a lista vem vazia e ela também
//     segue vendo tudo, pelo `nivel_acesso` antigo. É a regra travada: ninguém perde acesso no
//     meio do serviço enquanto o Felipe revisa perfil por perfil.
export async function verificarPin(pin) {
  const { data, error } = await supabase.rpc('verificar_pin_seguro', { pin_informado: pin })
  if (error) throw error
  const linha = data?.[0]
  if (!linha) return null
  return {
    nome: linha.nome_completo,
    nivelAcesso: linha.nivel_acesso,
    perfilId: linha.perfil_id ?? null,
    perfilNome: linha.perfil_nome ?? null,
    permissoes: Array.isArray(linha.permissoes) ? linha.permissoes : [],
    ehDesenvolvedor: !!linha.eh_desenvolvedor,
    unidadeId: linha.unidade_id ?? null,
    unidadeNome: linha.unidade_nome ?? null
  }
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
// 17/08/2026: Felipe (testando Contagem semanal com o time da cozinha) reportou abrir a tela com
// a data 03/08 escolhida e cair numa sessão de OUTRA PESSOA, do dia 17/08 — a busca aqui só
// filtrava por tipo + loja/grupo, sem checar nem a data escolhida (`dataReferencia`) nem quem
// estava logado (`usuario`). Resultado: pegava "a sessão em andamento mais recente desse
// grupo/loja", de qualquer dia e de qualquer pessoa, e a tela de lançamento continuava ela como
// se fosse a certa — sem avisar nada. Corrigido pra SEMPRE isolar por usuário (decisão explícita
// do Felipe: "a contagem não pode cruzar ou interferir por data e nem usuário....precisa ser
// única" — cada login só vê/continua a própria sessão, nunca a de outra pessoa, mesmo no mesmo
// grupo/loja) e, quando `dataReferencia` é informada (Contagem semanal), também por essa data —
// sessão de outro dia nunca é reaproveitada. `usuario` agora é obrigatório: sem login não tem como
// isolar por dono, e nunca fazia sentido buscar sessão em andamento sem saber de quem.
// 28/08/2026: `turno` entra pelo mesmo motivo que `dataReferencia` — no registro de perdas, almoço
// e jantar do mesmo dia são dois lançamentos distintos, então retomar "a sessão aberta de hoje"
// sem olhar o turno misturaria os dois.
// 28/08/2026: `turno` entra pelo mesmo motivo que `dataReferencia` — no registro de perdas, almoço
// e jantar do mesmo dia são dois lançamentos distintos, então retomar "a sessão aberta de hoje"
// sem olhar o turno misturaria os dois.
//
// `semEscopo`: perdas não tem loja NEM grupo de contagem, então nenhum dos dois filtros habituais
// se aplica. O `return null` de quem não informa escopo continua valendo por padrão (é um
// guarda-corpo: sem escopo e sem intenção explícita, a consulta pegaria a sessão aberta de
// qualquer loja) — quem precisa de busca sem escopo pede de propósito e fica responsável por
// informar dia/turno, que é o que isola a sessão nesse caso.
export async function buscarSessaoEmAndamento({ unidadeId, grupoId, tipo, usuario, dataReferencia, turno, semEscopo = false }) {
  if (!usuario) throw new Error('buscarSessaoEmAndamento precisa de `usuario` — não dá pra isolar sessão sem saber quem está logado.')
  function montar({ comTurno }) {
    let query = supabase
      .from('sessoes_contagem')
      .select('*')
      .eq('tipo', tipo)
      .eq('status', 'em_andamento')
      .eq('usuario', usuario)
    if (unidadeId) query = query.eq('unidade_id', unidadeId)
    else if (grupoId) query = query.eq('grupo_id', grupoId)
    else if (!semEscopo) return null
    if (dataReferencia) query = query.eq('data_referencia', dataReferencia)
    if (comTurno && turno) query = query.eq('turno', turno)
    return query.order('iniciada_em', { ascending: false }).limit(1).maybeSingle()
  }
  const consulta = montar({ comTurno: true })
  if (!consulta) return null
  let { data, error } = await consulta
  // migration_v13.sql ainda não rodou: procura sem filtrar por turno em vez de travar a tela.
  if (error && colunaNaoExiste(error, 'turno')) {
    ;({ data, error } = await montar({ comTurno: false }))
  }
  if (error) throw error
  return data
}

// 17/08/2026: `usuario` da sessão é gravado só na criação e nunca mudava — se a pessoa que ABRIU
// a contagem não foi a mesma que clicou em "Enviar" (ex.: alguém começa, não envia, e no dia
// seguinte outra pessoa reabre — hoje isso não deveria mais acontecer, ver fix em
// `buscarSessaoEmAndamento`, mas pode acontecer de propósito, ex. 1 pessoa inicia e outra finaliza
// no mesmo dispositivo/turno), o relatório mostrava o nome de quem abriu, não de quem de fato
// mandou os dados — foi exatamente o caso que o Felipe relatou ("estava com meu nome" numa
// contagem que ele não lembra de ter enviado). `usuario_finalizou` guarda separadamente quem
// clicou em enviar; `usuario` continua sendo "quem iniciou", sem mudar o significado de um campo
// que outras telas já leem.
export async function finalizarSessao(sessaoId, usuarioFinalizou) {
  const { error } = await supabase
    .from('sessoes_contagem')
    .update({ status: 'finalizada', finalizada_em: new Date().toISOString(), usuario_finalizou: usuarioFinalizou || null })
    .eq('id', sessaoId)
  // Se a coluna ainda não existir (migration_v10.sql não rodou no Supabase), tenta de novo sem
  // ela em vez de travar o envio da contagem inteira.
  if (error && colunaNaoExiste(error, 'usuario_finalizou')) {
    const { error: erroSemColuna } = await supabase
      .from('sessoes_contagem')
      .update({ status: 'finalizada', finalizada_em: new Date().toISOString() })
      .eq('id', sessaoId)
    if (erroSemColuna) throw erroSemColuna
    return
  }
  if (error) throw error
}

// Apaga a sessão inteira (e, por cascade no banco, os itens contados, itens esperados e saídas
// vinculados a ela) — usado no botão "Excluir" da tela de lançamento, pra quem abriu a contagem
// errada ou quer descartar ela sem enviar. Não confundir com "remover item" (1 produto só).
export async function excluirSessao(sessaoId) {
  const { error } = await supabase.from('sessoes_contagem').delete().eq('id', sessaoId)
  if (error) throw error
}

// 17/08/2026: `itens_contagem` guardava só `registrado_em` (quando) — nunca guardou QUEM lançou
// cada item, diferente de `saidas_contagem` (que já tinha `usuario` por linha desde sempre). Numa
// sessão que pode ser retomada por mais de 1 pessoa (turno, revezamento) isso deixava impossível
// saber quem contou o quê. Pedido do Felipe: "vamos guardar a informação de data hora e o que
// mais você conseguir pegar do usuário". `registrado_em` já é automático (default now() no banco);
// `usuario` (nome de quem está logado no momento do lançamento) é o dado adicional que dá pra
// capturar sem inventar infraestrutura nova (o login é por nome/PIN, sem e-mail/dispositivo).
// modoEntrada: 'embalagem' -> { qtdEmbalagens, pesoEmbalagem }; 'direto' -> { quantidade }
// motivoPerda/modoPerda: só no registro de perdas (ver migration_v13.sql). Diferente do `usuario`,
// esses dois NÃO têm fallback silencioso: uma perda gravada sem motivo é uma linha inútil no
// relatório (e indistinguível de uma contagem), então é melhor falhar com uma mensagem clara
// pedindo a migração do que gravar pela metade e o time achar que registrou.
export async function registrarItemContagem({ sessaoId, produtoId, codigoBarrasUsado, modoEntrada, qtdEmbalagens, pesoEmbalagem, quantidade, usuario, motivoPerda, modoPerda }) {
  const linha = {
    sessao_id: sessaoId,
    produto_id: produtoId,
    codigo_barras_usado: codigoBarrasUsado || null,
    modo_entrada: modoEntrada,
    qtd_embalagens: modoEntrada === 'embalagem' ? qtdEmbalagens : null,
    peso_embalagem: modoEntrada === 'embalagem' ? pesoEmbalagem : null,
    quantidade,
    usuario: usuario || null
  }
  if (motivoPerda) {
    linha.motivo_perda = motivoPerda
    linha.modo_perda = modoPerda || 'peso'
  }
  let { data, error } = await supabase.from('itens_contagem').insert(linha).select().single()
  if (error && motivoPerda && colunaNaoExiste(error) && /motivo_perda|modo_perda/.test(String(error.message || ''))) {
    throw new Error('O registro de perdas precisa da migração migration_v13.sql no Supabase (colunas motivo_perda/modo_perda). Nada foi gravado — fala com quem cuida do admin.')
  }
  // Se a coluna ainda não existir (migration_v10.sql não rodou no Supabase), tenta de novo sem
  // ela em vez de travar o lançamento do item inteiro.
  if (error && colunaNaoExiste(error, 'usuario')) {
    const { usuario: _descartado, ...linhaSemUsuario } = linha
    ;({ data, error } = await supabase.from('itens_contagem').insert(linhaSemUsuario).select().single())
  }
  if (error) throw error
  return data
}

// Busca filtrada pela categoria escolhida no registro de perdas (matéria-prima / pré-preparo /
// prato). Existe separada de `buscarProdutosPorNome` porque aquela é a busca da CONTAGEM, que
// exclui PRODUTO ACABADO de propósito (prato não tem estoque físico pra contar) — aqui prato é
// justamente uma das opções válidas.
//
// O filtro usa `tipo_item`, o mesmo campo declarado pelo Everest em que o motor de conversão se
// baseia. `tiposItem` vem de CATEGORIAS_PERDA (src/lib/perdas.js); se vier vazio ou desconhecido,
// não filtra por tipo em vez de devolver lista vazia — resultado demais é recuperável, lista vazia
// sem explicação faz a pessoa achar que o produto não existe.
export async function buscarProdutosPorCategoriaPerda(termo, tiposItem) {
  const t = (termo || '').trim()
  if (t.length < 2) return []
  const tokens = t.split(/\s+/).filter(Boolean)
  let q = supabase.from('produtos').select('*').eq('ativo', true)
  if (tiposItem?.length) q = q.in('tipo_item', tiposItem)
  for (const tok of tokens) {
    q = q.or(`nome.ilike.%${tok}%,codigo_everest.ilike.%${tok}%`)
  }
  const { data, error } = await q.order('nome').limit(30)
  if (error) throw error
  return data
}

// `usuario`: quem EDITOU esse lançamento por último — sobrescreve o `usuario` de quem lançou
// originalmente. É um campo de "última edição", não um histórico completo (não temos log de
// versões), mas já resolve a dúvida mais comum ("quem alterou esse valor por último").
export async function atualizarItemContagem(itemId, { modoEntrada, qtdEmbalagens, pesoEmbalagem, quantidade, usuario }) {
  const linha = {
    modo_entrada: modoEntrada,
    qtd_embalagens: modoEntrada === 'embalagem' ? qtdEmbalagens : null,
    peso_embalagem: modoEntrada === 'embalagem' ? pesoEmbalagem : null,
    quantidade,
    usuario: usuario || null
  }
  let { error } = await supabase.from('itens_contagem').update(linha).eq('id', itemId)
  if (error && colunaNaoExiste(error, 'usuario')) {
    const { usuario: _descartado, ...linhaSemUsuario } = linha
    ;({ error } = await supabase.from('itens_contagem').update(linhaSemUsuario).eq('id', itemId))
  }
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

// Corrige data e turno de uma sessão de perdas JÁ ABERTA, direto no lançamento — o registro é do
// ocorrido do dia, e é comum a pessoa perceber no meio que abriu no turno errado ou que está
// lançando o dia anterior.
//
// `mes_referencia`/`ano_referencia` acompanham a data escolhida (mesma regra da criação, §18.1):
// a tela de lançamento não mostra mês/ano, então deixá-los apontando pro mês antigo colocaria o
// registro no agrupamento errado do histórico sem ninguém ter como perceber.
export async function atualizarDataETurnoSessao(sessaoId, { dataReferencia, turno }) {
  const [ano, mes] = String(dataReferencia || '').split('-').map(Number)
  const linha = { data_referencia: dataReferencia || null, turno: turno || null }
  if (ano && mes) {
    linha.mes_referencia = mes
    linha.ano_referencia = ano
  }
  let { error } = await supabase.from('sessoes_contagem').update(linha).eq('id', sessaoId)
  if (error && colunaNaoExiste(error, 'turno')) {
    const { turno: _semTurno, ...semTurno } = linha
    ;({ error } = await supabase.from('sessoes_contagem').update(semTurno).eq('id', sessaoId))
    if (error) throw error
    // Avisa em vez de fingir que salvou tudo: a data foi gravada, o turno não.
    throw new Error('A data foi salva, mas o turno não — falta rodar a migration_v13.sql no Supabase.')
  }
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
