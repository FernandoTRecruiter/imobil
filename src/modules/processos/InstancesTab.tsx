/* =============================================================================
   Aba Processos em andamento: cada processo (renovação da A-301, cobrança da Casa...) com a
   etapa atual, a barra de progresso e o "Avançar etapa".
   Avançar marca a tarefa da etapa atual como feita e cria a da próxima. Etapa que exige
   aprovação só avança aprovada: no lugar do botão aparece o motivo.
   ============================================================================= */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronsRight } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can } from '@/auth/permissions'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { ROLE } from '@/data/labels'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatDate, formatDateTime } from '@/lib/dates'
import { useListState } from '@/lib/useListState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/States'
import { advanceInstance, INSTANCE_STATUS, listInstances, listTemplates, TASK_STATUS, type InstanceRow } from './repo'

const TONE = { running: 'primary', done: 'success', canceled: 'neutral' } as const

/** Barra de progresso acessível: o leitor de tela diz "2 de 4 etapas". */
export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded-full bg-surface-2 ring-1 ring-border" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={`${done} de ${total} etapas`}>
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="num text-xs whitespace-nowrap text-muted">
        {done} de {total}
      </span>
    </span>
  )
}

export function InstancesTab() {
  const s = useSession()
  const list = useListState('processos', { filters: { status: ['running'] } })
  const q = useRepo('processos', (sess) => listInstances(sess, list.params), [list.params])
  const templates = useRepo('modelos', listTemplates)
  const [advancing, setAdvancing] = useState<InstanceRow | null>(null)
  const advance = useRepoMutation(advanceInstance, {
    success: (r) => (r.task ? `Processo avançou: agora "${r.task.title.split(' · ')[0]}".` : `Processo "${r.instance.title}" concluído.`),
    onSuccess: () => setAdvancing(null),
  })
  const edit = can(s, 'workflows:edit')

  const columns: Column<InstanceRow>[] = [
    {
      key: 'title', header: 'Processo',
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{r.template_name}</span>
          <span className="text-xs text-muted">
            {r.contract_id ? (
              <Link to="/contratos/$contractId" params={{ contractId: r.contract_id }} className="text-primary hover:underline">
                {r.title}
              </Link>
            ) : (
              r.title
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'current', header: 'Etapa atual',
      cell: (r) =>
        r.status !== 'running' ? (
          <Badge tone={TONE[r.status]}>{INSTANCE_STATUS[r.status]}</Badge>
        ) : (
          <span className="flex min-w-0 flex-col">
            <span className="text-sm">{r.current_title ?? 'Etapa removida do modelo'}</span>
            {r.current_task && (
              <span className="text-xs text-muted">
                {TASK_STATUS[r.current_task.status]}
                {r.current_task.assignee_name ? ` · ${r.current_task.assignee_name}` : r.steps[r.current_step]?.role ? ` · ${ROLE[r.steps[r.current_step].role]}` : ''}
                {r.current_task.requires_approval && (r.current_task.approved ? ' · aprovada' : ' · falta aprovar')}
              </span>
            )}
          </span>
        ),
    },
    { key: 'progress', header: 'Progresso', sortable: true, firstDir: 'desc', hideBelow: 'sm', cell: (r) => <Progress done={r.steps_done} total={r.steps.length} /> },
    { key: 'started_at', header: 'Início', sortable: true, firstDir: 'desc', hideBelow: 'md', cell: (r) => formatDate(r.started_at.slice(0, 10)) },
    {
      key: 'acao', header: '', className: 'w-56',
      cell: (r) =>
        r.status !== 'running' ? (
          <span className="text-xs text-muted">{r.completed_at ? `Concluído em ${formatDateTime(r.completed_at, s.org.timezone)}` : ''}</span>
        ) : r.advance_blocker ? (
          <span className="text-xs font-medium text-warning-fg">{r.advance_blocker}</span>
        ) : edit ? (
          <Button size="sm" icon={<ChevronsRight className="size-4" aria-hidden="true" />} onClick={() => setAdvancing(r)}>
            Avançar etapa
          </Button>
        ) : null,
    },
  ]

  const exportList = async (format: ExportFormat) => {
    const all = await listInstances(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable(
      'processos.csv',
      all.rows,
      [
        { label: 'Modelo', value: (r) => r.template_name },
        { label: 'Processo', value: (r) => r.title },
        { label: 'Situação', value: (r) => INSTANCE_STATUS[r.status] },
        { label: 'Etapa atual', value: (r) => r.current_title },
        { label: 'Etapas feitas', value: (r) => r.steps_done },
        { label: 'Etapas', value: (r) => r.steps.length },
        { label: 'Início', value: (r) => formatDate(r.started_at.slice(0, 10)) },
      ],
      format,
    )
  }

  const next = advancing ? advancing.steps[advancing.current_step + 1] : undefined
  return (
    <>
      <ListToolbar
        state={list}
        noun={['processo', 'processos']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        onExport={exportList}
        searchPlaceholder="Buscar processo, contrato ou etapa"
        filters={[
          { key: 'status', label: 'Situação', options: (['running', 'done', 'canceled'] as const).map((v) => ({ value: v, label: INSTANCE_STATUS[v] })) },
          { key: 'modelo', label: 'Modelo', options: (templates.data ?? []).map((t) => ({ value: t.key, label: t.name })) },
        ]}
      />
      <DataTable
        caption="Processos"
        columns={columns}
        rows={q.data?.rows}
        rowKey={(r) => r.id}
        sort={list.sort}
        onSort={list.toggleSort}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState title="Nenhum processo encontrado" description={list.activeFilterCount ? 'Nenhum processo passa nos filtros ligados. Limpe os filtros para ver todos.' : 'Os processos abertos pelas automações e pela equipe aparecem aqui.'} />}
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      <ConfirmDialog
        open={!!advancing}
        onOpenChange={(o) => !o && setAdvancing(null)}
        title={`Avançar "${advancing?.title ?? ''}"?`}
        message={
          advancing && (
            <p>
              "{advancing.current_title}" fica como feita
              {next ? (
                <>
                  {' '}e o processo passa para <strong>"{next.title}"</strong> ({ROLE[next.role].toLowerCase()}, prazo de {next.sla_days} {next.sla_days === 1 ? 'dia' : 'dias'}).
                </>
              ) : (
                <>. Era a última etapa: o processo fica concluído.</>
              )}
            </p>
          )
        }
        confirmLabel={next ? 'Avançar' : 'Concluir processo'}
        loading={advance.isPending}
        onConfirm={() => advancing && advance.mutate({ id: advancing.id })}
      />
    </>
  )
}
