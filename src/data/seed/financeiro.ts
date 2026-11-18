/* =============================================================================
   financeiro.ts: cobranças de aluguel, pagamentos, despesas de condomínio e repasses.

   Janela: dos últimos 12 meses até 2 meses à frente (o "previsto").
   Cada inquilino tem um perfil: em dia (paga até o vencimento), atrasando (paga depois)
   ou inadimplente (os últimos 1 a 3 meses em aberto, um deles pago pela metade).
   "Vencido" NÃO é gravado: é aberto + vencimento antes de hoje (ver lib/finance).
   ============================================================================= */
import { addDays, addMonths, dueDateFor, formatMonth, monthStart } from '@/lib/dates'
import { applyPct, splitByShares } from '@/lib/money'
import type { Contract, FinancialEntry, Id, IsoDate, Payment, PaymentMethod } from '../types'
import { ORG, USER } from './catalogo'
import { ownersOfUnit } from './contratos'
import { base, type Ctx } from './ctx'

function rentAt(c: Ctx, k: Contract, date: IsoDate): number {
  const h = c.rentHistory[k.id] ?? [{ from: k.start_date, cents: k.rent_cents }]
  let v = h[0].cents
  for (const step of h) if (step.from <= date) v = step.cents
  return v
}

export function newEntry(c: Ctx, orgId: Id, e: Omit<FinancialEntry, keyof ReturnType<typeof base> | 'status' | 'recurrence_group' | 'transfer_id' | 'import_batch_id'> & Partial<Pick<FinancialEntry, 'recurrence_group' | 'transfer_id'>>): FinancialEntry {
  const row: FinancialEntry = {
    ...base(c, orgId, e.due_date > c.ref ? c.ref : addDays(e.due_date, -15)),
    status: 'open', recurrence_group: null, transfer_id: null, import_batch_id: null, ...e,
  }
  c.db.financial_entries.push(row)
  return row
}

/**
 * Quanto já foi pago de cada lançamento gerado. Antes a soma refazia um filtro em TODOS os pagamentos a
 * cada pagamento novo (conta que cresce ao quadrado): com as 120 vagas (06/11) o gerador passou de
 * 3 mil pagamentos e ficou lento a ponto de estourar o tempo dos testes. A chave é a própria linha do
 * lançamento, então cada geração começa do zero e a semente continua dando os mesmos dados.
 */
const paidSoFar = new WeakMap<FinancialEntry, number>()

export function pay(c: Ctx, entry: FinancialEntry, paidAt: IsoDate, amount = entry.amount_cents, method?: PaymentMethod): Payment {
  const m = method ?? c.rng.pick<PaymentMethod>(['pix', 'pix', 'pix', 'boleto', 'boleto', 'transfer'])
  const p: Payment = {
    ...base(c, entry.organization_id, paidAt, entry.organization_id === ORG.agency ? USER.staff : USER.landlord),
    entry_id: entry.id, paid_at: paidAt, amount_cents: amount, method: m,
    reference: m === 'boleto' ? `Boleto ${c.rng.digits(6)}` : m === 'pix' ? `PIX ${c.rng.digits(8)}` : 'Transferência bancária',
  }
  c.db.payments.push(p)
  const paid = (paidSoFar.get(entry) ?? 0) + amount
  paidSoFar.set(entry, paid)
  if (paid >= entry.amount_cents) entry.status = 'paid'
  return p
}

