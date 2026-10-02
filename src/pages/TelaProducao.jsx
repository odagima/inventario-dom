import { useCallback, useEffect, useState } from 'react'
import BuscaProdutoPerda from '../components/BuscaProdutoPerda'
import { CATEGORIAS_PERDA, LABEL_TURNO } from '../lib/perdas'
import { listarFrentes } from '../lib/frentesApi'
import { buscarFatoresCorrecao, calcularFCTeorico, descendentesDe, brutoEquivalente, buscarProdutosMesmaFamilia } from '../lib/fatoresCorrecaoApi'
import { registrarMovimento } from '../lib/estoqueMovimentosApi'
import { buscarProdutosPorCodigosEverest } from '../lib/api'
import {
  listarProducoesEmAndamento,
  listarProducoesPlanejadas,
  criarProducaoPlanejada,
  iniciarProducaoPlanejada,
  abrirProducao,
  adicionarItemProducao,
  removerItemProducao,
  finalizarProducao,
  cancelarProducao,
  rendimentoDoEvento,
  mediaFCTeoricoHistorico
} from '../lib/producaoApi'

// Tela única: painel do que está em andamento + "a fazer" + abertura + fechamento.
//
// A produção é da COZINHA, não de quem abriu — a lista mostra tudo que está aberto, e qualquer
// pessoa fecha. Resolve troca de turno e preparo de vários dias sem caso especial.
//
// Fluxo: "peguei 10 kg de filet peça" (abre, escolhe a frente) → some do caminho de quem lançou,
// fica no painel → depois, alguém abre e registra só o LÍQUIDO de cada item que saiu (o bruto já
// foi pesado uma vez, na abertura) → finaliza → credita/debita o saldo calculado da frente.

const CAT_INSUMO = CATEGORIAS_PERDA.find((c) => c.valor === 'materia_prima')
const CAT_PP = CATEGORIAS_PERDA.find((c) => c.valor === 'pre_preparo')
// Na entrada cabe tanto matéria-prima (peça crua) quanto PP (limpeza virando porcionados); na
// saída, quase sempre PP. Deixo as duas opções nos dois lados: a cadeia real tem os dois casos.
const CATEGORIAS = [CAT_INSUMO, CAT_PP]

function hojeIso() { return new Date().toISOString().slice(0, 10) }
function turnoDeAgora() { return new Date().getHours() < 16 ? 'almoco' : 'jantar' }

function fmt(n, casas = 3) {
  const x = Number(n)
  if (!isFinite(x)) return '—'
  return x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}
function fmtFC(fc) {
  if (fc == null) return '—'
  return (fc * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
}

function diasAtras(iso) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'hoje'
  if (d === 1) return 'ontem'
  return `há ${d} dias`
}

