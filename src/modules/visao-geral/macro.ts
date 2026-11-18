/* =============================================================================
   macro.ts: os números MACRO da Visão geral (07/11/2026) e a comparação com o período anterior.

   Pedido do Fernando: "visão geral mais única, um dashboard direto ao ponto com os macros".
   A tela virou quatro blocos (Carteira, Financeiro, Clientes, Manutenção), cada número com a
   seta que compara com o período anterior equivalente. Tudo aqui é função pura (entra linha
   Lite, sai número), chamada pelo app e pelo HTML do Power BI: o número é o mesmo nos dois.

   Dois tipos de número, duas comparações:
   1. FOTO de hoje (ocupação, locações vigentes, chamados abertos): compara com a mesma foto
      N meses atrás (prevToday). "3 meses" em 04/11 compara com 04/08.
   2. SOMA do período (receita, contratos novos, tempo de resolução): compara com os N meses
      anteriores, olhados no mesmo ponto do mês (até prevToday). Setembro a novembro visto em
      04/11 compara com junho a agosto visto em 04/08: nos dois lados, o mês corrente tem só 3 dias.
   Sem isso, o período atual pareceria sempre pior (o anterior já teve tempo de ser pago).

   Macro estende Overview (metrics.ts): quem já lia ocupação, receita e despesas da Visão geral
   (o teste dos Relatórios) continua lendo os mesmos campos.
   ============================================================================= */
import type { Id, IsoDate, UnitStatus } from '@/data/types'
import { addMonths, daysBetween, monthStart } from '@/lib/dates'
import {
  computeOverview, coveredAt, coversToday, HISTORY_STATUSES, inPeriod, isRevenue, isTransfer, monthEnd, occupancyOf, payablesOf, periodOf,
  revenueOf, unitStatuses, type ContractLite, type EntryLite, type LiteData, type MaintenanceLite, type Occupancy, type Overview,
  type Payables, type Period, type PeriodKey, type Revenue, type RoutineLite, type TaskLite, type UnitLite,
} from './metrics'

/* ---------------------------------------------------------------- 1. O período anterior */

/** O dia equivalente N meses atrás e o período que termina nele ("3" em 04/11 = 04/08 e jun a ago). */
export function previousOf(today: IsoDate, key: PeriodKey): { prevToday: IsoDate; prevPeriod: Period } {
  const prevToday = addMonths(today, -Number(key))
  return { prevToday, prevPeriod: periodOf(prevToday, key) }
}

/** Os 12 pontos da tendência: o último dia de cada um dos 11 meses anteriores e hoje. */
export function trendDates(today: IsoDate): IsoDate[] {
  const current = monthStart(today)
  return Array.from({ length: 12 }, (_, i) => (i === 11 ? today : monthEnd(addMonths(current, i - 11))))
}

/**
 * Como a cobrança estava numa data passada. Paga (ou com parte paga) só DEPOIS da data: naquela
 * data ainda estava em aberto, sem nada pago.
 * atalho: guardamos só o dia do ÚLTIMO pagamento; uma parte paga antes da data e o resto depois
 * contam como zero naquela data. Melhorar mandando os pagamentos um a um (tabela Pagamentos)
 * se a diferença aparecer no uso real.
 */
export function entryAsOf(e: EntryLite, date: IsoDate): EntryLite {
  if (!e.paid_at || e.paid_at <= date) return e
  return { ...e, status: e.status === 'paid' ? 'open' : e.status, paid_cents: 0, paid_at: null }
}

/* ---------------------------------------------------------------- 2. Carteira */

/**
 * Situação de cada unidade numa data. Hoje: a regra do app (locação VIGENTE, coversToday).
 * Antes de hoje: a locação que estava valendo naquela data (coveredAt), mesmo que hoje esteja
 * encerrada. As outras situações (disponível, reservada, bloqueada) são as de hoje.
 * atalho: a situação escolhida à mão não tem histórico e a unidade não tem data de cadastro; uma
 * unidade bloqueada ou criada depois da data conta como se já estivesse assim. Melhorar quando
 * houver histórico de situação (fase 2).
 */
