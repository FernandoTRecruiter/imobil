// Rota /imoveis/novo: só liga o endereço à página do módulo (a página mora em src/modules/imoveis).
import { createFileRoute } from '@tanstack/react-router'
import { NewPropertyPage } from '@/modules/imoveis/NewPropertyPage'

export const Route = createFileRoute('/imoveis/novo')({ component: NewPropertyPage })
