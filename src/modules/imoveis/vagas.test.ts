// Testes das vagas de garagem (06/11/2026): a regra do "Mora/aluga aqui", quem vê qual vaga, e que
// vaga não se mistura com unidade nas contas (ocupação, indicadores, categoria Unidades).
// Banco fictício de 04/11/2026 (resetForTest), "hoje" fixo na sessão.
// Rodar: npx vitest run src/modules/imoveis/vagas.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { AccessError } from '@/data/api'
import { USER } from '@/data/seed'
import { getDb, resetForTest } from '@/data/store'
import type { UnitRow } from '@/data/views/units'
import { listProperties, listUnits } from '@/data/views/units'
import { homesByPerson, listSpotPins, listSpots, residentLabel } from './vagas'

const TODAY = '2026-11-04'

function session(userId: string): Session {
  const s = buildSession(getDb(), userId)!
  s.today = TODAY
  return s
}
const prop = (name: string) => getDb().properties.find((p) => p.name === name)!
const daniela = () => getDb().people.find((p) => p.user_id === USER.lessee)!

beforeEach(() => {
  resetForTest(TODAY)
})

describe('"Mora/aluga aqui": a regra', () => {
  // Linhas feitas à mão: só as colunas que a regra lê.
  type Row = Pick<UnitRow, 'code' | 'kind' | 'property_id' | 'deleted_at' | 'lease' | 'owners'>
  const lease = (lessee: string): Row['lease'] => ({ id: 'k', code: 'LOC', start_date: '2026-01-01', end_date: '2027-01-01', rent_cents: 1, lessee_id: lessee, lessee_name: '' })
  const owner = (id: string) => ({ person_id: id, name: '', share_pct: 100 })
  const rows: Row[] = [
    { code: 'B-203', kind: 'apartment', property_id: 'p1', deleted_at: null, lease: lease('ana'), owners: [owner('bia')] },
    { code: 'A-301', kind: 'apartment', property_id: 'p1', deleted_at: null, lease: null, owners: [owner('ana')] },
    { code: 'A-101', kind: 'apartment', property_id: 'p1', deleted_at: null, lease: lease('ana'), owners: [owner('ana')] },
    // Vaga não é moradia: quem aluga a vaga não "mora" nela.
    { code: 'E-001', kind: 'parking', property_id: 'p1', deleted_at: null, lease: lease('caio'), owners: [owner('condo')] },
    // Arquivada não conta; outro imóvel fica com a chave dele.
    { code: 'C-404', kind: 'apartment', property_id: 'p1', deleted_at: '2026-01-01T00:00:00Z', lease: lease('caio'), owners: [] },
    { code: 'Casa 07', kind: 'house', property_id: 'p2', deleted_at: null, lease: lease('ana'), owners: [] },
  ]
  const m = homesByPerson(rows)

  it('aluga primeiro, depois é dona; sem repetir a unidade em que é as duas coisas', () => {
    expect(m.get('p1:ana')).toEqual(['A-101', 'B-203', 'A-301'])
    expect(m.get('p1:bia')).toEqual(['B-203'])
  })
  it('vaga e unidade arquivada não fazem ninguém morador; é por imóvel', () => {
    expect(m.get('p1:caio')).toBeUndefined()
    expect(m.get('p1:condo')).toBeUndefined()
    expect(m.get('p2:ana')).toEqual(['Casa 07'])
  })
  it('a célula mostra até dois códigos e conta o resto', () => {
    expect(residentLabel(['A-101'])).toBe('A-101')
    expect(residentLabel(['A-101', 'B-203', 'A-301', 'C-102'])).toBe('A-101, B-203 e mais 2')
  })
})

