// Gera o Imobil.html (o app inteiro num arquivo só) na pasta principal do projeto.
// Rodar: npm run arquivo   (depois é só abrir o Imobil.html com dois cliques)
//
// Passo 1: build com a config de arquivo único (vite.arquivo.config.ts) para dist-arquivo/.
// Passo 2: copia dist-arquivo/index.html para Imobil.html, ao lado do README.
// Passo 3: confere que nada ficou de fora (nenhum <script src> nem <link href> apontando para arquivo solto).
import { execSync } from 'node:child_process'
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
execSync('npx vite build -c vite.arquivo.config.ts', { cwd: raiz, stdio: 'inherit' })

const origem = join(raiz, 'dist-arquivo', 'index.html')
const destino = join(raiz, 'Imobil.html')
copyFileSync(origem, destino)

// O plugin de arquivo único embute JS e CSS, mas não o ícone da aba (<link rel="icon">): ele sai como
// arquivo solto. Aqui o ícone vira dado dentro do próprio HTML (data:), lido da mesma fonte do app.
const svg = readFileSync(join(raiz, 'src', 'assets', 'marca.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim()
const icone = `data:image/svg+xml,${encodeURIComponent(svg)}`
let html = readFileSync(destino, 'utf8').replace(/(<link[^>]+rel="icon"[^>]+href=")[^"]+(")/, `$1${icone}$2`)
writeFileSync(destino, html, 'utf8')
html = readFileSync(destino, 'utf8')
// Conferência: nenhum arquivo gerado ao lado pode ser citado em lugar nenhum do HTML (nem em tag, nem
// dentro do JavaScript). Foi assim que a marca escapou na primeira versão: o código pedia o .svg solto.
const gerados = readdirSync(join(raiz, 'dist-arquivo')).filter((n) => n !== 'index.html')
const soltos = gerados.filter((n) => html.includes(n))
if (soltos.length) {
  console.error(`Ficou arquivo de fora do Imobil.html: ${soltos.join(', ')}`)
  process.exit(1)
}
const kb = Math.round(statSync(destino).size / 1024)
console.log(`Imobil.html pronto (${kb.toLocaleString('pt-BR')} KB): abra com dois cliques.`)
