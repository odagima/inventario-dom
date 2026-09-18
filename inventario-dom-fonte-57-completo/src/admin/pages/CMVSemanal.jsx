import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { listarGruposAdmin, listarDatasContagemPorGrupo, buscarCMVSemanal, buscarContagensDoProduto, buscarVendasDoProduto } from '../lib/adminApi'
import { ultimoTrecho, formatarMoeda } from '../lib/formato'
import { useEscParaFechar } from '../lib/hooks'
import ArvoreDeOrigemView from '../components/ArvoreDeOrigemView'
import { LABEL_MOTIVO_PERDA } from '../../lib/perdas'

// Busca por insumo (13/08/2026, pedido do Felipe — "buscar filet mignon" rápido dentro do grupo já
// calculado, sem acento/caixa importar) e destaque de proteínas (maiores diferenças em R$, pra dar
// pro chefe uma leitura rápida de onde o consumo mais desviou do esperado, sem precisar rolar a
// tabela toda).
const normalizarBusca = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
const LIMITE_DESTAQUE = 3
// 24/08/2026, pedido do Felipe: nova aba "Insumos-chave" (ver mais abaixo) — os insumos de maior
// peso em VALOR NA RECEITA, pra abrir o relatório direto na página sem precisar procurar na tabela
// inteira. Não é um ranking/top-N mostrado pro usuário (ele pediu explicitamente pra não aparecer
// número/posição) — é só um limite técnico de quantos botões oferecer.
const LIMITE_INSUMOS_CHAVE = 10

const num = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
// Cor do "bloco teórico" (§14: marinho). Fica igual no cabeçalho, nas linhas e no total, formando
// um retângulo contínuo que separa visualmente o que vem das vendas do que vem da contagem.
const TEORICO_BG = 'color-mix(in srgb, #1C2B44 8%, transparent)'
const TEORICO_FG = '#1C2B44'

// 27/08/2026 (§43), correção apontada pelo Felipe: um fator de 1,25 significa 80% de
// APROVEITAMENTO (1 ÷ 1,25), não "125%". Mostrar 125% invertia a leitura — parecia que sobrava
// mais do que entrou. Agora o percentual exibido é sempre o aproveitamento, com o multiplicador
// do lado, que é o número que de fato multiplica a quantidade contada.
// 28/08/2026, pedido do Felipe: "o fator de correção ao invés de ser 1... 1,25, coloca em %".
// O multiplicador (1,2478) é o número que a conta usa, mas quem lê a tela raciocina em
// aproveitamento — 80% é imediato, 1,2478 exige traduzir de cabeça. O multiplicador continua
// disponível no `title` (tooltip) e na planilha exportada, pra quem precisa auditar a conta.
const percentualAproveitamento = (fator) => {
  const f = Number(fator)
  if (!Number.isFinite(f) || f <= 0) return '—'
  return `${((1 / f) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

const textoFator = (fator) => {
  const f = Number(fator)
  if (!Number.isFinite(f) || f <= 0) return '—'
  const aproveitamento = (1 / f) * 100
  return `${aproveitamento.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de aproveitamento (×${f.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })})`
}

const formatarNumeroLocal = (v, casas = 1) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

const fmtDia = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('pt-BR') : '—')
// NBSP entre "R$" e o número (não espaço normal) — evita quebra de linha no meio do valor
// em card/coluna estreita (mesmo fix aplicado em formato.js/formatarMoeda, 09/08/2026).
const fmtRS = (n) => n == null ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 27/08/2026 (§44): reescrita para o modelo de grafo. Não existe mais "origem do fator" — a
// quantidade do insumo por unidade do produto É o fator, e vem direto da ficha. O que ainda vale
// dizer é o que exige ação: aproveitamento de 100% na cadeia (a ficha afirma que a etapa não tem
// perda) e produto produzido sem ficha cadastrada.
function MemoriaCalculoFator({ fatorCorrecao }) {
  // 09/09/2026: os avisos de `eloIncompleto` e `terminalPorFaltaDeFicha` foram REMOVIDOS daqui a
  // pedido direto do Felipe ("não quero nenhum alerta ali, você está deixando tudo confuso").
  // O CÁLCULO continua existindo — `eloIncompleto`/`terminalPorFaltaDeFicha` seguem calculados em
  // `adminApi.js` e chegam nesse componente (a prop continua sendo passada pelos dois lugares que
  // chamam `MemoriaCalculoFator`), só não são mais desenhados na tela. Se um dia fizer sentido
  // trazer de volta — num lugar que não seja embaixo de cada linha —, o dado já está disponível,
  // é só reconectar.
  if (!(Number(fatorCorrecao) > 0)) {
    return (
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 10.5 }}>
        A ficha não tem quantidade nessa linha — sem ela não há como converter.
      </p>
    )
  }
  return null
}

// 25/08/2026, pedido do Felipe: "gerar uma planilha simples mostrando como foi feito o cálculo" —
// pra ele conseguir auditar um insumo específico (ex.: filet mignon, 17/08 a 24/08) linha por linha,
// sem depender de mim rodar nada contra o banco ao vivo (este ambiente não tem acesso de rede ao
// Supabase — ver DECISOES-TRAVADAS.md). Gera na hora, no navegador, a partir dos mesmos dados já
// carregados na tela (nenhuma consulta nova) — mesma lib `xlsx` já usada na Exportação contábil.
// 3 abas: Resumo (os números finais), "Vendas (teórico)" (de qual prato veio cada pedaço do
// teórico) e "Contagem (real)" (quais produtos contados geraram o estoque inicial/final) — o mesmo
// detalhe que já existe nas abas Vendas/Contagem do relatório, só que em planilha, linha a linha.
// §65: mesma informação do aviso da tela, em uma célula — pra planilha enviada a terceiro (ou ao
// chefe) não mostrar 100% sem dizer que é lacuna de cadastro.
const textoEloIncompleto = (e) => {
  if (!e) return ''
  const acao = e.motivo === 'ficha_vazia' ? 'ficha no banco sem linha de ingrediente' : 'sem ficha técnica cadastrada'
  const provavel = e.aproveitamentoProvavel > 0 && e.aproveitamentoProvavel <= 100
    ? ` — conferido ficaria ~${e.aproveitamentoProvavel.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
    : ''
  return `ATENÇÃO: 100% não é aproveitamento real. ${e.nome} (${e.codigo}) ${acao}${provavel}`
}

function exportarMemoriaCalculo(item, dados) {
  const aoaResumo = [
    ['Memória de cálculo — CMV Real × Teórico'],
    [`Insumo: ${item.nome}`],
    [`Código Everest: ${item.codigoEverest}${item.subgrupoEverest ? ' · ' + ultimoTrecho(item.subgrupoEverest) : ''} · Unidade: ${item.unidade}`],
    [`Período: estoque inicial ${fmtDia(dados?.dataInicio)} (${dados?.sessoesInicio ?? '—'} sessão(ões)) → estoque final ${fmtDia(dados?.dataFim)} (${dados?.sessoesFim ?? '—'} sessão(ões))`],
    [],
    ['Campo', `Valor (${item.unidade})`],
    ['Estoque inicial', item.estoqueInicial],
    ['(+) Compras', item.compras],
    ['(-) Estoque final', item.estoqueFinal],
    ['(=) Real (consumido)', item.real],
    ['Teórico (esperado pelas fichas técnicas dos pratos vendidos)', item.teorico],
    ['Diferença (teórico − real)', item.diferenca],
    [],
    ['Custo unitário considerado (R$)', item.custoUnitario],
    ['Origem do custo', item.custoOrigem === 'compras' ? 'Média das compras desse insumo no período' : (item.custoOrigem === 'ficha' ? 'Ficha técnica mais recente' : '—')],
    ['Diferença em valor (R$)', item.diferencaValor],
    [],
    ['Desperdício lançado no período (convertido)', item.perda ?? 0],
    ['Desperdício em valor (R$)', item.perdaValor ?? ''],
    ...((item.perdaPorMotivo || []).map((m) => [`   ${LABEL_MOTIVO_PERDA[m.motivo] || m.motivo}`, m.quantidade])),
    ['(o desperdício NÃO está descontado do Real nem da Diferença — mostra qual parte da diferença já tem explicação registrada)'],
    [],
    ['Como é calculado:'],
    ['Real = estoque inicial + compras no período − estoque final (tudo já convertido pro insumo em natura).'],
    ['Teórico = soma, de cada prato vendido no período que usa esse insumo, da quantidade que a ficha técnica do prato prevê consumir (ver aba "Vendas (teórico)").'],
    ['Diferença positiva = consumiu-se MENOS que o teórico previa (economia). Diferença negativa = consumiu-se MAIS (perda/quebra).']
  ]

  const aoaVendas = [
    ['De onde veio o TEÓRICO — pratos vendidos no período que usam esse insumo'],
    [],
    ['Prato', 'Código do prato', 'Qtd. vendida', `Qtd. bruta gerada (${item.unidade})`, `Qtd. líquida gerada (${item.unidade})`, 'Fator de correção', 'Origem do fator', '% do teórico', 'Valor estimado (R$)', 'Aviso'],
    ...(item.pratos || []).map((p) => [
      p.nome, p.codigoPrato, p.quantidadeVendida, p.quantidadeInsumo, p.quantidadeLiquida,
      p.fatorCorrecao, p.fatorOrigem || '—', p.percentualDoTeorico, p.valorEstimado,
      textoEloIncompleto(p.eloIncompleto)
    ])
  ]
  if (item.pratos?.length) {
    aoaVendas.push([])
    aoaVendas.push(['Total de TODOS os pratos (inclusive os que não vieram listados acima, se houver mais de 20)', '', '', item.teorico, item.pratosTotalLiquido])
    if (item.pratosOcultos > 0) aoaVendas.push([`+ ${item.pratosOcultos} prato(s) com menos peso, resumido(s) só no total acima — não listados linha a linha.`])
  } else {
    aoaVendas.push(['Nenhum prato vendido gerou consumo teórico desse insumo nesse período.'])
  }

  const aoaContagem = []
  for (const { campo, titulo, data } of [
    { campo: 'contagemInicial', titulo: 'Estoque inicial', data: dados?.dataInicio },
    { campo: 'contagemFinal', titulo: 'Estoque final', data: dados?.dataFim }
  ]) {
    const lista = item[campo] || []
    aoaContagem.push([`${titulo} — ${fmtDia(data)} (${lista.length} produto(s) contado(s))`])
    aoaContagem.push([])
    aoaContagem.push(['Produto contado', 'Código Everest', 'Qtd. contada', 'Unidade contada', `Qtd. bruta gerada (${item.unidade})`, `Qtd. líquida gerada (${item.unidade})`, 'Fator de correção', 'Origem do fator', 'Aviso'])
    for (const p of lista) {
      aoaContagem.push([p.nome, p.codigoProduto, p.quantidadeContada, p.unidadeProduto, p.quantidadeGerada, p.quantidadeLiquidaGerada, p.fatorCorrecao, p.fatorOrigem || '—', textoEloIncompleto(p.eloIncompleto)])
    }
    if (lista.length === 0) aoaContagem.push(['Nenhum produto contado gerou esse insumo nesse levantamento.'])
    aoaContagem.push([])
  }

  const livro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet(aoaResumo), 'Resumo')
  XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet(aoaVendas), 'Vendas (teorico)')
  XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet(aoaContagem), 'Contagem (real)')

  const nomeArquivo = String(item.nome || item.codigoEverest || 'insumo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  XLSX.writeFile(livro, `memoria-calculo-${nomeArquivo}-${dados?.dataInicio || ''}-a-${dados?.dataFim || ''}.xlsx`)
}

