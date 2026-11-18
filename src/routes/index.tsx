// Rota /: só liga o endereço à página do módulo (a página mora em src/modules/visao-geral).
import { createFileRoute } from '@tanstack/react-router'
import { OverviewPage } from '@/modules/visao-geral/OverviewPage'

export const Route = createFileRoute('/')({ component: OverviewPage })
