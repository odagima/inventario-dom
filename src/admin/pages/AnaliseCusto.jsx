import { useEffect, useMemo, useState } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts'
import { buscarCurvaDeVendas, buscarConsumoTeorico, buscarSubgruposDeVenda, LOJAS_VALIDAS, LOJAS_LABEL } from '../lib/adminApi'
import { formatarMoeda, formatarNumero, formatarPercentual } from '../lib/formato'

function primeiroDiaMesAtual() {
  const hoje = new Date()
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
}
function hojeIso() {
  return new Date().toISOString().slice(0, 10)
}

const OPCOES_ORDENACAO_CONSUMO = [
  { id: 'quantidade', label: 'Quantidade' },
  { id: 'valor', label: 'Valor' },
  { id: 'item', label: 'Item' }
]

// 11/08/2026, pedido do Felipe: essa fileira deixou de ser "o" resumo do topo da Curva de Vendas —
// virou o resumo SECUNDÁRIO (só do que tem ficha vinculada), com o faturamento total do período
// (com ou sem ficha) subindo pro topo do card, ao lado do título — ver `ResumoFaturamentoTotal`
// abaixo e o uso em "Curva de vendas (ABC)". `labelFatTotal` deixa o rótulo do 1º número específico
// por tela (Curva: "Faturamento com ficha", pra não confundir com o total do topo; Consumo
// Teórico: mantém "Fat. total", que lá já É o total do período). `percentualFichaExplicado`, quando
// informado, mostra um 4º número — % do FATURAMENTO (não da contagem de itens) já coberto por ficha
// técnica, ver comentário em `buscarCurvaDeVendas`.
function ResumoCabecalho({ totalVendas, totalCustoTeorico, cmvMedio, labelFatTotal = 'Fat. total', percentualFichaExplicado }) {
  return (
    <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', margin: '2px 0 16px' }}>
      <div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>{labelFatTotal}</p>
        <p style={{ margin: 0, fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap' }}>{formatarMoeda(totalVendas)}</p>
      </div>
      <div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Custo total</p>
        <p style={{ margin: 0, fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap' }}>{formatarMoeda(totalCustoTeorico)}</p>
      </div>
      <div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>CMV médio</p>
        <p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{formatarPercentual(cmvMedio)}</p>
      </div>
      {percentualFichaExplicado != null && (
        <div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>% fichas explicadas</p>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{formatarPercentual(percentualFichaExplicado)}</p>
        </div>
      )}
    </div>
  )
}

// Faturamento total do período, independente de ter ficha técnica vinculada ou não — sobe pro
// topo do card (ao lado do título), reage aos mesmos filtros de loja/grupo/data já aplicados na
// busca. Fica visualmente mais forte que o resumo secundário (`ResumoCabecalho`) de propósito: é
// "quanto vendeu de verdade", enquanto o outro é "de quanto eu já sei o custo".
function ResumoFaturamentoTotal({ totalVendas }) {
  return (
    <div style={{ textAlign: 'right', flexShrink: 0 }}>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Faturamento total do período</p>
      <p style={{ margin: 0, fontSize: 20, fontWeight: 700, whiteSpace: 'nowrap' }}>{formatarMoeda(totalVendas)}</p>
    </div>
  )
}

// `formatarMoeda` cai pra "R$ 0,00" em valor null (Number(null) é 0) — bom pra maioria dos casos,
// mas aqui alguns números (custo teórico extrapolado, diferença) ficam null quando não há como
// calcular ainda (0% de fichas explicadas) — mostrar "R$ 0,00" mentiria que o custo é zero. Usa o
// mesmo "—" que `formatarPercentual` já usa pra null.
function formatarMoedaOuTraco(valor) {
  return valor == null ? '—' : formatarMoeda(valor)
}

function MetricaMini({ label, valor, corValor, sub }) {
  return (
    <div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap', color: corValor || 'var(--text)' }}>{valor}</p>
      {sub && <p className="muted" style={{ margin: '2px 0 0', fontSize: 11, whiteSpace: 'nowrap' }}>{sub}</p>}
    </div>
  )
}

// 11/08/2026, pedido do Felipe: virou "um mini resumo/dash" — o espaço que antes só tinha o
// resumo secundário (Faturamento com ficha/Custo total/CMV médio/% fichas explicadas) ganhou uma
// 2ª fileira com 3 números novos, direto do que ele pediu:
// (1) Custo teórico TOTAL do período (estimado) — em destaque, é `custo total ÷ % fichas
//     explicadas`: projeta o custo teórico pro faturamento inteiro (com ou sem ficha), assumindo
//     que o resto do cardápio tem, em média, o mesmo CMV% do que já foi medido nos itens com FT.
//     Continua respeitando os filtros de loja/grupo (é o custo do que está sendo visto na tela).
// (2) Compras (CMC) do mesmo período + o que isso representaria como % do faturamento.
//     12/08/2026, pedido do Felipe ("o cmc tem mudado conforme o filtro de loja... deixar o cmc
//     apenas com filtro de período, desativar os outros filtros"): CMC agora SEMPRE soma a empresa
//     toda (DOM + Dalva) no período — loja e grupo não afetam mais esse número (ver comentário
//     completo em `buscarCurvaDeVendas`). O aviso de "bloco Dalva" (que existia quando CMC ainda
//     seguia o filtro de loja) não existe mais — no lugar, avisa quando a comparação com o custo
//     teórico (que SEGUE o filtro) fica parcial, ver `curva.comparacaoParcialPorFiltro` abaixo.
// (3) Diferença (Custo teórico projetado − Compras) — é o "custo perdido": positiva = compramos
//     menos do que o teórico projetado precisaria (economia, verde); negativa = compramos mais do
//     que o teórico explica — quebra/perda/desperdício que a ficha não captura (vermelho).
function ResumoDashboardCurva({ curva, loja, subgrupo }) {
  const diferenca = curva.diferencaCustoPerdido
  const corDiferenca = diferenca == null ? 'var(--text)' : diferenca >= 0 ? 'var(--success)' : 'var(--danger)'
  return (
    <div style={{ margin: '2px 0 16px', padding: '14px 18px', borderRadius: 12, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        <MetricaMini label="Faturamento com ficha" valor={formatarMoeda(curva.totalVendasComFicha)} />
        <MetricaMini label="Custo total" valor={formatarMoeda(curva.totalCustoTeoricoComFicha)} />
        <MetricaMini label="CMV médio" valor={formatarPercentual(curva.cmvMedioComFicha)} />
        <MetricaMini label="% fichas explicadas" valor={formatarPercentual(curva.percentualFichaExplicado)} />
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ padding: '4px 16px', borderRadius: 10, background: 'var(--accent-soft)' }}>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Custo teórico total (estimado)</p>
          <p style={{ margin: 0, fontSize: 24, fontWeight: 700, whiteSpace: 'nowrap' }}>{formatarMoedaOuTraco(curva.custoTeoricoExtrapolado)}</p>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 11, maxWidth: 220, lineHeight: 1.4 }}>Custo total ÷ % fichas explicadas — projeta o custo pro faturamento inteiro do período</p>
        </div>
        <MetricaMini
          label="Compras no período (CMC)"
          valor={formatarMoeda(curva.comprasPeriodo)}
          sub={`${formatarPercentual(curva.cmcPercentual)} do faturamento total · empresa toda`}
        />
        <MetricaMini
          label="Diferença (custo perdido)"
          valor={formatarMoedaOuTraco(diferenca)}
          corValor={corDiferenca}
          sub="Teórico − Compras · negativo = perda/quebra"
        />
      </div>

      {curva.comparacaoParcialPorFiltro && (
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          ⚠ Compras (CMC) só respeita o período — não muda com o filtro de loja/grupo, é sempre a empresa toda. Como
          {loja ? ` a loja ${LOJAS_LABEL[loja]}` : ''}{loja && subgrupo ? ' e' : ''}{subgrupo ? ` o grupo ${subgrupo}` : ''} está ativo, a
          Diferença acima compara um recorte (custo teórico só desse filtro) com o total da empresa — não é uma comparação
          de mesma base. Pra comparar com precisão, tire os filtros de loja/grupo (deixe "Todas"/"Todos").
        </p>
      )}
    </div>
  )
}

// Farol de 3 níveis (10/08/2026, pedido do Felipe): vermelho acima de 35% (alto), amarelo entre
// 28% e 34% (atenção), verde abaixo de 28% (ok) — só 3 cores semânticas já usadas no resto do
// app (danger/warning/success), sem virar arco-íris. Bolinha + palavra curta, mesmo idioma visual
// dos pontinhos coloridos já usados no Painel/Cobertura.
const FAROL_INFO = {
  alto: { cor: 'var(--danger)', label: 'Alto' },
  atencao: { cor: 'var(--warning)', label: 'Atenção' },
  ok: { cor: 'var(--success)', label: 'Ok' }
}
function FarolCmv({ farol }) {
  if (!farol || !FAROL_INFO[farol]) return <span className="muted">—</span>
  const { cor, label } = FAROL_INFO[farol]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: cor, display: 'inline-block', flexShrink: 0 }} />
      {label}
    </span>
  )
}

