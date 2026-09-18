import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { buscarLancamentos, listarUnidadesAdmin, listarGruposAdmin } from '../lib/adminApi'
import { LABEL_MOTIVO_PERDA, LABEL_TURNO } from '../../lib/perdas'

// Tabela dinâmica dos lançamentos (§ pedido do Felipe, 01/09/2026).
//
// O problema: agosto tem mais de 30 sessões de inventário porque o time lança um pedaço, envia, e
// depois lança outros itens numa sessão nova. Isso é o comportamento NORMAL e aditivo — não é
// duplicidade a corrigir. Abrir sessão por sessão pra entender o mês não escala.
//
// A solução: a unidade de análise passa a ser o LANÇAMENTO, e a sessão vira só uma das dimensões
// disponíveis. O Felipe escolhe como agrupar (até 3 níveis) e exporta.

const TIPOS = [
  { valor: 'mensal', label: 'Inventário' },
  { valor: 'semanal', label: 'Contagem semanal' },
  { valor: 'perdas', label: 'Perdas' },
  { valor: 'producao', label: 'Produção' },
  { valor: 'diario', label: 'Tempo de produção' }
]

const LABEL_TIPO = Object.fromEntries(TIPOS.map((t) => [t.valor, t.label]))

// Dimensões disponíveis pra agrupar. `campo` é a chave da linha crua devolvida pela API.
const DIMENSOES = [
  { campo: 'produto', label: 'Produto' },
  { campo: 'grupoEverest', label: 'Grupo Everest' },
  { campo: 'subgrupoEverest', label: 'Subgrupo' },
  { campo: 'tipoItem', label: 'Tipo do item' },
  { campo: 'loja', label: 'Loja' },
  { campo: 'mes', label: 'Mês de referência' },
  { campo: 'data', label: 'Data de referência' },
  { campo: 'quem', label: 'Quem lançou' },
  { campo: 'tipo', label: 'Tipo de contagem' },
  { campo: 'grupoContagem', label: 'Grupo de contagem' },
  { campo: 'turno', label: 'Turno' },
  { campo: 'motivoPerda', label: 'Motivo (perdas)' },
  { campo: 'sessaoId', label: 'Sessão' }
]

const LABEL_DIM = Object.fromEntries(DIMENSOES.map((d) => [d.campo, d.label]))

function primeiroDiaDoMes() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function hojeIso() { return new Date().toISOString().slice(0, 10) }

