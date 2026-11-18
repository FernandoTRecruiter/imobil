/* =============================================================================
   Configurações > Carteiras e situações (seção abaixo das carteiras; na conta de proprietário,
   a aba inteira, com o nome "Situações e cores"): rótulo e cor de cada situação da unidade (mapa,
   espelho e legenda). A prévia mostra o selo como o mapa desenha: cor cheia com o número
   em branco. Por isso o aviso de contraste é contra o BRANCO, com o mínimo de 3:1 que a
   WCAG pede para forma e texto grande. Contraste baixo avisa, não trava.
   ============================================================================= */
import { useState } from 'react'
import { useSession } from '@/auth/SessionProvider'
import { applyAppearance } from '@/data/appearance'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { getDb } from '@/data/store'
import { UNIT_STATUS } from '@/data/labels'
import type { UnitStatus, UnitStatusConfig } from '@/data/types'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Layout'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { listStatusConfig, saveStatusConfig } from './repo'
import { ContrastNote } from './Contraste'

const HEX = /^#[0-9a-fA-F]{6}$/

export function SituacoesTab() {
  const q = useRepo('config:situacoes', listStatusConfig)
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-96" />
  return <StatusForm key={q.data.map((r) => `${r.label}:${r.color}`).join('|')} rows={q.data} />
}

function StatusForm({ rows }: { rows: UnitStatusConfig[] }) {
  const [draft, setDraft] = useState(() => rows.map((r) => ({ status: r.status, label: r.label, color: r.color })))
  const s = useSession()
  const save = useRepoMutation(saveStatusConfig, {
    success: (n) => `${n} ${n === 1 ? 'situação salva' : 'situações salvas'}.`,
    // Aplica na hora no app inteiro (selos, espelho, mapa), sem precisar recarregar a página.
    onSuccess: () => applyAppearance(getDb(), s.org.id),
  })
  const set = (status: UnitStatus, patch: Partial<{ label: string; color: string }>) => setDraft(draft.map((d) => (d.status === status ? { ...d, ...patch } : d)))
  const dirty = draft.some((d, i) => d.label !== rows[i].label || d.color.toLowerCase() !== rows[i].color.toLowerCase())
  const invalid = draft.some((d) => !HEX.test(d.color) || d.label.trim().length < 2)
  return (
    <Section
      title="Situações das unidades"
      info="Ocupada vem do contrato vigente; as outras são escolhidas à mão na unidade. Aqui muda só o nome e a cor que a tela mostra."
      actions={
        dirty && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setDraft(rows.map((r) => ({ status: r.status, label: r.label, color: r.color })))}>
              Descartar
            </Button>
            <Button size="sm" variant="primary" disabled={invalid} loading={save.isPending} onClick={() => save.mutate(draft)}>
              Salvar
            </Button>
          </>
        )
      }
    >
      <ul className="flex flex-col divide-y divide-border">
        {draft.map((d, i) => {
          const okColor = HEX.test(d.color) ? d.color : rows[i].color
          const labelId = `situacao-${d.status}`
          return (
            <li key={d.status} className="grid gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-center">
              <span className="text-sm font-semibold" id={labelId}>
                {UNIT_STATUS[d.status]}
                {d.status === 'occupied' && <span className="block text-xs font-normal text-muted">vem do contrato</span>}
              </span>
              <label className="flex flex-col gap-1 text-[13px] font-medium">
                Rótulo na tela
                <input
                  className={cn('h-10 rounded-lg border bg-surface px-3 text-sm font-normal focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none', d.label.trim().length < 2 ? 'border-danger' : 'border-border')}
                  value={d.label}
                  maxLength={30}
                  aria-invalid={d.label.trim().length < 2}
                  onChange={(e) => set(d.status, { label: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-[13px] font-medium">
                Cor
                <span className="flex items-center gap-2">
                  <input type="color" aria-label={`Escolher a cor de ${UNIT_STATUS[d.status]}`} className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1" value={okColor.toLowerCase()} onChange={(e) => set(d.status, { color: e.target.value })} />
                  <input
                    className={cn('h-10 w-full min-w-0 rounded-lg border bg-surface px-3 font-mono text-sm font-normal uppercase focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none', HEX.test(d.color) ? 'border-border' : 'border-danger')}
                    value={d.color}
                    maxLength={7}
                    aria-label={`Código da cor de ${UNIT_STATUS[d.status]}`}
                    aria-invalid={!HEX.test(d.color)}
                    onChange={(e) => set(d.status, { color: e.target.value })}
                  />
                </span>
              </label>
              <div className="flex flex-col gap-1.5" aria-labelledby={labelId}>
                <span className="flex flex-wrap items-center gap-2">
                  {/* Selo do mapa: cor cheia com número em branco (é aqui que o contraste conta). */}
                  <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold text-white" style={{ background: okColor }}>
                    <span className="num">12</span> {d.label || UNIT_STATUS[d.status]}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: `color-mix(in srgb, ${okColor} 14%, transparent)`, color: `color-mix(in srgb, ${okColor} 65%, black)` }}>
                    <span className="size-1.5 rounded-full" style={{ background: okColor }} aria-hidden="true" />
                    {d.label || UNIT_STATUS[d.status]}
                  </span>
                </span>
                <ContrastNote color={okColor} min={3} />
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
