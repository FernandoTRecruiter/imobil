/* =============================================================================
   Barra de lista: UM desenho em todas as telas (07/11/2026, pedido do Fernando: "filtros enormes
   com 'baixar CSV' e 'Exportar planilha', tudo muito contra-intuitivo").

   Uma linha, da esquerda para a direita:
     [troca de categoria, se a tela tem]  [busca]  [Filtros N]  [extras da tela]  N de M  [Colunas]  [Exportar]
   e, embaixo, só quando há filtro ligado: os chips do que está ligado e "Limpar".

   - "Filtros" abre um painel com os filtros da tela, um grupo por filtro (abre um de cada vez, para
     o painel não virar um rolo). O número ao lado de cada opção vem das "facets" do repositório,
     calculadas com os OUTROS filtros ligados: é exatamente o que aparece ao ligar a opção. O botão
     mostra quantos estão ligados. "toggles" são as caixas sim/não da tela (ex.: "Mostrar arquivadas"),
     que moram no mesmo painel e também viram chip.
   - "Colunas" (opcional): escolher as colunas da tabela (ColumnChooser + columns.ts).
   - "Exportar" (opcional): menu com planilha .xlsx e CSV, do que está filtrado (todas as páginas).
     Exportar mora SÓ aqui; importar é outra ação, explícita, no cabeçalho de Imóveis e em
     Configurações > Dados, nunca ao lado do Exportar.
   - No celular a linha continua uma só: os botões viram ícone (o nome fica para o leitor de tela)
     e o contador "N de M" desce para a linha de baixo.

   A API de antes continua valendo (as telas passam as mesmas props); o que mudou é que onExport
   recebe o formato escolhido.
   ============================================================================= */
import { useState, type ReactNode } from 'react'
import { Popover } from 'radix-ui'
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import type { ExportFormat } from '@/lib/exportar'
import type { ListState } from '@/lib/useListState'
import { plural } from '@/lib/text'
import { ColumnChooser } from './ColumnChooser'
import type { ColumnChooserState } from './columns'
import { ExportMenu } from './ExportMenu'
import { cn } from './cn'

export interface FilterDef {
  key: string
  label: string
  options: { value: string; label: string }[]
}

/** Caixa sim/não da tela (ex.: "Mostrar arquivadas"): mora no painel de filtros e vira chip quando ligada. */
export interface ToolbarToggle {
  key: string
  label: string
  /** Texto do chip quando ligada (ex.: "Com arquivadas"). */
  chip: string
  on: boolean
  onChange: (on: boolean) => void
}

