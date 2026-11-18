/* =============================================================================
   metrics.ts: as FÓRMULAS da Visão geral, num lugar só e sem React.

   O que resolve: a Visão geral roda em dois lugares, no app e dentro do Power BI (visual
   HTML Content). Os dois chamam estas funções; por isso o número é o mesmo nos dois.

   Por que linhas "Lite" (planas, só com as colunas que as contas usam):
   1. Elas são o ESQUEMA que a medida DAX do Power BI manda (ver src/powerbi/schema.ts).
      Coluna a mais vira texto a mais dentro da medida, e o visual fica lento.
   2. Função pura (entra linha, sai número; nada de banco nem de tela) se testa com um
      conjunto pequeno feito à mão (metrics.test.ts).

   Regras de dado que valem aqui (as mesmas do app):
   - dinheiro em centavos inteiros; data como texto 'AAAA-MM-DD'; "hoje" vem de fora;
   - "ocupada" e "vencido" são CALCULADOS, nunca lidos de um campo (data/rules.ts).
   ============================================================================= */
import { leaseCovers } from '@/data/rules'
import type {
  AdjustmentIndex, Cents, Contract, ContractKind, ContractStatus, EntryCategory, EntryDirection, FinancialEntry, Id, IsoDate,
  MaintenanceStatus, ManualUnitStatus, UnitStatus,
} from '@/data/types'
import { addMonths, daysBetween, daysInMonth, monthStart, parts, toIso } from '@/lib/dates'

/* ---------------------------------------------------------------- 1. O esquema (linhas Lite) */

/** Unidade. "Ocupada" NÃO vem aqui: sai dos contratos, como no app inteiro. */
export interface UnitLite {
  id: Id
  code: string
  /** A situação escolhida à mão (disponível, reservada, em manutenção, bloqueada). */
  manual_status: ManualUnitStatus
  property_id: Id
  property_name: string
  /** Carteira e responsável são do imóvel; vêm repetidos em cada unidade para o filtro. */
  portfolio_id: Id | null
  portfolio_name: string | null
  manager_id: Id | null
  manager_name: string | null
}

export interface ContractLite {
  id: Id
  code: string
  kind: ContractKind
  status: ContractStatus
  unit_id: Id | null
  property_id: Id
  start_date: IsoDate
  end_date: IsoDate
  adjustment_index: AdjustmentIndex
  /** Mês do reajuste anual (1 a 12). */
  adjustment_month: number
  /** Contrato que este renova (null = locação nova). É o que separa "renovação" de "novo contrato". */
  parent_id: Id | null
}

export interface EntryLite {
  id: Id
  direction: EntryDirection
  category: EntryCategory
  status: FinancialEntry['status']
  due_date: IsoDate
  amount_cents: Cents
  /** Soma dos pagamentos até hoje (0 se nada foi pago). */
  paid_cents: Cents
  /**
   * Dia do ÚLTIMO pagamento (null = nada pago, ou a origem não mandou a data). Serve para duas
   * perguntas: pagou até o vencimento (pontualidade) e como estava a cobrança numa data passada
   * (a comparação com o período anterior).
   */
  paid_at: IsoDate | null
  /** Repasse e taxa de administração não têm imóvel (são por proprietário). */
  property_id: Id | null
}

export interface MaintenanceLite {
  id: Id
  status: MaintenanceStatus
  property_id: Id
  due_date: IsoDate | null
  quote_cents: Cents | null
  /** Dia em que o chamado foi aberto (null = a origem não mandou: conta como aberto desde sempre). */
  opened_on: IsoDate | null
  /** Dia em que foi concluído ou cancelado (null = ainda aberto). */
  closed_on: IsoDate | null
  /** Colaborador responsável. Só no app: o Power BI nunca recebe coluna de pessoa (fica null lá). */
  assignee_id: Id | null
}

