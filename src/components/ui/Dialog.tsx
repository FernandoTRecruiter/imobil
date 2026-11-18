/* =============================================================================
   Janela (Radix Dialog): fecha no Esc e no X, prende o Tab dentro e devolve o foco a quem
   abriu. É por isso que usamos a Radix: fazer isso à mão é onde a acessibilidade quebra.
   Movimento (07/11): o fundo escurece em 180 ms e a janela cresce de 98% enquanto aparece. Só a
   entrada anima: fechar é imediato (quem fechou já decidiu, esperar a saída só atrasa).
   ============================================================================= */
import type { ReactNode } from 'react'
import { Dialog as R } from 'radix-ui'
import { X } from 'lucide-react'
import { Button } from './Button'
import { cn } from './cn'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const SIZE = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md' }: DialogProps) {
  return (
    <R.Root open={open} onOpenChange={onOpenChange}>
      <R.Portal>
        <R.Overlay className="fixed inset-0 z-50 animate-fade-in bg-slate-950/40" />
        <R.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[min(90vh,900px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 animate-pop-in flex-col rounded-2xl border border-border bg-surface shadow-pop',
            SIZE[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <R.Title className="text-base font-semibold">{title}</R.Title>
              {description ? <R.Description className="mt-0.5 text-sm text-muted">{description}</R.Description> : <R.Description className="sr-only">{title}</R.Description>}
            </div>
            <R.Close asChild>
              <button className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text" aria-label="Fechar">
                <X className="size-4" aria-hidden="true" />
              </button>
            </R.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </R.Content>
      </R.Portal>
    </R.Root>
  )
}

/** Confirmação de ação que apaga ou muda algo importante: diz o NOME do que vai mudar. */
export function ConfirmDialog(props: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      size="sm"
      footer={
        <>
          <Button onClick={() => props.onOpenChange(false)}>Cancelar</Button>
          <Button variant={props.danger ? 'danger' : 'primary'} loading={props.loading} onClick={props.onConfirm}>
            {props.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-text">{props.message}</div>
    </Dialog>
  )
}
