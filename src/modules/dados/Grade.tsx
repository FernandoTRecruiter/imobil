/* =============================================================================
   Grade.tsx: a tabela "tipo planilha" do Data Manager (seleção, ordenação, célula editável).

   Por que não a DataTable compartilhada: ela só desenha texto. Aqui cada célula editável
   vira um campo ao clicar, mostra o erro do repositório NA PRÓPRIA célula e a primeira
   coluna tem caixa de seleção (inclusive no cabeçalho). O visual (moldura, cabeçalho grudado,
   rolagem dentro da moldura) é o mesmo da DataTable, para o olho não estranhar.

   Teclado: Tab anda entre as células editáveis (cada uma é um botão); Enter abre o campo;
   Enter grava; Esc desiste e volta o valor; sair do campo (Tab ou clique fora) também grava.
   ============================================================================= */
import { useRef, useState, type ReactNode } from 'react'
import { Popover } from 'radix-ui'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, LoaderCircle, Pencil } from 'lucide-react'
import type { SortDir } from '@/data/query'
import { cn } from '@/components/ui/cn'
import { Button } from '@/components/ui/Button'
import { ErrorState, Skeleton } from '@/components/ui/States'

export type Parsed = { value: unknown } | { error: string }

export type EditSpec<T> =
  | { kind: 'input'; field: string; inputMode?: 'decimal' | 'numeric' | 'text' | 'email' | 'tel'; initial: (row: T) => string; parse: (text: string) => Parsed; blocked?: (row: T) => string | null }
  | { kind: 'select'; field: string; initial: (row: T) => string; options: { value: string; label: string }[]; parse: (v: string) => Parsed; blocked?: (row: T) => string | null }
  | { kind: 'tags'; field: string; initial: (row: T) => string[]; options: { value: string; label: string }[]; blocked?: (row: T) => string | null }

export interface GridColumn<T> {
  key: string
  header: string
  /** Chave de ordenação do repositório (sem ela, a coluna não ordena). */
  sortKey?: string
  firstDir?: SortDir
  align?: 'left' | 'right'
  /** Largura mínima (classe do Tailwind): célula editável não pode "pular" ao abrir o campo. */
  minWidth?: string
  /** Sempre visível: não aparece no menu "Colunas". */
  locked?: boolean
  /** Começa escondida (a pessoa liga no menu "Colunas"). */
  hidden?: boolean
  cell: (row: T) => ReactNode
  edit?: EditSpec<T>
  /** Valor na exportação CSV/XLSX (número fica número no XLSX). */
  exportValue: (row: T) => string | number | null
}

export interface SaveArgs {
  id: string
  field: string
  value: unknown
}

interface GridProps<T extends { id: string }> {
  caption: string
  columns: GridColumn<T>[]
  rows: T[] | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  empty: ReactNode
  sort: { key: string; dir: SortDir } | null
  onSort: (key: string, firstDir: SortDir) => void
  selected: Set<string>
  onToggle: (id: string) => void
  onTogglePage: (ids: string[], on: boolean) => void
  activeId: string | null
  onActivate: (row: T) => void
  rowLabel: (row: T) => string
  onSave: (args: SaveArgs) => Promise<void>
  actions: (row: T) => ReactNode
}

