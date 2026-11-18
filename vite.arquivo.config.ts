// Build "arquivo único": o app inteiro num Imobil.html que abre com dois cliques, sem servidor.
// Por que precisa de config própria:
//   viteSingleFile: embute JS, CSS, fontes e imagens dentro do HTML (página aberta do disco não busca
//                   outros arquivos com segurança: o navegador bloqueia módulo vindo de file://);
//   base './':      caminhos relativos, porque do disco não existe "raiz do site";
//   outDir próprio: não mistura com o dist/ do build normal.
//   define:         liga as rotas com "#" SEMPRE neste build (ver main.tsx): do disco não há endereço
//                   de página, e numa subpasta de site (GitHub Pages) o endereço normal daria 404.
import { defineConfig, mergeConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import base from './vite.config'

export default mergeConfig(
  base,
  defineConfig({
    base: './',
    plugins: [viteSingleFile()],
    build: { outDir: 'dist-arquivo', emptyOutDir: true },
    define: { 'import.meta.env.VITE_HASH_HISTORY': JSON.stringify('1') },
  }),
)