/**
 * O que as contas de receita, despesa e atraso leem de um lançamento (sem o dia do pagamento).
 * Os Relatórios chamam as mesmas contas com as linhas deles, que não têm paid_at: por isso elas
 * pedem só isto, e não a linha Lite inteira.
 */
export type EntryBase = Omit<EntryLite, 'paid_at'>

/** Tarefa da equipe (processo ou avulsa). Entra só no desempenho da equipe. */
export interface TaskLite {
  id: Id
  status: 'todo' | 'doing' | 'done' | 'canceled'
  due_date: IsoDate | null
  /** Dia em que ficou feita (null = não está feita). */
  done_on: IsoDate | null
  /** Imóvel da unidade, do contrato ou do chamado ligado à tarefa (null = tarefa solta, sem imóvel). */
  property_id: Id | null
  /** Colaborador responsável. Só no app, como em MaintenanceLite. */
  assignee_id: Id | null
}

/** Rotina de manutenção (limpeza de caixa d'água, extintores...): "vencida" = ligada e com a data passada. */
export interface RoutineLite {
  id: Id
  property_id: Id
  next_date: IsoDate
  status: 'on' | 'off'
}

/**
 * As tabelas que a Visão geral lê (no Power BI: Unidades, Vagas, Contratos, Lancamentos, Chamados,
 * Tarefas e Rotinas). Vaga de garagem tem lista própria (spots): ela tem a conta dela ("vagas
 * alugadas") e nunca entra na ocupação das unidades.
 */
export interface LiteData {
  units: UnitLite[]
  spots: UnitLite[]
  contracts: ContractLite[]
  entries: EntryLite[]
  maintenance: MaintenanceLite[]
  tasks: TaskLite[]
  routines: RoutineLite[]
}

/* ---------------------------------------------------------------- 2. Período */

export type PeriodKey = '1' | '3' | '6' | '12'
export const PERIOD_KEYS: PeriodKey[] = ['1', '3', '6', '12']
export const PERIOD_LABEL: Record<PeriodKey, string> = { '1': 'Mês atual', '3': 'Últimos 3 meses', '6': 'Últimos 6 meses', '12': 'Últimos 12 meses' }
/**
 * Padrão = 3 meses. Por que não o mês atual: no começo do mês quase nada venceu ainda, e a
 * inadimplência de "novembro" no dia 4 diria zero sem querer dizer nada.
 */
export const DEFAULT_PERIOD: PeriodKey = '3'

export interface Period {
  key: PeriodKey
  /** Primeiro dia do primeiro mês. */
  first: IsoDate
  /** Último dia do mês atual (o mês corrente entra inteiro: o que vence depois de hoje é "a vencer"). */
  last: IsoDate
  /** Primeiro dia de cada mês do período, do mais antigo ao atual. */
  months: IsoDate[]
}

export function isPeriodKey(v: unknown): v is PeriodKey {
  return typeof v === 'string' && (PERIOD_KEYS as string[]).includes(v)
}

/** Período = os últimos N meses de calendário, contando o atual. '3' em 04/11 = 01/09 a 30/11. */
export function periodOf(today: IsoDate, key: PeriodKey): Period {
  const n = Number(key)
  const current = monthStart(today)
  const months = Array.from({ length: n }, (_, i) => addMonths(current, i - (n - 1)))
  return { key, first: months[0], last: monthEnd(current), months }
}

export function monthEnd(iso: IsoDate): IsoDate {
  const [y, m] = parts(iso)
  return toIso(y, m, daysInMonth(y, m))
}

export function inPeriod(date: IsoDate, p: Pick<Period, 'first' | 'last'>): boolean {
  return date >= p.first && date <= p.last
}

/* ---------------------------------------------------------------- 3. Ocupação */