// 24/08/2026 — extraído do popup original pra virar reaproveitável: o mesmo relatório de detalhe
// (valores, diferença em R$, e as abas Vendas/Contagem de "de onde veio") agora é usado tanto
// dentro do popup (aba "Relatório completo", clique na tabela) quanto direto na página (aba "Top
// 10 por valor", sem popup — pedido explícito do Felipe: "o relatório vai ser igual ao popup que
// temos agora... mas agora é o relatório direto na página, sem ser popup"). `onFechar` só é
// passado por quem usa dentro de um popup — quando ausente, não mostra o "×" (não faz sentido
// "fechar" um relatório que já está direto na página).
function DetalheCMV({ item, dados, abaDetalhe, setAbaDetalhe, setDrill, onFechar }) {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>{item.nome}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => exportarMemoriaCalculo(item, dados)} style={{ padding: '4px 10px', fontSize: 11.5 }}>
            Exportar memória de cálculo
          </button>
          {onFechar && <button onClick={onFechar} style={{ background: 'none', border: 'none', fontSize: 18 }}>×</button>}
        </div>
      </div>
      <p className="muted" style={{ margin: '4px 0 14px', fontSize: 12 }}>
        {item.unidade} · {item.codigoEverest}{item.subgrupoEverest ? ` · ${ultimoTrecho(item.subgrupoEverest)}` : ''}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          ['Estoque inicial', num(item.estoqueInicial)],
          ['Compras', num(item.compras)],
          ['Estoque final', num(item.estoqueFinal)],
          ['Real (consumido)', num(item.real)],
          ['Teórico (esperado pelas fichas)', num(item.teorico)]
        ].map(([rotulo, valor]) => (
          <div key={rotulo} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
            <span className="muted">{rotulo}</span>
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{valor} {item.unidade}</span>
          </div>
        ))}

        <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 10, display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
          <span className="muted">Diferença (teórico − real)</span>
          <span style={{
            fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums',
            color: item.diferenca > 0 ? 'var(--success)' : item.diferenca < 0 ? 'var(--danger)' : 'var(--text)'
          }}>
            {item.diferenca > 0 ? '+' : ''}{num(item.diferenca)} {item.unidade}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
          <span className="muted">Diferença em valor</span>
          <span style={{
            fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums',
            color: item.diferencaValor == null ? 'var(--text)' : item.diferencaValor > 0 ? 'var(--success)' : item.diferencaValor < 0 ? 'var(--danger)' : 'var(--text)'
          }}>
            {item.diferencaValor == null ? '—' : (item.diferencaValor > 0 ? '+' : '') + fmtRS(item.diferencaValor)}
          </span>
        </div>

        {/* §55 — DECOMPOSIÇÃO DA DIFERENÇA (28/08/2026, pedido do Felipe: "o desperdício não
            deveria fazer parte da composição da diferença? ... precisa ficar mais fácil de
            entender o cálculo"). A diferença é o que precisa ser EXPLICADO; o desperdício
            lançado é o primeiro pedaço da explicação, quebrado por motivo. O que sobra fica
            explicitamente rotulado como não explicado — em vez de virar um resto invisível.

            ⚠️ Isso é uma leitura da diferença, não uma mudança no cálculo: `real`, `teorico` e
            `diferenca` continuam vindo intactos da API (§55). */}
        {item.perda > 0 && item.diferenca < 0 && (() => {
          const aExplicar = Math.abs(item.diferenca)
          // A perda pode passar da diferença (ex.: consumo abaixo do teórico E perda lançada).
          // Nesse caso não existe "não explicado" — e a barra não pode passar de 100%.
          const explicado = Math.min(item.perda, aExplicar)
          const resto = Math.max(0, aExplicar - item.perda)
          const pct = (x) => (aExplicar > 0 ? Math.round((x / aExplicar) * 1000) / 10 : 0)
          const CORES = { estragado: '#C15A1B', sobra_praca: '#D9A441', erro_preparo: '#8C887E' }
          const linhaMotivo = { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '3px 0' }
          return (
            <div style={{ borderTop: '1px dashed var(--border)', marginTop: 6, paddingTop: 10 }}>
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 11 }}>
                De onde vem essa diferença de {num(aExplicar)} {item.unidade}:
              </p>

              {/* Barra proporcional: quanto da diferença o desperdício lançado já explica. */}
              <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--surface-3)', marginBottom: 10 }}>
                {item.perdaPorMotivo.map((m) => (
                  <div
                    key={m.motivo}
                    title={`${LABEL_MOTIVO_PERDA[m.motivo] || m.motivo}: ${num(m.quantidade)} ${item.unidade}`}
                    style={{ width: `${pct(Math.min(m.quantidade, aExplicar))}%`, background: CORES[m.motivo] || 'var(--warning)' }}
                  />
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, fontWeight: 600 }}>
                <span style={{ color: 'var(--warning)' }}>Desperdício lançado</span>
                <span style={{ whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: 'var(--warning)' }}>
                  {num(item.perda)} {item.unidade}
                  {item.perdaValor != null && <span style={{ fontWeight: 500 }}> · {fmtRS(item.perdaValor)}</span>}
                  <span style={{ fontWeight: 500, opacity: 0.8 }}> · {pct(explicado)}%</span>
                </span>
              </div>

              {/* Motivos indentados, com barra lateral — deixa visualmente óbvio que são
                  subdivisões do desperdício, não itens irmãos da diferença. */}
              <div style={{ paddingLeft: 12, borderLeft: '2px solid var(--border)', margin: '4px 0 8px' }}>
                {item.perdaPorMotivo.map((m) => (
                  <div key={m.motivo} style={linhaMotivo}>
                    <span className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: CORES[m.motivo] || 'var(--warning)', flexShrink: 0 }} />
                      {LABEL_MOTIVO_PERDA[m.motivo] || 'Sem motivo informado'}
                    </span>
                    <span className="muted" style={{ whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {num(m.quantidade)} {item.unidade}
                      {m.valor != null && ` · ${fmtRS(m.valor)}`}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, fontWeight: 600 }}>
                <span>{resto > 0 ? 'Ainda sem explicação' : 'Diferença toda explicada'}</span>
                <span style={{ whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {num(resto)} {item.unidade}
                  <span style={{ fontWeight: 500, opacity: 0.8 }}> · {pct(resto)}%</span>
                </span>
              </div>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
                O desperdício não é abatido do Real nem do Teórico — ele só mostra qual parte da diferença já tem
                explicação registrada. O resto é consumo que o sistema ainda não consegue atribuir.
              </p>
            </div>
          )
        })()}

        {/* Perda lançada num período em que a diferença foi POSITIVA (consumiu-se menos que o
            teórico): não há diferença negativa pra explicar, então mostra o número puro em vez de
            uma decomposição que não faria sentido. */}
        {item.perda > 0 && item.diferenca >= 0 && (
          <div style={{ borderTop: '1px dashed var(--border)', marginTop: 6, paddingTop: 8, display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
            <span className="muted">Desperdício lançado</span>
            <span style={{ fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: 'var(--warning)' }}>
              {num(item.perda)} {item.unidade}
              {item.perdaValor != null && <span style={{ fontWeight: 500 }}> · {fmtRS(item.perdaValor)}</span>}
            </span>
          </div>
        )}

        {item.custoUnitario != null ? (
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>
            Custo considerado: {fmtRS(item.custoUnitario)}/{item.unidade} ({item.custoOrigem === 'compras' ? 'média das compras desse insumo no período' : 'ficha técnica mais recente'}) ·
            diferença positiva = consumimos menos que o teórico (economia) · negativa = consumimos mais (perda, custou mais).
          </p>
        ) : (
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>
            Esse insumo não teve compra no período nem custo cadastrado numa ficha técnica — não dá pra converter a diferença em R$.
          </p>
        )}
      </div>

      {/* De onde veio (13/08/2026, pedido do Felipe — "mapear o que aconteceu com o filet
          mignon no período"): 2 abas dentro do relatório, a pedido do Felipe em 14/08/2026 (3)
          ("faça duas abas... vendas e a outra com os dados da contagem e a memória de
          cálculo... do mesmo jeito que está as vendas") — "Vendas" (de onde veio o TEÓRICO,
          olhando os pratos vendidos, já existia) e "Contagem" (de onde veio o REAL, olhando
          os produtos contados no estoque inicial/final). A memória de cálculo do fator de
          correção é a MESMA lógica nas 2 abas — extraída pro componente `MemoriaCalculoFator`
          (topo do arquivo) pra não duplicar. */}
      {(item.pratos?.length > 0 || item.contagemInicial?.length > 0 || item.contagemFinal?.length > 0) && (
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {[['vendas', 'Vendas'], ['contagem', 'Contagem']].map(([chave, rotulo]) => (
              <button
                key={chave}
                onClick={() => setAbaDetalhe(chave)}
                style={{
                  flex: 1, padding: '6px 0', fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em',
                  border: 'none', borderRadius: 6, cursor: 'pointer',
                  background: abaDetalhe === chave ? 'var(--accent)' : 'var(--surface-2)',
                  color: abaDetalhe === chave ? '#fff' : 'var(--muted)'
                }}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {abaDetalhe === 'vendas' && (
            item.pratos && item.pratos.length > 0 ? (
              <>
                <p className="muted" style={{ margin: '0 0 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  De onde veio o teórico ({item.pratos.length} prato{item.pratos.length > 1 ? 's' : ''})
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {item.pratos.map((p) => (
                    <div key={p.codigoPrato} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px' }}>
                      <button
                        onClick={() => setDrill({ codigo: p.codigoPrato, nome: p.nome, modo: 'vendas' })}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, fontSize: 12.5,
                          width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer'
                        }}
                      >
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nome} <span className="muted" style={{ fontSize: 11 }}>→ ver vendas</span></div>
                          <div className="muted" style={{ fontSize: 11 }}>{num(p.quantidadeVendida)} vendido(s)</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          {p.percentualDoTeorico != null && (
                            <div className="muted" style={{ fontSize: 11 }}>{num(p.percentualDoTeorico)}% do teórico</div>
                          )}
                          {p.valorEstimado != null && <div className="muted" style={{ fontSize: 11 }}>{fmtRS(p.valorEstimado)}</div>}
                        </div>
                      </button>
                      {/* 09/09/2026: "ver transformação" removido daqui também, a pedido do Felipe
                          — não estava sendo útil ("não muda em nada pra mim"). Já tinha sido
                          removido da aba Contagem em 26/08 pelo mesmo motivo; agora as duas abas
                          ficam consistentes. O popup/`ArvoreDeOrigemView` continua existindo no
                          código (`modo: 'transformacao'` em `drill`), só não tem mais link visível
                          nenhum que abra ele — se um dia fizer sentido trazer de volta, é reversível. */}
                      <div style={{ display: 'flex', gap: 14, marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                        <div>
                          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Líquido</div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{num(p.quantidadeLiquida)} {item.unidade}</div>
                        </div>
                        <div>
                          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Aproveitamento</div>
                          <div
                            title={p.fatorCorrecao != null ? `multiplicador ×${num(p.fatorCorrecao)} (bruto ÷ líquido)` : undefined}
                            style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                          >
                            {percentualAproveitamento(p.fatorCorrecao)}
                          </div>
                        </div>
                        <div>
                          <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Bruto</div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{num(p.quantidadeInsumo)} {item.unidade}</div>
                        </div>
                      </div>
                      <MemoriaCalculoFator fatorCorrecao={p.fatorCorrecao} />
                    </div>
                  ))}
                </div>
                {/* 17/08/2026 (3), pedido do Felipe: total somando TODOS os pratos (não só os
                    exibidos acima, que tem um limite de 20) — líquido é campo novo
                    (`pratosTotalLiquido`), bruto é o `teorico` que já existia (mesma soma). */}
                <div style={{ display: 'flex', gap: 14, marginTop: 10, paddingTop: 10, borderTop: '2px solid var(--border)' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}>Total</div>
                  <div>
                    <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Líquido</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{num(item.pratosTotalLiquido)} {item.unidade}</div>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Bruto</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{num(item.teorico)} {item.unidade}</div>
                  </div>
                </div>
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
                  Líquido = o que de fato entra no prato · Fator de correção = bruto ÷ líquido (quanto comprar cru pra sobrar o líquido necessário) · Bruto = o que sai do estoque (já usado no Teórico acima).
                </p>
                {item.pratosOcultos > 0 && (
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
                    + {item.pratosOcultos} outro{item.pratosOcultos > 1 ? 's' : ''} prato{item.pratosOcultos > 1 ? 's' : ''} com menos peso, não mostrado{item.pratosOcultos > 1 ? 's' : ''} aqui.
                  </p>
                )}
              </>
            ) : (
              <p className="muted" style={{ fontSize: 12 }}>Nenhum prato vendido gerou consumo teórico desse insumo nesse período.</p>
            )
          )}

          {/* 14/08/2026 (3), pedido do Felipe — aba nova, espelhando a de Vendas: de onde veio
              o REAL (o que a contagem física registrou), separado em estoque inicial e final
              (as 2 datas exatas escolhidas no topo da tela), com a mesma memória de cálculo. */}
          {abaDetalhe === 'contagem' && (
            <>
              {/* 25/08/2026 (§34). Substitui de vez as duas listas de cards que existiam abaixo
                  (estoque inicial e estoque final separados): uma tabela só, item contado por item
                  contado, com inicial e final LADO A LADO. Cada linha carrega o mesmo detalhe que
                  os cards antigos mostravam (fator de correção, bruto, aviso de fator recalculado)
                  numa segunda linha, e mantém os dois acessos (ver contagens / ver transformação).
                  Colunas a pedido do Felipe: inicial · final · teórico · diferença · diferença R$. */}
              {(() => {
                const listaIni = item.contagemInicial || []
                const listaFim = item.contagemFinal || []
                const porCodigo = new Map()
                const registrar = (lista, campo) => {
                  for (const p of lista) {
                    if (!porCodigo.has(p.codigoProduto)) {
                      porCodigo.set(p.codigoProduto, {
                        codigo: p.codigoProduto, nome: p.nome, unidadeProduto: p.unidadeProduto,
                        inicial: null, final: null, brutoInicial: 0, brutoFinal: 0,
                        fatorCorrecao: p.fatorCorrecao, fatorOrigem: p.fatorOrigem,
                        preparoIntermediario: p.preparoIntermediario, teorico: p.teoricoDoItem,
                        perda: p.perdaDoItem,
                        eloIncompleto: p.eloIncompleto || null // §65
                      })
                    }
                    const g = porCodigo.get(p.codigoProduto)
                    g[campo] = p.quantidadeContada
                    g[campo === 'inicial' ? 'brutoInicial' : 'brutoFinal'] = p.quantidadeGerada || 0
                    if (g.teorico == null && p.teoricoDoItem != null) g.teorico = p.teoricoDoItem
                    if (g.perda == null && p.perdaDoItem != null) g.perda = p.perdaDoItem
                    if (g.fatorCorrecao == null) { g.fatorCorrecao = p.fatorCorrecao; g.fatorOrigem = p.fatorOrigem; g.preparoIntermediario = p.preparoIntermediario }
                    if (!g.eloIncompleto && p.eloIncompleto) g.eloIncompleto = p.eloIncompleto
                  }
                }
                registrar(listaIni, 'inicial')
                registrar(listaFim, 'final')
                const linhas = [...porCodigo.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
                if (!linhas.length) {
                  return <p className="muted" style={{ fontSize: 12 }}>Nenhum produto contado gerou esse insumo nesses levantamentos.</p>
                }
                // 26/08/2026, pedido do Felipe: totais + double check. A soma das linhas em BRUTO
                // (já convertido pro insumo em natura) tem que fechar com os números do insumo no
                // topo do relatório. Se não fechar, algum item contado não está sendo convertido —
                // é exatamente o tipo de furo que a Conferência pegou em §32.
                const unidades = new Set(linhas.map((l) => l.unidadeProduto).filter(Boolean))
                const unidadeUnica = unidades.size === 1 ? [...unidades][0] : null
                const tot = {
                  inicial: linhas.reduce((a, l) => a + (l.inicial || 0), 0),
                  final: linhas.reduce((a, l) => a + (l.final || 0), 0),
                  teorico: linhas.reduce((a, l) => a + (l.teorico || 0), 0),
                  brutoInicial: linhas.reduce((a, l) => a + (l.brutoInicial || 0), 0),
                  brutoFinal: linhas.reduce((a, l) => a + (l.brutoFinal || 0), 0),
                  teoricoBruto: linhas.reduce((a, l) => a + ((l.teorico || 0) * (l.fatorCorrecao || 1)), 0),
                  semTeorico: linhas.filter((l) => l.teorico == null).length,
                  perda: linhas.reduce((a, l) => a + (l.perda || 0), 0)
                }
                tot.difValor = item.custoUnitario != null
                  ? (tot.brutoInicial - tot.brutoFinal - tot.teoricoBruto) * item.custoUnitario
                  : null
                // Tolerância de 0,5% (ou 1 g) — arredondamento de 3 casas em dezenas de linhas não
                // é divergência.
                const confere = (a, b) => {
                  const dif = Math.abs((a || 0) - (b || 0))
                  return dif <= Math.max(0.001, Math.abs(b || 0) * 0.005)
                }
                // 26/08/2026 — o check de TEÓRICO foi REMOVIDO daqui: ele não podia fechar nunca.
                // O teórico do insumo sai das folhas achatadas de cada prato; o teórico por item
                // contado sai dos PPs da cadeia. Como um prato puxa o PP E a folha na mesma ficha,
                // somar os dois níveis conta o mesmo insumo duas vezes — a divergência de 55,601 kg
                // que o Felipe viu era esse artefato, não dado errado. Estoque inicial/final, sim,
                // são somas de coisas independentes e devem fechar (e fechavam).
                const checks = [
                  { rotulo: 'Estoque inicial', somaLinhas: tot.brutoInicial, noRelatorio: item.estoqueInicial },
                  { rotulo: 'Estoque final', somaLinhas: tot.brutoFinal, noRelatorio: item.estoqueFinal }
                ].map((c) => ({ ...c, ok: confere(c.somaLinhas, c.noRelatorio) }))

                const th = { padding: '6px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }
                const td = { padding: '10px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', verticalAlign: 'top' }
                return (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px', fontSize: 12.5 }}>
                      <thead>
                        <tr>
                          <th style={{ ...th, textAlign: 'left' }}>Item contado</th>
                          <th style={{ ...th, textAlign: 'right' }}>Inicial<div style={{ fontWeight: 400, fontSize: 10 }}>{fmtDia(dados?.dataInicio)} · em {item.unidade}</div></th>
                          <th style={{ ...th, textAlign: 'right' }}>Final<div style={{ fontWeight: 400, fontSize: 10 }}>{fmtDia(dados?.dataFim)} · em {item.unidade}</div></th>
                          {/* 26/08/2026, pedido do Felipe: separar visualmente o que foi CONTADO
                              (inicial/final) do que é CONFRONTO com as vendas (teórico e as duas
                              diferenças). A borda vertical marca onde muda a natureza do número:
                              à esquerda, dado físico; à direita, comparação. */}
                          {/* 26/08/2026, pedido do Felipe: o Teórico ganha um retângulo de cor
                              própria (azul marinho da paleta, §14) atravessando cabeçalho, linhas e
                              totais — fica claro que ele vem de OUTRA fonte (as vendas), e não da
                              contagem física à esquerda. */}
                          <th style={{ ...th, textAlign: 'right', background: TEORICO_BG, borderTopLeftRadius: 8, color: TEORICO_FG }}>
                            Teórico<div style={{ fontWeight: 400, fontSize: 10 }}>pelas vendas</div>
                          </th>
                          {/* §55: só aparece quando houve perda lançada no período — coluna vazia
                              em todas as linhas seria só ruído numa tabela já larga. */}
                          {tot.perda > 0 && (
                            <th style={{ ...th, textAlign: 'right' }}>
                              Desperdício<div style={{ fontWeight: 400, fontSize: 10 }}>lançado · em {item.unidade}</div>
                            </th>
                          )}
                          <th style={{ ...th, textAlign: 'right' }}>
                            Diferença<div style={{ fontWeight: 400, fontSize: 10 }}>teórico − real</div>
                          </th>
                          <th style={{ ...th, textAlign: 'right' }}>Diferença (R$)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linhas.map((l) => {
                          // 27/08/2026 (§42), pedido do Felipe: as colunas passam a mostrar o valor
                          // JÁ CONVERTIDO pelo fator de correção — na unidade do insumo. Antes
                          // mostravam a quantidade contada crua, e por isso a coluna não somava no
                          // total (o total sempre foi em unidade de insumo). Conferido: as
                          // convertidas somam exatamente 338,726 e 319,722, os valores do
                          // cabeçalho do relatório. Agora a tabela fecha por dentro.
                          // A quantidade contada não se perde: vai pra sub-linha de cada item.
                          const consumo = (l.brutoInicial || 0) - (l.brutoFinal || 0)
                          const temTeorico = l.teorico != null
                          // Teórico também convertido, senão a subtração misturaria unidades
                          // (teórico em kg de Aparas menos consumo em kg de peça).
                          const teoricoConv = temTeorico ? l.teorico * (l.fatorCorrecao || 1) : null
                          // 26/08/2026 (§36): sinal ALINHADO ao topo do relatório — `teórico − real`.
                          // Antes esta tabela usava `real − teórico`, o inverso, e a mesma palavra
                          // "Diferença" significava coisas opostas em duas partes da MESMA tela.
                          // Com o alinhamento, negativo quer dizer sempre a mesma coisa em todo o
                          // app: consumiu MAIS do que as fichas explicam (perda).
                          const dif = temTeorico ? teoricoConv - consumo : -consumo
                          const difValor = item.custoUnitario != null ? dif * item.custoUnitario : null
                          const soNoFinal = l.inicial == null
                          const soNoInicial = l.final == null
                          // 26/08/2026, pedido do Felipe: destaque do negativo. Aqui negativo =
                          // consumo real ABAIXO do que as vendas pedem (o estoque não caiu o
                          // quanto deveria) — quase sempre contagem incompleta ou teórico inflado.
                          const negativo = difValor != null && difValor < -0.01
                          return (
                            <tr key={l.codigo} style={{
                              background: negativo ? 'color-mix(in srgb, var(--danger) 8%, var(--surface-2))' : 'var(--surface-2)',
                              boxShadow: negativo ? 'inset 3px 0 0 var(--danger)' : 'none'
                            }}>
                              <td style={{ padding: '10px 8px', borderRadius: '8px 0 0 8px', verticalAlign: 'top' }}>
                                <button
                                  onClick={() => setDrill({ codigo: l.codigo, nome: l.nome, modo: 'contagens', fator: l.fatorCorrecao, unidadeItem: l.unidadeProduto })}
                                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontSize: 12.5, fontWeight: 600 }}
                                >
                                  {l.nome} <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>→ ver contagens</span>
                                </button>
                                {/* 26/08/2026: "ver transformação" removido daqui a pedido do Felipe —
                                    nesta tabela o interesse é conferir quantidade, não a receita.
                                    Continua disponível na aba Vendas. */}
                                {/* 26/08/2026, pedido do Felipe. Antes esta linha mostrava "fator
                                    1,25 · bruto 110,22 kg" — e o "bruto" era a DIFERENÇA já
                                    convertida, não o estoque inicial, o que levava a crer que as
                                    colunas Inicial/Final já vinham com o fator aplicado. Não vêm:
                                    Inicial e Final são a quantidade CONTADA, crua, na unidade do
                                    próprio item. Agora a linha mostra o fator em % e o mesmo par
                                    inicial → final já convertido pro insumo, pra dar pra comparar
                                    lado a lado sem adivinhar. */}
                                <div className="muted" style={{ fontSize: 11, marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                                  <span title={l.fatorCorrecao ? `multiplicador ×${num(l.fatorCorrecao)}` : undefined}>
                                    aproveitamento {percentualAproveitamento(l.fatorCorrecao)}
                                  </span>
                                  <span>
                                    contado: {l.inicial == null ? '—' : num(l.inicial)} → {l.final == null ? '—' : num(l.final)} {l.unidadeProduto || ''}
                                  </span>
                                </div>
                                {(soNoInicial || soNoFinal) && (
                                  <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
                                    {soNoInicial ? 'não foi contado no estoque final' : 'não foi contado no estoque inicial'}
                                  </div>
                                )}

                              </td>
                              <td style={td}>{l.inicial == null ? '—' : `${num(l.brutoInicial)} ${item.unidade}`}</td>
                              <td style={td}>{l.final == null ? '—' : `${num(l.brutoFinal)} ${item.unidade}`}</td>
                              <td style={{ ...td, background: TEORICO_BG, color: temTeorico ? TEORICO_FG : 'var(--muted)', fontWeight: temTeorico ? 600 : 400 }}>
                                {temTeorico ? `${num(teoricoConv)} ${item.unidade}` : '—'}
                              </td>
                              {/* §55: quantidade lançada como perda deste item, já convertida pro
                                  insumo (mesmo fator das colunas Inicial/Final). "—" = nada
                                  lançado, que é diferente de zero. */}
                              {tot.perda > 0 && (
                                <td style={{ ...td, color: l.perda ? 'var(--warning)' : 'var(--muted)', fontWeight: l.perda ? 600 : 400 }}>
                                  {l.perda ? `${num(l.perda * (l.fatorCorrecao || 1))} ${item.unidade}` : '—'}
                                </td>
                              )}
                              <td style={{
                                ...td,
                                fontWeight: negativo ? 800 : 600,
                                color: negativo ? 'var(--danger)' : 'var(--text)'
                              }}>
                                {negativo ? '' : dif > 0 ? '+' : ''}{num(dif)} {l.unidadeProduto || ''}
                              </td>
                              <td style={{
                                ...td, borderRadius: '0 8px 8px 0',
                                fontWeight: negativo ? 800 : 600,
                                color: difValor == null ? 'var(--muted)' : negativo ? 'var(--danger)' : 'var(--text)'
                              }}>
                                {difValor != null ? formatarMoeda(difValor) : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        {/* 26/08/2026, pedido do Felipe: total em destaque. Fundo marinho sólido,
                            texto claro, fonte maior — é a linha que resume tudo, não pode parecer
                            só mais uma linha da tabela. */}
                        {/* 26/08/2026 (§36) — TOTAIS REESCRITO. O Felipe achou a divergência:
                            o rodapé dizia −26,107 kg e o topo do relatório −124,777 kg. O rodapé
                            estava errado em três frentes ao mesmo tempo: (1) somava a quantidade
                            CONTADA sem aplicar o fator de correção, (2) ignorava as compras do
                            período, e (3) somava o teórico de vários níveis da cadeia, contando o
                            mesmo insumo mais de uma vez. Somar coluna de tabela cuja unidade muda
                            de linha pra linha nunca ia dar no mesmo número do topo.
                            Agora o total é expresso NA UNIDADE DO INSUMO e usa exatamente os
                            mesmos valores do cabeçalho do relatório — inclusive as compras, que
                            não passam pela contagem. Ele bate com o topo por construção. */}
                        <tr style={{ background: '#1C2B44', color: '#F4F1E9', fontWeight: 700, fontSize: 13.5 }}>
                          <td style={{ padding: '13px 10px', borderRadius: '8px 0 0 8px' }}>
                            TOTAIS <span style={{ fontWeight: 400, opacity: 0.8 }}>em {item.unidade} do insumo</span>
                            <div style={{ fontSize: 10.5, fontWeight: 400, opacity: 0.75 }}>
                              {linhas.length} {linhas.length === 1 ? 'item contado' : 'itens contados'} · soma das colunas acima
                              {item.compras ? ` · a diferença inclui ${num(item.compras)} ${item.unidade} de compras` : ''}
                            </div>
                          </td>
                          <td style={{ ...td, padding: '13px 10px', color: 'inherit' }}>{num(item.estoqueInicial)} {item.unidade}</td>
                          <td style={{ ...td, padding: '13px 10px', color: 'inherit' }}>{num(item.estoqueFinal)} {item.unidade}</td>
                          <td style={{ ...td, padding: '13px 10px', background: 'rgba(244,241,233,0.14)', color: 'inherit', borderBottomLeftRadius: 8 }}>
                            {num(item.teorico)} {item.unidade}
                            {/* O teórico é o único que NÃO é a soma da coluna: o mesmo insumo
                                aparece em vários estágios da cadeia (peça → limpeza → aparas), e
                                somar os estágios contaria ele mais de uma vez. Aqui vale o número
                                do insumo, calculado direto das fichas dos pratos vendidos. */}
                            <div style={{ fontSize: 9.5, fontWeight: 400, opacity: 0.7 }}>não é a soma da coluna</div>
                          </td>
                          {/* §55: total do insumo (vem do cabeçalho, já convertido) — inclui perda
                              de itens que não aparecem nesta tabela, por isso não é a soma da
                              coluna acima. */}
                          {tot.perda > 0 && (
                            <td style={{ ...td, padding: '13px 10px', color: '#F2C879' }}>
                              {num(item.perda)} {item.unidade}
                              <div style={{ fontSize: 9.5, fontWeight: 400, opacity: 0.7 }}>não descontado</div>
                            </td>
                          )}
                          <td style={{ ...td, padding: '13px 10px', color: item.diferenca < 0 ? '#FF9C8A' : 'inherit' }}>{num(item.diferenca)} {item.unidade}</td>
                          <td style={{ ...td, padding: '13px 10px', borderRadius: '0 8px 8px 0', color: item.diferencaValor != null && item.diferencaValor < -0.01 ? '#FF9C8A' : 'inherit' }}>
                            {item.diferencaValor != null ? formatarMoeda(item.diferencaValor) : '—'}
                          </td>
                        </tr>
                      </tfoot>
                    </table>

                    <p className="muted" style={{ margin: '4px 0 10px', fontSize: 11 }}>
                      As linhas estão na unidade de cada item CONTADO (sem fator). O total está na unidade do insumo,
                      já convertido e somando as compras — por isso ele é maior que a soma visual das colunas, e é ele
                      que bate com o cabeçalho do relatório.
                    </p>
                    {!unidadeUnica && (
                      <p className="muted" style={{ margin: '0 0 8px', fontSize: 11 }}>
                        Os itens contados estão em unidades diferentes ({[...unidades].join(', ')}), então somar as colunas
                        de quantidade não faria sentido — os totais aparecem só em R$ e na conferência abaixo, que usa a
                        unidade do insumo em natura ({item.unidade}).
                      </p>
                    )}

                    {/* Double check pedido pelo Felipe (26/08/2026): a soma das linhas, convertida
                        pro insumo em natura, tem que bater com os números do topo do relatório. */}
                    <div className="card" style={{ marginTop: 4, marginBottom: 12, padding: '12px 14px', background: 'transparent', borderColor: checks.every((c) => c.ok) ? 'var(--border)' : 'var(--danger)' }}>
                      <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 13 }}>
                        Conferência {checks.every((c) => c.ok)
                          ? <span style={{ color: 'var(--success)', fontWeight: 700 }}>— fecha ✓</span>
                          : <span style={{ color: 'var(--danger)', fontWeight: 700 }}>— não fecha</span>}
                      </p>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr>
                            <th style={{ ...th, textAlign: 'left' }}></th>
                            <th style={{ ...th, textAlign: 'right' }}>Soma dos itens</th>
                            <th style={{ ...th, textAlign: 'right' }}>No relatório</th>
                            <th style={{ ...th, textAlign: 'right' }}>Dif.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {checks.map((c) => (
                            <tr key={c.rotulo}>
                              <td style={{ padding: '4px 8px' }}>{c.rotulo}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{num(c.somaLinhas)} {item.unidade}</td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{num(c.noRelatorio)} {item.unidade}</td>
                              <td style={{
                                padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                                fontWeight: c.ok ? 400 : 700, color: c.ok ? 'var(--success)' : 'var(--danger)'
                              }}>
                                {c.ok ? '✓' : num(c.somaLinhas - c.noRelatorio)}
                              </td>
                            </tr>
                          ))}
                          <tr>
                            <td style={{ padding: '4px 8px' }} className="muted">(+) Compras no período</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }} className="muted">—</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }} className="muted">{num(item.compras)} {item.unidade}</td>
                            <td style={{ padding: '4px 8px' }}></td>
                          </tr>
                        </tbody>
                      </table>
                      <p className="muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
                        {checks.every((c) => c.ok)
                          ? `Todo item contado está sendo convertido e somado. O "Real" do relatório (${num(item.real)} ${item.unidade}) soma também as compras acima, que não passam pela contagem.`
                          : 'Algum item contado não está entrando na soma do insumo — veja "Conferência dos dados" no topo da tela.'}
                      </p>
                    </div>

                  </>
                )
              })()}

            </>
          )}
        </div>
      )}
    </>
  )
}

// 24/08/2026, pedido do Felipe — reformulado depois do primeiro retorno dele (era "Top 10 por
// valor", com 3 problemas apontados):
// 1) Nome da aba não podia sugerir ranking/contagem → agora "Insumos-chave".
// 2) Critério não pode ser o quanto foi de fato contado/comprado no período (`custoTotalReal`) —
//    isso é ruidoso pra insumo caro com pouco movimento físico no recorte (exemplo dele: filet
//    mignon não aparecia porque o real desse período específico deu baixo, mesmo sendo item
//    presente em toda contagem). O critério certo é o PESO EM VALOR NA RECEITA: usa
//    `custoTotalTeorico` (teórico das fichas dos pratos vendidos × custo unitário) — reflete
//    importância na composição dos pratos, não oscilação de estoque.
// 3) Não é uma lista numerada com valores ao lado — são botões pra escolher (só o nome, sem
//    número/posição/valor no botão), single-select. O relatório completo (valores, diferença etc.)
//    só aparece depois de escolher, no `DetalheCMV` abaixo.
// 25/08/2026, pedido do Felipe: rastrear de onde vem o número contado de um item — toda contagem
// registrada dele, com data, quem contou e quantidade, somando no fim. Substitui o "ver
// transformação" na aba Contagem (que ele avaliou como não fazendo sentido nesse contexto).
// 25/08/2026 (§32), pedido do Felipe: mesma ideia do "ver contagens", do lado das vendas.
// Agrupado por DIA — uma venda de restaurante gera dezenas de linhas por dia (uma por comanda);
// listar comanda a comanda seria ilegível e não ajudaria a conferir nada.
// 25/08/2026 (§32), pedido do Felipe ("achei um item que não apareceu no relatório... podemos
// fazer um double check?"). Reconciliação: de tudo que foi LIDO do banco no período, quanto entrou
// na conta e o que ficou de fora, com o motivo de cada descarte. Começa recolhido — é uma
// ferramenta de auditoria, não o conteúdo principal da tela.
function Conferencia({ conferencia }) {
  // 28/08/2026: SEMPRE fechada. Eu a tinha feito abrir sozinha quando havia descarte; o Felipe
  // pediu de volta ("deixe ela sempre fechada, só abre se eu clicar") — ela empurrava o conteúdo
  // principal da tela pra baixo em todo cálculo, já que quase sempre há algum descarte legítimo.
  const [aberto, setAberto] = useState(false)
  if (!conferencia) return null

  const fontes = [
    { chave: 'contagem', rotulo: 'Contagem', unidadeRotulo: 'produtos contados', totalChave: 'produtosDistintos' },
    { chave: 'compras', rotulo: 'Compras', unidadeRotulo: 'produtos comprados', totalChave: 'produtosDistintos' },
    { chave: 'vendas', rotulo: 'Vendas', unidadeRotulo: 'pratos vendidos', totalChave: 'pratosDistintos' }
  ]
  const totalFora = fontes.reduce((a, f) => a + (conferencia[f.chave]?.descartados?.length || 0), 0)

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: totalFora > 0 ? 'var(--warning, #C15A1B)' : 'var(--border)' }}>
      <button
        onClick={() => setAberto((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        aria-expanded={aberto}
      >
        <span style={{ display: 'inline-block', transition: 'transform 150ms', transform: aberto ? 'rotate(90deg)' : 'none', fontSize: 10 }}>▶</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Conferência dos dados</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {totalFora === 0
            ? '— tudo que foi lido entrou na conta'
            : `— ${totalFora} ${totalFora === 1 ? 'item ficou' : 'itens ficaram'} de fora, com motivo`}
        </span>
      </button>

      {aberto && (
        <div style={{ marginTop: 14 }}>
          <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
            Confere se algum item lido do banco deixou de entrar no cálculo. Ficar de fora nem sempre é erro
            (material de limpeza não vira insumo), mas nada some sem aparecer aqui.
          </p>

          {fontes.map((f) => {
            const c = conferencia[f.chave] || {}
            const descartados = c.descartados || []
            return (
              <div key={f.chave} style={{ marginBottom: 16 }}>
                <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 13 }}>
                  {f.rotulo}
                  <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                    {' '}— {c.lidos || 0} lançamentos lidos · {c[f.totalChave] || 0} {f.unidadeRotulo} ·{' '}
                    <strong>{c.entraram || 0} entraram</strong>
                    {descartados.length > 0 && <> · {descartados.length} fora</>}
                  </span>
                </p>
                {descartados.length === 0 ? (
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>Nada ficou de fora.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <tbody>
                      {descartados.slice(0, 60).map((d, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '5px 8px' }}>
                            {d.nome} <span className="muted">({d.codigo})</span>
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {Number(d.quantidade || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {d.unidade || ''}
                          </td>
                          <td className="muted" style={{ padding: '5px 8px', fontSize: 11 }}>{d.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {descartados.length > 60 && (
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: 11 }}>
                    mostrando os 60 primeiros de {descartados.length}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function VendasDoProduto({ codigo, dataInicio, dataFim }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState('')
  const [soDoPeriodo, setSoDoPeriodo] = useState(true)

  useEffect(() => {
    let vivo = true
    setDados(null); setErro('')
    buscarVendasDoProduto(codigo, soDoPeriodo ? { dataInicio, dataFim } : {})
      .then((r) => { if (vivo) setDados(r) })
      .catch((e) => { if (vivo) setErro(e.message) })
    return () => { vivo = false }
  }, [codigo, soDoPeriodo, dataInicio, dataFim])

  const fq = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fd = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR') : '—')

  if (erro) return <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>
  if (!dados) return <p className="muted" style={{ fontSize: 13 }}>Buscando vendas…</p>

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 10 }}>
        <input type="checkbox" checked={soDoPeriodo} onChange={(e) => setSoDoPeriodo(e.target.checked)} />
        <span>Só o período do relatório <span className="muted">({fd(dataInicio)} a {fd(dataFim)})</span></span>
      </label>

      {dados.linhas.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Nenhuma venda registrada desse item nesse recorte.</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Dia', 'Loja', 'Qtd.', 'Valor'].map((h, i) => (
                  <th key={h} style={{ textAlign: i > 1 ? 'right' : 'left', padding: '6px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map((l, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{fd(l.data)}</td>
                  <td style={{ padding: '6px 8px' }} className="muted">{l.loja || '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fq(l.quantidade)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatarMoeda(l.valor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ padding: '8px', fontWeight: 600 }}>Total · {dados.linhas.length} dia{dados.linhas.length !== 1 ? 's' : ''}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fq(dados.total)}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatarMoeda(dados.totalValor)}</td>
              </tr>
            </tfoot>
          </table>
          {dados.canceladas > 0 && (
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
              {dados.canceladas} venda{dados.canceladas > 1 ? 's' : ''} cancelada{dados.canceladas > 1 ? 's' : ''} no período — fora do total acima, como em todo o resto do sistema.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// 27/08/2026 (§42), pedido do Felipe: o popup passa a mostrar ENTRADA (estoque inicial) e SAÍDA
// (estoque final) na mesma tela, cada lançamento com a quantidade CONTADA e a CONVERTIDA pelo fator
// de correção. Antes mostrava só a data clicada e só a quantidade crua — não dava pra amarrar o
// lançamento com o número que o relatório usa.
function ContagensDoProduto({ codigo, dataInicio, dataFim, grupoId, fator, unidadeItem, unidadeInsumo }) {
  const [entrada, setEntrada] = useState(null)
  const [saida, setSaida] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    setEntrada(null); setSaida(null); setErro('')
    const buscar = (d) => (d ? buscarContagensDoProduto(codigo, { dataInicio: d, dataFim: d, grupoId }) : Promise.resolve({ linhas: [], total: 0 }))
    Promise.all([buscar(dataInicio), buscar(dataFim)])
      .then(([e, sa]) => { if (vivo) { setEntrada(e); setSaida(sa) } })
      .catch((e) => { if (vivo) setErro(e.message) })
    return () => { vivo = false }
  }, [codigo, dataInicio, dataFim, grupoId])

  const fmtQtd = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  const fmtData = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR') : '—')
  const f = Number(fator) > 0 ? Number(fator) : 1

  if (erro) return <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>
  if (!entrada || !saida) return <p className="muted" style={{ fontSize: 13 }}>Buscando contagens…</p>

  const Bloco = ({ titulo, data, dados, cor }) => (
    <div style={{ marginBottom: 18 }}>
      <p style={{ margin: '0 0 6px', fontSize: 12.5, fontWeight: 700, color: cor }}>
        {titulo} <span className="muted" style={{ fontWeight: 400 }}>· {fmtData(data)}</span>
      </p>
      {dados.linhas.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Nenhuma contagem desse item nessa data.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Data</th>
              <th style={{ textAlign: 'left', padding: '5px 8px', color: 'var(--muted)', fontWeight: 600 }}>Quem contou</th>
              <th style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                Contado<div style={{ fontWeight: 400, fontSize: 10 }}>{unidadeItem}</div>
              </th>
              <th style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', background: 'color-mix(in srgb, #1C2B44 7%, transparent)' }}>
                Convertido<div style={{ fontWeight: 400, fontSize: 10 }}>{unidadeInsumo}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {dados.linhas.map((l, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{fmtData(l.data)}</td>
                <td style={{ padding: '6px 8px' }}>{l.usuario}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtQtd(l.quantidade)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', background: 'color-mix(in srgb, #1C2B44 7%, transparent)', fontWeight: 600 }}>
                  {fmtQtd(l.quantidade * f)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ padding: '7px 8px', fontWeight: 700 }}>
                Total · {dados.linhas.length} lançamento{dados.linhas.length !== 1 ? 's' : ''}
              </td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtQtd(dados.total)}</td>
              <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', background: 'color-mix(in srgb, #1C2B44 12%, transparent)' }}>
                {fmtQtd(dados.total * f)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )

  const consumo = (entrada.total - saida.total) * f

  return (
    <div>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 11.5 }}>
        Fator de correção aplicado: <strong>{textoFator(fator)}</strong>
        {Number(fator) === 1 && ' — sem perda registrada nessa etapa; confira a ficha no Everest'}
        {!(Number(fator) > 0) && ' — a ficha não tem as duas quantidades (bruto e líquido) pra calcular'}
      </p>

      <Bloco titulo="ENTRADA — estoque inicial" data={dataInicio} dados={entrada} cor="#5C6E49" />
      <Bloco titulo="SAÍDA — estoque final" data={dataFim} dados={saida} cor="#C15A1B" />

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
        <span style={{ fontWeight: 700 }}>Consumo deste item no período</span>
        <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {fmtQtd(consumo)} {unidadeInsumo}
        </span>
      </div>
      <p className="muted" style={{ margin: '8px 0 0', fontSize: 11 }}>
        Cada linha é um lançamento. O mesmo item contado duas vezes no mesmo dia aparece como duas linhas — é assim que
        se enxerga contagem em duplicidade.
      </p>
    </div>
  )
}

function PainelInsumosChave({ dados, itemSelecionado, selecionar, abaDetalhe, setAbaDetalhe, setDrill }) {
  const insumosChave = useMemo(() => {
    // 28/08/2026 (§47): antes esta lista exigia CUSTO conhecido. Quando a base de compras está
    // vazia (ou o período não tem compra do insumo), nenhum insumo tem custo — e a tela ficava
    // sem NADA pra clicar, escondendo também o relatório completo de cada item. O usuário via
    // "nenhum insumo" e não tinha como investigar justamente quando mais precisava.
    // 28/08/2026: quando NENHUM insumo tem custo, o critério antigo ordenava só pelo teórico — e
    // num período curto, ou sem vendas importadas, o teórico é zero em quase tudo. A ordem virava
    // arbitrária e o insumo principal do grupo (o filet, no caso do Felipe) sumia da lista embora
    // fosse o mais relevante. Agora o desempate soma o movimento FÍSICO (real), que existe mesmo
    // sem venda registrada — e um insumo com movimento nunca fica atrás de um com nada.
    const comCusto = dados.linhas.filter((l) => l.custoTotalTeorico != null && l.custoTotalTeorico > 0.01)
    const peso = (l) => Math.abs(l.teorico || 0) + Math.abs(l.real || 0)
    // 28/08/2026: nada de filtrar por movimento. Um insumo sem movimento no recorte ainda é um
    // insumo do grupo, e escondê-lo faz o usuário concluir que ele "sumiu" — foi o que aconteceu
    // com o filet. Ordena e mostra; quem não tem movimento cai pro fim naturalmente.
    const base = comCusto.length ? comCusto : dados.linhas
    return base
      .slice()
      .sort((a, b) => (comCusto.length
        ? (b.custoTotalTeorico || 0) - (a.custoTotalTeorico || 0)
        : peso(b) - peso(a)))
      .slice(0, LIMITE_INSUMOS_CHAVE)
  }, [dados])

  const semCustoNenhum = !!dados && dados.linhas.length > 0 &&
    !dados.linhas.some((l) => l.custoTotalTeorico != null && l.custoTotalTeorico > 0.01)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
          Insumos-chave desse grupo
        </p>
        <p className="muted" style={{ margin: '-4px 0 10px', fontSize: 11 }}>
          Mostrando {insumosChave.length} de {dados.linhas.length} insumos do grupo — é um recorte dos que mais pesam.
          Para qualquer outro, use a aba <strong>Relatório completo</strong>, que tem busca por nome.
          {dados.linhas.length === 0 && ' Nenhum insumo chegou até aqui: veja a Conferência dos dados acima.'}
        </p>
        {semCustoNenhum && insumosChave.length > 0 && (
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--danger)' }}>
            Nenhum insumo tem custo de compra nesse período — a lista abaixo está ordenada por quantidade teórica, e
            as colunas em R$ vão aparecer vazias. Confira a base de compras em Base de dados → Cobertura de dados.
          </p>
        )}
        {insumosChave.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Nenhum insumo desse grupo teve movimento no período. Abra a "Conferência dos dados" acima para ver o que
            foi lido e por que ficou de fora.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {insumosChave.map((l) => {
              const ativo = itemSelecionado?.codigoEverest === l.codigoEverest
              return (
                <button
                  key={l.codigoEverest}
                  onClick={() => selecionar(l)}
                  style={{
                    border: 'none', borderRadius: 20, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    background: ativo ? 'var(--accent)' : 'var(--surface-2)', color: ativo ? '#fff' : 'var(--text)'
                  }}
                >
                  {l.nome}
                </button>
              )
            })}
          </div>
        )}
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
          Insumos que mais pesam em valor na composição dos pratos vendidos nesse período — não é um ranking do que foi contado. Toque num item pra ver o relatório completo abaixo.
        </p>
      </div>

      {itemSelecionado && (
        <div className="card">
          <DetalheCMV item={itemSelecionado} dados={dados} abaDetalhe={abaDetalhe} setAbaDetalhe={setAbaDetalhe} setDrill={setDrill} onFechar={null} />
        </div>
      )}
    </div>
  )
}

export default function CMVSemanal() {
  const [grupos, setGrupos] = useState([])
  const [grupoId, setGrupoId] = useState('')
  const [datas, setDatas] = useState([])
  const [carregandoDatas, setCarregandoDatas] = useState(false)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [dados, setDados] = useState(null)
  const [calculando, setCalculando] = useState(false)
  const [erro, setErro] = useState('')
  const [subgrupoEverestFiltro, setSubgrupoEverestFiltro] = useState('')
  const [buscaInsumo, setBuscaInsumo] = useState('')
  // §35: isolar as perdas (diferença em R$ negativa = consumo acima do que as vendas justificam).
  const [soNegativos, setSoNegativos] = useState(false)
  const [popup, setPopup] = useState(null) // linha selecionada pro detalhe (aba "Relatório completo")
  // 24/08/2026, pedido do Felipe: a tela ganhou 2 abas de página (não confundir com as abas
  // Vendas/Contagem de dentro do relatório, que continuam existindo) — "Insumos-chave" (item
  // escolhido entre botões, relatório abre direto na página, sem popup) e "Relatório completo" (a
  // tabela inteira de sempre, com busca/filtro, e o relatório continua abrindo em popup ao clicar
  // numa linha — comportamento inalterado).
  const [abaPagina, setAbaPagina] = useState('chave')
  const [itemChave, setItemChave] = useState(null)
  // 14/08/2026 (3), pedido do Felipe: "de onde veio" ganhou 2 abas — Vendas (de onde veio o
  // TEÓRICO, já existia) e Contagem (de onde veio o REAL — estoque inicial/final). Sempre volta
  // pra "Vendas" quando abre um insumo novo, senão fica preso na aba do insumo anterior.
  const [abaDetalhe, setAbaDetalhe] = useState('vendas')
  // 20/08/2026, pedido do Felipe: dentro do "de onde vem" (Vendas/Contagem), poder clicar num
  // prato/produto específico (ex.: "DD PR ALIGOT COM FILET") e ver ELE MESMO se transformando de
  // volta no insumo em natura (mesmo motor da tela "Árvore de origem", §24 do doc de decisões) —
  // sem sair desse popup. `drill` guarda o código/nome do item escolhido; um 2º popup por cima
  // deste renderiza a árvore.
  const [drill, setDrill] = useState(null)

  useEscParaFechar(!!popup, () => setPopup(null))
  useEscParaFechar(!!drill, () => setDrill(null))

  function abrirDetalhe(l) {
    setAbaDetalhe('vendas')
    setDrill(null)
    setPopup(l)
  }

  function selecionarChave(l) {
    setAbaDetalhe('vendas')
    setDrill(null)
    setItemChave(l)
  }

  // Item "atual" pra fins de poda por foco na árvore de origem (§24.1) — depende de qual aba de
  // página está aberta, já que cada uma guarda sua própria seleção (`popup` vs `itemChave`).
  const itemEmFoco = abaPagina === 'chave' ? itemChave : popup

  useEffect(() => {
    // Só grupos ATIVOS aparecem aqui (24/08/2026, pedido do Felipe) — desativar um grupo em
    // Grupos.jsx some com ele desse filtro sem apagar o grupo nem suas contagens já feitas.
    listarGruposAdmin().then((lista) => setGrupos(lista.filter((g) => g.ativo))).catch(() => {})
  }, [])

  useEffect(() => {
    setDados(null)
    setDataInicio('')
    setDataFim('')
    if (!grupoId) { setDatas([]); return }
    setCarregandoDatas(true)
    listarDatasContagemPorGrupo(grupoId)
      .then((lista) => {
        setDatas(lista)
        // Lista vem do mais antigo pro mais novo — sugestão inicial: a data mais recente como
        // "fim", a anterior a ela como "início".
        if (lista.length) setDataFim(lista[lista.length - 1].data)
        if (lista.length > 1) setDataInicio(lista[lista.length - 2].data)
      })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregandoDatas(false))
  }, [grupoId])

  async function calcular() {
    setErro(''); setCalculando(true)
    setSubgrupoEverestFiltro('') // novo cálculo pode ter um conjunto diferente de subgrupos — não mantém filtro de outra consulta
    setBuscaInsumo('')
    setItemChave(null)
    setPopup(null)
    try {
      setDados(await buscarCMVSemanal({ grupoId: grupoId || null, dataInicio: dataInicio || null, dataFim: dataFim || null }))
    } catch (e) {
      setErro(e.message)
    } finally {
      setCalculando(false)
    }
  }

  // Filtro "Subgrupo do Everest" — trocado de "Grupo" pra "Subgrupo" a pedido do Felipe (grupo é
  // muito genérico; subgrupo é mais específico, ex. "CARNES BOVINAS" em vez de só "CARNES"). Só
  // oferece os subgrupos que de fato aparecem no resultado dessa consulta (ex.: se a contagem só
  // tem itens de Proteínas/Secos/Alimentação Funcionário, só os subgrupos desses 3 aparecem pra
  // escolher) — não a lista inteira de subgrupos do Everest cadastrados na empresa toda.
  const opcoesSubgrupoEverest = useMemo(() => {
    if (!dados) return []
    const nomes = new Set(dados.linhas.map((l) => ultimoTrecho(l.subgrupoEverest)).filter(Boolean))
    return Array.from(nomes).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [dados])

  const linhasFiltradas = useMemo(() => {
    if (!dados) return []
    let linhas = dados.linhas
    if (subgrupoEverestFiltro) linhas = linhas.filter((l) => ultimoTrecho(l.subgrupoEverest) === subgrupoEverestFiltro)
    const busca = normalizarBusca(buscaInsumo)
    if (busca) linhas = linhas.filter((l) => normalizarBusca(l.nome).includes(busca) || normalizarBusca(l.codigoEverest).includes(busca))
    if (soNegativos) {
      linhas = linhas.filter((l) => l.diferencaValor != null && l.diferencaValor < -1)
      // Com o filtro ligado, ordena pela MAIOR perda — é a ordem útil quando o objetivo é atacar.
      linhas = linhas.slice().sort((a, b) => a.diferencaValor - b.diferencaValor)
    }
    return linhas
  }, [dados, subgrupoEverestFiltro, buscaInsumo, soNegativos])

  const totalPerdas = useMemo(() => {
    if (!dados) return { qtd: 0, valor: 0 }
    const negativas = dados.linhas.filter((l) => l.diferencaValor != null && l.diferencaValor < -1)
    return { qtd: negativas.length, valor: negativas.reduce((a, l) => a + l.diferencaValor, 0) }
  }, [dados])

  // Destaque (13/08/2026, pedido do Felipe — "enfatizar a proteína"; 14/08/2026, corrigido a pedido
  // dele: o critério certo é IMPACTO NO CUSTO, não a diferença. "Nosso foco é analisar as
  // proteínas, que vão ser o item mais caro do prato" — uma proteína pode bater exatamente o
  // teórico (diferença ~0) e ainda ser, de longe, o insumo que mais pesa no custo do período; a
  // diferença some da lista por completo nesse caso, escondendo justamente o item mais caro.
  // Ranking agora por `custoTotalReal` (Real × custo unitário — o quanto esse insumo custou de
  // fato no período), não por `Math.abs(diferencaValor)`. Considera o conjunto já filtrado por
  // subgrupo/busca, mas ignora linhas sem custo conhecido (não dá pra ranquear sem custo).
  const destaques = useMemo(() => {
    return linhasFiltradas
      .filter((l) => l.custoTotalReal != null && l.custoTotalReal > 0.01)
      .slice()
      .sort((a, b) => b.custoTotalReal - a.custoTotalReal)
      .slice(0, LIMITE_DESTAQUE)
  }, [linhasFiltradas])

  return (
    <div>
      <div className="app-header" style={{ marginBottom: 10 }}>
        <p className="brand">CMV Real × Teórico</p>
        <p className="subtitle">
          Por insumo em natura, entre 2 datas exatas de contagem, dentro de 1 grupo de contagem (ex.: "Proteínas") —
          todas as lojas juntas, já que Compras não separa por loja no Everest. Real = estoque contado na data de
          início + compras no intervalo − estoque contado na data de fim. Teórico = fichas dos pratos vendidos no
          mesmo intervalo que usam algum insumo desse grupo. Conversão pro insumo em natura é automática (regra da
          folha — ver Consolidado da contagem), não depende mais de fator cadastrado manualmente.
        </p>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        <div>
          <label className="muted">Grupo de contagem</label>
          <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)} style={{ width: '100%' }}>
            <option value="">Selecione…</option>
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="muted">Data de início (estoque do começo)</label>
          <select
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            disabled={!grupoId || carregandoDatas || datas.length === 0}
            style={{ width: '100%' }}
          >
            <option value="">— nenhuma —</option>
            {datas.map((d) => (
              <option key={d.data} value={d.data}>{fmtDia(d.data)} · {d.totalSessoes} sessão(ões)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="muted">Data de fim (estoque do fim)</label>
          <select
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            disabled={!grupoId || carregandoDatas || datas.length === 0}
            style={{ width: '100%' }}
          >
            <option value="">— nenhuma —</option>
            {datas.map((d) => (
              <option key={d.data} value={d.data}>{fmtDia(d.data)} · {d.totalSessoes} sessão(ões)</option>
            ))}
          </select>
        </div>
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}
        <button className="primary" onClick={calcular} disabled={calculando || !grupoId || (!dataInicio && !dataFim)}>
          {calculando ? 'Calculando…' : 'Calcular'}
        </button>
      </div>

      {dados && (
        <>
          {/* 24/08/2026, pedido do Felipe: abas de página — "Insumos-chave" (item escolhido entre
              botões, relatório completo abre direto aqui) e "Relatório completo" (tabela inteira +
              busca/filtro, popup ao clicar — igual já era antes). */}
          <div className="segmented" style={{ marginBottom: 16 }}>
            <button className={abaPagina === 'chave' ? 'active' : ''} onClick={() => setAbaPagina('chave')}>Insumos-chave</button>
            <button className={abaPagina === 'completo' ? 'active' : ''} onClick={() => setAbaPagina('completo')}>Relatório completo</button>
          </div>

          <p className="muted" style={{ marginBottom: 16, fontSize: 12 }}>
            Estoque inicial de {fmtDia(dados.dataInicio)} ({dados.sessoesInicio} sessão(ões)) · estoque final de {fmtDia(dados.dataFim)} ({dados.sessoesFim} sessão(ões)) ·
            compras e vendas consideradas de {fmtDia(dados.dataInicio)} a {fmtDia(dados.dataFim)}, restritas aos insumos desse grupo.
          </p>

          <Conferencia conferencia={dados.conferencia} />
        </>
      )}

      {dados && abaPagina === 'chave' && (
        <PainelInsumosChave
          dados={dados}
          itemSelecionado={itemChave}
          selecionar={selecionarChave}
          abaDetalhe={abaDetalhe}
          setAbaDetalhe={setAbaDetalhe}
          setDrill={setDrill}
        />
      )}

      {dados && abaPagina === 'completo' && (
        <>
          <div className="card" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="muted">Buscar insumo (ex.: "filet mignon")</label>
              <input
                type="text"
                value={buscaInsumo}
                onChange={(e) => setBuscaInsumo(e.target.value)}
                placeholder="Digite o nome ou código do insumo…"
                style={{ width: '100%' }}
              />
            </div>
            {opcoesSubgrupoEverest.length > 0 && (
              <div>
                <label className="muted">Filtrar por subgrupo do Everest (opcional)</label>
                <select value={subgrupoEverestFiltro} onChange={(e) => setSubgrupoEverestFiltro(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Todos os subgrupos</option>
                  {opcoesSubgrupoEverest.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            )}
            {/* §35: atalho pra ir direto ao que está custando dinheiro. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={soNegativos} onChange={(e) => setSoNegativos(e.target.checked)} />
              <span>
                Só diferenças negativas (perdas)
                {totalPerdas.qtd > 0 && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {' '}— {totalPerdas.qtd} {totalPerdas.qtd === 1 ? 'insumo' : 'insumos'},{' '}
                    <strong style={{ color: 'var(--danger)' }}>{fmtRS(totalPerdas.valor)}</strong> no período
                  </span>
                )}
              </span>
            </label>
          </div>

          {/* Destaque (ver comentário no useMemo `destaques`) — maiores IMPACTOS NO CUSTO do recorte
              atual (Real × custo unitário), não a diferença — pra dar uma leitura rápida de quais
              insumos mais pesam no bolso antes de ir pra tabela inteira. Some sozinho se não houver
              nenhum insumo com custo conhecido no recorte. */}
          {destaques.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <p className="muted" style={{ margin: '0 0 10px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Maior impacto no custo {subgrupoEverestFiltro ? `· ${subgrupoEverestFiltro}` : buscaInsumo ? '· nesta busca' : 'do período'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {destaques.map((l) => (
                  <button
                    key={l.codigoEverest}
                    onClick={() => abrirDetalhe(l)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, width: '100%',
                      textAlign: 'left', background: 'var(--surface-2)', border: 'none', borderRadius: 8,
                      padding: '10px 12px', fontSize: 13, cursor: 'pointer'
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{l.nome}</span>
                    <span style={{ textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'block', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtRS(l.custoTotalReal)}</span>
                      {l.diferencaValor != null && Math.abs(l.diferencaValor) > 0.01 && (
                        <span className="muted" style={{ fontSize: 11, color: l.diferencaValor > 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {l.diferencaValor > 0 ? '+' : ''}{fmtRS(l.diferencaValor)} dif.
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
                Valor = quanto esse insumo custou de fato no período (Real × custo unitário) — critério de ordenação. "dif." é a diferença teórico−real desse insumo, só como referência (positiva/verde = economia, negativa/vermelho = perda). Toque pra ver o detalhe por prato.
              </p>
            </div>
          )}

          {linhasFiltradas.length === 0 ? (
            <p className="muted">
              {dados.linhas.length === 0
                ? 'Nenhum insumo em natura com movimento no período. Confere se há contagem/compras/vendas no intervalo escolhido.'
                : buscaInsumo
                  ? `Nenhum insumo bate com "${buscaInsumo}" — confere o nome ou tenta limpar a busca.`
                  : 'Nenhum insumo desse subgrupo do Everest no período — tenta "Todos os subgrupos" ou outro filtro.'}
            </p>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <div style={{ minWidth: 660 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(6, 1fr)', gap: 0, fontSize: 11, fontWeight: 600, color: 'var(--muted)', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                  <span>Insumo em natura</span>
                  <span style={{ textAlign: 'right' }}>Est. inic.</span>
                  <span style={{ textAlign: 'right' }}>Compras</span>
                  <span style={{ textAlign: 'right' }}>Est. final</span>
                  <span style={{ textAlign: 'right' }}>Real</span>
                  <span style={{ textAlign: 'right' }}>Teórico</span>
                  {/* 25/08/2026 (§35), pedido do Felipe: "deixa mais em evidência o que estiver
                      negativo". Negativo aqui = consumo real acima do teórico = perda em R$. Era o
                      número mais importante da tela e não aparecia nesta tabela — só dentro do
                      detalhe de cada item. */}
                  <span style={{ textAlign: 'right' }}>Dif. (R$)</span>
                </div>
                {linhasFiltradas.map((l) => {
                  const desvio = l.diferenca
                  const cor = Math.abs(desvio) > Math.max(0.001, Math.abs(l.teorico) * 0.1) ? 'var(--danger)' : 'var(--text)'
                  // Convenção do relatório (já usada no detalhe): diferença = teórico − real, então
                  // NEGATIVO = consumiu mais do que as vendas justificam = perda.
                  const negativo = l.diferencaValor != null && l.diferencaValor < -1
                  return (
                    <button
                      key={l.codigoEverest}
                      onClick={() => abrirDetalhe(l)}
                      style={{
                        display: 'grid', gridTemplateColumns: '1.4fr repeat(6, 1fr)', gap: 0, width: '100%',
                        alignItems: 'center', textAlign: 'left', border: 'none',
                        // Linha inteira tingida quando há perda relevante (> R$ 1) — o olho bate na
                        // linha antes de bater no número.
                        background: negativo ? 'color-mix(in srgb, var(--danger) 9%, transparent)' : 'none',
                        borderBottom: '1px solid var(--border)',
                        borderLeft: negativo ? '3px solid var(--danger)' : '3px solid transparent',
                        padding: '10px 12px', fontSize: 13, cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', gap: 2 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.nome}</span>
                        <span className="muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.unidade} · {l.codigoEverest}{l.subgrupoEverest ? ` · ${ultimoTrecho(l.subgrupoEverest)}` : ''}
                        </span>
                      </div>
                      <span style={{ textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{num(l.estoqueInicial)}</span>
                      <span style={{ textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{num(l.compras)}</span>
                      <span style={{ textAlign: 'right', color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{num(l.estoqueFinal)}</span>
                      <span style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{num(l.real)}</span>
                      <span style={{ textAlign: 'right', fontWeight: 700, color: cor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{num(l.teorico)}</span>
                      <span style={{
                        textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                        fontWeight: negativo ? 800 : 600,
                        color: l.diferencaValor == null ? 'var(--muted)' : l.diferencaValor < 0 ? 'var(--danger)' : 'var(--success)'
                      }}>
                        {l.diferencaValor == null ? '—' : (l.diferencaValor > 0 ? '+' : '') + fmtRS(l.diferencaValor)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {linhasFiltradas.length > 0 && (
            <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
              Real e Teórico são quantidades de insumo em natura consumidas. Diferença grande (Real ≫ Teórico) = consumo
              acima do que as vendas justificam — perda, quebra ou porção fora do padrão. Toque num item pra ver o detalhe
              (estoque inicial/compras/final, e a diferença já em R$ — teórico menos real, então diferença negativa = perda).
            </p>
          )}

          {/* Popup detalhe do item — pedido do Felipe (09/08/2026): ver a estrutura completa (inicial,
              compras, final, real, teórico, diferença) e a diferença já convertida em R$.
              ⚠️ Convenção da diferença (corrigida em 09/08/2026, a pedido do Felipe): TEÓRICO − REAL, não
              o contrário — positiva = consumimos MENOS que o esperado (economia, verde); negativa =
              consumimos MAIS que o esperado (perda/quebra, vermelho). Mesma direção do "Consumo teórico ×
              Venda" em Análise de Custo.
              Custo unitário: preferência pro custo médio de COMPRA do próprio insumo no período (mais
              confiável — é o preço de fato pago, não um retrato antigo de alguma ficha); só cai pro custo
              da ficha técnica (a mais recente, quando o insumo tem custo em mais de uma) quando não teve
              compra direta no período. */}
          {popup && (
            <div onClick={() => setPopup(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
              <div className="card" style={{ maxWidth: 480, width: '100%', maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
                <DetalheCMV item={popup} dados={dados} abaDetalhe={abaDetalhe} setAbaDetalhe={setAbaDetalhe} setDrill={setDrill} onFechar={() => setPopup(null)} />
              </div>
            </div>
          )}
        </>
      )}

      {/* 20/08/2026, pedido do Felipe: popup por cima do popup — "ver transformação" de um
          prato/produto específico, mostrando a Árvore de Origem (§24 do doc de decisões) dele até
          o insumo em natura. Reaproveita o mesmo componente da tela "Árvore de origem", só embutido
          aqui pra não sair do contexto do CMV Semanal. `codigoFoco` usa o item que estiver aberto
          na aba de página ativa (Insumos-chave ou Relatório completo — ver `itemEmFoco`). */}
      {drill && (
        <div onClick={() => setDrill(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 16 }}>
          <div className="card" style={{ maxWidth: (drill.modo === 'contagens' || drill.modo === 'vendas') ? 640 : 520, width: '100%', maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{drill.nome}</p>
                <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>
                  {drill.modo === 'contagens'
                    ? 'Todas as contagens registradas desse item'
                    : drill.modo === 'vendas'
                      ? 'Vendas registradas desse prato, por dia'
                      : 'Como esse item se transforma até o insumo em natura'}
                </p>
              </div>
              <button onClick={() => setDrill(null)} style={{ background: 'none', border: 'none', fontSize: 18 }}>×</button>
            </div>
            <div style={{ marginTop: 12 }}>
              {drill.modo === 'vendas' ? (
                <VendasDoProduto
                  codigo={drill.codigo}
                  dataInicio={dados?.dataInicio || null}
                  dataFim={dados?.dataFim || null}
                />
              ) : drill.modo === 'contagens' ? (
                <ContagensDoProduto
                  codigo={drill.codigo}
                  dataInicio={dados?.dataInicio || null}
                  dataFim={dados?.dataFim || null}
                  grupoId={grupoId || null}
                  fator={drill.fator}
                  unidadeItem={drill.unidadeItem}
                  unidadeInsumo={itemEmFoco?.unidade || ''}
                />
              ) : (
                <ArvoreDeOrigemView codigoEverest={drill.codigo} codigoFoco={itemEmFoco?.codigoEverest} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
