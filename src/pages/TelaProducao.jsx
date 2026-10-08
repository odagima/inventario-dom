import { useCallback, useEffect, useState } from 'react'
import BuscaProdutoPerda from '../components/BuscaProdutoPerda'
import Topbar from '../components/Topbar'
import Modal from '../components/Modal'
import Icon from '../components/Icon'
import TrocarLocalModal from '../components/TrocarLocalModal'
import ContextoLancamento from '../components/ContextoLancamento'
import { CATEGORIAS_PERDA } from '../lib/perdas'
import { listarLocaisEstoque } from '../lib/locaisEstoqueApi'
import { buscarFatoresCorrecao, calcularFCTeorico, filhosDiretos, brutoEquivalente } from '../lib/fatoresCorrecaoApi'
import { registrarMovimento } from '../lib/estoqueMovimentosApi'
import { turnoUtilizavel } from '../lib/turnosApi'
import { buscarProdutosPorCodigosEverest } from '../lib/api'
import {
  listarProducoesEmAndamento,
  listarProducoesPlanejadas,
  criarProducaoPlanejada,
  iniciarProducaoPlanejada,
  abrirProducao,
  adicionarItemProducao,
  removerItemProducao,
  editarQuantidadeItemProducao,
  finalizarProducao,
  cancelarProducao,
  buscarCadeiaProducao,
  rendimentoDoEvento,
  mediaFCTeoricoHistorico
} from '../lib/producaoApi'

// Tela única: painel do que está em andamento + "a fazer" + abertura + a cadeia inteira de
// produção (entrada → derivados → subprodutos) numa página só (§ pedido do Felipe, 02/10/2026).
//
// A produção é da COZINHA, não de quem abriu — a lista mostra tudo que está aberto, e qualquer
// pessoa fecha. Resolve troca de turno e preparo de vários dias sem caso especial.
//
// Fluxo: "peguei 10 kg de filet peça" (abre, escolhe o local de estoque) → some do caminho de quem lançou,
// fica no painel → quem reabre vê a cadeia inteira numa tela só: o insumo base no topo, e cada
// etapa (o que saiu, e o que saiu DO que saiu) logo abaixo — sem precisar navegar de tela em tela
// pra continuar porcionando. Cada etapa continua sendo seu próprio registro de produção por baixo
// (`producao_origem_id` encadeia uma na outra, ver migration_v15.sql) — só a TELA que parou de
// forçar navegação a cada passo.

const CAT_INSUMO = CATEGORIAS_PERDA.find((c) => c.valor === 'materia_prima')
const CAT_PP = CATEGORIAS_PERDA.find((c) => c.valor === 'pre_preparo')
// Na entrada cabe tanto matéria-prima (peça crua) quanto PP (limpeza virando porcionados); na
// saída, quase sempre PP. Deixo as duas opções nos dois lados: a cadeia real tem os dois casos.
const CATEGORIAS = [CAT_INSUMO, CAT_PP]

