/* Porta da página: sem a permissão, mostra "Sem acesso" (o repositório recusaria do mesmo jeito). */
import type { ReactNode } from 'react'
import { useSession } from '@/auth/SessionProvider'
import { can, type Action } from '@/auth/permissions'
import { NoAccess } from '@/components/ui/States'

export function Guard({ action, what, children }: { action: Action; what?: string; children: ReactNode }) {
  const s = useSession()
  return can(s, action) ? <>{children}</> : <NoAccess what={what} />
}
