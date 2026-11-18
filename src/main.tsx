/* =============================================================================
   Ponto de partida do app. A ordem dos "provedores" importa (cada um usa o de fora):
   cache de dados (React Query) -> avisos (toast) -> sessão (persona) -> rotas (telas).
   ============================================================================= */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createHashHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { applyStartupAppearance, SessionProvider } from '@/auth/SessionProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { applyTheme, readTheme } from '@/modules/configuracoes/tema'
import { routeTree } from './routeTree.gen'
import './styles.css'

const queryClient = new QueryClient({
  // staleTime: por 30 s a tela reaproveita o que já leu, em vez de pedir de novo a cada clique.
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

// Quando as rotas vão depois do "#" (Imobil.html#/contratos) em vez do endereço normal (/contratos):
//   1. no arquivo único (npm run arquivo), SEMPRE. Aberto do disco não existe "endereço de página";
//      publicado numa subpasta (por exemplo /imobil/demo/ no GitHub Pages), o endereço normal não
//      bate com nenhuma rota e recarregar a página pede ao servidor um arquivo que não existe (404).
//      Quem liga é o vite.arquivo.config.ts (VITE_HASH_HISTORY = '1'); o build normal não tem essa variável;
//   2. em qualquer outro build aberto do disco (file:), como já era antes.
// No servidor de desenvolvimento e no build normal, nada muda: endereço normal.
const usarHash = import.meta.env.VITE_HASH_HISTORY === '1' || location.protocol === 'file:'
const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  history: usarHash ? createHashHistory() : undefined,
})

// Registra o roteador para os links terem os endereços conferidos pelo TypeScript.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// O tema escolhido em Configurações vale desde a primeira tela (antes do React desenhar, sem piscar branco).
applyTheme(readTheme())
// Cor da marca e cores/rótulos de situação que a organização configurou (Configurações).
applyStartupAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
