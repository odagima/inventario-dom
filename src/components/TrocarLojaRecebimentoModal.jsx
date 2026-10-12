import { useState } from 'react'
import Modal from './Modal'

// Troca só de Loja (11/10/2026, Recebimento) — pedido do Felipe: Setor é sempre "Estoque" ("tudo
// entra direto pelo estoque"), não precisa trocar nem filtrar nada por ele; só a Loja (CNPJ de
// verdade — DOM ou Dalva) é editável aqui, independente do Setor. `lojasReais` já vem deduplicada
// por CNPJ de quem chama (RecebimentoForm.jsx).
export default function TrocarLojaRecebimentoModal({ lojasReais, unidadeAtualId, onFechar, onConfirmar }) {
  const [unidadeId, setUnidadeId] = useState(unidadeAtualId || '')
  const [confirmando, setConfirmando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function confirmar() {
    setSalvando(true)
    setErro('')
    try {
      await onConfirmar(lojasReais.find((u) => u.id === unidadeId) || null)
    } catch (e) {
      setErro(e.message)
      setSalvando(false)
    }
  }

  const mudou = unidadeId !== (unidadeAtualId || '')

  return (
    <Modal onFechar={() => !salvando && onFechar()} largura={340}>
      {!confirmando ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>Trocar loja</p>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Qual CNPJ essa entrega está vinculada — o material entra direto no Estoque de qualquer jeito.
          </p>
          <div>
            <label className="muted">Loja</label>
            <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
              <option value="">Selecione…</option>
              {lojasReais.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
          {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onFechar} style={{ flex: 1 }}>Cancelar</button>
            <button className="primary" onClick={() => setConfirmando(true)} disabled={!mudou || !unidadeId} style={{ flex: 1 }}>Trocar</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>Confirma a troca?</p>
          <p className="muted" style={{ margin: 0 }}>{lojasReais.find((u) => u.id === unidadeId)?.nome}</p>
          {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmando(false)} disabled={salvando} style={{ flex: 1 }}>Voltar</button>
            <button className="primary" onClick={confirmar} disabled={salvando} style={{ flex: 1 }}>
              {salvando ? 'Trocando…' : 'Confirmar troca'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
