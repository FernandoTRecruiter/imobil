// Relatórios nos dados fictícios de 04/11/2026: batem com a Visão geral, os totais fecham,
// os filtros cortam o que devem e cada pessoa vê só as abas que pode.
// Rodar: npx vitest run src/modules/relatorios
import { describe, expect, it } from 'vitest'
import { buildSession } from '@/auth/session'
import { USER } from '@/data/seed'
import { resetForTest } from '@/data/store'
import { isRevenue } from '@/modules/visao-geral/metrics'
import { DEFAULT_FILTERS, getOverview } from '@/modules/visao-geral/repo'
import { getReports } from './repo'
import { DEFAULT_REPORT_FILTERS } from './reports'
import { cellCsv, cellText, reportTables, sheetName, tableToCsv, tableToSheetRows } from './tables'

const TODAY = '2026-11-04'
const db = resetForTest(TODAY)
const session = (userId: string) => {
  const s = buildSession(db, userId)!
  s.today = TODAY
  return s
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('os relatórios batem com a Visão geral (mesmas fórmulas)', async () => {
  const s = session(USER.admin)
  const r = (await getReports(s, DEFAULT_REPORT_FILTERS)).reports
  const o = (await getOverview(s, { ...DEFAULT_FILTERS, period: '12' })).overview

  it('ocupação de hoje e o último ponto do histórico = indicador da Visão geral', () => {
    expect(r.occupancy.now).toEqual(o.occupancy)
    expect(r.occupancy.history).toHaveLength(12)
    const last = r.occupancy.history[11]
    expect(last).toMatchObject({ date: TODAY, occupied: o.occupancy.occupied, rentable: o.occupancy.rentable })
    expect(r.occupancy.history[0].date).toBe('2025-12-31')
    expect(sum(r.occupancy.byProperty.map((p) => p.units))).toBe(o.occupancy.units)
    expect(sum(r.occupancy.byKind.map((p) => p.occupied))).toBe(o.occupancy.occupied)
  })

  it('inadimplência: mesma conta; faixas, locatários e lista somam o "em atraso"', () => {
    const d = r.delinquency
    expect(d.revenue).toEqual(o.revenue)
    expect(d.revenue.overdue).toBeGreaterThan(0)
    expect(sum(d.aging.map((b) => b.cents))).toBe(d.revenue.overdue)
    expect(sum(d.byLessee.map((b) => b.cents))).toBe(d.revenue.overdue)
    expect(sum(d.list.map((b) => b.open_cents))).toBe(d.revenue.overdue)
    expect(d.list).toHaveLength(sum(d.aging.map((b) => b.count)))
    expect(d.list[0].days).toBeGreaterThanOrEqual(d.list[d.list.length - 1].days) // mais antigas primeiro
  })

  it('receitas e despesas: os meses somam o período e as categorias "na conta" somam a receita', () => {
    const c = r.cash
    expect(c.byMonth).toHaveLength(12)
    expect(sum(c.byMonth.map((m) => m.forecast))).toBe(c.revenue.forecast)
    expect(sum(c.byMonth.map((m) => m.received))).toBe(c.revenue.received)
    expect(sum(c.byMonth.map((m) => m.paid))).toBe(c.expenses.paid)
    const revenueCats = c.byCategory.filter((x) => x.direction === 'receivable' && x.counts)
    expect(sum(revenueCats.map((x) => x.forecast))).toBe(c.revenue.forecast)
    // taxa de administração aparece, mas fora da conta (sai do próprio aluguel)
    expect(c.byCategory.find((x) => x.category === 'admin_fee')?.counts).toBe(false)
    expect(c.expenses).toEqual(o.expenses)
  })

  it('repasses: líquido = bruto - taxa - despesas, por proprietário e por mês', () => {
    const t = r.transfers
    expect(t.totals.count).toBeGreaterThan(0)
    expect(t.totals.net).toBe(t.totals.gross - t.totals.fee - t.totals.expenses)
    expect(sum(t.byOwner.map((x) => x.net))).toBe(t.totals.net)
    expect(sum(t.byMonth.map((x) => x.net))).toBe(t.totals.net)
    const inDb = db.owner_transfers.filter((x) => x.organization_id === s.org.id && x.month >= r.period.first)
    expect(t.totals.count).toBe(inDb.length)
  })

  it('rentabilidade: resultado = recebido - despesas do proprietário - taxa; recebido = receita recebida', () => {
    const p = r.profitability
    for (const row of p.rows) expect(row.result, row.property).toBe(row.received - row.ownerExpenses - row.fee)
    expect(p.totals.received).toBe(r.cash.revenue.received)
    expect(p.totals.fee).toBeGreaterThan(0)
    // taxa estimada fica perto da taxa lançada (8% ou 10% do aluguel): entre 7% e 11% do recebido
    expect(p.totals.fee / p.totals.received).toBeGreaterThan(0.07)
    expect(p.totals.fee / p.totals.received).toBeLessThan(0.11)
  })

  it('manutenção: a situação soma os abertos; o custo por imóvel soma o custo', () => {
    const m = r.maintenance
    expect(m.opened).toBeGreaterThan(0)
    expect(sum(m.byStatus.map((x) => x.count))).toBe(m.opened)
    expect(sum(m.byCategory.map((x) => x.opened))).toBe(m.opened)
    expect(sum(m.costByProperty.map((x) => x.cost))).toBe(m.cost)
    expect(m.avgDays).not.toBeNull()
  })
})

describe('filtros dos relatórios', () => {
  it('proprietário: Carlos tem 4 unidades e os repasses são só dele', async () => {
    const s = session(USER.admin)
    const base = await getReports(s, DEFAULT_REPORT_FILTERS)
    const carlos = base.options.owners.find((x) => x.label === 'Carlos Mendes')!
    expect(carlos.count).toBe(4)
    const r = await getReports(s, { ...DEFAULT_REPORT_FILTERS, owner: carlos.value })
    expect(r.reports.occupancy.now.units).toBe(4)
    expect(r.reports.transfers.byOwner.map((x) => x.owner)).toEqual(['Carlos Mendes'])
  })

  it('imóvel: lançamento sem imóvel (repasse, taxa) sai; a receita fica só do imóvel', async () => {
    const s = session(USER.admin)
    const base = await getReports(s, DEFAULT_REPORT_FILTERS)
    const prop = base.options.properties.find((x) => x.label === 'Condomínio Mount Juic')!
    const r = await getReports(s, { ...DEFAULT_REPORT_FILTERS, property: prop.value })
    expect(r.reports.occupancy.now.units).toBe(prop.count)
    expect(r.reports.cash.byCategory.some((x) => x.category === 'transfer' || x.category === 'admin_fee')).toBe(false)
    expect(r.reports.profitability.rows.map((x) => x.property)).toEqual(['Condomínio Mount Juic'])
    expect(r.reports.cash.revenue.forecast).toBeLessThan(base.reports.cash.revenue.forecast)
  })

  it('vaga de garagem não entra na ocupação: o Mount Juic tem 120 apartamentos (e 60 vagas à parte)', async () => {
    const s = session(USER.admin)
    const base = await getReports(s, DEFAULT_REPORT_FILTERS)
    const prop = base.options.properties.find((x) => x.label === 'Condomínio Mount Juic')!
    expect(prop.count).toBe(120)
    const r = await getReports(s, { ...DEFAULT_REPORT_FILTERS, property: prop.value })
    expect(r.reports.occupancy.now.units).toBe(120)
    expect(r.reports.occupancy.byKind.map((x) => x.key)).not.toContain('parking')
    expect(r.reports.profitability.rows[0].units).toBe(120)
    // A receita da vaga continua no caixa do imóvel (é dinheiro de verdade), só não conta como unidade.
    expect(r.reports.profitability.rows[0].received).toBeGreaterThan(0)
  })

  it('carteira lembrada de outra conta vira "todas"', async () => {
    const agency = await getReports(session(USER.admin), DEFAULT_REPORT_FILTERS)
    const r = await getReports(session(USER.landlord), { ...DEFAULT_REPORT_FILTERS, portfolio: agency.options.portfolios[0].value, owner: 'qualquer' })
    expect(r.filters).toEqual(DEFAULT_REPORT_FILTERS)
  })
})

describe('quem vê o quê', () => {
  it('colaborador com relatórios e sem financeiro: só ocupação e manutenção, sem custo', async () => {
    const s = session(USER.leasing)
    expect(s.permissions.has('reports:view')).toBe(true)
    const d = await getReports(s, DEFAULT_REPORT_FILTERS)
    expect(d.show.money).toBe(false)
    const ids = Object.keys(reportTables(d)).sort()
    expect(ids).toEqual(['manutencao-categoria', 'manutencao-situacao', 'ocupacao-historico', 'ocupacao-imovel', 'ocupacao-tipo'])
    expect(reportTables(d)['manutencao-categoria']!.columns.some((c) => c.key === 'cost')).toBe(false)
    expect(d.reports.cash.revenue.forecast).toBe(0)
    expect(d.reports.transfers.totals.count).toBe(0)
  })

  it('proprietária independente: sem repasses, sem coluna de taxa, taxa zero', async () => {
    const d = await getReports(session(USER.landlord), DEFAULT_REPORT_FILTERS)
    expect(d.show).toMatchObject({ money: true, transfers: false, fee: false, portfolios: false, owners: false })
    const t = reportTables(d)
    expect(t['repasses-proprietario']).toBeUndefined()
    expect(t.rentabilidade!.columns.some((c) => c.key === 'fee')).toBe(false)
    expect(d.reports.profitability.totals.fee).toBe(0)
    expect(d.reports.cash.byCategory.every((x) => isRevenue(x) || x.direction === 'payable')).toBe(true)
  })

  it('portal e colaborador sem "reports:view" não têm relatórios', async () => {
    for (const user of [USER.owner, USER.lessee, USER.vendor, USER.maint]) {
      await expect(getReports(session(user), DEFAULT_REPORT_FILTERS), user).rejects.toThrow('equipe')
    }
  })
})

describe('exportação', () => {
  it('cada saída converte do seu jeito: tela, CSV e Excel', () => {
    expect(cellText('money', 123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56')
    expect(cellCsv('money', 123456)).toBe('1234,56')
    expect(cellCsv('pct', 0.9238)).toBe('92,4')
    expect(cellCsv('decimal', 1234.56)).toBe('1234,6')
    expect(cellCsv('date', '2026-11-04')).toBe('04/11/2026')
    expect(cellCsv('month', '2026-11-01')).toBe('nov/2026')
    expect(cellText('pct', null)).toBe('')
  })

  it('Excel: cabeçalho em português, dinheiro em reais com centavos, taxa em %', async () => {
    const d = await getReports(session(USER.admin), DEFAULT_REPORT_FILTERS)
    const t = reportTables(d)['inadimplencia-faixas']!
    const rows = tableToSheetRows(t)
    expect(rows[0].map((c) => c.v)).toEqual(['Faixa', 'Cobranças', 'Saldo em atraso', 'Parte do total'])
    const first = d.reports.delinquency.aging[0]
    expect(rows[1][2]).toEqual({ v: first.cents / 100, z: '#,##0.00' })
    expect(rows[1][3].z).toBe('0.0%')
    const csv = tableToCsv(t)
    expect(csv.charCodeAt(0)).toBe(0xfeff) // BOM: o Excel lê os acentos certo
    // Primeira linha (a quebra do CSV é CR+LF; aqui basta cortar no LF e tirar o CR).
    expect(csv.slice(1).split(String.fromCharCode(10))[0].trim()).toBe('Faixa;Cobranças;Saldo em atraso;Parte do total')
  })

  it('nome de aba: até 31 letras, sem caractere proibido e sem repetir', () => {
    const used = new Set<string>()
    expect(sheetName('Receitas/despesas: [mês]', used)).toBe('Receitas despesas   mês')
    expect(sheetName('Por categoria', used)).toBe('Por categoria')
    expect(sheetName('Por categoria', used)).toBe('Por categoria 2')
    expect(sheetName('x'.repeat(40), used)).toHaveLength(31)
  })

  it('todas as tabelas cabem no Excel com nome de aba único', async () => {
    const t = reportTables(await getReports(session(USER.admin), DEFAULT_REPORT_FILTERS))
    const sheets = Object.values(t).map((x) => x!.sheet)
    expect(sheets).toHaveLength(14)
    expect(new Set(sheets).size).toBe(sheets.length)
    expect(sheets.every((x) => x.length <= 31)).toBe(true)
  })
})
