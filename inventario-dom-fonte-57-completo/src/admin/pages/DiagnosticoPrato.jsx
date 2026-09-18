import { useState } from 'react'
import { diagnosticarPrato } from '../lib/adminApi'
import { formatarNumero } from '../lib/formato'

// ⚠️ 03/09/2026 — ARQUIVO RECUPERADO DO BUNDLE PUBLICADO (build 54), não do repositório.
// Nunca subiu pro GitHub (entregas commitadas como .zip sem extrair; a árvore versionada parou em
// 17/08). Lógica lida do JS minificado do dist 54. Todo o diagnóstico vem de `diagnosticarPrato`
// (`adminApi.js`, intacto no repo) — esta tela só monta o formulário e exibe.
//
// O que esta tela é (§45): responde por que um prato entra ou não no consumo teórico, sem precisar
// de acesso ao banco. Foi construída pro caso EXEC CARNE (§52: venda gravada num código e ficha
// cadastrada em outro) e é a ferramenta certa pra fechar o §65 — buscar o código do preparo e ver
// se a ficha dele tem linhas.

const HOJE = new Date().toISOString().slice(0, 10)
const SETE_DIAS_ATRAS = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

const COLUNAS_VENDAS = ['Código gravado na venda', 'Nome na venda', 'Qtd', 'Canceladas', 'Dias']
const COLUNAS_FICHA = ['Código', 'Ingrediente', 'Tipo', 'Bruto', 'Líquido']

