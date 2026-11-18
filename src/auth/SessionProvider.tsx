/* =============================================================================
   SessionProvider: guarda a persona escolhida no "Ver como" e entrega a sessão às telas.
   Na fase 2 a escolha some: a sessão vem do login do Supabase.
   ============================================================================= */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { applyAppearance } from '@/data/appearance'
import { getDb, resetDb } from '@/data/store'
import { USER } from '@/data/seed'
import type { Id } from '@/data/types'
import { readJSON, writeJSON } from '@/lib/storage'
import { buildSession, type Session } from './session'

const KEY = 'imobil:persona'

interface SessionApi {
  session: Session
  setPersona: (userId: Id, orgId?: Id) => void
  resetDemo: () => void
}

const Ctx = createContext<SessionApi | null>(null)

/** Aplica a aparência (cores e rótulos) da organização desta escolha de persona. */
function applySelectionAppearance(sel: { userId: Id; orgId?: Id }): void {
  const db = getDb()
  const s = buildSession(db, sel.userId, sel.orgId) ?? buildSession(db, USER.admin)
  if (s) applyAppearance(db, s.org.id)
}

/** Na abertura do app (main.tsx), antes do primeiro desenho: a aparência da persona guardada. */
export function applyStartupAppearance(): void {
  applySelectionAppearance(readJSON<{ userId: Id; orgId?: Id }>(KEY) ?? { userId: USER.admin })
}

/**
 * Os filtros lembrados (useListState) ficam no navegador. Ao trocar de pessoa ou de conta eles são
 * apagados: senão o filtro que a Ana deixou ligado (com ids de imóveis dela) apareceria para o Carlos.
 */
function clearRememberedLists(): void {
  try {
    const ls = globalThis.localStorage
    if (!ls) return
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i)
      if (k?.startsWith('imobil:list:')) ls.removeItem(k)
    }
  } catch {
    /* sem armazenamento: nada a limpar */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [sel, setSel] = useState<{ userId: Id; orgId?: Id }>(() => readJSON(KEY) ?? { userId: USER.admin })
  const [version, setVersion] = useState(0)

  const session = useMemo(() => {
    void version // muda quando os dados são restaurados, para a sessão ser montada de novo
    const db = getDb()
    return buildSession(db, sel.userId, sel.orgId) ?? buildSession(db, USER.admin)!
  }, [sel, version])

  const api: SessionApi = {
    session,
    setPersona: (userId, orgId) => {
      const next = { userId, orgId }
      if (userId !== sel.userId || orgId !== sel.orgId) clearRememberedLists()
      applySelectionAppearance(next) // cores e rótulos da conta nova antes do próximo desenho
      setSel(next)
      writeJSON(KEY, next)
    },
    resetDemo: () => {
      resetDb()
      qc.clear() // nada do cache antigo pode aparecer depois de restaurar
      applySelectionAppearance(sel)
      setVersion((v) => v + 1)
    },
  }
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useSessionApi(): SessionApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('useSessionApi precisa do SessionProvider')
  return api
}

export function useSession(): Session {
  return useSessionApi().session
}
