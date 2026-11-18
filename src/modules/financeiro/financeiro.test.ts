// Testes do financeiro: baixa (inclusive parcial), lançamento em série, cancelamento e repasse.
// Rodar: npx vitest run src/modules/financeiro
import { describe, expect, it } from 'vitest'
import { buildSession } from '@/auth/session'
import { AccessError, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { ORG, USER } from '@/data/seed'
import { resetForTest } from '@/data/store'
import type { FinancialEntry } from '@/data/types'
import { listEntries } from '@/data/views/finance'
import { monthStart } from '@/lib/dates'
import { cancelEntry, createEntries, registerPayment, restoreEntry, type NewEntryInput } from './repo'
import { approveTransfer, computeMonth, getTransferStatement, listTransfers, markTransferPaid, recalcTransferDrafts } from './repasses'

const TODAY = '2026-11-04'
const MONTH = '2026-11-01'

function setup() {
  const db = resetForTest(TODAY)
  const as = (userId: string) => {
    const s = buildSession(db, userId)!
    s.today = TODAY
    return s
  }
  return { db, as }
}

/** Aluguel em aberto e sem nenhum pagamento (da unidade pedida, se houver). */
function openRent(db: Db, unitId?: string): FinancialEntry {
  return db.financial_entries.find(
    (e) => e.organization_id === ORG.agency && e.category === 'rent' && e.status === 'open' && (!unitId || e.unit_id === unitId) && !db.payments.some((p) => p.entry_id === e.id),
  )!
}

const pay = (entry_id: string, amount_cents: number, paid_at = TODAY) => ({ entry_id, amount_cents, paid_at, method: 'pix' as const, reference: '' })

describe('baixa', () => {
  it('baixa parcial deixa o saldo em aberto; a segunda baixa quita', async () => {
    const { db, as } = setup()
    const s = as(USER.staff) // Bruno: colaborador do financeiro, com finance:edit
    const e = openRent(db)
    const half = Math.floor(e.amount_cents / 2)
    const r1 = await registerPayment(s, pay(e.id, half))
    expect(r1.entry.status).toBe('open')
    expect(r1.open_cents).toBe(e.amount_cents - half)
    const row = (await listEntries(s, { filters: { contract: [e.contract_id!] }, pageSize: 500 })).rows.find((x) => x.id === e.id)!
    expect(row.paid_cents).toBe(half)
    expect(row.open_cents).toBe(e.amount_cents - half)
    await expect(registerPayment(s, pay(e.id, e.amount_cents))).rejects.toThrow('passa do saldo')
    const r2 = await registerPayment(s, pay(e.id, e.amount_cents - half))
    expect(r2.entry.status).toBe('paid')
    expect(r2.open_cents).toBe(0)
  })

  it('recusa data no futuro, valor zero, lançamento quitado e quem não tem finance:edit', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const e = openRent(db)
    await expect(registerPayment(s, pay(e.id, 100, '2026-11-05'))).rejects.toThrow('futuro')
    await expect(registerPayment(s, pay(e.id, 0))).rejects.toThrow()
    const paid = db.financial_entries.find((x) => x.organization_id === ORG.agency && x.status === 'paid' && !x.transfer_id)!
    await expect(registerPayment(s, pay(paid.id, 100))).rejects.toThrow(RuleError)
    for (const who of [USER.owner, USER.lessee, USER.leasing]) await expect(registerPayment(as(who), pay(e.id, 100))).rejects.toThrow(AccessError)
  })

  it('conta de repasse só se paga pela tela Repasses', async () => {
    const { db, as } = setup()
    const e = db.financial_entries.find((x) => x.category === 'transfer' && x.status === 'open')!
    await expect(registerPayment(as(USER.admin), pay(e.id, 100))).rejects.toThrow('Repasses')
  })
})

describe('lançamento', () => {
  const base = (unitId: string): NewEntryInput => ({
    direction: 'payable', category: 'iptu', description: 'IPTU 2027', person_id: null, unit_id: unitId, contract_id: null,
    competence: '2027-01', due_date: '2027-01-31', amount_cents: 18000, charged_to: 'owner', repeat: 3,
  })

  it('série mensal: mesmo grupo, numerada, e o dia 31 vira o último dia do mês curto', async () => {
    const { db, as } = setup()
    const u = db.units.find((x) => x.organization_id === ORG.agency)!
    const rows = await createEntries(as(USER.staff), base(u.id))
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((r) => r.recurrence_group)).size).toBe(1)
    expect(rows.map((r) => r.due_date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
    expect(rows.map((r) => r.competence)).toEqual(['2027-01-01', '2027-02-01', '2027-03-01'])
    expect(rows[1].description).toBe('IPTU 2027 (2/3)')
    expect(rows[0].property_id).toBe(u.property_id)
  })

  it('aluguel e repasse não se lançam à mão', async () => {
    const { db, as } = setup()
    const u = db.units.find((x) => x.organization_id === ORG.agency)!
    await expect(createEntries(as(USER.staff), { ...base(u.id), category: 'rent' })).rejects.toThrow('contrato ativado')
  })

  it('cancelar só sem pagamento; desfazer volta para em aberto', async () => {
    const { db, as } = setup()
    const s = as(USER.staff)
    const e = openRent(db)
    const c = await cancelEntry(s, { id: e.id, reason: 'Cobrança lançada em duplicidade' })
    expect(c.status).toBe('canceled')
    expect((await restoreEntry(s, { id: e.id })).status).toBe('open')
    await registerPayment(s, pay(e.id, 100))
    await expect(cancelEntry(s, { id: e.id, reason: 'Teste' })).rejects.toThrow('já tem pagamento')
  })
})

