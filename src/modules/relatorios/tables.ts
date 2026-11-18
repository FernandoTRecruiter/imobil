/* =============================================================================
   tables.ts: cada tabela dos Relatórios declarada UMA vez (colunas, formato, linhas).

   Da mesma declaração saem três coisas, e por isso elas nunca discordam:
   1. a tabela da tela (com ordenação pelo cabeçalho);
   2. o CSV daquela tabela (com a ordem que está na tela);
   3. a aba dela no Excel (uma aba por relatório).

   Formatos: dinheiro chega em centavos e taxa como fração (0,924). Cada saída converte:
   tela "R$ 1.234,56" e "92,4%"; CSV "1234,56" e "92,4"; Excel número de verdade com formato.
   ============================================================================= */
import { CHARGED_TO } from '@/data/labels'
import type { IsoDate } from '@/data/types'
import { csvMoney, toCsv } from '@/lib/csv'
import { formatDate, formatMonth } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { formatRate } from '@/modules/visao-geral/charts'
import type { ReportsData } from './repo'
import type { CashMonth, CategoryRow, HistoryPoint, LesseeRow, MaintenanceCategoryRow, MonthTransferRow, OccupancyRow, OverdueRow, OwnerTransferRow, ProfitRow } from './reports'

export type ColumnKind = 'text' | 'int' | 'decimal' | 'money' | 'pct' | 'date' | 'month'
type Cell = string | number | null

export interface ReportColumn<T> {
  key: string
  header: string
  kind: ColumnKind
  value: (r: T) => Cell
  hideBelow?: 'sm' | 'md' | 'lg'
  /** Não quebrar linha (códigos como "LOC-2025-0143" ficam ilegíveis partidos). */
  nowrap?: boolean
}

export interface ReportTable<T> {
  id: string
  title: string
  /** Nome da aba no Excel (até 31 letras, regra do Excel). */
  sheet: string
  info?: string
  rowKey: (r: T) => string
  columns: ReportColumn<T>[]
  rows: T[]
}

/** Tabela com o tipo da linha "apagado", para caber numa lista com tabelas de linhas diferentes. */
export type AnyTable = ReportTable<unknown>
function table<T>(t: ReportTable<T>): AnyTable {
  // Seguro: as funções da tabela só recebem as linhas da própria tabela.
  return t as unknown as AnyTable
}

/* ---------------------------------------------------------------- uma célula em cada saída */

/** Na tela. */
export function cellText(kind: ColumnKind, v: Cell): string {
  if (v === null || v === '') return ''
  if (typeof v === 'string') return kind === 'date' ? formatDate(v) : kind === 'month' ? formatMonth(v) : v
  if (kind === 'money') return formatBRL(v)
  if (kind === 'pct') return formatRate(v)
  if (kind === 'decimal') return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return v.toLocaleString('pt-BR')
}

/** No CSV (Excel em português lê "1234,56" como número). */
export function cellCsv(kind: ColumnKind, v: Cell): string | number | null {
  if (v === null || v === '') return null
  if (typeof v === 'string') return kind === 'date' ? formatDate(v) : kind === 'month' ? formatMonth(v) : v
  if (kind === 'money') return csvMoney(v)
  if (kind === 'pct') return (Math.round(v * 1000) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })
  if (kind === 'decimal') return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })
  return v
}

/** No Excel: número de verdade (dinheiro em reais, taxa como fração) e o formato de exibição. */
export function cellXlsx(kind: ColumnKind, v: Cell): { v: string | number | null; z?: string } {
  if (v === null || v === '') return { v: null }
  if (typeof v === 'string') return { v: kind === 'date' ? formatDate(v) : kind === 'month' ? formatMonth(v) : v }
  if (kind === 'money') return { v: v / 100, z: '#,##0.00' }
  if (kind === 'pct') return { v, z: '0.0%' }
  if (kind === 'decimal') return { v, z: '0.0' }
  return { v }
}

