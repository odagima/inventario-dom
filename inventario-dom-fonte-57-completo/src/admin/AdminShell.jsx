import { useState } from 'react'
import VersaoBuild from './components/VersaoBuild'
import Lancamentos from './pages/Lancamentos'
import Dashboard from './pages/Dashboard'
import Relatorio from './pages/Relatorio'
import ImportarHistorico from './pages/ImportarHistorico'
import Unidades from './pages/Unidades'
import Reset from './pages/Reset'
import ConfiguracaoMensal from './pages/ConfiguracaoMensal'
import Siglas from './pages/Siglas'
import Saldo from './pages/Saldo'
import BaseProdutos from './pages/BaseProdutos'
import UsuariosPerfis from './pages/UsuariosPerfis'
import ImportarDados from './pages/ImportarDados'
import HistoricoFichasTecnicas from './pages/HistoricoFichasTecnicas'
import AnaliseProducao from './pages/AnaliseProducao'
import AnaliseCusto from './pages/AnaliseCusto'
import Grupos from './pages/Grupos'
import CMVSemanal from './pages/CMVSemanal'
import ExportacaoContabil from './pages/ExportacaoContabil'
import ArvoreTransformacao from './pages/ArvoreTransformacao'
import HistoricoProduto from './pages/HistoricoProduto'
import DiagnosticoPrato from './pages/DiagnosticoPrato'
import Cardapio from './pages/Cardapio'
import ConsolidadoSemanal from './pages/ConsolidadoSemanal'
import FatoresCorrecao from './pages/FatoresCorrecao'
import Cobertura from './pages/Cobertura'
import Backup from './pages/Backup'
import Painel from './pages/Painel'
import ResumoDiario from './components/ResumoDiario'
import AlertaFimDeMes from './components/AlertaFimDeMes'
import Icon from './components/Icon'

// ═══════════════════════════════════════════════════════════════════════════════
// 09/09/2026 — MENU REVERTIDO PRO FORMATO DO BUILD 54.
//
// O Felipe não gostou do reagrupamento do §71 ("layout por pergunta", 6 grupos, 25 abas) e pediu
// pra voltar. Este arquivo restaura os grupos/abas/rótulos EXATOS do menu original — extraídos
// diretamente do bundle publicado (build 54), não recriados de memória, pra não reintroduzir uma
// divergência sutil de nome ou ordem.
//
// O que NÃO voltou: o trabalho por baixo do menu continua.
//   - Tela de Usuários e Perfis (§67, `UsuariosPerfis.jsx`) — ocupa a aba "Configuração → Usuários",
//     no lugar da antiga `Usuarios.jsx` (que só listava nome/nível, sem perfil nem permissão).
//   - Gating por permissão (§67/§72) — cada aba abaixo tem `perm`, e `podeVer` decide quem vê o quê.
//     Quem não tem perfil vinculado continua vendo tudo (regra de compatibilidade já travada).
//   - O aviso do §65 (100% de aproveitamento que na verdade é lacuna de cadastro) já está dentro do
//     `CMVSemanal.jsx` — não depende de menu, então nada aqui precisa mudar por causa dele.
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// PERMISSÕES (§67) — mesmas regras de antes, só reaplicadas aos ids originais do menu.
//
// `perm: 'dev'` = só desenvolvedor — Backup e Reset, as duas operações irreversíveis, fora das
// marcáveis de propósito (já houve import apagando ficha em silêncio).
//
// Quem NÃO tem perfil vinculado continua vendo tudo, exatamente como sempre — o gating só passa a
// valer pra quem já tem perfil com permissões marcadas. Ninguém perde acesso na transição.
// ═══════════════════════════════════════════════════════════════════════════════
function podeVer(usuario, perm) {
  if (!perm) return true
  if (!usuario) return true // chamada antiga (só `nivelAcesso`) — não restringe
  if (usuario.ehDesenvolvedor) return true
  const lista = Array.isArray(usuario.permissoes) ? usuario.permissoes : []
  if (!lista.length) return true // sem perfil vinculado: segue pelo `nivel_acesso` antigo
  if (perm === 'dev') return false
  return lista.includes(perm)
}

