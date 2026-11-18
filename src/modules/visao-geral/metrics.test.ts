// Testes das fórmulas da Visão geral num conjunto PEQUENO feito à mão: cada número esperado
// foi conferido na ponta do lápis (a conta está no comentário ao lado).
// Rodar: npx vitest run src/modules/visao-geral
import { describe, expect, it } from 'vitest'
import {
  agingOf, computeOverview, coveredAt, coversToday, filterLite, filterOptions, isPeriodKey, monthlyRevenue, NONE, occupancyOf,
  overdueNow, periodOf, revenueOf, unitStatuses, type ContractLite, type EntryLite, type LiteData, type MaintenanceLite, type UnitLite,
} from './metrics'

const TODAY = '2026-11-04'

/* Dois imóveis: P1 (carteira A, responsável m1) e P2 (sem carteira e sem responsável). */
const unit = (id: string, property: 'P1' | 'P2', manual_status: UnitLite['manual_status']): UnitLite => ({
  id, code: id.toUpperCase(), manual_status, property_id: property, property_name: property === 'P1' ? 'Edifício Alfa' : 'Casa Beta',
  portfolio_id: property === 'P1' ? 'pfA' : null, portfolio_name: property === 'P1' ? 'Carteira A' : null,
  manager_id: property === 'P1' ? 'm1' : null, manager_name: property === 'P1' ? 'Pessoa Um' : null,
})
const units: UnitLite[] = [
  unit('u1', 'P1', 'available'), // locação vigente k1 -> ocupada
  unit('u2', 'P1', 'available'), // só locação encerrada -> disponível
  unit('u3', 'P1', 'reserved'), //  locação aguardando assinatura -> reservada
  unit('u4', 'P1', 'blocked'), //   bloqueada, sem locação
  unit('u5', 'P2', 'maintenance'),
  unit('u6', 'P2', 'blocked'), //   bloqueada À MÃO mas com locação vigente -> ocupada (o contrato manda)
  unit('u7', 'P2', 'available'), // locação vigente k5
  unit('u8', 'P2', 'available'), // locação vigente k7
]

const contract = (id: string, unit_id: string | null, property_id: string, o: Partial<ContractLite>): ContractLite => ({
  id, code: id.toUpperCase(), kind: 'lease', status: 'active', unit_id, property_id, start_date: '2025-01-01', end_date: '2027-12-31',
  adjustment_index: 'IPCA', adjustment_month: 1, parent_id: null, ...o,
})
const contracts: ContractLite[] = [
  contract('k1', 'u1', 'P1', { start_date: '2025-11-10', end_date: '2026-11-30', adjustment_month: 11 }), // vence em 26 dias; reajuste em novembro
  contract('k2', 'u6', 'P2', { start_date: '2026-06-01', end_date: '2027-05-31', adjustment_index: 'IGPM', adjustment_month: 11 }), // menos de 12 meses: sem reajuste
  contract('k3', 'u2', 'P1', { status: 'ended', start_date: '2024-01-01', end_date: '2026-09-30' }),
  contract('k4', 'u3', 'P1', { status: 'awaiting_signature', start_date: '2026-12-01', end_date: '2029-11-30' }),
  contract('k5', 'u7', 'P2', { start_date: '2025-02-01', end_date: '2027-01-20', adjustment_month: 2 }), // vence em 77 dias
  contract('k6', null, 'P1', { kind: 'management', end_date: '2026-11-14', adjustment_index: 'none' }), // administração: fora da conta de "vencendo"
  contract('k7', 'u8', 'P2', { start_date: '2024-11-01', end_date: '2026-12-20', adjustment_index: 'none', adjustment_month: 11 }), // vence em 46 dias; sem índice
]

const entry = (id: string, o: Partial<EntryLite>): EntryLite => ({
  id, direction: 'receivable', category: 'rent', status: 'open', due_date: TODAY, amount_cents: 0, paid_cents: 0, paid_at: null, property_id: 'P1', ...o,
})
const entries: EntryLite[] = [
  entry('e1', { due_date: '2026-09-10', amount_cents: 100000, paid_cents: 100000, status: 'paid' }),
  entry('e2', { due_date: '2026-10-10', amount_cents: 100000, paid_cents: 40000 }), //  parcial: 600 em atraso há 25 dias
  entry('e3', { due_date: '2026-11-03', amount_cents: 50000, property_id: 'P2' }), //   vencida ontem (1 dia)
  entry('e4', { due_date: '2026-11-10', amount_cents: 80000, property_id: 'P2' }), //   a vencer
  entry('e5', { due_date: '2026-10-05', amount_cents: 30000, status: 'canceled', property_id: 'P2' }),
  entry('e6', { category: 'admin_fee', due_date: '2026-10-10', amount_cents: 10000, property_id: null }), // taxa: não é receita
  entry('e7', { due_date: '2026-07-15', amount_cents: 70000 }), //                       fora do período de 3 meses; 112 dias
  entry('e8', { direction: 'payable', category: 'condo_fee', due_date: '2026-10-10', amount_cents: 54000, paid_cents: 54000, status: 'paid' }),
  entry('e9', { direction: 'payable', category: 'maintenance', due_date: '2026-11-20', amount_cents: 32000, property_id: 'P2' }),
  entry('e10', { direction: 'payable', category: 'transfer', due_date: '2026-10-10', amount_cents: 90000, paid_cents: 90000, status: 'paid', property_id: null }),
  entry('e11', { due_date: TODAY, amount_cents: 20000 }), //                              vence HOJE: ainda não é vencida
]

