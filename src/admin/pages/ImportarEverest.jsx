import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { importarProdutosEverest, buscarProdutosAdmin } from '../lib/adminApi'

// Busca/filtro dos produtos cadastrados (10/08/2026, pedido do Felipe: "inserir filtro/pesquisa
// pra ver os produtos cadastrados" dentro da própria aba de import — sem precisar ir pra outra
// tela). Reaproveita `buscarProdutosAdmin`, a mesma busca já usada em Consultar tudo (Cadastros).
function BuscaProdutosCadastrados({ recarregarChave }) {
  const [termo, setTermo] = useState('')
  const [produtos, setProdutos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    buscarProdutosAdmin(termo, 0, 'todos')
      .then((r) => { if (vivo) setProdutos(r) })
      .catch((e) => { if (vivo) setErro(e.message) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo, recarregarChave])

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Produtos cadastrados</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
        Busca pelo cadastro que já está na base (o que o import acima atualiza).
      </p>
      <input
        type="text"
        placeholder="Buscar por nome ou código Everest…"
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        style={{ marginBottom: 12, width: '100%', maxWidth: 320 }}
      />
      {carregando ? (
        <p className="muted">Buscando…</p>
      ) : erro ? (
        <p style={{ color: 'var(--danger)' }}>{erro}</p>
      ) : produtos.length === 0 ? (
        <p className="muted">Nenhum produto encontrado.</p>
      ) : (
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {produtos.map((p) => (
            <div key={p.id} className="list-item">
              <span>{p.nome}</span>
              <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{p.codigo_everest} · {p.categoria || '—'}</span>
            </div>
          ))}
          {produtos.length >= 100 && (
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>Mostrando os 100 primeiros — refine a busca pra achar mais rápido.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function ImportarEverest() {
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
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })

      const resultadoFinal = await importarProdutosEverest(linhas, (p) => setProgresso(p))
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
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Importar planilha do Everest</p>
        <p className="muted" style={{ margin: '0 0 14px' }}>
          Sobe o export do Everest (.xlsx) direto aqui — sem terminal, sem instalar nada. Atualiza o cadastro
          pelo código (não duplica), e vincula o código de barras automaticamente se a planilha tiver essa coluna.
        </p>

        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleArquivo} disabled={processando} style={{ marginBottom: 14 }} />

        {processando && (
          <div style={{ marginBottom: 12 }}>
            <p className="muted">
              {progresso
                ? `${progresso.etapa === 'produtos' ? 'Sincronizando produtos' : 'Vinculando códigos de barras'}: ${progresso.feito}/${progresso.total}`
                : 'Lendo planilha…'}
            </p>
          </div>
        )}

        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}

        {resultado && (
          <div style={{ background: 'rgba(48,209,88,0.1)', borderRadius: 10, padding: 12 }}>
            <p style={{ margin: 0, color: 'var(--success)', fontWeight: 500 }}>Importação concluída</p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {resultado.totalProdutos} produtos sincronizados · {resultado.totalBarcodes} códigos de barras vinculados
            </p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {resultado.linhasLidas} linhas lidas do arquivo · {resultado.codigosUnicos} códigos únicos encontrados
            </p>
            {resultado.linhasLidas > resultado.codigosUnicos && (
              <p style={{ color: 'var(--warning)', fontSize: 13, margin: '6px 0 0' }}>
                Atenção: {resultado.linhasLidas - resultado.codigosUnicos} linha(s) tinham código repetido com outra linha —
                só a última de cada código repetido foi salva. Se produtos diferentes estão sumindo, pode ser esse o motivo.
              </p>
            )}
          </div>
        )}
      </div>

      <BuscaProdutosCadastrados recarregarChave={chaveResumo} />
    </div>
  )
}
