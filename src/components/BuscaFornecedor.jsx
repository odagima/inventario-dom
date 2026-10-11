import { useEffect, useRef, useState } from 'react'
import { listarFornecedoresConhecidos } from '../lib/fornecedoresApi'

// Autocomplete de Fornecedor (11/10/2026, pedido do Felipe) — sugere quem já apareceu numa nota
// importada (Compras/NFe), pela razão social. Continua sendo um campo de texto livre (nem todo
// fornecedor de verdade já foi importado) — a lista é só pra facilitar, nunca trava a digitação de
// um nome novo. Carrega a lista inteira uma vez (não é grande) e filtra no cliente, sem debounce/
// consulta a cada tecla.
export default function BuscaFornecedor({ value, onChange }) {
  const [conhecidos, setConhecidos] = useState([])
  const [aberto, setAberto] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    listarFornecedoresConhecidos().then(setConhecidos).catch(() => {})
  }, [])

  useEffect(() => {
    function aoClicarFora(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setAberto(false)
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [])

  const termo = value.trim().toLowerCase()
  const sugestoes = termo.length < 1 ? [] : conhecidos
    .filter((razaoSocial) => razaoSocial.toLowerCase().includes(termo))
    .slice(0, 8)

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setAberto(true) }}
        onFocus={() => setAberto(true)}
        placeholder="Nome do fornecedor"
        autoComplete="off"
      />
      {aberto && sugestoes.length > 0 && (
        <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, padding: 0, zIndex: 10, maxHeight: 220, overflowY: 'auto' }}>
          {sugestoes.map((razaoSocial, i) => (
            <div
              key={razaoSocial}
              onClick={() => { onChange(razaoSocial); setAberto(false) }}
              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: i < sugestoes.length - 1 ? '1px solid var(--border)' : 'none' }}
            >
              <p style={{ margin: 0 }}>{razaoSocial}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
