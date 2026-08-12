import { useEffect, useState } from 'react'
import { buscarFichasParaHistorico, buscarHistoricoDeFicha } from '../lib/adminApi'
import { formatarMoeda, formatarPercentual } from '../lib/formato'

const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
function formatarMes(mesAno) {
  const [ano, mes] = mesAno.split('-').map(Number)
  return `${NOMES_MES[mes - 1]}/${ano}`
}

// Histórico de preço de Ficha Técnica (10/08/2026, pedido do Felipe: "queremos ter o histórico do
// preço das FT no tempo... filet mignon julho R$80, agosto R$82,30 e assim por diante").
// 12/08/2026, correção pedida pelo Felipe: a 1ª versão mostrava uma linha por REIMPORTAÇÃO da
// Ficha Técnica ("data do import") — mas o que importa é o MÊS em que o insumo foi de fato
// comprado (ex.: "AGUA: Jan 2,50 / Fev 2,60 / Mar 2,60 [repete o último preço se não houver
// compra em março]"). A tela agora mostra 1 linha por mês, com o preço vindo da ÚLTIMA compra
// desse insumo dentro do mês — mês sem compra repete o último preço conhecido (nunca zera, nunca
// pula). Ver `buscarHistoricoDeFicha`/migration_v9.sql em adminApi.js.
export default function HistoricoFichasTecnicas() {
  const [termo, setTermo] = useState('')
  const [fichas, setFichas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [fichaSelecionada, setFichaSelecionada] = useState(null)
  const [historico, setHistorico] = useState(null)
  const [indisponivel, setIndisponivel] = useState(false)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    buscarFichasParaHistorico(termo)
      .then((r) => { if (vivo) setFichas(r) })
      .catch((e) => { if (vivo) setErro(e.message) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [termo])

  function abrirFicha(f) {
    setFichaSelecionada(f)
    setHistorico(null)
    setIndisponivel(false)
    buscarHistoricoDeFicha(f.id)
      .then((r) => {
        setIndisponivel(r.indisponivel)
        setHistorico(r.linhas)
      })
      .catch((e) => setErro(e.message))
  }

  return (
    <div>
      <div className="app-header" style={{ marginBottom: 10 }}>
        <p className="brand">Histórico Ficha Técnica</p>
        <p className="subtitle">Preço de compra de cada insumo da ficha, mês a mês — não a data em que a ficha foi reimportada.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 360px) 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <input
            type="text"
            placeholder="Buscar ficha por nome…"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            style={{ marginBottom: 12, width: '100%' }}
          />
          {carregando ? (
            <p className="muted">Carregando…</p>
          ) : erro ? (
            <p style={{ color: 'var(--danger)' }}>{erro}</p>
          ) : fichas.length === 0 ? (
            <p className="muted">Nenhuma ficha encontrada.</p>
          ) : (
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              {fichas.map((f) => (
                <div
                  key={f.id}
                  className="list-item"
                  style={{ cursor: 'pointer', background: fichaSelecionada?.id === f.id ? 'var(--surface-2)' : undefined }}
                  onClick={() => abrirFicha(f)}
                >
                  <span>{f.nome || f.codigo_everest}</span>
                  <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatarMoeda(f.custo_producao)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          {!fichaSelecionada ? (
            <p className="muted">Selecione uma ficha pra ver a evolução do preço dela, mês a mês.</p>
          ) : indisponivel ? (
            <div>
              <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 15 }}>{fichaSelecionada.nome}</p>
              <p style={{ color: 'var(--warning, #e0a458)', fontSize: 13 }}>
                Histórico por mês ainda não disponível — falta rodar <code>migration_v9.sql</code> no SQL Editor do
                Supabase (adiciona o código Everest na compra, pra casar cada compra com o insumo certo). Depois de
                rodar, reimportar Entradas/Compras deixa o histórico completo também pras compras já existentes
                (a migração já tenta preencher o que der a partir do cadastro atual, mas reimportar garante 100%).
              </p>
            </div>
          ) : !historico ? (
            <p className="muted">Carregando histórico…</p>
          ) : historico.length === 0 ? (
            <div>
              <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 15 }}>{fichaSelecionada.nome}</p>
              <p className="muted" style={{ fontSize: 13 }}>
                Ainda sem nenhuma compra registrada pros insumos dessa ficha — vai aparecer aqui a partir da primeira
                compra importada (Base de dados → Importar dados → Entradas/Compras).
              </p>
            </div>
          ) : (
            <div>
              <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>{fichaSelecionada.nome}</p>
              <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
                Preço da última compra de cada insumo dentro do mês. Mês sem compra repete o último preço conhecido —
                marcado com <span style={{ color: 'var(--warning, #e0a458)' }}>●</span> quando é o caso.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--muted)', fontWeight: 600 }}>Mês</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--muted)', fontWeight: 600 }}>Custo</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--muted)', fontWeight: 600 }}>Variação</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((h, i) => {
                    const anterior = i > 0 ? historico[i - 1].custo : null
                    const variacao = anterior != null && anterior > 0 ? ((h.custo - anterior) / anterior) * 100 : null
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px' }}>
                          {formatarMes(h.mes)}
                          {!h.temCompraNoMes && (
                            <span title="Sem compra nesse mês — repete o último preço conhecido" style={{ color: 'var(--warning, #e0a458)', marginLeft: 6 }}>●</span>
                          )}
                          {h.incompleto && (
                            <span className="muted" title="Ainda falta a 1ª compra de pelo menos 1 insumo dessa ficha — custo parcial" style={{ marginLeft: 6, fontSize: 11 }}>(parcial)</span>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatarMoeda(h.custo)}</td>
                        <td style={{
                          padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                          color: variacao == null ? 'var(--muted)' : variacao > 0 ? 'var(--danger)' : variacao < 0 ? 'var(--success)' : 'var(--muted)'
                        }}>
                          {variacao == null ? '—' : `${variacao > 0 ? '+' : ''}${formatarPercentual(variacao)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
