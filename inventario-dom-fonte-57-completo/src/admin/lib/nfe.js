export function parseNFeXml(textoXml) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(textoXml, 'text/xml')

  const erro = doc.querySelector('parsererror')
  if (erro) throw new Error('XML inválido ou corrompido.')

  const dets = Array.from(doc.getElementsByTagName('det'))
  if (dets.length === 0) throw new Error('Não encontrei itens (tag <det>) nesse XML — é mesmo uma NF-e?')

  const numeroNota = doc.getElementsByTagName('nNF')[0]?.textContent || null
  const fornecedor = doc.querySelector('emit > xNome')?.textContent || null
  const cnpjDestinatario = doc.querySelector('dest > CNPJ')?.textContent || null
  const dataEmissaoBruta = doc.getElementsByTagName('dhEmi')[0]?.textContent || doc.getElementsByTagName('dEmi')[0]?.textContent || null
  const dataEmissao = dataEmissaoBruta ? dataEmissaoBruta.slice(0, 10) : null

  const itens = dets.map((det) => {
    const prod = det.getElementsByTagName('prod')[0]
    const get = (tag) => prod?.getElementsByTagName(tag)[0]?.textContent?.trim() || ''
    const cean = get('cEAN') || get('cEANTrib')
    return {
      cProdFornecedor: get('cProd'),
      nome: get('xProd'),
      cean: cean && cean.toUpperCase() !== 'SEM GTIN' ? cean : null,
      unidade: get('uCom').toLowerCase(),
      quantidade: Number(get('qCom') || 0)
    }
  })

  return { numeroNota, fornecedor, cnpjDestinatario, dataEmissao, itens }
}
