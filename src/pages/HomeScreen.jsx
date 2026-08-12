export default function HomeScreen({ usuarioLogado, onEntrarContagem, onEntrarProdutividade, onAbrirCadastro, onAbrirAdmin, onSair }) {
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
        <button style={{ padding: '18px', fontSize: 16 }} onClick={onEntrarProdutividade}>
          Produtividade
        </button>
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
