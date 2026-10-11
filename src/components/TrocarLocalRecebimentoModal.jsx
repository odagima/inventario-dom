import { useState } from 'react'
import Modal from './Modal'

// Troca de Loja/Setor específica do Recebimento (11/10/2026, pedido do Felipe: "como é a entrada
// real, baseada no CNPJ, não posso colocar outras sublojas" — "só temos DOM e Dalva"). Diferente
// do TrocarLocalModal genérico (que lista as 7 `unidades` cadastradas e deixa Loja/Setor
// independentes): aqui só entram as Lojas que têm CNPJ de verdade, dedupe por CNPJ (várias
// "sub-lojas" — Eventos, Mercadinho Dalva, RESID Bar, Estoque Central — dividem o mesmo CNPJ da
// Dalva; só "Grupo D.O.M" não tem CNPJ cadastrado nenhum, por isso fica de fora daqui até alguém
// corrigir o cadastro em Admin → Lojas e Setores). Setor é filtrado pra só mostrar quem pertence
// ao CNPJ da Loja escolhida.
export default function TrocarLocalRecebimentoModal({ unidades, locais, localAtualId, onFechar, onConfirmar }) {
  const vistos = new Set()
  const lojasReais = []
  unidades.forEach((u) => {
    if (!u.cnpj || vistos.has(u.cnpj)) return
    vistos.add(u.cnpj)
    lojasReais.push(u)
  })

  const localAtual = locais.find((l) => l.id === localAtualId)
  const unidadeAtual = localAtual && unidades.find((u) => u.id === localAtual.unidade_id)
  const [cnpjEscolhido, setCnpjEscolhido] = useState(unidadeAtual?.cnpj || lojasReais[0]?.cnpj || '')
  const [localEstoqueId, setLocalEstoqueId] = useState(localAtualId || '')
  const [confirmando, setConfirmando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const locaisDaLoja = locais.filter((l) => {
    const u = unidades.find((x) => x.id === l.unidade_id)
    return u?.cnpj === cnpjEscolhido
  })

  async function confirmar() {
    setSalvando(true)
    setErro('')
    try {
      await onConfirmar(locais.find((l) => l.id === localEstoqueId) || null)
    } catch (e) {
      setErro(e.message)
      setSalvando(false)
    }
  }

  const mudou = localEstoqueId !== (localAtualId || '')

  return (
    <Modal onFechar={() => !salvando && onFechar()} largura={360}>
      {!confirmando ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>Trocar loja/setor</p>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Vale só pra esse lançamento. Recebimento é a entrada fiscal — só as lojas com CNPJ cadastrado aparecem aqui.
          </p>
          <div>
            <label className="muted">Loja</label>
            <select value={cnpjEscolhido} onChange={(e) => { setCnpjEscolhido(e.target.value); setLocalEstoqueId('') }}>
              {lojasReais.map((u) => <option key={u.cnpj} value={u.cnpj}>{u.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="muted">Setor</label>
            <select value={localEstoqueId} onChange={(e) => setLocalEstoqueId(e.target.value)}>
              <option value="">Selecione…</option>
              {locaisDaLoja.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
            {locaisDaLoja.length === 0 && (
              <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>Nenhum Setor vinculado a essa Loja ainda.</p>
            )}
          </div>
          {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onFechar} style={{ flex: 1 }}>Cancelar</button>
            <button className="primary" onClick={() => setConfirmando(true)} disabled={!mudou || !localEstoqueId} style={{ flex: 1 }}>Trocar</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>Confirma a troca?</p>
          <p className="muted" style={{ margin: 0 }}>
            {lojasReais.find((u) => u.cnpj === cnpjEscolhido)?.nome} · {locais.find((l) => l.id === localEstoqueId)?.nome}
          </p>
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
