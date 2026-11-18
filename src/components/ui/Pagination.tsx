import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button'

/** Paginação: a lista nunca carrega tudo de uma vez (na fase 2, é o LIMIT/OFFSET da consulta). */
export function Pagination({ page, pageSize, total, onPage, onPageSize }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= 10) return null
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Paginação">
      <label className="flex items-center gap-2 text-muted">
        Por página
        <select className="h-8 rounded-lg border border-border bg-surface px-2 text-text" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronLeft className="size-4" aria-hidden="true" />}>
          Anterior
        </Button>
        <span className="num text-muted">
          Página {page} de {pages}
        </span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Próxima
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}
