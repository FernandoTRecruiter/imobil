/* =============================================================================
   Lotes.tsx: "Importações anteriores" (lista de lotes) e a janela de "Desfazer importação".

   O desfazer mostra ANTES de gravar o que vai sumir (quantos imóveis, unidades e pessoas) e,
   se algum registro do lote já foi usado (contrato, chamado, lançamento, dono ligado depois),
   a lista do que impede. O repositório recusa do mesmo jeito (RuleError): a janela só adianta
   a resposta para a pessoa não clicar à toa.
   ============================================================================= */
import { useState } from 'react'
import { Download, TriangleAlert, Undo2 } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { downloadText, toCsv } from '@/lib/csv'
import { downloadTable } from '@/lib/exportar'
import { formatDateTime } from '@/lib/dates'
import { plural } from '@/lib/text'
import { useListState } from '@/lib/useListState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Dialog } from '@/components/ui/Dialog'
import { Section } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { IMPORT_KIND_LABEL } from './campos'
import { listBatches, previewUndo, undoImport, type BatchRow } from './importacao'

const LEVEL_PT = { error: 'Erro', warning: 'Aviso' } as const

/** Baixa as mensagens guardadas no lote (erros e avisos por linha). */
export function downloadBatchErrors(b: Pick<BatchRow, 'file_name' | 'errors'>): void {
  downloadText(
    `erros-${b.file_name.replace(/\.[^.]+$/, '')}.csv`,
    toCsv(b.errors, [
      { label: 'Linha', value: (e) => e.row },
      { label: 'Nível', value: (e) => LEVEL_PT[e.level] },
      { label: 'Coluna', value: (e) => e.column },
      { label: 'Mensagem', value: (e) => e.message },
    ]),
  )
}

export function BatchesSection() {
  const s = useSession()
  const list = useListState('dados:lotes', { sort: null })
  const q = useRepo('importar:lotes', (sess) => listBatches(sess, list.params), [list.params])
  const [undoing, setUndoing] = useState<BatchRow | null>(null)

  const columns: Column<BatchRow>[] = [
    {
      key: 'file_name', header: 'Arquivo', sortable: true, firstDir: 'asc',
      cell: (b) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{b.file_name}</span>
          <span className="text-xs text-muted">{b.kind_label}</span>
        </span>
      ),
    },
    { key: 'created_at', header: 'Quando', sortable: true, firstDir: 'desc', hideBelow: 'sm', cell: (b) => <span className="num whitespace-nowrap">{formatDateTime(b.created_at, s.org.timezone)}</span> },
    { key: 'who', header: 'Quem', sortable: true, firstDir: 'asc', hideBelow: 'md', cell: (b) => b.who },
    {
      key: 'rows_total', header: 'Linhas', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md',
      cell: (b) => (
        <span className="num whitespace-nowrap" title={`${b.rows_ok} sem aviso, ${b.rows_warning} com aviso, ${b.rows_error} com erro`}>
          {b.rows_total} <span className="text-xs text-muted">({b.rows_error} com erro)</span>
        </span>
      ),
    },
    {
      key: 'state', header: 'Situação',
      cell: (b) => (b.undone_at ? <Badge tone="neutral">Desfeito em {formatDateTime(b.undone_at, s.org.timezone).slice(0, 10)}</Badge> : <Badge tone="success">{plural(b.alive, 'registro ativo', 'registros ativos')}</Badge>),
    },
    {
      key: 'acoes', header: '', className: 'w-px',
      cell: (b) => (
        <span className="flex justify-end gap-1">
          {b.errors.length > 0 && (
            <Button size="sm" variant="ghost" icon={<Download className="size-4" aria-hidden="true" />} onClick={() => downloadBatchErrors(b)} aria-label={`Baixar mensagens de ${b.file_name}`}>
              <span className="hidden sm:inline">Mensagens</span>
            </Button>
          )}
          {!b.undone_at && (
            <Button size="sm" icon={<Undo2 className="size-4" aria-hidden="true" />} onClick={() => setUndoing(b)} aria-label={`Desfazer a importação de ${b.file_name}`}>
              <span className="hidden sm:inline">Desfazer</span>
            </Button>
          )}
        </span>
      ),
    },
  ]

  return (
    <Section title="Importações anteriores" info="Cada importação vira um lote. Desfazer apaga o que o lote criou e devolve o que ele atualizou, desde que nada do lote tenha sido usado depois.">
      <div className="flex flex-col gap-3">
        <ListToolbar
          state={list}
          noun={['importação', 'importações']}
          total={q.data?.total}
          totalAll={q.data?.totalAll}
          facets={q.data?.facets}
          searchPlaceholder="Buscar por arquivo ou pessoa"
          filters={[
            { key: 'entity', label: 'Tipo', options: Object.entries(IMPORT_KIND_LABEL).map(([value, label]) => ({ value, label })) },
            { key: 'state', label: 'Situação', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'desfeito', label: 'Desfeito' }] },
          ]}
          onExport={async (format) => {
            const all = await listBatches(s, { ...list.params, page: 1, pageSize: 100_000 })
            await downloadTable(
              'importacoes',
              all.rows,
              [
                { label: 'Arquivo', value: (b) => b.file_name },
                { label: 'Tipo', value: (b) => b.kind_label },
                { label: 'Quando', value: (b) => formatDateTime(b.created_at, s.org.timezone) },
                { label: 'Quem', value: (b) => b.who },
                { label: 'Linhas', value: (b) => b.rows_total },
                { label: 'Sem aviso', value: (b) => b.rows_ok },
                { label: 'Com aviso', value: (b) => b.rows_warning },
                { label: 'Com erro', value: (b) => b.rows_error },
                { label: 'Desfeito em', value: (b) => (b.undone_at ? formatDateTime(b.undone_at, s.org.timezone) : '') },
              ],
              format,
            )
          }}
        />
        <DataTable
          caption="Importações anteriores"
          columns={columns}
          rows={q.data?.rows}
          rowKey={(b) => b.id}
          sort={list.sort}
          onSort={list.toggleSort}
          loading={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={<EmptyState title="Nenhuma importação ainda" description={list.activeFilterCount ? 'Nada passa nos filtros ligados.' : 'As planilhas importadas aparecem aqui, com o desfazer.'} />}
        />
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </div>
      {undoing && <UndoDialog batchId={undoing.id} fileName={undoing.file_name} onClose={() => setUndoing(null)} />}
    </Section>
  )
}

