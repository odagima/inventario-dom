import { useEffect, useState } from 'react'
import { buscarConfiguracaoGeral } from '../../lib/api'
import { setConfiguracaoGeral } from '../lib/adminApi'

const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

export default function ConfiguracaoMensal() {
  const [mes, setMes] = useState('')
  const [ano, setAno] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      const config = await buscarConfiguracaoGeral()
      setMes(config.mesAtivoMensal || new Date().getMonth() + 1)
      setAno(config.anoAtivoMensal || new Date().getFullYear())
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  async function handleSalvar() {
    setSalvando(true)
    setMensagem('')
    try {
      await setConfiguracaoGeral(Number(mes), Number(ano))
      setMensagem('Mês ativo atualizado — vale pra todas as lojas.')
    } finally {
      setSalvando(false)
    }
  }

  if (carregando) return <div className="card"><p className="muted">Carregando…</p></div>

  return (
    <div className="card">
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Mês ativo do inventário mensal</p>
      <p className="muted" style={{ margin: '0 0 16px' }}>
        Só esse mês fica liberado pra começar uma contagem mensal — vale pra todas as lojas ao mesmo tempo.
        Os outros meses ficam bloqueados até você trocar aqui.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 2 }}>
          <label className="muted">Mês</label>
          <select value={mes} onChange={(e) => setMes(e.target.value)}>
            {NOMES_MES.map((nome, i) => <option key={i} value={i + 1}>{nome}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="muted">Ano</label>
          <select value={ano} onChange={(e) => setAno(e.target.value)}>
            {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      {mensagem && <p style={{ color: 'var(--success)', fontSize: 13, marginBottom: 12 }}>{mensagem}</p>}

      <button className="primary" onClick={handleSalvar} disabled={salvando} style={{ width: '100%' }}>
        {salvando ? 'Salvando…' : 'Liberar esse mês'}
      </button>
    </div>
  )
}
