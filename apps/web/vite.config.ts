import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist' },
  server: { port: 5175, proxy: { '/api': { target: 'https://actionflow-api.marketmesh-api.workers.dev', changeOrigin: true } } }
})
