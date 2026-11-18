// A Visão geral contra o resto do sistema, nos dados fictícios de 04/11/2026:
// 1. ida e volta CSV -> medida (simulada) -> indicadores = indicadores direto dos dados;
// 2. o número de cada alerta é o que a lista de destino mostra com os filtros gravados;
// 3. quem vê o quê (proprietária independente, colaborador sem financeiro, portal).
// Rodar: npx vitest run src/modules/visao-geral
import { describe, expect, it } from 'vitest'
import { buildSession } from '@/auth/session'
import { scopeFor } from '@/data/scope'
import { USER } from '@/data/seed'
import { resetForTest } from '@/data/store'
import { listContracts } from '@/data/views/contracts'
import { listEntries, listMaintenance } from '@/data/views/finance'
import { isSpot, listUnits, toUnitRows } from '@/data/views/units'
import { listTasks } from '@/modules/processos/repo'
import { powerBiExample } from '@/powerbi/exportar'
import { fromDadosBrutos, parseCsv, POWERBI_TABLES } from '@/powerbi/schema'
// ?raw: o Vite entrega o arquivo como texto (sem precisar do módulo fs do Node).
import leiaMe from '../../../powerbi/LEIA-ME.md?raw'
import { buildLite } from './lite'
import { PERIOD_KEYS, unitStatuses } from './metrics'
import { DEFAULT_FILTERS, getOverview } from './repo'

const TODAY = '2026-11-04'
const db = resetForTest(TODAY)
const session = (userId: string) => {
  const s = buildSession(db, userId)!
  s.today = TODAY
  return s
}

describe('Power BI: ida e volta pelos CSVs de exemplo', () => {
  const ex = powerBiExample(TODAY)

  it('os indicadores lidos dos CSVs são idênticos aos calculados direto, nos 4 períodos', () => {
    expect(ex.fromCsv).toHaveLength(PERIOD_KEYS.length)
    expect(ex.fromCsv).toEqual(ex.direct)
    expect(ex.warnings).toEqual([])
    // Não é uma comparação de vazio com vazio: há dado de verdade nos dois lados.
    expect(ex.direct[1].occupancy.units).toBeGreaterThan(100)
    expect(ex.direct[1].revenue.forecast).toBeGreaterThan(0)
    expect(ex.direct[1].overdue.count).toBeGreaterThan(0)
  })

  it('cada CSV tem BOM, ";" e as colunas do esquema, na ordem', () => {
    for (const t of POWERBI_TABLES) {
      const file = ex.csv.find((f) => f.table === t.table)!
      expect(file.name).toBe(`${t.table}.csv`)
      expect(file.text.charCodeAt(0)).toBe(0xfeff)
      const [head, ...body] = parseCsv(file.text)
      expect(head).toEqual(t.columns.map((c) => c.column))
      expect(body.length).toBe(file.rows)
      expect(body.length).toBeGreaterThan(0)
    }
  })

  it('valor em reais vira centavos inteiros (sem vírgula no JSON)', () => {
    const lanc = ex.raw.lancamentos as Record<string, unknown>[]
    expect(lanc.every((r) => Number.isInteger(r.amount_cents) && Number.isInteger(r.paid_cents))).toBe(true)
  })

  it('nenhuma coluna de pessoa vai para o Power BI (só a equipe somada); o adaptador zera o responsável', () => {
    const fields = POWERBI_TABLES.flatMap((t) => t.columns.map((c) => c.field))
    expect(fields.some((f) => /assignee|manager|user|name_person|person/.test(f))).toBe(false)
    const back = fromDadosBrutos(ex.raw)
    expect(back.data.tasks.length).toBeGreaterThan(0)
    expect(back.data.tasks.every((t) => t.assignee_id === null)).toBe(true)
    expect(back.data.maintenance.every((r) => r.assignee_id === null)).toBe(true)
    // Os números da equipe somada vêm do mesmo jeito pelos CSVs (a ida e volta acima já compara tudo).
    expect(ex.direct[1].tasks.measured).toBeGreaterThan(0)
    expect(ex.direct[1].spots.units).toBeGreaterThan(0)
  })

  it('o LEIA-ME documenta toda tabela e toda coluna do esquema', () => {
    const doc = leiaMe
    for (const t of POWERBI_TABLES) {
      expect(doc, t.table).toContain(`'${t.table}'`)
      for (const c of t.columns) expect(doc, `${t.table}[${c.column}]`).toContain(`[${c.column}]`)
    }
  })
})