/* ---------------------------------------------------------------- Passo 5: aluguéis e pagamentos */
export function seedRentAndPayments(c: Ctx): void {
  const { db, rng, ref } = c
  const windowStart = monthStart(addMonths(ref, -12))
  const windowEnd = monthStart(addMonths(ref, 2))
  const leases = db.contracts.filter((k) => k.kind === 'lease' && ['active', 'ended', 'terminated'].includes(k.status))

  for (const k of leases) {
    const lessee = db.contract_parties.find((p) => p.contract_id === k.id && p.role === 'lessee')!
    const profile = k.status === 'active' ? (c.payProfile[k.id] ?? 'good') : 'good'
    const entries: FinancialEntry[] = []
    let m = monthStart(k.start_date) > windowStart ? monthStart(k.start_date) : windowStart
    const last = monthStart(k.end_date) < windowEnd ? monthStart(k.end_date) : windowEnd
    while (m <= last) {
      const due = dueDateFor(m, k.due_day)
      entries.push(newEntry(c, k.organization_id, {
        direction: 'receivable', category: 'rent', description: `Aluguel ${formatMonth(m)}`,
        contract_id: k.id, unit_id: k.unit_id, property_id: k.property_id, person_id: lessee.person_id,
        competence: m, due_date: due, amount_cents: rentAt(c, k, due), charged_to: null, recurrence_group: k.id,
      }))
      m = addMonths(m, 1)
    }

    const past = entries.filter((e) => e.due_date < ref)
    const unpaid = new Set<FinancialEntry>()
    if (profile === 'delinquent') past.slice(-rng.int(1, 3)).forEach((e) => unpaid.add(e))
    for (const e of past) {
      if (unpaid.has(e)) continue
      const when = profile === 'good' ? addDays(e.due_date, -rng.int(0, 4)) : addDays(e.due_date, rng.int(2, 18))
      if (when <= ref) pay(c, e, when)
    }
    // O inadimplente pagou metade do mês mais antigo em aberto (pagamento parcial: o saldo segue aberto).
    const oldest = [...unpaid][0]
    if (oldest) {
      const when = addDays(oldest.due_date, rng.int(3, 9))
      pay(c, oldest, when > ref ? ref : when, Math.round(oldest.amount_cents / 2))
    }
    // Quem paga em dia às vezes adianta o que vence nos próximos 3 dias.
    for (const e of entries) {
      if (profile === 'good' && e.due_date >= ref && e.due_date <= addDays(ref, 3) && rng.chance(0.25)) pay(c, e, ref)
    }
  }
}

/* ---------------------------------------------------------------- Passo 5b: condomínio de unidade vaga */
/**
 * Casa ou apartamento vago num condomínio: quem paga o condomínio é o dono (a imobiliária paga e
 * desconta no repasse). A vaga de estacionamento não entra: ela é do próprio condomínio.
 * O valor muda por condomínio (casa paga mais que apartamento pequeno).
 */
const CONDO_FEE: Record<string, { payee: string; cents: number }> = {
  'Condomínio Luar': { payee: 'condoLuar', cents: 78000 },
  'Condomínio Mount Juic': { payee: 'condoMontjuic', cents: 48000 },
  'Lynx Residence': { payee: 'condoLynx', cents: 62000 },
}

export function seedVacantCondoFees(c: Ctx): void {
  const { ref } = c
  const propName = new Map(c.db.properties.map((p) => [p.id, p.name]))
  for (const p of c.plans) {
    if (p.orgId !== ORG.agency || !['available', 'maintenance'].includes(p.fate) || p.unit.kind === 'parking' || !p.unit.building_id) continue
    const fee = CONDO_FEE[propName.get(p.unit.property_id) ?? '']
    if (!fee) continue
    for (let i = 3; i >= 1; i--) {
      const m = monthStart(addMonths(ref, -i))
      const e = newEntry(c, ORG.agency, {
        direction: 'payable', category: 'condo_fee', description: `Condomínio ${formatMonth(m)} (unidade vaga)`,
        contract_id: null, unit_id: p.unit.id, property_id: p.unit.property_id, person_id: c.persons[fee.payee].id,
        competence: m, due_date: dueDateFor(m, 10), amount_cents: fee.cents, charged_to: 'owner',
      })
      pay(c, e, addDays(e.due_date, -1), e.amount_cents, 'boleto')
    }
  }
}

/* ---------------------------------------------------------------- Passo 7: repasses */
/**
 * Repasse por dono e mês (só na imobiliária): aluguel recebido no mês, rateado pela fatia de cada
 * dono, menos a taxa de administração dele, menos as despesas cobradas do dono naquele mês.
 * Meses fechados: pagos no dia 10 do mês seguinte. Mês corrente: rascunho.
 */
