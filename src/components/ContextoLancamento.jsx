// Bloco padrão no topo de todo lançamento que puxa a base (Perdas, Produção, Recebimento —
// pedido do Felipe, 2ª rodada: "o cabeçalho é isso mesmo, só precisa arrumar de um jeito que
// fique bonito" + layout em grade dado por ele: Loja/Data numa linha, Setor sozinho embaixo,
// Usuário/Turno na linha de baixo). Cada campo só aparece se a tela passar o valor — Produção e
// Recebimento não têm Loja nem Turno, por exemplo.
//
// "Deixar disponível para alterar Loja, setor e turno (sem a palavra alterar)": o valor em si é o
// botão — sem link "alterar" à parte. Só Loja/Setor abrem o mesmo popup (TrocarLocalModal, com
// confirmação — são a mesma base padronizada); Turno e Data (quando a tela passa `onTrocarTurno`/
// `onTrocarData`) abrem um popup simples de um passo só, sem confirmação extra.
export default function ContextoLancamento({ loja, setor, data, turno, usuario, onTrocarSetor, onTrocarTurno, onTrocarData }) {
  const linha1 = [
    loja != null && { chave: 'loja', label: 'Loja', valor: loja, onClick: onTrocarSetor },
    data != null && { chave: 'data', label: 'Data', valor: data, onClick: onTrocarData }
  ].filter(Boolean)
  const linha3 = [
    usuario != null && { chave: 'usuario', label: 'Usuário', valor: usuario },
    turno != null && { chave: 'turno', label: 'Turno', valor: turno, onClick: onTrocarTurno }
  ].filter(Boolean)

  return (
    <div className="card" style={{ marginBottom: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {linha1.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          {linha1.map((c) => <Campo key={c.chave} {...c} />)}
        </div>
      )}
      {setor != null && <Campo label="Setor" valor={setor} onClick={onTrocarSetor} destaque />}
      {linha3.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          {linha3.map((c) => <Campo key={c.chave} {...c} />)}
        </div>
      )}
    </div>
  )
}

function Campo({ label, valor, onClick, destaque }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span className="muted" style={{ fontSize: 11.5 }}>{label}: </span>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          style={{
            padding: 0, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer',
            textDecoration: 'underline', fontWeight: destaque ? 700 : 600, fontSize: destaque ? 14.5 : 13.5
          }}
        >
          {valor}
        </button>
      ) : (
        <span style={{ fontWeight: destaque ? 700 : 600, fontSize: destaque ? 14.5 : 13.5 }}>{valor}</span>
      )}
    </div>
  )
}
