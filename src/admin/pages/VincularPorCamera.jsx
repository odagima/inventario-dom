import { useEffect, useRef, useState } from 'react'
import ScannerCodigoBarras from '../../components/ScannerCodigoBarras'
import { buscarProdutoPorBarcodeAdmin, buscarProdutosAdmin, vincularBarcode } from '../lib/adminApi'

const LARGURA_MINIMA_PC = 900

export default function VincularPorCamera() {
  const ehPc = typeof window !== 'undefined' && window.innerWidth >= LARGURA_MINIMA_PC
  const [ativo, setAtivo] = useState(!ehPc)
  const [codigoLido, setCodigoLido] = useState('')
  const [jaVinculado, setJaVinculado] = useState(null)
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState([])
  const [salvando, setSalvando] = useState(false)
  const [sucesso, setSucesso] = useState(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (termo.trim().length < 2) { setResultados([]); return }
    debounceRef.current = setTimeout(async () => {
      setResultados(await buscarProdutosAdmin(termo))
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [termo])

  async function handleLeitura(codigo) {
    setAtivo(false)
    setCodigoLido(codigo)
    setSucesso(null)
    const existente = await buscarProdutoPorBarcodeAdmin(codigo)
    setJaVinculado(existente?.produtos || null)
  }

  async function handleVincular(produto) {
    setSalvando(true)
    try {
      await vincularBarcode(produto.id, codigoLido, 'industrializado')
      setSucesso(produto)
      setTermo('')
      setResultados([])
    } finally {
      setSalvando(false)
    }
  }

  function escanearOutro() {
    setCodigoLido('')
    setJaVinculado(null)
    setSucesso(null)
    setTermo('')
    setResultados([])
    setAtivo(true)
  }

  return (
    <div className="card">
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Vincular por câmera</p>
      <p className="muted" style={{ margin: '0 0 14px' }}>
        Aponte a câmera pro código de barras impresso no produto industrializado. Depois é só achar o item certo no Everest e confirmar.
      </p>

      {ehPc ? (
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px' }}>Essa função é só pelo celular</p>
          <p className="muted" style={{ margin: 0 }}>Abre o Cadastro no celular pra apontar a câmera pro código de barras.</p>
        </div>
      ) : (
        <>
          {ativo && <ScannerCodigoBarras ativo={ativo} onLeitura={handleLeitura} />}

      {!ativo && codigoLido && (
        <div style={{ marginTop: 12 }}>
          <p className="muted" style={{ marginBottom: 10 }}>Código lido: <strong style={{ color: 'var(--text)' }}>{codigoLido}</strong></p>

          {sucesso ? (
            <div style={{ background: 'rgba(48,209,88,0.1)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <p style={{ margin: 0, color: 'var(--success)', fontWeight: 500 }}>Vinculado com sucesso</p>
              <p className="muted" style={{ margin: '4px 0 0' }}>{sucesso.nome}</p>
            </div>
          ) : jaVinculado ? (
            <div style={{ background: 'rgba(255,159,10,0.1)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <p style={{ margin: 0, color: 'var(--warning)', fontWeight: 500 }}>Esse código já está vinculado</p>
              <p className="muted" style={{ margin: '4px 0 0' }}>{jaVinculado.nome} · Everest {jaVinculado.codigo_everest || '—'}</p>
            </div>
          ) : (
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <label className="muted">Qual produto é esse?</label>
              <input
                autoFocus
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                placeholder="Digite o nome do produto"
                style={{ margin: '4px 0' }}
                type="search"
                name="busca-produto-vincular-camera"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
              {resultados.length > 0 && (
                <div className="card" style={{ padding: 0, maxHeight: 240, overflowY: 'auto' }}>
                  {resultados.map((p) => (
                    <div
                      key={p.id}
                      className="list-item"
                      style={{ padding: '10px 14px', cursor: 'pointer' }}
                      onClick={() => !salvando && handleVincular(p)}
                    >
                      <span>{p.nome}</span>
                      <span className="muted">Everest {p.codigo_everest || '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button className="primary" onClick={escanearOutro} style={{ width: '100%' }}>Escanear outro código</button>
        </div>
      )}
        </>
      )}
    </div>
  )
}
