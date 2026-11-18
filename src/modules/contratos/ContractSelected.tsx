/* =============================================================================
   O contrato ESCOLHIDO em "Contratos e pessoas" (07/11/2026): o que era a página do contrato
   (ContractPage, até 07/11) dividido pela regra de navegação do app ("uma ficha por coisa"):
     - ContractFicha: a ficha CURTA ao lado da tabela: situação, valor, vigência, próximo reajuste,
       atraso e quem aluga, com os botões explícitos: o passo "para a frente" (Enviar para revisão,
       Aprovar, Registrar assinatura...), "Mais ações" (reajuste, renovação, cobranças, observação e
       os outros caminhos, como Rescindir), "Abrir imóvel" e "Limpar escolha";
     - ContractDetails: as abas de baixo (no máximo 3): Termos e reajustes | Financeiro (Cobranças
       para o inquilino) | Histórico. As partes, o imóvel e os documentos estão na linha aberta da
       tabela (ContractsTable.tsx), não aqui: a mesma informação não mora em dois lugares.
   As janelas (TransitionDialog, AdjustmentDialog, EventDialog, RenewDialog) são as de sempre
   (ContractDialogs.tsx); useContractActions guarda qual está aberta, porque a ficha e as abas abrem
   as mesmas janelas. Cada botão só aparece para quem tem a permissão, mas a regra de verdade está
   no repositório.
   ============================================================================= */
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { DropdownMenu } from 'radix-ui'
import { ChevronDown, CircleAlert, ExternalLink, MessageSquarePlus, Percent, Receipt, RefreshCw, Repeat2 } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal } from '@/auth/permissions'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { DescriptionList, KpiTile, Section, Timeline, type TimelineItem } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, Skeleton } from '@/components/ui/States'
import { TabPanel, Tabs, type TabDef } from '@/components/ui/Tabs'
import { cn } from '@/components/ui/cn'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { ADJUSTMENT_INDEX, CONTRACT_KIND, CONTRACT_STATUS, CONTRACT_STATUS_TONE, GUARANTEE } from '@/data/labels'
import { CONTRACT_TRANSITIONS } from '@/data/rules'
import type { AdjustmentIndex, ContractEvent, ContractStatus } from '@/data/types'
import type { ContractRow } from '@/data/views/contracts'
import { listEntries, type EntryRow } from '@/data/views/finance'
import { csvMoney } from '@/lib/csv'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { addDays, formatDate, formatMonth, monthsBetween } from '@/lib/dates'
import { formatBRL, formatBRLShort } from '@/lib/money'
import { useListState } from '@/lib/useListState'
import { CancelEntryDialog, EntryActions, PaymentDialog } from '@/modules/financeiro/EntryDialogs'
import { ENTRY_STATE_LABEL, EntryStateBadge, formatPct } from '@/modules/financeiro/ui'
import { resolveTab } from '@/modules/imoveis/tabs'
import { DetailsHeading } from '@/modules/imoveis/UnitPage'
import { AdjustmentDialog, EventDialog, RenewDialog, TransitionDialog } from './ContractDialogs'
import { termText } from './ContractsTable'
import { generateRentEntries, getContract, isForwardStep, permissionFor, transitionLabel, type ContractView } from './repo'
import { FichaFooter, FichaFrame, type FichaItem } from './ui'

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MENU_ITEM = 'flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 outline-none data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'

/* ---------------------------------------------------------------- janelas */

export type ContractPending = { kind: 'move'; to: ContractStatus } | { kind: 'adjust' } | { kind: 'event'; event: 'note' | 'amendment' } | { kind: 'renew' }

/**
 * Qual janela do contrato está aberta. A ficha (Mais ações) e as abas (Registrar aditivo,
 * Adicionar observação) abrem as mesmas janelas: o estado mora na tela que tem as duas.
 */
