import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { jsPDF } from 'jspdf'
import { registrarEtiquetaInterna } from '../lib/adminApi'

const PRESETS = {
  '40x30': { largura: 40, altura: 30 },
  '50x30': { largura: 50, altura: 30 },
  '60x40': { largura: 60, altura: 40 }
}

export default function GeradorEtiquetas({ produto, onVoltar }) {
  const [preset, setPreset] = useState('50x30')
  const [largura, setLargura] = useState(PRESETS['50x30'].largura)
  const [altura, setAltura] = useState(PRESETS['50x30'].altura)
  const [salvando, setSalvando] = useState(false)
  const [registrado, setRegistrado] = useState(false)
  const canvasRef = useRef(null)

  useEffect(() => {
    if (preset !== 'personalizado') {
      setLargura(PRESETS[preset].largura)
      setAltura(PRESETS[preset].altura)
    }
  }, [preset])

  useEffect(() => {
    if (!canvasRef.current || !produto?.codigo_everest) return
    JsBarcode(canvasRef.current, produto.codigo_everest, {
      format: 'CODE128', height: 50, displayValue: true, fontSize: 14, margin: 4
    })
  }, [produto])

  async function handleRegistrar() {
    setSalvando(true)
    try {
      await registrarEtiquetaInterna(produto.id, produto.codigo_everest)
      setRegistrado(true)
    } finally {
      setSalvando(false)
    }
  }

  function handleImprimir() {
    const styleId = 'etiqueta-page-size'
    let style = document.getElementById(styleId)
    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      document.head.appendChild(style)
    }
    style.textContent = `@page { size: ${largura}mm ${altura}mm; margin: 0; }`
    window.print()
  }

  function handleBaixarPdf() {
    const doc = new jsPDF({ unit: 'mm', format: [largura, altura] })
    const imgData = canvasRef.current.toDataURL('image/png')
    const margem = 3
    const larguraImg = largura - margem * 2
    const alturaBarcode = Math.min(altura * 0.55, larguraImg * 0.4)

    doc.setFontSize(8)
    doc.text(produto.nome, largura / 2, margem + 3, { align: 'center', maxWidth: larguraImg })
    doc.addImage(imgData, 'PNG', margem, margem + 5, larguraImg, alturaBarcode)
    doc.setFontSize(7)
    doc.text(`Everest ${produto.codigo_everest} · ${produto.unidade_medida}`, largura / 2, margem + alturaBarcode + 9, { align: 'center' })

    doc.save(`etiqueta-${produto.codigo_everest}.pdf`)
  }

  if (!produto) return null

  if (!produto.codigo_everest) {
    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Gerar etiqueta</p>
          <button onClick={onVoltar} style={{ padding: '4px 8px', fontSize: 12 }}>voltar</button>
        </div>
        <p className="muted">
          "{produto.nome}" não tem código Everest cadastrado — a etiqueta interna usa esse código como base,
          então não dá pra gerar sem ele. Edita o cadastro desse produto e adiciona o código Everest primeiro.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Gerar etiqueta</p>
        <button onClick={onVoltar} style={{ padding: '4px 8px', fontSize: 12 }}>voltar</button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label className="muted">Tamanho da etiqueta</label>
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="40x30">40 x 30mm</option>
          <option value="50x30">50 x 30mm</option>
          <option value="60x40">60 x 40mm</option>
          <option value="personalizado">Personalizado</option>
        </select>
      </div>

      {preset === 'personalizado' && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label className="muted">Largura (mm)</label>
            <input type="number" value={largura} onChange={(e) => setLargura(Number(e.target.value))} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="muted">Altura (mm)</label>
            <input type="number" value={altura} onChange={(e) => setAltura(Number(e.target.value))} />
          </div>
        </div>
      )}

      <div id="etiqueta-print" style={{ border: '2px dashed var(--border)', borderRadius: 10, padding: 16, textAlign: 'center', background: '#fff', color: '#000' }}>
        <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 13 }}>{produto.nome}</p>
        <canvas ref={canvasRef} style={{ maxWidth: '100%' }} />
        <p style={{ margin: '8px 0 0', fontSize: 11 }}>Everest {produto.codigo_everest} · {produto.unidade_medida}</p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={handleImprimir} style={{ flex: 1 }}>Imprimir</button>
        <button onClick={handleBaixarPdf} style={{ flex: 1 }}>Baixar PDF</button>
      </div>

      <button className="primary" onClick={handleRegistrar} disabled={salvando || registrado} style={{ width: '100%', marginTop: 8 }}>
        {registrado ? 'Registrada como etiqueta interna ✓' : salvando ? 'Registrando…' : 'Confirmar e registrar código'}
      </button>
    </div>
  )
}
