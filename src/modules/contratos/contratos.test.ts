// Testes das regras de contrato: sobreposição, garantia, caução, transições, cobranças, rescisão,
// reajuste, renovação, quem pode o quê, as partes da linha aberta e os endereços antigos. Rodar: npx vitest run src/modules/contratos
import { describe, expect, it } from 'vitest'
import { buildSession } from '@/auth/session'
import { AccessError, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { HOLDING_STATUSES, occupiedUnitIds } from '@/data/rules'
import { ORG, USER } from '@/data/seed'
import { resetForTest } from '@/data/store'
import type { Contract } from '@/data/types'
import { addDays, formatDate } from '@/lib/dates'
import { cpfFromBase } from '@/lib/documents'
import { contractRedirect, parseContratosSearch, personRedirect } from './endereco'
import { changeContractStatus, createLease, generateRentEntries, getContract, getUnitLeaseParties, registerAdjustment, renewContract, sortParties, type NewLeaseInput } from './repo'

const TODAY = '2026-11-04'

function setup() {
  const db = resetForTest(TODAY)
  const as = (userId: string) => {
    const s = buildSession(db, userId)!
    s.today = TODAY // o "hoje" fixo deixa o teste igual em qualquer dia
    return s
  }
  return { db, as }
}

/** Unidade da imobiliária que nenhuma locação segura (livre para um contrato novo). */
function freeUnit(db: Db) {
  return db.units.find(
    (u) => u.organization_id === ORG.agency && !u.deleted_at && u.building_id && !db.contracts.some((k) => k.unit_id === u.id && HOLDING_STATUSES.includes(k.status)),
  )!
}

function activeLease(db: Db, pred: (k: Contract) => boolean = () => true): Contract {
  return db.contracts.find((k) => k.organization_id === ORG.agency && k.kind === 'lease' && k.status === 'active' && pred(k))!
}

/** Locação válida com um locatário novo (CPF com dígito verificador certo). */
function input(unitId: string, extra: Partial<NewLeaseInput> = {}): NewLeaseInput {
  return {
    unit_id: unitId,
    lessee: { new_person: { kind: 'PF', name: 'Pessoa de Teste', document: cpfFromBase('123456789'), email: '', phone: '' } },
    rent_cents: 250000, due_day: 10, start_date: '2026-12-01', months: 30, adjustment_index: 'IPCA', adjustment_month: 12,
    late_fee_pct: 10, interest_pct_month: 1, guarantee_type: 'insurance', deposit_cents: 0, guarantor: null, notes: '',
    ...extra,
  }
}

async function activate(s: ReturnType<ReturnType<typeof setup>['as']>, id: string) {
  for (const to of ['in_review', 'awaiting_approval', 'awaiting_signature', 'active'] as const) await changeContractStatus(s, { id, to, note: '' })
}

describe('criar locação', () => {
  it('recusa período que cruza com outra locação que segura a unidade, com o código e o período na mensagem', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const k = activeLease(db, (x) => x.end_date > '2027-03-01')
    const clash = input(k.unit_id!, { start_date: addDays(k.end_date, -40) })
    await expect(createLease(s, clash)).rejects.toThrow(RuleError)
    await expect(createLease(s, clash)).rejects.toThrow(k.code)
    await expect(createLease(s, clash)).rejects.toThrow(`${formatDate(k.start_date)} a ${formatDate(k.end_date)}`)
    // Começar no dia seguinte ao fim passa (e nada foi gravado pelas tentativas recusadas).
    const ok = await createLease(s, input(k.unit_id!, { start_date: addDays(k.end_date, 1) }))
    expect(ok.status).toBe('draft')
    expect(db.people.filter((p) => p.name === 'Pessoa de Teste')).toHaveLength(1)
  })

  it('aceita uma garantia só (Lei 8.245, art. 37)', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const u = freeUnit(db)
    const someone = db.people.find((p) => p.organization_id === ORG.agency && p.tags.includes('syndic'))!
    await expect(createLease(s, input(u.id, { guarantee_type: 'insurance', deposit_cents: 100000 }))).rejects.toThrow('uma garantia só')
    await expect(createLease(s, input(u.id, { guarantee_type: 'deposit', deposit_cents: 100000, guarantor: { person_id: someone.id } }))).rejects.toThrow('uma garantia só')
    await expect(createLease(s, input(u.id, { guarantee_type: 'guarantor' }))).rejects.toThrow('Fiador escolhido sem pessoa')
    const k = await createLease(s, input(u.id, { guarantee_type: 'guarantor', guarantor: { person_id: someone.id } }))
    expect(db.contract_parties.filter((p) => p.contract_id === k.id).map((p) => p.role).sort()).toEqual(['guarantor', 'lessee', 'lessor'])
  })

  it('caução de até 3 aluguéis (Lei 8.245, art. 38)', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const u = freeUnit(db)
    await expect(createLease(s, input(u.id, { guarantee_type: 'deposit', deposit_cents: 750001 }))).rejects.toThrow('3 aluguéis')
    const k = await createLease(s, input(u.id, { guarantee_type: 'deposit', deposit_cents: 750000 }))
    expect(k.deposit_cents).toBe(750000)
  })

  it('locadores são os donos da unidade com a fatia; documento repetido é recusado', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const u = freeUnit(db)
    const k = await createLease(s, input(u.id))
    const owners = db.property_owners.filter((o) => o.unit_id === u.id)
    const lessors = db.contract_parties.filter((p) => p.contract_id === k.id && p.role === 'lessor')
    expect(lessors.map((p) => [p.person_id, p.share_pct]).sort()).toEqual(owners.map((o) => [o.person_id, o.share_pct]).sort())
    // A mesma pessoa nova de novo: o CPF já existe na conta.
    await expect(createLease(s, input(freeUnit(db).id, { start_date: '2027-01-01' }))).rejects.toThrow('Já existe Pessoa de Teste')
  })

  it('só a equipe com contracts:edit cria (financeiro, proprietário e inquilina não)', async () => {
    const { db, as } = setup()
    const u = freeUnit(db)
    for (const who of [USER.staff, USER.owner, USER.lessee]) await expect(createLease(as(who), input(u.id))).rejects.toThrow(AccessError)
  })
})

