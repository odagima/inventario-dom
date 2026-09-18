import { useState } from 'react'

export default function ConversaoQuantidade({ produto, onCancelar, onConfirmar, onExcluir, valoresIniciais, editando }) {
  const [modo, setModo] = useState(valoresIniciais?.modoEntrada || 'direto') // 'direto' (padrão) | 'embalagem'
  const [qtdEmbalagens, setQtdEmbalagens] = useState(String(valoresIniciais?.qtdEmbalagens ?? '1'))
  const [pesoEmbalagem, setPesoEmbalagem] = useState(String(valoresIniciais?.pesoEmbalagem ?? ''))
  const [qtdDireto, setQtdDireto] = useState(
    valoresIniciais?.modoEntrada === 'direto' ? String(valoresIniciais?.quantidade ?? '') : ''
  )
  const [salvando, setSalvando] = useState(false)

  const total = modo === 'embalagem'
    ? (Number(qtdEmbalagens || 0) * Number(pesoEmbalagem || 0))
    : Number(qtdDireto || 0)

  async function handleConfirmar() {
    if (!(total > 0)) return
    setSalvando(true)
    try {
      await onConfirmar({
        modoEntrada: modo,
        qtdEmbalagens: modo === 'embalagem' ? Number(qtdEmbalagens || 0) : null,
        pesoEmbalagem: modo === 'embalagem' ? Number(pesoEmbalagem || 0) : null,
        quantidade: total
      })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 500 }}>{produto.nome}</p>
          <p className="muted" style={{ margin: 0 }}>
            Everest {produto.codigo_everest || '—'} · un. {produto.unidade_medida}
          </p>
        </div>
        <button type="button" className="ghost" onClick={onCancelar}>
          trocar
        </button>
      </div>

      <div className="segmented">
        <button
          type="button"
          onClick={() => setModo('direto')}
          className={modo === 'direto' ? 'active' : ''}
        >
          Direto em {produto.unidade_medida}
        </button>
        <button
          type="button"
          onClick={() => setModo('embalagem')}
          className={modo === 'embalagem' ? 'active' : ''}
        >
          Por embalagem
        </button>
      </div>

      {modo === 'embalagem' ? (
        <>
          <div>
            <label className="muted">
              {produto.unidade_medida === 'un' ? 'Quantidade de unidades por embalagem (ex: 12 se vem em fardo)' : `Peso por embalagem (${produto.unidade_medida})`}
            </label>
            <input
              type="number"
              min="0"
              step={produto.unidade_medida === 'un' ? '1' : '0.01'}
              placeholder={produto.unidade_medida === 'un' ? 'Ex: 12' : 'Ex: 0.5'}
              value={pesoEmbalagem}
              onChange={(e) => setPesoEmbalagem(e.target.value)}
              autoFocus
              name="conversao-peso-embalagem"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="muted">Quantidade de embalagens</label>
            <input
              type="number" min="0" value={qtdEmbalagens} onChange={(e) => setQtdEmbalagens(e.target.value)}
              name="conversao-qtd-embalagens" autoComplete="off"
            />
          </div>
        </>
      ) : (
        <div>
          <label className="muted">Quantidade em {produto.unidade_medida}</label>
          <input
            type="number" min="0" step="0.01" value={qtdDireto} onChange={(e) => setQtdDireto(e.target.value)} autoFocus
            name="conversao-qtd-direto" autoComplete="off"
          />
        </div>
      )}

      <p className="muted" style={{ margin: 0 }}>
        Total convertido: <strong style={{ color: 'var(--text)' }}>{total.toFixed(2)} {produto.unidade_medida}</strong>
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onCancelar} disabled={salvando} style={{ flex: 1 }}>Voltar</button>
        {editando && onExcluir && (
          <button type="button" onClick={onExcluir} disabled={salvando} style={{ flex: 1, color: 'var(--danger)', borderColor: 'var(--danger)' }}>Excluir</button>
        )}
        <button type="button" onClick={handleConfirmar} className="primary" disabled={salvando || !(total > 0)} style={{ flex: 1 }}>
          {salvando ? 'Salvando…' : 'Enviar'}
        </button>
      </div>
    </div>
  )
}