// Cobertura de ficha técnica (10/08/2026, pedido do Felipe): "quantas fichas já fizemos", discreto
// no cabeçalho — total e por loja (DD/DOM/EV/RB/DL/MC), pra acompanhar o cadastro sem abrir outra
// tela. Loja sem venda no período não entra na lista (percentual null).
// 11/08/2026: (a) separado "sem ficha técnica" (produto cadastrado, falta cadastrar a FT — gap
// normal) de "sem correspondência de produto" (o código Everest da venda nem bateu com o cadastro
// de Produtos — sintoma de import desalinhado, não de FT faltando) — o Felipe viu 0% de cobertura
// e perguntou "por quê, se os itens são os mesmos"; (b) trocado de linha de texto pra chips
// coloridos (mesmo idioma visual do `.badge` já usado em Produtos/Cadastro) e movido pra dentro
// do cabeçalho/filtro (antes só aparecia depois de buscar, junto da tabela de resultado).
function corTierCobertura(percentual) {
  if (percentual == null) return { bg: 'var(--surface-2)', fg: 'var(--muted)' }
  if (percentual >= 80) return { bg: 'rgba(63,125,74,0.16)', fg: 'var(--success)' }
  if (percentual >= 40) return { bg: 'rgba(201,121,30,0.16)', fg: 'var(--warning)' }
  return { bg: 'rgba(179,64,42,0.16)', fg: 'var(--danger)' }
}