/**
 * Ocupa HOJE: a regra é a de data/rules.ts (leaseCovers), para a Visão geral bater com a
 * tela de Imóveis. leaseCovers pede um Contract inteiro, mas só lê kind, status, start_date
 * e end_date, que a linha Lite tem; daí a conversão de tipo. O teste powerbi.test.ts confere
 * que a ocupação daqui é a mesma das telas (se rules.ts mudar, ele avisa).
 */
export function coversToday(k: Pick<ContractLite, 'kind' | 'status' | 'start_date' | 'end_date'>, date: IsoDate): boolean {
  return leaseCovers(k as Contract, date)
}

/** Status que já ocuparam a unidade em algum momento (para datas PASSADAS do histórico). */
export const HISTORY_STATUSES: ContractStatus[] = ['active', 'ended', 'terminated']

/**
 * Ocupava numa data PASSADA (histórico de 12 meses): locação que estava valendo naquela data.
 * Armadilha que isto evita: com a regra de hoje (só "vigente"), uma locação encerrada no mês
 * passado sumiria do histórico, e a ocupação de meses atrás sairia menor do que foi.
 */
export function coveredAt(k: Pick<ContractLite, 'kind' | 'status' | 'start_date' | 'end_date'>, date: IsoDate): boolean {
  return k.kind === 'lease' && HISTORY_STATUSES.includes(k.status) && k.start_date <= date && date <= k.end_date
}

/** Situação de cada unidade hoje: ocupada se há locação vigente; senão, a escolhida à mão. */
export function unitStatuses(units: UnitLite[], contracts: ContractLite[], today: IsoDate): Map<Id, UnitStatus> {
  const occupied = new Set<Id>()
  for (const k of contracts) if (k.unit_id && coversToday(k, today)) occupied.add(k.unit_id)
  return new Map(units.map((u) => [u.id, occupied.has(u.id) ? 'occupied' : u.manual_status]))
}

export interface Occupancy {
  units: number
  /** Alugáveis = todas menos as bloqueadas. */
  rentable: number
  occupied: number
  /** Alugáveis sem locação (disponível, reservada ou em manutenção). */
  vacant: number
  blocked: number
  /** ocupadas ÷ alugáveis (null quando não há alugável). */
  rate: number | null
  /** 1 - ocupação. */
  vacancy: number | null
}

/** Ocupação = ocupadas ÷ alugáveis; vacância = 1 - ocupação. Bloqueada não conta como alugável. */
export function occupancyOf(statuses: Iterable<UnitStatus>): Occupancy {
  let units = 0
  let occupied = 0
  let blocked = 0
  for (const st of statuses) {
    units++
    if (st === 'occupied') occupied++
    else if (st === 'blocked') blocked++
  }
  const rentable = units - blocked
  const rate = rentable ? occupied / rentable : null
  return { units, rentable, occupied, vacant: rentable - occupied, blocked, rate, vacancy: rate === null ? null : 1 - rate }
}

export function countByStatus(statuses: Iterable<UnitStatus>): Record<UnitStatus, number> {
  const out: Record<UnitStatus, number> = { occupied: 0, available: 0, reserved: 0, maintenance: 0, blocked: 0 }
  for (const st of statuses) out[st]++
  return out
}

export interface PropertyOccupancy extends Occupancy {
  property_id: Id
  property_name: string
}

/** Ocupação por empreendimento, do maior (mais unidades) para o menor. */
export function occupancyByProperty(units: UnitLite[], statuses: Map<Id, UnitStatus>): PropertyOccupancy[] {
  const groups = new Map<Id, { name: string; list: UnitStatus[] }>()
  for (const u of units) {
    const g = groups.get(u.property_id) ?? { name: u.property_name, list: [] }
    g.list.push(statuses.get(u.id) ?? u.manual_status)
    groups.set(u.property_id, g)
  }
  return [...groups.entries()]
    .map(([property_id, g]) => ({ property_id, property_name: g.name, ...occupancyOf(g.list) }))
    .sort((a, b) => b.units - a.units || a.property_name.localeCompare(b.property_name, 'pt-BR'))
}

