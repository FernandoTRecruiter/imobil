// Testes dos números de relacionamento (07/11/2026): cliente desde, tempo de contrato, pontualidade,
// renovações e quem vê o cadastro de moradia (no portal, só o próprio). Rodar: npx vitest run src/data/views
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { USER } from '@/data/seed'
import { getDb, resetForTest } from '@/data/store'
import type { Contract, ContractParty, FinancialEntry, Payment } from '@/data/types'
import { canSeeHousehold, clientSinceMap, contractTerm, lesseeSinceMap, monthsSince, punctualityMap, punctualityPct, renewalsOf } from './cliente'
import { listContracts, listPeople, toPersonRows } from './contracts'
import { scopeFor } from '../scope'
import { listUnits } from './units'

const TODAY = '2026-11-04'

function session(userId: string): Session {
  const s = buildSession(getDb(), userId)!
  s.today = TODAY
  return s
}

/* Linhas mínimas: só os campos que as contas leem (o resto não importa aqui). */
const k = (id: string, status: Contract['status'], start: string, end: string, parent: string | null = null) =>
  ({ id, kind: 'lease', unit_id: 'u1', status, start_date: start, end_date: end, parent_contract_id: parent }) as Contract
const party = (contract_id: string, person_id: string, role: ContractParty['role']) => ({ contract_id, person_id, role }) as ContractParty
const entry = (id: string, person_id: string, due_date: string, amount_cents: number, status: FinancialEntry['status'] = 'paid') =>
  ({ id, person_id, due_date, amount_cents, status, direction: 'receivable' }) as FinancialEntry
const pay = (entry_id: string, paid_at: string, amount_cents: number) => ({ entry_id, paid_at, amount_cents }) as Payment

describe('cliente desde e tempo como cliente', () => {
  it('é o início do PRIMEIRO contrato que aconteceu, em qualquer papel; rascunho e futuro não contam', () => {
    const contracts = [k('a', 'ended', '2022-03-10', '2023-03-09'), k('b', 'active', '2024-01-01', '2026-12-31'), k('c', 'draft', '2020-01-01', '2021-01-01'), k('d', 'active', '2027-01-01', '2028-01-01')]
    const parties = [party('a', 'fiador', 'guarantor'), party('b', 'fiador', 'lessee'), party('c', 'p2', 'lessee'), party('b', 'p3', 'lessor'), party('d', 'p4', 'lessee')]
    const m = clientSinceMap({ contracts, contract_parties: parties }, TODAY)
    expect(m.get('fiador')).toBe('2022-03-10') // o fiador de 2022 virou locatário depois: conta desde 2022
    expect(m.get('p2')).toBeUndefined() // só rascunho
    expect(m.get('p3')).toBe('2024-01-01')
    expect(m.get('p4')).toBeUndefined() // começa no futuro
    expect(monthsSince('2022-03-10', TODAY)).toBe(55)
    expect(monthsSince(null, TODAY)).toBeNull()
  })

  it('locatário desde: a renovação não zera (pega a primeira locação dele NA unidade)', () => {
    const contracts = [k('a', 'ended', '2022-03-10', '2024-09-09'), k('b', 'active', '2024-09-10', '2027-03-09', 'a')]
    const m = lesseeSinceMap({ contracts, contract_parties: [party('a', 'p1', 'lessee'), party('b', 'p1', 'lessee')] }, TODAY)
    expect(m.get('u1:p1')).toBe('2022-03-10')
  })
})

describe('tempo de contrato', () => {
  it('duração, decorrido e falta (o fim é o último dia: 01/01 a 31/12 = 12 meses)', () => {
    expect(contractTerm(k('x', 'active', '2026-01-01', '2026-12-31'), TODAY)).toEqual({ duration: 12, elapsed: 10, remaining: 1 })
    expect(contractTerm(k('x', 'active', '2024-06-15', '2026-12-14'), TODAY)).toEqual({ duration: 30, elapsed: 28, remaining: 1 })
  })
  it('encerrado não tem "falta" e o decorrido para na duração; o que ainda não começou tem 0', () => {
    expect(contractTerm(k('x', 'ended', '2023-01-01', '2023-12-31'), TODAY)).toEqual({ duration: 12, elapsed: 12, remaining: null })
    expect(contractTerm(k('x', 'awaiting_signature', '2026-12-01', '2027-11-30'), TODAY)).toEqual({ duration: 12, elapsed: 0, remaining: null })
  })
})

