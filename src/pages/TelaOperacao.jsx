import { useEffect, useState } from 'react'
import Topbar from '../components/Topbar'
import BuscaProduto from '../components/BuscaProduto'
import { listarLocaisEstoque } from '../lib/locaisEstoqueApi'
import {
  buscarTurnoAberto, turnoVencido, periodoDoTurno, LABEL_PERIODO,
  abrirTurno, fecharTurno, buscarUltimoFechamento, fecharTurnoComContagem
} from '../lib/turnosApi'
import { listarSaldosCalculados } from '../lib/estoqueMovimentosApi'
import { buscarProdutosPorCodigosEverest } from '../lib/api'
import { useRotulos } from '../lib/RotulosContext'

// Abrir/Fechar praça (07/10/2026, pedido do Felipe — rodada 2: "tipo caixa", depois simplificado
// pra "clica, escolhe o local (se não tiver vínculo fixo), confirma, e só DEPOIS pergunta se quer
// movimentar item — se sim, abre Requisição/Transferência; se não, só fecha o popup").
//
// Quem tem `local_estoque_padrao_id` vinculado (ver migration_v24.sql, Admin → Usuários) nem vê
// seletor de praça — só abre/fecha a dela. Quem não tem (gerente, por exemplo) escolhe livremente,
// igual antes.
//
// Abrir/fechar em si não pede item nenhum (isso é SEPARADO, pergunta depois) — só cria/encerra o
// turno. `abrirTurno`/`fecharTurno` aceitam lista de itens vazia de propósito (ver turnosApi.js).
//
// 12/10/2026 (pedido do Felipe, migration_v30.sql): Setor tipo "cozinha" (`tipo_operacao`, ver
// Admin → Lojas e Setores) ganha um fluxo PRÓPRIO — recebe porcionado todo dia e precisa devolver
// a sobra pra câmara à noite, mas sem CONTAR de verdade o saldo calculado só cresce, nunca reflete
// o consumo real do serviço. Pra esse tipo: Fechar pede uma contagem (pré-preenchida com o saldo
// calculado de hoje, editável) — ela ajusta o saldo pra realidade E devolve tudo pro Estoque.
// Abrir mostra o que foi fechado da última vez como sugestão (editável/com opção de adicionar) —
// "fechamento de ontem vira sugestão de abertura de hoje", sem nunca reabrir sozinho sem
// confirmação. Produção/Fixo (e quem não tem tipo definido) continuam exatamente como sempre.

