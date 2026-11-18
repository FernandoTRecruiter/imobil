/* =============================================================================
   rules.ts: regras de negócio que valem para TODA tela (e que o banco vai repetir).
   Cada função aqui responde uma pergunta só, com o fato que decide.
   ============================================================================= */
import { daysBetween } from '@/lib/dates'
import type { Db } from './db'
import type { Contract, ContractStatus, FinancialEntry, Id, IsoDate, Payment, Unit, UnitStatus } from './types'

/** Locação que ocupa a unidade numa data: vigente e com a data dentro do período. */
export function leaseCovers(k: Contract, date: IsoDate): boolean {
  return k.kind === 'lease' && k.status === 'active' && k.start_date <= date && date <= k.end_date
}

/** Unidades ocupadas numa data (o FATO que decide "ocupada", no lugar de um campo manual). */
export function occupiedUnitIds(db: Db, date: IsoDate): Set<Id> {
  return new Set(db.contracts.filter((k) => leaseCovers(k, date) && k.unit_id).map((k) => k.unit_id!))
}

/** Situação que a tela mostra: ocupada se há locação vigente; se não, a escolhida à mão. */
export function effectiveUnitStatus(u: Unit, occupied: Set<Id>): UnitStatus {
  return occupied.has(u.id) ? 'occupied' : u.manual_status
}

/** Quanto já foi pago de cada lançamento. */
export function paidByEntry(payments: Payment[]): Map<Id, number> {
  const m = new Map<Id, number>()
  for (const p of payments) m.set(p.entry_id, (m.get(p.entry_id) ?? 0) + p.amount_cents)
  return m
}

export type EntryState = 'forecast' | 'overdue' | 'received' | 'paid' | 'canceled'

/**
 * Previsto, vencido, recebido ou pago. "Vencido" nunca é gravado: é aberto + vencimento antes
 * de hoje (no fuso da organização). Gravado, ele ficaria velho no dia seguinte.
 */
export function entryState(e: FinancialEntry, today: IsoDate): EntryState {
  if (e.status === 'canceled') return 'canceled'
  if (e.status === 'paid') return e.direction === 'receivable' ? 'received' : 'paid'
  return e.due_date < today ? 'overdue' : 'forecast'
}

export function daysOverdue(e: FinancialEntry, today: IsoDate): number {
  return e.status === 'open' && e.due_date < today ? daysBetween(e.due_date, today) : 0
}

/**
 * Transições permitidas do contrato. Qualquer outra é recusada (no banco, por função).
 * Por que lista explícita: "encerrado" voltar para "vigente" apagaria a história.
 */
export const CONTRACT_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['in_review', 'terminated'],
  in_review: ['draft', 'awaiting_approval', 'terminated'],
  awaiting_approval: ['in_review', 'awaiting_signature', 'terminated'],
  awaiting_signature: ['active', 'in_review', 'terminated'],
  active: ['ended', 'terminated'],
  ended: [],
  terminated: [],
}

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to)
}

/** Duas locações da mesma unidade se cruzam? (a trava EXCLUDE do banco, em JavaScript). */
export function leasesOverlap(a: Pick<Contract, 'start_date' | 'end_date'>, b: Pick<Contract, 'start_date' | 'end_date'>): boolean {
  return a.start_date <= b.end_date && b.start_date <= a.end_date
}

/** Status que "seguram" a unidade no período (rascunho e encerrado não seguram). */
export const HOLDING_STATUSES: ContractStatus[] = ['awaiting_signature', 'active']