describe('repasse', () => {
  it('líquido = bruto - taxa - despesas, e a soma entre donos fecha no centavo (R$ 1.000,01 em 50/50)', async () => {
    const { db, as } = setup()
    const s = as(USER.staff)
    // A casa que Carlos divide 50/50 com Helena (Casa 07 do Condomínio Luar).
    const carlos = db.people.find((p) => p.user_id === USER.owner)!
    const share = db.property_owners.find((o) => o.person_id === carlos.id && o.share_pct === 50)!
    const house = db.units.find((u) => u.id === share.unit_id)!
    await registerPayment(s, pay(openRent(db, house.id).id, 100001))
    await recalcTransferDrafts(s)

    const month = computeMonth(db, ORG.agency, MONTH)
    const parts = [...month.values()].flatMap((m) => m.lines.filter((l) => l.total_cents === 100001)).map((l) => l.part_cents)
    expect(parts.sort()).toEqual([50000, 50001])
    // Nenhum centavo some nem aparece: soma das partes de todos os donos = soma dos aluguéis pagos no mês.
    const entryById = new Map(db.financial_entries.map((e) => [e.id, e]))
    const rentPaid = db.payments
      .filter((p) => entryById.get(p.entry_id)?.category === 'rent' && entryById.get(p.entry_id)?.organization_id === ORG.agency && monthStart(p.paid_at) === MONTH)
      .reduce((a, p) => a + p.amount_cents, 0)
    expect([...month.values()].reduce((a, m) => a + m.gross, 0)).toBe(rentPaid)
    for (const t of db.owner_transfers) expect(t.net_cents).toBe(t.gross_cents - t.admin_fee_cents - t.expenses_cents)
    const draft = db.owner_transfers.find((t) => t.owner_person_id === carlos.id && t.month === MONTH && t.status === 'draft')!
    expect(draft.gross_cents).toBe(month.get(carlos.id)!.gross)
  })

  it('recalcular nos dados fictícios não muda nada (mesma regra do gerador) e é idempotente', async () => {
    const { as } = setup()
    const s = as(USER.staff)
    expect((await recalcTransferDrafts(s)).changed).toBe(0)
    expect((await recalcTransferDrafts(s)).changed).toBe(0)
  })

  it('aprovar cria as contas do repasse, pagar quita; dinheiro que entra depois vira complemento', async () => {
    const { db, as } = setup()
    const s = as(USER.staff)
    const carlos = db.people.find((p) => p.user_id === USER.owner)!
    const a301 = db.units.find((u) => u.code === 'A-301' && u.organization_id === ORG.agency)!
    await registerPayment(s, pay(openRent(db, a301.id).id, 50000))
    await recalcTransferDrafts(s)
    const t = db.owner_transfers.find((x) => x.owner_person_id === carlos.id && x.month === MONTH && x.status === 'draft')!
    await expect(markTransferPaid(s, { id: t.id })).rejects.toThrow('Aprove')
    await approveTransfer(s, { id: t.id })
    const payable = db.financial_entries.find((e) => e.transfer_id === t.id && e.category === 'transfer')!
    expect(payable.amount_cents).toBe(t.net_cents)
    await markTransferPaid(s, { id: t.id })
    expect(db.owner_transfers.find((x) => x.id === t.id)!.status).toBe('paid')
    expect(db.financial_entries.filter((e) => e.transfer_id === t.id).every((e) => e.status === 'paid')).toBe(true)
    // Outro aluguel entra no mesmo mês depois do pagamento: o recálculo cria o complemento.
    const other = openRent(db, a301.id)
    await registerPayment(s, pay(other.id, 30000))
    await recalcTransferDrafts(s)
    const extra = db.owner_transfers.find((x) => x.owner_person_id === carlos.id && x.month === MONTH && x.status === 'draft')!
    expect(extra.gross_cents).toBe(30000)
    const st = await getTransferStatement(s, extra.id)
    expect(st.transfer.complement).toBe(true)
    expect(st.pending).toEqual({ gross: 0, fee: 0, expenses: 0, net: 0 })
  })

  it('o proprietário vê só os próprios repasses, a inquilina não vê nenhum, a conta independente não tem repasse', async () => {
    const { db, as } = setup()
    const owner = as(USER.owner)
    const list = await listTransfers(owner, { pageSize: 500 })
    expect(list.total).toBeGreaterThan(0)
    expect(list.rows.every((r) => r.owner_person_id === owner.personId)).toBe(true)
    await expect(listTransfers(as(USER.lessee), {})).rejects.toThrow(AccessError)
    await expect(listTransfers(as(USER.landlord), {})).rejects.toThrow('imobiliária')
    const t = db.owner_transfers.find((x) => x.status === 'draft')!
    await expect(approveTransfer(owner, { id: t.id })).rejects.toThrow(AccessError)
  })
})
