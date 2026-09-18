import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// 28/08/2026 — VERSÃO DO BUILD.
// Motivo: duas entregas seguidas ("líquido = bruto" e "fator em %") não surtiram efeito na tela,
// e não havia como saber se o problema era o código ou um dist antigo ainda no ar no Cloudflare.
// Passar meia hora investigando um bug que já estava corrigido é caro; um número visível resolve.
//
// Como funciona:
//  - `VITE_BUILD_ID` é passado no comando de build (ex.: VITE_BUILD_ID=50). Sem ele, cai pra data
//    e hora, que ainda identifica o build de forma única.
//  - O valor entra no bundle (mostrado no rodapé da barra lateral do admin) E num arquivo estático
//    `version.json` na raiz do dist.
//
// O `version.json` é o que resolve a dúvida de verdade: dá pra abrir
// `https://<endereço-do-app>/version.json` no navegador e ver o que o Cloudflare está servindo,
// sem depender de cache de JS, de service worker ou de recarregar a página certa.
const BUILD_ID = process.env.VITE_BUILD_ID || new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '')
const BUILD_TIME = new Date().toISOString()

function gravarVersionJson() {
  return {
    name: 'gravar-version-json',
    apply: 'build',
    closeBundle() {
      // 02/09/2026: `writeFileSync` sozinho falha com ENOENT quando `dist/` não existe ainda —
      // acontece em clone novo (build limpo). Nas máquinas onde já havia um `dist` de um build
      // anterior isso passava batido, então o defeito só aparece exatamente onde mais dói: na
      // primeira compilação de um checkout limpo, que é o caso do deploy automático do Cloudflare.
      const pasta = path.resolve(__dirname, 'dist')
      fs.mkdirSync(pasta, { recursive: true })
      const destino = path.join(pasta, 'version.json')
      fs.writeFileSync(destino, JSON.stringify({ build: BUILD_ID, geradoEm: BUILD_TIME }, null, 2))
      console.log(`\nversion.json gravado — build ${BUILD_ID}`)
    }
  }
}

export default defineConfig({
  plugins: [react(), gravarVersionJson()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME)
  },
  server: {
    host: true // permite acessar pelo celular na mesma rede via IP, necessário pra testar a câmera
  }
})
