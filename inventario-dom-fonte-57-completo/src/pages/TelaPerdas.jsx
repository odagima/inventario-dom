import { useCallback, useEffect, useState } from 'react'
import BuscaProdutoPerda from '../components/BuscaProdutoPerda'
import { MOTIVOS_PERDA, CATEGORIAS_PERDA, LABEL_MOTIVO_PERDA, LABEL_TURNO } from '../lib/perdas'
import {
  registrarItemContagem,
  listarItensDaSessao,
  removerItemContagem,
  finalizarSessao,
  excluirSessao,
  atualizarDataETurnoSessao
} from '../lib/api'

// Tela separada da TelaContagem de propósito. A contagem é "quanto tem no estoque" e traz junto
// câmera, código de barras, itens esperados, detecção de duplicado e barra de progresso — nada
// disso faz sentido aqui.
//
// Fluxo (28/08/2026, revisto com o Felipe): motivo → categoria → item → quantidade → envia →
// volta ao topo. O motivo vem primeiro porque ele é o que a pessoa sabe de cara ("estragou",
// "sobrou", "errei"); a categoria logo depois funciona como pré-filtro da busca, que sem ela
// devolve o catálogo inteiro. Na 1ª versão a ordem era item → motivo, com o caso "prato inteiro"
// atrás de um botão à parte — com o motivo na frente, prato virou só mais uma categoria e o
// caminho paralelo deixou de existir.

const INTERVALO_ATUALIZACAO_MS = 20000

