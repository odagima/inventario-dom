import Icon from './Icon'

// Botão de navegação em grade (ícone + rótulo) — pedido do Felipe (06/10/2026), depois de testar
// mockups: "contorno + sombra leve" (o `.card` do app já é exatamente isso, ver styles.css).
// Pensado pra reaparecer em mais de uma tela (Home primeiro; Contagem/Requisição depois, mesmo
// padrão), por isso vive em `components`, não dentro de uma página só.
//
// `bolinha` (07/10/2026, pedido do Felipe, Abrir/Fechar praça): cor opcional de uma bolinha no
// canto — verde = pode abrir, vermelha = já está aberta (fechar). Sem a prop, o tile fica igual.
export default function IconTile({ icone, label, cor, onClick, bolinha }) {
  return (
    <button onClick={onClick} className="icon-tile" style={{ position: 'relative' }}>
      {bolinha && (
        <span
          style={{
            position: 'absolute', top: 10, left: 10, width: 9, height: 9,
            borderRadius: '50%', background: bolinha, boxShadow: '0 0 0 2px var(--surface)'
          }}
        />
      )}
      <Icon nome={icone} cor={cor} tamanho={23} />
      <span>{label}</span>
    </button>
  )
}