describe('pontualidade', () => {
  it('% das cobranças vencidas nos últimos 12 meses pagas INTEIRAS até o vencimento', () => {
    const entries = [
      entry('e1', 'p', '2026-10-10', 1000), // paga no dia: no prazo
      entry('e2', 'p', '2026-09-10', 1000), // paga depois: fora do prazo
      entry('e3', 'p', '2026-08-10', 1000, 'open'), // em aberto: fora do prazo
      entry('e4', 'p', '2026-07-10', 1000), // metade no prazo, resto depois: fora do prazo
      entry('e5', 'p', '2025-01-10', 1000), // mais de 12 meses: não conta
      entry('e6', 'p', '2026-12-10', 1000, 'open'), // ainda não venceu: não conta
      entry('e7', 'p', '2026-06-10', 1000, 'canceled'), // cancelada: não conta
    ]
    const payments = [pay('e1', '2026-10-10', 1000), pay('e2', '2026-09-15', 1000), pay('e4', '2026-07-10', 500), pay('e4', '2026-07-20', 500), pay('e5', '2025-01-01', 1000)]
    const m = punctualityMap({ financial_entries: entries, payments }, TODAY)
    expect(m.get('p')).toEqual({ onTime: 1, total: 4 })
    expect(punctualityPct(m.get('p'))).toBe(25)
    expect(punctualityPct(undefined)).toBeNull() // sem cobrança vencida: sem número (não é 100%)
  })
})

describe('renovações', () => {
  it('conta a corrente de contratos anteriores e não trava em laço', () => {
    const byId = new Map([
      ['a', { parent_contract_id: null }],
      ['b', { parent_contract_id: 'a' }],
      ['c', { parent_contract_id: 'b' }],
      ['x', { parent_contract_id: 'y' }],
      ['y', { parent_contract_id: 'x' }],
    ])
    expect(renewalsOf(byId, { parent_contract_id: null })).toBe(0)
    expect(renewalsOf(byId, byId.get('c')!)).toBe(2)
    expect(renewalsOf(byId, byId.get('x')!)).toBe(50)
  })
})

describe('nos dados de demonstração e no escopo', () => {
  beforeEach(() => {
    resetForTest(TODAY)
  })

  it('há renovações, o contrato renovado aponta para o anterior do MESMO locatário, e a coluna conta', async () => {
    const db = getDb()
    const renewed = db.contracts.filter((x) => x.parent_contract_id)
    expect(renewed.length).toBeGreaterThan(5)
    for (const x of renewed) {
      const prev = db.contracts.find((p) => p.id === x.parent_contract_id)!
      expect(prev.end_date < x.start_date, x.code).toBe(true)
      const lessee = (id: string) => db.contract_parties.find((p) => p.contract_id === id && p.role === 'lessee')?.person_id
      expect(lessee(prev.id), x.code).toBe(lessee(x.id))
    }
    const list = await listContracts(session(USER.admin), { filters: { status: ['active'] }, sort: { key: 'renewals', dir: 'desc' }, pageSize: 5 })
    expect(list.rows[0].renewals).toBeGreaterThan(0)
  })

  it('a equipe vê dependentes, animais e pontualidade; o inquilino no portal vê os dele e não os dos outros', async () => {
    const db = getDb()
    const admin = session(USER.admin)
    const people = await listPeople(admin, { pageSize: 1000 })
    expect(people.rows.some((p) => p.dependents !== null && p.dependents !== undefined)).toBe(true)
    expect(people.rows.some((p) => !!p.pets)).toBe(true)
    expect(people.rows.some((p) => p.client_since !== null && p.client_months !== null)).toBe(true)

    const lessee = session(USER.lessee)
    const sc = scopeFor(db, lessee)
    const rows = toPersonRows(db, sc, TODAY)
    const me = rows.find((p) => p.id === lessee.personId)!
    expect(me.client_since).not.toBeNull()
    for (const other of rows.filter((p) => p.id !== lessee.personId)) {
      expect(other.dependents, other.name).toBeNull()
      expect(other.pets).toBe('')
      expect(other.punctuality_pct).toBeNull()
      expect(other.client_since).toBeNull()
    }
    expect(canSeeHousehold(sc, lessee.personId)).toBe(true)
  })

  it('o proprietário no portal não vê a família do inquilino da unidade dele; a equipe vê', async () => {
    const owner = session(USER.owner)
    const units = await listUnits(owner, { filters: { status: ['occupied'] }, pageSize: 500 })
    expect(units.rows.length).toBeGreaterThan(0)
    for (const u of units.rows) {
      expect(u.lessee_dependents).toBeNull()
      expect(u.lessee_pets).toBeNull()
      expect(u.lease_elapsed_months).not.toBeNull() // o tempo de contrato é do contrato, que ele vê
    }
    const team = await listUnits(session(USER.admin), { filters: { status: ['occupied'] }, pageSize: 500 })
    expect(team.rows.some((u) => u.lessee_dependents !== null)).toBe(true)
  })
})
