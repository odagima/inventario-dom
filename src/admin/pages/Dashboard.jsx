import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { buscarDadosDashboard } from '../lib/adminApi'

const PERIODOS = [
  { valor: 3, texto: 'Últimos 3 meses' },
  { valor: 6, texto: 'Últimos 6 meses' },
  { valor: 12, texto: 'Últimos 12 meses' },
  { valor: 0, texto: 'Tudo' }
]

export default function Dashboard({ tipoFiltro = 'mensal' }) {
  const [dados, setDados] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [filtroLoja, setFiltroLoja] = useState('todas')
  const [filtroPeriodo, setFiltroPeriodo] = useState(6)

  useEffect(() => {
    buscarDadosDashboard(tipoFiltro)
      .then((d) => setDados(d))
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [])

  const lojas = useMemo(() => [...new Set(dados.map((d) => d.unidade))].sort(), [dados])

  function filtrarPorPeriodo(lista, campoChave) {
    if (filtroPeriodo === 0) return lista
    const chavesUnicas = [...new Set(lista.map((d) => d[campoChave]))].sort()
    const chavesValidas = new Set(chavesUnicas.slice(-filtroPeriodo))
    return lista.filter((d) => chavesValidas.has(d[campoChave]))
  }

  const dadosFiltrados = useMemo(() => {
    let lista = dados
    if (filtroLoja !== 'todas') lista = lista.filter((d) => d.unidade === filtroLoja)
    return filtrarPorPeriodo(lista, 'chave')
  }, [dados, filtroLoja, filtroPeriodo])

  const porMes = useMemo(() => {
    const grupos = new Map()
    for (const d of dadosFiltrados) {
      if (!grupos.has(d.chave)) grupos.set(d.chave, { mes: d.mes, chave: d.chave, sessoes: 0, somaConclusao: 0, n: 0 })
      const g = grupos.get(d.chave)
      g.sessoes += 1
      g.somaConclusao += d.conclusao
      g.n += 1
    }
    return Array.from(grupos.values())
      .sort((a, b) => a.chave.localeCompare(b.chave))
      .map((g) => ({ mes: g.mes, sessoes: g.sessoes, conclusaoMedia: g.n ? Math.round(g.somaConclusao / g.n) : 0 }))
  }, [dadosFiltrados])

  const porUnidade = useMemo(() => {
    const grupos = new Map()
    for (const d of dadosFiltrados) {
      if (!grupos.has(d.unidade)) grupos.set(d.unidade, { unidade: d.unidade, sessoes: 0 })
      grupos.get(d.unidade).sessoes += 1
    }
    return Array.from(grupos.values())
  }, [dadosFiltrados])

  if (carregando) return <div className="card"><p className="muted">Carregando…</p></div>

  if (erro) return <div className="card"><p style={{ color: 'var(--danger)' }}>Erro ao carregar o dashboard: {erro}</p></div>

  if (dados.length === 0) {
    return <div className="card"><p className="muted">Nenhuma contagem importada ainda — os gráficos aparecem assim que houver dados.</p></div>
  }

  const eixoTexto = { stroke: 'var(--text-secondary)', fontSize: 12 }
  const tooltipEstilo = { background: 'var(--header-bg)', border: '0.5px solid rgba(244,241,233,0.15)', borderRadius: 8, color: 'var(--header-text)' }
  const gradeEstilo = 'var(--border)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="muted">Loja</label>
          <select value={filtroLoja} onChange={(e) => setFiltroLoja(e.target.value)}>
            <option value="todas">Todas</option>
            {lojas.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="muted">Período</label>
          <select value={filtroPeriodo} onChange={(e) => setFiltroPeriodo(Number(e.target.value))}>
            {PERIODOS.map((p) => <option key={p.valor} value={p.valor}>{p.texto}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        {dados.length > 0 && (
          <>
            <div className="card">
              <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Sessões de contagem por mês</p>
              <p className="muted" style={{ margin: '0 0 14px' }}>Quantas contagens foram feitas em cada mês.</p>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={porMes}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gradeEstilo} />
                    <XAxis dataKey="mes" {...eixoTexto} />
                    <YAxis {...eixoTexto} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipEstilo} />
                    <Bar dataKey="sessoes" fill="var(--accent)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Conclusão média por mês</p>
              <p className="muted" style={{ margin: '0 0 14px' }}>% de itens esperados que realmente foram contados, em média.</p>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={porMes}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gradeEstilo} />
                    <XAxis dataKey="mes" {...eixoTexto} />
                    <YAxis {...eixoTexto} unit="%" domain={[0, 100]} />
                    <Tooltip contentStyle={tooltipEstilo} />
                    <Line type="monotone" dataKey="conclusaoMedia" stroke="var(--success)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {filtroLoja === 'todas' && (
              <div className="card">
                <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Sessões por loja</p>
                <p className="muted" style={{ margin: '0 0 14px' }}>Quais casas estão contando com mais frequência.</p>
                <div style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer>
                    <BarChart data={porUnidade} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke={gradeEstilo} />
                      <XAxis type="number" {...eixoTexto} allowDecimals={false} />
                      <YAxis dataKey="unidade" type="category" {...eixoTexto} width={110} />
                      <Tooltip contentStyle={tooltipEstilo} />
                      <Bar dataKey="sessoes" fill="var(--dom-musgo)" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}
