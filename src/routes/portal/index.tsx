// Rota /portal/: só liga o endereço à página do módulo (a página mora em src/modules/portal).
import { createFileRoute } from '@tanstack/react-router'
import { PortalHome } from '@/modules/portal/PortalHome'

export const Route = createFileRoute('/portal/')({ component: PortalHome })
