import { useEffect } from 'react'

// 14/08/2026, pedido do Felipe: "todo popup deve poder ser fechado apertando a tecla esc" — hook
// reaproveitado por todo popup/overlay do admin (ver `position: 'fixed', inset: 0` + backdrop nas
// telas de Ficha Técnica, Cardápio, CMV Semanal, Relatório, Painel e Vendas). Só liga o listener
// enquanto o popup está de fato aberto (`ativo`), e desliga sozinho ao fechar/desmontar.
export function useEscParaFechar(ativo, onClose) {
  useEffect(() => {
    if (!ativo) return
    function aoTeclar(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [ativo, onClose])
}
