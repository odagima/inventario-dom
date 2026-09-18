const CAMINHOS = {
  busca: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm10 17-5.6-5.6',
  mais: 'M12 5v14M5 12h14',
  lixo: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  editar: 'M4 20h4L20 8l-4-4L4 16v4zM14 6l4 4',
  check: 'M4 12l5 5L20 6',
  x: 'M6 6l12 12M18 6 6 18',
  seta: 'M9 6l6 6-6 6',
  etiqueta: 'M3 11V4h7l11 11-7 7L3 11zM7.5 8.5h.01',
  caixaVazia: 'M3 8l9-4 9 4-9 4-9-4zm0 0v8l9 4 9-4V8M12 12v8',
  upload: 'M12 16V4m0 0 4 4m-4-4-4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  engrenagem: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.5 12H2m20 0h-2.5M12 4.5V2m0 20v-2.5M6.3 6.3 4.6 4.6m14.8 14.8-1.7-1.7M6.3 17.7l-1.7 1.7M17.7 6.3l1.7-1.7',
  menu: 'M4 7h16M4 12h16M4 17h16'
}

export default function Icon({ nome, tamanho = 18, cor = 'currentColor', style }) {
  const d = CAMINHOS[nome]
  if (!d) return null
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, ...style }}>
      <path d={d} stroke={cor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
