/* =============================================================================
   Início do portal: a primeira tela de quem não é da equipe.
   - Proprietário: indicadores das unidades dele, "Aprovações pendentes" (orçamentos e etapas
     que esperam o "sim" dele, decididos ali mesmo) e os próximos fins de contrato;
   - Inquilino: o contrato, as cobranças em aberto, os chamados (com "Abrir chamado") e os
     documentos liberados para ele;
   - Prestador: os chamados atribuídos, separados por situação, com as ações de cada um.
   - Proprietário e inquilino: os comunicados da administração, do mais novo ao mais antigo; o
     não lido leva um ponto azul e o "Marcar como lido" (destaque quieto, sem faixa nem cor de alerta).
   No topo, o nome da imobiliária: o portal é dela, a pessoa entra pela marca de quem administra.
   ============================================================================= */
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Download, FileText, Play, Plus, X } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { CONTRACT_STATUS, CONTRACT_STATUS_TONE, ENTRY_CATEGORY, MAINTENANCE_STATUS } from '@/data/labels'
import type { MaintenanceStatus } from '@/data/types'
import type { MaintenanceRow } from '@/data/views/finance'
import { formatDate, formatDateTime, formatMonth, monthStart } from '@/lib/dates'
import { formatBRL, formatBRLShort } from '@/lib/money'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { DescriptionList, KpiTile, PageHeader, Section } from '@/components/ui/Layout'
import { ErrorState, PageSkeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { markRead } from '@/modules/avisos/repo'
import type { PortalAnnouncement } from '@/modules/comunicacao/repo'
import { CompleteDialog, DecideQuoteDialog, OpenRequestDialog } from '@/modules/manutencao/dialogs'
import { startWork } from '@/modules/manutencao/repo'
import { demoDownload } from '@/modules/manutencao/RequestPage'
import { DueDate, PriorityBadge, StatusBadge } from '@/modules/manutencao/ui'
import { approveTask, type TaskRow } from '@/modules/processos/repo'
import { getPortalHome, type LesseeHome, type OwnerHome, type VendorRequest } from './repo'

const PORTAL_NAME = { owner: 'Portal do proprietário', lessee: 'Portal do inquilino', vendor: 'Portal do prestador' } as const

export function PortalHome() {
  const s = useSession()
  const q = useRepo('portal', getPortalHome)
  const kinds = (['owner', 'lessee', 'vendor'] as const).filter((r) => s.roles.includes(r))
  return (
    <Guard action="portal:home" what="o Início do portal">
      <div className="flex items-center gap-3">
        <Avatar name={s.org.name} color={s.org.brand_color} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{s.org.name}</p>
          <p className="truncate text-xs text-muted">{kinds.map((k) => PORTAL_NAME[k]).join(' · ')}</p>
        </div>
      </div>
      <PageHeader title="Início" muted={s.user.full_name} description="O que é seu e o que pede uma ação sua agora." />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <PageSkeleton />
      ) : (
        <>
          {(q.data.owner || q.data.lessee) && <AnnouncementsPart items={q.data.announcements} />}
          {q.data.owner && <OwnerPart data={q.data.owner} />}
          {q.data.lessee && <LesseePart data={q.data.lessee} />}
          {q.data.vendor && <VendorPart requests={q.data.vendor.requests} />}
        </>
      )}
    </Guard>
  )
}

/** Linha de chamado usada nas três partes: código, título, situação e, à direita, o que couber. */
function RequestLine({ r, detail, children }: { r: MaintenanceRow; detail?: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-64">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Link to="/manutencao/$requestId" params={{ requestId: r.id }} className="font-semibold text-primary hover:underline">
            {r.code}
          </Link>
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{r.title}</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">{detail}</div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </li>
  )
}

/* ---------------------------------------------------------------- comunicados */

const NOTICES_SHOWN = 3

/**
 * Comunicados da administração. Mostra os 3 mais novos e "Ver todos" abre o resto ali mesmo.
 * "Marcar como lido" marca o aviso do sino ligado ao comunicado (o mesmo da página Avisos).
 */
