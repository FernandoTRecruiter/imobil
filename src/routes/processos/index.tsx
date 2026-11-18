// Rota /processos/: só liga o endereço à página do módulo (a página mora em src/modules/processos).
import { createFileRoute } from '@tanstack/react-router'
import { ProcessesPage } from '@/modules/processos/ProcessesPage'

export const Route = createFileRoute('/processos/')({ component: ProcessesPage })
