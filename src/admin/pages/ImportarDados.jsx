import { useState } from 'react'
import ImportarEverest from './ImportarEverest'
import ImportarVendas from './ImportarVendas'
import ImportarFichasTecnicas from './ImportarFichasTecnicas'
import ImportarCompras from './ImportarCompras'

// Unifica os 4 uploads do Everest numa página só, em abas — antes eram 4 abas separadas dentro de
// "Base de dados" (Produtos/Importar base, Vendas/Importar Everest, Ficha técnica/Importar FT,
// Entradas/Importar compras), a pedido do Felipe (10/08/2026) pra agrupar tudo que é "subir um
// arquivo do Everest" num lugar só. A listagem/navegação de produtos (BaseProdutos) continua
// separada — é "consultar o cadastro", não "importar", então ficou de fora daqui.
const ABAS = [
  { id: 'produtos', label: 'Produtos' },
  { id: 'vendas', label: 'Vendas' },
  { id: 'fichas', label: 'Ficha técnica' },
  { id: 'entradas', label: 'Entradas / Compras' }
]

export default function ImportarDados() {
  const [aba, setAba] = useState('produtos')

  return (
    <div>
      <div className="app-header" style={{ marginBottom: 10 }}>
        <p className="brand">Importar dados</p>
        <p className="subtitle">Upload dos relatórios do Everest — cada aba é um arquivo diferente.</p>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {ABAS.map((a) => (
          <button key={a.id} className={aba === a.id ? 'active' : ''} onClick={() => setAba(a.id)}>
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'produtos' && <ImportarEverest />}
      {aba === 'vendas' && <ImportarVendas />}
      {aba === 'fichas' && <ImportarFichasTecnicas />}
      {aba === 'entradas' && <ImportarCompras />}
    </div>
  )
}
