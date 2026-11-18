/* =============================================================================
   Repasses: o que a imobiliária paga a cada proprietário por mês.
   Anatomia única (cabeçalho -> indicadores -> barra de lista -> tabela) + o demonstrativo numa
   janela (as linhas que formam o mês do dono, com a fatia e a taxa de cada uma).

   Só existe em conta de imobiliária (hasFeature 'transfers'). Na conta da proprietária
   independente a tela explica por quê, em vez de mostrar uma lista vazia sem motivo.
   A regra do cálculo está em repasses.ts.
   ============================================================================= */
import { useState } from 'react'
import { DropdownMenu } from 'radix-ui'
import { ArrowLeft, Calculator, Check, Ellipsis, FileSpreadsheet, HandCoins } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, hasFeature, isPortal } from '@/auth/permissions'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { csvMoney } from '@/lib/csv'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { addMonths, formatDate, formatDateTime, formatMonth, monthStart } from '@/lib/dates'
import { formatBRL, formatBRLShort } from '@/lib/money'
import { normalize } from '@/lib/text'
import { useListState } from '@/lib/useListState'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog'
import { InfoTip } from '@/components/ui/InfoTip'
import { Card, PageHeader } from '@/components/ui/Layout'
import { ExportMenu } from '@/components/ui/ExportMenu'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { approveTransfer, getTransferStatement, listTransfers, markTransferPaid, recalcTransferDrafts, type TransferRow, type TransferStatement } from './repasses'
import { FilterKpi, formatPct, LinkButton, TRANSFER_STATUS_LABEL, TransferStatusBadge } from './ui'

export function TransfersPage() {
  const s = useSession()
  // O inquilino tem finance:view (as cobranças dele), mas repasse é assunto do proprietário e da equipe.
  const allowed = !isPortal(s) || s.roles.includes('owner')
  return (
    <Guard action="finance:view" what="os repasses">
      {!hasFeature(s, 'transfers') ? (
        <NotForLandlord />
      ) : allowed ? (
        <TransfersScreen />
      ) : (
        <EmptyState title="Sem acesso" description="Repasse é o que a imobiliária paga ao proprietário. O portal do inquilino mostra as suas cobranças em Financeiro." />
      )}
    </Guard>
  )
}

/** Conta de proprietário independente: não há imobiliária no meio, então não há repasse. */
function NotForLandlord() {
  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Repasses" />
      <Card>
        <EmptyState
          title="Repasse só existe com imobiliária"
          description="Repasse é quando uma imobiliária recebe o aluguel, desconta a taxa de administração e as despesas e paga o resto ao proprietário. Na sua conta o aluguel entra direto para você: acompanhe o que recebe em Financeiro."
          action={<LinkButton to="/financeiro" variant="primary">Ir para Financeiro</LinkButton>}
        />
      </Card>
    </>
  )
}

