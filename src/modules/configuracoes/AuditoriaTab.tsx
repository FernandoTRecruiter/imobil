/* =============================================================================
   Configurações > Auditoria: tudo o que mudou na conta, quem mudou e quando, com o antes e
   o depois. Filtros por o quê (entidade), ação, quem e período; busca; exportar CSV.
   Só o administrador vê (o antes e o depois pode ter dado pessoal: seção G do plano).
   ============================================================================= */
import { useState } from 'react'
import { useSession } from '@/auth/SessionProvider'
import { useRepo } from '@/data/hooks'
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
import { AUDIT_ACTION_LABEL } from './auditoria'
import { listAudit, PERIODS, type AuditRow } from './repo'

const ACTION_TONE = { create: 'success', update: 'primary', archive: 'danger', restore: 'success', status: 'warning', approve: 'success', payment: 'success', import: 'primary', undo: 'orange' } as const

export function AuditoriaTab() {
  const s = useSession()
  const list = useListState('config:auditoria', { sort: { key: 'at', dir: 'desc' } })
  const q = useRepo('config:auditoria', (sess) => listAudit(sess, list.params), [list.params])
  const [open, setOpen] = useState<AuditRow | null>(null)
  const when = (r: AuditRow) => formatDateTime(r.at, s.org.timezone)

  const columns: Column<AuditRow>[] = [
    { key: 'at', header: 'Quando', sortable: true, firstDir: 'desc', cell: (r) => <span className="num whitespace-nowrap">{when(r)}</span> },
    { key: 'who', header: 'Quem', sortable: true, firstDir: 'asc', hideBelow: 'sm', cell: (r) => r.who },
    { key: 'entity', header: 'O quê', sortable: true, firstDir: 'asc', hideBelow: 'md', cell: (r) => r.entity_label },
    { key: 'action', header: 'Ação', cell: (r) => <Badge tone={ACTION_TONE[r.action]}>{r.action_label}</Badge> },
    { key: 'summary', header: 'Resumo', cell: (r) => <span className="line-clamp-2 min-w-48 [overflow-wrap:anywhere]" title={r.summary}>{r.summary}</span> },
    {
      key: 'detalhe', header: '', className: 'w-px',
      cell: (r) => (
        <Button size="sm" variant="ghost" onClick={() => setOpen(r)} aria-label={`Ver o detalhe de: ${r.summary}`}>
          {r.changes ? 'Mudanças' : 'Detalhe'}
        </Button>
      ),
    },
  ]

  const exportList = async (format: ExportFormat) => {
    const all = await listAudit(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable(
      'auditoria.csv',
      all.rows,
      [
        { label: 'Quando', value: (r) => when(r) },
        { label: 'Quem', value: (r) => r.who },
        { label: 'O quê', value: (r) => r.entity_label },
        { label: 'Registro', value: (r) => r.entity_id },
        { label: 'Ação', value: (r) => r.action_label },
        { label: 'Resumo', value: (r) => r.summary },
        { label: 'Mudanças', value: (r) => r.changes_text },
      ],
      format,
    )
  }

  return (
    <Section title="Auditoria" info="Cada gravação deixa uma linha aqui: quem, quando, o quê, e o valor de antes e de depois. A lista só cresce: nada é apagado.">
      <div className="flex flex-col gap-3">
        <ListToolbar
          state={list}
          noun={['registro', 'registros']}
          total={q.data?.total}
          totalAll={q.data?.totalAll}
          facets={q.data?.facets}
          onExport={exportList}
          searchPlaceholder="Buscar no resumo, em quem ou nas mudanças"
          filters={[
            { key: 'entity', label: 'O quê', options: q.data?.entities ?? [] },
            { key: 'action', label: 'Ação', options: Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({ value, label })) },
            { key: 'actor', label: 'Quem', options: q.data?.actors ?? [] },
            { key: 'period', label: 'Período', options: PERIODS },
          ]}
        />
        <DataTable
          caption="Auditoria da conta"
          columns={columns}
          rows={q.data?.rows}
          rowKey={(r) => r.id}
          sort={list.sort}
          onSort={list.toggleSort}
          loading={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={<EmptyState title="Nenhum registro encontrado" description={list.activeFilterCount ? 'Nada passa nos filtros ligados. Limpe os filtros para ver tudo.' : 'As mudanças feitas na conta aparecem aqui.'} />}
        />
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </div>
      {open && <AuditDetail row={open} when={when(open)} onClose={() => setOpen(null)} />}
    </Section>
  )
}

/** Detalhe de uma linha: quem, quando, o quê e a tabela "campo · antes · depois". */
function AuditDetail({ row, when, onClose }: { row: AuditRow; when: string; onClose: () => void }) {
  const s = useSession()
  const lines = row.change_lines
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={row.summary} description={`${row.action_label} · ${row.entity_label}`} size="lg">
      <div className="flex flex-col gap-4">
        <DescriptionList
          items={[
            { label: 'Quando', value: when },
            { label: 'Quem', value: row.who },
            { label: 'O quê', value: row.entity_label },
            { label: 'Registro', value: <span className="font-mono text-xs">{row.entity_id}</span> },
          ]}
        />
        {lines.length > 0 ? (
          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Antes e depois</caption>
              <thead>
                <tr>
                  {['Campo', 'Antes', 'Depois'].map((h) => (
                    <th key={h} scope="col" className="border-b border-border bg-surface-2 px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-muted uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.field} className="bg-surface">
                    <th scope="row" className="border-b border-border px-3 py-2 text-left font-medium">
                      {l.label}
                    </th>
                    <td className="border-b border-border px-3 py-2 text-muted [overflow-wrap:anywhere]">{l.from}</td>
                    <td className="border-b border-border px-3 py-2 [overflow-wrap:anywhere]">{l.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">Esta ação não guardou antes e depois (criação, importação ou ação sem campo alterado).</p>
        )}
        <p className="text-xs text-muted">Fuso da conta: {s.org.timezone}.</p>
      </div>
    </Dialog>
  )
}
