import { useEffect, useState } from 'react'
import { listarFuncionarios, criarFuncionario, atualizarFuncionario, removerFuncionario } from '../../lib/funcionariosApi'
import { listarUnidadesAdmin } from '../lib/adminApi'

// Cadastro de funcionários (07/10/2026, pedido do Felipe: "cargos e salários... preciso consultar
// e editar"). Mesmo molde de Unidades.jsx — lista simples, sem fluxo por trás.
export default function Funcionarios() {
  const [funcionarios, setFuncionarios] = useState([])
  const [unidades, setUnidades] = useState([])
  const [carregando, setCarregando] = useState(true)

  const [nome, setNome] = useState('')
  const [cargo, setCargo] = useState('')
  const [salario, setSalario] = useState('')
  const [unidadeId, setUnidadeId] = useState('')
  const [telefone, setTelefone] = useState('')
  const [dataAdmissao, setDataAdmissao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      const [f, u] = await Promise.all([listarFuncionarios(), listarUnidadesAdmin()])
      setFuncionarios(f)
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
      await criarFuncionario({
        nome: nome.trim(),
        cargo: cargo.trim(),
        salario: salario ? Number(salario.replace(',', '.')) : null,
        unidadeId: unidadeId || null,
        telefone: telefone.trim(),
        dataAdmissao: dataAdmissao || null
      })
      setNome(''); setCargo(''); setSalario(''); setUnidadeId(''); setTelefone(''); setDataAdmissao('')
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleAtualizarCampo(f, campo, valor) {
    await atualizarFuncionario(f.id, { [campo]: valor })
    setFuncionarios((prev) => prev.map((x) => (x.id === f.id ? { ...x, [campo]: valor } : x)))
  }

  async function handleRemover(f) {
    if (!window.confirm(`Excluir ${f.nome} do cadastro?`)) return
    await removerFuncionario(f.id)
    await carregar()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Novo funcionário</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="muted">Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" />
          </div>
          <div>
            <label className="muted">Cargo</label>
            <input value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ex: Cozinheiro" />
          </div>
          <div>
            <label className="muted">Salário</label>
            <input type="text" inputMode="decimal" value={salario} onChange={(e) => setSalario(e.target.value)} placeholder="Ex: 2500,00" />
          </div>
          <div>
            <label className="muted">Loja</label>
            <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
              <option value="">Selecione…</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="muted">Telefone</label>
            <input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Opcional" />
          </div>
          <div>
            <label className="muted">Data de admissão</label>
            <input type="date" value={dataAdmissao} onChange={(e) => setDataAdmissao(e.target.value)} />
          </div>
          {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
          <button className="primary" onClick={handleCriar} disabled={salvando || !nome.trim()}>
            {salvando ? 'Criando…' : 'Criar funcionário'}
          </button>
        </div>
      </div>

      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Funcionários cadastrados</p>
        {carregando ? (
          <p className="muted">Carregando…</p>
        ) : funcionarios.length === 0 ? (
          <p className="muted">Nenhum funcionário cadastrado ainda.</p>
        ) : (
          funcionarios.map((f) => (
            <div key={f.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <p style={{ margin: 0, fontWeight: 500 }}>{f.nome}</p>
                <button className="ghost" onClick={() => handleRemover(f)} style={{ color: 'var(--danger)' }}>excluir</button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  defaultValue={f.cargo || ''}
                  placeholder="Cargo"
                  onBlur={(e) => handleAtualizarCampo(f, 'cargo', e.target.value)}
                  style={{ flex: 1, minWidth: 120, fontSize: 13 }}
                />
                <input
                  defaultValue={f.salario ?? ''}
                  placeholder="Salário"
                  inputMode="decimal"
                  onBlur={(e) => handleAtualizarCampo(f, 'salario', e.target.value ? Number(e.target.value.replace(',', '.')) : null)}
                  style={{ flex: 1, minWidth: 100, fontSize: 13 }}
                />
                <input
                  defaultValue={f.telefone || ''}
                  placeholder="Telefone"
                  onBlur={(e) => handleAtualizarCampo(f, 'telefone', e.target.value)}
                  style={{ flex: 1, minWidth: 120, fontSize: 13 }}
                />
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>{f.unidade?.nome || 'sem loja vinculada'}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
