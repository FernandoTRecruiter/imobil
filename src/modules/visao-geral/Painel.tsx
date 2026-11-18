/* =============================================================================
   Painel.tsx: "Pede atenção" (os alertas da Visão geral) e o atalho que abre uma lista já filtrada.

   Até 07/11 este arquivo era o painel ao lado do mapa (alertas e unidades disponíveis). A Visão
   geral virou um painel de números macro, sem mapa: ficou só a lista de alertas, em faixa de largura
   cheia, e o "quantas disponíveis e há quanto tempo" passou a ser um número do bloco Carteira.

   Atalhos para as listas: grava o filtro da lista de destino (imobil:list:<chave>, o mesmo
   que o useListState lê) e só então navega; a lista abre já filtrada, com os chips e o
   "Limpar" dela funcionando.
   ============================================================================= */
import { Link } from '@tanstack/react-router'
import { ArrowRight, CircleAlert, CircleCheck, Clock3, TrendingUp } from 'lucide-react'
import { writeJSON } from '@/lib/storage'
import { cn } from '@/components/ui/cn'
import type { ListTarget, OverviewAlert } from './repo'

/** Grava os filtros da lista de destino (a lista lê isso ao abrir, no useListState) e, se houver, a aba dela. */
export function rememberList(t: Pick<ListTarget, 'list' | 'filters' | 'sort' | 'remember'>): void {
  writeJSON(`imobil:list:${t.list}`, { filters: t.filters, sort: t.sort, pageSize: 25 })
  if (t.remember) writeJSON(t.remember.key, t.remember.value)
}

const TONE_ICON = { danger: CircleAlert, warning: Clock3, primary: TrendingUp }
const TONE_CLASS = { danger: 'text-danger-fg', warning: 'text-warning-fg', primary: 'text-[var(--st-occupied-fg)]' }

/**
 * Mesma anatomia em todo alerta: ícone com cor de significado + título + detalhe, e a LINHA
 * inteira é o link (seta à direita). O destino continua dito no rótulo do leitor de tela
 * ("Ver cobranças: ..."). "className" escolhe as colunas (na Visão geral, faixa em até 3 colunas).
 */
export function AlertList({ alerts, className }: { alerts: OverviewAlert[]; className?: string }) {
  if (!alerts.length) {
    return (
      <p className="flex items-center gap-2 py-1 text-sm text-muted">
        <CircleCheck className="size-4 text-success" strokeWidth={1.5} aria-hidden="true" /> Nada pedindo atenção agora
      </p>
    )
  }
  return (
    <ul className={cn('grid', className)}>
      {alerts.map((a) => {
        const Icon = TONE_ICON[a.tone]
        return (
          <li key={a.key} className="min-w-0">
            <Link
              to={a.target.to}
              onClick={() => rememberList(a.target)}
              className="group -mx-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
              aria-label={`${a.action}: ${a.title}`}
            >
              <Icon className={cn('mt-0.5 size-4', TONE_CLASS[a.tone])} strokeWidth={1.5} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm">{a.title}</span>
                <span className="block truncate text-xs text-muted">{a.detail}</span>
              </span>
              <ArrowRight className="mt-0.5 size-4 text-faint transition-colors group-hover:text-text" strokeWidth={1.5} aria-hidden="true" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