// Anel de progresso (11/08/2026, pedido do Felipe: "deixar mais bonito, virar um widget só") — o
// percentual total de cobertura ganha um anel em vez de um chip solto, e as lojas viram bolinhas
// coloridas ao lado (mesmo idioma visual do farol de CMV acima) em vez de chips grandes disputando
// espaço. Tudo dentro de um único card, com o aviso de "sem correspondência" (quando existe) como
// rodapé discreto do mesmo widget, não mais um bloco de alerta separado.
function AnelPercentual({ percentual, tier, tamanho = 60, espessura = 6 }) {
  const raio = (tamanho - espessura) / 2
  const circunferencia = 2 * Math.PI * raio
  const pct = percentual == null ? 0 : Math.min(100, Math.max(0, percentual))
  const offset = circunferencia * (1 - pct / 100)
  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} style={{ flexShrink: 0 }}>
      <circle cx={tamanho / 2} cy={tamanho / 2} r={raio} fill="none" stroke="var(--surface-3)" strokeWidth={espessura} />
      {percentual != null && (
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          fill="none"
          stroke={tier.fg}
          strokeWidth={espessura}
          strokeLinecap="round"
          strokeDasharray={circunferencia}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${tamanho / 2} ${tamanho / 2})`}
        />
      )}
      <text x="50%" y="51%" textAnchor="middle" dominantBaseline="central" style={{ fontSize: tamanho * 0.24, fontWeight: 700, fill: 'var(--text)' }}>
        {percentual == null ? '—' : `${Math.round(percentual)}%`}
      </text>
    </svg>
  )
}

function LinhaLojaCobertura({ loja, c }) {
  const tier = corTierCobertura(c.percentual)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, whiteSpace: 'nowrap' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: tier.fg, flexShrink: 0 }} />
      <span className="muted">{loja}</span>
      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatarPercentual(c.percentual)}</span>
    </div>
  )
}

function CoberturaFichaTecnica({ cobertura }) {
  if (!cobertura) return null
  const t = cobertura.total
  const tierTotal = corTierCobertura(t.percentual)
  const lojasComVenda = LOJAS_VALIDAS.filter((l) => cobertura.porLoja[l]?.total > 0)

  return (
    <div className="card" style={{ margin: '10px 0 0', padding: '14px 18px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <AnelPercentual percentual={t.percentual} tier={tierTotal} />
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Fichas técnicas</p>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>{t.comFicha}/{t.total} itens vendidos no período</p>
          </div>
        </div>

        {lojasComVenda.length > 0 && (
          <>
            <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', flexShrink: 0 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, max-content))', gap: '6px 18px', flex: 1 }}>
              {lojasComVenda.map((l) => (
                <LinhaLojaCobertura key={l} loja={l} c={cobertura.porLoja[l]} />
              ))}
            </div>
          </>
        )}
      </div>

      {t.semCorrespondencia > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, paddingTop: 12, borderTop: '0.5px solid var(--border)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--warning)', flexShrink: 0, marginTop: 4 }} />
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--warning)' }}>{t.semCorrespondencia} item(ns)</strong> vendido(s) sem correspondência no
            cadastro de Produtos (código Everest da venda não encontrado) — diferente de "sem ficha técnica". Se esse
            número está alto, o problema não é FT faltando, é Vendas/Produtos desalinhados: reimportar Produtos e
            depois Vendas (Base de dados → Importar dados) deve resolver.
          </p>
        </div>
      )}
    </div>
  )
}

// 12/08/2026, pedido do Felipe ("colocar a matriz de bcg com as vendas dos nossos produtos... na
// curva de vendas respeitando os filtros"): matriz BCG do cardápio (adaptação clássica de
// "engenharia de cardápio" — Kasavana & Smith) sobre o MESMO conjunto de itens já usado pela
// tabela analítica (`curvaFiltrada`, só itens com ficha técnica, já respeitando período/loja/grupo)
// — sem consulta nova ao banco, é só outra visão dos mesmos dados.
// Eixos escolhidos com o Felipe: X = Popularidade (quantidade vendida), Y = Margem % (100 − CMV%
// do item, i.e. o CMV invertido). Corte entre "alto"/"baixo" em cada eixo = MÉDIA simples do
// próprio conjunto filtrado (não mediana) — também escolha do Felipe.
// Cores dos 4 quadrantes validadas como paleta categórica de 4 cores com o script do skill
// dataviz (`validate_palette.js`, modo claro — banda de luminosidade, piso de croma, separação CVD
// e piso de visão normal, todos PASS): Estrela reusa --success, Cavalo de batalha reusa --warning
// (ambos já usados no farol de CMV acima), Enigma e Abacaxi usam os 2 tons novos --bcg-enigma/
// --bcg-abacaxi (ver styles.css) — precisou de tom novo porque --danger ficou perto demais de
// --warning nos 2 juntos (ΔE 14,2, abaixo do piso de 15).
const QUADRANTES_BCG = [
  { chave: 'estrela', label: 'Estrela', cor: 'var(--success)', corHex: '#3f7d4a', descricao: 'Alto pedido + margem alta — carro-chefe, proteger.' },
  { chave: 'cavalo', label: 'Cavalo de batalha', cor: 'var(--warning)', corHex: '#c9791e', descricao: 'Alto pedido + margem baixa — populariza, mas rende pouco por unidade.' },
  { chave: 'enigma', label: 'Enigma', cor: 'var(--bcg-enigma)', corHex: '#3a6ea5', descricao: 'Pouco pedido + margem alta — vale destacar/promover no cardápio.' },
  { chave: 'abacaxi', label: 'Abacaxi', cor: 'var(--bcg-abacaxi)', corHex: '#9c2f52', descricao: 'Pouco pedido + margem baixa — candidato a repensar ou sair do cardápio.' }
]
const QUADRANTE_POR_CHAVE = Object.fromEntries(QUADRANTES_BCG.map((q) => [q.chave, q]))

function classificarQuadranteBCG(x, y, mediaX, mediaY) {
  if (x >= mediaX && y >= mediaY) return 'estrela'
  if (x >= mediaX && y < mediaY) return 'cavalo'
  if (x < mediaX && y >= mediaY) return 'enigma'
  return 'abacaxi'
}

function TooltipBCG({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const q = QUADRANTE_POR_CHAVE[p.quadrante]
  return (
    <div style={{ background: 'var(--header-bg)', border: '0.5px solid rgba(244,241,233,0.15)', borderRadius: 8, color: 'var(--header-text)', padding: '8px 12px', fontSize: 12 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{p.nome}</p>
      <p style={{ margin: 0 }}>Qtd. vendida: {formatarNumero(p.x, 1)}</p>
      <p style={{ margin: 0 }}>Margem: {formatarPercentual(p.y)}</p>
      <p style={{ margin: 0 }}>Valor: {formatarMoeda(p.valorTotal)}</p>
      <p style={{ margin: '4px 0 0', color: q.cor, fontWeight: 600 }}>{q.label}</p>
    </div>
  )
}

function LegendaBCG() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: '10px 0 4px' }}>
      {QUADRANTES_BCG.map((q) => (
        <div key={q.chave} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, maxWidth: 230 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: q.cor, flexShrink: 0, marginTop: 3 }} />
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.4 }}>
            <span style={{ fontWeight: 600 }}>{q.label}</span>
            <span className="muted"> — {q.descricao}</span>
          </p>
        </div>
      ))}
    </div>
  )
}

// Arredonda um teto (máximo de eixo) pra um número "redondo" acima do valor real — sem isso, o
// Recharts usa o próprio limite do domínio como último tick (ex. "510.84000000000003"), porque
// passamos domain=[min,max] explícito em vez de 'auto'. Arredonda pro múltiplo da ordem de
// grandeza imediatamente abaixo (ex. 510 → 600; 45 → 50; 6 → 10).
function tetoRedondo(valor) {
  if (valor <= 0) return 1
  const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(valor)) - 1))
  return Math.ceil(valor / magnitude) * magnitude
}

function MatrizBCG({ itens }) {
  const dados = useMemo(() => {
    const pontos = itens
      .filter((i) => i.custoTeoricoPercentual != null && i.quantidade > 0)
      .map((i) => ({ nome: i.nome, x: i.quantidade, y: Math.round((100 - i.custoTeoricoPercentual) * 100) / 100, valorTotal: i.valorTotal }))
    if (pontos.length === 0) return null
    const mediaX = pontos.reduce((a, p) => a + p.x, 0) / pontos.length
    const mediaY = pontos.reduce((a, p) => a + p.y, 0) / pontos.length
    const classificados = pontos.map((p) => ({ ...p, quadrante: classificarQuadranteBCG(p.x, p.y, mediaX, mediaY) }))
    const porQuadrante = Object.fromEntries(QUADRANTES_BCG.map((q) => [q.chave, classificados.filter((p) => p.quadrante === q.chave)]))
    const xs = classificados.map((p) => p.x)
    const ys = classificados.map((p) => p.y)
    const maxX = tetoRedondo(Math.max(...xs) * 1.08)
    const minY = Math.floor((Math.min(0, Math.min(...ys)) - 3) / 5) * 5
    const maxY = Math.ceil((Math.max(...ys) + 5) / 5) * 5
    return { classificados, porQuadrante, mediaX, mediaY, minX: 0, maxX, minY, maxY }
  }, [itens])

  if (!dados) return null
  const { porQuadrante, mediaX, mediaY, minX, maxX, minY, maxY } = dados

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Matriz BCG do cardápio</p>
      <p className="muted" style={{ margin: '0 0 4px', fontSize: 12 }}>
        Eixo X = quantidade vendida (popularidade) · Eixo Y = margem % (100% − CMV% do item). Corte entre alto/baixo
        em cada eixo = média do próprio conjunto filtrado abaixo. Mesmos itens da tabela (só com ficha técnica),
        respeitando os filtros de período/loja/grupo escolhidos acima.
      </p>
      <LegendaBCG />
      <div style={{ width: '100%', height: 400, marginTop: 16 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 24, right: 16, bottom: 8, left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" dataKey="x" name="Quantidade vendida" domain={[minX, maxX]} stroke="var(--text-secondary)" fontSize={12} label={{ value: 'Quantidade vendida', position: 'insideBottom', offset: -6, fill: 'var(--text-secondary)', fontSize: 12 }} />
            <YAxis type="number" dataKey="y" name="Margem" unit="%" domain={[minY, maxY]} stroke="var(--text-secondary)" fontSize={12} width={70} label={{ value: 'Margem %', angle: -90, position: 'left', dx: 14, fill: 'var(--text-secondary)', fontSize: 12 }} />
            <ZAxis range={[60, 60]} />
            <ReferenceArea x1={mediaX} x2={maxX} y1={mediaY} y2={maxY} fill={QUADRANTE_POR_CHAVE.estrela.corHex} fillOpacity={0.07} stroke="none" />
            <ReferenceArea x1={mediaX} x2={maxX} y1={minY} y2={mediaY} fill={QUADRANTE_POR_CHAVE.cavalo.corHex} fillOpacity={0.07} stroke="none" />
            <ReferenceArea x1={minX} x2={mediaX} y1={mediaY} y2={maxY} fill={QUADRANTE_POR_CHAVE.enigma.corHex} fillOpacity={0.07} stroke="none" />
            <ReferenceArea x1={minX} x2={mediaX} y1={minY} y2={mediaY} fill={QUADRANTE_POR_CHAVE.abacaxi.corHex} fillOpacity={0.07} stroke="none" />
            <ReferenceLine x={mediaX} stroke="var(--text-tertiary)" strokeDasharray="4 4" label={{ value: 'média', position: 'top', fill: 'var(--text-secondary)', fontSize: 11 }} />
            <ReferenceLine y={mediaY} stroke="var(--text-tertiary)" strokeDasharray="4 4" />
            <Tooltip content={<TooltipBCG />} cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }} />
            {QUADRANTES_BCG.map((q) => (
              <Scatter key={q.chave} name={q.label} data={porQuadrante[q.chave]} fill={q.corHex} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>Ver como tabela (acessível sem o gráfico)</summary>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 8 }}>
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
              {['Produto', 'Quadrante', 'Qtd. vendida', 'Margem %', 'Valor'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-secondary)', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dados.classificados
              .slice()
              .sort((a, b) => b.x - a.x)
              .map((p, i) => (
                <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>{p.nome}</td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: QUADRANTE_POR_CHAVE[p.quadrante].cor, flexShrink: 0 }} />
                      {QUADRANTE_POR_CHAVE[p.quadrante].label}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{formatarNumero(p.x, 1)}</td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{formatarPercentual(p.y)}</td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{formatarMoeda(p.valorTotal)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

export default function AnaliseCusto() {
  const [modo, setModo] = useState('curva') // 'curva' | 'consumo'
  const [dataInicio, setDataInicio] = useState(primeiroDiaMesAtual())
  const [dataFim, setDataFim] = useState(hojeIso())
  const [loja, setLoja] = useState('') // '' = todas as lojas
  const [subgrupo, setSubgrupo] = useState('') // '' = todos os subgrupos (alimentos + bebidas)
  const [subgrupos, setSubgrupos] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [curva, setCurva] = useState(null)
  const [consumo, setConsumo] = useState(null)
  const [erro, setErro] = useState('')

  const [ordenarPor, setOrdenarPor] = useState('quantidade')
  const [ordemAsc, setOrdemAsc] = useState(false)

  useEffect(() => {
    buscarSubgruposDeVenda().then(setSubgrupos).catch(() => {})
  }, [])

  async function handleBuscar() {
    setCarregando(true)
    setErro('')
    try {
      const filtroLoja = loja || null
      const filtroSubgrupo = subgrupo || null
      if (modo === 'curva') setCurva(await buscarCurvaDeVendas(dataInicio, dataFim, filtroLoja, filtroSubgrupo))
      if (modo === 'consumo') setConsumo(await buscarConsumoTeorico(dataInicio, dataFim, filtroLoja, filtroSubgrupo))
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  const corCurva = { A: 'var(--success)', B: 'var(--warning)', C: 'var(--text-tertiary)' }

  // 10/08/2026, pedido do Felipe: a Curva de Vendas (junto do que antes era a aba separada "CMV
  // ponderado") só mostra itens com ficha técnica vinculada — item sem FT tem custo teórico 0 e
  // distorcia o CMV% pra baixo sem ser real ("tenho o faturamento, mas ainda não tenho o custo").
  // A curva ABC (A/B/C) é recalculada só dentro desse universo filtrado, pra "% acumulado" fazer
  // sentido entre as linhas que aparecem (em vez de herdar o acumulado do universo cheio).
  const curvaFiltrada = useMemo(() => {
    if (!curva) return null
    const comFicha = curva.filter((i) => !i.semFicha).sort((a, b) => b.valorTotal - a.valorTotal)
    const totalFiltrado = comFicha.reduce((a, i) => a + i.valorTotal, 0)
    let acumulado = 0
    return comFicha.map((item) => {
      acumulado += item.valorTotal
      const percentualAcumulado = totalFiltrado > 0 ? (acumulado / totalFiltrado) * 100 : 0
      return { ...item, percentualAcumulado, curva: percentualAcumulado <= 80 ? 'A' : percentualAcumulado <= 95 ? 'B' : 'C' }
    })
  }, [curva])

  const consumoOrdenado = useMemo(() => {
    if (!consumo) return null
    const lista = [...consumo]
    const chave = ordenarPor === 'valor' ? 'valorTeorico' : ordenarPor === 'item' ? 'nome' : 'quantidadeTeorica'
    lista.sort((a, b) => {
      if (chave === 'nome') return ordemAsc ? a.nome.localeCompare(b.nome) : b.nome.localeCompare(a.nome)
      return ordemAsc ? a[chave] - b[chave] : b[chave] - a[chave]
    })
    return lista
  }, [consumo, ordenarPor, ordemAsc])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="segmented" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          <button className={modo === 'curva' ? 'active' : ''} onClick={() => setModo('curva')}>Curva de vendas</button>
          <button className={modo === 'consumo' ? 'active' : ''} onClick={() => setModo('consumo')}>Consumo teórico</button>
        </div>

        {/* Mesmo filtro nas 3 telas: período, loja e grupo (alimentos/bebidas). 11/08/2026: cada
            campo ganhou `flex + minWidth` (mesmo padrão já usado em Cardápio/Análise de Produção)
            pra quebrar linha de forma previsível — antes o Loja/Grupo sem largura própria deixava
            o "Grupo" bem mais largo que os outros e quebrava sozinho numa linha torta. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label className="muted">De</label>
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label className="muted">Até</label>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 170 }}>
            <label className="muted">Loja</label>
            <select value={loja} onChange={(e) => setLoja(e.target.value)}>
              <option value="">Todas</option>
              {LOJAS_VALIDAS.map((l) => (
                <option key={l} value={l}>{LOJAS_LABEL[l]}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 170 }}>
            <label className="muted">Grupo</label>
            <select value={subgrupo} onChange={(e) => setSubgrupo(e.target.value)}>
              <option value="">Todos</option>
              {subgrupos.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          {modo === 'consumo' && (
            <div style={{ flex: 1, minWidth: 170 }}>
              <label className="muted">Ordenar por</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={ordenarPor} onChange={(e) => setOrdenarPor(e.target.value)}>
                  {OPCOES_ORDENACAO_CONSUMO.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <button className="ghost" onClick={() => setOrdemAsc((v) => !v)} title="Inverter ordem" style={{ height: 38, padding: '0 10px' }}>
                  {ordemAsc ? '↑' : '↓'}
                </button>
              </div>
            </div>
          )}
          <button className="primary" onClick={handleBuscar} disabled={carregando} style={{ height: 44 }}>
            {carregando ? 'Buscando…' : 'Buscar'}
          </button>
        </div>

        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          Só considera itens de Alimentos e Bebidas (materiais, insumos e revenda de terceiros não entram — não são pratos).
        </p>
        {modo === 'curva' && (
          <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            Só entram itens com ficha técnica vinculada — item sem FT tem custo teórico desconhecido (não é 0%) e
            distorceria o CMV médio. O quanto falta cadastrar aparece no indicador de cobertura abaixo.
          </p>
        )}
        {modo === 'consumo' && (
          <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
            Considera só o primeiro nível da ficha técnica (ingredientes diretos do prato vendido). Se um ingrediente
            é ele mesmo uma produção com sub-receita, essa camada ainda não é expandida — próximo passo.
          </p>
        )}
        {modo === 'curva' && curva && <CoberturaFichaTecnica cobertura={curva.cobertura} />}
      </div>

      {erro && <div className="card"><p style={{ color: 'var(--danger)' }}>{erro}</p></div>}

      {modo === 'curva' && curva && curvaFiltrada && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Curva de vendas (ABC) — CMV Real por item</p>
            <ResumoFaturamentoTotal totalVendas={curva.totalVendas} />
          </div>
          <ResumoDashboardCurva curva={curva} loja={loja} subgrupo={subgrupo} />
          {curvaFiltrada.length === 0 ? (
            <p className="muted">Nenhum item com ficha técnica vinculada nesse período{loja ? ` para a loja ${LOJAS_LABEL[loja]}` : ''}{subgrupo ? ` em ${subgrupo}` : ''}.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 56 }} />
                <col style={{ width: 240 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 100 }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  {['Curva', 'Produto', 'Qtd.', 'Valor unit.', 'Valor', 'Custo unit.', 'Custo Teórico', 'CMV %', 'Flag'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {curvaFiltrada.map((item, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: '0.5px solid var(--border)',
                      // 11/08/2026, pedido do Felipe ("igual a antes, bem sutil"): item com CMV acima de
                      // 35% (farol "alto", mesmo corte de corFarolCmv) ganha um fundo vermelho bem leve
                      // na linha inteira — só reforça visualmente o que a coluna Flag já diz.
                      background: item.farol === 'alto' ? 'rgba(179,64,42,0.06)' : 'transparent'
                    }}
                  >
                    <td style={{ padding: '8px' }}><span className="badge" style={{ background: 'var(--surface-2)', color: corCurva[item.curva] }}>{item.curva}</span></td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.nome}>{item.nome}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarNumero(item.quantidade, 1)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{formatarMoedaOuTraco(item.valorUnitario)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarMoeda(item.valorTotal)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{formatarMoedaOuTraco(item.custoUnitario)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatarMoeda(item.custoTeorico)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap', fontWeight: 600 }}>{formatarPercentual(item.custoTeoricoPercentual)}</td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}><FarolCmv farol={item.farol} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modo === 'curva' && curva && curvaFiltrada && curvaFiltrada.length > 0 && <MatrizBCG itens={curvaFiltrada} />}

      {modo === 'consumo' && consumoOrdenado && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Consumo teórico de insumos</p>
          <ResumoCabecalho totalVendas={consumo.totalVendas} totalCustoTeorico={consumo.totalCustoTeorico} cmvMedio={consumo.cmvMedio} />
          {consumoOrdenado.length === 0 ? (
            <p className="muted">Sem dados suficientes (precisa de vendas + fichas técnicas vinculadas nesse período{loja ? `, na loja ${LOJAS_LABEL[loja]}` : ''}).</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>Item</th>
                  <th style={{ textAlign: 'right', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>Quantidade</th>
                  <th style={{ textAlign: 'right', padding: '8px', color: 'var(--text-secondary)', fontWeight: 500 }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {consumoOrdenado.map((item, i) => (
                  <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '8px' }}>{item.nome}</td>
                    <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarNumero(item.quantidadeTeorica, 3)} {item.unidade}</td>
                    <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{formatarMoeda(item.valorTeorico)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

    </div>
  )
}