export default function DiagnosticoPrato() {
  const [termo, setTermo] = useState('')
  const [dataInicio, setDataInicio] = useState(SETE_DIAS_ATRAS)
  const [dataFim, setDataFim] = useState(HOJE)
  const [resultado, setResultado] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [fichaAberta, setFichaAberta] = useState(null)

  async function verificar() {
    setCarregando(true)
    setErro('')
    setResultado(null)
    try {
      setResultado(await diagnosticarPrato(termo, { dataInicio, dataFim }))
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  // O veredito vem como texto do motor; "OK" no começo é o único caso verde.
  const corVeredito = (v) => (v.startsWith('OK') ? 'var(--success)' : 'var(--danger)')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Diagnóstico de prato</p>
        <p className="muted" style={{ margin: '0 0 14px', fontSize: 13 }}>
          Descobre por que um prato entra ou não no consumo teórico: se tem ficha, se a ficha chega
          a um insumo comprado, e se houve venda no período — inclusive venda gravada sob outro
          código.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px' }}>
            <label className="muted">Nome ou código do prato</label>
            <input
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verificar()}
              placeholder="ex.: exec carne"
            />
          </div>
          <div>
            <label className="muted">De</label>
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </div>
          <div>
            <label className="muted">Até</label>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
          <button className="primary" onClick={verificar} disabled={carregando || termo.trim().length < 2} style={{ height: 44 }}>
            {carregando ? 'Verificando…' : 'Verificar'}
          </button>
        </div>
      </div>

      {erro && (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--danger)' }}>{erro}</p>
        </div>
      )}

      {resultado && (
        <>
          <div className="card">
            <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 14 }}>
              Vendas no período com esse nome{' '}
              <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                — agrupadas pelo código em que estão gravadas
              </span>
            </p>

            {resultado.vendasPorCodigo.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Nenhuma venda com esse nome no período. Se você esperava vendas aqui, o problema é a
                base de vendas, não a ficha.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {COLUNAS_VENDAS.map((c, i) => (
                      <th key={c} style={{ textAlign: i > 1 ? 'right' : 'left', padding: '6px 8px', color: 'var(--muted)', fontWeight: 600 }}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultado.vendasPorCodigo.map((v) => (
                    <tr key={v.codigo} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v.codigo}</td>
                      <td style={{ padding: '6px 8px' }}>{v.nome}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatarNumero(v.qtd, 1)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: v.canceladas > 0 ? 'var(--danger)' : undefined }}>
                        {formatarNumero(v.canceladas, 1)}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.dias}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="muted" style={{ margin: '10px 0 0', fontSize: 11 }}>
              Se aparecer mais de um código aqui, a mesma coisa está sendo vendida sob códigos
              diferentes — e só o código que tem ficha entra no teórico.
            </p>
          </div>

          {resultado.linhas.length === 0 ? (
            <div className="card">
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nenhum produto no cadastro com esse termo.</p>
            </div>
          ) : (
            resultado.linhas.map((l) => (
              <div className="card" key={l.codigoEverest}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{l.nome}</p>
                    <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
                      {l.codigoEverest} · {l.unidade} · {l.tipoItem || 'sem tipo'} · {l.categoria || 'sem categoria'}
                      {l.ativo === false && ' · INATIVO'}
                    </p>
                  </div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: corVeredito(l.veredito), maxWidth: 340, textAlign: 'right' }}>
                    {l.veredito}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 22, marginTop: 12, flexWrap: 'wrap', fontSize: 12.5 }}>
                  <span>Ficha: <strong>{l.temFicha ? `sim, ${l.totalIngredientes} linhas` : 'NÃO'}</strong></span>
                  <span>Resolve para: <strong>{l.insumosResolvidos.length} insumo(s)</strong></span>
                  <span>
                    Venda no período:{' '}
                    <strong style={{ color: l.venda?.qtd ? undefined : 'var(--danger)' }}>
                      {l.venda ? `${formatarNumero(l.venda.qtd, 1)} un` : 'nenhuma'}
                    </strong>
                    {l.venda?.canceladas > 0 && (
                      <span className="muted"> ({formatarNumero(l.venda.canceladas, 1)} canceladas)</span>
                    )}
                  </span>
                </div>

                {(l.temFicha || l.insumosResolvidos.length > 0) && (
                  <button
                    onClick={() => setFichaAberta(fichaAberta === l.codigoEverest ? null : l.codigoEverest)}
                    className="muted"
                    style={{ background: 'none', border: 'none', padding: 0, marginTop: 10, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {fichaAberta === l.codigoEverest ? 'ocultar a ficha' : 'ver a ficha linha a linha'}
                  </button>
                )}

                {fichaAberta === l.codigoEverest && (
                  <div style={{ marginTop: 12 }}>
                    {/* "Como estão no banco" é o ponto da tela: mostrar o dado cru, não a
                        interpretação — é o que permite distinguir lacuna de cadastro de bug. */}
                    <p className="muted" style={{ margin: '0 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      Linhas da ficha, como estão no banco
                    </p>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {COLUNAS_FICHA.map((c, i) => (
                            <th key={c} style={{ textAlign: i > 2 ? 'right' : 'left', padding: '5px 8px', color: 'var(--muted)', fontWeight: 600 }}>
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {l.ingredientes.map((ing, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '5px 8px', fontVariantNumeric: 'tabular-nums' }}>{ing.codigo}</td>
                            <td style={{ padding: '5px 8px' }}>{ing.nome}</td>
                            <td style={{ padding: '5px 8px' }} className="muted">{ing.tipoItem || '—'}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatarNumero(ing.bruto, 6)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatarNumero(ing.liquido, 6)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {l.insumosResolvidos.length > 0 && (
                      <>
                        <p className="muted" style={{ margin: '14px 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                          O que o motor resolve — por 1 unidade vendida
                        </p>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <tbody>
                            {l.insumosResolvidos.map((ins, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '5px 8px', fontVariantNumeric: 'tabular-nums', verticalAlign: 'top' }}>{ins.codigo}</td>
                                <td style={{ padding: '5px 8px' }}>
                                  {ins.nome}
                                  {ins.terminalPorFaltaDeFicha && (
                                    <span style={{ color: 'var(--danger)', fontSize: 11 }}> · produzido sem ficha, a cadeia para aqui</span>
                                  )}
                                  {/* 09/09/2026: o parágrafo de aviso do eloIncompleto foi removido
                                      daqui também — mesmo pedido do Felipe feito para o CMV
                                      Semanal ("não quero nenhum alerta ali, deixa tudo confuso"),
                                      aplicado aqui por consistência. O campo `eloIncompleto`
                                      continua vindo em `insumosResolvidos` (não foi removido do
                                      `adminApi.js`), só não é mais desenhado. */}
                                </td>
                                <td style={{ padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, verticalAlign: 'top' }}>
                                  {formatarNumero(ins.quantidadePorUnidade, 6)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </>
      )}
    </div>
  )
}
