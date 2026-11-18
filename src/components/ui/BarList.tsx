/* =============================================================================
   Comparação por categoria: a barra pintada ATRÁS do rótulo, depois valor e %.
   Economiza espaço e diz o que importa. Uma cor só;
   cor por linha apenas quando significa algo (ex.: situação da unidade).
   CSS puro: nenhuma biblioteca de gráfico.
   ============================================================================= */
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface BarItem {
  key: string
  label: ReactNode
  value: number
  display: ReactNode
  color?: string
  onClick?: () => void
}

export function BarList({ items, showPct = true, ariaLabel }: { items: BarItem[]; showPct?: boolean; ariaLabel: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  const total = items.reduce((a, b) => a + b.value, 0) || 1
  return (
    <ul className="flex flex-col gap-1.5" aria-label={ariaLabel}>
      {items.map((it) => {
        const Row = it.onClick ? 'button' : 'div'
        return (
          <li key={it.key}>
            <Row onClick={it.onClick} className={cn('grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 text-left text-sm', it.onClick && 'group')}>
              <span className="relative min-w-0 overflow-hidden rounded-md px-2 py-1.5">
                <span
                  className="absolute inset-y-0 left-0 rounded-md opacity-[0.16] group-hover:opacity-25"
                  style={{ width: `${(it.value / max) * 100}%`, background: it.color ?? 'var(--primary)' }}
                  aria-hidden="true"
                />
                <span className="relative block truncate">{it.label}</span>
              </span>
              <span className="num text-right font-semibold">{it.display}</span>
              {showPct && <span className="num w-12 text-right text-xs text-muted">{((it.value / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>}
            </Row>
          </li>
        )
      })}
    </ul>
  )
}
