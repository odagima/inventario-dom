import { supabase } from './supabase'

// Fornecedores conhecidos (11/10/2026, pedido do Felipe: "liste os fornecedores que tem
// cadastrado... quando fazemos o upload das compras") — não existe uma tabela `fornecedores`
// própria, então a lista vem de quem já apareceu em alguma nota importada (`notas_importadas`,
// preenchida pelo import de Compras/NFe no Admin). `fornecedor` é a razão social; `fantasia` é o
// apelido — Recebimento de Mercadoria busca pelos dois.
export async function listarFornecedoresConhecidos() {
  const { data, error } = await supabase
    .from('notas_importadas')
    .select('fornecedor, fantasia')
    .not('fornecedor', 'is', null)
    .order('data_emissao', { ascending: false })
    .limit(2000)
  if (error) throw error

  const vistos = new Map()
  ;(data || []).forEach((n) => {
    const razaoSocial = n.fornecedor?.trim()
    if (!razaoSocial) return
    const chave = razaoSocial.toLowerCase()
    if (!vistos.has(chave)) vistos.set(chave, { razaoSocial, apelido: n.fantasia?.trim() || null })
  })
  return [...vistos.values()].sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, 'pt-BR'))
}
