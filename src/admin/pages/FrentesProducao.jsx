import { useEffect, useState } from 'react'
import { listarFrentes } from '../../lib/frentesApi'
import { listarSaldosCalculados } from '../../lib/estoqueMovimentosApi'
import { listarProducoes, rendimentoDoEvento } from '../../lib/producaoApi'
import { listarRequisicoesHistorico, listarTransferenciasHistorico } from '../../lib/requisicaoTransferenciaApi'
import { buscarProdutosPorCodigosEverest } from '../../lib/api'
import { formatarNumero } from '../lib/formato'

// Painel de conferência das Frentes (migration_v15.sql) — não existia nenhum lugar no Admin pra
// ver o que é lançado em Produção/Requisição/Transferência: cada tela nova (TelaProducao,
// TelaRequisicao) só mostra o que está em aberto, nada fica visível depois de fechado. Esta tela
// só LÊ — nenhuma edição acontece aqui.

function fmt(n, casas = 3) {
  const x = Number(n)
  if (!isFinite(x)) return '—'
  return x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

function formatarDataHora(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function FrentesProducao() {
  const [frentes, setFrentes] = useState([])
  const [saldosPorFrente, setSaldosPorFrente] = useState({})
  const [producoes, setProducoes] = useState([])
  const [requisicoes, setRequisicoes] = useState([])
  const [transferencias, setTransferencias] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    async function carregar() {
      try {
        const fr = await listarFrentes()
        setFrentes(fr)

        const saldosBrutos = await Promise.all(
          fr.map((f) => listarSaldosCalculados(f.id).then((linhas) => [f.id, linhas]))
        )
        const todosCodigos = [...new Set(saldosBrutos.flatMap(([, linhas]) => linhas.map((l) => l.codigo_everest)))]
        const produtos = await buscarProdutosPorCodigosEverest(todosCodigos)
        const nomePorCodigo = Object.fromEntries(produtos.map((p) => [p.codigo_everest, p.nome]))

        const mapa = {}
        saldosBrutos.forEach(([frenteId, linhas]) => {
          mapa[frenteId] = linhas
            .filter((l) => Math.abs(Number(l.saldo)) > 0.0001) // zerado não ajuda a conferir nada — só polui
            .map((l) => ({ ...l, nome: nomePorCodigo[l.codigo_everest] || l.codigo_everest }))
        })
        setSaldosPorFrente(mapa)

        const [prod, req, transf] = await Promise.all([
          listarProducoes({ limite: 50 }),
          listarRequisicoesHistorico(50),
          listarTransferenciasHistorico(50)
        ])
        setProducoes(prod)
        setRequisicoes(req)
        setTransferencias(transf)
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

      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Saldo calculado por frente</p>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
          Ledger próprio (migration_v15.sql), separado do saldo por contagem — só itens com saldo diferente de zero aparecem aqui.
        </p>
        {frentes.map((f) => {
          const linhas = saldosPorFrente[f.id] || []
          if (!linhas.length) return null
          return (
            <div key={f.id} style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 6px', fontWeight: 500, fontSize: 13.5 }}>{f.nome}</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.codigo_everest} style={{ borderBottom: '0.5px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px 4px 0' }}>{l.nome}</td>
                      <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {formatarNumero(l.saldo, 3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
        {frentes.every((f) => !(saldosPorFrente[f.id] || []).length) && (
          <p className="muted">Nenhuma frente com saldo lançado ainda.</p>
        )}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <p style={{ margin: '0 0 14px', fontWeight: 600, fontSize: 15 }}>Produções recentes</p>
        {producoes.length === 0 ? <p className="muted">Nenhuma produção registrada ainda.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                {['Data', 'Frente', 'Entrou', 'Saiu', 'F.C. do processo', 'Status'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {producoes.map((p) => {
                const entradas = (p.producoes_itens || []).filter((i) => i.papel === 'entrada')
                const saidas = (p.producoes_itens || []).filter((i) => i.papel === 'saida')
                const r = rendimentoDoEvento(p)
                return (
                  <tr key={p.id} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{p.data}</td>
                    <td style={{ padding: '8px' }}>{p.frentes?.nome || '—'}</td>
                    <td style={{ padding: '8px' }}>{entradas.map((e) => `${fmt(e.quantidade)} ${e.unidade} ${e.produtos?.nome || e.codigo_everest}`).join(', ') || '—'}</td>
                    <td style={{ padding: '8px' }}>{saidas.length ? `${saidas.length} ${saidas.length === 1 ? 'item' : 'itens'}` : '—'}</td>
                    <td style={{ padding: '8px' }}>{r ? `${(r.aproveitamento * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}</td>
                    <td style={{ padding: '8px' }} className="muted">{p.status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 15 }}>Requisições</p>
        {requisicoes.length === 0 ? <p className="muted">Nenhuma ainda.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {requisicoes.map((r) => (
              <div key={r.id} className="list-item">
                <span>{r.solicitante?.nome} ← {r.atendente?.nome} · {fmt(r.quantidade_atendida || 0)}/{fmt(r.quantidade_solicitada)} {r.codigo_everest}</span>
                <span className="muted">{r.status} · {formatarDataHora(r.solicitado_em)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 15 }}>Transferências</p>
        {transferencias.length === 0 ? <p className="muted">Nenhuma ainda.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {transferencias.map((t) => (
              <div key={t.id} className="list-item">
                <span>{t.origem?.nome} → {t.destino?.nome} · {fmt(t.quantidade)} {t.codigo_everest}</span>
                <span className="muted">{t.status} · {formatarDataHora(t.enviado_em)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
