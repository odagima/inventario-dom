import { useEffect, useRef, useState } from 'react'
import { buscarProdutosParaFator, listarFatoresCorrecao, criarFatorCorrecao, removerFatorCorrecao } from '../lib/adminApi'

function ProdutoPicker({ label, selecionado, onSelecionar, placeholder }) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState([])
  const [aberto, setAberto] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (selecionado) return
    if (timer.current) clearTimeout(timer.current)
    if (termo.trim().length < 2) { setResultados([]); return }
    timer.current = setTimeout(async () => {
      try { setResultados(await buscarProdutosParaFator(termo)); setAberto(true) } catch { setResultados([]) }
    }, 250)
  }, [termo, selecionado])

  if (selecionado) {
    return (
      <div>
        <label className="muted">{label}</label>
        <div className="list-item" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
          <span>{selecionado.nome} <span className="muted" style={{ fontSize: 11 }}>· {selecionado.codigo_everest} · {selecionado.unidade_medida}</span></span>
          <button onClick={() => { onSelecionar(null); setTermo(''); setResultados([]) }} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16 }}>×</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <label className="muted">{label}</label>
      <input type="text" value={termo} placeholder={placeholder} onChange={(e) => setTermo(e.target.value)} onFocus={() => setAberto(true)} style={{ width: '100%' }} />
      {aberto && resultados.length > 0 && (
        <div className="card" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, marginTop: 4, padding: 0, maxHeight: 240, overflowY: 'auto' }}>
          {resultados.map((p) => (
            <button key={p.id} onClick={() => { onSelecionar(p); setAberto(false) }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 12px', cursor: 'pointer' }}>
              {p.nome} <span className="muted" style={{ fontSize: 11 }}>· {p.codigo_everest} · {p.unidade_medida}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function FatoresCorrecao() {
  const [porcionado, setPorcionado] = useState(null)
  const [cru, setCru] = useState(null)
  const [fator, setFator] = useState('')
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function recarregar() {
    try { setLista(await listarFatoresCorrecao()) } catch (e) { setErro(e.message) } finally { setCarregando(false) }
  }
  useEffect(() => { recarregar() }, [])

  async function adicionar() {
    setErro('')
    const f = Number(String(fator).replace(',', '.'))
    if (!porcionado || !cru) { setErro('Escolha o item porcionado e o insumo cru.'); return }
    if (!isFinite(f) || f <= 0) { setErro('Informe um fator válido (ex.: 1,25).'); return }
    setSalvando(true)
    try {
      await criarFatorCorrecao({ porcionadoId: porcionado.id, cruId: cru.id, fator: f })
      setPorcionado(null); setCru(null); setFator('')
      await recarregar()
    } catch (e) {
      setErro('Não consegui salvar. Já rodou o schema.sql atualizado (cria a tabela fatores_correcao)? ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(id) {
    try { await removerFatorCorrecao(id); await recarregar() } catch (e) { setErro(e.message) }
  }

  return (
    <div>
      <div className="app-header" style={{ marginBottom: 10 }}>
        <p className="brand">Fatores de correção (antigo)</p>
        <p className="subtitle">Converte o item porcionado de volta ao insumo cru. Ex.: PP Filet Medalhão → Filet Mignon, fator 1,25.</p>
      </div>

      <div className="card" style={{ marginBottom: 16, borderColor: 'var(--warning)' }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          <b>Fora de uso desde 07/08/2026.</b> O "CMV Real × Teórico" (Contagem Semanal) parou de usar essa tabela —
          agora converte pro insumo em natura automaticamente, direto pela ficha técnica (sem precisar cadastrar par
          a par aqui). Os dados cadastrados aqui continuam salvos, só não alimentam mais nenhum relatório. Ver
          DECISOES-TRAVADAS.md §19.5.
        </p>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        <ProdutoPicker label="Item porcionado (como aparece na contagem)" placeholder="ex.: PP FILET MEDALHÃO" selecionado={porcionado} onSelecionar={setPorcionado} />
        <ProdutoPicker label="Insumo cru (o que você compra)" placeholder="ex.: FILET MIGNON" selecionado={cru} onSelecionar={setCru} />
        <div>
          <label className="muted">Fator (quanto de cru por 1 do porcionado)</label>
          <input type="text" inputMode="decimal" value={fator} onChange={(e) => setFator(e.target.value)} placeholder="ex.: 1,25" style={{ width: '100%' }} />
        </div>
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}
        <button className="primary" onClick={adicionar} disabled={salvando}>{salvando ? 'Salvando…' : 'Adicionar fator'}</button>
      </div>

      <p className="muted" style={{ marginBottom: 8 }}>Fatores cadastrados</p>
      {carregando ? (
        <p className="muted">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="muted">Nenhum fator cadastrado ainda.</p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {lista.map((f, i) => (
            <div key={f.id} className="list-item" style={{ borderBottom: i < lista.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div>
                <p style={{ margin: 0 }}>{f.porcionado?.nome} <span className="muted">→ {f.cru?.nome}</span></p>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>fator {Number(f.fator).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</p>
              </div>
              <button onClick={() => excluir(f.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
