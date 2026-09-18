import { useState } from 'react'

export default function ModalSenha({ onConfirmar, onCancelar }) {
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(false)
  const [verificando, setVerificando] = useState(false)

  async function handleConfirmar() {
    setVerificando(true)
    try {
      const ok = await onConfirmar(senha)
      if (!ok) {
        setErro(true)
        setSenha('')
      }
    } finally {
      setVerificando(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20
      }}
      onClick={onCancelar}
    >
      <div className="card" style={{ maxWidth: 340, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 20 }}>Grupo DOM</p>
        <p className="muted" style={{ margin: '0 0 18px' }}>Confirme seu código de acesso</p>
        <input
          type="password"
          autoFocus
          value={senha}
          onChange={(e) => { setSenha(e.target.value); setErro(false) }}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
          placeholder="Senha"
          name="modal-senha"
          autoComplete="off"
        />
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' }}>Senha incorreta.</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onCancelar} style={{ flex: 1 }}>Cancelar</button>
          <button className="primary" onClick={handleConfirmar} disabled={verificando} style={{ flex: 1 }}>
            {verificando ? 'Verificando…' : 'Entrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
