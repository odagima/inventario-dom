import { useEffect, useMemo, useState } from 'react'
import { buscarProdutosInsumoBase, buscarArvoreDeUsos } from '../lib/adminApi'
import { formatarNumero } from '../lib/formato'

// ⚠️ 03/09/2026 — ARQUIVO RECUPERADO DO BUNDLE PUBLICADO (build 54), não do repositório.
// Nunca subiu pro GitHub (entregas commitadas como .zip sem extrair; a árvore versionada parou em
// 17/08). Lógica lida do JS minificado do dist 54 — que preserva estrutura, strings, classes CSS e
// nomes de campo. Os dados vêm inteiros de `buscarArvoreDeUsos` (`adminApi.js`, intacto no repo).
//
// O que esta tela é (§29): a fusão das antigas "Árvore de usos" e "Árvore de origem" numa só.
// Parte de um INSUMO BASE (o que entra por compras) e mostra, em etapas, o que a ficha técnica
// registra como feito a partir dele.
//
// ⚠️ Modelo (§23, corrigido durante a validação com o Felipe): cada ficha registra uma RECEITA —
// quanto do pai é preciso pra fazer 1 do filho. Quando o mesmo item aparece em 2 fichas, são 2
// USOS POSSÍVEIS, ramos alternativos, não a divisão de um lote físico. Por isso a tela diz
// "o que a ficha técnica prevê", nunca "o que foi produzido".

const PALETA = { musgo: '#5C6E49', marinho: '#1C2B44', laranja: '#C15A1B', cinza: '#8C887E' }

const CATEGORIA = {
  insumo: { cor: PALETA.musgo, rotulo: 'Insumo em natura' },
  pre_preparo: { cor: PALETA.marinho, rotulo: 'Pré-preparo' },
  venda: { cor: PALETA.laranja, rotulo: 'Prato / venda' }
}

const estiloCategoria = (cat) => CATEGORIA[cat] || { cor: PALETA.cinza, rotulo: 'Sem categoria' }

const CSS = `
.etp { font-size: 13px; }
.etp-faixa { display: flex; align-items: baseline; gap: 10px; margin: 0 0 10px; }
.etp-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0;
  background: #1C2B44; color: #F4F1E9; font-size: 11px; font-weight: 700;
}
.etp-titulo { font-weight: 600; font-size: 13px; }
.etp-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.etp-card {
  background: #fff; border: 1px solid #D8D2C4; border-left-width: 4px;
  border-radius: 10px; padding: 10px 12px;
}
.etp-qtd {
  font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; color: #1C2B44;
  white-space: nowrap;
}
.etp-nome { font-size: 12.5px; font-weight: 600; line-height: 1.3; margin-top: 2px; }
.etp-cod { font-size: 11px; color: #8C887E; font-variant-numeric: tabular-nums; margin-top: 1px; }
.etp-obs { font-size: 10.5px; color: #8C887E; margin-top: 4px; }
.etp-alerta { font-size: 10.5px; color: #C15A1B; margin-top: 4px; }
.etp-trilho { border-left: 2px solid #E5E0D4; margin-left: 11px; padding: 0 0 18px 20px; }
.etp-trilho:last-child { border-left-color: transparent; padding-bottom: 0; }
`

// Achata a árvore em ETAPAS (nível 1, 2, 3…). Cada item aparece UMA vez, na primeira etapa em que
// surge; se chega por mais de um caminho, isso é registrado em `veioDe`. E se dois caminhos dão
// quantidades diferentes pro mesmo item, a divergência vai pra `outrasQuantidades` e aparece na
// tela — fichas que discordam entre si é informação, não erro a esconder.
function montarEtapas(raiz, quantidadeInicial) {
  const porCodigo = new Map()

  const descer = (no, nivel) => {
    for (const filho of no.filhos || []) {
      const qtd = filho.quantidade == null ? null : filho.quantidade * quantidadeInicial
      if (!porCodigo.has(filho.codigoEverest)) {
        porCodigo.set(filho.codigoEverest, {
          codigo: filho.codigoEverest,
          nome: filho.nome,
          unidade: filho.unidadeMedida,
          categoria: filho.categoria,
          nivel,
          quantidade: qtd,
          outrasQuantidades: new Set(),
          fatorAusente: !!filho.fatorAusente,
          veioDe: new Set([no.nome])
        })
      } else {
        const existente = porCodigo.get(filho.codigoEverest)
        existente.veioDe.add(no.nome)
        if (qtd != null && existente.quantidade != null && Math.abs(qtd - existente.quantidade) > 0.0005) {
          existente.outrasQuantidades.add(qtd)
        }
      }
      descer(filho, nivel + 1)
    }
  }

  descer(raiz, 1)

  const maiorNivel = Math.max(0, ...[...porCodigo.values()].map((i) => i.nivel))
  const etapas = []
  for (let n = 1; n <= maiorNivel; n++) {
    const itens = [...porCodigo.values()]
      .filter((i) => i.nivel === n)
      .sort((a, b) => (b.quantidade || 0) - (a.quantidade || 0))
    if (itens.length) etapas.push({ nivel: n, itens })
  }
  return etapas
}

