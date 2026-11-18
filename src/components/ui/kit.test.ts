// Testes do kit de lista de 07/11/2026: escolha de colunas lembrada, arquivo do "Exportar" (cabeçalho =
// colunas à vista, linhas = o que está filtrado) e a tabela do "Comparar" (melhor e pior por linha).
// Rodar: npx vitest run src/components/ui
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildSession } from '@/auth/session'
import { USER } from '@/data/seed'
import { getDb, resetForTest } from '@/data/store'
import { listUnits } from '@/data/views/units'
import { downloadTable, sheetCell, toSheetRows, xlsxBytes } from '@/lib/exportar'
import { toCsv } from '@/lib/csv'
import { unitColumns } from '@/modules/imoveis/components'
import { clearMarked, COMPARE_MAX, getMarked, toggleMarked } from './Compare'
import { buildComparison, comparisonExport, formatMonths, type MetricDef } from './compare-model'
import { columnsKey, exportColumnsOf, isColumnVisible, readColumnPrefs, toggleColumnPref, type ColumnPrefs } from './columns'

/** localStorage de mentira (o Node do teste não tem): um Map com a mesma cara. */
function fakeStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 }
}

describe('Colunas: escolha lembrada por tabela', () => {
  const cols = [
    { key: 'code', header: 'Unidade', locked: true },
    { key: 'status', header: 'Situação' },
    { key: 'pets', header: 'Animais', optional: true },
  ]
  const original = globalThis.localStorage
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage(), configurable: true })
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true })
  })

  it('padrão: travada e normais à vista, opcional escondida', () => {
    const none: ColumnPrefs = { on: [], off: [] }
    expect(cols.filter((c) => isColumnVisible(c, none)).map((c) => c.key)).toEqual(['code', 'status'])
  })

  it('ligar e desligar guarda só a diferença do padrão; travada não sai', () => {
    let p: ColumnPrefs = { on: [], off: [] }
    p = toggleColumnPref(p, cols[2]) // liga Animais
    p = toggleColumnPref(p, cols[1]) // desliga Situação
    p = toggleColumnPref(p, cols[0]) // tenta desligar a travada
    expect(p).toEqual({ on: ['pets'], off: ['status'] })
    expect(cols.filter((c) => isColumnVisible(c, p)).map((c) => c.key)).toEqual(['code', 'pets'])
    // Ligar de novo a que era do padrão apaga a marca (não guarda o que já é o padrão).
    expect(toggleColumnPref(p, cols[1])).toEqual({ on: ['pets'], off: [] })
  })

  it('persiste na chave imobil:colunas:<tabela> e volta igual depois de "recarregar"', () => {
    const p = toggleColumnPref({ on: [], off: [] }, cols[2])
    globalThis.localStorage.setItem(columnsKey('unidades'), JSON.stringify(p))
    expect(columnsKey('unidades')).toBe('imobil:colunas:unidades')
    expect(readColumnPrefs('unidades')).toEqual({ on: ['pets'], off: [] }) // a leitura nova (como depois do F5)
    expect(readColumnPrefs('contratos')).toEqual({ on: [], off: [] }) // outra tabela não herda
  })

  it('o que vem guardado estragado vira o padrão, sem quebrar a tela', () => {
    globalThis.localStorage.setItem(columnsKey('x'), '{"on":"pets","off":[1,"status"]}')
    expect(readColumnPrefs('x')).toEqual({ on: [], off: ['status'] })
    globalThis.localStorage.setItem(columnsKey('y'), 'não é json')
    expect(readColumnPrefs('y')).toEqual({ on: [], off: [] })
  })
})

