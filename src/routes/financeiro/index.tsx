// Rota /financeiro/: só liga o endereço à página do módulo (a página mora em src/modules/financeiro).
// validateSearch: aceita ?aba=previsto|vencido|recebido|pago (o aviso "cobranças vencidas" abre a lista
// já filtrada). Qualquer outro valor é ignorado, e o parâmetro é opcional: link sem ele continua valendo.
import { createFileRoute } from '@tanstack/react-router'
import { FinancePage, type FinanceTab } from '@/modules/financeiro/FinancePage'

const ABAS: FinanceTab[] = ['previsto', 'vencido', 'recebido', 'pago']

export const Route = createFileRoute('/financeiro/')({
  validateSearch: (search: Record<string, unknown>): { aba?: FinanceTab } => (ABAS.includes(search.aba as FinanceTab) ? { aba: search.aba as FinanceTab } : {}),
  component: function RouteComponent() {
    const { aba } = Route.useSearch()
    return <FinancePage aba={aba} />
  },
})
