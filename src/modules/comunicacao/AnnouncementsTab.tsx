/* =============================================================================
   Comunicados (aba Automações e comunicados, em Tarefas): os avisos da administração aos inquilinos e proprietários.

   - Lista: título, público, imóvel (ou "Todos os imóveis"), quando foi enviado e para quantas
     pessoas. Rascunho fica em cima (é o que falta fazer).
   - "Novo comunicado": título, texto, público e imóvel. Enquanto a pessoa escolhe, a janela mostra
     quantas pessoas recebem; o botão diz o número ("Enviar para 55 pessoas"), para ninguém mandar
     no escuro. Dá para guardar como rascunho e enviar depois (pela lista, com confirmação).
   - Enviar = e-mail para cada pessoa (simulado na demonstração) e aviso no portal de quem tem
     acesso. Enviado, não muda nem reenvia (quem leu, leu aquilo).
   Quem escreve e envia: a equipe com "editar processos" (o administrador sempre). Quem só vê
   processos, vê a lista.
   ============================================================================= */
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Send } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can } from '@/auth/permissions'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { ANNOUNCEMENT_AUDIENCE } from '@/data/labels'
import type { AnnouncementAudience } from '@/data/types'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatDateTime } from '@/lib/dates'
import { useListState } from '@/lib/useListState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { DescriptionList } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, Skeleton } from '@/components/ui/States'
import {
  announcementSchema, AUDIENCES, listAnnouncementProperties, listAnnouncements, previewRecipients, saveAnnouncement, sendAnnouncement,
  type AnnouncementRow, type RecipientPreview, type SendResult,
} from './repo'

