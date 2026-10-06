import IconTile from '../components/IconTile'

// Reformulada a pedido do Felipe (06/10/2026): os botões empilhados pareciam "um monte de
// funcionalidade jogada" — vira grade de ícones (ver IconTile.jsx/styles.css `.icon-tile`),
// ordenada pelo que é mais usado no dia a dia, sem dividir em blocos (testou agrupar por "operação
// do dia"/"produção e estoque"/retaguarda e não gostou da lógica).
//
// Perdas/Desperdícios subiu de dentro de Contagem pra cá (era "Registro de perdas/desperdício"
// dentro da lista de tipos) — entra direto na Contagem com o tipo já fixado (ver
// SelecaoUnidade.jsx `tipoFixo`), sem passar pela lista "o que você vai fazer".
export default function HomeScreen({ usuarioLogado, onEntrarContagem, onEntrarProducao, onEntrarRequisicao, onEntrarPerdas, onEntrarProdutividade, onAbrirCadastro, onAbrirAdmin, onSair }) {
  const nivel = usuarioLogado.nivelAcesso
  const podeCadastro = nivel === 'administrativo' || nivel === 'estoque_compras'
  const podeAdmin = nivel === 'administrativo'

  return (
    <div className="screen" style={{ justifyContent: 'center' }}>
      <div className="app-header" style={{ textAlign: 'center' }}>
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

      <div style={{ textAlign: 'center', marginTop: 24 }}>
        <button className="ghost" onClick={onSair}>Trocar usuário</button>
      </div>
    </div>
  )
}
