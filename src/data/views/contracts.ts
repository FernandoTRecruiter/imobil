/* =============================================================================
   views/contracts.ts: contratos e pessoas como as telas mostram.
   Usada por: Contratos, Imóveis (aba da unidade), Pessoas, Financeiro, Portal, Visão geral.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { addMonths, daysBetween } from '@/lib/dates'
import { AccessError, connect } from '../api'
import type { Db } from '../db'
import { runList, type ListParams, type ListResult } from '../query'
import { paidByEntry } from '../rules'
import { see, type Scope } from '../scope'
import type { Cents, Contract, ContractEvent, ContractParty, Id, IsoDate, Person, PersonTag } from '../types'
import { canSeeHousehold, clientSinceMap, contractTerm, monthsSince, punctualityMap, punctualityPct, renewalsOf } from './cliente'
import { joinNames, lesseeOf, lookup, unitLabel, type Lookup } from './lookup'

export interface ContractRow extends Contract {
  unit_code: string | null
  unit_label: string | null
  property_name: string
  lessee_id: Id | null
  lessee_name: string
  lessor_names: string
  guarantor_name: string | null
  /** Dias até o fim (negativo = já acabou). */
  days_to_end: number
  /** Soma do que está vencido e em aberto neste contrato. */
  overdue_cents: Cents
  /** Próximo aniversário de reajuste (só contrato vigente com índice). */
  next_adjustment: IsoDate | null
  /** Tempo de contrato em meses (views/cliente.ts): duração, quanto passou e quanto falta (só vigente). */
  duration_months: number
  elapsed_months: number
  remaining_months: number | null
  /** Quantas renovações vieram antes deste contrato. */
  renewals: number
  /** Pontualidade do locatário nos últimos 12 meses (%); null sem cobrança vencida ou fora do que a sessão pode ver. */
  lessee_punctuality_pct: number | null
}

function nextAdjustment(k: Contract, today: IsoDate): IsoDate | null {
  if (k.status !== 'active' || k.adjustment_index === 'none') return null
  for (let i = 1; i < 20; i++) {
    const d = addMonths(k.start_date, 12 * i)
    if (d > k.end_date) return null
    if (d >= today) return d
  }
  return null
}

/** Os três números do tempo de contrato com os nomes das colunas da linha. */
function termFields(k: Contract, today: IsoDate): Pick<ContractRow, 'duration_months' | 'elapsed_months' | 'remaining_months'> {
  const t = contractTerm(k, today)
  return { duration_months: t.duration, elapsed_months: t.elapsed, remaining_months: t.remaining }
}

export function toContractRows(db: Db, sc: Scope, today: IsoDate, L: Lookup = lookup(db)): ContractRow[] {
  const paid = paidByEntry(db.payments)
  // Relacionamento (views/cliente.ts): renovações pela corrente de contratos e pontualidade do locatário.
  const byId = new Map(db.contracts.map((k) => [k.id, k]))
  const punctual = punctualityMap(db, today)
  const overdue = new Map<Id, number>()
  for (const e of db.financial_entries) {
    if (!e.contract_id || e.status !== 'open' || e.direction !== 'receivable' || e.due_date >= today) continue
    overdue.set(e.contract_id, (overdue.get(e.contract_id) ?? 0) + e.amount_cents - (paid.get(e.id) ?? 0))
  }
  return db.contracts
    .filter((k) => see.contract(sc, k))
    .map((k) => {
      const parties = L.partiesByContract.get(k.id) ?? []
      const u = k.unit_id ? L.unit.get(k.unit_id) : undefined
      const lessee = lesseeOf(L, k.id)
      const name = (p: ContractParty) => L.person.get(p.person_id)?.name ?? 'Pessoa'
      const guarantor = parties.find((p) => p.role === 'guarantor')
      return {
        ...k,
        unit_code: u?.code ?? null, unit_label: u ? unitLabel(L, u) : null, property_name: L.property.get(k.property_id)?.name ?? '',
        lessee_id: lessee?.id ?? null, lessee_name: lessee?.name ?? '',
        lessor_names: joinNames(parties.filter((p) => p.role === 'lessor').map(name)),
        guarantor_name: guarantor ? name(guarantor) : null,
        days_to_end: daysBetween(today, k.end_date), overdue_cents: overdue.get(k.id) ?? 0, next_adjustment: nextAdjustment(k, today),
        ...termFields(k, today), renewals: renewalsOf(byId, k),
        // Pontualidade é dado da pessoa: no portal, só a do próprio locatário (canSeeHousehold).
        lessee_punctuality_pct: lessee && canSeeHousehold(sc, lessee.id) ? punctualityPct(punctual.get(lessee.id)) : null,
      }
    })
}

