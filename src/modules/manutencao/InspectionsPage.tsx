/* =============================================================================
   Tela de Vistorias (lista): barra de lista -> tabela -> paginação, e "Agendar vistoria".
   Ordem declarada: as agendadas primeiro (a mais próxima em cima), depois as feitas.
   Equipe vê todas; proprietário e inquilino, as das unidades deles; prestador, nenhuma.
   ============================================================================= */
import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarPlus } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal } from '@/auth/permissions'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { INSPECTION_KIND } from '@/data/labels'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatDate } from '@/lib/dates'
import { useListState } from '@/lib/useListState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, Skeleton } from '@/components/ui/States'
import { listTeam, type TeamMember } from '@/modules/processos/repo'
import { listOpenTargets } from './repo'
import { MaintenanceNav } from './ui'
import { INSPECTION_STATUS, KINDS, listInspections, scheduleInspection, scheduleSchema, type InspectionRow, type ScheduleInput } from './vistorias'

const STATUS_TONE = { scheduled: 'primary', done: 'success', canceled: 'neutral' } as const

export function InspectionsPage() {
  const s = useSession()
  const navigate = useNavigate()
  const list = useListState('vistorias')
  const q = useRepo('vistorias', (sess) => listInspections(sess, list.params), [list.params])
  const [scheduling, setScheduling] = useState(false)
  const canSchedule = !isPortal(s) && can(s, 'maintenance:edit')

  const columns: Column<InspectionRow>[] = [
    {
      key: 'unit', header: 'Unidade', sortable: true, firstDir: 'asc',
      cell: (i) => (
        <span className="flex min-w-0 flex-col">
          <Link to="/vistorias/$inspectionId" params={{ inspectionId: i.id }} className="font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {i.unit_code}
          </Link>
          <span className="max-w-40 truncate text-xs text-muted sm:max-w-60">{i.property_name}</span>
          {/* No celular as colunas Tipo e Situação somem: vêm para cá, para a tabela caber sem rolar. */}
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs sm:hidden">
            {INSPECTION_KIND[i.kind]}
            <Badge tone={STATUS_TONE[i.status]}>{INSPECTION_STATUS[i.status]}</Badge>
          </span>
        </span>
      ),
    },
    { key: 'kind', header: 'Tipo', hideBelow: 'sm', cell: (i) => INSPECTION_KIND[i.kind] },
    { key: 'date', header: 'Data', sortable: true, firstDir: 'desc', cell: (i) => formatDate(i.done_date ?? i.scheduled_date) },
    { key: 'status', header: 'Situação', hideBelow: 'sm', cell: (i) => <Badge tone={STATUS_TONE[i.status]}>{INSPECTION_STATUS[i.status]}</Badge> },
    { key: 'inspector', header: 'Vistoriador', hideBelow: 'md', cell: (i) => i.inspector_name ?? <span className="text-muted">A definir</span> },
    {
      key: 'items', header: 'Itens avaliados', align: 'right', hideBelow: 'lg',
      cell: (i) => (
        <span>
          {i.items_checked} de {i.items_total}
          {i.items_poor > 0 && <span className="ml-1 font-semibold text-danger-fg">· {i.items_poor} ruim</span>}
        </span>
      ),
    },
    { key: 'contract', header: 'Contrato', hideBelow: 'lg', cell: (i) => i.contract_code ?? <span className="text-muted">Sem contrato</span> },
  ]

  const exportList = async (format: ExportFormat) => {
    const all = await listInspections(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable(
      'vistorias.csv',
      all.rows,
      [
        { label: 'Unidade', value: (i) => i.unit_code },
        { label: 'Imóvel', value: (i) => i.property_name },
        { label: 'Tipo', value: (i) => INSPECTION_KIND[i.kind] },
        { label: 'Agendada para', value: (i) => formatDate(i.scheduled_date) },
        { label: 'Feita em', value: (i) => formatDate(i.done_date) },
        { label: 'Situação', value: (i) => INSPECTION_STATUS[i.status] },
        { label: 'Vistoriador', value: (i) => i.inspector_name },
        { label: 'Itens avaliados', value: (i) => i.items_checked },
        { label: 'Itens', value: (i) => i.items_total },
        { label: 'Itens ruins', value: (i) => i.items_poor },
        { label: 'Contrato', value: (i) => i.contract_code },
      ],
      format,
    )
  }

  return (
    <Guard action="maintenance:view" what="as vistorias">
      <PageHeader
        eyebrow="Manutenção"
        title="Vistorias"
        description="Entrada, periódica e saída, cômodo a cômodo. A de saída mostra o que piorou desde a entrada."
        actions={
          <>
            <MaintenanceNav current="vistorias" />
            {canSchedule && (
              <Button variant="primary" icon={<CalendarPlus className="size-4" aria-hidden="true" />} onClick={() => setScheduling(true)}>
                Agendar vistoria
              </Button>
            )}
          </>
        }
      />
      <ListToolbar
        state={list}
        noun={['vistoria', 'vistorias']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        onExport={exportList}
        searchPlaceholder="Buscar unidade, imóvel ou vistoriador"
        filters={[
          { key: 'kind', label: 'Tipo', options: KINDS.map((v) => ({ value: v, label: INSPECTION_KIND[v] })) },
          { key: 'status', label: 'Situação', options: (['scheduled', 'done', 'canceled'] as const).map((v) => ({ value: v, label: INSPECTION_STATUS[v] })) },
          { key: 'property', label: 'Imóvel', options: q.data?.propertyOptions ?? [] },
        ]}
      />
      <DataTable
        caption="Vistorias"
        columns={columns}
        rows={q.data?.rows}
        rowKey={(i) => i.id}
        sort={list.sort}
        onSort={list.toggleSort}
        onRowClick={(i) => void navigate({ to: '/vistorias/$inspectionId', params: { inspectionId: i.id } })}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={
          <EmptyState
            title="Nenhuma vistoria encontrada"
            description={list.activeFilterCount ? 'Nenhuma vistoria passa nos filtros ligados. Limpe os filtros para ver todas.' : 'As vistorias agendadas e feitas aparecem aqui.'}
            action={!list.activeFilterCount && canSchedule ? <Button onClick={() => setScheduling(true)}>Agendar vistoria</Button> : undefined}
          />
        }
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      {scheduling && <ScheduleDialog onClose={() => setScheduling(false)} />}
    </Guard>
  )
}

/** "Agendar vistoria": só monta o formulário quando as listas (unidades e equipe) chegaram. */
function ScheduleDialog({ onClose }: { onClose: () => void }) {
  const units = useRepo('manutencao:unidades', listOpenTargets)
  const team = useRepo('equipe', listTeam)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Agendar vistoria" description="O checklist nasce com os cômodos da unidade; na de saída, com os mesmos da entrada.">
      {units.data && team.data ? (
        <ScheduleForm units={units.data} team={team.data} onClose={onClose} />
      ) : (
        <div className="flex flex-col gap-3" role="status" aria-label="Carregando">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
    </Dialog>
  )
}

function ScheduleForm({ units, team, onClose }: { units: { value: string; label: string; group: string }[]; team: TeamMember[]; onClose: () => void }) {
  const s = useSession()
  const navigate = useNavigate()
  const save = useRepoMutation(scheduleInspection, {
    success: (i) => `Vistoria agendada para ${formatDate(i.scheduled_date)}.`,
    onSuccess: (i) => {
      onClose()
      void navigate({ to: '/vistorias/$inspectionId', params: { inspectionId: i.id } })
    },
  })
  const { register, handleSubmit, formState } = useForm<ScheduleInput>({
    resolver: zodResolver(scheduleSchema),
    mode: 'onBlur',
    defaultValues: { unit_id: '', kind: 'periodic', scheduled_date: s.today, inspector_user_id: team.some((m) => m.id === s.user.id) ? s.user.id : '' },
  })
  const submit = handleSubmit((v) => save.mutate(v))
  const groups = new Map<string, typeof units>()
  for (const u of units) groups.set(u.group, [...(groups.get(u.group) ?? []), u])
  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <Field label="Unidade" required error={formState.errors.unit_id?.message}>
        {({ id, describedBy, invalid }) => (
          <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('unit_id')}>
            <option value="">Escolha a unidade</option>
            {[...groups].map(([g, items]) => (
              <optgroup key={g} label={g}>
                {items.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" required error={formState.errors.kind?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('kind')}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {INSPECTION_KIND[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Data" required error={formState.errors.scheduled_date?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="date" min={s.today} aria-describedby={describedBy} aria-invalid={invalid} {...register('scheduled_date')} />}
        </Field>
      </div>
      <Field label="Vistoriador" hint="Pode ficar em branco e ser definido depois." error={formState.errors.inspector_user_id?.message}>
        {({ id, describedBy, invalid }) => (
          <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('inspector_user_id')}>
            <option value="">A definir</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="primary" loading={save.isPending} loadingText="Agendando…">
          Agendar
        </Button>
      </div>
    </form>
  )
}