function hojeHora(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TelaOperacao({ usuarioLogado, onSair, onAbrirRequisicao }) {
  const rotulos = useRotulos()
  const localFixoId = usuarioLogado?.localPadraoId || null
  const localFixoNome = usuarioLogado?.localPadraoNome || null

  const [locais, setLocais] = useState([])
  const [localEstoqueId, setLocalEstoqueId] = useState(localFixoId || '')
  const [turno, setTurno] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [acaoFeita, setAcaoFeita] = useState(null) // null | 'abriu' | 'fechou' — dispara a pergunta de movimentar
  // Fluxo de contagem (só Setor tipo 'cozinha') — null fora dele, ou { modo: 'abrir'|'fechar', itens }
  // enquanto a pessoa está contando.
  const [contagem, setContagem] = useState(null)
  const [preparandoContagem, setPreparandoContagem] = useState(false)

  useEffect(() => {
    listarLocaisEstoque().then(setLocais).catch((e) => setErro(e.message))
  }, [])

  useEffect(() => {
    if (!localEstoqueId) { setCarregando(false); return }
    let cancelado = false
    setCarregando(true)
    buscarTurnoAberto(localEstoqueId)
      .then((t) => { if (!cancelado) setTurno(t) })
      .catch((e) => { if (!cancelado) setErro(e.message) })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [localEstoqueId])

  const vencido = turno && turnoVencido(turno)
  const setorAtual = locais.find((l) => l.id === localEstoqueId)
  const nomeLocal = localFixoNome || setorAtual?.nome
  const ehCozinha = setorAtual?.tipo_operacao === 'cozinha'
  const estoqueId = locais.find((l) => l.nome.trim().toLowerCase() === 'estoque')?.id

  async function handleAbrir() {
    setErro('')
    setSalvando(true)
    try {
      await abrirTurno({ localEstoqueId, localOrigemId: null, itens: [], usuario: usuarioLogado?.nome })
      setAcaoFeita('abriu')
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleFechar() {
    setErro('')
    setSalvando(true)
    try {
      await fecharTurno({ turnoId: turno.id, localDestinoId: null, itens: [], usuario: usuarioLogado?.nome })
      setAcaoFeita('fechou')
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  // Abre a praça da Cozinha: busca o que foi contado no último fechamento (se tiver) e mostra como
  // sugestão de abertura, editável.
  async function prepararAberturaComContagem() {
    setErro('')
    setPreparandoContagem(true)
    try {
      const ultimo = await buscarUltimoFechamento(localEstoqueId)
      const itensSalvos = ultimo?.itens_fechamento || []
      const codigos = itensSalvos.map((i) => i.codigo_everest)
      const produtos = codigos.length ? await buscarProdutosPorCodigosEverest(codigos) : []
      const nomePorCodigo = Object.fromEntries(produtos.map((p) => [p.codigo_everest, p]))
      const itens = itensSalvos.map((i) => ({
        codigoEverest: i.codigo_everest,
        nome: nomePorCodigo[i.codigo_everest]?.nome || i.codigo_everest,
        unidadeMedida: nomePorCodigo[i.codigo_everest]?.unidade_medida || '',
        quantidade: String(i.quantidade)
      }))
      setContagem({ modo: 'abrir', itens })
    } catch (e) {
      setErro(e.message)
    } finally {
      setPreparandoContagem(false)
    }
  }

  // Fecha a praça da Cozinha: busca o saldo calculado de agora e mostra como ponto de partida da
  // contagem — a pessoa confere item a item o que tem de verdade, corrige o que estiver diferente.
  async function prepararFechamentoComContagem() {
    setErro('')
    setPreparandoContagem(true)
    try {
      const saldos = await listarSaldosCalculados(localEstoqueId)
      const comSaldo = saldos.filter((s) => Math.abs(Number(s.saldo)) > 0.001)
      const codigos = comSaldo.map((s) => s.codigo_everest)
      const produtos = codigos.length ? await buscarProdutosPorCodigosEverest(codigos) : []
      const nomePorCodigo = Object.fromEntries(produtos.map((p) => [p.codigo_everest, p]))
      const itens = comSaldo.map((s) => ({
        codigoEverest: s.codigo_everest,
        nome: nomePorCodigo[s.codigo_everest]?.nome || s.codigo_everest,
        unidadeMedida: nomePorCodigo[s.codigo_everest]?.unidade_medida || '',
        quantidade: String(s.saldo)
      }))
      setContagem({ modo: 'fechar', itens })
    } catch (e) {
      setErro(e.message)
    } finally {
      setPreparandoContagem(false)
    }
  }

  async function confirmarContagem(itensConfirmados) {
    setErro('')
    setSalvando(true)
    try {
      const itensParaApi = itensConfirmados.map((i) => ({ codigoEverest: i.codigoEverest, quantidade: Number(i.quantidade) || 0 }))
      if (contagem.modo === 'abrir') {
        await abrirTurno({ localEstoqueId, localOrigemId: estoqueId, itens: itensParaApi.filter((i) => i.quantidade > 0), usuario: usuarioLogado?.nome })
        setAcaoFeita('abriu')
      } else {
        await fecharTurnoComContagem({ turnoId: turno.id, localDestinoId: estoqueId, itensContados: itensParaApi, usuario: usuarioLogado?.nome })
        setAcaoFeita('fechou')
      }
      setContagem(null)
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  if (contagem) {
    return (
      <ContagemPraca
        titulo={contagem.modo === 'abrir' ? `Abrir a praça ${nomeLocal}` : `Fechar a praça ${nomeLocal}`}
        subtitulo={
          contagem.modo === 'abrir'
            ? (contagem.itens.length
                ? 'Isso foi devolvido no último fechamento — confirme, corrija ou adicione o que está levando agora.'
                : 'Nada sugerido ainda (primeira vez) — adicione o que está levando pra praça.')
            : 'Conte o que tem de verdade agora — ajusta o saldo e devolve tudo pro Estoque.'
        }
        itensIniciais={contagem.itens}
        erro={erro}
        salvando={salvando}
        textoBotao={contagem.modo === 'abrir' ? 'Confirmar abertura' : 'Confirmar fechamento'}
        onCancelar={() => setContagem(null)}
        onConfirmar={confirmarContagem}
      />
    )
  }

  return (
    <div className="screen">
      <Topbar titulo="Abrir/Fechar praça" onVoltar={onSair} />

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 12px' }}>{erro}</p>}

      {acaoFeita && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>
            {acaoFeita === 'abriu' ? `Praça ${nomeLocal} aberta.` : `Praça ${nomeLocal} fechada.`}
          </p>
          {ehCozinha ? (
            <>
              <p className="muted" style={{ margin: '0 0 16px', fontSize: 13 }}>
                {acaoFeita === 'abriu' ? 'Itens levados e saldo ajustado.' : 'Contagem registrada, saldo ajustado e devolvido pro Estoque.'}
              </p>
              <button className="primary" onClick={onSair} style={{ width: '100%' }}>Ok</button>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: '0 0 16px', fontSize: 13 }}>
                {acaoFeita === 'abriu' ? 'Vai levar algum item pra praça agora?' : 'Vai devolver algum item pro estoque agora?'}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onSair} style={{ flex: 1 }}>Não, obrigado</button>
                <button className="primary" onClick={onAbrirRequisicao} style={{ flex: 1 }}>Sim</button>
              </div>
            </>
          )}
        </div>
      )}

      {!acaoFeita && !localFixoId && (
        <div className="card" style={{ marginBottom: 16 }}>
          <label className="muted">{rotulos.setor}</label>
          <select value={localEstoqueId} onChange={(e) => setLocalEstoqueId(e.target.value)}>
            <option value="">Selecione…</option>
            {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </div>
      )}

      {!acaoFeita && localEstoqueId && carregando && <p className="muted">Carregando…</p>}

      {!acaoFeita && localEstoqueId && !carregando && !turno && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 16px', fontWeight: 600, fontSize: 15 }}>Abrir a praça {nomeLocal}?</p>
          {ehCozinha && (
            <p className="muted" style={{ margin: '0 0 16px', fontSize: 12 }}>
              Essa praça devolve contagem no fechamento — a abertura vai sugerir o que foi devolvido ontem.
            </p>
          )}
          <button
            className="primary"
            onClick={ehCozinha ? prepararAberturaComContagem : handleAbrir}
            disabled={salvando || preparandoContagem || (ehCozinha && !estoqueId)}
            style={{ width: '100%' }}
          >
            {salvando || preparandoContagem ? 'Abrindo…' : 'Abrir praça'}
          </button>
          {ehCozinha && !estoqueId && (
            <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>
              Não achei o Setor "Estoque" cadastrado — confere em Admin → Lojas e Setores.
            </p>
          )}
        </div>
      )}

      {!acaoFeita && localEstoqueId && !carregando && turno && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Fechar a praça {nomeLocal}?</p>
          <p className="muted" style={{ margin: '0 0 16px', fontSize: 12.5 }}>
            Aberta {hojeHora(turno.aberto_em)} ({LABEL_PERIODO[periodoDoTurno(turno.aberto_em)]})
            {turno.aberto_por ? ` por ${turno.aberto_por}` : ''}.
            {vencido && ' Passou das 3h — feche pra liberar um turno novo.'}
          </p>
          {ehCozinha && (
            <p className="muted" style={{ margin: '0 0 16px', fontSize: 12 }}>
              Essa praça pede contagem pra fechar — ajusta o saldo e devolve tudo pro Estoque.
            </p>
          )}
          <button
            className="primary"
            onClick={ehCozinha ? prepararFechamentoComContagem : handleFechar}
            disabled={salvando || preparandoContagem || (ehCozinha && !estoqueId)}
            style={{ width: '100%' }}
          >
            {salvando || preparandoContagem ? 'Fechando…' : 'Fechar praça'}
          </button>
          {ehCozinha && !estoqueId && (
            <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>
              Não achei o Setor "Estoque" cadastrado — confere em Admin → Lojas e Setores.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// Tela de contagem (abertura sugerida ou fechamento) — Setor tipo 'cozinha'. Lista editável, com
// opção de adicionar item novo; confirmar manda tudo de uma vez pro turnosApi.js.
function ContagemPraca({ titulo, subtitulo, itensIniciais, erro, salvando, textoBotao, onCancelar, onConfirmar }) {
  const [itens, setItens] = useState(itensIniciais)
  const [adicionando, setAdicionando] = useState(false)

  function mudarQuantidade(codigoEverest, valor) {
    setItens((prev) => prev.map((i) => (i.codigoEverest === codigoEverest ? { ...i, quantidade: valor } : i)))
  }

  function remover(codigoEverest) {
    setItens((prev) => prev.filter((i) => i.codigoEverest !== codigoEverest))
  }

  function adicionar(produto) {
    setAdicionando(false)
    setItens((prev) => {
      if (prev.some((i) => i.codigoEverest === produto.codigo_everest)) return prev
      return [...prev, { codigoEverest: produto.codigo_everest, nome: produto.nome, unidadeMedida: produto.unidade_medida, quantidade: '' }]
    })
  }

  return (
    <div className="screen">
      <Topbar titulo={titulo} onVoltar={onCancelar} />

      <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>{subtitulo}</p>

      {itens.length === 0 && !adicionando && <p className="muted" style={{ marginBottom: 14 }}>Nenhum item ainda.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {itens.map((item) => (
          <div key={item.codigoEverest} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nome}</p>
              <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>{item.unidadeMedida}</p>
            </div>
            <input
              type="number" min="0" step="0.001" inputMode="decimal"
              value={item.quantidade}
              onChange={(e) => mudarQuantidade(item.codigoEverest, e.target.value)}
              style={{ width: 90, flexShrink: 0 }}
            />
            <button type="button" className="ghost" onClick={() => remover(item.codigoEverest)} style={{ flexShrink: 0, padding: '4px 8px', fontSize: 11.5 }}>
              remover
            </button>
          </div>
        ))}
      </div>

      {adicionando ? (
        <div style={{ marginBottom: 14 }}>
          <BuscaProduto onSelecionar={adicionar} mostrarCamera={false} />
          <button className="ghost" onClick={() => setAdicionando(false)} style={{ marginTop: 8 }}>Cancelar</button>
        </div>
      ) : (
        <button onClick={() => setAdicionando(true)} style={{ width: '100%', marginBottom: 14 }}>+ Adicionar item</button>
      )}

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 12px' }}>{erro}</p>}

      <button
        className="primary"
        onClick={() => onConfirmar(itens)}
        disabled={salvando || itens.some((i) => i.quantidade === '' || Number(i.quantidade) < 0)}
        style={{ width: '100%' }}
      >
        {salvando ? 'Salvando…' : textoBotao}
      </button>
    </div>
  )
}
