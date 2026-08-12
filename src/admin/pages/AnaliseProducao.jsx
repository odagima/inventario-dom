import { useState } from 'react'
import { buscarCurvaDeVendas, buscarConsumoTeorico, buscarCMVReal, buscarCMVPonderado } from '../lib/adminApi'
import { formatarMoeda, formatarNumero } from '../lib/formato'

function primeiroDiaMesAtual() {
  const hoje = new Date()
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
}
function hojeIso() {
  return new Date().toISOString().slice(0, 10)
}

const NOMES_MES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

export default function AnaliseProducao() {
  const [modo, setModo] = useState('cmvReal') // 'cmvReal' | 'cmvPonderado' | 'curva' | 'consumo'

  // período (curva/consumo usam intervalo de datas)
  const [dataInicio, setDataInicio] = useState(primeiroDiaMesAtual())
  const [dataFim, setDataFim] = useState(hojeIso())
  // CMV usa mês/ano fechado (porque precisa comparar com o mês anterior)
  const [mesCmv, setMesCmv] = useState(new Date().getMonth() + 1)
  const [anoCmv, setAnoCmv] = useState(new Date().getFullYear())

  const [carregando, setCarregando] = useState(false)
  const [curva, setCurva] = useState(null)
  const [consumo, setConsumo] = useState(null)
  const [cmvReal, setCmvReal] = useState(null)
  const [cmvPonderado, setCmvPonderado] = useState(null)
  const [erro, setErro] = useState('')

  async function handleBuscar() {
    setCarregando(true)
    setErro('')
    try {
      if (modo === 'curva') setCurva(await buscarCurvaDeVendas(dataInicio, dataFim))
      if (modo === 'consumo') setConsumo(await buscarConsumoTeorico(dataInicio, dataFim))
      if (modo === 'cmvReal') setCmvReal(await buscarCMVReal(mesCmv, anoCmv))
      if (modo === 'cmvPonderado') setCmvPonderado(await buscarCMVPonderado(mesCmv, anoCmv))
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  const corCurva = { A: 'var(--success)', B: 'var(--warning)', C: 'var(--text-tertiary)' }
  const usaMesAno = modo === 'cmvReal' || modo === 'cmvPonderado'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="segmented" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          <button className={modo === 'cmvReal' ? 'active' : ''} onClick={() => setModo('cmvReal')}>CMV real</button>
          <button className={modo === 'cmvPonderado' ? 'active' : ''} onClick={() => setModo('cmvPonderado')}>CMV ponderado</button>
          <button className={modo === 'curva' ? 'active' : ''} onClick={() => setModo('curva')}>Curva de vendas</button>
          <button className={modo === 'consumo' ? 'active' : ''} onClick={() => setModo('consumo')}>Consumo teórico</button>
        </div>

        {usaMesAno ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 2, minWidth: 140 }}>
              <label className="muted">Mês</label>
              <select value={mesCmv} onChange={(e) => setMesCmv(Number(e.target.value))}>
                {NOMES_MES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label className="muted">Ano</label>
              <select value={anoCmv} onChange={(e) => setAnoCmv(Number(e.target.value))}>
                {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <button className="primary" onClick={handleBuscar} disabled={carregando} style={{ height: 44 }}>
              {carregando ? 'Calculando…' : 'Calcular'}
            </button>
          </div>
        ) : (
          // 11/08/2026: `flex + minWidth` alinhado com o mesmo padrão de Análise de custo/Cardápio,
          // pra quebrar linha de forma previsível em qualquer largura de tela.
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <label className="muted">De</label>
              <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <label className="muted">Até</label>
              <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
            <button className="primary" onClick={handleBuscar} disabled={carregando} style={{ height: 44 }}>
              {carregando ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
        )}

        {modo === 'cmvReal' && (
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            CMV real = (estoque inicial + compras − estoque final) ÷ vendas, por grupo. O estoque é valorizado
            pelo preço médio das compras recentes de cada item — itens sem nenhuma compra registrada ainda
            não entram na conta (mostro quantos ficaram de fora).
          </p>
        )}
        {modo === 'cmvPonderado' && (
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Custo teórico (o que a ficha técnica diz que deveria custar) × quantidade vendida, dividido pelas vendas.
            Compara com o CMV real: se o ponderado for bem menor que o real, tem quebra, desperdício ou porcionamento errado.
          </p>
        )}
        {modo === 'consumo' && (
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Considera só o primeiro nível da ficha técnica (ingredientes diretos do prato vendido).
          </p>
        )}
      </div>

      {erro && <div className="card"><p style={{ color: 'var(--danger)' }}>{erro}</p></div>}

      {modo === 'cmvReal' && cmvReal && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>CMV real por grupo</p>
          <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
            Comparando com o fechamento de {NOMES_MES[cmvReal.mesAnterior - 1]}/{cmvReal.anoAnterior}
            {cmvReal.totalItensSemCusto > 0 && ` · ${cmvReal.totalItensSemCusto} item(ns) contado(s) sem nenhuma compra registrada (ficaram de fora do valor)`}
          </p>
          {cmvReal.linhas.length === 0 ? (
            <p className="muted">Sem dados suficientes pra esse mês (precisa de contagem fechada + compras + vendas).</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  {['Grupo', 'Est. inicial', 'Compras', 'Est. final', 'Vendas', 'CMV'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cmvReal.linhas.map((l, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '8px' }}>{l.grupo}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarMoeda(l.estoqueInicial)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarMoeda(l.compras)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarMoeda(l.estoqueFinal)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarMoeda(l.vendas)}</td>
                    <td style={{ padding: '8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{l.cmvPercentual !== null ? `${l.cmvPercentual.toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modo === 'cmvPonderado' && cmvPonderado && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <p style={{ margin: '0 0 14px', fontWeight: 600, fontSize: 15 }}>CMV ponderado (teórico) por grupo</p>
          {cmvPonderado.linhas.length === 0 ? (
            <p className="muted">Sem vendas registradas nesse mês.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  {['Grupo', 'Vendas', 'Custo teórico', 'CMV ponderado', 'Sem ficha'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cmvPonderado.linhas.map((l, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '8px' }}>{l.grupo}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarMoeda(l.vendas)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarMoeda(l.custoTeorico)}</td>
                    <td style={{ padding: '8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{l.cmvPonderado !== null ? `${l.cmvPonderado.toFixed(1)}%` : '—'}</td>
                    <td style={{ padding: '8px' }} className="muted">{l.itensSemFicha || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modo === 'curva' && curva && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <p style={{ margin: '0 0 14px', fontWeight: 600, fontSize: 15 }}>Curva de vendas (ABC)</p>
          {curva.length === 0 ? (
            <p className="muted">Nenhuma venda nesse período.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  {['Curva', 'Produto', 'Grupo', 'Qtd', 'Valor', '% do total', '% acumulado'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {curva.map((item, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '8px' }}><span className="badge" style={{ background: 'var(--surface-2)', color: corCurva[item.curva] }}>{item.curva}</span></td>
                    <td style={{ padding: '8px' }}>{item.nome}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{item.grupo || '—'}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarNumero(item.quantidade, 1)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarMoeda(item.valorTotal)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{item.percentual.toFixed(1)}%</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{item.percentualAcumulado.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modo === 'consumo' && consumo && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <p style={{ margin: '0 0 14px', fontWeight: 600, fontSize: 15 }}>Consumo teórico de insumos</p>
          {consumo.length === 0 ? (
            <p className="muted">Sem dados suficientes (precisa de vendas + fichas técnicas vinculadas nesse período).</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>Insumo</th>
                  <th style={{ textAlign: 'right', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>Consumo teórico</th>
                </tr>
              </thead>
              <tbody>
                {consumo.map((item, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '8px' }}>{item.nome}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{item.quantidadeTeorica.toFixed(3)} {item.unidade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
