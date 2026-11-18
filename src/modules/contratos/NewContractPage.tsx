/* =============================================================================
   Nova locação: assistente de 5 etapas (Unidade -> Partes -> Valores -> Garantia -> Revisão).

   Como funciona:
   - UM formulário só (react-hook-form) para as 5 etapas. "Continuar" valida apenas os campos da
     etapa (trigger), então o erro aparece onde a pessoa está, e voltar não perde nada.
   - Os campos são texto (o que se digita: "2.500,00", "10,5"); a conversão para centavos e número
     acontece no envio. O esquema (zod) diz causa e conserto em cada erro.
   - Nada é gravado até "Criar rascunho". O contrato nasce em RASCUNHO: não cobra e não ocupa a
     unidade; depois vem revisão, aprovação, assinatura e ativação (tela do contrato).
   - As regras de verdade (sobreposição, garantia única, caução de até 3 aluguéis) estão no
     repositório; a tela repete as que dá para avisar antes, para ninguém chegar à revisão à toa.
   ============================================================================= */
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useForm, useWatch, type FieldPath, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, CircleAlert, Search } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { ADJUSTMENT_INDEX, CONTRACT_STATUS, GUARANTEE, UNIT_STATUS } from '@/data/labels'
import type { AdjustmentIndex, GuaranteeType, UnitStatus } from '@/data/types'
import { getUnit, listUnits, type UnitRow } from '@/data/views/units'
import { addMonths, formatDate, monthStart, parseDateBR, parts } from '@/lib/dates'
import { documentError, maskDocument, normalizeDocument } from '@/lib/documents'
import { formatBRL, parseBRL } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { UnitStatusBadge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Card, DescriptionList, PageHeader, Stepper } from '@/components/ui/Layout'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { formatPct, parsePct } from '@/modules/financeiro/ui'
import { PersonPicker, type PickedPerson } from './PersonPicker'
import { createLease, endDateFor, getLeaseContext, type LeaseContext, type NewLeaseInput, type PartyInput } from './repo'

const STEPS = ['Unidade', 'Partes', 'Valores', 'Garantia', 'Revisão']
/** Só unidade disponível ou reservada entra numa locação nova (ocupada, em manutenção e bloqueada, não). */
const ALLOWED: UnitStatus[] = ['available', 'reserved']
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const GUARANTEE_HELP: Record<GuaranteeType, string> = {
  none: 'Sem garantia. A lei permite cobrar o aluguel até o 6º dia útil do mês a vencer (art. 42).',
  deposit: 'Dinheiro depositado em poupança, de até 3 aluguéis (art. 38).',
  guarantor: 'Uma pessoa responde pela dívida se o locatário não pagar.',
  insurance: 'Apólice de seguradora que cobre aluguel e encargos em atraso.',
  capitalization: 'Título de capitalização em nome do locatário, resgatado no fim do contrato.',
}

/* ---------------------------------------------------------------- forma do formulário */

const partySchema = z.object({
  mode: z.enum(['existing', 'new']),
  id: z.string(),
  kind: z.enum(['PF', 'PJ']),
  name: z.string(),
  document: z.string(),
  email: z.string(),
  phone: z.string(),
})
type PartyForm = z.infer<typeof partySchema>
type Add = (path: string, message: string) => void

/** Regras da parte (locatário ou fiador): escolhida na lista OU cadastrada com documento válido. */
function checkParty(p: PartyForm, prefix: 'lessee' | 'guarantor', who: string, add: Add): void {
  if (p.mode === 'existing') {
    if (!p.id) add(`${prefix}.id`, `Escolha ${who} na lista ou cadastre uma pessoa nova.`)
    return
  }
  if (p.name.trim().length < 3) add(`${prefix}.name`, 'Nome com pelo menos 3 letras.')
  const problem = documentError(p.document)
  if (problem) add(`${prefix}.document`, problem)
  else if ((p.kind === 'PF') !== (normalizeDocument(p.document).length === 11)) {
    add(`${prefix}.document`, p.kind === 'PF' ? 'Pessoa física usa CPF (11 dígitos).' : 'Pessoa jurídica usa CNPJ (14 caracteres).')
  }
  if (p.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) add(`${prefix}.email`, 'E-mail incompleto: falta o @ ou o domínio.')
}

