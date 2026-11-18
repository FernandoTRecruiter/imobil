/* =============================================================================
   Campos de endereço com busca pelo CEP (cadastro em etapas e edição do imóvel).

   Ao completar os 8 números do CEP, a busca roda sozinha (ou pelo botão "Buscar"). Deu certo:
   preenche rua, bairro, cidade e UF e leva o cursor ao número. Deu errado (sem internet,
   serviço fora, CEP inexistente): diz o motivo e a pessoa segue digitando à mão, sem travar.

   Serve a qualquer formulário que tenha o campo "address" (por isso o tipo genérico T).
   ============================================================================= */
import { useId, useRef, useState } from 'react'
import type { FieldErrors, Path, PathValue, UseFormReturn } from 'react-hook-form'
import { CircleAlert, CircleCheck, LoaderCircle, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { cn } from '@/components/ui/cn'
import { formatCEP, onlyDigits } from '@/lib/documents'
import { CEP_FAIL_MESSAGE, lookupCep } from './cep'
import { FormField as Field } from './FormField'
import { UFS, type AddressInput } from './schemas'

type CepState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ok' } | { kind: 'fail'; message: string }

export function AddressFields<T extends { address: AddressInput }>({ form }: { form: UseFormReturn<T> }) {
  const [cep, setCep] = useState<CepState>({ kind: 'idle' })
  const statusId = useId()
  // Número da consulta mais recente: se a pessoa troca o CEP no meio da busca, a resposta
  // velha que chegar depois é descartada (senão preencheria o endereço do CEP anterior).
  const request = useRef(0)
  const lastDigits = useRef('')

  // Os caminhos "address.x" existem em T (o "extends" garante); o TypeScript não prova sozinho, daí o "as".
  const path = (k: keyof AddressInput) => `address.${k}` as Path<T>
  const errors = (form.formState.errors as FieldErrors<{ address: AddressInput }>).address
  const set = (k: keyof AddressInput, v: string) => form.setValue(path(k), v as PathValue<T, Path<T>>, { shouldValidate: true, shouldDirty: true })

  const search = async (raw: string, force = false) => {
    const digits = onlyDigits(raw)
    if (digits.length !== 8) {
      if (force) setCep({ kind: 'fail', message: CEP_FAIL_MESSAGE.invalid })
      return
    }
    if (digits === lastDigits.current && !force) return
    lastDigits.current = digits
    const mine = ++request.current
    setCep({ kind: 'loading' })
    const r = await lookupCep(digits)
    if (mine !== request.current) return
    if (!r.ok) {
      setCep({ kind: 'fail', message: CEP_FAIL_MESSAGE[r.reason] })
      return
    }
    if (r.street) set('street', r.street)
    if (r.district) set('district', r.district)
    set('city', r.city)
    set('state', r.state)
    set('cep', formatCEP(digits))
    setCep({ kind: 'ok' })
    form.setFocus(path(r.street ? 'number' : 'street'))
  }

  const cepField = form.register(path('cep'))

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
      <Field label="CEP" required className="sm:col-span-2" error={errors?.cep?.message}>
        {({ id, describedBy, invalid }) => (
          <div className="flex gap-2">
            <Input
              id={id}
              aria-describedby={[describedBy, statusId].filter(Boolean).join(' ')}
              aria-invalid={invalid}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="00000-000"
              maxLength={9}
              {...cepField}
              onChange={(e) => {
                // Primeiro o react-hook-form guarda o valor; depois, com 8 números, a busca roda sozinha.
                void cepField.onChange(e)
                if (onlyDigits(e.target.value).length === 8) void search(e.target.value)
              }}
            />
            <Button
              variant="secondary"
              className="px-3"
              aria-label="Buscar endereço pelo CEP"
              title="Buscar endereço pelo CEP"
              loading={cep.kind === 'loading'}
              loadingText=""
              icon={<Search className="size-4" aria-hidden="true" />}
              onClick={() => void search(String(form.getValues(path('cep')) ?? ''), true)}
            />
          </div>
        )}
      </Field>
      <p
        id={statusId}
        role="status"
        className={cn('flex items-start gap-1.5 self-end pb-2.5 text-xs sm:col-span-4', cep.kind === 'fail' ? 'text-warning-fg' : cep.kind === 'ok' ? 'text-success-fg' : 'text-muted')}
      >
        {cep.kind === 'loading' && <LoaderCircle className="mt-px size-3.5 shrink-0 animate-spin" aria-hidden="true" />}
        {cep.kind === 'ok' && <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />}
        {cep.kind === 'fail' && <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />}
        <span>
          {cep.kind === 'idle' && 'Digite o CEP: o endereço se preenche sozinho.'}
          {cep.kind === 'loading' && 'Buscando o endereço pelo CEP…'}
          {cep.kind === 'ok' && 'Endereço preenchido pelo CEP. Confira e complete o número.'}
          {cep.kind === 'fail' && cep.message}
        </span>
      </p>
      <Field label="Rua ou avenida" required className="sm:col-span-4" error={errors?.street?.message}>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="address-line1" {...form.register(path('street'))} />}
      </Field>
      <Field label="Número" required className="sm:col-span-2" error={errors?.number?.message}>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...form.register(path('number'))} />}
      </Field>
      <Field label="Complemento" optional className="sm:col-span-2" error={errors?.complement?.message} hint="Ex.: fundos, loja 2.">
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="address-line2" {...form.register(path('complement'))} />}
      </Field>
      <Field label="Bairro" required className="sm:col-span-4" error={errors?.district?.message}>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...form.register(path('district'))} />}
      </Field>
      <Field label="Cidade" required className="sm:col-span-4" error={errors?.city?.message}>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="address-level2" {...form.register(path('city'))} />}
      </Field>
      <Field label="UF" required className="sm:col-span-2" error={errors?.state?.message}>
        {({ id, describedBy, invalid }) => (
          <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="address-level1" {...form.register(path('state'))}>
            <option value="">Escolha</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  )
}
