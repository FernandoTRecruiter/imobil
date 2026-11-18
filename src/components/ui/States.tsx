/* Estados que toda tela precisa: carregando, vazio (com ação), erro (com "Tentar de novo") e sem acesso. */
import type { ReactNode } from 'react'
import { CircleAlert, Inbox, Lock } from 'lucide-react'
import { Button } from './Button'
import { cn } from './cn'

export function Skeleton({ className }: { className?: string }) {
  // Parado: o carregamento aqui dura frações de segundo; um bloco que pulsa só chamaria atenção.
  return <div className={cn('rounded-lg bg-surface-2', className)} aria-hidden="true" />
}

/** Esqueleto de página: aparece no lugar do conteúdo enquanto os dados chegam. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Carregando">
      {/* As mesmas alturas da tela pronta (cabeçalho de uma linha, faixa de indicadores baixa): nada pula quando os dados chegam. */}
      <Skeleton className="h-7 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
      <Skeleton className="h-[clamp(320px,calc(100dvh-300px),760px)]" />
    </div>
  )
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-muted">{icon ?? <Inbox className="size-5" aria-hidden="true" />}</span>
      <p className="font-semibold">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Algo deu errado ao carregar.'
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center" role="alert">
      <span className="grid size-11 place-items-center rounded-full bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger-fg">
        <CircleAlert className="size-5" aria-hidden="true" />
      </span>
      <p className="font-semibold">Não deu para carregar</p>
      <p className="max-w-md text-sm text-muted">{message}</p>
      {onRetry && (
        <Button className="mt-2" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </div>
  )
}

export function NoAccess({ what = 'esta página' }: { what?: string }) {
  return (
    <EmptyState
      icon={<Lock className="size-5" aria-hidden="true" />}
      title="Sem acesso"
      description={`O seu papel nesta conta não dá acesso a ${what}. Quem administra a conta pode liberar em Configurações.`}
    />
  )
}
