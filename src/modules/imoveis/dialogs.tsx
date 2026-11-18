/* =============================================================================
   Janelas de edição do módulo Imóveis: dados do imóvel, dados da unidade e fatias dos donos.
   Todas seguem a regra de formulário da casa: react-hook-form + zod (o mesmo esquema que o
   repositório usa), erro no campo com causa e conserto, botão com "Salvando…" contra clique duplo.
   ============================================================================= */
import { useController, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useSession } from '@/auth/SessionProvider'
import { hasFeature } from '@/auth/permissions'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/States'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { UNIT_KIND, UNIT_STATUS } from '@/data/labels'
import type { PropertyRow, UnitRow } from '@/data/views/units'
import { formatCEP } from '@/lib/documents'
import { AddressFields } from './AddressFields'
import { FormField } from './FormField'
import { OwnersEditor } from './OwnersEditor'
import { listFormOptions, setPropertyOwners, updateProperty, updateUnit, type OwnerShareRow } from './repo'
import { MANUAL_STATUSES, ownersEditSchema, propertyEditSchema, UNIT_KINDS, unitEditSchema, type OwnersEditInput, type PropertyEditInput, type UnitEditInput } from './schemas'

/** Centavos para o texto do campo de valor: 190000 -> "1.900,00". */
export function centsToInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/* ---------------------------------------------------------------- imóvel */

