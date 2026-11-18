/* =============================================================================
   Tela de Chamados (lista): indicadores -> barra de lista -> tabela -> paginação.

   Os indicadores olham TUDO o que a pessoa enxerga (não só a página) e, clicados, ligam o
   filtro correspondente: "Atrasados 3" vira a lista dos 3 atrasados.
   Equipe vê todos os chamados da conta; proprietário, os das unidades dele; inquilino, os da
   unidade dele; prestador, os atribuídos a ele (o escopo do repositório decide).
   Com ?aba=rotinas no endereço, a mesma página mostra as rotinas de manutenção (RoutinesView).
   Barra (07/11/2026): a mesma de toda lista, com "Colunas" (imobil:colunas:manutencao) e o
   "Exportar" (planilha ou CSV) com as colunas à vista.
   ============================================================================= */
import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal } from '@/auth/permissions'
import { useRepo } from '@/data/hooks'
import { CHARGED_TO, MAINTENANCE_CATEGORY, MAINTENANCE_STATUS, PRIORITY } from '@/data/labels'
import { listMaintenance, type MaintenanceRow } from '@/data/views/finance'
import { csvMoney } from '@/lib/csv'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatDate, formatMonth, monthStart } from '@/lib/dates'
import { formatBRL, formatBRLShort } from '@/lib/money'
import { useListState } from '@/lib/useListState'
import { Button } from '@/components/ui/Button'
import { exportColumnsOf, useColumnChooser } from '@/components/ui/columns'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { KpiTile, PageHeader } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, Skeleton } from '@/components/ui/States'
import { OpenRequestDialog } from './dialogs'
import { CATEGORIES, maintenanceSummary, PRIORITIES } from './repo'
import { RoutinesView } from './RoutinesView'
import { DueDate, MaintenanceNav, PriorityBadge, StatusBadge } from './ui'

const STATUS_ORDER = ['open', 'triage', 'quote', 'awaiting_owner', 'approved', 'in_progress', 'done', 'canceled'] as const

/**
 * Chamados ou Rotinas, conforme o endereço. São dois componentes separados (e não um "if" no meio
 * de um só) porque cada um tem os próprios ganchos: trocar de aba trocaria a quantidade de ganchos
 * do mesmo componente, e o React recusa.
 */
export function MaintenancePage({ aba }: { aba?: 'rotinas' }) {
  return aba === 'rotinas' ? <RoutinesView /> : <RequestsList />
}

