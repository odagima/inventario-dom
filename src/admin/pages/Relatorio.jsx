import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { editarQuantidadeItemContagem, trocarProdutoItemContagem, removerItemContagem, buscarProdutosAdmin, listarSessoes, buscarRelatorioSessao, atualizarReferenciaSessao, atualizarDataReferenciaSessao, atualizarTurnoSessao, atualizarUnidadeSessao, apagarSessao, reabrirSessao, finalizarSessaoAdmin, listarUnidadesAdmin, buscarDadosParaExportEverest, buscarResumoParaExportEverest } from '../lib/adminApi'
import { registrarSaidaContagem, listarSaidasDaSessao, removerSaidaContagem } from '../../lib/api'
import { useEscParaFechar } from '../lib/hooks'
import { LABEL_MOTIVO_PERDA, LABEL_TURNO } from '../../lib/perdas'

const LABEL_STATUS = { contado: 'Contado', pendente: 'Pendente', extra: 'Fora da lista' }
const LABEL_TIPO = {
  mensal: 'Inventário geral',
  semanal: 'Contagem semanal',
  diario: 'Contagem tempo de produção',
  producao: 'Registro de produção',
  perdas: 'Registro de perdas/desperdício',
  outros: 'Outros',
  parcial: 'Parcial'
}
const NOMES_MES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function ItemSessao({ s, onAbrir, dataDaSessao }) {
  // Contagem semanal não tem loja (ver migration_v6.sql) — usa o grupo de contagem como label
  // principal quando não há loja.
  const nomePrincipal = s.unidades?.nome || s.grupos_contagem?.nome || LABEL_TIPO[s.tipo] || s.tipo
  return (
    <div className="list-item" style={{ cursor: 'pointer' }} onClick={() => onAbrir(s)}>
      <div>
        <p style={{ margin: 0 }}>{nomePrincipal}</p>
        <p className="muted" style={{ margin: 0 }}>
          {LABEL_TIPO[s.tipo] || s.tipo} · {dataDaSessao(s)}
          {s.turno && ` · ${LABEL_TURNO[s.turno] || s.turno}`} · {s.usuario}
          {s.tipo === 'mensal' && s.mes_referencia && ` · ref. ${String(s.mes_referencia).padStart(2, '0')}/${s.ano_referencia}`}
        </p>
      </div>
      <span className="badge" style={{
        background: s.status === 'finalizada' ? 'rgba(48,209,88,0.16)' : 'rgba(255,159,10,0.16)',
        color: s.status === 'finalizada' ? 'var(--success)' : 'var(--warning)'
      }}>
        {s.status === 'finalizada' ? 'Finalizada' : 'Em andamento'}
      </span>
    </div>
  )
}

