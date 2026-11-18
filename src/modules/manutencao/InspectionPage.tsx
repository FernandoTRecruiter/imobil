/* =============================================================================
   Detalhe da vistoria: cabeçalho -> dados -> (na de saída) o que piorou -> checklist por cômodo.

   Agendada + equipe com permissão = checklist EDITÁVEL: estado de cada item (bom, regular,
   ruim, não vistoriado), observação, incluir e remover item e cômodo, salvar aos poucos e
   concluir. Concluída (ou quem não edita) = só leitura.
   Na de saída, a comparação com a de entrada atualiza AO VIVO enquanto o checklist é preenchido.

   PERDA DE DADO EVITADA: com alteração não salva, sair da tela (pelo menu ou fechando a aba)
   pergunta antes. O checklist pode ter dezenas de itens: perder isso por um clique custa caro.
   ============================================================================= */
import { useState, type ReactNode } from 'react'
import { Link, useBlocker } from '@tanstack/react-router'
import { ArrowLeft, Download, FileText, Plus, Printer, Trash2 } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal } from '@/auth/permissions'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { CONDITION } from '@/data/labels'
import type { Condition, InspectionRoom } from '@/data/types'
import { formatDate, formatDateTime } from '@/lib/dates'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { Card, DescriptionList, DetailHeader, Section } from '@/components/ui/Layout'
import { ErrorState, PageSkeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/components/ui/cn'
import { openReport, reportHtml } from './laudo'
import { demoDownload } from './RequestPage'
import { ConditionBadge } from './ui'
import { completeInspection, CONDITIONS, getInspection, INSPECTION_STATUS, KIND_PHRASE, saveChecklist, worsenedItems, type InspectionDetail, type WorseItem } from './vistorias'

const STATUS_TONE = { scheduled: 'primary', done: 'success', canceled: 'neutral' } as const

export function InspectionPage({ id }: { id: string }) {
  const q = useRepo('vistoria', (s) => getInspection(s, id), [id])
  return (
    <Guard action="maintenance:view" what="as vistorias">
      <Link to="/vistorias" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted hover:text-text">
        <ArrowLeft className="size-4" aria-hidden="true" /> Vistorias
      </Link>
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <PageSkeleton /> : <InspectionView detail={q.data} />}
    </Guard>
  )
}

/** Abre o laudo; avisa se o navegador bloqueou a janela nova. */
function useReport() {
  const s = useSession()
  const toast = useToast()
  return (d: InspectionDetail) => {
    const ok = openReport(reportHtml(d, s.org.name, formatDateTime(new Date().toISOString(), s.org.timezone)))
    if (!ok) toast.error('O navegador bloqueou a janela do laudo. Libere as janelas deste site e tente de novo.')
  }
}

