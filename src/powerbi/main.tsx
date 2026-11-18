/* =============================================================================
   main.tsx do Power BI: ponto de partida do HTML único da Visão geral.

   Como o dado chega: a medida DAX escreve <script>window.DADOS_BRUTOS = {...}</script>
   ANTES deste código no HTML; quando ele roda, o dado já está lá. Sem dado (HTML aberto
   direto no navegador), entram os dados fictícios do app.
   Sem roteador, sem React Query, sem Radix: só React e a tela.
   ============================================================================= */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loadSource } from './dados'
import { PowerBiOverview } from './PowerBiOverview'
import './powerbi.css'

declare global {
  interface Window {
    /** Preenchido pela medida DAX (formato em src/powerbi/schema.ts). */
    DADOS_BRUTOS?: unknown
  }
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <PowerBiOverview source={loadSource(window.DADOS_BRUTOS)} />
    </StrictMode>,
  )
}
