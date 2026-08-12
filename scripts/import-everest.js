/**
 * Importa/sincroniza o cadastro de produtos do Everest para o Supabase.
 *
 * O código do item é a chave real — o nome é só um rótulo que pode mudar
 * sem quebrar nada (vínculos de barcode, histórico de contagens, etc.).
 *
 * Uso:
 *   node scripts/import-everest.js caminho/para/export.xlsx
 *   node scripts/import-everest.js caminho/para/export.csv
 *   node scripts/import-everest.js caminho/para/export.tsv
 *
 * Espera as colunas: Item | Descrição do Item | UM
 * (exatamente como sai do export do Everest)
 *
 * Requer variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
 * (as mesmas do .env do app), ou passe via SUPABASE_URL / SUPABASE_ANON_KEY.
 */

import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { readFileSync } from 'fs'
import { extname } from 'path'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Defina SUPABASE_URL e SUPABASE_ANON_KEY (ou VITE_ equivalentes) antes de rodar.')
  process.exit(1)
}

const supabase = createClient(url, key)

const caminho = process.argv[2]
if (!caminho) {
  console.error('Uso: node scripts/import-everest.js caminho/para/export.xlsx')
  process.exit(1)
}

// Faixas de código -> categoria. Ajuste aqui se o Everest mudar a convenção.
function categoriaPorCodigo(codigo) {
  const c = Number(codigo)
  if (!Number.isFinite(c)) return 'outro'
  if (c >= 7000000) return 'equipamento'
  if (c >= 6000000) return 'limpeza_uniforme'
  if (c >= 4000000) return 'pre_preparo'
  if (c >= 3000000) return 'embalagem'
  if (c >= 2000000) return 'insumo'
  return 'venda' // itens de cardápio (pratos, drinks) — não entram na contagem física
}

function lerLinhas(caminho) {
  const ext = extname(caminho).toLowerCase()
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.readFile(caminho)
    const sheet = wb.Sheets[wb.SheetNames[0]]
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })
  }
  // CSV/TSV: detecta separador pela primeira linha
  const texto = readFileSync(caminho, 'utf8')
  const primeiraLinha = texto.split('\n')[0]
  const sep = primeiraLinha.includes('\t') ? '\t' : ','
  return texto.split('\n').filter(Boolean).map((l) => l.split(sep))
}

async function main() {
  const linhas = lerLinhas(caminho)
  const [cabecalho, ...resto] = linhas
  const idxItem = cabecalho.findIndex((c) => c.trim().toLowerCase() === 'item')
  const idxDescricao = cabecalho.findIndex((c) => c.trim().toLowerCase().startsWith('descri'))
  const idxUm = cabecalho.findIndex((c) => c.trim().toLowerCase() === 'um')
  const idxBarcode = cabecalho.findIndex((c) => {
    const t = c.trim().toLowerCase()
    return t.includes('barra') || t.includes('ean') || t.includes('gtin')
  })

  if (idxItem === -1 || idxDescricao === -1 || idxUm === -1) {
    console.error('Não encontrei as colunas Item / Descrição do Item / UM no arquivo.')
    process.exit(1)
  }
  if (idxBarcode === -1) {
    console.log('Nenhuma coluna de código de barras/EAN encontrada — importando só o cadastro (sem vincular barcodes).')
  }

  // Dedup por código — o export do Everest costuma vir com linhas repetidas
  const porCodigo = new Map()
  for (const linha of resto) {
    const codigo = (linha[idxItem] || '').trim()
    const nome = (linha[idxDescricao] || '').trim()
    const um = (linha[idxUm] || '').trim().toLowerCase()
    const barcode = idxBarcode !== -1 ? (linha[idxBarcode] || '').trim() : ''
    if (!codigo || !nome) continue
    porCodigo.set(codigo, { codigo, nome, um, barcode })
  }

  const produtos = Array.from(porCodigo.values()).map((p) => ({
    codigo_everest: p.codigo,
    nome: p.nome,
    unidade_medida: p.um || 'un',
    categoria: categoriaPorCodigo(p.codigo)
  }))

  console.log(`Lidos ${resto.length} linhas → ${produtos.length} produtos únicos por código.`)

  const porCategoria = produtos.reduce((acc, p) => {
    acc[p.categoria] = (acc[p.categoria] || 0) + 1
    return acc
  }, {})
  console.log('Distribuição por categoria:', porCategoria)

  // Upsert em lotes de 500 (limite confortável por request)
  const tamanhoLote = 500
  let atualizados = 0
  for (let i = 0; i < produtos.length; i += tamanhoLote) {
    const lote = produtos.slice(i, i + tamanhoLote)
    const { error } = await supabase
      .from('produtos')
      .upsert(lote, { onConflict: 'codigo_everest' })
    if (error) {
      console.error(`Erro no lote ${i}-${i + lote.length}:`, error.message)
      process.exit(1)
    }
    atualizados += lote.length
    console.log(`${atualizados}/${produtos.length} sincronizados...`)
  }

  // Vincula códigos de barras/EAN vindos do Everest, se a coluna existir.
  if (idxBarcode !== -1) {
    const comBarcode = Array.from(porCodigo.values()).filter((p) => p.barcode)
    console.log(`\n${comBarcode.length} itens com código de barras/EAN no export. Vinculando...`)

    let vinculados = 0
    for (let i = 0; i < comBarcode.length; i += tamanhoLote) {
      const lote = comBarcode.slice(i, i + tamanhoLote)
      const codigosEverest = lote.map((p) => p.codigo)
      const { data: produtosDb, error: erroSelect } = await supabase
        .from('produtos')
        .select('id, codigo_everest')
        .in('codigo_everest', codigosEverest)
      if (erroSelect) {
        console.error('Erro ao buscar produtos pra vincular barcode:', erroSelect.message)
        continue
      }
      const idPorCodigo = new Map(produtosDb.map((p) => [p.codigo_everest, p.id]))
      const barcodesParaSalvar = lote
        .filter((p) => idPorCodigo.has(p.codigo))
        .map((p) => ({
          codigo_barras: p.barcode,
          produto_id: idPorCodigo.get(p.codigo),
          origem: 'industrializado'
        }))
      if (barcodesParaSalvar.length === 0) continue
      const { error: erroBarcode } = await supabase
        .from('barcodes')
        .upsert(barcodesParaSalvar, { onConflict: 'codigo_barras' })
      if (erroBarcode) {
        console.error(`Erro ao vincular lote de barcodes ${i}-${i + lote.length}:`, erroBarcode.message)
        continue
      }
      vinculados += barcodesParaSalvar.length
      console.log(`${vinculados}/${comBarcode.length} barcodes vinculados...`)
    }
  }

  console.log('Importação concluída.')
}

main()
