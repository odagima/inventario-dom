import { useCallback, useEffect, useState } from 'react'
import BuscaProdutoPerda from '../components/BuscaProdutoPerda'
import { CATEGORIAS_PERDA, LABEL_TURNO } from '../lib/perdas'
import {
  listarProducoesEmAndamento,
  abrirProducao,
  adicionarItemProducao,
  removerItemProducao,
  finalizarProducao,
  cancelarProducao,
  rendimentoDoEvento
} from '../lib/producaoApi'

// Tela única: painel do que está em andamento + abertura + fechamento.
//
// A produção é da COZINHA, não de quem abriu — a lista mostra tudo que está aberto, e qualquer
// pessoa fecha. Resolve troca de turno e preparo de vários dias sem caso especial.
//
// Fluxo: "peguei 10 kg de filet peça" (abre) → some do caminho de quem lançou, fica no painel →
// depois, alguém abre e registra o que saiu (tournedot, escalope, aparas) → finaliza.

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

function diasAtras(iso) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'hoje'
  if (d === 1) return 'ontem'
  return `há ${d} dias`
}

export default function TelaProducao({ usuarioLogado, onSair }) {
  const [emAndamento, setEmAndamento] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [tela, setTela] = useState('painel') // 'painel' | 'abrir' | 'fechar'
  const [aberta, setAberta] = useState(null) // produção sendo fechada

  const carregar = useCallback(async (silencioso = false) => {
    try {
      const lista = await listarProducoesEmAndamento()
      setEmAndamento(lista)
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

  return (
    <div className="screen">
      <div className="topbar">
        <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <span className="unidade">Produção</span>
            <p className="muted" style={{ margin: '2px 0 0' }}>
              {tela === 'painel' ? 'o que está sendo produzido' : tela === 'abrir' ? 'nova produção' : 'registrar o que saiu'}
            </p>
          </div>
          {tela === 'painel'
            ? <button className="ghost" onClick={onSair} style={{ flexShrink: 0 }}>Voltar</button>
            : <button className="ghost" onClick={() => { setTela('painel'); setAberta(null) }} style={{ flexShrink: 0 }}>Voltar</button>}
        </div>
      </div>

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

      {tela === 'painel' && (
        <>
          <button
            className="primary"
            onClick={() => setTela('abrir')}
            style={{ width: '100%', padding: 16, fontSize: 16, marginBottom: 18 }}
          >
            Iniciar produção
          </button>

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
                      {p.usuario_inicio || '—'} · {diasAtras(p.iniciada_em)}
                      {saidas.length > 0 && ` · ${saidas.length} ${saidas.length === 1 ? 'item já pesado' : 'itens já pesados'}`}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {tela === 'abrir' && (
        <FormAbrir
          usuario={usuarioLogado?.nome}
          onPronto={async () => { await carregar(); setTela('painel') }}
          onErro={setErro}
        />
      )}

      {tela === 'fechar' && aberta && (
        <FormFechar
          producao={aberta}
          usuario={usuarioLogado?.nome}
          onMudou={carregar}
          onPronto={async () => { await carregar(); setTela('painel'); setAberta(null) }}
          onErro={setErro}
        />
      )}
    </div>
  )
}

// ── Abrir: só a entrada ("o que eu peguei") ──────────────────────────────────
function FormAbrir({ usuario, onPronto, onErro }) {
  const [data, setData] = useState(hojeIso())
  const [turno, setTurno] = useState(turnoDeAgora())
  const [categoria, setCategoria] = useState(CATEGORIAS[0])
  const [produto, setProduto] = useState(null)
  const [quantidade, setQuantidade] = useState('')
  const [salvando, setSalvando] = useState(false)

  const qtd = Number(String(quantidade).replace(',', '.'))

  async function salvar() {
    setSalvando(true)
    try {
      await abrirProducao({
        data,
        turno,
        usuario,
        entrada: {
          codigoEverest: produto.codigo_everest,
          produtoId: produto.id,
          quantidade: qtd,
          unidade: produto.unidade_medida
        }
      })
      onPronto()
    } catch (e) {
      onErro('Não consegui abrir — ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
            <label className="muted">Quanto pegou ({produto.unidade_medida})</label>
            <input
              type="number" min="0" step="0.001" inputMode="decimal" autoFocus
              value={quantidade} onChange={(e) => setQuantidade(e.target.value)}
              name="producao-entrada" autoComplete="off"
            />
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Você registra o que saiu depois, quando terminar. A produção fica no painel até lá — qualquer pessoa da cozinha pode fechar.
          </p>
          <button className="primary" onClick={salvar} disabled={salvando || !(qtd > 0)} style={{ width: '100%' }}>
            {salvando ? 'Abrindo…' : 'Iniciar produção'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Fechar: as saídas ("o que saiu") ─────────────────────────────────────────
function FormFechar({ producao, usuario, onMudou, onPronto, onErro }) {
  const [categoria, setCategoria] = useState(CATEGORIAS[1]) // saída costuma ser pré-preparo
  const [produto, setProduto] = useState(null)
  const [quantidade, setQuantidade] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false)

  const itens = producao.producoes_itens || []
  const entradas = itens.filter((i) => i.papel === 'entrada')
  const saidas = itens.filter((i) => i.papel === 'saida')
  const r = rendimentoDoEvento(producao)
  const qtd = Number(String(quantidade).replace(',', '.'))

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
          aberta por {producao.usuario_inicio || '—'} · {diasAtras(producao.iniciada_em)}
        </p>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>O que saiu?</p>
        {!produto ? (
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
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <p style={{ margin: 0, fontWeight: 500, minWidth: 0 }}>{produto.nome}</p>
              <button type="button" className="ghost" onClick={() => setProduto(null)}>trocar</button>
            </div>
            <div>
              <label className="muted">Quanto saiu ({produto.unidade_medida})</label>
              <input
                type="number" min="0" step="0.001" inputMode="decimal" autoFocus
                value={quantidade} onChange={(e) => setQuantidade(e.target.value)}
                name="producao-saida" autoComplete="off"
              />
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
          {saidas.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, minWidth: 0 }}>{s.produtos?.nome || s.codigo_everest}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(s.quantidade)} {s.unidade}</span>
                <button
                  onClick={async () => { await removerItemProducao(s.id); await onMudou() }}
                  style={{ padding: '6px 9px', color: 'var(--danger)' }}
                  aria-label="Apagar"
                >×</button>
              </span>
            </div>
          ))}

          {/* O número que dá sentido a tudo isso. Não é validação: se saiu menos do que entrou, a
              diferença É o rendimento do processo — o dado que o fator da ficha só supõe. */}
          {r && (
            <div style={{ borderTop: '1px dashed var(--border)', marginTop: 6, paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
                <span>Rendimento</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {(r.aproveitamento * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                </span>
              </div>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 11.5 }}>
                {fmt(r.saida)} de {fmt(r.entrada)} {r.unidade} · sobraram {fmt(r.perda)} {r.unidade} no processo
              </p>
            </div>
          )}
        </div>
      )}

      <button
        className="primary"
        onClick={async () => {
          setSalvando(true)
          try { await finalizarProducao(producao.id, usuario); onPronto() }
          catch (e) { onErro(e.message) }
          finally { setSalvando(false) }
        }}
        disabled={salvando || saidas.length === 0}
        style={{ width: '100%', padding: 14 }}
      >
        Finalizar produção
      </button>

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