const formSchema = z
  .object({
    unit_id: z.string(),
    lessee: partySchema,
    rent: z.string(),
    due_day: z.string(),
    start_date: z.string(),
    months: z.string(),
    adjustment_index: z.enum(['IGPM', 'IPCA', 'INPC', 'fixed', 'none']),
    adjustment_month: z.string(),
    late_fee_pct: z.string(),
    interest_pct_month: z.string(),
    guarantee_type: z.enum(['none', 'deposit', 'guarantor', 'insurance', 'capitalization']),
    deposit: z.string(),
    guarantor: partySchema,
    notes: z.string(),
  })
  .superRefine((v, ctx) => {
    // Todas as regras num lugar só: os campos são texto livre, então cada um é conferido aqui.
    const add: Add = (path, message) => ctx.addIssue({ code: 'custom', path: path.split('.'), message })
    if (!v.unit_id) add('unit_id', 'Escolha a unidade da locação na lista.')
    checkParty(v.lessee, 'lessee', 'o locatário', add)
    const rent = parseBRL(v.rent)
    if (!rent || rent <= 0) add('rent', 'Informe o aluguel em reais, por exemplo 2.500,00.')
    const day = Number(v.due_day)
    if (!Number.isInteger(day) || day < 1 || day > 31) add('due_day', 'Dia de vencimento de 1 a 31.')
    if (parseDateBR(v.start_date) !== v.start_date) add('start_date', 'Informe a data de início.')
    const months = Number(v.months)
    if (!Number.isInteger(months) || months < 1 || months > 120) add('months', 'Prazo de 1 a 120 meses (até 10 anos).')
    const late = parsePct(v.late_fee_pct)
    if (late === null || late < 0 || late > 20) add('late_fee_pct', 'Multa de 0 a 20%, por exemplo 10.')
    const interest = parsePct(v.interest_pct_month)
    if (interest === null || interest < 0 || interest > 10) add('interest_pct_month', 'Juros de 0 a 10% ao mês, por exemplo 1.')
    if (v.guarantee_type === 'deposit') {
      const dep = parseBRL(v.deposit)
      if (!dep || dep <= 0) add('deposit', 'Informe o valor da caução.')
      else if (rent && dep > rent * 3) add('deposit', `Até 3 aluguéis: no máximo ${formatBRL(rent * 3)} (Lei 8.245, art. 38).`)
    }
    if (v.guarantee_type === 'guarantor') {
      checkParty(v.guarantor, 'guarantor', 'o fiador', add)
      const sameId = v.guarantor.mode === 'existing' && v.lessee.mode === 'existing' && !!v.guarantor.id && v.guarantor.id === v.lessee.id
      const docG = normalizeDocument(v.guarantor.document)
      const sameDoc = v.guarantor.mode === 'new' && v.lessee.mode === 'new' && !!docG && docG === normalizeDocument(v.lessee.document)
      if (sameId || sameDoc) add(sameId ? 'guarantor.id' : 'guarantor.document', 'O fiador precisa ser outra pessoa, não o locatário.')
    }
    if (v.notes.length > 1000) add('notes', 'Observação de até 1.000 caracteres.')
  })
type FormValues = z.infer<typeof formSchema>
type Form = UseFormReturn<FormValues>

/** Campos que cada etapa confere ao clicar em "Continuar". */
const STEP_FIELDS: FieldPath<FormValues>[][] = [
  ['unit_id'],
  ['lessee.id', 'lessee.name', 'lessee.document', 'lessee.email'],
  ['rent', 'due_day', 'start_date', 'months', 'late_fee_pct', 'interest_pct_month'],
  ['deposit', 'guarantor.id', 'guarantor.name', 'guarantor.document', 'guarantor.email'],
  ['notes'],
]

const emptyParty: PartyForm = { mode: 'existing', id: '', kind: 'PF', name: '', document: '', email: '', phone: '' }

/** "1.234,56" (sem o "R$"): o valor pronto para o campo. */
function centsToField(c: number): string {
  return formatBRL(c).replace(/^R\$\s?/, '').trim()
}

function toParty(p: PartyForm): PartyInput {
  return p.mode === 'existing'
    ? { person_id: p.id }
    : { new_person: { kind: p.kind, name: p.name.trim(), document: p.document, email: p.email.trim(), phone: p.phone.trim() } }
}

