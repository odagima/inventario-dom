import { useEffect } from 'react'

// Popup padrão (06/10/2026, pedido do Felipe): "ao invés de abrir uma nova página, abre um popup
// e deixa a tela de baixo aparecendo, mas com blur. Aí apertando ESC fecha." — usado no lugar de
// qualquer confirmação que hoje navega pra tela cheia ou expande um card pra baixo (cancelar,
// excluir, confirmar envio etc.). Fecha com ESC, clicando fora, ou o botão que o conteúdo decidir.
export default function Modal({ children, onFechar, largura = 320 }) {
  useEffect(() => {
    function aoTeclar(e) { if (e.key === 'Escape') onFechar() }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [onFechar])

  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="modal-caixa" style={{ maxWidth: largura }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
