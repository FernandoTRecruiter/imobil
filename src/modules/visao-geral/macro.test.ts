// Testes dos números macro da Visão geral (macro.ts), das setas (figures.ts) e do desempenho por
// colaborador (desempenho.ts), num conjunto PEQUENO feito à mão. Cada número esperado foi conferido
// na ponta do lápis (a conta está no comentário ao lado).
// Hoje = 04/11/2026, período "3 meses" = set a nov; o anterior = jun a ago, visto até 04/08.
// Rodar: npx vitest run src/modules/visao-geral
import { describe, expect, it } from 'vitest'
import { staffRows } from './desempenho'
import { compareLabel, deltaCount, deltaDays, deltaMoney, deltaRate, macroBlocks, teamTotalsBlock } from './figures'
import {
  availableOf, computeMacro, entryAsOf, occupancyAt, previousOf, punctualityOf, requestsAt, resolutionOf, routinesOf, signedOf, taskStatsOf,
} from './macro'
import { periodOf, type ContractLite, type EntryLite, type LiteData, type MaintenanceLite, type TaskLite, type UnitLite } from './metrics'

const TODAY = '2026-11-04'
const PREV = '2026-08-04'

/* P1 (responsável m1): u1, u2, u3 e as vagas s1, s2. P2 (responsável m2): u4. */
const unit = (id: string, property: 'P1' | 'P2', manual_status: UnitLite['manual_status']): UnitLite => ({
  id, code: id.toUpperCase(), manual_status, property_id: property, property_name: property,
  portfolio_id: null, portfolio_name: null, manager_id: property === 'P1' ? 'm1' : 'm2', manager_name: null,
})
const units = [unit('u1', 'P1', 'available'), unit('u2', 'P1', 'available'), unit('u3', 'P1', 'blocked'), unit('u4', 'P2', 'available')]
const spots = [unit('s1', 'P1', 'available'), unit('s2', 'P1', 'blocked')]

const lease = (id: string, unit_id: string, property_id: string, status: ContractLite['status'], start_date: string, end_date: string, parent_id: string | null = null): ContractLite => ({
  id, code: id.toUpperCase(), kind: 'lease', status, unit_id, property_id, start_date, end_date, adjustment_index: 'IPCA', adjustment_month: 1, parent_id,
})
const contracts: ContractLite[] = [
  lease('k1', 'u1', 'P1', 'active', '2026-01-01', '2027-12-31'), //     vale hoje e em 04/08
  lease('k2', 'u2', 'P1', 'ended', '2025-06-01', '2026-09-30'), //      valia em 04/08; acabou há 35 dias
  lease('k3', 'u4', 'P2', 'active', '2026-09-15', '2027-09-14'), //     NOVA no período atual
  lease('k5', 's1', 'P1', 'active', '2026-10-01', '2027-09-30', 'kx'), // RENOVAÇÃO no período atual (vaga)
  lease('k6', 'u2', 'P1', 'awaiting_signature', '2026-12-01', '2029-11-30'), // ainda não fechou: não conta
  lease('k7', 'u4', 'P2', 'terminated', '2026-07-10', '2026-09-10'), // nova no período anterior; valia em 04/08
]

const entry = (id: string, o: Partial<EntryLite>): EntryLite => ({
  id, direction: 'receivable', category: 'rent', status: 'open', due_date: TODAY, amount_cents: 0, paid_cents: 0, paid_at: null, property_id: 'P1', ...o,
})
const paid = (id: string, due_date: string, amount: number, paid_at: string | null, property_id = 'P1') =>
  entry(id, { due_date, amount_cents: amount, paid_cents: amount, paid_at, status: 'paid', property_id })
