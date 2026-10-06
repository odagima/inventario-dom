import { useEffect, useState } from 'react'
import { verificarPin } from '../../lib/api'
import ModalSenha from '../../components/ModalSenha'
import { listarLocaisEstoque } from '../../lib/locaisEstoqueApi'
import { listarProducoes, removerProducaoCompleta } from '../../lib/producaoApi'
import {
  listarRequisicoesHistorico,
  listarTransferenciasHistorico,
  removerRequisicaoCompleta,
  removerTransferenciaCompleta
} from '../../lib/requisicaoTransferenciaApi'

// Limpeza de teste — só DEV (pedido do Felipe, 06/10/2026: "estou fazendo vários testes, e depois
// preciso apagar"). Diferente do "×" no Histórico de movimentação (LocaisEstoque.jsx, que só
// apaga a LINHA de saldo), aqui exclui o EVENTO inteiro — Produção, Requisição ou Transferência —
// e tudo que está ligado a ele (itens, movimentos de saldo). Exceção deliberada à regra de "não
// sumir com nada" do resto do app: existe só pra limpar lançamento de teste, não é fluxo normal.
//
// Dupla trava, mesmo padrão de Reset.jsx: a aba só aparece no menu pra quem tem `perm: 'dev'`, E
// cada exclusão pede a senha de novo e confere `ehDesenvolvedor` na hora — perm de menu sozinha
// não bastaria pra uma ação deste tamanho.
export default function LimpezaTeste() {
  const [locais, setLocais] = useState([])
  const [producoes, setProducoes] = useState([])
  const [requisicoes, setRequisicoes] = useState([])
  const [transferencias, setTransferencias] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [pendente, setPendente] = useState(null) // { tipo: 'producao'|'requisicao'|'transferencia', id, rotulo }
  const [excluindo, setExcluindo] = useState(false)

  async function carregar() {
    try {
      const [ls, prod, req, transf] = await Promise.all([
        listarLocaisEstoque(),
        listarProducoes({ limite: 100 }),
        listarRequisicoesHistorico(100),
        listarTransferenciasHistorico(100)
      ])
      setLocais(ls)
      setProducoes(prod)
      setRequisicoes(req)
      setTransferencias(transf)
      setErro('')
    } catch (e) {
      setErro('Não consegui carregar — ' + e.message)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  async function confirmarSenha(senha) {
    const resultado = await verificarPin(senha)
    if (!resultado?.ehDesenvolvedor) return false
    setExcluindo(true)
    try {
      if (pendente.tipo === 'producao') await removerProducaoCompleta(pendente.id)
      if (pendente.tipo === 'requisicao') await removerRequisicaoCompleta(pendente.id)
      if (pendente.tipo === 'transferencia') await removerTransferenciaCompleta(pendente.id)
      setPendente(null)
      await carregar()
      return true
    } catch (e) {
      setErro('Não consegui excluir — ' + e.message)
      return true // senha estava certa — fecha o modal mesmo com erro na exclusão, que já aparece acima
    } finally {
      setExcluindo(false)
    }
  }

  if (carregando) return <div className="card"><p className="muted">Carregando…</p></div>

  const nomePorLocal = Object.fromEntries(locais.map((l) => [l.id, l.nome]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Limpeza de teste</p>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
          Exclui o evento inteiro (não só o reflexo no saldo) — produção, requisição ou transferência, com tudo que está ligado a ele. Não dá pra desfazer.
        </p>
      </div>

      {erro && <div className="card"><p style={{ color: 'var(--danger)' }}>{erro}</p></div>}

      <div className="card">
        <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 15 }}>Produções</p>
        {producoes.length === 0 ? <p className="muted">Nenhuma ainda.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {producoes.map((p) => {
              const entradas = (p.producoes_itens || []).filter((i) => i.papel === 'entrada')
              const saidas = (p.producoes_itens || []).filter((i) => i.papel === 'saida')
              const rotulo = entradas.map((e) => `${e.quantidade} ${e.unidade} ${e.produtos?.nome || e.codigo_everest}`).join(', ') || '—'
              return (
                <div key={p.id} className="list-item">
                  <span>
                    {p.data} · {p.locais_estoque?.nome || nomePorLocal[p.local_estoque_id] || 'sem local'} · {rotulo}
                    {saidas.length > 0 && ` → ${saidas.length} ${saidas.length === 1 ? 'saída' : 'saídas'}`}
                    {' '}<span className="muted">({p.status}{p.producao_origem_id ? ', etapa' : ''})</span>
                  </span>
                  <button
                    onClick={() => setPendente({ tipo: 'producao', id: p.id, rotulo: `produção ${rotulo}` })}
                    style={{ padding: '6px 9px', color: 'var(--danger)', flexShrink: 0 }}
                  >Excluir</button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card">
        <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 15 }}>Requisições</p>
        {requisicoes.length === 0 ? <p className="muted">Nenhuma ainda.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {requisicoes.map((r) => (
              <div key={r.id} className="list-item">
                <span>
                  {r.solicitante?.nome} ← {r.atendente?.nome} · {r.quantidade_atendida || 0}/{r.quantidade_solicitada} {r.codigo_everest}
                  {' '}<span className="muted">({r.status})</span>
                </span>
                <button
                  onClick={() => setPendente({ tipo: 'requisicao', id: r.id, rotulo: `requisição de ${r.codigo_everest}` })}
                  style={{ padding: '6px 9px', color: 'var(--danger)', flexShrink: 0 }}
                >Excluir</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 15 }}>Transferências</p>
        {transferencias.length === 0 ? <p className="muted">Nenhuma ainda.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {transferencias.map((t) => (
              <div key={t.id} className="list-item">
                <span>
                  {t.origem?.nome} → {t.destino?.nome} · {t.quantidade} {t.codigo_everest}
                  {' '}<span className="muted">({t.status})</span>
                </span>
                <button
                  onClick={() => setPendente({ tipo: 'transferencia', id: t.id, rotulo: `transferência de ${t.codigo_everest}` })}
                  style={{ padding: '6px 9px', color: 'var(--danger)', flexShrink: 0 }}
                >Excluir</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendente && (
        <ModalSenha
          onConfirmar={confirmarSenha}
          onCancelar={() => !excluindo && setPendente(null)}
        />
      )}
    </div>
  )
}