export default function TelaProducao({ usuarioLogado, onSair }) {
  const [emAndamento, setEmAndamento] = useState([])
  const [planejadas, setPlanejadas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [tela, setTela] = useState('painel') // 'painel' | 'abrir' | 'fechar' | 'planejar'
  const [aberta, setAberta] = useState(null) // produção sendo fechada
  // Pré-preenchimento de "abrir": usado tanto por "Continuar e porcionar agora" quanto por
  // "Iniciar" numa planejada.
  const [prefill, setPrefill] = useState(null) // { frenteId, producaoOrigemId, planejadaId, produto, quantidade }

  const carregar = useCallback(async (silencioso = false) => {
    try {
      const [lista, planoLista] = await Promise.all([listarProducoesEmAndamento(), listarProducoesPlanejadas()])
      setEmAndamento(lista)
      setPlanejadas(planoLista)
      // Mantém a produção aberta em sincronia com o banco depois de cada mudança.
      setAberta((atual) => (atual ? lista.find((p) => p.id === atual.id) || null : null))
      setErro('')
    } catch (e) {
      if (!silencioso) setErro('Não consegui carregar — confere sua internet. ' + e.message)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function abrirFechamento(p) {
    setAberta(p)
    setTela('fechar')
  }

  function iniciarPlanejada(p) {
    setPrefill({ frenteId: p.frente_id, planejadaId: p.id, metaCodigoEverest: p.meta_codigo_everest, metaQuantidade: p.meta_quantidade })
    setTela('abrir')
  }

  function continuarEPorcionar(producaoOrigem, item) {
    setPrefill({
      frenteId: producaoOrigem.frente_id,
      producaoOrigemId: producaoOrigem.id,
      produtoPreCarregado: { codigo_everest: item.codigo_everest, id: item.produto_id, nome: item.produtos?.nome, unidade_medida: item.unidade },
      quantidade: item.quantidade
    })
    setTela('abrir')
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <span className="unidade">Produção</span>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              {tela === 'painel' ? 'o que está sendo produzido' : tela === 'abrir' ? 'nova produção' : tela === 'planejar' ? 'planejar o que falta produzir' : 'registrar o que saiu'}
            </p>
          </div>
          {tela === 'painel'
            ? <button className="ghost" onClick={onSair} style={{ flexShrink: 0 }}>Voltar</button>
            : <button className="ghost" onClick={() => { setTela('painel'); setAberta(null); setPrefill(null) }} style={{ flexShrink: 0 }}>Voltar</button>}
        </div>
      </div>

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

      {tela === 'painel' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <button className="primary" onClick={() => { setPrefill(null); setTela('abrir') }} style={{ flex: 1, padding: 16, fontSize: 16 }}>
              Iniciar produção
            </button>
            <button onClick={() => setTela('planejar')} style={{ padding: 16, fontSize: 16 }}>
              + Planejar
            </button>
          </div>

          {planejadas.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-2)', borderRadius: 12, padding: '12px 16px', marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>A fazer</span>
                <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: 20, padding: '3px 12px', fontSize: 13, fontWeight: 600 }}>
                  {planejadas.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                {planejadas.map((p) => (
                  <div key={p.id} className="card" style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
                        {p.meta_quantidade ? `${fmt(p.meta_quantidade)} ` : ''}{p.meta_codigo_everest}
                      </p>
                      <p className="muted" style={{ margin: '2px 0 0', fontSize: 11.5 }}>
                        {p.frentes?.nome || 'sem frente'} · {p.observacao || 'planejado'}
                      </p>
                    </div>
                    <button className="primary" onClick={() => iniciarPlanejada(p)} style={{ flexShrink: 0 }}>Iniciar</button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-2)', borderRadius: 12, padding: '12px 16px', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Em produção</span>
            <span style={{ background: emAndamento.length ? 'var(--accent)' : 'var(--surface-3)', color: '#fff', borderRadius: 20, padding: '3px 12px', fontSize: 13, fontWeight: 600 }}>
              {emAndamento.length}
            </span>
          </div>

          {carregando ? (
            <p className="muted">Carregando…</p>
          ) : emAndamento.length === 0 ? (
            <p className="muted">Nada em produção agora.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {emAndamento.map((p) => {
                const entradas = (p.producoes_itens || []).filter((i) => i.papel === 'entrada')
                const saidas = (p.producoes_itens || []).filter((i) => i.papel === 'saida')
                return (
                  <button
                    key={p.id}
                    onClick={() => abrirFechamento(p)}
                    className="card"
                    style={{ padding: '12px 14px', textAlign: 'left', width: '100%' }}
                  >
                    {entradas.map((e) => (
                      <p key={e.id} style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
                        {fmt(e.quantidade)} {e.unidade} · {e.produtos?.nome || e.codigo_everest}
                      </p>
                    ))}
                    <p className="muted" style={{ margin: '2px 0 0', fontSize: 11.5 }}>
                      {p.frentes?.nome ? `${p.frentes.nome} · ` : ''}{p.usuario_inicio || '—'} · {diasAtras(p.iniciada_em)}
                      {saidas.length > 0 && ` · ${saidas.length} ${saidas.length === 1 ? 'item já pesado' : 'itens já pesados'}`}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {tela === 'planejar' && (
        <FormPlanejar
          usuario={usuarioLogado?.nome}
          onPronto={async () => { await carregar(); setTela('painel') }}
          onErro={setErro}
        />
      )}

      {tela === 'abrir' && (
        <FormAbrir
          usuario={usuarioLogado?.nome}
          prefill={prefill}
          onPronto={async () => { await carregar(); setTela('painel'); setPrefill(null) }}
          onErro={setErro}
        />
      )}

      {tela === 'fechar' && aberta && (
        <FormFechar
          producao={aberta}
          usuario={usuarioLogado?.nome}
          onMudou={carregar}
          onContinuar={(item) => continuarEPorcionar(aberta, item)}
          onPronto={async () => { await carregar(); setTela('painel'); setAberta(null) }}
          onErro={setErro}
        />
      )}
    </div>
  )
}

// ── Planejar: só registra "o que falta produzir" (meta), sem pesar nada ainda ─────────────────
function FormPlanejar({ usuario, onPronto, onErro }) {
  const [frentes, setFrentes] = useState([])
  const [frenteId, setFrenteId] = useState('')
  const [categoria, setCategoria] = useState(CATEGORIAS[1])
  const [produto, setProduto] = useState(null)
  const [quantidade, setQuantidade] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => { listarFrentes().then(setFrentes).catch((e) => onErro(e.message)) }, [onErro])

  async function salvar() {
    setSalvando(true)
    try {
      await criarProducaoPlanejada({
        data: hojeIso(), frenteId, metaCodigoEverest: produto.codigo_everest,
        metaQuantidade: quantidade ? Number(String(quantidade).replace(',', '.')) : null,
        observacao, usuario
      })
      onPronto()
    } catch (e) {
      onErro('Não consegui planejar — ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label className="muted">Frente</label>
        <select value={frenteId} onChange={(e) => setFrenteId(e.target.value)}>
          <option value="">Selecione…</option>
          {frentes.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
        </select>
      </div>
      {!produto ? (
        <>
          <p style={{ margin: 0, fontWeight: 600 }}>O que precisa ser produzido?</p>
          <div className="segmented">
            {CATEGORIAS.map((c) => (
              <button key={c.valor} type="button" onClick={() => setCategoria(c)} className={categoria?.valor === c.valor ? 'active' : ''}>
                {c.label}
              </button>
            ))}
          </div>
          <BuscaProdutoPerda categoria={categoria} onSelecionar={setProduto} />
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <p style={{ margin: 0, fontWeight: 500 }}>{produto.nome}</p>
            <button type="button" className="ghost" onClick={() => setProduto(null)}>trocar</button>
          </div>
          <div>
            <label className="muted">Quantidade desejada ({produto.unidade_medida}) — opcional</label>
            <input type="number" min="0" step="0.001" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </div>
          <div>
            <label className="muted">Observação — opcional</label>
            <input type="text" value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="ex.: pro final de semana" />
          </div>
          <button className="primary" onClick={salvar} disabled={salvando || !frenteId} style={{ width: '100%' }}>
            {salvando ? 'Salvando…' : 'Adicionar ao "a fazer"'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Abrir: a entrada ("o que eu peguei") + a frente ──────────────────────────────────────────
function FormAbrir({ usuario, prefill, onPronto, onErro }) {
  const [data, setData] = useState(hojeIso())
  const [turno, setTurno] = useState(turnoDeAgora())
  const [frentes, setFrentes] = useState([])
  const [frenteId, setFrenteId] = useState(prefill?.frenteId || '')
  const [categoria, setCategoria] = useState(CATEGORIAS[0])
  const [produto, setProduto] = useState(prefill?.produtoPreCarregado || null)
  const [quantidade, setQuantidade] = useState(prefill?.quantidade ? String(prefill.quantidade) : '')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => { listarFrentes().then(setFrentes).catch((e) => onErro(e.message)) }, [onErro])

  const qtd = Number(String(quantidade).replace(',', '.'))

  async function salvar() {
    setSalvando(true)
    try {
      const entrada = {
        codigoEverest: produto.codigo_everest,
        produtoId: produto.id,
        quantidade: qtd,
        unidade: produto.unidade_medida
      }
      if (prefill?.planejadaId) {
        await iniciarProducaoPlanejada(prefill.planejadaId, entrada, usuario)
      } else {
        await abrirProducao({
          data, turno, usuario, entrada, frenteId, producaoOrigemId: prefill?.producaoOrigemId
        })
      }
      onPronto()
    } catch (e) {
      onErro('Não consegui abrir — ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {prefill?.producaoOrigemId && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Continuando direto de onde parou — já veio com o produto e a quantidade que acabou de sair.</p>
      )}
      {prefill?.planejadaId && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Planejado: {prefill.metaQuantidade ? `${fmt(prefill.metaQuantidade)} ` : ''}{prefill.metaCodigoEverest}. Confirme o produto e pese o bruto de verdade.
        </p>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="muted">Data</label>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="muted">Turno</label>
          <div className="segmented" style={{ marginTop: 4 }}>
            {Object.entries(LABEL_TURNO).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setTurno(v)} className={turno === v ? 'active' : ''}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {!prefill?.planejadaId && (
        <div>
          <label className="muted">Frente</label>
          <select value={frenteId} onChange={(e) => setFrenteId(e.target.value)}>
            <option value="">Selecione…</option>
            {frentes.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </div>
      )}

      {!produto ? (
        <>
          <p style={{ margin: 0, fontWeight: 600 }}>O que você pegou?</p>
          <div className="segmented">
            {CATEGORIAS.map((c) => (
              <button key={c.valor} type="button" onClick={() => setCategoria(c)} className={categoria?.valor === c.valor ? 'active' : ''}>
                {c.label}
              </button>
            ))}
          </div>
          <BuscaProdutoPerda categoria={categoria} onSelecionar={setProduto} />
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 500 }}>{produto.nome}</p>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>Everest {produto.codigo_everest}</p>
            </div>
            <button type="button" className="ghost" onClick={() => setProduto(null)}>trocar</button>
          </div>
          <div>
            <label className="muted">Peso bruto ({produto.unidade_medida})</label>
            <input
              type="number" min="0" step="0.001" inputMode="decimal" autoFocus
              value={quantidade} onChange={(e) => setQuantidade(e.target.value)}
              name="producao-entrada" autoComplete="off"
            />
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Só esse peso aqui é bruto — os itens que saírem depois só pedem o líquido de cada um. Você registra o que saiu depois, quando terminar.
          </p>
          <button className="primary" onClick={salvar} disabled={salvando || !(qtd > 0) || (!prefill?.planejadaId && !frenteId)} style={{ width: '100%' }}>
            {salvando ? 'Abrindo…' : 'Iniciar produção'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Fechar: as saídas (só o líquido de cada uma) ─────────────────────────────────────────────
function FormFechar({ producao, usuario, onMudou, onContinuar, onPronto, onErro }) {
  const [categoria, setCategoria] = useState(CATEGORIAS[1]) // saída costuma ser pré-preparo
  const [produto, setProduto] = useState(null)
  const [quantidade, setQuantidade] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [mapaFatores, setMapaFatores] = useState(null)
  const [esperados, setEsperados] = useState({}) // codigo_everest -> F.C. teórico esperado (0..∞, ~1 = em cima do previsto)
  const [produtosFamilia, setProdutosFamilia] = useState([]) // itens que descendem da entrada na ficha técnica
  const [modoFiltro, setModoFiltro] = useState(true) // true = só a família; false = "ver catálogo inteiro"

  const itens = producao.producoes_itens || []
  const entradas = itens.filter((i) => i.papel === 'entrada')
  const saidas = itens.filter((i) => i.papel === 'saida')
  const r = rendimentoDoEvento(producao)
  const qtd = Number(String(quantidade).replace(',', '.'))
  const codigoEntrada = entradas[0]?.codigo_everest
  const nomeEntrada = entradas[0]?.produtos?.nome || codigoEntrada || 'insumo'

  useEffect(() => { buscarFatoresCorrecao().then(setMapaFatores).catch((e) => onErro(e.message)) }, [onErro])

  // Filtro inteligente (§ pedido do Felipe, 02/10/2026): ao escolher Mignon na entrada, não faz
  // sentido oferecer frango a passarinho na saída. Combina dois sinais, nenhum dos dois exige
  // cadastro extra pra funcionar: (1) a cadeia de fatores_correcao, quando já existe (mais precisa,
  // também alimenta o F.C. teórico); (2) semelhança de NOME (`buscarProdutosMesmaFamilia`), que
  // pega item que ainda não tem ficha técnica nem fator — ex. "PP FILET MIGNON CABEÇA E RABO PARA
  // LIMPAR". Se nenhum dos dois achar nada, a lista fica vazia e a tela cai de volta no fluxo de
  // busca de sempre — nunca bloqueia o lançamento.
  useEffect(() => {
    if (!codigoEntrada) return
    let cancelado = false
    async function montarFamilia() {
      const candidatos = new Map()
      if (mapaFatores) {
        const descendentes = [...descendentesDe(mapaFatores, codigoEntrada)]
        if (descendentes.length) {
          const porFator = await buscarProdutosPorCodigosEverest(descendentes)
          porFator.forEach((p) => candidatos.set(p.id, p))
        }
      }
      if (nomeEntrada) {
        const tiposItem = [...(CAT_INSUMO?.tiposItem || []), ...(CAT_PP?.tiposItem || [])]
        const porNome = await buscarProdutosMesmaFamilia(nomeEntrada, tiposItem)
        porNome.forEach((p) => { if (p.codigo_everest !== codigoEntrada) candidatos.set(p.id, p) })
      }
      if (!cancelado) setProdutosFamilia([...candidatos.values()].sort((a, b) => a.nome.localeCompare(b.nome)))
    }
    montarFamilia().catch(() => { if (!cancelado) setProdutosFamilia([]) })
    return () => { cancelado = true }
  }, [mapaFatores, codigoEntrada, nomeEntrada])

  // Esperado de cada item que já saiu — busca uma vez por código, não a cada render.
  useEffect(() => {
    if (!mapaFatores) return
    const codigos = [...new Set(saidas.map((s) => s.codigo_everest))].filter((c) => esperados[c] === undefined)
    if (!codigos.length) return
    Promise.all(codigos.map((c) => mediaFCTeoricoHistorico(c, mapaFatores).then((v) => [c, v])))
      .then((pares) => setEsperados((prev) => ({ ...prev, ...Object.fromEntries(pares) })))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapaFatores, saidas.length])

  // Sanity-check na hora de digitar: se o peso implicaria mais bruto do que a produção recebeu de
  // entrada, é quase sempre dedo errado (zero a mais, vírgula no lugar errado) — avisa antes de
  // adicionar, sem bloquear (a pessoa pode confirmar mesmo assim, perda grande é uma possibilidade real).
  const brutoImplicito = (mapaFatores && produto && qtd > 0) ? brutoEquivalente(mapaFatores, produto.codigo_everest, qtd) : null
  const avisoBruto = brutoImplicito != null && r ? { valor: brutoImplicito, estourou: brutoImplicito > r.entrada * 1.15 } : null

  async function adicionar() {
    setSalvando(true)
    try {
      await adicionarItemProducao({
        producaoId: producao.id,
        papel: 'saida',
        codigoEverest: produto.codigo_everest,
        produtoId: produto.id,
        quantidade: qtd,
        unidade: produto.unidade_medida,
        usuario
      })
      setProduto(null)
      setQuantidade('')
      await onMudou()
    } catch (e) {
      onErro('Não consegui salvar — ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function finalizarComMovimento() {
    setSalvando(true)
    try {
      await finalizarProducao(producao.id, usuario)
      // Saldo calculado da frente: credita cada saída, debita cada entrada. Produção sem frente
      // (lançamentos antigos, ou alguém sem frente escolhida) não mexe em saldo nenhum.
      if (producao.frente_id) {
        for (const e of entradas) {
          await registrarMovimento({ frenteId: producao.frente_id, codigoEverest: e.codigo_everest, quantidade: -Number(e.quantidade), tipo: 'producao_entrada', producaoId: producao.id, usuario })
        }
        for (const s of saidas) {
          await registrarMovimento({ frenteId: producao.frente_id, codigoEverest: s.codigo_everest, quantidade: Number(s.quantidade), tipo: 'producao_saida', producaoId: producao.id, usuario })
        }
      }
      onPronto()
    } catch (e) {
      onErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <p className="muted" style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Entrou</p>
        {entradas.map((e) => (
          <p key={e.id} style={{ margin: '2px 0 0', fontWeight: 600 }}>
            {fmt(e.quantidade)} {e.unidade} · {e.produtos?.nome || e.codigo_everest}
          </p>
        ))}
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 11.5 }}>
          {producao.frentes?.nome ? `${producao.frentes.nome} · ` : ''}aberta por {producao.usuario_inicio || '—'} · {diasAtras(producao.iniciada_em)}
        </p>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>O que saiu?</p>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Só o líquido — o bruto já foi pesado na abertura, uma vez só.</p>
        {!produto ? (
          <>
            {produtosFamilia.length > 0 && (
              <div className="segmented">
                <button type="button" onClick={() => setModoFiltro(true)} className={modoFiltro ? 'active' : ''}>
                  Só o que leva {nomeEntrada}
                </button>
                <button type="button" onClick={() => setModoFiltro(false)} className={!modoFiltro ? 'active' : ''}>
                  Catálogo inteiro
                </button>
              </div>
            )}
            {produtosFamilia.length > 0 && modoFiltro ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                {produtosFamilia.map((p) => (
                  <button
                    key={p.id} type="button" onClick={() => setProduto(p)} className="card"
                    style={{ padding: '14px 10px', textAlign: 'left', fontSize: 13.5, fontWeight: 500 }}
                  >
                    {p.nome}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="segmented">
                  {CATEGORIAS.map((c) => (
                    <button key={c.valor} type="button" onClick={() => setCategoria(c)} className={categoria?.valor === c.valor ? 'active' : ''}>
                      {c.label}
                    </button>
                  ))}
                </div>
                <BuscaProdutoPerda categoria={categoria} onSelecionar={setProduto} />
              </>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <p style={{ margin: 0, fontWeight: 500, minWidth: 0 }}>{produto.nome}</p>
              <button type="button" className="ghost" onClick={() => setProduto(null)}>trocar</button>
            </div>
            <div>
              <label className="muted">Peso líquido ({produto.unidade_medida})</label>
              <input
                type="number" min="0" step="0.001" inputMode="decimal" autoFocus
                value={quantidade} onChange={(e) => setQuantidade(e.target.value)}
                name="producao-saida" autoComplete="off"
              />
              {avisoBruto && (
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 11.5, color: avisoBruto.estourou ? 'var(--warning)' : 'var(--text-secondary)' }}>
                  Equivale a ~{fmt(avisoBruto.valor)} {r.unidade} de {nomeEntrada} bruto
                  {avisoBruto.estourou && ` — essa produção só teve ${fmt(r.entrada)} ${r.unidade} de entrada, confere o peso`}
                </p>
              )}
            </div>
            <button className="primary" onClick={adicionar} disabled={salvando || !(qtd > 0)} style={{ width: '100%' }}>
              {salvando ? 'Salvando…' : 'Adicionar'}
            </button>
          </>
        )}
      </div>

      {saidas.length > 0 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p className="muted" style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Já pesado</p>
          {saidas.map((s) => {
            const fc = mapaFatores && r ? calcularFCTeorico(mapaFatores, s.codigo_everest, Number(s.quantidade), r.entrada) : null
            const esperado = esperados[s.codigo_everest]
            const bate = fc != null && esperado != null && Math.abs(fc - esperado) < 0.03
            return (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 14 }}>{s.produtos?.nome || s.codigo_everest}</span>
                  {fc != null && (
                    <p className="muted" style={{ margin: '1px 0 0', fontSize: 11 }}>
                      F.C. teórico <span style={{ color: bate ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>{fmtFC(fc)}</span>
                      {esperado != null && ` (esperado: ${fmtFC(esperado)})`}
                    </p>
                  )}
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(s.quantidade)} {s.unidade}</span>
                  <button className="ghost" onClick={() => onContinuar(s)} title="Continuar e porcionar agora" style={{ padding: '6px 9px', fontSize: 12 }}>→</button>
                  <button
                    onClick={async () => { await removerItemProducao(s.id); await onMudou() }}
                    style={{ padding: '6px 9px', color: 'var(--danger)' }}
                    aria-label="Apagar"
                  >×</button>
                </span>
              </div>
            )
          })}

          {/* O número que dá sentido a tudo isso. Não é validação: se saiu menos do que entrou, a
              diferença É o rendimento do processo — o dado que o fator da ficha só supõe. */}
          {r && (
            <div style={{ borderTop: '1px dashed var(--border)', marginTop: 6, paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
                <span>F.C. do processo</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {(r.aproveitamento * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                </span>
              </div>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 11.5 }}>
                {fmt(r.saida)} de {fmt(r.entrada)} {r.unidade} · perda de {fmt(r.perda)} {r.unidade} no processo
              </p>
            </div>
          )}
        </div>
      )}

      {!confirmando ? (
        <button
          className="primary"
          onClick={() => setConfirmando(true)}
          disabled={salvando || saidas.length === 0}
          style={{ width: '100%', padding: 14 }}
        >
          Finalizar produção
        </button>
      ) : (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Confere antes de fechar — isso grava no saldo da frente</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {saidas.map((s) => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                <span style={{ minWidth: 0 }}>{s.produtos?.nome || s.codigo_everest}</span>
                <span style={{ fontWeight: 600, flexShrink: 0 }}>{fmt(s.quantidade)} {s.unidade}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => setConfirmando(false)} disabled={salvando} style={{ flex: 1 }}>Revisar</button>
            <button className="primary" onClick={finalizarComMovimento} disabled={salvando} style={{ flex: 1 }}>
              {salvando ? 'Finalizando…' : 'Confirmar e finalizar'}
            </button>
          </div>
        </div>
      )}

      {!confirmandoCancelar ? (
        <button className="ghost" onClick={() => setConfirmandoCancelar(true)} style={{ color: 'var(--danger)' }}>
          Cancelar essa produção
        </button>
      ) : (
        <div className="card">
          <p style={{ margin: '0 0 10px', fontSize: 13 }}>Cancelar? Ela sai do painel e não entra nos indicadores, mas fica registrada.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmandoCancelar(false)} style={{ flex: 1 }}>Voltar</button>
            <button
              onClick={async () => { await cancelarProducao(producao.id, usuario); onPronto() }}
              style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}
            >Confirmar</button>
          </div>
        </div>
      )}
    </div>
  )
}