describe('Power BI: o adaptador não confia no que chega', () => {
  it('aceita rótulo com ou sem acento, e "Vencido" vira em aberto', () => {
    const a = fromDadosBrutos({
      hoje: '2026-11-04',
      unidades: [{ id: 'u1', code: 'A-1', manual_status: 'Em manutencao', property_id: 'p1', property_name: 'Prédio' }],
      lancamentos: [{ id: 'e1', direction: 'A receber', category: 'Aluguel', status: 'Vencido', due_date: '2026-10-10', amount_cents: 100000, paid_cents: null, property_id: 'p1' }],
    })
    expect(a.warnings).toEqual([])
    expect(a.data.units[0].manual_status).toBe('maintenance')
    expect(a.data.entries[0]).toMatchObject({ direction: 'receivable', category: 'rent', status: 'open', paid_cents: 0 })
  })
  it('lista que não é lista, data vazia e código desconhecido viram aviso (e não número errado)', () => {
    const a = fromDadosBrutos({
      contratos: 'oi',
      lancamentos: [
        { id: 'e1', direction: 'A receber', category: 'Aluguel', status: 'Em aberto', due_date: '', amount_cents: 100, property_id: 'p1' },
        { id: 'e2', direction: 'A receber', category: 'Luvas', status: 'Em aberto', due_date: '2026-10-10', amount_cents: 100, property_id: 'p1' },
      ],
    })
    expect(a.data.contracts).toEqual([])
    expect(a.data.entries.map((e) => [e.id, e.category])).toEqual([['e2', 'other']]) // e1 sem vencimento ficou de fora
    expect(a.warnings).toHaveLength(3)
    expect(a.hoje).toBeNull()
  })
})

describe('a ocupação das fórmulas é a mesma das telas (rules.ts)', () => {
  it('unidade a unidade, para a imobiliária e para a proprietária independente', () => {
    for (const user of [USER.admin, USER.landlord]) {
      const s = session(user)
      const sc = scopeFor(db, s)
      const lite = buildLite(db, sc, { money: false })
      const mine = unitStatuses(lite.units, lite.contracts, TODAY)
      // A vaga de garagem não entra na ocupação (lite.ts): a tela de Imóveis também lista as unidades sem ela.
      const screen = toUnitRows(db, sc, TODAY).filter((u) => !u.deleted_at && !isSpot(u))
      expect(mine.size).toBe(screen.length)
      for (const u of screen) expect(mine.get(u.id), u.code).toBe(u.status)
    }
  })

  it('vaga de garagem fica fora: 186 unidades da imobiliária (18 casas + 120 + 48 apartamentos), não 282', async () => {
    const s = session(USER.admin)
    const lite = buildLite(db, scopeFor(db, s), { money: true })
    expect(lite.units).toHaveLength(186)
    const d = await getOverview(s, DEFAULT_FILTERS)
    expect(d.overview.occupancy.units).toBe(186)
    expect(d.unitsInAccount).toBe(186)
    // O contrato da vaga continua contando como locação (prazo e reajuste são de verdade).
    const spotLeases = db.contracts.filter((k) => k.kind === 'lease' && lite.contracts.some((c) => c.id === k.id) && db.units.find((u) => u.id === k.unit_id)?.kind === 'parking')
    expect(spotLeases.length).toBeGreaterThan(0)
  })
})

