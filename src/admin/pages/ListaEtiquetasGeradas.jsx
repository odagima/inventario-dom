import { useEffect, useRef, useState } from 'react'
import { buscarEtiquetasGeradas } from '../lib/adminApi'

export default function ListaEtiquetasGeradas({ onSelecionar }) {
  const [termo, setTermo] = useState('')
  const [produtos, setProdutos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setCarregando(true)
      try {
        setProdutos(await buscarEtiquetasGeradas(termo))
      } finally {
        setCarregando(false)
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [termo])

  return (
    <div className="card">
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Etiquetas geradas</p>
      <p className="muted" style={{ margin: '0 0 14px' }}>Histórico de códigos internos já gerados — clique num item pra ver de novo ou reimprimir.</p>

      <input placeholder="Buscar por nome ou código" value={termo} onChange={(e) => setTermo(e.target.value)} style={{ marginBottom: 12 }} />

      {carregando ? (
        <p className="muted">Buscando…</p>
      ) : produtos.length === 0 ? (
        <p className="muted">Nenhuma etiqueta gerada ainda. Gere uma pela aba Consultar.</p>
      ) : (
        <div style={{ maxHeight: 440, overflowY: 'auto' }}>
          {produtos.map((p) => (
            <div key={p.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => onSelecionar(p)}>
              <div>
                <p style={{ margin: 0 }}>{p.nome}</p>
                <p className="muted" style={{ margin: 0 }}>Everest {p.codigo_everest || '—'} · {p.unidade_medida}</p>
              </div>
              <span className="muted">›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
