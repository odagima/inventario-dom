import { useEffect, useMemo, useState } from 'react'
import {
  listarUsuariosApp,
  listarPerfisAcesso,
  criarPerfilAcesso,
  atualizarPerfilAcesso,
  atualizarAcessoUsuario,
  criarUsuarioComPerfil,
  editarNomeUsuarioApp,
  listarUnidadesAdmin
} from '../lib/adminApi'

// ═══════════════════════════════════════════════════════════════════════════════
// 02/09/2026 (§67) — USUÁRIOS E PERFIS, numa tela só.
//
// Substitui a antiga `Usuarios.jsx` (que só listava nome/nível/ativo e editava inline). O arquivo
// antigo não foi apagado; só saiu do menu.
//
// Decisões que esta tela implementa (todas travadas com o Felipe):
//   · Perfil é CADASTRO com permissões marcáveis, não lista fixa no código.
//   · PIN de 4 dígitos mantido pra todos, e ESCONDIDO por padrão, com botão de revelar — antes a
//     lista mostrava o PIN de todo mundo aberto na tela, num aparelho compartilhado.
//   · Edição em PAINEL, não inline: mexer em acesso de gente merece um lugar com contexto, não um
//     campinho no meio da lista.
//   · Administrador pode criar e alterar administrador. Ninguém vira desenvolvedor pela tela —
//     `eh_desenvolvedor` é coluna e só muda por SQL (senão quem abre esta tela se promove).
//   · Loja na pessoa é OPCIONAL e nesta versão não restringe nada: serve pra pré-selecionar loja na
//     contagem e filtrar "quem lançou".
//   · Quem está SEM perfil continua funcionando pelo `nivel_acesso` antigo — a tela sinaliza isso
//     em vez de tratar como erro, porque é o estado esperado até o Felipe revisar pessoa por pessoa.
// ═══════════════════════════════════════════════════════════════════════════════

// As áreas e ações são as mesmas semeadas na migration_v15. Ficam aqui só como RÓTULO (o que cada
// permissão quer dizer em português) — a lista de quem tem o quê vive no banco.
const AREAS = [
  {
    area: 'Inventário e custos',
    acoes: [
      { id: 'contagens.ver', label: 'Ver contagens e lançamentos' },
      { id: 'contagens.lancar', label: 'Lançar contagem, perda e produção' },
      { id: 'custos.ver', label: 'Ver CMV, margem e exportação contábil' },
      { id: 'cadastros.ver', label: 'Ver produtos e fichas técnicas' },
      { id: 'cadastros.editar', label: 'Editar cadastros e configuração' },
      { id: 'importar.executar', label: 'Importar arquivos do Everest' }
    ]
  },
  {
    area: 'Manutenção',
    acoes: [
      { id: 'chamados.ver', label: 'Ver chamados' },
      { id: 'chamados.abrir', label: 'Abrir chamado' },
      { id: 'chamados.atender', label: 'Atender chamado' },
      { id: 'orcamentos.ver', label: 'Ver orçamentos' },
      { id: 'orcamentos.lancar', label: 'Lançar orçamento' },
      { id: 'orcamentos.aprovar', label: 'Aprovar orçamento' },
      { id: 'gastos.ver', label: 'Ver gastos e financeiro' }
    ]
  },
  {
    area: 'Pessoas',
    acoes: [
      { id: 'usuarios.ver', label: 'Ver usuários e perfis' },
      { id: 'usuarios.editar', label: 'Criar e alterar usuários e perfis' }
    ]
  }
]

const card = { border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12 }
const rotulo = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }

function PinOculto({ pin }) {
  const [visivel, setVisivel] = useState(false)
  if (!pin) return <span className="muted">—</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.12em' }}>{visivel ? pin : '••••'}</span>
      <button
        className="ghost"
        onClick={() => setVisivel((v) => !v)}
        style={{ fontSize: 10.5, padding: '2px 6px' }}
      >
        {visivel ? 'esconder' : 'revelar'}
      </button>
    </span>
  )
}

