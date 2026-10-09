import { useEffect, useState } from 'react'
import BuscaProdutoPerda from '../../components/BuscaProdutoPerda'
import { listarLocaisEstoque } from '../../lib/locaisEstoqueApi'
import { listarUnidades } from '../../lib/api'
import { buscarEstoqueVirtualComDerivados, saldoFiltrado } from '../../lib/estoqueMovimentosApi'
import { buscarCustoMedioAtualPorCodigos } from '../lib/adminApi'
import { formatarNumero, formatarMoeda } from '../lib/formato'

const SEM_LOJA = '__sem_loja__'

// Pedido do Felipe (09/10/2026): estoque virtual de um item + todos os derivados dele (árvore de
// porcionamento), filtrável por Loja, Setor e Item — pra validar se o saldo calculado bate com o
// que tem de verdade na praça. Reaproveita o mesmo ledger de "Saldo calculado por setor"
// (LocaisEstoque.jsx), só muda o recorte: aqui é por ITEM (+ descendentes), lá é por Setor.
//
// Versão Admin mostra preço e valor (preço × saldo) — o Painel de Controle operacional (mesma
// conta, `TelaAcompanhamento.jsx`) mostra só quantidade, preço/custo não é informação pra operação
// ver.
//
// Ajustes de 09/10/2026 (feedback do Felipe): (1) o filtro de Setor só oferece Setores que de fato
// têm saldo (dele ou de algum derivado) — antes listava todos, mesmo os sem nada; (2) separa quem
// tem saldo de quem está zerado, pra não precisar catar visualmente; (3) corrigido um bug onde
// escolher um Setor fazia o próprio seletor de Setor encolher pra só aquela opção (a lista de
// opções vinha do mesmo filtro já aplicado — agora as opções vêm só do filtro de Loja).
export default function EstoqueVirtualItem() {
  const [locais, setLocais] = useState([])
  const [unidades, setUnidades] = useState([])
  const [lojaId, setLojaId] = useState('')
  const [setorId, setSetorId] = useState('')
  const [produto, setProduto] = useState(null)
  const [carregandoBase, setCarregandoBase] = useState(true)
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')
  const [itens, setItens] = useState(null) // null = ainda não buscou
  const [setoresComDado, setSetoresComDado] = useState(null)

  useEffect(() => {
    Promise.all([listarLocaisEstoque(), listarUnidades()])
      .then(([ls, us]) => { setLocais(ls); setUnidades(us) })
      .catch((e) => setErro('Não consegui carregar Lojas/Setores — ' + e.message))
      .finally(() => setCarregandoBase(false))
  }, [])

  // Setores da Loja escolhida (ou todos) — NUNCA leva em conta o Setor já selecionado, senão
  // escolher um Setor encolhe o próprio seletor pra só ele (bug reportado).
  function locaisDaLoja() {
    if (lojaId === SEM_LOJA) return locais.filter((l) => !l.unidade_id)
    if (lojaId) return locais.filter((l) => l.unidade_id === lojaId)
    return locais
  }

  // Opções do seletor de Setor: antes de buscar, todos da Loja; depois de buscar, só quem tem
  // saldo (do item ou de algum derivado) — pedido do Felipe.
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
      const precoPorCodigo = await buscarCustoMedioAtualPorCodigos(base.map((i) => i.codigo_everest))
      setSetoresComDado(locaisComSaldo)
      if (setorId && !locaisComSaldo.includes(setorId)) setSetorId('') // setor escolhido ficou sem dado — mostra o total em vez de sumir
      setItens(base.map((i) => {
        const saldo = saldoFiltrado(i, locaisComSaldo.includes(setorId) ? setorId : '')
        const preco = precoPorCodigo[i.codigo_everest]
        return { ...i, saldo, preco: preco ?? null, valor: preco != null ? preco * saldo : null }
      }))
    } catch (e) {
      setErro('Não consegui buscar — ' + e.message)
    } finally {
      setBuscando(false)
    }
  }

  if (carregandoBase) return <div className="card"><p className="muted">Carregando…</p></div>

  const raiz = itens?.[0]
  const derivados = itens?.slice(1) || []
  const derivadosComSaldo = derivados.filter((d) => Math.abs(d.saldo) > 0.0001)
  const derivadosZerados = derivados.filter((d) => Math.abs(d.saldo) <= 0.0001)

  function linhaDerivado(d) {
    return (
      <tr key={d.codigo_everest} style={{ borderBottom: '0.5px solid var(--border)' }}>
        <td style={{ padding: '8px' }}>{d.nome}</td>
        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{formatarNumero(d.saldo, 3)}</td>
        <td style={{ padding: '8px', textAlign: 'right' }} className="muted">{d.preco != null ? formatarMoeda(d.preco) : '—'}</td>
        <td style={{ padding: '8px', textAlign: 'right' }}>{d.valor != null ? formatarMoeda(d.valor) : '—'}</td>
      </tr>
    )
  }

  return (
    <div className="card">
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Estoque virtual por item</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
        Escolha um item e veja o saldo calculado dele e de todos os derivados (árvore de porcionamento), filtrado por Loja e/ou Setor.
        Preço é o último valor de compra conhecido (nota importada) — "—" quando nunca comprado com esse código.
      </p>

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
          {setoresComDado && opcoesSetor().length === 0 && (
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>Nenhum Setor com saldo pra esse item/Loja.</p>
          )}
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
              <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
                Everest {raiz.codigo_everest} · raiz da cadeia · {raiz.preco != null ? `${formatarMoeda(raiz.preco)}/un.` : 'sem preço de compra'}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 20 }}>{formatarNumero(raiz.saldo, 3)}</p>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                estoque virtual{raiz.valor != null ? ` · ${formatarMoeda(raiz.valor)}` : ''}
              </p>
            </div>
          </div>

          {derivados.length === 0 ? (
            <p className="muted">Esse item não tem nenhum derivado cadastrado em Árvore de Porcionamento.</p>
          ) : (
            <>
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>Derivados com saldo ({derivadosComSaldo.length})</p>
              {derivadosComSaldo.length === 0 ? (
                <p className="muted" style={{ marginBottom: 14 }}>Nenhum derivado com saldo nesse recorte.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
                  <thead>
                    <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                      {['Item', 'Saldo', 'Preço', 'Valor'].map((h) => (
                        <th key={h} style={{ textAlign: h === 'Item' ? 'left' : 'right', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{derivadosComSaldo.map(linhaDerivado)}</tbody>
                </table>
              )}

              {derivadosZerados.length > 0 && (
                <details>
                  <summary className="muted" style={{ fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>Zerados ({derivadosZerados.length})</summary>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <tbody>{derivadosZerados.map(linhaDerivado)}</tbody>
                  </table>
                </details>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
