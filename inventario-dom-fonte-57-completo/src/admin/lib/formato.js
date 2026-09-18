// Formatação de números no padrão brasileiro (vírgula decimal, ponto de milhar) —
// mesmo padrão já usado em Painel.jsx e Cardapio.jsx, centralizado aqui pra reuso.
// Espaço entre "R$" e o número é NBSP ( ), não espaço normal — evita o navegador
// quebrar a linha bem no meio do valor (ex. "R$" numa linha, "2.281.924,88" na outra),
// que é feio e some com o alinhamento de qualquer card/coluna estreita (09/08/2026).
export function formatarMoeda(valor) {
  const n = Number(valor)
  return 'R$ ' + (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatarNumero(valor, casas = 2) {
  const n = Number(valor)
  return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

export function formatarPercentual(valor, casas = 1) {
  if (valor === null || valor === undefined) return '—'
  const n = Number(valor)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%'
}

// Pedido do Felipe (07/08/2026): as listas de "Grupo" no Painel (CMV) e no cadastro Everest
// costumam vir como "Categoria - Subcategoria" (às vezes com "/") — mostrar a linha inteira
// deixa a coluna desproporcional. Mostra só o último trecho (o nome mais específico); mesma
// ideia já usada em subgrupoDeVenda pro grupo_venda (que separa por "/").
export function ultimoTrecho(valor) {
  if (!valor) return valor
  const partes = String(valor).split(/\s+-\s+|\//).map((p) => p.trim()).filter(Boolean)
  return partes.length ? partes[partes.length - 1] : valor
}
