export default function Standby({ titulo, descricao }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%', background: 'var(--surface-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 22
      }}>
        💡
      </div>
      <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 16 }}>{titulo}</p>
      <p className="muted" style={{ margin: '0 auto', maxWidth: 420 }}>{descricao}</p>
      <p className="muted" style={{ marginTop: 20, fontSize: 12 }}>
        Isso é só uma ideia registrada — ainda não foi construído. Fica guardado aqui até decidirmos priorizar.
      </p>
    </div>
  )
}