export function EditPropertyDialog({ property, onClose }: { property: PropertyRow; onClose: () => void }) {
  const s = useSession()
  const options = useRepo('imoveis:form-opcoes', listFormOptions)
  const form = useForm<PropertyEditInput>({
    resolver: zodResolver(propertyEditSchema),
    mode: 'onBlur',
    defaultValues: {
      id: property.id, name: property.name, address: { ...property.address, cep: formatCEP(property.address.cep) },
      portfolio_id: property.portfolio_id ?? '', manager_user_id: property.manager_user_id ?? '', notes: property.notes,
    },
  })
  const { register, handleSubmit, formState } = form
  const save = useRepoMutation(updateProperty, { success: 'Dados do imóvel atualizados.', onSuccess: onClose })
  const submit = handleSubmit((v) => save.mutate(v))
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Editar dados do imóvel"
      description="Tipo e estrutura (blocos, andares) não mudam por aqui; as unidades se editam uma a uma."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label="Nome do imóvel" required error={formState.errors.name?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('name')} />}
        </Field>
        <AddressFields form={form} />
        {/* O <select> só mostra o valor atual se a opção existir quando ele nasce: espera as opções. */}
        {(hasFeature(s, 'portfolios') || hasFeature(s, 'team')) && !options.data && <Skeleton className="h-16" />}
        {(hasFeature(s, 'portfolios') || hasFeature(s, 'team')) && options.data && (
          <div className="grid gap-4 sm:grid-cols-2">
            {hasFeature(s, 'portfolios') && (
              <FormField label="Carteira" optional hint="Agrupa imóveis e limita o acesso de colaboradores.">
                {({ id, describedBy }) => (
                  <Select id={id} aria-describedby={describedBy} {...register('portfolio_id')}>
                    <option value="">Sem carteira</option>
                    {options.data.portfolios.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            )}
            {hasFeature(s, 'team') && (
              <FormField label="Responsável na equipe" optional>
                {({ id, describedBy }) => (
                  <Select id={id} aria-describedby={describedBy} {...register('manager_user_id')}>
                    <option value="">Sem responsável</option>
                    {options.data.managers.map((o) => (
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
        <FormField label="Observações" optional error={formState.errors.notes?.message}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} rows={3} {...register('notes')} />}
        </FormField>
      </form>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- unidade */

export function EditUnitDialog({ unit, onClose }: { unit: UnitRow; onClose: () => void }) {
  const occupied = unit.status === 'occupied'
  const form = useForm<UnitEditInput>({
    resolver: zodResolver(unitEditSchema),
    mode: 'onBlur',
    defaultValues: {
      id: unit.id, code: unit.code, kind: unit.kind, area_m2: unit.area_m2, bedrooms: unit.bedrooms, bathrooms: unit.bathrooms,
      parking_spots: unit.parking_spots, features: unit.features.join(', '), asking_rent: centsToInput(unit.asking_rent_cents),
      manual_status: unit.manual_status, notes: unit.notes,
    },
  })
  const { register, handleSubmit, formState } = form
  const e = formState.errors
  const save = useRepoMutation(updateUnit, { success: (u) => `Unidade ${u.code} atualizada.`, onSuccess: onClose })
  const submit = handleSubmit((v) => save.mutate(v))
  const num = (name: 'area_m2' | 'bedrooms' | 'bathrooms' | 'parking_spots', label: string, step = '1') => (
    <Field label={label} required error={e[name]?.message}>
      {({ id, describedBy, invalid }) => <Input id={id} type="number" inputMode="decimal" min={0} step={step} aria-describedby={describedBy} aria-invalid={invalid} {...register(name, { valueAsNumber: true })} />}
    </Field>
  )
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Editar unidade ${unit.code}`}
      description={unit.label}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Código" required error={e.code?.message} hint="Único dentro do imóvel.">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('code')} />}
          </Field>
          <Field label="Tipo" required error={e.kind?.message}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('kind')}>
                {UNIT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {UNIT_KIND[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Situação"
            error={e.manual_status?.message}
            hint={occupied ? `Ocupada vem do contrato vigente${unit.lease ? ` ${unit.lease.code}` : ''}: a escolha à mão volta a valer quando ele acabar.` : 'Ocupada não se escolhe: vem do contrato vigente.'}
          >
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} disabled={occupied} {...register('manual_status')}>
                {MANUAL_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {UNIT_STATUS[st]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {num('area_m2', 'Área (m²)', '0.01')}
          {num('bedrooms', 'Quartos')}
          {num('bathrooms', 'Banheiros')}
          {num('parking_spots', 'Vagas')}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Aluguel pedido (R$)" error={e.asking_rent?.message} hint="Valor de anúncio. O aluguel de verdade fica no contrato.">
            {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" placeholder="1.900,00" aria-describedby={describedBy} aria-invalid={invalid} {...register('asking_rent')} />}
          </Field>
          <Field label="Características" error={e.features?.message} hint="Separadas por vírgula: varanda, suíte, vista livre.">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('features')} />}
          </Field>
        </div>
        <Field label="Observações" error={e.notes?.message}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} rows={3} {...register('notes')} />}
        </Field>
      </form>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- fatias dos donos do imóvel inteiro */

export function OwnersDialog({ propertyId, propertyName, current, onClose }: { propertyId: string; propertyName: string; current: OwnerShareRow[]; onClose: () => void }) {
  const form = useForm<OwnersEditInput>({
    resolver: zodResolver(ownersEditSchema),
    mode: 'onBlur',
    defaultValues: { property_id: propertyId, owners: current.map((o) => ({ person_id: o.person_id, name: o.name, share_pct: o.share_pct })) },
  })
  const { field } = useController({ control: form.control, name: 'owners' })
  const ownersErr = form.formState.errors.owners
  const save = useRepoMutation(setPropertyOwners, { success: 'Proprietários atualizados.', onSuccess: onClose })
  const submit = form.handleSubmit((v) => save.mutate(v))
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Proprietários do imóvel inteiro"
      description={`${propertyName}. A fatia antiga fica guardada até ontem; a nova vale a partir de hoje (os repasses antigos não mudam).`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Salvar fatias
          </Button>
        </>
      }
    >
      <OwnersEditor
        value={field.value}
        onChange={(v) => {
          field.onChange(v)
          if (form.formState.isSubmitted) void form.trigger('owners')
        }}
        error={ownersErr?.root?.message ?? ownersErr?.message}
        rowErrors={field.value.map((_, i) => ownersErr?.[i]?.share_pct?.message ?? ownersErr?.[i]?.person_id?.message)}
      />
    </Dialog>
  )
}
