import { useEffect, useState } from 'react'
import { buscarResumoGeral } from '../lib/adminApi'

const NOMES_MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

export default function ResumoMesVigente() {
  const [resumo, setResumo] = useState(null)

  useEffect(() => {
    buscarResumoGeral().then(setResumo).catch(() => {})
    const intervalo = setInterval(() => {
      buscarResumoGeral().then(setResumo).catch(() => {})
    }, 30000)
    return () => clearInterval(intervalo)
  }, [])

  if (!resumo) return null

  if (!resumo.mesAtivo) {
    return (
      <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 14 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nenhum mês liberado ainda pro inventário mensal.</p>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 14 }}>
      <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 14 }}>
        {NOMES_MES[resumo.mesAtivo - 1]}/{resumo.anoAtivo}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 12 }}>Itens contados</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{resumo.totalItensContados}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 12 }}>Pessoas envolvidas</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{resumo.totalPessoas}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 12 }}>Lojas concluídas</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{resumo.lojasCompletas} de {resumo.totalLojas}</span>
        </div>
      </div>
    </div>
  )
}
