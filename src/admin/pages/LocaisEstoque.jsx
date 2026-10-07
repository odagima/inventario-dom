import { useEffect, useState } from 'react'
import BuscaProdutoPerda from '../../components/BuscaProdutoPerda'
import { listarLocaisEstoque, listarLocaisEstoqueTodos, criarLocalEstoque, atualizarLocalEstoque } from '../../lib/locaisEstoqueApi'
import { listarSaldosCalculados, buscarHistoricoMovimentos, removerMovimento } from '../../lib/estoqueMovimentosApi'
import { listarRequisicoesPendentes, listarTransferenciasPendentes } from '../../lib/requisicaoTransferenciaApi'
import { buscarProdutosPorCodigosEverest } from '../../lib/api'
import { listarUnidadesAdmin } from '../lib/adminApi'
import { formatarNumero } from '../lib/formato'

// Painel de conferência dos Locais de estoque (migration_v15.sql, renomeado de "frente" na
// migration_v19.sql) — cada tela nova (TelaProducao, TelaRequisicao) só mostra o que está em
// aberto, nada fica visível depois de fechado. Esta tela mostra o saldo calculado/histórico.
//
// 06/10/2026 (pedido do Felipe): o histórico de movimentação é filtrado por ITEM — item + período
// + local, só então mostra — em vez de uma lista corrida (produções/requisições/transferências
// dos últimos 50, sempre visível), que cresce sem parar e fica difícil de ler.
//
// 07/10/2026 (pedido do Felipe): até aqui criar um local novo exigia SQL direto — ganhou um
// cadastro simples em cima (mesmo molde de Unidades.jsx), o resto da tela continua só leitura.

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

