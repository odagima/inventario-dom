import { useEffect, useRef, useState } from 'react'
import { buscarBaseHistorico, contarBaseHistorico } from '../lib/adminApi'

export default function BaseHistorico() {
  const [termo, setTermo] = useState('')
  const [linhas, setLinhas] = useState([])
  const [pagina, setPagina] = useState(0)
  const [temMais, setTemMais] = useState(true)
  const [total, setTotal] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => { contarBaseHistorico().then(setTotal).catch(() => {}) }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setCarregando(true)
      try {
        const resultado = await buscarBaseHistorico(termo, 0)
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
      const resultado = await buscarBaseHistorico(termo, proximaPagina)
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
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Base do histórico antigo</p>
        {total !== null && <span className="muted">{total} linhas</span>}
      </div>
      <input placeholder="Buscar por nome do item" value={termo} onChange={(e) => setTermo(e.target.value)} style={{ marginBottom: 12 }} />

      {carregando ? (
        <p className="muted">Carregando…</p>
      ) : total === 0 ? (
        <p className="muted">Nenhuma linha importada ainda — sobe o arquivo na aba de import.</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 780 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                {['Responsável', 'Local', 'Item', 'Código Everest', 'Vinculado?', 'Qtd', 'UM', 'Data'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{l.responsavel || '—'}</td>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{l.local_original || '—'}</td>
                  <td style={{ padding: '8px' }}>{l.nome_original}</td>
                  <td style={{ padding: '8px' }}>{l.codigo_everest || '—'}</td>
                  <td style={{ padding: '8px' }}>{l.produto_id ? 'Sim' : 'Não'}</td>
                  <td style={{ padding: '8px' }}>{l.quantidade}</td>
                  <td style={{ padding: '8px' }}>{l.unidade_medida}</td>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{l.registrado_em ? new Date(l.registrado_em).toLocaleDateString('pt-BR') : '—'}</td>
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
