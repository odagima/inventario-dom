import { useEffect, useState } from 'react'
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar, Line } from 'recharts'
import { buscarProdutosInsumoBase, buscarHistoricoDoProduto } from '../lib/adminApi'
import { formatarMoeda, formatarNumero } from '../lib/formato'

// ⚠️ 03/09/2026 — ARQUIVO RECUPERADO DO BUNDLE PUBLICADO (build 54), não do repositório.
// Nunca subiu pro GitHub (entregas commitadas como .zip sem extrair; a árvore versionada parou em
// 17/08). Lógica lida do JS minificado do dist 54. Os números vêm inteiros de
// `buscarHistoricoDoProduto` (`adminApi.js`, intacto no repo) — esta tela só exibe.
//
// O que esta tela é (§37): compras, consumo teórico e movimento de estoque de UM insumo base, mês
// a mês. Tudo que foi contado como pré-preparo ou porcionado é convertido de volta pelo fator de
// correção e somado aqui, então a linha do mês representa o insumo, não o item contado.

const COR_COMPRAS = '#5C6E49'
const COR_TEORICO = '#C15A1B'

const rotuloMes = (mes) => {
  if (!mes) return ''
  const [ano, m] = mes.split('-')
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${nomes[Number(m) - 1] || m}/${String(ano).slice(2)}`
}

function Indicador({ rotulo, valor, sub }) {
  return (
    <div className="card" style={{ flex: '1 1 150px', padding: '12px 14px' }}>
      <p className="muted" style={{ margin: 0, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{rotulo}</p>
      <p style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{valor}</p>
      {sub && <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>{sub}</p>}
    </div>
  )
}

const COLUNAS = ['Mês', 'Est. inicial', '(+) Compras', '(−) Est. final', '(=) Consumo', 'Teórico', 'Diferença', 'Diferença (R$)']

export default function HistoricoProduto() {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState([])
  const [selecionado, setSelecionado] = useState(null)
  const [dados, setDados] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (termo.trim().length < 2) {
      setResultados([])
      return
    }
    let ativo = true
    const t = setTimeout(() => {
      buscarProdutosInsumoBase(termo.trim())
        .then((r) => { if (ativo) setResultados(r || []) })
        .catch(() => {})
    }, 250)
    return () => { ativo = false; clearTimeout(t) }
  }, [termo])

  async function escolher(produto) {
    setSelecionado(produto)
    setDados(null)
    setErro('')
    setCarregando(true)
    try {
      const r = await buscarHistoricoDoProduto(produto.codigo_everest)
      if (r) setDados(r)
      else setErro('Produto não encontrado no cadastro atual.')
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  const unidade = dados?.produto?.unidade || ''
  const comUnidade = (v, casas = 3) => (v == null ? '—' : `${formatarNumero(v, casas)} ${unidade}`)

  const serie = (dados?.linhas || []).map((l) => ({
    mes: rotuloMes(l.mes),
    Compras: l.comprasQtd,
    'Consumo teórico': l.teorico
  }))

  const dataBR = (iso) => iso?.slice(0, 10).split('-').reverse().join('/')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Histórico do produto</p>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
          Compras, consumo teórico e movimento de estoque de um <strong>insumo base</strong>, mês a
          mês. Tudo que foi contado como pré-preparo ou porcionado é convertido de volta pelo fator
          de correção e somado aqui.
        </p>

        <label className="muted">Buscar por nome ou código Everest</label>
        <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="ex.: filet mignon ou 2000088" />

        {resultados.length > 0 && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
            {resultados.slice(0, 18).map((p) => {
              const ativo = selecionado?.codigo_everest === p.codigo_everest
              return (
                <button
                  key={p.codigo_everest}
                  onClick={() => escolher(p)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                    padding: '9px 12px', borderRadius: 8, lineHeight: 1.3,
                    border: `1px solid ${ativo ? '#C15A1B' : 'var(--border)'}`,
                    background: ativo ? 'color-mix(in srgb, #C15A1B 12%, transparent)' : 'var(--surface-2)',
                    color: 'var(--text)'
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: ativo ? 700 : 600 }}>{p.nome}</span>
                  <span className="muted" style={{ display: 'block', fontSize: 11, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                    {p.codigo_everest} · {p.unidade_medida}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {termo.trim().length >= 2 && resultados.length === 0 && (
          <p className="muted" style={{ margin: '12px 0 0', fontSize: 12 }}>
            Nenhum insumo base com esse termo. Esta tela lista só insumos base — itens comprados,
            sem ficha técnica. Pratos e pré-preparos ficam de fora de propósito: o consumo deles é
            calculado aqui dentro, convertido pro insumo que os originou.
          </p>
        )}
      </div>

      {erro && (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--danger)' }}>{erro}</p>
        </div>
      )}

      {carregando && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Montando o histórico…</p>
        </div>
      )}

      {dados && !carregando && (
        <>
          <div className="card">
            <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>{dados.produto.nome}</p>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
              {dados.produto.codigoEverest} · {dados.produto.unidade}
              {dados.produto.subgrupo ? ` · ${dados.produto.subgrupo}` : ''}
              {dados.produto.categoria ? ` · ${dados.produto.categoria}` : ''}
            </p>
            {/* Sem este aviso, o estoque parece não fechar com o item cru — ele soma vários
                produtos contados que convergem pro mesmo insumo. */}
            {dados.itensQueGeramEstoque?.length > 1 && (
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
                O estoque abaixo soma <strong>{dados.itensQueGeramEstoque.length} produtos contados</strong>{' '}
                que se convertem neste insumo (pré-preparos e porcionados, cada um pelo seu fator),
                não só o item cru.
              </p>
            )}
          </div>

          <div>
            <p className="muted" style={{ margin: '0 0 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Média de compra
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Indicador rotulo="Por dia" valor={comUnidade(dados.medias?.dia, 2)} />
              <Indicador rotulo="Por semana" valor={comUnidade(dados.medias?.semana, 2)} />
              <Indicador rotulo="Por mês" valor={comUnidade(dados.medias?.mes, 2)} />
              <Indicador rotulo="Por ano" valor={comUnidade(dados.medias?.ano, 1)} />
              <Indicador
                rotulo="Valor médio"
                valor={dados.totais.precoMedio != null ? `${formatarMoeda(dados.totais.precoMedio)}/${unidade}` : '—'}
                sub={`${formatarMoeda(dados.totais.comprasValor)} em ${formatarNumero(dados.totais.comprasQtd, 2)} ${unidade}`}
              />
            </div>
            {/* Deixa explícito que são médias derivadas de um total, não uma série diária — a
                diferença importa pra quem for usar isso pra dimensionar compra. */}
            <p className="muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
              {dados.periodoCompras.dias > 0
                ? `Calculado sobre o período com compras registradas: ${dataBR(dados.periodoCompras.primeira)} a ${dataBR(dados.periodoCompras.ultima)} (${dados.periodoCompras.dias} dias). São médias derivadas desse total — não uma série por dia.`
                : 'Nenhuma compra registrada desse produto na base.'}
            </p>
          </div>

          {serie.length > 0 && (
            <div className="card">
              <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 14 }}>Compras × Consumo teórico</p>
              <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
                Quantidade comprada (barra) e o que as vendas do mês pediam pelas fichas (linha), em {unidade}.
              </p>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <ComposedChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.35} />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip cursor={{ fill: 'rgba(28,43,68,0.06)' }} formatter={(v) => `${formatarNumero(v, 2)} ${unidade}`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Compras" fill={COR_COMPRAS} radius={[3, 3, 0, 0]} activeBar={{ fillOpacity: 0.85 }} />
                    <Line type="monotone" dataKey="Consumo teórico" stroke={COR_TEORICO} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="card" style={{ overflowX: 'auto' }}>
            <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 14 }}>Análise mês a mês</p>
            <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
              Est. inicial + Compras − Est. final = Consumo real. Comparado com o teórico das fichas.
            </p>

            {dados.linhas.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Sem movimento registrado desse produto.</p>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 820 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {COLUNAS.map((c, i) => (
                        <th key={c} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '7px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dados.linhas.map((l) => {
                      // Diferença negativa = consumiu mais do que as fichas explicam. É o caso que
                      // interessa, então a linha inteira fica marcada.
                      const alerta = l.diferencaValor != null && l.diferencaValor < -0.01
                      const num = { padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
                      return (
                        <tr key={l.mes} style={{ borderBottom: '1px solid var(--border)', background: alerta ? 'color-mix(in srgb, var(--danger) 7%, transparent)' : 'transparent' }}>
                          <td style={{ padding: '8px', whiteSpace: 'nowrap', fontWeight: 600 }}>{rotuloMes(l.mes)}</td>
                          <td style={num}>{l.estoqueInicial == null ? '—' : formatarNumero(l.estoqueInicial, 3)}</td>
                          <td style={num}>{formatarNumero(l.comprasQtd, 3)}</td>
                          <td style={num}>{l.estoqueFinal == null ? '—' : formatarNumero(l.estoqueFinal, 3)}</td>
                          <td style={{ ...num, fontWeight: 600 }}>{l.consumo == null ? '—' : formatarNumero(l.consumo, 3)}</td>
                          <td style={{ ...num, background: 'color-mix(in srgb, #1C2B44 7%, transparent)', color: '#1C2B44', fontWeight: 600 }}>
                            {formatarNumero(l.teorico, 3)}
                          </td>
                          <td style={{ ...num, fontWeight: alerta ? 800 : 600, color: alerta ? 'var(--danger)' : 'var(--text)' }}>
                            {l.diferenca == null ? '—' : formatarNumero(l.diferenca, 3)}
                          </td>
                          <td style={{ ...num, fontWeight: alerta ? 800 : 600, color: alerta ? 'var(--danger)' : 'var(--text)' }}>
                            {l.diferencaValor == null ? '—' : formatarMoeda(l.diferencaValor)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
                  Diferença = teórico − consumo (mesma convenção do CMV Real × Teórico): negativa em
                  vermelho = consumiu mais do que as fichas explicam. Mês sem inventário nas duas
                  pontas fica com "—" no consumo — sem as duas contagens não existe a conta, e chutar
                  zero criaria um desvio que não é real. Valor em R$ pelo preço médio de compra do
                  próprio mês.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