function hojeIso() { return new Date().toISOString().slice(0, 10) }

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
  // 08/10/2026 (pedido do Felipe, simulação de fluxo): "abrir"/"planejar" tinham virado popup
  // dentro do popup (TelaProducao já é um popup da Home) — duas camadas de blur empilhadas, e
  // fechar exigia dois toques. Voltou a ser troca de conteúdo DENTRO do mesmo popup, como "processo"
  // já era — só um popup por vez, "voltar" sempre leva pro painel.
  const [tela, setTela] = useState('painel') // 'painel' | 'abrir' | 'planejar' | 'processo'
  const [processoRaizId, setProcessoRaizId] = useState(null)
  const [prefill, setPrefill] = useState(null) // { localEstoqueId, planejadaId, metaCodigoEverest, metaQuantidade } — só pra "Iniciar" numa planejada

  const carregar = useCallback(async (silencioso = false) => {
    try {
      const [lista, planoLista] = await Promise.all([listarProducoesEmAndamento(), listarProducoesPlanejadas()])
      setEmAndamento(lista)
      setPlanejadas(planoLista)
      setErro('')
    } catch (e) {
      if (!silencioso) setErro('Não consegui carregar — confere sua internet. ' + e.message)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function abrirProcesso(p) {
    setProcessoRaizId(p.id)
    setTela('processo')
  }

  function iniciarPlanejada(p) {
    setPrefill({ localEstoqueId: p.local_estoque_id, planejadaId: p.id, metaCodigoEverest: p.meta_codigo_everest, metaQuantidade: p.meta_quantidade })
    setTela('abrir')
  }

  async function cancelarPlanejada(p) {
    try {
      await cancelarProducao(p.id, usuarioLogado?.nome)
      await carregar()
    } catch (e) {
      setErro('Não consegui cancelar — ' + e.message)
    }
  }

  return (
    <div className="screen">
      <Topbar
        titulo="Produção"
        subtitulo={
          tela === 'painel' ? 'o que está sendo produzido'
            : tela === 'abrir' ? 'nova produção'
            : tela === 'planejar' ? 'planejar o que falta produzir'
            : 'acompanhar a produção'
        }
        onVoltar={tela === 'painel' ? onSair : () => { setTela('painel'); setProcessoRaizId(null); setPrefill(null); carregar() }}
      />

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
                        {p.locais_estoque?.nome || 'sem local'} · {p.observacao || 'planejado'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button className="ghost" onClick={() => cancelarPlanejada(p)} aria-label="Cancelar planejamento" style={{ padding: '10px 12px', color: 'var(--danger)' }}><Icon nome="x" tamanho={16} /></button>
                      <button className="primary" onClick={() => iniciarPlanejada(p)}>Iniciar</button>
                    </div>
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
                    onClick={() => abrirProcesso(p)}
                    className="card"
                    style={{ padding: '12px 14px', textAlign: 'left', width: '100%' }}
                  >
                    {entradas.map((e) => (
                      <p key={e.id} style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
                        {fmt(e.quantidade)} {e.unidade} · {e.produtos?.nome || e.codigo_everest}
                      </p>
                    ))}
                    <p className="muted" style={{ margin: '2px 0 0', fontSize: 11.5 }}>
                      {p.locais_estoque?.nome ? `${p.locais_estoque.nome} · ` : ''}{p.usuario_inicio || '—'} · {diasAtras(p.iniciada_em)}
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
        />
      )}

      {tela === 'abrir' && (
        <FormAbrir
          usuario={usuarioLogado?.nome}
          localPadraoId={usuarioLogado?.localPadraoId}
          prefill={prefill}
          onPronto={async () => { await carregar(); setTela('painel'); setPrefill(null) }}
        />
      )}

      {tela === 'processo' && processoRaizId && (
        <FormProcesso
          raizId={processoRaizId}
          usuario={usuarioLogado?.nome}
          onErro={setErro}
        />
      )}
    </div>
  )
}

// ── Planejar: só registra "o que falta produzir" (meta), sem pesar nada ainda ─────────────────
function FormPlanejar({ usuario, onPronto }) {
  const [locais, setLocais] = useState([])
  const [localEstoqueId, setLocalEstoqueId] = useState('')
  const [categoria, setCategoria] = useState(CATEGORIAS[1])
  const [produto, setProduto] = useState(null)
  const [quantidade, setQuantidade] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => { listarLocaisEstoque().then(setLocais).catch((e) => setErro(e.message)) }, [])

  async function salvar() {
    setSalvando(true)
    try {
      await criarProducaoPlanejada({
        data: hojeIso(), localEstoqueId, metaCodigoEverest: produto.codigo_everest,
        metaQuantidade: quantidade ? Number(String(quantidade).replace(',', '.')) : null,
        observacao, usuario
      })
      onPronto()
    } catch (e) {
      setErro('Não consegui planejar — ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Planejar produção</p>
      <div>
        <label className="muted">Local de estoque</label>
        <select value={localEstoqueId} onChange={(e) => setLocalEstoqueId(e.target.value)}>
          <option value="">Selecione…</option>
          {locais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
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
          <button className="primary" onClick={salvar} disabled={salvando || !localEstoqueId} style={{ width: '100%' }}>
            {salvando ? 'Salvando…' : 'Adicionar ao "a fazer"'}
          </button>
        </>
      )}
      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}
    </div>
  )
}

