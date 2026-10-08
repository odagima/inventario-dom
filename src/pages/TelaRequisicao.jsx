import { useCallback, useEffect, useState } from 'react'
import BuscaProduto from '../components/BuscaProduto'
import Topbar from '../components/Topbar'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import { listarLocaisEstoque } from '../lib/locaisEstoqueApi'
import { buscarSaldoCalculado } from '../lib/estoqueMovimentosApi'
import { podeAtenderRequisicao } from '../lib/permissoes'
import {
  listarRequisicoesPendentes,
  criarRequisicao,
  atenderRequisicao,
  listarTransferenciasPendentes,
  criarTransferencia,
  confirmarRecebimentoTransferencia
} from '../lib/requisicaoTransferenciaApi'

// Requisição × Transferência, distinguidas pela origem (ver PLANO-TRANSFORMACAO.md): se a origem
// precisa de liberação (Central, Compras) → Requisição, alguém atende antes de sair. Se quem
// manda já tem o material em mãos (Produção mandando pra Serviço) → Transferência, só o destino
// confirma recebimento. As duas emitem movimento no saldo calculado por local de estoque.

function fmt(n, casas = 3) {
  const x = Number(n)
  if (!isFinite(x)) return '—'
  return x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

export default function TelaRequisicao({ usuarioLogado, onSair, iniciarEmNova = false }) {
  // 08/10/2026 (pedido do Felipe, simulação de fluxo): "Nova" tinha virado popup dentro do popup
  // (TelaRequisicao já é um popup da Home) — voltou a ser troca de conteúdo no MESMO popup, como
  // "processo" já funciona em Produção. `iniciarEmNova` é só pro atalho de "Abrir praça → Sim, vou
  // levar item" (TelaOperacao.jsx) cair direto no formulário, sem precisar achar o botão.
  const [aba, setAba] = useState(iniciarEmNova ? 'nova' : 'pendentes') // 'nova' | 'pendentes'
  const [tipo, setTipo] = useState('requisicao') // 'requisicao' | 'transferencia'
  const [locais, setLocais] = useState([])
  const [pendentesReq, setPendentesReq] = useState([])
  const [pendentesTransf, setPendentesTransf] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    try {
      const [f, pr, pt] = await Promise.all([
        listarLocaisEstoque(), listarRequisicoesPendentes(), listarTransferenciasPendentes()
      ])
      setLocais(f); setPendentesReq(pr); setPendentesTransf(pt)
      setErro('')
    } catch (e) {
      setErro('Não consegui carregar — ' + e.message)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  return (
    <div className="screen">
      <Topbar
        titulo="Requisição / Transferência"
        onVoltar={aba === 'nova' ? () => setAba('pendentes') : onSair}
      />

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

      {aba === 'nova' ? (
        // Não fecha/volta sozinho ao enviar — fica aqui pra lançar vários seguidos, só atualiza
        // pendentes por baixo. "Voltar" (Topbar acima) é que leva pra lista.
        <FormNova
          locais={locais} tipo={tipo} setTipo={setTipo}
          usuario={usuarioLogado?.nome}
          localPadraoId={usuarioLogado?.localPadraoId}
          onPronto={carregar}
          onSair={onSair}
        />
      ) : (
        <>
          <button className="primary" onClick={() => setAba('nova')} style={{ width: '100%', padding: 16, fontSize: 16, marginBottom: 14 }}>
            + Nova requisição/transferência
          </button>

          {carregando ? <p className="muted">Carregando…</p> : (
            <Pendentes
              pendentesReq={pendentesReq} pendentesTransf={pendentesTransf}
              usuario={usuarioLogado?.nome} usuarioLogado={usuarioLogado}
              onMudou={carregar} onErro={setErro}
            />
          )}
        </>
      )}
    </div>
  )
}

function FormNova({ locais, tipo, setTipo, usuario, localPadraoId, onPronto, onSair }) {
  // Pedido do Felipe (08/10/2026, "puxa tudo automático... pra tudo e todos"): o lado que
  // representa "quem está agindo" (quem pede, numa requisição; quem manda, numa transferência)
  // já entra com o Setor padrão da pessoa — só o OUTRO lado precisa ser escolhido. Requisição e
  // Transferência são operação entre DOIS locais, então só dá pra automatizar um lado.
  const [origemId, setOrigemId] = useState(tipo === 'transferencia' ? (localPadraoId || '') : '')
  const [destinoId, setDestinoId] = useState(tipo === 'requisicao' ? (localPadraoId || '') : '')
  const [produto, setProduto] = useState(null)
  const [quantidade, setQuantidade] = useState('')
  const [disponivel, setDisponivel] = useState(null)
  const [salvando, setSalvando] = useState(false)
  // Pedido do Felipe (08/10/2026, print do celular): depois de enviar, confirmar com um popup de
  // verdade (igual ao resto do app) em vez de só uma frase verde — e perguntar se quer lançar outra
  // (mantém a tela, limpa só o item/quantidade) ou já fechar tudo (volta pra Home).
  const [concluido, setConcluido] = useState(null) // null | mensagem de sucesso
  const [erro, setErro] = useState('')

  // Troca de tipo muda qual lado é "quem está agindo" — preenche o lado certo se ainda não tiver
  // sido escolhido (nunca sobrescreve o que a pessoa já mexeu).
  useEffect(() => {
    if (!localPadraoId) return
    if (tipo === 'requisicao' && !destinoId) setDestinoId(localPadraoId)
    if (tipo === 'transferencia' && !origemId) setOrigemId(localPadraoId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo])

  const qtd = Number(String(quantidade).replace(',', '.'))

  useEffect(() => {
    setDisponivel(null)
    if (!origemId || !produto) return
    buscarSaldoCalculado(origemId, produto.codigo_everest).then(setDisponivel).catch(() => {})
  }, [origemId, produto])

  function inverter() {
    const o = origemId, d = destinoId
    setOrigemId(d); setDestinoId(o)
  }

  async function enviar() {
    setSalvando(true)
    setErro('')
    try {
      let mensagem
      if (tipo === 'requisicao') {
        const resultado = await criarRequisicao({
          localSolicitanteId: destinoId, localAtendenteId: origemId,
          codigoEverest: produto.codigo_everest, quantidadeSolicitada: qtd, usuario
        })
        mensagem = resultado.autoAtendida ? 'Requisição atendida na hora.' : 'Requisição enviada — aguardando o local de origem atender.'
      } else {
        await criarTransferencia({
          localOrigemId: origemId, localDestinoId: destinoId,
          codigoEverest: produto.codigo_everest, quantidade: qtd, usuario
        })
        mensagem = 'Transferência enviada — aguardando o destino confirmar recebimento.'
      }
      setConcluido(mensagem)
      onPronto()
    } catch (e) {
      setErro('Não consegui enviar — ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  // "Sim, fazer outra": limpa só o item/quantidade — origem e destino costumam valer pro próximo
  // item também (ex.: levando vários itens pra mesma praça de uma vez).
  function fazerOutra() {
    setConcluido(null)
    setProduto(null)
    setQuantidade('')
    setDisponivel(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="segmented">
        <button onClick={() => setTipo('requisicao')} className={tipo === 'requisicao' ? 'active' : ''}>Requisição</button>
        <button onClick={() => setTipo('transferencia')} className={tipo === 'transferencia' ? 'active' : ''}>Transferência</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {tipo === 'requisicao'
          ? 'A origem precisa liberar antes de sair (ex.: Estoque Central).'
          : 'Quem manda já tem o material em mãos — só o destino confirma recebimento.'}
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
        <div style={{ flex: 1 }}>
          <label className="muted">De (origem)</label>
          <select value={origemId} onChange={(e) => setOrigemId(e.target.value)}>
            <option value="">Selecione…</option>
            {locais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </div>
        <button type="button" className="ghost" onClick={inverter} title="Inverter" style={{ flexShrink: 0 }}><Icon nome="arrows-exchange" tamanho={18} /></button>
        <div style={{ flex: 1 }}>
          <label className="muted">Para (destino)</label>
          <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
            <option value="">Selecione…</option>
            {locais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </div>
      </div>

      <BuscaProduto onSelecionar={setProduto} mostrarCamera={false} />
      {produto && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <p style={{ margin: 0, fontWeight: 500 }}>{produto.nome}</p>
          <button type="button" className="ghost" onClick={() => setProduto(null)}>trocar</button>
        </div>
      )}
      {produto && (
        <div>
          <label className="muted">Quantidade ({produto.unidade_medida})</label>
          <input type="number" min="0" step="0.001" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          {disponivel != null && <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>Saldo calculado na origem: {fmt(disponivel)} {produto.unidade_medida}</p>}
        </div>
      )}

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}

      <button
        className="primary"
        onClick={enviar}
        disabled={salvando || !origemId || !destinoId || !produto || !(qtd > 0)}
        style={{ width: '100%' }}
      >
        {salvando ? 'Enviando…' : 'Enviar'}
      </button>

      {concluido && (
        <Modal onFechar={onSair} largura={340}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>
              {tipo === 'requisicao' ? 'Requisição enviada com sucesso!' : 'Transferência enviada com sucesso!'}
            </p>
            <p className="muted" style={{ margin: 0 }}>{concluido}</p>
            <p style={{ margin: 0 }}>Quer fazer outra requisição/transferência?</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onSair} style={{ flex: 1 }}>Não, fechar</button>
              <button className="primary" onClick={fazerOutra} style={{ flex: 1 }}>Sim, fazer outra</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Pendentes({ pendentesReq, pendentesTransf, usuario, usuarioLogado, onMudou, onErro }) {
  const [atendendoId, setAtendendoId] = useState(null)
  const [qtdAtender, setQtdAtender] = useState('')
  const [processando, setProcessando] = useState(false)
  const podeAtender = podeAtenderRequisicao(usuarioLogado)

  async function atender(req) {
    setProcessando(true)
    try {
      const restante = Number(req.quantidade_solicitada) - Number(req.quantidade_atendida || 0)
      const qtd = qtdAtender ? Number(String(qtdAtender).replace(',', '.')) : restante
      await atenderRequisicao(req.id, { quantidadeAtendidaAgora: qtd, usuario })
      setAtendendoId(null); setQtdAtender('')
      await onMudou()
    } catch (e) {
      onErro('Não consegui atender — ' + e.message)
    } finally {
      setProcessando(false)
    }
  }

  async function confirmarRecebimento(t) {
    setProcessando(true)
    try {
      await confirmarRecebimentoTransferencia(t.id, usuario)
      await onMudou()
    } catch (e) {
      onErro('Não consegui confirmar — ' + e.message)
    } finally {
      setProcessando(false)
    }
  }

  // Pedido do Felipe (08/10/2026): duas seções mostrando "Nada pendente." repetido era sem
  // sentido — só aparece o que de fato tem alguma coisa; se não tiver nada em lugar nenhum, UMA
  // mensagem só.
  if (pendentesReq.length === 0 && pendentesTransf.length === 0) {
    return <p className="muted">Nada pendente no momento.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {pendentesReq.length > 0 && (
        <div>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Requisições aguardando atendimento</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendentesReq.map((r) => {
              const restante = Number(r.quantidade_solicitada) - Number(r.quantidade_atendida || 0)
              return (
                <div key={r.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p style={{ margin: 0 }}>
                    <strong>{r.solicitante?.nome}</strong> pediu {fmt(r.quantidade_solicitada)} de {r.codigo_everest}
                    {Number(r.quantidade_atendida || 0) > 0 && ` (já atendido ${fmt(r.quantidade_atendida)}, falta ${fmt(restante)})`}
                    {' '}— atender via <strong>{r.atendente?.nome}</strong>
                  </p>
                  {!podeAtender ? (
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>Só estoquista, administrativo ou dev podem atender.</p>
                  ) : atendendoId === r.id ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="number" min="0" step="0.001" value={qtdAtender} onChange={(e) => setQtdAtender(e.target.value)} style={{ flex: 1 }} />
                      <button className="primary" onClick={() => atender(r)} disabled={processando}>Confirmar</button>
                      <button className="ghost" onClick={() => { setAtendendoId(null); setQtdAtender('') }}>Cancelar</button>
                    </div>
                  ) : (
                    <button className="primary" onClick={() => { setAtendendoId(r.id); setQtdAtender(String(restante)) }}>Atender</button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {pendentesTransf.length > 0 && (
        <div>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Transferências aguardando recebimento</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendentesTransf.map((t) => (
              <div key={t.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <p style={{ margin: 0 }}>{fmt(t.quantidade)} de {t.codigo_everest} · {t.origem?.nome} → {t.destino?.nome}</p>
                <button className="primary" onClick={() => confirmarRecebimento(t)} disabled={processando}>Recebi</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

