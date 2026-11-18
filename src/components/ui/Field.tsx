/* =============================================================================
   Campos de formulário com rótulo visível, dica e erro ligados por aria-describedby
   (o leitor de tela lê o erro junto com o campo). Placeholder nunca substitui rótulo.
   ============================================================================= */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

const control =
  'rounded-lg border border-border bg-surface px-3 text-sm text-text transition-[border-color,box-shadow] duration-150 placeholder:text-muted/80 hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-2 aria-[invalid=true]:border-danger'

/**
 * Largura: ocupa a linha toda por padrão, a não ser que quem usa passe uma largura própria (w-40...).
 * Sem esta conta, "w-full" e "w-40" ficariam juntos e o CSS escolheria um deles pela ordem do arquivo,
 * não pela intenção de quem escreveu.
 */
function width(className?: string): string {
  return /(^|\s)(w-|max-w-|basis-)/.test(className ?? '') ? '' : 'w-full'
}

/** Altura: 36 px por padrão (a mesma do botão médio, 07/11 "mais slim"); quem passa h-8, h-10... manda. Mesma conta da largura. */
function height(className?: string): string {
  return /(^|\s)h-/.test(className ?? '') ? '' : 'h-9'
}

export interface FieldProps {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  className?: string
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/** Moldura do campo: rótulo + controle + dica + erro com causa e conserto. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-text">
        {label}
        {required && <span className="text-danger" aria-hidden="true"> *</span>}
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

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, width(className), height(className), className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, width(className), 'min-h-24 py-2', className)} {...rest} />
})

/** Select nativo: acessível por teclado e no celular sem biblioteca nenhuma. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(control, width(className), height(className), 'pr-8', className)} {...rest}>
      {children}
    </select>
  )
})

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('inline-flex min-h-6 cursor-pointer items-center gap-2 text-sm', className)}>
      <input type="checkbox" className="size-4 rounded border-border accent-[var(--primary)]" {...rest} />
      <span>{label}</span>
    </label>
  )
}
