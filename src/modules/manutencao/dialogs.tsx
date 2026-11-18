/* =============================================================================
   manutencao/dialogs.tsx: as janelas de cada passo do chamado.

   Usadas pela tela de chamados, pelo detalhe do chamado e pelo Início do portal (o proprietário
   aprova ali mesmo; o prestador conclui ali mesmo). Cada janela:
   1. valida na tela com o MESMO esquema zod do repositório (erro com causa e conserto);
   2. grava pelo repositório (que confere de novo: a tela não é a única porta);
   3. avisa no canto o que aconteceu.

   ARMADILHA EVITADA: janela com lista que vem do banco (unidades, prestadores) só monta o
   formulário DEPOIS que a lista chega. Montar antes deixaria o formulário com a unidade vazia
   enquanto a tela mostra a única opção como escolhida (o valor guardado e o visto diferem).
   ============================================================================= */
import { useState, type ChangeEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { CHARGED_TO, MAINTENANCE_CATEGORY, PRIORITY } from '@/data/labels'
import type { MaintenanceRow } from '@/data/views/finance'
import { formatBRL, parseBRL } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/States'
import {
  assignVendor, attachToRequest, cancelRequest, CATEGORIES, CHARGED_OPTIONS, completeRequest, decideQuote, DUE_DAYS_BY_PRIORITY, listOpenTargets,
  listVendorOptions, openRequest, openRequestSchema, OWNER_APPROVAL_ABOVE_CENTS, PRIORITIES, registerQuote, setChargedTo, triageRequest,
  needsOwnerApproval, type FileInfo,
} from './repo'
import { useSession } from '@/auth/SessionProvider'

const MB = 1024 * 1024

/** Tamanho legível: 2.345.678 bytes -> "2,2 MB". */
export function formatSize(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Junta as opções por grupo (imóvel) para o <optgroup>, na ordem em que vieram. */
function grouped<T extends { group: string }>(list: T[]): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const it of list) m.set(it.group, [...(m.get(it.group) ?? []), it])
  return [...m]
}

/** Esqueleto do miolo da janela enquanto a lista chega. */
function FormSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Carregando">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-24" />
    </div>
  )
}

/**
 * Lista de arquivos escolhidos, com conferência de tipo e tamanho na hora (antes de enviar).
 * Devolve só o REGISTRO (nome, tamanho, tipo): no modo de demonstração o arquivo não é guardado.
 */
