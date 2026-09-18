import { useEffect, useState } from 'react'
import { buscarArvoreDeOrigem } from '../lib/adminApi'
import { formatarMoeda } from '../lib/formato'

// ⚠️ 03/09/2026 — ARQUIVO RECUPERADO DO BUNDLE PUBLICADO (build 54), não do repositório.
// Nunca subiu pro GitHub (entregas commitadas como .zip sem extrair; a árvore versionada parou em
// 17/08). A lógica foi lida do JS minificado do dist 54, que preserva estrutura, strings e nomes
// de campo. Os dados vêm inteiros de `buscarArvoreDeOrigem` (`adminApi.js`, intacto no repo).
//
// O que este componente é (§24, §24.1): a árvore que mostra um prato/PP se desmontando nível por
// nível até o insumo em natura. Os filhos de um nó são os ingredientes da MESMA ficha, usados
// JUNTOS — por isso o valor do nó é a SOMA dos filhos (diferente da Árvore de Usos, onde os ramos
// são usos alternativos e o valor se conserva por caminho).

export const LABEL_CATEGORIA = {
  venda: 'prato vendido',
  insumo: 'insumo',
  embalagem: 'embalagem',
  pre_preparo: 'pré-preparo',
  limpeza_uniforme: 'limpeza/uniforme',
  equipamento: 'equipamento'
}

// Poda por foco (§24.1): abrir a receita inteira quando o interesse é um insumo só é ruído
// ("se eu estou vendo o bovino peça, eu não quero ver tudo"). Mantém apenas os ramos que chegam ao
// código pedido e RECALCULA a soma de cada nó podado com o que sobrou — senão o valor exibido não
// corresponderia ao que está na tela.
export function podarAteInsumo(no, codigoAlvo) {
  if (no.codigoEverest === codigoAlvo) return no
  if (!no.filhos || no.filhos.length === 0) return null

  const filhos = no.filhos.map((f) => podarAteInsumo(f, codigoAlvo)).filter(Boolean)
  if (!filhos.length) return null

  // Possível duplicata não entra na soma (é a mesma quantidade contada de outro jeito, §24).
  const somaveis = filhos.filter((f) => !f.possivelDuplicata)
  const comValor = somaveis.filter((f) => f.valorTotal != null)
  const valorTotal = comValor.length
    ? Math.round(comValor.reduce((acc, f) => acc + f.valorTotal, 0) * 100) / 100
    : null
  const custoPorKg = valorTotal != null && no.quantidade > 0
    ? Math.round((valorTotal / no.quantidade) * 100) / 100
    : null

  return {
    ...no,
    filhos,
    valorTotal,
    custoPorKg,
    // Falta preço de algum ingrediente: o valor mostrado é parcial e precisa dizer isso.
    valorIncompleto: somaveis.some((f) => f.valorTotal == null)
  }
}