export function useContractActions() {
  const [pending, setPending] = useState<ContractPending | null>(null)
  const close = () => setPending(null)
  const dialogs = (v: ContractView | undefined): ReactNode =>
    v && pending ? (
      <>
        {pending.kind === 'move' && <TransitionDialog contract={v.contract} to={pending.to} onClose={close} />}
        {pending.kind === 'adjust' && <AdjustmentDialog view={v} onClose={close} />}
        {pending.kind === 'event' && <EventDialog contract={v.contract} kind={pending.event} onClose={close} />}
        {pending.kind === 'renew' && <RenewDialog contract={v.contract} onClose={close} />}
      </>
    ) : null
  return { open: setPending, dialogs }
}

/** A leitura do contrato escolhido (a mesma chave da linha aberta: uma leitura só para as três partes da tela). */
export function useContractView(contractId: string | null) {
  const q = useRepo('contrato:ficha', (sess) => getContract(sess, contractId!), [contractId], { enabled: !!contractId })
  // keepPreviousData mantém o contrato anterior enquanto o novo chega: só vale se for ESTE.
  return { q, view: q.data && q.data.contract.id === contractId ? q.data : undefined }
}

/* ---------------------------------------------------------------- ficha curta */

/**
 * A ficha curta do contrato escolhido. Os números que eram a faixa de indicadores da página do
 * contrato (aluguel, próximo reajuste, dias para vencer, em atraso) vieram para cá.
 */
