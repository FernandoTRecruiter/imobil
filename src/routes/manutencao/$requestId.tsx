// Rota /manutencao/$requestId: só liga o endereço à página do módulo (a página mora em src/modules/manutencao).
import { createFileRoute } from '@tanstack/react-router'
import { RequestPage } from '@/modules/manutencao/RequestPage'

export const Route = createFileRoute('/manutencao/$requestId')({
  component: function RouteComponent() {
    const { requestId } = Route.useParams()
    return <RequestPage id={requestId} />
  },
})
