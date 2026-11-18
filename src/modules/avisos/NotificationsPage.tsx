/* Tela de avisos: o que o sistema avisou, do mais novo para o mais antigo. Clicar abre o registro. */
import { Link } from '@tanstack/react-router'
import { BellOff, CheckCheck } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { formatDateTime } from '@/lib/dates'
import { useListState } from '@/lib/useListState'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { listNotifications, markRead } from './repo'

export function NotificationsPage() {
  const list = useListState('avisos', { filters: { estado: [] } })
  const q = useRepo('avisos', (s) => listNotifications(s, list.params), [list.params])
  const read = useRepoMutation(markRead, { success: (n) => (n ? `${n} ${n === 1 ? 'aviso marcado' : 'avisos marcados'} como lido.` : 'Nada para marcar.') })
  return (
    <Guard action="notifications:view" what="os avisos">
      <PageHeader
        eyebrow="Avisos"
        title="O que pede a sua atenção"
        description="Avisos gerados pelas automações e pelas ações da equipe. Cada aviso aparece uma vez só."
        actions={
          <Button icon={<CheckCheck className="size-4" aria-hidden="true" />} loading={read.isPending} loadingText="Marcando…" onClick={() => read.mutate('all')}>
            Marcar todos como lidos
          </Button>
        }
      />
      <ListToolbar
        state={list}
        noun={['aviso', 'avisos']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        filters={[{ key: 'estado', label: 'Situação', options: [{ value: 'nao_lido', label: 'Não lidos' }, { value: 'lido', label: 'Lidos' }] }]}
      />
      <Card className="overflow-hidden">
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="flex flex-col gap-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : q.data.rows.length === 0 ? (
          <EmptyState icon={<BellOff className="size-5" aria-hidden="true" />} title="Nenhum aviso aqui" description="Quando um contrato estiver para vencer ou um orçamento esperar resposta, o aviso aparece nesta lista." />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.rows.map((n) => (
              <li key={n.id} className={cn('flex items-start gap-3 px-4 py-3', !n.read_at && 'bg-primary-soft/40')}>
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-primary')} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  {n.link ? (
                    <Link to={n.link} onClick={() => !n.read_at && read.mutate([n.id])} className="font-medium hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    <p className="font-medium">{n.title}</p>
                  )}
                  <p className="text-sm text-muted">{n.body}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatDateTime(n.created_at)}
                    {!n.read_at && <span className="sr-only"> · não lido</span>}
                  </p>
                </div>
                {!n.read_at && (
                  <Button size="sm" variant="ghost" onClick={() => read.mutate([n.id])}>
                    Marcar como lido
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
    </Guard>
  )
}
