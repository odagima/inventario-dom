// Camada de tela cheia por cima da Home (07/10/2026, pedido do Felipe: "transformar todos os
// botões em popup" — menos Admin, Acompanhamento e Cadastro, que ele achou que ia mudar muita
// coisa à toa). A Home continua montada por baixo (não navega de verdade, é só uma camada em
// cima) — mas, diferente do Modal.jsx (caixa pequena, pensado pra formulário curto), aqui dentro
// vai a TELA inteira (`.screen`, com Topbar e tudo) — por isso não tem caixa pequena nem
// clique-fora-fecha: fecha só pelo "Voltar" de cada tela, igual já era antes.
export default function PopupTela({ children }) {
  return <div className="popup-tela">{children}</div>
}
