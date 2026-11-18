/* =============================================================================
   Segmented: a troca de categoria "Mostrar: A | B | C" no começo da barra de lista (07/11/2026).
   Um grupo de botões com aria-pressed (o leitor de tela diz qual está ligado) a partir de 640 px;
   no celular vira uma lista de escolha nativa, porque o grupo não cabe na mesma linha da busca e dos
   botões da barra (a barra é uma linha só também no celular).
   ============================================================================= */
import { useId } from 'react'
import { cn } from './cn'

export function Segmented<K extends string>({ value, options, onChange, label = 'Mostrar' }: { value: K; options: { value: K; label: string }[]; onChange: (k: K) => void; label?: string }) {
  const id = useId()
  return (
    <>
      <label className="shrink-0 sm:hidden">
        <span className="sr-only">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value as K)} className="h-9 max-w-32 rounded-lg border border-border bg-surface pr-6 pl-2 text-sm font-medium">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-surface p-0.5 max-sm:hidden" role="group" aria-labelledby={id}>
        {/* O nome do grupo fica para o leitor de tela: os botões já dizem o que mostram. */}
        <span id={id} className="sr-only">
          {label}
        </span>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => value !== o.value && onChange(o.value)}
            className={cn('h-8 rounded-md px-3 text-sm transition-colors duration-150 ease-out', value === o.value ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:text-text')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </>
  )
}
