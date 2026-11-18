/* =============================================================================
   ColumnChooser: o botão "Colunas" (07/11/2026). Menu com uma caixa por coluna; a escolha fica
   lembrada por tabela (columns.ts) e vale para o "Exportar". "Restaurar padrão" volta para as
   colunas de antes. A coluna que diz o que é a linha aparece marcada e travada: sem ela a linha
   não teria nome.
   ============================================================================= */
import { Popover } from 'radix-ui'
import { Columns3 } from 'lucide-react'
import type { ColumnChooserState } from './columns'
import { cn } from './cn'

export function ColumnChooser({ state }: { state: ColumnChooserState }) {
  const hidden = state.items.filter((i) => !i.visible).length
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-sm whitespace-nowrap transition-colors duration-150 hover:border-border-strong sm:px-3"
          title={hidden ? `${hidden} ${hidden === 1 ? 'coluna escondida' : 'colunas escondidas'}: ligue no menu` : 'Escolher as colunas da tabela'}
        >
          <Columns3 className="size-4" strokeWidth={1.5} aria-hidden="true" />
          <span className="max-sm:sr-only">Colunas</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 max-h-[min(70vh,520px,var(--radix-popover-content-available-height))] w-64 origin-[var(--radix-popover-content-transform-origin)] animate-pop-in overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-pop"
        >
          <fieldset>
            <legend className="px-2 pt-1 pb-1.5 text-xs text-muted">Colunas à vista (valem para o Exportar)</legend>
            {state.items.map((c) => (
              <label key={c.key} className={cn('flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm', c.locked ? 'cursor-default text-muted' : 'cursor-pointer hover:bg-surface-2')}>
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={c.visible} disabled={c.locked} onChange={() => state.toggle(c.key)} />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.locked && <span className="text-[11px]">sempre</span>}
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-primary hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent"
            disabled={!state.changed}
            onClick={state.reset}
          >
            Restaurar padrão
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
