import { useEffect, useState } from 'react'
import {
  contarParaReset,
  resetarVinculosNFe,
  resetarEtiquetasInternas,
  resetarHistoricoAntigo,
  contarBasesEverestParaReset,
  resetarFichasTecnicas,
  resetarVendasImportadas,
  resetarComprasImportadas,
  resetarProdutosOrfaos
} from '../lib/adminApi'
import { verificarPin } from '../../lib/api'
import ModalSenha from '../../components/ModalSenha'

export default function Reset() {
  const [contagem, setContagem] = useState(null)
  const [contagemEverest, setContagemEverest] = useState(null)
  const [erroCarregar, setErroCarregar] = useState('')
  const [pedindoSenhaPara, setPedindoSenhaPara] = useState(null) // ação aguardando confirmação de senha
  const [confirmando, setConfirmando] = useState(null) // 'nfe' | 'etiquetas' | 'historico' | 'fichas' | 'vendas' | 'compras' | 'orfaos' | null
  const [executando, setExecutando] = useState(false)
  const [mensagem, setMensagem] = useState('')

  async function carregar() {
    setErroCarregar('')
    // As duas contagens são independentes — se uma falhar, a outra ainda aparece (antes, um erro
    // aqui deixava a tela travada em "Carregando…" pra sempre, sem mostrar nada).
    const resultados = await Promise.allSettled([contarParaReset(), contarBasesEverestParaReset()])
    if (resultados[0].status === 'fulfilled') setContagem(resultados[0].value)
    if (resultados[1].status === 'fulfilled') setContagemEverest(resultados[1].value)
    const erros = resultados.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason))
    if (erros.length) setErroCarregar(erros.join(' · '))
  }

  useEffect(() => { carregar() }, [])

  async function handleConfirmarSenha(senha) {
    const resultado = await verificarPin(senha)
    if (!resultado || resultado.nivelAcesso !== 'administrativo') return false
    setConfirmando(pedindoSenhaPara)
    setPedindoSenhaPara(null)
    return true
  }

  async function executar(acao) {
    setExecutando(true)
    setMensagem('')
    try {
      if (acao === 'nfe') await resetarVinculosNFe()
      if (acao === 'etiquetas') await resetarEtiquetasInternas()
      if (acao === 'historico') await resetarHistoricoAntigo()
      if (acao === 'fichas') await resetarFichasTecnicas()
      if (acao === 'vendas') await resetarVendasImportadas()
      if (acao === 'compras') await resetarComprasImportadas()
      if (acao === 'orfaos') await resetarProdutosOrfaos()
      setMensagem('Feito. Os dados foram apagados.')
      setConfirmando(null)
      await carregar()
    } finally {
      setExecutando(false)
    }
  }

  if (!contagem && !contagemEverest && !erroCarregar) return <div className="card"><p className="muted">Carregando…</p></div>

  if (erroCarregar) {
    return (
      <div className="card">
        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Reset / zerar dados</p>
        <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 12px' }}>
          Não consegui carregar as contagens: {erroCarregar}
        </p>
        <button onClick={carregar}>Tentar de novo</button>
      </div>
    )
  }

  return (
    <div className="card">
      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 15 }}>Reset / zerar dados</p>
      <p className="muted" style={{ margin: '0 0 18px' }}>
        Pra recomeçar do zero com confiança quando algo parecer errado. Cada ação abaixo é isolada — zera só a parte escolhida, o resto do sistema continua intacto.
        Qualquer ação aqui pede a senha de novo, por segurança.
      </p>

      {mensagem && <p style={{ color: 'var(--success)', fontSize: 13, marginBottom: 14 }}>{mensagem}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 14 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 500 }}>Vínculos vindos de NF-e</p>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {contagem.barcodesIndustrializados} código(s) de barras vinculados via NF-e/import.
            Apaga só esses vínculos. NF-e está em standby (§1) — as compras de verdade hoje vêm do Everest
            ("Compras no Período"); pra zerar essas, use "Bases do Everest" abaixo. Etiquetas internas geradas
            manualmente não são afetadas.
          </p>
          {confirmando === 'nfe' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmando(null)} style={{ flex: 1 }}>Cancelar</button>
              <button onClick={() => executar('nfe')} disabled={executando} style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}>
                {executando ? 'Apagando…' : 'Confirmar, apagar tudo isso'}
              </button>
            </div>
          ) : (
            <button onClick={() => setPedindoSenhaPara('nfe')} disabled={contagem.barcodesIndustrializados === 0}>
              Zerar vínculos de NF-e
            </button>
          )}
        </div>

        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 14 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 500 }}>Etiquetas internas geradas</p>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {contagem.barcodesInternos} etiqueta(s) interna(s) geradas manualmente. Apagar faz esses itens voltarem a aparecer como "sem código".
          </p>
          {confirmando === 'etiquetas' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmando(null)} style={{ flex: 1 }}>Cancelar</button>
              <button onClick={() => executar('etiquetas')} disabled={executando} style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}>
                {executando ? 'Apagando…' : 'Confirmar, apagar tudo isso'}
              </button>
            </div>
          ) : (
            <button onClick={() => setPedindoSenhaPara('etiquetas')} disabled={contagem.barcodesInternos === 0}>
              Zerar etiquetas internas
            </button>
          )}
        </div>

        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 14 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 500 }}>Histórico importado</p>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {contagem.historico} linha(s) do inventário antigo (planilhas de antes do app). Não afeta nada das contagens feitas no app.
          </p>
          {confirmando === 'historico' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmando(null)} style={{ flex: 1 }}>Cancelar</button>
              <button onClick={() => executar('historico')} disabled={executando} style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}>
                {executando ? 'Apagando…' : 'Confirmar, apagar tudo isso'}
              </button>
            </div>
          ) : (
            <button onClick={() => setPedindoSenhaPara('historico')} disabled={contagem.historico === 0}>
              Zerar histórico antigo
            </button>
          )}
        </div>
      </div>

      <p className="muted" style={{ marginTop: 16, fontSize: 12 }}>
        Isso nunca apaga o cadastro de produtos do Everest, nem as contagens reais feitas pelo app de lançamento — só as três coisas listadas acima.
      </p>

      <p style={{ margin: '24px 0 4px', fontWeight: 600, fontSize: 15 }}>Bases do Everest (faxina antes de reimportar)</p>
      <p className="muted" style={{ margin: '0 0 14px' }}>
        Pra reimportar limpo com os formatos novos (§11/§13 do doc de decisões). Fichas técnicas, vendas e compras
        podem ser zeradas por completo com segurança — nada de real fica preso nelas. Produtos é diferente: contagens
        e saídas reais apontam pro cadastro e travam a exclusão de propósito, então só dá pra apagar os
        <b> órfãos</b> (sem nenhuma contagem/saída) — o resto se corrige reimportando de novo (atualiza pelo código Everest, não duplica).
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 14 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 500 }}>Fichas técnicas</p>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {contagemEverest.fichasTecnicas} ficha(s) técnica(s) (com os ingredientes). Apaga tudo — reimporte os arquivos DOM e Dalva depois.
          </p>
          {confirmando === 'fichas' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmando(null)} style={{ flex: 1 }}>Cancelar</button>
              <button onClick={() => executar('fichas')} disabled={executando} style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}>
                {executando ? 'Apagando…' : 'Confirmar, apagar tudo isso'}
              </button>
            </div>
          ) : (
            <button onClick={() => setPedindoSenhaPara('fichas')} disabled={contagemEverest.fichasTecnicas === 0}>
              Zerar fichas técnicas
            </button>
          )}
        </div>

        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 14 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 500 }}>Vendas importadas</p>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {contagemEverest.vendasImportadas} arquivo(s) de vendas importado(s) (com os itens). Apaga tudo — reimporte o relatório "Vendas Integração PDV" depois.
          </p>
          {confirmando === 'vendas' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmando(null)} style={{ flex: 1 }}>Cancelar</button>
              <button onClick={() => executar('vendas')} disabled={executando} style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}>
                {executando ? 'Apagando…' : 'Confirmar, apagar tudo isso'}
              </button>
            </div>
          ) : (
            <button onClick={() => setPedindoSenhaPara('vendas')} disabled={contagemEverest.vendasImportadas === 0}>
              Zerar vendas importadas
            </button>
          )}
        </div>

        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 14 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 500 }}>Compras importadas (Everest)</p>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {contagemEverest.notasImportadas} nota(s) de compra importada(s) (com os itens). Apaga tudo — reimporte "Compras no Período" depois.
          </p>
          {confirmando === 'compras' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmando(null)} style={{ flex: 1 }}>Cancelar</button>
              <button onClick={() => executar('compras')} disabled={executando} style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}>
                {executando ? 'Apagando…' : 'Confirmar, apagar tudo isso'}
              </button>
            </div>
          ) : (
            <button onClick={() => setPedindoSenhaPara('compras')} disabled={contagemEverest.notasImportadas === 0}>
              Zerar compras importadas
            </button>
          )}
        </div>

        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 14 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 500 }}>Produtos órfãos</p>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {contagemEverest.produtosOrfaos} de {contagemEverest.produtos} produto(s) sem nenhuma contagem/saída associada — sujeira segura de apagar
            (ex.: cadastro antigo do Colibri, item nunca contado). Os outros {contagemEverest.produtosProtegidos} têm histórico real e não são tocados.
          </p>
          {confirmando === 'orfaos' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmando(null)} style={{ flex: 1 }}>Cancelar</button>
              <button onClick={() => executar('orfaos')} disabled={executando} style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}>
                {executando ? 'Apagando…' : 'Confirmar, apagar tudo isso'}
              </button>
            </div>
          ) : (
            <button onClick={() => setPedindoSenhaPara('orfaos')} disabled={contagemEverest.produtosOrfaos === 0}>
              Zerar produtos órfãos
            </button>
          )}
        </div>
      </div>

      {pedindoSenhaPara && (
        <ModalSenha onConfirmar={handleConfirmarSenha} onCancelar={() => setPedindoSenhaPara(null)} />
      )}
    </div>
  )
}
