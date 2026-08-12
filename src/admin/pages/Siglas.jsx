import { useEffect, useState } from 'react'
import {
  listarSiglas, criarSigla, editarSigla, deletarSigla, ignorarSigla,
  buscarSiglasNaoMapeadas, reprocessarSiglasExistentes
} from '../lib/adminApi'

export default function Siglas() {
  const [siglas, setSiglas] = useState([])
  const [naoMapeadas, setNaoMapeadas] = useState([])
  const [novaSigla, setNovaSigla] = useState('')
  const [novoSignificado, setNovoSignificado] = useState('')
  const [editando, setEditando] = useState(null)
  const [significadoEdicao, setSignificadoEdicao] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [reprocessando, setReprocessando] = useState(false)
  const [progresso, setProgresso] = useState(null)
  const [mensagem, setMensagem] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      const [lista, semMapa] = await Promise.all([listarSiglas(), buscarSiglasNaoMapeadas()])
      setSiglas(lista)
      setNaoMapeadas(semMapa)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  async function handleCriar() {
    if (!novaSigla.trim() || !novoSignificado.trim()) return
    setSalvando(true)
    try {
      await criarSigla(novaSigla.trim(), novoSignificado.trim())
      setNovaSigla('')
      setNovoSignificado('')
      await carregar()
    } finally {
      setSalvando(false)
    }
  }

  function handleMapearRapido(sigla) {
    setNovaSigla(sigla)
    setNovoSignificado('')
  }

  async function handleIgnorar(sigla) {
    await ignorarSigla(sigla)
    setNaoMapeadas((prev) => prev.filter((s) => s.sigla !== sigla))
  }

  function abrirEdicao(s) {
    setEditando(s.sigla)
    setSignificadoEdicao(s.significado)
  }

  async function handleSalvarEdicao(sigla) {
    setSalvando(true)
    try {
      await editarSigla(sigla, significadoEdicao)
      setSiglas((prev) => prev.map((s) => (s.sigla === sigla ? { ...s, significado: significadoEdicao } : s)))
      setEditando(null)
    } finally {
      setSalvando(false)
    }
  }

  async function handleExcluir(sigla) {
    await deletarSigla(sigla)
    setSiglas((prev) => prev.filter((s) => s.sigla !== sigla))
  }

  async function handleReprocessar() {
    setReprocessando(true)
    setMensagem('')
    setProgresso(null)
    try {
      const total = await reprocessarSiglasExistentes((p) => setProgresso(p))
      setMensagem(`${total} produto(s) atualizado(s) com a sigla detectada.`)
      await carregar()
    } finally {
      setReprocessando(false)
    }
  }

  if (carregando) return <div className="card"><p className="muted">Carregando…</p></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>O que são as siglas?</p>
        <p className="muted" style={{ margin: 0 }}>
          São os prefixos que o Everest usa no início do nome de alguns produtos pra indicar origem/destino
          (ex: MC = Mercadinho, PP = produto de produção). A relevância é ajudar a identificar rapidinho de
          onde vem ou pra onde vai um item, e no futuro filtrar relatórios por isso.
        </p>
      </div>

      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Nova sigla</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={novaSigla} onChange={(e) => setNovaSigla(e.target.value)} placeholder="Sigla (ex: MC)" style={{ flex: 1 }} />
          <input value={novoSignificado} onChange={(e) => setNovoSignificado(e.target.value)} placeholder="Significado" style={{ flex: 2 }} />
        </div>
        <button className="primary" onClick={handleCriar} disabled={salvando || !novaSigla.trim() || !novoSignificado.trim()} style={{ width: '100%' }}>
          {salvando ? 'Salvando…' : 'Adicionar sigla'}
        </button>
      </div>

      {naoMapeadas.length > 0 && (
        <div className="card">
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15, color: 'var(--warning)' }}>Siglas não mapeadas</p>
          <p className="muted" style={{ margin: '0 0 12px' }}>
            As mais frequentes no nome dos produtos que ainda não têm significado definido. Pode ter palavra comum
            que não é sigla de verdade (o catálogo é todo em maiúsculas) — mapeia se for sigla, ou ignora se não for.
          </p>
          {naoMapeadas.map((s) => (
            <div key={s.sigla} className="list-item">
              <span>{s.sigla}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="muted">{s.total} produto(s)</span>
                <button style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => handleMapearRapido(s.sigla)}>Mapear</button>
                <button style={{ padding: '4px 8px', fontSize: 12, color: 'var(--text-secondary)' }} onClick={() => handleIgnorar(s.sigla)}>Ignorar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Siglas mapeadas</p>
        {siglas.map((s) => (
          <div key={s.sigla} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 500 }}>{s.sigla}</span>
                {editando !== s.sigla && <span className="muted"> · {s.significado}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => (editando === s.sigla ? setEditando(null) : abrirEdicao(s))}>
                  {editando === s.sigla ? 'Fechar' : 'Editar'}
                </button>
                <button style={{ padding: '4px 8px', fontSize: 12, color: 'var(--danger)' }} onClick={() => handleExcluir(s.sigla)}>Excluir</button>
              </div>
            </div>
            {editando === s.sigla && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={significadoEdicao} onChange={(e) => setSignificadoEdicao(e.target.value)} style={{ flex: 1 }} />
                <button className="primary" onClick={() => handleSalvarEdicao(s.sigla)} disabled={salvando}>Salvar</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Reprocessar cadastro existente</p>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Produtos importados antes dessa funcionalidade existir não têm sigla detectada ainda. Roda isso uma vez pra preencher.
        </p>
        {reprocessando && progresso && (
          <p className="muted" style={{ marginBottom: 10 }}>Processando: {progresso.feito}/{progresso.total}</p>
        )}
        {mensagem && <p style={{ color: 'var(--success)', fontSize: 13, marginBottom: 10 }}>{mensagem}</p>}
        <button onClick={handleReprocessar} disabled={reprocessando} style={{ width: '100%' }}>
          {reprocessando ? 'Reprocessando…' : 'Reprocessar agora'}
        </button>
      </div>
    </div>
  )
}
