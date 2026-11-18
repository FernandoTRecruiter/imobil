/* =============================================================================
   reports.ts: as contas dos Relatórios, puras (sem React e sem banco).

   As fórmulas que também aparecem na Visão geral NÃO são reescritas aqui: vêm de
   visao-geral/metrics.ts (receita, inadimplência, faixas de atraso, ocupação). Assim o
   relatório de inadimplência e o indicador da Visão geral dão o mesmo número.

   Entrada: as linhas das views (unidades, contratos, lançamentos, chamados), já cortadas
   pelo escopo no repo.ts, mais os repasses. Saída: uma estrutura por aba.
   ============================================================================= */
import { ENTRY_CATEGORY, MAINTENANCE_CATEGORY, MAINTENANCE_STATUS, UNIT_KIND } from '@/data/labels'
import type { Cents, ContractStatus, EntryCategory, EntryDirection, Id, IsoDate, MaintenanceCategory, MaintenanceStatus, UnitStatus } from '@/data/types'
import type { ContractRow } from '@/data/views/contracts'
import type { EntryRow, MaintenanceRow } from '@/data/views/finance'
import { isSpot, type UnitRow } from '@/data/views/units'
import { addMonths, daysBetween, monthStart } from '@/lib/dates'
import { applyPct } from '@/lib/money'
import {
  agingOf, coveredAt, coversToday, inPeriod, isExpense, isOverdue, isRevenue, monthEnd, NONE, occupancyOf, openOf, payablesOf, periodOf,
  revenueOf, settledOf, type AgingRow, type FilterOption, type Occupancy, type Payables, type Period, type PeriodKey, type Revenue,
} from '@/modules/visao-geral/metrics'

/* ---------------------------------------------------------------- 1. Entrada e filtros */

export interface TransferRow {
  id: Id
  owner_person_id: Id
  owner_name: string
  month: IsoDate
  gross_cents: Cents
  admin_fee_cents: Cents
  expenses_cents: Cents
  net_cents: Cents
  status: 'draft' | 'approved' | 'paid'
}

export interface ReportInput {
  today: IsoDate
  units: UnitRow[]
  /** Data de cadastro de cada unidade (para o histórico não contar unidade que ainda não existia). */
  unitCreated: Map<Id, IsoDate>
  portfolioName: Map<Id, string>
  contracts: ContractRow[]
  entries: EntryRow[]
  maintenance: MaintenanceRow[]
  transfers: TransferRow[]
}

export interface ReportFilters {
  period: PeriodKey
  /** '' = todos. Carteira aceita NONE ("sem carteira"). */
  property: string
  portfolio: string
  owner: string
}

/** Relatório olha para trás: padrão de 12 meses (a Visão geral usa 3). */
export const DEFAULT_REPORT_FILTERS: ReportFilters = { period: '12', property: '', portfolio: '', owner: '' }

function unitPasses(u: UnitRow, f: ReportFilters, skip?: keyof ReportFilters): boolean {
  return (
    (skip === 'property' || !f.property || u.property_id === f.property) &&
    (skip === 'portfolio' || !f.portfolio || (f.portfolio === NONE ? u.portfolio_id === null : u.portfolio_id === f.portfolio)) &&
    (skip === 'owner' || !f.owner || u.owners.some((o) => o.person_id === f.owner))
  )
}

/**
 * Corta tudo pelo recorte escolhido. Passo a passo:
 * 1. unidades que passam no imóvel, na carteira e no proprietário;
 * 2. contrato, chamado e lançamento COM unidade: entram se a unidade entrou;
 * 3. lançamento só com imóvel: entra se o imóvel entrou (e não há filtro de proprietário,
 *    que não sabe dizer de quem é a despesa do imóvel inteiro);
 * 4. lançamento sem imóvel (repasse, taxa de administração): sem filtro de imóvel ou carteira;
 *    com filtro de proprietário, só os dele;
 * 5. repasses: só o filtro de proprietário vale (repasse é por proprietário, não por imóvel).
 */
