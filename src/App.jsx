import { useState } from 'react'
import LoginScreen from './pages/LoginScreen'
import HomeScreen from './pages/HomeScreen'
import SelecaoUnidade from './pages/SelecaoUnidade'
import TelaContagem from './pages/TelaContagem'
import CadastroShell from './admin/CadastroShell'
import AdminShell from './admin/AdminShell'
import ProdutividadeShell from './produtividade/ProdutividadeShell'

export default function App() {
  const [modo, setModo] = useState('login') // 'login' | 'home' | 'contagem' | 'produtividade' | 'cadastro' | 'admin'
  const [contexto, setContexto] = useState(null) // { sessao, unidade, grupo } — unidade fica null na contagem semanal (sem loja)
  const [usuarioAtual, setUsuarioAtual] = useState(null)

  function handleLogin(resultado) {
    setUsuarioAtual(resultado)
    setModo('home')
  }

  function sair() {
    setUsuarioAtual(null)
    setContexto(null)
    setModo('login')
  }

  function voltarPraHome() {
    setContexto(null)
    setModo('home')
  }

  if (modo === 'login') return <LoginScreen onEntrar={handleLogin} />

  if (modo === 'cadastro') return <CadastroShell onSair={voltarPraHome} />
  if (modo === 'admin') return <AdminShell nivelAcesso={usuarioAtual?.nivelAcesso} onSair={voltarPraHome} />
  if (modo === 'produtividade') return <ProdutividadeShell usuarioLogado={usuarioAtual} onVoltar={voltarPraHome} />

  if (modo === 'contagem') {
    if (!contexto) {
      return <SelecaoUnidade usuarioLogado={usuarioAtual} onSessaoPronta={setContexto} onVoltar={voltarPraHome} />
    }
    return (
      <TelaContagem
        sessao={contexto.sessao}
        unidade={contexto.unidade}
        grupo={contexto.grupo}
        onFinalizar={() => { setContexto(null); setModo('home') }}
        onSair={() => { setContexto(null); setModo('home') }}
      />
    )
  }

  return (
    <HomeScreen
      usuarioLogado={usuarioAtual}
      onEntrarContagem={() => setModo('contagem')}
      onEntrarProdutividade={() => setModo('produtividade')}
      onAbrirCadastro={() => setModo('cadastro')}
      onAbrirAdmin={() => setModo('admin')}
      onSair={sair}
    />
  )
}