export default function Relatorio({ tipoFiltro = null, mostrarExportEverest = true }) {
  const [sessoes, setSessoes] = useState([])
  const [unidades, setUnidades] = useState([])
  const [sessaoAberta, setSessaoAberta] = useState(null)
  const [linhas, setLinhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [carregandoRelatorio, setCarregandoRelatorio] = useState(false)
  const [confirmandoExcluir, setConfirmandoExcluir] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [mesExport, setMesExport] = useState(new Date().getMonth() + 1)
  const [anoExport, setAnoExport] = useState(new Date().getFullYear())
  const [exportando, setExportando] = useState(false)
  const [resumoExport, setResumoExport] = useState(null)
  const [carregandoResumo, setCarregandoResumo] = useState(false)
  const [incluirHistorico, setIncluirHistorico] = useState(false)
  const [empresasSelecionadas, setEmpresasSelecionadas] = useState(new Set(['Dalva', 'DOM']))
  const [saidas, setSaidas] = useState([])
  const [saidaItem, setSaidaItem] = useState(null)
  const [saidaQtd, setSaidaQtd] = useState('')
  const [saidaMotivo, setSaidaMotivo] = useState('')
  const [salvandoSaida, setSalvandoSaida] = useState(false)
  const [buscaItem, setBuscaItem] = useState('')

  useEscParaFechar(!!saidaItem, () => { if (!salvandoSaida) setSaidaItem(null) })

  // Mês/ano de referência da sessão pra fins de agrupamento — com fallback, porque sessão
  // antiga (de antes desse campo existir, ou sem ele preenchido por algum motivo) não pode
  // simplesmente cair fora do agrupamento. Preferência: mes_referencia/ano_referencia (o que a
  // sessão diz que É) → data_referencia (dia real da contagem, semanal) → iniciada_em (nunca é nulo).
  function mesAnoDaSessao(s) {
    if (s.mes_referencia && s.ano_referencia) return { mes: s.mes_referencia, ano: s.ano_referencia }
    if (s.data_referencia) {
      const [ano, mes] = s.data_referencia.split('-').map(Number)
      if (ano && mes) return { mes, ano }
    }
    const d = new Date(s.iniciada_em)
    return { mes: d.getMonth() + 1, ano: d.getFullYear() }
  }

  // Agrupa "Sessões de contagem" por mês/ano de referência, depois por loja e depois por quem
  // contou — só pra Inventário (tipoFiltro = 'mensal'). Contagem Semanal usa outro agrupamento
  // (ver abaixo), já que ela não separa mais por loja (Compras não separa por loja no Everest) —
  // quem escopa é o Grupo de contagem.
  const sessoesAgrupadas = useMemo(() => {
    if (tipoFiltro !== 'mensal') return null
    const porMes = new Map()
    for (const s of sessoes) {
      const { mes, ano } = mesAnoDaSessao(s)
      const chave = `${ano}-${String(mes).padStart(2, '0')}`
      if (!porMes.has(chave)) porMes.set(chave, { ano, mes, porLoja: new Map() })
      const grupo = porMes.get(chave)
      const loja = s.unidades?.nome || '—'
      if (!grupo.porLoja.has(loja)) grupo.porLoja.set(loja, new Map())
      const porUsuario = grupo.porLoja.get(loja)
      const usuario = s.usuario || '—'
      if (!porUsuario.has(usuario)) porUsuario.set(usuario, [])
      porUsuario.get(usuario).push(s)
    }
    return Array.from(porMes.values())
      .sort((a, b) => (b.ano - a.ano) || (b.mes - a.mes))
      .map((g) => ({
        ...g,
        porLoja: Array.from(g.porLoja.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([loja, porUsuario]) => [loja, Array.from(porUsuario.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))])
      }))
  }, [sessoes, tipoFiltro])

  // Mesma correção: a referência informada manda. Sessão mensal cai no dia 1º do mês de
  // referência (representa o mês, não o dia da digitação).
  function dataDaSessaoChave(s) {
    if (s.data_referencia) return s.data_referencia
    if (s.mes_referencia && s.ano_referencia) return `${s.ano_referencia}-${String(s.mes_referencia).padStart(2, '0')}-01`
    return s.iniciada_em ? String(s.iniciada_em).slice(0, 10) : null
  }

  // Contagem semanal: agrupa por Grupo de contagem (A-Z) e, dentro do grupo, pela data exata da
  // contagem (mais recente primeiro) — não mais por loja, já que ela não é mais escolhida na
  // hora de contar (ver DECISOES-TRAVADAS.md / migration_v6.sql).
  const sessoesAgrupadasSemanal = useMemo(() => {
    if (tipoFiltro !== 'semanal') return null
    const porGrupo = new Map()
    for (const s of sessoes) {
      const nomeGrupo = s.grupos_contagem?.nome || 'Sem grupo de contagem'
      if (!porGrupo.has(nomeGrupo)) porGrupo.set(nomeGrupo, new Map())
      const porData = porGrupo.get(nomeGrupo)
      const dataChave = dataDaSessaoChave(s) || '—'
      if (!porData.has(dataChave)) porData.set(dataChave, [])
      porData.get(dataChave).push(s)
    }
    return Array.from(porGrupo.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
      .map(([nomeGrupo, porData]) => ({
        nomeGrupo,
        porData: Array.from(porData.entries()).sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      }))
  }, [sessoes, tipoFiltro])

  // Itens contados da sessão aberta: ordem alfabética + filtro de busca por nome — pedido do
  // Felipe, porque uma contagem grande tem item demais pra rolar procurando um por um.
  const linhasContadasFiltradas = useMemo(() => {
    const termo = buscaItem.trim().toLowerCase()
    return linhas
      .filter((l) => l.status === 'contado' || l.status === 'extra')
      .filter((l) => !termo || (l.nome || '').toLowerCase().includes(termo))
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
  }, [linhas, buscaItem])

  // 02/09/2026: mostrava `iniciada_em` (o dia em que a pessoa DIGITOU) sempre que não havia
  // `data_referencia` — que é o caso de TODO inventário mensal, já que ele só informa mês e ano.
  // Resultado: um inventário de agosto lançado em 2 de setembro aparecia como "02/09/2026", como
  // se a contagem tivesse sido feita nesse dia. Agora a sessão mensal mostra o mês de referência,
  // e o dia da digitação só aparece quando não há nenhuma referência informada — rotulado como
  // tal, pra ninguém confundir com a data da contagem.
  function dataDaSessao(s) {
    if (s.data_referencia) return new Date(s.data_referencia + 'T00:00:00').toLocaleDateString('pt-BR')
    if (s.mes_referencia && s.ano_referencia) return `${String(s.mes_referencia).padStart(2, '0')}/${s.ano_referencia}`
    return `lançado em ${new Date(s.iniciada_em).toLocaleDateString('pt-BR')}`
  }

  async function carregarSessoes() {
    setCarregando(true)
    try {
      const [listaSessoes, listaUnidades] = await Promise.all([listarSessoes(tipoFiltro), listarUnidadesAdmin()])
      setSessoes(listaSessoes)
      setUnidades(listaUnidades)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregarSessoes() }, [])

  // 01/10/2026, pedido do Felipe: um botão "Editar" só, com as 3 ações que hoje só dava pra fazer
  // apagando a sessão inteira (trocar o produto, corrigir a quantidade) ou nem dava (excluir só um
  // lançamento). `aba` escolhe qual das 3 está aberta dentro do mesmo modal.
  const [itemEditando, setItemEditando] = useState(null)
  const [abaEdicaoItem, setAbaEdicaoItem] = useState('quantidade') // 'quantidade' | 'produto' | 'excluir'
  const [qtdEdicaoItem, setQtdEdicaoItem] = useState('')
  const [termoTrocaProduto, setTermoTrocaProduto] = useState('')
  const [resultadosTrocaProduto, setResultadosTrocaProduto] = useState([])
  const [erroEdicaoItem, setErroEdicaoItem] = useState('')
  const [salvandoEdicaoItem, setSalvandoEdicaoItem] = useState(false)
  const buscaTrocaRef = useRef(null)

  function abrirEdicaoItem(l) {
    setItemEditando(l)
    setAbaEdicaoItem('quantidade')
    setQtdEdicaoItem(String(l.quantidade ?? ''))
    setTermoTrocaProduto('')
    setResultadosTrocaProduto([])
    setErroEdicaoItem('')
  }

  useEffect(() => {
    clearTimeout(buscaTrocaRef.current)
    if (termoTrocaProduto.trim().length < 2) { setResultadosTrocaProduto([]); return }
    buscaTrocaRef.current = setTimeout(async () => {
      setResultadosTrocaProduto((await buscarProdutosAdmin(termoTrocaProduto)).slice(0, 8))
    }, 250)
    return () => clearTimeout(buscaTrocaRef.current)
  }, [termoTrocaProduto])

  async function salvarQuantidade() {
    setErroEdicaoItem('')
    setSalvandoEdicaoItem(true)
    try {
      await editarQuantidadeItemContagem(itemEditando.id, String(qtdEdicaoItem).replace(',', '.'))
      setItemEditando(null)
      await recarregarAberto() // recarrega o relatório com o valor novo
    } catch (e) {
      setErroEdicaoItem(e.message)
    } finally {
      setSalvandoEdicaoItem(false)
    }
  }

  async function salvarTrocaProduto(novoProduto) {
    setErroEdicaoItem('')
    setSalvandoEdicaoItem(true)
    try {
      await trocarProdutoItemContagem(itemEditando.id, novoProduto.id)
      setItemEditando(null)
      await recarregarAberto()
    } catch (e) {
      setErroEdicaoItem(e.message)
    } finally {
      setSalvandoEdicaoItem(false)
    }
  }

  async function confirmarExclusaoItem() {
    setErroEdicaoItem('')
    setSalvandoEdicaoItem(true)
    try {
      await removerItemContagem(itemEditando.id)
      setItemEditando(null)
      await recarregarAberto()
    } catch (e) {
      setErroEdicaoItem(e.message)
    } finally {
      setSalvandoEdicaoItem(false)
    }
  }

  async function abrirSessao(sessao) {
    // Só limpa a busca quando troca de sessão de verdade — `salvarQuantidade` chama isso de novo
    // pra recarregar a MESMA sessão depois de uma edição, e perder o texto buscado nessa hora
    // seria um incômodo bobo.
    if (!sessaoAberta || sessaoAberta.id !== sessao.id) setBuscaItem('')
    setSessaoAberta(sessao)
    setConfirmandoExcluir(false)
    setCarregandoRelatorio(true)
    try {
      setLinhas(await buscarRelatorioSessao(sessao.id))
      try { setSaidas(await listarSaidasDaSessao(sessao.id)) } catch { setSaidas([]) }
    } finally {
      setCarregandoRelatorio(false)
    }
  }

  // Pedido do Felipe: quando a mesma pessoa tem mais de uma sessão na mesma loja/mês (contagem
  // fragmentada — começou, travou, começou de nova etc.), abre tudo junto numa visão só. Isso é
  // SÓ DE EXIBIÇÃO: cada linha continua marcada com a sessão de origem (`_sessaoId`), e
  // Editar/Saída sempre agem em cima do lançamento específico — nada no banco é unificado.
  function chaveGrupoUsuario(sessoesDoGrupo) {
    return sessoesDoGrupo.map((s) => s.id).sort().join(',')
  }

  async function abrirGrupoUsuario(sessoesDoGrupo, infoGrupo) {
    const chave = chaveGrupoUsuario(sessoesDoGrupo)
    if (!sessaoAberta || sessaoAberta._chaveGrupo !== chave) setBuscaItem('')
    const pseudo = {
      _merged: true,
      _chaveGrupo: chave,
      _sessoesOriginais: sessoesDoGrupo,
      id: chave,
      usuario: infoGrupo.usuario,
      unidades: infoGrupo.unidades,
      tipo: 'mensal',
      mes_referencia: infoGrupo.mes,
      ano_referencia: infoGrupo.ano,
      status: sessoesDoGrupo.every((s) => s.status === 'finalizada') ? 'finalizada' : 'em_andamento',
      iniciada_em: sessoesDoGrupo.map((s) => s.iniciada_em).sort()[0]
    }
    setSessaoAberta(pseudo)
    setConfirmandoExcluir(false)
    setCarregandoRelatorio(true)
    try {
      const listas = await Promise.all(sessoesDoGrupo.map(async (s) => {
        const ls = await buscarRelatorioSessao(s.id)
        return ls.map((l) => ({ ...l, _sessaoId: s.id }))
      }))
      const todas = listas.flat()
      // Um item pendente em UMA sessão fragmentada mas já contado em OUTRA não é "pendente" de
      // verdade — é só a lista esperada se repetindo por sessão. Não mostra a duplicata.
      const produtosContados = new Set(todas.filter((l) => l.status !== 'pendente').map((l) => l.produto_id))
      const vistosPendente = new Set()
      const final = todas.filter((l) => {
        if (l.status !== 'pendente') return true
        if (produtosContados.has(l.produto_id)) return false
        if (vistosPendente.has(l.produto_id)) return false
        vistosPendente.add(l.produto_id)
        return true
      })
      setLinhas(final)
      const saidasTudo = await Promise.all(sessoesDoGrupo.map((s) => listarSaidasDaSessao(s.id).catch(() => [])))
      setSaidas(saidasTudo.flat())
    } finally {
      setCarregandoRelatorio(false)
    }
  }

  // Usado depois de editar/apagar um lançamento — recarrega do jeito certo, seja visão de uma
  // sessão só ou visão combinada de várias.
  async function recarregarAberto() {
    if (sessaoAberta?._merged) await abrirGrupoUsuario(sessaoAberta._sessoesOriginais, { usuario: sessaoAberta.usuario, unidades: sessaoAberta.unidades, mes: sessaoAberta.mes_referencia, ano: sessaoAberta.ano_referencia })
    else await abrirSessao(sessaoAberta)
  }

  async function confirmarSaida() {
    const qtd = Number(String(saidaQtd).replace(',', '.'))
    if (!saidaItem || !isFinite(qtd) || qtd <= 0) return
    // Na visão combinada, cada item sabe de qual sessão veio (`_sessaoId`) — a saída tem que
    // entrar na sessão de origem certa, não numa sessão "combinada" que nem existe no banco.
    const sessaoIdAlvo = saidaItem._sessaoId || sessaoAberta.id
    setSalvandoSaida(true)
    try {
      await registrarSaidaContagem({ sessaoId: sessaoIdAlvo, produtoId: saidaItem.produto_id, quantidade: qtd, motivo: saidaMotivo, usuario: 'admin' })
      if (sessaoAberta?._merged) await recarregarAberto()
      else setSaidas(await listarSaidasDaSessao(sessaoIdAlvo))
      setSaidaItem(null); setSaidaQtd(''); setSaidaMotivo('')
    } catch (e) {
      alert('Não consegui registrar a saída. Você já rodou o schema.sql atualizado no Supabase (cria a tabela saidas_contagem)? Detalhe: ' + e.message)
    } finally {
      setSalvandoSaida(false)
    }
  }

  async function excluirSaida(id) {
    try {
      await removerSaidaContagem(id)
      if (sessaoAberta?._merged) await recarregarAberto()
      else setSaidas(await listarSaidasDaSessao(sessaoAberta.id))
    } catch (e) {
      alert('Não consegui remover a saída: ' + e.message)
    }
  }

  // 17/08/2026, pedido do Felipe: o Excel exportado precisa trazer a DATA DE REFERÊNCIA da
  // contagem (o dia real que ela representa, não quando foi lançada no sistema) — tanto como
  // coluna dentro da planilha quanto no nome do arquivo. Antes, o nome do arquivo usava
  // `iniciada_em` (timestamp de quando a sessão foi criada no banco); `dataDaSessaoChave` já
  // existe mais abaixo pra isso (prioriza `data_referencia`, cai pra `iniciada_em` só quando não
  // tem — sessão de tipo sem data escolhida, ex. Inventário geral).
  function exportarExcel() {
    const dataReferenciaArquivo = dataDaSessaoChave(sessaoAberta)
    const planilha = XLSX.utils.json_to_sheet(
      linhas
        .filter((l) => l.status === 'contado' || l.status === 'extra')
        .map((l) => ({
        'Data de referência': dataReferenciaArquivo || '',
        Produto: l.nome,
        'Código Everest': l.codigo_everest || '',
        Unidade: l.unidade_medida,
        Quantidade: l.quantidade ?? '',
        Motivo: l.motivo_perda ? (LABEL_MOTIVO_PERDA[l.motivo_perda] || l.motivo_perda) : '',
        'Lançado como': l.modo_perda === 'prato' ? 'Prato inteiro (porções)' : l.modo_perda === 'peso' ? 'Peso' : '',
        Status: LABEL_STATUS[l.status],
        'Lançado por': l.usuario || '',
        'Lançado em': l.registrado_em ? new Date(l.registrado_em).toLocaleString('pt-BR') : ''
      }))
    )
    const livro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(livro, planilha, 'Contagem')
    XLSX.writeFile(livro, `contagem-${sessaoAberta.unidades?.nome || sessaoAberta.grupos_contagem?.nome || 'unidade'}-${dataReferenciaArquivo}.xlsx`)
  }

  async function handleTrocarLoja(novaUnidadeId) {
    await atualizarUnidadeSessao(sessaoAberta.id, novaUnidadeId || null)
    const novaUnidade = unidades.find((u) => u.id === novaUnidadeId)
    setSessaoAberta((prev) => ({ ...prev, unidade_id: novaUnidadeId, unidades: { nome: novaUnidade?.nome } }))
  }

  async function handleExcluir() {
    setExcluindo(true)
    try {
      await apagarSessao(sessaoAberta.id)
      setSessaoAberta(null)
      await carregarSessoes()
    } finally {
      setExcluindo(false)
    }
  }

  function handleMudarMes(novoMes) {
    setMesExport(novoMes)
    setResumoExport(null)
  }
  function handleMudarAno(novoAno) {
    setAnoExport(novoAno)
    setResumoExport(null)
  }

  function nomeEmpresaDaUnidade(u) {
    return (u.cnpj || '').replace(/\D/g, '') === '03306282000148' ? 'DOM' : 'Dalva'
  }

  function toggleEmpresa(nome) {
    setEmpresasSelecionadas((prev) => {
      const novo = new Set(prev)
      if (novo.has(nome)) novo.delete(nome)
      else novo.add(nome)
      return novo
    })
    setResumoExport(null)
  }

  function idsParaFiltro() {
    // se marcou as duas empresas, manda null (sem filtro) — só assim o histórico (sem loja) pode entrar
    if (empresasSelecionadas.size === 2) return null
    return unidades.filter((u) => empresasSelecionadas.has(nomeEmpresaDaUnidade(u))).map((u) => u.id)
  }

  async function handleConferir() {
    setCarregandoResumo(true)
    setResumoExport(null)
    try {
      setResumoExport(await buscarResumoParaExportEverest(mesExport, anoExport, idsParaFiltro()))
    } finally {
      setCarregandoResumo(false)
    }
  }

  async function handleExportarMes() {
    setExportando(true)
    try {
      const dados = await buscarDadosParaExportEverest(mesExport, anoExport, incluirHistorico, idsParaFiltro())
      if (!dados.length) {
        alert('Nenhum dado encontrado pra esse mês (nem contagem finalizada, nem histórico).')
        return
      }
      const livro = XLSX.utils.book_new()
      for (const loja of dados) {
        const linhasPlanilha = [
          ['CNPJ', 'DEPOSITO', 'DATA INVENTARIO EVEREST'],
          [loja.cnpj, loja.deposito, `${String(mesExport).padStart(2, '0')}/${anoExport}`],
          [],
          ['GRUPO', 'ITEM', 'DESCRIÇÃO', 'UND.M', 'CONTAGEM'],
          ...loja.linhas.map((l) => [l.grupo, l.item, l.descricao, l.undM, l.contagem])
        ]
        const planilha = XLSX.utils.aoa_to_sheet(linhasPlanilha)
        const nomeAba = loja.loja.slice(0, 31).replace(/[[\]*/\\?:]/g, '')
        XLSX.utils.book_append_sheet(livro, planilha, nomeAba)
      }
      XLSX.writeFile(livro, `inventario-everest-${anoExport}-${String(mesExport).padStart(2, '0')}.xlsx`)
    } finally {
      setExportando(false)
    }
  }

  if (sessaoAberta) {
    const totalEsperado = linhas.filter((l) => l.status !== 'extra').length
    const totalContado = linhas.filter((l) => l.status === 'contado').length
    const totalPendente = linhas.filter((l) => l.status === 'pendente').length

    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{sessaoAberta.unidades?.nome || sessaoAberta.grupos_contagem?.nome}</p>
          <button onClick={() => setSessaoAberta(null)} style={{ padding: '4px 8px', fontSize: 12 }}>voltar</button>
        </div>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          {sessaoAberta._merged ? (
            <>Visão combinada de {sessaoAberta._sessoesOriginais.length} contagens de {sessaoAberta.usuario} · {dataDaSessao(sessaoAberta)}</>
          ) : (
            <>
              {LABEL_TIPO[sessaoAberta.tipo] || sessaoAberta.tipo} · {dataDaSessao(sessaoAberta)} · iniciada por {sessaoAberta.usuario}
              {/* 17/08/2026: só mostra "enviada por" quando é diferente de quem abriu — sinal de que outra
                  pessoa continuou/enviou a sessão (ver migration_v10.sql, usuario_finalizou). */}
              {sessaoAberta.usuario_finalizou && sessaoAberta.usuario_finalizou !== sessaoAberta.usuario && (
                <> · <span style={{ color: 'var(--warning)' }}>enviada por {sessaoAberta.usuario_finalizou}</span></>
              )}
            </>
          )}
        </p>

        {sessaoAberta._merged && (
          <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
            Só a visualização juntou — cada lançamento continua gravado na sessão de origem dele. Pra corrigir loja/mês ou apagar/reabrir uma sessão específica, veja a lista de novo e abra ela sozinha.
          </p>
        )}

        {!sessaoAberta._merged && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <p className="muted" style={{ margin: '0 0 10px', fontWeight: 500 }}>Corrigir dados da sessão</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="muted">Loja {sessaoAberta.tipo === 'semanal' && <span style={{ fontWeight: 400 }}>(opcional na contagem semanal)</span>}</label>
              <select value={sessaoAberta.unidade_id || ''} onChange={(e) => handleTrocarLoja(e.target.value)}>
                <option value="">— nenhuma —</option>
                {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </div>
            {/* 28/08/2026: perdas entrou aqui junto com a semanal — as duas representam um DIA
                específico, então a data é o dado que precisa ser corrigível depois do fato. */}
            {(sessaoAberta.tipo === 'semanal' || sessaoAberta.tipo === 'perdas') && (
              <div style={{ flex: 1 }}>
                <label className="muted">{sessaoAberta.tipo === 'perdas' ? 'Data do ocorrido' : 'Data da contagem'}</label>
                <input
                  type="date"
                  value={sessaoAberta.data_referencia || ''}
                  onChange={async (e) => {
                    const novaData = e.target.value
                    try {
                      await atualizarDataReferenciaSessao(sessaoAberta.id, novaData)
                      setSessaoAberta((prev) => ({ ...prev, data_referencia: novaData }))
                    } catch (err) {
                      alert(err.message)
                    }
                  }}
                />
              </div>
            )}
            {sessaoAberta.tipo === 'perdas' && (
              <div style={{ flex: 1 }}>
                <label className="muted">Turno</label>
                <select
                  value={sessaoAberta.turno || ''}
                  onChange={async (e) => {
                    const novoTurno = e.target.value
                    try {
                      await atualizarTurnoSessao(sessaoAberta.id, novoTurno)
                      setSessaoAberta((prev) => ({ ...prev, turno: novoTurno }))
                    } catch (err) {
                      alert(err.message)
                    }
                  }}
                >
                  <option value="">— não informado —</option>
                  {Object.entries(LABEL_TURNO).map(([valor, label]) => (
                    <option key={valor} value={valor}>{label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label className="muted">Mês de referência</label>
              <select
                value={sessaoAberta.mes_referencia || ''}
                onChange={async (e) => {
                  const novoMes = Number(e.target.value)
                  await atualizarReferenciaSessao(sessaoAberta.id, novoMes, sessaoAberta.ano_referencia)
                  setSessaoAberta((prev) => ({ ...prev, mes_referencia: novoMes }))
                }}
              >
                {NOMES_MES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="muted">Ano</label>
              <select
                value={sessaoAberta.ano_referencia || ''}
                onChange={async (e) => {
                  const novoAno = Number(e.target.value)
                  await atualizarReferenciaSessao(sessaoAberta.id, sessaoAberta.mes_referencia, novoAno)
                  setSessaoAberta((prev) => ({ ...prev, ano_referencia: novoAno }))
                }}
              >
                {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        )}

        {carregandoRelatorio ? (
          <p className="muted">Carregando…</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 10 }}>
                <p className="muted" style={{ margin: 0 }}>Esperados</p>
                <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 600 }}>{totalEsperado}</p>
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 10 }}>
                <p className="muted" style={{ margin: 0 }}>Contados</p>
                <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 600, color: 'var(--success)' }}>{totalContado}</p>
              </div>
              <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 10 }}>
                <p className="muted" style={{ margin: 0 }}>Pendentes</p>
                <p style={{ margin: '2px 0 0', fontSize: 18, fontWeight: 600, color: 'var(--warning)' }}>{totalPendente}</p>
              </div>
            </div>

            <button onClick={exportarExcel} style={{ width: '100%', marginBottom: 14 }}>Exportar Excel</button>

            <p className="muted" style={{ marginBottom: 6 }}>
              Itens contados <span style={{ fontSize: 11 }}>· clique na quantidade para corrigir</span>
            </p>
            <input
              type="text"
              value={buscaItem}
              onChange={(e) => setBuscaItem(e.target.value)}
              placeholder="Buscar item pelo nome…"
              style={{ width: '100%', marginBottom: 10 }}
            />
            <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 16 }}>
              {linhasContadasFiltradas.length === 0 && (
                <p className="muted" style={{ padding: '8px 0' }}>Nenhum item encontrado pra "{buscaItem}".</p>
              )}
              {linhasContadasFiltradas.map((l, i) => (
                <div key={i} className="list-item">
                  <div>
                    <p style={{ margin: 0 }}>{l.nome}</p>
                    <p className="muted" style={{ margin: 0 }}>
                      Everest {l.codigo_everest || '—'}
                      {/* 17/08/2026: quem lançou + quando (migration_v10.sql) — só aparece pra itens já
                          gravados depois da migração; contagens antigas mostram só o código Everest. */}
                      {/* 28/08/2026: motivo da perda (migration_v13.sql). Só existe em sessão tipo
                          'perdas'; em contagem/inventário vem nulo e nada muda. */}
                      {l.motivo_perda && ` · ${LABEL_MOTIVO_PERDA[l.motivo_perda] || l.motivo_perda}`}
                      {l.modo_perda === 'prato' && ' · prato inteiro'}
                      {l.usuario && ` · ${l.usuario}`}
                      {l.registrado_em && ` · ${new Date(l.registrado_em).toLocaleString('pt-BR')}`}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {l.quantidade !== null && (
                      <span style={{ fontSize: 13 }}>{l.quantidade} {l.unidade_medida}</span>
                    )}
                    <span className="badge" style={{
                      background: l.status === 'contado' ? 'rgba(48,209,88,0.16)' : l.status === 'pendente' ? 'rgba(255,159,10,0.16)' : 'rgba(10,132,255,0.16)',
                      color: l.status === 'contado' ? 'var(--success)' : l.status === 'pendente' ? 'var(--warning)' : '#6cb2ff'
                    }}>
                      {LABEL_STATUS[l.status]}
                    </span>
                    {l.id && (
                      <button onClick={() => abrirEdicaoItem(l)} style={{ padding: '4px 9px', fontSize: 12 }}>
                        Editar
                      </button>
                    )}
                    <button
                      onClick={() => { setSaidaItem(l); setSaidaQtd(''); setSaidaMotivo('') }}
                      style={{ padding: '4px 9px', fontSize: 12 }}
                    >
                      Saída
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {saidas.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p className="muted" style={{ marginBottom: 6 }}>Saídas registradas <span style={{ opacity: 0.7 }}>(descontam do estoque no export)</span></p>
                {saidas.map((s) => (
                  <div key={s.id} className="list-item">
                    <div>
                      <p style={{ margin: 0 }}>{s.produtos?.nome}</p>
                      {s.motivo && <p className="muted" style={{ margin: 0 }}>{s.motivo}</p>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--danger)' }}>− {s.quantidade} {s.produtos?.unidade_medida}</span>
                      <button onClick={() => excluirSaida(s.id)} style={{ color: 'var(--danger)', background: 'none', border: 'none', fontSize: 16 }} aria-label="Remover saída">×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {saidaItem && (
              <div onClick={() => !salvandoSaida && setSaidaItem(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
                <div className="card" style={{ maxWidth: 360, width: '100%' }} onClick={(e) => e.stopPropagation()}>
                  <p style={{ marginTop: 0, fontWeight: 600 }}>Registrar saída</p>
                  <p className="muted" style={{ marginTop: 0 }}>{saidaItem.nome} — contado {saidaItem.quantidade} {saidaItem.unidade_medida}. A contagem não muda; a saída desconta o estoque efetivo.</p>
                  <label className="muted">Quantidade que saiu ({saidaItem.unidade_medida})</label>
                  <input type="text" inputMode="decimal" value={saidaQtd} onChange={(e) => setSaidaQtd(e.target.value)} placeholder="0,000" style={{ width: '100%' }} />
                  <label className="muted" style={{ marginTop: 8, display: 'block' }}>Motivo (opcional)</label>
                  <input type="text" value={saidaMotivo} onChange={(e) => setSaidaMotivo(e.target.value)} placeholder="ex.: usado na produção" style={{ width: '100%' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button onClick={() => setSaidaItem(null)} disabled={salvandoSaida} style={{ flex: 1 }}>Cancelar</button>
                    <button className="primary" onClick={confirmarSaida} disabled={salvandoSaida} style={{ flex: 1 }}>{salvandoSaida ? 'Salvando…' : 'Registrar saída'}</button>
                  </div>
                </div>
              </div>
            )}

            {itemEditando && (
              <div onClick={() => !salvandoEdicaoItem && setItemEditando(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
                <div className="card" style={{ maxWidth: 380, width: '100%' }} onClick={(e) => e.stopPropagation()}>
                  <p style={{ marginTop: 0, fontWeight: 600 }}>Editar lançamento</p>
                  <p className="muted" style={{ marginTop: 0 }}>{itemEditando.nome}</p>

                  <div className="segmented" style={{ marginBottom: 14 }}>
                    <button onClick={() => setAbaEdicaoItem('quantidade')} className={abaEdicaoItem === 'quantidade' ? 'active' : ''}>Quantidade</button>
                    <button onClick={() => setAbaEdicaoItem('produto')} className={abaEdicaoItem === 'produto' ? 'active' : ''}>Produto</button>
                    <button onClick={() => setAbaEdicaoItem('excluir')} className={abaEdicaoItem === 'excluir' ? 'active' : ''} style={{ color: 'var(--danger)' }}>Excluir</button>
                  </div>

                  {erroEdicaoItem && <p style={{ margin: '0 0 10px', color: 'var(--danger)', fontSize: 12 }}>{erroEdicaoItem}</p>}

                  {abaEdicaoItem === 'quantidade' && (
                    <>
                      <label className="muted">Quantidade ({itemEditando.unidade_medida})</label>
                      <input
                        type="text" inputMode="decimal" autoFocus
                        value={qtdEdicaoItem} onChange={(e) => setQtdEdicaoItem(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') salvarQuantidade() }}
                        style={{ width: '100%' }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                        <button onClick={() => setItemEditando(null)} disabled={salvandoEdicaoItem} style={{ flex: 1 }}>Cancelar</button>
                        <button className="primary" onClick={salvarQuantidade} disabled={salvandoEdicaoItem} style={{ flex: 1 }}>
                          {salvandoEdicaoItem ? 'Salvando…' : 'Salvar'}
                        </button>
                      </div>
                    </>
                  )}

                  {abaEdicaoItem === 'produto' && (
                    <>
                      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>Isso troca pra qual produto esse lançamento conta — pra quando contou no item errado por engano.</p>
                      <label className="muted">Buscar produto certo</label>
                      <input
                        type="text" autoFocus placeholder="Nome ou código Everest…"
                        value={termoTrocaProduto} onChange={(e) => setTermoTrocaProduto(e.target.value)}
                        style={{ width: '100%' }}
                      />
                      {resultadosTrocaProduto.length > 0 && (
                        <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto' }}>
                          {resultadosTrocaProduto.map((p) => (
                            <div
                              key={p.id} className="list-item" style={{ cursor: salvandoEdicaoItem ? 'default' : 'pointer', padding: '8px 10px' }}
                              onClick={() => !salvandoEdicaoItem && salvarTrocaProduto(p)}
                            >
                              <span>{p.nome}</span>
                              <span className="muted">Everest {p.codigo_everest || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', marginTop: 14 }}>
                        <button onClick={() => setItemEditando(null)} disabled={salvandoEdicaoItem} style={{ flex: 1 }}>Cancelar</button>
                      </div>
                    </>
                  )}

                  {abaEdicaoItem === 'excluir' && (
                    <>
                      <p style={{ marginTop: 0, fontSize: 13 }}>Apagar só esse lançamento? Não apaga o resto da contagem, e não dá pra desfazer.</p>
                      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                        <button onClick={() => setItemEditando(null)} disabled={salvandoEdicaoItem} style={{ flex: 1 }}>Cancelar</button>
                        <button onClick={confirmarExclusaoItem} disabled={salvandoEdicaoItem} style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}>
                          {salvandoEdicaoItem ? 'Apagando…' : 'Confirmar exclusão'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {!sessaoAberta._merged && sessaoAberta.status === 'finalizada' && (
              <button
                onClick={async () => { await reabrirSessao(sessaoAberta.id); setSessaoAberta((prev) => ({ ...prev, status: 'em_andamento' })) }}
                style={{ width: '100%', marginBottom: 10 }}
              >
                Reabrir essa contagem (deixa continuar lançando)
              </button>
            )}

            {/* 09/09/2026, pedido do Felipe: caminho inverso do "Reabrir" acima — pra sessão
                travada em 'em andamento' (esqueceram de finalizar, celular trocado, ninguém vai
                voltar nela). Sem isso ela ficava contando pra sempre nos relatórios de CMV Semanal
                e Consolidado (§ investigação do filet mignon, 09/09) até alguém excluir os dados
                inteiros — o que jogaria fora a contagem física de verdade que já foi feita. */}
            {!sessaoAberta._merged && sessaoAberta.status === 'em_andamento' && (
              <button
                onClick={async () => { await finalizarSessaoAdmin(sessaoAberta.id); setSessaoAberta((prev) => ({ ...prev, status: 'finalizada' })) }}
                style={{ width: '100%', marginBottom: 10 }}
              >
                Finalizar essa contagem (estava travada em andamento)
              </button>
            )}

            {/* Apagar sessão inteira não existe em modo combinado de propósito — "qual das N
                sessões?" é ambíguo demais pra um botão só. Abra a sessão específica pra apagar. */}
            {!sessaoAberta._merged && (confirmandoExcluir ? (
              <div style={{ background: 'rgba(255,107,107,0.1)', borderRadius: 10, padding: 12 }}>
                <p style={{ margin: '0 0 10px', fontSize: 13 }}>Apagar essa contagem inteira? Não dá pra desfazer.</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setConfirmandoExcluir(false)} style={{ flex: 1 }}>Cancelar</button>
                  <button onClick={handleExcluir} disabled={excluindo} style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}>
                    {excluindo ? 'Apagando…' : 'Confirmar exclusão'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmandoExcluir(true)} style={{ width: '100%', color: 'var(--danger)' }}>
                Apagar essa contagem
              </button>
            ))}
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {mostrarExportEverest && (
      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Exportar inventário mensal (formato Everest)</p>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Junta todas as lojas do mês (uma aba por loja) no formato que o Everest espera.
        </p>
        <div style={{ marginBottom: 14 }}>
          <label className="muted" style={{ display: 'block', marginBottom: 6 }}>Empresas a incluir (o que o Everest aceita)</label>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={empresasSelecionadas.has('Dalva')} onChange={() => toggleEmpresa('Dalva')} style={{ width: 'auto' }} />
              Dalva <span className="muted">(Dalva e Dito, Mercadinho, RESID Bar, Eventos)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={empresasSelecionadas.has('DOM')} onChange={() => toggleEmpresa('DOM')} style={{ width: 'auto' }} />
              DOM
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
          <div style={{ flex: 2, minWidth: 140 }}>
            <label className="muted">Mês</label>
            <select value={mesExport} onChange={(e) => handleMudarMes(Number(e.target.value))}>
              {['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label className="muted">Ano</label>
            <select value={anoExport} onChange={(e) => handleMudarAno(Number(e.target.value))}>
              {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <button onClick={handleConferir} disabled={carregandoResumo} style={{ height: 44 }}>
            {carregandoResumo ? 'Conferindo…' : 'Conferir antes de exportar'}
          </button>
        </div>

        {resumoExport && (
          <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <p style={{ margin: '0 0 8px', fontWeight: 500 }}>O que vai entrar nesse export:</p>
            {resumoExport.sessoes.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nenhuma contagem mensal finalizada nesse mês/ano.</p>
            ) : (
              resumoExport.sessoes.map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                  <span>{s.loja}</span>
                  <span className="muted">{s.itens} item(ns) contado(s)</span>
                </div>
              ))
            )}
            <div style={{ borderTop: '0.5px solid var(--border)', marginTop: 8, paddingTop: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={incluirHistorico}
                  onChange={(e) => setIncluirHistorico(e.target.checked)}
                  disabled={resumoExport.totalHistorico === 0}
                  style={{ width: 'auto' }}
                />
                Incluir histórico antigo desse mês ({resumoExport.totalHistorico} linha{resumoExport.totalHistorico === 1 ? '' : 's'} encontrada{resumoExport.totalHistorico === 1 ? '' : 's'})
              </label>
              {resumoExport.totalHistorico > 0 && (
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                  Isso é dado da planilha antiga (de antes do app), não é o que foi contado agora — só marca se quiser mesmo juntar os dois.
                </p>
              )}
            </div>
          </div>
        )}

        <button
          className="primary"
          onClick={handleExportarMes}
          disabled={exportando || !resumoExport || resumoExport.sessoes.length === 0 || empresasSelecionadas.size === 0}
          style={{ width: '100%' }}
        >
          {exportando ? 'Gerando…' : 'Confirmar e exportar'}
        </button>
      </div>
      )}

      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Sessões de contagem</p>
        {carregando ? (
          <p className="muted">Carregando…</p>
        ) : sessoes.length === 0 ? (
          <p className="muted">Nenhuma sessão registrada ainda.</p>
        ) : sessoesAgrupadas ? (
          sessoesAgrupadas.map((grupo) => (
            <div key={`${grupo.ano}-${grupo.mes}`} style={{ marginBottom: 22 }}>
              <p style={{
                margin: '0 0 10px',
                fontWeight: 700,
                fontSize: 13,
                display: 'inline-block',
                padding: '4px 10px',
                borderRadius: 6,
                background: 'var(--surface-2)'
              }}>
                {grupo.mes ? NOMES_MES[grupo.mes - 1] : '—'}/{grupo.ano || '—'}
              </p>
              {grupo.porLoja.map(([loja, porUsuario]) => (
                <div key={loja} style={{ marginBottom: 12, paddingLeft: 10, borderLeft: '2px solid var(--border)' }}>
                  <p className="muted" style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{loja}</p>
                  {porUsuario.map(([usuario, sessoesDoUsuario]) => (
                    <div key={usuario} style={{ marginBottom: 8, paddingLeft: 10 }}>
                      {porUsuario.length > 1 && <p className="muted" style={{ margin: '0 0 2px', fontSize: 11 }}>{usuario}</p>}
                      {sessoesDoUsuario.length > 1 ? (
                        // Mais de uma sessão da mesma pessoa, na mesma loja/mês — pedido do Felipe:
                        // abre tudo junto numa visão só (ver `abrirGrupoUsuario`), em vez de um
                        // cartão por sessão fragmentada.
                        <div
                          className="list-item"
                          style={{ cursor: 'pointer' }}
                          onClick={() => abrirGrupoUsuario(sessoesDoUsuario, { usuario, unidades: sessoesDoUsuario[0].unidades, mes: grupo.mes, ano: grupo.ano })}
                        >
                          <div>
                            <p style={{ margin: 0 }}>{usuario}</p>
                            <p className="muted" style={{ margin: 0 }}>
                              {sessoesDoUsuario.length} contagens · {sessoesDoUsuario.every((s) => s.status === 'finalizada') ? 'todas finalizadas' : 'alguma em andamento'}
                            </p>
                          </div>
                          <span className="badge" style={{ background: 'rgba(10,132,255,0.16)', color: '#6cb2ff' }}>Ver junto</span>
                        </div>
                      ) : (
                        <div>
                          {sessoesDoUsuario.map((s) => <ItemSessao key={s.id} s={s} onAbrir={abrirSessao} dataDaSessao={dataDaSessao} />)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))
        ) : sessoesAgrupadasSemanal ? (
          sessoesAgrupadasSemanal.map((grupo) => (
            <div key={grupo.nomeGrupo} style={{ marginBottom: 22 }}>
              <p style={{
                margin: '0 0 10px',
                fontWeight: 700,
                fontSize: 13,
                display: 'inline-block',
                padding: '4px 10px',
                borderRadius: 6,
                background: 'var(--surface-2)'
              }}>
                {grupo.nomeGrupo}
              </p>
              {grupo.porData.map(([dataChave, sessoesDaData]) => (
                <div key={dataChave} style={{ marginBottom: 12, paddingLeft: 10, borderLeft: '2px solid var(--border)' }}>
                  <p className="muted" style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    {dataChave === '—' ? '—' : new Date(dataChave + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </p>
                  <div>
                    {sessoesDaData.map((s) => <ItemSessao key={s.id} s={s} onAbrir={abrirSessao} dataDaSessao={dataDaSessao} />)}
                  </div>
                </div>
              ))}
            </div>
          ))
        ) : (
          sessoes.map((s) => <ItemSessao key={s.id} s={s} onAbrir={abrirSessao} dataDaSessao={dataDaSessao} />)
        )}
      </div>
    </div>
  )
}
