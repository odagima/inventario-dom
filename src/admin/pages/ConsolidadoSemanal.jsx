import { useEffect, useState } from 'react'
import { listarGruposAdmin, listarDatasContagemPorGrupo, buscarConsolidadoPorData } from '../lib/adminApi'
import { formatarNumero } from '../lib/formato'

const LABEL_STATUS = {
  insumo_direto: { texto: 'já é insumo em natura', cor: 'var(--text-secondary)' },
  convertido: { texto: 'convertido ✓', cor: 'var(--success)' },
  gap_sem_ficha: { texto: 'sem ficha técnica — gap', cor: 'var(--danger)' },
  nao_aplicavel: { texto: 'sem conversão aplicável', cor: 'var(--text-tertiary)' }
}

const fmtDia = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('pt-BR') : '—')

export default function ConsolidadoSemanal() {
  const [grupos, setGrupos] = useState([])
  const [grupoId, setGrupoId] = useState('')
  const [datas, setDatas] = useState([])
  const [dataEscolhida, setDataEscolhida] = useState('')
  const [carregandoDatas, setCarregandoDatas] = useState(false)
  const [dados, setDados] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [soGaps, setSoGaps] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    listarGruposAdmin().then(setGrupos).catch(() => {})
  }, [])

  useEffect(() => {
    setDados(null)
    setDataEscolhida('')
    if (!grupoId) { setDatas([]); return }
    setCarregandoDatas(true)
    listarDatasContagemPorGrupo(grupoId)
      // Lista vem do mais antigo pro mais novo — sugestão inicial é a mais recente.
      .then((lista) => { setDatas(lista); if (lista.length) setDataEscolhida(lista[lista.length - 1].data) })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregandoDatas(false))
  }, [grupoId])

  async function handleBuscar() {
    if (!grupoId || !dataEscolhida) return
    setCarregando(true)
    setErro('')
    try {
      setDados(await buscarConsolidadoPorData(grupoId, dataEscolhida))
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  const linhasFiltradas = dados ? (soGaps ? dados.linhas.filter((l) => l.statusConversao === 'gap_sem_ficha') : dados.linhas) : []
  const totalGaps = dados ? dados.linhas.filter((l) => l.statusConversao === 'gap_sem_ficha').length : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Consolidado da contagem</p>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Soma todo lançamento do mesmo produto no mesmo grupo de contagem e mesma data — todas as lojas juntas (não
          separa por loja, já que Compras também não separa) — não importa quantas pessoas contaram ou em quantas
          sessões caiu. Onde o produto tem ficha técnica, já mostra também o insumo em natura equivalente.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="muted">Grupo de contagem</label>
            <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)}>
              <option value="">Selecione…</option>
              {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="muted">Data da contagem</label>
            <select
              value={dataEscolhida}
              onChange={(e) => setDataEscolhida(e.target.value)}
              disabled={!grupoId || carregandoDatas || datas.length === 0}
              style={{ minWidth: 220 }}
            >
              {datas.length === 0 && <option value="">{carregandoDatas ? 'Carregando…' : 'Nenhuma data encontrada'}</option>}
              {datas.map((d) => (
                <option key={d.data} value={d.data}>{fmtDia(d.data)} · {d.totalSessoes} sessão(ões)</option>
              ))}
            </select>
          </div>
          <button className="primary" onClick={handleBuscar} disabled={carregando || !grupoId || !dataEscolhida} style={{ height: 44 }}>
            {carregando ? 'Consolidando…' : 'Consolidar'}
          </button>
        </div>
      </div>

      {erro && <div className="card"><p style={{ color: 'var(--danger)' }}>{erro}</p></div>}

      {dados && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', margin: '2px 0 16px' }}>
            <div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>Produtos distintos</p>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{dados.totalProdutos}</p>
            </div>
            <div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>Lançamentos somados</p>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{dados.totalLancamentos}</p>
            </div>
            <div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>Sessões envolvidas</p>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{dados.sessoes.length}</p>
            </div>
            {totalGaps > 0 && (
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>Sem ficha técnica (gap)</p>
                <p style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--danger)' }}>{totalGaps}</p>
              </div>
            )}
          </div>

          {totalGaps > 0 && (
            <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 13 }}>
              <input type="checkbox" checked={soGaps} onChange={(e) => setSoGaps(e.target.checked)} />
              Mostrar só os produtos sem ficha técnica (gap)
            </label>
          )}

          {linhasFiltradas.length === 0 ? (
            <p className="muted">Nenhum lançamento nessa data pra esse grupo.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  {['Produto', 'Código Everest', 'Qtd. consolidada', 'Lançamentos', 'Conversão', 'Insumo em natura equivalente'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhasFiltradas.map((l) => (
                  <tr key={l.produtoId} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '8px' }}>{l.nome}</td>
                    <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>{l.codigoEverest || '—'}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarNumero(l.quantidade, 3)} {l.unidade}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }} title={`${l.sessoesEnvolvidas} sessão(ões)`}>{l.lancamentos}×</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap', color: LABEL_STATUS[l.statusConversao]?.cor }}>
                      {LABEL_STATUS[l.statusConversao]?.texto}
                    </td>
                    <td style={{ padding: '8px' }}>
                      {l.insumosEmNatura.length === 0 ? '—' : l.insumosEmNatura.map((i, idx) => (
                        <div key={idx} style={{ whiteSpace: 'nowrap' }}>
                          {formatarNumero(i.quantidadeEquivalente, 3)} {i.unidade} <span className="muted">— {i.nome} ({i.codigoEverest})</span>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
