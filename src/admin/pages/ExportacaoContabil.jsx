import { useState } from 'react'
import * as XLSX from 'xlsx'
import { buscarResumoContabil, buscarProdutosParaNcm } from '../lib/adminApi'
import { formatarMoeda, formatarPercentual } from '../lib/formato'

// ⚠️ 03/09/2026 — ARQUIVO RECUPERADO DO BUNDLE PUBLICADO (build 54), não do repositório.
//
// Esta tela (§22, entregue em 18/08/2026) nunca subiu pro GitHub: as entregas foram commitadas
// como .zip na raiz do repo em vez de extraídas, então a árvore `src/` versionada congelou em
// 17/08 e este arquivo existia só dentro do zip baixado, que não está mais disponível.
//
// De onde veio cada parte, pra ficar claro o que é dado e o que é reconstrução:
//  - A LÓGICA veio do JS minificado do `dist` 54 servido pelo Cloudflare, que preserva estrutura,
//    strings e nomes de campo (só encurta identificadores locais). Não foi reescrita de memória.
//  - Os NÚMEROS nunca estiveram aqui: vêm inteiros de `buscarResumoContabil` (`adminApi.js`), que
//    está no repositório e não foi tocado. Esta tela escolhe mês/ano, exibe e exporta.
//  - O que não se recupera de minificado são comentários e nomes de variável originais. Os
//    comentários abaixo foram reescritos a partir do §22; se algum contradisser o documento de
//    decisões, o documento vence.
//
// ⚠️ Antes de mandar pro contador: conferir um mês fechado contra a planilha manual antiga. Não por
// suspeita da conta (ela vive em `adminApi.js`, intacta), mas porque este arquivo foi remontado e
// merece uma verificação de ponta a ponta uma vez.

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

// As 5 linhas da planilha do contador, na ordem dela. A chave é o campo que
// `buscarResumoContabil` devolve para cada categoria.
const LINHAS = [
  ['Estoque inicial', 'estoqueInicial'],
  ['(+) Compras', 'compras'],
  ['(-) Estoque final', 'estoqueFinal'],
  ['(=) Custo bruto', 'custoBruto'],
  ['Vendas totais', 'vendas']
]