/**
 * Filtros: status, kind, index, guarantee, property, unit, ending ('30' | '60' | '90': vigentes que vencem nesse prazo).
 * Ordens: code, start_date, end_date, rent, lessee, overdue e (07/11/2026) term, renewals, punctuality.
 */
export async function listContracts(s: Session, params: ListParams): Promise<ListResult<ContractRow>> {
  const { db, sc } = await connect(s)
  const rows = toContractRows(db, sc, s.today)
  return runList(rows, params, {
    search: (r) => [r.code, r.unit_code, r.property_name, r.lessee_name, r.lessor_names],
    filters: {
      status: (r) => r.status, kind: (r) => r.kind, index: (r) => r.adjustment_index, guarantee: (r) => r.guarantee_type,
      property: (r) => r.property_id, unit: (r) => r.unit_id,
      ending: (r) => (r.status !== 'active' || r.days_to_end < 0 ? null : (['30', '60', '90'] as const).filter((d) => r.days_to_end <= Number(d))),
    },
    sorts: {
      code: (r) => r.code, start_date: (r) => r.start_date, end_date: (r) => r.end_date, rent: (r) => r.rent_cents, lessee: (r) => r.lessee_name, overdue: (r) => r.overdue_cents,
      term: (r) => r.elapsed_months, renewals: (r) => r.renewals, punctuality: (r) => r.lessee_punctuality_pct,
    },
    defaultSort: (a, b) => (a.start_date < b.start_date ? 1 : -1),
  })
}

export interface ContractDetail {
  contract: ContractRow
  parties: (ContractParty & { name: string; document: string; email: string; phone: string })[]
  events: (ContractEvent & { who: string })[]
}

export async function getContractDetail(s: Session, id: Id): Promise<ContractDetail> {
  const { db, sc } = await connect(s)
  const L = lookup(db)
  const contract = toContractRows(db, sc, s.today, L).find((k) => k.id === id)
  if (!contract) throw new AccessError('Contrato não encontrado ou fora do seu acesso.')
  const parties = (L.partiesByContract.get(id) ?? []).map((p) => {
    const person = L.person.get(p.person_id)
    return { ...p, name: person?.name ?? 'Pessoa', document: person?.document ?? '', email: person?.email ?? '', phone: person?.phone ?? '' }
  })
  const events = db.contract_events
    .filter((e) => e.contract_id === id)
    .sort((a, b) => (a.effective_date === b.effective_date ? (a.created_at < b.created_at ? 1 : -1) : a.effective_date < b.effective_date ? 1 : -1))
    .map((e) => ({ ...e, who: e.created_by ? (L.userName.get(e.created_by) ?? 'Sistema') : 'Sistema' }))
  return { contract, parties, events }
}

/* ---------------------------------------------------------------- pessoas */

export type PersonRole = 'owner' | 'lessee' | 'guarantor' | PersonTag

export interface PersonRow extends Person {
  /** Papéis: os que vêm das ligações (dono, locatário, fiador) + os declarados (prestador, síndico...). */
  roles: PersonRole[]
  units_owned: number
  active_leases: number
  overdue_cents: Cents
  /** Início do primeiro contrato com a conta, em qualquer papel (views/cliente.ts). */
  client_since: IsoDate | null
  /** Meses desde "cliente desde". */
  client_months: number | null
  /** % das cobranças dos últimos 12 meses pagas até o vencimento (null sem cobrança vencida). */
  punctuality_pct: number | null
}

