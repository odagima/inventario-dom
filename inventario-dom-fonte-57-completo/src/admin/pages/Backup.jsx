import { useState } from 'react'
import { gerarBackupApp, TABELAS_BACKUP_APP } from '../lib/adminApi'

export default function Backup() {
  const [gerando, setGerando] = useState(false)
  const [resumo, setResumo] = useState(null)
  const [erro, setErro] = useState('')

  async function baixar() {
    setGerando(true); setErro(''); setResumo(null)
    try {
      const { backup, resumo } = await gerarBackupApp()
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const hoje = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `backup-inventario-dom-${hoje}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setResumo(resumo)
    } catch (e) {
      setErro('Não consegui gerar o backup: ' + e.message)
    } finally {
      setGerando(false)
    }
  }

  return (
    <div>
      <div className="app-header" style={{ marginBottom: 10 }}>
        <p className="brand">Backup</p>
        <p className="subtitle">Baixa tudo o que foi criado no app (contagens, inventário, grupos, fatores, produção). O que vem do Everest não entra — é reimportável.</p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ margin: '0 0 8px', fontWeight: 600 }}>O que entra no backup</p>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
          {TABELAS_BACKUP_APP.join(' · ')}
        </p>
        <p className="muted" style={{ margin: '0 0 16px', fontSize: 13 }}>
          <strong style={{ color: 'var(--text)' }}>Fora do backup (vêm do Everest):</strong> produtos, fichas técnicas, vendas, compras. Esses você reimporta.
        </p>
        <button className="primary" onClick={baixar} disabled={gerando} style={{ width: '100%' }}>
          {gerando ? 'Gerando backup…' : 'Baixar backup (.json)'}
        </button>
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{erro}</p>}
      </div>

      {resumo && (
        <div className="card">
          <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Backup gerado ✓</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(resumo).map(([tabela, n]) => (
              <div key={tabela} className="list-item" style={{ padding: '6px 0' }}>
                <span style={{ fontSize: 13 }}>{tabela}</span>
                <span className="muted" style={{ fontSize: 13 }}>{typeof n === 'number' ? `${n} registros` : n}</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
            Guarde esse arquivo antes de limpar/zerar qualquer base. Ele é o que permite subir tudo de novo.
          </p>
        </div>
      )}
    </div>
  )
}
