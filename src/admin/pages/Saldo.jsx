import { useEffect, useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { buscarProdutosAdmin, listarGruposEverestComContagem, listarUnidadesAdmin, buscarSaldoMensalPorProdutos, buscarSaldoPorGrupoEverest } from '../lib/adminApi'

const NOMES_MES_SALDO = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const NOMES_MES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

// Evita o clássico 1.2999999999999998 de ponto flutuante, e deixa toda quantidade com a mesma
// quantidade de casas (pedido do Felipe).
function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function rotuloMes(ano, mes) {
  return `${ano}-${String(mes).padStart(2, '0')}`
}
function labelMes(rotulo) {
  const [ano, mes] = rotulo.split('-').map(Number)
  return `${NOMES_MES_ABREV[mes - 1]}/${String(ano).slice(2)}`
}
// Lista todo mês entre início e fim (inclusive) — mesmo os sem contagem nenhuma aparecem (com
// "—"), porque o ponto é comparar mês a mês e um buraco também é informação.
function mesesDoPeriodo(inicio, fim) {
  const lista = []
  let ano = inicio.ano, mes = inicio.mes
  while (ano < fim.ano || (ano === fim.ano && mes <= fim.mes)) {
    lista.push(rotuloMes(ano, mes))
    mes++
    if (mes > 12) { mes = 1; ano++ }
  }
  return lista
}

// Pedido do Felipe (01/10/2026 → ajustado em 02/10/2026): esta tela é só do Inventário (mensal) —
// "Grupo de contagem" (semanal/diário) mudou pra aba própria dentro de Contagem semanal, ver
// `SaldoSemanal.jsx`. Loja é FILTRO (escolhe 1, várias ou todas as lojas, soma na mesma coluna) —
// não mais uma coluna por loja. A coluna é o MÊS, dentro de um período (ex.: Jan até Set), pra dar
// pra comparar mês a mês.
export default function Saldo() {
  const [modo, setModo] = useState('item') // 'item' | 'grupoEverest'

  const [termo, setTermo] = useState('')
  const [resultadosBusca, setResultadosBusca] = useState([])
  const [produtoSelecionado, setProdutoSelecionado] = useState(null)
  const [porMesItem, setPorMesItem] = useState(new Map())
  const debounceRef = useRef(null)

  const [gruposEverest, setGruposEverest] = useState([])
  const [grupoEverestSelecionado, setGrupoEverestSelecionado] = useState('')
  const [saldoGrupo, setSaldoGrupo] = useState([])

  const [unidades, setUnidades] = useState([])
  const [unidadesSelecionadas, setUnidadesSelecionadas] = useState(new Set())

  const hoje = new Date()
  const [inicioMes, setInicioMes] = useState(hoje.getMonth() + 1)
  const [inicioAno, setInicioAno] = useState(hoje.getFullYear())
  const [fimMes, setFimMes] = useState(hoje.getMonth() + 1)
  const [fimAno, setFimAno] = useState(hoje.getFullYear())

  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    listarUnidadesAdmin().then((lista) => {
      setUnidades(lista)
      setUnidadesSelecionadas(new Set(lista.map((u) => u.id))) // começa com todas marcadas
    })
  }, [])

  // Lista de grupos só com o que teve contagem de verdade dentro do filtro atual (período +
  // lojas) — refaz sempre que o filtro muda, não só quando troca de modo. Se o grupo que estava
  // escolhido sumir da lista nova (filtro mudou e ele não tem mais dado), limpa a seleção em vez
  // de deixar uma tela "selecionada" mas sem nada atrás.
  useEffect(() => {
    if (modo !== 'grupoEverest' || unidades.length === 0) return
    listarGruposEverestComContagem(filtroAtual()).then((lista) => {
      setGruposEverest(lista)
      if (grupoEverestSelecionado && !lista.includes(grupoEverestSelecionado)) {
        setGrupoEverestSelecionado('')
        setSaldoGrupo([])
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, unidades, inicioMes, inicioAno, fimMes, fimAno, unidadesSelecionadas])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (termo.trim().length < 2) { setResultadosBusca([]); return }
    debounceRef.current = setTimeout(async () => {
      setResultadosBusca(await buscarProdutosAdmin(termo))
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [termo])

  function filtroAtual() {
    // Nenhuma loja marcada = ninguém escolheu nada ainda (não confundir com "todas"); só manda o
    // filtro de unidade quando nem todas estão marcadas, pra não mandar uma lista gigante à toa.
    const todasMarcadas = unidades.length > 0 && unidadesSelecionadas.size === unidades.length
    return {
      unidadeIds: (unidadesSelecionadas.size > 0 && !todasMarcadas) ? [...unidadesSelecionadas] : undefined,
      periodoInicio: { mes: inicioMes, ano: inicioAno },
      periodoFim: { mes: fimMes, ano: fimAno }
    }
  }

  async function carregarItem(produtoId) {
    setCarregando(true)
    try {
      const mapa = await buscarSaldoMensalPorProdutos([produtoId], filtroAtual())
      setPorMesItem(mapa.get(produtoId) || new Map())
    } finally {
      setCarregando(false)
    }
  }

  async function handleSelecionarProduto(produto) {
    setProdutoSelecionado(produto)
    setTermo('')
    setResultadosBusca([])
    await carregarItem(produto.id)
  }

  async function carregarGrupo(nome) {
    setCarregando(true)
    try {
      setSaldoGrupo(await buscarSaldoPorGrupoEverest(nome, filtroAtual()))
    } finally {
      setCarregando(false)
    }
  }

  async function handleSelecionarGrupoEverest(nome) {
    setGrupoEverestSelecionado(nome)
    if (!nome) return
    await carregarGrupo(nome)
  }

  // Recarrega quando período/lojas mudam, com produto/grupo já escolhido.
  useEffect(() => {
    if (modo === 'item' && produtoSelecionado) carregarItem(produtoSelecionado.id)
    if (modo === 'grupoEverest' && grupoEverestSelecionado) carregarGrupo(grupoEverestSelecionado)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicioMes, inicioAno, fimMes, fimAno, unidadesSelecionadas])

  function toggleUnidade(id) {
    setUnidadesSelecionadas((prev) => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  // Arrastar a tabela pro lado com o mouse (pedido do Felipe) — sem isso, só dava pra rolar pelo
  // scrollbar embaixo ou trackpad. `arrastando` evita que um simples clique (sem mover o mouse)
  // seja confundido com arraste.
  const scrollRef = useRef(null)
  const arrastoRef = useRef(null)
  function iniciarArrasto(e) {
    arrastoRef.current = { x: e.clientX, scrollLeft: scrollRef.current.scrollLeft, arrastando: false }
  }
  function moverArrasto(e) {
    if (!arrastoRef.current) return
    const dx = e.clientX - arrastoRef.current.x
    if (Math.abs(dx) > 3) arrastoRef.current.arrastando = true
    scrollRef.current.scrollLeft = arrastoRef.current.scrollLeft - dx
  }
  function pararArrasto() { arrastoRef.current = null }

  const meses = mesesDoPeriodo({ mes: inicioMes, ano: inicioAno }, { mes: fimMes, ano: fimAno })
  const dadosGraficoItem = meses.map((m) => ({ mes: labelMes(m), quantidade: porMesItem.get(m) ?? 0 }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="segmented" style={{ marginBottom: 16 }}>
          <button className={modo === 'item' ? 'active' : ''} onClick={() => setModo('item')}>Por item</button>
          <button className={modo === 'grupoEverest' ? 'active' : ''} onClick={() => setModo('grupoEverest')}>Grupo</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="muted" style={{ display: 'block', marginBottom: 6 }}>Loja (filtro — marque 1, várias ou todas)</label>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {unidades.map((u) => (
              <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={unidadesSelecionadas.has(u.id)} onChange={() => toggleUnidade(u.id)} style={{ width: 'auto' }} />
                {u.nome}
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <label className="muted" style={{ display: 'block', marginBottom: 4 }}>De</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={inicioMes} onChange={(e) => setInicioMes(Number(e.target.value))}>
                {NOMES_MES_SALDO.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select value={inicioAno} onChange={(e) => setInicioAno(Number(e.target.value))}>
                {[hoje.getFullYear() - 1, hoje.getFullYear(), hoje.getFullYear() + 1].map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="muted" style={{ display: 'block', marginBottom: 4 }}>Até</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={fimMes} onChange={(e) => setFimMes(Number(e.target.value))}>
                {NOMES_MES_SALDO.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select value={fimAno} onChange={(e) => setFimAno(Number(e.target.value))}>
                {[hoje.getFullYear() - 1, hoje.getFullYear(), hoje.getFullYear() + 1].map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
        </div>

        {modo === 'item' && (
          <div style={{ position: 'relative' }}>
            <label className="muted">Busca por nome ou código Everest (funciona pros dois)</label>
            <input placeholder="Ex: 2000263 ou Arroz tipo 1" value={termo} onChange={(e) => setTermo(e.target.value)} style={{ marginTop: 4 }} />
            {resultadosBusca.length > 0 && (
              <div className="card" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, padding: 0, zIndex: 5, maxHeight: 240, overflowY: 'auto' }}>
                {resultadosBusca.map((p) => (
                  <div key={p.id} className="list-item" style={{ cursor: 'pointer', padding: '10px 14px' }} onClick={() => handleSelecionarProduto(p)}>
                    <span>{p.nome}</span>
                    <span className="muted">Everest {p.codigo_everest || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {modo === 'grupoEverest' && (
          <>
            <label className="muted">Grupo cadastrado no Everest</label>
            <select value={grupoEverestSelecionado} onChange={(e) => handleSelecionarGrupoEverest(e.target.value)} style={{ marginTop: 4 }}>
              <option value="">Selecione…</option>
              {gruposEverest.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </>
        )}
      </div>

      {carregando && <div className="card"><p className="muted">Carregando…</p></div>}

      {modo === 'item' && produtoSelecionado && !carregando && (
        <div className="card">
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>{produtoSelecionado.nome}</p>
          <p className="muted" style={{ margin: '0 0 14px' }}>Everest {produtoSelecionado.codigo_everest || '—'}</p>
          <div style={{ width: '100%', height: 220, marginBottom: 16 }}>
            <ResponsiveContainer>
              <BarChart data={dadosGraficoItem}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="mes" stroke="var(--text-secondary)" fontSize={12} />
                <YAxis stroke="var(--text-secondary)" fontSize={12} />
                <Tooltip contentStyle={{ background: 'var(--header-bg)', border: '0.5px solid rgba(244,241,233,0.15)', borderRadius: 8, color: 'var(--header-text)' }} />
                <Bar dataKey="quantidade" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {meses.map((m) => (
            <div key={m} className="list-item">
              <span>{labelMes(m)}</span>
              <span>{fmt(porMesItem.get(m))}</span>
            </div>
          ))}
        </div>
      )}

      {modo === 'grupoEverest' && grupoEverestSelecionado && !carregando && (
        <div className="card">
          <p style={{ margin: '0 0 14px', fontWeight: 600, fontSize: 15 }}>
            Saldo por item — {grupoEverestSelecionado}
          </p>
          {saldoGrupo.length === 0 ? (
            <p className="muted">Nenhum item desse grupo foi contado nesse filtro ainda. Confere o período ou as lojas marcadas.</p>
          ) : (
            <div
              ref={scrollRef}
              onMouseDown={iniciarArrasto}
              onMouseMove={moverArrasto}
              onMouseUp={pararArrasto}
              onMouseLeave={pararArrasto}
              style={{ overflowX: 'auto', cursor: 'grab' }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, userSelect: 'none' }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <th style={{ position: 'sticky', left: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500, zIndex: 1 }}>Produto</th>
                    {meses.map((m) => (
                      <th key={m} style={{ textAlign: 'right', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {labelMes(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {saldoGrupo.map(({ produto, porMes }) => (
                    <tr key={produto.id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                      <td style={{ position: 'sticky', left: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', padding: '8px', whiteSpace: 'nowrap' }}>{produto.nome}</td>
                      {meses.map((m) => (
                        <td key={m} style={{ textAlign: 'right', padding: '8px' }}>{fmt(porMes.get(m))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