/* ---------------------------------------------------------------- 4. Dinheiro */

/**
 * O que NÃO é receita da carteira, mesmo sendo "a receber":
 * - taxa de administração: sai do próprio aluguel (contar as duas seria contar duas vezes);
 * - repasse: é dinheiro do proprietário passando pela imobiliária;
 * - caução: é garantia, volta para o inquilino no fim.
 */
const NOT_REVENUE: EntryCategory[] = ['admin_fee', 'transfer', 'deposit']
/** Categorias que contam como receita (para filtrar a lista do Financeiro igual à conta). */
export const REVENUE_CATEGORIES: EntryCategory[] = ['rent', 'condo_fee', 'iptu', 'maintenance', 'other']

export function isRevenue(e: Pick<EntryLite, 'direction' | 'category'>): boolean {
  return e.direction === 'receivable' && !NOT_REVENUE.includes(e.category)
}
/** Despesa = conta a pagar que não é repasse (o repasse é do proprietário, não gasto da carteira). */
export function isExpense(e: Pick<EntryLite, 'direction' | 'category'>): boolean {
  return e.direction === 'payable' && e.category !== 'transfer'
}
export function isTransfer(e: Pick<EntryLite, 'direction' | 'category'>): boolean {
  return e.direction === 'payable' && e.category === 'transfer'
}

/**
 * Quanto do lançamento já entrou (ou saiu). Pago = o valor inteiro; em aberto = a parte paga
 * (pagamento parcial conta); cancelado = nada. O teto no valor evita contar troco a mais.
 */
export function settledOf(e: Pick<EntryLite, 'status' | 'amount_cents' | 'paid_cents'>): Cents {
  if (e.status === 'canceled') return 0
  if (e.status === 'paid') return e.amount_cents
  return Math.min(Math.max(e.paid_cents, 0), e.amount_cents)
}

/** Saldo em aberto: o que falta pagar (a mesma conta do open_cents de data/views/finance.ts). */
export function openOf(e: Pick<EntryLite, 'status' | 'amount_cents' | 'paid_cents'>): Cents {
  return e.status === 'open' ? Math.max(0, e.amount_cents - Math.max(e.paid_cents, 0)) : 0
}

/** Vencido = em aberto com vencimento antes de hoje (a regra de entryState em rules.ts). */
export function isOverdue(e: Pick<EntryLite, 'status' | 'due_date'>, today: IsoDate): boolean {
  return e.status === 'open' && e.due_date < today
}

export interface Revenue {
  /** Prevista: tudo o que vence no período (sem os cancelados). */
  forecast: Cents
  /** Recebida: a parte já paga disso. */
  received: Cents
  /** Em atraso: saldo em aberto do que venceu antes de hoje. */
  overdue: Cents
  /** A vencer: saldo em aberto com vencimento de hoje em diante. */
  upcoming: Cents
  /** Já venceu: o total (pago ou não) com vencimento antes de hoje. É o divisor da inadimplência. */
  dueSoFar: Cents
  /** Inadimplência = em atraso ÷ já venceu (null quando nada venceu ainda). */
  delinquency: number | null
}

/**
 * Receita do período, pelo VENCIMENTO. Fecha sempre: prevista = recebida + em atraso + a vencer.
 * Inadimplência = saldo vencido em aberto ÷ total que já venceu no período.
 */
export function revenueOf(entries: EntryBase[], p: Pick<Period, 'first' | 'last'>, today: IsoDate): Revenue {
  const r: Revenue = { forecast: 0, received: 0, overdue: 0, upcoming: 0, dueSoFar: 0, delinquency: null }
  for (const e of entries) {
    if (!isRevenue(e) || e.status === 'canceled' || !inPeriod(e.due_date, p)) continue
    r.forecast += e.amount_cents
    r.received += settledOf(e)
    if (e.due_date < today) {
      r.dueSoFar += e.amount_cents
      r.overdue += openOf(e)
    } else r.upcoming += openOf(e)
  }
  r.delinquency = r.dueSoFar ? r.overdue / r.dueSoFar : null
  return r
}

