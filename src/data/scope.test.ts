// Bateria de isolamento (o equivalente, no modo de demonstração, da bateria de RLS do plano).
// Cada papel tenta ver o que não pode; o esperado é não ver.
import { describe, expect, it } from 'vitest'
import { buildSession } from '@/auth/session'
import { can, isPortal } from '@/auth/permissions'
import { resetForTest } from './store'
import { scopeFor, see } from './scope'
import { ORG, USER } from './seed'

const db = resetForTest('2026-11-04')
const session = (userId: string) => {
  const s = buildSession(db, userId)!
  s.today = '2026-11-04'
  return s
}

describe('isolamento entre organizações', () => {
  it('a conta da Marina enxerga só o Le Plaza (salas e vagas), nada da imobiliária', () => {
    const sc = scopeFor(db, session(USER.landlord))
    expect(db.properties.filter((p) => see.property(sc, p)).map((p) => p.name)).toEqual(['Edifício Le Plaza'])
    const units = db.units.filter((u) => see.unit(sc, u))
    expect(units.filter((u) => u.kind !== 'parking')).toHaveLength(9)
    expect(units.filter((u) => u.kind === 'parking')).toHaveLength(24)
  })
  it('a imobiliária não enxerga nenhuma linha da proprietária independente, e vice-versa', () => {
    const agency = scopeFor(db, session(USER.admin))
    const landlord = scopeFor(db, session(USER.landlord))
    expect(db.units.filter((u) => u.organization_id === ORG.landlord).some((u) => see.unit(agency, u))).toBe(false)
    expect(db.contracts.filter((k) => k.organization_id === ORG.agency).some((k) => see.contract(landlord, k))).toBe(false)
    expect(db.financial_entries.filter((e) => e.organization_id === ORG.landlord).some((e) => see.entry(agency, e))).toBe(false)
  })
})

describe('portal do proprietário', () => {
  const s = session(USER.owner)
  const sc = scopeFor(db, s)
  it('vê só as unidades de que é dono (3 no Mount Juic + a casa dividida no Luar), nenhuma vaga', () => {
    const visible = db.units.filter((u) => see.unit(sc, u)).map((u) => u.code).sort()
    expect(visible).toEqual(['A-301', 'A-302', 'B-504', 'Casa 07'])
  })
  it('não vê contrato de unidade alheia nem o financeiro de outro dono', () => {
    const others = db.contracts.filter((k) => k.organization_id === ORG.agency && k.kind === 'lease' && k.unit_id && !sc.unitIds.has(k.unit_id))
    expect(others.some((k) => see.contract(sc, k))).toBe(false)
    const foreignTransfers = db.financial_entries.filter((e) => e.category === 'transfer' && e.person_id !== s.personId)
    expect(foreignTransfers.some((e) => see.entry(sc, e))).toBe(false)
  })
  it('não vê documento interno (matrícula) nem tem acesso de equipe', () => {
    expect(db.documents.filter((d) => !d.visible_to_owner).some((d) => see.document(sc, d))).toBe(false)
    expect(can(s, 'settings:manage')).toBe(false)
    expect(can(s, 'quotes:approve')).toBe(true)
    expect(isPortal(s)).toBe(true)
  })
})

describe('portal do inquilino e do prestador', () => {
  it('a inquilina vê só os próprios contratos (o apartamento e a vaga) e as próprias cobranças', () => {
    const s = session(USER.lessee)
    const sc = scopeFor(db, s)
    const contracts = db.contracts.filter((k) => see.contract(sc, k))
    expect(contracts.length).toBe(2)
    expect(contracts.every((k) => db.contract_parties.some((p) => p.contract_id === k.id && p.person_id === s.personId && p.role === 'lessee'))).toBe(true)
    const entries = db.financial_entries.filter((e) => see.entry(sc, e))
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.person_id === s.personId && e.direction === 'receivable')).toBe(true)
  })
  it('a inquilina vê a PRÓPRIA vaga e nenhuma outra do estacionamento', () => {
    const sc = scopeFor(db, session(USER.lessee))
    const spots = db.units.filter((u) => u.kind === 'parking' && see.unit(sc, u)).map((u) => u.code)
    expect(spots).toEqual(['E-014'])
  })
  it('o prestador vê só chamados atribuídos a ele e nada do financeiro', () => {
    const s = session(USER.vendor)
    const sc = scopeFor(db, s)
    const reqs = db.maintenance_requests.filter((r) => see.maintenance(sc, r))
    expect(reqs.length).toBeGreaterThan(0)
    expect(reqs.every((r) => r.vendor_person_id === s.personId)).toBe(true)
    expect(db.financial_entries.some((e) => see.entry(sc, e))).toBe(false)
  })
  it('o prestador vê os anexos dos chamados dele e nenhum outro documento', () => {
    const s = session(USER.vendor)
    const sc = scopeFor(db, s)
    const docs = db.documents.filter((d) => see.document(sc, d))
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((d) => d.maintenance_id && sc.maintenanceIds.has(d.maintenance_id))).toBe(true)
  })
})

describe('chamado de área comum (sem unidade)', () => {
  it('o dono de unidade do prédio vê; o inquilino do mesmo prédio não; outro prédio, ninguém', () => {
    // Antes o chamado de área comum ia para a "primeira unidade" e aparecia no portal do inquilino dela.
    const condo = db.properties.find((p) => p.name === 'Condomínio Mount Juic')!
    const base = db.maintenance_requests.find((r) => r.organization_id === ORG.agency)!
    const comum = { ...base, id: 'chamado-area-comum', unit_id: null, property_id: condo.id, requester_person_id: null, vendor_person_id: null }
    db.maintenance_requests.push(comum)
    try {
      expect(see.maintenance(scopeFor(db, session(USER.owner)), comum)).toBe(true) // Carlos tem apartamentos no Mount Juic
      expect(see.maintenance(scopeFor(db, session(USER.lessee)), comum)).toBe(false) // Daniela mora no Mount Juic
      expect(see.maintenance(scopeFor(db, session(USER.admin)), comum)).toBe(true)
      expect(see.maintenance(scopeFor(db, session(USER.landlord)), comum)).toBe(false) // outra conta
    } finally {
      db.maintenance_requests.splice(db.maintenance_requests.indexOf(comum), 1)
    }
  })
})

describe('colaborador com permissão parcial', () => {
  it('o financeiro edita lançamento mas não mexe em configuração nem em contrato', () => {
    const s = session(USER.staff)
    expect(can(s, 'finance:edit')).toBe(true)
    expect(can(s, 'contracts:edit')).toBe(false)
    expect(can(s, 'settings:manage')).toBe(false)
  })
})
