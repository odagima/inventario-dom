export default function CabecalhoCartao({ titulo, subtitulo, acao }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: subtitulo ? 4 : 14 }}>
      <div>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{titulo}</p>
        {subtitulo && <p className="muted" style={{ margin: '2px 0 12px' }}>{subtitulo}</p>}
      </div>
      {acao}
    </div>
  )
}
