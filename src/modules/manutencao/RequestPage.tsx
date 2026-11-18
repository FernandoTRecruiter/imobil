/* =============================================================================
   Detalhe do chamado: cabeçalho -> etapas -> "O que fazer agora" -> dados, documentos e
   linha do tempo.

   "O que fazer agora" muda com o PAPEL e a SITUAÇÃO:
   - equipe (com permissão de editar): triar, atribuir prestador, registrar orçamento, concluir,
     cancelar, definir quem paga, anexar; o administrador registra a resposta do proprietário;
   - proprietário: aprovar ou recusar o orçamento das unidades dele;
   - prestador: iniciar a execução e concluir com observação;
   - inquilino: acompanha.
   Os botões só aparecem para quem pode; quem confere de verdade é o repositório.
   ============================================================================= */
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Ban, Check, Download, FileText, Paperclip, Play, Wallet, X } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal } from '@/auth/permissions'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { CHARGED_TO, MAINTENANCE_CATEGORY } from '@/data/labels'
import type { DocumentFile } from '@/data/types'
import type { MaintenanceRow } from '@/data/views/finance'
import { downloadText } from '@/lib/csv'
import { formatDate, formatDateTime } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Card, DescriptionList, DetailHeader, Section, Stepper, Timeline } from '@/components/ui/Layout'
import { ErrorState, PageSkeleton } from '@/components/ui/States'
import { AssignVendorDialog, AttachDialog, CancelDialog, ChargedToDialog, CompleteDialog, DecideQuoteDialog, formatSize, QuoteDialog, TriageDialog } from './dialogs'
import { FLOW_STEPS, flowStep, getRequestDetail, OWNER_APPROVAL_ABOVE_CENTS, startWork, type RequestDetail } from './repo'
import { DueDate, PriorityBadge, StatusBadge } from './ui'

type DialogKind = 'triage' | 'vendor' | 'quote' | 'approve' | 'reject' | 'complete' | 'cancel' | 'charged' | 'attach'

const QUOTE_STATUS = { none: 'Sem orçamento', pending: 'Aguardando o proprietário', approved: 'Aprovado', rejected: 'Recusado' } as const

/** No modo de demonstração não há arquivo guardado: o download entrega um aviso no lugar. */
export function demoDownload(d: Pick<DocumentFile, 'name'>) {
  downloadText(`${d.name}.txt`, `Arquivo de demonstração: "${d.name}".\n\nNo Imobil de verdade (fase 2) o download usa um link assinado que expira em poucos minutos.`, 'text/plain;charset=utf-8')
}

export function RequestPage({ id }: { id: string }) {
  const q = useRepo('chamado', (s) => getRequestDetail(s, id), [id])
  return (
    <Guard action="maintenance:view" what="os chamados de manutenção">
      <BackLink />
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <PageSkeleton /> : <RequestView detail={q.data} />}
    </Guard>
  )
}

function BackLink() {
  return (
    <Link to="/manutencao" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted hover:text-text">
      <ArrowLeft className="size-4" aria-hidden="true" /> Chamados
    </Link>
  )
}

