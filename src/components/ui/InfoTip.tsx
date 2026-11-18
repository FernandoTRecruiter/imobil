/* "i" com a explicação (a fórmula, não a aula). Popover e não tooltip: funciona no toque do celular. */
import type { ReactNode } from 'react'
import { Popover } from 'radix-ui'
import { Info } from 'lucide-react'

export function InfoTip({ children, label = 'Como é calculado' }: { children: ReactNode; label?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="inline-grid size-6 place-items-center rounded-full text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text" aria-label={label}>
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} className="z-50 max-w-72 origin-[var(--radix-popover-content-transform-origin)] animate-pop-in rounded-xl border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text shadow-pop">
          {children}
          <Popover.Arrow className="fill-[var(--surface)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
