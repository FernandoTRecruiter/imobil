/* =============================================================================
   FormField: o mesmo campo do components/ui/Field (rótulo visível, dica, erro ligado por
   aria-describedby), com uma coisa a mais: "opcional" em texto quieto ao lado do rótulo.

   Por que existe: no cadastro de imóvel a pessoa precisa saber, antes de tentar avançar, o que
   é obrigatório (*) e o que pode ficar em branco ("opcional"). O Field compartilhado só tem o *.
   atalho: cópia local do Field para não mexer no componente compartilhado enquanto outros módulos
   estão em obra; quando der, passar a prop "optional" para o Field e apagar este arquivo.
   ============================================================================= */
import { useId, type ReactNode } from 'react'
import { cn } from '@/components/ui/cn'

export interface FormFieldProps {
  label: string
  hint?: string
  error?: string | null
  /** Mostra o * vermelho (obrigatório). */
  required?: boolean
  /** Mostra "opcional" em cinza ao lado do rótulo. */
  optional?: boolean
  className?: string
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

export function FormField({ label, hint, error, required, optional, className, children }: FormFieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-text">
        {label}
        {/* O * fica escondido do leitor de tela, como no Field compartilhado: quem avisa o que falta é o erro do campo. */}
        {required && <span className="text-danger" aria-hidden="true"> *</span>}
        {optional && <span className="ml-1.5 font-normal text-faint">opcional</span>}
      </label>
      {children({ id, describedBy: [hintId, errId].filter(Boolean).join(' ') || undefined, invalid: !!error })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs font-medium text-danger-fg" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** Legenda de topo de formulário: diz uma vez o que o * e o "opcional" querem dizer. */
export function RequiredLegend() {
  return (
    <p className="text-xs text-muted">
      <span className="text-danger" aria-hidden="true">*</span> obrigatório · os campos marcados <span className="text-faint">opcional</span> podem ficar em branco
    </p>
  )
}