export function statusesAt(units: UnitLite[], contracts: ContractLite[], date: IsoDate, today: IsoDate): Map<Id, UnitStatus> {
  if (date >= today) return unitStatuses(units, contracts, today)
  const occupied = new Set<Id>()
  for (const k of contracts) if (k.unit_id && coveredAt(k, date)) occupied.add(k.unit_id)
  return new Map(units.map((u) => [u.id, occupied.has(u.id) ? 'occupied' : u.manual_status]))
}

export function occupancyAt(units: UnitLite[], contracts: ContractLite[], date: IsoDate, today: IsoDate): Occupancy {
  return occupancyOf(statusesAt(units, contracts, date, today).values())
}

export interface Available {
  /** Unidades "Disponível" hoje. */
  count: number
  /** Quantas delas já tiveram locação (a base da média). */
  withHistory: number
  /** Média de dias desde o fim da última locação (null = nenhuma teve locação). */
  avgDays: number | null
}

/**
 * Disponíveis e há quanto tempo. Passo a passo:
 * 1. a situação de hoje de cada unidade (ocupada pelo contrato; as outras, à mão);
 * 2. de cada uma, o fim da última locação que já acabou (antes de hoje);
 * 3. média dos dias desde esse fim; a nunca alugada fica fora da média, mas conta no total.
 */
export function availableOf(units: UnitLite[], contracts: ContractLite[], today: IsoDate): Available {
  const statuses = unitStatuses(units, contracts, today)
  const lastEnd = new Map<Id, IsoDate>()
  for (const k of contracts) {
    if (k.kind !== 'lease' || !k.unit_id || !HISTORY_STATUSES.includes(k.status) || k.end_date >= today) continue
    const prev = lastEnd.get(k.unit_id)
    if (!prev || k.end_date > prev) lastEnd.set(k.unit_id, k.end_date)
  }
  let count = 0
  let withHistory = 0
  let days = 0
  for (const u of units) {
    if (statuses.get(u.id) !== 'available') continue
    count++
    const end = lastEnd.get(u.id)
    if (!end) continue
    withHistory++
    days += daysBetween(end, today)
  }
  return { count, withHistory, avgDays: withHistory ? days / withHistory : null }
}

/* ---------------------------------------------------------------- 3. Clientes */

/** Locações valendo numa data (de unidade e de vaga). Hoje = vigente; antes = a que valia naquela data. */
export function leasesAt(contracts: ContractLite[], date: IsoDate, today: IsoDate): number {
  return contracts.filter((k) => k.kind === 'lease' && !!k.unit_id && (date >= today ? coversToday(k, today) : coveredAt(k, date))).length
}

export interface Signed {
  /** Locações novas (sem contrato anterior). */
  fresh: number
  /** Renovações (com contrato anterior). */
  renewals: number
}

/**
 * Locações que começaram no período, até a data de corte (asOf), e que de fato aconteceram
 * (vigente, encerrada ou rescindida; rascunho e "aguardando assinatura" ainda não fecharam).
 * O corte em asOf deixa o período anterior olhado no mesmo ponto do mês (ver o cabeçalho).
 */
export function signedOf(contracts: ContractLite[], p: Pick<Period, 'first' | 'last'>, asOf: IsoDate): Signed {
  const out: Signed = { fresh: 0, renewals: 0 }
  for (const k of contracts) {
    if (k.kind !== 'lease' || !HISTORY_STATUSES.includes(k.status) || !inPeriod(k.start_date, p) || k.start_date > asOf) continue
    if (k.parent_id) out.renewals++
    else out.fresh++
  }
  return out
}

export interface Punctuality {
  /** Cobranças que já venceram e cujo desfecho se conhece. */
  due: number
  /** As pagas por inteiro até o vencimento. */
  onTime: number
  rate: number | null
}

/**
 * Pontualidade dos locatários: das cobranças (as mesmas da inadimplência) que venceram no
 * período antes de hoje, quantas foram pagas por inteiro até o dia do vencimento.
 * Paga sem data de pagamento fica fora (não dá para dizer se foi no prazo).
 */
