/* Papéis da pessoa em selos: os que vêm das ligações (dono, locatário, fiador) e os declarados. */
import { Badge } from '@/components/ui/Badge'
import type { Tone } from '@/data/labels'
import type { PersonRole } from '@/data/views/contracts'

export const ROLE_LABEL: Record<PersonRole, string> = {
  owner: 'Proprietário', lessee: 'Inquilino', guarantor: 'Fiador', vendor: 'Prestador', contact: 'Contato', caretaker: 'Zelador', syndic: 'Síndico',
}

/** Ordem fixa dos selos (a mesma do filtro), para a tabela não "dançar" de linha para linha. */
export const ROLE_ORDER: PersonRole[] = ['owner', 'lessee', 'guarantor', 'vendor', 'syndic', 'caretaker', 'contact']

const ROLE_TONE: Record<PersonRole, Tone> = { owner: 'primary', lessee: 'success', guarantor: 'warning', vendor: 'orange', contact: 'neutral', caretaker: 'neutral', syndic: 'neutral' }

export function RoleBadges({ roles }: { roles: PersonRole[] }) {
  const list = ROLE_ORDER.filter((r) => roles.includes(r))
  if (!list.length) return <span className="text-xs text-muted">Sem papel</span>
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((r) => (
        <Badge key={r} tone={ROLE_TONE[r]}>
          {ROLE_LABEL[r]}
        </Badge>
      ))}
    </span>
  )
}