/** CSV de uma tabela, com o cabeçalho em português. */
export function tableToCsv(t: AnyTable): string {
  return toCsv(t.rows, t.columns.map((c) => ({ label: c.header, value: (r) => cellCsv(c.kind, c.value(r)) })))
}

/* ---------------------------------------------------------------- as tabelas */

const occCols = (first: string): ReportColumn<OccupancyRow>[] => [
  { key: 'label', header: first, kind: 'text', value: (r) => r.label },
  { key: 'units', header: 'Unidades', kind: 'int', value: (r) => r.units },
  { key: 'rentable', header: 'Alugáveis', kind: 'int', value: (r) => r.rentable, hideBelow: 'md' },
  { key: 'occupied', header: 'Ocupadas', kind: 'int', value: (r) => r.occupied },
  // "Vazias" e não "Vagas": desde 06/11 "Vaga" é a vaga de garagem (tipo de unidade), e a coluna confundiria.
  { key: 'vacant', header: 'Vazias', kind: 'int', value: (r) => r.vacant, hideBelow: 'sm' },
  { key: 'rate', header: 'Ocupação', kind: 'pct', value: (r) => r.rate },
]

export type TableId =
  | 'ocupacao-imovel' | 'ocupacao-tipo' | 'ocupacao-historico'
  | 'inadimplencia-faixas' | 'inadimplencia-locatario' | 'inadimplencia-lista'
  | 'caixa-mes' | 'caixa-categoria'
  | 'repasses-proprietario' | 'repasses-mes'
  | 'manutencao-categoria' | 'manutencao-situacao' | 'manutencao-custo'
  | 'rentabilidade'