// Estrutura idêntica à extraída do build 54 (grupos, ids, rótulos, ordem). Só o campo `perm` foi
// adicionado — não existia no menu antigo, ninguém era restringido.
const MODULOS = [
  {
    titulo: 'Painel',
    abas: [
      { id: 'painel_resumo', label: 'Resumo' },
      { id: 'painel_analiseCusto', label: 'Análise de custo', perm: 'custos.ver' }
    ]
  },
  {
    titulo: 'Inventário',
    abas: [
      { id: 'inv_analise', label: 'Análise / Dashboard', perm: 'contagens.ver' },
      { id: 'inv_saldo', label: 'Saldo por item', perm: 'contagens.ver' },
      { id: 'inv_historico', label: 'Histórico / Exportar', perm: 'contagens.ver' }
    ]
  },
  {
    titulo: 'Contagem semanal',
    abas: [
      { id: 'sem_analise', label: 'Análise / Dashboard', perm: 'contagens.ver' },
      { id: 'sem_grupos', label: 'Grupos de contagem', perm: 'cadastros.editar' },
      { id: 'sem_cmv', label: 'CMV Real × Teórico', perm: 'custos.ver' },
      { id: 'sem_historico', label: 'Histórico / Exportar', perm: 'contagens.ver' }
    ]
  },
  {
    titulo: 'Produção',
    abas: [
      { id: 'prod_analise', label: 'Análise / Dashboard', perm: 'custos.ver' },
      { id: 'prod_historico', label: 'Histórico', perm: 'contagens.ver' },
      { id: 'prod_exportar', label: 'Exportar / Importar', perm: 'contagens.ver' }
    ]
  },
  {
    titulo: 'Perdas',
    abas: [{ id: 'perdas_historico', label: 'Histórico / Exportar', perm: 'contagens.ver' }]
  },
  {
    titulo: 'Contabilidade',
    abas: [{ id: 'cont_exportacao', label: 'Exportação mensal (CMV)', perm: 'custos.ver' }]
  },
  {
    titulo: 'Cardápio',
    abas: [{ id: 'card_margem', label: 'Margem por prato', perm: 'custos.ver' }]
  },
  {
    titulo: 'Base de dados',
    abas: [
      { id: 'base_produtos', label: 'Produtos', perm: 'cadastros.ver' },
      { id: 'base_lancamentos', label: 'Lançamentos', perm: 'contagens.ver' },
      { id: 'base_arvore', label: 'Árvore de transformação', perm: 'cadastros.ver' },
      { id: 'base_hist_produto', label: 'Histórico do produto', perm: 'cadastros.ver' },
      { id: 'base_diagnostico', label: 'Diagnóstico de prato', perm: 'cadastros.ver' },
      { id: 'base_historico_ft', label: 'Histórico Ficha Técnica', perm: 'cadastros.ver' },
      { id: 'base_importar', label: 'Importar dados', perm: 'importar.executar' },
      { id: 'base_cobertura', label: 'Cobertura de dados', perm: 'cadastros.ver' },
      { id: 'base_backup', label: 'Backup', perm: 'dev' }
    ]
  },
  {
    titulo: 'Configuração',
    abas: [
      { id: 'cfg_mes', label: 'Mês ativo', perm: 'cadastros.editar' },
      { id: 'cfg_lojas', label: 'Lojas', perm: 'cadastros.editar' },
      { id: 'cfg_siglas', label: 'Siglas', perm: 'cadastros.editar' },
      // Rótulo igual ao original ("Usuários"); aponta pra `UsuariosPerfis` (§67), não mais pra
      // `Usuarios.jsx` antiga.
      { id: 'cfg_usuarios', label: 'Usuários', perm: 'usuarios.ver' },
      { id: 'cfg_migrar', label: 'Importar/migrar histórico', perm: 'importar.executar' },
      { id: 'cfg_reset', label: 'Reset', perm: 'dev', perigo: true }
    ]
  },
  {
    titulo: 'Standby',
    recolhivel: true,
    abas: [
      { id: 'sb_consolidado', label: 'Consolidado da contagem (antigo)' },
      { id: 'sb_fatores', label: 'Fatores de correção (antigo)' }
    ]
  }
]

