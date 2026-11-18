/* =============================================================================
   Peças de tela da "Contratos e pessoas" que outras telas também usam (07/11/2026):
     - CategorySwitch: o "Mostrar: A | B" que troca o que a tabela lista (Contratos | Pessoas aqui;
       Unidades | Vagas na aba Unidades da ficha do imóvel);
     - FichaFrame: a moldura da ficha CURTA ao lado da tabela (eyebrow, título, lista curta de dados,
       ações no rodapé), com o mesmo desenho da ficha curta da página Imóveis;
     - FichaFooter: o rodapé dela, com "Limpar escolha" sempre por último.
   ============================================================================= */
import { useId, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DescriptionList } from '@/components/ui/Layout'
import { Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'

/**
 * "Mostrar: A | B": um grupo de botões com aria-pressed (o leitor de tela diz qual está ligado).
 * atalho: mesmo desenho do KindSwitch de imoveis/PropertiesPage.tsx (que não é exportado); quando o kit
 * (components/ui) ganhar um controle segmentado, trocar os dois por ele.
 */
export function CategorySwitch<K extends string>({ value, options, onChange, label = 'Mostrar' }: { value: K; options: { value: K; label: string }[]; onChange: (k: K) => void; label?: string }) {
  const id = useId()
  return (
    <div className="flex items-center gap-3">
      <span id={id} className="text-[13px] font-medium">
        {label}
      </span>
      <div className="inline-flex h-10 items-center rounded-lg border border-border bg-surface p-1" role="group" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn('h-8 rounded-md px-3 text-sm', value === o.value ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:text-text')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export type FichaItem = { label: string; value: ReactNode; info?: ReactNode }

/**
 * A moldura da ficha curta. Três estados com a mesma moldura: nada escolhido (um resumo e o que
 * fazer), carregando (esqueleto no lugar dos dados) e escolhido (dados e ações).
 * atalho: copia o desenho do Frame de imoveis/FichaCurta.tsx (que não é exportado); quando ele for,
 * usar o de lá e apagar este.
 */
export function FichaFrame({
  label, eyebrow, title, sub, aside, items, children, footer, className,
}: {
  label: string
  eyebrow: ReactNode
  title: ReactNode
  sub?: ReactNode
  /** Ao lado do título (foto da pessoa, selo de situação). */
  aside?: ReactNode
  /** null = carregando. */
  items: FichaItem[] | null
  /** Aviso curto embaixo dos dados (conflito de período, por exemplo). */
  children?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <section aria-label={label} className={cn('flex min-w-0 flex-col rounded-2xl border border-border bg-surface shadow-card', className)}>
      <div className="flex items-start gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted">{eyebrow}</p>
          <h2 className="mt-0.5 text-lg leading-snug font-medium [overflow-wrap:anywhere]">{title}</h2>
          {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
        </div>
        {aside}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {items ? (
          <DescriptionList columns={2} items={items} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2" role="status" aria-label="Carregando">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        )}
        {children}
      </div>
      {footer && <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">{footer}</div>}
    </section>
  )
}

/** Rodapé da ficha escolhida: os botões explícitos (os únicos que mudam de página ou gravam) e, por último, "Limpar escolha". */
export function FichaFooter({ children, onClear }: { children?: ReactNode; onClear: () => void }) {
  return (
    <>
      {children}
      <Button size="sm" variant="ghost" className="ml-auto" icon={<X className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={onClear}>
        Limpar escolha
      </Button>
    </>
  )
}
