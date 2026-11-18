/* =============================================================================
   Financeiro: lançamentos a receber e a pagar (anatomia única: cabeçalho -> indicadores ->
   barra de lista -> tabela -> paginação).

   Indicadores = as "abas" Previsto, Vencido, Recebido e Pago do plano: cada um é um botão que
   liga o filtro de situação. Eles somam o recorte dos OUTROS filtros (direção, categoria, imóvel,
   competência, busca), sem o filtro de situação; senão, ao clicar em "Vencido", os outros três
   iriam a zero e a faixa deixaria de comparar.

   Quem vê o quê (o escopo do repositório decide; a tela só ajusta o texto):
   - equipe: tudo da conta; grava com finance:edit;
   - proprietário: os lançamentos dos imóveis dele + atalho para os repasses (só leitura);
   - inquilina: "Cobranças", só as dela, só leitura.

   Barra (07/11/2026): a mesma de toda lista, com "Colunas" (imobil:colunas:financeiro) e o
   "Exportar" (planilha ou CSV) com as colunas à vista.
   ============================================================================= */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeftRight, Plus } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, hasFeature, isPortal } from '@/auth/permissions'
import { useRepo } from '@/data/hooks'
import { CHARGED_TO, ENTRY_CATEGORY } from '@/data/labels'
import type { EntryState } from '@/data/rules'
import { AGING_LABEL, listEntries, type EntryRow } from '@/data/views/finance'
import type { EntryCategory } from '@/data/types'
import { csvMoney } from '@/lib/csv'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatDate, formatMonth } from '@/lib/dates'
import { formatBRL, formatBRLShort } from '@/lib/money'
import { readJSON, writeJSON } from '@/lib/storage'
import { useListState } from '@/lib/useListState'
import { Button } from '@/components/ui/Button'
import { exportColumnsOf, useColumnChooser } from '@/components/ui/columns'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/Layout'
import { ListToolbar, type FilterDef } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { CancelEntryDialog, EntryActions, NewEntryDialog, PaymentDialog } from './EntryDialogs'
import { listPropertyOptions } from './repo'
import { ENTRY_STATE_LABEL, EntryStateBadge, FilterKpi, LinkButton } from './ui'

/** Valores aceitos em /financeiro?aba=... (a rota valida com a mesma lista). */
export type FinanceTab = 'previsto' | 'vencido' | 'recebido' | 'pago'
const TAB_STATE: Record<FinanceTab, EntryState> = { previsto: 'forecast', vencido: 'overdue', recebido: 'received', pago: 'paid' }
const STATES: EntryState[] = ['forecast', 'overdue', 'received', 'paid', 'canceled']

/**
 * Abre a lista já filtrada pela situação pedida no endereço (?aba=vencido): grava a escolha ANTES de
 * useListState ler o que está guardado (é o mesmo caminho que as outras telas usam para abrir esta já
 * filtrada). A direção "a receber" entra junto quando nada foi escolhido antes: o aviso "cobranças
 * vencidas" fala do que a conta tem a receber.
 */
function rememberTab(aba: FinanceTab | undefined): true {
  if (!aba) return true
  const key = 'imobil:list:financeiro'
  const saved = readJSON<{ filters?: Record<string, string[]>; sort?: unknown; pageSize?: number }>(key) ?? {}
  writeJSON(key, { filters: { direction: ['receivable'], ...(saved.filters ?? {}), state: [TAB_STATE[aba]] }, sort: saved.sort ?? null, pageSize: saved.pageSize ?? 25 })
  return true
}

export function FinancePage({ aba }: { aba?: FinanceTab }) {
  return (
    <Guard action="finance:view" what="o financeiro">
      <FinanceScreen aba={aba} />
    </Guard>
  )
}

