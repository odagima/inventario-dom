import { useEffect, useRef, useState } from 'react'
import { buscarProdutosParaFator, listarFatoresCorrecao, criarFatorCorrecao, removerFatorCorrecao } from '../lib/adminApi'

// Porcionamento (06/10/2026, pedido do Felipe): "pegar todos os itens que existe um porcionamento,
// e ter isso como base... deixar disponível pra alteração, incluir ou excluir qualquer item que
// seja derivado dele." É a MESMA tabela `fatores_correcao` que a Produção usa pra filtrar o que
// mostrar na saída de cada etapa (ver `filhosDiretos` em src/lib/fatoresCorrecaoApi.js).
//
// 07/10/2026: a versão em árvore (indentada por nível) ficou "mega confusa" pro Felipe — trocada
// por uma lista simples, mesmo molde de Unidades.jsx (cadastrar em cima, lista editável embaixo,
// sem aninhamento visual). Mantém as mesmas funções de API (listar/criar/remover), só muda a tela.
//
// `fator` é OPCIONAL de propósito (migration_v17.sql) — dá pra marcar a ORDEM do processo (o que
// vira o quê) sem precisar medir o rendimento ainda; o fator entra depois, quando alguém souber.

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

function fmtFator(f) {
  if (f == null) return null
  return Number(f).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

export default function ArvoreDePorcionamento() {
  const [linhas, setLinhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const [item, setItem] = useState(null)
  const [derivaDe, setDerivaDe] = useState(null)
  const [fator, setFator] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function carregar() {
    try {
      setLinhas(await listarFatoresCorrecao())
      setErro('')
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }
  useEffect(() => { carregar() }, [])

  async function adicionar() {
    setErro('')
    if (!item || !derivaDe) { setErro('Escolha o item e de onde ele deriva.'); return }
    const texto = fator.trim()
    const f = texto ? Number(texto.replace(',', '.')) : null
    if (texto && (!isFinite(f) || f <= 0)) { setErro('Fator inválido (ex.: 1,25) — ou deixe em branco se ainda não souber.'); return }
    setSalvando(true)
    try {
      await criarFatorCorrecao({ porcionadoId: item.id, cruId: derivaDe.id, fator: f })
      setItem(null)
      setDerivaDe(null)
      setFator('')
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function remover(id) {
    if (!window.confirm('Remover esse item da lista? Quem derivava dele continua existindo, só perde essa ligação.')) return
    try {
      await removerFatorCorrecao(id)
      await carregar()
    } catch (e) {
      setErro(e.message)
    }
  }

  const linhasOrdenadas = [...linhas]
    .filter((l) => l.porcionado && l.cru)
    .sort((a, b) => a.porcionado.nome.localeCompare(b.porcionado.nome))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Novo item derivado</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ProdutoPicker label="Item" selecionado={item} onSelecionar={setItem} placeholder="ex.: PP Filet Mignon Limpeza" />
          <ProdutoPicker label="Deriva de" selecionado={derivaDe} onSelecionar={setDerivaDe} placeholder="ex.: Bovino Filet Mignon Peça" />
          <div>
            <label className="muted">Fator — opcional (quanto do item de origem por 1 deste item)</label>
            <input type="text" inputMode="decimal" value={fator} onChange={(e) => setFator(e.target.value)} placeholder="ex.: 1,25 — pode deixar em branco" />
          </div>
          {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}
          <button className="primary" onClick={adicionar} disabled={salvando || !item || !derivaDe}>
            {salvando ? 'Salvando…' : 'Adicionar'}
          </button>
        </div>
      </div>

      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Itens cadastrados</p>
        {carregando ? (
          <p className="muted">Carregando…</p>
        ) : linhasOrdenadas.length === 0 ? (
          <p className="muted">Nenhum item cadastrado ainda.</p>
        ) : (
          linhasOrdenadas.map((l) => (
            <div key={l.id} className="list-item">
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 500 }}>{l.porcionado.nome}</p>
                <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
                  deriva de <strong>{l.cru.nome}</strong>
                  {' · '}
                  {l.fator != null ? `fator ${fmtFator(l.fator)}` : <span style={{ color: 'var(--warning)' }}>sem fator ainda</span>}
                </p>
              </div>
              <button className="ghost" onClick={() => remover(l.id)} style={{ color: 'var(--danger)', flexShrink: 0 }}>remover</button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
