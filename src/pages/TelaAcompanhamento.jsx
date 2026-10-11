import { useEffect, useState } from 'react'
import Topbar from '../components/Topbar'
import BuscaProdutoPerda from '../components/BuscaProdutoPerda'
import { listarLocaisEstoque } from '../lib/locaisEstoqueApi'
import { listarSaldosCalculados, listarMovimentosRecentes, buscarEstoqueVirtualComDerivados, buscarSaldoVirtualGeral, saldoFiltrado } from '../lib/estoqueMovimentosApi'
import { listarTurnosHistorico, turnoVencido, buscarTurnoAberto } from '../lib/turnosApi'
import { buscarProducaoSemana } from '../lib/producaoApi'
import { listarRequisicoesPendentes, listarTransferenciasPendentes } from '../lib/requisicaoTransferenciaApi'
import { buscarProdutosPorCodigosEverest, listarUnidades } from '../lib/api'
import { formatarNumero } from '../admin/lib/formato'

const SEM_LOJA = '__sem_loja__'

// Painel de acompanhamento (07/10/2026, pedido do Felipe: "um painel completo pra
// acompanhamento... tira do abrir e fechar, cria um painel legal com informações" — veio depois
// de tentar colocar isso dentro de Admin → Locais de estoque, que ele rejeitou porque "isso é pra
// a operação verificar", não um relatório gerencial). Botão próprio na Home, tela só de leitura —
// nenhuma ação acontece aqui, é só pra enxergar o que está rolando agora em todas as praças.

const INTERVALO_ATUALIZACAO_MS = 20000

const LABEL_TIPO = {
  producao_entrada: 'Entrada (produção)',
  producao_saida: 'Saída (produção)',
  transferencia_saida: 'Transferência enviada',
  transferencia_entrada: 'Transferência recebida',
  requisicao_saida: 'Requisição atendida',
  requisicao_entrada: 'Requisição recebida',
  ajuste_contagem: 'Ajuste de contagem',
  recebimento: 'Recebimento de mercadoria'
}