function num(n, casas = 3) {
  const x = Number(n)
  if (!isFinite(x)) return '—'
  return x.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

// Rótulo legível de cada valor de dimensão. Sem isso a tela mostraria 'estragado' e uuid de sessão.
function rotulo(campo, valor) {
  if (valor == null || valor === '') return '—'
  if (campo === 'tipo') return LABEL_TIPO[valor] || valor
  if (campo === 'motivoPerda') return LABEL_MOTIVO_PERDA[valor] || valor
  if (campo === 'turno') return LABEL_TURNO[valor] || valor
  if (campo === 'data') return String(valor).split('-').reverse().join('/')
  if (campo === 'mes') { const [a, m] = String(valor).split('-'); return `${m}/${a}` }
  if (campo === 'sessaoId') return String(valor).slice(0, 8)
  return String(valor)
}

export default function Lancamentos() {
  const [tipos, setTipos] = useState(['mensal'])
  const [dataInicio, setDataInicio] = useState(primeiroDiaDoMes())
  const [dataFim, setDataFim] = useState(hojeIso())
  const [unidadeId, setUnidadeId] = useState('')
  const [grupoId, setGrupoId] = useState('')
  const [quem, setQuem] = useState('')
  const [busca, setBusca] = useState('')
  const [agrupamento, setAgrupamento] = useState(['produto'])
  const [unidades, setUnidades] = useState([])
  const [grupos, setGrupos] = useState([])
  const [linhas, setLinhas] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [expandido, setExpandido] = useState(new Set())

  useEffect(() => {
    listarUnidadesAdmin().then(setUnidades).catch(() => {})
    listarGruposAdmin().then(setGrupos).catch(() => {})
  }, [])

  async function calcular() {
    setCarregando(true)
    setErro('')
    try {
      const r = await buscarLancamentos({
        tipos: tipos.length ? tipos : null,
        dataInicio, dataFim,
        unidadeId: unidadeId || null,
        grupoId: grupoId || null
      })
      setLinhas(r)
      setExpandido(new Set())
    } catch (e) {
      setErro(e.message)
      setLinhas(null)
    } finally {
      setCarregando(false)
    }
  }

  // Filtros que agem sobre o resultado já carregado (não exigem nova consulta).
  const filtradas = useMemo(() => {
    if (!linhas) return []
    const t = busca.trim().toLowerCase()
    return linhas.filter((l) => {
      if (quem && l.quem !== quem) return false
      if (t && !(`${l.produto} ${l.codigoEverest}`.toLowerCase().includes(t))) return false
      return true
    })
  }, [linhas, quem, busca])

  const pessoas = useMemo(
    () => [...new Set((linhas || []).map((l) => l.quem))].sort(),
    [linhas]
  )

  // O pivô. Agrupa em até 3 níveis, na ordem escolhida.
  const grupoRaiz = useMemo(() => {
    if (!filtradas.length) return []

    function agrupar(itens, niveis, prefixo = '') {
      if (!niveis.length) return null
      const [campo, ...resto] = niveis
      const mapa = new Map()
      for (const it of itens) {
        const chave = it[campo] ?? '—'
        if (!mapa.has(chave)) mapa.set(chave, [])
        mapa.get(chave).push(it)
      }
      return [...mapa.entries()]
        .map(([chave, filhos]) => {
          // Quantidade só é somável dentro da MESMA unidade. Misturar kg com un daria um total
          // sem significado — nesse caso mostra as unidades em vez de um número errado.
          const unidades = [...new Set(filhos.map((f) => f.unidade).filter(Boolean))]
          return {
            id: `${prefixo}${campo}:${chave}`,
            campo,
            chave,
            total: filhos.reduce((a, f) => a + f.quantidade, 0),
            unidade: unidades.length === 1 ? unidades[0] : null,
            unidades,
            lancamentos: filhos.length,
            sessoes: new Set(filhos.map((f) => f.sessaoId)).size,
            pessoas: new Set(filhos.map((f) => f.quem)).size,
            itens: filhos,
            sub: agrupar(filhos, resto, `${prefixo}${campo}:${chave}|`)
          }
        })
        .sort((a, b) => b.total - a.total)
    }

    return agrupar(filtradas, agrupamento) || []
  }, [filtradas, agrupamento])

  const totalGeral = filtradas.reduce((a, l) => a + l.quantidade, 0)
  const unidadesNoTotal = [...new Set(filtradas.map((l) => l.unidade).filter(Boolean))]

  function alternar(id) {
    setExpandido((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function exportar() {
    const wb = XLSX.utils.book_new()

    // Aba 1: exatamente o agrupamento que está na tela, com a hierarquia indentada.
    const resumo = [[...agrupamento.map((c) => LABEL_DIM[c]), 'Quantidade', 'Unidade', 'Lançamentos', 'Sessões', 'Pessoas']]
    function percorrer(nos, caminho = []) {
      for (const n of nos) {
        const linha = [...caminho, rotulo(n.campo, n.chave)]
        while (linha.length < agrupamento.length) linha.push('')
        resumo.push([...linha, n.total, n.unidade || n.unidades.join(' / '), n.lancamentos, n.sessoes, n.pessoas])
        if (n.sub) percorrer(n.sub, [...caminho, rotulo(n.campo, n.chave)])
      }
    }
    percorrer(grupoRaiz)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Agrupado')

    // Aba 2: as linhas cruas. É o que permite montar qualquer outro corte fora do app.
    const cru = filtradas.map((l) => ({
      Data: l.data, Tipo: LABEL_TIPO[l.tipo] || l.tipo, Loja: l.loja,
      'Grupo de contagem': l.grupoContagem, Turno: LABEL_TURNO[l.turno] || '',
      'Quem lançou': l.quem, 'Código Everest': l.codigoEverest, Produto: l.produto,
      'Grupo Everest': l.grupoEverest, Subgrupo: l.subgrupoEverest, 'Tipo do item': l.tipoItem,
      Quantidade: l.quantidade, Unidade: l.unidade,
      Motivo: l.motivoPerda ? (LABEL_MOTIVO_PERDA[l.motivoPerda] || l.motivoPerda) : '',
      'Lançado como': l.modoPerda === 'prato' ? 'Prato inteiro (porções)' : l.modoPerda === 'peso' ? 'Peso' : '',
      Sessão: l.sessaoId, Status: l.status
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cru), 'Lançamentos')

    XLSX.writeFile(wb, `lancamentos-${dataInicio}-a-${dataFim}.xlsx`)
  }

  const th = { padding: '8px 10px', textAlign: 'left', fontSize: 11.5, fontWeight: 700, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td = { padding: '7px 10px', fontSize: 13, borderBottom: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

  return (
    <div>
      <h2>Lançamentos</h2>
      <p className="muted" style={{ marginTop: -6 }}>
        Todo lançamento do período, independente de em qual sessão caiu. Escolha como agrupar e exporte.
        O período e o mês usam sempre a <strong>data de referência informada</strong> no lançamento, nunca o dia em que foi digitado.
      </p>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <label className="muted">De (referência)</label>
          <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
        </div>
        <div>
          <label className="muted">Até (referência)</label>
          <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
        </div>
        <div>
          <label className="muted">Loja</label>
          <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            <option value="">Todas</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="muted">Grupo de contagem</label>
          <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)}>
            <option value="">Todos</option>
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </select>
        </div>
        <button className="primary" onClick={calcular} disabled={carregando}>
          {carregando ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ width: '100%' }}>
          <label className="muted">Tipo de contagem</label>
        </div>
        {TIPOS.map((t) => {
          const ativo = tipos.includes(t.valor)
          return (
            <button
              key={t.valor}
              onClick={() => setTipos((p) => (ativo ? p.filter((x) => x !== t.valor) : [...p, t.valor]))}
              style={{
                fontSize: 12.5, padding: '7px 12px',
                background: ativo ? 'var(--accent)' : 'var(--surface-2)',
                color: ativo ? '#fff' : 'inherit'
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="card">
        <label className="muted">Agrupar por (na ordem)</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {DIMENSOES.map((d) => {
            const pos = agrupamento.indexOf(d.campo)
            const ativo = pos >= 0
            return (
              <button
                key={d.campo}
                onClick={() => setAgrupamento((p) => {
                  if (ativo) return p.filter((x) => x !== d.campo)
                  if (p.length >= 3) return p // 3 níveis é o limite legível numa tabela
                  return [...p, d.campo]
                })}
                style={{
                  fontSize: 12.5, padding: '7px 12px',
                  background: ativo ? 'var(--accent-soft)' : 'var(--surface-2)',
                  color: ativo ? 'var(--accent-soft-text)' : 'inherit',
                  fontWeight: ativo ? 600 : 400
                }}
              >
                {ativo && <span style={{ opacity: 0.7 }}>{pos + 1}· </span>}{d.label}
              </button>
            )
          })}
        </div>
        {agrupamento.length === 0 && (
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>Escolha ao menos uma dimensão.</p>
        )}
        {agrupamento.length >= 3 && (
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>Três níveis é o máximo — desmarque um pra trocar.</p>
        )}
      </div>

      {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

      {linhas && (
        <>
          <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="muted">Buscar produto</label>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome ou código" />
            </div>
            <div>
              <label className="muted">Quem lançou</label>
              <select value={quem} onChange={(e) => setQuem(e.target.value)}>
                <option value="">Todos</option>
                {pessoas.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <button onClick={exportar} disabled={!filtradas.length}>Exportar Excel</button>
          </div>

          <div className="card" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>Lançamentos</p>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>{filtradas.length.toLocaleString('pt-BR')}</p>
            </div>
            <div>
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>Sessões</p>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>{new Set(filtradas.map((l) => l.sessaoId)).size}</p>
            </div>
            <div>
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>Produtos distintos</p>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>{new Set(filtradas.map((l) => l.codigoEverest)).size}</p>
            </div>
            <div>
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>Quantidade total</p>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>
                {unidadesNoTotal.length === 1 ? `${num(totalGeral)} ${unidadesNoTotal[0]}` : '—'}
              </p>
              {unidadesNoTotal.length > 1 && (
                <p className="muted" style={{ margin: 0, fontSize: 10.5 }}>
                  unidades diferentes ({unidadesNoTotal.join(', ')}) — não somável
                </p>
              )}
            </div>
          </div>

          {(() => {
            // Inventário mensal não informa dia — só mês. Agrupar por "Data de referência" nesse
            // caso mostraria dia 1º pra tudo, o que pareceria dado real. Melhor avisar.
            const semDia = filtradas.filter((l) => l.origemData === 'mes_referencia').length
            const semNada = filtradas.filter((l) => l.origemData === 'criacao').length
            if (!semDia && !semNada) return null
            return (
              <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
                {semDia > 0 && `${semDia.toLocaleString('pt-BR')} lançamento(s) vêm de sessão que informa só mês e ano (inventário mensal) — o mês está correto, mas não há dia informado. `}
                {semNada > 0 && `${semNada.toLocaleString('pt-BR')} lançamento(s) não têm nenhuma referência informada e usam a data de criação da sessão.`}
              </p>
            )
          })()}

          {filtradas.length === 0 ? (
            <p className="muted">Nenhum lançamento com esses filtros.</p>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>{agrupamento.map((c) => LABEL_DIM[c]).join(' › ')}</th>
                    <th style={{ ...th, textAlign: 'right' }}>Quantidade</th>
                    <th style={{ ...th, textAlign: 'right' }}>Lanç.</th>
                    <th style={{ ...th, textAlign: 'right' }}>Sessões</th>
                    <th style={{ ...th, textAlign: 'right' }}>Pessoas</th>
                  </tr>
                </thead>
                <tbody>
                  {grupoRaiz.map((n) => (
                    <NoDaArvore key={n.id} no={n} nivel={0} expandido={expandido} alternar={alternar} td={td} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function NoDaArvore({ no, nivel, expandido, alternar, td }) {
  const aberto = expandido.has(no.id)
  const temFilho = !!no.sub?.length
  return (
    <>
      <tr
        onClick={temFilho ? () => alternar(no.id) : undefined}
        style={{ cursor: temFilho ? 'pointer' : 'default', background: nivel === 0 ? 'transparent' : 'var(--surface-2)' }}
      >
        <td style={{ ...td, paddingLeft: 10 + nivel * 20, whiteSpace: 'normal', fontWeight: nivel === 0 ? 600 : 400 }}>
          {temFilho && <span style={{ opacity: 0.5, marginRight: 6 }}>{aberto ? '▾' : '▸'}</span>}
          {rotulo(no.campo, no.chave)}
        </td>
        <td style={{ ...td, textAlign: 'right', fontWeight: nivel === 0 ? 600 : 400 }}>
          {no.unidade ? `${num(no.total)} ${no.unidade}` : no.unidades.join(' / ')}
        </td>
        <td style={{ ...td, textAlign: 'right' }}>{no.lancamentos}</td>
        <td style={{ ...td, textAlign: 'right' }}>{no.sessoes}</td>
        <td style={{ ...td, textAlign: 'right' }}>{no.pessoas}</td>
      </tr>
      {aberto && no.sub.map((f) => (
        <NoDaArvore key={f.id} no={f} nivel={nivel + 1} expandido={expandido} alternar={alternar} td={td} />
      ))}
    </>
  )
}
