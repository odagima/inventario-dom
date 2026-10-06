import { useEffect, useRef, useState } from 'react'
import { buscarProdutosParaFator, listarFatoresCorrecao, criarFatorCorrecao, removerFatorCorrecao } from '../lib/adminApi'

// Árvore de porcionamento (06/10/2026, pedido do Felipe): "pegar todos os itens que existe um
// porcionamento, e ter isso como base... deixar disponível pra alteração, incluir ou excluir
// qualquer item que seja derivado dele." É a MESMA tabela `fatores_correcao` que a Produção usa
// pra filtrar o que mostrar na saída de cada etapa (ver `filhosDiretos` em
// src/lib/fatoresCorrecaoApi.js) — essa tela só dá uma forma visual (em árvore, por nível) de
// editar essas ligações, sem precisar de SQL a cada novo item (como foi feito manualmente nas
// migrations v16/v17).
//
// Era `FatoresCorrecao.jsx` — ficou parado desde 07/08/2026 porque o CMV parou de usar essa
// tabela (ver DECISOES-TRAVADAS.md §19.5), mas ela voltou a ser usada pela Produção desde então;
// o aviso de "fora de uso" saiu, e a tela virou editor de árvore em vez de lista de pares soltos.
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

// Formulário pra adicionar UM derivado direto de `paiId` — usado em todo nó da árvore.
function FormDerivado({ paiId, onCriado, onCancelar }) {
  const [produto, setProduto] = useState(null)
  const [fator, setFator] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setErro('')
    if (!produto) { setErro('Escolha o item derivado.'); return }
    const texto = fator.trim()
    const f = texto ? Number(texto.replace(',', '.')) : null
    if (texto && (!isFinite(f) || f <= 0)) { setErro('Fator inválido (ex.: 1,25) — ou deixe em branco se ainda não souber.'); return }
    setSalvando(true)
    try {
      await criarFatorCorrecao({ porcionadoId: produto.id, cruId: paiId, fator: f })
      onCriado()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 8, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ProdutoPicker label="Item derivado" selecionado={produto} onSelecionar={setProduto} placeholder="Buscar produto…" />
      <div>
        <label className="muted">Fator — opcional (quanto deste nível por 1 do pai)</label>
        <input type="text" inputMode="decimal" value={fator} onChange={(e) => setFator(e.target.value)} placeholder="ex.: 1,25 — pode deixar em branco" />
      </div>
      {erro && <p style={{ color: 'var(--danger)', fontSize: 12.5, margin: 0 }}>{erro}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancelar} disabled={salvando} style={{ flex: 1 }}>Cancelar</button>
        <button className="primary" onClick={salvar} disabled={salvando} style={{ flex: 1 }}>{salvando ? 'Salvando…' : 'Adicionar'}</button>
      </div>
    </div>
  )
}

// Começar uma árvore nova — pede os DOIS produtos (raiz + primeiro derivado) porque a raiz só
// "existe" na tela quando tem pelo menos um filho apontando pra ela.
function FormNovaArvore({ onCriado, onCancelar }) {
  const [raiz, setRaiz] = useState(null)
  const [derivado, setDerivado] = useState(null)
  const [fator, setFator] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setErro('')
    if (!raiz || !derivado) { setErro('Escolha o insumo base e o primeiro item derivado.'); return }
    const texto = fator.trim()
    const f = texto ? Number(texto.replace(',', '.')) : null
    if (texto && (!isFinite(f) || f <= 0)) { setErro('Fator inválido — ou deixe em branco.'); return }
    setSalvando(true)
    try {
      await criarFatorCorrecao({ porcionadoId: derivado.id, cruId: raiz.id, fator: f })
      onCriado()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ProdutoPicker label="Insumo base (a raiz da árvore)" selecionado={raiz} onSelecionar={setRaiz} placeholder="ex.: Bovino Filet Mignon Peça" />
      <ProdutoPicker label="Primeiro item derivado" selecionado={derivado} onSelecionar={setDerivado} placeholder="ex.: Limpeza" />
      <div>
        <label className="muted">Fator — opcional</label>
        <input type="text" inputMode="decimal" value={fator} onChange={(e) => setFator(e.target.value)} placeholder="pode deixar em branco" />
      </div>
      {erro && <p style={{ color: 'var(--danger)', fontSize: 12.5, margin: 0 }}>{erro}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancelar} disabled={salvando} style={{ flex: 1 }}>Cancelar</button>
        <button className="primary" onClick={salvar} disabled={salvando} style={{ flex: 1 }}>{salvando ? 'Salvando…' : 'Criar'}</button>
      </div>
    </div>
  )
}

