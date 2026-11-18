/* =============================================================================
   Relatórios (equipe com "reports:view"): seis relatórios em abas, com os mesmos filtros.

   Anatomia: PageHeader (com "Excel") -> filtros -> abas. Em cada aba: faixa de indicadores
   (o 1º em destaque) -> blocos com título, "i" e CSV -> tabela ordenável ou gráfico.
   Cada tabela é declarada uma vez em tables.ts: a tela, o CSV e a aba do Excel saem dela.
   Abas de dinheiro só aparecem com "finance:view"; Repasses, só na imobiliária.
   ============================================================================= */
import { useMemo, useState, type ReactNode } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { hasFeature } from '@/auth/permissions'
import { useRepo } from '@/data/hooks'
import { runList } from '@/data/query'
import { downloadText } from '@/lib/csv'
import { formatDate, formatMonth } from '@/lib/dates'
import { formatBRL, formatBRLShort } from '@/lib/money'
import { readJSON, writeJSON } from '@/lib/storage'
import { plural } from '@/lib/text'
import { useListState } from '@/lib/useListState'
import { BarList } from '@/components/ui/BarList'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ExportMenu } from '@/components/ui/ExportMenu'
import { InfoTip } from '@/components/ui/InfoTip'
import { KpiTile, PageHeader } from '@/components/ui/Layout'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/States'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/components/ui/cn'
import { formatRate, MonthBars, SeriesLegend, type MonthSeries } from '@/modules/visao-geral/charts'
import { FilterSelect } from '@/modules/visao-geral/FilterSelect'
import { FORMULAS, PERIOD_KEYS, PERIOD_LABEL, type PeriodKey } from '@/modules/visao-geral/metrics'
import { getReports, type ReportsData } from './repo'
import { DEFAULT_REPORT_FILTERS, type ReportFilters } from './reports'
import { cellText, downloadXlsx, reportTables, tableToCsv, type AnyTable, type TableId } from './tables'

type TabKey = 'ocupacao' | 'inadimplencia' | 'caixa' | 'repasses' | 'manutencao' | 'rentabilidade'
const TAB_LABEL: Record<TabKey, string> = {
  ocupacao: 'Ocupação e vacância', inadimplencia: 'Inadimplência', caixa: 'Receitas e despesas', repasses: 'Repasses',
  manutencao: 'Manutenção', rentabilidade: 'Rentabilidade por imóvel',
}
/** Ordem das abas no Excel = ordem das abas na tela. */
const TABLE_ORDER: TableId[] = [
  'ocupacao-imovel', 'ocupacao-tipo', 'ocupacao-historico', 'inadimplencia-faixas', 'inadimplencia-locatario', 'inadimplencia-lista',
  'caixa-mes', 'caixa-categoria', 'repasses-proprietario', 'repasses-mes', 'manutencao-categoria', 'manutencao-situacao', 'manutencao-custo', 'rentabilidade',
]
const TAB_STORE = 'imobil:relatorios:aba'

export function ReportsPage() {
  const s = useSession()
  return (
    <Guard action="reports:view" what="os relatórios">
      {/* key: trocar de persona remonta a tela e os filtros lembrados passam a ser os da nova conta. */}
      <ReportsBody key={`${s.user.id}:${s.org.id}`} />
    </Guard>
  )
}

