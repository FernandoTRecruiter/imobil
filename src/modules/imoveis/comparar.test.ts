// Testes do "Comparar" de imóveis e unidades (07/11/2026): os números batem com as outras telas, a ordem
// é a das marcas e id fora do escopo é ignorado. Rodar: npx vitest run src/modules/imoveis/comparar.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { buildComparison } from '@/components/ui/compare-model'
import { ORG, USER } from '@/data/seed'
import { getDb, resetForTest } from '@/data/store'
import { listContracts } from '@/data/views/contracts'
import { listMaintenance } from '@/data/views/finance'
import { listProperties, listUnits } from '@/data/views/units'
import { getPropertyComparison, getUnitComparison, PROPERTY_METRICS, UNIT_METRICS } from './comparar'

const TODAY = '2026-11-04'

function session(userId: string): Session {
  const s = buildSession(getDb(), userId)!
  s.today = TODAY
  return s
}

beforeEach(() => {
  resetForTest(TODAY)
})

describe('comparar imóveis', () => {
  it('números iguais aos da lista de imóveis, chamados e contratos; ordem das marcas', async () => {
    const s = session(USER.admin)
    const props = (await listProperties(s, { pageSize: 50 })).rows
    const ids = props.slice(0, 3).map((p) => p.id).reverse()
    const items = await getPropertyComparison(s, ids)
    expect(items.map((i) => i.id)).toEqual(ids)
    for (const it of items) {
      const p = props.find((x) => x.id === it.id)!
      expect(it.units_total).toBe(p.units_total)
      expect(it.occupancy_pct).toBe(p.occupancy_pct)
      expect(it.rent_roll_cents).toBe(p.rent_roll_cents)
      const open = await listMaintenance(s, { filters: { property: [it.id], open: ['aberto'] }, pageSize: 1 })
      expect(it.open_requests).toBe(open.total)
      const ending = (await listContracts(s, { filters: { property: [it.id], status: ['active'], kind: ['lease'] }, pageSize: 1000 })).rows.filter((k) => k.days_to_end >= 0 && k.days_to_end <= 90)
      expect(it.ending_90).toBe(ending.length)
      expect(it.rent_per_m2_cents).toBeGreaterThan(0)
      if (it.delinquency_pct !== null) expect(it.delinquency_pct).toBeLessThanOrEqual(100)
    }
    const rows = buildComparison(items, PROPERTY_METRICS)
    expect(rows).toHaveLength(PROPERTY_METRICS.length)
    expect(rows.find((r) => r.key === 'occupancy')!.cells.some((c) => c.mark === 'best')).toBe(true)
  })

  it('id de outra conta é ignorado (comparar não é porta para dado de fora)', async () => {
    const s = session(USER.admin)
    const other = getDb().properties.find((p) => p.organization_id === ORG.landlord)!
    const mine = getDb().properties.find((p) => p.organization_id === ORG.agency)!
    const items = await getPropertyComparison(s, [other.id, mine.id])
    expect(items.map((i) => i.id)).toEqual([mine.id])
  })
})

describe('comparar unidades', () => {
  it('aluguel, R$/m², tempo de contrato e chamados da unidade', async () => {
    const s = session(USER.admin)
    const units = (await listUnits(s, { filters: { status: ['occupied'], spot: ['nao'] }, pageSize: 3 })).rows
    const items = await getUnitComparison(s, units.map((u) => u.id))
    expect(items).toHaveLength(3)
    for (const it of items) {
      expect(it.rent_cents).toBe(it.lease!.rent_cents)
      expect(it.rent_per_m2_cents).toBe(Math.round(it.lease!.rent_cents / it.area_m2))
      expect(it.lease_elapsed_months).not.toBeNull()
      const open = await listMaintenance(s, { filters: { unit: [it.id], open: ['aberto'] }, pageSize: 1 })
      expect(it.open_requests).toBe(open.total)
    }
    const rows = buildComparison(items, UNIT_METRICS)
    expect(rows.find((r) => r.key === 'lessee')!.cells.every((c) => c.mark === null)).toBe(true)
  })

  it('no portal do proprietário: só as unidades dele, sem a família do inquilino', async () => {
    const owner = session(USER.owner)
    const mine = (await listUnits(owner, { filters: { status: ['occupied'] }, pageSize: 2 })).rows
    const visible = new Set((await listUnits(owner, { pageSize: 1000 })).rows.map((u) => u.id))
    const stranger = getDb().units.find((u) => u.organization_id === owner.org.id && !visible.has(u.id))!
    expect(stranger).toBeDefined()
    const ids = [...mine.map((u) => u.id), stranger.id]
    const items = await getUnitComparison(owner, ids)
    expect(items.map((i) => i.id)).toEqual(mine.map((u) => u.id))
    for (const it of items) expect(it.lessee_dependents).toBeNull()
  })
})