function fmt(n, casas = 3) {
  const x = Number(n)
  if (!isFinite(x)) return '—'
  return x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

function formatarDataHora(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function primeiroDiaMesAtual() {
  const hoje = new Date()
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
}
function hojeIso() { return new Date().toISOString().slice(0, 10) }

export default function LocaisEstoque({ usuario }) {
  const [locais, setLocais] = useState([])
  const [saldosPorLocal, setSaldosPorLocal] = useState({})
  const [pendentesReq, setPendentesReq] = useState([])
  const [pendentesTransf, setPendentesTransf] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    async function carregar() {
      try {
        const ls = await listarLocaisEstoque()
        setLocais(ls)

        const saldosBrutos = await Promise.all(
          ls.map((l) => listarSaldosCalculados(l.id).then((linhas) => [l.id, linhas]))
        )
        const todosCodigos = [...new Set(saldosBrutos.flatMap(([, linhas]) => linhas.map((l) => l.codigo_everest)))]
        const produtos = await buscarProdutosPorCodigosEverest(todosCodigos)
        const nomePorCodigo = Object.fromEntries(produtos.map((p) => [p.codigo_everest, p.nome]))

        const mapa = {}
        saldosBrutos.forEach(([localId, linhas]) => {
          mapa[localId] = linhas
            .filter((l) => Math.abs(Number(l.saldo)) > 0.0001) // zerado não ajuda a conferir nada — só polui
            .map((l) => ({ ...l, nome: nomePorCodigo[l.codigo_everest] || l.codigo_everest }))
        })
        setSaldosPorLocal(mapa)

        const [pr, pt] = await Promise.all([listarRequisicoesPendentes(), listarTransferenciasPendentes()])
        setPendentesReq(pr)
        setPendentesTransf(pt)
      } catch (e) {
        setErro('Não consegui carregar — ' + e.message)
      } finally {
        setCarregando(false)
      }
    }
    carregar()
  }, [])

  if (carregando) return <div className="card"><p className="muted">Carregando…</p></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {erro && <div className="card"><p style={{ color: 'var(--danger)' }}>{erro}</p></div>}

      <CadastroLocais />

      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Saldo calculado por local de estoque</p>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
          Ledger próprio (migration_v15.sql), separado do saldo por contagem — só itens com saldo diferente de zero aparecem aqui.
        </p>
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
                      <td style={{ padding: '4px 8px 4px 0' }}>{item.nome}</td>
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
          <p className="muted">Nenhum local de estoque com saldo lançado ainda.</p>
        )}
      </div>

      <HistoricoMovimentacao locais={locais} usuario={usuario} />

      <div className="card">
        <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 15 }}>Requisições pendentes</p>
        {pendentesReq.length === 0 ? <p className="muted">Nada pendente.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pendentesReq.map((r) => (
              <div key={r.id} className="list-item">
                <span>{r.solicitante?.nome} ← {r.atendente?.nome} · {fmt(r.quantidade_atendida || 0)}/{fmt(r.quantidade_solicitada)} {r.codigo_everest}</span>
                <span className="muted">{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 15 }}>Transferências pendentes</p>
        {pendentesTransf.length === 0 ? <p className="muted">Nada pendente.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {pendentesTransf.map((t) => (
              <div key={t.id} className="list-item">
                <span>{t.origem?.nome} → {t.destino?.nome} · {fmt(t.quantidade)} {t.codigo_everest}</span>
                <span className="muted">{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CadastroLocais() {
  const [locais, setLocais] = useState([])
  const [unidades, setUnidades] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [unidadeId, setUnidadeId] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      const [l, u] = await Promise.all([listarLocaisEstoqueTodos(), listarUnidadesAdmin()])
      setLocais(l)
      setUnidades(u)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  async function handleCriar() {
    if (!nome.trim()) return
    setErro('')
    setSalvando(true)
    try {
      await criarLocalEstoque({ nome: nome.trim(), unidadeId: unidadeId || null })
      setNome(''); setUnidadeId('')
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleAtualizarCampo(l, campo, valor) {
    await atualizarLocalEstoque(l.id, { [campo]: valor })
    setLocais((prev) => prev.map((x) => (x.id === l.id ? { ...x, [campo]: valor } : x)))
  }

  return (
    <div className="card">
      <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Cadastro de locais de estoque</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="muted">Nome</label>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Bar Dalva" />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="muted">Loja — opcional</label>
          <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            <option value="">Nenhuma</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        <button className="primary" onClick={handleCriar} disabled={salvando || !nome.trim()} style={{ height: 44 }}>
          {salvando ? 'Criando…' : 'Criar'}
        </button>
      </div>
      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{erro}</p>}

      {carregando ? (
        <p className="muted">Carregando…</p>
      ) : (
        locais.map((l) => (
          <div key={l.id} className="list-item" style={{ gap: 10 }}>
            <span style={{ flexShrink: 0 }}>{l.nome}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <select
                value={l.unidade_id || ''}
                onChange={(e) => handleAtualizarCampo(l, 'unidade_id', e.target.value || null)}
                style={{ fontSize: 12.5, padding: '6px 8px' }}
              >
                <option value="">Sem loja</option>
                {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }} className="muted">
                <input type="checkbox" checked={l.ativo} onChange={(e) => handleAtualizarCampo(l, 'ativo', e.target.checked)} />
                ativo
              </label>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function HistoricoMovimentacao({ locais, usuario }) {
  const [produto, setProduto] = useState(null)
  const [localEstoqueId, setLocalEstoqueId] = useState('')
  const [dataInicio, setDataInicio] = useState(primeiroDiaMesAtual())
  const [dataFim, setDataFim] = useState(hojeIso())
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')
  const [linhas, setLinhas] = useState(null) // null = ainda não buscou
  const [excluindoId, setExcluindoId] = useState(null)
  const podeExcluir = !!usuario?.ehDesenvolvedor

  const nomePorLocal = Object.fromEntries(locais.map((l) => [l.id, l.nome]))

  async function buscar() {
    if (!produto) return
    setBuscando(true)
    setErro('')
    try {
      const movimentos = await buscarHistoricoMovimentos({ codigoEverest: produto.codigo_everest, localEstoqueId: localEstoqueId || undefined, dataFim })
      // Saldo acumulado soma a HISTÓRIA TODA (até dataFim) — senão o acumulado mentiria, voltando
      // a zero sempre que alguém filtra a partir de uma data no meio da vida do item.
      let saldo = 0
      const comSaldo = movimentos.map((m) => { saldo += Number(m.quantidade); return { ...m, saldoAcumulado: saldo } })
      const inicioMs = dataInicio ? new Date(dataInicio + 'T00:00:00').getTime() : -Infinity
      setLinhas(comSaldo.filter((m) => new Date(m.registrado_em).getTime() >= inicioMs).reverse())
    } catch (e) {
      setErro('Não consegui buscar — ' + e.message)
    } finally {
      setBuscando(false)
    }
  }

  // Só DEV — pedido do Felipe (06/10/2026): "estou fazendo vários testes, e depois preciso
  // apagar". Apaga de verdade (ver `removerMovimento`), muda o saldo calculado na hora.
  async function excluir(m) {
    if (!window.confirm('Excluir esse movimento? Isso muda o saldo calculado do local de estoque. Não dá pra desfazer.')) return
    setExcluindoId(m.id)
    setErro('')
    try {
      await removerMovimento(m.id)
      await buscar()
    } catch (e) {
      setErro('Não consegui excluir — ' + e.message)
    } finally {
      setExcluindoId(null)
    }
  }

  return (
    <div className="card">
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Histórico de movimentação</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>Escolha o item e o período — a lista só aparece depois de buscar, pra não virar uma lista corrida.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!produto ? (
          <BuscaProdutoPerda onSelecionar={setProduto} />
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <p style={{ margin: 0, fontWeight: 500 }}>{produto.nome}</p>
            <button type="button" className="ghost" onClick={() => { setProduto(null); setLinhas(null) }}>trocar</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label className="muted">Local de estoque</label>
            <select value={localEstoqueId} onChange={(e) => setLocalEstoqueId(e.target.value)}>
              <option value="">Todos</option>
              {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label className="muted">De</label>
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 130 }}>
            <label className="muted">Até</label>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
          <button className="primary" onClick={buscar} disabled={!produto || buscando} style={{ height: 44 }}>
            {buscando ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
      </div>

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{erro}</p>}

      {linhas && (
        linhas.length === 0 ? (
          <p className="muted" style={{ marginTop: 14 }}>Nenhuma movimentação nesse período.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 14 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                {['Data', 'Tipo', 'Local de estoque', 'Quantidade', 'Saldo', 'Usuário', ...(podeExcluir ? [''] : [])].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((m) => (
                <tr key={m.id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarDataHora(m.registrado_em)}</td>
                  <td style={{ padding: '8px' }}>{LABEL_TIPO[m.tipo] || m.tipo}</td>
                  <td style={{ padding: '8px' }}>{nomePorLocal[m.local_estoque_id] || '—'}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: Number(m.quantidade) < 0 ? 'var(--danger)' : 'var(--success)' }}>
                    {Number(m.quantidade) > 0 ? '+' : ''}{formatarNumero(m.quantidade, 3)}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{formatarNumero(m.saldoAcumulado, 3)}</td>
                  <td style={{ padding: '8px' }} className="muted">{m.usuario || '—'}</td>
                  {podeExcluir && (
                    <td style={{ padding: '8px' }}>
                      <button
                        onClick={() => excluir(m)}
                        disabled={excluindoId === m.id}
                        style={{ padding: '6px 9px', color: 'var(--danger)' }}
                        aria-label="Excluir movimento"
                      >
                        {excluindoId === m.id ? '…' : '×'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  )
}
