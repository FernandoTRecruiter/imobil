/* =============================================================================
   Aba Modelos: as etapas de cada tipo de processo, em ordem.
   Quem edita processos inclui, remove e reordena etapas e muda prazo, quem faz e aprovação.
   Com processo em andamento, as etapas que já existem não saem nem trocam de lugar (o processo
   guarda só o NÚMERO da etapa atual): os botões ficam desligados e a regra explica por quê.
   ============================================================================= */
import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can } from '@/auth/permissions'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { ROLE } from '@/data/labels'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select } from '@/components/ui/Field'
import { Card } from '@/components/ui/Layout'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { listTemplates, saveTemplate, STEP_ROLES, type TemplateInput, type TemplateRow } from './repo'

export function TemplatesTab() {
  const q = useRepo('modelos', listTemplates)
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data)
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
    )
  if (!q.data.length) return <EmptyState title="Nenhum modelo de processo" description="Os modelos de renovação, cobrança e locação aparecem aqui." />
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {q.data.map((t) => (
        <TemplateCard key={t.id} template={t} />
      ))}
    </div>
  )
}

function TemplateCard({ template: t }: { template: TemplateRow }) {
  const s = useSession()
  const [editing, setEditing] = useState(false)
  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t.name}</h3>
          <p className="text-xs text-muted">
            {t.steps.length} {t.steps.length === 1 ? 'etapa' : 'etapas'} · {t.running ? `${t.running} em andamento` : 'nenhum em andamento'}
          </p>
        </div>
        {can(s, 'workflows:edit') && !editing && (
          <Button size="sm" icon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditing(true)}>
            Editar etapas
          </Button>
        )}
      </div>
      {editing ? (
        <TemplateEditor key={t.updated_at} template={t} onDone={() => setEditing(false)} />
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {t.steps.map((st, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold ring-1 ring-border">{i + 1}</span>
              <span className="min-w-0 flex-1 basis-40 font-medium">{st.title}</span>
              <span className="text-xs text-muted">
                {ROLE[st.role]} · {st.sla_days} {st.sla_days === 1 ? 'dia' : 'dias'}
              </span>
              {st.requires_approval && <Badge tone="warning">Exige aprovação</Badge>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

type Draft = TemplateInput['steps'][number]

/**
 * Edição local das etapas. Cada etapa guarda "from" (a posição que tinha antes): é assim que o
 * repositório descobre se alguma etapa antiga saiu ou mudou de lugar.
 */
function TemplateEditor({ template: t, onDone }: { template: TemplateRow; onDone: () => void }) {
  const [name, setName] = useState(t.name)
  const [steps, setSteps] = useState<Draft[]>(() => t.steps.map((st, i) => ({ ...st, from: i })))
  const save = useRepoMutation(saveTemplate, { success: `Modelo "${t.name}" salvo.`, onSuccess: onDone })
  const locked = t.running > 0 // com processo em andamento, etapa antiga não sai nem muda de lugar

  const set = (i: number, patch: Partial<Draft>) => setSteps((list) => list.map((st, k) => (k === i ? { ...st, ...patch } : st)))
  const move = (i: number, dir: -1 | 1) =>
    setSteps((list) => {
      const next = [...list]
      const [st] = next.splice(i, 1)
      next.splice(i + dir, 0, st)
      return next
    })
  /** Pode mexer na posição? Etapa nova sempre; antiga só sem processo em andamento. */
  const movable = (st: Draft) => !locked || st.from === null

  return (
    <div className="flex flex-col gap-3 p-4">
      <label className="flex flex-col gap-1.5 text-[13px] font-medium">
        Nome do modelo
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {locked && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          {t.running} {t.running === 1 ? 'processo está' : 'processos estão'} em andamento com este modelo: dá para mudar nome, prazo, quem faz e aprovação das etapas e incluir etapas no fim. Remover ou trocar de lugar fica para quando não houver processo em andamento.
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {steps.map((st, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold ring-1 ring-border">{i + 1}</span>
              <label className="min-w-0 flex-1">
                <span className="sr-only">Nome da etapa {i + 1}</span>
                <Input value={st.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="Nome da etapa" />
              </label>
              <IconBtn label={`Subir a etapa ${i + 1}`} disabled={i === 0 || !movable(st) || !movable(steps[i - 1])} onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" aria-hidden="true" />
              </IconBtn>
              <IconBtn label={`Descer a etapa ${i + 1}`} disabled={i === steps.length - 1 || !movable(st) || !movable(steps[i + 1])} onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" aria-hidden="true" />
              </IconBtn>
              <IconBtn label={`Remover a etapa ${i + 1}`} disabled={steps.length === 1 || !movable(st)} onClick={() => setSteps((list) => list.filter((_, k) => k !== i))}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconBtn>
            </div>
            <div className="flex flex-wrap items-center gap-3 pl-8">
              <label className="flex items-center gap-2 text-xs text-muted">
                Quem faz
                <span className="block w-40">
                  <Select value={st.role} onChange={(e) => set(i, { role: e.target.value as Draft['role'] })} className="text-sm text-text">
                    {STEP_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE[r]}
                      </option>
                    ))}
                  </Select>
                </span>
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">
                Prazo (dias)
                <span className="block w-20">
                  <Input type="number" min={1} max={365} inputMode="numeric" value={Number.isFinite(st.sla_days) ? st.sla_days : ''} onChange={(e) => set(i, { sla_days: e.target.value === '' ? Number.NaN : Number(e.target.value) })} className="text-sm text-text" />
                </span>
              </label>
              <Checkbox label="Exige aprovação" checked={st.requires_approval} onChange={(e) => set(i, { requires_approval: e.target.checked })} />
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setSteps((list) => [...list, { title: '', role: 'staff', sla_days: 3, requires_approval: false, from: null }])}>
          Incluir etapa
        </Button>
        <div className="flex gap-2">
          <Button size="sm" onClick={onDone}>
            Cancelar
          </Button>
          <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate({ id: t.id, name, steps })}>
            Salvar modelo
          </Button>
        </div>
      </div>
    </div>
  )
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-35" aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}