describe('tabela de vagas com os dados fictícios', () => {
  it('Mount Juic: as 60 vagas do estacionamento externo, com morador e gente de fora', async () => {
    const r = await listSpots(session(USER.admin), { pageSize: 1000 }, { propertyId: prop('Condomínio Mount Juic').id })
    expect(r.total).toBe(60)
    expect(r.rows.every((x) => x.place === 'Estacionamento externo')).toBe(true)
    // A vaga da Daniela: ela mora na B-203 do mesmo condomínio.
    const vagaDaniela = r.rows.find((x) => x.code === 'E-014')!
    expect(vagaDaniela).toMatchObject({ renter_id: daniela().id, resident_codes: ['B-203'], renter_kind: 'morador', status: 'occupied' })
    expect(r.facets.renter.morador).toBeGreaterThan(0)
    expect(r.facets.renter.de_fora).toBeGreaterThan(0)
    // "Morador" confere com o banco: a pessoa aluga ou é dona de unidade (não vaga) do mesmo imóvel.
    const db = getDb()
    for (const x of r.rows.filter((y) => y.renter_kind === 'morador')) {
      const codes = db.units.filter((u) => u.property_id === x.property_id && x.resident_codes.includes(u.code)).map((u) => u.kind)
      expect(codes.length).toBe(x.resident_codes.length)
      expect(codes.includes('parking')).toBe(false)
    }
  })

  it('Le Plaza: a vaga da garagem mostra o subsolo; 1º subsolo vem antes do 2º', async () => {
    const r = await listSpots(session(USER.landlord), { pageSize: 1000 })
    expect(r.total).toBe(24)
    expect(new Set(r.rows.map((x) => x.place))).toEqual(new Set(['1º subsolo', '2º subsolo']))
    expect(r.rows[0].place).toBe('1º subsolo')
    expect(r.rows.every((x) => x.property_name === 'Edifício Le Plaza')).toBe(true)
  })

  it('a ficha da pessoa: as vagas que ela aluga hoje', async () => {
    const r = await listSpots(session(USER.admin), {}, { personId: daniela().id })
    expect(r.rows.map((x) => x.code)).toEqual(['E-014'])
  })

  it('pinos da categoria Vagas: só imóvel com vaga no resultado, com os números DAS VAGAS', async () => {
    const s = session(USER.admin)
    const pins = await listSpotPins(s, {})
    expect(pins.map((p) => p.name).sort()).toEqual(['Condomínio Mount Juic', 'Lynx Residence'])
    const mj = pins.find((p) => p.name === 'Condomínio Mount Juic')!
    expect(mj).toMatchObject({ units_total: 60, matched: 60 })
    const free = await listSpotPins(s, { filters: { status: ['available'] } })
    const freeRows = await listSpots(s, { pageSize: 1000, filters: { status: ['available'] } })
    expect(free.reduce((a, p) => a + (p.matched ?? 0), 0)).toBe(freeRows.total)
  })
})

describe('quem vê qual vaga (espelho da RLS)', () => {
  it('a inquilina vê a própria vaga e nenhuma outra', async () => {
    const r = await listSpots(session(USER.lessee), { pageSize: 1000 })
    expect(r.rows.map((x) => x.code)).toEqual(['E-014'])
    expect(r.rows[0].resident_codes).toEqual(['B-203'])
  })
  it('o proprietário convidado não aluga vaga e não vê nenhuma', async () => {
    expect((await listSpots(session(USER.owner), {})).totalAll).toBe(0)
  })
  it('a conta da Marina vê só as vagas do Le Plaza; a imobiliária não vê as dela', async () => {
    const marina = await listSpots(session(USER.landlord), { pageSize: 1000 })
    expect(new Set(marina.rows.map((x) => x.property_name))).toEqual(new Set(['Edifício Le Plaza']))
    const agency = await listSpots(session(USER.admin), { pageSize: 1000 })
    expect(agency.rows.some((x) => x.property_name === 'Edifício Le Plaza')).toBe(false)
    expect(agency.total).toBe(96)
  })
  it('pedir as vagas de uma pessoa fora do acesso é recusado', async () => {
    const stranger = getDb().people.find((p) => p.name === 'Condomínio Lynx Residence')!
    await expect(listSpots(session(USER.lessee), {}, { personId: stranger.id })).rejects.toBeInstanceOf(AccessError)
  })
})

describe('vaga não se mistura com unidade nas contas', () => {
  it('imóvel: unidades e ocupação só de casa, apartamento e sala; vagas à parte', async () => {
    const rows = (await listProperties(session(USER.admin), { pageSize: 100 })).rows
    const mj = rows.find((r) => r.name === 'Condomínio Mount Juic')!
    expect(mj).toMatchObject({ units_total: 120, spots_total: 60 })
    const homes = getDb().units.filter((u) => u.property_id === mj.id && u.kind !== 'parking')
    expect(mj.units_occupied + mj.units_available).toBeLessThanOrEqual(homes.length)
    // A conta da ocupação usa só os 120 apartamentos (as 42 vagas alugadas não entram).
    const spots = await listSpots(session(USER.admin), { pageSize: 1000 }, { propertyId: mj.id })
    expect(mj.spots_rented).toBe(spots.rows.filter((x) => x.status === 'occupied').length)
    const units = await listUnits(session(USER.admin), { pageSize: 1000, filters: { property: [mj.id], spot: ['nao'] } })
    const rentable = units.rows.filter((u) => u.status !== 'blocked').length
    expect(mj.occupancy_pct).toBe(Math.round((units.rows.filter((u) => u.status === 'occupied').length / rentable) * 1000) / 10)
    expect(rows.find((r) => r.name === 'Condomínio Luar')).toMatchObject({ units_total: 18, spots_total: 0 })
  })

  it('categoria Unidades (recorte spot: nao): sem vaga, e o "N de M" conta só unidade', async () => {
    const s = session(USER.admin)
    const homes = await listUnits(s, { pageSize: 1, filters: { spot: ['nao'] } })
    expect(homes.totalAll).toBe(186)
    expect(homes.facets.kind.parking).toBeUndefined()
    // Sem o recorte (escolher a unidade de um contrato), a vaga aparece: ela também se aluga.
    const all = await listUnits(s, { pageSize: 1 })
    expect(all.totalAll).toBe(282)
    expect((await listUnits(s, { pageSize: 1, filters: { spot: ['sim'] } })).totalAll).toBe(96)
  })
})
