import { supabase } from './supabase'

// Fornecedores conhecidos (11/10/2026, pedido do Felipe: "liste os fornecedores que tem
// cadastrado... quando fazemos o upload das compras") — não existe uma tabela `fornecedores`
// própria, então a lista vem de quem já apareceu em alguma nota importada (`notas_importadas`,
// preenchida pelo import de Compras/NFe no Admin).
//
// `fantasia`, nessa tabela, é a LOJA de destino da nota (D.O.M., Dalva…), não um apelido do
// fornecedor — Felipe reportou ver "DOM"/"DALVA" aparecendo junto do nome do fornecedor e pediu
// pra tirar (11/10/2026). Só devolve a razão social.
export async function listarFornecedoresConhecidos() {
  const { data, error } = await supabase
    .from('notas_importadas')
    .select('fornecedor')
    .not('fornecedor', 'is', null)
    .order('data_emissao', { ascending: false })
    .limit(2000)
  if (error) throw error

  const vistos = new Set()
  ;(data || []).forEach((n) => {
    const razaoSocial = n.fornecedor?.trim()
    if (razaoSocial) vistos.add(razaoSocial)
  })
  return [...vistos].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