function AnnouncementsPart({ items }: { items: PortalAnnouncement[] }) {
  const s = useSession()
  const [all, setAll] = useState(false)
  const read = useRepoMutation(markRead, { silent: true })
  const unread = items.filter((a) => a.unread).length
  const shown = all ? items : items.slice(0, NOTICES_SHOWN)
  return (
    <Section title="Comunicados" actions={unread ? <span className="num text-xs text-muted">{unread} não {unread === 1 ? 'lido' : 'lidos'}</span> : undefined}>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nenhum comunicado da administração. Obra, assembleia ou falta de água aparecem aqui.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {shown.map((a) => (
            <li key={a.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              {/* O ponto marca o não lido; o lido guarda o mesmo espaço, para os títulos ficarem alinhados. */}
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', a.unread ? 'bg-primary' : 'bg-transparent')} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium [overflow-wrap:anywhere]">
                  {a.title}
                  {a.unread && <span className="sr-only"> (não lido)</span>}
                </p>
                <p className="mt-0.5 text-sm whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">{a.body}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-faint">
                  <span>{formatDateTime(a.sent_at, s.org.timezone)}</span>
                  <span>{a.property_name ?? 'Todos os imóveis'}</span>
                  {a.unread && (
                    <button className="min-h-6 font-medium text-primary hover:underline" disabled={read.isPending} onClick={() => read.mutate(a.notice_ids)}>
                      Marcar como lido
                    </button>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {items.length > NOTICES_SHOWN && (
        <button className="mt-2 min-h-6 text-xs font-medium text-primary hover:underline" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Mostrar só os mais novos' : `Ver todos os ${items.length} comunicados`}
        </button>
      )}
    </Section>
  )
}

/* ---------------------------------------------------------------- proprietário */

function OwnerPart({ data }: { data: OwnerHome }) {
  const s = useSession()
  const [deciding, setDeciding] = useState<{ r: MaintenanceRow; approve: boolean } | null>(null)
  const [approving, setApproving] = useState<TaskRow | null>(null)
  const approve = useRepoMutation(approveTask, { success: (t) => `"${t.title.split(' · ')[0]}" aprovada. A imobiliária segue com o processo.`, onSuccess: () => setApproving(null) })
  const pending = data.quotes.length + data.approvals.length
  const occupancy = data.units ? Math.round((data.occupied / data.units) * 100) : 0
  const last = data.lastTransfer
  return (
    <>
      <section aria-label="Resumo das suas unidades" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Unidades" value={data.units} hint="as suas nesta administração" />
        <KpiTile label="Ocupadas" value={data.occupied} hint={`${occupancy}% das suas unidades`} />
        <KpiTile
          label="Recebido no mês"
          value={formatBRLShort(data.receivedMonthCents)}
          hint={`aluguéis pagos em ${formatMonth(monthStart(s.today))}`}
          info="Soma dos aluguéis que os inquilinos das suas unidades pagaram neste mês. Valor cheio: antes da taxa de administração e, na unidade com mais de um dono, antes da divisão."
        />
        <KpiTile
          label="Último repasse"
          value={last ? formatBRLShort(last.net_cents) : 'Nenhum'}
          hint={last ? `${formatMonth(last.month)} · ${last.status === 'paid' ? `pago em ${formatDate(last.paid_at)}` : 'aprovado, a pagar'}` : 'ainda não houve repasse'}
          info="Valor líquido que chegou a você: aluguel recebido menos a taxa de administração e as despesas suas do mês."
        />
      </section>

      <Section title="Aprovações pendentes" actions={<Badge tone={pending ? 'orange' : 'success'}>{pending ? `${pending} esperando você` : 'Nada pendente'}</Badge>}>
        {pending === 0 ? (
          <p className="text-sm text-muted">Nada esperando a sua decisão agora. Quando um orçamento passar do limite combinado ou uma etapa precisar do seu sim, ele aparece aqui.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.quotes.map((r) => (
              <RequestLine
                key={r.id}
                r={r}
                detail={
                  <>
                    <span>Orçamento de manutenção · {r.unit_label}</span>
                    <span className="num font-semibold text-text">{formatBRL(r.quote_cents ?? 0)}</span>
                    {r.vendor_name && <span>{r.vendor_name}</span>}
                  </>
                }
              >
                <Button size="sm" variant="primary" icon={<Check className="size-4" aria-hidden="true" />} onClick={() => setDeciding({ r, approve: true })}>
                  Aprovar
                </Button>
                <Button size="sm" icon={<X className="size-4" aria-hidden="true" />} onClick={() => setDeciding({ r, approve: false })}>
                  Recusar
                </Button>
              </RequestLine>
            ))}
            {data.approvals.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    <span>{t.process_name}</span>
                    {t.contract_id && (
                      <Link to="/contratos/$contractId" params={{ contractId: t.contract_id }} className="text-primary hover:underline">
                        Contrato {t.contract_code}
                      </Link>
                    )}
                    {t.due_date && <span>Prazo: {formatDate(t.due_date)}</span>}
                  </p>
                </div>
                <Button size="sm" variant="primary" icon={<Check className="size-4" aria-hidden="true" />} onClick={() => setApproving(t)}>
                  Aprovar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Próximos vencimentos de contrato" actions={<Link to="/contratos" className="text-sm font-medium text-primary hover:underline">Ver contratos</Link>}>
        {data.upcomingEnds.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma locação vigente nas suas unidades.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.upcomingEnds.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1 basis-56 text-sm">
                  <Link to="/contratos/$contractId" params={{ contractId: k.id }} className="font-semibold text-primary hover:underline">
                    {k.code}
                  </Link>{' '}
                  <span>{k.unit_label}</span>
                  <p className="text-xs text-muted">{k.lessee_name ? `Inquilino: ${k.lessee_name}` : 'Sem inquilino'}</p>
                </div>
                <span className="flex items-center gap-2 text-sm">
                  <span className="num">{formatDate(k.end_date)}</span>
                  <Badge tone={k.days_to_end <= 60 ? 'warning' : 'neutral'}>{k.days_to_end === 0 ? 'termina hoje' : `em ${k.days_to_end} ${k.days_to_end === 1 ? 'dia' : 'dias'}`}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {deciding && <DecideQuoteDialog request={deciding.r} approve={deciding.approve} onClose={() => setDeciding(null)} />}
      <ConfirmDialog
        open={!!approving}
        onOpenChange={(o) => !o && setApproving(null)}
        title="Aprovar esta etapa?"
        message={
          approving && (
            <p>
              <strong>{approving.title}</strong>. Fica registrado que você aprovou, e a imobiliária segue para a próxima etapa ({approving.process_name.toLowerCase()}).
            </p>
          )
        }
        confirmLabel="Aprovar"
        loading={approve.isPending}
        onConfirm={() => approving && approve.mutate({ id: approving.id })}
      />
    </>
  )
}

/* ---------------------------------------------------------------- inquilino */

const LIST_MAX = 6

function LesseePart({ data }: { data: LesseeHome }) {
  const [opening, setOpening] = useState(false)
  const k = data.contract
  const overdue = data.openEntries.filter((e) => e.state === 'overdue')
  return (
    <>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Section title="Meu contrato" actions={k && <Link to="/contratos/$contractId" params={{ contractId: k.id }} className="text-sm font-medium text-primary hover:underline">Ver contrato</Link>}>
          {k ? (
            <DescriptionList
              columns={1}
              items={[
                { label: 'Unidade', value: k.unit_label },
                {
                  label: 'Vigência',
                  value: (
                    <span className="flex flex-col gap-1">
                      {formatDate(k.start_date)} a {formatDate(k.end_date)}
                      {/* Vigente com o prazo já vencido: diz isso, em vez de parecer tudo em dia. */}
                      {k.days_to_end < 0 ? (
                        <span>
                          <Badge tone="warning">Prazo terminou em {formatDate(k.end_date)}</Badge>
                        </span>
                      ) : (
                        <span>
                          <Badge tone={CONTRACT_STATUS_TONE[k.status]}>{CONTRACT_STATUS[k.status]}</Badge>
                        </span>
                      )}
                    </span>
                  ),
                },
                { label: 'Aluguel', value: <span className="num">{formatBRL(k.rent_cents)}</span> },
                {
                  label: 'Próximo vencimento',
                  value: data.nextDue ? (
                    <span className="num">
                      {formatDate(data.nextDue.due_date)} · <strong>{formatBRL(data.nextDue.open_cents)}</strong>
                    </span>
                  ) : (
                    'Nada a vencer'
                  ),
                },
              ]}
            />
          ) : (
            <p className="text-sm text-muted">Nenhum contrato de locação no seu nome.</p>
          )}
        </Section>
        <Section
          title="Cobranças em aberto"
          className="lg:col-span-2"
          actions={<Link to="/financeiro" className="text-sm font-medium text-primary hover:underline">Ver todas</Link>}
        >
          {overdue.length > 0 && (
            <p className="mb-3 rounded-lg bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-sm font-medium text-danger-fg">
              {overdue.length} {overdue.length === 1 ? 'cobrança vencida' : 'cobranças vencidas'}: {formatBRL(overdue.reduce((a, e) => a + e.open_cents, 0))} em aberto.
            </p>
          )}
          {data.openEntries.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma cobrança em aberto. Tudo em dia.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {data.openEntries.slice(0, LIST_MAX).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1 basis-48 text-sm">
                    <p className="font-medium">{e.description || ENTRY_CATEGORY[e.category]}</p>
                    <p className="text-xs text-muted">Vence em {formatDate(e.due_date)}</p>
                  </div>
                  <span className="flex items-center gap-2">
                    <Badge tone={e.state === 'overdue' ? 'danger' : 'neutral'}>{e.state === 'overdue' ? `Vencida há ${e.days_overdue} ${e.days_overdue === 1 ? 'dia' : 'dias'}` : 'A vencer'}</Badge>
                    <span className="num text-sm font-semibold">{formatBRL(e.open_cents)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.openEntries.length > LIST_MAX && <p className="mt-2 text-xs text-muted">E mais {data.openEntries.length - LIST_MAX}: veja todas em Cobranças.</p>}
        </Section>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section
          title="Meus chamados"
          actions={
            <Button size="sm" variant="primary" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setOpening(true)}>
              Abrir chamado
            </Button>
          }
        >
          {data.requests.length === 0 ? (
            <p className="text-sm text-muted">Nenhum chamado. Vazamento, tomada sem energia, porta emperrada: abra um chamado e a imobiliária cuida.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {data.requests.slice(0, LIST_MAX).map((r) => (
                <RequestLine key={r.id} r={r} detail={<span>Aberto em {formatDate(r.created_at.slice(0, 10))}</span>}>
                  <StatusBadge status={r.status} />
                </RequestLine>
              ))}
            </ul>
          )}
          {data.requests.length > LIST_MAX && (
            <Link to="/manutencao" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
              Ver todos os {data.requests.length} chamados
            </Link>
          )}
        </Section>
        {/* A lista inteira mora em "Meus contratos" desde 07/11 (a tela Documentos saiu do menu). */}
        <Section title="Documentos" actions={<Link to="/contratos" className="text-sm font-medium text-primary hover:underline">Ver todos</Link>}>
          {data.documents.length === 0 ? (
            <p className="text-sm text-muted">Nenhum documento liberado para você ainda.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {data.documents.slice(0, LIST_MAX).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <FileText className="size-4 shrink-0 text-muted" aria-hidden="true" />
                    <span className="truncate">{d.name}</span>
                  </span>
                  <button className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-surface-2" onClick={() => demoDownload(d)} aria-label={`Baixar ${d.name}`}>
                    <Download className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      {opening && <OpenRequestDialog onClose={() => setOpening(false)} />}
    </>
  )
}

/* ---------------------------------------------------------------- prestador */

const VENDOR_GROUPS: { title: string; statuses: MaintenanceStatus[]; empty: string }[] = [
  { title: 'Para iniciar', statuses: ['approved'], empty: 'Nenhum serviço aprovado esperando você começar.' },
  { title: 'Em execução', statuses: ['in_progress'], empty: 'Nenhum serviço em andamento.' },
  { title: 'Aguardando o seu orçamento', statuses: ['quote'], empty: 'Nenhum pedido de orçamento. Mande o orçamento à imobiliária, que registra aqui.' },
  { title: 'Aguardando o proprietário', statuses: ['awaiting_owner'], empty: 'Nenhum orçamento esperando o proprietário.' },
]
const DONE_SHOWN = 5

function VendorPart({ requests }: { requests: VendorRequest[] }) {
  const [completing, setCompleting] = useState<VendorRequest | null>(null)
  const start = useRepoMutation(startWork, { success: (r) => `Execução do ${r.code} iniciada.` })
  const by = (sts: MaintenanceStatus[]) => requests.filter((r) => sts.includes(r.status))
  const done = by(['done']).sort((a, b) => ((a.closed_at ?? '') < (b.closed_at ?? '') ? 1 : -1))
  const late = requests.filter((r) => r.late).length
  const detail = (r: VendorRequest) => (
    <>
      <span>{r.address}</span>
      <span>{r.unit_label}</span>
      <PriorityBadge priority={r.priority} />
      <span className="inline-flex items-center gap-1">
        Prazo: <DueDate date={r.due_date} late={r.late} />
      </span>
    </>
  )
  return (
    <>
      <section aria-label="Resumo dos seus chamados" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Para iniciar" value={by(['approved']).length} hint="orçamento aprovado" />
        <KpiTile label="Em execução" value={by(['in_progress']).length} hint="serviço começado" />
        <KpiTile label="Aguardando orçamento" value={by(['quote']).length} hint="mande o orçamento" />
        <KpiTile label="Atrasados" value={late} tone={late ? 'danger' : undefined} hint="passaram do prazo" />
      </section>
      {VENDOR_GROUPS.map((g) => {
        const items = by(g.statuses)
        return (
          <Section key={g.title} title={`${g.title} (${items.length})`}>
            {items.length === 0 ? (
              <p className="text-sm text-muted">{g.empty}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {items.map((r) => (
                  <RequestLine key={r.id} r={r} detail={detail(r)}>
                    {r.status === 'approved' && (
                      <Button size="sm" variant="primary" icon={<Play className="size-4" aria-hidden="true" />} loading={start.isPending && start.variables?.id === r.id} loadingText="Iniciando…" onClick={() => start.mutate({ id: r.id })}>
                        Iniciar execução
                      </Button>
                    )}
                    {r.status === 'in_progress' && (
                      <Button size="sm" variant="primary" icon={<Check className="size-4" aria-hidden="true" />} onClick={() => setCompleting(r)}>
                        Concluir serviço
                      </Button>
                    )}
                    {!['approved', 'in_progress'].includes(r.status) && <Badge tone="neutral">{MAINTENANCE_STATUS[r.status]}</Badge>}
                  </RequestLine>
                ))}
              </ul>
            )}
          </Section>
        )
      })}
      <Section title={`Concluídos recentemente (${done.length})`}>
        {done.length === 0 ? (
          <p className="text-sm text-muted">Nenhum serviço concluído ainda.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {done.slice(0, DONE_SHOWN).map((r) => (
              <RequestLine key={r.id} r={r} detail={<span>{r.unit_label} · concluído em {formatDate(r.closed_at?.slice(0, 10))}</span>}>
                <StatusBadge status={r.status} />
              </RequestLine>
            ))}
          </ul>
        )}
        {done.length > DONE_SHOWN && (
          <Link to="/manutencao" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
            Ver todos os chamados
          </Link>
        )}
      </Section>
      {completing && <CompleteDialog request={completing} byVendor onClose={() => setCompleting(null)} />}
    </>
  )
}