/** "55 pessoas" / "1 pessoa". */
function people(n: number): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? 'pessoa' : 'pessoas'}`
}

/** O que o aviso no canto diz depois do envio (com quem ficou sem e-mail, quando houver). */
function sentText(r: SendResult): string {
  const base = `"${r.announcement.title}" enviado para ${people(r.people)}: ${r.emails} ${r.emails === 1 ? 'e-mail simulado' : 'e-mails simulados'} e ${r.notices} ${r.notices === 1 ? 'aviso' : 'avisos'} no portal.`
  return r.missing ? `${base} ${people(r.missing)} sem e-mail no cadastro.` : base
}

/** Frase do recorte: "Vai para 55 pessoas; 1 tem acesso ao portal e recebe o aviso lá também." */
function previewText(p: RecipientPreview): string {
  if (p.total === 0) return 'Ninguém neste recorte: troque o público ou o imóvel.'
  const login = p.withLogin ? `; ${p.withLogin} ${p.withLogin === 1 ? 'tem' : 'têm'} acesso ao portal e ${p.withLogin === 1 ? 'recebe' : 'recebem'} o aviso lá também` : ''
  const noMail = p.total - p.withEmail
  return `Vai para ${people(p.total)}${login}.${noMail ? ` ${people(noMail)} sem e-mail no cadastro.` : ''}`
}

export function AnnouncementsTab() {
  const s = useSession()
  const list = useListState('comunicados')
  const q = useRepo('comunicados', (sess) => listAnnouncements(sess, list.params), [list.params])
  const props = useRepo('comunicados:imoveis', listAnnouncementProperties)
  const [editing, setEditing] = useState<AnnouncementRow | 'novo' | null>(null)
  const [viewing, setViewing] = useState<AnnouncementRow | null>(null)
  const [sending, setSending] = useState<AnnouncementRow | null>(null)
  const edit = can(s, 'workflows:edit')

  const columns: Column<AnnouncementRow>[] = [
    {
      key: 'title', header: 'Comunicado', sortable: true, firstDir: 'asc',
      cell: (a) => (
        <span className="flex min-w-0 flex-col items-start">
          <button
            className="max-w-80 truncate text-left font-medium hover:text-primary hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              setViewing(a)
            }}
          >
            {a.title}
          </button>
          <span className="max-w-80 truncate text-xs text-muted">{a.body}</span>
          {/* No celular as colunas de público e imóvel somem: o resumo vem para cá. */}
          <span className="text-xs text-muted md:hidden">
            {ANNOUNCEMENT_AUDIENCE[a.audience]} · {a.property_name ?? 'Todos os imóveis'}
          </span>
        </span>
      ),
    },
    { key: 'audience', header: 'Público', hideBelow: 'md', cell: (a) => <span className="whitespace-nowrap">{ANNOUNCEMENT_AUDIENCE[a.audience]}</span> },
    { key: 'property', header: 'Imóvel', hideBelow: 'md', cell: (a) => <span className="block max-w-56 truncate">{a.property_name ?? 'Todos os imóveis'}</span> },
    {
      key: 'sent_at', header: 'Enviado em', sortable: true, firstDir: 'desc',
      cell: (a) => (a.sent_at ? <span className="whitespace-nowrap">{formatDateTime(a.sent_at, s.org.timezone)}</span> : <Badge tone="warning">Rascunho</Badge>),
    },
    { key: 'recipients', header: 'Destinatários', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'sm', cell: (a) => (a.sent_at ? a.recipients.toLocaleString('pt-BR') : null) },
    {
      key: 'acoes', header: '', className: 'w-44',
      cell: (a) =>
        !a.sent_at && edit ? (
          <span className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(a)
              }}
            >
              Editar
            </Button>
            <Button
              size="sm"
              icon={<Send className="size-4" strokeWidth={1.5} aria-hidden="true" />}
              onClick={(e) => {
                e.stopPropagation()
                setSending(a)
              }}
            >
              Enviar
            </Button>
          </span>
        ) : null,
    },
  ]

  const exportList = async (format: ExportFormat) => {
    const all = await listAnnouncements(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable(
      'comunicados.csv',
      all.rows,
      [
        { label: 'Título', value: (a) => a.title },
        { label: 'Texto', value: (a) => a.body },
        { label: 'Público', value: (a) => ANNOUNCEMENT_AUDIENCE[a.audience] },
        { label: 'Imóvel', value: (a) => a.property_name ?? 'Todos os imóveis' },
        { label: 'Enviado em', value: (a) => (a.sent_at ? formatDateTime(a.sent_at, s.org.timezone) : 'Rascunho') },
        { label: 'Destinatários', value: (a) => (a.sent_at ? a.recipients : '') },
      ],
      format,
    )
  }

  return (
    <>
      <ListToolbar
        state={list}
        noun={['comunicado', 'comunicados']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        onExport={exportList}
        searchPlaceholder="Buscar comunicado ou imóvel"
        filters={[
          { key: 'situacao', label: 'Situação', options: [{ value: 'rascunho', label: 'Rascunhos' }, { value: 'enviado', label: 'Enviados' }] },
          { key: 'publico', label: 'Público', options: AUDIENCES.map((v) => ({ value: v, label: ANNOUNCEMENT_AUDIENCE[v] })) },
          { key: 'imovel', label: 'Imóvel', options: [{ value: 'todos', label: 'Todos os imóveis' }, ...(props.data ?? []).map((p) => ({ value: p.id, label: p.name }))] },
        ]}
      >
        {edit && (
          <Button variant="primary" icon={<Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={() => setEditing('novo')}>
            Novo comunicado
          </Button>
        )}
      </ListToolbar>
      <DataTable
        caption="Comunicados"
        columns={columns}
        rows={q.data?.rows}
        rowKey={(a) => a.id}
        sort={list.sort}
        onSort={list.toggleSort}
        onRowClick={setViewing}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={
          <EmptyState
            title="Nenhum comunicado encontrado"
            description={list.activeFilterCount ? 'Nenhum comunicado passa nos filtros ligados. Limpe os filtros para ver todos.' : 'Obra no prédio, assembleia, falta de água: escreva uma vez e o aviso chega a cada inquilino ou proprietário.'}
            action={!list.activeFilterCount && edit ? <Button onClick={() => setEditing('novo')}>Novo comunicado</Button> : undefined}
          />
        }
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}

      {editing && <AnnouncementDialog row={editing === 'novo' ? null : editing} onClose={() => setEditing(null)} />}
      {viewing && (
        <ViewDialog
          row={viewing}
          canEdit={edit}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing)
            setViewing(null)
          }}
          onSend={() => {
            setSending(viewing)
            setViewing(null)
          }}
        />
      )}
      {sending && <SendConfirm row={sending} onClose={() => setSending(null)} />}
    </>
  )
}

/** Comunicado aberto: o texto inteiro e os dados do envio. Rascunho ganha "Editar" e "Enviar". */
function ViewDialog({ row: a, canEdit, onClose, onEdit, onSend }: { row: AnnouncementRow; canEdit: boolean; onClose: () => void; onEdit: () => void; onSend: () => void }) {
  const s = useSession()
  const draft = !a.sent_at
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={a.title}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>Fechar</Button>
          {draft && canEdit && <Button onClick={onEdit}>Editar</Button>}
          {draft && canEdit && (
            <Button variant="primary" icon={<Send className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={onSend}>
              Enviar
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <DescriptionList
          items={[
            { label: 'Público', value: ANNOUNCEMENT_AUDIENCE[a.audience] },
            { label: 'Imóvel', value: a.property_name ?? 'Todos os imóveis' },
            { label: 'Enviado em', value: a.sent_at ? formatDateTime(a.sent_at, s.org.timezone) : 'Rascunho, ainda não enviado' },
            { label: 'Destinatários', value: a.sent_at ? people(a.recipients) : 'Definidos no envio' },
            { label: 'Escrito por', value: a.author_name ?? '' },
          ]}
        />
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Texto</p>
          <p className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{a.body}</p>
        </div>
      </div>
    </Dialog>
  )
}

/** Confirmação do envio de um rascunho, com o número de pessoas do recorte de AGORA. */
function SendConfirm({ row: a, onClose }: { row: AnnouncementRow; onClose: () => void }) {
  const preview = useRepo('comunicados:previa', (sess) => previewRecipients(sess, { audience: a.audience, property_id: a.property_id ?? '' }), [a.audience, a.property_id])
  const send = useRepoMutation(sendAnnouncement, { success: sentText, onSuccess: onClose })
  const p = preview.data
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Enviar "${a.title}"?`}
      message={
        <div className="flex flex-col gap-2">
          <p>
            {ANNOUNCEMENT_AUDIENCE[a.audience]} de {a.property_name ?? 'todos os imóveis'}.
          </p>
          <p className="text-muted">{p ? previewText(p) : 'Contando quem recebe…'}</p>
          <p className="text-muted">Na demonstração o e-mail é simulado (fica na caixa de saída). Depois de enviado, o comunicado não muda.</p>
        </div>
      }
      confirmLabel={p ? `Enviar para ${people(p.total)}` : 'Enviar'}
      loading={send.isPending}
      onConfirm={() => send.mutate({ id: a.id })}
    />
  )
}