function FinanceScreen({ aba }: { aba?: FinanceTab }) {
  const s = useSession()
  const navigate = useNavigate()
  const portal = isPortal(s)
  const lessee = portal && s.roles.includes('lessee') && !s.roles.includes('owner')
  const owner = portal && s.roles.includes('owner')
  const canEdit = can(s, 'finance:edit') && !portal
  // Roda uma vez, antes de useListState (a ordem dos ganchos garante): ver rememberTab.
  useState(() => rememberTab(portal ? undefined : aba))
  // O portal guarda as escolhas em outra chave: um filtro "a pagar" que a equipe deixou ligado
  // neste navegador esconderia, sem aviso, parte do extrato do proprietário.
  // Primeira visita da equipe: o que está EM ABERTO a receber, do vencimento mais antigo ao mais novo
  // (a cobrança mais atrasada em cima). "Limpar" volta para tudo.
  const list = useListState(
    portal ? 'financeiro-portal' : 'financeiro',
    portal ? {} : { filters: { direction: ['receivable'], state: ['overdue', 'forecast'] }, sort: { key: 'due_date', dir: 'asc' } },
  )
  useEffect(() => {
    if (aba) void navigate({ to: '/financeiro', search: {}, replace: true }) // tira o ?aba= do endereço depois de aplicado
  }, [aba, navigate])

  const q = useRepo('financeiro', (sess) => listEntries(sess, list.params), [list.params])
  // Indicadores: o mesmo recorte sem o filtro de situação (ver o cabeçalho do arquivo).
  const kpiParams = useMemo(() => ({ search: list.params.search, filters: { ...list.filters, state: [] }, page: 1, pageSize: 1 }), [list.params.search, list.filters])
  const kq = useRepo('financeiro:indicadores', (sess) => listEntries(sess, kpiParams), [kpiParams])
  const props = useRepo('financeiro:imoveis', listPropertyOptions, [], { enabled: !lessee })

  const [paying, setPaying] = useState<EntryRow | null>(null)
  const [canceling, setCanceling] = useState<EntryRow | null>(null)
  const [creating, setCreating] = useState(false)

  const states = list.filters.state ?? []
  const direction = list.filters.direction ?? []
  const toggleState = (st: EntryState) => list.setFilter('state', states.length === 1 && states[0] === st ? [] : [st])
  const t = kq.data?.totals
  const mixed = !portal && direction.length !== 1
  // "Recebido" só existe no que é a receber e "Pago" só no que é a pagar: com uma direção escolhida,
  // o indicador da outra ficaria em R$ 0,00 sem explicar por quê, então ele sai da faixa.
  const tiles: ('forecast' | 'overdue' | 'received' | 'paid')[] = lessee
    ? ['forecast', 'overdue', 'received']
    : !portal && direction.length === 1
      ? ['forecast', 'overdue', direction[0] === 'receivable' ? 'received' : 'paid']
      : ['forecast', 'overdue', 'received', 'paid']

  // Dado secundário vai na segunda linha da célula (competência sob o vencimento, unidade sob a pessoa,
  // pago sob o valor): assim "Em aberto" e "Situação" cabem na tela sem rolar a tabela para o lado.
  const allColumns: Column<EntryRow>[] = [
    {
      key: 'due_date', header: 'Vencimento', sortable: true, firstDir: 'desc', hideBelow: 'sm',
      export: [{ label: 'Vencimento', value: (e) => formatDate(e.due_date) }, { label: 'Competência', value: (e) => formatMonth(e.competence) }],
      cell: (e) => (
        <span className="flex flex-col whitespace-nowrap">
          <span className="num">{formatDate(e.due_date)}</span>
          <span className="text-xs text-muted">comp. {formatMonth(e.competence)}</span>
        </span>
      ),
    },
    {
      key: 'description', header: 'Descrição', locked: true,
      export: [
        { label: 'Descrição', value: (e) => e.description },
        { label: 'Categoria', value: (e) => ENTRY_CATEGORY[e.category] },
        { label: 'Direção', value: (e) => (e.direction === 'receivable' ? 'A receber' : 'A pagar') },
        { label: 'Contrato', value: (e) => e.contract_code },
      ],
      cell: (e) => (
        <span className="flex max-w-[15rem] min-w-0 flex-col">
          <span className="truncate font-medium" title={e.description}>{e.description}</span>
          {/* Celular (abaixo de 640 px): vencimento, saldo e situação vêm aqui, e as colunas deles somem. */}
          <span className="text-xs text-muted sm:hidden">vence {formatDate(e.due_date)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
            {/* Em aberto mostra o saldo; quitado ou cancelado mostra o valor (o "R$ 0,00" não diria nada). */}
            <Money cents={e.status === 'open' ? e.open_cents : e.amount_cents} muted={e.status !== 'open'} className={cn('text-sm', e.state === 'overdue' && 'font-semibold text-danger-fg')} />
            <EntryStateBadge state={e.state} daysOverdue={e.days_overdue} payer={lessee} />
          </span>
          <span className="hidden truncate text-xs text-muted sm:block">
            {ENTRY_CATEGORY[e.category]}
            {mixed && ` · ${e.direction === 'receivable' ? 'a receber' : 'a pagar'}`}
            {e.contract_id && (
              <>
                {' · '}
                <Link to="/contratos/$contractId" params={{ contractId: e.contract_id }} className="text-primary hover:underline">
                  {e.contract_code}
                </Link>
              </>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'person', header: lessee ? 'Unidade' : 'Pessoa e unidade', sortable: !lessee, firstDir: 'asc', hideBelow: 'md',
      export: [...(lessee ? [] : [{ label: 'Pessoa', value: (e: EntryRow) => e.person_name }]), { label: 'Unidade', value: (e) => e.unit_label ?? e.property_name }],
      cell: (e) => (
        <span className="flex max-w-[13rem] min-w-0 flex-col">
          {!lessee && <Clip text={e.person_name} empty="Sem pessoa" />}
          <span className={cn('truncate', !lessee && 'text-xs text-muted')} title={e.unit_label ?? e.property_name ?? ''}>
            {e.unit_label ?? e.property_name ?? 'Geral'}
          </span>
        </span>
      ),
    },
    { key: 'charged_to', header: 'Quem arca', optional: true, hideBelow: 'lg', export: [{ label: 'Quem arca', value: (e) => (e.charged_to ? CHARGED_TO[e.charged_to] : '') }], cell: (e) => (e.charged_to ? CHARGED_TO[e.charged_to] : '') },
    {
      key: 'amount', header: 'Valor', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'sm',
      export: [{ label: 'Valor (R$)', value: (e) => csvMoney(e.amount_cents) }, { label: 'Pago (R$)', value: (e) => csvMoney(e.paid_cents) }],
      cell: (e) => (
        <span className="flex flex-col items-end">
          <Money cents={e.amount_cents} />
          {e.paid_cents > 0 && e.state !== 'received' && e.state !== 'paid' && <span className="text-xs whitespace-nowrap text-muted">pago {formatBRL(e.paid_cents)}</span>}
        </span>
      ),
    },
    { key: 'open', header: 'Em aberto', align: 'right', hideBelow: 'sm', export: [{ label: 'Em aberto (R$)', value: (e) => csvMoney(e.open_cents) }], cell: (e) => <Money cents={e.open_cents} muted={!e.open_cents} className={cn(e.state === 'overdue' && 'font-semibold text-danger-fg')} /> },
    {
      key: 'days_overdue', header: 'Situação', sortable: true, firstDir: 'desc', hideBelow: 'sm',
      export: [{ label: 'Situação', value: (e) => (e.state === 'overdue' ? `Vencido há ${e.days_overdue} dias` : lessee && e.state === 'received' ? 'Pago' : ENTRY_STATE_LABEL[e.state]) }],
      cell: (e) => <EntryStateBadge state={e.state} daysOverdue={e.days_overdue} payer={lessee} />,
    },
    ...(!portal
      ? [{ key: 'acoes', header: '', locked: true, className: 'w-12', cell: (e: EntryRow) => <EntryActions entry={e} canEdit={canEdit} onPay={() => setPaying(e)} onCancel={() => setCanceling(e)} /> }]
      : []),
  ]

  // O portal guarda a escolha em outra chave (as colunas dele são outras: sem pessoa, sem ações).
  const { visible: columns, chooser } = useColumnChooser(portal ? 'financeiro-portal' : 'financeiro', allColumns)
  const exportList = async (format: ExportFormat) => {
    const all = await listEntries(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable(lessee ? 'cobrancas' : 'lancamentos', all.rows, exportColumnsOf(columns), format)
  }

  // Competências: as que existem no recorte (das facets) mais as já escolhidas, do mais novo ao mais antigo.
  const competences = [...new Set([...Object.keys(q.data?.facets.competence ?? {}), ...(list.filters.competence ?? [])])].sort().reverse()
  const filters: FilterDef[] = [
    { key: 'state', label: 'Situação', options: STATES.map((v) => ({ value: v, label: lessee && v === 'received' ? 'Pago' : ENTRY_STATE_LABEL[v] })) },
    { key: 'category', label: 'Categoria', options: (Object.keys(ENTRY_CATEGORY) as EntryCategory[]).map((v) => ({ value: v, label: ENTRY_CATEGORY[v] })) },
    ...(lessee ? [] : [{ key: 'property', label: 'Imóvel', options: props.data ?? [] }]),
    { key: 'competence', label: 'Competência', options: competences.map((c) => ({ value: c, label: formatMonth(`${c}-01`) })) },
    // Faixa de atraso: é o filtro que o alerta "vencidas há mais de 5 dias" da Visão geral liga.
    { key: 'atraso', label: 'Atraso', options: Object.entries(AGING_LABEL).map(([value, label]) => ({ value, label })) },
  ]

  const title = lessee ? 'Cobranças' : owner ? 'Extratos' : 'Lançamentos'
  const description = lessee
    ? 'Aluguéis e outras cobranças do seu contrato, com o que já foi pago e o que está em aberto.'
    : owner
      ? 'O que entra e sai pelos seus imóveis, do jeito que a administração registra. O que você recebe por mês está em Repasses.'
      : 'Contas a receber e a pagar. "Vencido" é calculado com a data de hoje; pagamento parcial deixa o saldo em aberto.'

  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title={title}
        description={description}
        actions={
          <>
            {hasFeature(s, 'transfers') && !lessee && (
              <LinkButton to="/financeiro/repasses" icon={<ArrowLeftRight className="size-4" aria-hidden="true" />} variant={owner ? 'primary' : 'secondary'}>
                {owner ? 'Ver meus repasses' : 'Repasses'}
              </LinkButton>
            )}
            {canEdit && (
              <Button variant="primary" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setCreating(true)}>
                Novo lançamento
              </Button>
            )}
          </>
        }
      />

      <div className={cn('grid grid-cols-2 gap-3', tiles.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
        {tiles.map((st) => {
          const value = !t ? null : st === 'forecast' ? t.forecast : st === 'overdue' ? t.overdue : st === 'received' ? t.received : t.paid
          return (
            <FilterKpi
              key={st}
              active={states.length === 1 && states[0] === st}
              onToggle={() => toggleState(st)}
              label={lessee ? { forecast: 'A vencer', overdue: 'Vencido', received: 'Pago', paid: 'Pago' }[st] : ENTRY_STATE_LABEL[st]}
              value={value === null ? '…' : formatBRLShort(value)}
              tone={st === 'overdue' && (value ?? 0) > 0 ? 'danger' : undefined}
              hint={st === 'forecast' || st === 'overdue' ? (mixed ? 'saldo a receber e a pagar' : 'saldo em aberto') : 'lançamentos quitados'}
              info={KPI_INFO[st](s.today)}
            />
          )
        })}
      </div>

      {!portal && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Direção">
          {(
            [
              ['all', 'Tudo'],
              ['receivable', 'A receber'],
              ['payable', 'A pagar'],
            ] as const
          ).map(([v, label]) => {
            const on = v === 'all' ? direction.length !== 1 : direction.length === 1 && direction[0] === v
            return (
              <button
                key={v}
                aria-pressed={on}
                onClick={() => list.setFilter('direction', v === 'all' ? [] : [v])}
                className={cn('h-9 rounded-lg border px-4 text-sm font-medium', on ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface hover:border-border-strong')}
              >
                {label}
                {q.data && v !== 'all' && <span className="num ml-1.5 text-xs opacity-80">{(q.data.facets.direction?.[v] ?? 0).toLocaleString('pt-BR')}</span>}
              </button>
            )
          })}
        </div>
      )}

      <ListToolbar
        state={list}
        noun={lessee ? ['cobrança', 'cobranças'] : ['lançamento', 'lançamentos']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        onExport={exportList}
        columns={chooser}
        searchPlaceholder={lessee ? 'Buscar por descrição' : 'Buscar por descrição, pessoa, unidade ou contrato'}
        filters={filters}
      />
      <DataTable
        caption={title}
        columns={columns}
        rows={q.data?.rows}
        rowKey={(e) => e.id}
        sort={list.sort}
        onSort={list.toggleSort}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={
          <EmptyState
            title={lessee ? 'Nenhuma cobrança encontrada' : 'Nenhum lançamento encontrado'}
            description={list.activeFilterCount ? 'Nada passa nos filtros ligados. Limpe os filtros para ver tudo.' : 'Os lançamentos aparecem aqui quando um contrato é ativado ou alguém lança uma conta.'}
            action={
              list.activeFilterCount ? (
                <Button onClick={list.clearFilters}>Limpar filtros</Button>
              ) : canEdit ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Novo lançamento
                </Button>
              ) : undefined
            }
          />
        }
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      {paying && <PaymentDialog entry={paying} onClose={() => setPaying(null)} />}
      {canceling && <CancelEntryDialog entry={canceling} onClose={() => setCanceling(null)} />}
      {creating && <NewEntryDialog onClose={() => setCreating(false)} />}
    </>
  )
}

/** A fórmula de cada indicador (vai no "i", nunca num parágrafo de aviso). */
const KPI_INFO: Record<'forecast' | 'overdue' | 'received' | 'paid', (today: string) => string> = {
  forecast: () => 'Soma do saldo em aberto que ainda não venceu, no recorte dos filtros. Pagamento parcial já desconta.',
  overdue: (today) => `Saldo em aberto com vencimento antes de hoje (${formatDate(today)}). Calculado na hora: não é gravado.`,
  received: () => 'Soma dos lançamentos a receber já quitados (valor inteiro). Parcial de lançamento ainda aberto não entra: ele reduz o saldo em aberto.',
  paid: () => 'Soma dos lançamentos a pagar já quitados (valor inteiro).',
}

/** Valor em reais que não quebra linha (R$ e número juntos). */
function Money({ cents, muted, className }: { cents: number; muted?: boolean; className?: string }) {
  return <span className={cn('whitespace-nowrap', muted && 'text-muted', className)}>{formatBRL(cents)}</span>
}

/** Texto longo cortado com reticências (o inteiro aparece ao passar o mouse); vazio vira o texto cinza. */
function Clip({ text, empty }: { text: string | null; empty: string }) {
  return text ? (
    <span className="block max-w-[13rem] truncate" title={text}>
      {text}
    </span>
  ) : (
    <span className="text-muted">{empty}</span>
  )
}
