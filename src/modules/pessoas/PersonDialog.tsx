/* =============================================================================
   Janela de cadastro e edição de pessoa (física ou jurídica).

   Usada em três lugares: "Nova pessoa" (lista), "Editar" (detalhe) e "Cadastrar pessoa" no
   passo Proprietários do cadastro de imóvel. Por isso devolve a pessoa salva em onSaved:
   quem abriu decide o que fazer com ela (o assistente, por exemplo, já a põe como dona).

   O documento aceita CPF e CNPJ, inclusive o CNPJ novo com letras; o erro diz a causa
   ("Tem 10 caracteres: CPF tem 11...") e o repositório recusa documento repetido na conta.
   Quem é só equipe do prédio (zelador, síndico, contato) pode ficar sem CPF: o rótulo troca o *
   por "opcional" assim que esses papéis são marcados (mesma regra do repositório, documentOptional).

   Foto (opcional): reduzida no navegador para 160 px antes de entrar no formulário (foto.ts).

   Moradia e convivência (07/11/2026, opcionais): dependentes, animais de estimação, veículos e
   ocupação. Servem para a regra do prédio (animais, vaga) e o seguro; a finalidade está dita no
   próprio bloco, como pede a LGPD. Empresa só tem "Veículos" (a frota que usa a vaga).
   ============================================================================= */
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, Field, Input, Textarea } from '@/components/ui/Field'
import { cn } from '@/components/ui/cn'
import { useRepoMutation } from '@/data/hooks'
import { MAINTENANCE_CATEGORY, PERSON_TAG } from '@/data/labels'
import type { Person } from '@/data/types'
import { formatDocument, formatPhone } from '@/lib/documents'
import { FormField } from '@/modules/imoveis/FormField'
import { PhotoField } from './PhotoField'
import { createPerson, documentOptional, MAINTENANCE_CATEGORIES, PERSON_TAGS, personSchema, updatePerson, type PersonInput } from './repo'

const EMPTY: PersonInput = { kind: 'PF', name: '', document: '', email: '', phone: '', tags: [], vendor_categories: [], notes: '', photo: null, dependents: '', pets: '', vehicles: '', occupation: '' }

/** Número guardado para o texto do campo (vazio = não informado). */
const countText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

function toInput(p: Person): PersonInput {
  return {
    kind: p.kind, name: p.name, document: formatDocument(p.document), email: p.email, phone: formatPhone(p.phone),
    tags: p.tags, vendor_categories: p.vendor_categories, notes: p.notes, photo: p.photo ?? null,
    dependents: countText(p.dependents), pets: p.pets ?? '', vehicles: countText(p.vehicles), occupation: p.occupation ?? '',
  }
}

