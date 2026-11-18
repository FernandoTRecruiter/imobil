/* Build do arquivo único (npm run arquivo): o app inteiro num HTML que abre com dois cliques,
   sempre em modo demonstração (scripts/gera-arquivo.mjs apaga as chaves do Supabase do build). */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'dist-arquivo', emptyOutDir: true },
})
