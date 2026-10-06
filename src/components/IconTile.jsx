import Icon from './Icon'

// Botão de navegação em grade (ícone + rótulo) — pedido do Felipe (06/10/2026), depois de testar
// mockups: "contorno + sombra leve" (o `.card` do app já é exatamente isso, ver styles.css).
// Pensado pra reaparecer em mais de uma tela (Home primeiro; Contagem/Requisição depois, mesmo
// padrão), por isso vive em `components`, não dentro de uma página só.
export default function IconTile({ icone, label, cor, onClick }) {
  return (
    <button onClick={onClick} className="icon-tile">
      <Icon nome={icone} cor={cor} tamanho={23} />
      <span>{label}</span>
    </button>
  )
}
