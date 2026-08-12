import { useCallback, useEffect, useRef, useState } from 'react'
import BuscaProduto from '../components/BuscaProduto'
import ScannerCodigoBarras from '../components/ScannerCodigoBarras'
import ConversaoQuantidade from '../components/ConversaoQuantidade'
import VincularProduto from '../components/VincularProduto'
import CadastroRapido from '../components/CadastroRapido'
import {
  buscarProdutoPorBarcode,
  cadastrarProdutoComBarcode,
  registrarItemContagem,
  atualizarItemContagem,
  listarItensDaSessao,
  listarEsperadosDaSessao,
  removerItemContagem,
  finalizarSessao,
  contarProgressoSessao,
  excluirSessao
} from '../lib/api'

const NOMES_TIPO = {
  mensal: 'inventário geral',
  semanal: 'contagem semanal',
  diario: 'contagem tempo de produção',
  producao: 'registro de produção',
  perdas: 'registro de perdas/desperdício',
  outros: 'outros',
  parcial: 'parcial'
}
const INTERVALO_ATUALIZACAO_MS = 20000 // atualiza a lista sozinho, útil quando mais de uma pessoa conta ao mesmo tempo

// KG e L exibem 3 casas decimais (0,000); demais unidades, formato pt-BR simples.
function formatarQtd(qtd, unidade) {
  const u = (unidade || '').toUpperCase()
  const n = Number(qtd)
  if (!isFinite(n)) return qtd
  if (u === 'KG' || u === 'L' || u === 'LT') return n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

export default function TelaContagem({ sessao, unidade, grupo, onFinalizar, onSair }) {
  const [estado, setEstado] = useState('buscando')
  const [codigoAtual, setCodigoAtual] = useState('')
  const [produtoAtual, setProdutoAtual] = useState(null)
  const [itemEditando, setItemEditando] = useState(null)
  const [itens, setItens] = useState([])
  const [carregandoItens, setCarregandoItens] = useState(true)
  const [progresso, setProgresso] = useState(null)
  const [esperados, setEsperados] = useState([])
  const [adicionando, setAdicionando] = useState(false)
  const [erro, setErro] = useState('')
  const [erroConversao, setErroConversao] = useState('')
  const [avisoJaLancado, setAvisoJaLancado] = useState(false)
  const [escolhaDuplicado, setEscolhaDuplicado] = useState(null) // { produto, existente }
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const estadoRef = useRef(estado)
  estadoRef.current = estado

  // Contagem semanal não tem loja (ver migration_v6.sql) — usa o nome do grupo de contagem no
  // lugar do nome da loja pra identificar a sessão na tela.
  const nomeContexto = unidade?.nome || grupo?.nome || (sessao.tipo === 'semanal' ? 'Contagem semanal' : 'Contagem')

  const carregarItens = useCallback(async (silencioso = false) => {
    try {
      const lista = await listarItensDaSessao(sessao.id)
      setItens(lista)
      if (sessao.tipo) {
        const p = await contarProgressoSessao(sessao.id)
        setProgresso(p)
      }
    } catch (e) {
      if (!silencioso) setErro('Não consegui atualizar a lista — confere sua internet. ' + e.message)
    } finally {
      setCarregandoItens(false)
    }
  }, [sessao.id, sessao.tipo])

  useEffect(() => { carregarItens() }, [carregarItens])

  useEffect(() => {
    if (sessao.tipo === 'semanal') {
      listarEsperadosDaSessao(sessao.id).then(setEsperados).catch(() => setEsperados([]))
    }
  }, [sessao.id, sessao.tipo])

  // Atualiza sozinho de tempos em tempos enquanto está na tela principal — importante quando
  // mais de uma pessoa está contando a mesma loja ao mesmo tempo.
  useEffect(() => {
    const intervalo = setInterval(() => {
      if (estadoRef.current === 'buscando') carregarItens(true)
    }, INTERVALO_ATUALIZACAO_MS)
    return () => clearInterval(intervalo)
  }, [carregarItens])

  function jaLancado(produtoId) {
    return itens.find((i) => i.produto_id === produtoId) || null
  }

  function handleSelecionarProduto(produto) {
    const existente = jaLancado(produto.id)
    if (existente) {
      setEscolhaDuplicado({ produto, existente })
      return
    }
    setProdutoAtual(produto)
    setCodigoAtual('')
    setItemEditando(null)
    setEstado('convertendo')
  }

  async function handleLeituraCamera(codigo) {
    setErro('')
    setCodigoAtual(codigo)
    try {
      const encontrado = await buscarProdutoPorBarcode(codigo)
      if (encontrado?.produtos) {
        const existente = jaLancado(encontrado.produtos.id)
        if (existente) {
          setEscolhaDuplicado({ produto: encontrado.produtos, existente })
          return
        }
        setProdutoAtual(encontrado.produtos)
        setItemEditando(null)
        setEstado('convertendo')
      } else {
        setEstado('vinculando')
      }
    } catch (e) {
      setErro('Não consegui verificar esse código — confere sua internet e tenta de novo. ' + e.message)
    }
  }

  function handleVinculado(produto) {
    const existente = jaLancado(produto.id)
    if (existente) {
      setEscolhaDuplicado({ produto, existente })
      return
    }
    setProdutoAtual(produto)
    setItemEditando(null)
    setEstado('convertendo')
  }

  function handleEscolherEditarExistente() {
    handleEditarItem(escolhaDuplicado.existente)
    setEscolhaDuplicado(null)
  }

  function handleEscolherLancarNovo() {
    setProdutoAtual(escolhaDuplicado.produto)
    setCodigoAtual('')
    setItemEditando(null)
    setAvisoJaLancado(true)
    setEstado('convertendo')
    setEscolhaDuplicado(null)
  }

  function handleEditarItem(item) {
    setProdutoAtual(item.produtos)
    setCodigoAtual(item.codigo_barras_usado || '')
    setItemEditando(item)
    setEstado('convertendo')
  }

  // Se der erro de rede aqui, a tela de conversão continua aberta com os valores digitados
  // intactos — a pessoa só tenta de novo, sem perder o que já preencheu.
  async function handleConfirmarQuantidade(dadosConversao) {
    setErroConversao('')
    try {
      if (itemEditando) {
        await atualizarItemContagem(itemEditando.id, dadosConversao)
      } else {
        await registrarItemContagem({
          sessaoId: sessao.id,
          produtoId: produtoAtual.id,
          codigoBarrasUsado: codigoAtual || null,
          ...dadosConversao
        })
      }
      await carregarItens()
      voltarParaBusca()
    } catch (e) {
      setErroConversao('Não consegui salvar — confere sua internet e toca em "Confirmar" de novo. Nada foi perdido. (' + e.message + ')')
      throw e // mantém a tela de conversão aberta (o componente filho não navega em caso de erro)
    }
  }

  async function handleSalvarCadastro(dados) {
    const produto = await cadastrarProdutoComBarcode(dados)
    setProdutoAtual(produto)
    setEstado('convertendo')
  }

  async function handleRemoverItem(itemId) {
    try {
      await removerItemContagem(itemId)
      await carregarItens()
    } catch (e) {
      setErro('Não consegui remover — confere sua internet e tenta de novo. ' + e.message)
    }
  }

  function voltarParaBusca() {
    setProdutoAtual(null)
    setCodigoAtual('')
    setItemEditando(null)
    setAvisoJaLancado(false)
    setErroConversao('')
    setAdicionando(false)
    setEstado('buscando')
  }

  async function handleFinalizarSessao() {
    setEnviando(true)
    setErroEnvio('')
    try {
      await finalizarSessao(sessao.id)
      setConfirmandoEnvio(false)
      setEnviado(true)
    } catch (e) {
      setErroEnvio('Não consegui enviar — confere sua internet e tenta de novo. Seus itens continuam salvos. (' + e.message + ')')
    } finally {
      setEnviando(false)
    }
  }

  // Apaga a sessão inteira (e todos os itens já lançados nela) — pra quem abriu a contagem
  // errada ou quer descartar tudo sem enviar. Diferente de "sair" (que só volta pra Home e deixa
  // a sessão em andamento, pra continuar depois).
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

  if (enviado) {
    return (
      <div className="screen">
        <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(63,125,74,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 22, color: 'var(--success)' }}>✓</div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>Contagem enviada</p>
          <p className="muted" style={{ margin: '4px 0 0' }}>{nomeContexto} · {itens.length} {itens.length === 1 ? 'item' : 'itens'}</p>
        </div>
        <p className="muted" style={{ marginBottom: 8 }}>Itens enviados</p>
        <div className="card" style={{ maxHeight: 340, overflowY: 'auto', marginBottom: 20 }}>
          {itens.map((item) => (
            <div key={item.id} className="list-item">
              <span>{item.produtos?.nome}</span>
              <span className="muted">{formatarQtd(item.quantidade, item.produtos?.unidade_medida)} {item.produtos?.unidade_medida}</span>
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
            <span className="unidade" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeContexto}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {onSair && (
                <button
                  className="ghost"
                  onClick={onSair}
                  style={{ fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10 }}
                >
                  Voltar
                </button>
              )}
              <button
                className="ghost"
                onClick={() => setConfirmandoExclusao(true)}
                style={{ fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10, color: 'var(--danger)' }}
              >
                Excluir
              </button>
              <button
                className="ghost"
                onClick={() => setConfirmandoEnvio(true)}
                style={{ fontSize: 13, fontWeight: 600, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10 }}
              >
                Enviar
              </button>
            </div>
          </div>
          <p className="muted" style={{ margin: '2px 0 8px' }}>
            {NOMES_TIPO[sessao.tipo] || sessao.tipo}
            {sessao.tipo === 'mensal' && sessao.mes_referencia && (
              <> · ref. {String(sessao.mes_referencia).padStart(2, '0')}/{sessao.ano_referencia}</>
            )}
          </p>
          {progresso && progresso.esperados > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--header-text-secondary)' }}>
                  <strong style={{ color: 'var(--header-text)' }}>{progresso.contados}</strong> de {progresso.esperados} itens
                </span>
                <span style={{ fontSize: 13, color: 'var(--header-text-secondary)' }}>
                  {Math.round((progresso.contados / progresso.esperados) * 100)}%
                </span>
              </div>
              {/* Track claro translúcido — essa barra fica dentro do cabeçalho marinho da Contagem. */}
              <div style={{ background: 'rgba(244,241,233,0.22)', borderRadius: 6, height: 6, overflow: 'hidden' }}>
                <div
                  style={{
                    background: 'linear-gradient(90deg, var(--accent), var(--accent-2))', height: '100%',
                    width: `${Math.min(100, Math.round((progresso.contados / progresso.esperados) * 100))}%`,
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmandoEnvio && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}
          onClick={() => !enviando && setConfirmandoEnvio(false)}
        >
          <div className="card" style={{ maxWidth: 340, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 16 }}>
              {sessao.tipo === 'perdas' ? 'Confirmar envio do registro?' : 'Confirmar envio?'}
            </p>
            <p className="muted" style={{ margin: '0 0 20px' }}>
              {nomeContexto} · {itens.length} {itens.length === 1 ? 'item' : 'itens'}
              {sessao.tipo === 'perdas' ? ' registrado(s) como perda/desperdício.' : ' lançado(s).'} Depois de enviada, {sessao.tipo === 'perdas' ? 'o registro é encerrado' : 'a contagem é encerrada'}.
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
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}
          onClick={() => !excluindo && setConfirmandoExclusao(false)}
        >
          <div className="card" style={{ maxWidth: 340, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 16 }}>Excluir essa contagem?</p>
            <p className="muted" style={{ margin: '0 0 20px' }}>
              {nomeContexto} · {itens.length} {itens.length === 1 ? 'item' : 'itens'} lançado(s). Isso apaga a sessão e tudo que já foi
              lançado nela — não dá pra desfazer.
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

      {escolhaDuplicado && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}
          onClick={() => setEscolhaDuplicado(null)}
        >
          <div className="card" style={{ maxWidth: 340, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 16 }}>Esse item já foi lançado</p>
            <p className="muted" style={{ margin: '0 0 20px' }}>
              {escolhaDuplicado.produto.nome} já tem {escolhaDuplicado.existente.quantidade} {escolhaDuplicado.produto.unidade_medida} lançado(s) nessa sessão. O que você quer fazer?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="primary" onClick={handleEscolherEditarExistente}>Editar o lançamento existente</button>
              <button onClick={handleEscolherLancarNovo}>Lançar como novo registro (linha separada)</button>
              <button className="ghost" onClick={() => setEscolhaDuplicado(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

      {estado === 'buscando' && (
        sessao.tipo === 'semanal' ? (
          adicionando ? (
            <div style={{ marginBottom: 16 }}>
              {esperados.length > 0 && (
                <>
                  <p className="muted" style={{ marginBottom: 8 }}>Itens do grupo · toque para lançar</p>
                  <div className="card" style={{ padding: 0, maxHeight: 260, overflowY: 'auto', marginBottom: 12 }}>
                    {esperados.map((p, i) => {
                      const lancado = itens.find((it) => it.produto_id === p.id)
                      return (
                        <button
                          key={p.id}
                          onClick={() => handleSelecionarProduto(p)}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                            width: '100%', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer',
                            padding: '12px 14px', borderBottom: i < esperados.length - 1 ? '1px solid var(--border)' : 'none'
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.nome} <span style={{ fontSize: 11, color: 'var(--accent)' }}>· grupo</span>
                          </span>
                          {lancado
                            ? <span style={{ color: 'var(--success)', flexShrink: 0 }}>{formatarQtd(lancado.quantidade, p.unidade_medida)} {p.unidade_medida} ✓</span>
                            : <span className="muted" style={{ flexShrink: 0 }}>{p.unidade_medida}</span>}
                        </button>
                      )
                    })}
                  </div>
                  <p className="muted" style={{ marginBottom: 8 }}>Ou busque outro item</p>
                </>
              )}
              <BuscaProduto onSelecionar={handleSelecionarProduto} onAbrirCamera={() => setEstado('camera')} />
              <button className="ghost" onClick={() => setAdicionando(false)} style={{ width: '100%', marginTop: 10 }}>Fechar</button>
            </div>
          ) : (
            <button className="primary" onClick={() => setAdicionando(true)} style={{ width: '100%', marginBottom: 8, minHeight: 50, fontSize: 16 }}>
              + Adicionar item
            </button>
          )
        ) : (
          <BuscaProduto onSelecionar={handleSelecionarProduto} onAbrirCamera={() => setEstado('camera')} />
        )
      )}

      {estado === 'camera' && (
        <div>
          <ScannerCodigoBarras ativo onLeitura={handleLeituraCamera} />
          <p className="muted" style={{ textAlign: 'center', marginTop: 10 }}>
            Aproxime bem do código (funciona de perto, principalmente em códigos pequenos). Se a imagem ficar borrada, afaste um pouquinho até focar — e use o zoom se aparecer.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
            <button onClick={voltarParaBusca}>Cancelar</button>
          </div>
        </div>
      )}

      {estado === 'convertendo' && produtoAtual && (
        <>
          {avisoJaLancado && (
            <p className="muted" style={{ color: 'var(--warning)', marginBottom: 10 }}>
              Esse item já estava lançado nessa sessão — ajuste a quantidade abaixo.
            </p>
          )}
          {erroConversao && (
            <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{erroConversao}</p>
          )}
          <ConversaoQuantidade
            produto={produtoAtual}
            onCancelar={voltarParaBusca}
            onConfirmar={handleConfirmarQuantidade}
            editando={!!itemEditando}
            onExcluir={itemEditando ? async () => { await handleRemoverItem(itemEditando.id); voltarParaBusca() } : undefined}
            valoresIniciais={
              itemEditando
                ? {
                    modoEntrada: itemEditando.modo_entrada,
                    qtdEmbalagens: itemEditando.qtd_embalagens,
                    pesoEmbalagem: itemEditando.peso_embalagem,
                    quantidade: itemEditando.quantidade
                  }
                : null
            }
          />
        </>
      )}

      {estado === 'vinculando' && (
        <VincularProduto
          codigoBarras={codigoAtual}
          onCancelar={voltarParaBusca}
          onVinculado={handleVinculado}
          onCadastrarNovo={() => setEstado('cadastrando')}
        />
      )}

      {estado === 'cadastrando' && (
        <CadastroRapido codigoBarras={codigoAtual} onCancelar={voltarParaBusca} onSalvar={handleSalvarCadastro} />
      )}

      {estado === 'buscando' && (
        <div style={{ marginTop: 24 }}>
          <div
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: 'var(--surface-2)', borderRadius: 12, padding: '12px 16px', marginBottom: 10
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {sessao.tipo === 'perdas' ? 'Itens registrados' : sessao.tipo === 'producao' ? 'Itens produzidos' : 'Itens lançados'}
            </span>
            <span
              style={{
                background: itens.length > 0 ? 'var(--accent)' : 'var(--surface-3)',
                color: '#fff', borderRadius: 20, padding: '3px 12px', fontSize: 13, fontWeight: 600
              }}
            >
              {itens.length}
            </span>
          </div>

          {carregandoItens ? (
            <p className="muted">Carregando…</p>
          ) : itens.length === 0 ? (
            <p className="muted">Nenhum item lançado ainda.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 440, overflowY: 'auto', paddingBottom: 4 }}>
              {itens.map((item, i) => (
                <div key={item.id} className="card" style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: 12, flexShrink: 0, width: 18 }}>{i + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <p
                        style={{
                          margin: 0, fontSize: 14, display: '-webkit-box',
                          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                        }}
                      >
                        {item.produtos?.nome}
                      </p>
                      {item.modo_entrada === 'embalagem' && (
                        <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                          {item.qtd_embalagens} emb. × {item.peso_embalagem}{item.produtos?.unidade_medida}
                        </p>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span
                      style={{
                        background: 'var(--accent-soft)', color: 'var(--accent-soft-text)', borderRadius: 999,
                        padding: '5px 12px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap'
                      }}
                    >
                      {formatarQtd(item.quantidade, item.produtos?.unidade_medida)} {item.produtos?.unidade_medida}
                    </span>
                    <button onClick={() => handleEditarItem(item)} style={{ padding: '9px 11px', fontSize: 14 }} aria-label="Editar item">
                      ✎
                    </button>
                    <button
                      onClick={() => handleRemoverItem(item.id)}
                      style={{ padding: '9px 11px', fontSize: 16, color: 'var(--danger)' }}
                      aria-label="Remover item"
                    >
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
