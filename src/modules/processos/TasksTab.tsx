/* =============================================================================
   Aba Tarefas: a mesma lista em dois desenhos.
   - Lista: tabela com ordenação, filtros, exportação (o padrão de toda lista do app);
   - Quadro: três colunas A fazer | Fazendo | Feito, com botões para mover o cartão
     (botão, e não arrastar: funciona no teclado e no celular).
   Mudar a situação: quem edita processos ou o próprio responsável. Tarefa que exige
   aprovação só vira "Feito" aprovada (o botão "Aprovar" aparece para quem pode aprovar).
   ============================================================================= */
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Columns3, List, Plus } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can } from '@/auth/permissions'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatDate } from '@/lib/dates'
import { readJSON, writeJSON } from '@/lib/storage'
import { useListState } from '@/lib/useListState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Card } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { DueDate } from '@/modules/manutencao/ui'
import { approveTask, createTask, listTasks, listTeam, listTemplates, newTaskSchema, setTaskStatus, TASK_STATUS, type NewTaskInput, type TaskRow, type TaskStatus } from './repo'

const TONE = { todo: 'neutral', doing: 'primary', done: 'success', canceled: 'neutral' } as const
const MODE_KEY = 'imobil:tarefas:modo'

/** Mutations da tarefa (mudar situação e aprovar), com o aviso do que aconteceu. */
function useTaskActions() {
  const status = useRepoMutation(setTaskStatus, { success: (t) => `"${t.title}" agora está em ${TASK_STATUS[t.status]}.` })
  const approve = useRepoMutation(approveTask, { success: (t) => `"${t.title}" aprovada.` })
  return { status, approve }
}