// Aba inicial por perfil: quem não pode ver o Painel (ex.: um perfil bem restrito) não deve cair
// numa tela vazia ao entrar. Pega a primeira aba visível, na ordem do menu.
function primeiraAbaVisivel(usuario) {
  for (const grupo of MODULOS) {
    if (grupo.recolhivel) continue
    for (const a of grupo.abas) if (podeVer(usuario, a.perm)) return a.id
  }
  return 'painel_resumo'
}

export default function AdminShell({ nivelAcesso, usuario = null, onSair }) {
  const [aba, setAba] = useState(() => primeiraAbaVisivel(usuario))
  const [menuAberto, setMenuAberto] = useState(false)
  const [gruposAbertos, setGruposAbertos] = useState({})

  function selecionar(id) {
    setAba(id)
    setMenuAberto(false)
  }

  // Grupo sem nenhuma aba visível não aparece (evita título de seção órfão).
  const gruposVisiveis = MODULOS
    .map((g) => ({ ...g, abas: g.abas.filter((a) => podeVer(usuario, a.perm)) }))
    .filter((g) => g.abas.length > 0)

  const abaLiberada = gruposVisiveis.some((g) => g.abas.some((a) => a.id === aba))

  return (
    <div className="admin-shell-wrapper">
      <div className="admin-topbar">
        <button className="btn-menu" onClick={() => setMenuAberto(true)} aria-label="Abrir menu">
          <Icon nome="menu" tamanho={18} />
        </button>
        <div>
          <p className="brand" style={{ fontSize: 20 }}>Grupo DOM</p>
          <p className="subtitle" style={{ margin: 0 }}>Administrativo</p>
        </div>
      </div>

      {menuAberto && <div className="sidebar-overlay" onClick={() => setMenuAberto(false)} />}

      <div className={`sidebar ${menuAberto ? 'aberta' : ''}`}>
        <p className="brand" style={{ fontSize: 15, margin: '0 0 2px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text)' }}>Grupo DOM</p>

        {usuario?.nome && (
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 11 }}>
            {usuario.nome}
            {usuario.perfilNome ? ` · ${usuario.perfilNome}` : (nivelAcesso ? ` · ${nivelAcesso}` : '')}
          </p>
        )}

        <ResumoDiario />

        {gruposVisiveis.map((grupo) => {
          const aberto = grupo.recolhivel ? !!gruposAbertos[grupo.titulo] : true
          const estiloTitulo = { margin: '0 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }
          return (
            <div key={grupo.titulo}>
              {grupo.recolhivel ? (
                <button
                  className="muted"
                  onClick={() => setGruposAbertos((s) => ({ ...s, [grupo.titulo]: !s[grupo.titulo] }))}
                  aria-expanded={aberto}
                  style={{
                    ...estiloTitulo,
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left'
                  }}
                >
                  <span style={{ display: 'inline-block', transition: 'transform 150ms', transform: aberto ? 'rotate(90deg)' : 'none', fontSize: 9 }}>▶</span>
                  {grupo.titulo}
                </button>
              ) : (
                <p className="muted" style={estiloTitulo}>{grupo.titulo}</p>
              )}
              {aberto && (
                <div className="sidebar-nav-grupo">
                  {grupo.abas.map((a) => (
                    <button
                      key={a.id}
                      className={`sidebar-nav-item ${aba === a.id ? 'active' : ''}`}
                      onClick={() => selecionar(a.id)}
                      style={a.perigo ? { color: 'var(--danger)' } : undefined}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <button className="ghost" onClick={onSair} style={{ marginTop: 'auto' }}>Sair</button>
        <VersaoBuild />
      </div>

      <div className="admin-com-sidebar">
        <div className="admin-com-sidebar-inner">
          <AlertaFimDeMes onIrParaConfiguracao={() => setAba('cfg_mes')} />

          {!abaLiberada && (
            <div className="card">
              <p style={{ margin: 0, fontSize: 13 }}>Seu perfil não tem acesso a essa tela.</p>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 11.5 }}>
                {usuario?.perfilNome ? `Perfil: ${usuario.perfilNome}. ` : ''}
                Peça a quem cuida dos acessos pra ajustar em Configuração → Usuários.
              </p>
            </div>
          )}

          {/* ── PAINEL ── */}
          {aba === 'painel_resumo' && <Painel />}
          {aba === 'painel_analiseCusto' && <AnaliseCusto />}

          {/* ── INVENTÁRIO ── */}
          {aba === 'inv_analise' && <Dashboard tipoFiltro="mensal" />}
          {aba === 'inv_saldo' && <Saldo />}
          {aba === 'inv_historico' && <Relatorio tipoFiltro="mensal" mostrarExportEverest />}

          {/* ── CONTAGEM SEMANAL ── */}
          {aba === 'sem_analise' && <Dashboard tipoFiltro="semanal" />}
          {aba === 'sem_grupos' && <Grupos />}
          {aba === 'sem_cmv' && <CMVSemanal />}
          {aba === 'sem_historico' && <Relatorio tipoFiltro="semanal" mostrarExportEverest />}

          {/* ── PRODUÇÃO ── */}
          {aba === 'prod_analise' && <AnaliseProducao />}
          {aba === 'prod_historico' && <Relatorio tipoFiltro="producao" mostrarExportEverest={false} />}
          {aba === 'prod_exportar' && <Relatorio tipoFiltro="producao" mostrarExportEverest />}

          {/* ── PERDAS ── */}
          {aba === 'perdas_historico' && <Relatorio tipoFiltro="perdas" mostrarExportEverest={false} />}

          {/* ── CONTABILIDADE ── */}
          {aba === 'cont_exportacao' && <ExportacaoContabil />}

          {/* ── CARDÁPIO ── */}
          {aba === 'card_margem' && <Cardapio />}

          {/* ── BASE DE DADOS ── */}
          {aba === 'base_produtos' && <BaseProdutos />}
          {aba === 'base_lancamentos' && <Lancamentos />}
          {aba === 'base_arvore' && <ArvoreTransformacao />}
          {aba === 'base_hist_produto' && <HistoricoProduto />}
          {aba === 'base_diagnostico' && <DiagnosticoPrato />}
          {aba === 'base_historico_ft' && <HistoricoFichasTecnicas />}
          {aba === 'base_importar' && <ImportarDados />}
          {aba === 'base_cobertura' && <Cobertura />}
          {aba === 'base_backup' && <Backup />}

          {/* ── CONFIGURAÇÃO ── */}
          {aba === 'cfg_mes' && <ConfiguracaoMensal />}
          {aba === 'cfg_lojas' && <Unidades />}
          {aba === 'cfg_siglas' && <Siglas />}
          {aba === 'cfg_usuarios' && <UsuariosPerfis usuarioLogado={usuario} />}
          {aba === 'cfg_migrar' && <ImportarHistorico />}
          {aba === 'cfg_reset' && <Reset />}

          {/* ── STANDBY ── */}
          {aba === 'sb_consolidado' && <ConsolidadoSemanal />}
          {aba === 'sb_fatores' && <FatoresCorrecao />}
        </div>
      </div>
    </div>
  )
}