export function applyReportFilters(input: ReportInput, f: ReportFilters): ReportInput {
  if (!f.property && !f.portfolio && !f.owner) return input
  const units = input.units.filter((u) => unitPasses(u, f))
  const unitIds = new Set(units.map((u) => u.id))
  const props = new Set(units.map((u) => u.property_id))
  const placeFilter = !!(f.property || f.portfolio)
  return {
    ...input,
    units,
    contracts: input.contracts.filter((k) => (k.unit_id ? unitIds.has(k.unit_id) : props.has(k.property_id) && !f.owner)),
    maintenance: input.maintenance.filter((r) => (r.unit_id ? unitIds.has(r.unit_id) : props.has(r.property_id) && !f.owner)),
    entries: input.entries.filter((e) => {
      if (e.unit_id) return unitIds.has(e.unit_id)
      if (e.property_id) return props.has(e.property_id) && !f.owner
      return !placeFilter && (!f.owner || e.person_id === f.owner)
    }),
    transfers: f.owner ? input.transfers.filter((t) => t.owner_person_id === f.owner) : input.transfers,
  }
}

export interface ReportOptions {
  properties: FilterOption[]
  portfolios: FilterOption[]
  owners: FilterOption[]
}

/**
 * Opções com a contagem de unidades recontada pelos OUTROS filtros (a mesma regra da Visão geral).
 * A contagem é de casa, apartamento e sala (o número que a Ocupação mostra ao ligar a opção); a vaga
 * de garagem não soma, mas o dono que só tem vaga (o condomínio) continua na lista, com 0.
 */
export function reportOptions(input: ReportInput, f: ReportFilters): ReportOptions {
  const tally = (skip: keyof ReportFilters, pairs: (u: UnitRow) => { value: string; label: string }[]) => {
    const seen = new Map<string, FilterOption>()
    for (const u of input.units) {
      const ok = unitPasses(u, f, skip) && !isSpot(u)
      for (const p of pairs(u)) {
        if (!seen.has(p.value)) seen.set(p.value, { ...p, count: 0 })
        if (ok) seen.get(p.value)!.count++
      }
    }
    return [...seen.values()].sort((a, b) => (a.value === NONE ? 1 : b.value === NONE ? -1 : a.label.localeCompare(b.label, 'pt-BR')))
  }
  return {
    properties: tally('property', (u) => [{ value: u.property_id, label: u.property_name }]),
    portfolios: tally('portfolio', (u) => [u.portfolio_id ? { value: u.portfolio_id, label: input.portfolioName.get(u.portfolio_id) ?? 'Carteira' } : { value: NONE, label: 'Sem carteira' }]),
    owners: tally('owner', (u) => u.owners.map((o) => ({ value: o.person_id, label: o.name }))),
  }
}

/* ---------------------------------------------------------------- 2. Ocupação e vacância */

export interface OccupancyRow extends Occupancy {
  key: string
  label: string
}

export interface HistoryPoint {
  month: IsoDate
  /** A data medida: o último dia do mês; no mês atual, hoje (o fim do mês ainda não chegou). */
  date: IsoDate
  rentable: number
  occupied: number
  rate: number | null
}

export interface OccupancyReport {
  now: Occupancy
  byProperty: OccupancyRow[]
  byKind: OccupancyRow[]
  history: HistoryPoint[]
}

function groupOccupancy(units: UnitRow[], key: (u: UnitRow) => string, label: (u: UnitRow) => string): OccupancyRow[] {
  const groups = new Map<string, { label: string; list: UnitStatus[] }>()
  for (const u of units) {
    const g = groups.get(key(u)) ?? { label: label(u), list: [] }
    g.list.push(u.status)
    groups.set(key(u), g)
  }
  return [...groups.entries()]
    .map(([k, g]) => ({ key: k, label: g.label, ...occupancyOf(g.list) }))
    .sort((a, b) => b.units - a.units || a.label.localeCompare(b.label, 'pt-BR'))
}

