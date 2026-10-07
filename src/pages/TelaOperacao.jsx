import { useEffect, useState } from 'react'
import Topbar from '../components/Topbar'
import { listarLocaisEstoque } from '../lib/locaisEstoqueApi'
import { buscarTurnoAberto, turnoVencido, periodoDoTurno, LABEL_PERIODO, abrirTurno, fecharTurno } from '../lib/turnosApi'

// Abrir/Fechar praça (07/10/2026, pedido do Felipe — rodada 2: "tipo caixa", depois simplificado
// pra "clica, escolhe o local (se não tiver vínculo fixo), confirma, e só DEPOIS pergunta se quer
// movimentar item — se sim, abre Requisição/Transferência; se não, só fecha o popup").
//
// Quem tem `local_estoque_padrao_id` vinculado (ver migration_v24.sql, Admin → Usuários) nem vê
// seletor de praça — só abre/fecha a dela. Quem não tem (gerente, por exemplo) escolhe livremente,
// igual antes.
//
// Abrir/fechar em si não pede item nenhum (isso é SEPARADO, pergunta depois) — só cria/encerra o
// turno. `abrirTurno`/`fecharTurno` aceitam lista de itens vazia de propósito (ver turnosApi.js).

function hojeHora(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TelaOperacao({ usuarioLogado, onSair, onAbrirRequisicao }) {
  const localFixoId = usuarioLogado?.localPadraoId || null
  const localFixoNome = usuarioLogado?.localPadraoNome || null

  const [locais, setLocais] = useState([])
  const [localEstoqueId, setLocalEstoqueId] = useState(localFixoId || '')
  const [turno, setTurno] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [acaoFeita, setAcaoFeita] = useState(null) // null | 'abriu' | 'fechou' — dispara a pergunta de movimentar

  useEffect(() => {
    listarLocaisEstoque().then(setLocais).catch((e) => setErro(e.message))
  }, [])

  useEffect(() => {
    if (!localEstoqueId) { setCarregando(false); return }
    let cancelado = false
    setCarregando(true)
    buscarTurnoAberto(localEstoqueId)
      .then((t) => { if (!cancelado) setTurno(t) })
      .catch((e) => { if (!cancelado) setErro(e.message) })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [localEstoqueId])

  const vencido = turno && turnoVencido(turno)
  const nomeLocal = localFixoNome || locais.find((l) => l.id === localEstoqueId)?.nome

  async function handleAbrir() {
    setErro('')
    setSalvando(true)
    try {
      await abrirTurno({ localEstoqueId, localOrigemId: null, itens: [], usuario: usuarioLogado?.nome })
      setAcaoFeita('abriu')
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleFechar() {
    setErro('')
    setSalvando(true)
    try {
      await fecharTurno({ turnoId: turno.id, localDestinoId: null, itens: [], usuario: usuarioLogado?.nome })
      setAcaoFeita('fechou')
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="screen">
      <Topbar titulo="Abrir/Fechar praça" onVoltar={onSair} />

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 12px' }}>{erro}</p>}

      {acaoFeita && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>
            {acaoFeita === 'abriu' ? `Praça ${nomeLocal} aberta.` : `Praça ${nomeLocal} fechada.`}
          </p>
          <p className="muted" style={{ margin: '0 0 16px', fontSize: 13 }}>
            {acaoFeita === 'abriu' ? 'Vai levar algum item pra praça agora?' : 'Vai devolver algum item pro estoque agora?'}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onSair} style={{ flex: 1 }}>Não, obrigado</button>
            <button className="primary" onClick={onAbrirRequisicao} style={{ flex: 1 }}>Sim</button>
          </div>
        </div>
      )}

      {!acaoFeita && !localFixoId && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label className="muted">Praça / local de estoque</label>
          <select value={localEstoqueId} onChange={(e) => setLocalEstoqueId(e.target.value)}>
            <option value="">Selecione…</option>
            {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </div>
      )}

      {!acaoFeita && localEstoqueId && carregando && <p className="muted">Carregando…</p>}

      {!acaoFeita && localEstoqueId && !carregando && !turno && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 16px', fontWeight: 600, fontSize: 15 }}>Abrir a praça {nomeLocal}?</p>
          <button className="primary" onClick={handleAbrir} disabled={salvando} style={{ width: '100%' }}>
            {salvando ? 'Abrindo…' : 'Abrir praça'}
          </button>
        </div>
      )}

      {!acaoFeita && localEstoqueId && !carregando && turno && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Fechar a praça {nomeLocal}?</p>
          <p className="muted" style={{ margin: '0 0 16px', fontSize: 12.5 }}>
            Aberta {hojeHora(turno.aberto_em)} ({LABEL_PERIODO[periodoDoTurno(turno.aberto_em)]})
            {turno.aberto_por ? ` por ${turno.aberto_por}` : ''}.
            {vencido && ' Passou das 3h — feche pra liberar um turno novo.'}
          </p>
          <button className="primary" onClick={handleFechar} disabled={salvando} style={{ width: '100%' }}>
            {salvando ? 'Fechando…' : 'Fechar praça'}
          </button>
        </div>
      )}
    </div>
  )
}
