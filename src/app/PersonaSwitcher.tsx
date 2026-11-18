/* "Ver como": troca a persona do modo de demonstração (no lugar do login). Mostra o que cada papel enxerga. */
import { DropdownMenu } from 'radix-ui'
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronDown, Eye } from 'lucide-react'
import { useSessionApi } from '@/auth/SessionProvider'
import { PERSONAS } from '@/data/seed'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/components/ui/cn'

export function PersonaSwitcher() {
  const { session, setPersona } = useSessionApi()
  const navigate = useNavigate()
  const current = PERSONAS.find((p) => p.userId === session.user.id)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-10 max-w-[min(320px,60vw)] items-center gap-2 rounded-lg border border-border bg-surface py-1 pr-3 pl-1.5 text-left hover:border-border-strong" aria-label="Ver como: trocar de persona">
          <Avatar name={session.user.full_name} color={session.user.avatar_color} size="sm" />
          <span className="hidden min-w-0 flex-col leading-tight sm:flex">
            <span className="truncate text-[13px] font-semibold">{session.user.full_name}</span>
            <span className="truncate text-[11px] text-muted">{current?.label ?? session.org.name}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-[min(360px,calc(100vw-32px))] rounded-2xl border border-border bg-surface p-2 shadow-pop">
          <DropdownMenu.Label className="flex items-center gap-2 px-2 pt-1 pb-2 text-xs text-faint">
            <Eye className="size-3.5" aria-hidden="true" /> Ver como (demonstração)
          </DropdownMenu.Label>
          {PERSONAS.map((p) => (
            <DropdownMenu.Item
              key={p.userId}
              onSelect={() => {
                setPersona(p.userId, p.orgId)
                void navigate({ to: ['owner', 'lessee', 'vendor'].includes(p.role) ? '/portal' : '/' })
              }}
              className={cn('flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 outline-none data-[highlighted]:bg-surface-2', p.userId === session.user.id && 'bg-primary-soft')}
            >
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center">{p.userId === session.user.id && <Check className="size-4 text-primary" aria-hidden="true" />}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">
                  {p.name} <span className="font-normal text-muted">· {p.label}</span>
                </span>
                <span className="block text-xs text-muted">{p.hint}</span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
