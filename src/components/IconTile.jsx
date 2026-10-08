import Icon from './Icon'

// Fundo suave atrás do ícone — mesmas cores de marca, só com baixa opacidade. Lookup fixo (não
// `color-mix()`) pra não depender de suporte de CSS mais novo no navegador do tablet/celular.
const FUNDO_SUAVE = {
  'var(--dom-marinho)': 'rgba(28, 43, 68, 0.1)',
  'var(--dom-musgo)': 'rgba(92, 110, 73, 0.14)',
  'var(--dom-laranja)': 'rgba(193, 90, 27, 0.14)',
  'var(--dom-cinza)': 'rgba(140, 136, 126, 0.16)',
  'var(--danger)': 'rgba(168, 68, 58, 0.12)'
}

// Botão de navegação em grade (ícone + rótulo) — pedido do Felipe (06/10/2026), depois de testar
// mockups: "contorno + sombra leve" (o `.card` do app já é exatamente isso, ver styles.css).
// Pensado pra reaparecer em mais de uma tela (Home primeiro; Contagem/Requisição depois, mesmo
// padrão), por isso vive em `components`, não dentro de uma página só.
//
// `bolinha` (07/10/2026, pedido do Felipe, Abrir/Fechar praça): cor opcional de uma bolinha
// grudada no ícone — verde = pode abrir, vermelha = já está aberta (fechar). Sem a prop, o tile
// fica igual. 08/10/2026 (2ª rodada): a bolinha morava no canto do TILE inteiro — "precisa ficar
// próxima ao ícone do relógio" — passou a ficar no canto do círculo do ícone, não do botão todo.
//
// 08/10/2026 (pedido do Felipe, "precisa ser bacana" + "tamanho fixo, não deixa adaptar pela
// palavra"): ícone ganhou fundo colorido (mesmo truque já usado nos motivos de Perdas) e o tile
// inteiro ganhou altura fixa em `.icon-tile` (styles.css) — rótulo comprido quebra em até 2 linhas
// dentro da mesma altura, nunca estica o tile.
export default function IconTile({ icone, label, cor, onClick, bolinha }) {
  return (
    <button onClick={onClick} className="icon-tile">
      <span className="icon-tile-bolha" style={{ background: FUNDO_SUAVE[cor] || 'var(--surface-2)', position: 'relative' }}>
        <Icon nome={icone} cor={cor} tamanho={21} />
        {bolinha && (
          <span
            style={{
              position: 'absolute', top: -2, right: -2, width: 10, height: 10,
              borderRadius: '50%', background: bolinha, boxShadow: '0 0 0 2px var(--surface)'
            }}
          />
        )}
      </span>
      <span>{label}</span>
    </button>
  )
}
