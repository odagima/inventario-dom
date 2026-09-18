import { useState } from 'react'
import VincularPorCamera from './pages/VincularPorCamera'
import ItensSemCodigo from './pages/ItensSemCodigo'
import ListaEtiquetasGeradas from './pages/ListaEtiquetasGeradas'
import GeradorEtiquetas from './components/GeradorEtiquetas'
import ConsultaProdutos from './pages/ConsultaProdutos'
import Grupos from './pages/Grupos'
import ImportarEverest from './pages/ImportarEverest'
import ImportarCompras from './pages/ImportarCompras'
import ImportarVendas from './pages/ImportarVendas'
import ImportarFichasTecnicas from './pages/ImportarFichasTecnicas'

const GRUPOS_ABAS = [
  {
    titulo: 'Principal',
    abas: [
      { id: 'vincular', label: 'Vincular por câmera' },
      { id: 'semCodigo', label: 'Itens sem código' },
      { id: 'etiquetas', label: 'Etiquetas impressas' }
    ]
  },
  {
    titulo: 'Cadastro avançado',
    abas: [
      { id: 'consulta', label: 'Consultar tudo' },
      { id: 'grupos', label: 'Grupos de contagem' }
    ]
  },
  {
    titulo: 'Importações em lote',
    abas: [
      { id: 'everest', label: 'Everest' },
      { id: 'compras', label: 'Compras' },
      { id: 'vendas', label: 'Vendas' },
      { id: 'fichas', label: 'Fichas técnicas' }
    ]
  }
]

export default function CadastroShell({ onSair }) {
  const [aba, setAba] = useState('consulta')
  const [produtoParaEtiqueta, setProdutoParaEtiqueta] = useState(null)

  function handleGerarEtiqueta(produto) {
    setProdutoParaEtiqueta(produto)
    setAba('etiquetas')
  }

  return (
    <div className="shell">
      <div className="app-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p className="brand">Grupo DOM</p>
          <p className="subtitle">Cadastros</p>
        </div>
        <button className="ghost" onClick={onSair}>sair</button>
      </div>

      {GRUPOS_ABAS.map((grupo) => (
        <div key={grupo.titulo} style={{ marginBottom: 4 }}>
          <p className="muted" style={{ margin: '14px 0 6px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{grupo.titulo}</p>
          <div className="tabs" style={{ flexWrap: 'wrap', margin: '0 0 4px' }}>
            {grupo.abas.map((a) => (
              <button
                key={a.id}
                className={aba === a.id ? 'active' : ''}
                onClick={() => { setAba(a.id); if (a.id === 'etiquetas' || a.id === 'semCodigo') setProdutoParaEtiqueta(null) }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 16 }}>
        {aba === 'vincular' && <VincularPorCamera />}
        {aba === 'semCodigo' && (
          produtoParaEtiqueta
            ? <GeradorEtiquetas produto={produtoParaEtiqueta} onVoltar={() => setProdutoParaEtiqueta(null)} />
            : <ItensSemCodigo onSelecionar={setProdutoParaEtiqueta} />
        )}
        {aba === 'etiquetas' && (
          produtoParaEtiqueta
            ? <GeradorEtiquetas produto={produtoParaEtiqueta} onVoltar={() => setProdutoParaEtiqueta(null)} />
            : <ListaEtiquetasGeradas onSelecionar={setProdutoParaEtiqueta} />
        )}
        {aba === 'consulta' && <ConsultaProdutos onGerarEtiqueta={handleGerarEtiqueta} />}
        {aba === 'grupos' && <Grupos />}
        {aba === 'everest' && <ImportarEverest />}
        {aba === 'compras' && <ImportarCompras />}
        {aba === 'vendas' && <ImportarVendas />}
        {aba === 'fichas' && <ImportarFichasTecnicas />}
      </div>
    </div>
  )
}