function TransfersScreen() {
  const s = useSession()
  const team = !isPortal(s)
  const canRecalc = team && can(s, 'finance:edit')
  const canApprove = team && can(s, 'transfers:approve')
  const canPay = team && can(s, 'finance:edit')
  const list = useListState('repasses')
  const q = useRepo('repasses', (sess) => listTransfers(sess, list.params), [list.params])
  const [statement, setStatement] = useState<TransferRow | null>(null)
  const [approving, setApproving] = useState<TransferRow | null>(null)
  const [paying, setPaying] = useState<TransferRow | null>(null)
  const recalc = useRepoMutation(recalcTransferDrafts, {
    success: (r) => (r.changed ? `${r.changed} ${r.changed === 1 ? 'rascunho atualizado' : 'rascunhos atualizados'} (${r.months.map(formatMonth).join(', ')}).` : 'Rascunhos conferidos: nada mudou desde o último cálculo.'),
  })
  const approve = useRepoMutation(approveTransfer, { success: (t) => `Repasse de ${formatMonth(t.month)} aprovado: a conta a pagar foi criada.`, onSuccess: () => setApproving(null) })
  const pay = useRepoMutation(markTransferPaid, { success: (t) => `Repasse de ${formatMonth(t.month)} pago.`, onSuccess: () => setPaying(null) })
  const current = monthStart(s.today)
  const t = q.data?.totals
  const status = list.filters.status ?? []
  const only = (v: string) => status.length === 1 && status[0] === v
  const toggleStatus = (v: string) => list.setFilter('status', only(v) ? [] : [v])

  const columns: Column<TransferRow>[] = [
    ...(team
      ? [{
          key: 'owner', header: 'Proprietário', sortable: true, firstDir: 'asc' as const,
          cell: (r: TransferRow) => (
            <button className="max-w-[14rem] truncate text-left font-medium hover:underline sm:max-w-none" onClick={() => setStatement(r)}>
              {r.owner_name}
            </button>
          ),
        }]
      : []),
    {
      key: 'month', header: 'Mês', sortable: true, firstDir: 'desc',
      cell: (r) => (
        <span className="whitespace-nowrap">
          {team ? formatMonth(r.month) : <button className="font-medium hover:underline" onClick={() => setStatement(r)}>{formatMonth(r.month)}</button>}
          {r.complement && <span className="ml-1 text-xs text-muted">(complemento)</span>}
        </span>
      ),
    },
    { key: 'gross', header: 'Bruto', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md', cell: (r) => formatBRL(r.gross_cents) },
    { key: 'fee', header: 'Taxa', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'lg', cell: (r) => formatBRL(r.admin_fee_cents) },
    { key: 'expenses', header: 'Despesas', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'lg', cell: (r) => formatBRL(r.expenses_cents) },
    { key: 'net', header: 'Líquido', sortable: true, firstDir: 'desc', align: 'right', cell: (r) => <span className={cn('font-semibold', r.net_cents < 0 && 'text-danger-fg')}>{formatBRL(r.net_cents)}</span> },
    { key: 'status', header: 'Situação', cell: (r) => <TransferStatusBadge status={r.status} /> },
    {
      key: 'acoes', header: '', className: 'w-12',
      cell: (r) => (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="grid size-8 place-items-center rounded-lg hover:bg-surface-2" aria-label={`Ações do repasse de ${formatMonth(r.month)}${team ? ` de ${r.owner_name}` : ''}`}>
              <Ellipsis className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" className="z-50 min-w-52 rounded-xl border border-border bg-surface p-1 text-sm shadow-pop">
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setStatement(r)}>
                <FileSpreadsheet className="size-4" aria-hidden="true" /> Ver demonstrativo
              </DropdownMenu.Item>
              {canApprove && r.status === 'draft' && (
                <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setApproving(r)}>
                  <Check className="size-4" aria-hidden="true" /> Aprovar
                </DropdownMenu.Item>
              )}
              {canPay && r.status === 'approved' && (
                <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setPaying(r)}>
                  <HandCoins className="size-4" aria-hidden="true" /> Marcar como pago
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ),
    },
  ]

  const exportList = async (format: ExportFormat) => {
    const all = await listTransfers(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable(
      'repasses.csv',
      all.rows,
      [
        { label: 'Proprietário', value: (r) => r.owner_name },
        { label: 'Mês', value: (r) => formatMonth(r.month) },
        { label: 'Bruto (R$)', value: (r) => csvMoney(r.gross_cents) },
        { label: 'Taxa (R$)', value: (r) => csvMoney(r.admin_fee_cents) },
        { label: 'Despesas (R$)', value: (r) => csvMoney(r.expenses_cents) },
        { label: 'Líquido (R$)', value: (r) => csvMoney(r.net_cents) },
        { label: 'Situação', value: (r) => TRANSFER_STATUS_LABEL[r.status] },
        { label: 'Complemento', value: (r) => (r.complement ? 'sim' : 'não') },
        { label: 'Pago em', value: (r) => formatDate(r.paid_at) },
      ],
      format,
    )
  }

  const months = [...new Set([...Object.keys(q.data?.facets.month ?? {}), ...(list.filters.month ?? [])])].sort().reverse()

  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title={team ? 'Repasses' : 'Meus repasses'}
        description={
          team
            ? 'O que cada proprietário recebe por mês: aluguel recebido na fatia dele, menos a taxa de administração e as despesas dos imóveis dele.'
            : 'O que a administração pagou ou vai pagar a você por mês. Abra o mês para ver o demonstrativo e baixar em planilha.'
        }
        actions={
          <>
            <LinkButton to="/financeiro" icon={<ArrowLeft className="size-4" aria-hidden="true" />}>
              {team ? 'Lançamentos' : 'Extratos'}
            </LinkButton>
            {canRecalc && (
              <Button variant="primary" icon={<Calculator className="size-4" aria-hidden="true" />} loading={recalc.isPending} loadingText="Recalculando…" onClick={() => recalc.mutate(undefined)}>
                Recalcular rascunho
              </Button>
            )}
            {canRecalc && (
              <InfoTip label="O que o recálculo faz">
                Refaz o rascunho de {formatMonth(current)} com os aluguéis recebidos até hoje. Nos 6 meses anteriores, cria um complemento quando entrou dinheiro depois da aprovação.
                Aprovado e pago nunca mudam.
              </InfoTip>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <FilterKpi label="Em rascunho" value={t ? formatBRLShort(t.draft) : '…'} hint="líquido ainda não aprovado" info="Soma do líquido dos repasses em rascunho no recorte dos filtros. O rascunho muda a cada recálculo." active={only('draft')} onToggle={() => toggleStatus('draft')} />
        <FilterKpi label="Aprovado, a pagar" value={t ? formatBRLShort(t.approved) : '…'} hint="vence dia 10 do mês seguinte" info="Soma do líquido dos repasses aprovados e ainda não pagos. Cada um já tem a conta a pagar no Financeiro." active={only('approved')} onToggle={() => toggleStatus('approved')} />
        <FilterKpi label="Pago" value={t ? formatBRLShort(t.paid) : '…'} hint="no recorte dos filtros" info="Soma do líquido dos repasses pagos. Líquido = bruto - taxa de administração - despesas." active={only('paid')} onToggle={() => toggleStatus('paid')} />
      </div>

      <ListToolbar
        state={list}
        noun={['repasse', 'repasses']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        onExport={exportList}
        searchPlaceholder={team ? 'Buscar por proprietário' : 'Buscar por mês'}
        filters={[
          { key: 'month', label: 'Mês', options: months.map((m) => ({ value: m, label: formatMonth(`${m}-01`) })) },
          { key: 'status', label: 'Situação', options: (['draft', 'approved', 'paid'] as const).map((v) => ({ value: v, label: TRANSFER_STATUS_LABEL[v] })) },
          ...(team ? [{ key: 'owner', label: 'Proprietário', options: q.data?.owners ?? [] }] : []),
        ]}
      />
      <DataTable
        caption="Repasses"
        columns={columns}
        rows={q.data?.rows}
        rowKey={(r) => r.id}
        sort={list.sort}
        onSort={list.toggleSort}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={
          <EmptyState
            title="Nenhum repasse encontrado"
            description={list.activeFilterCount ? 'Nada passa nos filtros ligados. Limpe os filtros para ver todos.' : 'O repasse do mês nasce em rascunho quando o primeiro aluguel do mês é recebido.'}
            action={list.activeFilterCount ? <Button onClick={list.clearFilters}>Limpar filtros</Button> : canRecalc ? <Button variant="primary" onClick={() => recalc.mutate(undefined)}>Recalcular rascunho</Button> : undefined}
          />
        }
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}

      {statement && <StatementDialog row={statement} onClose={() => setStatement(null)} />}
      {approving && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setApproving(null)}
          title="Aprovar repasse?"
          confirmLabel="Aprovar"
          loading={approve.isPending}
          onConfirm={() => approve.mutate({ id: approving.id })}
          message={
            <div className="flex flex-col gap-2">
              <p>
                Repasse de <strong>{formatMonth(approving.month)}</strong> para <strong>{approving.owner_name}</strong>: líquido de <strong>{formatBRL(approving.net_cents)}</strong>.
              </p>
              <p className="text-muted">A conta a pagar nasce com vencimento no dia 10 de {formatMonth(addMonths(approving.month, 1))}. Depois de aprovado, o valor não muda mais.</p>
              {approving.month === current && <p className="text-muted">{formatMonth(current)} ainda não terminou: o que for recebido depois desta aprovação entra num repasse complementar no próximo recálculo.</p>}
            </div>
          }
        />
      )}
      {paying && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPaying(null)}
          title="Marcar repasse como pago?"
          confirmLabel="Marcar como pago"
          loading={pay.isPending}
          onConfirm={() => pay.mutate({ id: paying.id })}
          message={
            <p>
              {paying.net_cents > 0 ? (
                <>
                  Registra a transferência de <strong>{formatBRL(paying.net_cents)}</strong> para <strong>{paying.owner_name}</strong> hoje ({formatDate(s.today)}) e quita a taxa retida.
                </>
              ) : (
                <>Líquido de {formatBRL(paying.net_cents)}: as despesas passaram do aluguel do mês, então nada é transferido. O repasse fica como pago para fechar o mês.</>
              )}
            </p>
          }
        />
      )}
    </>
  )
}

