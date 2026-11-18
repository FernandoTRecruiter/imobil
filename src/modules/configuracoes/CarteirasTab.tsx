/* =============================================================================
   Configurações > Carteiras e situações (primeira seção): grupos de imóveis (Residencial,
   Comercial...) para filtrar e,
   mais adiante, limitar o que cada colaborador vê. Só existe na conta de imobiliária.
   Excluir só carteira vazia: o repositório recusa e diz para onde mover os imóveis.
   ============================================================================= */
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { downloadTable } from '@/lib/exportar'
import { plural } from '@/lib/text'
import { useListState } from '@/lib/useListState'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog'
import { Field, Input } from '@/components/ui/Field'
import { Section } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { EmptyState } from '@/components/ui/States'
import { deletePortfolio, listPortfolios, portfolioSchema, savePortfolio, type PortfolioInput, type PortfolioRow } from './repo'

export function CarteirasTab() {
  const s = useSession()
  const list = useListState('config:carteiras')
  const q = useRepo('config:carteiras', (sess) => listPortfolios(sess, list.params), [list.params])
  const [editing, setEditing] = useState<PortfolioRow | 'nova' | null>(null)
  const [removing, setRemoving] = useState<PortfolioRow | null>(null)
  const del = useRepoMutation(deletePortfolio, { success: 'Carteira excluída.', onSuccess: () => setRemoving(null) })

  const columns: Column<PortfolioRow>[] = [
    {
      key: 'name', header: 'Carteira', sortable: true, firstDir: 'asc',
      cell: (p) => (
        <span className="flex items-center gap-2 font-medium">
          <span className="size-3 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden="true" />
          {p.name}
        </span>
      ),
    },
    { key: 'properties', header: 'Imóveis', sortable: true, firstDir: 'desc', align: 'right', cell: (p) => p.properties },
    { key: 'staff', header: 'Colaboradores limitados', align: 'right', hideBelow: 'sm', cell: (p) => p.limited_staff },
    {
      key: 'acoes', header: '', className: 'w-px',
      cell: (p) => (
        <span className="flex justify-end gap-1">
          <button className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text" aria-label={`Editar a carteira ${p.name}`} onClick={() => setEditing(p)}>
            <Pencil className="size-4" aria-hidden="true" />
          </button>
          <button className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger-fg" aria-label={`Excluir a carteira ${p.name}`} onClick={() => setRemoving(p)}>
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ]

  return (
    <Section
      title="Carteiras"
      actions={
        <Button size="sm" variant="primary" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setEditing('nova')}>
          Nova carteira
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <ListToolbar
          state={list}
          noun={['carteira', 'carteiras']}
          total={q.data?.total}
          totalAll={q.data?.totalAll}
          searchPlaceholder="Buscar carteira"
          onExport={async (format) => {
            const all = await listPortfolios(s, { ...list.params, page: 1, pageSize: 100_000 })
            await downloadTable('carteiras', all.rows, [{ label: 'Carteira', value: (p) => p.name }, { label: 'Cor', value: (p) => p.color }, { label: 'Imóveis', value: (p) => p.properties }], format)
          }}
        />
        <DataTable
          caption="Carteiras"
          columns={columns}
          rows={q.data?.rows}
          rowKey={(p) => p.id}
          sort={list.sort}
          onSort={list.toggleSort}
          loading={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={<EmptyState title="Nenhuma carteira" description={list.activeFilterCount ? 'Nada encontrado com essa busca.' : 'Crie carteiras para agrupar os imóveis.'} />}
        />
      </div>
      {editing && <PortfolioDialog portfolio={editing === 'nova' ? null : editing} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={`Excluir a carteira "${removing.name}"?`}
          message={
            removing.properties > 0 ? (
              <p>
                Ela tem {plural(removing.properties, 'imóvel', 'imóveis')}: a exclusão vai ser recusada. Mova os imóveis antes em Dados &gt; Data Manager &gt; Imóveis &gt; Mudar carteira.
              </p>
            ) : (
              <p>A carteira está vazia e some da lista. A auditoria guarda que ela existiu.</p>
            )
          }
          confirmLabel="Excluir"
          danger
          loading={del.isPending}
          onConfirm={() => del.mutate(removing.id)}
        />
      )}
    </Section>
  )
}

function PortfolioDialog({ portfolio, onClose }: { portfolio: PortfolioRow | null; onClose: () => void }) {
  const form = useForm<PortfolioInput>({ resolver: zodResolver(portfolioSchema), mode: 'onBlur', defaultValues: { id: portfolio?.id ?? null, name: portfolio?.name ?? '', color: portfolio?.color ?? '#0e7c66' } })
  const { register, handleSubmit, control, setValue, formState } = form
  const color = useWatch({ control, name: 'color' })
  const save = useRepoMutation(savePortfolio, { success: (p) => `Carteira "${p.name}" salva.`, onSuccess: onClose })
  const submit = handleSubmit((v) => save.mutate(v))
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={portfolio ? `Editar "${portfolio.name}"` : 'Nova carteira'}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Salvar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label="Nome" required error={formState.errors.name?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('name')} />}
        </Field>
        <Field label="Cor" required hint="Aparece ao lado do nome nas listas e no mapa." error={formState.errors.color?.message}>
          {({ id, describedBy, invalid }) => (
            <span className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Escolher a cor da carteira"
                className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1"
                value={/^#[0-9a-fA-F]{6}$/.test(color ?? '') ? color.toLowerCase() : '#0e7c66'}
                onChange={(e) => setValue('color', e.target.value, { shouldValidate: true })}
              />
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} className="font-mono uppercase" maxLength={7} {...register('color')} />
            </span>
          )}
        </Field>
      </form>
    </Dialog>
  )
}