// ── Abrir: a entrada ("o que eu peguei") + o local de estoque ────────────────────────────────
function FormAbrir({ usuario, localPadraoId, prefill, onPronto }) {
  const [data, setData] = useState(hojeIso())
  const [locais, setLocais] = useState([])
  // Pedido do Felipe (08/10/2026, "puxa tudo automático... pra tudo e todos" + "não está tudo com
  // a mesma cara"): quem tem Setor padrão vinculado já entra com o local certo — trocar usa o
  // mesmo popup com confirmação de Perdas (ver TrocarLocalModal), só sem o campo Loja (Produção
  // não guarda isso).
  const [localEstoqueId, setLocalEstoqueId] = useState(prefill?.localEstoqueId || localPadraoId || '')
  const [trocandoSetor, setTrocandoSetor] = useState(false)
  const [categoria, setCategoria] = useState(CATEGORIAS[0])
  const [produto, setProduto] = useState(null)
  const [quantidade, setQuantidade] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => { listarLocaisEstoque().then(setLocais).catch((e) => setErro(e.message)) }, [])

  const qtd = Number(String(quantidade).replace(',', '.'))

  async function salvar() {
    setSalvando(true)
    try {
      const localEfetivo = prefill?.localEstoqueId || localEstoqueId
      const turno = await turnoUtilizavel(localEfetivo)
      if (!turno) throw new Error('Essa praça não está aberta — abra em "Abrir/Fechar praça" antes de lançar.')
      const entrada = {
        codigoEverest: produto.codigo_everest,
        produtoId: produto.id,
        quantidade: qtd,
        unidade: produto.unidade_medida
      }
      if (prefill?.planejadaId) {
        await iniciarProducaoPlanejada(prefill.planejadaId, entrada, usuario)
      } else {
        await abrirProducao({ data, usuario, entrada, localEstoqueId })
      }
      onPronto()
    } catch (e) {
      setErro('Não consegui abrir — ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  const localAtual = locais.find((l) => l.id === localEstoqueId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{prefill?.planejadaId ? 'Iniciar planejada' : 'Nova produção'}</p>

      {!prefill?.planejadaId && (
        <ContextoLancamento
          mostrarLoja={false}
          local={localAtual}
          usuario={usuario}
          onTrocar={() => setTrocandoSetor(true)}
          extra={`data ${data.split('-').reverse().join('/')}`}
        />
      )}

      {prefill?.planejadaId && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Planejado: {prefill.metaQuantidade ? `${fmt(prefill.metaQuantidade)} ` : ''}{prefill.metaCodigoEverest}. Confirme o produto e pese o bruto de verdade.
        </p>
      )}
      <div>
        <label className="muted">Data</label>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </div>

      {trocandoSetor && (
        <TrocarLocalModal
          mostrarLoja={false}
          localAtualId={localEstoqueId}
          onFechar={() => setTrocandoSetor(false)}
          onConfirmar={(_, localNovo) => { setLocalEstoqueId(localNovo?.id || ''); setTrocandoSetor(false) }}
        />
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
            Só esse peso aqui é bruto — os itens que saírem depois só pedem o líquido de cada um.
          </p>
          <button className="primary" onClick={salvar} disabled={salvando || !(qtd > 0) || (!prefill?.planejadaId && !localEstoqueId)} style={{ width: '100%' }}>
            {salvando ? 'Abrindo…' : 'Iniciar produção'}
          </button>
        </>
      )}
      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}
    </div>
  )
}

