import { useEffect, useState } from 'react'
import { buscarMargemCardapio, buscarComposicaoFicha, buscarFichasQueUsamInsumo } from '../lib/adminApi'

const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const fmtRS = (n) => n == null ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct = (n) => n == null ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'

function Seta({ tendencia }) {
  if (tendencia === 'subiu') return <span style={{ color: 'var(--danger)' }} title="CMV subiu vs média dos 3 meses anteriores">↑</span>
  if (tendencia === 'caiu') return <span style={{ color: 'var(--success)' }} title="CMV caiu vs média dos 3 meses anteriores">↓</span>
  if (tendencia === 'estavel') return <span className="muted" title="Estável vs média dos 3 meses anteriores">→</span>
  return <span className="muted" title="Sem venda desse prato nos últimos 3 meses — sem base de comparação">–</span>
}

export default function Cardapio() {
  const hoje = new Date()
  const [mes, setMes] = useState(hoje.getMonth() + 1)
  const [ano, setAno] = useState(hoje.getFullYear())
  const [dados, setDados] = useState({ linhas: [], media: null, limiteVermelho: null })
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [grupoFiltro, setGrupoFiltro] = useState('')
  const [popup, setPopup] = useState(null) // { nome, composicao }
  const [carregandoPopup, setCarregandoPopup] = useState(false)

  // "Onde é usado"
  const [insumoCodigo, setInsumoCodigo] = useState('')
  const [fichasDoInsumo, setFichasDoInsumo] = useState(null)
  const [buscandoReverso, setBuscandoReverso] = useState(false)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    buscarMargemCardapio(mes, ano)
      .then((r) => { if (vivo) setDados(r) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [mes, ano])

  const grupos = [...new Set(dados.linhas.map((l) => l.grupo).filter(Boolean))].sort()
  const termo = busca.trim().toLowerCase()
  const linhas = dados.linhas.filter((l) => {
    if (grupoFiltro && l.grupo !== grupoFiltro) return false
    if (termo && !(`${l.nome} ${l.codigo_everest}`.toLowerCase().includes(termo))) return false
    return true
  })

  async function abrirPopup(l) {
    setPopup({ nome: l.nome, custo: l.custo, venda: l.venda, cmv: l.cmv, composicao: null })
    setCarregandoPopup(true)
    try {
      // 12/08/2026: casar pelo código Everest do prato, não pelo produto_id — ver comentário em
      // `buscarComposicaoFicha` (mesma FK órfã do §29.13, ainda não corrigida aqui até agora).
      const c = await buscarComposicaoFicha(l.codigo_everest)
      setPopup((p) => p ? { ...p, composicao: c } : p)
    } finally {
      setCarregandoPopup(false)
    }
  }

  async function buscarReverso() {
    if (!insumoCodigo.trim()) return
    setBuscandoReverso(true)
    try {
      setFichasDoInsumo(await buscarFichasQueUsamInsumo(insumoCodigo.trim()))
    } finally {
      setBuscandoReverso(false)
    }
  }

  return (
    <div>
      <div className="app-header" style={{ marginBottom: 10 }}>
        <p className="brand">Cardápio · Margem</p>
        <p className="subtitle">Custo da ficha × venda real. CMV% em vermelho = muito acima da média dos pratos.</p>
      </div>

      {/* Filtros */}
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
        <div>
          <label className="muted">Mês</label>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {NOMES_MES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="muted">Ano</label>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {[ano - 1, ano, ano + 1].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="muted">Buscar prato</label>
          <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome ou código" style={{ width: '100%' }} />
        </div>
        {grupos.length > 0 && (
          <div>
            <label className="muted">Grupo</label>
            <select value={grupoFiltro} onChange={(e) => setGrupoFiltro(e.target.value)}>
              <option value="">Todos</option>
              {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        )}
      </div>

      {carregando ? (
        <p className="muted">Carregando margem…</p>
      ) : dados.linhas.length === 0 ? (
        <p className="muted">Nenhum prato com ficha e venda nesse período. Confere se as vendas do mês foram importadas.</p>
      ) : (
        <>
          {dados.media != null && (
            <p className="muted" style={{ marginBottom: 8 }}>
              CMV% médio dos pratos: <strong>{fmtPct(dados.media)}</strong> · vermelho a partir de {fmtPct(dados.limiteVermelho)} · {linhas.length} de {dados.linhas.length} pratos
            </p>
          )}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px 92px 68px 30px', columnGap: 18, fontSize: 12, fontWeight: 600, padding: '10px 14px', borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
              <span>Prato</span>
              <span style={{ textAlign: 'right' }}>Custo</span>
              <span style={{ textAlign: 'right' }}>Venda</span>
              <span style={{ textAlign: 'right' }}>CMV%</span>
              <span style={{ textAlign: 'center' }}></span>
            </div>
            {linhas.map((l) => (
              <button
                key={l.codigo_everest}
                onClick={() => abrirPopup(l)}
                style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px 92px 68px 30px', columnGap: 18, width: '100%',
                  alignItems: 'center', textAlign: 'left', background: 'none', border: 'none',
                  borderBottom: '1px solid var(--border)', padding: '11px 14px', cursor: 'pointer'
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.nome}
                  {l.codigo_everest && <span className="muted" style={{ fontSize: 11 }}> · {l.codigo_everest}</span>}
                </span>
                <span style={{ textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtRS(l.custo)}</span>
                <span style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtRS(l.venda)}</span>
                <span
                  style={{
                    textAlign: 'right', fontWeight: 700,
                    color: l.acimaMedia ? 'var(--danger)' : 'var(--text)',
                    background: l.acimaMedia ? 'rgba(179,64,42,0.1)' : 'transparent',
                    borderRadius: 8, padding: '3px 6px'
                  }}
                >
                  {fmtPct(l.cmv)}
                </span>
                <span style={{ textAlign: 'center', fontSize: 16 }}><Seta tendencia={l.tendencia} /></span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Onde é usado (reverso) */}
      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ margin: '0 0 4px', fontWeight: 600 }}>Onde é usado</p>
        <p className="muted" style={{ marginTop: 0 }}>Digite o código Everest de um insumo pra ver as fichas que o usam.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text" value={insumoCodigo} onChange={(e) => setInsumoCodigo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && buscarReverso()}
            placeholder="código do insumo (ex.: 2001234)" style={{ flex: 1 }}
          />
          <button className="primary" onClick={buscarReverso} disabled={buscandoReverso}>{buscandoReverso ? '…' : 'Buscar'}</button>
        </div>
        {fichasDoInsumo != null && (
          fichasDoInsumo.length === 0
            ? <p className="muted" style={{ marginTop: 10 }}>Nenhuma ficha usa esse código.</p>
            : (
              <div style={{ marginTop: 10 }}>
                {fichasDoInsumo.map((f, i) => (
                  <div key={i} className="list-item">
                    <span>{f.ficha_nome}{f.ficha_codigo && <span className="muted" style={{ fontSize: 11 }}> · {f.ficha_codigo}</span>}</span>
                    <span className="muted">{f.quantidade} {f.unidade}</span>
                  </div>
                ))}
              </div>
            )
        )}
      </div>

      {/* Popup composição */}
      {popup && (
        <div onClick={() => setPopup(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div className="card" style={{ maxWidth: 460, width: '100%', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>{popup.nome}</p>
              <button onClick={() => setPopup(null)} style={{ background: 'none', border: 'none', fontSize: 18 }}>×</button>
            </div>
            <p className="muted" style={{ margin: '4px 0 12px' }}>
              Custo {fmtRS(popup.custo)} · Venda {fmtRS(popup.venda)} · CMV {fmtPct(popup.cmv)}
            </p>
            <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 13 }}>Composição da ficha</p>
            {carregandoPopup ? (
              <p className="muted">Carregando composição…</p>
            ) : !popup.composicao?.ficha ? (
              <p className="muted">Sem ficha técnica cadastrada pra esse prato.</p>
            ) : popup.composicao.ingredientes.length === 0 ? (
              <p className="muted">Ficha sem ingredientes.</p>
            ) : (
              <div>
                {popup.composicao.ingredientes.map((ing, i) => (
                  <div key={i} className="list-item">
                    <div>
                      <p style={{ margin: 0 }}>{ing.nome}</p>
                      <p className="muted" style={{ margin: 0, fontSize: 11 }}>{ing.quantidade} {ing.unidade_medida} · {fmtRS(ing.custo_unitario)}/{ing.unidade_medida}</p>
                    </div>
                    <span style={{ whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtRS(ing.custo_linha)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
