// Rota /contratos/novo: só liga o endereço à página do módulo (a página mora em src/modules/contratos).
// validateSearch: aceita ?unidade=<id> para abrir o assistente com a unidade já escolhida (a tela da
// unidade usa). O parâmetro é opcional: link sem ele continua valendo.
import { createFileRoute } from '@tanstack/react-router'
import { NewContractPage } from '@/modules/contratos/NewContractPage'

export const Route = createFileRoute('/contratos/novo')({
  validateSearch: (search: Record<string, unknown>): { unidade?: string } => (typeof search.unidade === 'string' && search.unidade ? { unidade: search.unidade } : {}),
  component: function RouteComponent() {
    const { unidade } = Route.useSearch()
    return <NewContractPage unitId={unidade} />
  },
})
