/* =============================================================================
   PersonPicker: escolher uma pessoa já cadastrada (locatário, fiador, contraparte de lançamento).

   Por que não um <select>: a imobiliária tem centenas de pessoas; rolar uma lista de 300 nomes
   é lento e no celular é pior. Aqui a pessoa digita parte do nome ou do documento e escolhe
   entre poucos resultados (a busca roda no repositório, como rodará no banco).
   ============================================================================= */
import { useEffect, useState } from 'react'
import { UserRound, X } from 'lucide-react'
import { useRepo } from '@/data/hooks'
import { listPeople } from '@/data/views/contracts'
import type { Id } from '@/data/types'
import { maskDocument } from '@/lib/documents'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { cn } from '@/components/ui/cn'

export interface PickedPerson {
  id: Id
  name: string
  document: string
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'proprietário', lessee: 'locatário', guarantor: 'fiador', vendor: 'prestador', contact: 'contato', caretaker: 'zelador', syndic: 'síndico',
}

export function PersonPicker({
  label, value, onChange, error, hint, excludeIds = [], required,
}: {
  label: string
  value: PickedPerson | null
  onChange: (p: PickedPerson | null) => void
  error?: string
  hint?: string
  excludeIds?: Id[]
  required?: boolean
}) {
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  // Espera 200 ms depois da última tecla (na fase 2, uma consulta por pausa e não por letra).
  // Documento digitado com pontuação ("123.456.789-09") vira só dígitos: é assim que o banco guarda.
  useEffect(() => {
    const t = setTimeout(() => setSearch(/^[\d.\-/\s]+$/.test(input) ? input.replace(/\D/g, '') : input), 200)
    return () => clearTimeout(t)
  }, [input])
  const q = useRepo('contratos:pessoas', (s) => listPeople(s, { search, pageSize: 6 }), [search], { enabled: !value && search.trim().length >= 2 })
  const rows = (q.data?.rows ?? []).filter((p) => !excludeIds.includes(p.id))

  if (value) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-[13px] font-medium">{label}</p>
        <div className="flex items-center gap-3 rounded-xl border border-primary bg-primary-soft px-3 py-2">
          <UserRound className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{value.name}</span>
            <span className="block text-xs text-muted">{maskDocument(value.document)}</span>
          </span>
          <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden="true" />} onClick={() => onChange(null)}>
            Trocar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Field label={label} hint={hint ?? 'Digite pelo menos 2 letras do nome, ou o CPF/CNPJ.'} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <div className="flex flex-col gap-2">
          <input
            id={id}
            type="search"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Nome, CPF ou CNPJ"
            autoComplete="off"
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none aria-[invalid=true]:border-danger"
          />
          {search.trim().length >= 2 && (
            <ul className={cn('flex flex-col gap-1', q.isFetching && 'opacity-60')} aria-label={`Resultados para ${label.toLowerCase()}`}>
              {rows.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onChange({ id: p.id, name: p.name, document: p.document })}
                    className="flex min-h-10 w-full items-center gap-3 rounded-lg border border-border px-3 py-1.5 text-left hover:border-primary hover:bg-primary-soft"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {maskDocument(p.document)}
                        {p.roles.length > 0 && ` · ${p.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ')}`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {!q.isFetching && rows.length === 0 && <li className="px-1 text-sm text-muted">Ninguém encontrado com "{search}". Confira o nome ou cadastre uma pessoa nova.</li>}
            </ul>
          )}
        </div>
      )}
    </Field>
  )
}
