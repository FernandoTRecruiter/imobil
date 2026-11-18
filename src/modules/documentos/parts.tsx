/* =============================================================================
   Documentos onde eles moram (07/11/2026). A tela Documentos saiu do menu: documento sempre
   pertence a alguma coisa, então ele aparece e é anexado ali (pedido do Fernando: "deixar anexar
   documentos com contratos e imóveis"). Este arquivo tem as peças que esses lugares usam:
     - DocumentList: a lista curta (linha aberta do contrato e da pessoa), com "Anexar documento";
     - AttachDocumentDialog: enviar (só o registro, na demonstração) com "Pertence a" fixo ou escolhido;
     - DocumentActions: Baixar, Quem vê, Arquivar (com Desfazer), por linha;
     - MyDocuments: a lista inteira do proprietário ou do inquilino, em "Meus contratos";
     - DocumentsRedirect: o endereço antigo /documentos leva a quem chega ao lugar dos documentos dele.
   Quem vê o quê é o repositório (see.document): a tela só esconde botões.
   ============================================================================= */
import { useState } from 'react'
import { Link, Navigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { DropdownMenu } from 'radix-ui'
import { Archive, Download, Ellipsis, Eye, FilePlus2, FileText } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, isPortal, type Action } from '@/auth/permissions'
import type { Session } from '@/auth/session'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox, Field, Input, Select } from '@/components/ui/Field'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { useRepo, useRepoMutation } from '@/data/hooks'
import type { DocumentFile } from '@/data/types'
import { csvMoney, downloadText } from '@/lib/csv'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatDate } from '@/lib/dates'
import { useListState } from '@/lib/useListState'
import {
  archiveDocument, LINK_KIND_LABEL, listAttachTargets, listDocuments, setVisibility, uploadDocument, uploadSchema, VISIBILITY_LABEL,
  type AttachGroup, type DocumentRow, type LinkKind, type UploadInput,
} from './repo'

/* ---------------------------------------------------------------- endereço antigo /documentos */

/**
 * Para onde o endereço antigo /documentos leva (dado da sessão, por isso é componente e não beforeLoad):
 *   - equipe: Imóveis, porque o imóvel é o centro (a aba "Documentos e histórico" de cada um junta os
 *     documentos dele, das unidades e dos contratos);
 *   - proprietário e inquilino: "Meus contratos", onde fica a lista inteira dos documentos dele;
 *   - quem não vê documento (prestador): null, e a porta mostra "Sem acesso", como antes.
 */
export function documentsHome(s: Session): '/imoveis' | '/contratos' | null {
  if (!can(s, 'documents:view')) return null
  return isPortal(s) ? '/contratos' : '/imoveis'
}

export function DocumentsRedirect() {
  const s = useSession()
  const to = documentsHome(s)
  return <Guard action="documents:view" what="os documentos">{to && <Navigate to={to} replace />}</Guard>
}

/* ---------------------------------------------------------------- baixar, quem vê, arquivar */

/** No modo de demonstração não há arquivo guardado: o download entrega um aviso no lugar. */
export function demoDownload(d: Pick<DocumentFile, 'name'>) {
  downloadText(`${d.name}.txt`, `Arquivo de demonstração: "${d.name}".\n\nNo Imobil de verdade (fase 2) o download usa um link assinado que expira em poucos minutos.`, 'text/plain;charset=utf-8')
}

type VisibilityKey = DocumentRow['visibilityKey']
export const visibilityOf = (d: Pick<DocumentFile, 'visible_to_owner' | 'visible_to_lessee'>): VisibilityKey =>
  d.visible_to_owner && d.visible_to_lessee ? 'both' : d.visible_to_owner ? 'owner' : d.visible_to_lessee ? 'lessee' : 'internal'

const MENU_ITEM = 'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 outline-none data-[highlighted]:bg-surface-2'

/**
 * Ações de um documento. Portal: só baixar (botão com ícone). Equipe: menu com Baixar, Quem vê e
 * Arquivar; arquivar avisa com "Desfazer" em vez de perguntar antes (regra da casa).
 */
export function DocumentActions({ doc }: { doc: DocumentFile }) {
  const s = useSession()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const archive = useRepoMutation(archiveDocument, { silent: true })
  if (isPortal(s)) {
    return (
      <Button size="sm" variant="ghost" icon={<Download className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={() => demoDownload(doc)} aria-label={`Baixar ${doc.name}`}>
        Baixar
      </Button>
    )
  }
  const onArchive = () =>
    archive.mutate({ id: doc.id }, { onSuccess: () => toast.success(`"${doc.name}" arquivado.`, { label: 'Desfazer', onClick: () => archive.mutate({ id: doc.id, restore: true }) }) })
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-surface-2" aria-label={`Ações de ${doc.name}`}>
            <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" className="z-50 min-w-44 rounded-xl border border-border bg-surface p-1 text-sm shadow-pop">
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => demoDownload(doc)}>
              <Download className="size-4" strokeWidth={1.5} aria-hidden="true" /> Baixar
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setEditing(true)}>
              <Eye className="size-4" strokeWidth={1.5} aria-hidden="true" /> Quem vê
            </DropdownMenu.Item>
            <DropdownMenu.Item className={`${MENU_ITEM} text-danger-fg`} onSelect={onArchive}>
              <Archive className="size-4" strokeWidth={1.5} aria-hidden="true" /> Arquivar
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {editing && <VisibilityDialog doc={doc} onClose={() => setEditing(false)} />}
    </>
  )
}

