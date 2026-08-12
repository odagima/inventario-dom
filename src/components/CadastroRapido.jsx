import { useState } from 'react'

export default function CadastroRapido({ codigoBarras, onCancelar, onSalvar }) {
  const [nome, setNome] = useState('')
  const [unidadeMedida, setUnidadeMedida] = useState('un')
  const [categoria, setCategoria] = useState('')
  const [codigoEverest, setCodigoEverest] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!nome.trim()) return
    setSalvando(true)
    try {
      await onSalvar({ nome, unidadeMedida, categoria, codigoEverest, codigoBarras })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <p style={{ margin: 0, fontWeight: 500 }}>Código não encontrado</p>
        <p className="muted" style={{ margin: '4px 0 0' }}>{codigoBarras}</p>
      </div>

      <div>
        <label className="muted">Nome do produto</label>
        <input
          value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Queijo minas frescal" required
          name="cadastro-rapido-nome" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
        />
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="muted">Unidade de medida</label>
          <select value={unidadeMedida} onChange={(e) => setUnidadeMedida(e.target.value)}>
            <option value="un">un</option>
            <option value="kg">kg</option>
            <option value="lt">lt</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="muted">Categoria</label>
          <input
            value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Ex: laticínios"
            name="cadastro-rapido-categoria" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
          />
        </div>
      </div>

      <div>
        <label className="muted">Código no Everest — opcional</label>
        <input
          value={codigoEverest} onChange={(e) => setCodigoEverest(e.target.value)} placeholder="Código interno"
          name="cadastro-rapido-codigo" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" onClick={onCancelar} style={{ flex: 1 }}>Cancelar</button>
        <button type="submit" className="primary" disabled={salvando} style={{ flex: 1 }}>
          {salvando ? 'Salvando…' : 'Salvar e continuar'}
        </button>
      </div>
    </form>
  )
}
