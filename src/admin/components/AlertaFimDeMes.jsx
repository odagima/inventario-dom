import { useEffect, useState } from 'react'
import { buscarConfiguracaoGeral } from '../../lib/api'

function diasRestantesNoMes() {
  const hoje = new Date()
  const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
  return Math.ceil((ultimoDia - hoje) / (1000 * 60 * 60 * 24))
}

export default function AlertaFimDeMes({ onIrParaConfiguracao }) {
  const [config, setConfig] = useState(null)

  useEffect(() => { buscarConfiguracaoGeral().then(setConfig).catch(() => {}) }, [])

  if (!config) return null

  const hoje = new Date()
  const dias = diasRestantesNoMes()
  const mesJaLiberado = config.mesAtivoMensal === hoje.getMonth() + 1 && config.anoAtivoMensal === hoje.getFullYear()

  if (dias > 7 || mesJaLiberado) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: '0 0 16px' }}>
        Faltam {dias} {dias === 1 ? 'dia' : 'dias'} pro fim do mês.
      </p>
    )
  }

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(255,159,10,0.18), rgba(255,107,107,0.14))',
        border: '0.5px solid rgba(255,159,10,0.35)', borderRadius: 14, padding: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap'
      }}
    >
      <div>
        <p style={{ margin: 0, fontWeight: 600 }}>
          Faltam {dias} {dias === 1 ? 'dia' : 'dias'} pro fechamento do mês
        </p>
        <p className="muted" style={{ margin: '2px 0 0' }}>O inventário mensal desse mês ainda não foi liberado pras lojas.</p>
      </div>
      <button className="primary" onClick={onIrParaConfiguracao} style={{ fontWeight: 600 }}>
        Liberar mês agora
      </button>
    </div>
  )
}
