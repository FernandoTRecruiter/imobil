/* =============================================================================
   Rotinas de manutenção (Manutenção > Rotinas, endereço /manutencao?aba=rotinas).

   A lista das rotinas da conta (o serviço, o imóvel, a cada quantos meses, a próxima data, o
   prestador e o último chamado que ela abriu), com ligar e desligar na própria linha e o
   formulário de criar e editar. Quem abre o chamado é a rotina diária (Tarefas > Automações,
   regra "Rotina de manutenção chegou"); aqui a equipe só diz O QUÊ e QUANDO.
   Só a equipe vê (rotina é trabalho interno). Criar, editar, ligar e desligar: quem edita a manutenção.
   ============================================================================= */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal } from '@/auth/permissions'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { MAINTENANCE_CATEGORY } from '@/data/labels'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatDate } from '@/lib/dates'
import { useListState } from '@/lib/useListState'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { PageHeader } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, NoAccess, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { CATEGORIES } from './repo'
import { listSchedules, monthsText, saveSchedule, scheduleOptions, scheduleSchema, setScheduleActive, type ScheduleInput, type ScheduleOptions, type ScheduleRow } from './rotinas'
import { MaintenanceNav } from './ui'

export function RoutinesView() {
  const s = useSession()
  const edit = can(s, 'maintenance:edit')
  const [editing, setEditing] = useState<ScheduleRow | 'nova' | null>(null)
  return (
    <Guard action="maintenance:view" what="as rotinas de manutenção">
      <PageHeader
        eyebrow="Manutenção"
        title="Rotinas"
        description="Serviços que se repetem a cada tantos meses. Quando a data chega, a rotina diária abre o chamado sozinha."
        actions={
          <>
            <MaintenanceNav current="rotinas" />
            {edit && !isPortal(s) && (
              <Button variant="primary" icon={<Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={() => setEditing('nova')}>
                Nova rotina
              </Button>
            )}
          </>
        }
      />
      {/* O portal tem "ver manutenção" (os próprios chamados), mas rotina é da equipe: quem chega pelo endereço vê o aviso. */}
      {isPortal(s) ? <NoAccess what="as rotinas de manutenção" /> : <RoutinesList edit={edit} onEdit={setEditing} />}
      {editing && <ScheduleDialog row={editing === 'nova' ? null : editing} onClose={() => setEditing(null)} />}
    </Guard>
  )
}

function RoutinesList({ edit, onEdit }: { edit: boolean; onEdit: (r: ScheduleRow | 'nova') => void }) {
  const s = useSession()
  const list = useListState('rotinas')
  const q = useRepo('rotinas', (sess) => listSchedules(sess, list.params), [list.params])
  const opts = useRepo('rotinas:opcoes', scheduleOptions)
  const toggle = useRepoMutation(setScheduleActive, { success: (r) => `Rotina "${r.title}" ${r.active ? 'ligada' : 'desligada'}.` })

  const columns: Column<ScheduleRow>[] = [
    {
      key: 'title', header: 'Rotina', sortable: true, firstDir: 'asc',
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className={cn('max-w-72 truncate font-medium', !r.active && 'text-muted')}>{r.title}</span>
          <span className="text-xs text-muted">{MAINTENANCE_CATEGORY[r.category]}</span>
          {/* No celular a coluna Imóvel some: o imóvel vem para cá. */}
          <span className="max-w-56 truncate text-xs text-muted md:hidden">
            {r.property_name} · {r.unit_code ?? 'Áreas comuns'}
          </span>
        </span>
      ),
    },
    {
      key: 'property', header: 'Imóvel', hideBelow: 'md',
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="max-w-56 truncate">{r.property_name}</span>
          <span className="text-xs text-muted">{r.unit_code ?? 'Áreas comuns'}</span>
        </span>
      ),
    },
    { key: 'every_months', header: 'A cada', sortable: true, firstDir: 'desc', hideBelow: 'sm', cell: (r) => <span className="num whitespace-nowrap">{monthsText(r.every_months)}</span> },
    {
      key: 'next_date', header: 'Próxima data', sortable: true, firstDir: 'desc',
      cell: (r) => (
        <span className={cn('inline-flex flex-col leading-tight', !r.active && 'text-muted')}>
          <span className="num">{formatDate(r.next_date)}</span>
          {r.overdue && <span className="text-[11px] font-medium text-warning-fg">vencida</span>}
          {!r.active && <span className="text-[11px]">desligada</span>}
        </span>
      ),
    },
    { key: 'vendor', header: 'Prestador', hideBelow: 'lg', cell: (r) => (r.vendor_name ? <span className="block max-w-44 truncate">{r.vendor_name}</span> : <span className="text-muted">A definir</span>) },
    {
      key: 'last', header: 'Último chamado', hideBelow: 'lg',
      cell: (r) =>
        r.last_request_id && r.last_request_code ? (
          <Link to="/manutencao/$requestId" params={{ requestId: r.last_request_id }} className="num text-primary hover:underline">
            {r.last_request_code}
          </Link>
        ) : (
          <span className="whitespace-nowrap text-muted">Nenhum ainda</span>
        ),
    },
    {
      key: 'active', header: 'Situação',
      cell: (r) =>
        edit ? (
          <Checkbox
            label={r.active ? 'Ligada' : 'Desligada'}
            role="switch"
            aria-checked={r.active}
            aria-label={`Rotina "${r.title}" ${r.active ? 'ligada' : 'desligada'}`}
            checked={r.active}
            disabled={toggle.isPending}
            onChange={(e) => toggle.mutate({ id: r.id, active: e.target.checked })}
          />
        ) : (
          <span className={cn('text-sm', !r.active && 'text-muted')}>{r.active ? 'Ligada' : 'Desligada'}</span>
        ),
    },
    {
      key: 'acoes', header: '', className: 'w-24',
      cell: (r) =>
        edit ? (
          <Button size="sm" variant="ghost" onClick={() => onEdit(r)}>
            Editar
          </Button>
        ) : null,
    },
  ]

  const exportList = async (format: ExportFormat) => {
    const all = await listSchedules(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable(
      'rotinas-de-manutencao.csv',
      all.rows,
      [
        { label: 'Rotina', value: (r) => r.title },
        { label: 'Categoria', value: (r) => MAINTENANCE_CATEGORY[r.category] },
        { label: 'Imóvel', value: (r) => r.property_name },
        { label: 'Unidade', value: (r) => r.unit_code ?? 'Áreas comuns' },
        { label: 'A cada (meses)', value: (r) => r.every_months },
        { label: 'Próxima data', value: (r) => formatDate(r.next_date) },
        { label: 'Prestador', value: (r) => r.vendor_name },
        { label: 'Último chamado', value: (r) => r.last_request_code },
        { label: 'Situação', value: (r) => (r.active ? 'Ligada' : 'Desligada') },
      ],
      format,
    )
  }

  return (
    <>
      <ListToolbar
        state={list}
        noun={['rotina', 'rotinas']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        onExport={exportList}
        searchPlaceholder="Buscar rotina, imóvel ou prestador"
        filters={[
          { key: 'imovel', label: 'Imóvel', options: (opts.data?.properties ?? []).map((p) => ({ value: p.id, label: p.name })) },
          { key: 'categoria', label: 'Categoria', options: CATEGORIES.map((v) => ({ value: v, label: MAINTENANCE_CATEGORY[v] })) },
          { key: 'situacao', label: 'Situação', options: [{ value: 'ligada', label: 'Ligadas' }, { value: 'desligada', label: 'Desligadas' }] },
          { key: 'vencida', label: 'Data', options: [{ value: 'sim', label: 'Vencidas (abrem na próxima rodada)' }] },
        ]}
      />
      <DataTable
        caption="Rotinas de manutenção"
        columns={columns}
        rows={q.data?.rows}
        rowKey={(r) => r.id}
        sort={list.sort}
        onSort={list.toggleSort}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={
          <EmptyState
            title="Nenhuma rotina encontrada"
            description={list.activeFilterCount ? 'Nenhuma rotina passa nos filtros ligados. Limpe os filtros para ver todas.' : "Caixa d'água, extintores, dedetização: cadastre uma vez e o chamado abre sozinho na data."}
            action={!list.activeFilterCount && edit ? <Button onClick={() => onEdit('nova')}>Nova rotina</Button> : undefined}
          />
        }
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
    </>
  )
}

/** Criar ou editar rotina. O formulário só monta quando imóveis e prestadores chegaram. */
function ScheduleDialog({ row, onClose }: { row: ScheduleRow | null; onClose: () => void }) {
  const opts = useRepo('rotinas:opcoes', scheduleOptions)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={row ? `Editar "${row.title}"` : 'Nova rotina'} description="O chamado abre sozinho na próxima data; depois a data anda o número de meses escolhido." size="md">
      {opts.data ? <ScheduleForm row={row} opts={opts.data} onClose={onClose} /> : <Skeleton className="h-96" />}
    </Dialog>
  )
}