export function toPersonRows(db: Db, sc: Scope, today: IsoDate): PersonRow[] {
  const owned = new Map<Id, Set<Id>>()
  for (const o of db.property_owners) {
    if (o.until && o.until < today) continue
    const set = owned.get(o.person_id) ?? new Set<Id>()
    if (o.unit_id) set.add(o.unit_id)
    else db.units.filter((u) => u.property_id === o.property_id).forEach((u) => set.add(u.id))
    owned.set(o.person_id, set)
  }
  const activeIds = new Set(db.contracts.filter((k) => k.kind === 'lease' && k.status === 'active').map((k) => k.id))
  const roles = new Map<Id, Set<PersonRole>>()
  const leases = new Map<Id, number>()
  for (const p of db.contract_parties) {
    const set = roles.get(p.person_id) ?? new Set<PersonRole>()
    if (p.role === 'lessee') set.add('lessee')
    if (p.role === 'guarantor') set.add('guarantor')
    roles.set(p.person_id, set)
    if (p.role === 'lessee' && activeIds.has(p.contract_id)) leases.set(p.person_id, (leases.get(p.person_id) ?? 0) + 1)
  }
  const paid = paidByEntry(db.payments)
  const overdue = new Map<Id, number>()
  for (const e of db.financial_entries) {
    if (!e.person_id || e.status !== 'open' || e.direction !== 'receivable' || e.due_date >= today) continue
    overdue.set(e.person_id, (overdue.get(e.person_id) ?? 0) + e.amount_cents - (paid.get(e.id) ?? 0))
  }
  // Equipe do prédio (property_staff ativa) também dá papel: o zelador ligado a um imóvel aparece como
  // zelador mesmo sem ninguém ter marcado o papel à mão (mesma lógica do "proprietário", que vem da ligação).
  const STAFF_TO_ROLE: Record<string, PersonRole> = { caretaker: 'caretaker', syndic: 'syndic', doorman: 'contact', cleaning: 'contact', security: 'contact', other: 'contact' }
  const staffRoles = new Map<Id, PersonRole[]>()
  for (const st of db.property_staff) if (st.active) staffRoles.set(st.person_id, [...(staffRoles.get(st.person_id) ?? []), STAFF_TO_ROLE[st.role]])
  const since = clientSinceMap(db, today)
  const punctual = punctualityMap(db, today)
  return db.people
    .filter((p) => see.person(sc, p))
    .map((p) => {
      const r = new Set<PersonRole>([...(roles.get(p.id) ?? []), ...p.tags, ...(staffRoles.get(p.id) ?? [])])
      if ((owned.get(p.id)?.size ?? 0) > 0) r.add('owner')
      // Moradia e relacionamento: no portal, só o da própria pessoa (LGPD, views/cliente.ts).
      const mine = canSeeHousehold(sc, p.id)
      const from = mine ? (since.get(p.id) ?? null) : null
      return {
        ...p, roles: [...r], units_owned: owned.get(p.id)?.size ?? 0, active_leases: leases.get(p.id) ?? 0, overdue_cents: overdue.get(p.id) ?? 0,
        dependents: mine ? (p.dependents ?? null) : null, pets: mine ? (p.pets ?? '') : '', vehicles: mine ? (p.vehicles ?? null) : null, occupation: mine ? (p.occupation ?? '') : '',
        client_since: from, client_months: monthsSince(from, today), punctuality_pct: mine ? punctualityPct(punctual.get(p.id)) : null,
      }
    })
}

/**
 * Filtros: role, kind, archived ('sim'/'nao'). Ordens: name, created_at, units_owned, overdue e, desde
 * 07/11/2026, client_since, punctuality, dependents e vehicles (colunas opcionais da tabela).
 */
export async function listPeople(s: Session, params: ListParams): Promise<ListResult<PersonRow>> {
  const { db, sc } = await connect(s)
  const rows = toPersonRows(db, sc, s.today)
  // Mesmo padrão das unidades: "não arquivadas" é filtro aplicado aqui, para a contagem de arquivadas aparecer.
  const asked = (params.filters?.archived ?? []).length > 0
  const effective = asked ? params : { ...params, filters: { ...params.filters, archived: ['nao'] } }
  const result = runList(rows, effective, {
    search: (r) => [r.name, r.document, r.email, r.phone],
    filters: { role: (r) => r.roles, kind: (r) => r.kind, archived: (r) => (r.deleted_at ? 'sim' : 'nao') },
    sorts: {
      name: (r) => r.name, created_at: (r) => r.created_at, units_owned: (r) => r.units_owned, overdue: (r) => r.overdue_cents,
      client_since: (r) => r.client_since, punctuality: (r) => r.punctuality_pct, dependents: (r) => r.dependents ?? null, vehicles: (r) => r.vehicles ?? null,
    },
    defaultSort: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
  })
  if (!asked) result.totalAll = rows.filter((r) => !r.deleted_at).length
  return result
}

export async function getPerson(s: Session, id: Id): Promise<PersonRow> {
  const { db, sc } = await connect(s)
  const p = toPersonRows(db, sc, s.today).find((r) => r.id === id)
  if (!p) throw new AccessError('Pessoa não encontrada ou fora do seu acesso.')
  return p
}