export interface Payables {
  /** Previsto: tudo o que vence no período. */
  total: Cents
  /** A parte já paga. */
  paid: Cents
}

/** Despesas (ou repasses) do período, pelo vencimento, sem os cancelados. */
export function payablesOf(entries: EntryBase[], p: Pick<Period, 'first' | 'last'>, which: (e: EntryBase) => boolean): Payables {
  const out: Payables = { total: 0, paid: 0 }
  for (const e of entries) {
    if (!which(e) || e.status === 'canceled' || !inPeriod(e.due_date, p)) continue
    out.total += e.amount_cents
    out.paid += settledOf(e)
  }
  return out
}

/* ---------------------------------------------------------------- 5. Atraso por faixa (aging) */

export interface AgingBucket {
  key: '1-15' | '16-30' | '31-60' | '60+'
  label: string
  min: number
  max: number
}
export const AGING_BUCKETS: AgingBucket[] = [
  { key: '1-15', label: '1 a 15 dias', min: 1, max: 15 },
  { key: '16-30', label: '16 a 30 dias', min: 16, max: 30 },
  { key: '31-60', label: '31 a 60 dias', min: 31, max: 60 },
  { key: '60+', label: 'Mais de 60 dias', min: 61, max: Number.POSITIVE_INFINITY },
]

export function bucketOf(days: number): AgingBucket | null {
  return AGING_BUCKETS.find((b) => days >= b.min && days <= b.max) ?? null
}

export interface AgingRow extends AgingBucket {
  count: number
  cents: Cents
}

/**
 * Saldo vencido em aberto do período, separado pelos dias desde o vencimento.
 * A soma das faixas é o "em atraso" de revenueOf: as duas contas olham as mesmas cobranças.
 */
export function agingOf(entries: EntryBase[], p: Pick<Period, 'first' | 'last'>, today: IsoDate): AgingRow[] {
  const rows: AgingRow[] = AGING_BUCKETS.map((b) => ({ ...b, count: 0, cents: 0 }))
  for (const e of entries) {
    if (!isRevenue(e) || !isOverdue(e, today) || !inPeriod(e.due_date, p)) continue
    const open = openOf(e)
    if (open <= 0) continue
    const b = bucketOf(daysBetween(e.due_date, today))
    const row = b && rows.find((x) => x.key === b.key)
    if (!row) continue
    row.count++
    row.cents += open
  }
  return rows
}

/* ---------------------------------------------------------------- 6. Série mensal */

export interface MonthPoint {
  month: IsoDate // primeiro dia do mês
  forecast: Cents
  received: Cents
  overdue: Cents
}

/** Receita prevista x recebida dos últimos N meses (o atual é o último), pelo mês de vencimento. */
export function monthlyRevenue(entries: EntryBase[], today: IsoDate, n = 12): MonthPoint[] {
  const current = monthStart(today)
  return Array.from({ length: n }, (_, i) => {
    const month = addMonths(current, i - (n - 1))
    const r = revenueOf(entries, { first: month, last: monthEnd(month) }, today)
    return { month, forecast: r.forecast, received: r.received, overdue: r.overdue }
  })
}

/* ---------------------------------------------------------------- 7. Prazos (contratos e chamados) */

export interface Ending {
  d30: number
  d60: number
  d90: number
}

/**
 * Locações vigentes que acabam entre hoje e daqui a 30, 60 ou 90 dias (as faixas se somam:
 * quem vence em 20 dias está nas três). É a mesma regra do filtro "vence em" da lista de Contratos.
 */
