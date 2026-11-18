/* =============================================================================
   FilterSelect: o seletor dos filtros da Visão geral e dos Relatórios.

   Por que <select> nativo: funciona no teclado e no celular sem biblioteca, e o leitor de
   tela já sabe ler. A contagem vai no texto da opção ("Residencial Acácias (64)"), recontada
   pelos outros filtros no repositório: o número é o que aparece ao escolher.
   Armadilha que o "min-w-0" evita: um select com opção longa alarga a página inteira no celular.
   "compact" (Visão geral, onde o mapa é o destaque): rótulo menor e apagado, campo mais
   estreito e, a partir de 1280 px, o rótulo AO LADO do campo (07/11, "mais slim": a barra de
   filtros vira uma linha de 36 px). Sem ele, o desenho de sempre (Relatórios não muda).
   ============================================================================= */
import { useId } from 'react'
import { Field, Select } from '@/components/ui/Field'

export interface SelectOption {
  value: string
  label: string
  /** Sem contagem: a opção aparece sem número (ex.: período). */
  count?: number
}

interface Props {
  label: string
  value: string
  onChange: (v: string) => void
  options?: SelectOption[]
  all?: string
  compact?: boolean
}

function Options({ options, value, all }: Pick<Props, 'options' | 'value' | 'all'>) {
  return (
    <>
      {all !== undefined && <option value="">{all}</option>}
      {(options ?? []).map((o) =>
        // Opção sem unidade no recorte dos outros filtros some, menos a que já está escolhida.
        o.count === 0 && o.value !== value ? null : (
          <option key={o.value} value={o.value}>
            {o.count === undefined ? o.label : `${o.label} (${o.count})`}
          </option>
        ),
      )}
    </>
  )
}

export function FilterSelect({ label, value, onChange, options, all, compact }: Props) {
  const id = useId()
  if (compact) {
    return (
      <div className="flex min-w-0 flex-col gap-1 xl:flex-row xl:items-center xl:gap-2">
        <label htmlFor={id} className="shrink-0 text-xs text-muted">
          {label}
        </label>
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="max-w-full truncate xl:w-44">
          <Options options={options} value={value} all={all} />
        </Select>
      </div>
    )
  }
  return (
    <Field label={label} className="min-w-0 sm:w-52">
      {({ id: fieldId }) => (
        <Select id={fieldId} value={value} onChange={(e) => onChange(e.target.value)} className="max-w-full truncate">
          <Options options={options} value={value} all={all} />
        </Select>
      )}
    </Field>
  )
}