function RequestView({ detail }: { detail: RequestDetail }) {
  const s = useSession()
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const r = detail.request
  const vendorOnly = s.roles.length === 1 && s.roles[0] === 'vendor'
  const step = flowStep(r.status)
  const close = () => setDialog(null)
  return (
    <>
      <DetailHeader
        title={r.title}
        badge={
          <>
            <StatusBadge status={r.status} />
            <PriorityBadge priority={r.priority} />
          </>
        }
        meta={
          <>
            <span className="font-semibold text-text">{r.code}</span>
            {vendorOnly || !r.unit_id ? (
              <span>{r.unit_label}</span>
            ) : (
              <Link to="/unidades/$unitId" params={{ unitId: r.unit_id }} className="text-primary hover:underline">
                {r.unit_label}
              </Link>
            )}
            <span>
              Aberto em {formatDate(r.created_at.slice(0, 10))} por {detail.opened_by}
            </span>
          </>
        }
        actions={
          !isPortal(s) && can(s, 'maintenance:edit') && r.status !== 'canceled' ? (
            <Button icon={<Paperclip className="size-4" aria-hidden="true" />} onClick={() => setDialog('attach')}>
              Anexar
            </Button>
          ) : undefined
        }
      />

      <Card className="overflow-x-auto px-4 py-3">
        {step === -1 ? (
          <p className="flex items-center gap-2 text-sm">
            <Ban className="size-4 text-muted" aria-hidden="true" />
            Chamado cancelado{r.closed_at ? ` em ${formatDate(r.closed_at.slice(0, 10))}` : ''}. O motivo está na linha do tempo.
          </p>
        ) : (
          <Stepper steps={FLOW_STEPS} current={step} />
        )}
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Section title="O que fazer agora">
            <NextStep request={r} onOpen={setDialog} />
          </Section>
          <Section title="Dados do chamado">
            <DescriptionList
              items={[
                { label: 'Categoria', value: MAINTENANCE_CATEGORY[r.category] },
                { label: 'Prazo', value: <DueDate date={r.due_date} late={r.late} /> },
                { label: 'Prestador', value: r.vendor_name ?? 'A definir' },
                { label: 'Responsável na equipe', value: r.assignee_name ?? 'A definir' },
                {
                  label: 'Orçamento',
                  value: r.quote_cents ? `${formatBRL(r.quote_cents)} · ${QUOTE_STATUS[r.quote_status]}` : 'Sem orçamento',
                  info: `Acima de ${formatBRL(OWNER_APPROVAL_ABOVE_CENTS)} o proprietário aprova; até esse valor, a equipe aprova direto.`,
                },
                { label: 'Quem paga', value: r.charged_to ? CHARGED_TO[r.charged_to] : 'A definir' },
                { label: 'Endereço', value: detail.address },
                { label: 'Encerrado em', value: r.closed_at ? formatDateTime(r.closed_at, s.org.timezone) : 'Em aberto' },
              ]}
            />
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted">Relato</p>
              <p className="mt-1 text-sm whitespace-pre-line [overflow-wrap:anywhere]">{r.description || <span className="text-muted">Sem detalhes além do título.</span>}</p>
            </div>
          </Section>
          {/* O prestador também vê: o escopo (see.document) entrega só os anexos do chamado dele. */}
          <DocumentsSection documents={detail.documents} />
        </div>
        <Section title="Linha do tempo" className="min-w-0">
          <Timeline items={detail.timeline.map((t) => ({ id: t.id, when: formatDateTime(t.at, s.org.timezone), title: t.summary, who: t.who }))} />
        </Section>
      </div>

      {dialog === 'triage' && <TriageDialog request={r} onClose={close} />}
      {dialog === 'vendor' && <AssignVendorDialog request={r} onClose={close} />}
      {dialog === 'quote' && <QuoteDialog request={r} onClose={close} />}
      {(dialog === 'approve' || dialog === 'reject') && <DecideQuoteDialog request={r} approve={dialog === 'approve'} onBehalf={!isPortal(s)} onClose={close} />}
      {dialog === 'complete' && <CompleteDialog request={r} byVendor={vendorOnly} onClose={close} />}
      {dialog === 'cancel' && <CancelDialog request={r} onClose={close} />}
      {dialog === 'charged' && <ChargedToDialog request={r} onClose={close} />}
      {dialog === 'attach' && <AttachDialog request={r} onClose={close} />}
    </>
  )
}