const entries: EntryLite[] = [
  paid('e1', '2026-09-10', 100000, '2026-09-08'), //            no prazo
  paid('e2', '2026-10-10', 100000, '2026-10-15'), //            pago com atraso
  entry('e3', { due_date: '2026-10-20', amount_cents: 50000 }), // vencido em aberto
  entry('e4', { due_date: '2026-11-10', amount_cents: 80000 }), // a vencer
  paid('e5', '2026-10-05', 30000, null), //                     pago sem data: fora da pontualidade
  paid('e6', '2026-07-10', 100000, '2026-07-09', 'P2'), //       período anterior, no prazo
  paid('e7', '2026-07-20', 100000, '2026-08-20', 'P2'), //       período anterior: pago DEPOIS de 04/08
  entry('p1', { direction: 'payable', category: 'maintenance', due_date: '2026-10-12', amount_cents: 40000, paid_cents: 40000, paid_at: '2026-10-12', status: 'paid' }),
  entry('p2', { direction: 'payable', category: 'maintenance', due_date: '2026-07-15', amount_cents: 25000 }),
]

const request = (id: string, o: Partial<MaintenanceLite>): MaintenanceLite => ({
  id, status: 'done', property_id: 'P1', due_date: null, quote_cents: null, opened_on: null, closed_on: null, assignee_id: null, ...o,
})
const maintenance: MaintenanceLite[] = [
  request('r1', { opened_on: '2026-07-01', closed_on: '2026-07-11', assignee_id: 'm1' }), // anterior: 10 dias
  request('r2', { opened_on: '2026-07-20', closed_on: '2026-08-20', due_date: '2026-07-25' }), // aberto e atrasado em 04/08
  request('r3', { opened_on: '2026-10-01', closed_on: '2026-10-05', assignee_id: 'm2', property_id: 'P2' }), // atual: 4 dias
  request('r4', { status: 'open', opened_on: '2026-10-20', due_date: '2026-10-25', assignee_id: 'm2', property_id: 'P2' }), // aberto e atrasado hoje
  request('r5', { status: 'canceled', opened_on: '2026-09-01', closed_on: '2026-09-03' }), // cancelado: fora do tempo médio
]

const task = (id: string, o: Partial<TaskLite>): TaskLite => ({ id, status: 'todo', due_date: null, done_on: null, property_id: 'P1', assignee_id: null, ...o })
const tasks: TaskLite[] = [
  task('t1', { status: 'done', due_date: '2026-09-20', done_on: '2026-09-18', assignee_id: 'm1' }), // no prazo
  task('t2', { status: 'done', due_date: '2026-10-01', done_on: '2026-10-03', assignee_id: 'm1' }), // feita depois do prazo
  task('t3', { due_date: '2026-10-30', assignee_id: 'm2', property_id: 'P2' }), //                  atrasada hoje
  task('t4', { due_date: '2026-11-20' }), //                                                          prazo ainda não chegou
  task('t5', { status: 'done', due_date: '2026-07-30', done_on: '2026-08-10' }), //                  em 04/08 estava atrasada
  task('t6', { status: 'canceled', due_date: '2026-10-10' }), //                                      cancelada: não conta
]

const data: LiteData = {
  units, spots, contracts, entries, maintenance, tasks,
  routines: [
    { id: 'ro1', property_id: 'P1', next_date: '2026-11-01', status: 'on' }, // vencida
    { id: 'ro2', property_id: 'P1', next_date: '2026-12-01', status: 'on' },
    { id: 'ro3', property_id: 'P2', next_date: '2026-10-01', status: 'off' }, // desligada: não vence
  ],
}

describe('período anterior e a etiqueta da comparação', () => {
  it('"3 meses" em 04/11 compara com jun a ago, visto em 04/08', () => {
    const { prevToday, prevPeriod } = previousOf(TODAY, '3')
    expect(prevToday).toBe(PREV)
    expect(prevPeriod.months).toEqual(['2026-06-01', '2026-07-01', '2026-08-01'])
    expect(compareLabel({ prevPeriod })).toBe('jun a ago/2026')
    expect(compareLabel(previousOf(TODAY, '1'))).toBe('out/2026')
    expect(compareLabel(previousOf(TODAY, '12'))).toBe('dez/2024 a nov/2025')
  })
  it('31/05 menos 3 meses cai no último dia de fevereiro', () => {
    expect(previousOf('2026-05-31', '3').prevToday).toBe('2026-02-28')
  })
})