export function TasksTab() {
  const s = useSession()
  const list = useListState('tarefas')
  const [mode, setMode] = useState<'lista' | 'quadro'>(() => (readJSON<string>(MODE_KEY) === 'quadro' ? 'quadro' : 'lista'))
  // No quadro todas as tarefas filtradas aparecem de uma vez (as colunas fazem o papel da paginação).
  const params = mode === 'quadro' ? { ...list.params, page: 1, pageSize: 1000 } : list.params
  const q = useRepo('tarefas', (sess) => listTasks(sess, params), [params])
  const team = useRepo('equipe', listTeam)
  const templates = useRepo('modelos', listTemplates)
  const [creating, setCreating] = useState(false)
  const actions = useTaskActions()

  const switchMode = (m: 'lista' | 'quadro') => {
    setMode(m)
    writeJSON(MODE_KEY, m)
  }

  const columns: Column<TaskRow>[] = [
    {
      key: 'title', header: 'Tarefa', sortable: true, firstDir: 'asc',
      cell: (t) => (
        <span className="flex min-w-0 flex-col">
          <span className="max-w-md font-medium">{t.title}</span>
          <span className="text-xs text-muted">{t.process_name}</span>
          {t.description && <span className="max-w-80 truncate text-xs text-muted">{t.description}</span>}
        </span>
      ),
    },
    { key: 'assignee', header: 'Responsável', sortable: true, firstDir: 'asc', hideBelow: 'md', cell: (t) => t.assignee_name ?? <span className="text-muted">{t.step_role === 'owner' ? 'Proprietário (portal)' : 'Sem responsável'}</span> },
    { key: 'due_date', header: 'Prazo', sortable: true, firstDir: 'desc', cell: (t) => <DueDate date={t.due_date} late={t.late} /> },
    { key: 'status', header: 'Situação', sortable: true, firstDir: 'asc', cell: (t) => <StatusControl task={t} actions={actions} /> },
    { key: 'approval', header: 'Aprovação', hideBelow: 'lg', cell: (t) => <ApprovalCell task={t} actions={actions} /> },
  ]

  const exportList = async (format: ExportFormat) => {
    const all = await listTasks(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable(
      'tarefas.csv',
      all.rows,
      [
        { label: 'Tarefa', value: (t) => t.title },
        { label: 'Processo', value: (t) => t.process_name },
        { label: 'Responsável', value: (t) => t.assignee_name },
        { label: 'Prazo', value: (t) => formatDate(t.due_date) },
        { label: 'Atrasada', value: (t) => (t.late ? 'Sim' : 'Não') },
        { label: 'Situação', value: (t) => TASK_STATUS[t.status] },
        { label: 'Exige aprovação', value: (t) => (t.requires_approval ? 'Sim' : 'Não') },
        { label: 'Aprovada', value: (t) => (t.approved_by ? 'Sim' : t.requires_approval ? 'Não' : '') },
        { label: 'Contrato', value: (t) => t.contract_code },
        { label: 'Unidade', value: (t) => t.unit_code },
      ],
      format,
    )
  }

  const people = team.data ?? []
  return (
    <>
      <ListToolbar
        state={list}
        noun={['tarefa', 'tarefas']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        onExport={exportList}
        searchPlaceholder="Buscar tarefa, processo ou contrato"
        filters={[
          { key: 'responsavel', label: 'Responsável', options: [{ value: 'eu', label: 'Eu' }, ...people.map((m) => ({ value: m.id, label: m.name })), { value: 'sem', label: 'Sem responsável' }] },
          { key: 'status', label: 'Situação', options: (['todo', 'doing', 'done', 'canceled'] as const).map((v) => ({ value: v, label: TASK_STATUS[v] })) },
          { key: 'processo', label: 'Processo', options: [...(templates.data ?? []).map((t) => ({ value: t.key, label: t.name })), { value: 'avulsa', label: 'Avulsa (sem processo)' }] },
          { key: 'aprovacao', label: 'Aprovação', options: [{ value: 'pendente', label: 'Esperando aprovação' }, { value: 'aprovada', label: 'Aprovadas' }] },
          { key: 'atrasada', label: 'Atraso', options: [{ value: 'sim', label: 'Atrasadas' }] },
        ]}
      >
        <div className="inline-flex items-center gap-1 rounded-lg bg-surface-2 p-1 ring-1 ring-border" role="group" aria-label="Desenho da lista">
          {(['lista', 'quadro'] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => switchMode(m)}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium', mode === m ? 'bg-surface text-text shadow-card' : 'text-muted hover:text-text')}
            >
              {m === 'lista' ? <List className="size-4" aria-hidden="true" /> : <Columns3 className="size-4" aria-hidden="true" />}
              {m === 'lista' ? 'Lista' : 'Quadro'}
            </button>
          ))}
        </div>
        {can(s, 'workflows:edit') && (
          <Button variant="primary" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setCreating(true)}>
            Nova tarefa
          </Button>
        )}
      </ListToolbar>
      {mode === 'lista' ? (
        <>
          <DataTable
            caption="Tarefas"
            columns={columns}
            rows={q.data?.rows}
            rowKey={(t) => t.id}
            sort={list.sort}
            onSort={list.toggleSort}
            loading={q.isFetching}
            error={q.error}
            onRetry={() => q.refetch()}
            empty={<EmptyState title="Nenhuma tarefa encontrada" description={list.activeFilterCount ? 'Nenhuma tarefa passa nos filtros ligados. Limpe os filtros para ver todas.' : 'As tarefas dos processos e as avulsas aparecem aqui.'} />}
          />
          {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
        </>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : (
        <Board rows={q.data.rows} actions={actions} />
      )}
      {creating && <NewTaskDialog onClose={() => setCreating(false)} />}
    </>
  )
}

type Actions = ReturnType<typeof useTaskActions>

/** Situação: seletor para quem pode mudar; selo para quem só vê. "Feito" bloqueado enquanto falta aprovação. */
function StatusControl({ task: t, actions }: { task: TaskRow; actions: Actions }) {
  if (!t.can_edit || t.status === 'canceled') return <Badge tone={TONE[t.status]}>{TASK_STATUS[t.status]}</Badge>
  const blocked = t.requires_approval && !t.approved_by
  // O Select da casa ocupa 100% da largura de quem o contém: a caixa de 10rem é que define o tamanho.
  return (
    <span className="block w-40">
      <Select
        aria-label={`Situação de "${t.title}"`}
        value={t.status}
        disabled={actions.status.isPending}
        onChange={(e) => actions.status.mutate({ id: t.id, status: e.target.value as 'todo' | 'doing' | 'done' })}
      >
        <option value="todo">{TASK_STATUS.todo}</option>
        <option value="doing">{TASK_STATUS.doing}</option>
        <option value="done" disabled={blocked}>
          {blocked ? 'Feito (falta aprovar)' : TASK_STATUS.done}
        </option>
      </Select>
    </span>
  )
}

function ApprovalCell({ task: t, actions }: { task: TaskRow; actions: Actions }) {
  if (!t.requires_approval) return <span className="text-xs text-muted">Não exige</span>
  if (t.approved_by) return <Badge tone="success">Aprovada</Badge>
  if (t.can_approve)
    return (
      <Button size="sm" variant="primary" icon={<Check className="size-4" aria-hidden="true" />} loading={actions.approve.isPending && actions.approve.variables?.id === t.id} loadingText="Aprovando…" onClick={() => actions.approve.mutate({ id: t.id })}>
        Aprovar
      </Button>
    )
  return <Badge tone="warning">{t.step_role === 'owner' ? 'Esperando o proprietário' : 'Esperando aprovação'}</Badge>
}

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'A fazer' },
  { status: 'doing', label: 'Fazendo' },
  { status: 'done', label: 'Feito' },
]
const DONE_LIMIT = 20