export function punctualityOf(entries: EntryLite[], p: Pick<Period, 'first' | 'last'>, today: IsoDate): Punctuality {
  let due = 0
  let onTime = 0
  for (const e of entries) {
    if (!isRevenue(e) || e.status === 'canceled' || e.amount_cents <= 0 || !inPeriod(e.due_date, p) || e.due_date >= today) continue
    const settled = e.status === 'paid' || e.paid_cents >= e.amount_cents
    if (settled && !e.paid_at) continue
    due++
    if (settled && e.paid_at! <= e.due_date) onTime++
  }
  return { due, onTime, rate: due ? onTime / due : null }
}

/* ---------------------------------------------------------------- 4. Manutenção */

const CLOSED_STATUSES: MaintenanceLite['status'][] = ['done', 'canceled']

/**
 * Chamados abertos (e atrasados) numa data: aberto até a data e não fechado até ela. Sem dia de
 * abertura, conta como aberto desde sempre; fechado sem dia de conclusão, como fechado desde sempre
 * (a escolha que não inventa chamado aberto).
 */
export function requestsAt(rows: MaintenanceLite[], date: IsoDate): { open: number; late: number } {
  const out = { open: 0, late: 0 }
  for (const r of rows) {
    if (r.opened_on && r.opened_on > date) continue
    const closed = r.closed_on ? r.closed_on <= date : CLOSED_STATUSES.includes(r.status)
    if (closed) continue
    out.open++
    if (r.due_date && r.due_date < date) out.late++
  }
  return out
}

export interface Resolution {
  /** Chamados concluídos no período (até a data de corte). */
  count: number
  /** Média de dias entre abertura e conclusão (null = nenhum com as duas datas). */
  avgDays: number | null
}

export function resolutionOf(rows: MaintenanceLite[], p: Pick<Period, 'first' | 'last'>, asOf: IsoDate): Resolution {
  let count = 0
  let known = 0
  let days = 0
  for (const r of rows) {
    if (r.status !== 'done' || !r.closed_on || !inPeriod(r.closed_on, p) || r.closed_on > asOf) continue
    count++
    if (!r.opened_on) continue
    known++
    days += Math.max(0, daysBetween(r.opened_on, r.closed_on))
  }
  return { count, avgDays: known ? days / known : null }
}

export function routinesOf(rows: RoutineLite[], today: IsoDate): { active: number; overdue: number } {
  const on = rows.filter((r) => r.status === 'on')
  return { active: on.length, overdue: on.filter((r) => r.next_date < today).length }
}

/* ---------------------------------------------------------------- 5. Tarefas (equipe) */

export interface TaskStats {
  /** Tarefas com prazo no período que já venceram ou já foram feitas (a base do "no prazo"). */
  measured: number
  /** Feitas até o prazo. */
  onTime: number
  rate: number | null
  /** Atrasadas na data de corte: prazo antes dela e não feitas até ela. */
  late: number
}

/**
 * Tarefas no prazo e atrasadas, vistas na data de corte (asOf). Passo a passo para cada tarefa:
 * 1. cancelada não conta;
 * 2. "feita até a data": feita e com o dia de conclusão até asOf (feita sem dia = feita, e fica
 *    fora do "no prazo", que precisa do dia);
 * 3. atrasada: prazo antes de asOf e não feita até asOf (em asOf = hoje, é a regra do alerta);
 * 4. no prazo: entre as que têm prazo no período e já venceram ou já foram feitas, as feitas até o prazo.
 */
export function taskStatsOf(tasks: TaskLite[], p: Pick<Period, 'first' | 'last'>, asOf: IsoDate): TaskStats {
  const out: TaskStats = { measured: 0, onTime: 0, rate: null, late: 0 }
  for (const t of tasks) {
    if (t.status === 'canceled') continue
    const done = t.status === 'done' && (!t.done_on || t.done_on <= asOf)
    if (t.due_date && t.due_date < asOf && !done) out.late++
    if (!t.due_date || !inPeriod(t.due_date, p)) continue
    if (done && !t.done_on) continue
    if (!(t.due_date < asOf || done)) continue
    out.measured++
    if (done && t.done_on! <= t.due_date) out.onTime++
  }
  out.rate = out.measured ? out.onTime / out.measured : null
  return out
}

