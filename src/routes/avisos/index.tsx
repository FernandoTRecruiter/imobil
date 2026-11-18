// Rota /avisos/: só liga o endereço à página do módulo (a página mora em src/modules/avisos).
import { createFileRoute } from '@tanstack/react-router'
import { NotificationsPage } from '@/modules/avisos/NotificationsPage'

export const Route = createFileRoute('/avisos/')({ component: NotificationsPage })