export default function UsuariosPerfis({ usuarioLogado = null }) {
  const [aba, setAba] = useState('pessoas')
  const [usuarios, setUsuarios] = useState([])
  const [perfis, setPerfis] = useState([])
  const [unidades, setUnidades] = useState([])
  const [semMigracao, setSemMigracao] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState(null) // usuário em edição (painel)
  const [novoAberto, setNovoAberto] = useState(false)
  const [perfilEditando, setPerfilEditando] = useState(null)

  // Só quem tem `usuarios.editar` (ou é desenvolvedor) muda alguma coisa. Sem perfil vinculado
  // segue podendo, igual a hoje — a transição não pode travar o Felipe fora da própria tela.
  const podeEditar = useMemo(() => {
    if (!usuarioLogado) return true
    if (usuarioLogado.ehDesenvolvedor) return true
    const lista = Array.isArray(usuarioLogado.permissoes) ? usuarioLogado.permissoes : []
    if (!lista.length) return true
    return lista.includes('usuarios.editar')
  }, [usuarioLogado])

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const [us, ps, un] = await Promise.all([listarUsuariosApp(), listarPerfisAcesso(), listarUnidadesAdmin()])
      setUsuarios(us || [])
      // `null` = tabela `perfis_acesso` não existe ainda (migration_v15 não rodada).
      setSemMigracao(ps === null)
      setPerfis(ps || [])
      setUnidades((un || []).filter((u) => u.ativo !== false))
    } catch (e) {
      setErro(e.message || String(e))
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  const listaFiltrada = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return (usuarios || [])
      .filter((u) => (mostrarInativos ? true : u.ativo !== false))
      .filter((u) => (termo ? (u.nome_completo || '').toLowerCase().includes(termo) : true))
  }, [usuarios, busca, mostrarInativos])

  // Agrupado por perfil, com contagem — é assim que a pergunta "quem é o quê" se responde de
  // relance. Quem está sem perfil aparece num grupo próprio no fim, sinalizado.
  const porPerfil = useMemo(() => {
    const grupos = new Map()
    for (const u of listaFiltrada) {
      const chave = u.perfil_nome || '__sem__'
      if (!grupos.has(chave)) grupos.set(chave, [])
      grupos.get(chave).push(u)
    }
    const nomes = [...grupos.keys()].filter((k) => k !== '__sem__').sort((a, b) => a.localeCompare(b, 'pt-BR'))
    if (grupos.has('__sem__')) nomes.push('__sem__')
    return nomes.map((n) => ({ perfil: n, pessoas: grupos.get(n) }))
  }, [listaFiltrada])

  async function acao(fn, mensagem) {
    setErro(null)
    setAviso(null)
    try {
      await fn()
      setAviso(mensagem)
      await carregar()
    } catch (e) {
      setErro(e.message || String(e))
    }
  }

  if (carregando) return <p className="muted">Carregando…</p>

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Usuários e acessos</h2>

      {semMigracao && (
        <div style={{ ...card, borderColor: 'var(--danger)' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>
            A tabela de perfis ainda não existe no banco.
          </p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 11.5 }}>
            Rode <code>supabase/migration_v15.sql</code> no SQL Editor do Supabase. Até então, esta
            tela lista as pessoas e deixa trocar nome, PIN e ativo — só o vínculo de perfil e loja
            fica indisponível, e ninguém perde acesso (todos seguem pelo nível antigo).
          </p>
        </div>
      )}

      {erro && (
        <div style={{ ...card, borderColor: 'var(--danger)' }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--danger)' }}>{erro}</p>
        </div>
      )}
      {aviso && (
        <div style={{ ...card, borderColor: 'var(--border)' }}>
          <p style={{ margin: 0, fontSize: 12.5 }}>{aviso}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[{ id: 'pessoas', label: 'Pessoas' }, { id: 'perfis', label: 'Perfis' }].map((t) => (
          <button
            key={t.id}
            className={aba === t.id ? '' : 'ghost'}
            onClick={() => { setAba(t.id); setEditando(null); setPerfilEditando(null) }}
            style={{ fontSize: 12.5, padding: '6px 12px', borderRadius: 999 }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {aba === 'pessoas' && (
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <input
              placeholder="Buscar por nome"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ flex: '1 1 200px', minWidth: 160 }}
            />
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
              mostrar inativos
            </label>
            {podeEditar && (
              <button onClick={() => { setNovoAberto((v) => !v); setEditando(null) }}>
                {novoAberto ? 'Cancelar' : 'Nova pessoa'}
              </button>
            )}
          </div>

          {novoAberto && podeEditar && (
            <NovaPessoa
              perfis={perfis}
              unidades={unidades}
              onSalvar={async (dados) => {
                await acao(() => criarUsuarioComPerfil(dados), `${dados.nomeCompleto} cadastrado.`)
                setNovoAberto(false)
              }}
            />
          )}

          {editando && podeEditar && (
            <PainelPessoa
              usuario={editando}
              perfis={perfis}
              unidades={unidades}
              semMigracao={semMigracao}
              onFechar={() => setEditando(null)}
              onSalvar={async (mudancas) => {
                await acao(async () => {
                  if (mudancas.nome != null && mudancas.nome !== editando.nome_completo) {
                    await editarNomeUsuarioApp(editando.id, mudancas.nome)
                  }
                  const temAcesso = mudancas.perfilId !== undefined || mudancas.unidadeId !== undefined ||
                    mudancas.limparUnidade || mudancas.pin || mudancas.ativo !== undefined
                  if (temAcesso) {
                    await atualizarAcessoUsuario(editando.id, {
                      perfilId: mudancas.perfilId ?? null,
                      unidadeId: mudancas.unidadeId ?? null,
                      limparUnidade: !!mudancas.limparUnidade,
                      pin: mudancas.pin || null,
                      ativo: mudancas.ativo
                    })
                  }
                }, 'Alterações salvas.')
                setEditando(null)
              }}
            />
          )}

          {porPerfil.length === 0 && <p className="muted">Ninguém encontrado com esse filtro.</p>}

          {porPerfil.map((g) => (
            <div key={g.perfil} style={{ marginBottom: 16 }}>
              <p className="muted" style={{ ...rotulo, margin: '0 0 6px' }}>
                {g.perfil === '__sem__' ? 'Sem perfil vinculado' : g.perfil} · {g.pessoas.length}
              </p>
              {g.perfil === '__sem__' && (
                <p className="muted" style={{ margin: '0 0 6px', fontSize: 11 }}>
                  Continuam funcionando pelo nível antigo, sem restrição de menu. Vincular um perfil
                  é o que passa a valer o acesso marcado.
                </p>
              )}
              <div style={card}>
                {g.pessoas.map((u, i) => (
                  <div
                    key={u.id}
                    style={{
                      display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center',
                      padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                      opacity: u.ativo === false ? 0.55 : 1
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u.nome_completo}
                        {u.eh_desenvolvedor && <span className="muted" style={{ fontSize: 10.5 }}> · desenvolvedor</span>}
                        {u.ativo === false && <span className="muted" style={{ fontSize: 10.5 }}> · inativo</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {u.unidade_nome || 'sem loja'}
                        {!u.perfil_nome && u.nivel_acesso ? ` · nível ${u.nivel_acesso}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, fontSize: 12 }}>
                      <PinOculto pin={u.pin} />
                      {podeEditar && (
                        <button className="ghost" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => { setEditando(u); setNovoAberto(false) }}>
                          editar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {aba === 'perfis' && (
        <div>
          {semMigracao ? (
            <p className="muted">Disponível depois de rodar a <code>migration_v15.sql</code>.</p>
          ) : (
            <>
              {podeEditar && (
                <button
                  onClick={() => setPerfilEditando({ novo: true, nome: '', descricao: '', permissoes: [] })}
                  style={{ marginBottom: 12 }}
                >
                  Novo perfil
                </button>
              )}

              {perfilEditando && podeEditar && (
                <PainelPerfil
                  perfil={perfilEditando}
                  onFechar={() => setPerfilEditando(null)}
                  onSalvar={async (dados) => {
                    await acao(async () => {
                      if (perfilEditando.novo) await criarPerfilAcesso(dados.nome, dados.descricao, dados.permissoes)
                      else await atualizarPerfilAcesso(perfilEditando.id, dados)
                    }, 'Perfil salvo.')
                    setPerfilEditando(null)
                  }}
                />
              )}

              {perfis.map((p) => {
                const quantos = usuarios.filter((u) => u.perfil_id === p.id).length
                return (
                  <div key={p.id} style={{ ...card, opacity: p.ativo === false ? 0.55 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                          {p.nome}
                          {p.eh_desenvolvedor && <span className="muted" style={{ fontSize: 10.5, fontWeight: 400 }}> · pode tudo</span>}
                          {p.ativo === false && <span className="muted" style={{ fontSize: 10.5, fontWeight: 400 }}> · inativo</span>}
                        </div>
                        {p.descricao && <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{p.descricao}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                        <span className="muted" style={{ fontSize: 11 }}>{quantos} pessoa(s)</span>
                        {podeEditar && !p.eh_desenvolvedor && (
                          <button
                            className="ghost"
                            style={{ fontSize: 11.5, padding: '4px 8px' }}
                            onClick={() => setPerfilEditando({ ...p })}
                          >
                            editar
                          </button>
                        )}
                      </div>
                    </div>
                    {!p.eh_desenvolvedor && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
                        {p.permissoes.length
                          ? p.permissoes.map((id) => {
                              const encontrada = AREAS.flatMap((g) => g.acoes).find((x) => x.id === id)
                              return encontrada ? encontrada.label : id
                            }).join(' · ')
                          : 'Nenhuma permissão marcada — quem tiver esse perfil não vê nada além do aviso de acesso.'}
                      </div>
                    )}
                  </div>
                )
              })}

              <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
                Apagar base e restaurar backup são as únicas operações fixas do desenvolvedor — não
                aparecem como permissão marcável de propósito. Virar desenvolvedor exige SQL.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function NovaPessoa({ perfis, unidades, onSalvar }) {
  const [nome, setNome] = useState('')
  const [pin, setPin] = useState('')
  const [perfilId, setPerfilId] = useState('')
  const [unidadeId, setUnidadeId] = useState('')
  const pinValido = /^[0-9]{4}$/.test(pin)
  return (
    <div style={card}>
      <p style={{ ...rotulo, margin: '0 0 10px' }} className="muted">Nova pessoa</p>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <input placeholder="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} />
        <input
          placeholder="PIN (4 dígitos)"
          value={pin}
          inputMode="numeric"
          maxLength={4}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        <select value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
          <option value="">Sem perfil (nível antigo)</option>
          {perfis.filter((p) => p.ativo !== false && !p.eh_desenvolvedor).map((p) => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
        </select>
        <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
          <option value="">Sem loja</option>
          {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          disabled={!nome.trim() || !pinValido}
          onClick={() => onSalvar({
            nomeCompleto: nome, pin, perfilId: perfilId || null, unidadeId: unidadeId || null
          })}
        >
          Cadastrar
        </button>
        {!pinValido && pin.length > 0 && <span className="muted" style={{ fontSize: 11 }}>o PIN tem 4 dígitos</span>}
      </div>
    </div>
  )
}

function PainelPessoa({ usuario, perfis, unidades, semMigracao, onFechar, onSalvar }) {
  const [nome, setNome] = useState(usuario.nome_completo || '')
  const [perfilId, setPerfilId] = useState(usuario.perfil_id || '')
  const [unidadeId, setUnidadeId] = useState(usuario.unidade_id || '')
  const [pin, setPin] = useState('')
  const [ativo, setAtivo] = useState(usuario.ativo !== false)
  const pinOk = pin === '' || /^[0-9]{4}$/.test(pin)

  return (
    <div style={{ ...card, borderColor: 'var(--text)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <p className="muted" style={{ ...rotulo, margin: 0 }}>Editando · {usuario.nome_completo}</p>
        <button className="ghost" style={{ fontSize: 11.5, padding: '2px 8px' }} onClick={onFechar}>fechar</button>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <label style={{ fontSize: 11.5 }}>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} style={{ width: '100%' }} />
        </label>
        <label style={{ fontSize: 11.5 }}>
          Perfil
          <select value={perfilId} onChange={(e) => setPerfilId(e.target.value)} disabled={semMigracao} style={{ width: '100%' }}>
            <option value="">Sem perfil (nível antigo)</option>
            {perfis.filter((p) => p.ativo !== false && !p.eh_desenvolvedor).map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
            {usuario.eh_desenvolvedor && <option value={usuario.perfil_id}>Desenvolvedor</option>}
          </select>
        </label>
        <label style={{ fontSize: 11.5 }}>
          Loja (opcional)
          <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} disabled={semMigracao} style={{ width: '100%' }}>
            <option value="">Sem loja</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11.5 }}>
          Novo PIN (deixe vazio pra manter)
          <input
            value={pin}
            inputMode="numeric"
            maxLength={4}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            style={{ width: '100%' }}
          />
        </label>
      </div>

      <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        ativo (desmarcar impede o login, sem apagar histórico)
      </label>

      {usuario.eh_desenvolvedor && (
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          Essa pessoa é desenvolvedor. Se for o único ativo, o banco recusa desativar ou trocar o
          perfil dela — a saída seria SQL, e é de propósito.
        </p>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          disabled={!nome.trim() || !pinOk}
          onClick={() => onSalvar({
            nome: nome.trim(),
            // "" no select significa "sem perfil/loja". `undefined` no RPC quer dizer "não mexer",
            // então limpar a loja precisa do flag próprio — sem ele não haveria como distinguir.
            perfilId: semMigracao ? undefined : (perfilId || null),
            unidadeId: semMigracao ? undefined : (unidadeId || null),
            limparUnidade: !semMigracao && !unidadeId && !!usuario.unidade_id,
            pin: pin || null,
            ativo
          })}
        >
          Salvar
        </button>
        {!pinOk && <span className="muted" style={{ fontSize: 11 }}>o PIN tem 4 dígitos</span>}
      </div>
    </div>
  )
}

function PainelPerfil({ perfil, onFechar, onSalvar }) {
  const [nome, setNome] = useState(perfil.nome || '')
  const [descricao, setDescricao] = useState(perfil.descricao || '')
  const [permissoes, setPermissoes] = useState(perfil.permissoes || [])
  const [ativo, setAtivo] = useState(perfil.ativo !== false)

  const alternar = (id) =>
    setPermissoes((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]))

  return (
    <div style={{ ...card, borderColor: 'var(--text)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <p className="muted" style={{ ...rotulo, margin: 0 }}>
          {perfil.novo ? 'Novo perfil' : `Editando perfil · ${perfil.nome}`}
        </p>
        <button className="ghost" style={{ fontSize: 11.5, padding: '2px 8px' }} onClick={onFechar}>fechar</button>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <label style={{ fontSize: 11.5 }}>
          Nome do perfil
          <input value={nome} onChange={(e) => setNome(e.target.value)} disabled={perfil.protegido} style={{ width: '100%' }} />
        </label>
        <label style={{ fontSize: 11.5 }}>
          Descrição
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} style={{ width: '100%' }} />
        </label>
      </div>
      {perfil.protegido && (
        <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          Perfil que o app assume existir — o nome não é editável, as permissões sim.
        </p>
      )}

      {AREAS.map((a) => (
        <div key={a.area} style={{ marginTop: 12 }}>
          <p className="muted" style={{ ...rotulo, margin: '0 0 6px' }}>{a.area}</p>
          <div style={{ display: 'grid', gap: 4, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
            {a.acoes.map((x) => (
              <label key={x.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={permissoes.includes(x.id)} onChange={() => alternar(x.id)} />
                {x.label}
              </label>
            ))}
          </div>
        </div>
      ))}

      <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        ativo
      </label>

      <div style={{ marginTop: 12 }}>
        <button
          disabled={!nome.trim()}
          onClick={() => onSalvar({ nome: nome.trim(), descricao, permissoes, ativo })}
        >
          Salvar perfil
        </button>
      </div>
    </div>
  )
}
