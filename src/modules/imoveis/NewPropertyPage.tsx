/* =============================================================================
   Cadastrar imóvel: assistente em 6 etapas (Tipo, Endereço, Estrutura, Proprietários,
   Equipe do prédio, Revisão). A etapa da equipe é opcional: dá para pular e adicionar depois.
   Todo campo diz se é obrigatório (*) ou "opcional", antes de a pessoa tentar avançar.

   Como funciona:
   1. UM formulário (react-hook-form) para as 5 etapas, validado pelo MESMO esquema zod que o
      repositório usa. "Próximo" confere só os campos da etapa atual (trigger); o "Cadastrar"
      confere tudo e, se algo falhar, volta para a etapa com o erro.
   2. RASCUNHO: a cada mudança (com 400 ms de folga) o formulário vai para o localStorage, numa
      chave por organização E por pessoa (quem divide o computador não vê o rascunho do outro).
      Ao voltar, a tela oferece retomar de onde parou ou começar do zero.
   3. A estrutura (blocos x andares x unidades) vira códigos pela mesma função da gravação
      (planStructure), então a prévia mostra exatamente o que vai ser criado.
   4. EQUIPE DO PRÉDIO: cada pessoa (zelador, porteiro, síndico) vira ficha nova em Pessoas e
      ligação ao imóvel, tudo no mesmo "Cadastrar imóvel". A foto é reduzida no navegador.
   ============================================================================= */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useController, useFieldArray, useForm, useWatch, type DefaultValues, type FieldErrors, type Path, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, ArrowRight, Building, Building2, Check, DoorOpen, House, Store, Trash2, UserPlus, type LucideIcon } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, hasFeature } from '@/auth/permissions'
import type { Session } from '@/auth/session'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { Input, Select, Textarea } from '@/components/ui/Field'
import { Card, DescriptionList, PageHeader, Stepper } from '@/components/ui/Layout'
import { Skeleton } from '@/components/ui/States'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { PROPERTY_KIND, STAFF_ROLE, UNIT_KIND } from '@/data/labels'
import { formatDateTime } from '@/lib/dates'
import { formatCEP, formatPhone } from '@/lib/documents'
import { formatBRL, parseBRL } from '@/lib/money'
import { readJSON, writeJSON } from '@/lib/storage'
import { plural } from '@/lib/text'
import { PhotoField } from '@/modules/pessoas/PhotoField'
import { AddressFields } from './AddressFields'
import { FormField, RequiredLegend } from './FormField'
import { OwnersEditor } from './OwnersEditor'
import { createProperty, listFormOptions, type Option } from './repo'
import { formatPct, newPropertySchema, STAFF_ROLES, structureSchema, TEMPLATES_BY_KIND, UNIT_KINDS, type NewPropertyInput, type WizardKind } from './schemas'
import { codeRanges, LIMITS, planStructure, type StructurePlan } from './structure'

const STEPS = ['Tipo', 'Endereço', 'Estrutura', 'Proprietários', 'Equipe do prédio', 'Revisão']

/** Campos que cada etapa confere antes de deixar avançar. */
const STEP_FIELDS: Path<NewPropertyInput>[][] = [['kind'], ['name', 'address', 'portfolio_id', 'manager_user_id', 'notes'], ['structure'], ['owners'], ['staff'], []]

type Values = NewPropertyInput
type Structure = Values['structure']

interface Draft {
  values: DefaultValues<Values>
  step: number
  savedAt: string
}

const KIND_CARDS: { kind: WizardKind; title: string; text: string; icon: LucideIcon }[] = [
  { kind: 'house', title: 'Casa', text: 'Uma casa avulsa. Vira um imóvel com uma unidade, que é a que se aluga.', icon: House },
  { kind: 'apartment', title: 'Apartamento', text: 'Um apartamento avulso, sem cadastrar o prédio inteiro.', icon: DoorOpen },
  { kind: 'condominium', title: 'Condomínio', text: 'Blocos com andares ou casas em fila; cada unidade com o próprio código.', icon: Building2 },
  { kind: 'building', title: 'Edifício', text: 'Um prédio inteiro, com andares e apartamentos.', icon: Building },
  { kind: 'commercial', title: 'Comercial', text: 'Salas e lojas distribuídas em andares.', icon: Store },
]

