/* =============================================================================
   PropertyTimeline: a linha do tempo única do imóvel na tela (dados em timeline.ts).

   Mora na aba de histórico do detalhe do imóvel: filtro por fonte com a contagem de cada uma
   (Cadastro e equipe, Contratos, Chamados, Comunicados, E-mails) e "Mostrar mais".
   Filtro e corte acontecem no repositório, para a contagem e a lista nunca discordarem.
   ============================================================================= */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useSession } from '@/auth/SessionProvider'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { Timeline } from '@/components/ui/Layout'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { useRepo } from '@/data/hooks'
import { formatDate, formatDateTime } from '@/lib/dates'
import { propertyTimeline, TIMELINE_KIND_LABEL, TIMELINE_PAGE, type TimelineItem, type TimelineKind } from './timeline'

const KINDS = Object.keys(TIMELINE_KIND_LABEL) as TimelineKind[]

export function PropertyTimeline({ propertyId }: { propertyId: string }) {
  const s = useSession()
  const [kind, setKind] = useState<TimelineKind | null>(null)
  const [limit, setLimit] = useState(TIMELINE_PAGE)
  const q = useRepo('imoveis:linha-do-tempo', (sess) => propertyTimeline(sess, propertyId, { kind, limit }), [propertyId, kind, limit])

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Carregando o histórico">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    )
  }
  const d = q.data
  const all = KINDS.reduce((a, k) => a + d.counts[k], 0)
  const when = (it: TimelineItem) => `${it.dateOnly ? formatDate(it.at) : formatDateTime(it.at, s.org.timezone)} · ${TIMELINE_KIND_LABEL[it.kind]}`
  const items = d.items.map((it) => ({
    id: it.id,
    when: when(it),
    who: it.who ?? undefined,
    title: it.link ? (
      <Link to={it.link} className="hover:underline">
        {it.title}
      </Link>
    ) : (
      it.title
    ),
    detail: it.detail.length ? (
      <ul className="flex flex-col">
        {it.detail.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    ) : undefined,
  }))
  const pick = (k: TimelineKind | null) => {
    setKind(k)
    setLimit(TIMELINE_PAGE) // trocar de fonte volta para a primeira página
  }

  return (
    <div className="flex flex-col gap-4">
      {all > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar o histórico por fonte">
          <Chip on={kind === null} onClick={() => pick(null)} label="Tudo" count={all} />
          {KINDS.filter((k) => d.counts[k] > 0).map((k) => (
            <Chip key={k} on={kind === k} onClick={() => pick(kind === k ? null : k)} label={TIMELINE_KIND_LABEL[k]} count={d.counts[k]} />
          ))}
        </div>
      )}
      <div aria-busy={q.isFetching || undefined} className={cn(q.isPlaceholderData && 'opacity-60')}>
        <Timeline items={items} empty="Nada registrado ainda." />
      </div>
      {d.total > d.items.length && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => setLimit(limit + TIMELINE_PAGE)} loading={q.isFetching} loadingText="Carregando…">
            Mostrar mais
          </Button>
          <span className="num text-xs text-muted">
            {d.items.length.toLocaleString('pt-BR')} de {d.total.toLocaleString('pt-BR')}
          </span>
        </div>
      )}
    </div>
  )
}

/** Botão de filtro com contagem: borda fina, ligado = degrau de superfície (cromo quieto). */
function Chip({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium', on ? 'border-border-strong bg-surface-2 text-text' : 'border-border bg-surface text-muted hover:border-border-strong hover:text-text')}
    >
      {label}
      <span className="num text-faint">{count.toLocaleString('pt-BR')}</span>
    </button>
  )
}