// ── Processo: a cadeia inteira numa tela só — o insumo base no topo, e cada etapa (o que saiu, e
// o que saiu do que saiu) logo abaixo. Cada etapa continua sendo seu próprio registro de produção
// por baixo; esta tela só junta tudo visualmente, sem forçar navegação a cada passo.
function FormProcesso({ raizId, usuario, onErro }) {
  const [cadeia, setCadeia] = useState([])
  const [mapaFatores, setMapaFatores] = useState(null)
  const [carregando, setCarregando] = useState(true)

  const recarregar = useCallback(async () => {
    try {
      setCadeia(await buscarCadeiaProducao(raizId))
    } catch (e) {
      onErro('Não consegui carregar — ' + e.message)
    } finally {
      setCarregando(false)
    }
  }, [raizId, onErro])

  useEffect(() => { recarregar() }, [recarregar])
  useEffect(() => { buscarFatoresCorrecao().then(setMapaFatores).catch((e) => onErro(e.message)) }, [onErro])

  async function criarSubEtapa(etapaOrigem, item) {
    try {
      const turno = await turnoUtilizavel(etapaOrigem.local_estoque_id)
      if (!turno) throw new Error('Essa praça não está aberta — abra em "Abrir/Fechar praça" antes de continuar.')
      await abrirProducao({
        data: hojeIso(), usuario,
        localEstoqueId: etapaOrigem.local_estoque_id,
        producaoOrigemId: etapaOrigem.id,
        entrada: { codigoEverest: item.codigo_everest, produtoId: item.produto_id, quantidade: Number(item.quantidade), unidade: item.unidade }
      })
      await recarregar()
    } catch (e) {
      onErro('Não consegui continuar — ' + e.message)
    }
  }

  if (carregando) return <p className="muted">Carregando…</p>

  const raiz = cadeia.find((p) => !p.producao_origem_id)
  if (!raiz) return <p className="muted">Não encontrei essa produção.</p>
  const demaisEtapas = cadeia
    .filter((p) => p.producao_origem_id)
    .sort((a, b) => new Date(a.iniciada_em) - new Date(b.iniciada_em))
  const nomeRaiz = raiz.producoes_itens?.find((i) => i.papel === 'entrada')?.produtos?.nome
    || raiz.producoes_itens?.find((i) => i.papel === 'entrada')?.codigo_everest
    || '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <p className="muted" style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Produzindo</p>
        <p style={{ margin: '2px 0 0', fontWeight: 700, fontSize: 16 }}>{nomeRaiz}</p>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 11.5 }}>
          {raiz.locais_estoque?.nome ? `${raiz.locais_estoque.nome} · ` : ''}aberta por {raiz.usuario_inicio || '—'} · {diasAtras(raiz.iniciada_em)}
        </p>
      </div>

      <Etapa producao={raiz} usuario={usuario} mapaFatores={mapaFatores} onMudou={recarregar} onNovaEtapa={(item) => criarSubEtapa(raiz, item)} onErro={onErro} />

      {demaisEtapas.map((p) => (
        <Etapa key={p.id} producao={p} usuario={usuario} mapaFatores={mapaFatores} onMudou={recarregar} onNovaEtapa={(item) => criarSubEtapa(p, item)} onErro={onErro} />
      ))}
    </div>
  )
}

