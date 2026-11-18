/* =============================================================================
   Repasses: o que a imobiliária paga a cada proprietário por mês (só conta de imobiliária).

   A regra é a mesma dos dados fictícios (seed/financeiro.ts, passo 7), para o recálculo bater
   com o que já está gravado:
     bruto    = aluguel RECEBIDO no mês (pela data do pagamento), rateado pela fatia de cada dono;
     taxa     = % do contrato de administração daquele dono e imóvel, sobre a parte dele;
     despesas = contas a pagar cobradas do dono (charged_to = 'owner') que vencem no mês, rateadas;
     líquido  = bruto - taxa - despesas.
   O rateio usa splitByShares: as partes dos donos somam EXATAMENTE o valor pago (o centavo que
   sobra vai para a maior fração). Por isso a soma entre donos fecha no centavo.

   Ciclo: rascunho -> aprovado -> pago.
   RASCUNHO = o que o mês já rendeu MENOS o que já foi aprovado para aquele dono e mês. Assim um
   aluguel que entra depois da aprovação não se perde: o próximo recálculo cria um rascunho
   complementar com a diferença. Sem isso, dinheiro recebido depois de aprovar nunca seria repassado.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { can, hasFeature } from '@/auth/permissions'
import { AccessError, audit, connect, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { runList, type ListParams, type ListResult } from '@/data/query'
import type { Scope } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type { Cents, FinancialEntry, Id, IsoDate, OwnerTransfer, Payment } from '@/data/types'
import { lookup, ownersOf, unitLabel } from '@/data/views/lookup'
import { addMonths, dueDateFor, formatMonth, monthStart } from '@/lib/dates'
import { applyPct, formatBRL, splitByShares } from '@/lib/money'
import { newId } from '@/lib/random'
import { DEFAULT_ADMIN_FEE_PCT, managementFeeMap } from '@/modules/contratos/repo'

/* ---------------------------------------------------------------- o cálculo do mês */

export interface StatementLine {
  kind: 'rent' | 'expense'
  /** Data do pagamento (aluguel) ou do vencimento (despesa). */
  date: IsoDate
  description: string
  unit_label: string
  /** Valor inteiro (do pagamento ou da despesa). */
  total_cents: Cents
  share_pct: number
  /** A parte deste dono. */
  part_cents: Cents
  fee_pct: number
  fee_cents: Cents
}

export interface Amounts {
  gross: Cents
  fee: Cents
  expenses: Cents
  net: Cents
}

export interface OwnerMonth extends Amounts {
  owner_id: Id
  lines: StatementLine[]
}

const ZERO: Amounts = { gross: 0, fee: 0, expenses: 0, net: 0 }

/**
 * O mês de cada dono, linha a linha. Passo a passo:
 *   1. índices (unidade, dono, taxa por dono e imóvel);
 *   2. cada PAGAMENTO de aluguel do mês: divide pelos donos da unidade na data do pagamento e
 *      calcula a taxa de cada parte (arredondada parte a parte, como no gerador);
 *   3. cada DESPESA do dono que vence no mês (cancelada não conta): divide pelos donos;
 *   4. soma por dono.
 */
