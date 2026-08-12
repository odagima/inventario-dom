import { useEffect, useState } from 'react'
import {
  listarUnidades,
  listarGrupos,
  listarItensDoGrupo,
  listarProdutosParaMensal,
  buscarSessaoEmAndamento,
  iniciarSessao,
  buscarConfiguracaoGeral,
  finalizarSessao
} from '../lib/api'
import BuscaProduto from '../components/BuscaProduto'

// Contagem semanal não pede loja (Compras não separa por loja no Everest, e a Contagem Semanal
// já é filtrada por Grupo de contagem) — só Inventário geral e os demais tipos exigem loja.
function tipoExigeLoja(tipo) {
  return tipo !== 'semanal'
}

const TIPOS_CONTAGEM = [
  { valor: 'mensal', label: 'Inventário geral', usaGrupo: false },
  { valor: 'semanal', label: 'Contagem semanal', usaGrupo: true },
  { valor: 'diario', label: 'Contagem tempo de produção', usaGrupo: true },
  { valor: 'producao', label: 'Registro de produção', usaGrupo: false },
  { valor: 'perdas', label: 'Registro de perdas/desperdício', usaGrupo: false }
]
const POR_VALOR = Object.fromEntries(TIPOS_CONTAGEM.map((t) => [t.valor, t]))

function hojeIso() {
  return new Date().toISOString().slice(0, 10)
}

