import { useEffect, useState } from 'react'
import Topbar from '../components/Topbar'
import BuscaProdutoPerda from '../components/BuscaProdutoPerda'
import Icon from '../components/Icon'
import { listarLocaisEstoque } from '../lib/locaisEstoqueApi'
import { buscarTurnoAberto, turnoVencido, periodoDoTurno, LABEL_PERIODO, abrirTurno, fecharTurno, listarTurnosAbertos, listarTurnosHistorico } from '../lib/turnosApi'

// Abrir/Fechar operação (07/10/2026, pedido do Felipe: "tipo caixa... abre, opera, precisa fechar
// pra operar o próximo turno"). Botão próprio na Home, antes do menu de lançamentos — Produção e
// Requisição travam sem um turno aberto no local escolhido (ver `turnoUtilizavel` em
// src/lib/turnosApi.js).
//
// Abrir = transferência de saída (de onde o material está vindo → o local da praça). Fechar =
// transferência de volta (da praça → pra onde está indo, normalmente a câmara fria/Estoque
// Central). As duas são a MESMA lista de itens (produto + quantidade), só muda a direção.
//
// "Status das praças" (07/10/2026, pedido do Felipe): "não quero no ADM, isso é pra a operação
// verificar" — a central de acompanhamento mora aqui, na tela que o time já usa, não no
// Administrativo. Atualiza sozinho, mostra todas as praças de uma vez antes de escolher uma.

const INTERVALO_ATUALIZACAO_MS = 20000

