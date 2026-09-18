import { useState } from 'react'
import * as XLSX from 'xlsx'
import { importarNcm } from '../lib/adminApi'

// 03/09/2026 — TELA REPOSTA (§22, entregue em 18/08/2026).
//
// O arquivo original não existe em nenhuma cópia disponível: não subiu pro GitHub (§74) e não
// estava nos zips recuperáveis. Diferente das 5 telas do §75, esta NÃO foi recuperada do bundle —
// foi reescrita em cima de duas coisas concretas: a assinatura real de `importarNcm` em
// `adminApi.js` (que está intacto e é quem faz todo o trabalho) e o padrão das telas de importação
// vizinhas (`ImportarCompras.jsx`). O layout pode não ser idêntico ao que existia; o comportamento
// é, porque a lógica inteira vive na função.
//
// O que `importarNcm` faz (e por isso a tela é simples): lê a planilha sem depender de nome de
// coluna — detecta pelo formato, código de 4-8 dígitos + NCM no padrão 0000.00.00 — e casa por
// `codigo_everest`. Código sem produto correspondente não cria linha nova, só é contado.
//
// ⚠️ Precisa da `migration_v11.sql` (coluna `produtos.ncm`) rodada no Supabase.

export default function ImportarNcm() {
  const [processando, setProcessando] = useState(false)
  const [progresso, setProgresso] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [erro, setErro] = useState('')

  async function handleArquivo(e) {
    const arquivo = e.target.files?.[0]
    if (!arquivo) return
    setProcessando(true)
    setErro('')
    setResultado(null)
    setProgresso(null)
    try {
      const buffer = await arquivo.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true })
      setResultado(await importarNcm(linhas, setProgresso))
    } catch (err) {
      setErro(err.message)
    } finally {
      setProcessando(false)
      // Limpa o input pra permitir reenviar o MESMO arquivo depois de corrigi-lo — sem isso o
      // onChange não dispara na segunda vez e parece que a tela travou.
      e.target.value = ''
    }
  }

  return (
    <div className="card">
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Importar NCM</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
        Planilha com o código Everest e o NCM de cada produto. Não precisa ter nome de coluna
        específico — a leitura reconhece pelo formato (código de 4 a 8 dígitos e NCM no padrão
        0000.00.00). O NCM entra no cadastro do produto e sai na 2ª aba da Exportação contábil.
      </p>

      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={handleArquivo}
        disabled={processando}
        style={{ marginBottom: 14 }}
      />

      {processando && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {progresso ? `Gravando… ${progresso.feito} de ${progresso.total}` : 'Lendo a planilha…'}
        </p>
      )}

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}

      {resultado && (
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Importação concluída</p>
          <p className="muted" style={{ margin: 0 }}>
            {resultado.linhasLidas} linha(s) lida(s) · {resultado.codigosEncontrados} código(s) com NCM
          </p>
          <p style={{ margin: 0 }}>
            <strong>{resultado.atualizados}</strong> produto(s) atualizado(s)
          </p>
          {/* Os dois contadores abaixo são o ponto da tela: dizem o que NÃO entrou, em vez de
              deixar a diferença invisível entre "li 800 linhas" e "gravei 300". */}
          {resultado.semCorrespondencia > 0 && (
            <p className="muted" style={{ margin: 0 }}>
              {resultado.semCorrespondencia} código(s) sem produto correspondente no cadastro — não
              geram produto novo, ficam de fora. Se forem muitos, provavelmente falta reimportar
              Produtos.
            </p>
          )}
          {resultado.linhasIgnoradas > 0 && (
            <p className="muted" style={{ margin: 0 }}>
              {resultado.linhasIgnoradas} linha(s) sem par código + NCM reconhecível (cabeçalho,
              totais, linhas em branco).
            </p>
          )}
        </div>
      )}
    </div>
  )
}
