import { useEffect, useState } from 'react'
import Modal from './Modal'
import { listarUnidades } from '../lib/api'
import { listarLocaisEstoque } from '../lib/locaisEstoqueApi'
import { useRotulos } from '../lib/RotulosContext'

// Popup de trocar Loja/Setor, compartilhado por qualquer tela que lance algo "puxando a base
// padronizada" (Perdas, Produção, Recebimento — 08/10/2026, pedido do Felipe: "vamos usar esse
// padrão pra tudo e todos, assim conseguimos manter uma base certa pra cruzar os dados"). Sempre
// em 2 passos — escolher, depois confirmar — porque trocar daqui vale só aquele lançamento, nunca
// o cadastro da pessoa, e isso precisa ficar claro antes de valer.
//
// `mostrarLoja` (08/10/2026, "não está tudo com a mesma cara"): Produção não guarda Loja nenhuma
// (só Setor, via `producoes.local_estoque_id`) — mostrar o campo ali seria inventar um dado que
// não existe. A interação (tocar → confirmar) é a mesma em todo canto; os campos mostrados é que
// seguem o que cada lançamento de fato guarda.
export default function TrocarLocalModal({ unidadeAtualId, localAtualId, onFechar, onConfirmar, mostrarLoja = true }) {
  const rotulos = useRotulos()
  const [unidadeId, setUnidadeId] = useState(unidadeAtualId || '')
  const [localEstoqueId, setLocalEstoqueId] = useState(localAtualId || '')
  const [unidades, setUnidades] = useState([])
  const [locais, setLocais] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [confirmando, setConfirmando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    Promise.all([mostrarLoja ? listarUnidades() : Promise.resolve([]), listarLocaisEstoque()])
      .then(([u, l]) => { setUnidades(u); setLocais(l) })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [mostrarLoja])

  async function confirmar() {
    setSalvando(true)
    setErro('')
    try {
      // Devolve os objetos (não só o id) — quem chama precisa do `.nome` pra atualizar o
      // cabeçalho na hora, sem esperar a tela inteira recarregar.
      await onConfirmar(
        unidades.find((u) => u.id === unidadeId) || null,
        locais.find((l) => l.id === localEstoqueId) || null
      )
    } catch (e) {
      setErro(e.message)
      setSalvando(false)
    }
  }

  const mudou = (mostrarLoja && unidadeId !== (unidadeAtualId || '')) || localEstoqueId !== (localAtualId || '')

  return (
    <Modal onFechar={() => !salvando && onFechar()} largura={360}>
      {carregando ? (
        <p className="muted">Carregando…</p>
      ) : !confirmando ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>
            {mostrarLoja ? `Trocar ${rotulos.loja.toLowerCase()}/${rotulos.setor.toLowerCase()}` : `Trocar ${rotulos.setor.toLowerCase()}`}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Vale só pra esse lançamento — da próxima vez volta a sugerir o padrão do seu cadastro.
          </p>
          {mostrarLoja && (
            <div>
              <label className="muted">{rotulos.loja}</label>
              <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
                <option value="">Sem {rotulos.loja.toLowerCase()}</option>
                {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="muted">{rotulos.setor}</label>
            <select value={localEstoqueId} onChange={(e) => setLocalEstoqueId(e.target.value)}>
              <option value="">Sem {rotulos.setor.toLowerCase()}</option>
              {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>
          {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onFechar} style={{ flex: 1 }}>Cancelar</button>
            <button className="primary" onClick={() => setConfirmando(true)} disabled={!mudou} style={{ flex: 1 }}>Trocar</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>Confirma a troca?</p>
          <p className="muted" style={{ margin: 0 }}>
            {mostrarLoja ? `${unidades.find((u) => u.id === unidadeId)?.nome || `sem ${rotulos.loja.toLowerCase()}`} · ` : ''}
            {locais.find((l) => l.id === localEstoqueId)?.nome || `sem ${rotulos.setor.toLowerCase()}`}
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