describe('carteira', () => {
  it('ocupação hoje 2 de 3; em 04/08, 3 de 3 (a locação encerrada depois ainda valia)', () => {
    expect(occupancyAt(units, contracts, TODAY, TODAY)).toMatchObject({ rentable: 3, occupied: 2 })
    expect(occupancyAt(units, contracts, PREV, TODAY)).toMatchObject({ rentable: 3, occupied: 3, rate: 1 })
  })
  it('disponíveis: só u2, há 35 dias (fim da última locação em 30/09)', () => {
    expect(availableOf(units, contracts, TODAY)).toEqual({ count: 1, withHistory: 1, avgDays: 35 })
  })
  it('vagas: a s1 alugada desde 01/10 (a s2 está bloqueada)', () => {
    expect(occupancyAt(spots, contracts, TODAY, TODAY)).toMatchObject({ rentable: 1, occupied: 1 })
    expect(occupancyAt(spots, contracts, PREV, TODAY)).toMatchObject({ occupied: 0 })
  })
})

describe('dinheiro visto numa data passada', () => {
  it('pago depois da data volta a estar em aberto e sem nada pago naquela data', () => {
    const e7 = entries.find((e) => e.id === 'e7')!
    expect(entryAsOf(e7, PREV)).toMatchObject({ status: 'open', paid_cents: 0, paid_at: null })
    expect(entryAsOf(e7, '2026-08-20')).toBe(e7)
  })
  it('pontualidade: 1 de 3 no período (o pago sem data fica fora); antes, 1 de 2', () => {
    const p = periodOf(TODAY, '3')
    expect(punctualityOf(entries, p, TODAY)).toEqual({ due: 3, onTime: 1, rate: 1 / 3 })
    const { prevPeriod } = previousOf(TODAY, '3')
    const before = entries.map((e) => entryAsOf(e, PREV))
    expect(punctualityOf(before, prevPeriod, PREV)).toEqual({ due: 2, onTime: 1, rate: 0.5 })
  })
})

describe('clientes, manutenção e tarefas', () => {
  const p = periodOf(TODAY, '3')
  const { prevPeriod } = previousOf(TODAY, '3')
  it('novos e renovações: k3 nova e k5 renovação agora; k7 nova antes; "aguardando assinatura" não conta', () => {
    expect(signedOf(contracts, p, TODAY)).toEqual({ fresh: 1, renewals: 1 })
    expect(signedOf(contracts, prevPeriod, PREV)).toEqual({ fresh: 1, renewals: 0 })
  })
  it('chamados abertos numa data: em 04/08 só o r2, e atrasado', () => {
    expect(requestsAt(maintenance, PREV)).toEqual({ open: 1, late: 1 })
  })
  it('tempo de resolução: 4 dias agora (r3), 10 antes (r1); o r2 fechou depois de 04/08 e o cancelado fica fora', () => {
    expect(resolutionOf(maintenance, p, TODAY)).toEqual({ count: 1, avgDays: 4 })
    expect(resolutionOf(maintenance, prevPeriod, PREV)).toEqual({ count: 1, avgDays: 10 })
  })
  it('tarefas: 1 de 3 no prazo e 1 atrasada hoje; em 04/08, a t5 estava atrasada', () => {
    expect(taskStatsOf(tasks, p, TODAY)).toEqual({ measured: 3, onTime: 1, rate: 1 / 3, late: 1 })
    expect(taskStatsOf(tasks, prevPeriod, PREV)).toEqual({ measured: 1, onTime: 0, rate: 0, late: 1 })
  })
  it('rotinas: 1 vencida das 2 ligadas', () => {
    expect(routinesOf(data.routines, TODAY)).toEqual({ active: 2, overdue: 1 })
  })
})

describe('a Visão geral inteira (computeMacro)', () => {
  const m = computeMacro(data, TODAY, '3')
  it('cada número com o de antes', () => {
    expect(m.prevToday).toBe(PREV)
    expect(m.leases).toMatchObject({ active: 3, activePrev: 3 }) // k1, k3, k5 hoje; k1, k2, k7 em 04/08
    expect(m.revenue).toMatchObject({ forecast: 360000, received: 230000, overdue: 50000, dueSoFar: 280000 })
    expect(m.revenuePrev).toMatchObject({ forecast: 200000, received: 100000, overdue: 100000, delinquency: 0.5 })
    expect(m.upkeep.total).toBe(40000)
    expect(m.upkeepPrev.total).toBe(25000)
    expect(m.requests.open).toBe(1)
    expect(m.requestsPrev).toEqual({ open: 1, late: 1 })
  })
  it('tendências de 12 pontos; o último ponto é o número de hoje', () => {
    expect(m.occupancyTrend).toHaveLength(12)
    expect(m.occupancyTrend[11]).toBe(m.occupancy.rate)
    expect(m.leases.trend[11]).toBe(m.leases.active)
    expect(m.requestsTrend[11]).toBe(m.requests.open)
  })
})

