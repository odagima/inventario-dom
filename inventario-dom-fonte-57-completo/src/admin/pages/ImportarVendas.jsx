import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { importarVendasEverest, buscarResumoVendasPorAnoMes, buscarDetalheVendasDoMes } from '../lib/adminApi'
import { formatarMoeda } from '../lib/formato'

const NOMES_MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function formatarDataIso(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR')
}

// Popup do 3º nível (Dia + Loja) — pedido do Felipe: abre os 2 primeiros níveis (Ano/Mês) direto
// na tela, e só o 3º nível (o mais fundo, com mais linhas) vem num popup, carregado na hora do
// clique (não teria sentido puxar dia-a-dia de todo mês só pra montar o resumo Ano/Mês).
function PopupDetalheMes({ ano, mes, onClose }) {
  const [linhas, setLinhas] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    buscarDetalheVendasDoMes(ano, mes)
      .then((r) => { if (vivo) setLinhas(r) })
      .catch((e) => { if (vivo) setErro(e.message) })
    return () => { vivo = false }
  }, [ano, mes])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
      <div className="card" style={{ maxWidth: 480, width: '100%', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>{NOMES_MES[Number(mes) - 1]}/{ano} — por dia e loja</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18 }}>×</button>
        </div>
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{erro}</p>}
        {!erro && !linhas && <p className="muted" style={{ marginTop: 10 }}>Carregando…</p>}
        {linhas && (linhas.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>Sem vendas nesse mês.</p>
        ) : (
          <div style={{ marginTop: 10 }}>
            {linhas.map((l, i) => (
              <div key={i} className="list-item">
                <span className="muted">{formatarDataIso(l.data)} · {l.loja}</span>
                <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatarMoeda(l.valor)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function ResumoVendas() {
  const [resumo, setResumo] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [anoAberto, setAnoAberto] = useState(null)
  const [popup, setPopup] = useState(null) // { ano, mes } | null

  function carregar() {
    setCarregando(true)
    buscarResumoVendasPorAnoMes()
      .then((r) => { setResumo(r); if (r.length) setAnoAberto((a) => a ?? r[0].ano) })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false))
  }

  useEffect(() => { carregar() }, [])

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Resumo do que já foi importado</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
        Por ano e mês — clique num ano pra abrir os meses, e num mês pra ver o detalhe por dia e loja.
      </p>
      {carregando ? (
        <p className="muted">Carregando…</p>
      ) : erro ? (
        <p style={{ color: 'var(--danger)' }}>{erro}</p>
      ) : !resumo?.length ? (
        <p className="muted">Nenhuma venda importada ainda.</p>
      ) : (
        resumo.map((a) => (
          <div key={a.ano} style={{ marginBottom: 6 }}>
            <div
              className="list-item"
              style={{ cursor: 'pointer', fontWeight: 600 }}
              onClick={() => setAnoAberto((cur) => (cur === a.ano ? null : a.ano))}
            >
              <span>{anoAberto === a.ano ? '▾' : '▸'} {a.ano}</span>
              <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatarMoeda(a.valor)}</span>
            </div>
            {anoAberto === a.ano && (
              <div style={{ marginLeft: 18, borderLeft: '1px solid var(--border)', paddingLeft: 10 }}>
                {a.meses.map((m) => (
                  <div
                    key={m.mes}
                    className="list-item"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setPopup({ ano: a.ano, mes: m.mes })}
                  >
                    <span className="muted">{NOMES_MES[Number(m.mes) - 1]}</span>
                    <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatarMoeda(m.valor)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
      {popup && <PopupDetalheMes ano={popup.ano} mes={popup.mes} onClose={() => setPopup(null)} />}
    </div>
  )
}

export default function ImportarVendas() {
  const [processando, setProcessando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState('')
  const [chaveResumo, setChaveResumo] = useState(0)

  async function handleArquivo(e) {
    const arquivo = e.target.files?.[0]
    if (!arquivo) return
    setErro('')
    setResultado(null)
    setProcessando(true)
    try {
      const buffer = await arquivo.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
      const resultadoFinal = await importarVendasEverest(arquivo.name, linhas)
      setResultado(resultadoFinal)
      setChaveResumo((k) => k + 1) // força o resumo abaixo a recarregar com o dado novo
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
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Importar vendas</p>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Sobe o relatório "Vendas Integração PDV" do Everest — formato novo, 1 linha por venda, com data por linha.
          Pode exportar um período grande de uma vez só (o app fatia por mês usando a data de cada linha, não mais
          o nome do arquivo). Reimportar um período que já existe na base <strong>substitui</strong> o que já estava
          lá (nunca soma em cima) — se suspeitar que algum mês foi importado em duplicidade, é só subir o arquivo
          desse período de novo.
        </p>

        <input type="file" accept=".xlsx,.xls" onChange={handleArquivo} disabled={processando} style={{ marginBottom: 14 }} />

        {processando && <p className="muted">Lendo e importando planilha…</p>}

        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

        {resultado && (
          <div style={{ background: 'rgba(48,209,88,0.1)', borderRadius: 10, padding: 12 }}>
            <p style={{ margin: 0, color: 'var(--success)', fontWeight: 500 }}>Importação concluída</p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {resultado.itens} item(ns) · período {resultado.dataInicio || '—'} a {resultado.dataFim || '—'}
              {resultado.canceladas > 0 && ` · ${resultado.canceladas} venda(s) cancelada(s) (guardadas, fora do CMV/faturamento por padrão)`}
              {resultado.semCorrespondencia > 0 && ` · ${resultado.semCorrespondencia} sem produto correspondente no cadastro`}
              {resultado.linhasIgnoradas > 0 && ` · ${resultado.linhasIgnoradas} linha(s) de rodapé/em branco ignoradas`}
            </p>
            {resultado.lotesSubstituidos > 0 && (
              <p style={{ color: 'var(--warning, #e0a458)', fontSize: 13, margin: '6px 0 0' }}>
                {resultado.lotesSubstituidos} importação(ões) anterior(es) que cobriam esse mesmo período ({resultado.itensRemovidos} item(ns))
                foram substituídas por essa — evita contar a mesma venda duas vezes.
              </p>
            )}
          </div>
        )}
      </div>

      <ResumoVendas key={chaveResumo} />
    </div>
  )
}
