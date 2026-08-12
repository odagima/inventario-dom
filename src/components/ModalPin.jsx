import { useState } from 'react'
import { verificarPin } from '../lib/api'

const NIVEL_PERMITE = {
  contagem: ['administrativo', 'estoque_compras', 'operacao'],
  produtividade: ['administrativo', 'estoque_compras', 'operacao'],
  cadastro: ['administrativo', 'estoque_compras'],
  admin: ['administrativo']
}

export default function ModalPin({ destino, onEntrar, onCancelar }) {
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState('')
  const [verificando, setVerificando] = useState(false)

  async function handleConfirmar() {
    if (pin.length !== 4) return
    setVerificando(true)
    setErro('')
    try {
      const resultado = await verificarPin(pin)
      if (!resultado) {
        setErro('PIN não encontrado ou inativo.')
        setPin('')
        return
      }
      if (!NIVEL_PERMITE[destino].includes(resultado.nivelAcesso)) {
        setErro('Seu acesso não inclui essa área.')
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
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}
      onClick={onCancelar}
    >
      <div className="card" style={{ maxWidth: 320, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 20 }}>Grupo DOM</p>
        <p className="muted" style={{ margin: '0 0 18px' }}>Digite seu código de 4 números</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErro('') }}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
          placeholder="••••"
          style={{ textAlign: 'center', fontSize: 20, letterSpacing: 6 }}
          name="modal-pin"
          autoComplete="off"
        />
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' }}>{erro}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onCancelar} style={{ flex: 1 }}>Cancelar</button>
          <button className="primary" onClick={handleConfirmar} disabled={verificando || pin.length !== 4} style={{ flex: 1 }}>
            {verificando ? 'Verificando…' : 'Entrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
