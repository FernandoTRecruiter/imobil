// Testes da ficha curta (resumo.ts): o básico de um imóvel e o resumo do recorte usam as MESMAS contas
// da tabela de imóveis, o "Vencido" só existe para quem vê o financeiro, e o escopo vale.
// Banco fictício de 04/11/2026 (resetForTest), "hoje" fixo na sessão.
// Rodar: npx vitest run src/modules/imoveis/resumo.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError } from '@/data/api'
import { USER } from '@/data/seed'
import { getDb, resetForTest } from '@/data/store'
import { scopeFor } from '@/data/scope'
import { toEntryRows } from '@/data/views/finance'
import { toPropertyRows } from '@/data/views/units'
import { getPropertyBrief, summarizeProperties } from './resumo'

const TODAY = '2026-11-04'

function session(userId: string): Session {
  const s = buildSession(getDb(), userId)!
  s.today = TODAY
  return s
}

beforeEach(() => {
  resetForTest(TODAY)
})

describe('ficha curta do imóvel', () => {
  it('os números batem com a linha da tabela de imóveis, e o vencido com o Financeiro', async () => {
    const s = session(USER.admin)
    const db = getDb()
    const rows = toPropertyRows(db, scopeFor(db, s), TODAY).filter((p) => !p.deleted_at && p.units_total > 0)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const b = await getPropertyBrief(s, row.id)
      expect(b).toMatchObject({ units_total: row.units_total, units_occupied: row.units_occupied, units_available: row.units_available, spots_total: row.spots_total, spots_rented: row.spots_rented, rent_roll_cents: row.rent_roll_cents })
      expect(b.units_rentable).toBeLessThanOrEqual(b.units_total)
      // Vencido = saldo em aberto das cobranças de receita do imóvel que já venceram (a conta do Financeiro).
      const overdue = toEntryRows(db, scopeFor(db, s), TODAY)
        .filter((e) => e.property_id === row.id && e.direction === 'receivable' && !['admin_fee', 'transfer', 'deposit'].includes(e.category) && e.state === 'overdue')
        .reduce((a, e) => a + e.open_cents, 0)
      expect(b.overdue_cents).toBe(overdue)
    }
  })

  it('quem não vê o financeiro não recebe o vencido (nem zero: a linha some)', async () => {
    const s = [USER.staff, USER.leasing, USER.maint].map(session).find((x) => !can(x, 'finance:view') && can(x, 'properties:view'))
    expect(s).toBeDefined()
    const id = toPropertyRows(getDb(), scopeFor(getDb(), s!), TODAY).find((p) => p.units_total > 0)!.id
    expect((await getPropertyBrief(s!, id)).overdue_cents).toBeNull()
  })

  it('imóvel de outra conta é recusado (o escopo vale aqui também)', async () => {
    const plaza = getDb().properties.find((p) => p.organization_id !== session(USER.admin).org.id)!
    await expect(getPropertyBrief(session(USER.admin), plaza.id)).rejects.toBeInstanceOf(AccessError)
  })
})

describe('resumo do recorte (nada escolhido)', () => {
  it('soma os imóveis pedidos; id fora do acesso não entra', async () => {
    const s = session(USER.admin)
    const rows = toPropertyRows(getDb(), scopeFor(getDb(), s), TODAY).filter((p) => !p.deleted_at)
    const outside = getDb().properties.find((p) => p.organization_id !== s.org.id)!.id
    const r = await summarizeProperties(s, [...rows.map((p) => p.id), outside])
    expect(r.properties).toBe(rows.length)
    expect(r.units_total).toBe(rows.reduce((a, p) => a + p.units_total, 0))
    expect(r.spots_rented).toBe(rows.reduce((a, p) => a + p.spots_rented, 0))
    expect(r.rent_roll_cents).toBe(rows.reduce((a, p) => a + p.rent_roll_cents, 0))
    expect(await summarizeProperties(s, [])).toMatchObject({ properties: 0, units_total: 0, rent_roll_cents: 0 })
  })
})
