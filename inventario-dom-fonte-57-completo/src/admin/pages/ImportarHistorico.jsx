import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { importarContagensHistoricas, contarHistoricoExistente, buscarStatusMensalPorMes, normalizarDataFechamentoMes, migrarHistoricoParaSessoes, contarSessoesMigradas } from '../lib/adminApi'

const NOMES_MES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const LABEL_STATUS = { completo: 'Completo', pendente: 'Pendente', nao_iniciado: 'Não iniciado' }
const COR_STATUS = { completo: 'var(--success)', pendente: 'var(--warning)', nao_iniciado: 'var(--text-tertiary)' }

export default function ImportarHistorico() {
  const [statusMensal, setStatusMensal] = useState([])
  const [carregandoStatus, setCarregandoStatus] = useState(true)
  const [mesAberto, setMesAberto] = useState(null)

  const [arquivoSelecionado, setArquivoSelecionado] = useState(null)
  const [linhasParaImportar, setLinhasParaImportar] = useState(null)
  const [previewDatas, setPreviewDatas] = useState([])
  const [processando, setProcessando] = useState(false)
  const [progresso, setProgresso] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState('')
  const [avisoDuplicidade, setAvisoDuplicidade] = useState(null)
  const inputRef = useRef(null)

  const [sessoesMigradas, setSessoesMigradas] = useState(0)
  const [migrando, setMigrando] = useState(false)
  const [progressoMigracao, setProgressoMigracao] = useState(null)
  const [resultadoMigracao, setResultadoMigracao] = useState(null)
  const [confirmandoMigracao, setConfirmandoMigracao] = useState(false)

  useEffect(() => {
    buscarStatusMensalPorMes().then(setStatusMensal).finally(() => setCarregandoStatus(false))
    contarSessoesMigradas().then(setSessoesMigradas)
  }, [])

  async function handleMigrar() {
    setMigrando(true)
    setProgressoMigracao(null)
    try {
      const resultado = await migrarHistoricoParaSessoes((p) => setProgressoMigracao(p))
      setResultadoMigracao(resultado)
      setSessoesMigradas(await contarSessoesMigradas())
      setConfirmandoMigracao(false)
    } finally {
      setMigrando(false)
    }
  }

  async function handleArquivo(e) {
    const arquivo = e.target.files?.[0]
    if (!arquivo) return
    setErro('')
    setResultado(null)
    setPreviewDatas([])
    setLinhasParaImportar(null)

    try {
      const buffer = await arquivo.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const linhas = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      // Monta a prévia: agrupa por data original, mostra pra qual data de fechamento cada uma vira
      const colData = Object.keys(linhas[0] || {}).find((c) => c.trim().toLowerCase() === 'data e hora')
      const porDataOriginal = new Map()
      if (colData) {
        for (const linha of linhas) {
          const bruta = linha[colData]
          if (!(bruta instanceof Date)) continue
          const chave = bruta.toLocaleDateString('pt-BR')
          if (!porDataOriginal.has(chave)) {
            porDataOriginal.set(chave, { original: chave, ajustada: normalizarDataFechamentoMes(bruta).toLocaleDateString('pt-BR'), total: 0 })
          }
          porDataOriginal.get(chave).total += 1
        }
      }
      setPreviewDatas(Array.from(porDataOriginal.values()).sort((a, b) => a.original.localeCompare(b.original)))
      setLinhasParaImportar(linhas)
      setArquivoSelecionado(arquivo)
    } catch (err) {
      setErro(err.message)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleConfirmarImport() {
    setErro('')
    try {
      const jaExistente = await contarHistoricoExistente()
      if (jaExistente > 0) {
        setAvisoDuplicidade({ quantidadeExistente: jaExistente })
        return
      }
      await processarImport()
    } catch (err) {
      setErro(err.message)
    }
  }

  async function processarImport() {
    setProcessando(true)
    setProgresso(null)
    try {
      const resultadoFinal = await importarContagensHistoricas(linhasParaImportar, (p) => setProgresso(p))
      setResultado(resultadoFinal)
      setPreviewDatas([])
      setLinhasParaImportar(null)
    } catch (err) {
      setErro(err.message)
    } finally {
      setProcessando(false)
      setAvisoDuplicidade(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function cancelarSelecao() {
    setPreviewDatas([])
    setLinhasParaImportar(null)
    setArquivoSelecionado(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Status do inventário mensal</p>
        <p className="muted" style={{ margin: '0 0 14px' }}>Clica num mês pra ver quais lojas já concluíram.</p>

        {carregandoStatus ? (
          <p className="muted">Carregando…</p>
        ) : statusMensal.length === 0 ? (
          <p className="muted">Nenhuma contagem mensal registrada ainda.</p>
        ) : (
          statusMensal.map((m) => {
            const completos = m.lojas.filter((l) => l.status === 'completo').length
            const aberto = mesAberto === m.chave
            return (
              <div key={m.chave} style={{ borderBottom: '0.5px solid var(--border)' }}>
                <div
                  className="list-item"
                  style={{ cursor: 'pointer', borderBottom: 'none' }}
                  onClick={() => setMesAberto(aberto ? null : m.chave)}
                >
                  <span>{NOMES_MES[m.mes - 1]}/{m.ano}</span>
                  <span className="muted">{completos} de {m.lojas.length} lojas</span>
                </div>
                {aberto && (
                  <div style={{ padding: '0 0 12px 4px' }}>
                    {m.lojas.map((l) => (
                      <div key={l.nome} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                        <span>{l.nome}</span>
                        <span style={{ color: COR_STATUS[l.status] }}>{LABEL_STATUS[l.status]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Migrar histórico pro modelo novo</p>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Cria sessões de contagem reais (com loja definida) a partir do histórico antigo, usando o de-para
          de local combinado com você. Isso faz o histórico entrar nas análises por loja (Saldo, CMV, etc).
          Não apaga nada — só adiciona.
        </p>

        {sessoesMigradas > 0 && !resultadoMigracao && (
          <p className="muted" style={{ marginBottom: 10 }}>
            Já existem {sessoesMigradas} sessão(ões) migrada(s) anteriormente.
          </p>
        )}

        {migrando && (
          <p className="muted" style={{ marginBottom: 10 }}>
            {progressoMigracao ? `Migrando: ${progressoMigracao.feito}/${progressoMigracao.total} grupos` : 'Preparando…'}
          </p>
        )}

        {resultadoMigracao && (
          <div style={{ background: 'rgba(48,209,88,0.1)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <p style={{ margin: 0, color: 'var(--success)', fontWeight: 500 }}>Migração concluída</p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {resultadoMigracao.sessoesCriadas} sessão(ões) criada(s) · {resultadoMigracao.itensMigrados} item(ns) migrado(s)
              {resultadoMigracao.itensSemProduto > 0 && ` · ${resultadoMigracao.itensSemProduto} sem produto vinculado`}
              {resultadoMigracao.semMapeamento > 0 && ` · ${resultadoMigracao.semMapeamento} linha(s) com local sem mapeamento`}
            </p>
          </div>
        )}

        {confirmandoMigracao ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmandoMigracao(false)} style={{ flex: 1 }}>Cancelar</button>
            <button className="primary" onClick={handleMigrar} disabled={migrando} style={{ flex: 1 }}>
              {migrando ? 'Migrando…' : 'Confirmar migração'}
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmandoMigracao(true)} style={{ width: '100%' }}>
            {sessoesMigradas > 0 ? 'Migrar de novo' : 'Migrar histórico agora'}
          </button>
        )}
      </div>

      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Importar histórico antigo</p>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Sobe a planilha das contagens de antes do app. As datas são ajustadas automaticamente pro
          fechamento do mês (dia ≥21 ou ≤10 vira o último dia do mês de referência).
        </p>

        <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={handleArquivo} disabled={processando} style={{ marginBottom: 14 }} />

        {previewDatas.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <p className="muted" style={{ marginBottom: 8 }}>Confere se o ajuste de data ficou certo antes de importar:</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '6px', color: 'var(--text-secondary)', fontWeight: 500 }}>Data original</th>
                  <th style={{ textAlign: 'left', padding: '6px', color: 'var(--text-secondary)', fontWeight: 500 }}>Vira</th>
                  <th style={{ textAlign: 'right', padding: '6px', color: 'var(--text-secondary)', fontWeight: 500 }}>Linhas</th>
                </tr>
              </thead>
              <tbody>
                {previewDatas.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '6px' }}>{p.original}</td>
                    <td style={{ padding: '6px', color: 'var(--success)' }}>{p.ajustada}</td>
                    <td style={{ padding: '6px', textAlign: 'right' }}>{p.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={cancelarSelecao} style={{ flex: 1 }}>Cancelar</button>
              <button className="primary" onClick={handleConfirmarImport} style={{ flex: 1 }}>Confirmar e importar</button>
            </div>
          </div>
        )}

        {avisoDuplicidade && (
          <div style={{ background: 'rgba(255,159,10,0.12)', borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <p style={{ margin: '0 0 4px', color: 'var(--warning)', fontWeight: 500 }}>Já existe histórico importado</p>
            <p className="muted" style={{ margin: '0 0 12px' }}>
              Já tem {avisoDuplicidade.quantidadeExistente} linha(s) na base. Importar de novo pode duplicar os itens que já estão lá.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAvisoDuplicidade(null)} style={{ flex: 1 }}>Cancelar</button>
              <button onClick={processarImport} style={{ flex: 1, background: 'var(--warning)', color: '#151515' }}>
                Importar mesmo assim
              </button>
            </div>
          </div>
        )}

        {processando && (
          <p className="muted">{progresso ? `Importando: ${progresso.feito}/${progresso.total}` : 'Lendo planilha…'}</p>
        )}

        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

        {resultado && (
          <div style={{ background: 'rgba(48,209,88,0.1)', borderRadius: 10, padding: 12 }}>
            <p style={{ margin: 0, color: 'var(--success)', fontWeight: 500 }}>Importação concluída</p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {resultado.total} linhas importadas · {resultado.comProduto} vinculadas a um produto do cadastro
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
