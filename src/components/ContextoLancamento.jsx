import Icon from './Icon'

// Bloco padrão no topo de todo lançamento que puxa a base (Perdas, Produção, Recebimento, Contagem,
// Requisição/Transferência — pedido do Felipe, 2ª rodada: "o cabeçalho é isso mesmo, só precisa
// arrumar de um jeito que fique bonito" + layout em grade dado por ele: Loja/Data numa linha, Setor
// sozinho embaixo, Usuário/Turno na linha de baixo). Cada campo só aparece se a tela passar o valor
// — Produção e Recebimento não têm Loja nem Turno, por exemplo.
//
// 08/10/2026, 3ª rodada ("viu como o cabeçalho não estão iguais ao da Perda"): com menos campos
// disponíveis (ex.: Produção só tem Setor + Usuário), as linhas "Loja/Data" e "Usuário/Turno"
// separadas deixavam campo solto sozinho numa linha — virava uma lista empilhada, bem diferente
// da Perdas. Setor continua com linha própria em destaque (é o campo mais importante, sempre no
// topo); todo o resto (Loja/Data/Usuário/Turno) vira UM grupo só, que empacota de 2 em 2 sozinho —
// com todos os 4 campos (Perdas) dá exatamente a mesma grade de antes; com menos campos (Produção,
// Recebimento, Contagem), o que sobra se junta em vez de ficar cada um na sua linha.
//
// 08/10/2026, 4ª rodada ("eu quero que apareça TODA a informação no cabeçalho, já falamos várias
// vezes isso" — circulou o cartão de Perdas inteiro): Requisição/Transferência tinha ficado de fora
// porque mexe em DOIS locais (origem e destino), não um Setor só — mas o pedido é claro, todas as
// abas usam o mesmo cartão, sem exceção. `origem`/`destino` substituem `setor` nesse caso: os dois
// em destaque, lado a lado, com o mesmo botão de inverter que já existia no formulário.
//
// "Deixar disponível para alterar Loja, setor e turno (sem a palavra alterar)": o valor em si é o
// botão — sem link "alterar" à parte. Só Loja/Setor/origem/destino abrem popup de trocar (com
// confirmação — são a mesma base padronizada); Turno e Data (quando a tela passa `onTrocarTurno`/
// `onTrocarData`) abrem um popup simples de um passo só, sem confirmação extra.
export default function ContextoLancamento({
  loja, setor, origem, destino, data, turno, usuario,
  onTrocarSetor, onTrocarTurno, onTrocarData, onTrocarOrigem, onTrocarDestino, onInverter
}) {
  const secundarios = [
    loja != null && { chave: 'loja', label: 'Loja', valor: loja, onClick: onTrocarSetor },
    data != null && { chave: 'data', label: 'Data', valor: data, onClick: onTrocarData },
    usuario != null && { chave: 'usuario', label: 'Usuário', valor: usuario },
    turno != null && { chave: 'turno', label: 'Turno', valor: turno, onClick: onTrocarTurno }
  ].filter(Boolean)

  return (
    <div className="card" style={{ marginBottom: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {setor != null && <Campo label="Setor" valor={setor} onClick={onTrocarSetor} destaque />}
      {(origem != null || destino != null) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {origem != null && <Campo label="De" valor={origem} onClick={onTrocarOrigem} destaque />}
          {onInverter && (
            <button
              type="button"
              onClick={onInverter}
              aria-label="Inverter origem e destino"
              style={{ padding: 6, flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <Icon nome="arrows-exchange" tamanho={16} />
            </button>
          )}
          {destino != null && <Campo label="Para" valor={destino} onClick={onTrocarDestino} destaque />}
        </div>
      )}
      {secundarios.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
          {secundarios.map((c) => (
            <div key={c.chave} style={{ flex: '1 1 40%', minWidth: 130 }}>
              <Campo {...c} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Campo({ label, valor, onClick, destaque }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span className="muted" style={{ fontSize: 11.5 }}>{label}: </span>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          style={{
            padding: 0, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer',
            textDecoration: 'underline', fontWeight: destaque ? 700 : 600, fontSize: destaque ? 14.5 : 13.5
          }}
        >
          {valor}
        </button>
      ) : (
        <span style={{ fontWeight: destaque ? 700 : 600, fontSize: destaque ? 14.5 : 13.5 }}>{valor}</span>
      )}
    </div>
  )
}