function faz(iso) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)} dias`
}

export default function TelaAcompanhamento({ usuarioLogado, onSair }) {
  const [locais, setLocais] = useState([])
  const [unidades, setUnidades] = useState([])
  const [saldosPorLocal, setSaldosPorLocal] = useState({})
  const [pendentesReq, setPendentesReq] = useState([])
  const [pendentesTransf, setPendentesTransf] = useState([])
  const [recentes, setRecentes] = useState([])
  const [nomePorCodigo, setNomePorCodigo] = useState({})
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [atualizadoEm, setAtualizadoEm] = useState(null)

  useEffect(() => {
    let cancelado = false

    async function carregar() {
      try {
        const [ls, us] = await Promise.all([listarLocaisEstoque(), listarUnidades()])
        if (cancelado) return
        setLocais(ls)
        setUnidades(us)

        const [saldosBrutos, pr, pt, mov] = await Promise.all([
          Promise.all(ls.map((l) => listarSaldosCalculados(l.id).then((linhas) => [l.id, linhas]))),
          listarRequisicoesPendentes(),
          listarTransferenciasPendentes(),
          listarMovimentosRecentes(30)
        ])
        if (cancelado) return

        setPendentesReq(pr)
        setPendentesTransf(pt)
        setRecentes(mov)

        const mapaSaldo = {}
        saldosBrutos.forEach(([localId, linhas]) => {
          mapaSaldo[localId] = linhas.filter((l) => Math.abs(Number(l.saldo)) > 0.0001)
        })
        setSaldosPorLocal(mapaSaldo)

        const todosCodigos = [...new Set([
          ...saldosBrutos.flatMap(([, linhas]) => linhas.map((l) => l.codigo_everest)),
          ...mov.map((m) => m.codigo_everest)
        ])]
        const produtos = await buscarProdutosPorCodigosEverest(todosCodigos)
        if (cancelado) return
        setNomePorCodigo(Object.fromEntries(produtos.map((p) => [p.codigo_everest, p.nome])))

        setErro('')
        setAtualizadoEm(new Date())
      } catch (e) {
        if (!cancelado) setErro('Não consegui carregar — ' + e.message)
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }

    carregar()
    const intervalo = setInterval(carregar, INTERVALO_ATUALIZACAO_MS)
    return () => { cancelado = true; clearInterval(intervalo) }
  }, [])

  const nomePorLocal = Object.fromEntries(locais.map((l) => [l.id, l.nome]))

  if (carregando) return (
    <div className="screen">
      <Topbar titulo="Painel de Controle" subtitulo="o que está rolando agora" onVoltar={onSair} />
      <p className="muted">Carregando…</p>
    </div>
  )

  return (
    <div className="screen">
      <Topbar
        titulo="Painel de Controle"
        subtitulo={atualizadoEm ? `atualizado ${faz(atualizadoEm)}` : 'o que está rolando agora'}
        onVoltar={onSair}
      />

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

      <StatusDaOperacao usuario={usuarioLogado} locais={locais} unidades={unidades} />

      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Saldo atual por praça</p>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>Só itens com saldo diferente de zero.</p>
        {locais.map((l) => {
          const linhas = saldosPorLocal[l.id] || []
          if (!linhas.length) return null
          return (
            <div key={l.id} style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 6px', fontWeight: 500, fontSize: 13.5 }}>{l.nome}</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {linhas.map((item) => (
                    <tr key={item.codigo_everest} style={{ borderBottom: '0.5px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px 4px 0' }}>{nomePorCodigo[item.codigo_everest] || item.codigo_everest}</td>
                      <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {formatarNumero(item.saldo, 3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
        {locais.every((l) => !(saldosPorLocal[l.id] || []).length) && (
          <p className="muted">Nenhum local com saldo lançado ainda.</p>
        )}
      </div>

      <ProducaoDaSemana usuario={usuarioLogado} locais={locais} unidades={unidades} />

      <EstoqueVirtualGeral locais={locais} unidades={unidades} />

      <EstoqueVirtualPorItem locais={locais} unidades={unidades} />

      {(pendentesReq.length > 0 || pendentesTransf.length > 0) && (
        <div className="card" style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Pendências</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pendentesReq.map((r) => (
              <div key={r.id} className="list-item">
                <span>{r.solicitante?.nome} ← {r.atendente?.nome} · {nomePorCodigo[r.codigo_everest] || r.codigo_everest}</span>
                <span className="muted">{r.status}</span>
              </div>
            ))}
            {pendentesTransf.map((t) => (
              <div key={t.id} className="list-item">
                <span>{t.origem?.nome} → {t.destino?.nome} · {nomePorCodigo[t.codigo_everest] || t.codigo_everest}</span>
                <span className="muted">em trânsito</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Atividade recente</p>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>Últimas {recentes.length} movimentações, todas as praças.</p>
        {recentes.length === 0 ? (
          <p className="muted">Nada lançado ainda.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentes.map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13 }}>{nomePorCodigo[m.codigo_everest] || m.codigo_everest}</p>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>
                    {LABEL_TIPO[m.tipo] || m.tipo} · {nomePorLocal[m.local_estoque_id] || '—'} · {faz(m.registrado_em)}
                  </p>
                </div>
                <span style={{ fontWeight: 600, fontSize: 13, color: Number(m.quantidade) < 0 ? 'var(--danger)' : 'var(--success)', flexShrink: 0 }}>
                  {Number(m.quantidade) > 0 ? '+' : ''}{formatarNumero(m.quantidade, 3)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Mesma conta do Admin (Painel → "Estoque virtual por item"), só que SEM preço/valor de propósito
// — preço de compra não é informação pra operação ver, só quantidade (pedido do Felipe, 09/10/2026).
function EstoqueVirtualPorItem({ locais, unidades }) {
  const [lojaId, setLojaId] = useState('')
  const [setorId, setSetorId] = useState('')
  const [produto, setProduto] = useState(null)
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')
  const [itens, setItens] = useState(null)
  const [setoresComDado, setSetoresComDado] = useState(null)

  // Setores da Loja escolhida (ignora o Setor já selecionado — senão escolher um Setor encolhe o
  // próprio seletor pra só ele, bug reportado).
  function locaisDaLoja() {
    if (lojaId === SEM_LOJA) return locais.filter((l) => !l.unidade_id)
    if (lojaId) return locais.filter((l) => l.unidade_id === lojaId)
    return locais
  }

  function opcoesSetor() {
    const daLoja = locaisDaLoja()
    if (!setoresComDado) return daLoja
    return daLoja.filter((l) => setoresComDado.includes(l.id))
  }

  async function buscar() {
    if (!produto) return
    setBuscando(true)
    setErro('')
    try {
      const { itens: base, locaisComSaldo } = await buscarEstoqueVirtualComDerivados({
        codigoEverestRaiz: produto.codigo_everest,
        locaisAlvo: locaisDaLoja()
      })
      setSetoresComDado(locaisComSaldo)
      const setorEfetivo = locaisComSaldo.includes(setorId) ? setorId : ''
      if (setorId && !locaisComSaldo.includes(setorId)) setSetorId('')
      setItens(base.map((i) => ({ ...i, saldo: saldoFiltrado(i, setorEfetivo) })))
    } catch (e) {
      setErro('Não consegui buscar — ' + e.message)
    } finally {
      setBuscando(false)
    }
  }

  const raiz = itens?.[0]
  const derivados = itens?.slice(1) || []
  const derivadosComSaldo = derivados.filter((d) => Math.abs(d.saldo) > 0.0001)
  const derivadosZerados = derivados.filter((d) => Math.abs(d.saldo) <= 0.0001)

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Estoque virtual por item</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>Escolha um item e veja a quantidade calculada dele e dos derivados, filtrado por Loja e/ou Setor.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="muted">Loja</label>
          <select value={lojaId} onChange={(e) => { setLojaId(e.target.value); setSetorId('') }}>
            <option value="">Todas</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            <option value={SEM_LOJA}>Sem loja</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="muted">Setor</label>
          <select value={setorId} onChange={(e) => setSetorId(e.target.value)}>
            <option value="">Todos</option>
            {opcoesSetor().map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </div>
      </div>

      {!produto ? (
        <BuscaProdutoPerda onSelecionar={setProduto} />
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <p style={{ margin: 0, fontWeight: 500 }}>{produto.nome}</p>
          <button type="button" className="ghost" onClick={() => { setProduto(null); setItens(null); setSetoresComDado(null) }}>trocar</button>
        </div>
      )}

      {produto && (
        <button className="primary" onClick={buscar} disabled={buscando} style={{ marginBottom: 14 }}>
          {buscando ? 'Buscando…' : 'Ver estoque virtual'}
        </button>
      )}

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{erro}</p>}

      {raiz && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-3)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 500 }}>{raiz.nome}</p>
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>Everest {raiz.codigo_everest} · raiz da cadeia</p>
            </div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 20 }}>{formatarNumero(raiz.saldo, 3)}</p>
          </div>

          {derivados.length === 0 ? (
            <p className="muted">Esse item não tem nenhum derivado cadastrado.</p>
          ) : (
            <>
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>Derivados com saldo ({derivadosComSaldo.length})</p>
              {derivadosComSaldo.length === 0 ? (
                <p className="muted" style={{ marginBottom: 14 }}>Nenhum derivado com saldo nesse recorte.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  {derivadosComSaldo.map((d) => (
                    <div key={d.codigo_everest} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', border: '0.5px solid var(--border)', borderRadius: 8 }}>
                      <span style={{ fontSize: 13 }}>{d.nome}</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{formatarNumero(d.saldo, 3)}</span>
                    </div>
                  ))}
                </div>
              )}
              {derivadosZerados.length > 0 && (
                <details>
                  <summary className="muted" style={{ fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>Zerados ({derivadosZerados.length})</summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {derivadosZerados.map((d) => (
                      <div key={d.codigo_everest} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', border: '0.5px solid var(--border)', borderRadius: 8 }}>
                        <span style={{ fontSize: 13 }}>{d.nome}</span>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{formatarNumero(d.saldo, 3)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// Status da operação (11/10/2026, pedido do Felipe: substitui a lista "Status das praças" de
// todo mundo — aqui só pega a referência da Loja/Setor DO PRÓPRIO USUÁRIO, igual o resto do app
// já faz com `usuarioLogado.localPadraoId`). Mostra o turno aberto agora (se tiver) e o último
// fechamento registrado, sempre os dois juntos — não só um ou outro.
function StatusDaOperacao({ usuario, locais, unidades }) {
  const localId = usuario?.localPadraoId || null
  const [turno, setTurno] = useState(null)
  const [ultimoFechado, setUltimoFechado] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!localId) { setCarregando(false); return }
    let cancelado = false
    setCarregando(true)
    // `listarTurnosHistorico` não filtra status — se a praça está aberta agora, a linha mais
    // recente é a ABERTA (mesmo registro), não um fechamento de verdade. Busca algumas linhas e
    // acha a primeira já FECHADA, pra nunca confundir "abriu" com "fechou".
    Promise.all([buscarTurnoAberto(localId), listarTurnosHistorico(localId, 5)])
      .then(([t, hist]) => {
        if (cancelado) return
        setTurno(t)
        setUltimoFechado(hist.find((h) => h.status === 'fechado') || null)
        setErro('')
      })
      .catch((e) => { if (!cancelado) setErro('Não consegui carregar — ' + e.message) })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [localId])

  const local = locais.find((l) => l.id === localId)
  const loja = local && unidades.find((u) => u.id === local.unidade_id)
  const vencido = turno && turnoVencido(turno)

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Status da operação</p>
      {!localId ? (
        <p className="muted">Seu usuário não tem Setor padrão vinculado — vincule em Cadastros pra ver o status da sua praça aqui.</p>
      ) : carregando ? (
        <p className="muted">Carregando…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 500 }}>{loja ? `${loja.nome} · ` : ''}{local?.nome || usuario.localPadraoNome}</span>
            {turno ? (
              <span style={{ fontSize: 12.5, color: vencido ? 'var(--danger)' : 'var(--success)' }}>
                {vencido ? 'Vencida' : 'Aberta'} {faz(turno.aberto_em)}{turno.aberto_por ? ` · ${turno.aberto_por}` : ''}
              </span>
            ) : (
              <span className="muted" style={{ fontSize: 12.5 }}>Fechada</span>
            )}
          </div>
          {ultimoFechado && (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Último fechamento: {faz(ultimoFechado.fechado_em || ultimoFechado.aberto_em)}{ultimoFechado.fechado_por ? ` · ${ultimoFechado.fechado_por}` : ''}
            </p>
          )}
        </div>
      )}
      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{erro}</p>}
    </div>
  )
}

// Produção da semana por Setor (11/10/2026, pedido do Felipe: "pode usar o mesmo filtro do
// estoque virtual... sempre mostrar o status do usuário pegando loja e setor") — mesmo seletor de
// Loja/Setor de `EstoqueVirtualPorItem`, mas já parte pré-preenchido com a Loja/Setor do próprio
// usuário (continua trocável). Busca automática ao trocar o filtro — não tem item pra escolher
// antes, diferente do estoque virtual.
function ProducaoDaSemana({ usuario, locais, unidades }) {
  const localPadrao = locais.find((l) => l.id === usuario?.localPadraoId)
  const [lojaId, setLojaId] = useState(localPadrao?.unidade_id || '')
  const [setorId, setSetorId] = useState(usuario?.localPadraoId || '')
  const [itens, setItens] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  function locaisDaLoja() {
    if (lojaId === SEM_LOJA) return locais.filter((l) => !l.unidade_id)
    if (lojaId) return locais.filter((l) => l.unidade_id === lojaId)
    return locais
  }

  useEffect(() => {
    if (!locais.length) return
    let cancelado = false
    setCarregando(true)
    setErro('')
    const alvo = setorId ? locais.filter((l) => l.id === setorId) : locaisDaLoja()
    const hoje = new Date()
    const seteDiasAtras = new Date(hoje.getTime() - 6 * 86400000)
    const fmt = (d) => d.toISOString().slice(0, 10)
    buscarProducaoSemana({ locaisAlvo: alvo, dataInicio: fmt(seteDiasAtras), dataFim: fmt(hoje) })
      .then((linhas) => { if (!cancelado) setItens(linhas) })
      .catch((e) => { if (!cancelado) setErro('Não consegui buscar — ' + e.message) })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lojaId, setorId, locais.length])

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Produção da semana</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>Últimos 7 dias, por Setor. F.C. médio é o teórico (ver Produção), não a razão saída/entrada da etapa.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="muted">Loja</label>
          <select value={lojaId} onChange={(e) => { setLojaId(e.target.value); setSetorId('') }}>
            <option value="">Todas</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            <option value={SEM_LOJA}>Sem loja</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="muted">Setor</label>
          <select value={setorId} onChange={(e) => setSetorId(e.target.value)}>
            <option value="">Todos</option>
            {locaisDaLoja().map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </div>
      </div>

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{erro}</p>}

      {carregando ? (
        <p className="muted">Buscando…</p>
      ) : !itens || itens.length === 0 ? (
        <p className="muted">Nenhuma produção concluída nos últimos 7 dias nesse recorte.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
              {['Item', 'Qtd. semana', 'Produções', 'F.C. médio'].map((h) => (
                <th key={h} style={{ textAlign: h === 'Item' ? 'left' : 'right', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.codigo_everest} style={{ borderBottom: '0.5px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>{i.nome}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatarNumero(i.quantidade, 3)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{i.numProducoes}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: i.fcMedio == null ? 'var(--text-secondary)' : (i.fcMedio < 0.9 || i.fcMedio > 1.1) ? 'var(--danger)' : 'var(--success)' }}>
                  {i.fcMedio != null ? `${(i.fcMedio * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// Estoque virtual — visão geral (11/10/2026, alternativa em tabela única à busca por item de
// `EstoqueVirtualPorItem`, pedido do Felipe depois de ver o mockup denso: "gostei de tudo" — vê
// TODOS os itens com saldo calculado no recorte de uma vez, com saldo/zerado já separado, sem
// escolher uma raiz primeiro). As duas formas convivem — essa é rápida pra conferência geral, a
// outra é pra investigar a árvore de um item específico.
function EstoqueVirtualGeral({ locais, unidades }) {
  const [lojaId, setLojaId] = useState('')
  const [setorId, setSetorId] = useState('')
  const [busca, setBusca] = useState('')
  const [itens, setItens] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  function locaisDaLoja() {
    if (lojaId === SEM_LOJA) return locais.filter((l) => !l.unidade_id)
    if (lojaId) return locais.filter((l) => l.unidade_id === lojaId)
    return locais
  }

  useEffect(() => {
    if (!locais.length) return
    let cancelado = false
    setCarregando(true)
    setErro('')
    const alvo = setorId ? locais.filter((l) => l.id === setorId) : locaisDaLoja()
    buscarSaldoVirtualGeral({ locaisAlvo: alvo })
      .then((base) => { if (!cancelado) setItens(base.map((i) => ({ ...i, saldo: saldoFiltrado(i, setorId) }))) })
      .catch((e) => { if (!cancelado) setErro('Não consegui buscar — ' + e.message) })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lojaId, setorId, locais.length])

  const filtrados = (itens || []).filter((i) => !busca || i.nome.toLowerCase().includes(busca.toLowerCase()))
  const comSaldo = filtrados.filter((i) => Math.abs(i.saldo) > 0.0001)
  const zerados = filtrados.filter((i) => Math.abs(i.saldo) <= 0.0001)

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Estoque virtual — visão geral</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>Tudo que tem saldo calculado (e o que zerou) de uma vez, sem escolher um item primeiro.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label className="muted">Loja</label>
          <select value={lojaId} onChange={(e) => { setLojaId(e.target.value); setSetorId('') }}>
            <option value="">Todas</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            <option value={SEM_LOJA}>Sem loja</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label className="muted">Setor</label>
          <select value={setorId} onChange={(e) => setSetorId(e.target.value)}>
            <option value="">Todos</option>
            {locaisDaLoja().map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <label className="muted">Buscar item</label>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar…" />
        </div>
      </div>

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{erro}</p>}

      {carregando ? (
        <p className="muted">Buscando…</p>
      ) : itens && (
        <>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>Com saldo ({comSaldo.length})</p>
          {comSaldo.length === 0 ? (
            <p className="muted" style={{ marginBottom: 14 }}>Nenhum item com saldo nesse recorte.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 14 }}>
              <tbody>
                {comSaldo.map((i) => (
                  <tr key={i.codigo_everest} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px 6px 0' }}>{i.nome}</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 600 }}>{formatarNumero(i.saldo, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {zerados.length > 0 && (
            <details>
              <summary className="muted" style={{ fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>Zerados ({zerados.length})</summary>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {zerados.map((i) => (
                    <tr key={i.codigo_everest} style={{ borderBottom: '0.5px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px 6px 0' }} className="muted">{i.nome}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right' }} className="muted">{formatarNumero(i.saldo, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </div>
  )
}