/**
 * Ocupação hoje (u.status já vem de rules.ts) e o histórico de 12 meses, medido no último
 * dia de cada mês a partir das locações. Em cada data: ocupada = havia locação valendo;
 * alugável = ocupada ou não bloqueada. O bloqueio é o de HOJE (o sistema não guarda a
 * história do bloqueio manual), e unidade cadastrada depois da data não conta.
 * Vaga de garagem fica de fora: a ocupação fala de casa, apartamento e sala (a vaga não é moradia).
 */
export function occupancyReport(input: ReportInput): OccupancyReport {
  const { contracts, today } = input
  const units = input.units.filter((u) => !isSpot(u))
  const leases = contracts.filter((k) => k.kind === 'lease' && k.unit_id)
  const current = monthStart(today)
  const history = Array.from({ length: 12 }, (_, i) => {
    const month = addMonths(current, i - 11)
    const date = i === 11 ? today : monthEnd(month)
    const covers = i === 11 ? coversToday : coveredAt
    const occupiedIds = new Set(leases.filter((k) => covers(k, date)).map((k) => k.unit_id!))
    let rentable = 0
    let occupied = 0
    for (const u of units) {
      if ((input.unitCreated.get(u.id) ?? '0000-01-01') > date) continue
      const occ = occupiedIds.has(u.id)
      if (occ) occupied++
      if (occ || u.manual_status !== 'blocked') rentable++
    }
    return { month, date, rentable, occupied, rate: rentable ? occupied / rentable : null }
  })
  return {
    now: occupancyOf(units.map((u) => u.status)),
    byProperty: groupOccupancy(units, (u) => u.property_id, (u) => u.property_name),
    byKind: groupOccupancy(units, (u) => u.kind, (u) => UNIT_KIND[u.kind]),
    history,
  }
}

/* ---------------------------------------------------------------- 3. Inadimplência */

export interface LesseeRow {
  key: string
  name: string
  count: number
  cents: Cents
  oldestDays: number
  contracts: string
}

export interface OverdueRow {
  id: Id
  person: string
  unit: string
  contract: string
  competence: IsoDate
  due_date: IsoDate
  days: number
  open_cents: Cents
}

export interface DelinquencyReport {
  revenue: Revenue
  aging: AgingRow[]
  byLessee: LesseeRow[]
  list: OverdueRow[]
}

/** Mesmo recorte do indicador da Visão geral: cobranças das locações, vencimento no período, vencidas e com saldo. */
export function delinquencyReport(input: ReportInput, p: Period): DelinquencyReport {
  const overdue = input.entries.filter((e) => isRevenue(e) && isOverdue(e, input.today) && inPeriod(e.due_date, p) && openOf(e) > 0)
  const list: OverdueRow[] = overdue
    .map((e) => ({
      id: e.id, person: e.person_name ?? 'Sem pessoa', unit: e.unit_label ?? e.property_name ?? '', contract: e.contract_code ?? '',
      competence: e.competence, due_date: e.due_date, days: daysBetween(e.due_date, input.today), open_cents: openOf(e),
    }))
    .sort((a, b) => b.days - a.days || b.open_cents - a.open_cents)
  const groups = new Map<string, LesseeRow & { codes: Set<string> }>()
  for (const e of overdue) {
    const key = e.person_id ?? NONE
    const g = groups.get(key) ?? { key, name: e.person_name ?? 'Sem pessoa', count: 0, cents: 0, oldestDays: 0, contracts: '', codes: new Set<string>() }
    g.count++
    g.cents += openOf(e)
    g.oldestDays = Math.max(g.oldestDays, daysBetween(e.due_date, input.today))
    if (e.contract_code) g.codes.add(e.contract_code)
    groups.set(key, g)
  }
  const byLessee = [...groups.values()]
    .map(({ codes, ...g }) => ({ ...g, contracts: [...codes].sort().join(', ') }))
    .sort((a, b) => b.cents - a.cents)
  return { revenue: revenueOf(input.entries, p, input.today), aging: agingOf(input.entries, p, input.today), byLessee, list }
}