describe('situação do contrato', () => {
  it('ativar gera as cobranças mensais (dia 31 vira 28/02) e gerar de novo não duplica', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const k = await createLease(s, input(freeUnit(db).id, { due_day: 31 }))
    await activate(s, k.id)
    const rent = () => db.financial_entries.filter((e) => e.recurrence_group === k.id && e.category === 'rent')
    // Horizonte: do início (dez/2026) até 12 meses depois dele = 13 competências.
    expect(rent()).toHaveLength(13)
    expect(new Set(rent().map((e) => e.competence)).size).toBe(13)
    expect(rent().find((e) => e.competence === '2027-02-01')!.due_date).toBe('2027-02-28')
    expect(rent().find((e) => e.competence === '2027-03-01')!.due_date).toBe('2027-03-31')
    expect((await generateRentEntries(s, { id: k.id })).created).toBe(0)
    expect((await generateRentEntries(s, { id: k.id })).created).toBe(0)
    expect(rent()).toHaveLength(13)
  })

  it('num contrato fictício vigente, gerar continua a série sem recriar meses antigos', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const k = activeLease(db, (x) => x.end_date > '2028-01-01')
    const before = db.financial_entries.filter((e) => e.recurrence_group === k.id)
    const last = before.reduce((m, e) => (e.competence > m ? e.competence : m), '')
    const r = await generateRentEntries(s, { id: k.id })
    const after = db.financial_entries.filter((e) => e.recurrence_group === k.id)
    expect(after).toHaveLength(before.length + r.created)
    expect(after.filter((e) => !before.includes(e)).every((e) => e.competence > last)).toBe(true)
    expect(new Set(after.map((e) => e.competence)).size).toBe(after.length)
    expect((await generateRentEntries(s, { id: k.id })).created).toBe(0)
  })

  it('caminho fora de CONTRACT_TRANSITIONS é recusado', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const k = await createLease(s, input(freeUnit(db).id))
    await expect(changeContractStatus(s, { id: k.id, to: 'active', note: '' })).rejects.toThrow('Caminhos possíveis')
  })

  it('aprovar pede contracts:approve; a equipe de locação envia mas não aprova', async () => {
    const { db, as } = setup()
    const leasing = as(USER.leasing)
    const k = await createLease(leasing, input(freeUnit(db).id))
    await changeContractStatus(leasing, { id: k.id, to: 'in_review', note: '' })
    await changeContractStatus(leasing, { id: k.id, to: 'awaiting_approval', note: '' })
    await expect(changeContractStatus(leasing, { id: k.id, to: 'awaiting_signature', note: '' })).rejects.toThrow(AccessError)
    await expect(changeContractStatus(as(USER.staff), { id: k.id, to: 'in_review', note: '' })).rejects.toThrow(AccessError)
    const r = await changeContractStatus(as(USER.admin), { id: k.id, to: 'awaiting_signature', note: '' })
    expect(r.contract.approved_by).toBe(USER.admin)
    expect(r.contract.reviewed_by).toBe(USER.leasing)
  })

  it('duas propostas para o mesmo período: a segunda não chega a "aguardando assinatura"', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const u = freeUnit(db)
    const a = await createLease(s, input(u.id))
    const b = await createLease(s, input(u.id, { lessee: { new_person: { kind: 'PF', name: 'Outra Pessoa', document: cpfFromBase('987654321'), email: '', phone: '' } } }))
    for (const to of ['in_review', 'awaiting_approval', 'awaiting_signature'] as const) await changeContractStatus(s, { id: a.id, to, note: '' })
    await changeContractStatus(s, { id: b.id, to: 'in_review', note: '' })
    await changeContractStatus(s, { id: b.id, to: 'awaiting_approval', note: '' })
    await expect(changeContractStatus(s, { id: b.id, to: 'awaiting_signature', note: '' })).rejects.toThrow(a.code)
  })

  it('rescindir: fim vira o dia da saída, cobranças futuras em aberto são canceladas, a unidade fica livre', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const k = activeLease(db, (x) => x.end_date > '2027-06-01' && x.start_date < '2026-10-01')
    await expect(changeContractStatus(s, { id: k.id, to: 'terminated', note: 'Mudança de cidade', date: addDays(TODAY, 3) })).rejects.toThrow('dia da saída')
    await expect(changeContractStatus(s, { id: k.id, to: 'terminated', note: '', date: TODAY })).rejects.toThrow('motivo')
    const r = await changeContractStatus(s, { id: k.id, to: 'terminated', note: 'Mudança de cidade', date: TODAY })
    expect(r.contract.end_date).toBe(TODAY)
    expect(r.canceled).toBeGreaterThan(0)
    const open = db.financial_entries.filter((e) => e.contract_id === k.id && e.status === 'open' && e.competence > '2026-11-01')
    expect(open.every((e) => db.payments.some((p) => p.entry_id === e.id))).toBe(true)
    const ev = db.contract_events.find((e) => e.contract_id === k.id && e.to_status === 'terminated')!
    expect(ev.payload.planned_end).toBe(k.end_date)
    expect(occupiedUnitIds(db, TODAY).has(k.unit_id!)).toBe(false)
  })

  it('encerrar só depois do fim do prazo', async () => {
    const { db, as } = setup()
    const k = activeLease(db, (x) => x.end_date > TODAY)
    await expect(changeContractStatus(as(USER.admin), { id: k.id, to: 'ended', note: '' })).rejects.toThrow('Rescindir')
  })
})

