import { useEffect, useState } from 'react'
import { listarUnidadesAdmin, criarUnidade, atualizarUnidade } from '../lib/adminApi'

export default function Unidades() {
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

  // Agrupa as unidades já existentes por CNPJ, pra oferecer "vincular ao mesmo CNPJ de X"
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
      setNome('')
      setCnpjNovo('')
      setCodigoDeposito('')
      setGrupoCnpj('')
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
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
              <option value="__novo__">Novo CNPJ (unidade independente)</option>
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
