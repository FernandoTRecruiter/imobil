// Confere que os dados fictícios respeitam as mesmas regras que o banco vai cobrar.
// Se um destes falhar, a demonstração estaria mostrando algo que o sistema real recusaria.
import { describe, expect, it } from 'vitest'
import { seedDb, ORG, PERSONAS } from './index'
import { EXEMPLOS } from './exemplos'

const REF = '2026-11-04'
const db = seedDb(REF)

describe('dados fictícios', () => {
  it('a mesma data gera exatamente os mesmos dados (semente fixa)', () => {
    expect(JSON.stringify(seedDb(REF))).toBe(JSON.stringify(db))
  })

  it('tem as duas organizações e todas as personas com login', () => {
    expect(db.organizations.map((o) => o.kind).sort()).toEqual(['agency', 'landlord'])
    for (const p of PERSONAS) expect(db.memberships.some((m) => m.user_id === p.userId && m.organization_id === p.orgId)).toBe(true)
    // Imobiliária: 18 casas (Luar) + 120 apartamentos e 60 vagas (Mount Juic) + 48 apartamentos e 36 vagas (Lynx).
    expect(db.units.filter((u) => u.organization_id === ORG.agency)).toHaveLength(282)
    // Marina: 9 salas e 24 vagas no Le Plaza.
    expect(db.units.filter((u) => u.organization_id === ORG.landlord)).toHaveLength(33)
  })

  it('só os 4 exemplos, cada um com as unidades, as vagas e TODOS os andares de exemplos.ts', () => {
    // Pedido de 06/11: "limitar a esses 4". exemplos.ts é a fonte única (o 3D lê os mesmos nomes e códigos).
    expect(db.properties.map((p) => p.name).sort()).toEqual(EXEMPLOS.map((e) => e.name).sort())
    for (const ex of EXEMPLOS) {
      const p = db.properties.find((x) => x.name === ex.name)!
      expect(p.organization_id, ex.name).toBe(ex.org === 'agency' ? ORG.agency : ORG.landlord)
      const us = db.units.filter((u) => u.property_id === p.id)
      const homes = ex.blocks.flatMap((b) => b.floors.flatMap((f) => f.units))
      const spots = [...ex.blocks.flatMap((b) => b.floors.flatMap((f) => f.parking ?? [])), ...ex.parking.flatMap((a) => a.spots)]
      expect(us.filter((u) => u.kind !== 'parking').map((u) => u.code).sort(), ex.name).toEqual([...homes].sort())
      expect(us.filter((u) => u.kind === 'parking').map((u) => u.code).sort(), ex.name).toEqual([...spots].sort())
      // Andar só de volume (sem unidade) também existe: o 3D desenha o prédio inteiro.
      for (const b of ex.blocks) {
        const row = db.buildings.find((x) => x.property_id === p.id && x.name === b.name)!
        expect(db.floors.filter((f) => f.building_id === row.id).map((f) => [f.level, f.label]).sort(), `${ex.name} ${b.name}`).toEqual(b.floors.map((f) => [f.level, f.label]).sort())
      }
    }
  })

  it('vaga: do estacionamento externo leva a área e não tem bloco; da garagem fica no subsolo; nunca é de apartamento', () => {
    const spots = db.units.filter((u) => u.kind === 'parking')
    expect(spots.length).toBe(120)
    const floorLevel = new Map(db.floors.map((f) => [f.id, f.level]))
    for (const u of spots) {
      if (u.zone) expect(u.building_id === null && u.floor_id === null, u.code).toBe(true)
      else expect(floorLevel.get(u.floor_id!)! < 0, u.code).toBe(true)
    }
    // O dono da vaga é o condomínio (ou a dona do prédio inteiro), nunca o dono de um apartamento.
    const homeOwners = new Set(db.property_owners.filter((o) => o.unit_id && db.units.find((u) => u.id === o.unit_id)!.kind !== 'parking').map((o) => o.person_id))
    for (const o of db.property_owners.filter((x) => spots.some((u) => u.id === x.unit_id))) expect(homeOwners.has(o.person_id)).toBe(false)
  })

  it('vagas: cerca de 70% alugadas por contrato normal, aluguel de R$ 150 a R$ 350, e há bloqueada ou em manutenção', () => {
    const spotIds = new Set(db.units.filter((u) => u.kind === 'parking').map((u) => u.id))
    const rented = db.contracts.filter((k) => k.kind === 'lease' && k.status === 'active' && spotIds.has(k.unit_id!))
    expect(rented.length / spotIds.size).toBeGreaterThan(0.65)
    expect(rented.length / spotIds.size).toBeLessThan(0.75)
    for (const k of rented) expect(k.rent_cents >= 15000 && k.rent_cents <= 35000, `${k.code} ${k.rent_cents}`).toBe(true)
    const manual = db.units.filter((u) => spotIds.has(u.id)).map((u) => u.manual_status)
    expect(manual.filter((m) => m === 'blocked' || m === 'maintenance').length).toBeGreaterThanOrEqual(3)
  })

  it('nenhuma unidade tem duas locações vigentes no mesmo período', () => {
    const leases = db.contracts.filter((k) => k.kind === 'lease' && ['active', 'ended', 'terminated', 'awaiting_signature'].includes(k.status))
    for (const a of leases) {
      for (const b of leases) {
        if (a.id >= b.id || a.unit_id !== b.unit_id) continue
        const overlap = a.start_date <= b.end_date && b.start_date <= a.end_date
        expect(overlap, `${a.code} x ${b.code}`).toBe(false)
      }
    }
  })

  it('as fatias dos donos de cada unidade somam 100%', () => {
    for (const u of db.units) {
      const own = db.property_owners.filter((o) => o.unit_id === u.id)
      const rows = own.length ? own : db.property_owners.filter((o) => o.property_id === u.property_id && o.unit_id === null)
      expect(rows.reduce((a, b) => a + b.share_pct, 0), u.code).toBe(100)
    }
  })

  it('repasse fecha: líquido = bruto - taxa - despesas', () => {
    expect(db.owner_transfers.length).toBeGreaterThan(0)
    for (const t of db.owner_transfers) expect(t.net_cents).toBe(t.gross_cents - t.admin_fee_cents - t.expenses_cents)
  })

  it('lançamento pago tem pagamento que cobre o valor, e nenhum pagamento é do futuro', () => {
    const sum = new Map<string, number>()
    for (const p of db.payments) {
      sum.set(p.entry_id, (sum.get(p.entry_id) ?? 0) + p.amount_cents)
      expect(p.paid_at <= REF).toBe(true)
    }
    for (const e of db.financial_entries.filter((x) => x.status === 'paid' && x.amount_cents > 0)) {
      expect(sum.get(e.id) ?? 0).toBeGreaterThanOrEqual(e.amount_cents)
    }
  })

  it('nenhuma linha mistura organizações (contrato e unidade da mesma conta)', () => {
    const unitOrg = new Map(db.units.map((u) => [u.id, u.organization_id]))
    for (const k of db.contracts.filter((x) => x.unit_id)) expect(unitOrg.get(k.unit_id!)).toBe(k.organization_id)
    const personOrg = new Map(db.people.map((p) => [p.id, p.organization_id]))
    for (const cp of db.contract_parties) expect(personOrg.get(cp.person_id)).toBe(cp.organization_id)
  })

  it('contrato vigente está dentro do prazo (início <= hoje <= fim)', () => {
    // Pegou um erro real: a locação da Daniela saía "vigente" com o fim 42 dias atrás.
    for (const k of db.contracts.filter((x) => x.status === 'active')) {
      expect(k.start_date <= REF && REF <= k.end_date, `${k.code} ${k.start_date}..${k.end_date}`).toBe(true)
    }
  })

  it('nada nos dados acontece depois de hoje (auditoria, aprovação de repasse, criação)', () => {
    for (const a of db.audit_logs) expect(a.at.slice(0, 10) <= REF, a.summary).toBe(true)
    for (const t of db.owner_transfers) if (t.approved_at) expect(t.approved_at.slice(0, 10) <= REF).toBe(true)
    // Código de banco em inglês não aparece em texto de tela (ex.: "awaiting_signature").
    expect(db.audit_logs.some((a) => /awaiting_|in_review|_approval/.test(a.summary))).toBe(false)
  })

  it('há casos para a demonstração mostrar (vencidos, vencendo, aprovações)', () => {
    const overdue = db.financial_entries.filter((e) => e.direction === 'receivable' && e.status === 'open' && e.due_date < REF)
    expect(overdue.length).toBeGreaterThan(3)
    expect(db.maintenance_requests.filter((r) => r.status === 'awaiting_owner').length).toBeGreaterThanOrEqual(2)
    expect(db.contracts.some((k) => k.status === 'awaiting_signature')).toBe(true)
  })
})