function InspectionView({ detail }: { detail: InspectionDetail }) {
  const s = useSession()
  const report = useReport()
  const i = detail.inspection
  const editable = i.status === 'scheduled' && !isPortal(s) && can(s, 'maintenance:edit')
  return (
    <>
      <DetailHeader
        title={`Vistoria ${KIND_PHRASE[i.kind]} · ${i.unit_code}`}
        badge={<Badge tone={STATUS_TONE[i.status]}>{INSPECTION_STATUS[i.status]}</Badge>}
        meta={
          <>
            <span>{i.property_name}</span>
            <span>{i.done_date ? `Feita em ${formatDate(i.done_date)}` : `Agendada para ${formatDate(i.scheduled_date)}`}</span>
          </>
        }
        actions={
          !editable && (
            <Button icon={<Printer className="size-4" aria-hidden="true" />} onClick={() => report(detail)}>
              Gerar laudo
            </Button>
          )
        }
      />
      <Section title="Dados da vistoria">
        <DescriptionList
          columns={3}
          items={[
            {
              label: 'Unidade',
              value: isPortal(s) && s.roles.includes('vendor') ? i.unit_label : (
                <Link to="/unidades/$unitId" params={{ unitId: i.unit_id }} className="text-primary hover:underline">
                  {i.unit_label}
                </Link>
              ),
            },
            { label: 'Endereço', value: detail.address },
            {
              label: 'Contrato',
              value: i.contract_id ? (
                <Link to="/contratos/$contractId" params={{ contractId: i.contract_id }} className="text-primary hover:underline">
                  {i.contract_code}
                </Link>
              ) : 'Sem contrato',
            },
            { label: 'Agendada para', value: formatDate(i.scheduled_date) },
            { label: 'Feita em', value: i.done_date ? formatDate(i.done_date) : 'Ainda não feita' },
            { label: 'Vistoriador', value: i.inspector_name ?? 'A definir' },
          ]}
        />
      </Section>
      {editable ? (
        <ChecklistEditor key={i.updated_at} detail={detail} onReport={report} />
      ) : (
        <>
          {i.kind === 'move_out' && <Comparison baselineDate={detail.baseline?.inspection.done_date ?? null} worse={detail.baseline?.worse ?? null} anyChecked={i.items_checked > 0} />}
          <ChecklistView rooms={i.rooms} />
        </>
      )}
      {detail.documents.length > 0 && (
        <Section title="Documentos da vistoria">
          <ul className="divide-y divide-border">
            {detail.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
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
        </Section>
      )}
    </>
  )
}

/** Na vistoria de saída: o que piorou desde a entrada (a base de desconto de caução ou reparo). */
function Comparison({ baselineDate, worse, anyChecked }: { baselineDate: string | null; worse: WorseItem[] | null; anyChecked: boolean }) {
  return (
    <Section
      title="Comparação com a vistoria de entrada"
      info="Liga cômodo e item pelo nome. Piorou = o estado na saída é pior que na entrada (bom > regular > ruim). Item não vistoriado em uma das duas fica de fora."
    >
      {!worse ? (
        <p className="text-sm text-muted">Não há vistoria de entrada concluída desta unidade para comparar.</p>
      ) : !anyChecked ? (
        <p className="text-sm text-muted">Entrada de {formatDate(baselineDate)}. A comparação aparece conforme os itens forem avaliados.</p>
      ) : worse.length === 0 ? (
        <p className="text-sm">Entrada de {formatDate(baselineDate)}: <strong>nenhum item piorou</strong>.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Entrada de {formatDate(baselineDate)}: <strong className="text-danger-fg">{worse.length} {worse.length === 1 ? 'item piorou' : 'itens pioraram'}</strong>.
          </p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {worse.map((w) => (
              <li key={`${w.room}|${w.item}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 basis-48 font-medium">
                  {w.room} · {w.item}
                </span>
                <span className="flex items-center gap-1.5">
                  <ConditionBadge condition={w.from} />
                  <span aria-label="virou">→</span>
                  <ConditionBadge condition={w.to} />
                </span>
                {w.note && <span className="w-full text-xs text-muted">{w.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

/** Checklist só para ler (vistoria concluída, ou quem não edita). */
function ChecklistView({ rooms }: { rooms: InspectionRoom[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rooms.map((r) => (
        <Section key={r.name} title={r.name}>
          <ul className="divide-y divide-border">
            {r.items.map((it, j) => (
              <li key={`${it.name}-${j}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
                <span className="min-w-0">{it.name}</span>
                <ConditionBadge condition={it.condition} />
                {it.note && <span className="w-full text-xs text-muted">{it.note}</span>}
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  )
}

/** Cópia funda do checklist, para editar sem mexer no que veio do banco. */
function cloneRooms(rooms: InspectionRoom[]): InspectionRoom[] {
  return rooms.map((r) => ({ name: r.name, items: r.items.map((it) => ({ ...it })) }))
}

const SEG_ACTIVE: Record<Condition, string> = {
  good: 'peer-checked:bg-[color-mix(in_srgb,var(--success)_14%,transparent)] peer-checked:text-[var(--success-fg)] peer-checked:border-[var(--success)]',
  fair: 'peer-checked:bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] peer-checked:text-[var(--warning-fg)] peer-checked:border-[var(--warning)]',
  poor: 'peer-checked:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] peer-checked:text-[var(--danger-fg)] peer-checked:border-[var(--danger)]',
  na: 'peer-checked:bg-surface-2 peer-checked:text-text peer-checked:border-border-strong',
}

/**
 * Checklist editável. Estado local (o que a pessoa está preenchendo); "Salvar" grava aos poucos e
 * "Concluir" grava e fecha. Depois de salvar, a tela recarrega e este bloco renasce com o salvo
 * (a chave do componente é a hora da última gravação).
 */
function ChecklistEditor({ detail, onReport }: { detail: InspectionDetail; onReport: (d: InspectionDetail) => void }) {
  const i = detail.inspection
  const [rooms, setRooms] = useState<InspectionRoom[]>(() => cloneRooms(i.rooms))
  const [confirming, setConfirming] = useState(false)
  const save = useRepoMutation(saveChecklist, { success: 'Checklist salvo.' })
  const complete = useRepoMutation(completeInspection, { success: 'Vistoria concluída. O laudo já pode ser gerado.', onSuccess: () => setConfirming(false) })
  const dirty = JSON.stringify(rooms) !== JSON.stringify(i.rooms)
  const busy = save.isPending || complete.isPending

  // Sair com alteração não salva: pergunta antes (navegação no app e fechar ou recarregar a aba).
  useBlocker({
    shouldBlockFn: () => (dirty && !busy ? !window.confirm('O checklist tem alterações não salvas. Sair mesmo assim e perder o que foi preenchido?') : false),
    enableBeforeUnload: () => dirty && !busy,
  })

  const items = rooms.flatMap((r) => r.items)
  const pending = items.filter((x) => x.condition === 'na').length
  const checked = items.length - pending
  const baseline = detail.baseline
  const liveWorse = baseline ? worsenedItems(baseline.inspection.rooms, rooms) : null

  /* Ajudantes que trocam UM pedaço do checklist sem mexer no resto (estado imutável). */
  const setRoom = (ri: number, patch: Partial<InspectionRoom>) => setRooms((rs) => rs.map((r, k) => (k === ri ? { ...r, ...patch } : r)))
  const setItem = (ri: number, ii: number, patch: Partial<InspectionRoom['items'][number]>) =>
    setRooms((rs) => rs.map((r, k) => (k !== ri ? r : { ...r, items: r.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) })))

  const payload = { id: i.id, rooms }
  const draftDetail: InspectionDetail = { ...detail, inspection: { ...i, rooms }, baseline: baseline ? { ...baseline, worse: liveWorse ?? [] } : null }

  return (
    <>
      {i.kind === 'move_out' && <Comparison baselineDate={baseline?.inspection.done_date ?? null} worse={liveWorse} anyChecked={checked > 0} />}
      <Card className="z-20 flex flex-wrap sm:sticky sm:top-[80px] items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm" aria-live="polite">
          <strong className="num">{checked}</strong> de <span className="num">{items.length}</span> itens avaliados
          {dirty && <span className="ml-2 font-medium text-warning-fg">· alterações não salvas</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Printer className="size-4" aria-hidden="true" />} onClick={() => onReport(draftDetail)}>
            Laudo (rascunho)
          </Button>
          <Button disabled={!dirty || busy} loading={save.isPending} onClick={() => save.mutate(payload)}>
            Salvar
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => setConfirming(true)}>
            Concluir vistoria
          </Button>
        </div>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {rooms.map((room, ri) => (
          <Card key={ri} className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
              <label className="min-w-0 flex-1 basis-40">
                <span className="sr-only">Nome do cômodo {ri + 1}</span>
                <Input value={room.name} onChange={(e) => setRoom(ri, { name: e.target.value })} placeholder="Nome do cômodo" className="font-semibold" />
              </label>
              <div className="flex items-center gap-1">
                <IconButton label={`Remover o cômodo ${room.name || ri + 1}`} disabled={rooms.length === 1} onClick={() => setRooms((rs) => rs.filter((_, k) => k !== ri))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
            </div>
            <ul className="divide-y divide-border">
              {room.items.map((it, ii) => (
                <li key={ii} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Item {ii + 1} de {room.name || 'cômodo'}</span>
                      <Input value={it.name} onChange={(e) => setItem(ri, ii, { name: e.target.value })} placeholder="O que foi vistoriado" />
                    </label>
                    <IconButton label={`Remover ${it.name || 'item'}`} disabled={room.items.length === 1} onClick={() => setRoom(ri, { items: room.items.filter((_, j) => j !== ii) })}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </IconButton>
                  </div>
                  <fieldset className="flex flex-wrap gap-1.5">
                    <legend className="sr-only">Estado de {it.name || 'item'}</legend>
                    {CONDITIONS.map((c) => (
                      <label key={c} className="cursor-pointer">
                        <input type="radio" className="peer sr-only" name={`c-${ri}-${ii}`} checked={it.condition === c} onChange={() => setItem(ri, ii, { condition: c })} />
                        <span
                          className={cn(
                            'inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-muted peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] hover:border-border-strong',
                            SEG_ACTIVE[c],
                          )}
                        >
                          {CONDITION[c]}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <label>
                    <span className="sr-only">Observação de {it.name || 'item'}</span>
                    <Input value={it.note} onChange={(e) => setItem(ri, ii, { note: e.target.value })} placeholder="Observação (opcional)" />
                  </label>
                </li>
              ))}
            </ul>
            <div className="border-t border-border px-4 py-2">
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setRoom(ri, { items: [...room.items, { name: '', condition: 'na', note: '' }] })}>
                Incluir item
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <div>
        <Button icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setRooms((rs) => [...rs, { name: '', items: [{ name: '', condition: 'na', note: '' }] }])}>
          Incluir cômodo
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Concluir a vistoria de ${i.unit_code}?`}
        message={
          <>
            <p>
              {checked} de {items.length} itens avaliados.
              {pending > 0 && ` ${pending} ${pending === 1 ? 'fica' : 'ficam'} como "Não vistoriado".`}
            </p>
            <p className="mt-2 text-muted">Depois de concluída, o checklist não muda mais: vale como registro e laudo.</p>
          </>
        }
        confirmLabel="Concluir vistoria"
        loading={complete.isPending}
        onConfirm={() => complete.mutate(payload)}
      />
    </>
  )
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40" aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}