/** Janela do desfazer: o que some, o que volta e, se houver, o que impede (com o motivo). */
export function UndoDialog({ batchId, fileName, onClose, onDone }: { batchId: string; fileName: string; onClose: () => void; onDone?: () => void }) {
  const pre = useRepo('importar:previa-desfazer', (s) => previewUndo(s, batchId), [batchId])
  const undo = useRepoMutation(undoImport, {
    success: (p) => `Importação de ${p.fileName} desfeita.`,
    onSuccess: () => {
      onDone?.()
      onClose()
    },
  })
  const p = pre.data
  const blocked = !!p && p.blockers.length > 0
  const parts = p
    ? [
        p.created.properties && plural(p.created.properties, 'imóvel', 'imóveis'),
        p.created.units && plural(p.created.units, 'unidade', 'unidades'),
        p.created.people && plural(p.created.people, 'pessoa', 'pessoas'),
      ].filter(Boolean)
    : []
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Desfazer importação"
      description={fileName}
      footer={
        <>
          <Button onClick={onClose}>{blocked ? 'Fechar' : 'Cancelar'}</Button>
          {p && !blocked && (
            <Button variant="danger" icon={<Undo2 className="size-4" aria-hidden="true" />} loading={undo.isPending} loadingText="Desfazendo…" onClick={() => undo.mutate(batchId)}>
              Desfazer
            </Button>
          )}
        </>
      }
    >
      {pre.isPending ? (
        <Skeleton className="h-24" />
      ) : pre.error ? (
        <ErrorState error={pre.error} onRetry={() => pre.refetch()} />
      ) : blocked ? (
        <div className="flex flex-col gap-3 text-sm" role="alert">
          <p className="flex items-start gap-2 font-semibold text-danger-fg">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Não dá para desfazer: {p.blockers.length === 1 ? 'um registro do lote já foi usado' : `${p.blockers.length} registros do lote já foram usados`} depois da importação.
          </p>
          <ul className="max-h-64 list-disc overflow-y-auto pl-5 text-text">
            {p.blockers.slice(0, 30).map((b) => (
              <li key={b}>{b}</li>
            ))}
            {p.blockers.length > 30 && <li className="text-muted">e mais {p.blockers.length - 30}</li>}
          </ul>
          <p className="text-muted">O desfazer só apaga o que ninguém usou. Para corrigir esses registros, use o Data Manager ou a tela de cada um.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            {parts.length ? (
              <>
                {/* Concordância: só pessoas ou só unidades = feminino; com imóvel no meio = masculino. */}
                Remove <strong>{parts.join(', ')}</strong> criad{p!.created.properties ? 'o' : 'a'}
                {p!.created.properties + p!.created.units + p!.created.people > 1 ? 's' : ''} por este lote
              </>
            ) : (
              'Este lote não criou registros'
            )}
            {p!.created.owners > 0 && <>, com {plural(p!.created.owners, 'ligação de proprietário', 'ligações de proprietário')}</>}.
          </p>
          {p!.updated > 0 && <p>Devolve o valor de antes de {plural(p!.updated, 'registro atualizado', 'registros atualizados')} pela importação.</p>}
          <p className="text-muted">O lote continua na lista como "desfeito", e a auditoria guarda o que foi feito.</p>
        </div>
      )}
    </Dialog>
  )
}
