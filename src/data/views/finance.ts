/* =============================================================================
   views/finance.ts: lançamentos e chamados de manutenção como as telas mostram.
   "Vencido", "em aberto" e "atrasado" saem daqui calculados com o "hoje" da sessão.
   Usada por: Financeiro, Contratos, Imóveis, Manutenção, Portal, Visão geral, Relatórios.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { AccessError, connect } from '../api'
import type { Db } from '../db'
import { runList, type ListConfig, type ListParams, type ListResult } from '../query'
import { daysOverdue, entryState, paidByEntry, type EntryState } from '../rules'
import { see, type Scope } from '../scope'
import type { Cents, FinancialEntry, Id, IsoDate, MaintenanceRequest } from '../types'
import { lookup, unitLabel, type Lookup } from './lookup'

export interface EntryRow extends FinancialEntry {
  state: EntryState
  paid_cents: Cents
  open_cents: Cents
  days_overdue: number
  last_paid_at: IsoDate | null
  unit_code: string | null
  unit_label: string | null
  property_name: string | null
  person_name: string | null
  contract_code: string | null
}

export function toEntryRows(db: Db, sc: Scope, today: IsoDate, L: Lookup = lookup(db)): EntryRow[] {
  const paid = paidByEntry(db.payments)
  const lastPaid = new Map<Id, IsoDate>()
  for (const p of db.payments) if (!lastPaid.has(p.entry_id) || lastPaid.get(p.entry_id)! < p.paid_at) lastPaid.set(p.entry_id, p.paid_at)
  return db.financial_entries
    .filter((e) => see.entry(sc, e))
    .map((e) => {
      const u = e.unit_id ? L.unit.get(e.unit_id) : undefined
      const pc = paid.get(e.id) ?? 0
      return {
        ...e, state: entryState(e, today), paid_cents: pc, open_cents: e.status === 'open' ? Math.max(0, e.amount_cents - pc) : 0,
        days_overdue: daysOverdue(e, today), last_paid_at: lastPaid.get(e.id) ?? null,
        unit_code: u?.code ?? null, unit_label: u ? unitLabel(L, u) : null,
        property_name: e.property_id ? (L.property.get(e.property_id)?.name ?? null) : null,
        person_name: e.person_id ? (L.person.get(e.person_id)?.name ?? null) : null,
        contract_code: e.contract_id ? (L.contract.get(e.contract_id)?.code ?? null) : null,
      }
    })
}

export interface EntryTotals {
  forecast: Cents // previsto: em aberto e ainda não venceu
  overdue: Cents // vencido: em aberto e já venceu (só o saldo que falta)
  received: Cents // recebido (a receber, pago)
  paid: Cents // pago (a pagar, pago)
  count: number
}

/**
 * Faixas de atraso (mesmas chaves das faixas de inadimplência da Visão geral) + "mais5", que se
 * sobrepõe às outras: uma cobrança com 20 dias está em "16-30" E em "mais5". O alerta "vencidas há
 * mais de 5 dias" abre a lista com "mais5" e mostra exatamente o número que anuncia.
 */
export const AGING_LABEL: Record<string, string> = {
  mais5: 'Há mais de 5 dias', '1-15': '1 a 15 dias', '16-30': '16 a 30 dias', '31-60': '31 a 60 dias', '60+': 'Mais de 60 dias',
}

function agingKeys(days: number): string[] | null {
  if (days <= 0) return null
  const bucket = days <= 15 ? '1-15' : days <= 30 ? '16-30' : days <= 60 ? '31-60' : '60+'
  return days > 5 ? ['mais5', bucket] : [bucket]
}

const ENTRY_CFG: ListConfig<EntryRow> = {
  search: (r) => [r.description, r.person_name, r.unit_code, r.property_name, r.contract_code],
  filters: {
    state: (r) => r.state, direction: (r) => r.direction, category: (r) => r.category, property: (r) => r.property_id,
    contract: (r) => r.contract_id, unit: (r) => r.unit_id, person: (r) => r.person_id, charged_to: (r) => r.charged_to,
    competence: (r) => r.competence.slice(0, 7), atraso: (r) => agingKeys(r.days_overdue),
  },
  sorts: { due_date: (r) => r.due_date, amount: (r) => r.amount_cents, competence: (r) => r.competence, days_overdue: (r) => r.days_overdue, person: (r) => r.person_name },
  defaultSort: (a, b) => (a.due_date < b.due_date ? 1 : -1),
}

