export default function HomeScreen({ usuarioLogado, onEntrarContagem, onEntrarProducao, onEntrarRequisicao, onEntrarProdutividade, onAbrirCadastro, onAbrirAdmin, onSair }) {
  const nivel = usuarioLogado.nivelAcesso
  const podeCadastro = nivel === 'administrativo' || nivel === 'estoque_compras'
  const podeAdmin = nivel === 'administrativo'

  return (
    <div className="screen" style={{ justifyContent: 'center' }}>
      <div className="app-header" style={{ textAlign: 'center' }}>
        <p className="brand">Grupo DOM</p>
        <p className="subtitle">Olá, {usuarioLogado.nome}</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button className="primary" style={{ padding: '18px', fontSize: 16 }} onClick={onEntrarContagem}>
          Contagem
        </button>
        <button style={{ padding: '18px', fontSize: 16 }} onClick={onEntrarProducao}>
          Produção
        </button>
        <button style={{ padding: '18px', fontSize: 16 }} onClick={onEntrarRequisicao}>
          Requisição / Transferência
        </button>
        {/* Produtividade ocultada a pedido do Felipe (02/10/2026) — "não vamos usar isso por
            agora". onEntrarProdutividade continua recebido pra não quebrar o App.jsx; é só
            reativar o botão quando for retomado. */}
        {podeCadastro && (
          <button style={{ padding: '18px', fontSize: 16 }} onClick={onAbrirCadastro}>Cadastros</button>
        )}
        {podeAdmin && (
          <button style={{ padding: '18px', fontSize: 16 }} onClick={onAbrirAdmin}>Administrativo</button>
        )}
      </div>

      <div style={{ textAlign: 'center', marginTop: 24 }}>
        <button className="ghost" onClick={onSair}>Trocar usuário</button>
      </div>
    </div>
  )
}
