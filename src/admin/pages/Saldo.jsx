import { useEffect, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { buscarProdutosAdmin, listarGruposAdmin, listarGruposEverest, buscarSaldoItem, buscarSaldoGrupo, buscarSaldoPorGrupoEverest } from '../lib/adminApi'

function formatarData(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function Saldo() {
  const [modo, setModo] = useState('item') // 'item' | 'grupo' | 'grupoEverest'

  const [termo, setTermo] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState([])
  const [produtoSelecionado, setProdutoSelecionado] = useState(null)
  const [serieItem, setSerieItem] = useState([])
  const debounceRef = useRef(null)

  const [grupos, setGrupos] = useState([])
  const [grupoId, setGrupoId] = useState('')
  const [saldoGrupo, setSaldoGrupo] = useState([])

  const [gruposEverest, setGruposEverest] = useState([])
  const [grupoEverestSelecionado, setGrupoEverestSelecionado] = useState('')

  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    if (modo === 'grupo') listarGruposAdmin().then(setGrupos)
    if (modo === 'grupoEverest') listarGruposEverest().then(setGruposEverest)
  }, [modo])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (termo.trim().length < 2) { setResultadosBusca([]); return }
    debounceRef.current = setTimeout(async () => {
      setResultadosBusca(await buscarProdutosAdmin(termo))
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [termo])

  async function handleSelecionarProduto(produto) {
    setProdutoSelecionado(produto)
    setTermo('')
    setResultadosBusca([])
    setCarregando(true)
    try {
      setSerieItem(await buscarSaldoItem(produto.id))
    } finally {
      setCarregando(false)
    }
  }

  async function handleSelecionarGrupo(id) {
    setGrupoId(id)
    if (!id) return
    setCarregando(true)
    try {
      setSaldoGrupo(await buscarSaldoGrupo(id))
    } finally {
      setCarregando(false)
    }
  }

  async function handleSelecionarGrupoEverest(nome) {
    setGrupoEverestSelecionado(nome)
    if (!nome) return
    setCarregando(true)
    try {
      setSaldoGrupo(await buscarSaldoPorGrupoEverest(nome))
    } finally {
      setCarregando(false)
    }
  }

  const dadosGrafico = serieItem.map((s) => ({ data: formatarData(s.data), quantidade: s.quantidade }))
  const datasDoGrupo = [...new Set(saldoGrupo.flatMap((r) => r.serie.map((s) => s.data)))].sort((a, b) => new Date(a) - new Date(b))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="segmented" style={{ marginBottom: 16 }}>
          <button className={modo === 'item' ? 'active' : ''} onClick={() => setModo('item')}>Por item</button>
          <button className={modo === 'grupo' ? 'active' : ''} onClick={() => setModo('grupo')}>Grupo de contagem</button>
          <button className={modo === 'grupoEverest' ? 'active' : ''} onClick={() => setModo('grupoEverest')}>Grupo Everest</button>
        </div>

        {modo === 'item' && (
          <div style={{ position: 'relative' }}>
            <label className="muted">Busca por nome ou código Everest (funciona pros dois)</label>
            <input placeholder="Ex: 2000263 ou Arroz tipo 1" value={termo} onChange={(e) => setTermo(e.target.value)} style={{ marginTop: 4 }} />
            {resultadosBusca.length > 0 && (
              <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, padding: 0, zIndex: 5, maxHeight: 240, overflowY: 'auto' }}>
                {resultadosBusca.map((p) => (
                  <div key={p.id} className="list-item" style={{ cursor: 'pointer', padding: '10px 14px' }} onClick={() => handleSelecionarProduto(p)}>
                    <span>{p.nome}</span>
                    <span className="muted">Everest {p.codigo_everest || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {modo === 'grupo' && (
          <>
            <label className="muted">Grupo de contagem (semanal/diário que você criou)</label>
            <select value={grupoId} onChange={(e) => handleSelecionarGrupo(e.target.value)} style={{ marginTop: 4 }}>
              <option value="">Selecione…</option>
              {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
            </select>
          </>
        )}

        {modo === 'grupoEverest' && (
          <>
            <label className="muted">Grupo cadastrado no Everest</label>
            <select value={grupoEverestSelecionado} onChange={(e) => handleSelecionarGrupoEverest(e.target.value)} style={{ marginTop: 4 }}>
              <option value="">Selecione…</option>
              {gruposEverest.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </>
        )}
      </div>

      {carregando && <div className="card"><p className="muted">Carregando…</p></div>}

      {modo === 'item' && produtoSelecionado && !carregando && (
        <div className="card">
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>{produtoSelecionado.nome}</p>
          <p className="muted" style={{ margin: '0 0 14px' }}>Everest {produtoSelecionado.codigo_everest || '—'} · {serieItem.length} contagem(ns) registrada(s)</p>
          {serieItem.length === 0 ? (
            <p className="muted">Esse item ainda não foi contado em nenhuma sessão (nem no histórico antigo). Se você acha que deveria ter, confere na aba "Histórico antigo" se o código Everest bateu certinho na importação.</p>
          ) : (
            <>
              <div style={{ width: '100%', height: 220, marginBottom: 16 }}>
                <ResponsiveContainer>
                  <LineChart data={dadosGrafico}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="data" stroke="var(--text-secondary)" fontSize={12} />
                    <YAxis stroke="var(--text-secondary)" fontSize={12} />
                    <Tooltip contentStyle={{ background: 'var(--header-bg)', border: '0.5px solid rgba(244,241,233,0.15)', borderRadius: 8, color: 'var(--header-text)' }} />
                    <Line type="monotone" dataKey="quantidade" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {serieItem.map((s, i) => (
                <div key={i} className="list-item">
                  <span>{formatarData(s.data)} · {s.unidade} · {s.tipo}</span>
                  <span>{s.quantidade}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {(modo === 'grupo' || modo === 'grupoEverest') && saldoGrupo.length > 0 && !carregando && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <p style={{ margin: '0 0 14px', fontWeight: 600, fontSize: 15 }}>
            Saldo por item — {modo === 'grupo' ? grupos.find((g) => g.id === grupoId)?.nome : grupoEverestSelecionado}
          </p>
          {datasDoGrupo.length === 0 ? (
            <p className="muted">Nenhum item desse grupo tem contagem registrada ainda.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>Produto</th>
                  {datasDoGrupo.map((d) => (
                    <th key={d} style={{ textAlign: 'right', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {formatarData(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {saldoGrupo.filter((r) => r.serie.length > 0).map(({ produto, serie }) => {
                  const porData = new Map(serie.map((s) => [s.data, s.quantidade]))
                  return (
                    <tr key={produto.id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{produto.nome}</td>
                      {datasDoGrupo.map((d) => (
                        <td key={d} style={{ textAlign: 'right', padding: '8px' }}>{porData.get(d) ?? '—'}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
