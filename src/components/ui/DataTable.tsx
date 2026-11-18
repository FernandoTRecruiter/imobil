/* =============================================================================
   DataTable: a tabela única do app. Só DESENHA: buscar, filtrar, ordenar e paginar
   acontecem no repositório (como acontecerá no banco), e a tabela recebe a página pronta.

   - Cabeçalho ordenável com <button> e aria-sort (o leitor de tela diz a ordem).
   - Cabeçalho grudado no topo da moldura; a tabela larga rola DENTRO da moldura,
     nunca a página inteira para o lado.
   - Clique na linha abre o detalhe; para quem usa teclado, a célula principal deve ter um Link.
   - Trocar de página, filtro ou ordem (07/11, "tá muito travado"): as linhas antigas ficam na tela
     esmaecidas (60%) enquanto as novas chegam (o useRepo guarda a leitura anterior), e as linhas
     NOVAS entram com um fade curto. Ao ordenar, a linha que muda de lugar também refaz o fade (o
     navegador recomeça a animação do elemento que o React move), o que avisa que a ordem mudou.
     Passar o mouse ou escolher não monta linha de novo, então não anima. O esqueleto só aparece na
     primeira leitura, quando não há nada para mostrar.
   ============================================================================= */
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { SortDir } from '@/data/query'
import type { CsvColumn } from '@/lib/csv'
import { cn } from './cn'
import { Skeleton, ErrorState } from './States'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** Ligue para ordenar por esta coluna (a chave precisa existir em "sorts" do repositório). */
  sortable?: boolean
  /** 1º clique: 'desc' para número e data (maior/mais novo primeiro), 'asc' para texto. */
  firstDir?: SortDir
  align?: 'left' | 'right' | 'center'
  className?: string
  /** Esconde a coluna em telas estreitas (o dado continua no detalhe). */
  hideBelow?: 'sm' | 'md' | 'lg'
  /*
   * Escolha de colunas (botão "Colunas" da ListToolbar, 07/11/2026). Ver components/ui/columns.ts.
   *   optional: começa DESLIGADA; a pessoa liga no menu (as colunas de hoje continuam o padrão);
   *   locked:   sempre à vista (a coluna que diz o que é a linha, ou a caixa de comparar);
   *   menuLabel: nome no menu quando o cabeçalho é vazio ou curto demais.
   */
  optional?: boolean
  locked?: boolean
  menuLabel?: string
  /**
   * O que a coluna vira no "Exportar": uma ou mais colunas do arquivo. A célula da tela costuma
   * juntar dados ("Contrato e unidade"), e no arquivo cada um tem a sua coluna (Código, Unidade,
   * Imóvel). Sem isto a coluna não vai para o arquivo (ex.: botões de ação, caixa de comparar).
   */
  export?: CsvColumn<T>[]
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T) => string
  sort?: { key: string; dir: SortDir } | null
  onSort?: (key: string, firstDir: SortDir) => void
  onRowClick?: (row: T) => void
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  empty?: ReactNode
  caption: string
}

const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' }
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' }

export function DataTable<T>({ columns, rows, rowKey, sort, onSort, onRowClick, loading, error, onRetry, empty, caption }: Props<T>) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  const refreshing = !!loading && !!rows
  return (
    <div className="relative max-h-[70vh] overflow-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm" aria-busy={loading || undefined}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key
              const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn('sticky top-0 z-10 border-b border-border bg-surface-2 px-3 py-2 text-xs font-medium whitespace-nowrap text-muted', ALIGN[c.align ?? 'left'], c.hideBelow && HIDE[c.hideBelow], c.className)}
                >
                  {c.sortable && onSort ? (
                    <button
                      className={cn('inline-flex min-h-6 items-center gap-1 transition-colors duration-150 hover:text-text', active && 'text-text', c.align === 'right' && 'flex-row-reverse')}
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
        {/* O corpo inteiro esmaece enquanto a leitura nova chega (uma transição só, não uma por linha). */}
        <tbody className={cn('transition-opacity duration-200 ease-out', refreshing && 'opacity-60')}>
          {loading && !rows
            ? Array.from({ length: 8 }, (_, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className={cn('border-b border-border px-3 py-2.5', c.hideBelow && HIDE[c.hideBelow])}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </td>
                  ))}
                </tr>
              ))
            : rows?.map((r) => (
                <tr
                  key={rowKey(r)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  // animate-fade-in roda só quando a linha MONTA (página ou filtro novo), não a cada desenho.
                  className={cn('animate-fade-in bg-surface transition-colors duration-150 ease-out', onRowClick && 'cursor-pointer hover:bg-primary-soft/60')}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('border-b border-border px-3 py-2 align-middle', ALIGN[c.align ?? 'left'], c.align === 'right' && 'num', c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && rows && rows.length === 0 && <div className="bg-surface">{empty}</div>}
    </div>
  )
}