export function endingLeases(contracts: ContractLite[], today: IsoDate): Ending {
  const out: Ending = { d30: 0, d60: 0, d90: 0 }
  for (const k of contracts) {
    if (k.kind !== 'lease' || k.status !== 'active') continue
    const d = daysBetween(today, k.end_date)
    if (d < 0) continue
    if (d <= 30) out.d30++
    if (d <= 60) out.d60++
    if (d <= 90) out.d90++
  }
  return out
}

/**
 * Reajustes do mês: locação vigente, com índice, cujo mês de reajuste é o mês de hoje, que já
 * completa 12 meses de contrato neste mês e que ainda vale neste mês.
 * Por que "12 meses": o primeiro reajuste é no primeiro aniversário, nunca no mês da assinatura.
 */
export function adjustmentsThisMonth(contracts: ContractLite[], today: IsoDate): ContractLite[] {
  const [, month] = parts(today)
  const current = monthStart(today)
  return contracts.filter(
    (k) =>
      k.kind === 'lease' &&
      k.status === 'active' &&
      k.adjustment_index !== 'none' &&
      k.adjustment_month === month &&
      addMonths(monthStart(k.start_date), 12) <= current &&
      k.end_date >= current,
  )
}

export interface Requests {
  /** Abertos = nem concluídos nem cancelados. */
  open: number
  /** Atrasados = abertos que passaram do prazo. */
  late: number
  awaitingOwner: number
  awaitingOwnerCents: Cents
}

const CLOSED: MaintenanceStatus[] = ['done', 'canceled']

export function requestsOf(rows: MaintenanceLite[], today: IsoDate): Requests {
  const out: Requests = { open: 0, late: 0, awaitingOwner: 0, awaitingOwnerCents: 0 }
  for (const r of rows) {
    if (CLOSED.includes(r.status)) continue
    out.open++
    if (r.due_date && r.due_date < today) out.late++
    if (r.status === 'awaiting_owner') {
      out.awaitingOwner++
      out.awaitingOwnerCents += r.quote_cents ?? 0
    }
  }
  return out
}

export interface OverdueNow {
  /** Cobranças vencidas hoje (de qualquer mês) e o saldo delas. */
  count: number
  cents: Cents
  /** Só as vencidas há mais de N dias (as que pedem cobrança). */
  lateCount: number
  lateCents: Cents
  oldestDays: number
}

/** Cobranças da carteira vencidas AGORA, de qualquer mês, e quantas passaram de N dias. */
export function overdueNow(entries: EntryBase[], today: IsoDate, minDays = 5): OverdueNow {
  const out: OverdueNow = { count: 0, cents: 0, lateCount: 0, lateCents: 0, oldestDays: 0 }
  for (const e of entries) {
    if (!isRevenue(e) || !isOverdue(e, today)) continue
    const days = daysBetween(e.due_date, today)
    out.count++
    out.cents += openOf(e)
    out.oldestDays = Math.max(out.oldestDays, days)
    if (days > minDays) {
      out.lateCount++
      out.lateCents += openOf(e)
    }
  }
  return out
}

/* ---------------------------------------------------------------- 8. Filtros (empreendimento, carteira, responsável) */

/** Valor do filtro para "sem carteira" ou "sem responsável". */
export const NONE = '__none'

export interface LiteFilter {
  /** '' = todos. */
  property: string
  portfolio: string
  manager: string
}

function matchKey(value: Id | null, wanted: string): boolean {
  if (!wanted) return true
  return wanted === NONE ? value === null : value === wanted
}

function unitMatches(u: UnitLite, f: LiteFilter, skip?: keyof LiteFilter): boolean {
  return (
    (skip === 'property' || !f.property || u.property_id === f.property) &&
    (skip === 'portfolio' || matchKey(u.portfolio_id, f.portfolio)) &&
    (skip === 'manager' || matchKey(u.manager_id, f.manager))
  )
}