describe('Exportar: colunas à vista e só o que está filtrado', () => {
  beforeEach(() => {
    resetForTest('2026-11-04')
  })

  it('o arquivo tem o cabeçalho das colunas à vista (na ordem) e as linhas do filtro, em .xlsx e CSV', async () => {
    const s = buildSession(getDb(), USER.admin)!
    s.today = '2026-11-04'
    const all = unitColumns({ showProperty: true, linkPeople: true })
    // A pessoa ligou "Animais do locatário" e desligou "Donos".
    const prefs: ColumnPrefs = { on: ['pets'], off: ['owners'] }
    const visible = all.filter((c) => isColumnVisible(c, prefs))
    const cols = exportColumnsOf(visible)
    const filtered = await listUnits(s, { filters: { status: ['occupied'], spot: ['nao'] }, page: 1, pageSize: 100_000 })
    const head = cols.map((c) => c.label)
    expect(head).toContain('Animais do locatário')
    expect(head).not.toContain('Donos')
    expect(head).not.toContain('Bloco') // opcional não ligada
    expect(head.slice(0, 3)).toEqual(['Unidade', 'Arquivada', 'Imóvel'])

    const sheet = toSheetRows(filtered.rows, cols)
    expect(sheet[0]).toEqual(head)
    expect(sheet.length - 1).toBe(filtered.total)
    // Dinheiro sai como NÚMERO na planilha (coluna "(R$)").
    const rentCol = head.indexOf('Aluguel vigente (R$)')
    expect(typeof sheet[1][rentCol]).toBe('number')
    expect(sheet[1][rentCol]).toBe(filtered.rows[0].lease!.rent_cents / 100)

    // O .xlsx de verdade, lido de volta.
    const wb = XLSX.read(await xlsxBytes([{ name: 'Dados', rows: sheet }]), { type: 'array' })
    const back = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Dados, { header: 1 })
    expect(back[0]).toEqual(head)
    expect(back.length - 1).toBe(filtered.total)

    // O CSV: mesma primeira linha, separada por ponto e vírgula, com o BOM do Excel.
    const csv = toCsv(filtered.rows, cols)
    expect(csv.startsWith('﻿' + head.join(';'))).toBe(true)
    expect(csv.split('\r\n').length - 1).toBe(filtered.total)
  })

  it('número em pt-BR vira número só em coluna com unidade no nome (o código "0101" continua texto)', () => {
    expect(sheetCell('Aluguel (R$)', '1.234,56')).toBe(1234.56)
    expect(sheetCell('Área (m²)', '65,5')).toBe(65.5)
    expect(sheetCell('Tempo de contrato (meses)', '12')).toBe(12)
    expect(sheetCell('Unidade', '0101')).toBe('0101')
    expect(sheetCell('Aluguel (R$)', '')).toBeNull()
  })

  it('downloadTable tira o ".csv" antigo do nome (a extensão vem do formato)', async () => {
    // Sem navegador não há download; o teste confere só que a porta aceita o nome antigo sem quebrar.
    const created: string[] = []
    const realDoc = globalThis.document
    const realUrl = globalThis.URL.createObjectURL
    Object.defineProperty(globalThis, 'document', {
      value: { createElement: () => ({ click() {}, remove() {}, set download(v: string) { created.push(v) }, set href(_: string) {} }), body: { appendChild() {} } },
      configurable: true,
    })
    globalThis.URL.createObjectURL = () => 'blob:x'
    try {
      await downloadTable('vagas.csv', [{ a: 1 }], [{ label: 'A', value: (r) => r.a }], 'csv')
      await downloadTable('vagas.csv', [{ a: 1 }], [{ label: 'A', value: (r) => r.a }], 'xlsx')
    } finally {
      Object.defineProperty(globalThis, 'document', { value: realDoc, configurable: true })
      globalThis.URL.createObjectURL = realUrl
    }
    expect(created).toEqual(['vagas.csv', 'vagas.xlsx'])
  })
})

describe('Comparar', () => {
  type It = { name: string; occ: number | null; overdue: number; who: string | null }
  const metrics: MetricDef<It>[] = [
    { key: 'occ', label: 'Ocupação', kind: 'pct', better: 'higher', value: (i) => i.occ },
    { key: 'overdue', label: 'Vencido', kind: 'money', better: 'lower', value: (i) => i.overdue },
    { key: 'who', label: 'Locatário', kind: 'text', value: (i) => i.who },
  ]
  const items: It[] = [
    { name: 'A', occ: 90, overdue: 0, who: 'Ana' },
    { name: 'B', occ: 60, overdue: 50000, who: null },
    { name: 'C', occ: null, overdue: 0, who: 'Caio' },
  ]

  it('marca o melhor e o pior de cada linha numérica; vazio e texto não ganham marca', () => {
    const rows = buildComparison(items, metrics)
    expect(rows[0].cells.map((c) => c.mark)).toEqual(['best', 'worst', null])
    expect(rows[0].cells[2].text).toBe('sem dado')
    // Empate no melhor: os dois levam a marca (menor vencido é melhor).
    expect(rows[1].cells.map((c) => c.mark)).toEqual(['best', 'worst', 'best'])
    expect(rows[2].cells.map((c) => c.mark)).toEqual([null, null, null])
  })

  it('todos iguais: ninguém é melhor nem pior', () => {
    const rows = buildComparison([items[0], { ...items[0], name: 'D' }], metrics)
    expect(rows[0].cells.every((c) => c.mark === null)).toBe(true)
  })

  it('o arquivo da comparação tem uma linha por coisa e a unidade no nome da coluna', () => {
    const cols = comparisonExport((i: It) => i.name, metrics, 'Imóvel')
    expect(cols.map((c) => c.label)).toEqual(['Imóvel', 'Ocupação (%)', 'Vencido (R$)', 'Locatário'])
    const sheet = toSheetRows(items, cols)
    expect(sheet[2]).toEqual(['B', 60, 500, null])
  })

  it('tempo em meses lido por gente', () => {
    expect(formatMonths(0)).toBe('menos de 1 mês')
    expect(formatMonths(8)).toBe('8 meses')
    expect(formatMonths(12)).toBe('1 ano')
    expect(formatMonths(28)).toBe('2 anos e 4 meses')
  })

  it('marcar para comparar para no máximo e desmarcar tira', () => {
    clearMarked('t')
    for (let i = 0; i < COMPARE_MAX + 2; i++) toggleMarked('t', `id${i}`)
    expect(getMarked('t')).toHaveLength(COMPARE_MAX)
    toggleMarked('t', 'id0')
    expect(getMarked('t')).not.toContain('id0')
    clearMarked('t')
    expect(getMarked('t')).toEqual([])
  })
})
