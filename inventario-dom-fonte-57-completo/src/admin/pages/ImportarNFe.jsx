import { useState } from 'react'
import JSZip from 'jszip'
import Fuse from 'fuse.js'
import { parseNFeXml } from '../lib/nfe'
import { carregarProdutosParaMatching, vincularBarcodesEmLote, registrarNotasImportadas } from '../lib/adminApi'

async function extrairArquivosXml(arquivos, onProgresso) {
  const resultado = []
  for (let i = 0; i < arquivos.length; i++) {
    const arquivo = arquivos[i]
    if (arquivo.name.toLowerCase().endsWith('.zip')) {
      const zip = await JSZip.loadAsync(arquivo)
      const entradas = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith('.xml'))
      for (const entrada of entradas) {
        const texto = await entrada.async('string')
        resultado.push({ nome: entrada.name, texto })
      }
    } else if (arquivo.name.toLowerCase().endsWith('.xml')) {
      resultado.push({ nome: arquivo.name, texto: await arquivo.text() })
    }
    onProgresso?.({ feito: i + 1, total: arquivos.length })
  }
  return resultado
}

export default function ImportarNFe() {
  const [etapa, setEtapa] = useState('idle') // 'idle' | 'lendo' | 'comparando' | 'pronto' | 'salvando' | 'concluido'
  const [progresso, setProgresso] = useState({ feito: 0, total: 0 })
  const [notas, setNotas] = useState([])
  const [erro, setErro] = useState('')
  const [resumoFinal, setResumoFinal] = useState(null)
  const [produtosCache, setProdutosCache] = useState([])
  const [buscaManual, setBuscaManual] = useState({}) // chave "notaIdx-linhaIdx" -> termo digitado

  async function handleArquivos(e) {
    const arquivos = Array.from(e.target.files || [])
    if (arquivos.length === 0) return
    setErro('')
    setResumoFinal(null)
    setNotas([])

    try {
      // 1) Extrai todos os XMLs (de dentro de .zip também) — rápido, tudo local
      setEtapa('lendo')
      setProgresso({ feito: 0, total: arquivos.length })
      const arquivosXml = await extrairArquivosXml(arquivos, (p) => setProgresso(p))

      // 2) Carrega o cadastro de produtos UMA vez só (nada de 1 consulta por item)
      const produtos = await carregarProdutosParaMatching()
      setProdutosCache(produtos)
      const barcodeParaProduto = new Map()
      for (const p of produtos) {
        for (const b of p.barcodes || []) barcodeParaProduto.set(b.codigo_barras, p)
      }
      const fuse = new Fuse(produtos, { keys: ['nome'], threshold: 0.3, ignoreLocation: true })

      // 3) Processa tudo localmente — instantâneo mesmo com milhares de itens
      setEtapa('comparando')
      setProgresso({ feito: 0, total: arquivosXml.length })
      const novasNotas = []
      for (let i = 0; i < arquivosXml.length; i++) {
        const { texto } = arquivosXml[i]
        try {
          const { numeroNota, fornecedor, cnpjDestinatario, dataEmissao, itens } = parseNFeXml(texto)
          const linhas = itens.map((item) => {
            if (!item.cean) return { ...item, status: 'sem_ean', candidatos: [], escolhido: null }
            const jaVinculado = barcodeParaProduto.get(item.cean)
            if (jaVinculado) return { ...item, status: 'ja_vinculado', produtoJaVinculado: jaVinculado, candidatos: [], escolhido: null }
            const candidatos = fuse.search(item.nome, { limit: 5 }).map((r) => r.item)
            return { ...item, status: candidatos.length ? 'sugestao' : 'sem_match', candidatos, escolhido: candidatos[0] || null }
          })
          novasNotas.push({ numeroNota, fornecedor, cnpjDestinatario, dataEmissao, linhas })
        } catch {
          // XML que não é NF-e válida — pula e segue os outros
        }
        setProgresso({ feito: i + 1, total: arquivosXml.length })
        // Libera o navegador a cada poucos arquivos — sem isso, com centenas de arquivos
        // a aba trava (a barra de progresso nem aparece) porque o JS nunca solta o controle.
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0))
      }

      setNotas(novasNotas)
      setEtapa('pronto')
    } catch (err) {
      setErro(err.message)
      setEtapa('idle')
    } finally {
      e.target.value = ''
    }
  }

  function handleEscolherCandidato(notaIdx, linhaIdx, produto) {
    setNotas((prev) => {
      const copia = [...prev]
      copia[notaIdx] = { ...copia[notaIdx], linhas: [...copia[notaIdx].linhas] }
      copia[notaIdx].linhas[linhaIdx] = { ...copia[notaIdx].linhas[linhaIdx], escolhido: produto }
      return copia
    })
  }

  function handleEscolherManual(notaIdx, linhaIdx, produto) {
    setNotas((prev) => {
      const copia = [...prev]
      copia[notaIdx] = { ...copia[notaIdx], linhas: [...copia[notaIdx].linhas] }
      copia[notaIdx].linhas[linhaIdx] = { ...copia[notaIdx].linhas[linhaIdx], status: 'sugestao', escolhido: produto, candidatos: [produto] }
      return copia
    })
    setBuscaManual((prev) => ({ ...prev, [`${notaIdx}-${linhaIdx}`]: '' }))
  }

  async function handleConfirmarImportacao() {
    setEtapa('salvando')
    try {
      const vinculosPorCodigo = new Map()
      for (const nota of notas) {
        for (const linha of nota.linhas) {
          if (linha.status === 'sugestao' && linha.escolhido) {
            // O mesmo EAN pode aparecer em várias notas (ex: mesmo produto comprado em datas
            // diferentes) — o upsert em lote quebra se o mesmo código aparecer duas vezes no
            // mesmo lote, então mantemos só uma entrada por código.
            vinculosPorCodigo.set(linha.cean, { produtoId: linha.escolhido.id, codigoBarras: linha.cean, origem: 'industrializado' })
          }
        }
      }
      const vinculos = Array.from(vinculosPorCodigo.values())
      await vincularBarcodesEmLote(vinculos)
      await registrarNotasImportadas(notas)

      setResumoFinal({ notas: notas.length, vinculados: vinculos.length })
      setEtapa('concluido')
      setNotas([])
    } catch (err) {
      setErro(err.message)
      setEtapa('pronto')
    }
  }

  const totalParaVincular = notas.reduce((acc, n) => acc + n.linhas.filter((l) => l.status === 'sugestao' && l.escolhido).length, 0)

  return (
    <div className="card">
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Importar XML de NF-e</p>
      <p className="muted" style={{ margin: '0 0 14px' }}>
        Extrai o EAN de cada item e sugere o vínculo com o produto já cadastrado. Aceita vários arquivos <code>.xml</code> ou uma pasta <code>.zip</code>.
      </p>

      <input type="file" accept=".xml,.zip" multiple onChange={handleArquivos} disabled={etapa === 'lendo' || etapa === 'comparando' || etapa === 'salvando'} style={{ marginBottom: 14 }} />

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

      {(etapa === 'lendo' || etapa === 'comparando' || etapa === 'salvando') && (
        <div style={{ marginBottom: 14 }}>
          <p className="muted" style={{ marginBottom: 6 }}>
            {etapa === 'lendo' && `Lendo arquivos: ${progresso.feito}/${progresso.total}`}
            {etapa === 'comparando' && `Comparando com o cadastro: ${progresso.feito}/${progresso.total}`}
            {etapa === 'salvando' && 'Salvando vínculos…'}
          </p>
          <div style={{ background: 'var(--surface-2)', borderRadius: 8, height: 8, overflow: 'hidden' }}>
            <div
              style={{
                background: 'var(--accent)', height: '100%',
                width: progresso.total ? `${Math.round((progresso.feito / progresso.total) * 100)}%` : '30%',
                transition: 'width 0.2s ease'
              }}
            />
          </div>
        </div>
      )}

      {etapa === 'concluido' && resumoFinal && (
        <div style={{ background: 'rgba(48,209,88,0.1)', borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <p style={{ margin: 0, color: 'var(--success)', fontWeight: 500 }}>Importação concluída</p>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {resumoFinal.notas} nota(s) processada(s) · {resumoFinal.vinculados} código(s) de barras vinculado(s)
          </p>
        </div>
      )}

      {etapa === 'pronto' && notas.map((nota, notaIdx) => {
        const linhasComAcao = nota.linhas
          .map((linha, linhaIdx) => ({ linha, linhaIdx }))
          .filter(({ linha }) => linha.status !== 'ja_vinculado' && linha.status !== 'sem_ean')
        const totalIgnorado = nota.linhas.length - linhasComAcao.length

        return (
          <div key={notaIdx} style={{ marginTop: 16, borderTop: '0.5px solid var(--border)', paddingTop: 14 }}>
            <p style={{ margin: '0 0 4px', fontWeight: 500 }}>NF {nota.numeroNota || '—'} {nota.fornecedor ? `· ${nota.fornecedor}` : ''}</p>
            {totalIgnorado > 0 && (
              <p className="muted" style={{ margin: '0 0 10px' }}>
                {totalIgnorado} {totalIgnorado === 1 ? 'item já estava ok' : 'itens já estavam ok'} (já vinculados ou sem EAN) — não precisam de ação.
              </p>
            )}
            {linhasComAcao.length === 0 ? (
              <p className="muted">Nada pra revisar nessa nota.</p>
            ) : (
              linhasComAcao.map(({ linha, linhaIdx }) => (
                <div key={linhaIdx} className="list-item" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <div>
                      <p style={{ margin: 0 }}>{linha.nome}</p>
                      <p className="muted" style={{ margin: 0 }}>EAN {linha.cean} · {linha.unidade}</p>
                    </div>
                    <span className="badge" style={{
                      background: linha.status === 'sugestao' ? 'rgba(10,132,255,0.16)' : 'rgba(255,159,10,0.16)',
                      color: linha.status === 'sugestao' ? '#6cb2ff' : 'var(--warning)'
                    }}>
                      {{ sugestao: 'Sugestão', sem_match: 'Sem correspondência' }[linha.status]}
                    </span>
                  </div>
                  {linha.status === 'sugestao' && (
                    <select value={linha.escolhido?.id || ''} onChange={(e) => {
                      const escolhido = e.target.value ? linha.candidatos.find((c) => c.id === e.target.value) : null
                      handleEscolherCandidato(notaIdx, linhaIdx, escolhido)
                    }} style={{ fontSize: 13 }}>
                      <option value="">— Não vincular esse item —</option>
                      {linha.candidatos.map((c) => (
                        <option key={c.id} value={c.id}>{c.nome} · Everest {c.codigo_everest || '—'}</option>
                      ))}
                    </select>
                  )}
                  {linha.status === 'sem_match' && (
                    <div style={{ width: '100%' }}>
                      <input
                        placeholder="Procurar manualmente no cadastro, ou deixe em branco pra não vincular"
                        value={buscaManual[`${notaIdx}-${linhaIdx}`] || ''}
                        onChange={(e) => setBuscaManual((prev) => ({ ...prev, [`${notaIdx}-${linhaIdx}`]: e.target.value }))}
                        style={{ fontSize: 13 }}
                      />
                      {(buscaManual[`${notaIdx}-${linhaIdx}`] || '').trim().length >= 2 && (
                        <div className="card" style={{ padding: 0, marginTop: 6, maxHeight: 180, overflowY: 'auto' }}>
                          {produtosCache
                            .filter((p) => p.nome.toLowerCase().includes(buscaManual[`${notaIdx}-${linhaIdx}`].toLowerCase()))
                            .slice(0, 8)
                            .map((p) => (
                              <div
                                key={p.id}
                                className="list-item"
                                style={{ padding: '8px 12px', cursor: 'pointer' }}
                                onClick={() => handleEscolherManual(notaIdx, linhaIdx, p)}
                              >
                                <span>{p.nome}</span>
                                <span className="muted">Everest {p.codigo_everest || '—'}</span>
                              </div>
                            ))}
                        </div>
                      )}
                      <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
                        Não encontrou? Tudo bem deixar sem vínculo — esse item simplesmente não entra na atualização.
                      </p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )
      })}

      {etapa === 'pronto' && (
        <button className="primary" onClick={handleConfirmarImportacao} disabled={totalParaVincular === 0} style={{ width: '100%', marginTop: 16 }}>
          {`Confirmar ${totalParaVincular} vínculo(s)`}
        </button>
      )}
    </div>
  )
}
