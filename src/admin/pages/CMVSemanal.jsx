import { useEffect, useMemo, useState } from 'react'
import { listarGruposAdmin, listarDatasContagemPorGrupo, buscarCMVSemanal } from '../lib/adminApi'
import { ultimoTrecho } from '../lib/formato'

const num = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtDia = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('pt-BR') : '—')
// NBSP entre "R$" e o número (não espaço normal) — evita quebra de linha no meio do valor
// em card/coluna estreita (mesmo fix aplicado em formato.js/formatarMoeda, 09/08/2026).
const fmtRS = (n) => n == null ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CMVSemanal() {
  const [grupos, setGrupos] = useState([])
  const [grupoId, setGrupoId] = useState('')
  const [datas, setDatas] = useState([])
  const [carregandoDatas, setCarregandoDatas] = useState(false)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [dados, setDados] = useState(null)
  const [calculando, setCalculando] = useState(false)
  const [erro, setErro] = useState('')
  const [subgrupoEverestFiltro, setSubgrupoEverestFiltro] = useState('')
  const [popup, setPopup] = useState(null) // linha selecionada pro detalhe

  useEffect(() => {
    listarGruposAdmin().then(setGrupos).catch(() => {})
  }, [])

  useEffect(() => {
    setDados(null)
    setDataInicio('')
    setDataFim('')
    if (!grupoId) { setDatas([]); return }
    setCarregandoDatas(true)
    listarDatasContagemPorGrupo(grupoId)
      .then((lista) => {
        setDatas(lista)
        // Lista vem do mais antigo pro mais novo — sugestão inicial: a data mais recente como
        // "fim", a anterior a ela como "início".
        if (lista.length) setDataFim(lista[lista.length - 1].data)
        if (lista.length > 1) setDataInicio(lista[lista.length - 2].data)
      })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregandoDatas(false))
  }, [grupoId])

  async function calcular() {
    setErro(''); setCalculando(true)
    setSubgrupoEverestFiltro('') // novo cálculo pode ter um conjunto diferente de subgrupos — não mantém filtro de outra consulta
    try {
      setDados(await buscarCMVSemanal({ grupoId: grupoId || null, dataInicio: dataInicio || null, dataFim: dataFim || null }))
    } catch (e) {
      setErro(e.message)
    } finally {
      setCalculando(false)
    }
  }

  // Filtro "Subgrupo do Everest" — trocado de "Grupo" pra "Subgrupo" a pedido do Felipe (grupo é
  // muito genérico; subgrupo é mais específico, ex. "CARNES BOVINAS" em vez de só "CARNES"). Só
  // oferece os subgrupos que de fato aparecem no resultado dessa consulta (ex.: se a contagem só
  // tem itens de Proteínas/Secos/Alimentação Funcionário, só os subgrupos desses 3 aparecem pra
  // escolher) — não a lista inteira de subgrupos do Everest cadastrados na empresa toda.
  const opcoesSubgrupoEverest = useMemo(() => {
    if (!dados) return []
    const nomes = new Set(dados.linhas.map((l) => ultimoTrecho(l.subgrupoEverest)).filter(Boolean))
    return Array.from(nomes).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [dados])

  const linhasFiltradas = useMemo(() => {
    if (!dados) return []
    if (!subgrupoEverestFiltro) return dados.linhas
    return dados.linhas.filter((l) => ultimoTrecho(l.subgrupoEverest) === subgrupoEverestFiltro)
  }, [dados, subgrupoEverestFiltro])

  return (
    <div>
      <div className="app-header" style={{ marginBottom: 10 }}>
        <p className="brand">CMV Real × Teórico</p>
        <p className="subtitle">
          Por insumo em natura, entre 2 datas exatas de contagem, dentro de 1 grupo de contagem (ex.: "Proteínas") —
          todas as lojas juntas, já que Compras não separa por loja no Everest. Real = estoque contado na data de
          início + compras no intervalo − estoque contado na data de fim. Teórico = fichas dos pratos vendidos no
          mesmo intervalo que usam algum insumo desse grupo. Conversão pro insumo em natura é automática (regra da
          folha — ver Consolidado da contagem), não depende mais de fator cadastrado manualmente.
        </p>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        <div>
          <label className="muted">Grupo de contagem</label>
          <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)} style={{ width: '100%' }}>
            <option value="">Selecione…</option>
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="muted">Data de início (estoque do começo)</label>
          <select
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            disabled={!grupoId || carregandoDatas || datas.length === 0}
            style={{ width: '100%' }}
          >
            <option value="">— nenhuma —</option>
            {datas.map((d) => (
              <option key={d.data} value={d.data}>{fmtDia(d.data)} · {d.totalSessoes} sessão(ões)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="muted">Data de fim (estoque do fim)</label>
          <select
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            disabled={!grupoId || carregandoDatas || datas.length === 0}
            style={{ width: '100%' }}
          >
            <option value="">— nenhuma —</option>
            {datas.map((d) => (
              <option key={d.data} value={d.data}>{fmtDia(d.data)} · {d.totalSessoes} sessão(ões)</option>
            ))}
          </select>
        </div>
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}
        <button className="primary" onClick={calcular} disabled={calculando || !grupoId || (!dataInicio && !dataFim)}>
          {calculando ? 'Calculando…' : 'Calcular'}
        </button>
      </div>

      {dados && opcoesSubgrupoEverest.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label className="muted">Filtrar por subgrupo do Everest (opcional)</label>
          <select value={subgrupoEverestFiltro} onChange={(e) => setSubgrupoEverestFiltro(e.target.value)} style={{ width: '100%' }}>
            <option value="">Todos os subgrupos</option>
            {opcoesSubgrupoEverest.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      )}

      {dados && (
        <p className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
          Estoque inicial de {fmtDia(dados.dataInicio)} ({dados.sessoesInicio} sessão(ões)) · estoque final de {fmtDia(dados.dataFim)} ({dados.sessoesFim} sessão(ões)) ·
          compras e vendas consideradas de {fmtDia(dados.dataInicio)} a {fmtDia(dados.dataFim)}, restritas aos insumos desse grupo.
        </p>
      )}

      {dados != null && (
        linhasFiltradas.length === 0 ? (
          <p className="muted">
            {dados.linhas.length === 0
              ? 'Nenhum insumo em natura com movimento no período. Confere se há contagem/compras/vendas no intervalo escolhido.'
              : 'Nenhum insumo desse subgrupo do Everest no período — tenta "Todos os subgrupos" ou outro filtro.'}
          </p>
        ) : (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <div style={{ minWidth: 560 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(5, 1fr)', gap: 0, fontSize: 11, fontWeight: 600, color: 'var(--muted)', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                <span>Insumo em natura</span>
                <span style={{ textAlign: 'right' }}>Est. inic.</span>
                <span style={{ textAlign: 'right' }}>Compras</span>
                <span style={{ textAlign: 'right' }}>Est. final</span>
                <span style={{ textAlign: 'right' }}>Real</span>
                <span style={{ textAlign: 'right' }}>Teórico</span>
              </div>
              {linhasFiltradas.map((l) => {
                const desvio = l.diferenca
                const cor = Math.abs(desvio) > Math.max(0.001, Math.abs(l.teorico) * 0.1) ? 'var(--danger)' : 'var(--text)'
                return (
                  <button
                    key={l.codigoEverest}
                    onClick={() => setPopup(l)}
                    style={{
                      display: 'grid', gridTemplateColumns: '1.4fr repeat(5, 1fr)', gap: 0, width: '100%',
                      alignItems: 'center', textAlign: 'left', background: 'none', border: 'none',
                      borderBottom: '1px solid var(--border)', padding: '10px 12px', fontSize: 13, cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', gap: 2 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.nome}</span>
                      <span className="muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.unidade} · {l.codigoEverest}{l.subgrupoEverest ? ` · ${ultimoTrecho(l.subgrupoEverest)}` : ''}
                      </span>
                    </div>
                    <span style={{ textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{num(l.estoqueInicial)}</span>
                    <span style={{ textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{num(l.compras)}</span>
                    <span style={{ textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{num(l.estoqueFinal)}</span>
                    <span style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{num(l.real)}</span>
                    <span style={{ textAlign: 'right', fontWeight: 700, color: cor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{num(l.teorico)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      )}
      {dados != null && linhasFiltradas.length > 0 && (
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          Real e Teórico são quantidades de insumo em natura consumidas. Diferença grande (Real ≫ Teórico) = consumo
          acima do que as vendas justificam — perda, quebra ou porção fora do padrão. Toque num item pra ver o detalhe
          (estoque inicial/compras/final, e a diferença já em R$ — teórico menos real, então diferença negativa = perda).
        </p>
      )}

      {/* Popup detalhe do item — pedido do Felipe (09/08/2026): ver a estrutura completa (inicial,
          compras, final, real, teórico, diferença) e a diferença já convertida em R$.
          ⚠️ Convenção da diferença (corrigida em 09/08/2026, a pedido do Felipe): TEÓRICO − REAL, não
          o contrário — positiva = consumimos MENOS que o esperado (economia, verde); negativa =
          consumimos MAIS que o esperado (perda/quebra, vermelho). Mesma direção do "Consumo teórico ×
          Venda" em Análise de Custo.
          Custo unitário: preferência pro custo médio de COMPRA do próprio insumo no período (mais
          confiável — é o preço de fato pago, não um retrato antigo de alguma ficha); só cai pro custo
          da ficha técnica (a mais recente, quando o insumo tem custo em mais de uma) quando não teve
          compra direta no período. */}
      {popup && (
        <div onClick={() => setPopup(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
          <div className="card" style={{ maxWidth: 420, width: '100%', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>{popup.nome}</p>
              <button onClick={() => setPopup(null)} style={{ background: 'none', border: 'none', fontSize: 18 }}>×</button>
            </div>
            <p className="muted" style={{ margin: '4px 0 14px', fontSize: 12 }}>
              {popup.unidade} · {popup.codigoEverest}{popup.subgrupoEverest ? ` · ${ultimoTrecho(popup.subgrupoEverest)}` : ''}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['Estoque inicial', num(popup.estoqueInicial)],
                ['Compras', num(popup.compras)],
                ['Estoque final', num(popup.estoqueFinal)],
                ['Real (consumido)', num(popup.real)],
                ['Teórico (esperado pelas fichas)', num(popup.teorico)]
              ].map(([rotulo, valor]) => (
                <div key={rotulo} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                  <span className="muted">{rotulo}</span>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{valor} {popup.unidade}</span>
                </div>
              ))}

              <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 10, display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                <span className="muted">Diferença (teórico − real)</span>
                <span style={{
                  fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                  color: popup.diferenca > 0 ? 'var(--success)' : popup.diferenca < 0 ? 'var(--danger)' : 'var(--text)'
                }}>
                  {popup.diferenca > 0 ? '+' : ''}{num(popup.diferenca)} {popup.unidade}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                <span className="muted">Diferença em valor</span>
                <span style={{
                  fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                  color: popup.diferencaValor == null ? 'var(--text)' : popup.diferencaValor > 0 ? 'var(--success)' : popup.diferencaValor < 0 ? 'var(--danger)' : 'var(--text)'
                }}>
                  {popup.diferencaValor == null ? '—' : (popup.diferencaValor > 0 ? '+' : '') + fmtRS(popup.diferencaValor)}
                </span>
              </div>

              {popup.custoUnitario != null ? (
                <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>
                  Custo considerado: {fmtRS(popup.custoUnitario)}/{popup.unidade} ({popup.custoOrigem === 'compras' ? 'média das compras desse insumo no período' : 'ficha técnica mais recente'}) ·
                  diferença positiva = consumimos menos que o teórico (economia) · negativa = consumimos mais (perda, custou mais).
                </p>
              ) : (
                <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>
                  Esse insumo não teve compra no período nem custo cadastrado numa ficha técnica — não dá pra converter a diferença em R$.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
