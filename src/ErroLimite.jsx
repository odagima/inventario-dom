import { Component } from 'react'

export default class ErroLimite extends Component {
  constructor(props) {
    super(props)
    this.state = { erro: null }
  }

  static getDerivedStateFromError(erro) {
    return { erro }
  }

  componentDidCatch(erro, info) {
    console.error('Erro capturado:', erro, info)
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="screen">
          <div className="card">
            <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Algo deu errado</p>
            <p className="muted" style={{ margin: '0 0 16px', wordBreak: 'break-word' }}>
              {String(this.state.erro?.message || this.state.erro)}
            </p>
            <button className="primary" style={{ width: '100%' }} onClick={() => this.setState({ erro: null })}>
              Tentar de novo
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
