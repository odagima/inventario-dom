import { useEffect, useState } from 'react'
import IconTile from '../components/IconTile'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import RecebimentoForm from '../components/RecebimentoForm'
import SelecaoUnidade from './SelecaoUnidade'
import TelaContagem from './TelaContagem'
import TelaPerdas from './TelaPerdas'
import TelaProducao from './TelaProducao'
import TelaRequisicao from './TelaRequisicao'
import TelaOperacao from './TelaOperacao'
import { buscarTurnoAberto, turnoVencido } from '../lib/turnosApi'
import { podeVer } from '../lib/permissoes'

// Reformulada a pedido do Felipe (06/10/2026): os botões empilhados pareciam "um monte de
// funcionalidade jogada" — vira grade de ícones (ver IconTile.jsx/styles.css `.icon-tile`),
// ordenada pelo que é mais usado no dia a dia, sem dividir em blocos (testou agrupar por "operação
// do dia"/"produção e estoque"/retaguarda e não gostou da lógica).
//
// Perdas/Desperdícios subiu de dentro de Contagem pra cá (era "Registro de perdas/desperdício"
// dentro da lista de tipos) — entra direto na Contagem com o tipo já fixado (ver
// SelecaoUnidade.jsx `tipoFixo`), sem passar pela lista "o que você vai fazer".
//
// "Trocar usuário" (08/10/2026, 2ª rodada — "aquela parte da troca de usuário eu não gostei"):
// voltou a ser um botão de verdade no rodapé, escrito por extenso. O canto superior direito do
// cabeçalho (onde o pílula "Trocar" vivia) virou o indicador de praça aberta, abaixo.
//
// 07/10/2026 (pedido do Felipe): "transformar todos os botões em popup" — Contagem, Perdas,
// Produção, Requisição e Operação deixaram de navegar pra uma página própria (`App.jsx` não troca
// mais de `modo` pra eles) e abrem no MESMO popup pequeno do Recebimento de Mercadoria ("igual ao
// recebimento de mercadoria" — 1ª versão tinha feito uma camada de tela cheia separada, trocado
// por pedido dele). Ficou de fora Admin, Acompanhamento e Cadastro — "vamos mudar muita coisa,
// está sem graça": são telas de consulta/gestão, não lançamento rápido, continuam página cheia.
//
// 08/10/2026 (pedido do Felipe): grade reordenada por ORDEM DE USO (não mais alfabética — "Abrir/
// Requisição/Produção/Desperdício/Contagem e assim por diante"), e cada ícone só aparece se a
// pessoa tiver a permissão (`podeVer`, mesma regra do Admin — sem perfil vinculado, continua vendo
// tudo). A permissão hoje só distingue "lança" (`contagens.lancar`, cobre Contagem/Perdas/
// Produção/Requisição/Abrir praça/Recebimento — ainda é uma permissão só, o catálogo de perfis não
// tem uma por tela) de "só vê" (`contagens.ver`, o Painel de controle).
//
// 08/10/2026, 2ª rodada ("está tudo centralizado no meio... precisa ser adaptativo"): tirado o
// `justifyContent: center` do `.screen` — o conteúdo cresce a partir do topo, como as outras
// telas, em vez de flutuar no meio da tela com espaço vazio em volta.
export default function HomeScreen({ usuarioLogado, onEntrarProdutividade, onEntrarAcompanhamento, onAbrirCadastro, onAbrirAdmin, onSair }) {
  const nivel = usuarioLogado.nivelAcesso
  const podeCadastro = nivel === 'administrativo' || nivel === 'estoque_compras'
  const podeAdmin = nivel === 'administrativo'
  const [confirmandoTroca, setConfirmandoTroca] = useState(false)
  const [mostrandoRecebimento, setMostrandoRecebimento] = useState(false)
  const [erroRecebimento, setErroRecebimento] = useState('')

  const [telaAberta, setTelaAberta] = useState(null) // null | 'producao' | 'requisicao' | 'operacao'
  // true só quando vem do "Sim" de Abrir/Fechar praça (ver tiles.operacao abaixo) — cai direto no
  // formulário de nova requisição/transferência em vez de pousar em "Pendentes".
  const [requisicaoIniciarEmNova, setRequisicaoIniciarEmNova] = useState(false)

  // Bolinha do tile "Abrir/Fechar praça" (07/10/2026, pedido do Felipe) — só pra quem tem local
  // padrão vinculado (ver migration_v24.sql); sem vínculo, o tile fica neutro (escolhe livremente
  // dentro da tela, igual antes). `null` = sem turno aberto; truthy = aberto.
  const localFixoId = usuarioLogado?.localPadraoId || null
  const [turnoDoLocalFixo, setTurnoDoLocalFixo] = useState(null)

  function atualizarStatusPraca() {
    if (!localFixoId) return
    buscarTurnoAberto(localFixoId).then(setTurnoDoLocalFixo).catch(() => {})
  }
  useEffect(() => { atualizarStatusPraca() }, [localFixoId])

  function fecharOperacao() {
    setTelaAberta(null)
    atualizarStatusPraca()
  }

  // Contagem e Perdas são o mesmo fluxo por baixo (SelecaoUnidade decide a sessão, só o tipo
  // muda) — mesma lógica que já vivia em App.jsx antes de virar popup.
  const [contagemAberta, setContagemAberta] = useState(false)
  const [tipoFixoContagem, setTipoFixoContagem] = useState(null)
  const [contexto, setContexto] = useState(null)

  function abrirContagem(tipoFixo) {
    setTipoFixoContagem(tipoFixo)
    setContexto(null)
    setContagemAberta(true)
  }
  function fecharContagem() {
    setContagemAberta(false)
    setContexto(null)
    setTipoFixoContagem(null)
  }

  // Ordem de uso (não alfabética) — ver comentário no topo do arquivo.
  const tiles = [
    {
      key: 'operacao',
      icone: 'clock',
      cor: 'var(--dom-marinho)',
      label: !localFixoId ? 'Abrir/Fechar praça' : turnoDoLocalFixo ? `Fechar ${usuarioLogado.localPadraoNome}` : `Abrir ${usuarioLogado.localPadraoNome}`,
      bolinha: !localFixoId ? null : turnoDoLocalFixo ? (turnoVencido(turnoDoLocalFixo) ? 'var(--warning)' : 'var(--danger)') : 'var(--success)',
      onClick: () => setTelaAberta('operacao'),
      visivel: podeVer(usuarioLogado, 'contagens.lancar')
    },
    {
      key: 'requisicao',
      icone: 'arrows-exchange',
      cor: 'var(--dom-marinho)',
      label: 'Requisição / Transferência',
      onClick: () => { setRequisicaoIniciarEmNova(false); setTelaAberta('requisicao') },
      visivel: podeVer(usuarioLogado, 'contagens.lancar')
    },
    {
      key: 'producao',
      icone: 'chef-hat',
      cor: 'var(--dom-laranja)',
      label: 'Produção',
      onClick: () => setTelaAberta('producao'),
      visivel: podeVer(usuarioLogado, 'contagens.lancar')
    },
    {
      key: 'perdas',
      icone: 'trash',
      cor: 'var(--danger)',
      label: 'Perdas / Desperdícios',
      onClick: () => abrirContagem('perdas'),
      visivel: podeVer(usuarioLogado, 'contagens.lancar')
    },
    {
      key: 'contagem',
      icone: 'clipboard-list',
      cor: 'var(--dom-musgo)',
      label: 'Contagem',
      onClick: () => abrirContagem(null),
      visivel: podeVer(usuarioLogado, 'contagens.lancar')
    },
    {
      key: 'recebimento',
      icone: 'package',
      cor: 'var(--dom-laranja)',
      label: 'Recebimento de Mercadoria',
      onClick: () => { setErroRecebimento(''); setMostrandoRecebimento(true) },
      visivel: podeVer(usuarioLogado, 'contagens.lancar')
    },
    {
      key: 'acompanhamento',
      icone: 'activity',
      cor: 'var(--dom-musgo)',
      label: 'Painel de Controle',
      onClick: onEntrarAcompanhamento,
      visivel: podeVer(usuarioLogado, 'contagens.ver')
    },
    // Produtividade ocultada a pedido do Felipe (02/10/2026) — "não vamos usar isso por agora".
    // onEntrarProdutividade continua recebido pra não quebrar o App.jsx; é só reativar aqui quando
    // for retomado.
    {
      key: 'cadastros',
      icone: 'database',
      cor: 'var(--dom-cinza)',
      label: 'Cadastros',
      onClick: onAbrirCadastro,
      visivel: podeCadastro
    },
    {
      key: 'admin',
      icone: 'settings',
      cor: 'var(--dom-cinza)',
      label: 'Administrativo',
      onClick: onAbrirAdmin,
      visivel: podeAdmin
    }
  ]

  return (
    <div className="screen">
      <div className="app-header" style={{ position: 'relative', textAlign: 'center' }}>
        {localFixoId && turnoDoLocalFixo && (
          <span
            style={{
              position: 'absolute', top: 0, right: 0, display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.14)', color: 'var(--header-text)',
              borderRadius: 20, padding: '7px 12px', fontSize: 12.5, fontWeight: 500
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: turnoVencido(turnoDoLocalFixo) ? 'var(--warning)' : 'var(--success)'
            }} />
            {usuarioLogado.localPadraoNome} aberta
          </span>
        )}
        <p className="brand">Grupo DOM</p>
        <p className="subtitle">Olá, {usuarioLogado.nome}</p>
      </div>

      <div className="icon-grid">
        {tiles.filter((t) => t.visivel).map((t) => (
          <IconTile key={t.key} icone={t.icone} cor={t.cor} label={t.label} bolinha={t.bolinha} onClick={t.onClick} />
        ))}
      </div>

      <button
        onClick={() => setConfirmandoTroca(true)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', marginTop: 18 }}
      >
        <Icon nome="user" tamanho={16} />
        Trocar usuário
      </button>

      {confirmandoTroca && (
        <Modal onFechar={() => setConfirmandoTroca(false)} largura={300}>
          <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 15 }}>Trocar usuário?</p>
          <p className="muted" style={{ margin: '0 0 16px', fontSize: 13 }}>Você sai da sua sessão atual.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmandoTroca(false)} style={{ flex: 1 }}>Cancelar</button>
            <button className="primary" onClick={onSair} style={{ flex: 1 }}>Trocar</button>
          </div>
        </Modal>
      )}

      {mostrandoRecebimento && (
        <Modal onFechar={() => setMostrandoRecebimento(false)} largura={440}>
          <RecebimentoForm
            usuario={usuarioLogado?.nome}
            localPadraoId={usuarioLogado?.localPadraoId}
            onPronto={() => setMostrandoRecebimento(false)}
            onErro={setErroRecebimento}
            onSair={() => setMostrandoRecebimento(false)}
          />
          {erroRecebimento && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{erroRecebimento}</p>}
        </Modal>
      )}

      {telaAberta === 'producao' && (
        <Modal onFechar={() => setTelaAberta(null)} largura={440}>
          <TelaProducao usuarioLogado={usuarioLogado} onSair={() => setTelaAberta(null)} />
        </Modal>
      )}
      {telaAberta === 'requisicao' && (
        <Modal onFechar={() => setTelaAberta(null)} largura={440}>
          <TelaRequisicao usuarioLogado={usuarioLogado} onSair={() => setTelaAberta(null)} iniciarEmNova={requisicaoIniciarEmNova} />
        </Modal>
      )}
      {telaAberta === 'operacao' && (
        <Modal onFechar={fecharOperacao} largura={440}>
          <TelaOperacao
            usuarioLogado={usuarioLogado}
            onSair={fecharOperacao}
            onAbrirRequisicao={() => { setRequisicaoIniciarEmNova(true); setTelaAberta('requisicao') }}
          />
        </Modal>
      )}

      {contagemAberta && (
        <Modal onFechar={fecharContagem} largura={440}>
          {!contexto ? (
            <SelecaoUnidade usuarioLogado={usuarioLogado} tipoFixo={tipoFixoContagem} onSessaoPronta={setContexto} onVoltar={fecharContagem} />
          ) : contexto.sessao?.tipo === 'perdas' ? (
            <TelaPerdas sessao={contexto.sessao} unidade={contexto.unidade} local={contexto.local} usuarioLogado={usuarioLogado} onFinalizar={fecharContagem} onSair={fecharContagem} />
          ) : (
            <TelaContagem sessao={contexto.sessao} unidade={contexto.unidade} grupo={contexto.grupo} usuarioLogado={usuarioLogado} onFinalizar={fecharContagem} onSair={fecharContagem} />
          )}
        </Modal>
      )}
    </div>
  )
}