/* ---------------------------------------------------------------- valores iniciais */

/** Estrutura padrão de cada tipo (dá para mudar tudo na etapa Estrutura). */
function structureDefaults(kind: WizardKind): Structure {
  const apt = { kind: 'apartment' as const, area_m2: 65, bedrooms: 2, bathrooms: 1, parking_spots: 1, asking_rent: '' }
  const grid = { code: '', blocks: 1, floors: 4, unitsPerFloor: 4, startNumber: 101 }
  switch (kind) {
    case 'house':
      return { ...grid, template: 'single', code: 'Casa', unit: { kind: 'house', area_m2: 120, bedrooms: 3, bathrooms: 2, parking_spots: 2, asking_rent: '' } }
    case 'apartment':
      return { ...grid, template: 'single', code: 'Apto 101', unit: apt }
    case 'condominium':
      return { ...grid, template: 'tower', blocks: 2, unit: apt }
    case 'building':
      return { ...grid, template: 'tower', unitsPerFloor: 2, unit: apt }
    case 'commercial':
      return { ...grid, template: 'tower', floors: 6, unitsPerFloor: 5, unit: { kind: 'office', area_m2: 40, bedrooms: 0, bathrooms: 1, parking_spots: 1, asking_rent: '' } }
  }
}

/** Casas em fila (condomínio horizontal): uma quadra de 6 casas, numeradas de 1 em diante. */
function rowHousesDefaults(): Structure {
  return { template: 'row_houses', code: '', blocks: 1, floors: 1, unitsPerFloor: 6, startNumber: 1, unit: { kind: 'house', area_m2: 110, bedrooms: 3, bathrooms: 2, parking_spots: 2, asking_rent: '' } }
}

function emptyValues(s: Session): DefaultValues<Values> {
  return {
    name: '',
    address: { cep: '', street: '', number: '', complement: '', district: '', city: '', state: '' },
    portfolio_id: '',
    manager_user_id: s.org.kind === 'agency' ? s.user.id : '',
    notes: '',
    structure: structureDefaults('house'),
    // Na conta de proprietário independente, quem cadastra costuma ser o dono: já vem preenchido.
    owners: s.org.kind === 'landlord' && s.personId ? [{ person_id: s.personId, name: s.user.full_name, share_pct: 100 }] : [],
    staff: [],
  }
}

/**
 * O rascunho vem do navegador (dado de fora): pode ser de uma versão antiga do app ou estar
 * pela metade. Aqui ele é completado com os valores padrão, campo a campo.
 */
function readDraft(key: string, s: Session): Draft | null {
  const d = readJSON<Draft>(key)
  if (!d || typeof d !== 'object' || !d.values || typeof d.step !== 'number') return null
  const base = emptyValues(s)
  return {
    step: Math.min(Math.max(0, Math.trunc(d.step)), STEPS.length - 1),
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : new Date(0).toISOString(),
    values: {
      ...base, ...d.values,
      address: { ...base.address, ...d.values.address },
      structure: { ...base.structure, ...d.values.structure, unit: { ...base.structure?.unit, ...d.values.structure?.unit } },
      owners: Array.isArray(d.values.owners) ? d.values.owners : base.owners,
      // Rascunho de antes da etapa "Equipe do prédio" não tem a lista: começa vazia.
      staff: Array.isArray(d.values.staff) ? d.values.staff : [],
    },
  }
}

/** "Casa Hortênsias, 120" a partir do endereço (quando a pessoa não dá nome). */
function suggestName(kind: WizardKind | undefined, street: string, number: string): string {
  const short = street.replace(/^(rua|avenida|av\.|r\.|travessa|alameda)\s+(das |dos |da |do |de )?/i, '').trim()
  if (!short) return ''
  return `${kind ? PROPERTY_KIND[kind] : 'Imóvel'} ${short}${number.trim() ? `, ${number.trim()}` : ''}`
}