/**
 * Corta todas as tabelas pelos imóveis que passam no filtro.
 * Lançamento sem imóvel (repasse, taxa de administração) só entra SEM filtro: ele é do
 * proprietário, não dá para dizer de qual imóvel é. Por isso o repasse some ao filtrar.
 * Pelo mesmo motivo, a tarefa solta (sem unidade, contrato ou chamado) some com filtro ligado.
 */
export function filterLite(d: LiteData, f: LiteFilter): { data: LiteData; propertyIds: Id[] | null } {
  if (!f.property && !f.portfolio && !f.manager) return { data: d, propertyIds: null }
  const units = d.units.filter((u) => unitMatches(u, f))
  const spots = d.spots.filter((u) => unitMatches(u, f))
  // Imóveis do recorte: os das unidades e os das vagas (um imóvel só de vagas também é recorte).
  const props = new Set([...units, ...spots].map((u) => u.property_id))
  return {
    data: {
      units,
      spots,
      contracts: d.contracts.filter((k) => props.has(k.property_id)),
      entries: d.entries.filter((e) => !!e.property_id && props.has(e.property_id)),
      maintenance: d.maintenance.filter((r) => props.has(r.property_id)),
      tasks: d.tasks.filter((t) => !!t.property_id && props.has(t.property_id)),
      routines: d.routines.filter((r) => props.has(r.property_id)),
    },
    propertyIds: [...props],
  }
}

export interface FilterOption {
  value: string
  label: string
  /** Unidades que aparecem ao escolher esta opção, já com os OUTROS filtros ligados. */
  count: number
}

export interface FilterOptions {
  properties: FilterOption[]
  portfolios: FilterOption[]
  managers: FilterOption[]
}

/**
 * Opções de cada filtro com a contagem de unidades recontada pelos OUTROS filtros
 * (QoL da casa: o número ao lado é exatamente o que aparece ao escolher a opção).
 */
export function filterOptions(units: UnitLite[], f: LiteFilter): FilterOptions {
  const build = (skip: keyof LiteFilter, key: (u: UnitLite) => Id | null, label: (u: UnitLite) => string | null, noneLabel: string) => {
    const seen = new Map<string, FilterOption>()
    for (const u of units) {
      const value = key(u) ?? NONE
      if (!seen.has(value)) seen.set(value, { value, label: key(u) === null ? noneLabel : (label(u) ?? noneLabel), count: 0 })
      if (unitMatches(u, f, skip)) seen.get(value)!.count++
    }
    return [...seen.values()].sort((a, b) => (a.value === NONE ? 1 : b.value === NONE ? -1 : a.label.localeCompare(b.label, 'pt-BR')))
  }
  return {
    properties: build('property', (u) => u.property_id, (u) => u.property_name, 'Sem imóvel'),
    portfolios: build('portfolio', (u) => u.portfolio_id, (u) => u.portfolio_name, 'Sem carteira'),
    managers: build('manager', (u) => u.manager_id, (u) => u.manager_name, 'Sem responsável'),
  }
}

/* ---------------------------------------------------------------- 9. A Visão geral inteira */

export interface Overview {
  today: IsoDate
  period: Period
  occupancy: Occupancy
  byStatus: Record<UnitStatus, number>
  byProperty: PropertyOccupancy[]
  revenue: Revenue
  expenses: Payables
  transfers: Payables
  aging: AgingRow[]
  monthly: MonthPoint[]
  ending: Ending
  adjustments: ContractLite[]
  overdue: OverdueNow
  requests: Requests
}

