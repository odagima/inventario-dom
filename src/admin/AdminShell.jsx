import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import Relatorio from './pages/Relatorio'
import ImportarHistorico from './pages/ImportarHistorico'
import Unidades from './pages/Unidades'
import Reset from './pages/Reset'
import ConfiguracaoMensal from './pages/ConfiguracaoMensal'
import Siglas from './pages/Siglas'
import Saldo from './pages/Saldo'
import BaseProdutos from './pages/BaseProdutos'
import BaseHistorico from './pages/BaseHistorico'
import Usuarios from './pages/Usuarios'
import ImportarDados from './pages/ImportarDados'
import HistoricoFichasTecnicas from './pages/HistoricoFichasTecnicas'
import AnaliseProducao from './pages/AnaliseProducao'
import AnaliseCusto from './pages/AnaliseCusto'
import Grupos from './pages/Grupos'
import CMVSemanal from './pages/CMVSemanal'
import Cardapio from './pages/Cardapio'
import ConsolidadoSemanal from './pages/ConsolidadoSemanal'
import Cobertura from './pages/Cobertura'
import Backup from './pages/Backup'
import Painel from './pages/Painel'
import Standby from './components/Standby'
import ResumoMesVigente from './components/ResumoMesVigente'
import AlertaFimDeMes from './components/AlertaFimDeMes'
import Icon from './components/Icon'

// Estrutura por MÓDULO. Cada módulo tem suas sub-abas.
const MODULOS = [
  {
    titulo: 'Painel',
    abas: [
      { id: 'painel_resumo', label: 'Resumo' },
      { id: 'painel_analiseCusto', label: 'Análise de custo' }
    ]
  },
  {
    titulo: 'Inventário',
    abas: [
      { id: 'inv_analise', label: 'Análise / Dashboard' },
      { id: 'inv_saldo', label: 'Saldo por item' },
      { id: 'inv_historico', label: 'Histórico / Exportar' }
    ]
  },
  {
    titulo: 'Contagem semanal',
    abas: [
      { id: 'sem_analise', label: 'Análise / Dashboard' },
      { id: 'sem_consolidado', label: 'Consolidado da semana' },
      { id: 'sem_grupos', label: 'Grupos de contagem' },
      { id: 'sem_cmv', label: 'CMV Real × Teórico' },
      { id: 'sem_historico', label: 'Histórico / Exportar' }
    ]
  },
  {
    titulo: 'Produção',
    abas: [
      { id: 'prod_analise', label: 'Análise / Dashboard' },
      { id: 'prod_historico', label: 'Histórico' },
      { id: 'prod_exportar', label: 'Exportar / Importar' }
    ]
  },
  {
    titulo: 'Cardápio',
    abas: [
      { id: 'card_margem', label: 'Margem por prato' }
    ]
  },
  {
    titulo: 'Base de dados',
    abas: [
      { id: 'base_produtos', label: 'Produtos' },
      { id: 'base_historico_ft', label: 'Histórico Ficha Técnica' },
      { id: 'base_importar', label: 'Importar dados' },
      { id: 'base_cobertura', label: 'Cobertura de dados' },
      { id: 'base_backup', label: 'Backup' }
    ]
  },
  {
    titulo: 'Configuração',
    abas: [
      { id: 'cfg_mes', label: 'Mês ativo' },
      { id: 'cfg_lojas', label: 'Lojas' },
      { id: 'cfg_siglas', label: 'Siglas' },
      { id: 'cfg_usuarios', label: 'Usuários' },
      { id: 'cfg_migrar', label: 'Importar/migrar histórico' },
      { id: 'cfg_reset', label: 'Reset', perigo: true }
    ]
  },
  {
    titulo: 'Standby (ideias)',
    abas: [
      { id: 'sb_perdas', label: 'Perdas / desperdício' }
    ]
  }
]

export default function AdminShell({ nivelAcesso, onSair }) {
  const [aba, setAba] = useState('painel_resumo')
  const [menuAberto, setMenuAberto] = useState(false)

  function selecionar(id) {
    setAba(id)
    setMenuAberto(false)
  }

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="brand" style={{ fontSize: 20, margin: 0 }}>Grupo DOM</p>
          <button className="btn-menu btn-menu-mobile" onClick={() => setMenuAberto(false)} aria-label="Fechar menu">
            <Icon nome="x" tamanho={16} />
          </button>
        </div>

        <ResumoMesVigente />

        {MODULOS.map((grupo) => (
          <div key={grupo.titulo}>
            <p className="muted" style={{ margin: '0 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{grupo.titulo}</p>
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
          </div>
        ))}

        <button className="ghost" onClick={onSair} style={{ marginTop: 'auto' }}>Sair</button>
      </div>

      <div className="admin-com-sidebar">
        <div className="admin-com-sidebar-inner">
          <AlertaFimDeMes onIrParaConfiguracao={() => setAba('cfg_mes')} />

          {/* PAINEL */}
          {aba === 'painel_resumo' && <Painel />}
          {aba === 'painel_analiseCusto' && <AnaliseCusto />}

          {aba === 'inv_analise' && <Dashboard tipoFiltro="mensal" />}
          {aba === 'inv_saldo' && <Saldo />}
          {aba === 'inv_historico' && <Relatorio tipoFiltro="mensal" mostrarExportEverest={true} />}

          {/* CONTAGEM SEMANAL — base separada do inventário */}
          {aba === 'sem_analise' && <Dashboard tipoFiltro="semanal" />}
          {aba === 'sem_consolidado' && <ConsolidadoSemanal />}
          {aba === 'sem_grupos' && <Grupos />}
          {aba === 'sem_cmv' && <CMVSemanal />}
          {aba === 'sem_historico' && <Relatorio tipoFiltro="semanal" mostrarExportEverest={true} />}

          {/* PRODUÇÃO */}
          {aba === 'prod_analise' && <AnaliseProducao />}
          {aba === 'prod_historico' && <Relatorio tipoFiltro="producao" mostrarExportEverest={false} />}
          {aba === 'prod_exportar' && <Relatorio tipoFiltro="producao" mostrarExportEverest={true} />}

          {/* CARDÁPIO */}
          {aba === 'card_margem' && <Cardapio />}

          {/* BASE DE DADOS */}
          {aba === 'base_produtos' && <BaseProdutos />}
          {aba === 'base_historico_ft' && <HistoricoFichasTecnicas />}
          {aba === 'base_importar' && <ImportarDados />}
          {aba === 'base_cobertura' && <Cobertura />}
          {aba === 'base_backup' && <Backup />}

          {/* CONFIGURAÇÃO */}
          {aba === 'cfg_mes' && <ConfiguracaoMensal />}
          {aba === 'cfg_lojas' && <Unidades />}
          {aba === 'cfg_siglas' && <Siglas />}
          {aba === 'cfg_usuarios' && <Usuarios />}
          {aba === 'cfg_migrar' && <ImportarHistorico />}
          {aba === 'cfg_reset' && <Reset />}

          {/* STANDBY — ideias registradas, sem execução (ou funcionalidades reais que caíram em
              desuso e ficam guardadas aqui em vez de apagadas — ver DECISOES-TRAVADAS.md) */}
          {aba === 'sb_perdas' && (
            <Standby
              titulo="Registro de perdas / desperdício"
              descricao="Registrar o que foi jogado fora ou perdido (por quebra, validade, erro de produção), pra descontar do estoque e entender o tamanho real da perda por grupo. Usaria a mesma mecânica da contagem."
            />
          )}
        </div>
      </div>
    </div>
  )
}