function firstStepWithError(e: FieldErrors<Values>): number {
  if (e.kind) return 0
  if (e.name || e.address || e.portfolio_id || e.manager_user_id || e.notes) return 1
  if (e.structure) return 2
  if (e.owners) return 3
  if (e.staff) return 4
  return 5
}

/* ---------------------------------------------------------------- página */

export function NewPropertyPage() {
  return (
    <Guard action="properties:edit" what="o cadastro de imóveis">
      <PageHeader
        eyebrow="Imóveis"
        title="Cadastrar imóvel"
        description="Seis etapas; a da equipe do prédio é opcional. O rascunho fica salvo neste navegador a cada mudança: dá para parar e voltar depois."
        actions={
          <Link to="/imoveis" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:border-border-strong">
            <ArrowLeft className="size-4" aria-hidden="true" /> Voltar à lista
          </Link>
        }
      />
      <WizardGate />
    </Guard>
  )
}

function draftKey(s: Session): string {
  return `imobil:rascunho:imovel:${s.org.id}:${s.user.id}`
}

/** Decide se começa do zero ou oferece retomar o rascunho guardado. */
function WizardGate() {
  const s = useSession()
  const key = draftKey(s)
  const [draft] = useState(() => readDraft(key, s))
  const [start, setStart] = useState<{ values: DefaultValues<Values>; step: number } | null>(() => (draft ? null : { values: emptyValues(s), step: 0 }))

  if (!start && draft) {
    const v = draft.values
    const what = v.name || (v.kind ? PROPERTY_KIND[v.kind] : '') || 'Imóvel sem nome'
    return (
      <Card className="flex max-w-2xl flex-col gap-3 p-6">
        <h2 className="text-base font-semibold">Você tem um cadastro pela metade</h2>
        <p className="text-sm text-muted">
          <strong className="text-text">{what}</strong>, parado na etapa {STEPS[draft.step]}, salvo em {formatDateTime(draft.savedAt, s.org.timezone)}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setStart({ values: draft.values, step: draft.step })}>
            Retomar de onde parei
          </Button>
          <Button
            onClick={() => {
              writeJSON(key, null) // "null" no lugar do rascunho = sem rascunho
              setStart({ values: emptyValues(s), step: 0 })
            }}
          >
            Começar do zero
          </Button>
        </div>
        <p className="text-xs text-muted">O rascunho fica só neste navegador e só para você.</p>
      </Card>
    )
  }
  return <Wizard initial={start!} storageKey={key} />
}

