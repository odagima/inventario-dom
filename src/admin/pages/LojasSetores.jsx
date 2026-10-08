import { useEffect, useState } from 'react'
import { listarUnidadesAdmin, criarUnidade, atualizarUnidade } from '../lib/adminApi'
import { listarLocaisEstoqueTodos, criarLocalEstoque, atualizarLocalEstoque } from '../../lib/locaisEstoqueApi'

// Página única de Lojas + Setores (08/10/2026, pedido do Felipe: "faça um levantamento, veja tudo
// que estiver incoerente... quero uma página só pra arrumar essa tabela, pois vai ser dela que
// vamos puxar e padronizar a informação"). Antes, Loja vivia em Configuração → Lojas
// (Unidades.jsx) e Setor vivia dentro de Produção → Locais de estoque, cada um com seu próprio
// cadastro, espalhados em grupos de menu diferentes — difícil de achar ("vejo no adm onde estão
// as informações de loja... quais as lojas? quais setores?").
//
// Nomenclatura padronizada a partir daqui (o resto do app foi revisado junto):
//   Loja  = entidade jurídica/CNPJ (tabela `unidades`) — "Dalva e Dito", "DOM".
//   Setor = área operacional onde se produz/estoca (tabela `locais_estoque`, era "frente") —
//           "Confeitaria", "Produção", "Serviço Dalva". Usuário também chama de "praça" na fala,
//           mas a UI sempre escreve "Setor" pra não ter duas palavras pro mesmo cadastro.
// Todo lançamento do app (Perdas, Produção, Recebimento, Abrir/Fechar praça) puxa de uma dessas
// duas tabelas — esta tela é onde se cadastra e organiza as duas, pra tudo mais continuar certo.
export default function LojasSetores() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SecaoLojas />
      <SecaoSetores />
    </div>
  )
}

