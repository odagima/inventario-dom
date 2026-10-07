import { useState } from 'react'
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

// Reformulada a pedido do Felipe (06/10/2026): os botões empilhados pareciam "um monte de
// funcionalidade jogada" — vira grade de ícones (ver IconTile.jsx/styles.css `.icon-tile`),
// ordenada pelo que é mais usado no dia a dia, sem dividir em blocos (testou agrupar por "operação
// do dia"/"produção e estoque"/retaguarda e não gostou da lógica).
//
// Perdas/Desperdícios subiu de dentro de Contagem pra cá (era "Registro de perdas/desperdício"
// dentro da lista de tipos) — entra direto na Contagem com o tipo já fixado (ver
// SelecaoUnidade.jsx `tipoFixo`), sem passar pela lista "o que você vai fazer".
//
// "Trocar usuário" saiu do rodapé e virou ícone no canto superior direito do cabeçalho — pede
// confirmação num popup (ver Modal.jsx) antes de sair, pra não trocar sem querer num toque perdido.
//
// 07/10/2026 (pedido do Felipe): "transformar todos os botões em popup" — Contagem, Perdas,
// Produção, Requisição e Operação deixaram de navegar pra uma página própria (`App.jsx` não troca
// mais de `modo` pra eles) e abrem no MESMO popup pequeno do Recebimento de Mercadoria ("igual ao
// recebimento de mercadoria" — 1ª versão tinha feito uma camada de tela cheia separada, trocado
// por pedido dele). Ficou de fora Admin, Acompanhamento e Cadastro — "vamos mudar muita coisa,
// está sem graça": são telas de consulta/gestão, não lançamento rápido, continuam página cheia.
export default function HomeScreen({ usuarioLogado, onEntrarProdutividade, onEntrarAcompanhamento, onAbrirCadastro, onAbrirAdmin, onSair }) {
  const nivel = usuarioLogado.nivelAcesso
  const podeCadastro = nivel === 'administrativo' || nivel === 'estoque_compras'
  const podeAdmin = nivel === 'administrativo'
  const [confirmandoTroca, setConfirmandoTroca] = useState(false)
  const [mostrandoRecebimento, setMostrandoRecebimento] = useState(false)
  const [erroRecebimento, setErroRecebimento] = useState('')

  const [telaAberta, setTelaAberta] = useState(null) // null | 'producao' | 'requisicao' | 'operacao'

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

  return (
    <div className="screen" style={{ justifyContent: 'center' }}>
      <div className="app-header" style={{ position: 'relative', textAlign: 'center' }}>
        {/* Ícone sozinho (sem rótulo) testou "pouco intuitivo" — virou pílula com texto, mesma
            cor/transparência do ícone circular das outras telas, só mais larga. */}
        <button
          onClick={() => setConfirmandoTroca(true)}
          style={{
            position: 'absolute', top: 0, right: 0, display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(255,255,255,0.14)', color: 'var(--header-text)', border: 'none',
            borderRadius: 20, padding: '7px 12px 7px 10px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer'
          }}
        >
          <Icon nome="user" tamanho={14} />
          Trocar
        </button>
        <p className="brand">Grupo DOM</p>
        <p className="subtitle">Olá, {usuarioLogado.nome}</p>
      </div>

      <div className="icon-grid">
        <IconTile icone="clock" cor="var(--dom-marinho)" label="Abrir/Fechar operação" onClick={() => setTelaAberta('operacao')} />
        <IconTile icone="activity" cor="var(--dom-musgo)" label="Acompanhamento" onClick={onEntrarAcompanhamento} />
        <IconTile icone="clipboard-list" cor="var(--dom-musgo)" label="Contagem" onClick={() => abrirContagem(null)} />
        <IconTile icone="chef-hat" cor="var(--dom-laranja)" label="Produção" onClick={() => setTelaAberta('producao')} />
        <IconTile icone="arrows-exchange" cor="var(--dom-marinho)" label="Requisição / Transferência" onClick={() => setTelaAberta('requisicao')} />
        <IconTile icone="trash" cor="var(--danger)" label="Perdas / Desperdícios" onClick={() => abrirContagem('perdas')} />
        <IconTile icone="package" cor="var(--dom-laranja)" label="Recebimento de Mercadoria" onClick={() => { setErroRecebimento(''); setMostrandoRecebimento(true) }} />
        {/* Produtividade ocultada a pedido do Felipe (02/10/2026) — "não vamos usar isso por
            agora". onEntrarProdutividade continua recebido pra não quebrar o App.jsx; é só
            reativar o tile quando for retomado. */}
        {podeCadastro && (
          <IconTile icone="database" cor="var(--dom-cinza)" label="Cadastros" onClick={onAbrirCadastro} />
        )}
        {podeAdmin && (
          <IconTile icone="settings" cor="var(--dom-cinza)" label="Administrativo" onClick={onAbrirAdmin} />
        )}
      </div>

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
        <Modal onFechar={() => setMostrandoRecebimento(false)} largura={360}>
          <RecebimentoForm
            usuario={usuarioLogado?.nome}
            onPronto={() => setMostrandoRecebimento(false)}
            onErro={setErroRecebimento}
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
          <TelaRequisicao usuarioLogado={usuarioLogado} onSair={() => setTelaAberta(null)} />
        </Modal>
      )}
      {telaAberta === 'operacao' && (
        <Modal onFechar={() => setTelaAberta(null)} largura={440}>
          <TelaOperacao usuarioLogado={usuarioLogado} onSair={() => setTelaAberta(null)} />
        </Modal>
      )}

      {contagemAberta && (
        <Modal onFechar={fecharContagem} largura={440}>
          {!contexto ? (
            <SelecaoUnidade usuarioLogado={usuarioLogado} tipoFixo={tipoFixoContagem} onSessaoPronta={setContexto} onVoltar={fecharContagem} />
          ) : contexto.sessao?.tipo === 'perdas' ? (
            <TelaPerdas sessao={contexto.sessao} unidade={contexto.unidade} usuarioLogado={usuarioLogado} onFinalizar={fecharContagem} onSair={fecharContagem} />
          ) : (
            <TelaContagem sessao={contexto.sessao} unidade={contexto.unidade} grupo={contexto.grupo} usuarioLogado={usuarioLogado} onFinalizar={fecharContagem} onSair={fecharContagem} />
          )}
        </Modal>
      )}
    </div>
  )
}