/** Do formulário (texto) para o repositório (centavos e números). Só roda depois de validar. */
function toInput(v: FormValues): NewLeaseInput {
  return {
    unit_id: v.unit_id, lessee: toParty(v.lessee), rent_cents: parseBRL(v.rent)!, due_day: Number(v.due_day), start_date: v.start_date,
    months: Number(v.months), adjustment_index: v.adjustment_index, adjustment_month: Number(v.adjustment_month),
    late_fee_pct: parsePct(v.late_fee_pct)!, interest_pct_month: parsePct(v.interest_pct_month)!, guarantee_type: v.guarantee_type,
    deposit_cents: v.guarantee_type === 'deposit' ? parseBRL(v.deposit)! : 0, guarantor: v.guarantee_type === 'guarantor' ? toParty(v.guarantor) : null, notes: v.notes,
  }
}

/** Locação que já segura a unidade num período que cruza com o digitado (aviso antes de gravar). */
function clashOf(ctx: LeaseContext | undefined, start: string, monthsText: string) {
  const months = Number(monthsText)
  if (!ctx || parseDateBR(start) !== start || !Number.isInteger(months) || months < 1) return null
  const end = endDateFor(start, months)
  return ctx.holding.find((k) => k.start_date <= end && start <= k.end_date) ?? null
}

/* ---------------------------------------------------------------- página */

export function NewContractPage({ unitId }: { unitId?: string }) {
  return (
    <Guard action="contracts:edit" what="o cadastro de locação">
      <Wizard initialUnitId={unitId} />
    </Guard>
  )
}

function Wizard({ initialUnitId }: { initialUnitId?: string }) {
  const s = useSession()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [pickedUnit, setPickedUnit] = useState<UnitRow | null>(null)
  const [lesseePick, setLesseePick] = useState<PickedPerson | null>(null)
  const [guarantorPick, setGuarantorPick] = useState<PickedPerson | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)
  const start = monthStart(addMonths(s.today, 1)) // padrão: dia 1º do mês que vem
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    defaultValues: {
      unit_id: '', lessee: emptyParty, rent: '', due_day: '10', start_date: start, months: '30', adjustment_index: 'IPCA',
      adjustment_month: String(parts(start)[1]), late_fee_pct: '10', interest_pct_month: '1', guarantee_type: 'none', deposit: '', guarantor: emptyParty, notes: '',
    },
  })
  // Unidade vinda do endereço (?unidade=): entra escolhida se estiver disponível ou reservada.
  const initial = useRepo('contratos:unidade-inicial', (sess) => getUnit(sess, initialUnitId!), [initialUnitId], { enabled: !!initialUnitId })
  const initialOk = initial.data && ALLOWED.includes(initial.data.status) ? initial.data : null
  const unit = pickedUnit ?? initialOk
  const ctx = useRepo('contratos:contexto', (sess) => getLeaseContext(sess, unit!.id), [unit?.id], { enabled: !!unit })
  const save = useRepoMutation(createLease, {
    success: (k) => `Locação ${k.code} criada em rascunho.`,
    // A locação nova aparece escolhida em Contratos e pessoas (linha aberta, ficha curta, detalhes).
    onSuccess: (k) => void navigate({ to: '/contratos', search: { contrato: k.id } }),
  })

  // A cada troca de etapa o foco vai para o título dela: quem usa leitor de tela ouve onde está.
  useEffect(() => {
    if (moved.current) heading.current?.focus()
  }, [step])

  const chooseUnit = (u: UnitRow) => {
    setPickedUnit(u)
    form.setValue('unit_id', u.id, { shouldValidate: true })
    if (!form.getValues('rent') && u.asking_rent_cents) form.setValue('rent', centsToField(u.asking_rent_cents))
  }

  const go = (to: number) => {
    moved.current = true
    setStep(to)
  }

  const next = async () => {
    if (step === 0 && unit && !form.getValues('unit_id')) chooseUnit(unit)
    if (!(await form.trigger(STEP_FIELDS[step], { shouldFocus: true }))) return
    if (step === 2) {
      const v = form.getValues()
      const clash = clashOf(ctx.data, v.start_date, v.months)
      if (clash) {
        form.setError('start_date', { message: `Cruza com ${clash.code} (${formatDate(clash.start_date)} a ${formatDate(clash.end_date)}): comece depois de ${formatDate(clash.end_date)}.` }, { shouldFocus: true })
        return
      }
    }
    go(step + 1)
  }

  const submit = form.handleSubmit((v) => save.mutate(toInput(v)))

  return (
    <>
      <PageHeader eyebrow="Contratos" title="Nova locação" description="Cinco etapas; nada é gravado até a revisão. O contrato nasce em rascunho e só cobra depois de assinado e ativado." />
      <Stepper steps={STEPS} current={step} />
      <Card className="flex flex-col gap-5 p-4 sm:p-6">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
          Etapa {step + 1} de {STEPS.length}: {STEPS[step]}
        </h2>
        <form noValidate onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-5">
          {step === 0 && <UnitStep unit={unit} initial={initial.data ?? null} initialError={initial.error} onPick={chooseUnit} error={form.formState.errors.unit_id?.message} />}
          {step === 1 && <PartiesStep form={form} ctx={ctx.data} ctxError={ctx.error} pick={lesseePick} onPick={setLesseePick} />}
          {step === 2 && <ValuesStep form={form} ctx={ctx.data} today={s.today} />}
          {step === 3 && <GuaranteeStep form={form} pick={guarantorPick} onPick={setGuarantorPick} lesseeId={lesseePick?.id} />}
          {step === 4 && unit && <ReviewStep form={form} unit={unit} ctx={ctx.data} lessee={lesseePick} guarantor={guarantorPick} agency={s.org.kind === 'agency'} />}
        </form>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {step === 0 ? (
          <Link to="/contratos" className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text">
            <ArrowLeft className="size-4" aria-hidden="true" /> Voltar para Contratos
          </Link>
        ) : (
          <Button variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden="true" />} onClick={() => go(step - 1)}>
            Voltar
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={() => void next()}>
            Continuar <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button variant="primary" loading={save.isPending} loadingText="Criando…" onClick={() => void submit()}>
            Criar rascunho
          </Button>
        )}
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- etapa 1: unidade */

