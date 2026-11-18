/* base './': o app funciona em qualquer endereço (GitHub Pages em subpasta, Netlify, Vercel). */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5190 },
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
})