const MENU_ITEM = 'flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 outline-none data-[highlighted]:bg-surface-2'

/** Demonstrativo do mês do dono: as linhas, os totais, e se o mês fecha com o que foi gravado. */
function StatementDialog({ row, onClose }: { row: TransferRow; onClose: () => void }) {
  const q = useRepo('repasses:demonstrativo', (sess) => getTransferStatement(sess, row.id), [row.id])
  const st = q.data
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Demonstrativo de ${formatMonth(row.month)}`}
      description={`${row.owner_name} · ${TRANSFER_STATUS_LABEL[row.status]}${row.approved_at ? ` · aprovado em ${formatDateTime(row.approved_at)}` : ''}${row.paid_at ? ` · pago em ${formatDate(row.paid_at)}` : ''}`}
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Fechar</Button>
          {/* O mesmo "Exportar" de toda lista (planilha .xlsx ou CSV), no lugar do antigo "Baixar planilha (CSV)". */}
          <ExportMenu disabled={!st} onExport={(f) => (st ? downloadStatement(st, f) : undefined)} />
        </>
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !st ? (
        <div className="flex flex-col gap-2" role="status" aria-label="Carregando">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <StatementBody st={st} />
      )}
    </Dialog>
  )
}

function StatementBody({ st }: { st: TransferStatement }) {
  const t = st.transfer
  const rent = st.lines.filter((l) => l.kind === 'rent')
  const expenses = st.lines.filter((l) => l.kind === 'expense')
  const closes = st.pending.gross === 0 && st.pending.fee === 0 && st.pending.expenses === 0
  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Bruto', t.gross_cents],
          ['Taxa de administração', -t.admin_fee_cents],
          ['Despesas', -t.expenses_cents],
          ['Líquido', t.net_cents],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-xl border border-border px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className={cn('num text-base font-bold', (v as number) < 0 && label === 'Líquido' && 'text-danger-fg')}>{formatBRL(v as number)}</dd>
          </div>
        ))}
      </dl>
      {t.complement && <p className="text-muted">Este é um complemento: entrou dinheiro do mês depois de outro repasse ter sido aprovado.</p>}

      <section aria-label="Aluguéis recebidos">
        <h3 className="mb-2 font-semibold">Aluguéis recebidos no mês ({rent.length})</h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Aluguéis recebidos</caption>
            <thead className="bg-surface-2 text-left text-[11px] tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" className="px-3 py-2">Recebido em</th>
                <th scope="col" className="px-3 py-2">Unidade</th>
                <th scope="col" className="hidden px-3 py-2 sm:table-cell">Descrição</th>
                <th scope="col" className="px-3 py-2 text-right">Pago</th>
                <th scope="col" className="px-3 py-2 text-right">Fatia</th>
                <th scope="col" className="px-3 py-2 text-right">Parte</th>
                <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {rent.map((l, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="num px-3 py-2 whitespace-nowrap">{formatDate(l.date)}</td>
                  <td className="px-3 py-2">{l.unit_label}</td>
                  <td className="hidden px-3 py-2 sm:table-cell">{l.description}</td>
                  <td className="num px-3 py-2 text-right">{formatBRL(l.total_cents)}</td>
                  <td className="num px-3 py-2 text-right">{formatPct(l.share_pct)}</td>
                  <td className="num px-3 py-2 text-right font-medium">{formatBRL(l.part_cents)}</td>
                  <td className="num hidden px-3 py-2 text-right md:table-cell">
                    {formatBRL(l.fee_cents)} <span className="text-xs text-muted">({formatPct(l.fee_pct)})</span>
                  </td>
                </tr>
              ))}
              {rent.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-3 text-muted">Nenhum aluguel recebido neste mês.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Despesas do proprietário">
        <h3 className="mb-2 font-semibold">Despesas cobradas do proprietário ({expenses.length})</h3>
        {expenses.length === 0 ? (
          <p className="text-muted">Nenhuma despesa no mês.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {expenses.map((l, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block">{l.description}</span>
                  <span className="block text-xs text-muted">
                    {l.unit_label} · vence {formatDate(l.date)} · fatia {formatPct(l.share_pct)} de {formatBRL(l.total_cents)}
                  </span>
                </span>
                <span className="num font-medium">{formatBRL(l.part_cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(st.siblings.length > 0 || !closes) && (
        <section aria-label="Conferência do mês" className="rounded-xl bg-surface-2 px-3 py-2">
          <p className="font-semibold">Conferência do mês</p>
          <p className="mt-1">
            Mês inteiro recalculado hoje: líquido de {formatBRL(st.month.net)}.
            {st.siblings.length > 0 && ` Outros repasses deste mês: ${st.siblings.map((x) => `${formatBRL(x.net_cents)} (${TRANSFER_STATUS_LABEL[x.status].toLowerCase()})`).join(', ')}.`}
          </p>
          {!closes && <p className="mt-1 text-danger-fg">Falta repassar {formatBRL(st.pending.net)} deste mês: rode "Recalcular rascunho" para criar o complemento.</p>}
        </section>
      )}
    </div>
  )
}

/** Planilha do demonstrativo (o proprietário baixa a dele): linhas + totais, em .xlsx ou CSV. */
function downloadStatement(st: TransferStatement, format: ExportFormat): Promise<void> {
  const t = st.transfer
  type Line = { a: string; b: string; c: string; d: string; e: string; f: string; g: string }
  const rows: Line[] = [
    ...st.lines.map((l) => ({
      a: l.kind === 'rent' ? 'Aluguel recebido' : 'Despesa', b: formatDate(l.date), c: l.unit_label, d: l.description,
      e: csvMoney(l.total_cents), f: `${l.share_pct}%`, g: csvMoney(l.kind === 'rent' ? l.part_cents - l.fee_cents : -l.part_cents),
    })),
    { a: 'Bruto', b: '', c: '', d: '', e: '', f: '', g: csvMoney(t.gross_cents) },
    { a: 'Taxa de administração', b: '', c: '', d: '', e: '', f: '', g: csvMoney(-t.admin_fee_cents) },
    { a: 'Despesas', b: '', c: '', d: '', e: '', f: '', g: csvMoney(-t.expenses_cents) },
    { a: 'Líquido do repasse', b: '', c: '', d: '', e: '', f: '', g: csvMoney(t.net_cents) },
  ]
  return downloadTable(
    `demonstrativo-${t.month.slice(0, 7)}-${normalize(t.owner_name).replace(/[^a-z0-9]+/g, '-')}`,
    rows,
    [
      { label: 'Tipo', value: (r) => r.a },
      { label: 'Data', value: (r) => r.b },
      { label: 'Unidade', value: (r) => r.c },
      { label: 'Descrição', value: (r) => r.d },
      { label: 'Valor (R$)', value: (r) => r.e },
      { label: 'Fatia', value: (r) => r.f },
      { label: 'Para o proprietário (R$)', value: (r) => r.g },
    ],
    format,
    'Demonstrativo',
  )
}