function UnitStep({ unit, initial, initialError, onPick, error }: { unit: UnitRow | null; initial: UnitRow | null; initialError: unknown; onPick: (u: UnitRow) => void; error?: string }) {
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(input), 200) // espera a pessoa parar de digitar
    return () => clearTimeout(t)
  }, [input])
  const q = useRepo('contratos:unidades-livres', (sess) => listUnits(sess, { search, filters: { status: ALLOWED }, pageSize: 12 }), [search])
  const rows = q.data?.rows ?? []
  // A escolhida fica sempre visível, mesmo fora dos 12 primeiros resultados da busca.
  const list = unit && !rows.some((r) => r.id === unit.id) ? [unit, ...rows] : rows
  return (
    <div className="flex flex-col gap-3">
      {!!initialError && <ErrorState error={initialError} />}
      {initial && !ALLOWED.includes(initial.status) && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-3 py-2 text-sm" role="status">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden="true" />
          <span>
            A unidade {initial.label} está {UNIT_STATUS[initial.status].toLowerCase()}
            {initial.lease ? ` (locação ${initial.lease.code} até ${formatDate(initial.lease.end_date)})` : ''}. Uma locação nova começa por uma unidade disponível ou reservada: escolha abaixo.
          </span>
        </p>
      )}
      <label className="relative">
        <span className="sr-only">Buscar unidade</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Buscar por código, imóvel ou bairro"
          className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-sm hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
        />
      </label>
      <p className="num text-xs text-muted" aria-live="polite">
        {q.data ? `${q.data.total.toLocaleString('pt-BR')} ${q.data.total === 1 ? 'unidade disponível ou reservada' : 'unidades disponíveis ou reservadas'}${q.data.total > rows.length ? `; mostrando ${rows.length}, busque para achar outra` : ''}` : 'Carregando…'}
      </p>
      {error && (
        <p className="text-xs font-medium text-danger-fg" role="alert">
          {error}
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Unidades">
        {!q.data && Array.from({ length: 6 }, (_, i) => <li key={i}><Skeleton className="h-24" /></li>)}
        {list.map((u) => {
          const on = unit?.id === u.id
          return (
            <li key={u.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPick(u)}
                className={cn('flex h-full w-full flex-col gap-1 rounded-xl border p-3 text-left transition-colors', on ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-border hover:border-border-strong hover:bg-surface-2')}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate font-semibold">{u.code}</span>
                  <UnitStatusBadge status={u.status} />
                </span>
                <span className="truncate text-sm text-muted">
                  {u.property_name} · {u.district}
                </span>
                <span className="text-xs text-muted">
                  {u.area_m2} m²{u.bedrooms ? ` · ${u.bedrooms} quartos` : ''}
                  {u.asking_rent_cents ? ` · pedida ${formatBRL(u.asking_rent_cents)}` : ''}
                </span>
                <span className="truncate text-xs text-muted">Dono: {u.owners_label || 'sem dono cadastrado'}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ---------------------------------------------------------------- etapa 2: partes */

function PartiesStep({ form, ctx, ctxError, pick, onPick }: { form: Form; ctx: LeaseContext | undefined; ctxError: unknown; pick: PickedPerson | null; onPick: (p: PickedPerson | null) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2" aria-label="Locadores">
        <h3 className="text-sm font-semibold">Locadores</h3>
        <p className="text-xs text-muted">São os donos da unidade, com a fatia de cada um. Para mudar, ajuste os proprietários em Imóveis.</p>
        {ctxError ? (
          <ErrorState error={ctxError} />
        ) : !ctx ? (
          <Skeleton className="h-12" />
        ) : ctx.lessors.length === 0 ? (
          <p className="text-sm text-danger-fg">A unidade não tem proprietário cadastrado: inclua o dono em Imóveis antes de alugar.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {ctx.lessors.map((o) => (
              <li key={o.person_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="font-medium">{o.name}</span>
                <span className="num text-muted">{formatPct(o.share_pct)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <PartyFields form={form} name="lessee" label="Locatário" pick={pick} onPick={onPick} excludeIds={ctx?.lessors.map((o) => o.person_id) ?? []} />
    </div>
  )
}

/** Escolher alguém cadastrado ou cadastrar na hora (locatário e fiador usam a mesma peça). */
function PartyFields({ form, name, label, pick, onPick, excludeIds }: { form: Form; name: 'lessee' | 'guarantor'; label: string; pick: PickedPerson | null; onPick: (p: PickedPerson | null) => void; excludeIds: string[] }) {
  const { register, formState, setValue, control } = form
  const mode = useWatch({ control, name: `${name}.mode` })
  const kind = useWatch({ control, name: `${name}.kind` })
  const errors = formState.errors[name]
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={`Como informar o ${label.toLowerCase()}`}>
        <label className="inline-flex min-h-6 items-center gap-2 text-sm">
          <input type="radio" value="existing" className="size-4 accent-[var(--primary)]" {...register(`${name}.mode`)} /> Pessoa já cadastrada
        </label>
        <label className="inline-flex min-h-6 items-center gap-2 text-sm">
          <input type="radio" value="new" className="size-4 accent-[var(--primary)]" {...register(`${name}.mode`)} /> Cadastrar agora
        </label>
      </div>
      {mode === 'existing' ? (
        <PersonPicker
          label={`Buscar ${label.toLowerCase()}`}
          required
          value={pick}
          excludeIds={excludeIds}
          error={errors?.id?.message}
          onChange={(p) => {
            onPick(p)
            setValue(`${name}.id`, p?.id ?? '', { shouldValidate: !!p })
          }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de pessoa" required>
            {({ id }) => (
              <Select id={id} {...register(`${name}.kind`)}>
                <option value="PF">Pessoa física (CPF)</option>
                <option value="PJ">Pessoa jurídica (CNPJ)</option>
              </Select>
            )}
          </Field>
          <Field label={kind === 'PJ' ? 'Razão social' : 'Nome completo'} required error={errors?.name?.message}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="off" {...register(`${name}.name`)} />}
          </Field>
          <Field label={kind === 'PJ' ? 'CNPJ' : 'CPF'} required error={errors?.document?.message} hint="Com ou sem pontuação. O dígito verificador é conferido.">
            {({ id, describedBy, invalid }) => <Input id={id} inputMode={kind === 'PJ' ? 'text' : 'numeric'} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="off" {...register(`${name}.document`)} />}
          </Field>
          <Field label="E-mail" error={errors?.email?.message}>
            {({ id, describedBy, invalid }) => <Input id={id} type="email" aria-describedby={describedBy} aria-invalid={invalid} autoComplete="off" {...register(`${name}.email`)} />}
          </Field>
          <Field label="Telefone">
            {({ id }) => <Input id={id} type="tel" inputMode="tel" autoComplete="off" {...register(`${name}.phone`)} />}
          </Field>
        </div>
      )}
    </fieldset>
  )
}

/* ---------------------------------------------------------------- etapa 3: valores */

function ValuesStep({ form, ctx, today }: { form: Form; ctx: LeaseContext | undefined; today: string }) {
  const { register, formState, setValue, control } = form
  const e = formState.errors
  const [rent, start, months, dueDay] = useWatch({ control, name: ['rent', 'start_date', 'months', 'due_day'] })
  const rentCents = parseBRL(rent)
  const monthsN = Number(months)
  const end = parseDateBR(start) === start && Number.isInteger(monthsN) && monthsN >= 1 ? endDateFor(start, monthsN) : null
  return (
    <div className="flex flex-col gap-4">
      {ctx && ctx.holding.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-3 py-2 text-sm" role="status">
          <p className="font-medium">A unidade já tem período comprometido:</p>
          <ul className="mt-1 list-disc pl-5">
            {ctx.holding.map((k) => (
              <li key={k.id}>
                {k.code} ({CONTRACT_STATUS[k.status].toLowerCase()}) de {formatDate(k.start_date)} a {formatDate(k.end_date)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-muted">O início precisa ser depois do fim do último período.</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Aluguel (R$)" required error={e.rent?.message} hint={rentCents ? formatBRL(rentCents) : 'Ex.: 2.500,00'}>
          {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" aria-describedby={describedBy} aria-invalid={invalid} {...register('rent')} />}
        </Field>
        <Field label="Dia de vencimento" required error={e.due_day?.message} hint={Number(dueDay) > 28 ? `Em mês sem o dia ${dueDay}, vence no último dia (ex.: 28/02).` : 'De 1 a 31.'}>
          {({ id, describedBy, invalid }) => <Input id={id} type="number" min={1} max={31} aria-describedby={describedBy} aria-invalid={invalid} {...register('due_day')} />}
        </Field>
        <Field label="Início" required error={e.start_date?.message} hint={start && start < today ? 'Início no passado: as cobranças desde lá nascem na ativação.' : undefined}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...register('start_date', { onChange: (ev) => parseDateBR(ev.target.value) && setValue('adjustment_month', String(parts(ev.target.value)[1])) })}
            />
          )}
        </Field>
        <Field label="Prazo (meses)" required error={e.months?.message} hint={end ? `Fim em ${formatDate(end)}.` : 'Residencial costuma ser 30 meses.'}>
          {({ id, describedBy, invalid }) => <Input id={id} type="number" min={1} max={120} aria-describedby={describedBy} aria-invalid={invalid} {...register('months')} />}
        </Field>
        <Field label="Índice de reajuste" required>
          {({ id }) => (
            <Select id={id} {...register('adjustment_index')}>
              {(Object.keys(ADJUSTMENT_INDEX) as AdjustmentIndex[]).map((i) => (
                <option key={i} value={i}>
                  {ADJUSTMENT_INDEX[i]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Mês de reajuste" hint="Normalmente o mês do início (aniversário do contrato).">
          {({ id, describedBy }) => (
            <Select id={id} aria-describedby={describedBy} {...register('adjustment_month')}>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Multa por atraso (%)" required error={e.late_fee_pct?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" aria-describedby={describedBy} aria-invalid={invalid} {...register('late_fee_pct')} />}
        </Field>
        <Field label="Juros (% ao mês)" required error={e.interest_pct_month?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" aria-describedby={describedBy} aria-invalid={invalid} {...register('interest_pct_month')} />}
        </Field>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- etapa 4: garantia */

function GuaranteeStep({ form, pick, onPick, lesseeId }: { form: Form; pick: PickedPerson | null; onPick: (p: PickedPerson | null) => void; lesseeId?: string }) {
  const { register, formState, control } = form
  const [type, rent] = useWatch({ control, name: ['guarantee_type', 'rent'] })
  const max = (parseBRL(rent) ?? 0) * 3
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm">
          <span className="font-semibold">Modalidade</span>
          <span className="text-muted"> · uma só: a Lei do Inquilinato (art. 37) proíbe duas garantias no mesmo contrato.</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(GUARANTEE) as GuaranteeType[]).map((g) => (
            <label key={g} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3', type === g ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong')}>
              <input type="radio" value={g} className="mt-0.5 size-4 accent-[var(--primary)]" {...register('guarantee_type')} />
              <span>
                <span className="block text-sm font-semibold">{GUARANTEE[g]}</span>
                <span className="block text-xs text-muted">{GUARANTEE_HELP[g]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {type === 'deposit' && (
        <Field label="Valor da caução (R$)" required error={formState.errors.deposit?.message} hint={max ? `Até ${formatBRL(max)} (3 aluguéis).` : 'Até 3 aluguéis.'}>
          {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" className="max-w-xs" aria-describedby={describedBy} aria-invalid={invalid} {...register('deposit')} />}
        </Field>
      )}
      {type === 'guarantor' && <PartyFields form={form} name="guarantor" label="Fiador" pick={pick} onPick={onPick} excludeIds={lesseeId ? [lesseeId] : []} />}
    </div>
  )
}

/* ---------------------------------------------------------------- etapa 5: revisão */

function ReviewStep({ form, unit, ctx, lessee, guarantor, agency }: { form: Form; unit: UnitRow; ctx: LeaseContext | undefined; lessee: PickedPerson | null; guarantor: PickedPerson | null; agency: boolean }) {
  const v = useWatch({ control: form.control })
  const who = (p: Partial<PartyForm> | undefined, picked: PickedPerson | null) =>
    p?.mode === 'existing' ? (picked ? `${picked.name} · ${maskDocument(picked.document)}` : '') : `${p?.name ?? ''} · ${maskDocument(p?.document ?? '')} (cadastro novo)`
  const months = Number(v.months)
  const end = v.start_date && months ? endDateFor(v.start_date, months) : ''
  const rent = parseBRL(v.rent ?? '') ?? 0
  return (
    <div className="flex flex-col gap-5">
      <DescriptionList
        columns={3}
        items={[
          { label: 'Unidade', value: unit.label },
          { label: 'Locadores', value: ctx ? ctx.lessors.map((o) => `${o.name} (${formatPct(o.share_pct)})`).join(', ') : '' },
          { label: 'Locatário', value: who(v.lessee, lessee) },
          { label: 'Período', value: end ? `${formatDate(v.start_date)} a ${formatDate(end)} (${months} meses)` : '' },
          { label: 'Aluguel', value: `${formatBRL(rent)} · vence dia ${v.due_day}` },
          { label: 'Reajuste', value: `${ADJUSTMENT_INDEX[v.adjustment_index ?? 'none']} · em ${MONTHS[Number(v.adjustment_month) - 1] ?? ''}` },
          { label: 'Multa e juros', value: `${v.late_fee_pct}% de multa · ${v.interest_pct_month}% ao mês` },
          {
            label: 'Garantia',
            value: `${GUARANTEE[v.guarantee_type ?? 'none']}${v.guarantee_type === 'deposit' ? `: ${formatBRL(parseBRL(v.deposit ?? '') ?? 0)}` : ''}${v.guarantee_type === 'guarantor' ? `: ${who(v.guarantor, guarantor)}` : ''}`,
          },
          ...(agency
            ? [{
                label: 'Taxa de administração',
                value: ctx ? `${formatPct(ctx.admin_fee_pct)}${ctx.admin_contract_code ? ` (do contrato ${ctx.admin_contract_code})` : ' (padrão: o dono não tem contrato de administração)'}` : '',
                info: 'Vem do contrato de administração do proprietário com a imobiliária. É descontada no repasse.',
              }]
            : []),
        ]}
      />
      <Field label="Observações (opcional)" error={form.formState.errors.notes?.message} hint="Ficam no contrato, visíveis só para a equipe.">
        {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} {...form.register('notes')} />}
      </Field>
      <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
        O contrato nasce em <strong className="text-text">rascunho</strong>: não cobra e não ocupa a unidade. Depois vêm revisão, aprovação e assinatura; as cobranças mensais nascem na ativação.
      </p>
    </div>
  )
}
