import { useEffect, useRef, useState } from 'react'
import { buscarBaseProdutos, contarProdutos } from '../lib/adminApi'

export default function BaseProdutos() {
  const [termo, setTermo] = useState('')
  const [linhas, setLinhas] = useState([])
  const [pagina, setPagina] = useState(0)
  const [temMais, setTemMais] = useState(true)
  const [total, setTotal] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => { contarProdutos().then(setTotal).catch(() => {}) }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setCarregando(true)
      try {
        const resultado = await buscarBaseProdutos(termo, 0)
        setLinhas(resultado)
        setPagina(0)
        setTemMais(resultado.length === 100)
      } finally {
        setCarregando(false)
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [termo])

  async function handleCarregarMais() {
    setCarregandoMais(true)
    try {
      const proximaPagina = pagina + 1
      const resultado = await buscarBaseProdutos(termo, proximaPagina)
      setLinhas((prev) => [...prev, ...resultado])
      setPagina(proximaPagina)
      setTemMais(resultado.length === 100)
    } finally {
      setCarregandoMais(false)
    }
  }

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Base de produtos</p>
        {total !== null && <span className="muted">{total} cadastrados</span>}
      </div>
      <input placeholder="Buscar por nome" value={termo} onChange={(e) => setTermo(e.target.value)} style={{ marginBottom: 12 }} />

      {carregando ? (
        <p className="muted">Carregando…</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 780 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                {['Código', 'Nome', 'Grupo', 'Subgrupo', 'UM', 'Código de barras', 'Venda', 'Ativo'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((p) => (
                <tr key={p.id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{p.codigo_everest || '—'}</td>
                  <td style={{ padding: '8px' }}>{p.nome}</td>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{p.grupo_everest || '—'}</td>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{p.subgrupo_everest || '—'}</td>
                  <td style={{ padding: '8px' }}>{p.unidade_medida}</td>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{p.barcodes?.length ? p.barcodes.map((b) => b.codigo_barras).join(', ') : '—'}</td>
                  <td style={{ padding: '8px' }}>{p.venda === true ? 'Sim' : p.venda === false ? 'Não' : '—'}</td>
                  <td style={{ padding: '8px' }}>{p.ativo ? 'Ativo' : 'Inativo'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {temMais && (
            <button onClick={handleCarregarMais} disabled={carregandoMais} style={{ width: '100%', marginTop: 12 }}>
              {carregandoMais ? 'Carregando…' : `Carregar mais (${linhas.length} de ${total ?? '...'})`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
