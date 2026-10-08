import { useEffect, useState } from 'react'
import { listarUnidadesAdmin, criarUnidade, atualizarUnidade } from '../lib/adminApi'
import { listarLocaisEstoqueTodos, criarLocalEstoque, atualizarLocalEstoque } from '../../lib/locaisEstoqueApi'
import { salvarRotulos } from '../../lib/rotulosApi'
import { useRotulos, useRecarregarRotulos } from '../../lib/RotulosContext'

// Página única de Lojas + Setores (08/10/2026, pedido do Felipe: "faça um levantamento, veja tudo
// que estiver incoerente... quero uma página só pra arrumar essa tabela, pois vai ser dela que
// vamos puxar e padronizar a informação"). Antes, Loja vivia em Configuração → Lojas
// (Unidades.jsx) e Setor vivia dentro de Produção → Locais de estoque, cada um com seu próprio
// cadastro, espalhados em grupos de menu diferentes — difícil de achar ("vejo no adm onde estão
// as informações de loja... quais as lojas? quais setores?").
//
// 08/10/2026, 2ª rodada ("eu quero ter o poder de mexer nisso... ajuste aquela parte no ADM pra eu
// conseguir mexer de forma fácil, ali ficou muito confuso"): ganhou 2 coisas que faltavam —
// (1) dá pra renomear loja/setor direto na lista (antes só CNPJ/depósito/vínculo eram editáveis,
// o nome ficava preso pra sempre do jeito que foi criado); (2) uma seção nova no topo,
// "Nomenclatura", pra trocar as PALAVRAS que o app usa pra cada conceito (Loja/Setor/Usuário/Item/
// Turno) sem precisar mexer em código — ver `rotulosApi.js`/`RotulosContext.jsx`.
export default function LojasSetores() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SecaoNomenclatura />
      <SecaoLojas />
      <SecaoSetores />
    </div>
  )
}

function SecaoNomenclatura() {
  const rotulos = useRotulos()
  const recarregarRotulos = useRecarregarRotulos()
  const [form, setForm] = useState(rotulos)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState('')

  // Sempre que os rótulos globais mudarem (ex.: outra aba salvou antes), o formulário acompanha —
  // mas só enquanto a pessoa não começou a digitar aqui (não sobrescreve um rascunho no meio).
  useEffect(() => { setForm(rotulos) }, [rotulos])

  const CAMPOS = [
    { chave: 'loja', descricao: 'Entidade com CNPJ (hoje: "Loja")' },
    { chave: 'setor', descricao: 'Área operacional — Confeitaria, Estoque Central... (hoje: "Setor")' },
    { chave: 'usuario', descricao: 'Quem loga com o PIN (hoje: "Usuário")' },
    { chave: 'item', descricao: 'O que é contado, pesado ou movimentado (hoje: "Item")' },
    { chave: 'turno', descricao: 'Almoço, Jantar... (hoje: "Turno")' }
  ]

  async function salvar() {
    setErro('')
    setSalvo(false)
    setSalvando(true)
    try {
      const limpo = await salvarRotulos(form)
      setForm(limpo)
      await recarregarRotulos()
      setSalvo(true)
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 17 }}>Nomenclatura</p>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
        As palavras que o app usa pra cada conceito. Troque aqui e atualiza em todo canto que usa
        essa palavra — cabeçalhos de lançamento, listas, formulários.
      </p>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {CAMPOS.map((c) => (
          <div key={c.chave}>
            <label className="muted">{c.descricao}</label>
            <input
              value={form[c.chave] ?? ''}
              onChange={(e) => { setForm((prev) => ({ ...prev, [c.chave]: e.target.value })); setSalvo(false) }}
            />
          </div>
        ))}
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{erro}</p>}
        {salvo && !erro && <p style={{ color: 'var(--success)', fontSize: 13, margin: 0 }}>Salvo — já valeu em todo o app.</p>}
        <button
          className="primary"
          onClick={salvar}
          disabled={salvando || CAMPOS.some((c) => !String(form[c.chave] ?? '').trim())}
        >
          {salvando ? 'Salvando…' : 'Salvar nomenclatura'}
        </button>
      </div>
    </div>
  )
}

