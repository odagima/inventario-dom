import { useEffect, useState } from 'react'
import { pararProducao, cancelarProducao, finalizarProducao } from '../lib/produtividadeApi'

function formatarDuracao(ms) {
  const totalSeg = Math.floor(ms / 1000)
  const h = Math.floor(totalSeg / 3600)
  const m = Math.floor((totalSeg % 3600) / 60)
  const s = totalSeg % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

export default function CartaoAndamento({ andamento, onAtualizado }) {
  const [agora, setAgora] = useState(Date.now())
  const [parando, setParando] = useState(false)
  const [produzidos, setProduzidos] = useState([{ nome: '', kg: '', porcoes: '' }])
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (andamento.parado_em) return
    const intervalo = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(intervalo)
  }, [andamento.parado_em])

  const inicioMs = new Date(andamento.iniciado_em).getTime()
  const fimMs = andamento.parado_em ? new Date(andamento.parado_em).getTime() : agora
  const duracao = formatarDuracao(fimMs - inicioMs)

  async function handleParar() {
    const atualizado = await pararProducao(andamento.id)
    onAtualizado(atualizado)
    setParando(true)
  }

  async function handleCancelar() {
    await cancelarProducao(andamento.id)
    onAtualizado(null)
  }

  function atualizarProduzido(i, campo, valor) {
    setProduzidos((prev) => prev.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p)))
  }

  function adicionarProduzido() {
    setProduzidos((prev) => [...prev, { nome: '', kg: '', porcoes: '' }])
  }

  function removerProduzido(i) {
    setProduzidos((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleSalvar() {
    setErro('')
    const validos = produzidos.filter((p) => p.nome.trim() && Number(p.kg) > 0 && Number(p.porcoes) > 0)
    if (!validos.length) { setErro('Preenche nome, kg e porções de pelo menos um produzido.'); return }
    setSalvando(true)
    try {
      await finalizarProducao(
        andamento,
        validos.map((p) => ({ nome: p.nome.trim(), kg: Number(p.kg), porcoes: Number(p.porcoes) })),
        obs
      )
      onAtualizado(null)
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontWeight: 600 }}>{andamento.producao}</p>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
            {andamento.insumo} · {andamento.praca} · {andamento.funcionario}
          </p>
        </div>
        <p style={{ margin: 0, fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: andamento.parado_em ? 'var(--warning)' : 'var(--accent)' }}>
          {duracao}
        </p>
      </div>

      {!parando && !andamento.parado_em && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={handleCancelar} style={{ flex: 1, color: 'var(--danger)' }}>Cancelar</button>
          <button className="primary" onClick={handleParar} style={{ flex: 2 }}>■ Parar</button>
        </div>
      )}

      {(parando || andamento.parado_em) && (
        <div style={{ marginTop: 14, background: 'var(--surface-2)', borderRadius: 12, padding: 12 }}>
          <p className="muted" style={{ margin: '0 0 8px' }}>O que saiu dessa produção?</p>
          {produzidos.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
              <input placeholder="Produzido" value={p.nome} onChange={(e) => atualizarProduzido(i, 'nome', e.target.value)} style={{ flex: 2 }} />
              <input placeholder="Kg" type="number" value={p.kg} onChange={(e) => atualizarProduzido(i, 'kg', e.target.value)} style={{ flex: 1 }} />
              <input placeholder="Porções" type="number" value={p.porcoes} onChange={(e) => atualizarProduzido(i, 'porcoes', e.target.value)} style={{ flex: 1 }} />
              {produzidos.length > 1 && (
                <button onClick={() => removerProduzido(i)} style={{ padding: '8px 10px', color: 'var(--danger)' }}>×</button>
              )}
            </div>
          ))}
          <button onClick={adicionarProduzido} style={{ width: '100%', marginBottom: 8, fontSize: 13 }}>+ Outro produzido</button>
          <input placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} style={{ marginBottom: 8 }} />
          {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{erro}</p>}
          <button className="primary" onClick={handleSalvar} disabled={salvando} style={{ width: '100%' }}>
            {salvando ? 'Salvando…' : '✔ Salvar'}
          </button>
        </div>
      )}
    </div>
  )
}
