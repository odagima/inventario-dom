import { useEffect, useMemo, useState } from 'react'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { buscarPainelResumo, buscarTendenciaPainel, buscarCurvaDeVendas, corFarolCmv } from '../lib/adminApi'
import { formatarMoeda, formatarNumero, formatarPercentual } from '../lib/formato'

function primeiroDiaMesAtual() {
  const hoje = new Date()
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
}
function hojeIso() {
  return new Date().toISOString().slice(0, 10)
}

const COR_DOM = '#6cb2ff'
const COR_DALVA = '#e0a458'

// `onClick` opcional (10/08/2026) — usado pelos cards de Faturamento e CMV Real do Painel pra abrir
// um popup com o detalhe completo, mantendo o card no topo só com o resumo (Felipe pediu pra
// simplificar a visão principal e mover a quebra fina pra dentro do popup).
function Widget({ children, style, className, onClick }) {
  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        background: 'var(--surface-2, #1a1a1a)', border: '1px solid var(--border)',
        borderRadius: 16, padding: 18, ...(onClick ? { cursor: 'pointer' } : {}), ...style
      }}
    >{children}</div>
  )
}

// `linhas` aceita um `sublinhas` opcional por item — usado no widget de Faturamento (pedido do
// Felipe, 09/08/2026) pra destrinchar o bloco "Dalva e Dito" nas 4 lojas que somam nele (Dalva e
// Dito, Eventos, Mercadinho, Resid Bar — mesma composição do §17.2/TabelaFaturamento), sem precisar
// abrir a tabela detalhada mais abaixo.
// 09/08/2026: valores em R$ nunca podem quebrar linha no meio (ex. "R$" numa linha e o
// número na outra) — feio e some com o alinhamento. `formatarMoeda` já usa NBSP entre
// "R$" e o número (evita a quebra bem ali), e aqui o span do valor também leva
// `whiteSpace: 'nowrap'` + `flexShrink: 0` como segunda trava: se a linha não couber,
// quem cede espaço é o nome (trunca com "…"), nunca o valor.
function Metrica({ label, principal, linhas, onClick }) {
  return (
    <Widget className="metrica-card" onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <p style={{ margin: 0, fontSize: 11, letterSpacing: 1.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</p>
        {onClick && <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>ver detalhe →</span>}
      </div>
      <p className="metrica-principal">{principal}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {linhas.map((l, i) => (
          <div key={i}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--muted)', minWidth: 0, overflow: 'hidden' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: l.cor, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.nome}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {l.valor}{l.extra != null && <span style={{ color: 'var(--muted)' }}>{l.extra}</span>}
              </span>
            </div>
            {l.sublinhas && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, marginLeft: 3, paddingLeft: 11, borderLeft: '1px solid var(--border)' }}>
                {l.sublinhas.map((s, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--muted)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{s.nome}</span>
                    <span style={{ whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{s.valor}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Widget>
  )
}

// Células com valor em R$/%: `whiteSpace: 'nowrap'` garante que o número nunca quebra
// linha dentro da coluna (segunda trava, junto do NBSP de `formatarMoeda`) — a tabela já
// tem `overflowX: 'auto'` no Widget, então numa tela estreita ela ganha scroll horizontal
// em vez de espremer/quebrar os números (mesmo padrão já usado na Curva de Vendas, §17.6).
const thBase = { padding: '4px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }
const tdMoney = { textAlign: 'right', padding: '4px 8px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

// Popup do card "Faturamento" (10/08/2026) — o card no topo agora só mostra DOM + Dalva; a
// composição da Dalva nas 5 sub-lojas (que antes vinha como `sublinhas` sempre visíveis) foi pra
// aqui, a pedido do Felipe ("deixar apenas os 2 principais... mas quando clicarmos, abre um popup
// com a informação das duas casa + o que compõe o do dalva").
function PopupFaturamento({ d, share, onClose }) {
  const sublojas = [
    { nome: 'Dalva e Dito', valor: d.faturamento.porLoja.DD },
    { nome: 'Delivery Dalva', valor: d.faturamento.porLoja.DL },
    { nome: 'Eventos', valor: d.faturamento.porLoja.EV },
    { nome: 'Mercadinho', valor: d.faturamento.porLoja.MC },
    { nome: 'Resid Bar', valor: d.faturamento.porLoja.RB }
  ]
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
      <div className="card" style={{ maxWidth: 420, width: '100%', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>Faturamento</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18 }}>×</button>
        </div>
        <p className="muted" style={{ margin: '4px 0 14px' }}>Total do período: {formatarMoeda(d.faturamento.total)}</p>
        {[
          { nome: 'DOM', cor: COR_DOM, valor: d.faturamento.DOM },
          { nome: 'Dalva e Dito', cor: COR_DALVA, valor: d.faturamento.Dalva }
        ].map((l) => (
          <div key={l.nome} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.cor, display: 'inline-block' }} />
              {l.nome}
            </span>
            <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {formatarMoeda(l.valor)} <span className="muted">{share(l.valor, d.faturamento.total)}</span>
            </span>
          </div>
        ))}
        <p style={{ margin: '16px 0 6px', fontWeight: 600, fontSize: 13 }}>Composição da Dalva e Dito</p>
        {sublojas.map((s) => (
          <div key={s.nome} className="list-item">
            <span className="muted">{s.nome}</span>
            <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatarMoeda(s.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Popup do card "CMV Real" (10/08/2026) — pedido do Felipe: DOM + Dalva e Dito (bloco) + a quebra
// nas 5 sub-lojas, com Estoque Inicial/Compras/Estoque Final/Consumo/CMV%. Combinado com ele:
// Estoque vem real por sub-loja (via `sublocaDaUnidade` em adminApi.js); Compras só existe nos 2
// blocos (nota fiscal do Everest não vai mais fundo — decisão de 07/08) — o total de Compras da
// Dalva entra inteiro em "Dalva e Dito" e as outras 4 sub-lojas ficam com Compras = 0 (não ratear);
// Consumo é o cálculo normal (Estoque Inicial + Compras − Estoque Final) em cima desses números.
function LinhaCmvReal({ nome, l, indent, negrito, cor }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: indent ? '4px 8px 4px 24px' : '6px 8px', fontWeight: negrito ? 700 : 400 }}>
        {cor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: cor, display: 'inline-block', marginRight: 7 }} />}
        {nome}
      </td>
      <td style={tdMoney}>{formatarMoeda(l.estoqueInicial)}</td>
      <td style={tdMoney}>{formatarMoeda(l.compras)}</td>
      <td style={tdMoney}>{formatarMoeda(l.estoqueFinal)}</td>
      <td style={{ ...tdMoney, fontWeight: negrito ? 700 : 400 }}>{formatarMoeda(l.consumo)}</td>
      <td style={{ ...tdMoney, fontWeight: 600 }}>{formatarPercentual(l.cmvPercentual)}</td>
    </tr>
  )
}

function PopupCmvReal({ d, onClose }) {
  const sublojas = [
    { codigo: 'DD', nome: 'Dalva e Dito' },
    { codigo: 'DL', nome: 'Delivery' },
    { codigo: 'EV', nome: 'Eventos' },
    { codigo: 'MC', nome: 'Mercadinho' },
    { codigo: 'RB', nome: 'Resid Bar' }
  ]
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
      <div className="card" style={{ maxWidth: 640, width: '100%', maxHeight: '80vh', overflowY: 'auto', overflowX: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>CMV Real</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18 }}>×</button>
        </div>
        <p className="muted" style={{ margin: '4px 0 14px', fontSize: 12 }}>
          Estoque inicial + Compras − Estoque final = Consumo. Compras só existe nos blocos DOM/Dalva (nota fiscal
          do Everest não distingue sub-loja) — nas sub-lojas, Compras fica em "Dalva e Dito" e as demais ficam
          zeradas, não estimadas.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 480 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ ...thBase, textAlign: 'left' }}></th>
              <th style={{ ...thBase, textAlign: 'right' }}>Est. inicial</th>
              <th style={{ ...thBase, textAlign: 'right' }}>Compras</th>
              <th style={{ ...thBase, textAlign: 'right' }}>Est. final</th>
              <th style={{ ...thBase, textAlign: 'right' }}>Consumo</th>
              <th style={{ ...thBase, textAlign: 'right' }}>CMV Real %</th>
            </tr>
          </thead>
          <tbody>
            <LinhaCmvReal nome="DOM" l={d.cmv.porBloco.DOM} negrito cor={COR_DOM} />
            <LinhaCmvReal nome="Dalva e Dito" l={d.cmv.porBloco.Dalva} negrito cor={COR_DALVA} />
            {sublojas.map((s) => (
              <LinhaCmvReal key={s.codigo} nome={s.nome} l={d.cmv.porLoja[s.codigo]} indent />
            ))}
          </tbody>
        </table>
        {d.cmv.totalItensSemCusto > 0 && (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            {d.cmv.totalItensSemCusto} item(ns) sem custo médio recente não entraram nesse cálculo.
          </p>
        )}
        {/* 10/08/2026: aviso movido pra aqui de dentro do widget "Dados do período" (removido do
            Painel a pedido do Felipe, "não vejo muita função pra ele") — o que ele avisava
            (contagem mensal incompleta pode deixar o CMV parcial) é específico do CMV Real, então
            faz mais sentido aqui dentro do próprio popup do que solto num card. */}
        {d.dadosCompletos.lojasCompletas < d.dadosCompletos.totalLojas && (
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--warning, #e0a458)' }}>
            Contagem mensal de {String(d.dadosCompletos.mes).padStart(2, '0')}/{d.dadosCompletos.ano} incompleta —
            {d.dadosCompletos.lojasCompletas} de {d.dadosCompletos.totalLojas} loja(s) fecharam. O Estoque (e por
            tanto o CMV Real) desse período pode estar parcial.
          </p>
        )}
      </div>
    </div>
  )
}

const FAROL_COR = { alto: 'var(--danger)', atencao: 'var(--warning)', ok: 'var(--success)' }

// Tendência (11/08/2026) — substitui o widget "Dados do período" removido a pedido do Felipe
// ("não vejo muita função pra ele"). Faturamento (barra, eixo esquerdo) e CMV Real % (linha, eixo
// direito) dos últimos 6 meses — dá pra ver evolução, não só o retrato do período escolhido nos
// cards de cima. Independente do filtro de data do Painel (é sempre "os últimos 6 meses reais",
// carregado 1x — ver `buscarTendenciaPainel`).
function TendenciaPainel({ dados }) {
  if (!dados) return null
  return (
    <div className="card">
      <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 15 }}>Tendência (últimos 6 meses)</p>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>Faturamento (barra) e CMV Real % (linha) — o mês atual entra parcial, até hoje.</p>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <ComposedChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" stroke="var(--text-secondary)" fontSize={12} />
            <YAxis yAxisId="fat" stroke="var(--text-secondary)" fontSize={12} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
            <YAxis yAxisId="cmv" orientation="right" stroke="var(--text-secondary)" fontSize={12} unit="%" domain={[0, 'auto']} />
            <Tooltip
              contentStyle={{ background: 'var(--header-bg)', border: '0.5px solid rgba(244,241,233,0.15)', borderRadius: 8, color: 'var(--header-text)' }}
              formatter={(value, name) => (name === 'CMV Real %' ? [formatarPercentual(value), name] : [formatarMoeda(value), name])}
            />
            <Bar yAxisId="fat" dataKey="faturamento" name="Faturamento" fill="var(--accent)" radius={[6, 6, 0, 0]} />
            <Line yAxisId="cmv" type="monotone" dataKey="cmvPercentual" name="CMV Real %" stroke="var(--danger)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Alertas (11/08/2026) — o que precisa de atenção agora, sempre visível, sem precisar abrir outra
// tela: cobertura de ficha técnica, itens sem correspondência de produto (achado no §29.3, sintoma
// de import desalinhado — Vendas/Produtos fora de sincronia) e contagem do mês incompleta (mesmo
// dado que já aparece dentro do popup de CMV Real, §28.2 — aqui fica em destaque na tela
// principal, sem precisar abrir o popup pra saber). Reaproveita `d` (cards de cima) e `curva`
// (cobertura, mesmo período dos cards).
function AlertasPainel({ d, curva }) {
  const itens = []
  if (curva?.cobertura?.total) {
    const t = curva.cobertura.total
    if (t.total > 0 && (t.percentual == null || t.percentual < 100)) {
      itens.push({
        cor: t.percentual != null && t.percentual < 50 ? 'var(--danger)' : 'var(--warning)',
        texto: `Fichas técnicas cadastradas: ${formatarPercentual(t.percentual)} (${t.comFicha}/${t.total} itens vendidos no período).`
      })
    }
    if (t.semCorrespondencia > 0) {
      itens.push({
        cor: 'var(--danger)',
        texto: `${t.semCorrespondencia} item(ns) vendido(s) sem correspondência no cadastro de Produtos — pode indicar Vendas/Produtos desalinhados.`
      })
    }
  }
  if (d?.dadosCompletos && d.dadosCompletos.lojasCompletas < d.dadosCompletos.totalLojas) {
    itens.push({
      cor: 'var(--warning)',
      texto: `Contagem de ${String(d.dadosCompletos.mes).padStart(2, '0')}/${d.dadosCompletos.ano} incompleta — ${d.dadosCompletos.lojasCompletas} de ${d.dadosCompletos.totalLojas} loja(s) fecharam.`
    })
  }
  return (
    <div className="card">
      <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 15 }}>Alertas</p>
      {itens.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--success)' }}>Tudo certo por aqui.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {itens.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: it.cor, display: 'inline-block', marginTop: 5, flexShrink: 0 }} />
              <span>{it.texto}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Ranking rápido (11/08/2026) — top 5 pratos com CMV mais alto no período, atalho pra ação direta
// sem precisar abrir Análise de custo. Só considera itens com ficha técnica vinculada (mesma regra
// da Curva de Vendas, §29.3) — sem isso o "CMV mais alto" seria só quem ainda não tem FT.
function RankingCmvAlto({ curva }) {
  const top5 = useMemo(() => {
    if (!curva) return []
    return curva.filter((i) => !i.semFicha && i.custoTeoricoPercentual != null)
      .sort((a, b) => b.custoTeoricoPercentual - a.custoTeoricoPercentual)
      .slice(0, 5)
  }, [curva])
  return (
    <div className="card">
      <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 15 }}>CMV mais alto no período</p>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>Top 5 pratos com ficha técnica vinculada — o que está comendo mais margem.</p>
      {top5.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Sem itens com ficha técnica no período.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {top5.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '4px 0', borderBottom: i < top5.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, overflow: 'hidden' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: FAROL_COR[corFarolCmv(item.custoTeoricoPercentual)], display: 'inline-block', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nome}</span>
              </span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexShrink: 0, whiteSpace: 'nowrap' }}>
                <span className="muted" style={{ fontSize: 12 }}>{formatarNumero(item.quantidade, 0)} vendidos</span>
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatarPercentual(item.custoTeoricoPercentual)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Painel() {
  const [dataInicio, setDataInicio] = useState(primeiroDiaMesAtual())
  const [dataFim, setDataFim] = useState(hojeIso())
  const [d, setD] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [popupFaturamento, setPopupFaturamento] = useState(false)
  const [popupCmv, setPopupCmv] = useState(false)
  const [tendencia, setTendencia] = useState(null)
  const [curvaAtual, setCurvaAtual] = useState(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro('')
    Promise.all([
      buscarPainelResumo(dataInicio, dataFim),
      buscarCurvaDeVendas(dataInicio, dataFim)
    ])
      .then(([resumo, curva]) => { if (vivo) { setD(resumo); setCurvaAtual(curva) } })
      .catch((e) => { if (vivo) setErro(e.message) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [dataInicio, dataFim])

  // Tendência (últimos 6 meses reais) — carregada 1x, não depende do filtro de período dos cards
  // acima (é sempre "os últimos 6 meses", não o que o Felipe escolheu olhar agora).
  useEffect(() => {
    let vivo = true
    buscarTendenciaPainel(6).then((r) => { if (vivo) setTendencia(r) }).catch(() => {})
    return () => { vivo = false }
  }, [])

  const share = (v, t) => (t ? formatarPercentual((v / t) * 100) : '—')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <p className="brand" style={{ margin: 0 }}>Painel</p>
          <p className="subtitle" style={{ margin: 0 }}>Resumo do período, num relance.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <label className="muted" style={{ display: 'block', fontSize: 12 }}>De</label>
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </div>
          <div>
            <label className="muted" style={{ display: 'block', fontSize: 12 }}>Até</label>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
        </div>
      </div>

      {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

      {carregando || !d ? (
        <p className="muted">Carregando painel…</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12, marginBottom: 12 }}>
            <Metrica
              label="Faturamento"
              principal={formatarMoeda(d.faturamento.total)}
              onClick={() => setPopupFaturamento(true)}
              linhas={[
                { nome: 'DOM', cor: COR_DOM, valor: formatarMoeda(d.faturamento.DOM), extra: share(d.faturamento.DOM, d.faturamento.total) },
                { nome: 'Dalva e Dito', cor: COR_DALVA, valor: formatarMoeda(d.faturamento.Dalva), extra: share(d.faturamento.Dalva, d.faturamento.total) }
              ]}
            />
            <Metrica
              label="Compras"
              principal={formatarMoeda(d.compras.total)}
              linhas={[
                { nome: 'DOM', cor: COR_DOM, valor: formatarMoeda(d.compras.DOM), extra: share(d.compras.DOM, d.compras.total) },
                { nome: 'Dalva e Dito', cor: COR_DALVA, valor: formatarMoeda(d.compras.Dalva), extra: share(d.compras.Dalva, d.compras.total) }
              ]}
            />
            <Metrica
              label="CMV Real"
              principal={formatarPercentual(d.cmv.total)}
              onClick={() => setPopupCmv(true)}
              linhas={[
                { nome: 'DOM', cor: COR_DOM, valor: formatarPercentual(d.cmv.DOM) },
                { nome: 'Dalva e Dito', cor: COR_DALVA, valor: formatarPercentual(d.cmv.Dalva) }
              ]}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <TendenciaPainel dados={tendencia} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 12 }}>
            <AlertasPainel d={d} curva={curvaAtual} />
            <RankingCmvAlto curva={curvaAtual} />
          </div>

          {popupFaturamento && <PopupFaturamento d={d} share={share} onClose={() => setPopupFaturamento(false)} />}
          {popupCmv && <PopupCmvReal d={d} onClose={() => setPopupCmv(false)} />}
        </>
      )}
    </div>
  )
}
