import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { importarFichasTecnicas, buscarResumoFichasTecnicas } from '../lib/adminApi'
import { formatarMoeda } from '../lib/formato'

// Popup de detalhe da ficha (11/08/2026, pedido do Felipe: a lista em linha era "boa a ideia, mas
// não tão simples" — trocado por card + popup, mesmo padrão visual já usado em Vendas/Painel pro
// nível mais fundo de detalhe) — mostra os insumos que compõem o custo, com o mesmo destaque de
// "fora do cálculo" que já existia inline.
function PopupFicha({ ficha, onClose }) {
  const comConsumo = ficha.ingredientes.filter((ing) => !ing.foraDoCalculo)
  const foraDoCalculo = ficha.ingredientes.filter((ing) => ing.foraDoCalculo)
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
      <div className="card" style={{ maxWidth: 480, width: '100%', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>{ficha.nome}</p>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 12, fontFamily: 'monospace' }}>{ficha.codigo}</p>
          </div>
          <button className="ghost" onClick={onClose} style={{ padding: '4px 10px' }}>Fechar</button>
        </div>

        <div style={{ display: 'flex', gap: 24, margin: '14px 0 4px' }}>
          <div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Custo teórico (1 unidade)</p>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 600, whiteSpace: 'nowrap' }}>{formatarMoeda(ficha.custoTotal)}</p>
          </div>
          <div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Insumos</p>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{comConsumo.length}</p>
          </div>
        </div>

        <p className="muted" style={{ margin: '14px 0 6px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Compõem o custo</p>
        {comConsumo.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>Sem insumos cadastrados.</p>
        ) : comConsumo.map((ing, i) => (
          <div key={i} className="list-item">
            <span style={{ fontSize: 13 }}>{ing.nome}</span>
            <span style={{ whiteSpace: 'nowrap', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{formatarMoeda(ing.custo)}</span>
          </div>
        ))}

        {foraDoCalculo.length > 0 && (
          <>
            <p className="muted" style={{ margin: '16px 0 6px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Fora do cálculo (não é linha "Consumo")
            </p>
            {foraDoCalculo.map((ing, i) => (
              <div key={i} className="list-item" style={{ opacity: 0.55 }}>
                <span className="muted" style={{ fontSize: 12 }}>{ing.nome}</span>
                <span style={{ whiteSpace: 'nowrap', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{formatarMoeda(ing.custo)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// Resumo agrupado por ficha (10/08/2026, pedido do Felipe; redesenhado em 11/08/2026 — grade de
// cards em vez de linha simples, clique abre o detalhe num popup, mesmo padrão visual do resto do
// app pro nível mais fundo). `custoTotal` já é o `custo_producao` calculado no import (linhas de
// "Consumo" já filtradas — ver ehLinhaDeConsumo em adminApi.js).
function ResumoFichasTecnicas({ recarregarChave }) {
  const [resumo, setResumo] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [fichaAberta, setFichaAberta] = useState(null)

  useEffect(() => {
    setCarregando(true)
    buscarResumoFichasTecnicas()
      .then(setResumo)
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [recarregarChave])

  const filtradas = (resumo || []).filter((f) => !busca.trim() || f.nome.toLowerCase().includes(busca.trim().toLowerCase()) || (f.codigo || '').includes(busca.trim()))

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Fichas técnicas cadastradas</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
        Clique numa ficha pra ver os insumos que compõem o custo dela.
      </p>
      <input
        type="text"
        placeholder="Buscar por nome ou código…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        style={{ marginBottom: 14, width: '100%', maxWidth: 320 }}
      />
      {carregando ? (
        <p className="muted">Carregando…</p>
      ) : erro ? (
        <p style={{ color: 'var(--danger)' }}>{erro}</p>
      ) : filtradas.length === 0 ? (
        <p className="muted">Nenhuma ficha técnica encontrada.</p>
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, paddingRight: 2 }}>
          {filtradas.map((f) => {
            const semInsumoNoCalculo = f.ingredientes.filter((ing) => !ing.foraDoCalculo).length === 0 && f.ingredientes.length > 0
            return (
              <div
                key={f.id}
                onClick={() => setFichaAberta(f)}
                style={{
                  cursor: 'pointer',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  transition: 'border-color .15s'
                }}
              >
                <p style={{ margin: 0, fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.nome}>
                  {f.nome}
                </p>
                <p className="muted" style={{ margin: 0, fontSize: 11, fontFamily: 'monospace' }}>{f.codigo}</p>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatarMoeda(f.custoTotal)}</span>
                  <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{f.ingredientes.length} insumo{f.ingredientes.length === 1 ? '' : 's'}</span>
                </div>
                {semInsumoNoCalculo && (
                  <span style={{ fontSize: 11, color: 'var(--warning, #e0a458)' }}>sem linha "Consumo" identificada</span>
                )}
              </div>
            )
          })}
        </div>
      )}
      {fichaAberta && <PopupFicha ficha={fichaAberta} onClose={() => setFichaAberta(null)} />}
    </div>
  )
}

export default function ImportarFichasTecnicas() {
  const [processando, setProcessando] = useState(false)
  const [progresso, setProgresso] = useState(null)
  const [resultados, setResultados] = useState([])
  const [erro, setErro] = useState('')
  const [chaveResumo, setChaveResumo] = useState(0)

  async function handleArquivos(e) {
    const arquivos = Array.from(e.target.files || []).filter((f) => /\.xlsx?$/i.test(f.name))
    if (!arquivos.length) return
    setErro('')
    setResultados([])
    setProcessando(true)
    setProgresso({ feito: 0, total: arquivos.length })
    try {
      const listaResultados = []
      for (let i = 0; i < arquivos.length; i++) {
        const arquivo = arquivos[i]
        try {
          const buffer = await arquivo.arrayBuffer()
          const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
          const resultado = await importarFichasTecnicas(linhas, (p) => setProgresso({ ...p, arquivo: i + 1, totalArquivos: arquivos.length }))
          listaResultados.push({ arquivo: arquivo.name, ...resultado, ok: true })
        } catch (err) {
          listaResultados.push({ arquivo: arquivo.name, ok: false, erro: err.message })
        }
      }
      setResultados(listaResultados)
      setChaveResumo((k) => k + 1)
    } catch (err) {
      setErro(err.message)
    } finally {
      setProcessando(false)
      e.target.value = ''
    }
  }

  const totalFichas = resultados.filter((r) => r.ok).reduce((acc, r) => acc + (r.fichas || 0), 0)
  const totalIngredientes = resultados.filter((r) => r.ok).reduce((acc, r) => acc + (r.ingredientes || 0), 0)
  const totalSemCorrespondencia = resultados.filter((r) => r.ok).reduce((acc, r) => acc + (r.semCorrespondencia || 0), 0)
  const totalSemLinhaConsumo = resultados.filter((r) => r.ok).reduce((acc, r) => acc + (r.fichasSemLinhaConsumo || 0), 0)
  const historicoIndisponivel = resultados.some((r) => r.ok && r.historicoIndisponivel)

  return (
    <div>
      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Importar fichas técnicas</p>
      <p className="muted" style={{ margin: '0 0 14px' }}>
        Sobe o relatório "Ficha Técnica de Produto" do Everest — formato novo, tabular, 1 linha por ingrediente.
        Pode selecionar os dois arquivos de uma vez (DOM e Dalva). Isso vira a base do consumo teórico e do CMV.
      </p>

      <input type="file" accept=".xlsx,.xls" multiple onChange={handleArquivos} disabled={processando} style={{ marginBottom: 14 }} />

      {processando && progresso && (
        <p className="muted">
          Arquivo {progresso.arquivo || 1}/{progresso.totalArquivos || 1} — processando linha {progresso.feito}/{progresso.total}…
        </p>
      )}

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

      {resultados.length > 0 && (
        <>
          <div style={{ background: 'rgba(48,209,88,0.1)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <p style={{ margin: 0, color: 'var(--success)', fontWeight: 500 }}>
              {resultados.filter((r) => r.ok).length} de {resultados.length} arquivo(s) importado(s)
            </p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {totalFichas} ficha(s) técnica(s) · {totalIngredientes} ingrediente(s)
              {totalSemCorrespondencia > 0 && ` · ${totalSemCorrespondencia} sem produto correspondente no cadastro`}
            </p>
          </div>
          {totalSemLinhaConsumo > 0 && (
            <p style={{ color: 'var(--warning, #e0a458)', fontSize: 13, marginBottom: 12 }}>
              {totalSemLinhaConsumo} ficha(s) não tinham nenhuma linha marcada "Consumo" na coluna Tipo de Baixa —
              o custo dessas foi calculado somando todos os insumos (comportamento antigo), o que pode estar
              contando insumo em dobro. Vale revisar essas fichas no Everest.
            </p>
          )}
          {historicoIndisponivel && (
            <p style={{ color: 'var(--warning, #e0a458)', fontSize: 13, marginBottom: 12 }}>
              O histórico de preço (Base de dados → Histórico Ficha Técnica) ainda não está disponível — falta
              rodar <code>migration_v7.sql</code> no SQL Editor do Supabase. A importação em si funcionou normalmente.
            </p>
          )}
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {resultados.map((r, i) => (
              <div key={i} className="list-item">
                <span style={{ fontSize: 13 }}>{r.arquivo}</span>
                {r.ok ? (
                  <span className="muted" style={{ fontSize: 12 }}>{r.fichas} fichas · {r.ingredientes} ingredientes</span>
                ) : (
                  <span style={{ color: 'var(--danger)', fontSize: 12 }}>{r.erro}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      </div>

      <ResumoFichasTecnicas recarregarChave={chaveResumo} />
    </div>
  )
}
