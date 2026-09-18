import { useEffect, useRef, useState } from 'react'
import { buscarProdutosAdmin, statusBarcode, contarProdutos, vincularBarcode, removerBarcodeEspecifico } from '../lib/adminApi'
import Icon from '../components/Icon'
import EstadoVazio from '../components/EstadoVazio'
import CabecalhoCartao from '../components/CabecalhoCartao'

const LABEL_STATUS = { industrializado: 'Industrializado', interno: 'Etiqueta interna', sem_codigo: 'Sem código' }

export default function ConsultaProdutos({ onGerarEtiqueta }) {
  const [termo, setTermo] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [produtos, setProdutos] = useState([])
  const [pagina, setPagina] = useState(0)
  const [temMais, setTemMais] = useState(true)
  const [total, setTotal] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [editandoId, setEditandoId] = useState(null)
  const [novoCodigo, setNovoCodigo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => { contarProdutos().then(setTotal).catch(() => {}) }, [])

  async function buscar(paginaAlvo = 0) {
    return buscarProdutosAdmin(termo, paginaAlvo, filtroStatus)
  }

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setCarregando(true)
      try {
        const resultado = await buscar(0)
        setProdutos(resultado)
        setPagina(0)
        setTemMais(resultado.length === 100)
      } finally {
        setCarregando(false)
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [termo, filtroStatus])

  async function handleCarregarMais() {
    setCarregandoMais(true)
    try {
      const proximaPagina = pagina + 1
      const resultado = await buscar(proximaPagina)
      setProdutos((prev) => [...prev, ...resultado])
      setPagina(proximaPagina)
      setTemMais(resultado.length === 100)
    } finally {
      setCarregandoMais(false)
    }
  }

  function atualizarProdutoLocal(produtoId, novosBarcodes) {
    setProdutos((prev) => prev.map((p) => (p.id === produtoId ? { ...p, barcodes: novosBarcodes } : p)))
  }

  async function handleAdicionarCodigo(produto) {
    if (!novoCodigo.trim()) return
    setSalvando(true)
    try {
      await vincularBarcode(produto.id, novoCodigo.trim(), 'industrializado')
      atualizarProdutoLocal(produto.id, [...(produto.barcodes || []), { codigo_barras: novoCodigo.trim(), origem: 'industrializado' }])
      setNovoCodigo('')
    } finally {
      setSalvando(false)
    }
  }

  async function handleRemoverCodigo(produto, codigoBarras) {
    setSalvando(true)
    try {
      await removerBarcodeEspecifico(codigoBarras)
      atualizarProdutoLocal(produto.id, (produto.barcodes || []).filter((b) => b.codigo_barras !== codigoBarras))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card">
      <CabecalhoCartao
        titulo="Consultar produtos Everest"
        acao={total !== null && <span className="muted">{total} cadastrados</span>}
      />

      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Icon nome="busca" tamanho={16} cor="var(--text-tertiary)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          placeholder="Buscar por nome ou código"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          style={{ paddingLeft: 38 }}
        />
      </div>

      <div className="segmented" style={{ marginBottom: 12 }}>
        <button type="button" className={filtroStatus === 'todos' ? 'active' : ''} onClick={() => setFiltroStatus('todos')}>Todos</button>
        <button type="button" className={filtroStatus === 'industrializado' ? 'active' : ''} onClick={() => setFiltroStatus('industrializado')}>Industrializado</button>
        <button type="button" className={filtroStatus === 'interno' ? 'active' : ''} onClick={() => setFiltroStatus('interno')}>Etiqueta interna</button>
        <button type="button" className={filtroStatus === 'sem_codigo' ? 'active' : ''} onClick={() => setFiltroStatus('sem_codigo')}>Sem código</button>
      </div>

      {carregando ? (
        <div className="carregando-linha"><span className="spinner" /><span className="muted">Buscando…</span></div>
      ) : produtos.length === 0 ? (
        <EstadoVazio icone="busca" titulo="Nenhum produto encontrado" descricao="Tenta ajustar o termo ou o filtro." />
      ) : (
        <>
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {produtos.map((p) => {
              const status = statusBarcode(p)
              const editando = editandoId === p.id
              const codigos = p.barcodes || []
              return (
                <div key={p.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '13px 10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ margin: 0 }}>{p.nome}</p>
                      <p className="muted" style={{ margin: '2px 0 0' }}>
                        Everest {p.codigo_everest || '—'} · {p.unidade_medida}
                        {p.grupo_everest && <> · {p.grupo_everest}</>}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span className={`badge badge-${status}`}>{LABEL_STATUS[status]}{codigos.length > 1 ? ` · ${codigos.length}` : ''}</span>
                      {status === 'sem_codigo' ? (
                        <button style={{ padding: '5px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => onGerarEtiqueta(p)}>
                          <Icon nome="etiqueta" tamanho={13} /> Gerar
                        </button>
                      ) : (
                        <button
                          style={{ padding: '5px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                          onClick={() => { setEditandoId(editando ? null : p.id); setNovoCodigo('') }}
                        >
                          <Icon nome="editar" tamanho={13} /> {editando ? 'Fechar' : 'Gerenciar'}
                        </button>
                      )}
                    </div>
                  </div>

                  {editando && (
                    <div style={{ marginTop: 10, background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
                      <p className="muted" style={{ margin: '0 0 8px' }}>
                        Vários códigos podem apontar pro mesmo produto (útil pra itens genéricos, tipo "arroz tipo 1" onde a marca não importa).
                      </p>
                      {codigos.length === 0 ? (
                        <p className="muted" style={{ marginBottom: 10 }}>Nenhum código vinculado ainda.</p>
                      ) : (
                        <div style={{ marginBottom: 10 }}>
                          {codigos.map((b) => (
                            <div key={b.codigo_barras} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '0.5px solid var(--border)' }}>
                              <span style={{ fontSize: 13 }}>{b.codigo_barras} <span className="muted">({b.origem === 'interno' ? 'etiqueta interna' : 'industrializado'})</span></span>
                              <button
                                onClick={() => handleRemoverCodigo(p, b.codigo_barras)}
                                disabled={salvando}
                                style={{ padding: '4px 8px', fontSize: 12, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4 }}
                              >
                                <Icon nome="lixo" tamanho={13} /> Remover
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <label className="muted">Adicionar outro código</label>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <input
                          value={novoCodigo}
                          onChange={(e) => setNovoCodigo(e.target.value)}
                          placeholder="Novo código de barras"
                          style={{ flex: 1 }}
                        />
                        <button className="primary" onClick={() => handleAdicionarCodigo(p)} disabled={salvando || !novoCodigo.trim()} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Icon nome="mais" tamanho={14} /> {salvando ? 'Salvando…' : 'Adicionar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {temMais && (
            <button onClick={handleCarregarMais} disabled={carregandoMais} style={{ width: '100%', marginTop: 12 }}>
              {carregandoMais ? 'Carregando…' : `Carregar mais (${produtos.length} de ${total ?? '...'})`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
