/* Selos: fundo com ~12% da cor e texto na versão escura da cor (contraste conferido).
   Cor nunca sozinha: o selo sempre tem o texto da situação. */
import type { ReactNode } from 'react'
import type { Tone } from '@/data/labels'
import { UNIT_STATUS } from '@/data/labels'
import type { UnitStatus } from '@/data/types'
import { cn } from './cn'

const TONE: Record<Tone, string> = {
  neutral: 'bg-[color-mix(in_srgb,var(--st-blocked)_12%,transparent)] text-[var(--st-blocked-fg)]',
  primary: 'bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-[var(--st-occupied-fg)]',
  success: 'bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success-fg)]',
  warning: 'bg-[color-mix(in_srgb,var(--warning)_13%,transparent)] text-[var(--warning-fg)]',
  danger: 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger-fg)]',
  orange: 'bg-[color-mix(in_srgb,var(--st-maintenance)_12%,transparent)] text-[var(--st-maintenance-fg)]',
}

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} aria-hidden="true" />}
      {children}
    </span>
  )
}

/** Cor de cada situação de unidade (mapa, espelho, legenda). */
export const UNIT_STATUS_VAR: Record<UnitStatus, string> = {
  available: 'var(--st-available)',
  occupied: 'var(--st-occupied)',
  reserved: 'var(--st-reserved)',
  maintenance: 'var(--st-maintenance)',
  blocked: 'var(--st-blocked)',
}
const UNIT_TONE: Record<UnitStatus, Tone> = { available: 'success', occupied: 'primary', reserved: 'warning', maintenance: 'orange', blocked: 'neutral' }

export function UnitStatusBadge({ status }: { status: UnitStatus }) {
  return (
    <Badge tone={UNIT_TONE[status]} dot={UNIT_STATUS_VAR[status]}>
      {UNIT_STATUS[status]}
    </Badge>
  )
}
