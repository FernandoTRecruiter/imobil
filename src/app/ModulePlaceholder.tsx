/* Página provisória de um módulo que ainda vai ser construído (some quando o módulo chega). */
import type { Action } from '@/auth/permissions'
import { Guard } from './Guard'
import { Card, PageHeader } from '@/components/ui/Layout'

export function ModulePlaceholder({ eyebrow, title, stage, items, action }: { eyebrow: string; title: string; stage: string; items: string[]; action: Action }) {
  return (
    <Guard action={action}>
      <PageHeader eyebrow={eyebrow} title={title} />
      <Card className="p-6">
        <p className="text-sm text-muted">Esta tela entra na etapa {stage} do template. Vai ter:</p>
        <ul className="mt-3 list-disc pl-5 text-sm">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </Card>
    </Guard>
  )
}
