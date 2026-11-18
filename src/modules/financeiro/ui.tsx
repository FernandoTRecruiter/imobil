/* =============================================================================
   Peças de tela do financeiro usadas em mais de uma página (Financeiro, Repasses, Contrato).
   Ficam num lugar só para "Vencido há 3 dias" ter o mesmo texto e a mesma cor em toda tela.
   ============================================================================= */
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { Tone } from '@/data/labels'
import type { EntryState } from '@/data/rules'
import type { OwnerTransfer } from '@/data/types'
import { Badge } from '@/components/ui/Badge'
import { KpiTile } from '@/components/ui/Layout'
import { cn } from '@/components/ui/cn'

export const ENTRY_STATE_LABEL: Record<EntryState, string> = {
  forecast: 'Previsto', overdue: 'Vencido', received: 'Recebido', paid: 'Pago', canceled: 'Cancelado',
}
const ENTRY_STATE_TONE: Record<EntryState, Tone> = { forecast: 'primary', overdue: 'danger', received: 'success', paid: 'success', canceled: 'neutral' }

/**
 * Situação do lançamento com o texto que a pessoa precisa: "Vencido há 12 dias".
 * Para a inquilina, "recebido" (visão da administração) aparece como "Pago" (visão dela).
 */
export function EntryStateBadge({ state, daysOverdue, payer }: { state: EntryState; daysOverdue: number; payer?: boolean }) {
  const label =
    state === 'overdue' ? `Vencido há ${daysOverdue} ${daysOverdue === 1 ? 'dia' : 'dias'}` : payer && state === 'received' ? 'Pago' : ENTRY_STATE_LABEL[state]
  return <Badge tone={ENTRY_STATE_TONE[state]}>{label}</Badge>
}

export const TRANSFER_STATUS_LABEL: Record<OwnerTransfer['status'], string> = { draft: 'Rascunho', approved: 'Aprovado', paid: 'Pago' }
const TRANSFER_STATUS_TONE: Record<OwnerTransfer['status'], Tone> = { draft: 'neutral', approved: 'primary', paid: 'success' }

export function TransferStatusBadge({ status }: { status: OwnerTransfer['status'] }) {
  return <Badge tone={TRANSFER_STATUS_TONE[status]}>{TRANSFER_STATUS_LABEL[status]}</Badge>
}

/**
 * Link com cara de botão (navegar é link: abre em nova aba, o leitor de tela anuncia "link").
 * As classes repetem as do Button (primário e secundário, tamanho médio) porque o Button é um <button>.
 */
export function LinkButton({ to, children, icon, variant = 'secondary', className }: { to: string; children: ReactNode; icon?: ReactNode; variant?: 'primary' | 'secondary'; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium whitespace-nowrap transition-colors',
        variant === 'primary' ? 'bg-primary text-on-primary shadow-card hover:bg-primary-hover' : 'border border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2',
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  )
}

/**
 * Indicador que liga um filtro ao clicar.
 * Por que não KpiTile com onClick: com onClick ele vira <button>, e o "i" (InfoTip) dentro dele também
 * é um <button>. Botão dentro de botão é HTML inválido (o React avisa no console e o leitor de tela se
 * perde). Aqui o botão que filtra fica POR BAIXO do cartão, cobrindo a área toda; o cartão deixa o
 * clique passar (pointer-events-none) e só o "i" volta a receber clique por cima.
 */
export function FilterKpi({ active, onToggle, label, value, hint, info, tone }: { active: boolean; onToggle: () => void; label: string; value: ReactNode; hint?: ReactNode; info?: ReactNode; tone?: 'danger' | 'success' }) {
  return (
    <div
      className={cn(
        'relative rounded-2xl [&>div]:pointer-events-none [&>div]:relative [&>div]:z-10 [&>div_button]:pointer-events-auto hover:[&>div]:border-primary/50',
        'has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-primary',
        active && 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--bg)]',
      )}
    >
      <button type="button" aria-pressed={active} aria-label={`${label}: ${active ? 'tirar o filtro' : 'mostrar só estes na lista'}`} onClick={onToggle} className="absolute inset-0 rounded-2xl focus:outline-none" />
      <KpiTile label={label} value={value} hint={active ? 'Filtro ligado · clique para tirar' : hint} info={info} tone={tone} />
    </div>
  )
}

/** Percentual em pt-BR: 4.5 -> "4,5%". */
export function formatPct(n: number): string {
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
}

/** Lê "4,5" ou "4.5" ou "-1,2" (o que se digita num campo de percentual). Null se não for número. */
export function parsePct(input: string): number | null {
  const t = input.trim().replace('%', '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}
