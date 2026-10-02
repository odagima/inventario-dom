import { useEffect, useState } from 'react'
import { listarGruposAdmin, buscarSaldoGrupo } from '../lib/adminApi'

function formatarData(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

// Semana DENTRO do mês (1ª-7º dia = semana 1, 8º-14º = semana 2, ...) — só pra organizar visualmente
// as colunas. Pedido do Felipe, mas com uma ressalva que ele mesmo já tinha decidido antes no CMV
// Real × Teórico: NÃO soma/some os dias dentro da semana (isso escondia contagem fora do dia
// certo) — cada dia continua sua própria coluna, a semana é só um rótulo agrupando colunas.
function semanaDoMes(iso) {
  const dia = new Date(iso + 'T00:00:00').getDate()
  return Math.ceil(dia / 7)
}

const NOMES_MES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

// Pedido do Felipe (01/10/2026): "contagem por grupo" morava dentro do Saldo do Inventário —
// mudou pra cá porque Grupo de contagem é especificamente semanal/diário (ver SelecaoUnidade.jsx),
// não tem nada a ver com o Inventário mensal. Usa a mesma lógica de "só o que foi contado" (ver
// `buscarSaldoGrupo`/`buscarSaldoItem` em adminApi.js), mas agrupa coluna por SEMANA dentro do mês
// em vez de por loja (contagem semanal não separa por loja — ver migration_v6.sql).
export default function SaldoSemanal() {
  const [grupos, setGrupos] = useState([])
  const [grupoId, setGrupoId] = useState('')
  const [mesFiltro, setMesFiltro] = useState(new Date().getMonth() + 1)
  const [anoFiltro, setAnoFiltro] = useState(new Date().getFullYear())
  const [saldoGrupo, setSaldoGrupo] = useState([])
  const [carregando, setCarregando] = useState(false)

  useEffect(() => { listarGruposAdmin().then(setGrupos) }, [])

  function filtro() {
    return { tipo: 'semanal', mes: mesFiltro, ano: anoFiltro }
  }

  async function carregar(id) {
    if (!id) return
    setCarregando(true)
    try {
      setSaldoGrupo(await buscarSaldoGrupo(id, filtro()))
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    if (grupoId) carregar(grupoId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesFiltro, anoFiltro])

  // Datas reais que tiveram contagem nesse mês (não inventa dia nenhum) + a que semana cada uma
  // pertence, pra montar o cabeçalho agrupado (Semana 1 | Semana 2 | ...) sem juntar os valores.
  const datas = [...new Set(saldoGrupo.flatMap((r) => r.serie.map((s) => s.data)))].sort((a, b) => new Date(a) - new Date(b))
  const semanas = []
  for (const d of datas) {
    const s = semanaDoMes(d)
    const ultima = semanas[semanas.length - 1]
    if (ultima && ultima.semana === s) ultima.datas.push(d)
    else semanas.push({ semana: s, datas: [d] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <label className="muted">Grupo de contagem</label>
        <select
          value={grupoId}
          onChange={(e) => { setGrupoId(e.target.value); carregar(e.target.value) }}
          style={{ marginTop: 4, marginBottom: 14 }}
        >
          <option value="">Selecione…</option>
          {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: 140 }}>
            <label className="muted">Mês</label>
            <select value={mesFiltro} onChange={(e) => setMesFiltro(Number(e.target.value))}>
              {NOMES_MES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label className="muted">Ano</label>
            <select value={anoFiltro} onChange={(e) => setAnoFiltro(Number(e.target.value))}>
              {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
      </div>

      {carregando && <div className="card"><p className="muted">Carregando…</p></div>}

      {!carregando && grupoId && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <p style={{ margin: '0 0 14px', fontWeight: 600, fontSize: 15 }}>
            Saldo por item — {grupos.find((g) => g.id === grupoId)?.nome} · {NOMES_MES[mesFiltro - 1]}/{anoFiltro}
          </p>
          {datas.length === 0 ? (
            <p className="muted">Nenhum item desse grupo foi contado nesse mês ainda.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <th rowSpan={2} style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500, verticalAlign: 'bottom' }}>Produto</th>
                  {semanas.map((s) => (
                    <th key={s.semana} colSpan={s.datas.length} style={{ textAlign: 'center', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '0.5px solid var(--border)', borderLeft: '1px solid var(--border)' }}>
                      Semana {s.semana}
                    </th>
                  ))}
                </tr>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  {datas.map((d) => (
                    <th key={d} style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {formatarData(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {saldoGrupo.filter((r) => r.serie.length > 0).map(({ produto, serie }) => {
                  const porData = new Map(serie.map((s) => [s.data, s.quantidade]))
                  return (
                    <tr key={produto.id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                      <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{produto.nome}</td>
                      {datas.map((d) => (
                        <td key={d} style={{ textAlign: 'right', padding: '8px' }}>{porData.get(d) ?? '—'}</td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
