import { useEffect, useState } from 'react'
import BuscaProdutoPerda from './BuscaProdutoPerda'
import TrocarLocalModal from './TrocarLocalModal'
import ContextoLancamento from './ContextoLancamento'
import Topbar from './Topbar'
import { CATEGORIAS_PERDA } from '../lib/perdas'
import { listarLocaisEstoque } from '../lib/locaisEstoqueApi'
import { buscarRecebimentoParecido, criarRecebimento, excluirRecebimento } from '../lib/recebimentosApi'

const CAT_INSUMO = CATEGORIAS_PERDA.find((c) => c.valor === 'materia_prima')

function agora() {
  return new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Recebimento de Mercadoria — pedido do Felipe (06/10/2026): "algo simples. Fornecedor, número da
// NF (se tiver), data (automático), horário (automático), item (apenas insumos base, matéria-
// prima), e quantidade." Data/horário não são campos editáveis de propósito — é "chegou agora",
// não um lançamento retroativo como Perdas/Contagem.
export default function RecebimentoForm({ usuario, localPadraoId, onPronto, onErro, onSair }) {
  const [locais, setLocais] = useState([])
  // Pedido do Felipe (08/10/2026, "puxa tudo automático... pra tudo e todos"): quem tem Setor
  // padrão vinculado já entra com o local certo — ainda dá pra trocar no select, é escolha de uma
  // vez só (não um cabeçalho de sessão, como Perdas).
  const [localEstoqueId, setLocalEstoqueId] = useState(localPadraoId || '')
  const [trocandoSetor, setTrocandoSetor] = useState(false)
  const [fornecedor, setFornecedor] = useState('')
  const [numeroNota, setNumeroNota] = useState('')
  const [produto, setProduto] = useState(null)
  const [quantidade, setQuantidade] = useState('')
  const [parecido, setParecido] = useState(null)
  const [verificando, setVerificando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => { listarLocaisEstoque().then(setLocais).catch((e) => onErro(e.message)) }, [onErro])

  const qtd = Number(String(quantidade).replace(',', '.'))

  // Checa "parecido" (mesmo fornecedor + mesma quantidade + mesmo item) assim que os 3 campos
  // estiverem prontos — pega o caso de lançar a mesma entrega 2x antes mesmo de enviar.
  useEffect(() => {
    setParecido(null)
    if (!produto || !(qtd > 0) || fornecedor.trim().length < 2) return
    let cancelado = false
    setVerificando(true)
    buscarRecebimentoParecido({ fornecedor, quantidade: qtd, codigoEverest: produto.codigo_everest })
      .then((r) => { if (!cancelado) setParecido(r) })
      .catch(() => {})
      .finally(() => { if (!cancelado) setVerificando(false) })
    return () => { cancelado = true }
  }, [fornecedor, qtd, produto])

  async function enviar() {
    setSalvando(true)
    setErro('')
    try {
      await criarRecebimento({ localEstoqueId, codigoEverest: produto.codigo_everest, quantidade: qtd, fornecedor, numeroNota, usuario })
      onPronto()
    } catch (e) {
      setErro('Não consegui registrar — ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function excluirAntigoEEnviar() {
    setSalvando(true)
    setErro('')
    try {
      await excluirRecebimento(parecido.id)
      await criarRecebimento({ localEstoqueId, codigoEverest: produto.codigo_everest, quantidade: qtd, fornecedor, numeroNota, usuario })
      onPronto()
    } catch (e) {
      setErro('Não consegui concluir — ' + e.message)
    } finally {
      setSalvando(false)
    }
  }

  const pronto = localEstoqueId && fornecedor.trim().length >= 2 && produto && qtd > 0

  const localAtual = locais.find((l) => l.id === localEstoqueId)

  return (
    <div className="screen">
      <Topbar titulo="Recebimento de Mercadoria" onVoltar={onSair} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ContextoLancamento
          setor={localAtual?.nome || 'sem setor'}
          data={agora()}
          usuario={usuario}
          onTrocarSetor={() => setTrocandoSetor(true)}
        />

        {trocandoSetor && (
          <TrocarLocalModal
            mostrarLoja={false}
            localAtualId={localEstoqueId}
            onFechar={() => setTrocandoSetor(false)}
            onConfirmar={(_, localNovo) => { setLocalEstoqueId(localNovo?.id || ''); setTrocandoSetor(false) }}
          />
        )}

        <div>
          <label className="muted">Fornecedor</label>
          <input type="text" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} placeholder="Nome do fornecedor" />
        </div>

        <div>
          <label className="muted">Número da NF — opcional</label>
          <input type="text" value={numeroNota} onChange={(e) => setNumeroNota(e.target.value)} placeholder="Se já tiver em mãos" />
        </div>

        {!produto ? (
          <div>
            <label className="muted">Insumo (matéria-prima)</label>
            <BuscaProdutoPerda categoria={CAT_INSUMO} onSelecionar={setProduto} />
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <p style={{ margin: 0, fontWeight: 500 }}>{produto.nome}</p>
            <button type="button" className="ghost" onClick={() => setProduto(null)}>trocar</button>
          </div>
        )}

        {produto && (
          <div>
            <label className="muted">Quantidade ({produto.unidade_medida})</label>
            <input type="number" min="0" step="0.001" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </div>
        )}

        {verificando && <p className="muted" style={{ fontSize: 12 }}>Conferindo se já existe um parecido…</p>}

        {parecido && (
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--warning)', borderRadius: 10, padding: '10px 12px' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13 }}>
              Já existe um recebimento parecido: <strong>{fornecedor}</strong>, mesma quantidade, registrado {new Date(parecido.registrado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              {parecido.usuario ? ` por ${parecido.usuario}` : ''}. Pode ser o mesmo lançado 2 vezes.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setParecido(null)} disabled={salvando} style={{ flex: 1 }}>Não, são diferentes</button>
              <button onClick={excluirAntigoEEnviar} disabled={salvando} style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}>
                {salvando ? 'Excluindo…' : 'Excluir o antigo e enviar'}
              </button>
            </div>
          </div>
        )}

        {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}

        {!parecido && (
          <button className="primary" onClick={enviar} disabled={!pronto || salvando} style={{ width: '100%' }}>
            {salvando ? 'Registrando…' : 'Registrar recebimento'}
          </button>
        )}
      </div>
    </div>
  )
}
