/* =============================================================================
   ExpandTable: a tabela de "Contratos e pessoas" cuja linha ABRE no lugar (07/11/2026).

   Pedido do Fernando: "uma tabela única que tem contratos que tu expande e mostra as pessoas
   envolvidas". A linha aberta é a escolhida: abrir uma linha escolhe a coisa (a ficha curta ao lado
   e os detalhes embaixo seguem), clicar de novo nela solta. Uma aberta por vez: uma escolha, uma
   ficha, um conjunto de detalhes (a mesma regra do mapa e do 3D).

   Como funciona, passo a passo:
     1. a primeira coluna é o botão com a seta (aria-expanded, aria-controls): é por ele que o teclado
        abre e fecha (Enter ou espaço). O clique do mouse em qualquer ponto da linha faz o mesmo;
        link ou botão dentro de uma célula segue sendo dele (não abre a linha);
     2. a linha aberta ganha fundo e filete azul e, logo abaixo, uma linha da largura da tabela com o
        conteúdo (renderExpansion), que é a região que o botão controla;
     3. "pinned": a coisa escolhida que não está nesta página nem passa nos filtros (link antigo,
        aviso guardado) entra em cima de tudo, aberta, para o escolhido nunca sumir da tela;
     4. quem chega com a escolha no endereço (link) vê a página rolar até a linha aberta, uma vez.
   A busca, os filtros, a ordem e a página continuam no repositório: a tabela só desenha.

   atalho: tabela própria porque a DataTable do kit (components/ui) não tem linha expansível; quando
   ela ganhar "renderExpansion", trocar esta por ela (o desenho das células é o mesmo).
   ============================================================================= */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from 'lucide-react'
import type { Column } from '@/components/ui/DataTable'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import type { SortDir } from '@/data/query'

/**
 * Mesmas classes da DataTable, com duas opções a mais, porque a tabela divide a largura com a ficha
 * curta a partir de 1280 px (e fica com a largura toda entre 1024 e 1280):
 *   visibleClass: as classes de mostrar e esconder da coluna, no lugar de hideBelow (ex.: o contato
 *                 some só entre 1280 e 1536 px, onde a ficha ao lado já mostra o contato);
 *   headerWrap:   o título da coluna pode quebrar em duas linhas ("Contratos / vigentes").
 */
export type ExpandColumn<T> = Omit<Column<T>, 'hideBelow'> & { hideBelow?: 'sm' | 'md' | 'lg' | 'xl'; visibleClass?: string; headerWrap?: boolean }
const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' }
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' }

/** Classes de mostrar e esconder da coluna (visibleClass ganha de hideBelow). */
const show = <T,>(c: ExpandColumn<T>) => c.visibleClass ?? (c.hideBelow && HIDE[c.hideBelow])

/** Elementos que têm clique próprio: clicar neles não abre nem fecha a linha. */
const OWN_CLICK = 'a,button,input,select,textarea,label,[role="menuitem"]'

export interface ExpandTableProps<T> {
  caption: string
  columns: ExpandColumn<T>[]
  rows: T[] | undefined
  rowKey: (r: T) => string
  /** Nome da linha para o botão da seta ("Contrato LOC-2026-0012"). */
  rowLabel: (r: T) => string
  /** A linha aberta (a escolhida). */
  openKey: string | null
  /** Abrir ou fechar a linha (quem chama decide: escolher, soltar). */
  onToggle: (r: T) => void
  renderExpansion: (r: T, pinned: boolean) => ReactNode
  /** O escolhido que não está nas linhas desta página: entra em cima, aberto. */
  pinned?: T
  sort?: { key: string; dir: SortDir } | null
  onSort?: (key: string, firstDir: SortDir) => void
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  empty?: ReactNode
}