/** Todas as tabelas que esta pessoa pode ver (as de dinheiro só com permissão de financeiro). */
export function reportTables(d: ReportsData): Partial<Record<TableId, AnyTable>> {
  const r = d.reports
  const out: Partial<Record<TableId, AnyTable>> = {}

  out['ocupacao-imovel'] = table<OccupancyRow>({ id: 'ocupacao-imovel', title: 'Por imóvel', sheet: 'Ocupação por imóvel', rowKey: (x) => x.key, columns: occCols('Imóvel'), rows: r.occupancy.byProperty })
  out['ocupacao-tipo'] = table<OccupancyRow>({ id: 'ocupacao-tipo', title: 'Por tipo de unidade', sheet: 'Ocupação por tipo', rowKey: (x) => x.key, columns: occCols('Tipo'), rows: r.occupancy.byKind })
  out['ocupacao-historico'] = table<HistoryPoint>({
    id: 'ocupacao-historico', title: 'Últimos 12 meses', sheet: 'Ocupação 12 meses', rowKey: (x) => x.month,
    columns: [
      { key: 'month', header: 'Mês', kind: 'month', value: (x) => x.month },
      { key: 'date', header: 'Medido em', kind: 'date', value: (x) => x.date, hideBelow: 'sm' },
      { key: 'rentable', header: 'Alugáveis', kind: 'int', value: (x) => x.rentable },
      { key: 'occupied', header: 'Ocupadas', kind: 'int', value: (x) => x.occupied },
      { key: 'rate', header: 'Ocupação', kind: 'pct', value: (x) => x.rate },
    ],
    rows: r.occupancy.history,
  })

  if (d.show.money) {
    const overdueTotal = r.delinquency.aging.reduce((a, b) => a + b.cents, 0)
    out['inadimplencia-faixas'] = table({
      id: 'inadimplencia-faixas', title: 'Por faixa de atraso', sheet: 'Atraso por faixa', rowKey: (x) => x.key,
      columns: [
        { key: 'label', header: 'Faixa', kind: 'text', value: (x) => x.label },
        { key: 'count', header: 'Cobranças', kind: 'int', value: (x) => x.count },
        { key: 'cents', header: 'Saldo em atraso', kind: 'money', value: (x) => x.cents },
        { key: 'share', header: 'Parte do total', kind: 'pct', value: (x) => (overdueTotal ? x.cents / overdueTotal : null) },
      ],
      rows: r.delinquency.aging,
    })
    out['inadimplencia-locatario'] = table<LesseeRow>({
      id: 'inadimplencia-locatario', title: 'Por locatário', sheet: 'Atraso por locatário', rowKey: (x) => x.key,
      columns: [
        { key: 'name', header: 'Locatário', kind: 'text', value: (x) => x.name },
        { key: 'contracts', header: 'Contratos', kind: 'text', value: (x) => x.contracts, hideBelow: 'md', nowrap: true },
        { key: 'count', header: 'Cobranças', kind: 'int', value: (x) => x.count, hideBelow: 'sm' },
        { key: 'cents', header: 'Saldo em atraso', kind: 'money', value: (x) => x.cents },
        { key: 'oldest', header: 'Maior atraso (dias)', kind: 'int', value: (x) => x.oldestDays, hideBelow: 'sm' },
      ],
      rows: r.delinquency.byLessee,
    })
    out['inadimplencia-lista'] = table<OverdueRow>({
      id: 'inadimplencia-lista', title: 'Cobranças em atraso', sheet: 'Cobranças em atraso', rowKey: (x) => x.id,
      columns: [
        { key: 'person', header: 'Locatário', kind: 'text', value: (x) => x.person },
        { key: 'unit', header: 'Unidade', kind: 'text', value: (x) => x.unit, hideBelow: 'md' },
        { key: 'contract', header: 'Contrato', kind: 'text', value: (x) => x.contract, hideBelow: 'lg', nowrap: true },
        { key: 'competence', header: 'Competência', kind: 'month', value: (x) => x.competence, hideBelow: 'sm' },
        { key: 'due', header: 'Vencimento', kind: 'date', value: (x) => x.due_date, hideBelow: 'md' },
        { key: 'days', header: 'Dias', kind: 'int', value: (x) => x.days },
        { key: 'open', header: 'Saldo', kind: 'money', value: (x) => x.open_cents },
      ],
      rows: r.delinquency.list,
    })
    out['caixa-mes'] = table<CashMonth>({
      id: 'caixa-mes', title: 'Por mês', sheet: 'Receitas e despesas por mês', rowKey: (x) => x.month,
      info: 'Pelo mês de vencimento. Saldo = recebida − despesas pagas.',
      columns: [
        { key: 'month', header: 'Mês', kind: 'month', value: (x) => x.month },
        { key: 'forecast', header: 'Receita prevista', kind: 'money', value: (x) => x.forecast, hideBelow: 'md' },
        { key: 'received', header: 'Recebida', kind: 'money', value: (x) => x.received },
        { key: 'expenses', header: 'Despesas', kind: 'money', value: (x) => x.expenses, hideBelow: 'lg' },
        { key: 'paid', header: 'Despesas pagas', kind: 'money', value: (x) => x.paid, hideBelow: 'sm' },
        { key: 'balance', header: 'Saldo', kind: 'money', value: (x) => x.balance },
      ],
      rows: r.cash.byMonth,
    })
    out['caixa-categoria'] = table<CategoryRow>({
      id: 'caixa-categoria', title: 'Por categoria', sheet: 'Por categoria', rowKey: (x) => x.key,
      info: 'Tudo o que vence no período, por categoria. "Na conta" = entra na receita ou na despesa da carteira (taxa de administração, repasse e caução não entram).',
      columns: [
        { key: 'label', header: 'Categoria', kind: 'text', value: (x) => x.label },
        { key: 'direction', header: 'Tipo', kind: 'text', value: (x) => (x.direction === 'receivable' ? 'A receber' : 'A pagar') },
        { key: 'counts', header: 'Na conta', kind: 'text', value: (x) => (x.counts ? 'Sim' : 'Não'), hideBelow: 'md' },
        { key: 'forecast', header: 'Previsto', kind: 'money', value: (x) => x.forecast },
        { key: 'settled', header: 'Realizado', kind: 'money', value: (x) => x.settled, hideBelow: 'sm' },
        { key: 'open', header: 'Em aberto', kind: 'money', value: (x) => x.open, hideBelow: 'sm' },
      ],
      rows: r.cash.byCategory,
    })
    out['rentabilidade'] = table<ProfitRow>({
      id: 'rentabilidade', title: 'Rentabilidade por imóvel', sheet: 'Rentabilidade', rowKey: (x) => x.key,
      info: d.show.fee
        ? 'Resultado = recebido − despesas do proprietário − taxa de administração. A taxa é estimada com o percentual de cada contrato sobre o aluguel recebido.'
        : 'Resultado = recebido − despesas do proprietário.',
      columns: [
        { key: 'property', header: 'Imóvel', kind: 'text', value: (x) => x.property },
        { key: 'units', header: 'Unidades', kind: 'int', value: (x) => x.units, hideBelow: 'lg' },
        { key: 'received', header: 'Recebido', kind: 'money', value: (x) => x.received },
        { key: 'expenses', header: `Despesas do ${CHARGED_TO.owner.toLowerCase()}`, kind: 'money', value: (x) => x.ownerExpenses, hideBelow: 'sm' },
        ...(d.show.fee ? [{ key: 'fee', header: 'Taxa (estimada)', kind: 'money' as const, value: (x: ProfitRow) => x.fee, hideBelow: 'md' as const }] : []),
        { key: 'result', header: 'Resultado', kind: 'money', value: (x) => x.result },
        { key: 'margin', header: 'Margem', kind: 'pct', value: (x) => x.margin, hideBelow: 'sm' },
      ],
      rows: r.profitability.rows,
    })
  }

  if (d.show.transfers) {
    const cols = <T extends OwnerTransferRow | MonthTransferRow>(): ReportColumn<T>[] => [
      { key: 'gross', header: 'Bruto', kind: 'money', value: (x) => x.gross, hideBelow: 'md' },
      { key: 'fee', header: 'Taxa', kind: 'money', value: (x) => x.fee, hideBelow: 'lg' },
      { key: 'expenses', header: 'Despesas', kind: 'money', value: (x) => x.expenses, hideBelow: 'lg' },
      { key: 'net', header: 'Líquido', kind: 'money', value: (x) => x.net },
      { key: 'paid', header: 'Pagos', kind: 'text', value: (x) => `${x.paid} de ${x.count}`, hideBelow: 'sm' },
    ]
    out['repasses-proprietario'] = table<OwnerTransferRow>({
      id: 'repasses-proprietario', title: 'Por proprietário', sheet: 'Repasses por proprietário', rowKey: (x) => x.key,
      columns: [{ key: 'owner', header: 'Proprietário', kind: 'text', value: (x) => x.owner }, { key: 'months', header: 'Meses', kind: 'int', value: (x) => x.months, hideBelow: 'md' }, ...cols<OwnerTransferRow>()],
      rows: r.transfers.byOwner,
    })
    out['repasses-mes'] = table<MonthTransferRow>({
      id: 'repasses-mes', title: 'Por mês', sheet: 'Repasses por mês', rowKey: (x) => x.month,
      columns: [{ key: 'month', header: 'Mês', kind: 'month', value: (x) => x.month }, { key: 'owners', header: 'Proprietários', kind: 'int', value: (x) => x.owners }, ...cols<MonthTransferRow>()],
      rows: r.transfers.byMonth,
    })
  }

  out['manutencao-categoria'] = table<MaintenanceCategoryRow>({
    id: 'manutencao-categoria', title: 'Por categoria', sheet: 'Manutenção por categoria', rowKey: (x) => x.key,
    info: 'Abertos = criados no período; concluídos = encerrados no período. Prazo médio = dias da abertura à conclusão.',
    columns: [
      { key: 'label', header: 'Categoria', kind: 'text', value: (x) => x.label },
      { key: 'opened', header: 'Abertos', kind: 'int', value: (x) => x.opened },
      { key: 'closed', header: 'Concluídos', kind: 'int', value: (x) => x.closed },
      { key: 'still', header: 'Ainda abertos', kind: 'int', value: (x) => x.stillOpen, hideBelow: 'md' },
      { key: 'avg', header: 'Prazo médio (dias)', kind: 'decimal', value: (x) => x.avgDays, hideBelow: 'sm' },
      ...(d.show.money ? [{ key: 'cost', header: 'Custo', kind: 'money' as const, value: (x: MaintenanceCategoryRow) => x.cost, hideBelow: 'sm' as const }] : []),
    ],
    rows: r.maintenance.byCategory,
  })
  out['manutencao-situacao'] = table({
    id: 'manutencao-situacao', title: 'Por situação', sheet: 'Manutenção por situação', rowKey: (x) => x.key,
    info: 'Situação de hoje dos chamados abertos no período.',
    columns: [
      { key: 'label', header: 'Situação', kind: 'text', value: (x) => x.label },
      { key: 'count', header: 'Chamados', kind: 'int', value: (x) => x.count },
    ],
    rows: r.maintenance.byStatus,
  })
  if (d.show.money) {
    out['manutencao-custo'] = table({
      id: 'manutencao-custo', title: 'Custo por imóvel', sheet: 'Custo de manutenção', rowKey: (x) => x.key,
      info: 'Orçamentos aprovados dos chamados concluídos no período.',
      columns: [
        { key: 'property', header: 'Imóvel', kind: 'text', value: (x) => x.property },
        { key: 'closed', header: 'Concluídos', kind: 'int', value: (x) => x.closed },
        { key: 'cost', header: 'Custo', kind: 'money', value: (x) => x.cost },
      ],
      rows: r.maintenance.costByProperty,
    })
  }
  return out
}

