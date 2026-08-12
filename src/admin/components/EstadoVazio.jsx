import Icon from './Icon'

export default function EstadoVazio({ icone = 'caixaVazia', titulo, descricao }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 16px' }}>
      <div
        style={{
          width: 44, height: 44, borderRadius: '50%', background: 'var(--surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px'
        }}
      >
        <Icon nome={icone} tamanho={20} cor="var(--text-secondary)" />
      </div>
      <p style={{ margin: 0, fontWeight: 500 }}>{titulo}</p>
      {descricao && <p className="muted" style={{ margin: '4px 0 0' }}>{descricao}</p>}
    </div>
  )
}
