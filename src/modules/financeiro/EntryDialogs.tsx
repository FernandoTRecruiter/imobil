/* =============================================================================
   Janelas do financeiro: dar baixa, cancelar lançamento (com "Desfazer") e novo lançamento.
   Usadas na tela Financeiro e na aba Financeiro do contrato (mesma regra, mesma janela).

   A tela valida para avisar cedo (com causa e conserto); o repositório valida de novo, porque
   é a porta que não pode faltar.
   ============================================================================= */
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { DropdownMenu } from 'radix-ui'
import { Ban, Ellipsis, FileText, HandCoins } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { CHARGED_TO, ENTRY_CATEGORY, PAYMENT_METHOD } from '@/data/labels'
import type { EntryRow } from '@/data/views/finance'
import type { ChargedTo, EntryCategory, PaymentMethod } from '@/data/types'
import { addMonths, dueDateFor, formatDate, formatMonth, monthStart, parseDateBR, parts } from '@/lib/dates'
import { formatBRL, parseBRL } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { PersonPicker, type PickedPerson } from '@/modules/contratos/PersonPicker'
import { cancelEntry, createEntries, listUnitOptions, MANUAL_CATEGORIES, registerPayment, restoreEntry, type UnitOption } from './repo'

const METHODS = Object.keys(PAYMENT_METHOD) as PaymentMethod[]

/* ---------------------------------------------------------------- menu de ações da linha */

