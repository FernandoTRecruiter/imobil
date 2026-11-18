// A Visão geral em blocos (07/11/2026) contra o resto do sistema, nos dados fictícios de 04/11/2026:
// 1. cada número que vira link abre uma lista com o MESMO número (clicar nunca é surpresa);
// 2. quem vê o desempenho da equipe: admin vê todos, colaborador só a própria linha, conta sem
//    equipe não tem o bloco, portal não tem Visão geral;
// 3. disponíveis e vagas fora da ocupação (o que o antigo disponiveis.test.ts cobria).
// Rodar: npx vitest run src/modules/visao-geral
import { describe, expect, it } from 'vitest'
import { buildSession } from '@/auth/session'
import { can } from '@/auth/permissions'
import { USER } from '@/data/seed'
import { resetForTest } from '@/data/store'
import { listContracts } from '@/data/views/contracts'
import { listEntries, listMaintenance } from '@/data/views/finance'
import { listUnits } from '@/data/views/units'
import { listSpots } from '@/modules/imoveis/vagas'
import { listSchedules } from '@/modules/manutencao/rotinas'
import { listTasks } from '@/modules/processos/repo'
import { macroBlocks } from './figures'
import { DEFAULT_FILTERS, getOverview } from './repo'

const TODAY = '2026-11-04'
const db = resetForTest(TODAY)
const session = (userId: string) => {
  const s = buildSession(db, userId)!
  s.today = TODAY
  return s
}
const ALL = { page: 1, pageSize: 100_000 }

describe('cada número com link abre a lista com o mesmo número', () => {
  it('disponíveis, vagas, locações, chamados e rotinas', async () => {
    const s = session(USER.admin)
    const d = await getOverview(s, DEFAULT_FILTERS)
    const m = d.overview
    const L = d.links
    expect(Object.keys(L).sort()).toEqual(['available', 'ending', 'leases', 'overdue', 'received', 'requestsLate', 'requestsOpen', 'routines', 'spots', 'transfers', 'upkeep'])

    // spot: ['nao'] é o recorte que a categoria Unidades de Imóveis põe em toda consulta (sem as vagas).
    expect((await listUnits(s, { ...ALL, filters: { ...L.available!.filters, spot: ['nao'] } })).total).toBe(m.available.count)
    expect(m.available.count).toBeGreaterThan(0)
    expect((await listSpots(s, { ...ALL, filters: L.spots!.filters })).total).toBe(m.spots.occupied)
    expect(m.spots.occupied).toBeGreaterThan(0)
    expect((await listContracts(s, { ...ALL, filters: L.leases!.filters })).total).toBe(m.leases.active)
    expect((await listContracts(s, { ...ALL, filters: L.ending!.filters })).total).toBe(m.ending.d90)
    expect((await listMaintenance(s, { ...ALL, filters: L.requestsOpen!.filters })).total).toBe(m.requests.open)
    expect((await listMaintenance(s, { ...ALL, filters: L.requestsLate!.filters })).total).toBe(m.requests.late)
    expect((await listSchedules(s, { ...ALL, filters: L.routines!.filters })).total).toBe(m.routines.overdue)
    expect(L.routines!.search).toEqual({ aba: 'rotinas' })
  })

  it('dinheiro: o vencido em aberto, o recebido e a despesa de manutenção do período batem com o Financeiro', async () => {
    const s = session(USER.admin)
    const d = await getOverview(s, DEFAULT_FILTERS)
    const m = d.overview
    const overdue = await listEntries(s, { ...ALL, filters: d.links.overdue!.filters })
    expect(overdue.totals.overdue).toBe(m.revenue.overdue)
    expect(m.revenue.overdue).toBeGreaterThan(0)
    const received = await listEntries(s, { ...ALL, filters: d.links.received!.filters })
    // O Financeiro soma no "recebido" só a cobrança paga por inteiro; a parte paga de uma em aberto fica no saldo.
    const partial = received.rows.filter((r) => r.status === 'open').reduce((a, r) => a + (r.amount_cents - r.open_cents), 0)
    expect(received.totals.received + partial).toBe(m.revenue.received)
    const upkeep = await listEntries(s, { ...ALL, filters: d.links.upkeep!.filters })
    expect(upkeep.rows.filter((r) => r.status !== 'canceled').reduce((a, r) => a + r.amount_cents, 0)).toBe(m.upkeep.total)
  })

  it('a tarefa atrasada do alerta é a mesma conta do bloco da equipe', async () => {
    const s = session(USER.admin)
    const d = await getOverview(s, DEFAULT_FILTERS)
    const tasks = await listTasks(s, { ...ALL, filters: { atrasada: ['sim'] } })
    expect(d.overview.tasks.late).toBe(tasks.total)
    expect(d.alerts.find((a) => a.key === 'tarefas')?.title).toBe(`${tasks.total} tarefas atrasadas`)
  })

  it('sem a permissão da lista de destino, o número fica sem link', async () => {
    const d = await getOverview(session(USER.maint), DEFAULT_FILTERS)
    expect(d.show.money).toBe(false)
    expect(d.links.overdue).toBeUndefined()
    expect(d.links.leases).toBeUndefined() // o colaborador da manutenção não abre Contratos
    expect(d.links.requestsOpen).toBeDefined()
  })
})

