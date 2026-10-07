import { useEffect, useState } from 'react'
import Topbar from '../components/Topbar'
import { listarLocaisEstoque } from '../lib/locaisEstoqueApi'
import { listarSaldosCalculados, listarMovimentosRecentes } from '../lib/estoqueMovimentosApi'
import { listarTurnosAbertos, listarTurnosHistorico, turnoVencido } from '../lib/turnosApi'
import { listarRequisicoesPendentes, listarTransferenciasPendentes } from '../lib/requisicaoTransferenciaApi'
import { buscarProdutosPorCodigosEverest } from '../lib/api'
import { formatarNumero } from '../admin/lib/formato'

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

export default function TelaAcompanhamento({ onSair }) {
  const [locais, setLocais] = useState([])
  const [turnosAbertos, setTurnosAbertos] = useState([])
  const [ultimoFechadoPorLocal, setUltimoFechadoPorLocal] = useState({})
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
        const ls = await listarLocaisEstoque()
        if (cancelado) return
        setLocais(ls)

        const [abertos, saldosBrutos, pr, pt, mov] = await Promise.all([
          listarTurnosAbertos(),
          Promise.all(ls.map((l) => listarSaldosCalculados(l.id).then((linhas) => [l.id, linhas]))),
          listarRequisicoesPendentes(),
          listarTransferenciasPendentes(),
          listarMovimentosRecentes(30)
        ])
        if (cancelado) return

        setTurnosAbertos(abertos)
        setPendentesReq(pr)
        setPendentesTransf(pt)
        setRecentes(mov)

        const idsComAberto = new Set(abertos.map((t) => t.local_estoque_id))
        const semAberto = ls.filter((l) => !idsComAberto.has(l.id))
        const historicos = await Promise.all(semAberto.map((l) => listarTurnosHistorico(l.id, 1)))
        if (cancelado) return
        const mapaFechado = {}
        semAberto.forEach((l, i) => { mapaFechado[l.id] = historicos[i][0] || null })
        setUltimoFechadoPorLocal(mapaFechado)

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
  const abertoPorLocal = Object.fromEntries(turnosAbertos.map((t) => [t.local_estoque_id, t]))

  if (carregando) return (
    <div className="screen">
      <Topbar titulo="Acompanhamento" subtitulo="o que está rolando agora" onVoltar={onSair} />
      <p className="muted">Carregando…</p>
    </div>
  )

  return (
    <div className="screen">
      <Topbar
        titulo="Acompanhamento"
        subtitulo={atualizadoEm ? `atualizado ${faz(atualizadoEm)}` : 'o que está rolando agora'}
        onVoltar={onSair}
      />

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Status das praças</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {locais.map((l) => {
            const turno = abertoPorLocal[l.id]
            const vencido = turno && turnoVencido(turno)
            const ultimoFechado = ultimoFechadoPorLocal[l.id]
            return (
              <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 500 }}>{l.nome}</span>
                {turno ? (
                  <span style={{ fontSize: 12.5, textAlign: 'right', color: vencido ? 'var(--danger)' : 'var(--success)' }}>
                    {vencido ? 'Vencida' : 'Aberta'} {faz(turno.aberto_em)}{turno.aberto_por ? ` · ${turno.aberto_por}` : ''}
                  </span>
                ) : ultimoFechado ? (
                  <span className="muted" style={{ fontSize: 12.5, textAlign: 'right' }}>Fechada · {faz(ultimoFechado.fechado_em || ultimoFechado.aberto_em)}</span>
                ) : (
                  <span className="muted" style={{ fontSize: 12.5, textAlign: 'right' }}>Nunca aberta</span>
                )}
              </div>
            )
          })}
        </div>
      </div>

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