function formatarQtd(qtd, unidade) {
  const u = (unidade || '').toUpperCase()
  const n = Number(qtd)
  if (!isFinite(n)) return qtd
  if (u === 'KG' || u === 'L' || u === 'LT') return n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

export default function TelaPerdas({ sessao: sessaoInicial, unidade, usuarioLogado, onFinalizar, onSair }) {
  // Data e turno podem ser corrigidos aqui dentro, então a sessão vira estado local em vez de
  // prop lida direto — senão a tela continuaria mostrando os valores antigos depois de salvar.
  const [sessao, setSessao] = useState(sessaoInicial)
  const [editandoQuando, setEditandoQuando] = useState(false)
  const [dataEditada, setDataEditada] = useState(sessaoInicial.data_referencia || new Date().toISOString().slice(0, 10))
  const [turnoEditado, setTurnoEditado] = useState(sessaoInicial.turno || 'almoco')
  const [salvandoQuando, setSalvandoQuando] = useState(false)
  const [erroQuando, setErroQuando] = useState('')
  // 'lista' (topo do loop) | 'item' (categoria + busca) | 'quantidade'
  const [estado, setEstado] = useState('lista')
  const [produtoAtual, setProdutoAtual] = useState(null)
  const [motivo, setMotivo] = useState(null)
  const [categoria, setCategoria] = useState(CATEGORIAS_PERDA[0])
  const [quantidade, setQuantidade] = useState('')
  const [itens, setItens] = useState([])
  const [carregandoItens, setCarregandoItens] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [erroSalvar, setErroSalvar] = useState('')
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')

  const carregarItens = useCallback(async (silencioso = false) => {
    try {
      setItens(await listarItensDaSessao(sessao.id))
    } catch (e) {
      if (!silencioso) setErro('Não consegui atualizar a lista — confere sua internet. ' + e.message)
    } finally {
      setCarregandoItens(false)
    }
  }, [sessao.id])

  useEffect(() => { carregarItens() }, [carregarItens])

  useEffect(() => {
    const intervalo = setInterval(() => { if (estado === 'lista') carregarItens(true) }, INTERVALO_ATUALIZACAO_MS)
    return () => clearInterval(intervalo)
  }, [carregarItens, estado])

  function voltarAoTopo() {
    setProdutoAtual(null)
    setMotivo(null)
    setCategoria(CATEGORIAS_PERDA[0])
    setQuantidade('')
    setErroSalvar('')
    setEstado('lista')
  }

  function handleEscolherMotivo(valor) {
    setMotivo(valor)
    setCategoria(CATEGORIAS_PERDA[0])
    setEstado('item')
  }

  function handleSelecionarProduto(produto) {
    setProdutoAtual(produto)
    setQuantidade('')
    setEstado('quantidade')
  }

  // Prato é lançado por PORÇÕES (a explosão pelos insumos usa a ficha, na leitura); as outras
  // duas categorias, na unidade de estoque do próprio item.
  const lancandoPrato = categoria?.valor === 'prato'

  async function handleSalvar() {
    const n = Number(String(quantidade).replace(',', '.'))
    if (!(n > 0)) return
    setSalvando(true)
    setErroSalvar('')
    try {
      await registrarItemContagem({
        sessaoId: sessao.id,
        produtoId: produtoAtual.id,
        modoEntrada: 'direto',
        quantidade: n,
        usuario: usuarioLogado?.nome,
        motivoPerda: motivo,
        modoPerda: lancandoPrato ? 'prato' : 'peso'
      })
      await carregarItens()
      voltarAoTopo()
    } catch (e) {
      setErroSalvar('Não consegui salvar — ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleSalvarQuando() {
    setSalvandoQuando(true)
    setErroQuando('')
    try {
      await atualizarDataETurnoSessao(sessao.id, { dataReferencia: dataEditada, turno: turnoEditado })
      setSessao((prev) => ({ ...prev, data_referencia: dataEditada, turno: turnoEditado }))
      setEditandoQuando(false)
    } catch (e) {
      // Pode ser falha total ou parcial (data salva, turno não — migração pendente). Nos dois
      // casos recarrego o que a tela mostra a partir do que foi de fato pedido, e deixo o erro
      // visível em vez de fechar o editor como se tivesse dado tudo certo.
      setErroQuando(e.message)
      setSessao((prev) => ({ ...prev, data_referencia: dataEditada }))
    } finally {
      setSalvandoQuando(false)
    }
  }

  async function handleRemoverItem(itemId) {
    try {
      await removerItemContagem(itemId)
      await carregarItens()
    } catch (e) {
      setErro('Não consegui apagar — confere sua internet e tenta de novo. ' + e.message)
    }
  }

  async function handleFinalizarSessao() {
    setEnviando(true)
    setErroEnvio('')
    try {
      await finalizarSessao(sessao.id, usuarioLogado?.nome)
      setConfirmandoEnvio(false)
      setEnviado(true)
    } catch (e) {
      setErroEnvio('Não consegui enviar — confere sua internet e tenta de novo. Seus lançamentos continuam salvos. (' + e.message + ')')
    } finally {
      setEnviando(false)
    }
  }

  async function handleExcluirSessao() {
    setExcluindo(true)
    setErroExclusao('')
    try {
      await excluirSessao(sessao.id)
      setConfirmandoExclusao(false)
      onSair()
    } catch (e) {
      setErroExclusao('Não consegui excluir — confere sua internet e tenta de novo. (' + e.message + ')')
    } finally {
      setExcluindo(false)
    }
  }

  const contexto = [
    unidade?.nome,
    sessao.data_referencia ? sessao.data_referencia.split('-').reverse().join('/') : null,
    LABEL_TURNO[sessao.turno]
  ].filter(Boolean).join(' · ')

  if (enviado) {
    return (
      <div className="screen">
        <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(63,125,74,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 22, color: 'var(--success)' }}>✓</div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>Registro enviado</p>
          <p className="muted" style={{ margin: '4px 0 0' }}>{contexto} · {itens.length} {itens.length === 1 ? 'lançamento' : 'lançamentos'}</p>
        </div>
        <div className="card" style={{ maxHeight: 340, overflowY: 'auto', marginBottom: 20 }}>
          {itens.map((item) => (
            <div key={item.id} className="list-item">
              <span>{item.produtos?.nome}</span>
              <span className="muted">
                {formatarQtd(item.quantidade, item.modo_perda === 'prato' ? 'un' : item.produtos?.unidade_medida)}{' '}
                {item.modo_perda === 'prato' ? 'porções' : item.produtos?.unidade_medida}
              </span>
            </div>
          ))}
        </div>
        <button className="primary" onClick={onFinalizar} style={{ width: '100%' }}>Concluir</button>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span className="unidade" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {unidade?.nome || 'Perdas'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {onSair && (
                <button className="ghost" onClick={onSair} style={{ fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10 }}>
                  Voltar
                </button>
              )}
              <button className="ghost" onClick={() => setConfirmandoExclusao(true)} style={{ fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--danger)' }}>
                Excluir
              </button>
              <button className="ghost" onClick={() => setConfirmandoEnvio(true)} style={{ fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10 }}>
                Enviar
              </button>
            </div>
          </div>
          <p className="muted" style={{ margin: '2px 0 0' }}>
            registro de perdas · {contexto}
            {' '}
            <button
              className="ghost"
              onClick={() => {
                setDataEditada(sessao.data_referencia || new Date().toISOString().slice(0, 10))
                setTurnoEditado(sessao.turno || 'almoco')
                setErroQuando('')
                setEditandoQuando(true)
              }}
              style={{ padding: 0, background: 'none', border: 'none', textDecoration: 'underline', fontSize: 13, color: 'inherit', cursor: 'pointer' }}
            >
              alterar
            </button>
          </p>
        </div>
      </div>

      {/* Aviso permanente, não é um toast que some. §55: se o time achar que a perda já sai do
          estoque, vai contar errado depois — a contagem física continua sendo a contagem física. */}
      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          <strong>Isso não dá baixa no estoque.</strong>{' '}
          <span className="muted">
            É registro pra explicar a diferença do CMV. Continue contando o que estiver na praça, normalmente.
          </span>
        </p>
      </div>

      {editandoQuando && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Quando foi essa perda?</p>
          <div>
            <label className="muted">Data do ocorrido</label>
            <input type="date" value={dataEditada} onChange={(e) => setDataEditada(e.target.value)} />
          </div>
          <div>
            <label className="muted">Turno</label>
            <div className="segmented" style={{ marginTop: 4 }}>
              {Object.entries(LABEL_TURNO).map(([valor, label]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => setTurnoEditado(valor)}
                  className={turnoEditado === valor ? 'active' : ''}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Vale pra tudo que já foi lançado nessa sessão — os itens continuam onde estão.
          </p>
          {erroQuando && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erroQuando}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setEditandoQuando(false)} disabled={salvandoQuando} style={{ flex: 1 }}>Cancelar</button>
            <button className="primary" onClick={handleSalvarQuando} disabled={salvandoQuando} style={{ flex: 1 }}>
              {salvandoQuando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {confirmandoEnvio && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }} onClick={() => !enviando && setConfirmandoEnvio(false)}>
          <div className="card" style={{ maxWidth: 340, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 16 }}>Confirmar envio do registro?</p>
            <p className="muted" style={{ margin: '0 0 20px' }}>
              {contexto} · {itens.length} {itens.length === 1 ? 'lançamento' : 'lançamentos'}. Depois de enviado, o registro é encerrado.
            </p>
            {erroEnvio && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erroEnvio}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmandoEnvio(false)} disabled={enviando} style={{ flex: 1 }}>Cancelar</button>
              <button className="primary" onClick={handleFinalizarSessao} disabled={enviando} style={{ flex: 1 }}>
                {enviando ? 'Enviando…' : 'Confirmar envio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmandoExclusao && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }} onClick={() => !excluindo && setConfirmandoExclusao(false)}>
          <div className="card" style={{ maxWidth: 340, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 16 }}>Excluir esse registro?</p>
            <p className="muted" style={{ margin: '0 0 20px' }}>
              {contexto} · {itens.length} {itens.length === 1 ? 'lançamento' : 'lançamentos'}. Isso apaga tudo que foi lançado nesse turno — não dá pra desfazer.
            </p>
            {erroExclusao && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erroExclusao}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmandoExclusao(false)} disabled={excluindo} style={{ flex: 1 }}>Cancelar</button>
              <button onClick={handleExcluirSessao} disabled={excluindo} style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}>
                {excluindo ? 'Excluindo…' : 'Confirmar exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

      {estado === 'lista' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="muted">O que aconteceu?</label>
          {MOTIVOS_PERDA.map((m) => (
            <button
              key={m.valor}
              onClick={() => handleEscolherMotivo(m.valor)}
              style={{ textAlign: 'left', padding: '14px', background: 'var(--surface-2)', minHeight: 58 }}
            >
              <span style={{ display: 'block', fontWeight: 600 }}>{m.label}</span>
              <span className="muted" style={{ fontSize: 12 }}>{m.descricao}</span>
            </button>
          ))}
        </div>
      )}

      {estado === 'item' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>{LABEL_MOTIVO_PERDA[motivo]}</p>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>Agora escolha o tipo e busque o item.</p>
            </div>
            <button type="button" className="ghost" onClick={voltarAoTopo}>trocar</button>
          </div>

          {/* Pré-filtro da busca. Sem ele, digitar "filet" traz peça crua, PPs e pratos
              misturados — e a lista corta em 30 resultados, então o item certo pode nem aparecer. */}
          <div className="segmented">
            {CATEGORIAS_PERDA.map((c) => (
              <button
                key={c.valor}
                type="button"
                onClick={() => setCategoria(c)}
                className={categoria?.valor === c.valor ? 'active' : ''}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="muted" style={{ margin: '-6px 0 0', fontSize: 12 }}>{categoria?.descricao}</p>

          <BuscaProdutoPerda categoria={categoria} onSelecionar={handleSelecionarProduto} />

          <button className="ghost" onClick={voltarAoTopo} style={{ width: '100%' }}>Voltar</button>
        </div>
      )}

      {estado === 'quantidade' && produtoAtual && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 500 }}>{produtoAtual.nome}</p>
              <p className="muted" style={{ margin: 0 }}>
                {LABEL_MOTIVO_PERDA[motivo]} · {categoria?.label}
              </p>
            </div>
            <button type="button" className="ghost" onClick={() => setEstado('item')}>trocar</button>
          </div>

          <div>
            <label className="muted">
              {lancandoPrato ? 'Quantas porções foram perdidas' : `Quanto foi perdido (${produtoAtual.unidade_medida})`}
            </label>
            <input
              type="number"
              min="0"
              step={lancandoPrato ? '1' : '0.001'}
              inputMode="decimal"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              autoFocus
              name="perda-quantidade"
              autoComplete="off"
            />
          </div>

          {lancandoPrato && (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              A conversão pros insumos usa a ficha técnica do prato — não precisa calcular nada aqui.
            </p>
          )}

          {erroSalvar && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erroSalvar}</p>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={voltarAoTopo} disabled={salvando} style={{ flex: 1 }}>Cancelar</button>
            <button
              type="button"
              className="primary"
              onClick={handleSalvar}
              disabled={salvando || !(Number(String(quantidade).replace(',', '.')) > 0)}
              style={{ flex: 1 }}
            >
              {salvando ? 'Salvando…' : 'Enviar'}
            </button>
          </div>
        </div>
      )}

      {estado === 'lista' && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-2)', borderRadius: 12, padding: '12px 16px', marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Já lançado nesse turno</span>
            <span style={{ background: itens.length > 0 ? 'var(--accent)' : 'var(--surface-3)', color: '#fff', borderRadius: 20, padding: '3px 12px', fontSize: 13, fontWeight: 600 }}>
              {itens.length}
            </span>
          </div>

          {carregandoItens ? (
            <p className="muted">Carregando…</p>
          ) : itens.length === 0 ? (
            <p className="muted">Nada lançado nesse turno ainda.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 440, overflowY: 'auto', paddingBottom: 4 }}>
              {itens.map((item, i) => (
                <div key={item.id} className="card" style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12, flexShrink: 0, width: 18 }}>{i + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 14, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {item.produtos?.nome}
                      </p>
                      <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                        {LABEL_MOTIVO_PERDA[item.motivo_perda] || 'sem motivo'}
                        {item.modo_perda === 'prato' && ' · prato inteiro'}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ background: 'var(--accent-soft)', color: 'var(--accent-soft-text)', borderRadius: 999, padding: '5px 12px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {formatarQtd(item.quantidade, item.modo_perda === 'prato' ? 'un' : item.produtos?.unidade_medida)}{' '}
                      {item.modo_perda === 'prato' ? 'porções' : item.produtos?.unidade_medida}
                    </span>
                    <button onClick={() => handleRemoverItem(item.id)} style={{ padding: '9px 11px', fontSize: 16, color: 'var(--danger)' }} aria-label="Apagar lançamento">
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
