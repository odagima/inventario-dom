import { useState } from 'react'
import { verificarPin } from '../lib/api'

export default function LoginScreen({ onEntrar }) {
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState('')
  const [verificando, setVerificando] = useState(false)

  async function handleEntrar() {
    if (pin.length !== 4) return
    setVerificando(true)
    setErro('')
    try {
      const resultado = await verificarPin(pin)
      if (!resultado) {
        setErro('Código não encontrado ou inativo.')
        setPin('')
        return
      }
      onEntrar(resultado)
    } catch (e) {
      setErro(e.message)
    } finally {
      setVerificando(false)
    }
  }

  return (
    <div className="screen" style={{ justifyContent: 'center', textAlign: 'center' }}>
      <div className="app-header" style={{ textAlign: 'center' }}>
        <p className="brand">Grupo DOM</p>
        <p className="subtitle">Inventário</p>
      </div>

      <div className="card">
        <p className="muted" style={{ margin: '0 0 14px' }}>Digite seu código de 4 números</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErro('') }}
          onKeyDown={(e) => e.key === 'Enter' && handleEntrar()}
          placeholder="••••"
          style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8, marginBottom: 14 }}
          name="login-pin"
          autoComplete="off"
        />
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}
        <button className="primary" onClick={handleEntrar} disabled={verificando || pin.length !== 4} style={{ width: '100%', padding: 16, fontSize: 16 }}>
          {verificando ? 'Verificando…' : 'Entrar'}
        </button>
      </div>
    </div>
  )
}