export function ContractFicha({ view: v, error, onRetry, onClear, onAction, className }: { view: ContractView | undefined; error: unknown; onRetry: () => void; onClear: () => void; onAction: (p: ContractPending) => void; className?: string }) {
  const s = useSession()
  const navigate = useNavigate()
  const gen = useRepoMutation(generateRentEntries, {
    success: (r) => (r.created ? `${r.created} cobranças geradas (até ${formatMonth(r.to!)}).` : 'Nada a gerar: as cobranças já vão até 12 meses à frente.'),
  })
  if (error && !v)
    return (
      <FichaFrame className={className} label="Contrato não encontrado" eyebrow="Escolha" title="Contrato não encontrado" sub="Ele não existe mais ou está fora do seu acesso." items={[]} footer={<FichaFooter onClear={onClear} />}>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Tentar de novo
        </Button>
      </FichaFrame>
    )
  if (!v) return <FichaFrame className={className} label="Contrato escolhido" eyebrow="Contrato escolhido" title={<Skeleton className="h-6 w-40" />} items={null} />

  const k = v.contract
  const portal = isPortal(s)
  const lease = k.kind === 'lease'
  const canEdit = !portal && can(s, 'contracts:edit')
  const canFinance = !portal && can(s, 'finance:edit')
  const moves = portal ? [] : CONTRACT_TRANSITIONS[k.status].filter((to) => can(s, permissionFor(k.status, to)))
  const forward = moves.find((to) => isForwardStep(k.status, to))
  const others = moves.filter((to) => to !== forward)
  const activeLease = lease && k.status === 'active'
  const hasMore = others.length > 0 || canEdit || (activeLease && canFinance)
  const t = termText(k)
  const upcoming = lease && !['active', 'ended', 'terminated'].includes(k.status) && k.adjustment_index !== 'none' && v.nextAdjustmentFrom <= k.end_date

  const items: FichaItem[] = [
    { label: 'Situação', value: <Badge tone={CONTRACT_STATUS_TONE[k.status]}>{CONTRACT_STATUS[k.status]}</Badge> },
    lease
      ? { label: 'Aluguel', value: <span><span className="num whitespace-nowrap">{formatBRL(k.rent_cents)}</span> <span className="whitespace-nowrap text-muted">· dia {k.due_day}</span></span>, info: 'Valor mensal em vigor (já com os reajustes registrados) e o dia do vencimento.' }
      : { label: 'Taxa de administração', value: <span className="num">{formatPct(k.admin_fee_pct)}</span>, info: 'Percentual que a imobiliária desconta no repasse ao proprietário.' },
    {
      label: 'Vigência',
      value: (
        <span className="flex flex-col">
          <span className="num">
            {formatDate(k.start_date)} a {formatDate(k.end_date)}
          </span>
          <span className={cn('text-xs', t.tone === 'danger' ? 'text-danger-fg' : t.tone === 'warning' ? 'font-medium text-warning-fg' : 'text-muted')}>{t.text}</span>
        </span>
      ),
      info: 'Prazo vencido sem encerrar nem renovar: a locação segue por prazo indeterminado (Lei 8.245, art. 46).',
    },
    ...(lease
      ? [
          {
            label: 'Próximo reajuste',
            value: k.next_adjustment ? (
              <span className="num">{formatDate(k.next_adjustment)}</span>
            ) : upcoming ? (
              <span>
                <span className="num">{formatDate(v.nextAdjustmentFrom)}</span> <span className="text-muted">· o 1º</span>
              </span>
            ) : (
              <span className="text-muted">Sem previsão</span>
            ),
            info: `Próximo aniversário do contrato (início + 12 meses, + 24...) a partir de hoje${k.adjustment_index === 'none' ? '' : `, pelo ${ADJUSTMENT_INDEX[k.adjustment_index]}`}. Antes da ativação, mostra o primeiro, que só vale se o contrato for assinado.`,
          },
        ]
      : []),
    {
      label: 'Em atraso',
      value: k.overdue_cents > 0 ? <span className="num font-medium text-danger-fg">{formatBRL(k.overdue_cents)}</span> : <span className="text-muted">Nada vencido</span>,
      info: 'Soma do saldo em aberto das cobranças a receber deste contrato com vencimento antes de hoje. Pagamento parcial já desconta.',
    },
    { label: lease ? 'Locatário' : 'Proprietário', value: lease ? k.lessee_name || <span className="text-muted">Não informado</span> : k.lessor_names },
  ]

  const openProperty = () => void navigate({ to: '/imoveis/$propertyId', params: { propertyId: k.property_id }, search: k.unit_id ? { unidade: k.unit_id } : {} })

  return (
    <FichaFrame
      className={className}
      label={`Contrato escolhido: ${k.code}`}
      eyebrow={`${CONTRACT_KIND[k.kind]} · ${k.property_name}`}
      title={k.code}
      sub={k.unit_label ?? 'Imóvel inteiro'}
      items={items}
      footer={
        <FichaFooter onClear={onClear}>
          {forward && (
            <Button size="sm" variant="primary" onClick={() => onAction({ kind: 'move', to: forward })}>
              {transitionLabel(k.status, forward)}
            </Button>
          )}
          {hasMore && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button size="sm" icon={<ChevronDown className="size-4" aria-hidden="true" />}>
                  Mais ações
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-64 rounded-xl border border-border bg-surface p-1 text-sm shadow-pop">
                  {activeLease && canEdit && (
                    <>
                      <DropdownMenu.Item className={MENU_ITEM} onSelect={() => onAction({ kind: 'adjust' })}>
                        <Percent className="size-4" aria-hidden="true" /> Registrar reajuste
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className={MENU_ITEM} disabled={!!v.renewal} onSelect={() => onAction({ kind: 'renew' })}>
                        <Repeat2 className="size-4" aria-hidden="true" /> {v.renewal ? `Renovação já criada (${v.renewal.code})` : 'Renovar'}
                      </DropdownMenu.Item>
                    </>
                  )}
                  {activeLease && (canEdit || canFinance) && (
                    <DropdownMenu.Item className={MENU_ITEM} onSelect={() => gen.mutate({ id: k.id })}>
                      <RefreshCw className="size-4" aria-hidden="true" /> Gerar próximas cobranças
                    </DropdownMenu.Item>
                  )}
                  {canEdit && (
                    <DropdownMenu.Item className={MENU_ITEM} onSelect={() => onAction({ kind: 'event', event: 'note' })}>
                      <MessageSquarePlus className="size-4" aria-hidden="true" /> Adicionar observação
                    </DropdownMenu.Item>
                  )}
                  {others.length > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
                  {others.map((to) => {
                    const early = to === 'ended' && s.today < k.end_date
                    return (
                      <DropdownMenu.Item key={to} className={cn(MENU_ITEM, to === 'terminated' && 'text-danger-fg')} disabled={early} onSelect={() => onAction({ kind: 'move', to })}>
                        {transitionLabel(k.status, to)}
                        {early && <span className="text-xs text-muted">(a partir de {formatDate(k.end_date)})</span>}
                      </DropdownMenu.Item>
                    )
                  })}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          {can(s, 'properties:view') && (
            <Button size="sm" icon={<ExternalLink className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={openProperty}>
              Abrir imóvel
            </Button>
          )}
        </FichaFooter>
      }
    >
      {v.clashes.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-3 py-2 text-sm" role="status">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden="true" />
          <span>
            {v.clashes.map((c) => `${c.code} (${CONTRACT_STATUS[c.status].toLowerCase()}, ${formatDate(c.start_date)} a ${formatDate(c.end_date)})`).join('; ')} já segura esta unidade num período
            que cruza com este. Este contrato não chega a "Aguardando assinatura" enquanto o outro existir.
          </span>
        </p>
      )}
    </FichaFrame>
  )
}

/* ---------------------------------------------------------------- detalhes (abas de baixo) */

/** As abas do contrato escolhido. Sem contagem: somar evento com cobrança daria um número que não conta nada. */
export function contractTabs(lessee: boolean): TabDef[] {
  return [
    { value: 'termos', label: 'Termos e reajustes' },
    { value: 'financeiro', label: lessee ? 'Cobranças' : 'Financeiro' },
    { value: 'historico', label: 'Histórico' },
  ]
}

/**
 * Os detalhes do contrato escolhido. A aba muda SÓ no clique da pessoa; escolher outro contrato
 * volta para a primeira (a tela tira o ?aba= do endereço ao trocar de escolha).
 */
export function ContractDetails({ view: v, tab, onTab, onClear, onAction }: { view: ContractView; tab?: string; onTab: (t: string) => void; onClear: () => void; onAction: (p: ContractPending) => void }) {
  const s = useSession()
  const k = v.contract
  const portal = isPortal(s)
  const lessee = portal && s.roles.includes('lessee') && !s.roles.includes('owner')
  const canEdit = !portal && can(s, 'contracts:edit')
  const canFinance = !portal && can(s, 'finance:edit')
  const activeLease = k.kind === 'lease' && k.status === 'active'
  const changes = v.events.filter((e) => ['adjustment', 'amendment', 'renewal'].includes(e.kind))
  const tabs = contractTabs(lessee)
  const current = resolveTab(tab, tabs, {})
  return (
    <section className="flex flex-col gap-2" aria-label={`Detalhes de ${k.code}`}>
      <DetailsHeading title={`Detalhes de ${k.code}`} onClear={onClear} />
      <Tabs value={current} onValueChange={onTab} tabs={tabs}>
        {/* Cada aba empilha seções num div de dentro: o painel inativo do Radix fica no DOM com
            "hidden", e um "flex" no próprio painel venceria o hidden e mostraria a aba fechada. */}
        <TabPanel value="termos" className="pt-3">
          <div className="flex flex-col gap-4">
            <Terms view={v} portal={portal} agency={s.org.kind === 'agency'} />
            <Section
              title="Reajustes e aditivos"
              info="Reajuste: uma vez por ano (Lei 10.192/2001), pelo percentual do índice. Aditivo: mudança combinada entre as partes. Renovação: um contrato novo ligado a este."
              actions={
                canEdit && (
                  <>
                    {activeLease && (
                      <Button size="sm" icon={<Percent className="size-4" aria-hidden="true" />} onClick={() => onAction({ kind: 'adjust' })}>
                        Registrar reajuste
                      </Button>
                    )}
                    {!['ended', 'terminated'].includes(k.status) && (
                      <Button size="sm" onClick={() => onAction({ kind: 'event', event: 'amendment' })}>
                        Registrar aditivo
                      </Button>
                    )}
                  </>
                )
              }
            >
              <div className="flex flex-col gap-3">
                {activeLease && k.adjustment_index !== 'none' && (
                  <p className="text-sm text-muted">
                    Próximo reajuste pode valer a partir de <strong className="text-text">{formatDate(v.nextAdjustmentFrom)}</strong> pelo {ADJUSTMENT_INDEX[k.adjustment_index]}.
                  </p>
                )}
                <Timeline items={changes.map(eventItem)} empty="Nenhum reajuste ou aditivo registrado." />
              </div>
            </Section>
          </div>
        </TabPanel>
        <TabPanel value="financeiro" className="pt-3">
          <ContractEntries contract={k} canFinance={canFinance} payer={lessee} />
        </TabPanel>
        <TabPanel value="historico" className="pt-3">
          <Section
            title="Linha do tempo"
            info="Tudo o que aconteceu com o contrato, com a data de efeito e quem fez. O mais novo em cima."
            actions={
              canEdit && (
                <Button size="sm" icon={<MessageSquarePlus className="size-4" aria-hidden="true" />} onClick={() => onAction({ kind: 'event', event: 'note' })}>
                  Adicionar observação
                </Button>
              )
            }
          >
            <Timeline items={v.events.map(eventItem)} />
          </Section>
        </TabPanel>
      </Tabs>
    </section>
  )
}

/**
 * Os termos do contrato que a ficha curta e a linha aberta não mostram (vencimento, índice,
 * garantia, multa, taxa, contrato anterior e renovação, observações). Unidade, período e aluguel
 * ficaram na ficha curta: dois lugares com o mesmo dado fazem perguntar "qual é o certo?".
 */
function Terms({ view: v, portal, agency }: { view: ContractView; portal: boolean; agency: boolean }) {
  const k = v.contract
  const lease = k.kind === 'lease'
  const months = monthsBetween(k.start_date, addDays(k.end_date, 1))
  return (
    <Section title="Termos">
      <DescriptionList
        columns={3}
        items={[
          { label: 'Tipo', value: CONTRACT_KIND[k.kind] },
          { label: 'Prazo', value: `${months} ${months === 1 ? 'mês' : 'meses'}` },
          ...(lease
            ? [
                { label: 'Vencimento', value: `Todo dia ${k.due_day}${k.due_day > 28 ? ' (no mês sem esse dia, o último dia)' : ''}` },
                { label: 'Reajuste', value: k.adjustment_index === 'none' ? 'Sem reajuste' : `${ADJUSTMENT_INDEX[k.adjustment_index]}, em ${MONTHS[k.adjustment_month - 1]}` },
                { label: 'Garantia', value: `${GUARANTEE[k.guarantee_type]}${k.guarantee_type === 'deposit' ? `: ${formatBRL(k.deposit_cents)}` : ''}` },
                { label: 'Multa e juros', value: `${formatPct(k.late_fee_pct)} de multa · ${formatPct(k.interest_pct_month)} ao mês` },
              ]
            : []),
          ...(agency ? [{ label: 'Taxa de administração', value: formatPct(k.admin_fee_pct), info: 'Descontada no repasse ao proprietário.' }] : []),
          ...(v.parent ? [{ label: 'Contrato anterior', value: <ContractLink id={v.parent.id} code={v.parent.code} /> }] : []),
          ...(v.renewal ? [{ label: 'Renovação', value: <span><ContractLink id={v.renewal.id} code={v.renewal.code} /> ({CONTRACT_STATUS[v.renewal.status].toLowerCase()})</span> }] : []),
          ...(!portal ? [{ label: 'Observações', value: k.notes }] : []),
        ]}
      />
    </Section>
  )
}

/** Contrato anterior ou renovação: escolher o outro contrato na mesma tela (troca a escolha, não a página). */
function ContractLink({ id, code }: { id: string; code: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" className="text-primary hover:underline" onClick={() => void navigate({ to: '/contratos', search: { contrato: id }, replace: true, resetScroll: false })}>
      {code}
    </button>
  )
}

/* ---------------------------------------------------------------- linha do tempo */

/** Um evento do banco vira um item legível: o que mudou, de quanto para quanto, e a observação. */
function eventItem(e: ContractEvent & { who: string }): TimelineItem {
  const p = e.payload
  let title: string
  const detail: string[] = []
  if (e.kind === 'created') title = 'Contrato criado'
  else if (e.kind === 'status') title = `${e.from_status ? CONTRACT_STATUS[e.from_status] : ''} → ${e.to_status ? CONTRACT_STATUS[e.to_status] : ''}`
  else if (e.kind === 'adjustment') {
    const index = ADJUSTMENT_INDEX[p.index as AdjustmentIndex] ?? String(p.index ?? '')
    title = `Reajuste de ${formatPct(Number(p.pct ?? 0))} (${index})`
    if (typeof p.from_cents === 'number' && typeof p.to_cents === 'number') detail.push(`De ${formatBRL(p.from_cents)} para ${formatBRL(p.to_cents)}.`)
  } else if (e.kind === 'amendment') title = 'Aditivo'
  else if (e.kind === 'renewal') title = `Renovação ${p.new_code ?? ''}`.trim()
  else title = 'Observação'
  if (typeof p.planned_end === 'string') detail.push(`O fim planejado era ${formatDate(p.planned_end)}.`)
  if (e.note && e.note.replace(/\.$/, '') !== title) detail.push(e.note) // "Contrato criado." não repete o título
  return { id: e.id, when: formatDate(e.effective_date), title, detail: detail.join(' ') || undefined, who: e.who }
}

/* ---------------------------------------------------------------- financeiro do contrato */

function ContractEntries({ contract: k, canFinance, payer }: { contract: ContractRow; canFinance: boolean; payer: boolean }) {
  const s = useSession()
  // Só ordem e tamanho de página são lembrados; o filtro do contrato entra por fora.
  const list = useListState('contrato-financeiro', { sort: { key: 'competence', dir: 'desc' } })
  const params = useMemo(() => ({ ...list.params, filters: { ...list.params.filters, contract: [k.id] } }), [list.params, k.id])
  const q = useRepo('contrato:financeiro', (sess) => listEntries(sess, params), [params])
  // O contrato inteiro, sem busca nem filtro: é o "M" do "N de M" e a base dos indicadores da aba
  // (sem isso o contador diria "15 de 1.902", contando os lançamentos da conta toda).
  const base = useRepo('contrato:financeiro-total', (sess) => listEntries(sess, { filters: { contract: [k.id] }, page: 1, pageSize: 1 }), [k.id])
  const [paying, setPaying] = useState<EntryRow | null>(null)
  const [canceling, setCanceling] = useState<EntryRow | null>(null)
  const t = base.data?.totals
  const columns: Column<EntryRow>[] = [
    { key: 'competence', header: 'Competência', sortable: true, firstDir: 'desc', cell: (e) => <span className="whitespace-nowrap">{formatMonth(e.competence)}</span> },
    { key: 'due_date', header: 'Vencimento', sortable: true, firstDir: 'desc', hideBelow: 'sm', cell: (e) => <span className="num whitespace-nowrap">{formatDate(e.due_date)}</span> },
    { key: 'description', header: 'Descrição', hideBelow: 'md', cell: (e) => <span className="block max-w-[16rem] truncate">{e.description}</span> },
    { key: 'amount', header: 'Valor', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md', cell: (e) => <span className="whitespace-nowrap">{formatBRL(e.amount_cents)}</span> },
    { key: 'paid', header: 'Pago', align: 'right', hideBelow: 'lg', cell: (e) => <span className={cn('whitespace-nowrap', !e.paid_cents && 'text-muted')}>{formatBRL(e.paid_cents)}</span> },
    { key: 'open', header: 'Em aberto', align: 'right', cell: (e) => <span className={cn('whitespace-nowrap', e.state === 'overdue' && 'font-semibold text-danger-fg')}>{formatBRL(e.open_cents)}</span> },
    { key: 'days_overdue', header: 'Situação', sortable: true, firstDir: 'desc', cell: (e) => <EntryStateBadge state={e.state} daysOverdue={e.days_overdue} payer={payer} /> },
    ...(canFinance ? [{ key: 'acoes', header: '', className: 'w-12', cell: (e: EntryRow) => <EntryActions entry={{ ...e, contract_id: null }} canEdit onPay={() => setPaying(e)} onCancel={() => setCanceling(e)} /> }] : []),
  ]
  const exportList = async (format: ExportFormat) => {
    const all = await listEntries(s, { ...params, page: 1, pageSize: 100_000 })
    await downloadTable(
      `cobrancas-${k.code}.csv`,
      all.rows,
      [
        { label: 'Competência', value: (e) => formatMonth(e.competence) },
        { label: 'Vencimento', value: (e) => formatDate(e.due_date) },
        { label: 'Descrição', value: (e) => e.description },
        { label: 'Valor (R$)', value: (e) => csvMoney(e.amount_cents) },
        { label: 'Pago (R$)', value: (e) => csvMoney(e.paid_cents) },
        { label: 'Em aberto (R$)', value: (e) => csvMoney(e.open_cents) },
        { label: 'Situação', value: (e) => (e.state === 'overdue' ? `Vencido há ${e.days_overdue} dias` : payer && e.state === 'received' ? 'Pago' : ENTRY_STATE_LABEL[e.state]) },
      ],
      format,
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiTile label={payer ? 'A vencer' : 'Previsto'} value={t ? formatBRLShort(t.forecast) : '…'} info="Saldo em aberto que ainda não venceu." />
        <KpiTile label="Vencido" value={t ? formatBRLShort(t.overdue) : '…'} tone={t && t.overdue > 0 ? 'danger' : undefined} info={`Saldo em aberto com vencimento antes de hoje (${formatDate(s.today)}).`} />
        <KpiTile label={payer ? 'Pago' : 'Recebido'} value={t ? formatBRLShort(t.received) : '…'} info="Soma das cobranças quitadas (valor inteiro)." />
      </div>
      <ListToolbar
        state={list}
        noun={['cobrança', 'cobranças']}
        total={q.data?.total}
        totalAll={base.data?.total}
        facets={q.data?.facets}
        onExport={exportList}
        searchPlaceholder="Buscar por descrição"
        filters={[{ key: 'state', label: 'Situação', options: (['forecast', 'overdue', 'received', 'canceled'] as const).map((v) => ({ value: v, label: payer && v === 'received' ? 'Pago' : ENTRY_STATE_LABEL[v] })) }]}
      />
      <DataTable
        caption={`Cobranças do contrato ${k.code}`}
        columns={columns}
        rows={q.data?.rows}
        rowKey={(e) => e.id}
        sort={list.sort}
        onSort={list.toggleSort}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={
          <EmptyState
            icon={<Receipt className="size-5" aria-hidden="true" />}
            title="Nenhuma cobrança"
            description={list.activeFilterCount ? 'Nada passa nos filtros ligados.' : k.status === 'active' ? 'Use "Gerar próximas cobranças" em Mais ações, na ficha ao lado.' : 'As cobranças mensais nascem quando o contrato é ativado (assinatura registrada).'}
            action={list.activeFilterCount ? <Button onClick={list.clearFilters}>Limpar filtros</Button> : undefined}
          />
        }
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      {paying && <PaymentDialog entry={paying} onClose={() => setPaying(null)} />}
      {canceling && <CancelEntryDialog entry={canceling} onClose={() => setCanceling(null)} />}
    </div>
  )
}