export function PersonDialog({ person, onClose, onSaved, title }: { person?: Person; onClose: () => void; onSaved?: (p: Person) => void; title?: string }) {
  const editing = !!person
  const form = useForm<PersonInput>({ resolver: zodResolver(personSchema), mode: 'onBlur', defaultValues: person ? toInput(person) : EMPTY })
  const { register, handleSubmit, formState, control, setValue, getValues } = form
  const kind = useWatch({ control, name: 'kind' })
  const tags = useWatch({ control, name: 'tags' }) ?? []
  const photo = useWatch({ control, name: 'photo' })
  const docOptional = documentOptional(tags)
  const done = (p: Person) => {
    onSaved?.(p)
    onClose()
  }
  const create = useRepoMutation(createPerson, { success: (p) => `${p.name} cadastrada.`, onSuccess: done })
  const update = useRepoMutation(updatePerson, { success: (p) => `Cadastro de ${p.name} atualizado.`, onSuccess: done })
  const saving = create.isPending || update.isPending
  const submit = handleSubmit((v) => (person ? update.mutate({ ...v, id: person.id }) : create.mutate(v)))
  const docLabel = kind === 'PJ' ? 'CNPJ' : 'CPF'

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title ?? (editing ? `Editar ${person.name}` : 'Nova pessoa')}
      description={editing ? undefined : 'Proprietário, inquilino, fiador e prestador usam o mesmo cadastro. O papel vem das ligações (imóvel, contrato).'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            {editing ? 'Salvar' : 'Cadastrar'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          // A janela pode abrir de dentro de outro formulário (o cadastro de imóvel): sem parar a
          // propagação, o Enter aqui também "enviaria" o formulário de trás.
          e.stopPropagation()
          void submit(e)
        }}
      >
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Tipo</legend>
          <div className="inline-flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Tipo de pessoa">
            {(['PF', 'PJ'] as const).map((k) => (
              <label
                key={k}
                className={cn(
                  'flex min-h-8 cursor-pointer items-center rounded-md px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)]',
                  kind === k ? 'bg-primary text-on-primary' : 'text-muted hover:text-text',
                )}
              >
                <input type="radio" value={k} className="sr-only" {...register('kind')} />
                {k === 'PF' ? 'Pessoa física' : 'Pessoa jurídica'}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={kind === 'PJ' ? 'Razão social' : 'Nome completo'} required error={formState.errors.name?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="name" {...register('name')} />}
        </Field>
        <FormField
          label={docLabel}
          required={!docOptional}
          optional={docOptional}
          error={formState.errors.document?.message}
          hint={docOptional ? 'Equipe do prédio pode ficar sem documento.' : kind === 'PJ' ? 'Aceita o CNPJ novo com letras (desde julho de 2026).' : 'Só números ou com pontuação, tanto faz.'}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              autoComplete="off"
              placeholder={kind === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
              {...register('document', { onBlur: () => setValue('document', formatDocument(getValues('document'))) })}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="E-mail" optional error={formState.errors.email?.message}>
            {({ id, describedBy, invalid }) => <Input id={id} type="email" aria-describedby={describedBy} aria-invalid={invalid} autoComplete="email" {...register('email')} />}
          </FormField>
          <FormField label="Telefone" optional error={formState.errors.phone?.message}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="tel" aria-describedby={describedBy} aria-invalid={invalid} autoComplete="tel" placeholder="(31) 99999-0000" {...register('phone', { onBlur: () => setValue('phone', formatPhone(getValues('phone'))) })} />
            )}
          </FormField>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-medium">Papéis declarados</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {PERSON_TAGS.map((t) => (
              <Checkbox key={t} label={PERSON_TAG[t]} value={t} {...register('tags')} />
            ))}
          </div>
          <p className="text-xs text-muted">Proprietário, inquilino e fiador não se marcam aqui: aparecem sozinhos quando a pessoa é ligada a um imóvel ou contrato.</p>
        </fieldset>
        {tags.includes('vendor') && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] font-medium">Serviços que o prestador faz</legend>
            <div className="grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
              {MAINTENANCE_CATEGORIES.map((c) => (
                <Checkbox key={c} label={MAINTENANCE_CATEGORY[c]} value={c} {...register('vendor_categories')} />
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[13px] font-medium">Moradia e convivência</legend>
          <p className="-mt-1 text-xs text-muted">Opcional. Usado para as regras do prédio (animais, vaga) e o seguro; só a equipe e a própria pessoa veem.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {kind === 'PF' && (
              <FormField label="Dependentes" optional error={formState.errors.dependents?.message} hint="Quem mora junto e depende dela.">
                {({ id, describedBy, invalid }) => <Input id={id} inputMode="numeric" className="w-24" aria-describedby={describedBy} aria-invalid={invalid} {...register('dependents')} />}
              </FormField>
            )}
            <FormField label="Veículos" optional error={formState.errors.vehicles?.message}>
              {({ id, describedBy, invalid }) => <Input id={id} inputMode="numeric" className="w-24" aria-describedby={describedBy} aria-invalid={invalid} {...register('vehicles')} />}
            </FormField>
            {kind === 'PF' && (
              <FormField label="Animais de estimação" optional error={formState.errors.pets?.message}>
                {({ id, describedBy, invalid }) => <Input id={id} placeholder="Ex.: 1 cachorro" aria-describedby={describedBy} aria-invalid={invalid} {...register('pets')} />}
              </FormField>
            )}
            {kind === 'PF' && (
              <FormField label="Ocupação" optional error={formState.errors.occupation?.message}>
                {({ id, describedBy, invalid }) => <Input id={id} autoComplete="organization-title" aria-describedby={describedBy} aria-invalid={invalid} {...register('occupation')} />}
              </FormField>
            )}
          </div>
        </fieldset>
        <PhotoField value={photo} onChange={(v) => setValue('photo', v, { shouldDirty: true })} />
        <FormField label="Observações" optional error={formState.errors.notes?.message}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} rows={3} {...register('notes')} />}
        </FormField>
      </form>
    </Dialog>
  )
}
