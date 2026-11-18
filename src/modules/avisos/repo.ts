/* =============================================================================
   Avisos (notificações dentro do sistema). Cada pessoa vê só os próprios avisos.
   Os avisos nascem das automações (contrato vencendo, orçamento aguardando...) com uma
   chave de duplicidade: a mesma regra, para o mesmo registro, no mesmo dia, gera um só.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { connect } from '@/data/api'
import { useRepo } from '@/data/hooks'
import { runList, type ListParams, type ListResult } from '@/data/query'
import { upsertRows } from '@/data/store'
import type { Notification } from '@/data/types'

function mine(s: Session, all: Notification[]): Notification[] {
  return all.filter((n) => n.organization_id === s.org.id && n.user_id === s.user.id && n.channel === 'in_app')
}

export async function listNotifications(s: Session, params: ListParams): Promise<ListResult<Notification>> {
  const { db } = await connect(s)
  return runList(mine(s, db.notifications), params, {
    search: (n) => [n.title, n.body],
    filters: { estado: (n) => (n.read_at ? 'lido' : 'nao_lido') },
    defaultSort: (a, b) => (a.created_at < b.created_at ? 1 : -1),
  })
}

export async function countUnread(s: Session): Promise<number> {
  const { db } = await connect(s)
  return mine(s, db.notifications).filter((n) => !n.read_at).length
}

/** Marca como lido (um, vários ou todos). Só os avisos da própria pessoa. */
export async function markRead(s: Session, ids: string[] | 'all'): Promise<number> {
  const { db } = await connect(s)
  const now = new Date().toISOString()
  const target = mine(s, db.notifications).filter((n) => !n.read_at && (ids === 'all' || ids.includes(n.id)))
  upsertRows('notifications', target.map((n) => ({ ...n, read_at: now })))
  return target.length
}

export function useUnreadCount(): number {
  return useRepo('avisos:nao-lidos', countUnread).data ?? 0
}