function VisibilityDialog({ doc, onClose }: { doc: DocumentFile; onClose: () => void }) {
  const [owner, setOwner] = useState(doc.visible_to_owner)
  const [lessee, setLessee] = useState(doc.visible_to_lessee)
  const save = useRepoMutation(setVisibility, { success: 'Visibilidade atualizada.', onSuccess: onClose })
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Quem vê este documento"
      description={doc.name}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ id: doc.id, owner, lessee })}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <Checkbox label="Proprietário vê no portal" checked={owner} onChange={(e) => setOwner(e.target.checked)} />
        <Checkbox label="Inquilino vê no portal" checked={lessee} onChange={(e) => setLessee(e.target.checked)} />
      </div>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- anexar */

/**
 * Janela "Anexar documento". `target` fixo ("contract:<id>", na linha aberta do contrato) ou
 * `around` (a aba do imóvel ou da unidade): aí o "Pertence a" lista o imóvel, os contratos e as
 * unidades dali (listAttachTargets). Na demonstração só o registro é guardado, não o arquivo.
 * "Quem vê no portal" começa como o caso mais comum do lugar: contrato, os dois; o resto, só o dono.
 */
export function AttachDocumentDialog({ target, targetLabel, around, onClose }: { target?: string; targetLabel?: string; around?: { propertyId: string } | { unitId: string }; onClose: () => void }) {
  const aroundKey = around ? ('unitId' in around ? `u:${around.unitId}` : `p:${around.propertyId}`) : ''
  const groups = useRepo('documentos:onde-anexar', (sess) => (around ? listAttachTargets(sess, around) : Promise.resolve([] as AttachGroup[])), [aroundKey], { enabled: !!around })
  const save = useRepoMutation(uploadDocument, { success: (d) => `"${d.name}" anexado.`, onSuccess: onClose })
  const contract = target?.startsWith('contract:') ?? false
  const form = useForm<UploadInput>({ resolver: zodResolver(uploadSchema), mode: 'onBlur', defaultValues: { name: '', target: target ?? '', owner: true, lessee: contract, size: 0, mime: '' } })
  const { register, handleSubmit, setValue, formState } = form
  const submit = handleSubmit((v) => save.mutate(v))
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Anexar documento"
      description={targetLabel ? `Pertence a: ${targetLabel}. No modo de demonstração só o registro é guardado; o arquivo em si, não.` : 'No modo de demonstração só o registro é guardado; o arquivo em si, não.'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} loadingText="Anexando…" onClick={submit}>
            Anexar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label="Arquivo" hint="PDF, imagem ou planilha, até 20 MB." error={formState.errors.size?.message}>
          {({ id, describedBy }) => (
            <input
              id={id}
              aria-describedby={describedBy}
              type="file"
              className="text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface-2 file:px-3 file:py-2 file:text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                setValue('size', f.size, { shouldValidate: true })
                setValue('mime', f.type)
                if (!form.getValues('name')) setValue('name', f.name, { shouldValidate: true })
              }}
            />
          )}
        </Field>
        <Field label="Nome do documento" required error={formState.errors.name?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('name')} />}
        </Field>
        {!target && (
          <Field label="Pertence a" required error={formState.errors.target?.message ?? (groups.error instanceof Error ? groups.error.message : undefined)}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('target')}>
                <option value="">{groups.isLoading ? 'Carregando…' : 'Escolha o imóvel, o contrato ou a unidade'}</option>
                {groups.data?.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Quem vê no portal</legend>
          <Checkbox label="Proprietário" {...register('owner')} />
          <Checkbox label="Inquilino" {...register('lessee')} />
          <p className="text-xs text-muted">Sem marcar nenhum, só a equipe vê.</p>
        </fieldset>
      </form>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- lista curta */

/**
 * Lista curta de documentos (linha aberta do contrato ou da pessoa): nome que baixa, data, quem vê
 * (só a equipe lê isso) e as ações. "Anexar documento" aparece para a equipe, com o vínculo fixo.
 */
export function DocumentList({ docs, loading, error, onRetry, attach, empty }: { docs: DocumentFile[] | undefined; loading: boolean; error: unknown; onRetry: () => void; attach?: { target: string; label: string }; empty: string }) {
  const s = useSession()
  const team = !isPortal(s)
  const [attaching, setAttaching] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : loading || !docs ? (
        <Skeleton className="h-12" />
      ) : !docs.length ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden="true" />
                <span className="min-w-0">
                  <button type="button" className="block min-h-6 max-w-full truncate text-left text-sm font-medium hover:underline" onClick={() => demoDownload(d)} title="Baixar">
                    {d.name}
                  </button>
                  <span className="block text-xs text-muted">
                    <span className="num">{formatDate(d.created_at.slice(0, 10))}</span>
                    {team && ` · ${VISIBILITY_LABEL[visibilityOf(d)].toLowerCase()}`}
                  </span>
                </span>
              </span>
              <DocumentActions doc={d} />
            </li>
          ))}
        </ul>
      )}
      {team && attach && (
        <Button size="sm" className="w-fit" icon={<FilePlus2 className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={() => setAttaching(true)}>
          Anexar documento
        </Button>
      )}
      {attaching && attach && <AttachDocumentDialog target={attach.target} targetLabel={attach.label} onClose={() => setAttaching(false)} />}
    </div>
  )
}

