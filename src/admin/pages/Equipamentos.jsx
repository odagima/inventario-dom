import { useEffect, useState } from 'react'
import { listarEquipamentos, criarEquipamento, atualizarEquipamento, removerEquipamento } from '../../lib/equipamentosApi'
import { listarLocaisEstoque } from '../../lib/locaisEstoqueApi'

const ESTADOS = [
  { valor: 'funcionando', label: 'Funcionando' },
  { valor: 'manutencao', label: 'Em manutenção' },
  { valor: 'quebrado', label: 'Quebrado' }
]

// Cadastro de equipamentos (07/10/2026, pedido do Felipe). Mesmo molde de Unidades.jsx — lista
// simples, sem fluxo por trás.
export default function Equipamentos() {
  const [equipamentos, setEquipamentos] = useState([])
  const [locais, setLocais] = useState([])
  const [carregando, setCarregando] = useState(true)

  const [nome, setNome] = useState('')
  const [localEstoqueId, setLocalEstoqueId] = useState('')
  const [numeroPatrimonio, setNumeroPatrimonio] = useState('')
  const [valor, setValor] = useState('')
  const [dataAquisicao, setDataAquisicao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      const [e, l] = await Promise.all([listarEquipamentos(), listarLocaisEstoque()])
      setEquipamentos(e)
      setLocais(l)
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
      await criarEquipamento({
        nome: nome.trim(),
        localEstoqueId: localEstoqueId || null,
        numeroPatrimonio: numeroPatrimonio.trim(),
        valor: valor ? Number(valor.replace(',', '.')) : null,
        dataAquisicao: dataAquisicao || null
      })
      setNome(''); setLocalEstoqueId(''); setNumeroPatrimonio(''); setValor(''); setDataAquisicao('')
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleAtualizarCampo(eq, campo, valorNovo) {
    await atualizarEquipamento(eq.id, { [campo]: valorNovo })
    setEquipamentos((prev) => prev.map((x) => (x.id === eq.id ? { ...x, [campo]: valorNovo } : x)))
  }

  async function handleRemover(eq) {
    if (!window.confirm(`Excluir ${eq.nome} do cadastro?`)) return
    await removerEquipamento(eq.id)
    await carregar()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Novo equipamento</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="muted">Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Câmara fria 2" />
          </div>
          <div>
            <label className="muted">Local onde está</label>
            <select value={localEstoqueId} onChange={(e) => setLocalEstoqueId(e.target.value)}>
              <option value="">Selecione…</option>
              {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="muted">Número de patrimônio</label>
            <input value={numeroPatrimonio} onChange={(e) => setNumeroPatrimonio(e.target.value)} placeholder="Opcional" />
          </div>
          <div>
            <label className="muted">Valor</label>
            <input type="text" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Opcional" />
          </div>
          <div>
            <label className="muted">Data de aquisição</label>
            <input type="date" value={dataAquisicao} onChange={(e) => setDataAquisicao(e.target.value)} />
          </div>
          {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
          <button className="primary" onClick={handleCriar} disabled={salvando || !nome.trim()}>
            {salvando ? 'Criando…' : 'Criar equipamento'}
          </button>
        </div>
      </div>

      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Equipamentos cadastrados</p>
        {carregando ? (
          <p className="muted">Carregando…</p>
        ) : equipamentos.length === 0 ? (
          <p className="muted">Nenhum equipamento cadastrado ainda.</p>
        ) : (
          equipamentos.map((eq) => (
            <div key={eq.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <p style={{ margin: 0, fontWeight: 500 }}>{eq.nome}</p>
                <button className="ghost" onClick={() => handleRemover(eq)} style={{ color: 'var(--danger)' }}>excluir</button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select
                  defaultValue={eq.estado}
                  onChange={(e) => handleAtualizarCampo(eq, 'estado', e.target.value)}
                  style={{ flex: 1, minWidth: 140, fontSize: 13 }}
                >
                  {ESTADOS.map((s) => <option key={s.valor} value={s.valor}>{s.label}</option>)}
                </select>
                <input
                  defaultValue={eq.numero_patrimonio || ''}
                  placeholder="Nº patrimônio"
                  onBlur={(e) => handleAtualizarCampo(eq, 'numero_patrimonio', e.target.value)}
                  style={{ flex: 1, minWidth: 120, fontSize: 13 }}
                />
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>{eq.local?.nome || 'sem local vinculado'}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
