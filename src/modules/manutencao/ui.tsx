/* =============================================================================
   manutencao/ui.tsx: peças pequenas de tela que a manutenção, as vistorias e o portal repetem.
   Um lugar só para o selo de situação, o prazo vermelho e a navegação Chamados | Rotinas | Vistorias:
   se o desenho mudar, muda aqui e vale nas três telas.
   ============================================================================= */
import { Link } from '@tanstack/react-router'
import { useSession } from '@/auth/SessionProvider'
import { isPortal } from '@/auth/permissions'
import { CONDITION, MAINTENANCE_STATUS, MAINTENANCE_STATUS_TONE, PRIORITY, PRIORITY_TONE, type Tone } from '@/data/labels'
import type { Condition, MaintenancePriority, MaintenanceStatus } from '@/data/types'
import { formatDate } from '@/lib/dates'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/components/ui/cn'

export function StatusBadge({ status }: { status: MaintenanceStatus }) {
  return <Badge tone={MAINTENANCE_STATUS_TONE[status]}>{MAINTENANCE_STATUS[status]}</Badge>
}

export function PriorityBadge({ priority }: { priority: MaintenancePriority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY[priority]}</Badge>
}

export const CONDITION_TONE: Record<Condition, Tone> = { good: 'success', fair: 'warning', poor: 'danger', na: 'neutral' }

export function ConditionBadge({ condition }: { condition: Condition }) {
  return <Badge tone={CONDITION_TONE[condition]}>{CONDITION[condition]}</Badge>
}

/** Prazo: em vermelho e com a palavra "atrasado" quando passou (cor nunca sozinha). */
export function DueDate({ date, late }: { date: string | null; late: boolean }) {
  if (!date) return <span className="text-muted">Sem prazo</span>
  return (
    <span className={cn('inline-flex flex-col leading-tight', late && 'font-semibold text-danger-fg')}>
      {formatDate(date)}
      {late && <span className="text-[11px] font-medium">atrasado</span>}
    </span>
  )
}

type NavKey = 'chamados' | 'rotinas' | 'vistorias'

/**
 * Chamados | Rotinas | Vistorias: as telas da Manutenção (o menu lateral leva só a "Manutenção").
 * O prestador não tem vistoria (o escopo dele só tem os chamados atribuídos), então não vê o atalho.
 * Rotinas é trabalho interno da equipe: só aparece para quem não é do portal. Chamados e Rotinas são
 * a mesma página (/manutencao), trocada pelo ?aba=rotinas do endereço.
 */
export function MaintenanceNav({ current }: { current: NavKey }) {
  const s = useSession()
  if (s.roles.length === 1 && s.roles[0] === 'vendor') return null
  const cls = (key: NavKey) => cn('inline-flex h-8 items-center rounded-md px-3 text-sm', current === key ? 'bg-surface font-medium text-text shadow-card' : 'text-muted hover:text-text')
  const here = (key: NavKey) => (current === key ? 'page' : undefined)
  return (
    <nav aria-label="Manutenção" className="inline-flex items-center gap-1 rounded-lg bg-surface-2 p-1 ring-1 ring-border">
      <Link to="/manutencao" search={{}} aria-current={here('chamados')} className={cls('chamados')}>
        Chamados
      </Link>
      {!isPortal(s) && (
        <Link to="/manutencao" search={{ aba: 'rotinas' }} aria-current={here('rotinas')} className={cls('rotinas')}>
          Rotinas
        </Link>
      )}
      <Link to="/vistorias" aria-current={here('vistorias')} className={cls('vistorias')}>
        Vistorias
      </Link>
    </nav>
  )
}
