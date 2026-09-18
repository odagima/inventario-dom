import { useEffect, useRef, useState } from 'react'
import {
  listarGruposAdmin,
  criarGrupo,
  deletarGrupo,
  editarNomeGrupo,
  ativarDesativarGrupo,
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
  // 03/09/2026 (§26.3, reposto): editar nome e ativar/desativar. O `adminApi` já tinha
  // `editarNomeGrupo` e `ativarDesativarGrupo` desde 24/08, mas esta tela não chamava nenhuma das
  // duas — a versão do repositório é anterior a essa entrega (ver §74).
  const [editandoId, setEditandoId] = useState(null)
  const [nomeEditado, setNomeEditado] = useState('')
  const [erro, setErro] = useState('')
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
    // `deletarGrupo` recusa quando o grupo já tem contagem (§26.3) — antes a FK só desvinculava a
    // sessão em silêncio. A mensagem vem do próprio adminApi e precisa aparecer na tela.
    setErro('')
    try {
      await deletarGrupo(grupoId)
      if (grupoAberto?.id === grupoId) setGrupoAberto(null)
      await carregarGrupos()
    } catch (e) {
      setErro(e.message)
    }
  }

  async function salvarNome(grupoId) {
    const nome = nomeEditado.trim()
    if (!nome) return
    setErro('')
    try {
      await editarNomeGrupo(grupoId, nome)
      setEditandoId(null)
      if (grupoAberto?.id === grupoId) setGrupoAberto((g) => ({ ...g, nome }))
      await carregarGrupos()
    } catch (e) {
      setErro(e.message)
    }
  }

  async function alternarAtivo(grupo) {
    setErro('')
    try {
      await ativarDesativarGrupo(grupo.id, !grupo.ativo)
      await carregarGrupos()
    } catch (e) {
      // Sem a migration_v12 a coluna `ativo` não existe — o adminApi devolve o texto dizendo
      // exatamente qual migração rodar, então basta mostrá-lo.
      setErro(e.message)
    }
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

      {erro && (
        <p style={{ color: 'var(--danger)', fontSize: 12.5, margin: '0 0 12px' }}>{erro}</p>
      )}

      {carregando ? (
        <p className="muted">Carregando…</p>
      ) : grupos.length === 0 ? (
        <p className="muted">Nenhum grupo criado ainda.</p>
      ) : (
        grupos.map((g) => (
          <div key={g.id} className="list-item" style={{ opacity: g.ativo ? 1 : 0.55 }}>
            {editandoId === g.id ? (
              <div style={{ display: 'flex', gap: 6, flex: 1, alignItems: 'center' }}>
                <input
                  value={nomeEditado}
                  onChange={(e) => setNomeEditado(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') salvarNome(g.id); if (e.key === 'Escape') setEditandoId(null) }}
                  autoFocus
                />
                <button className="primary" onClick={() => salvarNome(g.id)} style={{ padding: '4px 10px', fontSize: 12, flexShrink: 0 }}>Salvar</button>
                <button onClick={() => setEditandoId(null)} style={{ padding: '4px 8px', fontSize: 12, flexShrink: 0 }}>Cancelar</button>
              </div>
            ) : (
              <>
                <div style={{ cursor: 'pointer', minWidth: 0 }} onClick={() => abrirGrupo(g)}>
                  <p style={{ margin: 0 }}>
                    {g.nome}
                    {!g.ativo && <span className="muted" style={{ fontSize: 11 }}> · inativo</span>}
                  </p>
                  <p className="muted" style={{ margin: 0 }}>{g.totalItens} {g.totalItens === 1 ? 'item' : 'itens'}</p>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <label className="muted" style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 4 }} title="Grupo ativo (aparece nos filtros de contagem)">
                    <input type="checkbox" checked={!!g.ativo} onChange={() => alternarAtivo(g)} />
                    ativo
                  </label>
                  <button onClick={() => { setEditandoId(g.id); setNomeEditado(g.nome); setErro('') }} style={{ padding: '4px 8px', fontSize: 12 }}>Renomear</button>
                  <button onClick={() => handleDeletarGrupo(g.id)} style={{ padding: '4px 8px', fontSize: 12 }}>Excluir</button>
                </div>
              </>
            )}
          </div>
        ))
      )}
    </div>
  )
}