export default function ArvoreTransformacao() {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState([])
  const [selecionado, setSelecionado] = useState(null)
  const [quantidadeTexto, setQuantidadeTexto] = useState('1')
  const [mostrarPratos, setMostrarPratos] = useState(false)
  const [arvore, setArvore] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  // Busca com atraso de 250ms: digitar "filet" não deve disparar cinco consultas.
  useEffect(() => {
    if (termo.trim().length < 2) {
      setResultados([])
      return
    }
    let ativo = true
    const t = setTimeout(() => {
      buscarProdutosInsumoBase(termo.trim())
        .then((r) => { if (ativo) setResultados(r || []) })
        .catch(() => {})
    }, 250)
    return () => { ativo = false; clearTimeout(t) }
  }, [termo])

  async function escolher(produto) {
    setSelecionado(produto)
    setArvore(null)
    setErro('')
    setCarregando(true)
    try {
      const r = await buscarArvoreDeUsos(produto.codigo_everest)
      if (r) setArvore(r)
      else setErro('Esse produto não está no cadastro atual — reimporte Produtos e tente de novo.')
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  const quantidade = useMemo(() => {
    const n = Number(String(quantidadeTexto).replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : 1
  }, [quantidadeTexto])

  // Pratos vendidos são o fim da cadeia e costumam ser muitos — por padrão a árvore mostra só as
  // transformações (pré-preparos), com um botão pra revelar os pratos.
  const semPratos = (no) => {
    if (!no) return no
    const filhos = (no.filhos || []).filter((f) => f.categoria !== 'venda').map(semPratos)
    return { ...no, filhos }
  }
  const contarPratos = (no) =>
    ((no?.filhos) || []).reduce((acc, f) => acc + (f.categoria === 'venda' ? 1 : 0) + contarPratos(f), 0)

  const arvoreExibida = arvore ? (mostrarPratos ? arvore : semPratos(arvore)) : null
  const totalPratos = arvore ? contarPratos(arvore) : 0
  const semDerivados = arvoreExibida && (!arvoreExibida.filhos || arvoreExibida.filhos.length === 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{CSS}</style>

      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Árvore de transformação</p>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
          Escolha um <strong>insumo base</strong> (o que entra por compras) e veja as transformações
          que a ficha técnica registra a partir dele. A quantidade sobre cada linha é o quanto se
          obtém na etapa seguinte.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 260px' }}>
            <label className="muted">Buscar por nome ou código Everest</label>
            <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="ex.: filet mignon" />
          </div>
          <div style={{ width: 150 }}>
            <label className="muted">Quantidade inicial</label>
            <input value={quantidadeTexto} onChange={(e) => setQuantidadeTexto(e.target.value)} placeholder="1" />
          </div>
        </div>

        {resultados.length > 0 && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
            {resultados.slice(0, 18).map((p) => {
              const ativo = selecionado?.codigo_everest === p.codigo_everest
              return (
                <button
                  key={p.codigo_everest}
                  onClick={() => escolher(p)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                    padding: '9px 12px', borderRadius: 8, lineHeight: 1.3,
                    border: `1px solid ${ativo ? PALETA.laranja : 'var(--border)'}`,
                    background: ativo ? 'color-mix(in srgb, #C15A1B 12%, transparent)' : 'var(--surface-2)',
                    color: 'var(--text)'
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: ativo ? 700 : 600 }}>{p.nome}</span>
                  <span className="muted" style={{ display: 'block', fontSize: 11, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                    {p.codigo_everest} · {p.unidade_medida}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {termo.trim().length >= 2 && resultados.length === 0 && (
          <p className="muted" style={{ margin: '12px 0 0', fontSize: 12 }}>
            Nenhum insumo base com esse termo. A busca lista só o que aparece em compras e não tem
            ficha própria — é de lá que a cadeia começa. Pré-preparos e pratos aparecem dentro da
            árvore, não como ponto de partida.
          </p>
        )}
      </div>

      {erro && (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--danger)' }}>{erro}</p>
        </div>
      )}

      {carregando && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Montando a árvore…</p>
        </div>
      )}

      {arvoreExibida && !carregando && (
        <div className="card arvT">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{arvoreExibida.nome}</p>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Partindo de {formatarNumero(quantidade, 3)} {arvoreExibida.unidadeMedida || ''}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: '#8C887E' }}>
                {Object.values(CATEGORIA)
                  .filter((c) => mostrarPratos || c.rotulo !== 'Prato / venda')
                  .map((c) => (
                    <span key={c.rotulo} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, display: 'inline-block', background: c.cor }} />
                      {c.rotulo}
                    </span>
                  ))}
              </div>
              {totalPratos > 0 && (
                <button
                  onClick={() => setMostrarPratos((v) => !v)}
                  style={{
                    fontSize: 11.5, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: mostrarPratos ? 'color-mix(in srgb, #C15A1B 12%, transparent)' : 'var(--surface-2)'
                  }}
                >
                  {mostrarPratos ? `Ocultar os ${totalPratos} pratos` : `Mostrar os ${totalPratos} pratos que usam`}
                </button>
              )}
            </div>
          </div>

          {semDerivados ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {totalPratos > 0
                ? 'Esse insumo não passa por nenhuma transformação registrada — vai direto pros pratos. Use o botão acima para vê-los.'
                : 'Nenhuma ficha técnica usa esse item como ingrediente, então não há derivados pra mostrar. Se você esperava ver algo aqui, falta ligar esse insumo às fichas no Everest.'}
            </p>
          ) : (
            <div className="etp" style={{ marginTop: 6 }}>
              {montarEtapas(arvoreExibida, quantidade).map((etapa) => (
                <div className="etp-trilho" key={etapa.nivel}>
                  <div className="etp-faixa" style={{ marginLeft: -32 }}>
                    <span className="etp-num">{etapa.nivel}</span>
                    <span className="etp-titulo">
                      {etapa.nivel === 1 ? 'Vira' : 'Depois pode virar'}
                      <span className="muted" style={{ fontWeight: 400 }}>
                        {' '}· {etapa.itens.length} {etapa.itens.length === 1 ? 'item' : 'itens'}
                      </span>
                    </span>
                  </div>

                  <div className="etp-grade">
                    {etapa.itens.map((item) => {
                      const est = estiloCategoria(item.categoria)
                      return (
                        <div className="etp-card" key={item.codigo} style={{ borderLeftColor: est.cor }}>
                          <div className="etp-qtd">
                            {item.quantidade == null ? '—' : `${formatarNumero(item.quantidade, 3)} ${item.unidade || ''}`}
                          </div>
                          <div className="etp-nome">{item.nome}</div>
                          <div className="etp-cod">{item.codigo}</div>
                          {item.veioDe.size > 1 && (
                            <div className="etp-obs">chega por {item.veioDe.size} caminhos</div>
                          )}
                          {item.outrasQuantidades.size > 0 && (
                            <div className="etp-alerta">
                              outro caminho dá {[...item.outrasQuantidades].map((q) => formatarNumero(q, 3)).join(' / ')} — fichas divergem
                            </div>
                          )}
                          {item.fatorAusente && <div className="etp-alerta">sem quantidade na ficha</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>
                Cada item aparece uma vez, na primeira etapa em que surge. A quantidade é o que se
                obtém partindo de {formatarNumero(quantidade, 3)} {arvoreExibida.unidadeMedida} — não
                é o que foi produzido de verdade, é o que a ficha técnica prevê.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
