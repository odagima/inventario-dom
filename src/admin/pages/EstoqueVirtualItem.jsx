import { useEffect, useState } from 'react'
import BuscaProdutoPerda from '../../components/BuscaProdutoPerda'
import { listarLocaisEstoque } from '../../lib/locaisEstoqueApi'
import { listarUnidades, buscarProdutosPorCodigosEverest } from '../../lib/api'
import { listarSaldosCalculados } from '../../lib/estoqueMovimentosApi'
import { buscarFatoresCorrecao, buscarDescendentes } from '../../lib/fatoresCorrecaoApi'
import { formatarNumero } from '../lib/formato'

const SEM_LOJA = '__sem_loja__'

// Pedido do Felipe (09/10/2026): estoque virtual de um item + todos os derivados dele (árvore de
// porcionamento), filtrável por Loja, Setor e Item — pra validar se o saldo calculado bate com o
// que tem de verdade na praça. Reaproveita o mesmo ledger de "Saldo calculado por setor"
// (LocaisEstoque.jsx), só muda o recorte: aqui é por ITEM (+ descendentes), lá é por Setor.
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

  useEffect(() => {
    Promise.all([listarLocaisEstoque(), listarUnidades()])
      .then(([ls, us]) => { setLocais(ls); setUnidades(us) })
      .catch((e) => setErro('Não consegui carregar Lojas/Setores — ' + e.message))
      .finally(() => setCarregandoBase(false))
  }, [])

  // Setor escolhido manda mais que Loja — Loja só filtra a LISTA de setores quando nenhum setor
  // específico foi escolhido ainda.
  function locaisAlvo() {
    if (setorId) return locais.filter((l) => l.id === setorId)
    if (lojaId === SEM_LOJA) return locais.filter((l) => !l.unidade_id)
    if (lojaId) return locais.filter((l) => l.unidade_id === lojaId)
    return locais
  }

  async function buscar() {
    if (!produto) return
    setBuscando(true)
    setErro('')
    try {
      const alvo = locaisAlvo()
      const [mapa, saldosPorLocal] = await Promise.all([
        buscarFatoresCorrecao(),
        Promise.all(alvo.map((l) => listarSaldosCalculados(l.id)))
      ])

      const saldoPorCodigo = {}
      saldosPorLocal.forEach((linhas) => {
        linhas.forEach((l) => { saldoPorCodigo[l.codigo_everest] = (saldoPorCodigo[l.codigo_everest] || 0) + Number(l.saldo) })
      })

      const descendentes = buscarDescendentes(mapa, produto.codigo_everest)
      const todosCodigos = [produto.codigo_everest, ...descendentes]
      const produtos = await buscarProdutosPorCodigosEverest(todosCodigos)
      const nomePorCodigo = Object.fromEntries(produtos.map((p) => [p.codigo_everest, p.nome]))

      setItens(todosCodigos.map((codigo, i) => ({
        codigo_everest: codigo,
        nome: nomePorCodigo[codigo] || codigo,
        raiz: i === 0,
        saldo: saldoPorCodigo[codigo] || 0
      })))
    } catch (e) {
      setErro('Não consegui buscar — ' + e.message)
    } finally {
      setBuscando(false)
    }
  }

  if (carregandoBase) return <div className="card"><p className="muted">Carregando…</p></div>

  const raiz = itens?.[0]
  const derivados = itens?.slice(1) || []

  return (
    <div className="card">
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Estoque virtual por item</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
        Escolha um item e veja o saldo calculado dele e de todos os derivados (árvore de porcionamento), filtrado por Loja e/ou Setor.
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
            {locaisAlvo().map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </div>
      </div>

      {!produto ? (
        <BuscaProdutoPerda onSelecionar={setProduto} />
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <p style={{ margin: 0, fontWeight: 500 }}>{produto.nome}</p>
          <button type="button" className="ghost" onClick={() => { setProduto(null); setItens(null) }}>trocar</button>
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
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 20 }}>{formatarNumero(raiz.saldo, 3)}</p>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>estoque virtual</p>
            </div>
          </div>

          <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>Derivados (árvore de porcionamento)</p>
          {derivados.length === 0 ? (
            <p className="muted">Esse item não tem nenhum derivado cadastrado em Árvore de Porcionamento.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {derivados.map((d) => (
                <div key={d.codigo_everest} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', border: '0.5px solid var(--border)', borderRadius: 8 }}>
                  <span style={{ fontSize: 13 }}>{d.nome}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{formatarNumero(d.saldo, 3)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