export function Grade<T extends { id: string }>(p: GridProps<T>) {
  const [announce, setAnnounce] = useState('')
  if (p.error) return <ErrorState error={p.error} onRetry={p.onRetry} />
  const pageIds = p.rows?.map((r) => r.id) ?? []
  const allOn = pageIds.length > 0 && pageIds.every((id) => p.selected.has(id))
  const someOn = !allOn && pageIds.some((id) => p.selected.has(id))
  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-border">
      {/* Anúncio para leitor de tela: "Área de A-101 salva." (a célula também mostra o ✓). */}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{p.caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky top-0 z-10 w-10 border-b border-border bg-surface-2 px-3 py-2.5">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                aria-label="Selecionar todos desta página"
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = someOn
                }}
                onChange={() => p.onTogglePage(pageIds, !allOn)}
              />
            </th>
            {p.columns.map((c) => {
              const active = p.sort?.key === c.sortKey
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={c.sortKey ? (active ? (p.sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                  className={cn('sticky top-0 z-10 border-b border-border bg-surface-2 px-3 py-2.5 text-[11px] font-semibold tracking-wide whitespace-nowrap text-muted uppercase', c.align === 'right' ? 'text-right' : 'text-left', c.minWidth)}
                >
                  {c.sortKey ? (
                    <button className={cn('inline-flex min-h-6 items-center gap-1 uppercase hover:text-text', active && 'text-text', c.align === 'right' && 'flex-row-reverse')} onClick={() => p.onSort(c.sortKey!, c.firstDir ?? 'asc')}>
                      {c.header}
                      {active ? p.sort!.dir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden="true" /> : <ArrowDown className="size-3.5" aria-hidden="true" /> : <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              )
            })}
            <th scope="col" className="sticky top-0 z-10 w-20 border-b border-border bg-surface-2 px-3 py-2.5">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {p.loading && !p.rows
            ? Array.from({ length: 8 }, (_, i) => (
                <tr key={i}>
                  <td className="border-b border-border px-3 py-3" colSpan={p.columns.length + 2}>
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))
            : p.rows?.map((r) => {
                const label = p.rowLabel(r)
                return (
                  <tr
                    key={r.id}
                    onClick={() => p.onActivate(r)}
                    className={cn('transition-colors', p.activeId === r.id ? 'bg-primary-soft/70' : p.selected.has(r.id) ? 'bg-primary-soft/40' : 'bg-surface hover:bg-surface-2', p.loading && 'opacity-60')}
                  >
                    <td className="border-b border-border px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label={`Selecionar ${label}`} checked={p.selected.has(r.id)} onChange={() => p.onToggle(r.id)} />
                    </td>
                    {p.columns.map((c) => (
                      // whitespace-nowrap: como numa planilha, cada registro ocupa UMA linha (texto longo corta e mostra inteiro no title).
                      <td key={c.key} className={cn('border-b border-border px-3 py-1.5 align-middle whitespace-nowrap', c.align === 'right' ? 'num text-right' : 'text-left', c.minWidth)}>
                        {c.edit ? (
                          <EditableCell row={r} column={c} spec={c.edit} label={label} onSave={(field, value) => p.onSave({ id: r.id, field, value })} onSaved={setAnnounce} />
                        ) : (
                          c.cell(r)
                        )}
                      </td>
                    ))}
                    <td className="border-b border-border px-2 py-1.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {p.actions(r)}
                    </td>
                  </tr>
                )
              })}
        </tbody>
      </table>
      {!p.loading && p.rows && p.rows.length === 0 && <div className="bg-surface">{p.empty}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- célula editável */

interface CellProps<T> {
  row: T
  column: GridColumn<T>
  spec: EditSpec<T>
  label: string
  onSave: (field: string, value: unknown) => Promise<void>
  onSaved: (message: string) => void
}

function EditableCell<T>({ row, column, spec, label, onSave, onSaved }: CellProps<T>) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const errId = `${column.key}-${label}-erro`.replace(/\W+/g, '-')
  const blocked = spec.blocked?.(row) ?? null
  const what = `${column.header} de ${label}`

  /**
   * Fecha o campo. Com Enter/Esc o foco volta ao botão da célula (quem usa teclado não se
   * perde); saindo com Tab ou clique fora, NÃO: puxar o foco de volta prenderia a pessoa ali.
   */
  const close = (refocus: boolean) => {
    setEditing(false)
    setError(null)
    if (refocus) requestAnimationFrame(() => btn.current?.focus())
  }

  /** Lê o texto, confere na tela (mensagem rápida) e grava; o repositório confere de novo e manda o erro de regra. */
  const commit = async (raw: string | string[], refocus: boolean) => {
    if (saving) return
    const parsed: Parsed = spec.kind === 'tags' ? { value: raw } : spec.parse(raw as string)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    const before = spec.kind === 'tags' ? JSON.stringify([...spec.initial(row)].sort()) : spec.initial(row)
    const now = spec.kind === 'tags' ? JSON.stringify([...(raw as string[])].sort()) : (raw as string)
    if (before === now) return close(refocus)
    setSaving(true)
    try {
      await onSave(spec.field, parsed.value)
      setSavedAt(now)
      onSaved(`${what}: salvo.`)
      close(refocus)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar. Tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  if (blocked) {
    return (
      <span className="block truncate text-muted" title={blocked}>
        {column.cell(row)}
      </span>
    )
  }

  if (!editing) {
    // O ✓ fica enquanto o valor mostrado é o que acabou de ser gravado.
    const justSaved = savedAt !== null && savedAt === (spec.kind === 'tags' ? JSON.stringify([...spec.initial(row)].sort()) : spec.initial(row))
    return (
      <button
        ref={btn}
        type="button"
        aria-label={`Editar ${what}`}
        className={cn('group -mx-1.5 flex min-h-8 w-[calc(100%+12px)] items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-primary-soft/60 focus-visible:bg-primary-soft/60', column.align === 'right' && 'flex-row-reverse text-right')}
        onClick={(e) => {
          e.stopPropagation()
          setText(spec.kind === 'tags' ? '' : spec.initial(row))
          setError(null)
          setEditing(true)
        }}
      >
        <span className="min-w-0 flex-1 truncate">{column.cell(row)}</span>
        {justSaved ? <Check className="size-3.5 shrink-0 text-success-fg" aria-hidden="true" /> : <Pencil className="size-3.5 shrink-0 opacity-0 group-hover:opacity-50 group-focus-visible:opacity-50" aria-hidden="true" />}
      </button>
    )
  }

  const errorLine = error && (
    <p id={errId} role="alert" className="mt-1 max-w-64 text-left text-xs leading-snug font-medium whitespace-normal text-danger-fg">
      {error}
    </p>
  )

  if (spec.kind === 'tags') {
    return <TagsEditor what={what} initial={spec.initial(row)} options={spec.options} saving={saving} error={errorLine} onCancel={() => close(true)} onSave={(v) => void commit(v, true)} />
  }

  if (spec.kind === 'select') {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <div className="relative">
          <select
            autoFocus
            aria-label={what}
            aria-invalid={!!error}
            aria-describedby={error ? errId : undefined}
            className="h-8 w-full min-w-32 rounded-md border border-primary bg-surface px-2 pr-7 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none aria-[invalid=true]:border-danger"
            value={text}
            aria-busy={saving || undefined}
            onChange={(e) => {
              setText(e.target.value)
              void commit(e.target.value, true)
            }}
            onBlur={() => !saving && !error && close(false)}
            onKeyDown={(e) => e.key === 'Escape' && close(true)}
          >
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {saving && <LoaderCircle className="absolute top-2 right-2 size-4 animate-spin text-muted" aria-hidden="true" />}
        </div>
        {errorLine}
      </div>
    )
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="relative">
        <input
          autoFocus
          aria-label={what}
          aria-invalid={!!error}
          aria-describedby={error ? errId : undefined}
          inputMode={spec.inputMode}
          className={cn('h-8 w-full min-w-24 rounded-md border border-primary bg-surface px-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none aria-[invalid=true]:border-danger', column.align === 'right' && 'text-right')}
          value={text}
          readOnly={saving}
          aria-busy={saving || undefined}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit(text, true)
            if (e.key === 'Escape') close(true)
          }}
          onBlur={() => void commit(text, false)}
        />
        {saving && <LoaderCircle className="absolute top-2 right-2 size-4 animate-spin text-muted" aria-hidden="true" />}
      </div>
      {errorLine}
    </div>
  )
}

/** Papéis declarados: várias opções de uma vez, num balão com "Salvar". */
function TagsEditor({ what, initial, options, saving, error, onCancel, onSave }: { what: string; initial: string[]; options: { value: string; label: string }[]; saving: boolean; error: ReactNode; onCancel: () => void; onSave: (v: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>(initial)
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Popover.Root open onOpenChange={(o) => !o && onCancel()}>
        <Popover.Anchor asChild>
          <span className="block truncate text-muted">{picked.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ') || 'Nenhum'}</span>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={6} className="z-50 w-60 rounded-xl border border-border bg-surface p-2 shadow-pop" aria-label={what}>
            <fieldset className="flex flex-col">
              <legend className="mb-1 px-1 text-xs font-semibold text-muted">{what}</legend>
              {options.map((o) => (
                <label key={o.value} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-2">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={picked.includes(o.value)} onChange={() => setPicked((cur) => (cur.includes(o.value) ? cur.filter((x) => x !== o.value) : [...cur, o.value]))} />
                  {o.label}
                </label>
              ))}
            </fieldset>
            {error}
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" onClick={onCancel}>
                Cancelar
              </Button>
              <Button size="sm" variant="primary" loading={saving} onClick={() => onSave(picked)}>
                Salvar
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