export function computeMonth(db: Db, orgId: Id, month: IsoDate): Map<Id, OwnerMonth> {
  // 1.
  const L = lookup(db)
  const fees = managementFeeMap(db, orgId)
  const entryById = new Map(db.financial_entries.map((e) => [e.id, e]))
  const out = new Map<Id, OwnerMonth>()
  const of = (id: Id) => {
    let m = out.get(id)
    if (!m) out.set(id, (m = { owner_id: id, ...ZERO, lines: [] }))
    return m
  }
  // 2.
  for (const p of db.payments) {
    const e = entryById.get(p.entry_id)
    if (!e || e.organization_id !== orgId || e.category !== 'rent' || !e.unit_id || monthStart(p.paid_at) !== month) continue
    const u = L.unit.get(e.unit_id)
    if (!u) continue
    const owners = ownersOf(L, u, p.paid_at)
    splitByShares(p.amount_cents, owners.map((o) => o.share_pct)).forEach((part, i) => {
      const o = owners[i]
      const feePct = fees.get(`${o.person_id}:${u.property_id}`)?.pct ?? DEFAULT_ADMIN_FEE_PCT
      const fee = applyPct(part, feePct)
      const m = of(o.person_id)
      m.gross += part
      m.fee += fee
      m.lines.push({ kind: 'rent', date: p.paid_at, description: e.description, unit_label: unitLabel(L, u), total_cents: p.amount_cents, share_pct: o.share_pct, part_cents: part, fee_pct: feePct, fee_cents: fee })
    })
  }
  // 3.
  for (const e of db.financial_entries) {
    if (e.organization_id !== orgId || e.direction !== 'payable' || e.charged_to !== 'owner' || e.status === 'canceled' || !e.unit_id || monthStart(e.due_date) !== month) continue
    const u = L.unit.get(e.unit_id)
    if (!u) continue
    const owners = ownersOf(L, u, e.due_date)
    splitByShares(e.amount_cents, owners.map((o) => o.share_pct)).forEach((part, i) => {
      const m = of(owners[i].person_id)
      m.expenses += part
      m.lines.push({ kind: 'expense', date: e.due_date, description: e.description, unit_label: unitLabel(L, u), total_cents: e.amount_cents, share_pct: owners[i].share_pct, part_cents: part, fee_pct: 0, fee_cents: 0 })
    })
  }
  // 4.
  for (const m of out.values()) {
    m.net = m.gross - m.fee - m.expenses
    m.lines.sort((a, b) => (a.kind === b.kind ? (a.date < b.date ? -1 : 1) : a.kind === 'rent' ? -1 : 1))
  }
  return out
}

function sumOf(ts: OwnerTransfer[]): Amounts {
  return ts.reduce<Amounts>((a, t) => ({ gross: a.gross + t.gross_cents, fee: a.fee + t.admin_fee_cents, expenses: a.expenses + t.expenses_cents, net: a.net + t.net_cents }), ZERO)
}

/* ---------------------------------------------------------------- escopo e lista */

/**
 * Quem vê qual repasse (owner_transfers não tem regra em scope.ts, então a regra mora aqui,
 * como manda o CONVENCOES): a equipe vê os da conta; o proprietário, só os dele; mais ninguém.
 */
function visibleTransfers(db: Db, sc: Scope, s: Session): OwnerTransfer[] {
  const mine = db.owner_transfers.filter((t) => t.organization_id === s.org.id)
  if (sc.all) return mine
  if (sc.role === 'owner' && sc.personId) return mine.filter((t) => t.owner_person_id === sc.personId)
  throw new AccessError('Repasse é do proprietário e da equipe da imobiliária.')
}

function assertAgency(s: Session): void {
  if (!hasFeature(s, 'transfers')) throw new RuleError('Repasse só existe em conta de imobiliária: na conta do proprietário independente o aluguel entra direto para o dono.')
}

export interface TransferRow extends OwnerTransfer {
  owner_name: string
  /** Há outro repasse do mesmo dono e mês, criado antes deste: este é o complemento. */
  complement: boolean
}

export interface TransferTotals {
  draft: Cents
  approved: Cents
  paid: Cents
  count: number
}

function toRows(db: Db, ts: OwnerTransfer[]): TransferRow[] {
  const names = new Map(db.people.map((p) => [p.id, p.name]))
  return ts.map((t) => ({
    ...t,
    owner_name: names.get(t.owner_person_id) ?? 'Proprietário',
    complement: ts.some((o) => o.id !== t.id && o.owner_person_id === t.owner_person_id && o.month === t.month && o.created_at < t.created_at),
  }))
}

/**
 * Lista de repasses. Filtros: month ('AAAA-MM'), status, owner. Ordens: owner, month, gross, fee, expenses, net.
 * Devolve também os totais do recorte inteiro (não só da página) e os donos para o filtro.
 */
