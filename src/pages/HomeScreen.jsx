import { useState } from 'react'
import IconTile from '../components/IconTile'
import Icon from '../components/Icon'
import Modal from '../components/Modal'

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
export default function HomeScreen({ usuarioLogado, onEntrarContagem, onEntrarProducao, onEntrarRequisicao, onEntrarPerdas, onEntrarProdutividade, onAbrirCadastro, onAbrirAdmin, onSair }) {
  const nivel = usuarioLogado.nivelAcesso
  const podeCadastro = nivel === 'administrativo' || nivel === 'estoque_compras'
  const podeAdmin = nivel === 'administrativo'
  const [confirmandoTroca, setConfirmandoTroca] = useState(false)

  return (
    <div className="screen" style={{ justifyContent: 'center' }}>
      <div className="app-header" style={{ position: 'relative', textAlign: 'center' }}>
        <button
          className="topbar-icone"
          onClick={() => setConfirmandoTroca(true)}
          aria-label="Trocar usuário"
          style={{ position: 'absolute', top: 0, right: 0 }}
        >
          <Icon nome="user" tamanho={15} />
        </button>
        <p className="brand">Grupo DOM</p>
        <p className="subtitle">Olá, {usuarioLogado.nome}</p>
      </div>

      <div className="icon-grid">
        <IconTile icone="clipboard-list" cor="var(--dom-musgo)" label="Contagem" onClick={onEntrarContagem} />
        <IconTile icone="chef-hat" cor="var(--dom-laranja)" label="Produção" onClick={onEntrarProducao} />
        <IconTile icone="arrows-exchange" cor="var(--dom-marinho)" label="Requisição / Transferência" onClick={onEntrarRequisicao} />
        <IconTile icone="trash" cor="var(--danger)" label="Perdas / Desperdícios" onClick={onEntrarPerdas} />
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
    </div>
  )
}