function SecaoLojas() {
  const [unidades, setUnidades] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [grupoCnpj, setGrupoCnpj] = useState('')
  const [cnpjNovo, setCnpjNovo] = useState('')
  const [codigoDeposito, setCodigoDeposito] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      setUnidades(await listarUnidadesAdmin())
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  // Agrupa as lojas já existentes por CNPJ, pra oferecer "vincular ao mesmo CNPJ de X"
  const gruposExistentes = []
  const vistos = new Set()
  for (const u of unidades) {
    if (u.cnpj && !vistos.has(u.cnpj)) {
      vistos.add(u.cnpj)
      gruposExistentes.push({ cnpj: u.cnpj, nomeReferencia: u.nome })
    }
  }

  async function handleCriar() {
    if (!nome.trim()) return
    setErro('')
    setSalvando(true)
    try {
      const cnpjFinal = grupoCnpj === '__novo__' ? cnpjNovo.trim() : grupoCnpj
      await criarUnidade({ nome: nome.trim(), cnpj: cnpjFinal, codigoDeposito: codigoDeposito.trim() })
      setNome(''); setCnpjNovo(''); setCodigoDeposito(''); setGrupoCnpj('')
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleAtualizarCampo(unidade, campo, valor) {
    const dados = {
      cnpj: campo === 'cnpj' ? valor : unidade.cnpj,
      codigoDeposito: campo === 'codigo_deposito' ? valor : unidade.codigo_deposito
    }
    await atualizarUnidade(unidade.id, dados)
    setUnidades((prev) => prev.map((u) => (u.id === unidade.id ? { ...u, cnpj: dados.cnpj, codigo_deposito: dados.codigoDeposito } : u)))
  }

  return (
    <div>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 17 }}>Lojas</p>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>Entidade com CNPJ — usada na exportação contábil e no cadastro de pessoas.</p>

      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Nova loja</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="muted">Nome da loja</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Novo Bar" />
          </div>
          <div>
            <label className="muted">Vincular ao CNPJ de</label>
            <select value={grupoCnpj} onChange={(e) => setGrupoCnpj(e.target.value)}>
              <option value="">Selecione…</option>
              {gruposExistentes.map((g) => (
                <option key={g.cnpj} value={g.cnpj}>Mesmo CNPJ do {g.nomeReferencia} ({g.cnpj})</option>
              ))}
              <option value="__novo__">Novo CNPJ (loja independente)</option>
            </select>
          </div>
          {grupoCnpj === '__novo__' && (
            <div>
              <label className="muted">Novo CNPJ</label>
              <input value={cnpjNovo} onChange={(e) => setCnpjNovo(e.target.value)} placeholder="Só números" />
            </div>
          )}
          <div>
            <label className="muted">Código do depósito no Everest (opcional por enquanto)</label>
            <input value={codigoDeposito} onChange={(e) => setCodigoDeposito(e.target.value)} placeholder="Ex: 1" />
          </div>
          {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
          <button className="primary" onClick={handleCriar} disabled={salvando || !nome.trim()}>
            {salvando ? 'Criando…' : 'Criar loja'}
          </button>
        </div>
      </div>

      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Lojas cadastradas</p>
        {carregando ? (
          <p className="muted">Carregando…</p>
        ) : (
          unidades.map((u) => (
            <div key={u.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <p style={{ margin: 0, fontWeight: 500 }}>{u.nome}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  defaultValue={u.cnpj || ''}
                  placeholder="CNPJ"
                  onBlur={(e) => handleAtualizarCampo(u, 'cnpj', e.target.value)}
                  style={{ flex: 1, fontSize: 13 }}
                />
                <input
                  defaultValue={u.codigo_deposito || ''}
                  placeholder="Cód. depósito"
                  onBlur={(e) => handleAtualizarCampo(u, 'codigo_deposito', e.target.value)}
                  style={{ flex: 1, fontSize: 13 }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function SecaoSetores() {
  const [setores, setSetores] = useState([])
  const [unidades, setUnidades] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [unidadeId, setUnidadeId] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      const [s, u] = await Promise.all([listarLocaisEstoqueTodos(), listarUnidadesAdmin()])
      setSetores(s)
      setUnidades(u)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  async function handleCriar() {
    if (!nome.trim()) return
    setErro('')
    setSalvando(true)
    try {
      await criarLocalEstoque({ nome: nome.trim(), unidadeId: unidadeId || null })
      setNome(''); setUnidadeId('')
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleAtualizarCampo(s, campo, valor) {
    await atualizarLocalEstoque(s.id, { [campo]: valor })
    setSetores((prev) => prev.map((x) => (x.id === s.id ? { ...x, [campo]: valor } : x)))
  }

  return (
    <div>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 17 }}>Setores</p>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
        Área operacional onde se produz/estoca (Confeitaria, Produção, Serviço Dalva…) — é de onde
        Perdas, Produção, Recebimento e Abrir/Fechar praça puxam o local do lançamento.
      </p>

      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Novo setor</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label className="muted">Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Bar Dalva" />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label className="muted">Loja — opcional</label>
            <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
              <option value="">Nenhuma</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
          <button className="primary" onClick={handleCriar} disabled={salvando || !nome.trim()} style={{ height: 44 }}>
            {salvando ? 'Criando…' : 'Criar'}
          </button>
        </div>
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{erro}</p>}
      </div>

      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Setores cadastrados</p>
        {carregando ? (
          <p className="muted">Carregando…</p>
        ) : (
          setores.map((s) => (
            <div key={s.id} className="list-item" style={{ gap: 10 }}>
              <span style={{ flexShrink: 0 }}>{s.nome}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <select
                  value={s.unidade_id || ''}
                  onChange={(e) => handleAtualizarCampo(s, 'unidade_id', e.target.value || null)}
                  style={{ fontSize: 12.5, padding: '6px 8px' }}
                >
                  <option value="">Sem loja</option>
                  {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }} className="muted">
                  <input type="checkbox" checked={s.ativo} onChange={(e) => handleAtualizarCampo(s, 'ativo', e.target.checked)} />
                  ativo
                </label>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
