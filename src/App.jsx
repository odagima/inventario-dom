import { useEffect, useState } from 'react'
import LoginScreen from './pages/LoginScreen'
import HomeScreen from './pages/HomeScreen'
import SelecaoUnidade from './pages/SelecaoUnidade'
import TelaContagem from './pages/TelaContagem'
import TelaPerdas from './pages/TelaPerdas'
import TelaProducao from './pages/TelaProducao'
import CadastroShell from './admin/CadastroShell'
import AdminShell from './admin/AdminShell'
import ProdutividadeShell from './produtividade/ProdutividadeShell'

// 25/08/2026, pedido do Felipe ("toda vez que vou atualizar a página, sai"): o login vivia só em
// `useState`, então qualquer F5 / troca de aba / retomada do PWA no celular jogava de volta pra tela
// de login. Agora quem está logado fica guardado no navegador.
//
// O que é guardado: SÓ o usuário (nome/nível). A contagem em andamento (`contexto`) NÃO é
// restaurada de propósito — voltar direto pra uma tela de contagem com uma sessão que pode ter sido
// finalizada/alterada por outra pessoa nesse meio-tempo é pior do que passar pela Home e reabrir a
// contagem, que é rápido e mostra o estado real. Depois do F5 o usuário cai na Home, logado.
//
// Validade: 12 horas. É um app usado em tablet/celular compartilhado no salão e na cozinha — deixar
// login eterno num aparelho de uso comum não é seguro. 12h cobre um turno inteiro com folga.
const CHAVE_SESSAO = 'inventario-dom:usuario'
const VALIDADE_MS = 12 * 60 * 60 * 1000

function lerUsuarioSalvo() {
  try {
    const bruto = localStorage.getItem(CHAVE_SESSAO)
    if (!bruto) return null
    const { usuario, expiraEm } = JSON.parse(bruto)
    if (!usuario || !expiraEm || Date.now() > expiraEm) {
      localStorage.removeItem(CHAVE_SESSAO)
      return null
    }
    return usuario
  } catch {
    // Navegador com storage bloqueado (aba anônima, política do dispositivo) — o app continua
    // funcionando normalmente, só sem lembrar o login.
    return null
  }
}

function salvarUsuario(usuario) {
  try {
    if (!usuario) localStorage.removeItem(CHAVE_SESSAO)
    else localStorage.setItem(CHAVE_SESSAO, JSON.stringify({ usuario, expiraEm: Date.now() + VALIDADE_MS }))
  } catch { /* storage indisponível — segue sem persistir */ }
}

export default function App() {
  const usuarioSalvo = lerUsuarioSalvo()
  const [modo, setModo] = useState(usuarioSalvo ? 'home' : 'login') // 'login' | 'home' | 'contagem' | 'produtividade' | 'cadastro' | 'admin'
  const [contexto, setContexto] = useState(null) // { sessao, unidade, grupo } — unidade fica null na contagem semanal (sem loja)
  const [usuarioAtual, setUsuarioAtual] = useState(usuarioSalvo)

  // Renova a validade enquanto a pessoa está usando: quem passou o turno inteiro no app não é
  // deslogado no meio só porque entrou há 12h.
  useEffect(() => {
    if (usuarioAtual) salvarUsuario(usuarioAtual)
  }, [usuarioAtual, modo])

  function handleLogin(resultado) {
    salvarUsuario(resultado)
    setUsuarioAtual(resultado)
    setModo('home')
  }

  function sair() {
    salvarUsuario(null)
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
  // 02/09/2026 (§67): o AdminShell passa a receber o usuário INTEIRO, não só o nível — é dele que
  // saem as permissões que montam o menu. `nivelAcesso` continua sendo passado porque o gating cai
  // de volta nele quando a pessoa não tem perfil vinculado (ninguém perde acesso na transição).
  if (modo === 'admin') return <AdminShell nivelAcesso={usuarioAtual?.nivelAcesso} usuario={usuarioAtual} onSair={voltarPraHome} />
  if (modo === 'produtividade') return <ProdutividadeShell usuarioLogado={usuarioAtual} onVoltar={voltarPraHome} />
  // Produção não passa por SelecaoUnidade: não tem loja (cozinha única) nem sessão por usuário —
  // a lista de "em produção" é compartilhada por toda a cozinha.
  if (modo === 'producao') return <TelaProducao usuarioLogado={usuarioAtual} onSair={voltarPraHome} />

  if (modo === 'contagem') {
    if (!contexto) {
      return <SelecaoUnidade usuarioLogado={usuarioAtual} onSessaoPronta={setContexto} onVoltar={voltarPraHome} />
    }
    // Perdas tem tela própria (loop item → motivo → quantidade); ver src/pages/TelaPerdas.jsx.
    if (contexto.sessao?.tipo === 'perdas') {
      return (
        <TelaPerdas
          sessao={contexto.sessao}
          unidade={contexto.unidade}
          usuarioLogado={usuarioAtual}
          onFinalizar={() => { setContexto(null); setModo('home') }}
          onSair={() => { setContexto(null); setModo('home') }}
        />
      )
    }
    return (
      <TelaContagem
        sessao={contexto.sessao}
        unidade={contexto.unidade}
        grupo={contexto.grupo}
        usuarioLogado={usuarioAtual}
        onFinalizar={() => { setContexto(null); setModo('home') }}
        onSair={() => { setContexto(null); setModo('home') }}
      />
    )
  }

  return (
    <HomeScreen
      usuarioLogado={usuarioAtual}
      onEntrarContagem={() => setModo('contagem')}
      onEntrarProducao={() => setModo('producao')}
      onEntrarProdutividade={() => setModo('produtividade')}
      onAbrirCadastro={() => setModo('cadastro')}
      onAbrirAdmin={() => setModo('admin')}
      onSair={sair}
    />
  )
}
