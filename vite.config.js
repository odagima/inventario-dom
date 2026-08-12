import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true // permite acessar pelo celular na mesma rede via IP, necessário pra testar a câmera
  }
})