/* ---------------------------------------------------------------- 4. Receitas e despesas */

export interface CashMonth {
  month: IsoDate
  forecast: Cents
  received: Cents
  expenses: Cents
  paid: Cents
  /** Saldo do mês = recebida - despesas pagas (o que de fato entrou menos o que saiu). */
  balance: Cents
}

export interface CategoryRow {
  key: string
  direction: EntryDirection
  category: EntryCategory
  label: string
  /** Entra na conta de receita (ou despesa) da carteira? Taxa, repasse e caução, não. */
  counts: boolean
  forecast: Cents
  settled: Cents
  open: Cents
}

export interface CashReport {
  revenue: Revenue
  expenses: Payables
  byMonth: CashMonth[]
  byCategory: CategoryRow[]
}

export function cashReport(input: ReportInput, p: Period): CashReport {
  const byMonth = p.months.map((month) => {
    const range = { first: month, last: monthEnd(month) }
    const r = revenueOf(input.entries, range, input.today)
    const x = payablesOf(input.entries, range, isExpense)
    return { month, forecast: r.forecast, received: r.received, expenses: x.total, paid: x.paid, balance: r.received - x.paid }
  })
  const groups = new Map<string, CategoryRow>()
  for (const e of input.entries) {
    if (e.status === 'canceled' || !inPeriod(e.due_date, p)) continue
    const key = `${e.direction}:${e.category}`
    const g = groups.get(key) ?? {
      key, direction: e.direction, category: e.category, label: ENTRY_CATEGORY[e.category],
      counts: e.direction === 'receivable' ? isRevenue(e) : isExpense(e), forecast: 0, settled: 0, open: 0,
    }
    g.forecast += e.amount_cents
    g.settled += settledOf(e)
    g.open += openOf(e)
    groups.set(key, g)
  }
  const byCategory = [...groups.values()].sort((a, b) => (a.direction === b.direction ? b.forecast - a.forecast : a.direction === 'receivable' ? -1 : 1))
  return { revenue: revenueOf(input.entries, p, input.today), expenses: payablesOf(input.entries, p, isExpense), byMonth, byCategory }
}

/* ---------------------------------------------------------------- 5. Repasses */

export interface TransferTotals {
  gross: Cents
  fee: Cents
  expenses: Cents
  net: Cents
  count: number
  paid: number
}

export interface OwnerTransferRow extends TransferTotals {
  key: Id
  owner: string
  months: number
}

export interface MonthTransferRow extends TransferTotals {
  month: IsoDate
  owners: number
}

export interface TransfersReport {
  totals: TransferTotals
  byOwner: OwnerTransferRow[]
  byMonth: MonthTransferRow[]
}

function addTransfer(t: TransferTotals, r: TransferRow): void {
  t.gross += r.gross_cents
  t.fee += r.admin_fee_cents
  t.expenses += r.expenses_cents
  t.net += r.net_cents
  t.count++
  if (r.status === 'paid') t.paid++
}

const zeroTotals = (): TransferTotals => ({ gross: 0, fee: 0, expenses: 0, net: 0, count: 0, paid: 0 })