type FormValues = Omit<ScheduleInput, 'id'>
const formSchema = scheduleSchema.omit({ id: true })

function ScheduleForm({ row, opts, onClose }: { row: ScheduleRow | null; opts: ScheduleOptions; onClose: () => void }) {
  const s = useSession()
  const save = useRepoMutation(saveSchedule, { success: (r) => `Rotina "${r.title}" salva.`, onSuccess: onClose })
  const { register, handleSubmit, formState, control, setValue } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    defaultValues: {
      property_id: row?.property_id ?? '', unit_id: row?.unit_id ?? '', category: row?.category ?? 'cleaning', title: row?.title ?? '',
      description: row?.description ?? '', every_months: row?.every_months ?? 6, next_date: row?.next_date ?? '', vendor_person_id: row?.vendor_person_id ?? '',
      active: row?.active ?? true,
    },
  })
  const propertyId = useWatch({ control, name: 'property_id' })
  const category = useWatch({ control, name: 'category' })
  const units = opts.properties.find((p) => p.id === propertyId)?.units ?? []
  // Prestadores que atendem a categoria primeiro (os outros continuam na lista, depois).
  const vendors = [...opts.vendors].sort((a, b) => Number(b.categories.includes(category)) - Number(a.categories.includes(category)) || a.name.localeCompare(b.name, 'pt-BR'))
  const submit = handleSubmit((v) => save.mutate({ ...v, id: row?.id ?? '' }))

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Imóvel" required error={formState.errors.property_id?.message}>
          {({ id, describedBy, invalid }) => (
            // Trocar o imóvel limpa a unidade: a unidade escolhida antes é de outro imóvel.
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('property_id', { onChange: () => setValue('unit_id', '') })}>
              <option value="">Escolha o imóvel</option>
              {opts.properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Unidade" hint="Áreas comuns: o chamado fica registrado na primeira unidade do imóvel." error={formState.errors.unit_id?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} disabled={!propertyId} {...register('unit_id')}>
              <option value="">Áreas comuns</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Serviço" required error={formState.errors.title?.message}>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder="Ex.: Limpeza da caixa d'água" {...register('title')} />}
      </Field>
      <Field label="Detalhes" hint="Vai no chamado e no e-mail ao prestador." error={formState.errors.description?.message}>
        {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} className="min-h-20" {...register('description')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Categoria" required error={formState.errors.category?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('category')}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MAINTENANCE_CATEGORY[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="A cada (meses)" required error={formState.errors.every_months?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="number" min={1} max={60} inputMode="numeric" aria-describedby={describedBy} aria-invalid={invalid} {...register('every_months', { valueAsNumber: true })} />}
        </Field>
        <Field label="Próxima data" required error={formState.errors.next_date?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="date" min={s.today} aria-describedby={describedBy} aria-invalid={invalid} {...register('next_date')} />}
        </Field>
      </div>
      <Field label="Prestador" hint="Recebe o e-mail quando o chamado abrir. Sem prestador, a equipe escolhe na triagem." error={formState.errors.vendor_person_id?.message}>
        {({ id, describedBy, invalid }) => (
          <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('vendor_person_id')}>
            <option value="">Sem prestador (escolher na triagem)</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.categories.includes(category) ? '' : ' (outra especialidade)'}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Checkbox label="Ligada: entra na rotina diária" {...register('active')} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {row ? 'Salvar rotina' : 'Criar rotina'}
        </Button>
      </div>
    </form>
  )
}
