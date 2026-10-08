import { useEffect, useState } from 'react'

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

  // 08/10/2026 (queixa do Felipe, com print do celular: busca de item dentro do popup "não tem
  // espaço pra visualizar" — o teclado cobria quase todos os resultados). O popup se centralizava/
  // dimensionava usando `100dvh` (CSS puro), mas no celular o teclado NÃO encolhe o `dvh` — ele só
  // mexe no "visual viewport" do navegador. Resultado: o popup continuava se achando do tamanho da
  // tela inteira e ficava, em parte, escondido atrás do teclado. Acompanhando `visualViewport`
  // (quando o navegador suporta) o popup passa a usar a altura e a posição REALMENTE visíveis.
  const [janela, setJanela] = useState(null)
  useEffect(() => {
    if (!window.visualViewport) return
    const vv = window.visualViewport
    function atualizar() { setJanela({ altura: vv.height, topo: vv.offsetTop }) }
    atualizar()
    vv.addEventListener('resize', atualizar)
    vv.addEventListener('scroll', atualizar)
    return () => {
      vv.removeEventListener('resize', atualizar)
      vv.removeEventListener('scroll', atualizar)
    }
  }, [])

  const estiloFundo = janela ? { top: janela.topo, left: 0, right: 0, height: janela.altura, bottom: 'auto' } : undefined
  const estiloCaixa = { maxWidth: largura, ...(janela ? { maxHeight: janela.altura - 40 } : null) }

  return (
    <div className="modal-fundo" style={estiloFundo} onClick={onFechar}>
      <div className="modal-caixa" style={estiloCaixa} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
