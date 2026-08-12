import { useEffect, useRef, useState } from 'react'
import { buscarProdutosPorNome } from '../lib/api'

export default function BuscaProduto({ onSelecionar, onAbrirCamera, mostrarCamera = true }) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (termo.trim().length < 2) {
      setResultados([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setBuscando(true)
      try {
        const lista = await buscarProdutosPorNome(termo)
        setResultados(lista)
      } finally {
        setBuscando(false)
      }
    }, 250) // debounce: evita uma query a cada tecla
    return () => clearTimeout(debounceRef.current)
  }, [termo])

  function handleSelecionar(produto) {
    setTermo('')
    setResultados([])
    onSelecionar(produto)
  }

  return (
    <div style={{ position: 'relative' }}>
      <label className="muted">Item da contagem</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <input
          ref={inputRef}
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Digite o nome do produto"
          autoFocus
          type="search"
          name="busca-produto-contagem"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        {mostrarCamera && (
          <button
            type="button"
            onClick={onAbrirCamera}
            aria-label="Escanear código de barras"
            style={{ width: 44, flexShrink: 0 }}
          >
            📷
          </button>
        )}
      </div>

      {resultados.length > 0 && (
        <div
          className="card"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 46, marginTop: 4,
            padding: 0, zIndex: 10, maxHeight: 260, overflowY: 'auto'
          }}
        >
          {resultados.map((p, i) => (
            <div
              key={p.id}
              onClick={() => handleSelecionar(p)}
              style={{
                padding: '10px 14px', cursor: 'pointer',
                borderBottom: i < resultados.length - 1 ? '1px solid var(--border)' : 'none'
              }}
            >
              <p style={{ margin: 0 }}>{p.nome}</p>
              <p className="muted" style={{ margin: 0 }}>
                Everest {p.codigo_everest || '—'} · un. {p.unidade_medida}
              </p>
            </div>
          ))}
        </div>
      )}

      {termo.trim().length >= 2 && !buscando && resultados.length === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>Nenhum produto encontrado — use a câmera ou cadastre pelo código de barras.</p>
      )}

      <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>
        {mostrarCamera ? 'Ou toque na câmera pra ler o código de barras' : ''}
      </p>
    </div>
  )
}