describe('reajuste e renovação', () => {
  it('reajuste uma vez por ano; o aluguel novo vale para as cobranças em aberto a partir da data', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const k = await createLease(s, input(freeUnit(db).id))
    await activate(s, k.id)
    await expect(registerAdjustment(s, { id: k.id, index: 'IPCA', pct: 4.5, effective_date: '2027-06-01', note: '' })).rejects.toThrow('01/12/2027')
    const r = await registerAdjustment(s, { id: k.id, index: 'IPCA', pct: 4.5, effective_date: '2027-12-01', note: '' })
    expect(r.contract.rent_cents).toBe(261250)
    const dec = db.financial_entries.find((e) => e.recurrence_group === k.id && e.competence === '2027-12-01')!
    const nov = db.financial_entries.find((e) => e.recurrence_group === k.id && e.competence === '2027-11-01')!
    expect(dec.amount_cents).toBe(261250)
    expect(nov.amount_cents).toBe(250000)
  })

  it('renovar cria rascunho ligado ao anterior, começando no dia seguinte ao fim; não renova duas vezes', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const k = activeLease(db, (x) => !db.contracts.some((c) => c.parent_contract_id === x.id))
    const n = await renewContract(s, { id: k.id })
    expect(n.status).toBe('draft')
    expect(n.parent_contract_id).toBe(k.id)
    expect(n.start_date).toBe(addDays(k.end_date, 1))
    expect(n.rent_cents).toBe(k.rent_cents)
    expect(db.contract_parties.some((p) => p.contract_id === n.id && p.role === 'lessee')).toBe(true)
    await expect(renewContract(s, { id: k.id })).rejects.toThrow(n.code)
  })
})

describe('escopo do detalhe', () => {
  it('a inquilina abre o próprio contrato sem as observações internas e não abre o de outra pessoa', async () => {
    const { db, as } = setup()
    const s = as(USER.lessee)
    const mine = db.contract_parties.find((p) => p.person_id === s.personId && p.role === 'lessee')!
    const v = await getContract(s, mine.contract_id)
    expect(v.events.some((e) => e.kind === 'note')).toBe(false)
    expect(v.parties.filter((p) => p.person_id !== s.personId).every((p) => p.document === '' && p.email === '')).toBe(true)
    const other = activeLease(db, (k) => k.id !== mine.contract_id)
    await expect(getContract(s, other.id)).rejects.toThrow(AccessError)
  })
})