// etapa: 'escolha' (tipo + loja + nome) | 'form' (grupo, se precisar) | 'revisao'
export default function SelecaoUnidade({ usuarioLogado, onSessaoPronta, onVoltar }) {
  const [etapa, setEtapa] = useState('escolha')
  const [tipo, setTipo] = useState(null)
  const [unidades, setUnidades] = useState([])
  const [unidadeId, setUnidadeId] = useState('')
  const [grupos, setGrupos] = useState([])
  const [grupoId, setGrupoId] = useState('')
  const [dataContagem, setDataContagem] = useState(hojeIso())
  const [itensRevisao, setItensRevisao] = useState([])
  const [configGeral, setConfigGeral] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState('')
  const [sessaoAntigaDetectada, setSessaoAntigaDetectada] = useState(null)

  useEffect(() => {
    Promise.all([listarUnidades(), buscarConfiguracaoGeral()])
      .then(([listaUnidades, config]) => {
        setUnidades(listaUnidades)
        // Não pré-selecionar loja: força o usuário a escolher (evita contagem na loja errada).
        setConfigGeral(config)
      })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [])

  useEffect(() => {
    if (tipo && POR_VALOR[tipo]?.usaGrupo) {
      listarGrupos().then((lista) => {
        setGrupos(lista)
        if (lista.length) setGrupoId(lista[0].id)
      })
    }
  }, [tipo])

  const mesBloqueado = tipo === 'mensal' && (!configGeral?.mesAtivoMensal || !configGeral?.anoAtivoMensal)

  function handleEscolherTipo(valor) {
    setErro('')
    setTipo(valor)
  }

  async function handleContinuar() {
    if (!tipo) return
    if (tipoExigeLoja(tipo) && !unidadeId) return
    setErro('')
    setProcessando(true)
    try {
      const sessaoExistente = tipoExigeLoja(tipo)
        ? await buscarSessaoEmAndamento({ unidadeId, tipo })
        : await buscarSessaoEmAndamento({ grupoId, tipo })
      if (sessaoExistente) {
        const horasAberta = (Date.now() - new Date(sessaoExistente.iniciada_em).getTime()) / (1000 * 60 * 60)
        const unidade = unidades.find((u) => u.id === unidadeId)
        const grupo = grupos.find((g) => g.id === grupoId)
        if (horasAberta >= 18) {
          setSessaoAntigaDetectada({ sessao: sessaoExistente, unidade, grupo, horasAberta })
          return
        }
        onSessaoPronta({ sessao: sessaoExistente, unidade, grupo })
        return
      }
      const infoTipo = POR_VALOR[tipo]
      if (infoTipo.usaGrupo) {
        if (!grupoId) { setErro('Cadastre um grupo antes de iniciar essa contagem.'); return }
        const itens = await listarItensDoGrupo(grupoId)
        if (tipo === 'semanal') {
          // Semanal: grupo único, vai direto pra contagem (sem etapa de revisão).
          await confirmarInicio(itens.map((p) => p.id))
        } else {
          setItensRevisao(itens)
          setEtapa('revisao')
        }
      } else if (tipo === 'mensal') {
        await confirmarInicio(await listarProdutosParaMensal())
      } else {
        await confirmarInicio([])
      }
    } catch (e) {
      setErro(e.message)
    } finally {
      setProcessando(false)
    }
  }

  async function confirmarInicio(itensEsperadosIds) {
    setProcessando(true)
    try {
      // Semanal: mês/ano de referência seguem a data escolhida (pode ser retroativa), não o dia
      // real do lançamento — assim uma contagem de segunda lançada só na quarta ainda cai no mês
      // certo pro histórico/relatórios.
      const [anoData, mesData] = tipo === 'semanal' && dataContagem ? dataContagem.split('-').map(Number) : []
      const sessao = await iniciarSessao({
        unidadeId: tipoExigeLoja(tipo) ? unidadeId : null,
        usuario: usuarioLogado.nome,
        tipo,
        grupoId: POR_VALOR[tipo]?.usaGrupo ? grupoId : null,
        mesReferencia: tipo === 'mensal' ? configGeral.mesAtivoMensal : (mesData || new Date().getMonth() + 1),
        anoReferencia: tipo === 'mensal' ? configGeral.anoAtivoMensal : (anoData || new Date().getFullYear()),
        dataReferencia: tipo === 'semanal' ? dataContagem : null,
        itensEsperadosIds
      })
      const unidade = unidades.find((u) => u.id === unidadeId)
      const grupo = grupos.find((g) => g.id === grupoId)
      onSessaoPronta({ sessao, unidade: tipoExigeLoja(tipo) ? unidade : null, grupo })
    } catch (e) {
      setErro(e.message)
    } finally {
      setProcessando(false)
    }
  }

  async function handleContinuarSessaoAntiga() {
    onSessaoPronta({ sessao: sessaoAntigaDetectada.sessao, unidade: sessaoAntigaDetectada.unidade, grupo: sessaoAntigaDetectada.grupo })
  }

  async function handleEncerrarEComecarNova() {
    setProcessando(true)
    setErro('')
    try {
      await finalizarSessao(sessaoAntigaDetectada.sessao.id)
      setSessaoAntigaDetectada(null)
      await handleContinuar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setProcessando(false)
    }
  }

  function handleAdicionarItemRevisao(produto) {
    if (itensRevisao.some((p) => p.id === produto.id)) return
    setItensRevisao((prev) => [...prev, produto])
  }

  function handleRemoverItemRevisao(produtoId) {
    setItensRevisao((prev) => prev.filter((p) => p.id !== produtoId))
  }

  if (carregando) return <div className="screen"><p className="muted">Carregando…</p></div>

  if (sessaoAntigaDetectada) {
    const dias = Math.floor(sessaoAntigaDetectada.horasAberta / 24)
    const nomeContexto = sessaoAntigaDetectada.unidade?.nome || sessaoAntigaDetectada.grupo?.nome || 'contagem'
    return (
      <div className="screen" style={{ justifyContent: 'center' }}>
        <div className="card">
          <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 16 }}>Sessão antiga em andamento</p>
          <p className="muted" style={{ margin: '0 0 20px' }}>
            Tem uma contagem de <strong style={{ color: 'var(--text)' }}>{nomeContexto}</strong> iniciada
            {dias >= 1 ? ` há ${dias} ${dias === 1 ? 'dia' : 'dias'}` : ' há mais de 18 horas'}, ainda em andamento.
            Provavelmente alguém esqueceu de enviar. Quer continuar ela ou começar uma nova (a antiga é encerrada automaticamente)?
          </p>
          {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="primary" onClick={handleContinuarSessaoAntiga}>Continuar essa sessão</button>
            <button onClick={handleEncerrarEComecarNova} disabled={processando}>
              {processando ? 'Encerrando…' : 'Encerrar e começar nova'}
            </button>
            <button className="ghost" onClick={() => setSessaoAntigaDetectada(null)}>Cancelar</button>
          </div>
        </div>
      </div>
    )
  }

  if (etapa === 'revisao') {
    return (
      <div className="screen">
        <div className="app-header">
          <p className="brand">Grupo DOM</p>
          <p className="subtitle">Ajustar itens — {POR_VALOR[tipo].label}</p>
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Lista do grupo, com {itensRevisao.length} {itensRevisao.length === 1 ? 'item' : 'itens'}. Adicione ou remova antes de iniciar.
        </p>
        <div className="card" style={{ marginBottom: 14, maxHeight: 260, overflowY: 'auto' }}>
          {itensRevisao.map((p) => (
            <div key={p.id} className="list-item">
              <span>{p.nome}</span>
              <button onClick={() => handleRemoverItemRevisao(p.id)} style={{ fontSize: 16, color: 'var(--danger)', background: 'none', border: 'none' }}>×</button>
            </div>
          ))}
        </div>
        <BuscaProduto onSelecionar={handleAdicionarItemRevisao} mostrarCamera={false} />
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{erro}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => setEtapa('escolha')} style={{ flex: 1 }}>Voltar</button>
          <button
            className="primary"
            disabled={processando || itensRevisao.length === 0}
            onClick={() => confirmarInicio(itensRevisao.map((p) => p.id))}
            style={{ flex: 1 }}
          >
            {processando ? 'Iniciando…' : 'Iniciar contagem'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="app-header">
        <p className="brand">Grupo DOM</p>
        <p className="subtitle">Olá, {usuarioLogado.nome}!</p>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="muted">O que você vai fazer?</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            {TIPOS_CONTAGEM.map((t) => (
              <button
                key={t.valor}
                onClick={() => handleEscolherTipo(t.valor)}
                className={tipo === t.valor ? 'active' : ''}
                style={{
                  textAlign: 'left', padding: '12px 14px',
                  background: tipo === t.valor ? 'var(--accent-soft)' : 'var(--surface-2)',
                  color: tipo === t.valor ? 'var(--accent-soft-text)' : 'var(--text)',
                  fontWeight: tipo === t.valor ? 600 : 500
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tipo && (
          <>
            {mesBloqueado ? (
              <p className="muted">Nenhum mês foi liberado pelo Administrativo pra contagem mensal ainda. Fala com quem cuida do admin.</p>
            ) : (
              <>
                {tipoExigeLoja(tipo) && (
                  <div style={{ padding: 12, borderRadius: 10, border: unidadeId ? '1px solid var(--border)' : '2px solid var(--warning)', background: 'var(--surface-2)' }}>
                    <label style={{ fontWeight: 700, fontSize: 15, display: 'block', marginBottom: 6 }}>
                      Loja {!unidadeId && <span style={{ color: 'var(--warning)', fontWeight: 500 }}>— escolha antes de iniciar</span>}
                    </label>
                    <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
                      <option value="">Selecione a loja…</option>
                      {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                    </select>
                  </div>
                )}

                {tipo === 'mensal' && configGeral?.mesAtivoMensal && (
                  <p className="muted">
                    Referência: {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][configGeral.mesAtivoMensal - 1]}/{configGeral.anoAtivoMensal}
                  </p>
                )}

                {POR_VALOR[tipo].usaGrupo && grupos.length === 0 && (
                  <p className="muted" style={{ marginTop: 6 }}>Nenhum grupo cadastrado ainda — crie um em Contagem semanal → Grupos de contagem.</p>
                )}
                {POR_VALOR[tipo].usaGrupo && grupos.length > 0 && (
                  <div style={tipo === 'semanal' ? { padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)' } : undefined}>
                    <label className={tipo === 'semanal' ? undefined : 'muted'} style={tipo === 'semanal' ? { fontWeight: 700, fontSize: 15, display: 'block', marginBottom: 6 } : undefined}>
                      Grupo de contagem
                    </label>
                    <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)}>
                      {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                    </select>
                  </div>
                )}

                {tipo === 'semanal' && (
                  <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                    <label style={{ fontWeight: 700, fontSize: 15, display: 'block', marginBottom: 6 }}>Data da contagem</label>
                    <input type="date" value={dataContagem} onChange={(e) => setDataContagem(e.target.value)} />
                    <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
                      {dataContagem === hojeIso() ? 'Entrando com a data de hoje.' : 'Data alterada — vale como o dia real da contagem.'}
                    </p>
                  </div>
                )}

                {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}

                <button
                  className="primary"
                  onClick={handleContinuar}
                  disabled={
                    processando ||
                    (tipoExigeLoja(tipo) && !unidadeId) ||
                    (POR_VALOR[tipo].usaGrupo && grupos.length === 0)
                  }
                >
                  {processando ? 'Abrindo…' : (POR_VALOR[tipo].usaGrupo && tipo !== 'semanal') ? 'Revisar itens' : 'Iniciar'}
                </button>
              </>
            )}
          </>
        )}
      </div>

      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <button className="ghost" onClick={onVoltar}>‹ Voltar</button>
      </div>
    </div>
  )
}