/** Repasses por proprietário e por mês, dos meses do período (líquido = bruto - taxa - despesas). */
export function transfersReport(input: ReportInput, p: Period): TransfersReport {
  const rows = input.transfers.filter((t) => p.months.includes(monthStart(t.month)))
  const totals = zeroTotals()
  const owners = new Map<Id, OwnerTransferRow>()
  const months = new Map<IsoDate, MonthTransferRow & { ids: Set<Id> }>()
  for (const r of rows) {
    addTransfer(totals, r)
    const o = owners.get(r.owner_person_id) ?? { key: r.owner_person_id, owner: r.owner_name, months: 0, ...zeroTotals() }
    addTransfer(o, r)
    o.months++
    owners.set(r.owner_person_id, o)
    const m = months.get(r.month) ?? { month: r.month, owners: 0, ids: new Set<Id>(), ...zeroTotals() }
    addTransfer(m, r)
    m.ids.add(r.owner_person_id)
    m.owners = m.ids.size
    months.set(r.month, m)
  }
  return {
    totals,
    byOwner: [...owners.values()].sort((a, b) => b.net - a.net),
    byMonth: [...months.values()]
      .map((m) => ({ month: m.month, owners: m.owners, gross: m.gross, fee: m.fee, expenses: m.expenses, net: m.net, count: m.count, paid: m.paid }))
      .sort((a, b) => (a.month < b.month ? -1 : 1)),
  }
}

/* ---------------------------------------------------------------- 6. Manutenção */

export interface MaintenanceCategoryRow {
  key: MaintenanceCategory
  label: string
  opened: number
  closed: number
  stillOpen: number
  avgDays: number | null
  cost: Cents
}

export interface MaintenanceReport {
  /** Abertos no período. */
  opened: number
  /** Concluídos no período. */
  closed: number
  /** Prazo médio de solução: média de dias da abertura à conclusão, dos concluídos no período. */
  avgDays: number | null
  /** Custo: soma dos orçamentos aprovados dos concluídos no período. */
  cost: Cents
  byCategory: MaintenanceCategoryRow[]
  byStatus: { key: MaintenanceStatus; label: string; count: number }[]
  costByProperty: { key: Id; property: string; closed: number; cost: Cents }[]
}

const CLOSED: MaintenanceStatus[] = ['done', 'canceled']

export function maintenanceReport(input: ReportInput, p: Period): MaintenanceReport {
  const opened = input.maintenance.filter((r) => inPeriod(r.created_at.slice(0, 10), p))
  const closed = input.maintenance.filter((r) => r.status === 'done' && !!r.closed_at && inPeriod(r.closed_at.slice(0, 10), p))
  const days = (r: MaintenanceRow) => daysBetween(r.created_at.slice(0, 10), r.closed_at!.slice(0, 10))
  const avg = (list: MaintenanceRow[]) => (list.length ? Math.round((list.reduce((a, r) => a + days(r), 0) / list.length) * 10) / 10 : null)
  const cost = (list: MaintenanceRow[]) => list.reduce((a, r) => a + (r.quote_status === 'approved' ? (r.quote_cents ?? 0) : 0), 0)

  const categories = [...new Set([...opened, ...closed].map((r) => r.category))]
  const byCategory = categories
    .map((c) => {
      const o = opened.filter((r) => r.category === c)
      const done = closed.filter((r) => r.category === c)
      return { key: c, label: MAINTENANCE_CATEGORY[c], opened: o.length, closed: done.length, stillOpen: o.filter((r) => !CLOSED.includes(r.status)).length, avgDays: avg(done), cost: cost(done) }
    })
    .sort((a, b) => b.opened - a.opened || a.label.localeCompare(b.label, 'pt-BR'))
  const statusCount = new Map<MaintenanceStatus, number>()
  for (const r of opened) statusCount.set(r.status, (statusCount.get(r.status) ?? 0) + 1)
  const byStatus = (Object.keys(MAINTENANCE_STATUS) as MaintenanceStatus[]).filter((st) => statusCount.has(st)).map((st) => ({ key: st, label: MAINTENANCE_STATUS[st], count: statusCount.get(st)! }))
  const props = new Map<Id, { key: Id; property: string; closed: number; cost: Cents }>()
  for (const r of closed) {
    const g = props.get(r.property_id) ?? { key: r.property_id, property: r.property_name, closed: 0, cost: 0 }
    g.closed++
    g.cost += cost([r])
    props.set(r.property_id, g)
  }
  return {
    opened: opened.length, closed: closed.length, avgDays: avg(closed), cost: cost(closed), byCategory, byStatus,
    costByProperty: [...props.values()].sort((a, b) => b.cost - a.cost),
  }
}

