import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

const FORMATOS_NATIVOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf']
const FORMATOS_FALLBACK = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF']
const TEMPO_CONFIRMACAO_MS = 3000 // tempo mostrando "código lido" antes de seguir, só pra dar segurança visual

export default function ScannerCodigoBarras({ onLeitura, ativo }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)
  const html5QrRef = useRef(null)
  const [erroCamera, setErroCamera] = useState('')
  const [analisando, setAnalisando] = useState(false)
  const [modo, setModo] = useState(null) // 'nativo' | 'fallback'
  const [codigoConfirmado, setCodigoConfirmado] = useState(null)
  const [zoomDisponivel, setZoomDisponivel] = useState(false)
  const [zoomMinMax, setZoomMinMax] = useState({ min: 1, max: 4, step: 0.1 })
  const [zoom, setZoom] = useState(1)
  const trilhaVideoRef = useRef(null)

  function aplicarZoom(valor) {
    setZoom(valor)
    trilhaVideoRef.current?.applyConstraints({ advanced: [{ zoom: valor }] }).catch(() => {})
  }

  useEffect(() => {
    if (!ativo) return
    let cancelado = false
    let pausado = false // true assim que um código é lido, até o tempo de confirmação passar

    function pararTudo() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      if (html5QrRef.current) {
        const instancia = html5QrRef.current
        html5QrRef.current = null // evita chamar stop()/clear() de novo numa instância já parada
        instancia
          .stop()
          .catch(() => {})
          .finally(() => {
            try { instancia.clear() } catch { /* elemento já desmontado */ }
          })
      }
    }

    function reportarLeitura(codigo) {
      if (pausado) return
      pausado = true
      setCodigoConfirmado(codigo)
      pararTudo()
      setTimeout(() => {
        if (!cancelado) onLeitura(codigo)
      }, TEMPO_CONFIRMACAO_MS)
    }

    async function iniciarNativo() {
      const detector = new window.BarcodeDetector({ formats: FORMATOS_NATIVOS })
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: 'continuous' }]
        }
      })
      if (cancelado) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setModo('nativo')

      const trilha = stream.getVideoTracks()[0]
      trilhaVideoRef.current = trilha
      try {
        const capacidades = trilha.getCapabilities?.()
        if (capacidades?.zoom) {
          setZoomDisponivel(true)
          setZoomMinMax({ min: capacidades.zoom.min, max: capacidades.zoom.max, step: capacidades.zoom.step || 0.1 })
        }
      } catch {
        // sem suporte a zoom nesse aparelho — segue sem o controle
      }

      async function loop() {
        if (cancelado || pausado) return
        try {
          const resultados = await detector.detect(videoRef.current)
          setAnalisando(true)
          if (resultados.length > 0) {
            reportarLeitura(resultados[0].rawValue)
            return
          }
        } catch {
          // erro pontual de frame — ignora e segue tentando
        }
        rafRef.current = requestAnimationFrame(loop)
      }
      loop()
    }

    async function iniciarFallback() {
      setModo('fallback')
      const instancia = new Html5Qrcode('leitor-barcode-fallback', {
        formatsToSupport: FORMATOS_FALLBACK,
        verbose: false
      })
      html5QrRef.current = instancia
      await instancia.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          videoConstraints: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        },
        (texto) => {
          setAnalisando(true)
          reportarLeitura(texto)
        },
        () => setAnalisando(true)
      )
    }

    setErroCamera('')
    setAnalisando(false)
    setCodigoConfirmado(null)
    setZoomDisponivel(false)
    setZoom(1)
    ;(async () => {
      if (window.BarcodeDetector) {
        try {
          await iniciarNativo()
          return
        } catch (err) {
          console.warn('Câmera nativa falhou, tentando modo de compatibilidade:', err)
          // não retorna — cai pro fallback abaixo em vez de travar com erro
        }
      }
      try {
        await iniciarFallback()
      } catch (err) {
        if (!cancelado) {
          setErroCamera(
            'Não consegui acessar a câmera. Confirma se você autorizou o uso da câmera pra esse site. Detalhe: ' +
              (err?.message || err)
          )
        }
      }
    })()

    return () => {
      cancelado = true
      pararTudo()
    }
  }, [ativo])

  return (
    <div style={{ position: 'relative' }}>
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          width: '100%', minHeight: 220, borderRadius: 14, background: 'var(--surface-2, #2c2c2e)',
          objectFit: 'cover', display: modo === 'nativo' ? 'block' : 'none'
        }}
      />
      <div
        id="leitor-barcode-fallback"
        style={{
          width: '100%', minHeight: 220, borderRadius: 14, overflow: 'hidden',
          background: 'var(--surface-2, #2c2c2e)', display: modo === 'fallback' ? 'block' : 'none'
        }}
      />

      {codigoConfirmado ? (
        <div
          style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', borderRadius: 14,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10
          }}
        >
          <div
            style={{
              width: 56, height: 56, borderRadius: '50%', background: 'rgba(48,209,88,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'var(--success, #30d158)',
              animation: 'aparecer-check 0.3s ease'
            }}
          >
            ✓
          </div>
          <p style={{ color: '#fff', fontWeight: 600, margin: 0 }}>Código lido!</p>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, margin: 0 }}>{codigoConfirmado}</p>
        </div>
      ) : (
        <div style={{ position: 'absolute', inset: '38% 8%', border: '2px solid rgba(255,255,255,0.5)', borderRadius: 10, pointerEvents: 'none', overflow: 'hidden' }}>
          {analisando && <div className="linha-scanner" />}
        </div>
      )}

      {zoomDisponivel && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '0 4px' }}>
          <span className="muted" style={{ fontSize: 12 }}>Zoom</span>
          <input
            type="range"
            min={zoomMinMax.min}
            max={zoomMinMax.max}
            step={zoomMinMax.step}
            value={zoom}
            onChange={(e) => aplicarZoom(Number(e.target.value))}
            style={{ flex: 1 }}
          />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 }}>
        <span
          className={analisando && !codigoConfirmado ? 'ponto-pulso' : ''}
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: codigoConfirmado ? 'var(--success, #30d158)' : analisando ? 'var(--accent, #0a84ff)' : 'var(--text-tertiary, #666)'
          }}
        />
        <span className="muted" style={{ fontSize: 13 }}>
          {codigoConfirmado ? 'Confirmado' : analisando ? 'Analisando…' : 'Iniciando câmera…'}
          {modo === 'fallback' && !codigoConfirmado && ' (modo compatibilidade)'}
        </span>
      </div>
      {erroCamera && <p style={{ color: 'var(--danger, #ff453a)', fontSize: 13, marginTop: 12 }}>{erroCamera}</p>}
    </div>
  )
}
