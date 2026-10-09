import { useEffect, useState } from 'react'
import { buscarConfiguracoes, definirConfiguracao } from '../../lib/configuracoesApi'

// Painel de interruptores do sistema (migration_v18.sql) — pedido do Felipe (06/10/2026): um
// lugar pra ligar/desligar parâmetros sem precisar mexer em código. Hoje só tem um (requisição
// exigir aprovação), semeado desligado e ainda sem nenhuma tela consultando o valor — é só a
// prateleira pronta pro próximo que precisar disso.
export default function ConfiguracoesSistema({ usuario }) {
  const [configuracoes, setConfiguracoes] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [salvandoChave, setSalvandoChave] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    buscarConfiguracoes()
      // Essa tela só sabe lidar com interruptor liga/desliga (booleano) — uma config que guarda
      // outra coisa (ex.: rotulos_sistema, que guarda um objeto) tem tela própria e não pode
      // aparecer aqui, porque "alternar" reescreveria ela com true/false e apagaria o valor real.
      .then((lista) => setConfiguracoes(lista.filter((c) => typeof c.valor === 'boolean')))
      .catch((e) => setErro('Não consegui carregar — ' + e.message))
      .finally(() => setCarregando(false))
  }, [])

  async function alternar(config) {
    const ligado = config.valor === true
    setSalvandoChave(config.chave)
    setErro('')
    try {
      await definirConfiguracao(config.chave, !ligado, usuario)
      setConfiguracoes((lista) => lista.map((c) => (c.chave === config.chave ? { ...c, valor: !ligado } : c)))
    } catch (e) {
      setErro('Não consegui salvar — ' + e.message)
    } finally {
      setSalvandoChave(null)
    }
  }

  if (carregando) return <div className="card"><p className="muted">Carregando…</p></div>

  return (
    <div className="card">
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Configurações do sistema</p>
      <p className="muted" style={{ margin: '0 0 14px', fontSize: 12 }}>Liga e desliga comportamentos do app — sem precisar mexer em código.</p>
      {erro && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{erro}</p>}
      {configuracoes.length === 0 ? (
        <p className="muted">Nenhuma configuração cadastrada.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {configuracoes.map((c) => {
            const ligado = c.valor === true
            return (
              <div key={c.chave} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{c.chave}</p>
                  {c.descricao && <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>{c.descricao}</p>}
                </div>
                <button
                  onClick={() => alternar(c)}
                  disabled={salvandoChave === c.chave}
                  style={{
                    flexShrink: 0, padding: '8px 16px', borderRadius: 20,
                    background: ligado ? 'var(--success)' : 'var(--surface-3)',
                    color: ligado ? '#fff' : 'var(--text-secondary)'
                  }}
                >
                  {salvandoChave === c.chave ? '…' : ligado ? 'Ligado' : 'Desligado'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