describe('o número de cada alerta é o que a lista de destino mostra', () => {
  it('com os filtros que o botão grava, a lista dá o mesmo total', async () => {
    const s = session(USER.admin)
    const d = await getOverview(s, DEFAULT_FILTERS)
    const all = { page: 1, pageSize: 100_000 }
    const byKey = Object.fromEntries(d.alerts.map((a) => [a.key, a]))
    expect(Object.keys(byKey).sort()).toEqual(['chamados', 'cobrancas', 'contratos', 'orcamentos', 'reajustes', 'tarefas'])

    const ending = await listContracts(s, { ...all, filters: byKey.contratos.target.filters })
    expect(ending.total).toBe(d.overview.ending.d60)
    const adjustments = await listContracts(s, { ...all, filters: byKey.reajustes.target.filters })
    expect(adjustments.total).toBe(d.overview.adjustments.length)
    const late = await listMaintenance(s, { ...all, filters: byKey.chamados.target.filters })
    expect(late.total).toBe(d.overview.requests.late)
    const quotes = await listMaintenance(s, { ...all, filters: byKey.orcamentos.target.filters })
    expect(quotes.total).toBe(d.overview.requests.awaitingOwner)
    // Cobranças: com o filtro "atraso: mais5" a lista mostra exatamente as vencidas há mais de 5 dias.
    const overdue = await listEntries(s, { ...all, filters: byKey.cobrancas.target.filters })
    expect(overdue.total).toBe(d.overview.overdue.lateCount)
    expect(overdue.totals.overdue).toBe(d.overview.overdue.lateCents)
    const tasks = await listTasks(s, { ...all, filters: byKey.tarefas.target.filters })
    expect(tasks.total).toBeGreaterThan(0)
    expect(byKey.tarefas.title).toBe(`${tasks.total} tarefas atrasadas`)
    expect(byKey.tarefas.target.remember).toEqual({ key: 'imobil:processos:aba', value: 'tarefas' })
    expect(byKey.cobrancas.action).toBe('Ver cobranças')
  })

  it('cada barra de situação abre Imóveis com o mesmo número de unidades', async () => {
    const s = session(USER.admin)
    const d = await getOverview(s, DEFAULT_FILTERS)
    for (const [status, n] of Object.entries(d.overview.byStatus)) {
      // spot: ['nao'] é o recorte que a categoria Unidades de Imóveis põe em toda consulta (sem as vagas).
      const r = await listUnits(s, { page: 1, pageSize: 1, filters: { status: [status], spot: ['nao'] } })
      expect(r.total, status).toBe(n)
    }
  })

  it('com filtro de carteira, a lista abre no mesmo recorte', async () => {
    const s = session(USER.admin)
    const base = await getOverview(s, DEFAULT_FILTERS)
    const pf = base.options.portfolios.find((o) => o.label === 'Residencial')!
    const d = await getOverview(s, { ...DEFAULT_FILTERS, portfolio: pf.value })
    expect(d.propertyIds).not.toBeNull()
    expect(d.overview.occupancy.units).toBe(pf.count)
    const occupied = await listUnits(s, { page: 1, pageSize: 1, filters: { status: ['occupied'], property: d.propertyIds!, spot: ['nao'] } })
    expect(occupied.total).toBe(d.overview.byStatus.occupied)
  })
})

describe('quem vê o quê', () => {
  it('proprietária independente: sem carteira, sem repasse, sem filtro de responsável', async () => {
    const d = await getOverview(session(USER.landlord), DEFAULT_FILTERS)
    expect(d.show).toMatchObject({ money: true, transfers: false, portfolios: false, managers: false })
    expect(d.overview.transfers.total).toBe(0)
    expect(d.overview.occupancy.units).toBe(9) // Marina: as 9 salas do Le Plaza (as 24 vagas ficam fora)
  })

  it('colaborador sem "finance:view": nenhum dinheiro sai do repositório', async () => {
    const s = session(USER.leasing)
    expect(s.permissions.has('finance:view')).toBe(false)
    const d = await getOverview(s, DEFAULT_FILTERS)
    expect(d.show.money).toBe(false)
    expect(d.overview.revenue.forecast).toBe(0)
    expect(d.overview.monthly.every((p) => p.forecast === 0)).toBe(true)
    expect(d.alerts.some((a) => a.key === 'cobrancas')).toBe(false)
    expect(d.alerts.find((a) => a.key === 'orcamentos')?.detail ?? '').not.toContain('R$')
    // Nem pela comparação com o período anterior, nem pela pontualidade, nem pelo desempenho dele.
    expect(d.overview.revenuePrev.forecast).toBe(0)
    expect(d.overview.punctuality.due).toBe(0)
    expect(d.overview.upkeep.total).toBe(0)
    expect(d.team.rows.every((r) => r.delinquency === null)).toBe(true)
  })

  it('id lembrado de outra conta vira "todos" (troca de persona)', async () => {
    const agency = await getOverview(session(USER.admin), DEFAULT_FILTERS)
    const foreign = agency.options.properties[0].value
    const d = await getOverview(session(USER.landlord), { ...DEFAULT_FILTERS, property: foreign })
    expect(d.filters.property).toBe('')
    expect(d.overview.occupancy.units).toBe(9) // Marina: as 9 salas do Le Plaza
  })

  it('portal (proprietário, inquilino, prestador) não tem Visão geral', async () => {
    for (const user of [USER.owner, USER.lessee, USER.vendor]) {
      await expect(getOverview(session(user), DEFAULT_FILTERS)).rejects.toThrow('equipe')
    }
  })
})