/* ---------------------------------------------------------------- Excel */

/** Nome de aba que o Excel aceita: sem []:*?/\, até 31 letras e sem repetir. */
export function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Planilha'
  let out = base
  for (let i = 2; used.has(out); i++) out = `${base.slice(0, 31 - String(i).length - 1)} ${i}`
  used.add(out)
  return out
}

/** Linhas de uma aba: cabeçalho + valores já no formato do Excel. */
export function tableToSheetRows(t: AnyTable): { v: string | number | null; z?: string }[][] {
  return [t.columns.map((c) => ({ v: c.header })), ...t.rows.map((r) => t.columns.map((c) => cellXlsx(c.kind, c.value(r))))]
}

/**
 * Baixa o Excel com uma aba por relatório. A biblioteca (SheetJS, ~400 KB) só é carregada
 * no clique: quem nunca exporta não paga por ela ao abrir a tela.
 */
export async function downloadXlsx(tables: AnyTable[], fileName: string, today: IsoDate): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()
  for (const t of tables) {
    const rows = tableToSheetRows(t)
    const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => c.v)))
    // Formato de exibição de cada número (dinheiro com centavos, taxa em %).
    rows.forEach((r, ri) =>
      r.forEach((c, ci) => {
        const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })]
        if (cell && c.z && typeof c.v === 'number') cell.z = c.z
      }),
    )
    ws['!cols'] = t.columns.map((c, ci) => ({ wch: Math.min(48, Math.max(c.header.length, ...rows.slice(1).map((r) => String(r[ci].v ?? '').length)) + 2) }))
    XLSX.utils.book_append_sheet(wb, ws, sheetName(t.sheet, used))
  }
  wb.Props = { Title: 'Relatórios Imobil', CreatedDate: new Date(`${today}T12:00:00`) }
  XLSX.writeFile(wb, fileName)
}
