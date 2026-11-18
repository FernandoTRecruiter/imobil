/* =============================================================================
   Caixa de saída de e-mail (dentro da aba Automações e comunicados, em Tarefas).

   Cada linha é um e-mail que o sistema mandou ou mandaria: renovação de contrato, pedido de
   manutenção aberto ou atualizado, rotina de manutenção, comunicado. Na fase 1 nada sai da
   máquina (situação "Simulado"); a lista existe para a equipe conferir PARA QUEM foi, O QUÊ e
   POR QUÊ, e abrir o texto. Na fase 2 a mesma lista mostra "Enviado" ou "Falhou".

   Mesma anatomia de toda lista: busca sem acento, filtro com contagem, ordenar pelo cabeçalho,
   "N de M", exportar o que está filtrado e escolhas lembradas.
   ============================================================================= */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useSession } from '@/auth/SessionProvider'
import { useRepo } from '@/data/hooks'
import { EMAIL_REASON } from '@/data/labels'
import type { EmailMessage } from '@/data/types'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatDateTime } from '@/lib/dates'
import { useListState } from '@/lib/useListState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Dialog } from '@/components/ui/Dialog'
import { DescriptionList, Section } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/States'
import { EMAIL_STATUS } from './outbox'
import { listOutbox, type OutboxRow } from './repo'

const REASONS = ['renewal', 'request_opened', 'request_update', 'routine_maintenance', 'announcement', 'charge_due', 'other'] as const satisfies readonly EmailMessage['reason'][]
const STATUS_TONE = { simulated: 'neutral', sent: 'success', failed: 'danger' } as const

export function OutboxSection() {
  const s = useSession()
  const list = useListState('caixa-de-saida')
  const q = useRepo('caixa-de-saida', (sess) => listOutbox(sess, list.params), [list.params])
  const [open, setOpen] = useState<OutboxRow | null>(null)

  const columns: Column<OutboxRow>[] = [
    {
      key: 'to_name', header: 'Para', sortable: true, firstDir: 'asc', hideBelow: 'sm',
      cell: (e) => (
        <span className="flex min-w-0 flex-col">
          <span className="max-w-48 truncate font-medium">{e.to_name}</span>
          <span className="max-w-48 truncate text-xs text-muted">{e.to_email}</span>
        </span>
      ),
    },
    {
      key: 'subject', header: 'Assunto', sortable: true, firstDir: 'asc',
      cell: (e) => (
        <span className="flex min-w-0 flex-col items-start">
          {/* Botão no assunto: quem usa teclado também abre o texto (o clique na linha é atalho do mouse). */}
          <button
            className="max-w-72 truncate text-left hover:text-primary hover:underline sm:max-w-96"
            onClick={(ev) => {
              ev.stopPropagation()
              setOpen(e)
            }}
          >
            {e.subject}
          </button>
          {/* No comunicado o assunto já diz o título: a segunda linha só aparece quando acrescenta (o código do contrato ou do chamado). */}
          {e.ref.kind !== 'announcement' && <span className="text-xs text-muted">{e.ref.label}</span>}
          {/* No celular a coluna Para some: quem recebe vem para cá, para a tabela caber sem rolar. */}
          <span className="max-w-64 truncate text-xs text-muted sm:hidden">Para {e.to_name}</span>
        </span>
      ),
    },
    { key: 'reason', header: 'Motivo', hideBelow: 'md', cell: (e) => <span className="whitespace-nowrap">{EMAIL_REASON[e.reason]}</span> },
    { key: 'created_at', header: 'Quando', sortable: true, firstDir: 'desc', hideBelow: 'sm', cell: (e) => <span className="whitespace-nowrap">{formatDateTime(e.created_at, s.org.timezone)}</span> },
    { key: 'status', header: 'Situação', hideBelow: 'lg', cell: (e) => <Badge tone={STATUS_TONE[e.status]}>{EMAIL_STATUS[e.status]}</Badge> },
  ]

  const exportList = async (format: ExportFormat) => {
    const all = await listOutbox(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable(
      'caixa-de-saida.csv',
      all.rows,
      [
        { label: 'Para', value: (e) => e.to_name },
        { label: 'E-mail', value: (e) => e.to_email },
        { label: 'Assunto', value: (e) => e.subject },
        { label: 'Motivo', value: (e) => EMAIL_REASON[e.reason] },
        { label: 'Referente a', value: (e) => e.ref.label },
        { label: 'Quando', value: (e) => formatDateTime(e.created_at, s.org.timezone) },
        { label: 'Situação', value: (e) => EMAIL_STATUS[e.status] },
      ],
      format,
    )
  }

  return (
    <Section
      title="Caixa de saída de e-mail"
      info='Na demonstração nada sai daqui: cada linha mostra o que seria enviado, para quem e por quê ("Simulado"). Com o envio ligado, a situação passa a ser Enviado ou Falhou.'
    >
      <div className="flex flex-col gap-3">
        <ListToolbar
          state={list}
          noun={['e-mail', 'e-mails']}
          total={q.data?.total}
          totalAll={q.data?.totalAll}
          facets={q.data?.facets}
          onExport={exportList}
          searchPlaceholder="Buscar pessoa, e-mail ou assunto"
          filters={[
            { key: 'motivo', label: 'Motivo', options: REASONS.map((v) => ({ value: v, label: EMAIL_REASON[v] })) },
            { key: 'situacao', label: 'Situação', options: (['simulated', 'sent', 'failed'] as const).map((v) => ({ value: v, label: EMAIL_STATUS[v] })) },
          ]}
        />
        <DataTable
          caption="Caixa de saída de e-mail"
          columns={columns}
          rows={q.data?.rows}
          rowKey={(e) => e.id}
          sort={list.sort}
          onSort={list.toggleSort}
          onRowClick={setOpen}
          loading={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={<EmptyState title="Nenhum e-mail encontrado" description={list.activeFilterCount ? 'Nenhum e-mail passa nos filtros ligados. Limpe os filtros para ver todos.' : 'Os e-mails das automações e dos comunicados aparecem aqui.'} />}
        />
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </div>
      {open && <EmailDialog email={open} onClose={() => setOpen(null)} />}
    </Section>
  )
}

/** O e-mail aberto: quem recebe, por quê, a que se refere e o texto inteiro. */
function EmailDialog({ email: e, onClose }: { email: OutboxRow; onClose: () => void }) {
  const s = useSession()
  const ref =
    e.ref.kind === 'contract' ? (
      <Link to="/contratos/$contractId" params={{ contractId: e.entity_id }} className="text-primary hover:underline">
        {e.ref.label}
      </Link>
    ) : e.ref.kind === 'request' ? (
      <Link to="/manutencao/$requestId" params={{ requestId: e.entity_id }} className="text-primary hover:underline">
        {e.ref.label}
      </Link>
    ) : (
      e.ref.label
    )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={e.subject} size="md" footer={<Button onClick={onClose}>Fechar</Button>}>
      <div className="flex flex-col gap-4">
        <DescriptionList
          items={[
            { label: 'Para', value: `${e.to_name} <${e.to_email}>` },
            { label: 'Motivo', value: EMAIL_REASON[e.reason] },
            { label: 'Quando', value: formatDateTime(e.created_at, s.org.timezone) },
            { label: 'Situação', value: <Badge tone={STATUS_TONE[e.status]}>{EMAIL_STATUS[e.status]}</Badge> },
            { label: 'Referente a', value: ref },
          ]}
        />
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Texto</p>
          <p className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{e.body}</p>
        </div>
      </div>
    </Dialog>
  )
}
