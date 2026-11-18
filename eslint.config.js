// Lint: lê o código atrás de erro comum antes de rodar (variável esquecida, regra dos hooks do React).
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // routeTree.gen.ts é gerado pelo plugin de rotas: não se edita nem se revisa à mão.
  // condominio/ é outro app (com lint, tipos e testes próprios): o Imobil não revisa o código dele.
  globalIgnores(['dist', 'src/routeTree.gen.ts', 'powerbi/saida', 'node_modules', 'condominio/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
  },
  {
    files: ['scripts/**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
  },
])
