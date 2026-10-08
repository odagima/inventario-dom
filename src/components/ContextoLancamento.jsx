// Bloco padrão no topo de todo lançamento que puxa a base (Perdas, Produção, Recebimento —
// 08/10/2026, pedido do Felipe: "não está tudo com a mesma cara... ajuste"). Sempre no mesmo
// lugar (logo abaixo do Topbar), mesmo visual — só o que mostra muda com o que aquele lançamento
// de fato guarda (`mostrarLoja`/`extra`).
export default function ContextoLancamento({ unidade, local, extra, usuario, mostrarLoja = true, onTrocar }) {
  return (
    <div
      style={{
        background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10,
        padding: '10px 12px', marginBottom: 14, display: 'flex',
        justifyContent: 'space-between', alignItems: 'center', gap: 10
      }}
    >
      <div style={{ minWidth: 0 }}>
        <button
          type="button"
          onClick={onTrocar}
          style={{ padding: 0, background: 'none', border: 'none', textDecoration: 'underline', fontSize: 13, fontWeight: 600, color: 'inherit', cursor: 'pointer' }}
        >
          {mostrarLoja ? `${unidade?.nome || 'sem loja'} · ` : ''}{local?.nome || 'sem setor'}
        </button>
        {extra && <span className="muted" style={{ fontSize: 13 }}> · {extra}</span>}
      </div>
      <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>{usuario}</span>
    </div>
  )
}
