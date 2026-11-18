// Rota /relatorios/: só liga o endereço à página do módulo (a página mora em src/modules/relatorios).
import { createFileRoute } from '@tanstack/react-router'
import { ReportsPage } from '@/modules/relatorios/ReportsPage'

export const Route = createFileRoute('/relatorios/')({ component: ReportsPage })