/* ---------------------------------------------------------------- 7. Rentabilidade por imóvel */

export interface ProfitRow {
  key: Id
  property: string
  units: number
  /** Recebido: parte paga das cobranças das locações com vencimento no período. */
  received: Cents
  /** Despesas do proprietário: contas a pagar cobradas do proprietário (charged_to = owner) no período. */
  ownerExpenses: Cents
  /** Taxa de administração ESTIMADA: % do contrato sobre o aluguel recebido. */
  fee: Cents
  /** Resultado = recebido - despesas do proprietário - taxa. */
  result: Cents
  margin: number | null
}

/** Status de locação que já gerou cobrança (para achar a taxa do contrato da cobrança). */
const BILLED: ContractStatus[] = ['active', 'ended', 'terminated']

/**
 * Estimativa operacional por imóvel. A taxa é recalculada aqui com o % de cada contrato
 * (a taxa de verdade é lançada por proprietário, sem imóvel, então não dá para somar por imóvel).
 */
export function profitabilityReport(input: ReportInput, p: Period): { rows: ProfitRow[]; totals: Omit<ProfitRow, 'key' | 'property' | 'units' | 'margin'> & { margin: number | null } } {
  const feePct = new Map(input.contracts.filter((k) => BILLED.includes(k.status)).map((k) => [k.id, k.admin_fee_pct]))
  const rows = new Map<Id, ProfitRow>()
  const get = (id: Id, name: string) => rows.get(id) ?? (rows.set(id, { key: id, property: name, units: 0, received: 0, ownerExpenses: 0, fee: 0, result: 0, margin: null }), rows.get(id)!)
  // A linha do imóvel nasce com qualquer unidade (a vaga também rende), mas "Unidades" conta só moradia e sala.
  for (const u of input.units) {
    const row = get(u.property_id, u.property_name)
    if (!isSpot(u)) row.units++
  }
  for (const e of input.entries) {
    if (!e.property_id || e.status === 'canceled' || !inPeriod(e.due_date, p) || !rows.has(e.property_id)) continue
    const row = rows.get(e.property_id)!
    if (isRevenue(e)) {
      const got = settledOf(e)
      row.received += got
      if (e.category === 'rent' && e.contract_id) row.fee += applyPct(got, feePct.get(e.contract_id) ?? 0)
    } else if (e.direction === 'payable' && e.charged_to === 'owner') row.ownerExpenses += e.amount_cents
  }
  const list = [...rows.values()]
    .map((r) => ({ ...r, result: r.received - r.ownerExpenses - r.fee, margin: r.received ? (r.received - r.ownerExpenses - r.fee) / r.received : null }))
    .sort((a, b) => b.received - a.received || a.property.localeCompare(b.property, 'pt-BR'))
  const t = list.reduce((a, r) => ({ received: a.received + r.received, ownerExpenses: a.ownerExpenses + r.ownerExpenses, fee: a.fee + r.fee, result: a.result + r.result }), { received: 0, ownerExpenses: 0, fee: 0, result: 0 })
  return { rows: list, totals: { ...t, margin: t.received ? t.result / t.received : null } }
}

/* ---------------------------------------------------------------- 8. Tudo de uma vez */

export interface Reports {
  period: Period
  occupancy: OccupancyReport
  delinquency: DelinquencyReport
  cash: CashReport
  transfers: TransfersReport
  maintenance: MaintenanceReport
  profitability: ReturnType<typeof profitabilityReport>
}

export function buildReports(input: ReportInput, key: PeriodKey): Reports {
  const period = periodOf(input.today, key)
  return {
    period,
    occupancy: occupancyReport(input),
    delinquency: delinquencyReport(input, period),
    cash: cashReport(input, period),
    transfers: transfersReport(input, period),
    maintenance: maintenanceReport(input, period),
    profitability: profitabilityReport(input, period),
  }
}
