// Rota /manutencao/: só liga o endereço à página do módulo (a página mora em src/modules/manutencao).
// validateSearch: aceita ?aba=rotinas (as rotinas de manutenção, na mesma página dos chamados). Qualquer
// outro valor é ignorado, e o parâmetro é opcional: link sem ele continua abrindo os chamados.
import { createFileRoute } from '@tanstack/react-router'
import { MaintenancePage } from '@/modules/manutencao/MaintenancePage'

export const Route = createFileRoute('/manutencao/')({
  validateSearch: (search: Record<string, unknown>): { aba?: 'rotinas' } => (search.aba === 'rotinas' ? { aba: 'rotinas' } : {}),
  component: function RouteComponent() {
    const { aba } = Route.useSearch()
    return <MaintenancePage aba={aba} />
  },
})
