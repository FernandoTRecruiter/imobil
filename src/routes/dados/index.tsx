// Rota /dados/: só liga o endereço à página do módulo (a página mora em src/modules/dados).
import { createFileRoute } from '@tanstack/react-router'
import { DataManagerPage } from '@/modules/dados/DataManagerPage'

export const Route = createFileRoute('/dados/')({ component: DataManagerPage })
