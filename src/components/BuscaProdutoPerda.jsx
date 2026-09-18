import { useEffect, useRef, useState } from 'react'
import { buscarProdutosPorCategoriaPerda } from '../lib/api'

// Busca usada no registro de perdas, já restrita à categoria escolhida (matéria-prima /
// pré-preparo / prato). Separada do BuscaProduto da contagem porque aquela sempre exclui
// PRODUTO ACABADO e não aceita filtro — e porque aqui não há câmera: perda é digitada no fim do
// turno, não escaneada na prateleira.
export default function BuscaProdutoPerda({ categoria, onSelecionar }) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')
  const debounceRef = useRef(null)

  // Trocar de categoria limpa o que estava digitado — senão a lista some sem explicação (os
  // resultados da categoria anterior não valem mais) e parece que a busca quebrou.
  useEffect(() => { setTermo(''); setResultados([]); setErro('') }, [categoria?.valor])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (termo.trim().length < 2) {
      setResultados([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setBuscando(true)
      setErro('')
      try {
        setResultados(await buscarProdutosPorCategoriaPerda(termo, categoria?.tiposItem))
      } catch (e) {
        setErro('Não consegui buscar — confere sua internet. ' + e.message)
      } finally {
        setBuscando(false)
      }
    }, 250) // debounce: evita uma query a cada tecla
    return () => clearTimeout(debounceRef.current)
  }, [termo, categoria])

  function handleSelecionar(produto) {
    setTermo('')
    setResultados([])
    onSelecionar(produto)
  }

  return (
    <div style={{ position: 'relative' }}>
      <label className="muted">{categoria?.label || 'Item'}</label>
      <input
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder={categoria?.valor === 'prato' ? 'Digite o nome do prato' : 'Digite o nome do item'}
        autoFocus
        type="search"
        name="busca-item-perda"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
        style={{ marginTop: 4 }}
      />

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{erro}</p>}

      {resultados.length > 0 && (
        <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, padding: 0, zIndex: 10, maxHeight: 260, overflowY: 'auto' }}>
          {resultados.map((p, i) => (
            <div
              key={p.id}
              onClick={() => handleSelecionar(p)}
              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: i < resultados.length - 1 ? '1px solid var(--border)' : 'none' }}
            >
              <p style={{ margin: 0 }}>{p.nome}</p>
              <p className="muted" style={{ margin: 0 }}>
                Everest {p.codigo_everest || '—'}
                {categoria?.valor !== 'prato' && ` · un. ${p.unidade_medida}`}
              </p>
            </div>
          ))}
        </div>
      )}

      {termo.trim().length >= 2 && !buscando && !erro && resultados.length === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          Nada encontrado em {(categoria?.label || 'nesta categoria').toLowerCase()}. Se o item for de outro tipo, volte e troque a categoria acima.
        </p>
      )}
    </div>
  )
}
