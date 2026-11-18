/* =============================================================================
   session.ts: quem está usando agora, em qual organização e com quais papéis.

   No modo de demonstração não há login: o seletor "Ver como" escolhe a persona. Na fase 2
   a sessão vem do Supabase Auth (o mesmo objeto, montado a partir do usuário logado).
   ============================================================================= */
import { todayIn } from '@/lib/dates'
import type { Db } from '@/data/db'
import type { Id, IsoDate, Membership, Organization, Permission, Profile, Role } from '@/data/types'

export interface Session {
  user: Profile
  org: Organization
  /** Os vínculos desta pessoa NESTA organização (pode ter mais de um papel: dono de um imóvel e inquilino de outro). */
  memberships: Membership[]
  roles: Role[]
  personId: Id | null
  permissions: Set<Permission>
  /** Organizações às quais o usuário pertence (para trocar de conta). */
  orgs: Organization[]
  /** "Hoje" no fuso da organização: é com ele que se decide o que está vencido. */
  today: IsoDate
}

export function buildSession(db: Db, userId: Id, orgId?: Id): Session | null {
  const user = db.profiles.find((p) => p.id === userId)
  if (!user) return null
  const mine = db.memberships.filter((m) => m.user_id === userId && m.status === 'active')
  const orgs = db.organizations.filter((o) => mine.some((m) => m.organization_id === o.id))
  const org = orgs.find((o) => o.id === orgId) ?? orgs[0]
  if (!org) return null
  const memberships = mine.filter((m) => m.organization_id === org.id)
  return {
    user,
    org,
    memberships,
    roles: [...new Set(memberships.map((m) => m.role))],
    personId: memberships.find((m) => m.person_id)?.person_id ?? null,
    permissions: new Set(memberships.flatMap((m) => m.permissions)),
    orgs,
    today: todayIn(org.timezone),
  }
}