/** Tudo o que a Visão geral mostra, calculado de uma vez (o app e o Power BI chamam esta). */
export function computeOverview(d: LiteData, today: IsoDate, key: PeriodKey): Overview {
  const period = periodOf(today, key)
  const statuses = unitStatuses(d.units, d.contracts, today)
  return {
    today,
    period,
    occupancy: occupancyOf(statuses.values()),
    byStatus: countByStatus(statuses.values()),
    byProperty: occupancyByProperty(d.units, statuses),
    revenue: revenueOf(d.entries, period, today),
    expenses: payablesOf(d.entries, period, isExpense),
    transfers: payablesOf(d.entries, period, isTransfer),
    aging: agingOf(d.entries, period, today),
    monthly: monthlyRevenue(d.entries, today, 12),
    ending: endingLeases(d.contracts, today),
    adjustments: adjustmentsThisMonth(d.contracts, today),
    overdue: overdueNow(d.entries, today, 5),
    requests: requestsOf(d.maintenance, today),
  }
}

/* ---------------------------------------------------------------- 10. As fórmulas em texto (o "i" das duas telas) */

/** Um texto só para o app e o Power BI: trocar aqui troca nos dois. */
export const FORMULAS = {
  occupancy: 'Ocupadas ÷ alugáveis. Ocupada = locação vigente hoje. Bloqueada não conta como alugável.',
  vacancy: '1 − ocupação: alugáveis sem locação vigente (disponível, reservada ou em manutenção) ÷ alugáveis.',
  forecast: 'Tudo o que vence no período, cobrado das locações (aluguel, condomínio, IPTU e outros). Fora: taxa de administração, repasse e caução.',
  received: 'Parte já paga do que vence no período. Prevista = recebida + em atraso + a vencer.',
  delinquency: 'Saldo vencido em aberto ÷ total que já venceu no período (pago ou não). Vencido = em aberto com vencimento antes de hoje.',
  expenses: 'Contas a pagar que vencem no período (manutenção, condomínio de unidade vaga e outras), sem os repasses.',
  transfers: 'Repasses aos proprietários que vencem no período: aluguel recebido − taxa de administração − despesas do proprietário.',
  ending: 'Locações vigentes cujo fim cai entre hoje e daqui a 30, 60 ou 90 dias.',
  requests: 'Chamados que não estão concluídos nem cancelados. Atrasado = passou do prazo.',
  aging: 'Saldo vencido em aberto do período, pelos dias desde o vencimento. A soma é o "em atraso" da inadimplência.',
  monthly: 'Por mês de vencimento: prevista = tudo o que vence no mês; recebida = a parte já paga.',
  byProperty: 'Ocupadas ÷ alugáveis de cada empreendimento, hoje.',
  byStatus: 'Situação de hoje: ocupada vem da locação vigente; as outras, da escolha feita no cadastro.',
  // Os da Visão geral em blocos (07/11/2026): macro.ts e desempenho.ts.
  available: 'Unidades com a situação "Disponível" hoje (vaga de garagem fica fora). A média conta os dias desde o fim da última locação de cada uma; a nunca alugada fica fora da média.',
  spots: 'Vagas de garagem com locação vigente hoje, de quantas são alugáveis (bloqueada não conta).',
  upkeep: 'Contas a pagar de manutenção que vencem no período (o serviço dos chamados concluídos), pagas ou não.',
  leases: 'Locações vigentes hoje, de unidades e de vagas de garagem.',
  fresh: 'Locações sem contrato anterior que começaram no período, até hoje.',
  renewals: 'Locações que renovam um contrato anterior (a renovação feita no contrato) e começaram no período, até hoje.',
  punctuality: 'Cobranças das locações que venceram no período e foram pagas por inteiro até o vencimento ÷ cobranças que já venceram. Pagamento sem data fica fora da conta.',
  resolution: 'Chamados concluídos no período, até hoje: média de dias entre a abertura e a conclusão. Cancelado fica fora.',
  routines: 'Rotinas de manutenção ligadas cuja próxima data já passou (a rotina diária abre o chamado).',
  tasksOnTime: 'Tarefas com prazo no período que já venceram ou já foram feitas: feitas até o prazo ÷ total.',
  tasksLate: 'Tarefas a fazer ou em andamento com o prazo antes de hoje.',
} as const
