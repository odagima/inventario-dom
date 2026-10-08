import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { buscarRotulos, ROTULOS_PADRAO } from './rotulosApi'

// Deixa as palavras do app (Loja/Setor/Usuário/Item/Turno) disponíveis pra qualquer tela, sem cada
// uma ter que buscar sozinha — carrega uma vez na raiz do app (ver App.jsx) e todo componente lê
// com `useRotulos()`. Troca em Admin > Nomenclatura chama `recarregar()` e atualiza em tudo que já
// está na tela, sem precisar dar F5.
const RotulosContext = createContext({ rotulos: ROTULOS_PADRAO, recarregar: () => {} })

export function RotulosProvider({ children }) {
  const [rotulos, setRotulos] = useState(ROTULOS_PADRAO)

  const carregar = useCallback(async () => {
    try {
      setRotulos(await buscarRotulos())
    } catch {
      // Migração ainda não rodou, ou falha de rede — segue com o padrão em vez de quebrar a tela.
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  return (
    <RotulosContext.Provider value={{ rotulos, recarregar: carregar }}>
      {children}
    </RotulosContext.Provider>
  )
}

export function useRotulos() {
  return useContext(RotulosContext).rotulos
}

export function useRecarregarRotulos() {
  return useContext(RotulosContext).recarregar
}
