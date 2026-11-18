/* =============================================================================
   useListState: o estado de uma lista (busca, filtros, ordem, página) num lugar só.

   Ordenação pelo cabeçalho, regra da casa:
     1º clique: maior ou mais novo primeiro (número e data) ou A→Z (texto);
     2º clique: inverte;
     3º clique: volta à ordem declarada da tela.
   Filtros, ordem e tamanho da página ficam lembrados no navegador; a busca não
   (voltar e achar a lista "sumida" por causa de uma busca velha confunde).
   ============================================================================= */
import { useEffect, useMemo, useState } from 'react'
import type { ListParams, SortDir } from '@/data/query'
import { readJSON, writeJSON } from './storage'

interface Remembered {
  filters: Record<string, string[]>
  sort: { key: string; dir: SortDir } | null
  pageSize: number
}

export function useListState(storageKey: string, initial: Partial<Remembered> = {}) {
  const [remembered, setRemembered] = useState<Remembered>(() => ({
    filters: {},
    sort: null,
    pageSize: 25,
    ...initial,
    ...(readJSON<Remembered>(`imobil:list:${storageKey}`) ?? {}),
  }))
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  // A busca espera 200 ms depois da última tecla: na fase 2 isso poupa uma consulta por letra.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 200)
    return () => clearTimeout(t)
  }, [searchInput])

  const save = (next: Remembered) => {
    setRemembered(next)
    writeJSON(`imobil:list:${storageKey}`, next)
    setPage(1)
  }

  const params: ListParams = useMemo(
    () => ({ search, filters: remembered.filters, sort: remembered.sort, page, pageSize: remembered.pageSize }),
    [search, remembered, page],
  )

  return {
    params,
    searchInput,
    setSearchInput,
    filters: remembered.filters,
    sort: remembered.sort,
    page,
    setPage,
    pageSize: remembered.pageSize,
    setPageSize: (n: number) => save({ ...remembered, pageSize: n }),
    setFilter: (key: string, values: string[]) => save({ ...remembered, filters: { ...remembered.filters, [key]: values } }),
    /** Troca TODOS os filtros de uma vez (ex.: clicar num indicador mostra só o que ele conta). */
    replaceFilters: (filters: Record<string, string[]>) => save({ ...remembered, filters }),
    toggleFilterValue: (key: string, value: string) => {
      const cur = remembered.filters[key] ?? []
      save({ ...remembered, filters: { ...remembered.filters, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } })
    },
    clearFilters: () => {
      setSearchInput('')
      save({ ...remembered, filters: {} })
    },
    activeFilterCount: Object.values(remembered.filters).reduce((a, v) => a + v.length, 0) + (search ? 1 : 0),
    toggleSort: (key: string, firstDir: SortDir) => {
      const cur = remembered.sort
      let next: Remembered['sort']
      if (!cur || cur.key !== key) next = { key, dir: firstDir }
      else if (cur.dir === firstDir) next = { key, dir: firstDir === 'asc' ? 'desc' : 'asc' }
      else next = null
      save({ ...remembered, sort: next })
    },
  }
}

export type ListState = ReturnType<typeof useListState>