/** Quadro: as tarefas filtradas em três colunas. Na coluna "Feito", as 20 mais recentes. */
function Board({ rows, actions }: { rows: TaskRow[]; actions: Actions }) {
  return (
    <div className="grid items-start gap-4 md:grid-cols-3">
      {COLUMNS.map((col) => {
        let items = rows.filter((t) => t.status === col.status)
        const total = items.length
        if (col.status === 'done') items = [...items].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, DONE_LIMIT)
        return (
          <section key={col.status} aria-label={`${col.label}: ${total}`} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-surface-2 p-3 ring-1 ring-border">
            <h3 className="flex items-center justify-between px-1 text-sm font-semibold">
              {col.label}
              <span className="num rounded-md bg-surface px-2 text-xs text-muted ring-1 ring-border">{total}</span>
            </h3>
            {items.length === 0 && <p className="px-1 py-6 text-center text-xs text-muted">Nada aqui.</p>}
            {items.map((t) => (
              <BoardCard key={t.id} task={t} actions={actions} />
            ))}
            {total > items.length && <p className="px-1 text-xs text-muted">Mostrando as {DONE_LIMIT} mais recentes de {total}. Use a lista para ver todas.</p>}
          </section>
        )
      })}
    </div>
  )
}

function BoardCard({ task: t, actions }: { task: TaskRow; actions: Actions }) {
  const blocked = t.requires_approval && !t.approved_by
  const move = (status: 'todo' | 'doing' | 'done') => actions.status.mutate({ id: t.id, status })
  const busy = actions.status.isPending && actions.status.variables?.id === t.id
  return (
    <Card className="flex flex-col gap-2 p-3">
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{t.title}</p>
      <p className="text-xs text-muted">{t.process_name}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted">{t.assignee_name ?? (t.step_role === 'owner' ? 'Proprietário (portal)' : 'Sem responsável')}</span>
        <DueDate date={t.due_date} late={t.late} />
      </div>
      {t.requires_approval && (
        <span>
          <Badge tone={t.approved_by ? 'success' : 'warning'}>{t.approved_by ? 'Aprovada' : 'Exige aprovação'}</Badge>
        </span>
      )}
      {(t.can_edit || t.can_approve) && t.status !== 'canceled' && (
        <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
          {t.can_edit && t.status === 'todo' && <Button size="sm" disabled={busy} onClick={() => move('doing')}>Começar</Button>}
          {t.can_edit && t.status === 'doing' && <Button size="sm" disabled={busy} onClick={() => move('todo')}>Voltar para A fazer</Button>}
          {t.can_edit && t.status !== 'done' && !blocked && <Button size="sm" variant="primary" disabled={busy} onClick={() => move('done')}>Concluir</Button>}
          {t.can_edit && t.status === 'done' && <Button size="sm" disabled={busy} onClick={() => move('todo')}>Reabrir</Button>}
          {t.can_approve && (
            <Button size="sm" variant="primary" icon={<Check className="size-4" aria-hidden="true" />} loading={actions.approve.isPending && actions.approve.variables?.id === t.id} loadingText="Aprovando…" onClick={() => actions.approve.mutate({ id: t.id })}>
              Aprovar
            </Button>
          )}
          {blocked && !t.can_approve && t.status !== 'done' && <span className="text-xs text-muted">Concluir depois da aprovação.</span>}
        </div>
      )}
    </Card>
  )
}

/** "Nova tarefa" avulsa (fora de processo). */
function NewTaskDialog({ onClose }: { onClose: () => void }) {
  const team = useRepo('equipe', listTeam)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Nova tarefa" description="Tarefa avulsa, fora de processo. Responsável e prazo podem ficar em branco.">
      {team.data ? <NewTaskForm team={team.data} onClose={onClose} /> : <Skeleton className="h-48" />}
    </Dialog>
  )
}

function NewTaskForm({ team, onClose }: { team: Awaited<ReturnType<typeof listTeam>>; onClose: () => void }) {
  const s = useSession()
  const save = useRepoMutation(createTask, { success: (t) => `Tarefa "${t.title}" criada.`, onSuccess: onClose })
  const { register, handleSubmit, formState } = useForm<NewTaskInput>({
    resolver: zodResolver(newTaskSchema),
    mode: 'onBlur',
    defaultValues: { title: '', description: '', assignee_user_id: team.some((m) => m.id === s.user.id) ? s.user.id : '', due_date: '', requires_approval: false },
  })
  const submit = handleSubmit((v) => save.mutate(v))
  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <Field label="Título" required error={formState.errors.title?.message}>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder="Ex.: Ligar para o síndico sobre a obra" {...register('title')} />}
      </Field>
      <Field label="Descrição" error={formState.errors.description?.message}>
        {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} className="min-h-20" {...register('description')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Responsável" error={formState.errors.assignee_user_id?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('assignee_user_id')}>
              <option value="">Sem responsável</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Prazo" error={formState.errors.due_date?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="date" min={s.today} aria-describedby={describedBy} aria-invalid={invalid} {...register('due_date')} />}
        </Field>
      </div>
      <Checkbox label="Exige aprovação do administrador para concluir" {...register('requires_approval')} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Criar tarefa
        </Button>
      </div>
    </form>
  )
}
