import { useEffect, useState } from 'react'
import { listarUsuariosApp, criarUsuarioApp, atualizarUsuarioApp, deletarUsuarioApp } from '../lib/adminApi'

const NIVEIS = [
  { valor: 'administrativo', label: 'Administrativo', descricao: 'Acesso total, inclusive Administrativo' },
  { valor: 'estoque_compras', label: 'Estoque/Compras', descricao: 'Lançamentos + Cadastros' },
  { valor: 'operacao', label: 'Operação', descricao: 'Só lançamentos' }
]
const LABEL_NIVEL = Object.fromEntries(NIVEIS.map((n) => [n.valor, n.label]))

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [codigo, setCodigo] = useState('')
  const [nivel, setNivel] = useState('operacao')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      setUsuarios(await listarUsuariosApp())
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  async function handleCriar() {
    setErro('')
    if (!nome.trim()) return
    if (!/^[0-9]{4}$/.test(codigo)) { setErro('O código precisa ter exatamente 4 números.'); return }
    setSalvando(true)
    try {
      await criarUsuarioApp(nome.trim(), codigo, nivel)
      setNome('')
      setCodigo('')
      setNivel('operacao')
      await carregar()
    } catch (e) {
      setErro(e.message.includes('duplicate') || e.message.includes('unique') ? 'Esse código já está em uso por outra pessoa.' : e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleToggleAtivo(usuario) {
    await atualizarUsuarioApp(usuario.id, { ativo: !usuario.ativo })
    setUsuarios((prev) => prev.map((u) => (u.id === usuario.id ? { ...u, ativo: !u.ativo } : u)))
  }

  async function handleMudarNivel(usuario, novoNivel) {
    await atualizarUsuarioApp(usuario.id, { nivel_acesso: novoNivel })
    setUsuarios((prev) => prev.map((u) => (u.id === usuario.id ? { ...u, nivel_acesso: novoNivel } : u)))
  }

  async function handleExcluir(usuario) {
    await deletarUsuarioApp(usuario.id)
    setUsuarios((prev) => prev.filter((u) => u.id !== usuario.id))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Nova pessoa</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" style={{ flex: 2, minWidth: 160 }} />
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="Código (4 números)"
            inputMode="numeric"
            style={{ flex: 1, minWidth: 120 }}
          />
        </div>
        <label className="muted">Nível de acesso</label>
        <select value={nivel} onChange={(e) => setNivel(e.target.value)} style={{ margin: '4px 0 10px' }}>
          {NIVEIS.map((n) => <option key={n.valor} value={n.valor}>{n.label} — {n.descricao}</option>)}
        </select>
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{erro}</p>}
        <button className="primary" onClick={handleCriar} disabled={salvando || !nome.trim() || codigo.length !== 4} style={{ width: '100%' }}>
          {salvando ? 'Salvando…' : 'Criar acesso'}
        </button>
      </div>

      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Pessoas cadastradas</p>
        {carregando ? (
          <p className="muted">Carregando…</p>
        ) : usuarios.length === 0 ? (
          <p className="muted">Nenhuma pessoa cadastrada ainda.</p>
        ) : (
          usuarios.map((u) => (
            <div key={u.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: 0 }}>{u.nome_completo}</p>
                  <p className="muted" style={{ margin: 0 }}>Código {u.pin} · {u.ativo ? 'ativo' : 'inativo'}</p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => handleToggleAtivo(u)}>
                    {u.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                  <button style={{ padding: '4px 8px', fontSize: 12, color: 'var(--danger)' }} onClick={() => handleExcluir(u)}>Excluir</button>
                </div>
              </div>
              <select value={u.nivel_acesso} onChange={(e) => handleMudarNivel(u, e.target.value)} style={{ fontSize: 13 }}>
                {NIVEIS.map((n) => <option key={n.valor} value={n.valor}>{n.label}</option>)}
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