function Wizard({ initial, storageKey }: { initial: { values: DefaultValues<Values>; step: number }; storageKey: string }) {
  const s = useSession()
  const navigate = useNavigate()
  const [step, setStep] = useState(initial.step)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const finished = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)
  const options = useRepo('imoveis:form-opcoes', listFormOptions)
  const form = useForm<Values>({ resolver: zodResolver(newPropertySchema), mode: 'onBlur', defaultValues: initial.values })
  const all = useWatch({ control: form.control })
  const dirty = form.formState.isDirty

  // Rascunho: grava 400 ms depois da última mudança (sem isso, cada tecla escreveria no disco).
  useEffect(() => {
    if (!dirty && step === initial.step) return
    const t = setTimeout(() => {
      if (finished.current) return // já cadastrou: não ressuscitar o rascunho apagado
      const at = new Date().toISOString()
      writeJSON(storageKey, { values: form.getValues(), step, savedAt: at } satisfies Draft)
      setSavedAt(at)
    }, 400)
    return () => clearTimeout(t)
  }, [all, step, dirty, storageKey, form, initial.step])

  // Ao trocar de etapa, o foco vai para o título dela (quem usa leitor de tela ouve onde está).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    heading.current?.focus()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  const save = useRepoMutation(createProperty, {
    success: (r) => `${r.property.name} cadastrado com ${plural(r.units, 'unidade', 'unidades')}.`,
    onSuccess: (r) => {
      finished.current = true
      writeJSON(storageKey, null)
      void navigate({ to: '/imoveis/$propertyId', params: { propertyId: r.property.id } })
    },
  })

  const next = async () => {
    if (step === 1 && !form.getValues('name').trim()) {
      const v = form.getValues()
      const name = suggestName(v.kind, v.address.street, v.address.number)
      if (name) form.setValue('name', name, { shouldDirty: true })
    }
    const ok = await form.trigger(STEP_FIELDS[step], { shouldFocus: true })
    if (ok) setStep(step + 1)
  }
  const submit = form.handleSubmit(
    (v) => save.mutate(v),
    (errors) => setStep(firstStepWithError(errors)),
  )

  return (
    <Card className="flex flex-col gap-6 p-4 sm:p-6">
      <Stepper steps={STEPS} current={step} />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          // Só o envio DESTE formulário conta: a janela "Cadastrar pessoa" (aberta por cima) tem o
          // próprio formulário, e o React propaga o evento pela árvore de componentes até aqui.
          if (e.target !== e.currentTarget) return
          if (step < STEPS.length - 1) void next()
          else void submit()
        }}
        className="flex flex-col gap-6"
      >
        {/* O título recebe o foco por código (não é clicável): sem contorno. O estilo vai inline porque a
            regra global de :focus-visible vence as classes do Tailwind. */}
        <div className="flex flex-col gap-1">
          <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold" style={{ outline: 'none' }}>
            {step + 1}. {STEPS[step]}
            {step === 4 && <span className="ml-2 text-sm font-normal text-faint">opcional</span>}
          </h2>
          {step < 5 && <RequiredLegend />}
        </div>
        {step === 0 && <StepKind form={form} />}
        {step === 1 && <StepAddress form={form} options={options.data} />}
        {step === 2 && <StepStructure form={form} />}
        {step === 3 && <StepOwners form={form} />}
        {step === 4 && <StepStaff form={form} />}
        {step === 5 && <StepReview form={form} options={options.data} goTo={setStep} />}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted" aria-live="polite">
            {savedAt ? `Rascunho salvo às ${formatDateTime(savedAt, s.org.timezone).slice(-5)}.` : 'O rascunho é salvo sozinho a cada mudança.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {step > 0 && (
              <Button onClick={() => setStep(step - 1)} icon={<ArrowLeft className="size-4" aria-hidden="true" />}>
                Voltar
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button variant="primary" type="submit">
                Próximo <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button variant="primary" type="submit" loading={save.isPending} loadingText="Cadastrando…" icon={<Check className="size-4" aria-hidden="true" />}>
                Cadastrar imóvel
              </Button>
            )}
          </div>
        </div>
      </form>
    </Card>
  )
}

/* ---------------------------------------------------------------- etapa 1: tipo */

function StepKind({ form }: { form: UseFormReturn<Values> }) {
  const err = form.formState.errors.kind?.message
  const reg = form.register('kind', {
    // Trocar o tipo refaz a estrutura com o padrão do tipo novo (casa não tem bloco; condomínio tem).
    onChange: (e: { target: { value: string } }) => {
      form.setValue('structure', structureDefaults(e.target.value as WizardKind), { shouldDirty: true })
      form.clearErrors('structure')
    },
  })
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[13px] font-medium">
        Tipo do imóvel<span className="text-danger" aria-hidden="true"> *</span>
      </legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {KIND_CARDS.map((k) => (
          <label
            key={k.kind}
            className="flex cursor-pointer gap-3 rounded-2xl border border-border bg-surface p-4 hover:border-border-strong has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]"
          >
            <input type="radio" value={k.kind} className="sr-only" {...reg} />
            <k.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">{k.title}</span>
              <span className="text-sm text-muted">{k.text}</span>
            </span>
          </label>
        ))}
      </div>
      {err && (
        <p className="text-sm font-medium text-danger-fg" role="alert">
          {err}
        </p>
      )}
      <p className="text-xs text-muted">Terreno ainda não entra pelo cadastro em etapas: no modelo, toda locação aponta uma unidade alugável.</p>
    </fieldset>
  )
}

/* ---------------------------------------------------------------- etapa 2: endereço */