export function ListToolbar({
  state,
  filters = [],
  facets,
  total,
  totalAll,
  noun,
  onExport,
  children,
  leading,
  searchPlaceholder = 'Buscar',
  columns,
  toggles = [],
}: {
  state: ListState
  filters?: FilterDef[]
  facets?: Record<string, Record<string, number>>
  total?: number
  totalAll?: number
  noun: [string, string]
  /** Exportar o que está filtrado. Recebe o formato escolhido no menu (lib/exportar.ts: downloadTable). */
  onExport?: (format: ExportFormat) => Promise<void> | void
  /** Controles da própria tela, na mesma linha (ex.: "Novo contrato", "Lista | Quadro"). */
  children?: ReactNode
  /** Controle que vem ANTES da busca, na mesma linha (a troca de categoria "Mostrar"). */
  leading?: ReactNode
  searchPlaceholder?: string
  /** Liga o botão "Colunas" (useColumnChooser). */
  columns?: ColumnChooserState
  toggles?: ToolbarToggle[]
}) {
  const chips = filters.flatMap((f) => (state.filters[f.key] ?? []).map((v) => ({ f, v, label: f.options.find((o) => o.value === v)?.label ?? v })))
  const togglesOn = toggles.filter((t) => t.on)
  const filterCount = chips.length + togglesOn.length
  const counted = total !== undefined && totalAll !== undefined
  const countText = counted ? (total === totalAll ? plural(totalAll, noun[0], noun[1]) : `${total.toLocaleString('pt-BR')} de ${plural(totalAll, noun[0], noun[1])}`) : ''
  const nothingFound = counted && total === 0 && state.params.search ? ` · nada encontrado para "${state.params.search}"` : ''
  const hasChips = chips.length > 0 || togglesOn.length > 0 || state.activeFilterCount > 0
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {leading}
        {/* A busca cresce até ocupar o que sobra; no celular encolhe o quanto precisar (a linha é uma só, os botões viram ícone). */}
        <label className="relative min-w-0 flex-1 basis-0 sm:min-w-36 sm:basis-40">
          <span className="sr-only">{searchPlaceholder}</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            value={state.searchInput}
            onChange={(e) => state.setSearchInput(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-sm transition-[border-color,box-shadow] duration-150 hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
          />
        </label>
        {(filters.length > 0 || toggles.length > 0) && <FiltersButton filters={filters} toggles={toggles} state={state} facets={facets} count={filterCount} />}
        {children}
        {/* Contador ao vivo: anuncia a frase inteira para o leitor de tela. No celular ele mora na linha de baixo. */}
        {counted && (
          <p className="ml-auto hidden text-xs whitespace-nowrap text-muted tabular-nums sm:block" aria-live="polite">
            {countText}
            {nothingFound}
          </p>
        )}
        {(columns || onExport) && (
          <div className={cn('flex shrink-0 items-center gap-2', !counted && 'ml-auto', counted && 'max-sm:ml-auto')}>
            {columns && <ColumnChooser state={columns} />}
            {onExport && <ExportMenu onExport={onExport} total={total} />}
          </div>
        )}
      </div>
      {(hasChips || counted) && (
        // Sem chip, a linha só existe no celular (para o contador); no computador ela não ocupa espaço.
        <div className={cn('flex animate-fade-in flex-wrap items-center gap-2', !hasChips && 'sm:hidden')}>
          {chips.map(({ f, v, label }) => (
            <Chip key={`${f.key}:${v}`} label={label} prefix={f.label} onRemove={() => state.toggleFilterValue(f.key, v)} />
          ))}
          {togglesOn.map((t) => (
            <Chip key={`t:${t.key}`} label={t.chip} onRemove={() => t.onChange(false)} />
          ))}
          {state.activeFilterCount > 0 && (
            <button type="button" className="min-h-6 text-xs font-medium text-primary hover:underline" onClick={state.clearFilters}>
              Limpar
            </button>
          )}
          {/* Só um dos dois contadores existe de cada vez (o outro está escondido), então só um anuncia. */}
          {counted && (
            <p className="ml-auto text-xs whitespace-nowrap text-muted tabular-nums sm:hidden" aria-live="polite">
              {countText}
              {nothingFound}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Um filtro ligado, com o X que desliga só ele. */
function Chip({ label, prefix, onRemove }: { label: string; prefix?: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface py-0.5 pr-1 pl-2.5 text-xs text-text">
      {prefix && <span className="text-faint">{prefix}:</span>} {label}
      <button type="button" className="grid size-6 place-items-center rounded transition-colors duration-150 hover:bg-surface-2" onClick={onRemove} aria-label={`Remover filtro ${prefix ? `${prefix}: ` : ''}${label}`}>
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  )
}

/**
 * O botão "Filtros" e o painel. Passo a passo do painel:
 *   1. um grupo por filtro; o cabeçalho do grupo diz o nome e o que está ligado nele;
 *   2. abre um grupo de cada vez (o primeiro com algo ligado, ou o primeiro); com um filtro só,
 *      ele já vem aberto e sem cabeçalho de abrir;
 *   3. cada opção é uma caixa com o número ao lado (o que aparece ao ligá-la);
 *   4. embaixo, as caixas sim/não da tela ("Mostrar arquivadas").
 */
function FiltersButton({ filters, toggles, state, facets, count }: { filters: FilterDef[]; toggles: ToolbarToggle[]; state: ListState; facets?: Record<string, Record<string, number>>; count: number }) {
  const firstOn = filters.find((f) => (state.filters[f.key] ?? []).length > 0)?.key
  const [open, setOpen] = useState<string | null>(null)
  const current = open ?? firstOn ?? filters[0]?.key ?? null
  const single = filters.length === 1
  return (
    <Popover.Root onOpenChange={(o) => !o && setOpen(null)}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border bg-surface px-2.5 text-sm whitespace-nowrap transition-colors duration-150 sm:px-3',
            count ? 'border-primary text-text' : 'border-border hover:border-border-strong',
          )}
        >
          <SlidersHorizontal className="size-4" strokeWidth={1.5} aria-hidden="true" />
          <span className="max-sm:sr-only">Filtros</span>
          {count > 0 && (
            <span className="num text-xs text-primary">
              {count}
              <span className="sr-only"> {count === 1 ? 'ligado' : 'ligados'}</span>
            </span>
          )}
          <ChevronDown className="size-3.5 opacity-60 max-sm:hidden" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 max-h-[min(72vh,560px,var(--radix-popover-content-available-height))] w-[min(22rem,calc(100vw-32px))] origin-[var(--radix-popover-content-transform-origin)] animate-pop-in overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-pop"
        >
          <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-1.5">
            <p className="text-xs text-muted">Filtros</p>
            {count > 0 && (
              <button type="button" className="min-h-6 text-xs font-medium text-primary hover:underline" onClick={state.clearFilters}>
                Limpar todos
              </button>
            )}
          </div>
          {filters.map((f) => {
            const selected = state.filters[f.key] ?? []
            const isOpen = single || current === f.key
            const summary = selected.map((v) => f.options.find((o) => o.value === v)?.label ?? v).join(', ')
            const regionId = `filtro-${f.key}`
            return (
              <div key={f.key} className="border-t border-border first-of-type:border-t-0">
                {!single && (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={regionId}
                    onClick={() => setOpen(isOpen ? '' : f.key)}
                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-2"
                  >
                    <span className="font-medium">{f.label}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-primary">{summary}</span>
                    <ChevronDown className={cn('size-3.5 shrink-0 opacity-60 transition-transform duration-150 motion-reduce:transition-none', isOpen && 'rotate-180')} aria-hidden="true" />
                  </button>
                )}
                {isOpen && <FilterOptions id={regionId} def={f} selected={selected} counts={facets?.[f.key] ?? {}} onToggle={(v) => state.toggleFilterValue(f.key, v)} onClear={() => state.setFilter(f.key, [])} />}
              </div>
            )
          })}
          {toggles.length > 0 && (
            <div className={cn('flex flex-col gap-0.5 px-1 pt-1.5 pb-1', filters.length > 0 && 'mt-1 border-t border-border')}>
              {toggles.map((t) => (
                <label key={t.key} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm hover:bg-surface-2">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={t.on} onChange={(e) => t.onChange(e.target.checked)} />
                  {t.label}
                </label>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** As opções de um filtro, com a contagem de cada uma. Opção com zero fica cinza (ligar não mostraria nada). */
function FilterOptions({ id, def, selected, counts, onToggle, onClear }: { id: string; def: FilterDef; selected: string[]; counts: Record<string, number>; onToggle: (v: string) => void; onClear: () => void }) {
  return (
    <fieldset id={id} className="pb-1.5">
      <legend className="sr-only">{def.label}</legend>
      <div className="max-h-64 overflow-y-auto">
        {def.options.map((o) => {
          const n = counts[o.value] ?? 0
          return (
            <label key={o.value} className={cn('flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm transition-colors duration-150 hover:bg-surface-2', n === 0 && !selected.includes(o.value) && 'text-muted')}>
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              <span className="num text-xs text-muted">{n}</span>
            </label>
          )
        })}
        {!def.options.length && <p className="px-2 py-1.5 text-xs text-muted">Nenhuma opção na lista de agora.</p>}
      </div>
      {selected.length > 0 && (
        <button type="button" className="mt-0.5 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-primary hover:bg-surface-2" onClick={onClear}>
          Limpar {def.label.toLowerCase()}
        </button>
      )}
    </fieldset>
  )
}
