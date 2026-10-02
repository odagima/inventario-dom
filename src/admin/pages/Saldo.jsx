import { useEffect, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { buscarProdutosAdmin, listarGruposEverest, buscarSaldoItem, buscarSaldoPorGrupoEverest } from '../lib/adminApi'

function formatarData(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const NOMES_MES_SALDO = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

// Pedido do Felipe (01/10/2026): esta tela é só do Inventário (mensal) agora — "Grupo de
// contagem" (semanal/diário) mudou pra aba própria dentro de Contagem semanal, ver
// `SaldoSemanal.jsx`. Também reduziu de 3 modos pra 2: Por item, e Grupo (Everest).
export default function Saldo() {
  const [modo, setModo] = useState('item') // 'item' | 'grupoEverest'

  const [termo, setTermo] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState([])
  const [produtoSelecionado, setProdutoSelecionado] = useState(null)
  const [serieItem, setSerieItem] = useState([])
  const debounceRef = useRef(null)

  const [gruposEverest, setGruposEverest] = useState([])
  const [grupoEverestSelecionado, setGrupoEverestSelecionado] = useState('')
  const [saldoGrupo, setSaldoGrupo] = useState([])

  const [mesFiltro, setMesFiltro] = useState(new Date().getMonth() + 1)
  const [anoFiltro, setAnoFiltro] = useState(new Date().getFullYear())
  const [semFiltroMes, setSemFiltroMes] = useState(false)

  const [carregando, setCarregando] = useState(false)

  function filtroInventario() {
    return { tipo: 'mensal', mes: semFiltroMes ? null : mesFiltro, ano: semFiltroMes ? null : anoFiltro }
  }

  useEffect(() => {
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
      setSerieItem(await buscarSaldoItem(produto.id, filtroInventario()))
    } finally {
      setCarregando(false)
    }
  }

  // Recarrega quando o mês/ano muda, com produto/grupo já selecionado.
  useEffect(() => {
    if (modo === 'item' && produtoSelecionado) {
      setCarregando(true)
      buscarSaldoItem(produtoSelecionado.id, filtroInventario()).then(setSerieItem).finally(() => setCarregando(false))
    }
    if (modo === 'grupoEverest' && grupoEverestSelecionado) {
      setCarregando(true)
      buscarSaldoPorGrupoEverest(grupoEverestSelecionado, filtroInventario()).then(setSaldoGrupo).finally(() => setCarregando(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesFiltro, anoFiltro, semFiltroMes])

  async function handleSelecionarGrupoEverest(nome) {
    setGrupoEverestSelecionado(nome)
    if (!nome) return
    setCarregando(true)
    try {
      setSaldoGrupo(await buscarSaldoPorGrupoEverest(nome, filtroInventario()))
    } finally {
      setCarregando(false)
    }
  }

  const dadosGrafico = serieItem.map((s) => ({ data: formatarData(s.data), quantidade: s.quantidade }))
  // Colunas são as LOJAS que de fato contaram esse grupo nesse mês — não datas (ver
  // `buscarSaldoPorGrupoEverest`: antes a coluna era a data exata, e duas lojas contando perto
  // uma da outra pareciam "o mesmo dia duplicado", sem nenhum rótulo dizendo de qual loja era).
  const lojasDoGrupo = [...new Set(saldoGrupo.flatMap((r) => [...r.porLoja.keys()]))].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="segmented" style={{ marginBottom: 16 }}>
          <button className={modo === 'item' ? 'active' : ''} onClick={() => setModo('item')}>Por item</button>
          <button className={modo === 'grupoEverest' ? 'active' : ''} onClick={() => setModo('grupoEverest')}>Grupo</button>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ flex: 2, minWidth: 140 }}>
            <label className="muted">Mês</label>
            <select value={mesFiltro} onChange={(e) => setMesFiltro(Number(e.target.value))} disabled={semFiltroMes}>
              {NOMES_MES_SALDO.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label className="muted">Ano</label>
            <select value={anoFiltro} onChange={(e) => setAnoFiltro(Number(e.target.value))} disabled={semFiltroMes}>
              {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 10 }}>
            <input type="checkbox" checked={semFiltroMes} onChange={(e) => setSemFiltroMes(e.target.checked)} style={{ width: 'auto' }} />
            Todos os meses
          </label>
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
            <p className="muted">Esse item ainda não foi contado em nenhuma sessão (nem no histórico antigo) nesse filtro. Se você acha que deveria ter, confere o mês/ano escolhido, ou marque "Todos os meses".</p>
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

      {modo === 'grupoEverest' && grupoEverestSelecionado && !carregando && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <p style={{ margin: '0 0 14px', fontWeight: 600, fontSize: 15 }}>
            Saldo por item — {grupoEverestSelecionado}
          </p>
          {saldoGrupo.length === 0 ? (
            <p className="muted">Nenhum item desse grupo foi contado nesse filtro ainda. Confere o mês/ano, ou marque "Todos os meses".</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>Produto</th>
                  {lojasDoGrupo.map((loja) => (
                    <th key={loja} style={{ textAlign: 'right', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {loja}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {saldoGrupo.map(({ produto, porLoja }) => (
                  <tr key={produto.id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{produto.nome}</td>
                    {lojasDoGrupo.map((loja) => (
                      <td key={loja} style={{ textAlign: 'right', padding: '8px' }}>{porLoja.get(loja) ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
