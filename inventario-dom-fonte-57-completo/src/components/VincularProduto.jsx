import { useEffect, useRef, useState } from 'react'
import { buscarProdutosPorNome, vincularBarcodeExistente } from '../lib/api'

export default function VincularProduto({ codigoBarras, onVinculado, onCadastrarNovo, onCancelar }) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [vinculando, setVinculando] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (termo.trim().length < 2) {
      setResultados([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setBuscando(true)
      try {
        setResultados(await buscarProdutosPorNome(termo))
      } finally {
        setBuscando(false)
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [termo])

  async function handleSelecionar(produto) {
    setVinculando(true)
    try {
      await vincularBarcodeExistente(produto.id, codigoBarras)
      onVinculado(produto)
    } finally {
      setVinculando(false)
    }
  }

  return (
    <div className="card">
      <p style={{ margin: 0, fontWeight: 600 }}>Código não reconhecido</p>
      <p className="muted" style={{ margin: '2px 0 16px' }}>{codigoBarras}</p>

      <label className="muted">Qual produto do Everest é esse?</label>
      <input
        autoFocus
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Digite o nome do produto"
        style={{ margin: '4px 0 12px' }}
        type="search"
        name="busca-produto-vincular"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
      />

      {buscando && <p className="muted">Buscando…</p>}

      {!buscando && resultados.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {resultados.map((p) => (
            <div
              key={p.id}
              onClick={() => !vinculando && handleSelecionar(p)}
              style={{ padding: '10px 0', borderBottom: '0.5px solid var(--border)', cursor: 'pointer' }}
            >
              <p style={{ margin: 0 }}>{p.nome}</p>
              <p className="muted" style={{ margin: 0 }}>Everest {p.codigo_everest || '—'} · {p.unidade_medida}</p>
            </div>
          ))}
        </div>
      )}

      {!buscando && termo.trim().length >= 2 && resultados.length === 0 && (
        <p className="muted" style={{ marginBottom: 12 }}>Nenhum produto encontrado com esse nome.</p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={onCancelar} style={{ flex: 1 }}>Cancelar</button>
        <button onClick={onCadastrarNovo} style={{ flex: 1 }}>Não encontrei, cadastrar novo</button>
      </div>
    </div>
  )
}