function SecaoLojas() {
  const rotulos = useRotulos()
  const [unidades, setUnidades] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [grupoCnpj, setGrupoCnpj] = useState('')
  const [cnpjNovo, setCnpjNovo] = useState('')
  const [codigoDeposito, setCodigoDeposito] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      setUnidades(await listarUnidadesAdmin())
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  // Agrupa as lojas já existentes por CNPJ, pra oferecer "vincular ao mesmo CNPJ de X"
  const gruposExistentes = []
  const vistos = new Set()
  for (const u of unidades) {
    if (u.cnpj && !vistos.has(u.cnpj)) {
      vistos.add(u.cnpj)
      gruposExistentes.push({ cnpj: u.cnpj, nomeReferencia: u.nome })
    }
  }

  async function handleCriar() {
    if (!nome.trim()) return
    setErro('')
    setSalvando(true)
    try {
      const cnpjFinal = grupoCnpj === '__novo__' ? cnpjNovo.trim() : grupoCnpj
      await criarUnidade({ nome: nome.trim(), cnpj: cnpjFinal, codigoDeposito: codigoDeposito.trim() })
      setNome(''); setCnpjNovo(''); setCodigoDeposito(''); setGrupoCnpj('')
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleAtualizarCampo(unidade, campo, valor) {
    if (campo === 'nome' && !valor.trim()) return // nunca salva nome em branco
    const dados = {
      nome: campo === 'nome' ? valor.trim() : unidade.nome,
      cnpj: campo === 'cnpj' ? valor : unidade.cnpj,
      codigoDeposito: campo === 'codigo_deposito' ? valor : unidade.codigo_deposito,
      ativo: campo === 'ativo' ? valor : unidade.ativo
    }
    await atualizarUnidade(unidade.id, dados)
    setUnidades((prev) => prev.map((u) => (u.id === unidade.id ? { ...u, nome: dados.nome, cnpj: dados.cnpj, codigo_deposito: dados.codigoDeposito, ativo: dados.ativo } : u)))
  }

  return (
    <div>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 17 }}>{rotulos.loja}s</p>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
        Entidade com CNPJ — usada na exportação contábil e no cadastro de pessoas. Não dá pra excluir
        (o histórico de lançamentos depende dela) — desmarque "ativo" pra tirar das listas sem apagar nada.
      </p>

      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Nova {rotulos.loja.toLowerCase()}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="muted">Nome da {rotulos.loja.toLowerCase()}</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Novo Bar" />
          </div>
          <div>
            <label className="muted">Vincular ao CNPJ de</label>
            <select value={grupoCnpj} onChange={(e) => setGrupoCnpj(e.target.value)}>
              <option value="">Selecione…</option>
              {gruposExistentes.map((g) => (
                <option key={g.cnpj} value={g.cnpj}>Mesmo CNPJ do {g.nomeReferencia} ({g.cnpj})</option>
              ))}
              <option value="__novo__">Novo CNPJ ({rotulos.loja.toLowerCase()} independente)</option>
            </select>
          </div>
          {grupoCnpj === '__novo__' && (
            <div>
              <label className="muted">Novo CNPJ</label>
              <input value={cnpjNovo} onChange={(e) => setCnpjNovo(e.target.value)} placeholder="Só números" />
            </div>
          )}
          <div>
            <label className="muted">Código do depósito no Everest (opcional por enquanto)</label>
            <input value={codigoDeposito} onChange={(e) => setCodigoDeposito(e.target.value)} placeholder="Ex: 1" />
          </div>
          {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
          <button className="primary" onClick={handleCriar} disabled={salvando || !nome.trim()}>
            {salvando ? 'Criando…' : `Criar ${rotulos.loja.toLowerCase()}`}
          </button>
        </div>
      </div>

      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>{rotulos.loja}s cadastradas</p>
        {carregando ? (
          <p className="muted">Carregando…</p>
        ) : (
          unidades.map((u) => (
            <div key={u.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  defaultValue={u.nome}
                  onBlur={(e) => handleAtualizarCampo(u, 'nome', e.target.value)}
                  style={{ flex: 1, fontWeight: 600, fontSize: 14.5, border: 'none', background: 'none', padding: 0 }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, flexShrink: 0 }} className="muted">
                  <input type="checkbox" checked={u.ativo} onChange={(e) => handleAtualizarCampo(u, 'ativo', e.target.checked)} />
                  ativo
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  defaultValue={u.cnpj || ''}
                  placeholder="CNPJ"
                  onBlur={(e) => handleAtualizarCampo(u, 'cnpj', e.target.value)}
                  style={{ flex: 1, fontSize: 13 }}
                />
                <input
                  defaultValue={u.codigo_deposito || ''}
                  placeholder="Cód. depósito"
                  onBlur={(e) => handleAtualizarCampo(u, 'codigo_deposito', e.target.value)}
                  style={{ flex: 1, fontSize: 13 }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function SecaoSetores() {
  const rotulos = useRotulos()
  const [setores, setSetores] = useState([])
  const [unidades, setUnidades] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [unidadeId, setUnidadeId] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    setCarregando(true)
    try {
      const [s, u] = await Promise.all([listarLocaisEstoqueTodos(), listarUnidadesAdmin()])
      setSetores(s)
      setUnidades(u)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  async function handleCriar() {
    if (!nome.trim()) return
    setErro('')
    setSalvando(true)
    try {
      await criarLocalEstoque({ nome: nome.trim(), unidadeId: unidadeId || null })
      setNome(''); setUnidadeId('')
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function handleAtualizarCampo(s, campo, valor) {
    if (campo === 'nome' && !valor.trim()) return // nunca salva nome em branco
    const valorFinal = campo === 'nome' ? valor.trim() : valor
    await atualizarLocalEstoque(s.id, { [campo]: valorFinal })
    setSetores((prev) => prev.map((x) => (x.id === s.id ? { ...x, [campo]: valorFinal } : x)))
  }

  return (
    <div>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 17 }}>{rotulos.setor}es</p>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 12 }}>
        Área operacional onde se produz/estoca (Confeitaria, Produção, Serviço Dalva…) — é de onde
        Perdas, Produção, Recebimento e Abrir/Fechar praça puxam o local do lançamento. Não dá pra
        excluir (o histórico de lançamentos depende dele) — desmarque "ativo" pra tirar das listas
        sem apagar nada.
      </p>

      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>Novo {rotulos.setor.toLowerCase()}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label className="muted">Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Bar Dalva" />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label className="muted">{rotulos.loja} — opcional</label>
            <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
              <option value="">Nenhuma</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
          <button className="primary" onClick={handleCriar} disabled={salvando || !nome.trim()} style={{ height: 44 }}>
            {salvando ? 'Criando…' : 'Criar'}
          </button>
        </div>
        {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{erro}</p>}
      </div>

      <div className="card">
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15 }}>{rotulos.setor}es cadastrados</p>
        {carregando ? (
          <p className="muted">Carregando…</p>
        ) : (
          setores.map((s) => (
            <div key={s.id} className="list-item" style={{ gap: 10, flexWrap: 'wrap' }}>
              <input
                defaultValue={s.nome}
                onBlur={(e) => handleAtualizarCampo(s, 'nome', e.target.value)}
                style={{ flex: 1, minWidth: 110, fontWeight: 500, border: 'none', background: 'none', padding: 0 }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <select
                  value={s.unidade_id || ''}
                  onChange={(e) => handleAtualizarCampo(s, 'unidade_id', e.target.value || null)}
                  style={{ fontSize: 12.5, padding: '6px 8px' }}
                >
                  <option value="">Sem {rotulos.loja.toLowerCase()}</option>
                  {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }} className="muted">
                  <input type="checkbox" checked={s.ativo} onChange={(e) => handleAtualizarCampo(s, 'ativo', e.target.checked)} />
                  ativo
                </label>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
