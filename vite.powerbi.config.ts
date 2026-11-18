// Configuração do Vite SÓ para o HTML único da Visão geral no Power BI (o app usa vite.config.ts).
// Quem roda: scripts/gera-powerbi.mjs (npm run powerbi). Por que cada escolha:
//   root em src/powerbi:  a entrada é src/powerbi/index.html, e o Tailwind só procura classes
//                         ali (mais as linhas @source de powerbi.css), para o CSS sair enxuto.
//   viteSingleFile:       põe o JavaScript e o CSS DENTRO do HTML. O visual HTML Content recebe
//                         um texto só, sem arquivo do lado e sem internet.
//   formato 'iife':       o código vira uma função que se executa sozinha. Assim ele roda como
//                         <script> comum no fim da página (depois do window.DADOS_BRUTOS) e não
//                         deixa nomes soltos na página se o visual desenhar o HTML de novo.
//   apelido da fonte:     o pacote da fonte do app aponta para um CSS vazio (fonte do sistema).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath, URL } from 'node:url'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: here('./src/powerbi'),
  publicDir: false,
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      '@fontsource-variable/geist': here('./src/powerbi/sem-fonte.css'),
      '@fontsource-variable/geist-mono': here('./src/powerbi/sem-fonte.css'),
      '@': here('./src'),
    },
  },
  build: {
    outDir: here('./powerbi/saida/build'),
    emptyOutDir: true,
    target: 'es2020',
    reportCompressedSize: false,
    rollupOptions: { output: { format: 'iife' } },
  },
})
