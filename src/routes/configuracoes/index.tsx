// Rota /configuracoes/: só liga o endereço à página do módulo (a página mora em src/modules/configuracoes).
import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/modules/configuracoes/SettingsPage'

export const Route = createFileRoute('/configuracoes/')({ component: SettingsPage })
