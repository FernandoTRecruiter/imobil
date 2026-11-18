// Rota /vistorias/: só liga o endereço à página do módulo (a página mora em src/modules/manutencao).
import { createFileRoute } from '@tanstack/react-router'
import { InspectionsPage } from '@/modules/manutencao/InspectionsPage'

export const Route = createFileRoute('/vistorias/')({ component: InspectionsPage })
