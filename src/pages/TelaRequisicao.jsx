import { useCallback, useEffect, useState } from 'react'
import BuscaProduto from '../components/BuscaProduto'
import Topbar from '../components/Topbar'
import Modal from '../components/Modal'
import ContextoLancamento from '../components/ContextoLancamento'
import { listarLocaisEstoque } from '../lib/locaisEstoqueApi'
import { buscarSaldoCalculado } from '../lib/estoqueMovimentosApi'
import { podeAtenderRequisicao } from '../lib/permissoes'
import { buscarConfiguracao } from '../lib/configuracoesApi'
import {
  listarRequisicoesPendentes,
  listarRequisicoesAguardandoConfirmacao,
  criarRequisicao,
  atenderRequisicao,
  confirmarRecebimentoRequisicao,
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

function hojeFormatado() {
  return new Date().toLocaleDateString('pt-BR')
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
  const [aguardandoConfirmacao, setAguardandoConfirmacao] = useState([])
  // Interruptor (Admin → Configurações do sistema, migration_v31.sql) — desligado por padrão;
  // enquanto estiver desligado, nada muda em como a tela se comporta hoje. O lado da Requisição
  // não precisa de um interruptor próprio aqui: o comportamento já é decidido no servidor
  // (atenderRequisicao) e reflete sozinho — se o interruptor tiver ligado, a rodada aparece em
  // `aguardandoConfirmacao`; se não, nunca aparece nada ali.
  const [exigeConfirmacaoTransferencia, setExigeConfirmacaoTransferencia] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    try {
      const [f, pr, pt, ac, ect] = await Promise.all([
        listarLocaisEstoque(), listarRequisicoesPendentes(), listarTransferenciasPendentes(),
        listarRequisicoesAguardandoConfirmacao(),
        buscarConfiguracao('transferencia_exige_confirmacao_quantidade')
      ])
      setLocais(f); setPendentesReq(pr); setPendentesTransf(pt); setAguardandoConfirmacao(ac)
      setExigeConfirmacaoTransferencia(!!ect)
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
              aguardandoConfirmacao={aguardandoConfirmacao}
              exigeConfirmacaoTransferencia={exigeConfirmacaoTransferencia}
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
  // Pedido do Felipe (12/10/2026, migration_v31.sql): quem manda numa transferência já sabe pra
  // quem está mandando — só mapeamento, não trava nada (fica vazio se não quiser preencher).
  const [destinatarioEsperado, setDestinatarioEsperado] = useState('')
  const [produto, setProduto] = useState(null)
  const [quantidade, setQuantidade] = useState('')
  const [disponivel, setDisponivel] = useState(null)
  const [salvando, setSalvando] = useState(false)
  // Pedido do Felipe (08/10/2026, "eu quero que apareça TODA a informação no cabeçalho" — circulou
  // o cartão de Perdas inteiro): Requisição também usa o cartão padrão agora. Como ela mexe em DOIS
  // locais (não um Setor só), origem/destino entram no lugar de Setor, e trocar cada um abre um
  // popup simples (sem confirmação de 2 passos — nada foi salvo ainda, é só o rascunho do formulário).
  const [trocandoOrigem, setTrocandoOrigem] = useState(false)
  const [trocandoDestino, setTrocandoDestino] = useState(false)
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
          codigoEverest: produto.codigo_everest, quantidade: qtd, usuario,
          destinatarioEsperado
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
    setDestinatarioEsperado('')
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

      <ContextoLancamento
        origem={locais.find((l) => l.id === origemId)?.nome || 'sem setor'}
        destino={locais.find((l) => l.id === destinoId)?.nome || 'sem setor'}
        data={hojeFormatado()}
        usuario={usuario}
        onTrocarOrigem={() => setTrocandoOrigem(true)}
        onTrocarDestino={() => setTrocandoDestino(true)}
        onInverter={inverter}
      />

      {trocandoOrigem && (
        <PopupEscolherLocal
          titulo="Trocar origem (De)"
          locais={locais}
          valorId={origemId}
          onFechar={() => setTrocandoOrigem(false)}
          onConfirmar={(id) => { setOrigemId(id); setTrocandoOrigem(false) }}
        />
      )}
      {trocandoDestino && (
        <PopupEscolherLocal
          titulo="Trocar destino (Para)"
          locais={locais}
          valorId={destinoId}
          onFechar={() => setTrocandoDestino(false)}
          onConfirmar={(id) => { setDestinoId(id); setTrocandoDestino(false) }}
        />
      )}

      {tipo === 'transferencia' && (
        <div>
          <label className="muted">Quem vai receber — opcional</label>
          <input
            value={destinatarioEsperado}
            onChange={(e) => setDestinatarioEsperado(e.target.value)}
            placeholder="Nome de quem vai receber"
          />
        </div>
      )}

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

// Popup simples de 1 passo (sem confirmação extra) — trocar origem/destino aqui é só rascunho do
// formulário, nada foi salvo ainda (diferente do TrocarLocalModal de Perdas/Produção/Recebimento,
// que troca o Setor de uma sessão JÁ aberta e por isso pede confirmação em 2 passos).
function PopupEscolherLocal({ titulo, locais, valorId, onFechar, onConfirmar }) {
  const [id, setId] = useState(valorId || '')
  return (
    <Modal onFechar={onFechar} largura={320}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>{titulo}</p>
        <select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Selecione…</option>
          {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onFechar} style={{ flex: 1 }}>Cancelar</button>
          <button className="primary" onClick={() => onConfirmar(id)} disabled={!id} style={{ flex: 1 }}>Confirmar</button>
        </div>
      </div>
    </Modal>
  )
}

function Pendentes({ pendentesReq, pendentesTransf, aguardandoConfirmacao, exigeConfirmacaoTransferencia, usuario, usuarioLogado, onMudou, onErro }) {
  const [atendendoId, setAtendendoId] = useState(null)
  const [qtdAtender, setQtdAtender] = useState('')
  const [destinatarioAtender, setDestinatarioAtender] = useState('')
  const [recebendoId, setRecebendoId] = useState(null)
  const [qtdRecebida, setQtdRecebida] = useState('')
  const [confirmandoId, setConfirmandoId] = useState(null)
  const [qtdConfirmada, setQtdConfirmada] = useState('')
  const [processando, setProcessando] = useState(false)
  const podeAtender = podeAtenderRequisicao(usuarioLogado)

  async function atender(req) {
    setProcessando(true)
    try {
      const restante = Number(req.quantidade_solicitada) - Number(req.quantidade_atendida || 0)
      const qtd = qtdAtender ? Number(String(qtdAtender).replace(',', '.')) : restante
      await atenderRequisicao(req.id, { quantidadeAtendidaAgora: qtd, usuario, destinatarioEsperado: destinatarioAtender })
      setAtendendoId(null); setQtdAtender(''); setDestinatarioAtender('')
      await onMudou()
    } catch (e) {
      onErro('Não consegui atender — ' + e.message)
    } finally {
      setProcessando(false)
    }
  }

  // Sem o interruptor ligado (padrão hoje), continua exatamente como sempre foi — um toque, sem
  // contar nada.
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

  // Com `transferencia_exige_confirmacao_quantidade` ligado (migration_v31.sql): quem recebe conta
  // e digita a PRÓPRIA quantidade — pré-preenchida com o que foi enviado, mas editável. Se
  // divergir, fica registrado nos dois movimentos (saída com o valor de quem mandou, entrada com
  // o valor confirmado aqui) — nenhum sobrescreve o outro.
  async function confirmarRecebimentoComContagem(t) {
    setProcessando(true)
    try {
      const qtd = qtdRecebida === '' ? Number(t.quantidade) : Number(String(qtdRecebida).replace(',', '.'))
      await confirmarRecebimentoTransferencia(t.id, usuario, qtd)
      setRecebendoId(null); setQtdRecebida('')
      await onMudou()
    } catch (e) {
      onErro('Não consegui confirmar — ' + e.message)
    } finally {
      setProcessando(false)
    }
  }

  async function confirmarRequisicao(req) {
    setProcessando(true)
    try {
      const qtd = qtdConfirmada === '' ? Number(req.quantidade_atendida_pendente) : Number(String(qtdConfirmada).replace(',', '.'))
      await confirmarRecebimentoRequisicao(req.id, { quantidadeConfirmada: qtd, usuario })
      setConfirmandoId(null); setQtdConfirmada('')
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
  if (pendentesReq.length === 0 && pendentesTransf.length === 0 && aguardandoConfirmacao.length === 0) {
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input type="number" min="0" step="0.001" value={qtdAtender} onChange={(e) => setQtdAtender(e.target.value)} placeholder="Quantidade" />
                      <input value={destinatarioAtender} onChange={(e) => setDestinatarioAtender(e.target.value)} placeholder="Quem vai buscar — opcional" />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="primary" onClick={() => atender(r)} disabled={processando} style={{ flex: 1 }}>Confirmar</button>
                        <button className="ghost" onClick={() => { setAtendendoId(null); setQtdAtender(''); setDestinatarioAtender('') }}>Cancelar</button>
                      </div>
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
              <div key={t.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0 }}>
                  {fmt(t.quantidade)} de {t.codigo_everest} · {t.origem?.nome} → {t.destino?.nome}
                  {t.destinatario_esperado && <span className="muted"> · destinatário: {t.destinatario_esperado}</span>}
                </p>
                {!exigeConfirmacaoTransferencia ? (
                  <button className="primary" onClick={() => confirmarRecebimento(t)} disabled={processando}>Recebi</button>
                ) : recebendoId === t.id ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="number" min="0" step="0.001" value={qtdRecebida}
                      onChange={(e) => setQtdRecebida(e.target.value)} placeholder={String(t.quantidade)}
                      style={{ flex: 1 }}
                    />
                    <button className="primary" onClick={() => confirmarRecebimentoComContagem(t)} disabled={processando}>Confirmar</button>
                    <button className="ghost" onClick={() => { setRecebendoId(null); setQtdRecebida('') }}>Cancelar</button>
                  </div>
                ) : (
                  <button className="primary" onClick={() => { setRecebendoId(t.id); setQtdRecebida(String(t.quantidade)) }}>
                    Conferir e confirmar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {aguardandoConfirmacao.length > 0 && (
        <div>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Requisições aguardando sua confirmação</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {aguardandoConfirmacao.map((r) => (
              <div key={r.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0 }}>
                  <strong>{r.atendente?.nome}</strong> disse que liberou {fmt(r.quantidade_atendida_pendente)} de {r.codigo_everest} pra <strong>{r.solicitante?.nome}</strong>
                  {r.destinatario_esperado && <span className="muted"> · destinatário: {r.destinatario_esperado}</span>}
                </p>
                {confirmandoId === r.id ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="number" min="0" step="0.001" value={qtdConfirmada}
                      onChange={(e) => setQtdConfirmada(e.target.value)} placeholder={String(r.quantidade_atendida_pendente)}
                      style={{ flex: 1 }}
                    />
                    <button className="primary" onClick={() => confirmarRequisicao(r)} disabled={processando}>Confirmar</button>
                    <button className="ghost" onClick={() => { setConfirmandoId(null); setQtdConfirmada('') }}>Cancelar</button>
                  </div>
                ) : (
                  <button className="primary" onClick={() => { setConfirmandoId(r.id); setQtdConfirmada(String(r.quantidade_atendida_pendente)) }}>
                    Conferir e confirmar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

