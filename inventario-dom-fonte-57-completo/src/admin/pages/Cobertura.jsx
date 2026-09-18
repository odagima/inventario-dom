import { useEffect, useState } from 'react'
import { buscarCoberturaDados } from '../lib/adminApi'

const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const NOMES_MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function fmtData(d) {
  if (!d) return '—'
  const s = String(d)
  const dt = s.length === 10 ? new Date(s + 'T12:00:00') : new Date(s)
  return isNaN(dt) ? '—' : dt.toLocaleDateString('pt-BR')
}

// Redesenho em widgets (10/08/2026), a pedido do Felipe ("melhorar a interface... deixar tudo
// widget? pra ficar mais bonito e mais fácil a visualização") — mesma linguagem visual do Painel
// (cards arredondados em grid, KPI no topo, detalhe em tabela abaixo), no lugar da lista corrida
// de antes.
function Widget({ children, style }) {
  return (
    <div style={{
      background: 'var(--surface-2, #1a1a1a)', border: '1px solid var(--border)',
      borderRadius: 16, padding: 18, ...style
    }}>{children}</div>
  )
}

function Kpi({ titulo, valor, detalhe, cor }) {
  return (
    <Widget>
      <p style={{ margin: 0, fontSize: 11, letterSpacing: 1.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
        {cor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: cor, display: 'inline-block', marginRight: 7 }} />}
        {titulo}
      </p>
      <p style={{ margin: '8px 0 4px', fontSize: 22, fontWeight: 700, whiteSpace: 'nowrap' }}>{valor}</p>
      {detalhe && <p className="muted" style={{ margin: 0, fontSize: 12 }}>{detalhe}</p>}
    </Widget>
  )
}

const thBase = { padding: '4px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'left' }
const td = { padding: '5px 8px', whiteSpace: 'nowrap' }

function TabelaPeriodo({ titulo, cor, linhas, vazio }) {
  return (
    <Widget style={{ overflowX: 'auto' }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, letterSpacing: 1.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
        {cor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: cor, display: 'inline-block', marginRight: 7 }} />}
        {titulo}
      </p>
      {linhas.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>{vazio}</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={thBase}>Loja</th>
              <th style={{ ...thBase, textAlign: 'right' }}>De</th>
              <th style={{ ...thBase, textAlign: 'right' }}>Até</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={td}>{l.loja}</td>
                <td style={{ ...td, textAlign: 'right', color: 'var(--muted)' }}>{fmtData(l.de)}</td>
                <td style={{ ...td, textAlign: 'right', color: 'var(--muted)' }}>{fmtData(l.ate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Widget>
  )
}

export default function Cobertura() {
  const [dados, setDados] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    buscarCoberturaDados()
      .then((r) => { if (vivo) setDados(r) })
      .catch((e) => { if (vivo) setErro(e.message) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [])

  if (carregando) return <p className="muted">Carregando cobertura…</p>
  if (erro) return <p style={{ color: 'var(--danger)' }}>Não consegui carregar: {erro}</p>
  if (!dados) return null

  const ultimoMesInventario = dados.inventario[0]
  const semanalRecente = dados.semanal.slice(0, 12)

  const dataMaisRecente = (lista) => lista.reduce((max, l) => (l.ate && (!max || l.ate > max)) ? l.ate : max, null)
  const vendasAte = dataMaisRecente(dados.vendasCobertura)
  const comprasAte = dataMaisRecente(dados.comprasCobertura)

  return (
    <div>
      <div className="app-header" style={{ marginBottom: 10 }}>
        <p className="brand">O que já subimos</p>
        <p className="subtitle">Cobertura de dados por base — enxergue os buracos de um relance.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12, marginBottom: 12 }}>
        <Kpi
          titulo="Inventário geral"
          cor="var(--dom-musgo)"
          valor={ultimoMesInventario ? `${NOMES_MES_ABREV[ultimoMesInventario.mes - 1]}/${ultimoMesInventario.ano}` : '—'}
          detalhe={ultimoMesInventario ? 'mês mais recente com contagem' : 'nenhuma contagem finalizada ainda'}
        />
        <Kpi
          titulo="Vendas"
          cor="var(--dom-laranja)"
          valor={dados.vendasCobertura.length ? `${dados.vendasCobertura.length} loja(s)` : '—'}
          detalhe={vendasAte ? `até ${fmtData(vendasAte)}` : 'nenhuma venda importada'}
        />
        <Kpi
          titulo="Compras"
          cor="var(--dom-marinho)"
          valor={dados.comprasCobertura.length ? `${dados.comprasCobertura.length} loja(s)` : '—'}
          detalhe={comprasAte ? `até ${fmtData(comprasAte)}` : 'nenhuma compra importada'}
        />
        <Kpi
          titulo="Fichas técnicas"
          cor="var(--dom-cinza)"
          valor={dados.fichas.total}
          detalhe={dados.fichas.atualizadoEm ? `atualizado em ${fmtData(dados.fichas.atualizadoEm)}` : 'nenhuma ficha ainda'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 12 }}>
        <TabelaPeriodo titulo="Vendas por loja" cor="var(--dom-laranja)" linhas={dados.vendasCobertura} vazio="Nenhuma venda importada." />
        <TabelaPeriodo titulo="Compras por loja" cor="var(--dom-marinho)" linhas={dados.comprasCobertura} vazio="Nenhuma compra importada." />
      </div>

      <Widget style={{ marginBottom: 12 }}>
        <p style={{ margin: '0 0 10px', fontSize: 11, letterSpacing: 1.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--dom-musgo)', display: 'inline-block', marginRight: 7 }} />
          Inventário geral, por mês
        </p>
        {dados.inventario.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nenhuma contagem mensal finalizada ainda.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {dados.inventario.map((m, i) => (
              <div key={i}>
                <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 13 }}>{NOMES_MES[m.mes - 1]}/{m.ano}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {m.empresas.map((e, j) => (
                    <div key={j} style={{
                      display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                      background: 'var(--surface, #111)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px'
                    }}>
                      <span style={{ fontWeight: 600 }}>{e.empresa}</span>
                      <span className="muted">{e.contagens} {e.contagens === 1 ? 'contagem' : 'contagens'} · última {fmtData(e.ultima)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Widget>

      <Widget style={{ overflowX: 'auto' }}>
        <p style={{ margin: '0 0 10px', fontSize: 11, letterSpacing: 1.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--dom-cinza)', display: 'inline-block', marginRight: 7 }} />
          Contagem semanal — mais recentes
        </p>
        {dados.semanal.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nenhuma contagem semanal ainda.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={thBase}>Data</th>
                <th style={thBase}>Grupo</th>
                <th style={thBase}>Loja</th>
                <th style={thBase}>Status</th>
              </tr>
            </thead>
            <tbody>
              {semanalRecente.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={td}>{fmtData(s.data)}</td>
                  <td style={td}>{s.grupo}</td>
                  <td style={td}>{s.loja}</td>
                  <td style={{ ...td, color: s.status !== 'finalizada' ? 'var(--warning, #e0a458)' : 'var(--muted)' }}>
                    {s.status !== 'finalizada' ? 'em andamento' : 'finalizada'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {dados.semanal.length > semanalRecente.length && (
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
            mostrando {semanalRecente.length} de {dados.semanal.length} — histórico completo em Contagem semanal → Histórico/Exportar.
          </p>
        )}
      </Widget>
    </div>
  )
}