const formSchema = announcementSchema.omit({ id: true, send: true })
type FormValues = { title: string; body: string; audience: AnnouncementAudience; property_id: string }

/** "Novo comunicado" ou edição de rascunho. Só monta o formulário depois que a lista de imóveis chega. */
function AnnouncementDialog({ row, onClose }: { row: AnnouncementRow | null; onClose: () => void }) {
  const props = useRepo('comunicados:imoveis', listAnnouncementProperties)
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={row ? 'Editar rascunho' : 'Novo comunicado'}
      description="O texto vai por e-mail e aparece no portal de quem tem acesso."
      size="md"
    >
      {props.data ? <AnnouncementForm row={row} properties={props.data} onClose={onClose} /> : <Skeleton className="h-80" />}
    </Dialog>
  )
}

function AnnouncementForm({ row, properties, onClose }: { row: AnnouncementRow | null; properties: { id: string; name: string }[]; onClose: () => void }) {
  const save = useRepoMutation(saveAnnouncement, {
    success: (r) => (r.announcement.sent_at ? sentText(r) : `Rascunho "${r.announcement.title}" salvo.`),
    onSuccess: onClose,
  })
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onBlur',
    defaultValues: { title: row?.title ?? '', body: row?.body ?? '', audience: row?.audience ?? 'lessees', property_id: row?.property_id ?? '' },
  })
  const { register, handleSubmit, formState, control } = form
  // O recorte é recontado a cada troca de público ou imóvel (é o número que aparece no botão).
  const audience = useWatch({ control, name: 'audience' })
  const propertyId = useWatch({ control, name: 'property_id' })
  const preview = useRepo('comunicados:previa', (sess) => previewRecipients(sess, { audience, property_id: propertyId }), [audience, propertyId])
  const total = preview.data?.total
  const submit = (send: boolean) => handleSubmit((v) => save.mutate({ ...v, id: row?.id ?? '', send }))
  const sendingNow = save.isPending && save.variables?.send

  return (
    <form className="flex flex-col gap-4" onSubmit={submit(true)} noValidate>
      <Field label="Título" required error={formState.errors.title?.message}>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder="Ex.: Manutenção do elevador do Bloco B" {...register('title')} />}
      </Field>
      <Field label="Texto" required hint="O que acontece, quando e o que a pessoa precisa fazer." error={formState.errors.body?.message}>
        {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} className="min-h-32" {...register('body')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quem recebe" required error={formState.errors.audience?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('audience')}>
              {AUDIENCES.map((v) => (
                <option key={v} value={v}>
                  {ANNOUNCEMENT_AUDIENCE[v]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Imóvel" error={formState.errors.property_id?.message}>
          {({ id, describedBy, invalid }) => (
            <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('property_id')}>
              <option value="">Todos os imóveis</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <p className="text-sm text-muted" aria-live="polite">
        {preview.data ? previewText(preview.data) : 'Contando quem recebe…'}
      </p>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button onClick={onClose}>Cancelar</Button>
        <Button loading={save.isPending && !sendingNow} disabled={save.isPending} onClick={submit(false)}>
          Salvar rascunho
        </Button>
        <Button
          type="submit"
          variant="primary"
          icon={<Send className="size-4" strokeWidth={1.5} aria-hidden="true" />}
          loading={!!sendingNow}
          loadingText="Enviando…"
          disabled={save.isPending || total === 0}
        >
          {total === undefined ? 'Enviar' : `Enviar para ${people(total)}`}
        </Button>
      </div>
    </form>
  )
}
