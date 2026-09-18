import { useEffect, useState } from 'react'

// Mostra qual build está rodando E qual build está PUBLICADO no servidor.
//
// Os dois números vêm de lugares diferentes de propósito:
//  - `__BUILD_ID__` é assado no bundle JS que o navegador já carregou (pode estar em cache).
//  - `version.json` é buscado do servidor a cada vez, sem cache.
// Quando os dois divergem, o navegador está com uma versão velha em cache — e a tela diz isso
// explicitamente, com o botão pra recarregar. Foi exatamente esse cenário (dist antigo no ar,
// ou cache do navegador) que fez duas correções parecerem "não ter mudado nada".
export default function VersaoBuild() {
  const local = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '?'
  const [publicado, setPublicado] = useState(null)

  useEffect(() => {
    let vivo = true
    fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d?.build) setPublicado(String(d.build)) })
      .catch(() => { /* sem rede ou arquivo ausente — só não mostra o comparativo */ })
    return () => { vivo = false }
  }, [])

  const desatualizado = publicado && publicado !== String(local)

  return (
    <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
      <p className="muted" style={{ margin: 0, fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>
        build {String(local)}
      </p>
      {desatualizado && (
        <button
          onClick={() => window.location.reload(true)}
          style={{
            marginTop: 4, width: '100%', fontSize: 10.5, padding: '5px 6px',
            background: 'var(--warning)', color: '#1A1A1A', border: 'none', borderRadius: 6, cursor: 'pointer'
          }}
        >
          Build {publicado} disponível — atualizar
        </button>
      )}
    </div>
  )
}
