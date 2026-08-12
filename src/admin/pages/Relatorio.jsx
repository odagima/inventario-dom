import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { listarSessoes, buscarRelatorioSessao, atualizarReferenciaSessao, atualizarDataReferenciaSessao, atualizarUnidadeSessao, apagarSessao, reabrirSessao, listarUnidadesAdmin, buscarDadosParaExportEverest, buscarResumoParaExportEverest } from '../lib/adminApi'
import { registrarSaidaContagem, listarSaidasDaSessao, removerSaidaContagem } from '../../lib/api'

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
          {LABEL_TIPO[s.tipo] || s.tipo} · {dataDaSessao(s)} · {s.usuario}
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

  // Agrupa "Sessões de contagem" por mês/ano de referência e depois por loja — só pra
  // Inventário (tipoFiltro = 'mensal'). Contagem Semanal usa outro agrupamento (ver abaixo),
  // já que ela não separa mais por loja (Compras não separa por loja no Everest) — quem
  // escopa é o Grupo de contagem.
  const sessoesAgrupadas = useMemo(() => {
    if (tipoFiltro !== 'mensal') return null
    const porMes = new Map()
    for (const s of sessoes) {
      const { mes, ano } = mesAnoDaSessao(s)
      const chave = `${ano}-${String(mes).padStart(2, '0')}`
      if (!porMes.has(chave)) porMes.set(chave, { ano, mes, porLoja: new Map() })
      const grupo = porMes.get(chave)
      const loja = s.unidades?.nome || '—'
      if (!grupo.porLoja.has(loja)) grupo.porLoja.set(loja, [])
      grupo.porLoja.get(loja).push(s)
    }
    return Array.from(porMes.values())
      .sort((a, b) => (b.ano - a.ano) || (b.mes - a.mes))
      .map((g) => ({ ...g, porLoja: Array.from(g.porLoja.entries()).sort((a, b) => a[0].localeCompare(b[0])) }))
  }, [sessoes, tipoFiltro])

  function dataDaSessaoChave(s) {
    return s.data_referencia || (s.iniciada_em ? String(s.iniciada_em).slice(0, 10) : null)
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

  function dataDaSessao(s) {
    return s.data_referencia ? new Date(s.data_referencia + 'T00:00:00').toLocaleDateString('pt-BR') : new Date(s.iniciada_em).toLocaleDateString('pt-BR')
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

  async function abrirSessao(sessao) {
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

  async function confirmarSaida() {
    const qtd = Number(String(saidaQtd).replace(',', '.'))
    if (!saidaItem || !isFinite(qtd) || qtd <= 0) return
    setSalvandoSaida(true)
    try {
      await registrarSaidaContagem({ sessaoId: sessaoAberta.id, produtoId: saidaItem.produto_id, quantidade: qtd, motivo: saidaMotivo, usuario: 'admin' })
      setSaidas(await listarSaidasDaSessao(sessaoAberta.id))
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
      setSaidas(await listarSaidasDaSessao(sessaoAberta.id))
    } catch (e) {
      alert('Não consegui remover a saída: ' + e.message)
    }
  }

  function exportarExcel() {
    const planilha = XLSX.utils.json_to_sheet(
      linhas
        .filter((l) => l.status === 'contado' || l.status === 'extra')
        .map((l) => ({
        Produto: l.nome,
        'Código Everest': l.codigo_everest || '',
        Unidade: l.unidade_medida,
        Quantidade: l.quantidade ?? '',
        Status: LABEL_STATUS[l.status]
      }))
    )
    const livro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(livro, planilha, 'Contagem')
    const dataArquivo = new Date(sessaoAberta.iniciada_em).toISOString().slice(0, 10)
    XLSX.writeFile(livro, `contagem-${sessaoAberta.unidades?.nome || 'unidade'}-${dataArquivo}.xlsx`)
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
          {LABEL_TIPO[sessaoAberta.tipo] || sessaoAberta.tipo} · {dataDaSessao(sessaoAberta)} · {sessaoAberta.usuario}
        </p>

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
            {sessaoAberta.tipo === 'semanal' && (
              <div style={{ flex: 1 }}>
                <label className="muted">Data da contagem</label>
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

            <p className="muted" style={{ marginBottom: 6 }}>Itens contados</p>
            <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 16 }}>
              {linhas.filter((l) => l.status === 'contado' || l.status === 'extra').map((l, i) => (
                <div key={i} className="list-item">
                  <div>
                    <p style={{ margin: 0 }}>{l.nome}</p>
                    <p className="muted" style={{ margin: 0 }}>Everest {l.codigo_everest || '—'}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {l.quantidade !== null && <span>{l.quantidade} {l.unidade_medida}</span>}
                    <span className="badge" style={{
                      background: l.status === 'contado' ? 'rgba(48,209,88,0.16)' : l.status === 'pendente' ? 'rgba(255,159,10,0.16)' : 'rgba(10,132,255,0.16)',
                      color: l.status === 'contado' ? 'var(--success)' : l.status === 'pendente' ? 'var(--warning)' : '#6cb2ff'
                    }}>
                      {LABEL_STATUS[l.status]}
                    </span>
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

            {sessaoAberta.status === 'finalizada' && (
              <button
                onClick={async () => { await reabrirSessao(sessaoAberta.id); setSessaoAberta((prev) => ({ ...prev, status: 'em_andamento' })) }}
                style={{ width: '100%', marginBottom: 10 }}
              >
                Reabrir essa contagem (deixa continuar lançando)
              </button>
            )}

            {confirmandoExcluir ? (
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
            )}
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
              {grupo.porLoja.map(([loja, sessoesDaLoja]) => (
                <div key={loja} style={{ marginBottom: 12, paddingLeft: 10, borderLeft: '2px solid var(--border)' }}>
                  <p className="muted" style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{loja}</p>
                  <div>
                    {sessoesDaLoja.map((s) => <ItemSessao key={s.id} s={s} onAbrir={abrirSessao} dataDaSessao={dataDaSessao} />)}
                  </div>
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
