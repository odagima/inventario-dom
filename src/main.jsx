import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErroLimite from './ErroLimite.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErroLimite>
      <App />
    </ErroLimite>
  </React.StrictMode>
)