function StepAddress({ form, options }: { form: UseFormReturn<Values>; options?: { portfolios: Option[]; managers: Option[] } }) {
  const s = useSession()
  const { register, formState, control } = form
  const [kind, street, number] = useWatch({ control, name: ['kind', 'address.street', 'address.number'] })
  const suggestion = suggestName(kind, street ?? '', number ?? '')
  return (
    <div className="flex flex-col gap-5">
      <FormField label="Nome do imóvel" required error={formState.errors.name?.message} hint={suggestion ? `Em branco, usamos "${suggestion}".` : 'Ex.: Residencial Jardim das Flores. Em branco, usamos o endereço.'}>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder={suggestion || undefined} {...register('name')} />}
      </FormField>
      <AddressFields form={form} />
      {/* ARMADILHA: o <select> só mostra o valor padrão se a opção já existir quando ele nasce.
          Por isso ele espera as opções chegarem (antes, um esqueleto ocupa o lugar). */}
      {(hasFeature(s, 'portfolios') || hasFeature(s, 'team')) && !options && <Skeleton className="h-16" />}
      {(hasFeature(s, 'portfolios') || hasFeature(s, 'team')) && options && (
        <div className="grid gap-4 sm:grid-cols-2">
          {hasFeature(s, 'portfolios') && (
            <FormField label="Carteira" optional hint="Agrupa imóveis e limita o acesso de colaboradores.">
              {({ id, describedBy }) => (
                <Select id={id} aria-describedby={describedBy} {...register('portfolio_id')}>
                  <option value="">Sem carteira</option>
                  {options.portfolios.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          {hasFeature(s, 'team') && (
            <FormField label="Responsável na equipe" optional hint="Quem da imobiliária cuida deste imóvel.">
              {({ id, describedBy }) => (
                <Select id={id} aria-describedby={describedBy} {...register('manager_user_id')}>
                  <option value="">Sem responsável</option>
                  {options.managers.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
        </div>
      )}
      <FormField label="Observações" optional error={formState.errors.notes?.message} hint="Portaria, áreas comuns, o que a equipe precisa saber.">
        {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} rows={3} {...register('notes')} />}
      </FormField>
    </div>
  )
}

/* ---------------------------------------------------------------- etapa 3: estrutura */

function StepStructure({ form }: { form: UseFormReturn<Values> }) {
  const { register, control, formState, setValue, clearErrors } = form
  const kind = useWatch({ control, name: 'kind' })
  const st = useWatch({ control, name: 'structure' })
  const e = formState.errors.structure
  const parsed = structureSchema.safeParse(st)
  const plan = parsed.success ? planStructure(parsed.data) : null
  const single = st.template === 'single'
  const rows = st.template === 'row_houses'

  const numField = (name: 'blocks' | 'floors' | 'unitsPerFloor' | 'startNumber', label: string, max: number, hint?: string) => (
    <FormField label={label} required error={e?.[name]?.message} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <Input id={id} type="number" inputMode="numeric" min={1} max={max} aria-describedby={describedBy} aria-invalid={invalid} {...register(`structure.${name}`, { valueAsNumber: true })} />
      )}
    </FormField>
  )
  const unitNum = (name: 'area_m2' | 'bedrooms' | 'bathrooms' | 'parking_spots', label: string, step = '1') => (
    <FormField label={label} required error={e?.unit?.[name]?.message}>
      {({ id, describedBy, invalid }) => <Input id={id} type="number" inputMode="decimal" min={0} step={step} aria-describedby={describedBy} aria-invalid={invalid} {...register(`structure.unit.${name}`, { valueAsNumber: true })} />}
    </FormField>
  )

  return (
    <div className="flex flex-col gap-6">
      {kind === 'condominium' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">
            Como é o condomínio<span className="text-danger" aria-hidden="true"> *</span>
          </legend>
          <div className="inline-flex w-full rounded-lg border border-border p-0.5 sm:w-auto sm:self-start" role="radiogroup" aria-label="Como é o condomínio">
            {TEMPLATES_BY_KIND.condominium.map((t) => (
              <label key={t} className={cn('flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-md px-4 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)] sm:flex-none', st.template === t ? 'bg-primary text-on-primary' : 'text-muted hover:text-text')}>
                <input
                  type="radio"
                  className="sr-only"
                  name="template"
                  value={t}
                  checked={st.template === t}
                  onChange={() => {
                    setValue('structure', t === 'row_houses' ? rowHousesDefaults() : structureDefaults('condominium'), { shouldDirty: true })
                    clearErrors('structure')
                  }}
                />
                {t === 'tower' ? 'Prédios com andares' : 'Casas em fila'}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {single ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{kind === 'apartment' ? 'Apartamento avulso' : 'Casa'} vira um imóvel com uma unidade só; é ela que o contrato de locação aponta.</p>
          <FormField label="Código da unidade" required error={e?.code?.message} hint="Como a unidade aparece nas listas, ex.: Casa, Apto 302." className="max-w-xs">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('structure.code')} />}
          </FormField>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {numField('blocks', rows ? 'Quadras' : 'Blocos', LIMITS.blocks, rows ? undefined : 'Com 2 ou mais, o código ganha a letra: A-101.')}
          {!rows && numField('floors', 'Andares por bloco', LIMITS.floors)}
          {numField('unitsPerFloor', rows ? 'Casas por quadra' : 'Unidades por andar', LIMITS.unitsPerFloor)}
          {numField('startNumber', rows ? 'Primeira casa' : 'Número inicial', 9999, rows ? 'Numeração seguida: Casa 1, Casa 2...' : '101 gera 101, 102... no 1º andar e 201, 202... no 2º.')}
        </div>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[13px] font-medium">{single ? 'Dados da unidade' : 'Padrão das unidades (cada uma se ajusta depois)'}</legend>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          <FormField label="Tipo" required error={e?.unit?.kind?.message} className="col-span-2">
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('structure.unit.kind')}>
                {UNIT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {UNIT_KIND[k]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {unitNum('area_m2', 'Área (m²)', '0.01')}
          {unitNum('bedrooms', 'Quartos')}
          {unitNum('bathrooms', 'Banheiros')}
          {unitNum('parking_spots', 'Vagas')}
          <FormField label="Aluguel pedido (R$)" optional error={e?.unit?.asking_rent?.message} hint="Valor de anúncio." className="col-span-2">
            {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" placeholder="1.900,00" aria-describedby={describedBy} aria-invalid={invalid} {...register('structure.unit.asking_rent')} />}
          </FormField>
        </div>
      </fieldset>

      <StructurePreview plan={plan} single={single} />
    </div>
  )
}

/** Prévia: quantas unidades, faixa de códigos e a grade do primeiro bloco (do andar mais alto ao térreo). */
function StructurePreview({ plan, single }: { plan: StructurePlan | null; single: boolean }) {
  if (!plan) {
    return <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted">Corrija os campos acima para ver a prévia dos códigos.</p>
  }
  const first = plan.blocks[0]
  const floors = first ? [...first.floors].reverse() : []
  const cut = floors.length > 8
  const shown = cut ? [...floors.slice(0, 4), null, ...floors.slice(-2)] : floors
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4" aria-label="Prévia da estrutura">
      <p className="text-sm">
        <strong>{plural(plan.total, 'unidade será criada', 'unidades serão criadas')}</strong>
        {!single && plan.blocks.length > 0 && ` em ${plural(plan.blocks.length, 'bloco', 'blocos')}`}: <span className="num">{codeRanges(plan)}</span>
      </p>
      {first && (
        <div className="overflow-x-auto">
          <p className="mb-1.5 text-xs font-medium text-muted">{first.name}</p>
          <div className="flex w-max flex-col gap-1">
            {shown.map((f, i) =>
              f ? (
                <div key={f.level} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-right text-[11px] text-muted">{f.label}</span>
                  <div className="flex gap-1">
                    {f.units.map((u) => (
                      <span key={u.code} className="num min-w-14 rounded-md border border-border bg-surface px-2 py-1 text-center text-xs">
                        {u.code}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p key={`corte-${i}`} className="pl-[72px] text-[11px] text-muted">
                  … mais {floors.length - 6} andares …
                </p>
              ),
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- etapa 4: proprietários */

function StepOwners({ form }: { form: UseFormReturn<Values> }) {
  const { field } = useController({ control: form.control, name: 'owners' })
  const err = form.formState.errors.owners
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-medium">
          Proprietários<span className="text-danger" aria-hidden="true"> *</span>
        </p>
        <p className="text-sm text-muted">Quem é dono e com que fatia. As fatias valem para todas as unidades do imóvel e precisam somar 100%.</p>
      </div>
      <OwnersEditor
        value={field.value}
        onChange={(v) => {
          field.onChange(v)
          // Já houve erro? Confere de novo a cada mudança, para a mensagem sumir assim que a soma fechar.
          if (form.formState.errors.owners) void form.trigger('owners')
        }}
        error={err?.root?.message ?? err?.message}
        rowErrors={field.value.map((_, i) => err?.[i]?.share_pct?.message ?? err?.[i]?.person_id?.message)}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- etapa 5: equipe do prédio (opcional) */

/** Papel sugerido para a próxima pessoa: o primeiro que ainda não está na lista (zelador, porteiro, síndico...). */
function nextRole(taken: string[]): (typeof STAFF_ROLES)[number] {
  const order = ['caretaker', 'doorman', 'syndic'] as const
  return order.find((r) => !taken.includes(r)) ?? 'other'
}

function StepStaff({ form }: { form: UseFormReturn<Values> }) {
  const s = useSession()
  const { control, register, setValue, getValues, formState } = form
  const { fields, append, remove } = useFieldArray({ control, name: 'staff' })
  const staff = useWatch({ control, name: 'staff' }) ?? []
  const errors = formState.errors.staff
  // Cada pessoa da equipe vira ficha em Pessoas: sem "editar pessoas", a etapa explica e deixa pular.
  if (!can(s, 'people:edit')) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted">
        <p>Cadastrar a equipe aqui cria fichas em Pessoas, e o seu papel não edita pessoas. Pule esta etapa: quem tem o acesso adiciona a equipe depois, no imóvel.</p>
        {/* Rascunho antigo (de quando o papel permitia) com pessoas na lista: sem isto, o cadastro ficaria preso na recusa. */}
        {fields.length > 0 && (
          <Button size="sm" className="self-start" onClick={() => remove()}>
            Tirar {fields.length === 1 ? 'a pessoa' : `as ${fields.length} pessoas`} da lista
          </Button>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Zelador, porteiro, síndico: quem trabalha no prédio ou responde por ele. Pode pular e adicionar depois, na aba Pessoas do imóvel.</p>
      {fields.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Equipe do prédio">
          {fields.map((f, i) => {
            const e = errors?.[i]
            return (
              <li key={f.id} className="flex flex-col gap-4 rounded-xl border border-border p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{staff[i]?.name?.trim() || `Pessoa ${i + 1}`}</p>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={() => remove(i)} aria-label={`Tirar ${staff[i]?.name?.trim() || `a pessoa ${i + 1}`} da lista`}>
                    Tirar
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <FormField label="Papel" required error={e?.role?.message}>
                    {({ id, describedBy, invalid }) => (
                      <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register(`staff.${i}.role`)}>
                        {STAFF_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {STAFF_ROLE[r]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField label="Nome" required error={e?.name?.message}>
                    {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="off" {...register(`staff.${i}.name`)} />}
                  </FormField>
                  <FormField label="Telefone" optional error={e?.phone?.message}>
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        type="tel"
                        aria-describedby={describedBy}
                        aria-invalid={invalid}
                        placeholder="(31) 99999-0000"
                        {...register(`staff.${i}.phone`, { onBlur: () => setValue(`staff.${i}.phone`, formatPhone(getValues(`staff.${i}.phone`))) })}
                      />
                    )}
                  </FormField>
                  <FormField label="Observação" optional error={e?.note?.message} hint="Turno ou ramal.">
                    {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} maxLength={120} {...register(`staff.${i}.note`)} />}
                  </FormField>
                </div>
                <PhotoField value={staff[i]?.photo} onChange={(v) => setValue(`staff.${i}.photo`, v, { shouldDirty: true })} />
              </li>
            )
          })}
        </ul>
      )}
      {errors?.root?.message && (
        <p className="text-sm font-medium text-danger-fg" role="alert">
          {errors.root.message}
        </p>
      )}
      {fields.length < 10 ? (
        <Button className="self-start" icon={<UserPlus className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={() => append({ role: nextRole(staff.map((m) => m.role)), name: '', phone: '', note: '', photo: null })}>
          {fields.length ? 'Adicionar outra pessoa' : 'Adicionar pessoa da equipe'}
        </Button>
      ) : (
        <p className="text-xs text-muted">Até 10 pessoas aqui; as outras se adicionam depois, na aba Pessoas do imóvel.</p>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- etapa 6: revisão */

function StepReview({ form, options, goTo }: { form: UseFormReturn<Values>; options?: { portfolios: Option[]; managers: Option[] }; goTo: (step: number) => void }) {
  const v = useWatch({ control: form.control }) as Values
  const parsed = structureSchema.safeParse(v.structure)
  const plan = parsed.success ? planStructure(parsed.data) : null
  const a = v.address
  const rent = v.structure.unit.asking_rent ? parseBRL(v.structure.unit.asking_rent) : null
  const change = (step: number) => (
    <Button size="sm" variant="ghost" onClick={() => goTo(step)}>
      Alterar
    </Button>
  )
  const block = (title: string, step: number, body: ReactNode) => (
    <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {change(step)}
      </div>
      {body}
    </section>
  )
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Confira antes de cadastrar. Depois, cada unidade se edita no detalhe do imóvel.</p>
      {block(
        'Imóvel',
        1,
        <DescriptionList
          items={[
            { label: 'Tipo', value: v.kind ? PROPERTY_KIND[v.kind] : '' },
            { label: 'Nome', value: v.name },
            { label: 'Endereço', value: `${a.street}, ${a.number}${a.complement ? ` (${a.complement})` : ''} · ${a.district} · ${a.city}/${a.state.toUpperCase()} · CEP ${formatCEP(a.cep)}` },
            ...(options?.portfolios.length ? [{ label: 'Carteira', value: options.portfolios.find((o) => o.value === v.portfolio_id)?.label ?? 'Sem carteira' }] : []),
            ...(options?.managers.length ? [{ label: 'Responsável', value: options.managers.find((o) => o.value === v.manager_user_id)?.label ?? 'Sem responsável' }] : []),
          ]}
        />,
      )}
      {block(
        'Estrutura',
        2,
        <DescriptionList
          items={[
            { label: 'Unidades', value: plan ? `${plan.total} · ${codeRanges(plan)}` : 'Estrutura com erro: volte e corrija' },
            { label: 'Tipo das unidades', value: UNIT_KIND[v.structure.unit.kind] },
            { label: 'Padrão', value: `${v.structure.unit.area_m2} m² · ${plural(v.structure.unit.bedrooms, 'quarto', 'quartos')} · ${plural(v.structure.unit.bathrooms, 'banheiro', 'banheiros')} · ${plural(v.structure.unit.parking_spots, 'vaga', 'vagas')}` },
            { label: 'Aluguel pedido', value: rent !== null ? formatBRL(rent) : '' },
          ]}
        />,
      )}
      {block(
        'Proprietários',
        3,
        v.owners.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {v.owners.map((o) => (
              <li key={o.person_id} className="flex justify-between gap-3">
                <span>{o.name}</span>
                <span className="num font-semibold">{formatPct(o.share_pct)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-danger-fg">Nenhum proprietário: volte e escolha pelo menos um.</p>
        ),
      )}
      {block(
        'Equipe do prédio',
        4,
        v.staff?.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {v.staff.map((m, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-3">
                <span>
                  {m.name} <span className="text-muted">· {STAFF_ROLE[m.role]}</span>
                </span>
                <span className="num text-muted">{m.phone ? formatPhone(m.phone) : 'sem telefone'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Ninguém por enquanto. Dá para adicionar depois, na aba Pessoas do imóvel.</p>
        ),
      )}
    </div>
  )
}
