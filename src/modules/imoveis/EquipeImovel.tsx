/* =============================================================================
   EquipeImovel: a equipe do prédio (zelador, porteiro, síndico...) de um imóvel, com foto.

   Aparece no detalhe do imóvel, aba "Pessoas", abaixo dos proprietários (cartão com título).
   Ações (só para quem edita imóveis, e nunca no imóvel arquivado): adicionar (pessoa já
   cadastrada ou cadastro rápido com foto), editar papel e observação, desativar com "Desfazer".
   O proprietário convidado vê a lista (o escopo já filtra) sem nenhum botão.
   ============================================================================= */
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Pencil, Phone, UserMinus, UserPlus, UserRoundCheck } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal } from '@/auth/permissions'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { Dialog } from '@/components/ui/Dialog'
import { Input, Select, Textarea } from '@/components/ui/Field'
import { Section } from '@/components/ui/Layout'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { STAFF_ROLE } from '@/data/labels'
import { getPerson } from '@/data/views/contracts'
import { formatPhone, onlyDigits } from '@/lib/documents'
import { photoSchema } from '@/modules/pessoas/foto'
import { PersonDialog } from '@/modules/pessoas/PersonDialog'
import { PersonPicker } from '@/modules/pessoas/PersonPicker'
import { PhotoField } from '@/modules/pessoas/PhotoField'
import { quickPersonSchema } from '@/modules/pessoas/repo'
import { addPropertyStaff, listPropertyStaff, setPropertyStaffActive, updatePropertyStaff, type StaffRow } from './equipe'
import { FormField } from './FormField'
import { STAFF_ROLES, staffNoteField, staffRoleField } from './schemas'

/** Chave da leitura da equipe do imóvel (toda gravação recarrega as leituras, esta inclusive). */
export const STAFF_QUERY = 'imoveis:equipe'