function RequestsList() {
  const s = useSession()
  const navigate = useNavigate()
  const list = useListState('manutencao')
  const q = useRepo('manutencao', (sess) => listMaintenance(sess, list.params), [list.params])
  const summary = useRepo('manutencao:resumo', maintenanceSummary)
  const [opening, setOpening] = useState(false)
  const portal = isPortal(s)

  /**
   * Clique no indicador: liga o filtro daquele recorte, somado aos que já estão ligados.
   * Por que não "trocar todos os filtros": o useListState grava cada mudança a partir do estado
   * da última tela desenhada; limpar e ligar no mesmo clique faria a segunda gravação apagar a
   * primeira. Com os filtros limpos (o normal), o número da lista é o do indicador.
   */
  const only = (key: string, values: string[]) => list.setFilter(key, values)

  // Categoria e data de abertura moram na 2ª linha da célula do chamado: cabe tudo em 1440 px sem
  // rolar a tabela para o lado. O cabeçalho "Chamado" ordena pela abertura (o mais novo primeiro).
  const allColumns: Column<MaintenanceRow>[] = [
    {
      key: 'created_at', header: 'Chamado', sortable: true, firstDir: 'desc', locked: true,
      export: [
        { label: 'Chamado', value: (r) => r.code },
        { label: 'Título', value: (r) => r.title },
        { label: 'Categoria', value: (r) => MAINTENANCE_CATEGORY[r.category] },
        { label: 'Aberto em', value: (r) => formatDate(r.created_at.slice(0, 10)) },
      ],
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <Link to="/manutencao/$requestId" params={{ requestId: r.id }} className="w-fit font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.code}
          </Link>
          <span className="max-w-44 truncate text-text sm:max-w-56">{r.title}</span>
          <span className="text-xs text-muted">
            {MAINTENANCE_CATEGORY[r.category]}
            <span className="hidden sm:inline"> · aberto em {formatDate(r.created_at.slice(0, 10))}</span>
          </span>
          {/* No celular a coluna Situação some: o selo vem para cá, para a tabela caber sem rolar. */}
          <span className="mt-1 sm:hidden">
            <StatusBadge status={r.status} />
          </span>
        </span>
      ),
    },
    {
      key: 'unit', header: 'Unidade', hideBelow: 'md',
      export: [{ label: 'Unidade', value: (r) => r.unit_code }, { label: 'Imóvel', value: (r) => r.property_name }],
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{r.unit_code}</span>
          <span className="max-w-36 truncate text-xs text-muted">{r.property_name}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Situação', hideBelow: 'sm', export: [{ label: 'Situação', value: (r) => MAINTENANCE_STATUS[r.status] }], cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'priority', header: 'Prioridade', sortable: true, firstDir: 'desc', hideBelow: 'sm', export: [{ label: 'Prioridade', value: (r) => PRIORITY[r.priority] }], cell: (r) => <PriorityBadge priority={r.priority} /> },
    {
      key: 'due_date', header: 'Prazo', sortable: true, firstDir: 'desc',
      export: [{ label: 'Prazo', value: (r) => formatDate(r.due_date) }, { label: 'Atrasado', value: (r) => (r.late ? 'Sim' : 'Não') }],
      cell: (r) => <DueDate date={r.due_date} late={r.late} />,
    },
    { key: 'requester', header: 'Quem pediu', optional: true, hideBelow: 'lg', export: [{ label: 'Quem pediu', value: (r) => r.requester_name }], cell: (r) => <span className="block max-w-40 truncate">{r.requester_name ?? ''}</span> },
    { key: 'vendor', header: 'Prestador', hideBelow: 'lg', export: [{ label: 'Prestador', value: (r) => r.vendor_name }], cell: (r) => (r.vendor_name ? <span className="block max-w-40 truncate">{r.vendor_name}</span> : <span className="text-muted">A definir</span>) },
    {
      key: 'quote', header: 'Orçamento', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md',
      export: [{ label: 'Orçamento (R$)', value: (r) => csvMoney(r.quote_cents) }],
      cell: (r) => <span className="whitespace-nowrap">{r.quote_cents ? formatBRL(r.quote_cents) : <span className="text-muted">Sem orçamento</span>}</span>,
    },
    { key: 'charged_to', header: 'Quem paga', optional: true, hideBelow: 'lg', export: [{ label: 'Quem paga', value: (r) => (r.charged_to ? CHARGED_TO[r.charged_to] : '') }], cell: (r) => (r.charged_to ? CHARGED_TO[r.charged_to] : '') },
  ]
  const { visible: columns, chooser } = useColumnChooser('manutencao', allColumns)

  const exportList = async (format: ExportFormat) => {
    const all = await listMaintenance(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable('chamados', all.rows, exportColumnsOf(columns), format)
  }

  const k = summary.data
  return (
    <Guard action="maintenance:view" what="os chamados de manutenção">
      <PageHeader
        eyebrow="Manutenção"
        title="Chamados"
        description={portal ? 'Os chamados das suas unidades: em que pé está cada um e o que falta.' : 'Do pedido à conclusão: triagem, prestador, orçamento, aprovação do proprietário e execução.'}
        actions={
          <>
            <MaintenanceNav current="chamados" />
            {can(s, 'maintenance:open') && (
              <Button variant="primary" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setOpening(true)}>
                Abrir chamado
              </Button>
            )}
          </>
        }
      />
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {k ? (
          <>
            <KpiTile label="Abertos" value={k.open.toLocaleString('pt-BR')} hint="nem concluídos nem cancelados" onClick={() => only('open', ['aberto'])} />
            <KpiTile label="Atrasados" value={k.late.toLocaleString('pt-BR')} tone={k.late ? 'danger' : undefined} hint="passaram do prazo" onClick={() => only('late', ['sim'])} />
            {/* Na conta de proprietário independente ninguém espera o "sim" do dono (é ele quem registra): ali o 3º indicador é a execução. */}
            {s.org.kind === 'agency' ? (
              <KpiTile label="Aguardando proprietário" value={k.awaitingOwner.toLocaleString('pt-BR')} hint="orçamento esperando o sim" onClick={() => only('status', ['awaiting_owner'])} />
            ) : (
              <KpiTile label="Em execução" value={k.inProgress.toLocaleString('pt-BR')} hint="serviço começado" onClick={() => only('status', ['in_progress'])} />
            )}
            <KpiTile
              label="Custo do mês"
              value={formatBRLShort(k.monthCostCents)}
              hint={`${k.monthDoneCount} ${k.monthDoneCount === 1 ? 'concluído' : 'concluídos'} em ${formatMonth(monthStart(s.today))}`}
              info="Soma dos orçamentos dos chamados concluídos neste mês (data de conclusão no fuso da conta). Chamado sem orçamento conta zero."
            />
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px]" />)
        )}
      </section>
      <ListToolbar
        state={list}
        noun={['chamado', 'chamados']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        onExport={exportList}
        columns={chooser}
        searchPlaceholder="Buscar chamado, unidade ou prestador"
        filters={[
          { key: 'status', label: 'Situação', options: STATUS_ORDER.map((v) => ({ value: v, label: MAINTENANCE_STATUS[v] })) },
          { key: 'category', label: 'Categoria', options: CATEGORIES.map((v) => ({ value: v, label: MAINTENANCE_CATEGORY[v] })) },
          { key: 'priority', label: 'Prioridade', options: [...PRIORITIES].reverse().map((v) => ({ value: v, label: PRIORITY[v] })) },
          { key: 'property', label: 'Imóvel', options: k?.properties ?? [] },
          { key: 'open', label: 'Andamento', options: [{ value: 'aberto', label: 'Abertos' }, { value: 'fechado', label: 'Encerrados (concluídos ou cancelados)' }] },
          { key: 'late', label: 'Atraso', options: [{ value: 'sim', label: 'Atrasados' }] },
        ]}
      />
      <DataTable
        caption="Chamados de manutenção"
        columns={columns}
        rows={q.data?.rows}
        rowKey={(r) => r.id}
        sort={list.sort}
        onSort={list.toggleSort}
        onRowClick={(r) => void navigate({ to: '/manutencao/$requestId', params: { requestId: r.id } })}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={
          <EmptyState
            title="Nenhum chamado encontrado"
            description={list.activeFilterCount ? 'Nenhum chamado passa nos filtros ligados. Limpe os filtros para ver todos.' : 'Quando alguém abrir um chamado, ele aparece aqui.'}
            action={!list.activeFilterCount && can(s, 'maintenance:open') ? <Button onClick={() => setOpening(true)}>Abrir chamado</Button> : undefined}
          />
        }
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      {opening && <OpenRequestDialog onClose={() => setOpening(false)} />}
    </Guard>
  )
}
