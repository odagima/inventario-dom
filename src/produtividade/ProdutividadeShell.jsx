import { useEffect, useState } from 'react'
import { listarUnidades } from '../lib/api'
import {
  PRACAS, TURNOS, turnoAtual,
  listarProducoesCadastradas, criarProducaoCadastrada,
  iniciarProducao, listarAndamentos, registrarManual, listarRegistrosRecentes
} from '../lib/produtividadeApi'
import CartaoAndamento from './CartaoAndamento'

export default function ProdutividadeShell({ usuarioLogado, onVoltar }) {
  const [unidades, setUnidades] = useState([])
  const [unidadeId, setUnidadeId] = useState('')
  const [aba, setAba] = useState('registrar') // 'registrar' | 'andamento' | 'registros'

  const [producoes, setProducoes] = useState([])
  const [praca, setPraca] = useState(PRACAS[0])
  const [insumo, setInsumo] = useState('')
  const [producaoSelecionada, setProducaoSelecionada] = useState('')
  const [novaProducaoNome, setNovaProducaoNome] = useState('')
  const [mostrarNovaProducao, setMostrarNovaProducao] = useState(false)
  const [turno, setTurno] = useState(turnoAtual())
  const [modoManual, setModoManual] = useState(false)
  const [tempoManual, setTempoManual] = useState('')
  const [produzidosManual, setProduzidosManual] = useState([{ nome: '', kg: '', porcoes: '' }])
  const [obsManual, setObsManual] = useState('')

  const [andamentos, setAndamentos] = useState([])
  const [registros, setRegistros] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')

  useEffect(() => {
    Promise.all([listarUnidades(), listarProducoesCadastradas()])
      .then(([listaUnidades, listaProducoes]) => {
        setUnidades(listaUnidades)
        if (listaUnidades.length) setUnidadeId(listaUnidades[0].id)
        setProducoes(listaProducoes)
        if (listaProducoes.length) setProducaoSelecionada(listaProducoes[0].nome)
      })
      .finally(() => setCarregando(false))
  }, [])

  useEffect(() => {
    if (!unidadeId) return
    carregarAndamentos()
  }, [unidadeId])

  async function carregarAndamentos() {
    setAndamentos(await listarAndamentos(unidadeId))
  }

  async function carregarRegistros() {
    setRegistros(await listarRegistrosRecentes(unidadeId))
  }

  function handleSelecionarProducao(nome) {
    setProducaoSelecionada(nome)
    const encontrada = producoes.find((p) => p.nome === nome)
    if (encontrada?.praca_padrao) setPraca(encontrada.praca_padrao)
  }

  async function handleCriarProducao() {
    if (!novaProducaoNome.trim()) return
    await criarProducaoCadastrada(novaProducaoNome.trim(), praca)
    const lista = await listarProducoesCadastradas()
    setProducoes(lista)
    setProducaoSelecionada(novaProducaoNome.trim())
    setNovaProducaoNome('')
    setMostrarNovaProducao(false)
  }

  async function handleIniciar() {
    setErro('')
    if (!insumo.trim() || !producaoSelecionada) { setErro('Preenche o insumo e a produção.'); return }
    setSalvando(true)
    try {
      await iniciarProducao({
        unidadeId, praca, insumo: insumo.trim(), producao: producaoSelecionada,
        funcionario: usuarioLogado.nome, turno
      })
      setInsumo('')
      await carregarAndamentos()
      setAba('andamento')
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  function atualizarProduzidoManual(i, campo, valor) {
    setProduzidosManual((prev) => prev.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p)))
  }

  async function handleSalvarManual() {
    setErro('')
    const validos = produzidosManual.filter((p) => p.nome.trim() && Number(p.kg) > 0 && Number(p.porcoes) > 0)
    if (!insumo.trim() || !producaoSelecionada || !validos.length) {
      setErro('Preenche insumo, produção e pelo menos um produzido com kg e porções.')
      return
    }
    setSalvando(true)
    try {
      await registrarManual({
        unidadeId, praca, insumo: insumo.trim(), producao: producaoSelecionada,
        funcionario: usuarioLogado.nome, turno,
        tempoMin: tempoManual ? Number(tempoManual) : null,
        produzidos: validos.map((p) => ({ nome: p.nome.trim(), kg: Number(p.kg), porcoes: Number(p.porcoes) })),
        obs: obsManual
      })
      setSucesso('Registrado!')
      setInsumo('')
      setTempoManual('')
      setProduzidosManual([{ nome: '', kg: '', porcoes: '' }])
      setObsManual('')
      setTimeout(() => setSucesso(''), 2500)
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  if (carregando) return <div className="screen"><p className="muted">Carregando…</p></div>

  return (
    <div className="screen" style={{ maxWidth: 480 }}>
      <div className="topbar">
        <div>
          <span className="unidade">Produtividade</span>
          <p className="muted" style={{ margin: '2px 0 0' }}>Olá, {usuarioLogado.nome}</p>
        </div>
        <button className="ghost" onClick={onVoltar}>Sair</button>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label className="muted">Loja</label>
        <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
      </div>

      <div className="segmented" style={{ marginBottom: 16 }}>
        <button className={aba === 'registrar' ? 'active' : ''} onClick={() => setAba('registrar')}>Registrar</button>
        <button className={aba === 'andamento' ? 'active' : ''} onClick={() => { setAba('andamento'); carregarAndamentos() }}>
          Em andamento {andamentos.length > 0 ? `(${andamentos.length})` : ''}
        </button>
        <button className={aba === 'registros' ? 'active' : ''} onClick={() => { setAba('registros'); carregarRegistros() }}>Registros</button>
      </div>

      {aba === 'registrar' && (
        <div className="card">
          <div className="segmented" style={{ marginBottom: 14 }}>
            <button className={!modoManual ? 'active' : ''} onClick={() => setModoManual(false)}>Cronometrar</button>
            <button className={modoManual ? 'active' : ''} onClick={() => setModoManual(true)}>Inserir manual</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label className="muted">Insumo (matéria-prima)</label>
              <input value={insumo} onChange={(e) => setInsumo(e.target.value)} placeholder="Ex: Filé mignon" />
            </div>

            <div>
              <label className="muted">Produção</label>
              {mostrarNovaProducao ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={novaProducaoNome} onChange={(e) => setNovaProducaoNome(e.target.value)} placeholder="Nome da nova produção" style={{ flex: 1 }} />
                  <button className="primary" onClick={handleCriarProducao}>Criar</button>
                  <button onClick={() => setMostrarNovaProducao(false)}>Cancelar</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={producaoSelecionada} onChange={(e) => handleSelecionarProducao(e.target.value)} style={{ flex: 1 }}>
                    {producoes.map((p) => <option key={p.id} value={p.nome}>{p.nome}</option>)}
                  </select>
                  <button onClick={() => setMostrarNovaProducao(true)} style={{ flexShrink: 0 }}>+ Nova</button>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label className="muted">Praça</label>
                <select value={praca} onChange={(e) => setPraca(e.target.value)}>
                  {PRACAS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="muted">Turno</label>
                <select value={turno} onChange={(e) => setTurno(e.target.value)}>
                  {TURNOS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {!modoManual ? (
              <>
                {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
                <button className="primary" onClick={handleIniciar} disabled={salvando} style={{ padding: 16, fontSize: 16 }}>
                  {salvando ? 'Iniciando…' : '▶ Iniciar produção'}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="muted">Tempo total (minutos) — ou deixa em branco se não souber</label>
                  <input type="number" value={tempoManual} onChange={(e) => setTempoManual(e.target.value)} placeholder="Ex: 35" />
                </div>
                <p className="muted" style={{ margin: 0 }}>O que foi produzido</p>
                {produzidosManual.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6 }}>
                    <input placeholder="Produzido" value={p.nome} onChange={(e) => atualizarProduzidoManual(i, 'nome', e.target.value)} style={{ flex: 2 }} />
                    <input placeholder="Kg" type="number" value={p.kg} onChange={(e) => atualizarProduzidoManual(i, 'kg', e.target.value)} style={{ flex: 1 }} />
                    <input placeholder="Porções" type="number" value={p.porcoes} onChange={(e) => atualizarProduzidoManual(i, 'porcoes', e.target.value)} style={{ flex: 1 }} />
                  </div>
                ))}
                <button onClick={() => setProduzidosManual((prev) => [...prev, { nome: '', kg: '', porcoes: '' }])} style={{ fontSize: 13 }}>+ Outro produzido</button>
                <input placeholder="Observação (opcional)" value={obsManual} onChange={(e) => setObsManual(e.target.value)} />
                {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
                {sucesso && <p style={{ color: 'var(--success)', fontSize: 13 }}>{sucesso}</p>}
                <button className="primary" onClick={handleSalvarManual} disabled={salvando} style={{ padding: 16, fontSize: 16 }}>
                  {salvando ? 'Salvando…' : '✔ Salvar registro'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {aba === 'andamento' && (
        andamentos.length === 0 ? (
          <p className="muted">Nenhuma produção em andamento nessa loja.</p>
        ) : (
          andamentos.map((a) => (
            <CartaoAndamento
              key={a.id}
              andamento={a}
              onAtualizado={(atualizado) => {
                if (atualizado) {
                  setAndamentos((prev) => prev.map((x) => (x.id === atualizado.id ? atualizado : x)))
                } else {
                  setAndamentos((prev) => prev.filter((x) => x.id !== a.id))
                }
              }}
            />
          ))
        )
      )}

      {aba === 'registros' && (
        registros.length === 0 ? (
          <p className="muted">Nenhum registro ainda.</p>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {registros.map((r) => (
              <div key={r.id} className="list-item" style={{ padding: '12px 14px' }}>
                <div>
                  <p style={{ margin: 0 }}>{r.produzido}</p>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    {r.producao} · {r.funcionario} · {r.praca}
                    {r.tempo_min ? ` · ${r.tempo_min}min` : ''}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontSize: 13 }}>{r.kg}kg</p>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>{r.porcoes} porções</p>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
