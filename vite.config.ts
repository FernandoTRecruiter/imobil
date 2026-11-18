// Configuração do Vite (monta o site e roda o servidor de desenvolvimento) e do Vitest (testes).
// Por que cada plugin:
//   tanstackRouter: lê a pasta src/routes e gera o mapa de rotas (cada arquivo vira um endereço).
//                   Precisa vir ANTES do react(), porque transforma os arquivos de rota primeiro.
//   react:          entende JSX e recarrega a tela sem perder o estado enquanto você edita.
//   tailwindcss:    gera só o CSS das classes que o código usa.
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    // "@/" aponta para src/: import '@/lib/money' em vez de '../../../lib/money'.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // condominio/ tem servidor próprio (porta 5180): gerar o Condominio.html lá não pode recarregar as telas do Imobil.
  server: { watch: { ignored: ['**/condominio/**'] } },
  test: {
    // As regras (dinheiro, CPF, escopo dos dados) rodam em Node puro, sem navegador.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // condominio/ é outro app, com os testes dele (npx vitest run dentro da pasta dele). Os padrões do
    // Vitest (node_modules, dist...) continuam, por isso o configDefaults.exclude vem junto.
    exclude: [...configDefaults.exclude, 'condominio/**'],
    // Alguns testes geram os dados fictícios de novo e fazem dezenas de consultas: com a máquina ocupada
    // passavam de 5 s (o padrão) e falhavam sem defeito nenhum.
    testTimeout: 20_000,
  },
})
