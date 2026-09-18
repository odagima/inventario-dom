import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { importarComprasEverest, buscarResumoComprasPorAnoMesLoja } from '../lib/adminApi'
import { formatarMoeda } from '../lib/formato'

const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function formatarDataIso(iso) {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR')
}

// Resumo Ano → Mês → Loja (10/08/2026, pedido do Felipe) — os 3 níveis abertos inline (sem popup:
// diferente de Vendas, aqui o volume é por nota/loja, bem menor que dia-a-dia de itens vendidos).
function ResumoCompras({ recarregarChave }) {
  const [resumo, setResumo] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [anoAberto, setAnoAberto] = useState(null)
  const [mesAberto, setMesAberto] = useState(null) // "ano|mes"

  useEffect(() => {
    setCarregando(true)
    buscarResumoComprasPorAnoMesLoja()
      .then((r) => { setResumo(r); if (r.length) setAnoAberto((a) => a ?? r[0].ano) })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [recarregarChave])

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Resumo do que já foi importado</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
        Por ano, mês e loja — com a data da última compra de cada loja naquele mês.
      </p>
      {carregando ? (
        <p className="muted">Carregando…</p>
      ) : erro ? (
        <p style={{ color: 'var(--danger)' }}>{erro}</p>
      ) : !resumo?.length ? (
        <p className="muted">Nenhuma compra importada ainda.</p>
      ) : (
        resumo.map((a) => (
          <div key={a.ano} style={{ marginBottom: 6 }}>
            <div className="list-item" style={{ cursor: 'pointer', fontWeight: 600 }} onClick={() => setAnoAberto((cur) => (cur === a.ano ? null : a.ano))}>
              <span>{anoAberto === a.ano ? '▾' : '▸'} {a.ano}</span>
              <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatarMoeda(a.valor)}</span>
            </div>
            {anoAberto === a.ano && (
              <div style={{ marginLeft: 18, borderLeft: '1px solid var(--border)', paddingLeft: 10 }}>
                {a.meses.map((m) => {
                  const chaveMes = `${a.ano}|${m.mes}`
                  return (
                    <div key={m.mes}>
                      <div className="list-item" style={{ cursor: 'pointer' }} onClick={() => setMesAberto((cur) => (cur === chaveMes ? null : chaveMes))}>
                        <span className="muted">{mesAberto === chaveMes ? '▾' : '▸'} {NOMES_MES[Number(m.mes) - 1]}</span>
                        <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatarMoeda(m.valor)}</span>
                      </div>
                      {mesAberto === chaveMes && (
                        <div style={{ marginLeft: 18, borderLeft: '1px solid var(--border)', paddingLeft: 10, marginBottom: 6 }}>
                          {m.lojas.map((l, i) => (
                            <div key={i} className="list-item">
                              <span className="muted" style={{ fontSize: 12 }}>{l.loja} · última compra {formatarDataIso(l.ultimaCompra)}</span>
                              <span style={{ whiteSpace: 'nowrap', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{formatarMoeda(l.valor)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

export default function ImportarCompras() {
  const [processando, setProcessando] = useState(false)
  const [progresso, setProgresso] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState('')
  const [chaveResumo, setChaveResumo] = useState(0)

  async function handleArquivo(e) {
    const arquivo = e.target.files?.[0]
    if (!arquivo) return
    setErro('')
    setResultado(null)
    setProcessando(true)
    setProgresso(null)
    try {
      const buffer = await arquivo.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true })

      const resultadoFinal = await importarComprasEverest(linhas, (p) => setProgresso(p))
      setResultado(resultadoFinal)
      setChaveResumo((k) => k + 1)
    } catch (err) {
      setErro(err.message)
    } finally {
      setProcessando(false)
      e.target.value = ''
    }
  }

  return (
    <div>
      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Importar compras (Everest)</p>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Sobe o relatório "Compras no Período" exportado direto do Everest — o código do item já vem certo
          (sem precisar adivinhar por nome), e a quantidade/custo já vêm convertidos pra unidade de estoque.
          Alimenta o comparativo do Dashboard e o CMV Real.
        </p>

        <input type="file" accept=".xlsx,.xls" onChange={handleArquivo} disabled={processando} style={{ marginBottom: 14 }} />

        {processando && (
          <p className="muted">{progresso ? `Salvando notas: ${progresso.feito}/${progresso.total}` : 'Lendo planilha…'}</p>
        )}

        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

        {resultado && (
          <div style={{ background: 'rgba(48,209,88,0.1)', borderRadius: 10, padding: 12 }}>
            <p style={{ margin: 0, color: 'var(--success)', fontWeight: 500 }}>Importação concluída</p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {resultado.notas} nota(s) · {resultado.itens} item(ns)
              {resultado.semCorrespondencia > 0 && ` · ${resultado.semCorrespondencia} sem produto correspondente no cadastro`}
              {resultado.notasDuplicadas > 0 && ` · ${resultado.notasDuplicadas} nota(s) já existiam e foram ignoradas`}
              {resultado.foraDoSubgrupo > 0 && ` · ${resultado.foraDoSubgrupo} linha(s) fora dos subgrupos relevantes (ignoradas)`}
              {resultado.foraDoCMV > 0 && ` · ${resultado.foraDoCMV} item(ns) marcado(s) "Calcula CMV = Não" (guardados, fora do CMV Real)`}
              {resultado.linhasIgnoradas > 0 && ` · ${resultado.linhasIgnoradas} linha(s) sem N. Nota (rodapé/totais, ignoradas)`}
            </p>
          </div>
        )}
      </div>

      <ResumoCompras recarregarChave={chaveResumo} />
    </div>
  )
}
