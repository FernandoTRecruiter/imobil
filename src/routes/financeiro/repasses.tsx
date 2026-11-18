// Rota /financeiro/repasses: só liga o endereço à página do módulo (a página mora em src/modules/financeiro).
import { createFileRoute } from '@tanstack/react-router'
import { TransfersPage } from '@/modules/financeiro/TransfersPage'

export const Route = createFileRoute('/financeiro/repasses')({ component: TransfersPage })