const request = (id: string, o: Partial<MaintenanceLite>): MaintenanceLite => ({
  id, status: 'open', property_id: 'P1', due_date: null, quote_cents: null, opened_on: null, closed_on: null, assignee_id: null, ...o,
})
const maintenance: MaintenanceLite[] = [
  request('r1', { due_date: '2026-11-01' }), // aberto e atrasado
  request('r2', { status: 'awaiting_owner', property_id: 'P2', due_date: '2026-11-10', quote_cents: 85000 }),
  request('r3', { status: 'done', due_date: '2026-10-01' }),
  request('r4', { status: 'canceled', property_id: 'P2', due_date: '2026-10-01' }),
  request('r5', { status: 'in_progress', property_id: 'P2' }),
]

const data: LiteData = { units, spots: [], contracts, entries, maintenance, tasks: [], routines: [] }

describe('período', () => {
  it('"3 meses" em 04/11 vai de 01/09 a 30/11 (o mês atual entra inteiro)', () => {
    expect(periodOf(TODAY, '3')).toEqual({ key: '3', first: '2026-09-01', last: '2026-11-30', months: ['2026-09-01', '2026-10-01', '2026-11-01'] })
    expect(periodOf('2026-02-10', '1')).toMatchObject({ first: '2026-02-01', last: '2026-02-28' })
    expect(periodOf('2026-01-15', '12').first).toBe('2025-02-01')
  })
  it('só aceita os períodos da lista', () => {
    expect(isPeriodKey('6')).toBe(true)
    expect(isPeriodKey('2')).toBe(false)
    expect(isPeriodKey(null)).toBe(false)
  })
})

describe('ocupação e vacância', () => {
  it('ocupada vem do contrato; bloqueada não é alugável', () => {
    const st = unitStatuses(units, contracts, TODAY)
    expect([...st.values()].filter((s) => s === 'occupied').length).toBe(4) // u1, u6, u7, u8
    expect(st.get('u6')).toBe('occupied') // bloqueada à mão, mas com locação vigente
    expect(st.get('u2')).toBe('available') // a locação dela acabou
    const o = occupancyOf(st.values())
    // 8 unidades, 1 bloqueada -> 7 alugáveis; 4 ocupadas -> 4/7; vacância 3/7
    expect(o).toMatchObject({ units: 8, rentable: 7, occupied: 4, vacant: 3, blocked: 1 })
    expect(o.rate).toBeCloseTo(4 / 7, 10)
    expect(o.vacancy).toBeCloseTo(3 / 7, 10)
  })
  it('sem unidade alugável a taxa fica vazia (não 0%, que mentiria)', () => {
    expect(occupancyOf(['blocked']).rate).toBeNull()
  })
  it('por empreendimento: P1 1 de 3 alugáveis, P2 3 de 4; empate em tamanho vai por nome', () => {
    const m = computeOverview(data, TODAY, '3')
    expect(m.byProperty.map((p) => [p.property_name, p.occupied, p.rentable])).toEqual([
      ['Casa Beta', 3, 4],
      ['Edifício Alfa', 1, 3],
    ])
  })
  it('histórico: locação encerrada conta no passado, mas não hoje', () => {
    const k3 = contracts.find((k) => k.id === 'k3')!
    expect(coveredAt(k3, '2026-08-31')).toBe(true)
    expect(coversToday(k3, '2026-08-31')).toBe(false)
    expect(coveredAt(k3, TODAY)).toBe(false)
  })
})