export default function ExportacaoContabil() {
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [ano, setAno] = useState(new Date().getFullYear())
  const [carregando, setCarregando] = useState(false)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')

  async function calcular() {
    setCarregando(true)
    setErro('')
    try {
      setDados(await buscarResumoContabil(mes, ano))
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  async function exportar() {
    if (!dados) return
    const colunas = [...dados.linhas.map((l) => l.tipo), 'TOTAL']
    // Uma linha da planilha = o mesmo campo lido em cada categoria, mais o total.
    const valores = (campo) => [...dados.linhas.map((l) => l[campo]), dados.total[campo]]

    const aoa = [
      ['CUSTOS A&B — GRUPO D.O.M.', ...Array(colunas.length - 1).fill(null), `${MESES[mes - 1]}/${ano}`],
      [],
      ['', ...colunas],
      ['ESTOQUE INICIAL', ...valores('estoqueInicial')],
      ['(+) COMPRAS', ...valores('compras')],
      ['(-) ESTOQUE FINAL', ...valores('estoqueFinal')],
      ['(=) CUSTO BRUTO', ...valores('custoBruto')],
      ['VENDAS TOTAIS', ...valores('vendas')],
      // Percentual vai como fração (÷100): a célula é lida como porcentagem no Excel, então 32,4
      // cru viraria 3240%.
      ['% CUSTO (CMV)',
        ...dados.linhas.map((l) => (l.percentualCusto == null ? null : l.percentualCusto / 100)),
        dados.total.percentualCusto == null ? null : dados.total.percentualCusto / 100],
      [],
      // Os avisos vão DENTRO da planilha, não só na tela: quem lê é o contador, que não viu a tela
      // e não tem como saber que o número é bruto nem o que ficou de fora.
      [`Fora de Alimentos & Bebidas (não entra no total acima): estoque inicial ${formatarMoeda(dados.linhaSemCategoria?.estoqueInicial)}, compras ${formatarMoeda(dados.linhaSemCategoria?.compras)}, estoque final ${formatarMoeda(dados.linhaSemCategoria?.estoqueFinal)}, vendas ${formatarMoeda(dados.linhaSemCategoria?.vendas)}.`],
      ['Créditos ao custo (perdas, cortesias, consumo interno etc.) ainda não entram nesse cálculo — este é o Custo Bruto, sem descontar nada disso.'],
      [`Comparando com o fechamento de ${MESES[dados.mesAnterior - 1]}/${dados.anoAnterior}.${dados.totalItensSemCusto > 0 ? ` ${dados.totalItensSemCusto} item(ns) contado(s) sem compra recente registrada, ficaram de fora do valor.` : ''}`]
    ]

    const livro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet(aoa), 'Resumo')

    // 2ª aba: NCM. Falhar aqui não pode derrubar a exportação do Resumo, que é o que ele precisa
    // todo mês — a aba de NCM é complemento.
    try {
      const produtos = await buscarProdutosParaNcm()
      const aoaNcm = [
        ['Código Everest', 'Produto', 'NCM'],
        ...produtos.map((p) => [p.codigo_everest, p.nome, p.ncm || ''])
      ]
      XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet(aoaNcm), 'NCM')
    } catch {
      // segue sem a aba de NCM
    }

    XLSX.writeFile(livro, `CMV-Inventario-DOM-${ano}-${String(mes).padStart(2, '0')}.xlsx`)
  }

  const temLinhaSemCategoria = dados?.linhaSemCategoria && (
    dados.linhaSemCategoria.estoqueInicial || dados.linhaSemCategoria.compras ||
    dados.linhaSemCategoria.estoqueFinal || dados.linhaSemCategoria.vendas
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Exportação contábil (CMV por categoria)</p>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
          Estoque Inicial/Final vem do Inventário mensal consolidado; Compras e Vendas do período.
          Agrupado em Alimentos / Bebidas Leves / Bebidas Alcoólicas / Vinhos — mesma classificação
          que já era usada na planilha que você manda pro contador. Ainda não desconta
          perdas/cortesias/consumo interno (ver aviso abaixo da tabela).
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 2, minWidth: 140 }}>
            <label className="muted">Mês</label>
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
              {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label className="muted">Ano</label>
            <select value={ano} onChange={(e) => setAno(Number(e.target.value))}>
              {[new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <button className="primary" onClick={calcular} disabled={carregando} style={{ height: 44 }}>
            {carregando ? 'Calculando…' : 'Calcular'}
          </button>
          {dados && <button onClick={exportar} style={{ height: 44 }}>Exportar Excel</button>}
        </div>
      </div>

      {erro && (
        <div className="card">
          <p style={{ color: 'var(--danger)' }}>{erro}</p>
        </div>
      )}

      {dados && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>{MESES[mes - 1]}/{ano}</p>
          <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>
            Comparando com o fechamento de {MESES[dados.mesAnterior - 1]}/{dados.anoAnterior}
            {dados.totalItensSemCusto > 0 && ` · ${dados.totalItensSemCusto} item(ns) contado(s) sem compra recente registrada (ficaram de fora do valor)`}
            {dados.totalItensOrfaos > 0 && ` (${dados.totalItensOrfaos} deles não existem mais no cadastro atual de Produtos)`}
          </p>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }} />
                {dados.linhas.map((l) => (
                  <th key={l.tipo} style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {l.tipo}
                  </th>
                ))}
                <th style={{ textAlign: 'left', padding: '8px', fontWeight: 600, whiteSpace: 'nowrap' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {LINHAS.map(([rotulo, campo]) => (
                <tr key={campo} style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <td style={{ padding: '8px' }} className="muted">{rotulo}</td>
                  {dados.linhas.map((l) => (
                    <td key={l.tipo} style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarMoeda(l[campo])}</td>
                  ))}
                  <td style={{ padding: '8px', whiteSpace: 'nowrap', fontWeight: 600 }}>{formatarMoeda(dados.total[campo])}</td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: '8px' }} className="muted">% Custo (CMV)</td>
                {dados.linhas.map((l) => (
                  <td key={l.tipo} style={{ padding: '8px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {formatarPercentual(l.percentualCusto)}
                  </td>
                ))}
                <td style={{ padding: '8px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {formatarPercentual(dados.total.percentualCusto)}
                </td>
              </tr>
            </tbody>
          </table>

          {temLinhaSemCategoria ? (
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Fora de Alimentos &amp; Bebidas (limpeza, descartáveis etc. — não entra no total acima):
              estoque inicial {formatarMoeda(dados.linhaSemCategoria.estoqueInicial)}, compras{' '}
              {formatarMoeda(dados.linhaSemCategoria.compras)}, estoque final{' '}
              {formatarMoeda(dados.linhaSemCategoria.estoqueFinal)}, vendas{' '}
              {formatarMoeda(dados.linhaSemCategoria.vendas)}.
            </p>
          ) : null}

          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Créditos ao custo (perdas, cortesias, consumo interno, teste de cozinha, alimentação da
            equipe) ainda não entram nessa conta — o número acima é o Custo Bruto, sem descontar
            nada disso.
          </p>
        </div>
      )}
    </div>
  )
}
