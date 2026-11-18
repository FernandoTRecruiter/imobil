/* =============================================================================
   history.ts: a aba "Histórico" do imóvel, da unidade e da pessoa (lida da auditoria).

   A auditoria (audit_logs) guarda cada ação com quem fez e quando. O histórico de um
   registro junta as linhas dele com as do que pendura nele: o histórico da unidade mostra
   também a mudança de status do contrato e as baixas de pagamento daquela unidade.

   QUEM VÊ: só a equipe (admin e colaborador). audit_logs não tem regra em scope.ts; a matriz F
   do plano põe a auditoria do lado da administração, então portal não lê. Na fase 2 vira uma
   política de RLS do tipo "papel de equipe na organização da linha".
   ============================================================================= */
import type { Db } from '@/data/db'
import type { AuditAction, AuditLog, Id, IsoDateTime } from '@/data/types'

export interface HistoryEntry {
  id: string
  at: IsoDateTime
  who: string
  action: AuditAction
  summary: string
  changes: AuditLog['changes']
}

export interface HistoryRef {
  entity: string
  ids: Iterable<Id>
}

/** Limite de linhas: o histórico de um condomínio grande passaria de milhares (pagamento por pagamento). */
const MAX = 200

/**
 * Junta as linhas da auditoria dos registros pedidos, do mais novo para o mais velho.
 * "created" vira a linha do cadastro quando a auditoria não tem o "create" (os dados fictícios
 * já nascem prontos, sem esse registro): data e autor saem da própria linha (created_at e created_by).
 */
export function buildHistory(db: Db, orgId: Id, refs: HistoryRef[], created?: { entity: string; id: Id; at: IsoDateTime; by: Id | null; summary: string }): HistoryEntry[] {
  const wanted = new Map<string, Set<Id>>()
  for (const r of refs) {
    const set = wanted.get(r.entity) ?? new Set<Id>()
    for (const id of r.ids) set.add(id)
    wanted.set(r.entity, set)
  }
  const names = new Map(db.profiles.map((p) => [p.id, p.full_name]))
  const who = (id: Id | null) => (id ? (names.get(id) ?? 'Pessoa removida') : 'Sistema')
  const rows: HistoryEntry[] = db.audit_logs
    .filter((l) => l.organization_id === orgId && wanted.get(l.entity)?.has(l.entity_id))
    .map((l) => ({ id: l.id, at: l.at, who: who(l.actor_user_id), action: l.action, summary: l.summary, changes: l.changes }))
  if (created && !db.audit_logs.some((l) => l.entity === created.entity && l.entity_id === created.id && l.action === 'create')) {
    rows.push({ id: `criado-${created.id}`, at: created.at, who: who(created.by), action: 'create', summary: created.summary, changes: null })
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX)
}
