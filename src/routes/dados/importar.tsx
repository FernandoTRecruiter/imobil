// Rota /dados/importar: só liga o endereço à página do módulo (a página mora em src/modules/dados).
import { createFileRoute } from '@tanstack/react-router'
import { ImportPage } from '@/modules/dados/ImportPage'

export const Route = createFileRoute('/dados/importar')({ component: ImportPage })
