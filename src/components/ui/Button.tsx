/* Botão único do app. "loading" desabilita e troca o texto, para não gravar duas vezes.
   Tamanho (07/11, "mais slim"): o médio tem 36 px no computador; a ação principal (primary) tem
   44 px no celular, o alvo de toque confortável para o dedo. Só cor e fundo mudam com transição. */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
type Size = 'sm' | 'md'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover shadow-card max-sm:min-h-11',
  secondary: 'bg-surface text-text border border-border hover:border-border-strong hover:bg-surface-2',
  ghost: 'text-text hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
  link: 'text-primary underline-offset-4 hover:underline px-0',
}
const SIZE: Record<Size, string> = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-9 px-3.5 text-sm gap-2' }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  loadingText?: string
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, loadingText = 'Salvando…', icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-[color,background-color,border-color,opacity] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-55',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : icon}
      {loading ? loadingText : children}
    </button>
  )
})