function hojeHora(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function faz(iso) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)} dias`
}

function StatusPracas({ locais }) {
  const [abertos, setAbertos] = useState([])
  const [ultimoFechadoPorLocal, setUltimoFechadoPorLocal] = useState({})
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      try {
        const ab = await listarTurnosAbertos()
        if (cancelado) return
        setAbertos(ab)

        const idsComAberto = new Set(ab.map((t) => t.local_estoque_id))
        const semAberto = locais.filter((l) => !idsComAberto.has(l.id))
        const historicos = await Promise.all(semAberto.map((l) => listarTurnosHistorico(l.id, 1)))
        if (cancelado) return
        const mapa = {}
        semAberto.forEach((l, i) => { mapa[l.id] = historicos[i][0] || null })
        setUltimoFechadoPorLocal(mapa)
      } catch { /* não trava o resto da tela por causa disso */ } finally {
        if (!cancelado) setCarregando(false)
      }
    }
    carregar()
    const intervalo = setInterval(carregar, INTERVALO_ATUALIZACAO_MS)
    return () => { cancelado = true; clearInterval(intervalo) }
  }, [locais])

  if (!locais.length) return null

  const abertoPorLocal = Object.fromEntries(abertos.map((t) => [t.local_estoque_id, t]))

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Status das praças</p>
      {carregando ? <p className="muted">Carregando…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {locais.map((l) => {
            const turno = abertoPorLocal[l.id]
            const vencido = turno && turnoVencido(turno)
            const ultimoFechado = ultimoFechadoPorLocal[l.id]
            return (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 500 }}>{l.nome}</span>
                {turno ? (
                  <span style={{ fontSize: 12.5, textAlign: 'right', color: vencido ? 'var(--danger)' : 'var(--success)' }}>
                    {vencido ? 'Vencida' : 'Aberta'} {faz(turno.aberto_em)}
                  </span>
                ) : ultimoFechado ? (
                  <span className="muted" style={{ fontSize: 12.5, textAlign: 'right' }}>Fechada · {faz(ultimoFechado.fechado_em || ultimoFechado.aberto_em)}</span>
                ) : (
                  <span className="muted" style={{ fontSize: 12.5, textAlign: 'right' }}>Nunca aberta</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ListaItens({ itens, onMudar }) {
  const [produto, setProduto] = useState(null)
  const [quantidade, setQuantidade] = useState('')

  function adicionar() {
    const qtd = Number(String(quantidade).replace(',', '.'))
    if (!produto || !(qtd > 0)) return
    onMudar([...itens, { codigoEverest: produto.codigo_everest, nome: produto.nome, unidade: produto.unidade_medida, quantidade: qtd }])
    setProduto(null)
    setQuantidade('')
  }

  function remover(i) {
    onMudar(itens.filter((_, idx) => idx !== i))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {itens.map((it, i) => (
        <div key={i} className="list-item">
          <span>{it.nome} <span className="muted" style={{ fontSize: 11 }}>· {it.quantidade} {it.unidade}</span></span>
          <button onClick={() => remover(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)' }}><Icon nome="x" tamanho={16} /></button>
        </div>
      ))}

      <BuscaProdutoPerda onSelecionar={setProduto} />
      {produto && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <p style={{ margin: 0, fontWeight: 500 }}>{produto.nome}</p>
          <button type="button" className="ghost" onClick={() => setProduto(null)}>trocar</button>
        </div>
      )}
      {produto && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label className="muted">Quantidade ({produto.unidade_medida})</label>
            <input type="number" min="0" step="0.001" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </div>
          <button onClick={adicionar} disabled={!(Number(String(quantidade).replace(',', '.')) > 0)} style={{ height: 44 }}>+ item</button>
        </div>
      )}
    </div>
  )
}

export default function TelaOperacao({ usuarioLogado, onSair }) {
  const [locais, setLocais] = useState([])
  const [localEstoqueId, setLocalEstoqueId] = useState('')
  const [turno, setTurno] = useState(null) // null = nenhum local escolhido ainda, ou sem turno aberto nele
  const [carregando, setCarregando] = useState(false)
  const [localOutro, setLocalOutro] = useState('') // origem (abrir) ou destino (fechar)
  const [itens, setItens] = useState([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => { listarLocaisEstoque().then(setLocais).catch((e) => setErro(e.message)) }, [])

  async function escolherLocal(id) {
    setLocalEstoqueId(id)
    setItens([])
    setErro('')
    setLocalOutro('')
    if (!id) { setTurno(null); return }
    setCarregando(true)
    try {
      const t = await buscarTurnoAberto(id)
      setTurno(t)
      // Sugere o Estoque Central como origem/destino padrão — a maioria das praças abastece e
      // devolve pra lá; quem precisar de outro local troca no próprio seletor.
      const central = locais.find((l) => l.nome.toLowerCase().includes('central'))
      if (central) setLocalOutro(central.id)
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  async function handleAbrir() {
    if (!localOutro || itens.length === 0) { setErro('Escolha de onde está vindo o material e pelo menos 1 item.'); return }
    setErro('')
    setSalvando(true)
    try {
      await abrirTurno({ localEstoqueId, localOrigemId: localOutro, itens, usuario: usuarioLogado?.nome })
      await escolherLocal(localEstoqueId)
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleFechar() {
    if (!localOutro) { setErro('Escolha pra onde o material está voltando.'); return }
    setErro('')
    setSalvando(true)
    try {
      await fecharTurno({ turnoId: turno.id, localDestinoId: localOutro, itens, usuario: usuarioLogado?.nome })
      await escolherLocal(localEstoqueId)
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  const vencido = turno && turnoVencido(turno)
  const nomeLocal = locais.find((l) => l.id === localEstoqueId)?.nome

  return (
    <div className="screen">
      <Topbar titulo="Operação" subtitulo="abrir e fechar por praça" onVoltar={onSair} />

      <StatusPracas locais={locais} />

      <div className="card">
        <label className="muted">Praça / local de estoque</label>
        <select value={localEstoqueId} onChange={(e) => escolherLocal(e.target.value)}>
          <option value="">Selecione…</option>
          {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
      </div>

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '12px 0 0' }}>{erro}</p>}

      {carregando && <p className="muted" style={{ marginTop: 12 }}>Carregando…</p>}

      {!carregando && localEstoqueId && !turno && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Abrir operação — {nomeLocal}</p>
          <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>O que está sendo levado pra praça agora, pra começar a operar.</p>

          <div style={{ marginBottom: 12 }}>
            <label className="muted">Vindo de</label>
            <select value={localOutro} onChange={(e) => setLocalOutro(e.target.value)}>
              <option value="">Selecione…</option>
              {locais.filter((l) => l.id !== localEstoqueId).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>

          <ListaItens itens={itens} onMudar={setItens} />

          <button className="primary" onClick={handleAbrir} disabled={salvando || !localOutro || itens.length === 0} style={{ width: '100%', marginTop: 14 }}>
            {salvando ? 'Abrindo…' : 'Abrir operação'}
          </button>
        </div>
      )}

      {!carregando && turno && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>
            {vencido ? 'Operação vencida' : 'Operação aberta'} — {nomeLocal}
          </p>
          <p className="muted" style={{ margin: '0 0 14px', fontSize: 12.5 }}>
            Aberta {hojeHora(turno.aberto_em)} ({LABEL_PERIODO[periodoDoTurno(turno.aberto_em)]})
            {turno.aberto_por ? ` por ${turno.aberto_por}` : ''}.
            {vencido && ' Passou das 3h — feche antes de abrir uma nova.'}
          </p>

          <div style={{ marginBottom: 12 }}>
            <label className="muted">Voltando pra</label>
            <select value={localOutro} onChange={(e) => setLocalOutro(e.target.value)}>
              <option value="">Selecione…</option>
              {locais.filter((l) => l.id !== localEstoqueId).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>

          <ListaItens itens={itens} onMudar={setItens} />

          <button className="primary" onClick={handleFechar} disabled={salvando || !localOutro} style={{ width: '100%', marginTop: 14 }}>
            {salvando ? 'Fechando…' : 'Fechar operação'}
          </button>
        </div>
      )}
    </div>
  )
}