export function ExpandTable<T>({ caption, columns, rows, rowKey, rowLabel, openKey, onToggle, renderExpansion, pinned, sort, onSort, loading, error, onRetry, empty }: ExpandTableProps<T>) {
  const wrap = useRef<HTMLDivElement>(null)
  const list = pinned && !rows?.some((r) => rowKey(r) === rowKey(pinned)) ? [pinned, ...(rows ?? [])] : rows
  // Passo 4: a escolha que veio no endereço quando a tela abriu (não a de cada clique depois).
  const [arrivedKey] = useState(openKey)
  const scrolled = useRef(false)
  const arrivedShown = !!arrivedKey && !!list?.some((r) => rowKey(r) === arrivedKey)
  useEffect(() => {
    if (!arrivedShown || scrolled.current) return
    scrolled.current = true // uma vez só: depois disso, rolar é com a pessoa
    // A folga das barras grudadas no topo vem do scroll-padding-top do html (styles.css).
    wrap.current?.querySelector<HTMLElement>(`tr[data-key="${CSS.escape(arrivedKey!)}"]`)?.scrollIntoView({ block: 'start' })
  }, [arrivedShown, arrivedKey])

  if (error) return <ErrorState error={error} onRetry={onRetry} />
  const span = columns.length + 1

  /** Passo 1: clique na linha abre ou fecha, menos quando foi num link ou botão (a seta tem o próprio onClick). */
  const rowClick = (e: MouseEvent, r: T) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    if ((e.target as Element).closest(OWN_CLICK)) return
    onToggle(r)
  }

  return (
    <div ref={wrap} className="relative overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-10 border-b border-border bg-surface-2 px-1 py-2.5 sm:px-2">
              <span className="sr-only">Abrir</span>
            </th>
            {columns.map((c) => {
              const active = sort?.key === c.key
              const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn('border-b border-border bg-surface-2 px-3 py-2.5 text-xs font-medium text-muted', c.headerWrap ? 'leading-tight' : 'whitespace-nowrap', ALIGN[c.align ?? 'left'], show(c), c.className)}
                >
                  {c.sortable && onSort ? (
                    <button
                      type="button"
                      className={cn('inline-flex min-h-6 items-center gap-1 hover:text-text', active && 'text-text', c.align === 'right' && 'flex-row-reverse')}
                      onClick={() => onSort(c.key, c.firstDir ?? 'asc')}
                    >
                      {c.header}
                      {active ? sort!.dir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden="true" /> : <ArrowDown className="size-3.5" aria-hidden="true" /> : <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading && !list
            ? Array.from({ length: 8 }, (_, i) => (
                <tr key={i}>
                  <td className="border-b border-border px-1 py-3 sm:px-2" />
                  {columns.map((c) => (
                    <td key={c.key} className={cn('border-b border-border px-3 py-3', show(c))}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </td>
                  ))}
                </tr>
              ))
            : list?.flatMap((r) => {
                const key = rowKey(r)
                const open = key === openKey
                const isPinned = r === pinned && !rows?.some((x) => rowKey(x) === key)
                const regionId = `aberta-${key}`
                const cells = (
                  <tr
                    key={key}
                    data-key={key}
                    onClick={(e) => rowClick(e, r)}
                    className={cn(
                      'cursor-pointer bg-surface transition-colors hover:bg-primary-soft/60',
                      open && 'bg-primary-soft hover:bg-primary-soft [&>td:first-child]:shadow-[inset_3px_0_0_var(--primary)]',
                      loading && 'opacity-60',
                    )}
                  >
                    <td className={cn('border-b border-border px-1 py-2.5 align-middle sm:px-2', open && 'border-b-transparent')}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={open ? regionId : undefined}
                        aria-label={`${open ? 'Fechar' : 'Abrir'} ${rowLabel(r)}`}
                        onClick={() => onToggle(r)}
                        className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
                      >
                        <ChevronRight className={cn('size-4 transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-90')} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </td>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn('border-b border-border px-3 py-2.5 align-middle', open && 'border-b-transparent', ALIGN[c.align ?? 'left'], c.align === 'right' && 'num', show(c), c.className)}
                      >
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                )
                if (!open) return [cells]
                return [
                  cells,
                  <tr key={`${key}:aberta`} className="bg-surface">
                    <td colSpan={span} className="border-b border-border p-0 shadow-[inset_3px_0_0_var(--primary)]">
                      <div id={regionId} role="region" aria-label={`Detalhes de ${rowLabel(r)}`} className="@container px-4 pt-2 pb-4 [overflow-wrap:anywhere]">
                        {renderExpansion(r, isPinned)}
                      </div>
                    </td>
                  </tr>,
                ]
              })}
        </tbody>
      </table>
      {!loading && list && list.length === 0 && <div className="bg-surface">{empty}</div>}
    </div>
  )
}