/** Ações de um lançamento. Sem finance:edit sobra só "Ver contrato" (a regra de verdade está no repositório). */
export function EntryActions({ entry, canEdit, onPay, onCancel }: { entry: EntryRow; canEdit: boolean; onPay: () => void; onCancel: () => void }) {
  const navigate = useNavigate()
  const editable = canEdit && entry.status === 'open' && !entry.transfer_id
  const item = 'flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 outline-none data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'
  if (!editable && !entry.contract_id) return null
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="grid size-8 place-items-center rounded-lg hover:bg-surface-2" aria-label={`Ações de ${entry.description}`}>
          <Ellipsis className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="z-50 min-w-52 rounded-xl border border-border bg-surface p-1 text-sm shadow-pop">
          {editable && (
            <>
              <DropdownMenu.Item className={item} onSelect={onPay}>
                <HandCoins className="size-4" aria-hidden="true" /> Dar baixa
              </DropdownMenu.Item>
              <DropdownMenu.Item className={`${item} text-danger-fg`} disabled={entry.paid_cents > 0} onSelect={onCancel}>
                <Ban className="size-4" aria-hidden="true" /> {entry.paid_cents > 0 ? 'Cancelar (já tem pagamento)' : 'Cancelar lançamento'}
              </DropdownMenu.Item>
            </>
          )}
          {entry.contract_id && (
            <DropdownMenu.Item className={item} onSelect={() => void navigate({ to: '/contratos/$contractId', params: { contractId: entry.contract_id! } })}>
              <FileText className="size-4" aria-hidden="true" /> Ver contrato {entry.contract_code}
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/* ---------------------------------------------------------------- dar baixa */

/** Forma do formulário de baixa: o limite (saldo e hoje) entra no esquema para o erro dizer o número. */
function paymentFormSchema(open: number, today: string) {
  return z.object({
    amount: z
      .string()
      .refine((v) => (parseBRL(v) ?? 0) > 0, 'Informe um valor maior que zero, por exemplo 1.250,00.')
      .refine((v) => (parseBRL(v) ?? 0) <= open, `Até o saldo em aberto: ${formatBRL(open)}. Valor a mais vira outro lançamento.`),
    paid_at: z
      .string()
      .refine((v) => parseDateBR(v) === v, 'Informe a data do pagamento.')
      .refine((v) => v <= today, `Data no futuro: use hoje (${formatDate(today)}) ou uma data anterior.`),
    method: z.enum(['pix', 'boleto', 'transfer', 'cash', 'card', 'other']),
    reference: z.string().max(120, 'Referência de até 120 caracteres.'),
  })
}
type PaymentForm = z.infer<ReturnType<typeof paymentFormSchema>>

/** "R$ 1.234,56" sem o "R$": o valor que aparece pronto no campo para a pessoa só confirmar. */
function centsToField(c: number): string {
  return formatBRL(c).replace(/^R\$\s?/, '').trim()
}

export function PaymentDialog({ entry, onClose }: { entry: EntryRow; onClose: () => void }) {
  const s = useSession()
  const schema = useMemo(() => paymentFormSchema(entry.open_cents, s.today), [entry.open_cents, s.today])
  const form = useForm<PaymentForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { amount: centsToField(entry.open_cents), paid_at: s.today, method: 'pix', reference: '' },
  })
  const save = useRepoMutation(registerPayment, {
    success: (r) => (r.open_cents > 0 ? `Baixa registrada. Ainda em aberto: ${formatBRL(r.open_cents)}.` : `"${entry.description}" quitado.`),
    onSuccess: onClose,
  })
  const { register, handleSubmit, formState, control } = form
  // useWatch (e não watch): o valor digitado atualiza a dica "Parcial: ..." sem confundir o React Compiler.
  const typed = parseBRL(useWatch({ control, name: 'amount' })) ?? 0
  const submit = handleSubmit((v) => save.mutate({ entry_id: entry.id, amount_cents: parseBRL(v.amount)!, paid_at: v.paid_at, method: v.method, reference: v.reference.trim() }))
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Dar baixa"
      description={`${entry.description}${entry.person_name ? ` · ${entry.person_name}` : ''} · vence ${formatDate(entry.due_date)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} loadingText="Registrando…" onClick={submit}>
            Registrar baixa
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <p className="num rounded-lg bg-surface-2 px-3 py-2 text-sm">
          Valor {formatBRL(entry.amount_cents)} · já pago {formatBRL(entry.paid_cents)} · <strong>em aberto {formatBRL(entry.open_cents)}</strong>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Valor recebido (R$)"
            required
            error={formState.errors.amount?.message}
            hint={typed > 0 && typed < entry.open_cents ? `Parcial: ${formatBRL(entry.open_cents - typed)} continuam em aberto.` : 'Pode ser parcial: o resto fica em aberto.'}
          >
            {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" aria-describedby={describedBy} aria-invalid={invalid} {...register('amount')} />}
          </Field>
          <Field label="Data do pagamento" required error={formState.errors.paid_at?.message}>
            {({ id, describedBy, invalid }) => <Input id={id} type="date" max={s.today} aria-describedby={describedBy} aria-invalid={invalid} {...register('paid_at')} />}
          </Field>
          <Field label="Forma" required>
            {({ id }) => (
              <Select id={id} {...register('method')}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD[m]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Referência" hint="Número do PIX, do boleto ou do comprovante." error={formState.errors.reference?.message}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('reference')} />}
          </Field>
        </div>
      </form>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- cancelar (com Desfazer) */

export function CancelEntryDialog({ entry, onClose }: { entry: EntryRow; onClose: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cancel = useRepoMutation(cancelEntry, { silent: true })
  const restore = useRepoMutation(restoreEntry, { success: 'Cancelamento desfeito: o lançamento voltou a ficar em aberto.' })
  const confirm = () => {
    if (reason.trim().length < 3) return setError('Conte o motivo com pelo menos 3 letras (fica na auditoria).')
    cancel.mutate(
      { id: entry.id, reason },
      {
        onSuccess: () => {
          toast.success(`"${entry.description}" cancelado.`, { label: 'Desfazer', onClick: () => restore.mutate({ id: entry.id }) })
          onClose()
        },
      },
    )
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Cancelar lançamento?"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="danger" loading={cancel.isPending} loadingText="Cancelando…" onClick={confirm}>
            Cancelar lançamento
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          <strong>{entry.description}</strong> ({formatBRL(entry.amount_cents)}, vence {formatDate(entry.due_date)}) deixa de ser cobrado. Ele continua na lista como
          "Cancelado" e o motivo vai para a auditoria.
        </p>
        <Field label="Motivo" required error={error}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setError(null)
              }}
              placeholder="Ex.: lançado em duplicidade"
            />
          )}
        </Field>
      </div>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- novo lançamento */

const entryFormSchema = z
  .object({
    direction: z.enum(['receivable', 'payable']),
    category: z.string(),
    description: z.string(),
    amount: z.string(),
    due_date: z.string(),
    competence: z.string(),
    unit_id: z.string(),
    link_contract: z.boolean(),
    charged_to: z.string(),
    repeat: z.string(),
  })
  .superRefine((v, ctx) => {
    // Todas as regras num lugar só: os campos são texto livre e a mensagem diz causa e conserto.
    const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (!MANUAL_CATEGORIES.includes(v.category as EntryCategory)) add('category', 'Escolha a categoria.')
    if (v.description.trim().length < 3) add('description', 'Descreva com pelo menos 3 letras, por exemplo "IPTU 2027".')
    if ((parseBRL(v.amount) ?? 0) <= 0) add('amount', 'Informe um valor maior que zero, por exemplo 180,00.')
    if (parseDateBR(v.due_date) !== v.due_date) add('due_date', 'Informe o vencimento.')
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v.competence)) add('competence', 'Informe o mês de referência.')
    const n = Number(v.repeat)
    if (!Number.isInteger(n) || n < 1 || n > 36) add('repeat', 'Repita de 1 a 36 vezes (1 = só este mês).')
  })
type EntryForm = z.infer<typeof entryFormSchema>

/** Novo lançamento à mão (condomínio, IPTU, manutenção, caução, outro), com repetição mensal opcional. */
export function NewEntryDialog({ onClose }: { onClose: () => void }) {
  const s = useSession()
  const units = useRepo('financeiro:unidades', listUnitOptions)
  const [person, setPerson] = useState<PickedPerson | null>(null)
  const form = useForm<EntryForm>({
    resolver: zodResolver(entryFormSchema),
    mode: 'onBlur',
    defaultValues: {
      direction: 'payable', category: 'condo_fee', description: '', amount: '', due_date: '', competence: s.today.slice(0, 7),
      unit_id: '', link_contract: true, charged_to: '', repeat: '1',
    },
  })
  const { register, handleSubmit, formState, setValue, control } = form
  const [unitId, repeatText, due, amountText, direction] = useWatch({ control, name: ['unit_id', 'repeat', 'due_date', 'amount', 'direction'] })
  const save = useRepoMutation(createEntries, {
    success: (rows) => (rows.length > 1 ? `${rows.length} lançamentos criados (${formatMonth(rows[0].competence)} a ${formatMonth(rows[rows.length - 1].competence)}).` : `"${rows[0].description}" lançado.`),
    onSuccess: onClose,
  })
  const unitList = units.data
  const unit = unitList?.find((u) => u.id === unitId)
  const repeat = Number(repeatText)
  const amount = parseBRL(amountText)
  // Unidades agrupadas por imóvel (vira <optgroup> no select).
  const groups = useMemo(() => {
    const m = new Map<string, UnitOption[]>()
    for (const u of unitList ?? []) m.set(u.property_name, [...(m.get(u.property_name) ?? []), u])
    return [...m.entries()]
  }, [unitList])
  const submit = handleSubmit((v) =>
    save.mutate({
      direction: v.direction, category: v.category as EntryCategory, description: v.description, person_id: person?.id ?? null,
      unit_id: v.unit_id || null, contract_id: v.link_contract && unit?.lease ? unit.lease.id : null, competence: v.competence,
      due_date: v.due_date, amount_cents: parseBRL(v.amount)!, charged_to: (v.charged_to || null) as ChargedTo | null, repeat: Number(v.repeat),
    }),
  )
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Novo lançamento"
      description="Aluguel nasce do contrato ativado; repasse e taxa nascem do repasse. Aqui entram as outras contas."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {repeat > 1 ? `Lançar ${repeat} meses` : 'Lançar'}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1 text-[13px] font-medium">Direção</legend>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex min-h-6 items-center gap-2 text-sm">
              <input type="radio" value="receivable" className="size-4 accent-[var(--primary)]" {...register('direction')} /> A receber
            </label>
            <label className="inline-flex min-h-6 items-center gap-2 text-sm">
              <input type="radio" value="payable" className="size-4 accent-[var(--primary)]" {...register('direction')} /> A pagar
            </label>
          </div>
        </fieldset>
        <Field label="Categoria" required error={formState.errors.category?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('category')}>
              {MANUAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {ENTRY_CATEGORY[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Descrição" required error={formState.errors.description?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder="Ex.: Condomínio novembro" {...register('description')} />}
        </Field>
        <Field label="Valor (R$)" required error={formState.errors.amount?.message} hint={amount ? formatBRL(amount) : undefined}>
          {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" aria-describedby={describedBy} aria-invalid={invalid} placeholder="0,00" {...register('amount')} />}
        </Field>
        <Field label="Vencimento" required error={formState.errors.due_date?.message}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...register('due_date', { onChange: (e) => /^\d{4}-\d{2}/.test(e.target.value) && setValue('competence', e.target.value.slice(0, 7)) })}
            />
          )}
        </Field>
        <Field label="Competência (mês de referência)" required error={formState.errors.competence?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="month" aria-describedby={describedBy} aria-invalid={invalid} {...register('competence')} />}
        </Field>
        <Field label="Repetir todo mês" error={formState.errors.repeat?.message} hint={repeat > 1 && due ? `Vencimentos de ${formatDate(due)} a ${formatDate(lastDue(due, repeat))}.` : '1 = só este mês. Até 36.'}>
          {({ id, describedBy, invalid }) => <Input id={id} type="number" min={1} max={36} aria-describedby={describedBy} aria-invalid={invalid} {...register('repeat')} />}
        </Field>
        <div className="sm:col-span-2">
          <PersonPicker label={direction === 'payable' ? 'Quem recebe (opcional)' : 'Quem paga (opcional)'} value={person} onChange={setPerson} />
        </div>
        <Field label="Unidade (opcional)">
          {({ id }) => (
            <Select id={id} {...register('unit_id')}>
              <option value="">{units.isLoading ? 'Carregando…' : 'Sem unidade'}</option>
              {groups.map(([property, list]) => (
                <optgroup key={property} label={property}>
                  {list.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Quem arca" hint="Despesa do proprietário entra no repasse dele.">
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} {...register('charged_to')}>
              <option value="">Não se aplica</option>
              {(Object.keys(CHARGED_TO) as ChargedTo[])
                .filter((c) => c !== 'agency' || s.org.kind === 'agency')
                .map((c) => (
                  <option key={c} value={c}>
                    {CHARGED_TO[c]}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        {unit?.lease && (
          <div className="sm:col-span-2">
            <Checkbox label={`Ligar ao contrato vigente ${unit.lease.code} (${unit.lease.lessee_name})`} {...register('link_contract')} />
          </div>
        )}
      </form>
    </Dialog>
  )
}

/** Último vencimento de uma série (mesma conta do repositório: cada mês parte do dia combinado). */
function lastDue(first: string, repeat: number): string {
  return dueDateFor(addMonths(monthStart(first), repeat - 1), parts(first)[2])
}
