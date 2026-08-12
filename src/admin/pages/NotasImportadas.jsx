import { useEffect, useState } from 'react'
import { buscarResumoNotasPorLojaMes } from '../lib/adminApi'

function formatarData(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR')
}

export default function NotasImportadas() {
  const [resumo, setResumo] = useState([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    buscarResumoNotasPorLojaMes().then(setResumo).finally(() => setCarregando(false))
  }, [])

  return (
    <div className="card">
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Notas importadas — resumo por loja e mês</p>
      <p className="muted" style={{ margin: '0 0 14px' }}>
        Controle do que já foi importado (NF-e + Compras). Serve de base pra montar a análise de preço dos itens comprados, mais pra frente.
      </p>

      {carregando ? (
        <p className="muted">Carregando…</p>
      ) : resumo.length === 0 ? (
        <p className="muted">Nenhuma nota importada ainda.</p>
      ) : (
        resumo.map((r) => (
          <div key={`${r.loja}-${r.chaveMes}`} className="list-item">
            <div>
              <p style={{ margin: 0 }}>{r.loja} · {r.chaveMes}</p>
              <p className="muted" style={{ margin: 0 }}>
                NF importadas de {formatarData(r.dataMin)} até {formatarData(r.dataMax)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0 }}>{r.totalNotas} nota(s)</p>
              <p className="muted" style={{ margin: 0 }}>{r.totalItens} item(ns)</p>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