describe('linha aberta do contrato (partes por contrato)', () => {
  it('a locação da B-203: Daniela locatária, os donos da unidade como locadores, na ordem locador, locatário, fiador', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const daniela = db.people.find((p) => p.user_id === USER.lessee)!
    const b203 = db.units.find((u) => u.code === 'B-203')!
    const k = db.contracts.find((x) => x.unit_id === b203.id && x.status === 'active')!
    const v = await getContract(s, k.id)
    expect(v.parties.find((p) => p.role === 'lessee')?.person_id).toBe(daniela.id)
    // As partes da linha aberta são exatamente as do banco (nenhuma some, nenhuma inventada).
    expect(v.parties.map((p) => p.id).sort()).toEqual(db.contract_parties.filter((cp) => cp.contract_id === k.id).map((cp) => cp.id).sort())
    const order = ['lessor', 'lessee', 'guarantor', 'representative']
    expect(v.parties.every((p, i, all) => i === 0 || order.indexOf(all[i - 1].role) <= order.indexOf(p.role))).toBe(true)
    expect(v.parties.some((p) => p.role === 'lessor')).toBe(true)
  })

  it('partes da locação vigente pela unidade: as mesmas do contrato; unidade vaga devolve vazio; outra conta é recusada', async () => {
    const { db, as } = setup()
    const s = as(USER.admin)
    const b203 = db.units.find((u) => u.code === 'B-203')!
    const k = db.contracts.find((x) => x.unit_id === b203.id && x.status === 'active')!
    expect((await getUnitLeaseParties(s, b203.id)).map((p) => p.id)).toEqual((await getContract(s, k.id)).parties.map((p) => p.id))
    expect(await getUnitLeaseParties(s, freeUnit(db).id)).toEqual([])
    const sala = db.units.find((u) => u.organization_id === ORG.landlord)!
    await expect(getUnitLeaseParties(s, sala.id)).rejects.toThrow(AccessError)
  })

  it('sortParties: papel primeiro, depois a maior fatia, depois o nome', () => {
    const p = (role: 'lessor' | 'lessee' | 'guarantor', name: string, share_pct: number | null) => ({ role, name, share_pct })
    const out = sortParties([p('guarantor', 'Zeca', null), p('lessee', 'Bia', null), p('lessor', 'Ana', 30), p('lessor', 'Caio', 70), p('lessor', 'Beto', 30)])
    expect(out.map((x) => x.name)).toEqual(['Caio', 'Ana', 'Beto', 'Bia', 'Zeca'])
  })
})

describe('endereço de Contratos e pessoas e os endereços antigos', () => {
  it('lê só o que conhece: lista=pessoas, ids curtos, aba curta; "lista=contratos" é o padrão e sai', () => {
    expect(parseContratosSearch({})).toEqual({})
    expect(parseContratosSearch({ lista: 'contratos' })).toEqual({})
    expect(parseContratosSearch({ lista: 'pessoas', pessoa: 'p1', aba: 'historico' })).toEqual({ lista: 'pessoas', pessoa: 'p1', aba: 'historico' })
    expect(parseContratosSearch({ contrato: 'k1', pessoa: 'p1' })).toEqual({ contrato: 'k1', pessoa: 'p1' })
    expect(parseContratosSearch({ lista: 'qualquer', contrato: '', pessoa: 42, aba: 7 })).toEqual({})
    expect(parseContratosSearch({ contrato: 'x'.repeat(81) })).toEqual({})
  })

  it('/contratos/<id> vira /contratos?contrato=<id> (o contrato escolhido e aberto)', () => {
    expect(contractRedirect('k-123')).toEqual({ contrato: 'k-123' })
  })

  it('/pessoas/<id>?aba= vira a pessoa escolhida em Pessoas, com a aba de hoje', () => {
    expect(personRedirect('p-9')).toEqual({ lista: 'pessoas', pessoa: 'p-9' })
    expect(personRedirect('p-9', 'financeiro')).toEqual({ lista: 'pessoas', pessoa: 'p-9', aba: 'financeiro' })
    expect(personRedirect('p-9', 'chamados')).toEqual({ lista: 'pessoas', pessoa: 'p-9', aba: 'financeiro' })
    expect(personRedirect('p-9', 'historico')).toEqual({ lista: 'pessoas', pessoa: 'p-9', aba: 'historico' })
    // Imóveis e contratos da pessoa estão na linha aberta: a aba antiga cai na primeira dos detalhes.
    for (const old of ['imoveis', 'unidades', 'contratos', 'qualquer', 'constructor']) expect(personRedirect('p-9', old), old).toEqual({ lista: 'pessoas', pessoa: 'p-9' })
    // O que o redirecionamento devolve passa pela leitura do endereço sem perder nada.
    expect(parseContratosSearch({ ...personRedirect('p-9', 'chamados') })).toEqual(personRedirect('p-9', 'chamados'))
    expect(parseContratosSearch({ ...contractRedirect('k-1') })).toEqual(contractRedirect('k-1'))
  })
})