/* ---------------------------------------------------------------- 6. A Visão geral em blocos */

/** Despesa de manutenção: conta a pagar da categoria manutenção (o serviço dos chamados). */
export function isUpkeep(e: Pick<EntryLite, 'direction' | 'category'>): boolean {
  return e.direction === 'payable' && e.category === 'maintenance'
}

export interface Macro extends Overview {
  prevToday: IsoDate
  prevPeriod: Period
  /** Carteira. */
  occupancyPrev: Occupancy
  /** Ocupação no fim de cada mês (o último ponto é hoje); null = sem unidade alugável. */
  occupancyTrend: (number | null)[]
  available: Available
  spots: Occupancy
  spotsPrev: Occupancy
  /** Financeiro (revenue, transfers e expenses vêm de Overview). */
  revenuePrev: Revenue
  transfersPrev: Payables
  upkeep: Payables
  upkeepPrev: Payables
  /** Clientes (ending vem de Overview). */
  leases: { active: number; activePrev: number; trend: number[] }
  signed: Signed
  signedPrev: Signed
  punctuality: Punctuality
  punctualityPrev: Punctuality
  /** Manutenção (requests vem de Overview). */
  requestsPrev: { open: number; late: number }
  requestsTrend: number[]
  resolution: Resolution
  resolutionPrev: Resolution
  routines: { active: number; overdue: number }
  /** Equipe, somada (o app mostra também por colaborador, em desempenho.ts). */
  tasks: TaskStats
  tasksPrev: TaskStats
}

/**
 * Tudo o que a Visão geral mostra, de uma vez (o app e o Power BI chamam esta).
 * Passo a passo: a base de sempre (computeOverview); o período anterior e o dia equivalente;
 * cada bloco com o número de agora e o de antes; as tendências de 12 meses.
 */
export function computeMacro(d: LiteData, today: IsoDate, key: PeriodKey): Macro {
  const base = computeOverview(d, today, key)
  const { prevToday, prevPeriod } = previousOf(today, key)
  const dates = trendDates(today)
  const before = d.entries.map((e) => entryAsOf(e, prevToday))
  return {
    ...base,
    prevToday,
    prevPeriod,
    occupancyPrev: occupancyAt(d.units, d.contracts, prevToday, today),
    occupancyTrend: dates.map((dt) => occupancyAt(d.units, d.contracts, dt, today).rate),
    available: availableOf(d.units, d.contracts, today),
    spots: occupancyAt(d.spots, d.contracts, today, today),
    spotsPrev: occupancyAt(d.spots, d.contracts, prevToday, today),
    revenuePrev: revenueOf(before, prevPeriod, prevToday),
    transfersPrev: payablesOf(d.entries, prevPeriod, isTransfer),
    upkeep: payablesOf(d.entries, base.period, isUpkeep),
    upkeepPrev: payablesOf(d.entries, prevPeriod, isUpkeep),
    leases: {
      active: leasesAt(d.contracts, today, today),
      activePrev: leasesAt(d.contracts, prevToday, today),
      trend: dates.map((dt) => leasesAt(d.contracts, dt, today)),
    },
    signed: signedOf(d.contracts, base.period, today),
    signedPrev: signedOf(d.contracts, prevPeriod, prevToday),
    punctuality: punctualityOf(d.entries, base.period, today),
    punctualityPrev: punctualityOf(before, prevPeriod, prevToday),
    requestsPrev: requestsAt(d.maintenance, prevToday),
    // O último ponto é o número de cima do bloco (pela situação do chamado), para os dois baterem.
    requestsTrend: dates.map((dt, i) => (i === dates.length - 1 ? base.requests.open : requestsAt(d.maintenance, dt).open)),
    resolution: resolutionOf(d.maintenance, base.period, today),
    resolutionPrev: resolutionOf(d.maintenance, prevPeriod, prevToday),
    routines: routinesOf(d.routines, today),
    tasks: taskStatsOf(d.tasks, base.period, today),
    tasksPrev: taskStatsOf(d.tasks, prevPeriod, prevToday),
  }
}