describe('quem vê o desempenho da equipe', () => {
  it('admin: a tabela de todos os colaboradores, maior carteira primeiro', async () => {
    const s = session(USER.admin)
    expect(can(s, 'team:performance')).toBe(true)
    const d = await getOverview(s, DEFAULT_FILTERS)
    expect(d.team.mode).toBe('team')
    expect(d.team.rows.map((r) => r.user_id).sort()).toEqual([USER.admin, USER.staff, USER.leasing, USER.maint].sort())
    const units = d.team.rows.map((r) => r.units)
    expect([...units].sort((a, b) => b - a)).toEqual(units)
    // A carteira de cada um soma as unidades com responsável (o seed põe responsável em todo imóvel da imobiliária).
    expect(units.reduce((a, b) => a + b, 0)).toBe(d.overview.occupancy.units)
    // Os chamados da imobiliária são do colaborador da manutenção: é ele quem tem os resolvidos.
    const maint = d.team.rows.find((r) => r.user_id === USER.maint)!
    expect(maint.requests.count).toBe(d.overview.resolution.count)
  })

  it('colaborador: só a própria linha ("Meu desempenho"); a dos outros nem sai do repositório', async () => {
    for (const user of [USER.staff, USER.leasing, USER.maint]) {
      const s = session(user)
      expect(can(s, 'team:performance')).toBe(false)
      const d = await getOverview(s, DEFAULT_FILTERS)
      expect(d.team.mode).toBe('self')
      expect(d.team.rows.map((r) => r.user_id)).toEqual([user])
    }
  })

  it('colaborador sem "finance:view": a inadimplência da carteira dele fica sem base (nenhum lançamento sai)', async () => {
    const d = await getOverview(session(USER.leasing), DEFAULT_FILTERS)
    expect(d.team.rows[0].units).toBeGreaterThan(0)
    expect(d.team.rows[0].delinquency).toBeNull()
  })

  it('proprietária independente: sem equipe, sem bloco; os quatro blocos sem a linha de repasse', async () => {
    const d = await getOverview(session(USER.landlord), DEFAULT_FILTERS)
    expect(d.team).toEqual({ mode: 'none', rows: [] })
    const blocks = macroBlocks(d.overview, d.show)
    expect(blocks.map((b) => b.key)).toEqual(['carteira', 'financeiro', 'clientes', 'manutencao'])
    expect(blocks[1].rows.some((r) => r.key === 'repasses')).toBe(false)
    expect(d.links.transfers).toBeUndefined()
  })

  it('portal (proprietário, inquilino, prestador) não tem Visão geral nem ação de equipe', async () => {
    for (const user of [USER.owner, USER.lessee, USER.vendor]) {
      expect(can(session(user), 'team:performance')).toBe(false)
      await expect(getOverview(session(user), DEFAULT_FILTERS)).rejects.toThrow('equipe')
    }
  })
})

describe('filtro de empreendimento', () => {
  it('blocos, links e equipe no mesmo recorte', async () => {
    const s = session(USER.admin)
    const target = db.properties.find((p) => p.name === 'Condomínio Mount Juic')!
    const d = await getOverview(s, { ...DEFAULT_FILTERS, property: target.id })
    expect(d.propertyIds).toEqual([target.id])
    expect(d.links.available!.filters.property).toEqual([target.id])
    expect(d.links.routines!.filters.imovel).toEqual([target.id])
    expect((await listUnits(s, { ...ALL, filters: { ...d.links.available!.filters, spot: ['nao'] } })).total).toBe(d.overview.available.count)
    // Mount Juic é da Ana: só ela tem carteira neste recorte.
    expect(d.team.rows.filter((r) => r.units > 0).map((r) => r.user_id)).toEqual([USER.admin])
  })
})