/**
 * Filtros: state, direction, category, property, contract, unit, person, charged_to, competence ('AAAA-MM'),
 * atraso ('mais5' | '1-15' | '16-30' | '31-60' | '60+', ver AGING_LABEL).
 * Ordens: due_date, amount, competence, days_overdue, person. Devolve também os totais do recorte inteiro (não só da página).
 */
export async function listEntries(s: Session, params: ListParams): Promise<ListResult<EntryRow> & { totals: EntryTotals }> {
  const { db, sc } = await connect(s)
  const rows = toEntryRows(db, sc, s.today)
  const all = runList(rows, { ...params, page: 1, pageSize: Number.MAX_SAFE_INTEGER }, ENTRY_CFG).rows
  const totals: EntryTotals = { forecast: 0, overdue: 0, received: 0, paid: 0, count: all.length }
  for (const r of all) {
    if (r.state === 'forecast') totals.forecast += r.open_cents
    else if (r.state === 'overdue') totals.overdue += r.open_cents
    else if (r.state === 'received') totals.received += r.amount_cents
    else if (r.state === 'paid') totals.paid += r.amount_cents
  }
  return { ...runList(rows, params, ENTRY_CFG), totals }
}

/* ---------------------------------------------------------------- manutenção */

export interface MaintenanceRow extends MaintenanceRequest {
  unit_code: string
  unit_label: string
  property_name: string
  vendor_name: string | null
  requester_name: string | null
  assignee_name: string | null
  /** Passou do prazo e não foi concluído nem cancelado. */
  late: boolean
}

const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 } as const

export function toMaintenanceRows(db: Db, sc: Scope, today: IsoDate, L: Lookup = lookup(db)): MaintenanceRow[] {
  return db.maintenance_requests
    .filter((r) => see.maintenance(sc, r))
    .map((r) => {
      const u = r.unit_id ? L.unit.get(r.unit_id) : undefined
      const propertyName = L.property.get(r.property_id)?.name ?? ''
      return {
        ...r, unit_code: u?.code ?? (r.unit_id ? '' : 'Áreas comuns'), unit_label: u ? unitLabel(L, u) : r.unit_id ? '' : `${propertyName} · Áreas comuns`, property_name: propertyName,
        vendor_name: r.vendor_person_id ? (L.person.get(r.vendor_person_id)?.name ?? null) : null,
        requester_name: r.requester_person_id ? (L.person.get(r.requester_person_id)?.name ?? null) : null,
        assignee_name: r.assignee_user_id ? (L.userName.get(r.assignee_user_id) ?? null) : null,
        late: !!r.due_date && r.due_date < today && !['done', 'canceled'].includes(r.status),
      }
    })
}

/** Filtros: status, category, priority, property, unit, open ('aberto'/'fechado'), late ('sim'). Ordens: created_at, due_date, priority, quote. */
export async function listMaintenance(s: Session, params: ListParams): Promise<ListResult<MaintenanceRow>> {
  const { db, sc } = await connect(s)
  return runList(toMaintenanceRows(db, sc, s.today), params, {
    search: (r) => [r.code, r.title, r.unit_code, r.property_name, r.vendor_name, r.requester_name],
    filters: {
      status: (r) => r.status, category: (r) => r.category, priority: (r) => r.priority, property: (r) => r.property_id, unit: (r) => r.unit_id,
      open: (r) => (['done', 'canceled'].includes(r.status) ? 'fechado' : 'aberto'), late: (r) => (r.late ? 'sim' : null),
    },
    sorts: { created_at: (r) => r.created_at, due_date: (r) => r.due_date, priority: (r) => PRIORITY_RANK[r.priority], quote: (r) => r.quote_cents },
    defaultSort: (a, b) => (a.created_at < b.created_at ? 1 : -1),
  })
}

export async function getMaintenance(s: Session, id: Id): Promise<MaintenanceRow> {
  const { db, sc } = await connect(s)
  const r = toMaintenanceRows(db, sc, s.today).find((x) => x.id === id)
  if (!r) throw new AccessError('Chamado não encontrado ou fora do seu acesso.')
  return r
}