// ── Etapa: um registro de produção dentro da cadeia — o que entrou nela, o que saiu, e o botão
// pra continuar processando qualquer um dos itens que saíram.
function Etapa({ producao, usuario, mapaFatores, onMudou, onNovaEtapa, onErro }) {
  const [categoria, setCategoria] = useState(CATEGORIAS[1]) // saída costuma ser pré-preparo
  const [produto, setProduto] = useState(null)
  const [quantidade, setQuantidade] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [confirmandoFinalizar, setConfirmandoFinalizar] = useState(false)
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false)
  const [esperados, setEsperados] = useState({}) // codigo_everest -> F.C. teórico esperado
  const [produtosFamilia, setProdutosFamilia] = useState([]) // só o PRÓXIMO passo (filhos diretos da entrada)
  const [modoFiltro, setModoFiltro] = useState(true) // true = só a família; false = "catálogo inteiro"
  const [editandoId, setEditandoId] = useState(null)
  const [valorEdicao, setValorEdicao] = useState('')

  const itens = producao.producoes_itens || []
  const entradas = itens.filter((i) => i.papel === 'entrada')
  const saidas = itens.filter((i) => i.papel === 'saida')
  const r = rendimentoDoEvento(producao)
  const qtd = Number(String(quantidade).replace(',', '.'))
  const codigoEntrada = entradas[0]?.codigo_everest
  const nomeEntrada = entradas[0]?.produtos?.nome || codigoEntrada || 'insumo'
  const finalizada = producao.status !== 'em_andamento'

  // Filtro inteligente (§ pedido do Felipe, 02/10/2026): só o PRÓXIMO passo do processo, nunca a
  // família inteira — "insumo base vira cabeça-e-rabo e limpeza; DESSES vira os outros". Se a
  // entrada ainda não tem nenhum filho cadastrado em fatores_correcao (nem que seja só a ordem,
  // sem fator — ver migration_v17.sql), a lista fica vazia e cai no fluxo de busca de sempre.
  useEffect(() => {
    if (finalizada || !mapaFatores || !codigoEntrada) return
    const filhos = filhosDiretos(mapaFatores, codigoEntrada)
    if (!filhos.length) { setProdutosFamilia([]); return }
    buscarProdutosPorCodigosEverest(filhos).then(setProdutosFamilia).catch(() => setProdutosFamilia([]))
  }, [finalizada, mapaFatores, codigoEntrada])

  // Esperado de cada item que já saiu — busca uma vez por código, não a cada render.
  useEffect(() => {
    if (!mapaFatores || !saidas.length) return
    const codigos = [...new Set(saidas.map((s) => s.codigo_everest))].filter((c) => esperados[c] === undefined)
    if (!codigos.length) return
    Promise.all(codigos.map((c) => mediaFCTeoricoHistorico(c, mapaFatores).then((v) => [c, v])))
      .then((pares) => setEsperados((prev) => ({ ...prev, ...Object.fromEntries(pares) })))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapaFatores, saidas.length])

  // Sanity-check na hora de digitar: se o peso implicaria mais bruto do que essa etapa recebeu de
  // entrada, é quase sempre dedo errado (zero a mais, vírgula no lugar errado).
  const brutoImplicito = (mapaFatores && produto && qtd > 0) ? brutoEquivalente(mapaFatores, produto.codigo_everest, qtd) : null
  const avisoBruto = brutoImplicito != null && r ? { valor: brutoImplicito, estourou: brutoImplicito > r.entrada * 1.15 } : null

  async function adicionar() {
    setSalvando(true)
    try {
      await adicionarItemProducao({
        producaoId: producao.id, papel: 'saida',
        codigoEverest: produto.codigo_everest, produtoId: produto.id,
        quantidade: qtd, unidade: produto.unidade_medida, usuario
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

  async function salvarEdicao(item) {
    const novo = Number(String(valorEdicao).replace(',', '.'))
    if (!(novo > 0)) return
    setSalvando(true)
    try {
      await editarQuantidadeItemProducao(item.id, novo)
      setEditandoId(null)
      await onMudou()
    } catch (e) {
      onErro('Não consegui editar — ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function finalizarComMovimento() {
    setSalvando(true)
    try {
      await finalizarProducao(producao.id, usuario)
      // Saldo calculado do local de estoque: credita cada saída, debita cada entrada. Produção
      // sem local (lançamentos antigos, ou alguém sem local escolhido) não mexe em saldo nenhum.
      if (producao.local_estoque_id) {
        for (const e of entradas) {
          await registrarMovimento({ localEstoqueId: producao.local_estoque_id, codigoEverest: e.codigo_everest, quantidade: -Number(e.quantidade), tipo: 'producao_entrada', producaoId: producao.id, usuario })
        }
        for (const s of saidas) {
          await registrarMovimento({ localEstoqueId: producao.local_estoque_id, codigoEverest: s.codigo_everest, quantidade: Number(s.quantidade), tipo: 'producao_saida', producaoId: producao.id, usuario })
        }
      }
      setConfirmandoFinalizar(false)
      await onMudou()
    } catch (e) {
      onErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {finalizada && (
        <p className="muted" style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          {producao.status === 'cancelada' ? 'Cancelada' : 'Finalizada'}
        </p>
      )}

      {entradas.map((e) => {
        const editando = editandoId === e.id
        return editando ? (
          <div key={e.id} style={{ display: 'flex', gap: 8 }}>
            <input type="number" min="0" step="0.001" inputMode="decimal" autoFocus value={valorEdicao} onChange={(ev) => setValorEdicao(ev.target.value)} style={{ flex: 1 }} />
            <button onClick={() => setEditandoId(null)} disabled={salvando}>Cancelar</button>
            <button className="primary" onClick={() => salvarEdicao(e)} disabled={salvando}>Salvar</button>
          </div>
        ) : (
          <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 15, minWidth: 0 }}>
              A partir de {fmt(e.quantidade)} {e.unidade} · {e.produtos?.nome || e.codigo_everest}
            </p>
            {!finalizada && (
              <button className="ghost" onClick={() => { setEditandoId(e.id); setValorEdicao(String(e.quantidade)) }} style={{ padding: '8px 10px', flexShrink: 0 }} aria-label="Editar peso de entrada">
                Editar
              </button>
            )}
          </div>
        )
      })}

      {!finalizada && (
        <>
          <p style={{ margin: 0, fontWeight: 600 }}>O que saiu?</p>
          {!produto ? (
            <>
              {produtosFamilia.length > 0 && (
                <div className="segmented">
                  <button type="button" onClick={() => setModoFiltro(true)} className={modoFiltro ? 'active' : ''}>
                    Só o que vem de {nomeEntrada}
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
                    {avisoBruto.estourou && ` — essa etapa só teve ${fmt(r.entrada)} ${r.unidade} de entrada, confere o peso`}
                  </p>
                )}
              </div>
              <button className="primary" onClick={adicionar} disabled={salvando || !(qtd > 0)} style={{ width: '100%' }}>
                {salvando ? 'Salvando…' : 'Adicionar'}
              </button>
            </>
          )}
        </>
      )}

      {saidas.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
          {saidas.map((s) => {
            const fc = mapaFatores && r ? calcularFCTeorico(mapaFatores, s.codigo_everest, Number(s.quantidade), r.entrada) : null
            const esperado = esperados[s.codigo_everest]
            const bate = fc != null && esperado != null && Math.abs(fc - esperado) < 0.03
            const editando = editandoId === s.id
            return (
              <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 14 }}>{s.produtos?.nome || s.codigo_everest}</span>
                    {fc != null && (
                      <p className="muted" style={{ margin: '1px 0 0', fontSize: 11 }}>
                        F.C. teórico <span style={{ color: bate ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>{fmtFC(fc)}</span>
                        {esperado != null && ` (esperado: ${fmtFC(esperado)})`}
                      </p>
                    )}
                  </div>
                  {!editando && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(s.quantidade)} {s.unidade}</span>
                      {!finalizada && (
                        <>
                          <button className="ghost" onClick={() => { setEditandoId(s.id); setValorEdicao(String(s.quantidade)) }} style={{ padding: '8px 10px' }}>
                            Editar
                          </button>
                          <button
                            onClick={async () => { await removerItemProducao(s.id); await onMudou() }}
                            style={{ padding: '8px 10px', color: 'var(--danger)' }}
                            aria-label="Apagar"
                          ><Icon nome="x" tamanho={16} /></button>
                        </>
                      )}
                    </span>
                  )}
                </div>
                {editando && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="number" min="0" step="0.001" inputMode="decimal" autoFocus value={valorEdicao} onChange={(e) => setValorEdicao(e.target.value)} style={{ flex: 1 }} />
                    <button onClick={() => setEditandoId(null)} disabled={salvando}>Cancelar</button>
                    <button className="primary" onClick={() => salvarEdicao(s)} disabled={salvando}>Salvar</button>
                  </div>
                )}
                {!finalizada && !editando && (
                  <button className="ghost" onClick={() => onNovaEtapa(s)} style={{ alignSelf: 'flex-start', fontSize: 13.5, padding: '10px 14px', fontWeight: 500 }}>
                    + Fazer subproduto a partir deste item
                  </button>
                )}
              </div>
            )
          })}

          {r && (
            <div>
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

      {!finalizada && (
        <>
          <button
            className="primary"
            onClick={() => setConfirmandoFinalizar(true)}
            disabled={salvando || saidas.length === 0}
            style={{ width: '100%', padding: 14 }}
          >
            Finalizar essa etapa
          </button>

          <button className="ghost" onClick={() => setConfirmandoCancelar(true)} style={{ color: 'var(--danger)' }}>
            Cancelar essa etapa
          </button>
        </>
      )}

      {confirmandoCancelar && (
        <Modal onFechar={() => setConfirmandoCancelar(false)}>
          <p style={{ margin: '0 0 10px', fontSize: 13 }}>Cancelar essa etapa? Ela sai do painel e não entra nos indicadores, mas fica registrada.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmandoCancelar(false)} style={{ flex: 1 }}>Voltar</button>
            <button
              onClick={async () => { await cancelarProducao(producao.id, usuario); setConfirmandoCancelar(false); await onMudou() }}
              style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}
            >Confirmar</button>
          </div>
        </Modal>
      )}

      {confirmandoFinalizar && (
        <Modal onFechar={() => !salvando && setConfirmandoFinalizar(false)} largura={360}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>Confere antes de fechar — isso grava no saldo do local de estoque</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {saidas.map((s) => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                  <span style={{ minWidth: 0 }}>{s.produtos?.nome || s.codigo_everest}</span>
                  <span style={{ fontWeight: 600, flexShrink: 0 }}>{fmt(s.quantidade)} {s.unidade}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => setConfirmandoFinalizar(false)} disabled={salvando} style={{ flex: 1 }}>Revisar</button>
              <button className="primary" onClick={finalizarComMovimento} disabled={salvando} style={{ flex: 1 }}>
                {salvando ? 'Finalizando…' : 'Confirmar e finalizar'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