/** O texto do próximo passo + os botões que ESTA pessoa pode apertar agora. */
function NextStep({ request: r, onOpen }: { request: MaintenanceRow; onOpen: (d: DialogKind) => void }) {
  const s = useSession()
  const team = !isPortal(s)
  const edit = team && can(s, 'maintenance:edit')
  const owner = isPortal(s) && can(s, 'quotes:approve')
  const vendor = can(s, 'maintenance:work')
  const start = useRepoMutation(startWork, { success: `Execução do ${r.code} iniciada.` })
  const value = formatBRL(r.quote_cents ?? 0)

  const text: Record<MaintenanceRow['status'], string> = {
    open: 'Aguardando a triagem da equipe.',
    triage: 'Triagem feita. Falta atribuir o prestador.',
    quote: r.quote_status === 'rejected' ? `O orçamento de ${value} foi recusado. Falta um novo orçamento (ou cancelar).` : `Aguardando o orçamento de ${r.vendor_name ?? 'o prestador'}.`,
    awaiting_owner: `Orçamento de ${value} esperando a aprovação do proprietário.`,
    approved: `Orçamento de ${value} aprovado. Aguardando o prestador iniciar.`,
    in_progress: 'Serviço em execução.',
    done: `Concluído${r.closed_at ? ` em ${formatDate(r.closed_at.slice(0, 10))}` : ''}.`,
    canceled: 'Chamado cancelado.',
  }

  const actions: ReactNode[] = []
  const add = (key: string, node: ReactNode) => actions.push(<span key={key}>{node}</span>)
  if (edit) {
    if (r.status === 'open') add('triar', <Button variant="primary" onClick={() => onOpen('triage')}>Fazer a triagem</Button>)
    if (r.status === 'triage') add('prestador', <Button variant="primary" onClick={() => onOpen('vendor')}>Atribuir o prestador</Button>)
    if (r.status === 'quote') {
      add('orcamento', <Button variant="primary" onClick={() => onOpen('quote')}>Registrar o orçamento</Button>)
      add('trocar', <Button onClick={() => onOpen('vendor')}>Trocar o prestador</Button>)
    }
    if (r.status === 'approved' || r.status === 'in_progress') add('concluir', <Button variant="primary" icon={<Check className="size-4" aria-hidden="true" />} onClick={() => onOpen('complete')}>Concluir o chamado</Button>)
  }
  if (r.status === 'awaiting_owner' && (owner || (team && can(s, 'quotes:approve')))) {
    add('aprovar', <Button variant="primary" icon={<Check className="size-4" aria-hidden="true" />} onClick={() => onOpen('approve')}>{owner ? 'Aprovar o orçamento' : 'Registrar aprovação do proprietário'}</Button>)
    add('recusar', <Button icon={<X className="size-4" aria-hidden="true" />} onClick={() => onOpen('reject')}>{owner ? 'Recusar' : 'Registrar recusa'}</Button>)
  }
  if (vendor && r.status === 'approved') add('iniciar', <Button variant="primary" icon={<Play className="size-4" aria-hidden="true" />} loading={start.isPending} loadingText="Iniciando…" onClick={() => start.mutate({ id: r.id })}>Iniciar a execução</Button>)
  if (vendor && r.status === 'in_progress') add('concluir-prestador', <Button variant="primary" icon={<Check className="size-4" aria-hidden="true" />} onClick={() => onOpen('complete')}>Concluir o serviço</Button>)
  if (edit && !['done', 'canceled'].includes(r.status)) {
    add('quem-paga', <Button variant="ghost" icon={<Wallet className="size-4" aria-hidden="true" />} onClick={() => onOpen('charged')}>{r.charged_to ? 'Trocar quem paga' : 'Definir quem paga'}</Button>)
    add('cancelar', <Button variant="ghost" className="text-danger-fg" icon={<Ban className="size-4" aria-hidden="true" />} onClick={() => onOpen('cancel')}>Cancelar o chamado</Button>)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{text[r.status]}</p>
      {actions.length > 0 ? <div className="flex flex-wrap gap-2">{actions}</div> : !['done', 'canceled'].includes(r.status) && <p className="text-xs text-muted">Nenhuma ação sua agora: a próxima é de outra pessoa. Você recebe um aviso quando mudar.</p>}
    </div>
  )
}

function DocumentsSection({ documents }: { documents: DocumentFile[] }) {
  return (
    <Section title="Documentos do chamado">
      {documents.length === 0 ? (
        <p className="text-sm text-muted">Nenhum anexo ainda. Fotos de quem abriu e o orçamento do prestador aparecem aqui.</p>
      ) : (
        <ul className="divide-y divide-border">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0 truncate text-sm">{d.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                <span className="hidden sm:inline">{formatSize(d.size)} · {formatDate(d.created_at.slice(0, 10))}</span>
                <button className="grid size-8 place-items-center rounded-lg text-text hover:bg-surface-2" onClick={() => demoDownload(d)} aria-label={`Baixar ${d.name}`}>
                  <Download className="size-4" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