export function EquipeImovel({ propertyId, propertyName, archived = false }: { propertyId: string; propertyName: string; archived?: boolean }) {
  const s = useSession()
  const toast = useToast()
  const canEdit = !isPortal(s) && can(s, 'properties:edit') && !archived
  const linkPeople = can(s, 'people:view')
  const q = useRepo(STAFF_QUERY, (sess) => listPropertyStaff(sess, propertyId), [propertyId])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const toggle = useRepoMutation(setPropertyStaffActive, { silent: true })

  const deactivate = (r: StaffRow) =>
    toggle.mutate(
      { id: r.id, active: false },
      { onSuccess: () => toast.success(`${r.name} saiu da equipe.`, { label: 'Desfazer', onClick: () => toggle.mutate({ id: r.id, active: true }) }) },
    )
  const reactivate = (r: StaffRow) => toggle.mutate({ id: r.id, active: true }, { onSuccess: () => toast.success(`${r.name} voltou à equipe.`) })

  const addButton = canEdit ? (
    <Button size="sm" icon={<UserPlus className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={() => setAdding(true)}>
      Adicionar
    </Button>
  ) : null

  let body: ReactNode
  if (q.error) body = <ErrorState error={q.error} onRetry={() => q.refetch()} />
  else if (!q.data) body = <Skeleton className="h-24" />
  else {
    const active = q.data.filter((r) => r.active)
    const inactive = q.data.filter((r) => !r.active)
    const shown = showInactive ? q.data : active
    body = (
      <div className="flex flex-col gap-2">
        {shown.length ? (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {shown.map((r) => (
              <li key={r.id} className={cn('flex items-start gap-3 py-2.5 first:pt-0 last:pb-0', !r.active && 'opacity-70')}>
                <Avatar name={r.name} photo={r.photo} color="color-mix(in srgb, var(--st-blocked) 70%, #000)" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    {linkPeople ? (
                      <Link to="/pessoas/$personId" params={{ personId: r.person_id }} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.name}</span>
                    )}
                    <span className="text-xs text-muted">{STAFF_ROLE[r.role]}</span>
                    {!r.active && <Badge>Saiu da equipe</Badge>}
                  </p>
                  {r.phone && (
                    <a href={`tel:+55${onlyDigits(r.phone)}`} className="num inline-flex w-fit items-center gap-1 text-[13px] text-muted hover:text-text">
                      <Phone className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                      {formatPhone(r.phone)}
                    </a>
                  )}
                  {r.note && <p className="text-xs text-muted">{r.note}</p>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    {r.active ? (
                      <>
                        <IconButton label={`Editar ${r.name} na equipe`} onClick={() => setEditing(r)}>
                          <Pencil className="size-4" strokeWidth={1.5} aria-hidden="true" />
                        </IconButton>
                        <IconButton label={`Tirar ${r.name} da equipe`} onClick={() => deactivate(r)} disabled={toggle.isPending}>
                          <UserMinus className="size-4" strokeWidth={1.5} aria-hidden="true" />
                        </IconButton>
                      </>
                    ) : (
                      <IconButton label={`Trazer ${r.name} de volta à equipe`} onClick={() => reactivate(r)} disabled={toggle.isPending}>
                        <UserRoundCheck className="size-4" strokeWidth={1.5} aria-hidden="true" />
                      </IconButton>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{canEdit ? 'Ninguém da equipe do prédio cadastrado. Adicione zelador, porteiro ou síndico.' : 'Ninguém da equipe do prédio cadastrado.'}</p>
        )}
        {inactive.length > 0 && (
          <button type="button" className="min-h-6 w-fit text-xs font-medium text-primary hover:underline" aria-pressed={showInactive} onClick={() => setShowInactive(!showInactive)}>
            {showInactive ? 'Esconder quem saiu' : `Mostrar quem saiu (${inactive.length})`}
          </button>
        )}
      </div>
    )
  }

  const dialogs = (
    <>
      {adding && <AddStaffDialog propertyId={propertyId} propertyName={propertyName} taken={q.data?.filter((r) => r.active) ?? []} onClose={() => setAdding(false)} />}
      {editing && <EditStaffDialog row={editing} onClose={() => setEditing(null)} />}
    </>
  )
  const info = 'Quem trabalha no prédio ou responde por ele: zelador, porteiro, síndico. Quem sai da equipe não é apagado: fica no histórico do imóvel.'

  return (
    <Section title="Equipe do prédio" info={info} actions={addButton}>
      {body}
      {dialogs}
    </Section>
  )
}

/** Botão só de ícone: 32 px de alvo, rótulo para o leitor de tela e no balão do mouse. */
function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text disabled:opacity-55">
      {children}
    </button>
  )
}

/* ---------------------------------------------------------------- adicionar */

/**
 * Formulário da janela "Adicionar à equipe". Os campos das duas formas (pessoa já cadastrada e
 * cadastro rápido) convivem; a regra de cada forma só vale quando ela está escolhida.
 */
const addFormSchema = z
  .object({
    role: staffRoleField,
    note: staffNoteField,
    mode: z.enum(['existing', 'new']),
    person_id: z.string(),
    person_name: z.string(),
    name: z.string(),
    phone: z.string(),
    photo: photoSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'existing') {
      if (!v.person_id) ctx.addIssue({ code: 'custom', path: ['person_id'], message: 'Escolha a pessoa na busca ou troque para "Cadastrar agora".' })
      return
    }
    // Cadastro rápido: as mesmas regras que o repositório vai cobrar (nome e telefone).
    const r = quickPersonSchema.safeParse({ name: v.name, phone: v.phone, photo: v.photo })
    if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: 'custom', path: i.path as (string | number)[], message: i.message })
  })
type AddForm = z.infer<typeof addFormSchema>

function AddStaffDialog({ propertyId, propertyName, taken, onClose }: { propertyId: string; propertyName: string; taken: StaffRow[]; onClose: () => void }) {
  const s = useSession()
  const canCreate = can(s, 'people:edit')
  const form = useForm<AddForm>({
    resolver: zodResolver(addFormSchema),
    mode: 'onBlur',
    defaultValues: { role: 'caretaker', note: '', mode: canCreate ? 'new' : 'existing', person_id: '', person_name: '', name: '', phone: '', photo: null },
  })
  const { register, control, formState, setValue, handleSubmit, getValues } = form
  const [mode, personName, photo, role] = useWatch({ control, name: ['mode', 'person_name', 'photo', 'role'] })
  const e = formState.errors
  const save = useRepoMutation(addPropertyStaff, { success: (r) => `${STAFF_ROLE[r.role]} adicionado à equipe de ${propertyName}.`, onSuccess: onClose })
  const submit = handleSubmit((v) =>
    save.mutate({
      property_id: propertyId, role: v.role, note: v.note,
      person_id: v.mode === 'existing' ? v.person_id : null,
      new_person: v.mode === 'new' ? { name: v.name, phone: v.phone, photo: v.photo } : null,
    }),
  )
  // Quem já está no MESMO papel não aparece como opção na busca (o repositório recusaria).
  const exclude = new Set(taken.filter((r) => r.role === role).map((r) => r.person_id))

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Adicionar à equipe do prédio"
      description={propertyName}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Adicionar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={(ev) => { ev.stopPropagation(); void submit(ev) }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Papel" required error={e.role?.message}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('role')}>
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {STAFF_ROLE[r]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Observação" optional error={e.note?.message} hint="Turno ou ramal, ex.: seg a sex, 7h às 16h.">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} maxLength={120} {...register('note')} />}
          </FormField>
        </div>

        {canCreate && (
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Quem é</legend>
            <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Quem é">
              {(['new', 'existing'] as const).map((m) => (
                <label
                  key={m}
                  className={cn(
                    'flex min-h-8 cursor-pointer items-center rounded-md px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)]',
                    mode === m ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:text-text',
                  )}
                >
                  <input type="radio" value={m} className="sr-only" {...register('mode')} />
                  {m === 'new' ? 'Cadastrar agora' : 'Pessoa já cadastrada'}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {mode === 'existing' ? (
          <div className="flex flex-col gap-2">
            {personName ? (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                Escolhida: <strong className="font-medium">{personName}</strong>
                <Button size="sm" variant="ghost" onClick={() => { setValue('person_id', ''); setValue('person_name', '') }}>
                  Trocar
                </Button>
              </p>
            ) : (
              <PersonPicker exclude={exclude} onPick={(p) => { setValue('person_id', p.id, { shouldValidate: true }); setValue('person_name', p.name) }} />
            )}
            {e.person_id?.message && (
              <p className="text-xs font-medium text-danger-fg" role="alert">
                {e.person_id.message}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Nome" required error={e.name?.message}>
                {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="off" {...register('name')} />}
              </FormField>
              <FormField label="Telefone" optional error={e.phone?.message}>
                {({ id, describedBy, invalid }) => (
                  <Input id={id} type="tel" aria-describedby={describedBy} aria-invalid={invalid} placeholder="(31) 99999-0000" {...register('phone', { onBlur: () => setValue('phone', formatPhone(getValues('phone'))) })} />
                )}
              </FormField>
            </div>
            <PhotoField value={photo} onChange={(v) => setValue('photo', v, { shouldDirty: true })} />
            <p className="text-xs text-muted">A pessoa entra em Pessoas sem CPF; dá para completar a ficha depois.</p>
          </div>
        )}
      </form>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- editar papel e observação */

const editFormSchema = z.object({ role: staffRoleField, note: staffNoteField })
type EditForm = z.infer<typeof editFormSchema>

function EditStaffDialog({ row, onClose }: { row: StaffRow; onClose: () => void }) {
  const s = useSession()
  const [editingPerson, setEditingPerson] = useState(false)
  const form = useForm<EditForm>({ resolver: zodResolver(editFormSchema), mode: 'onBlur', defaultValues: { role: row.role, note: row.note } })
  const { register, formState, handleSubmit } = form
  const save = useRepoMutation(updatePropertyStaff, { success: `${row.name} atualizado na equipe.`, onSuccess: onClose })
  const submit = handleSubmit((v) => save.mutate({ id: row.id, ...v }))
  if (editingPerson) return <PersonFromStaff personId={row.person_id} onClose={onClose} />
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Editar ${row.name} na equipe`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={(ev) => { ev.stopPropagation(); void submit(ev) }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Papel" required error={formState.errors.role?.message}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('role')}>
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {STAFF_ROLE[r]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Observação" optional error={formState.errors.note?.message} hint="Turno ou ramal.">
            {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} rows={2} maxLength={120} className="min-h-10" {...register('note')} />}
          </FormField>
        </div>
        {can(s, 'people:edit') && (
          <p className="text-sm text-muted">
            Nome, telefone e foto ficam na ficha da pessoa.{' '}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setEditingPerson(true)}>
              Editar ficha e foto
            </button>
          </p>
        )}
      </form>
    </Dialog>
  )
}

/** Abre a ficha completa da pessoa (com o campo de foto) a partir da linha da equipe. */
function PersonFromStaff({ personId, onClose }: { personId: string; onClose: () => void }) {
  const q = useRepo('pessoa', (sess) => getPerson(sess, personId), [personId])
  if (q.error) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Ficha da pessoa">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Dialog>
    )
  }
  if (!q.data) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Ficha da pessoa">
        <Skeleton className="h-48" />
      </Dialog>
    )
  }
  return <PersonDialog person={q.data} onClose={onClose} />
}