export function seedTransfers(c: Ctx): void {
  const { db, ref } = c
  const A = ORG.agency
  const entryById = new Map(db.financial_entries.map((e) => [e.id, e]))
  for (let i = 6; i >= 0; i--) {
    const M = monthStart(addMonths(ref, -i))
    const nextM = addMonths(M, 1)
    const acc = new Map<Id, { gross: number; fee: number; expenses: number }>()
    const get = (id: Id) => acc.get(id) ?? (acc.set(id, { gross: 0, fee: 0, expenses: 0 }), acc.get(id)!)

    for (const p of db.payments) {
      const e = entryById.get(p.entry_id)
      if (!e || e.organization_id !== A || e.category !== 'rent' || monthStart(p.paid_at) !== M) continue
      const owners = ownersOfUnit(c, e.unit_id!, e.property_id!)
      splitByShares(p.amount_cents, owners.map((o) => o.share_pct)).forEach((part, idx) => {
        const o = owners[idx]
        const t = get(o.person_id)
        t.gross += part
        t.fee += applyPct(part, c.feeByOwner[`${o.person_id}:${e.property_id}`] ?? 10)
      })
    }
    for (const e of db.financial_entries) {
      if (e.organization_id !== A || e.direction !== 'payable' || e.charged_to !== 'owner' || monthStart(e.due_date) !== M || !e.unit_id) continue
      const owners = ownersOfUnit(c, e.unit_id, e.property_id!)
      splitByShares(e.amount_cents, owners.map((o) => o.share_pct)).forEach((part, idx) => (get(owners[idx].person_id).expenses += part))
    }

    for (const [ownerId, t] of acc) {
      const net = t.gross - t.fee - t.expenses
      const payday = dueDateFor(nextM, 10)
      const status = i === 0 ? 'draft' : payday <= ref ? 'paid' : 'approved'
      // Nada nos dados pode ter data depois de "hoje": a aprovação acontece 2 dias antes do pagamento,
      // mas nunca no futuro (o repasse do mês passado, ainda não pago, foi aprovado no máximo hoje).
      const notAfterRef = (d: IsoDate) => (d > ref ? ref : d)
      const tr = {
        ...base(c, A, i === 0 ? ref : notAfterRef(addDays(payday, -3)), USER.staff),
        owner_person_id: ownerId, month: M, gross_cents: t.gross, admin_fee_cents: t.fee, expenses_cents: t.expenses, net_cents: net,
        status: status as 'draft' | 'approved' | 'paid',
        approved_by: status === 'draft' ? null : USER.admin, approved_at: status === 'draft' ? null : `${notAfterRef(addDays(payday, -2))}T10:00:00-03:00`,
        paid_at: status === 'paid' ? payday : null,
      }
      db.owner_transfers.push(tr)
      if (i === 0) continue
      // O repasse vira uma conta a pagar ao dono; a taxa vira receita da imobiliária.
      const out = newEntry(c, A, {
        direction: 'payable', category: 'transfer', description: `Repasse ${formatMonth(M)}`, contract_id: null, unit_id: null,
        property_id: null, person_id: ownerId, competence: M, due_date: payday, amount_cents: Math.max(net, 0), charged_to: null, transfer_id: tr.id,
      })
      const fee = newEntry(c, A, {
        direction: 'receivable', category: 'admin_fee', description: `Taxa de administração ${formatMonth(M)}`, contract_id: null, unit_id: null,
        property_id: null, person_id: ownerId, competence: M, due_date: payday, amount_cents: t.fee, charged_to: null, transfer_id: tr.id,
      })
      if (status === 'paid') {
        if (out.amount_cents > 0) pay(c, out, payday, out.amount_cents, 'transfer')
        else out.status = 'paid'
        pay(c, fee, payday, fee.amount_cents, 'other')
      }
    }
  }
}