function No({ produto, fatorId, fator, nivel, filhosPorPaiId, onRemover, onMudou }) {
  const [adicionando, setAdicionando] = useState(false)
  const filhos = filhosPorPaiId[produto.id] || []

  return (
    <div style={{ marginLeft: nivel === 0 ? 0 : 20, borderLeft: nivel === 0 ? 'none' : '1px dashed var(--border)', paddingLeft: nivel === 0 ? 0 : 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0' }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontWeight: nivel === 0 ? 700 : 500, fontSize: nivel === 0 ? 15 : 13.5 }}>{produto.nome}</span>
          <span className="muted" style={{ fontSize: 10.5, marginLeft: 8 }}>nível {nivel + 1}</span>
          {fatorId && (
            fator != null
              ? <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>fator {fmtFator(fator)}</span>
              : <span style={{ fontSize: 11, marginLeft: 8, color: 'var(--warning)' }}>sem fator ainda</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button className="ghost" onClick={() => setAdicionando((v) => !v)} style={{ fontSize: 11.5, padding: '5px 8px' }}>+ derivado</button>
          {fatorId && (
            <button className="ghost" onClick={() => onRemover(fatorId)} style={{ fontSize: 11.5, padding: '5px 8px', color: 'var(--danger)' }}>remover</button>
          )}
        </div>
      </div>

      {adicionando && (
        <FormDerivado paiId={produto.id} onCriado={() => { setAdicionando(false); onMudou() }} onCancelar={() => setAdicionando(false)} />
      )}

      {filhos.map((f) => (
        <No
          key={f.id}
          produto={f.porcionado}
          fatorId={f.id}
          fator={f.fator}
          nivel={nivel + 1}
          filhosPorPaiId={filhosPorPaiId}
          onRemover={onRemover}
          onMudou={onMudou}
        />
      ))}
    </div>
  )
}

export default function ArvoreDePorcionamento() {
  const [linhas, setLinhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [adicionandoRaiz, setAdicionandoRaiz] = useState(false)

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

  async function remover(id) {
    if (!window.confirm('Remover esse item da árvore? Os derivados dele continuam existindo, só perdem a ligação com esse pai.')) return
    try {
      await removerFatorCorrecao(id)
      await carregar()
    } catch (e) {
      setErro(e.message)
    }
  }

  if (carregando) return <div className="card"><p className="muted">Carregando…</p></div>

  // Agrupa por pai (cru) e acha as RAÍZES: todo "cru" que nunca aparece como "porcionado" de
  // outra linha — ou seja, não tem pai conhecido.
  const filhosPorPaiId = {}
  const produtoPorId = {}
  linhas.forEach((l) => {
    if (!l.porcionado || !l.cru) return
    produtoPorId[l.cru.id] = l.cru
    produtoPorId[l.porcionado.id] = l.porcionado
    if (!filhosPorPaiId[l.cru.id]) filhosPorPaiId[l.cru.id] = []
    filhosPorPaiId[l.cru.id].push(l)
  })
  const idsQueSaoFilhos = new Set(linhas.map((l) => l.porcionado?.id).filter(Boolean))
  const raizesIds = [...new Set(linhas.map((l) => l.cru?.id).filter(Boolean))].filter((id) => !idsQueSaoFilhos.has(id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Árvore de porcionamento</p>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          A mesma árvore que a Produção usa pra filtrar o que mostrar na saída de cada etapa. Inclua ou remova
          qualquer item derivado — o fator (rendimento) é opcional, dá pra marcar a ordem do processo antes de
          medir quanto rende de verdade.
        </p>
      </div>

      {erro && <div className="card"><p style={{ color: 'var(--danger)' }}>{erro}</p></div>}

      <div className="card">
        {raizesIds.length === 0 && <p className="muted" style={{ marginBottom: adicionandoRaiz ? 10 : 0 }}>Nenhuma árvore cadastrada ainda.</p>}
        {raizesIds.map((id) => (
          <No
            key={id}
            produto={produtoPorId[id]}
            fatorId={null}
            fator={null}
            nivel={0}
            filhosPorPaiId={filhosPorPaiId}
            onRemover={remover}
            onMudou={carregar}
          />
        ))}

        {adicionandoRaiz ? (
          <FormNovaArvore onCriado={() => { setAdicionandoRaiz(false); carregar() }} onCancelar={() => setAdicionandoRaiz(false)} />
        ) : (
          <button className="ghost" onClick={() => setAdicionandoRaiz(true)} style={{ marginTop: 10 }}>+ Começar uma árvore nova (insumo base)</button>
        )}
      </div>
    </div>
  )
}