export async function listTransfers(s: Session, params: ListParams): Promise<ListResult<TransferRow> & { totals: TransferTotals; owners: { value: Id; label: string }[] }> {
  const { db, sc } = await connect(s)
  assertAgency(s)
  const rows = toRows(db, visibleTransfers(db, sc, s))
  const cfg = {
    search: (r: TransferRow) => [r.owner_name, formatMonth(r.month)],
    filters: { month: (r: TransferRow) => r.month.slice(0, 7), status: (r: TransferRow) => r.status, owner: (r: TransferRow) => r.owner_person_id },
    sorts: {
      owner: (r: TransferRow) => r.owner_name, month: (r: TransferRow) => r.month, gross: (r: TransferRow) => r.gross_cents,
      fee: (r: TransferRow) => r.admin_fee_cents, expenses: (r: TransferRow) => r.expenses_cents, net: (r: TransferRow) => r.net_cents,
    },
    defaultSort: (a: TransferRow, b: TransferRow) => (a.month === b.month ? a.owner_name.localeCompare(b.owner_name, 'pt-BR') : a.month < b.month ? 1 : -1),
  }
  const all = runList(rows, { ...params, page: 1, pageSize: Number.MAX_SAFE_INTEGER }, cfg).rows
  const totals: TransferTotals = { draft: 0, approved: 0, paid: 0, count: all.length }
  for (const r of all) totals[r.status] += r.net_cents
  const owners = [...new Map(rows.map((r) => [r.owner_person_id, r.owner_name])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  return { ...runList(rows, params, cfg), totals, owners }
}

export interface TransferStatement {
  transfer: TransferRow
  /** Linhas do mês inteiro deste dono, recalculadas hoje. */
  lines: StatementLine[]
  /** O mês inteiro (todas as linhas). */
  month: Amounts
  /** Outros repasses do mesmo dono e mês (complemento ou o original). */
  siblings: TransferRow[]
  /** Mês recalculado hoje MENOS a soma dos repasses gravados do mês (zero = fecha). */
  pending: Amounts
}

/** Demonstrativo: as linhas que formam o mês do dono, com fatia e taxa de cada uma. */
export async function getTransferStatement(s: Session, id: Id): Promise<TransferStatement> {
  const { db, sc } = await connect(s)
  assertAgency(s)
  const visible = visibleTransfers(db, sc, s)
  const t = visible.find((x) => x.id === id)
  if (!t) throw new AccessError('Repasse não encontrado ou fora do seu acesso.')
  const sameMonth = visible.filter((x) => x.owner_person_id === t.owner_person_id && x.month === t.month)
  const rows = toRows(db, sameMonth)
  const m = computeMonth(db, s.org.id, t.month).get(t.owner_person_id)
  const month: Amounts = m ? { gross: m.gross, fee: m.fee, expenses: m.expenses, net: m.net } : ZERO
  const recorded = sumOf(sameMonth)
  return {
    transfer: rows.find((r) => r.id === id)!,
    lines: m?.lines ?? [],
    month,
    siblings: rows.filter((r) => r.id !== id),
    pending: { gross: month.gross - recorded.gross, fee: month.fee - recorded.fee, expenses: month.expenses - recorded.expenses, net: month.net - recorded.net },
  }
}

/* ---------------------------------------------------------------- gravações */

/** Quantos meses para trás o recálculo olha (a mesma janela dos repasses fictícios). */
export const RECALC_MONTHS_BACK = 6

/**
 * "Recalcular rascunho": refaz o rascunho do mês corrente e, nos 6 meses anteriores, cria o
 * complemento quando entrou dinheiro depois da aprovação (pagamento registrado com data antiga).
 * Passo a passo, para cada mês e cada dono:
 *   1. o mês recalculado (computeMonth);
 *   2. menos o que já foi aprovado ou pago para aquele dono e mês;
 *   3. a diferença vira (ou atualiza) o RASCUNHO; diferença zero sem rascunho = nada a fazer.
 * Só mexe em rascunho: aprovado e pago nunca mudam (são o que foi combinado e pago).
 * Rodar duas vezes seguidas não muda nada na segunda.
 */
export async function recalcTransferDrafts(s: Session): Promise<{ changed: number; months: IsoDate[] }> {
  const { db, sc } = await connect(s)
  assertAgency(s)
  if (!sc.all || !can(s, 'finance:edit')) throw new AccessError('Recalcular repasse pede a permissão de editar o financeiro.')
  const current = monthStart(s.today)
  const changed: OwnerTransfer[] = []
  for (let i = RECALC_MONTHS_BACK; i >= 0; i--) {
    const M = addMonths(current, -i)
    const computed = computeMonth(db, s.org.id, M)
    const existing = db.owner_transfers.filter((t) => t.organization_id === s.org.id && t.month === M)
    for (const owner of new Set([...computed.keys(), ...existing.map((t) => t.owner_person_id)])) {
      // 1. e 2.
      const c = computed.get(owner) ?? { ...ZERO }
      const closed = sumOf(existing.filter((t) => t.owner_person_id === owner && t.status !== 'draft'))
      const left = { gross: c.gross - closed.gross, fee: c.fee - closed.fee, expenses: c.expenses - closed.expenses }
      const net = left.gross - left.fee - left.expenses
      const draft = existing.find((t) => t.owner_person_id === owner && t.status === 'draft')
      // 3.
      if (!draft && left.gross === 0 && left.fee === 0 && left.expenses === 0) continue
      if (draft && draft.gross_cents === left.gross && draft.admin_fee_cents === left.fee && draft.expenses_cents === left.expenses) continue
      const now = nowIso()
      changed.push({
        ...(draft ?? { id: newId(), organization_id: s.org.id, created_at: now, created_by: s.user.id, owner_person_id: owner, month: M, status: 'draft' as const, approved_by: null, approved_at: null, paid_at: null }),
        updated_at: now, gross_cents: left.gross, admin_fee_cents: left.fee, expenses_cents: left.expenses, net_cents: net,
      })
    }
  }
  if (changed.length) {
    upsertRows('owner_transfers', changed)
    audit(s, 'owner_transfers', changed[0].id, 'update', `Recalculou ${changed.length} ${changed.length === 1 ? 'rascunho' : 'rascunhos'} de repasse`)
  }
  return { changed: changed.length, months: [...new Set(changed.map((t) => t.month))].sort() }
}

/**
 * As contas que o repasse gera (as que ainda não existem): a conta a PAGAR ao dono (o líquido) e
 * a taxa de administração a RECEBER dele (retida no próprio repasse). Vencem no dia 10 do mês
 * seguinte, como nos dados fictícios; repasse de mês antigo vence hoje.
 */
function transferEntries(db: Db, s: Session, t: OwnerTransfer, complement: boolean): FinancialEntry[] {
  const have = db.financial_entries.filter((e) => e.transfer_id === t.id)
  const payday = dueDateFor(addMonths(t.month, 1), 10)
  const due = payday < s.today ? s.today : payday
  const suffix = complement ? ' (complementar)' : ''
  const now = nowIso()
  const base = {
    organization_id: t.organization_id, created_at: now, updated_at: now, created_by: s.user.id, contract_id: null, unit_id: null, property_id: null,
    person_id: t.owner_person_id, competence: t.month, due_date: due, charged_to: null, status: 'open' as const, recurrence_group: null, transfer_id: t.id, import_batch_id: null,
  }
  const out: FinancialEntry[] = []
  if (t.net_cents > 0 && !have.some((e) => e.category === 'transfer')) {
    out.push({ ...base, id: newId(), direction: 'payable', category: 'transfer', description: `Repasse ${formatMonth(t.month)}${suffix}`, amount_cents: t.net_cents })
  }
  if (t.admin_fee_cents > 0 && !have.some((e) => e.category === 'admin_fee')) {
    out.push({ ...base, id: newId(), direction: 'receivable', category: 'admin_fee', description: `Taxa de administração ${formatMonth(t.month)}${suffix}`, amount_cents: t.admin_fee_cents })
  }
  return out
}

/** Aprovar (transfers:approve): o rascunho vira o valor combinado e nascem as contas do repasse. */
export async function approveTransfer(s: Session, args: { id: Id }): Promise<OwnerTransfer> {
  const { db, sc } = await connect(s)
  assertAgency(s)
  if (!sc.all || !can(s, 'transfers:approve')) throw new AccessError('Aprovar repasse pede a permissão de aprovação de repasses.')
  const t = db.owner_transfers.find((x) => x.id === args.id && x.organization_id === s.org.id)
  if (!t) throw new AccessError('Repasse não encontrado ou fora do seu acesso.')
  if (t.status !== 'draft') throw new RuleError(`Este repasse já está ${t.status === 'approved' ? 'aprovado' : 'pago'}.`)
  const next: OwnerTransfer = { ...t, status: 'approved', approved_by: s.user.id, approved_at: nowIso(), updated_at: nowIso() }
  const complement = toRows(db, db.owner_transfers.filter((x) => x.organization_id === s.org.id)).find((r) => r.id === t.id)?.complement ?? false
  const entries = transferEntries(db, s, next, complement)
  upsertRows('owner_transfers', [next])
  if (entries.length) upsertRows('financial_entries', entries)
  audit(s, 'owner_transfers', t.id, 'approve', `Aprovou o repasse de ${formatMonth(t.month)} (${formatBRL(t.net_cents)})`, { status: { from: 'draft', to: 'approved' } })
  return next
}

/**
 * Marcar como pago: cria a conta a pagar do repasse se faltar (repasse antigo) e quita as duas contas
 * dele (o líquido pago ao dono e a taxa retida). Líquido zero ou negativo não gera pagamento:
 * as despesas passaram do aluguel do mês e nada é transferido.
 */
export async function markTransferPaid(s: Session, args: { id: Id }): Promise<OwnerTransfer> {
  const { db, sc } = await connect(s)
  assertAgency(s)
  if (!sc.all || !can(s, 'finance:edit')) throw new AccessError('Pagar repasse pede a permissão de editar o financeiro.')
  const t = db.owner_transfers.find((x) => x.id === args.id && x.organization_id === s.org.id)
  if (!t) throw new AccessError('Repasse não encontrado ou fora do seu acesso.')
  if (t.status === 'draft') throw new RuleError('Aprove o repasse antes de pagar: o rascunho ainda pode mudar no recálculo.')
  if (t.status === 'paid') throw new RuleError('Este repasse já está pago.')
  const complement = toRows(db, db.owner_transfers.filter((x) => x.organization_id === s.org.id)).find((r) => r.id === t.id)?.complement ?? false
  const created = transferEntries(db, s, t, complement)
  if (created.length) upsertRows('financial_entries', created)
  const now = nowIso()
  const paidSoFar = new Map<Id, number>()
  for (const p of db.payments) paidSoFar.set(p.entry_id, (paidSoFar.get(p.entry_id) ?? 0) + p.amount_cents)
  const payments: Payment[] = []
  const settled: FinancialEntry[] = []
  // upsertRows já colocou as contas recém-criadas na tabela: o filtro abaixo pega as antigas e as novas.
  for (const e of db.financial_entries.filter((x) => x.transfer_id === t.id)) {
    if (e.status !== 'open') continue
    const left = e.amount_cents - (paidSoFar.get(e.id) ?? 0)
    if (left > 0) {
      const transfer = e.category === 'transfer'
      payments.push({
        id: newId(), organization_id: e.organization_id, created_at: now, updated_at: now, created_by: s.user.id, entry_id: e.id, paid_at: s.today,
        amount_cents: left, method: transfer ? 'transfer' : 'other', reference: transfer ? `Repasse ${formatMonth(t.month)}` : 'Retida no repasse',
      })
    }
    settled.push({ ...e, status: 'paid', updated_at: now })
  }
  const next: OwnerTransfer = { ...t, status: 'paid', paid_at: s.today, updated_at: now }
  if (payments.length) upsertRows('payments', payments)
  if (settled.length) upsertRows('financial_entries', settled)
  upsertRows('owner_transfers', [next])
  audit(s, 'owner_transfers', t.id, 'payment', `Pagou o repasse de ${formatMonth(t.month)} (${formatBRL(Math.max(t.net_cents, 0))})`, { status: { from: 'approved', to: 'paid' } })
  return next
}