export function NoDaArvore({ no, profundidade }) {
  const [aberto, setAberto] = useState(true)
  const temFilhos = no.filhos && no.filhos.length > 0

  // Folha sem ficha própria tem dois significados: é insumo em natura de verdade (fim legítimo da
  // cadeia) ou é um PP que ninguém cadastrou (gap). Nunca some como se fosse zero.
  const rotuloFolha = no.semFichaPropria
    ? (no.categoria === 'insumo' ? 'insumo em natura' : 'sem ficha técnica cadastrada — gap')
    : null

  const fundoDeAlerta = no.fatorAusente || (no.semFichaPropria && no.categoria !== 'insumo')

  return (
    <div style={{ marginLeft: profundidade === 0 ? 0 : 20, opacity: no.possivelDuplicata ? 0.55 : 1 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
        borderLeft: profundidade > 0 ? '2px solid var(--border)' : 'none',
        borderRadius: 8,
        background: fundoDeAlerta ? 'rgba(179, 64, 42, 0.08)' : (profundidade === 0 ? 'var(--surface-2)' : 'transparent')
      }}>
        {temFilhos
          ? <button onClick={() => setAberto((v) => !v)} className="ghost" style={{ padding: '2px 8px', minWidth: 28 }}>{aberto ? '−' : '+'}</button>
          : <span style={{ width: 28 }} />}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontWeight: profundidade === 0 ? 700 : 500, fontSize: 13.5,
              textDecoration: no.possivelDuplicata ? 'line-through' : 'none'
            }}>
              {no.nome || no.codigoEverest}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>{no.codigoEverest}</span>
            {no.categoria && (
              <span className="muted" style={{ fontSize: 11, border: '1px solid var(--border)', borderRadius: 6, padding: '1px 6px' }}>
                {LABEL_CATEGORIA[no.categoria] || no.categoria}
              </span>
            )}
            {rotuloFolha && (
              <span className="muted" style={{ fontSize: 11, color: no.categoria === 'insumo' ? 'var(--accent)' : 'var(--danger)' }}>
                {rotuloFolha}
              </span>
            )}
            {no.possivelDuplicata && (
              <span style={{ fontSize: 11, color: 'var(--danger)' }}>possível duplicata — não somada</span>
            )}
          </div>

          {no.fatorAusente ? (
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--danger)' }}>
              ficha cadastrada, mas sem fator/quantidade líquida nessa linha — não dá pra calcular
              quanto disso é usado (gap de cadastro, não é zero).
            </p>
          ) : (
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
              {no.quantidade != null ? `${no.quantidade} ${no.unidadeMedida || ''}` : '—'}
              {no.custoPorKg != null && ` · ${formatarMoeda(no.custoPorKg)}/${no.unidadeMedida || 'un'}`}
              {no.valorTotal != null && ` · valor ${formatarMoeda(no.valorTotal)}`}
              {no.valorIncompleto && ' · custo incompleto (falta preço de algum ingrediente)'}
            </p>
          )}

          {/* §24.3 — o cadastro cru do Everest ao lado da conta, sempre visível. Foi o pedido do
              Felipe ("me mostra como está aparecendo na ficha"): sem isso não dá pra distinguir
              lacuna de cadastro de erro de leitura sem abrir o Everest em outra aba. */}
          {no.cadastroNaFicha && (
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 11 }}>
              como está na ficha de <strong>{no.cadastroNaFicha.fichaPaiNome}</strong>: bruto (qtd. baixa estoque) ={' '}
              {no.cadastroNaFicha.brutoCadastrado != null ? no.cadastroNaFicha.brutoCadastrado : '—'} · líquido (qtd. aplicada) ={' '}
              {no.cadastroNaFicha.liquidoCadastrado != null ? no.cadastroNaFicha.liquidoCadastrado : '—'} · fator cadastrado ={' '}
              {no.cadastroNaFicha.fatorCadastrado != null ? no.cadastroNaFicha.fatorCadastrado : '— (vazio)'} · % aproveitamento cadastrado ={' '}
              {no.cadastroNaFicha.percentualAproveitamentoCadastrado != null ? `${no.cadastroNaFicha.percentualAproveitamentoCadastrado}%` : '— (vazio)'}
            </p>
          )}

          {no.truncadoPorProfundidade && (
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--accent)' }}>
              cadeia continua além do limite de níveis mostrado aqui.
            </p>
          )}
        </div>
      </div>

      {aberto && temFilhos && (
        <div>
          {no.filhos.map((filho, i) => (
            <NoDaArvore key={`${filho.codigoEverest}-${i}`} no={filho} profundidade={profundidade + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ArvoreDeOrigemView({ codigoEverest, codigoFoco }) {
  const [arvore, setArvore] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [verCompleta, setVerCompleta] = useState(false)

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro('')
    setArvore(null)
    setVerCompleta(false)
    buscarArvoreDeOrigem(codigoEverest)
      .then((r) => {
        if (cancelado) return
        if (r) setArvore(r)
        else setErro('Não achei esse código no cadastro atual de Produtos.')
      })
      .catch((e) => { if (!cancelado) setErro(e.message) })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [codigoEverest])

  if (carregando) return <p className="muted" style={{ fontSize: 12 }}>Montando a árvore…</p>
  if (erro) return <p style={{ color: 'var(--danger)', fontSize: 12 }}>{erro}</p>
  if (!arvore) return null

  const podada = codigoFoco && !verCompleta ? podarAteInsumo(arvore, codigoFoco) : null

  // Pediu foco mas não existe caminho até o insumo: mostra a árvore completa com o aviso, em vez
  // de deixar a área em branco (ficha com lacuna é informação, não erro a esconder).
  if (codigoFoco && !verCompleta && !podada) {
    return (
      <>
        <p className="muted" style={{ fontSize: 12, color: 'var(--danger)' }}>
          Não achei um caminho até esse insumo dentro dessa receita (pode ser uma ficha com lacuna) —
          mostrando a árvore completa do item.
        </p>
        <NoDaArvore no={arvore} profundidade={0} />
      </>
    )
  }

  return (
    <>
      <NoDaArvore no={podada || arvore} profundidade={0} />
      {codigoFoco && (
        <button
          onClick={() => setVerCompleta((v) => !v)}
          className="ghost"
          style={{ marginTop: 10, fontSize: 11.5, padding: '4px 8px' }}
        >
          {verCompleta ? '← Mostrar só o caminho até esse insumo' : 'Ver a receita completa deste item →'}
        </button>
      )}
    </>
  )
}
