/* Abas (Radix Tabs: setas do teclado trocam de aba, ARIA pronto). Contagem em cada aba quando houver.
   Movimento (07/11): o painel da aba que abre sobe 4 px e aparece (200 ms). A Radix só monta o painel
   da aba ativa, então a animação roda na troca de aba, não a cada desenho. */
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef, type ReactNode } from 'react'
import { Tabs as R } from 'radix-ui'
import { cn } from './cn'

export interface TabDef {
  value: string
  label: string
  count?: number
}

export function Tabs({ value, onValueChange, tabs, children }: { value: string; onValueChange: (v: string) => void; tabs: TabDef[]; children: ReactNode }) {
  return (
    <R.Root value={value} onValueChange={onValueChange}>
      <R.List className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Seções">
        {tabs.map((t) => (
          <R.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px flex min-h-9 items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted transition-[color,border-color] duration-150 ease-out hover:text-text data-[state=active]:border-primary data-[state=active]:text-text"
          >
            {t.label}
            {t.count !== undefined && <span className="num text-xs text-faint">{t.count}</span>}
          </R.Trigger>
        ))}
      </R.List>
      {children}
    </R.Root>
  )
}

/** Painel de uma aba: o mesmo da Radix (mesmas propriedades), com a entrada curta. */
export const TabPanel = forwardRef<ComponentRef<typeof R.Content>, ComponentPropsWithoutRef<typeof R.Content>>(function TabPanel({ className, ...props }, ref) {
  return <R.Content ref={ref} className={cn('animate-rise-in', className)} {...props} />
})
