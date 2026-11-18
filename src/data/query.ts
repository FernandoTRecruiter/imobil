/* =============================================================================
   query.ts: buscar, filtrar, ordenar e paginar uma lista, do jeito que o banco fará.

   Por que no "servidor" e não na tabela da tela: com milhares de linhas, a tela não pode
   carregar tudo. Na fase 2 isto vira o WHERE / ORDER BY / LIMIT da consulta; hoje roda
   em memória com o MESMO contrato (parâmetros de entrada e formato de saída).

   Contagem de filtro (QoL da casa): o número ao lado de cada opção é calculado com a busca
   e TODOS OS OUTROS filtros aplicados, menos o próprio. Assim o número é exatamente o que
   aparece ao ligar a opção.
   ============================================================================= */
import { matchesSearch } from '@/lib/text'

export type SortDir = 'asc' | 'desc'

export interface ListParams {
  search?: string
  /** campo -> valores aceitos (vazio = sem filtro). Valores de um campo somam (OU); campos diferentes cortam (E). */
  filters?: Record<string, string[]>
  sort?: { key: string; dir: SortDir } | null
  page?: number // começa em 1
  pageSize?: number
}

export interface ListResult<T> {
  rows: T[]
  /** Linhas depois da busca e dos filtros (antes de paginar). */
  total: number
  /** Linhas que a sessão enxerga, sem busca nem filtro (o "M" de "N de M"). */
  totalAll: number
  /** campo -> valor -> quantas linhas. */
  facets: Record<string, Record<string, number>>
  page: number
  pageSize: number
}

export interface ListConfig<T> {
  search: (r: T) => (string | number | null | undefined)[]
  /** Um valor (ou vários) por linha para cada filtro. */
  filters?: Record<string, (r: T) => string | string[] | null>
  sorts?: Record<string, (r: T) => string | number | null>
  /** Ordem quando nenhuma coluna está ligada (a "ordem declarada" do QoL). */
  defaultSort?: (a: T, b: T) => number
}

function valuesOf(v: string | string[] | null): string[] {
  return v === null ? [] : Array.isArray(v) ? v : [v]
}

export function runList<T>(all: T[], params: ListParams, cfg: ListConfig<T>): ListResult<T> {
  const filters = Object.entries(params.filters ?? {}).filter(([, vals]) => vals.length > 0)
  const searched = params.search ? all.filter((r) => matchesSearch(params.search!, cfg.search(r))) : all
  const passes = (r: T, skip?: string) =>
    filters.every(([key, vals]) => key === skip || !cfg.filters?.[key] || valuesOf(cfg.filters[key](r)).some((v) => vals.includes(v)))

  const facets: Record<string, Record<string, number>> = {}
  for (const key of Object.keys(cfg.filters ?? {})) {
    const counts: Record<string, number> = {}
    for (const r of searched) {
      if (!passes(r, key)) continue
      for (const v of valuesOf(cfg.filters![key](r))) counts[v] = (counts[v] ?? 0) + 1
    }
    facets[key] = counts
  }

  let rows = searched.filter((r) => passes(r))
  const sortFn = params.sort && cfg.sorts?.[params.sort.key]
  if (sortFn) {
    const dir = params.sort!.dir === 'asc' ? 1 : -1
    rows = [...rows].sort((a, b) => {
      const va = sortFn(a)
      const vb = sortFn(b)
      // Vazio sempre no fim, nos dois sentidos (regra da casa).
      if (va === null || va === '') return vb === null || vb === '' ? 0 : 1
      if (vb === null || vb === '') return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * dir
    })
  } else if (cfg.defaultSort) {
    rows = [...rows].sort(cfg.defaultSort)
  }

  const pageSize = params.pageSize ?? 25
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(Math.max(1, params.page ?? 1), pages)
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, totalAll: all.length, facets, page, pageSize }
}