function FilePicker({ label, hint, accept, max, files, onChange }: { label: string; hint: string; accept?: string; max: number; files: FileInfo[]; onChange: (f: FileInfo[]) => void }) {
  const [error, setError] = useState<string | null>(null)
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = [...(e.target.files ?? [])]
    e.target.value = '' // deixa escolher o mesmo arquivo de novo depois de remover
    const problems: string[] = []
    const ok: FileInfo[] = []
    for (const f of chosen) {
      if (accept === 'image/*' && !f.type.startsWith('image/')) problems.push(`"${f.name}" não é foto`)
      else if (f.size > 10 * MB) problems.push(`"${f.name}" passa de 10 MB`)
      else ok.push({ name: f.name, size: f.size, mime: f.type })
    }
    const next = [...files, ...ok].slice(0, max)
    if (files.length + ok.length > max) problems.push(`no máximo ${max} arquivos`)
    setError(problems.length ? `Ficou de fora: ${problems.join('; ')}.` : null)
    onChange(next)
  }
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <div className="flex flex-col gap-2">
          <input
            id={id}
            aria-describedby={describedBy}
            type="file"
            accept={accept}
            multiple
            onChange={pick}
            className="text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface-2 file:px-3 file:py-2 file:text-sm"
          />
          {files.length > 0 && (
            <ul className="flex flex-col gap-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2 py-1 text-sm">
                  <span className="min-w-0 truncate">{f.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    {formatSize(f.size)}
                    <button type="button" className="min-h-6 rounded px-1.5 font-medium text-primary hover:underline" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remover ${f.name}`}>
                      Remover
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  )
}

/* ---------------------------------------------------------------- abrir chamado */

const openFormSchema = openRequestSchema.omit({ photos: true })
type OpenForm = z.infer<typeof openFormSchema>

/** "Abrir chamado": equipe escolhe entre todas as unidades; proprietário entre as dele; inquilino já vem com a dele. */
export function OpenRequestDialog({ onClose }: { onClose: () => void }) {
  const targets = useRepo('manutencao:unidades', listOpenTargets)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Abrir chamado" description="Conte o problema: a equipe faz a triagem e chama o prestador." size="md">
      {targets.data ? <OpenRequestForm targets={targets.data} onClose={onClose} /> : <FormSkeleton />}
    </Dialog>
  )
}

function OpenRequestForm({ targets, onClose }: { targets: { value: string; label: string; group: string }[]; onClose: () => void }) {
  const navigate = useNavigate()
  const [photos, setPhotos] = useState<FileInfo[]>([])
  const save = useRepoMutation(openRequest, {
    success: (r) => `Chamado ${r.code} aberto.`,
    onSuccess: (r) => {
      onClose()
      void navigate({ to: '/manutencao/$requestId', params: { requestId: r.id } })
    },
  })
  const form = useForm<OpenForm>({
    resolver: zodResolver(openFormSchema),
    mode: 'onBlur',
    // Uma unidade só (a inquilina): já vem escolhida.
    defaultValues: { unit_id: targets.length === 1 ? targets[0].value : '', priority: 'medium', title: '', description: '' },
  })
  const { register, handleSubmit, formState } = form
  const submit = handleSubmit((v) => save.mutate({ ...v, photos }))
  if (!targets.length) return <p className="text-sm text-muted">Não há unidade em que você possa abrir chamado.</p>
  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <Field label="Unidade" required error={formState.errors.unit_id?.message}>
        {({ id, describedBy, invalid }) => (
          <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('unit_id')}>
            {targets.length > 1 && <option value="">Escolha a unidade</option>}
            {grouped(targets).map(([g, items]) => (
              <optgroup key={g} label={g}>
                {items.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Categoria" required error={formState.errors.category?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('category')}>
              <option value="">Escolha</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MAINTENANCE_CATEGORY[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Prioridade" required hint="Urgente: risco ou vazamento ativo." error={formState.errors.priority?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY[p]} (prazo de {DUE_DAYS_BY_PRIORITY[p]} {DUE_DAYS_BY_PRIORITY[p] === 1 ? 'dia' : 'dias'})
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="O que aconteceu" required error={formState.errors.title?.message}>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder="Ex.: Vazamento na pia da cozinha" {...register('title')} />}
      </Field>
      <Field label="Detalhes" hint="Desde quando, onde exatamente, se piora com o uso." error={formState.errors.description?.message}>
        {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('description')} />}
      </Field>
      <FilePicker label="Fotos (opcional)" hint="Até 5 fotos de até 10 MB. Na demonstração só o registro da foto é guardado." accept="image/*" max={5} files={photos} onChange={setPhotos} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="primary" loading={save.isPending} loadingText="Abrindo…">
          Abrir chamado
        </Button>
      </div>
    </form>
  )
}

/* ---------------------------------------------------------------- equipe: triagem */

const triageFormSchema = z.object({
  category: z.enum(CATEGORIES, { message: 'Escolha a categoria.' }),
  priority: z.enum(PRIORITIES, { message: 'Escolha a prioridade.' }),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Escolha o prazo no calendário.'),
})

export function TriageDialog({ request, onClose }: { request: MaintenanceRow; onClose: () => void }) {
  const s = useSession()
  const save = useRepoMutation(triageRequest, { success: `Triagem do ${request.code} feita.`, onSuccess: onClose })
  const { register, handleSubmit, formState } = useForm<z.infer<typeof triageFormSchema>>({
    resolver: zodResolver(triageFormSchema),
    mode: 'onBlur',
    defaultValues: { category: request.category, priority: request.priority, due_date: request.due_date && request.due_date >= s.today ? request.due_date : s.today },
  })
  const submit = handleSubmit((v) => save.mutate({ id: request.id, ...v }))
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Fazer a triagem"
      description={`${request.code} · ${request.title}. Confira a categoria, a prioridade e o prazo. Você fica como responsável.`}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Concluir triagem
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit} noValidate>
        <Field label="Categoria" required error={formState.errors.category?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('category')}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MAINTENANCE_CATEGORY[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Prioridade" required error={formState.errors.priority?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Prazo" required className="sm:col-span-2" error={formState.errors.due_date?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="date" min={s.today} aria-describedby={describedBy} aria-invalid={invalid} {...register('due_date')} />}
        </Field>
      </form>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- equipe: prestador */

export function AssignVendorDialog({ request, onClose }: { request: MaintenanceRow; onClose: () => void }) {
  const vendors = useRepo('manutencao:prestadores', (s) => listVendorOptions(s, request.category), [request.category])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={request.vendor_person_id ? 'Trocar o prestador' : 'Atribuir o prestador'} description={`${request.code} · ${MAINTENANCE_CATEGORY[request.category]}. O chamado passa a esperar o orçamento dele.`} size="sm">
      {vendors.data ? <AssignVendorForm request={request} vendors={vendors.data} onClose={onClose} /> : <FormSkeleton />}
    </Dialog>
  )
}

function AssignVendorForm({ request, vendors, onClose }: { request: MaintenanceRow; vendors: Awaited<ReturnType<typeof listVendorOptions>>; onClose: () => void }) {
  const [vendor, setVendor] = useState(request.vendor_person_id ?? vendors.find((v) => v.fits)?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = useRepoMutation(assignVendor, { success: `Prestador do ${request.code} definido.`, onSuccess: onClose })
  const fit = vendors.filter((v) => v.fits)
  const others = vendors.filter((v) => !v.fits)
  const submit = () => (vendor ? save.mutate({ id: request.id, vendor_person_id: vendor }) : setError('Escolha o prestador.'))
  return (
    <div className="flex flex-col gap-4">
      <Field label="Prestador" required error={error} hint={fit.length ? `Primeiro os que atendem ${MAINTENANCE_CATEGORY[request.category].toLowerCase()}.` : `Nenhum prestador cadastrado para ${MAINTENANCE_CATEGORY[request.category].toLowerCase()}: mostrando todos.`}>
        {({ id, describedBy, invalid }) => (
          <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} value={vendor} onChange={(e) => { setVendor(e.target.value); setError(null) }}>
            <option value="">Escolha</option>
            {fit.length > 0 && (
              <optgroup label={`Atendem ${MAINTENANCE_CATEGORY[request.category]}`}>
                {fit.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Outros prestadores">
                {others.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.categories.map((c) => MAINTENANCE_CATEGORY[c]).join(', ')})
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={save.isPending} onClick={submit}>
          Salvar prestador
        </Button>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- equipe: orçamento */

const quoteFormSchema = z.object({
  valor: z.string().refine((v) => (parseBRL(v) ?? 0) > 0, 'Informe o valor em reais, por exemplo 850,00.'),
  charged_to: z.enum(CHARGED_OPTIONS, { message: 'Diga quem paga o serviço.' }),
})

export function QuoteDialog({ request, onClose }: { request: MaintenanceRow; onClose: () => void }) {
  const s = useSession()
  const save = useRepoMutation(registerQuote, {
    success: (r) => (r.status === 'awaiting_owner' ? `Orçamento registrado: ${r.code} aguarda o proprietário.` : `Orçamento registrado e aprovado: ${r.code} pronto para a execução.`),
    onSuccess: onClose,
  })
  const { register, handleSubmit, formState, control } = useForm<z.infer<typeof quoteFormSchema>>({
    resolver: zodResolver(quoteFormSchema),
    mode: 'onBlur',
    defaultValues: { valor: request.quote_cents ? String(request.quote_cents / 100).replace('.', ',') : '', charged_to: request.charged_to ?? 'owner' },
  })
  // useWatch (e não watch): lê o valor digitado sem quebrar a memorização do React.
  const typed = parseBRL(useWatch({ control, name: 'valor' }) ?? '')
  const route = typed && typed > 0 ? (needsOwnerApproval(s.org.kind, typed) ? `${formatBRL(typed)}: vai para a aprovação do proprietário.` : `${formatBRL(typed)}: fica aprovado direto.`) : null
  const submit = handleSubmit((v) => save.mutate({ id: request.id, quote_cents: parseBRL(v.valor)!, charged_to: v.charged_to }))
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Registrar o orçamento"
      description={`${request.code} · ${request.vendor_name ?? 'prestador'}. ${s.org.kind === 'agency' ? `Acima de ${formatBRL(OWNER_APPROVAL_ABOVE_CENTS)} o proprietário aprova; até esse valor, fica aprovado na hora.` : 'Fica aprovado na hora.'}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Registrar orçamento
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label="Valor do orçamento (R$)" required hint={route ?? 'Ex.: 850,00'} error={formState.errors.valor?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} inputMode="decimal" autoComplete="off" aria-describedby={describedBy} aria-invalid={invalid} {...register('valor')} />}
        </Field>
        <Field label="Quem paga" required hint="Proprietário ou imobiliária: a conta ao prestador é lançada ao concluir. Inquilino: ele paga direto." error={formState.errors.charged_to?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('charged_to')}>
              {CHARGED_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CHARGED_TO[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- proprietário: aprovar ou recusar */

const approveForm = z.object({ comment: z.string().trim().max(500, 'Comentário longo demais: até 500 caracteres.') })
const rejectForm = z.object({ comment: z.string().trim().min(5, 'Diga o motivo (pelo menos 5 letras): a equipe usa isso para buscar outro orçamento.').max(500, 'Motivo longo demais: até 500 caracteres.') })

/**
 * Aprovar (comentário opcional) ou recusar (motivo obrigatório) o orçamento.
 * onBehalf = a equipe registrando a resposta que o proprietário deu fora do sistema.
 */
export function DecideQuoteDialog({ request, approve, onBehalf, onClose }: { request: MaintenanceRow; approve: boolean; onBehalf?: boolean; onClose: () => void }) {
  const save = useRepoMutation(decideQuote, { success: approve ? `Orçamento do ${request.code} aprovado.` : `Orçamento do ${request.code} recusado.`, onSuccess: onClose })
  const { register, handleSubmit, formState } = useForm<{ comment: string }>({ resolver: zodResolver(approve ? approveForm : rejectForm), mode: 'onBlur', defaultValues: { comment: '' } })
  const submit = handleSubmit((v) => save.mutate({ id: request.id, approve, comment: v.comment }))
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={approve ? 'Aprovar o orçamento' : 'Recusar o orçamento'}
      description={`${request.code} · ${request.title} · ${request.unit_label}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant={approve ? 'primary' : 'danger'} loading={save.isPending} onClick={submit}>
            {approve ? 'Aprovar' : 'Recusar'} {formatBRL(request.quote_cents ?? 0)}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <p className="text-sm">
          Orçamento de <strong className="num">{formatBRL(request.quote_cents ?? 0)}</strong>
          {request.vendor_name ? ` de ${request.vendor_name}` : ''}
          {request.charged_to ? `, pago por: ${CHARGED_TO[request.charged_to].toLowerCase()}` : ''}.
        </p>
        {onBehalf && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">Use quando o proprietário respondeu por telefone ou e-mail. Fica gravado que foi você quem lançou.</p>}
        <Field label={approve ? 'Comentário (opcional)' : 'Motivo da recusa'} required={!approve} error={formState.errors.comment?.message}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} className="min-h-20" {...register('comment')} />}
        </Field>
      </form>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- concluir */

const completeForm = z.object({ note: z.string().trim().min(5, 'Conte em poucas palavras o que foi feito (pelo menos 5 letras).').max(1000, 'Observação longa demais: até 1.000 caracteres.') })

export function CompleteDialog({ request, byVendor, onClose }: { request: MaintenanceRow; byVendor?: boolean; onClose: () => void }) {
  const save = useRepoMutation(completeRequest, {
    success: (r) => (r.payable ? `${r.request.code} concluído. Conta a pagar de ${formatBRL(r.payable.amount_cents)} lançada.` : `${r.request.code} concluído.`),
    onSuccess: onClose,
  })
  const { register, handleSubmit, formState } = useForm<{ note: string }>({ resolver: zodResolver(completeForm), mode: 'onBlur', defaultValues: { note: '' } })
  const submit = handleSubmit((v) => save.mutate({ id: request.id, note: v.note }))
  const bill = request.quote_cents && (request.charged_to === 'owner' || request.charged_to === 'agency')
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={byVendor ? 'Concluir o serviço' : 'Concluir o chamado'}
      description={`${request.code} · ${request.title}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Concluir
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        {!byVendor && bill && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
            Ao concluir, entra no Financeiro a conta a pagar de <strong className="num">{formatBRL(request.quote_cents!)}</strong> para {request.vendor_name ?? 'o prestador'} (paga: {CHARGED_TO[request.charged_to!].toLowerCase()}).
          </p>
        )}
        <Field label="O que foi feito" required error={formState.errors.note?.message}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} className="min-h-20" placeholder="Ex.: troca do sifão e da vedação da pia" {...register('note')} />}
        </Field>
      </form>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- equipe: cancelar, quem paga, anexar */

const cancelForm = z.object({ reason: z.string().trim().min(5, 'Diga o motivo do cancelamento (pelo menos 5 letras).').max(500, 'Motivo longo demais: até 500 caracteres.') })

export function CancelDialog({ request, onClose }: { request: MaintenanceRow; onClose: () => void }) {
  const save = useRepoMutation(cancelRequest, { success: `Chamado ${request.code} cancelado.`, onSuccess: onClose })
  const { register, handleSubmit, formState } = useForm<{ reason: string }>({ resolver: zodResolver(cancelForm), mode: 'onBlur', defaultValues: { reason: '' } })
  const submit = handleSubmit((v) => save.mutate({ id: request.id, reason: v.reason }))
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Cancelar o chamado ${request.code}?`}
      description={`"${request.title}" fica na lista como cancelado, com a história. Não dá para reabrir.`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="danger" loading={save.isPending} onClick={submit}>
            Cancelar chamado
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <Field label="Motivo" required error={formState.errors.reason?.message}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} className="min-h-20" placeholder="Ex.: o inquilino resolveu por conta própria" {...register('reason')} />}
        </Field>
      </form>
    </Dialog>
  )
}

export function ChargedToDialog({ request, onClose }: { request: MaintenanceRow; onClose: () => void }) {
  const [value, setValue] = useState(request.charged_to ?? 'owner')
  const save = useRepoMutation(setChargedTo, { success: `Quem paga o ${request.code} atualizado.`, onSuccess: onClose })
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Quem paga o serviço"
      description="Proprietário ou imobiliária: a conta ao prestador é lançada ao concluir. Inquilino: ele paga direto ao prestador."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ id: request.id, charged_to: value })}>
            Salvar
          </Button>
        </>
      }
    >
      <Field label="Quem paga" required>
        {({ id }) => (
          <Select id={id} value={value} onChange={(e) => setValue(e.target.value as typeof value)}>
            {CHARGED_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CHARGED_TO[c]}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Dialog>
  )
}

export function AttachDialog({ request, onClose }: { request: MaintenanceRow; onClose: () => void }) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const save = useRepoMutation(attachToRequest, { success: (n) => `${n} ${n === 1 ? 'arquivo anexado' : 'arquivos anexados'} ao ${request.code}.`, onSuccess: onClose })
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Anexar ao chamado"
      description="Orçamento, nota fiscal ou foto. O proprietário vê no portal; o inquilino, não."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} disabled={!files.length} onClick={() => save.mutate({ id: request.id, files })}>
            Anexar
          </Button>
        </>
      }
    >
      <FilePicker label="Arquivos" hint="Até 10 arquivos de até 10 MB. Na demonstração só o registro é guardado." max={10} files={files} onChange={setFiles} />
    </Dialog>
  )
}
