import Icon from './Icon'

// Cabeçalho padrão de toda tela (06/10/2026, pedido do Felipe): botão "Voltar" estilo iOS
// (chevron + texto, sem caixa) à esquerda, título centralizado, e até 2 ícones de ação à direita
// (ex.: Excluir/Enviar em Contagem e Perdas; Trocar usuário na Home). `subtitulo` aceita texto OU
// um nó React (TelaPerdas usa um link "alterar" embutido na frase) — cada tela decide o que falar
// ali; o Topbar só garante o mesmo lugar/visual em todo canto.
export default function Topbar({ titulo, subtitulo, onVoltar, acoes = [] }) {
  return (
    <div className="topbar-novo">
      <div className="topbar-novo-linha">
        <div className="topbar-novo-lado">
          {onVoltar && (
            <button className="topbar-voltar" onClick={onVoltar}>
              <Icon nome="chevron-left" tamanho={20} />
              Voltar
            </button>
          )}
        </div>
        <span className="topbar-novo-titulo">{titulo}</span>
        <div className="topbar-novo-lado" style={{ justifyContent: 'flex-end' }}>
          {acoes.map((a, i) => (
            <button
              key={i}
              className="topbar-icone"
              onClick={a.onClick}
              aria-label={a.aria || a.icone}
              style={a.cor ? { color: a.cor } : undefined}
            >
              <Icon nome={a.icone} tamanho={16} cor={a.cor || 'currentColor'} />
            </button>
          ))}
        </div>
      </div>
      {subtitulo && <div className="topbar-novo-subtitulo">{subtitulo}</div>}
    </div>
  )
}