describe('receita e inadimplência', () => {
  const p = periodOf(TODAY, '3')
  const r = revenueOf(entries, p, TODAY)
  it('prevista = recebida + em atraso + a vencer', () => {
    // e1 1000 + e2 1000 + e3 500 + e4 800 + e11 200 = 3500 (e5 cancelada, e6 é taxa, e7 fora do período)
    expect(r.forecast).toBe(350000)
    expect(r.received).toBe(140000) // e1 inteira + 400 de e2
    expect(r.overdue).toBe(110000) //  600 de e2 + 500 de e3
    expect(r.upcoming).toBe(100000) // e4 + e11 (vence hoje: ainda a vencer)
    expect(r.received + r.overdue + r.upcoming).toBe(r.forecast)
  })
  it('inadimplência = saldo vencido ÷ total que já venceu', () => {
    // já venceu: e1 1000 + e2 1000 + e3 500 = 2500; em atraso 1100 -> 44%
    expect(r.dueSoFar).toBe(250000)
    expect(r.delinquency).toBeCloseTo(0.44, 10)
  })
  it('nada vencido ainda: a inadimplência fica vazia', () => {
    expect(revenueOf([entries[3]], p, TODAY).delinquency).toBeNull()
  })
  it('faixas de atraso somam o "em atraso"', () => {
    const a = agingOf(entries, p, TODAY)
    expect(a.map((b) => [b.key, b.count, b.cents])).toEqual([
      ['1-15', 1, 50000], // e3: 1 dia
      ['16-30', 1, 60000], // e2: 25 dias
      ['31-60', 0, 0],
      ['60+', 0, 0],
    ])
    expect(a.reduce((s, b) => s + b.cents, 0)).toBe(r.overdue)
  })
  it('vencidas agora (de qualquer mês) e as com mais de 5 dias', () => {
    // e2 (25 dias), e3 (1 dia), e7 (112 dias, fora do período mas vencida)
    expect(overdueNow(entries, TODAY, 5)).toEqual({ count: 3, cents: 180000, lateCount: 2, lateCents: 130000, oldestDays: 112 })
  })
  it('despesas sem repasse; repasse à parte', () => {
    const m = computeOverview(data, TODAY, '3')
    expect(m.expenses).toEqual({ total: 86000, paid: 54000 }) // e8 + e9
    expect(m.transfers).toEqual({ total: 90000, paid: 90000 }) // e10
  })
  it('série de 12 meses termina no mês atual', () => {
    const s = monthlyRevenue(entries, TODAY, 12)
    expect(s).toHaveLength(12)
    expect(s[0].month).toBe('2025-12-01')
    expect(s[11]).toEqual({ month: '2026-11-01', forecast: 150000, received: 0, overdue: 50000 }) // e3 + e4 + e11
    expect(s.find((x) => x.month === '2026-07-01')).toEqual({ month: '2026-07-01', forecast: 70000, received: 0, overdue: 70000 })
  })
})

describe('prazos', () => {
  const m = computeOverview(data, TODAY, '3')
  it('locações vencendo em 30/60/90 dias (as faixas se somam; administração fica fora)', () => {
    expect(m.ending).toEqual({ d30: 1, d60: 2, d90: 3 }) // k1 26 dias; k7 46; k5 77
  })
  it('reajustes do mês: com índice e com 12 meses completos', () => {
    expect(m.adjustments.map((k) => k.id)).toEqual(['k1'])
  })
  it('chamados abertos, atrasados e orçamentos aguardando o proprietário', () => {
    expect(m.requests).toEqual({ open: 3, late: 1, awaitingOwner: 1, awaitingOwnerCents: 85000 })
  })
})

describe('filtros', () => {
  it('carteira corta as quatro tabelas pelo imóvel; lançamento sem imóvel sai', () => {
    const { data: d, propertyIds } = filterLite(data, { property: '', portfolio: 'pfA', manager: '' })
    expect(propertyIds).toEqual(['P1'])
    expect(d.units.map((u) => u.id)).toEqual(['u1', 'u2', 'u3', 'u4'])
    expect(d.contracts.map((k) => k.id)).toEqual(['k1', 'k3', 'k4', 'k6'])
    expect(d.entries.map((e) => e.id)).toEqual(['e1', 'e2', 'e7', 'e8', 'e11']) // e6 (taxa) e e10 (repasse) não têm imóvel
    expect(d.maintenance.map((r) => r.id)).toEqual(['r1', 'r3'])
  })
  it('"sem responsável" pega o imóvel sem responsável', () => {
    expect(filterLite(data, { property: '', portfolio: '', manager: NONE }).propertyIds).toEqual(['P2'])
  })
  it('sem filtro, nada muda', () => {
    expect(filterLite(data, { property: '', portfolio: '', manager: '' })).toEqual({ data, propertyIds: null })
  })
  it('a contagem de cada opção é recontada pelos OUTROS filtros', () => {
    const o = filterOptions(units, { property: '', portfolio: 'pfA', manager: '' })
    expect(o.properties.map((x) => [x.label, x.count])).toEqual([['Casa Beta', 0], ['Edifício Alfa', 4]])
    expect(o.portfolios.map((x) => [x.label, x.count])).toEqual([['Carteira A', 4], ['Sem carteira', 4]]) // a própria carteira não se corta
    expect(o.managers.map((x) => [x.label, x.count])).toEqual([['Pessoa Um', 4], ['Sem responsável', 0]])
  })
})
