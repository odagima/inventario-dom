import { useEffect, useRef, useState } from 'react'
import {
  listarGruposAdmin,
  criarGrupo,
  deletarGrupo,
  listarItensDoGrupoAdmin,
  adicionarItemGrupo,
  removerItemGrupo,
  buscarProdutosAdmin
} from '../lib/adminApi'

export default function Grupos() {
  const [grupos, setGrupos] = useState([])
  const [grupoAberto, setGrupoAberto] = useState(null)
  const [itensGrupo, setItensGrupo] = useState([])
  const [novoNomeGrupo, setNovoNomeGrupo] = useState('')
  const [buscaItem, setBuscaItem] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState([])
  const [carregando, setCarregando] = useState(true)
  const debounceRef = useRef(null)

  useEffect(() => { carregarGrupos() }, [])

  async function carregarGrupos() {
    setCarregando(true)
    try {
      setGrupos(await listarGruposAdmin())
    } finally {
      setCarregando(false)
    }
  }

  async function abrirGrupo(grupo) {
    setGrupoAberto(grupo)
    setItensGrupo(await listarItensDoGrupoAdmin(grupo.id))
  }

  async function handleCriarGrupo() {
    if (!novoNomeGrupo.trim()) return
    const grupo = await criarGrupo(novoNomeGrupo.trim())
    setNovoNomeGrupo('')
    await carregarGrupos()
    abrirGrupo({ id: grupo.id, nome: grupo.nome, totalItens: 0 })
  }

  async function handleDeletarGrupo(grupoId) {
    await deletarGrupo(grupoId)
    if (grupoAberto?.id === grupoId) setGrupoAberto(null)
    await carregarGrupos()
  }

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (buscaItem.trim().length < 2) { setResultadosBusca([]); return }
    debounceRef.current = setTimeout(async () => {
      setResultadosBusca(await buscarProdutosAdmin(buscaItem))
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [buscaItem])

  async function handleAdicionarItem(produto) {
    if (itensGrupo.some((p) => p.id === produto.id)) return
    await adicionarItemGrupo(grupoAberto.id, produto.id)
    setItensGrupo((prev) => [...prev, produto])
  }

  async function handleRemoverItem(produtoId) {
    await removerItemGrupo(grupoAberto.id, produtoId)
    setItensGrupo((prev) => prev.filter((p) => p.id !== produtoId))
  }

  if (grupoAberto) {
    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{grupoAberto.nome}</p>
          <button onClick={() => setGrupoAberto(null)} style={{ padding: '4px 8px', fontSize: 12 }}>voltar</button>
        </div>

        <label className="muted">Adicionar item ao grupo</label>
        <input value={buscaItem} onChange={(e) => setBuscaItem(e.target.value)} placeholder="Digite o nome ou código do produto" style={{ margin: '4px 0 8px' }} autoFocus />
        {buscaItem.trim().length >= 2 && (
          <div className="card" style={{ padding: 0, marginBottom: 14, maxHeight: 280, overflowY: 'auto' }}>
            {resultadosBusca.length === 0 ? (
              <p className="muted" style={{ padding: '12px 14px', margin: 0 }}>Nenhum produto encontrado.</p>
            ) : (
              resultadosBusca.map((p) => {
                const jaAdicionado = itensGrupo.some((it) => it.id === p.id)
                return (
                  <div key={p.id} className="list-item" style={{ padding: '10px 14px' }}>
                    <div>
                      <p style={{ margin: 0 }}>{p.nome}</p>
                      <p className="muted" style={{ margin: 0 }}>Everest {p.codigo_everest || '—'} · {p.unidade_medida}</p>
                    </div>
                    <button
                      onClick={() => handleAdicionarItem(p)}
                      disabled={jaAdicionado}
                      className={jaAdicionado ? '' : 'primary'}
                      style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0 }}
                    >
                      {jaAdicionado ? 'Já incluído ✓' : '+ Adicionar'}
                    </button>
                  </div>
                )
              })
            )}
          </div>
        )}

        <p className="muted" style={{ marginBottom: 6 }}>Itens no grupo ({itensGrupo.length})</p>
        {itensGrupo.length === 0 ? (
          <p className="muted">Nenhum item ainda — busque acima pra adicionar.</p>
        ) : (
          itensGrupo.map((p) => (
            <div key={p.id} className="list-item">
              <span>{p.nome}</span>
              <button onClick={() => handleRemoverItem(p.id)} style={{ fontSize: 16, background: 'none', border: 'none', color: 'var(--danger)' }}>×</button>
            </div>
          ))
        )}
      </div>
    )
  }

  return (
    <div className="card">
      <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Grupos de contagem parcial</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={novoNomeGrupo} onChange={(e) => setNovoNomeGrupo(e.target.value)} placeholder="Nome do novo grupo (ex: Laticínios)" />
        <button className="primary" onClick={handleCriarGrupo} style={{ flexShrink: 0 }}>Criar</button>
      </div>

      {carregando ? (
        <p className="muted">Carregando…</p>
      ) : grupos.length === 0 ? (
        <p className="muted">Nenhum grupo criado ainda.</p>
      ) : (
        grupos.map((g) => (
          <div key={g.id} className="list-item">
            <div style={{ cursor: 'pointer' }} onClick={() => abrirGrupo(g)}>
              <p style={{ margin: 0 }}>{g.nome}</p>
              <p className="muted" style={{ margin: 0 }}>{g.totalItens} {g.totalItens === 1 ? 'item' : 'itens'}</p>
            </div>
            <button onClick={() => handleDeletarGrupo(g.id)} style={{ padding: '4px 8px', fontSize: 12 }}>Excluir</button>
          </div>
        ))
      )}
    </div>
  )
}