describe('setas e blocos (figures.ts)', () => {
  it('taxa em pontos percentuais, contagem, dinheiro e dias; sem base num lado, sem seta', () => {
    expect(deltaRate(2 / 3, 1)?.text).toBe('▼ 33,3 p.p.')
    expect(deltaRate(0.5, null)).toBeNull()
    expect(deltaCount(3, 3).text).toBe('sem variação')
    expect(deltaCount(5, 2)).toEqual({ text: '▲ 3', said: '3 a mais que no período anterior' })
    // O Intl põe um espaço que não quebra (U+00A0) entre R$ e o número: troca por espaço comum para comparar.
    expect(deltaMoney(230000, 100000).text.replace(/\u00a0/g, ' ')).toBe('▲ R$ 1.300')
    expect(deltaDays(4, 10)?.text).toBe('▼ 6,0 dias')
  })
  it('sem acesso a dinheiro: sem bloco Financeiro e sem pontualidade; sem repasse: sem a linha', () => {
    const m = computeMacro(data, TODAY, '3')
    const withMoney = macroBlocks(m, { money: true, transfers: false })
    expect(withMoney.map((b) => b.key)).toEqual(['carteira', 'financeiro', 'clientes', 'manutencao'])
    expect(withMoney[1].rows.map((r) => r.key)).toEqual(['inadimplencia', 'manutencao'])
    const noMoney = macroBlocks(m, { money: false, transfers: false })
    expect(noMoney.map((b) => b.key)).toEqual(['carteira', 'clientes', 'manutencao'])
    expect(noMoney.find((b) => b.key === 'clientes')!.rows.some((r) => r.key === 'pontualidade')).toBe(false)
  })
  it('nenhum texto com travessão; equipe somada só com tarefa nos dados', () => {
    const m = computeMacro(data, TODAY, '3')
    expect(JSON.stringify(macroBlocks(m, { money: true, transfers: true }))).not.toContain('\u2014')
    expect(teamTotalsBlock(m)?.headline.value).toBe('33,3%')
    expect(teamTotalsBlock(computeMacro({ ...data, tasks: [] }, TODAY, '3'))).toBeNull()
  })
})

describe('desempenho por colaborador (desempenho.ts)', () => {
  const rows = staffRows(data, [{ id: 'm2', name: 'Pessoa Dois' }, { id: 'm1', name: 'Pessoa Um' }], TODAY, '3')
  it('maior carteira primeiro', () => {
    expect(rows.map((r) => r.user_id)).toEqual(['m1', 'm2'])
  })
  it('m1: carteira P1 (3 unidades, vacância 1/2), tarefas 1 de 2 no prazo, a renovação da vaga do P1', () => {
    expect(rows[0]).toMatchObject({ properties: 1, units: 3, vacancy: 0.5, signed: { fresh: 0, renewals: 1 }, requests: { count: 0, avgDays: null } })
    expect(rows[0].tasks).toEqual({ measured: 2, onTime: 1, rate: 0.5, late: 0 })
    expect(rows[0].delinquency).toBeCloseTo(50000 / 280000, 10)
  })
  it('m2: carteira P2 (1 unidade, ocupada), a tarefa atrasada, o chamado resolvido em 4 dias, a locação nova', () => {
    expect(rows[1]).toMatchObject({ properties: 1, units: 1, vacancy: 0, signed: { fresh: 1, renewals: 0 }, requests: { count: 1, avgDays: 4 }, delinquency: null })
    expect(rows[1].tasks).toEqual({ measured: 1, onTime: 0, rate: 0, late: 1 })
  })
})