function ReportsBody() {
  const s = useSession()
  const toast = useToast()
  const storeKey = `imobil:relatorios:${s.org.id}`
  const [filters, setFilters] = useState<ReportFilters>(() => ({ ...DEFAULT_REPORT_FILTERS, ...(readJSON<Partial<ReportFilters>>(storeKey) ?? {}) }))
  const [tab, setTab] = useState<TabKey>(() => readJSON<TabKey>(TAB_STORE) ?? 'ocupacao')
  const [exporting, setExporting] = useState(false)
  const q = useRepo('relatorios', (sess) => getReports(sess, filters), [filters])
  const tables = useMemo(() => (q.data ? reportTables(q.data) : null), [q.data])

  const change = (patch: Partial<ReportFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    writeJSON(storeKey, next)
  }
  const show = q.data?.show
  const tabs = (Object.keys(TAB_LABEL) as TabKey[]).filter((t) => {
    if (!show) return t === 'ocupacao' || t === 'manutencao'
    if (t === 'repasses') return show.transfers
    if (t === 'inadimplencia' || t === 'caixa' || t === 'rentabilidade') return show.money
    return true
  })
  // Aba lembrada que esta pessoa não pode ver (troca de persona) volta para a primeira.
  const current = tabs.includes(tab) ? tab : 'ocupacao'

  const exportAll = async () => {
    if (!tables || !q.data) return
    setExporting(true)
    try {
      await downloadXlsx(TABLE_ORDER.flatMap((id) => (tables[id] ? [tables[id]] : [])), `relatorios-imobil-${q.data.today}.xlsx`, q.data.today)
    } catch {
      toast.error('Não deu para gerar o Excel. Tente de novo; se repetir, use o Exportar de cada tabela.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Relatórios"
        title="Relatórios da carteira"
        description={`${s.org.name} · dados de ${formatDate(s.today)}`}
        actions={
          <Button icon={<FileSpreadsheet className="size-4" aria-hidden="true" />} loading={exporting} loadingText="Gerando…" disabled={!tables} onClick={exportAll}>
            Exportar tudo (.xlsx)
          </Button>
        }
      />
      <FilterBar filters={q.data?.filters ?? filters} data={q.data} onChange={change} />
      {q.isLoading ? (
        <PageSkeleton />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data && tables ? (
        <div className={cn(q.isFetching && 'opacity-70 transition-opacity')}>
          <Tabs
            value={current}
            onValueChange={(v) => {
              setTab(v as TabKey)
              writeJSON(TAB_STORE, v)
            }}
            tabs={tabs.map((t) => ({ value: t, label: TAB_LABEL[t] }))}
          >
            <TabPanel value="ocupacao" className="pt-5">
              <OccupancyTab data={q.data} tables={tables} />
            </TabPanel>
            {q.data.show.money && (
              <>
                <TabPanel value="inadimplencia" className="pt-5">
                  <DelinquencyTab data={q.data} tables={tables} />
                </TabPanel>
                <TabPanel value="caixa" className="pt-5">
                  <CashTab data={q.data} tables={tables} />
                </TabPanel>
                <TabPanel value="rentabilidade" className="pt-5">
                  <ProfitTab data={q.data} tables={tables} />
                </TabPanel>
              </>
            )}
            {q.data.show.transfers && (
              <TabPanel value="repasses" className="pt-5">
                <TransfersTab data={q.data} tables={tables} />
              </TabPanel>
            )}
            <TabPanel value="manutencao" className="pt-5">
              <MaintenanceTab data={q.data} tables={tables} />
            </TabPanel>
          </Tabs>
        </div>
      ) : null}
    </>
  )
}

/* ---------------------------------------------------------------- filtros */

function FilterBar({ filters, data, onChange }: { filters: ReportFilters; data?: ReportsData; onChange: (p: Partial<ReportFilters>) => void }) {
  const s = useSession()
  // A carteira sai da sessão (a barra não muda de tamanho quando os dados chegam); o proprietário,
  // do dado (conta com um dono só não tem o que filtrar).
  const portfolios = hasFeature(s, 'portfolios')
  const owners = data ? data.show.owners : hasFeature(s, 'transfers')
  const dirty = filters.period !== DEFAULT_REPORT_FILTERS.period || !!filters.property || !!filters.portfolio || !!filters.owner
  return (
    <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap" role="group" aria-label="Filtros dos relatórios">
      <FilterSelect label="Período" value={filters.period} onChange={(v) => onChange({ period: v as PeriodKey })} options={PERIOD_KEYS.map((k) => ({ value: k, label: PERIOD_LABEL[k] }))} />
      <FilterSelect label="Imóvel" value={filters.property} onChange={(v) => onChange({ property: v })} all="Todos" options={data?.options.properties} />
      {portfolios && <FilterSelect label="Carteira" value={filters.portfolio} onChange={(v) => onChange({ portfolio: v })} all="Todas" options={data?.options.portfolios} />}
      {owners && <FilterSelect label="Proprietário" value={filters.owner} onChange={(v) => onChange({ owner: v })} all="Todos" options={data?.options.owners} />}
      {dirty && (
        <Button variant="ghost" className="col-span-2 justify-self-start sm:col-span-1" onClick={() => onChange(DEFAULT_REPORT_FILTERS)}>
          Limpar
        </Button>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- peças das abas */

type TabProps = { data: ReportsData; tables: Partial<Record<TableId, AnyTable>> }

function Kpis({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
}

/**
 * Cabeçalho de bloco: título, "i" e o "Exportar" da tabela (a mesma anatomia em todo bloco). Desde
 * 07/11/2026 é o menu de toda lista (planilha .xlsx ou CSV), no lugar do botão "N linhas · CSV".
 */
function BlockHead({ table, title, info }: { table?: AnyTable; title: string; info?: ReactNode }) {
  const s = useSession()
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-1 text-sm font-semibold">
        {title}
        {info && <InfoTip>{info}</InfoTip>}
      </h3>
      {table && (
        <ExportMenu
          size="sm"
          total={table.rows.length}
          onExport={(f) => (f === 'csv' ? downloadText(`${table.id}.csv`, tableToCsv(table)) : downloadXlsx([table], `${table.id}.xlsx`, s.today))}
        />
      )}
    </div>
  )
}

/** Bloco com gráfico (o CSV baixa a tabela que está por trás do gráfico). */
function ChartBlock({ table, title, info, children }: { table?: AnyTable; title: string; info?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <BlockHead table={table} title={title} info={info} />
      {children}
    </section>
  )
}

/** Tabela ordenável pelo cabeçalho (regra da casa: 1º clique maior/mais novo, 2º inverte, 3º volta). */
function TableBlock({ table }: { table?: AnyTable }) {
  const list = useListState(`relatorio-${table?.id ?? 'vazio'}`)
  const sorted = useMemo(() => {
    if (!table) return []
    const sorts = Object.fromEntries(table.columns.map((c) => [c.key, (r: unknown) => c.value(r)]))
    return runList(table.rows, { sort: list.sort, page: 1, pageSize: Number.MAX_SAFE_INTEGER }, { search: () => [], sorts }).rows
  }, [table, list.sort])
  if (!table) return null
  const columns: Column<unknown>[] = table.columns.map((c) => ({
    // Texto e mês (rótulo de linha) à esquerda; número, dinheiro, taxa e data à direita, sem quebrar.
    key: c.key, header: c.header, sortable: true, firstDir: c.kind === 'text' ? 'asc' : 'desc', align: c.kind === 'text' || c.kind === 'month' ? 'left' : 'right', hideBelow: c.hideBelow,
    className: c.kind !== 'text' || c.nowrap ? 'whitespace-nowrap' : undefined,
    cell: (r) => cellText(c.kind, c.value(r)),
  }))
  return (
    <section className="flex min-w-0 flex-col gap-2">
      {/* O CSV sai na ordem da tela. */}
      <BlockHead table={{ ...table, rows: sorted }} title={table.title} info={table.info} />
      <DataTable
        caption={table.title}
        columns={columns}
        rows={sorted}
        rowKey={table.rowKey}
        sort={list.sort}
        onSort={list.toggleSort}
        empty={<EmptyState title="Nada neste recorte" description="Mude o período ou limpe os filtros." />}
      />
    </section>
  )
}

/* ---------------------------------------------------------------- as abas */

function OccupancyTab({ data, tables }: TabProps) {
  const o = data.reports.occupancy
  const h = o.history
  return (
    <div className="flex flex-col gap-6">
      <Kpis>
        <KpiTile emphasis label="Ocupação hoje" value={formatRate(o.now.rate)} hint={`${o.now.occupied} de ${plural(o.now.rentable, 'alugável', 'alugáveis')}`} info={FORMULAS.occupancy} />
        <KpiTile label="Vacância" value={formatRate(o.now.vacancy)} hint={plural(o.now.vacant, 'unidade vaga', 'unidades vagas')} info={FORMULAS.vacancy} />
        <KpiTile label="Unidades" value={o.now.units} hint={o.now.blocked ? `${o.now.blocked} bloqueada${o.now.blocked > 1 ? 's' : ''}` : 'Nenhuma bloqueada'} info="Unidades ativas no recorte. Bloqueada fica fora da conta de ocupação." />
        <KpiTile label="Variação em 12 meses" value={h[0].rate === null || h[11].rate === null ? '0 p.p.' : `${((h[11].rate - h[0].rate) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })} p.p.`} hint={`de ${formatRate(h[0].rate)} em ${formatMonth(h[0].month)}`} info="Ocupação de hoje menos a do fim do primeiro mês da série, em pontos percentuais (p.p.)." />
      </Kpis>
      <TableBlock table={tables['ocupacao-imovel']} />
      {/* Lado a lado só em tela bem larga: em 1440 a tabela de 6 colunas não cabe em meia coluna. */}
      <div className="grid gap-6 2xl:grid-cols-2">
        <TableBlock table={tables['ocupacao-tipo']} />
        <ChartBlock
          table={tables['ocupacao-historico']}
          title="Últimos 12 meses"
          info="Medida no último dia de cada mês (no mês atual, hoje), a partir das locações. O bloqueio considerado é o de hoje."
        >
          <figure className="flex flex-col gap-2">
            <MonthBars
              months={h.map((p) => p.month)}
              series={[{ key: 'rate', label: 'Ocupação', values: h.map((p) => p.rate ?? 0), color: 'var(--primary)' }]}
              format={(v) => `${Math.round(v * 100)}%`}
              max={1}
              ariaLabel="Ocupação no fim de cada mês, nos últimos 12 meses"
              height={200}
            />
            <figcaption className="text-sm text-muted">
              De {formatRate(h[0].rate)} em {formatMonth(h[0].month)} para {formatRate(h[11].rate)} hoje.
            </figcaption>
          </figure>
        </ChartBlock>
      </div>
    </div>
  )
}

function DelinquencyTab({ data, tables }: TabProps) {
  const d = data.reports.delinquency
  const oldest = d.list[0]
  return (
    <div className="flex flex-col gap-6">
      <Kpis>
        <KpiTile emphasis label="Inadimplência" value={formatRate(d.revenue.delinquency)} hint={d.revenue.dueSoFar ? `de ${formatBRLShort(d.revenue.dueSoFar)} que venceram` : 'Nada venceu no período ainda'} info={FORMULAS.delinquency} />
        <KpiTile label="Em atraso" value={formatBRLShort(d.revenue.overdue)} hint={formatBRL(d.revenue.overdue)} info="Saldo em aberto das cobranças do período que já venceram." />
        <KpiTile label="Cobranças em atraso" value={d.list.length} hint={plural(d.byLessee.length, 'locatário', 'locatários')} info="Cobranças das locações vencidas e com saldo em aberto." />
        <KpiTile label="Maior atraso" value={oldest ? `${oldest.days} dias` : '0 dias'} hint={oldest ? oldest.person : 'Nenhuma em atraso'} info="Dias desde o vencimento da cobrança mais antiga em aberto." />
      </Kpis>
      <div className="grid gap-6 lg:grid-cols-3">
        <ChartBlock table={tables['inadimplencia-faixas']} title="Por faixa de atraso" info={FORMULAS.aging}>
          {d.aging.some((b) => b.count > 0) ? (
            <BarList ariaLabel="Saldo em atraso por faixa" items={d.aging.map((b) => ({ key: b.key, label: b.label, value: b.cents, display: `${formatBRLShort(b.cents)} · ${b.count}`, color: 'var(--danger)' }))} />
          ) : (
            <p className="text-sm text-muted">Nada em atraso no período.</p>
          )}
        </ChartBlock>
        <div className="min-w-0 lg:col-span-2">
          <TableBlock table={tables['inadimplencia-locatario']} />
        </div>
      </div>
      <TableBlock table={tables['inadimplencia-lista']} />
    </div>
  )
}

function CashTab({ data, tables }: TabProps) {
  const c = data.reports.cash
  const balance = c.revenue.received - c.expenses.paid
  const series: MonthSeries[] = [
    { key: 'forecast', label: 'Receita prevista', values: c.byMonth.map((m) => m.forecast), color: 'var(--primary)', opacity: 0.3 },
    { key: 'received', label: 'Recebida', values: c.byMonth.map((m) => m.received), color: 'var(--primary)' },
    { key: 'paid', label: 'Despesas pagas', values: c.byMonth.map((m) => m.paid), color: 'var(--st-blocked)' },
  ]
  return (
    <div className="flex flex-col gap-6">
      <Kpis>
        <KpiTile emphasis label="Receita prevista" value={formatBRLShort(c.revenue.forecast)} hint={`${formatBRLShort(c.revenue.upcoming)} a vencer`} info={FORMULAS.forecast} />
        <KpiTile label="Recebida" value={formatBRLShort(c.revenue.received)} hint={c.revenue.forecast ? `${formatRate(c.revenue.received / c.revenue.forecast)} da prevista` : 'Nada previsto'} info={FORMULAS.received} />
        <KpiTile label="Despesas" value={formatBRLShort(c.expenses.total)} hint={`${formatBRLShort(c.expenses.paid)} já pagas`} info={FORMULAS.expenses} />
        <KpiTile label="Saldo" value={formatBRLShort(balance)} tone={balance < 0 ? 'danger' : undefined} hint="recebida − despesas pagas" info="Receita recebida menos despesas pagas, das que vencem no período. Repasse não entra (é dinheiro do proprietário)." />
      </Kpis>
      <ChartBlock title="Por mês" info={FORMULAS.monthly}>
        <figure className="flex flex-col gap-3">
          <SeriesLegend series={series} />
          <MonthBars months={c.byMonth.map((m) => m.month)} series={series} format={(v) => formatBRLShort(v).replace(/,00$/, '')} ariaLabel="Receita prevista, recebida e despesas pagas por mês" />
          <figcaption className="text-sm text-muted">
            {PERIOD_LABEL[data.filters.period]}: recebida {formatBRL(c.revenue.received)}, despesas pagas {formatBRL(c.expenses.paid)}, saldo {formatBRL(balance)}.
          </figcaption>
        </figure>
      </ChartBlock>
      <TableBlock table={tables['caixa-mes']} />
      <TableBlock table={tables['caixa-categoria']} />
    </div>
  )
}

function TransfersTab({ data, tables }: TabProps) {
  const t = data.reports.transfers.totals
  return (
    <div className="flex flex-col gap-6">
      <Kpis>
        <KpiTile emphasis label="Líquido repassado" value={formatBRLShort(t.net)} hint={`${t.paid} de ${plural(t.count, 'repasse pago', 'repasses pagos')}`} info={FORMULAS.transfers} />
        <KpiTile label="Aluguel recebido (bruto)" value={formatBRLShort(t.gross)} info="Aluguel recebido no mês, rateado pela fatia de cada proprietário." />
        <KpiTile label="Taxa de administração" value={formatBRLShort(t.fee)} hint={t.gross ? `${formatRate(t.fee / t.gross)} do bruto` : undefined} info="Percentual do contrato de administração sobre o aluguel recebido." />
        <KpiTile label="Despesas descontadas" value={formatBRLShort(t.expenses)} info="Despesas cobradas do proprietário no mês (manutenção, condomínio de unidade vaga)." />
      </Kpis>
      {(data.filters.property || data.filters.portfolio) && (
        // Só aparece quando muda a leitura: com filtro de imóvel ligado, estes números NÃO estão filtrados.
        <p className="text-xs font-medium text-warning-fg">Repasse é por proprietário: o filtro de imóvel e o de carteira não valem nesta aba.</p>
      )}
      <TableBlock table={tables['repasses-proprietario']} />
      <TableBlock table={tables['repasses-mes']} />
    </div>
  )
}

function MaintenanceTab({ data, tables }: TabProps) {
  const m = data.reports.maintenance
  return (
    <div className="flex flex-col gap-6">
      <Kpis>
        <KpiTile emphasis label="Abertos no período" value={m.opened} hint={plural(m.byStatus.reduce((a, s) => a + (['done', 'canceled'].includes(s.key) ? 0 : s.count), 0), 'ainda aberto', 'ainda abertos')} info="Chamados criados no período." />
        <KpiTile label="Concluídos no período" value={m.closed} info="Chamados encerrados como concluídos no período (de qualquer data de abertura)." />
        <KpiTile label="Prazo médio de solução" value={m.avgDays === null ? '0 dias' : `${m.avgDays.toLocaleString('pt-BR')} dias`} hint={m.avgDays === null ? 'Nenhum concluído no período' : undefined} info="Média de dias da abertura à conclusão, dos concluídos no período." />
        {data.show.money ? (
          <KpiTile label="Custo" value={formatBRLShort(m.cost)} info="Soma dos orçamentos aprovados dos chamados concluídos no período." />
        ) : (
          <KpiTile label="Categorias" value={m.byCategory.length} info="Categorias com chamado aberto ou concluído no período." />
        )}
      </Kpis>
      <TableBlock table={tables['manutencao-categoria']} />
      <div className={cn('grid gap-6', data.show.money && 'lg:grid-cols-2')}>
        <ChartBlock table={tables['manutencao-situacao']} title="Por situação" info={tables['manutencao-situacao']?.info}>
          {m.byStatus.length ? (
            <BarList ariaLabel="Chamados por situação" items={m.byStatus.map((st) => ({ key: st.key, label: st.label, value: st.count, display: st.count }))} />
          ) : (
            <p className="text-sm text-muted">Nenhum chamado aberto no período.</p>
          )}
        </ChartBlock>
        <TableBlock table={tables['manutencao-custo']} />
      </div>
    </div>
  )
}

function ProfitTab({ data, tables }: TabProps) {
  const t = data.reports.profitability.totals
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm font-medium text-warning-fg">Estimativa operacional, não é aconselhamento contábil.</p>
      <Kpis>
        <KpiTile emphasis label="Resultado" value={formatBRLShort(t.result)} hint={t.margin === null ? 'Nada recebido no período' : `margem de ${formatRate(t.margin)}`} info={tables.rentabilidade?.info} />
        <KpiTile label="Recebido" value={formatBRLShort(t.received)} info="Parte já paga das cobranças das locações que vencem no período." />
        <KpiTile label="Despesas do proprietário" value={formatBRLShort(t.ownerExpenses)} info="Contas a pagar cobradas do proprietário (manutenção, condomínio de unidade vaga), com vencimento no período." />
        {data.show.fee ? (
          <KpiTile label="Taxa (estimada)" value={formatBRLShort(t.fee)} info="Percentual de cada contrato de locação sobre o aluguel recebido." />
        ) : (
          <KpiTile label="Imóveis" value={data.reports.profitability.rows.length} info="Imóveis com unidade ativa no recorte." />
        )}
      </Kpis>
      <TableBlock table={tables.rentabilidade} />
    </div>
  )
}