/* ---------------------------------------------------------------- portal: todos os meus documentos */

/** Para onde o vínculo do documento leva, se a pessoa pode abrir aquele lugar (senão, o rótulo fica sem link). */
const OPENS: Record<LinkKind, Action> = { contract: 'contracts:view', unit: 'properties:view', property: 'properties:view', person: 'people:view', maintenance: 'maintenance:view', inspection: 'maintenance:view' }

/**
 * A lista inteira dos documentos do proprietário ou do inquilino (o que a tela Documentos mostrava
 * no portal), em "Meus contratos" quando nada está escolhido. Busca, filtro, ordem e exportar.
 */
export function MyDocuments() {
  const s = useSession()
  const list = useListState('meus-documentos')
  const q = useRepo('documentos:meus', (sess) => listDocuments(sess, list.params), [list.params])
  const columns: Column<DocumentRow>[] = [
    {
      key: 'name', header: 'Documento', sortable: true, firstDir: 'asc',
      cell: (d) => (
        <span className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-muted" strokeWidth={1.5} aria-hidden="true" />
          <button type="button" className="min-h-6 truncate text-left font-medium hover:underline" onClick={() => demoDownload(d)} title="Baixar">
            {d.name}
          </button>
        </span>
      ),
    },
    {
      key: 'link', header: 'Pertence a', sortable: true, firstDir: 'asc', hideBelow: 'sm',
      cell: (d) =>
        can(s, OPENS[d.linkKind]) ? (
          <Link to={d.linkHref} className="text-primary hover:underline">
            {LINK_KIND_LABEL[d.linkKind]} {d.linkLabel}
          </Link>
        ) : (
          `${LINK_KIND_LABEL[d.linkKind]} ${d.linkLabel}`
        ),
    },
    { key: 'created_at', header: 'Enviado em', sortable: true, firstDir: 'desc', align: 'right', cell: (d) => formatDate(d.created_at.slice(0, 10)) },
  ]
  const exportList = async (format: ExportFormat) => {
    const all = await listDocuments(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable(
      'meus-documentos.csv',
      all.rows,
      [
        { label: 'Documento', value: (d) => d.name },
        { label: 'Pertence a', value: (d) => `${LINK_KIND_LABEL[d.linkKind]} ${d.linkLabel}` },
        { label: 'Tamanho (KB)', value: (d) => csvMoney(Math.round((d.size / 1024) * 100)) },
        { label: 'Enviado em', value: (d) => formatDate(d.created_at.slice(0, 10)) },
      ],
      format,
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <ListToolbar
        state={list}
        noun={['documento', 'documentos']}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={q.data?.facets}
        onExport={exportList}
        searchPlaceholder="Buscar por nome ou registro"
        filters={[{ key: 'vinculo', label: 'Pertence a', options: Object.entries(LINK_KIND_LABEL).map(([value, label]) => ({ value, label })) }]}
      />
      <DataTable
        caption="Meus documentos"
        columns={columns}
        rows={q.data?.rows}
        rowKey={(d) => d.id}
        sort={list.sort}
        onSort={list.toggleSort}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState title="Nenhum documento" description={list.activeFilterCount ? 'Nenhum documento passa nos filtros ligados. Limpe os filtros para ver todos.' : 'Quando a administração liberar um documento para você, ele aparece aqui.'} />}
      />
      {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
    </div>
  )
}

/** Selo "quem vê", para as tabelas da equipe (aba Documentos e histórico do imóvel e da unidade). */
export function VisibilityBadge({ value }: { value: VisibilityKey }) {
  return <Badge tone={value === 'internal' ? 'neutral' : 'primary'}>{VISIBILITY_LABEL[value]}</Badge>
}
