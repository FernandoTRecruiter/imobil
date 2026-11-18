// Rota /vistorias/$inspectionId: só liga o endereço à página do módulo (a página mora em src/modules/manutencao).
import { createFileRoute } from '@tanstack/react-router'
import { InspectionPage } from '@/modules/manutencao/InspectionPage'

export const Route = createFileRoute('/vistorias/$inspectionId')({
  component: function RouteComponent() {
    const { inspectionId } = Route.useParams()
    return <InspectionPage id={inspectionId} />
  },
})
