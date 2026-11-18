/* =============================================================================
   Gera o app num arquivo só (NOME), para abrir com dois cliques e mostrar a quem quiser ver.
   Passo a passo:
     1. build com o vite.arquivo.config.ts, com as chaves do Supabase APAGADAS: o arquivo é sempre
        demonstração (dados fictícios no navegador) e nunca leva chave nenhuma, mesmo com .env;
     2. põe o ícone dentro do HTML (o arquivo único não leva a pasta public junto);
     3. grava o resultado na raiz do projeto.
   ============================================================================= */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NOME = 'Condominio.html'
const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// 1. Variável já definida no ambiente vence o .env no Vite: vazia = modo demonstração.
execSync('npx vite build --config vite.arquivo.config.ts', {
  cwd: raiz,
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
})

// 2. Ícone embutido.
let html = fs.readFileSync(path.join(raiz, 'dist-arquivo', 'index.html'), 'utf-8')
const icone = fs.readFileSync(path.join(raiz, 'public', 'favicon.svg'), 'utf-8')
const dataUri = `data:image/svg+xml;base64,${Buffer.from(icone).toString('base64')}`
html = html.replaceAll('href="./favicon.svg"', `href="${dataUri}"`)

// Trava: nenhuma chave do Supabase pode ter entrado.
if (/supabase\.co|eyJhbGci/.test(html)) throw new Error('O arquivo único levou uma chave do Supabase. Nada foi gravado.')

// 3. Grava. E um atalho que abre direto no painel da equipe (o mesmo arquivo, endereço #/adm).
fs.writeFileSync(path.join(raiz, NOME), html)
const ATALHO = NOME.replace('.html', '-equipe.html')
fs.writeFileSync(
  path.join(raiz, ATALHO),
  `<!doctype html><meta charset="utf-8"><title>Painel da equipe</title><script>location.replace('${NOME}#/adm')</script><a href="${NOME}#/adm">Abrir o painel da equipe</a>\n`,
)
console.log(`${NOME}: ${(html.length / 1024).toFixed(0)} KB · ${ATALHO}: atalho para o painel da equipe`)
