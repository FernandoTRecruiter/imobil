/* =============================================================================
   Configurações > Usuários e permissões (primeira seção): quem acessa a conta, com qual papel,
   e os convites pendentes.

   Desativar pede confirmação com o NOME de quem perde o acesso; o repositório recusa
   desativar a si mesmo e o último administrador. Convite de portal (proprietário,
   inquilino, prestador) precisa de uma pessoa do cadastro: é ela que define o que o
   convidado vai ver.
   ============================================================================= */
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Ban, MailX, RotateCcw, UserPlus } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { ROLE } from '@/data/labels'
import type { Role } from '@/data/types'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { formatDate } from '@/lib/dates'
import { useListState } from '@/lib/useListState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { Section } from '@/components/ui/Layout'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/States'
import { invitableRoles, inviteSchema, inviteUser, listInvitablePeople, listInvitations, listMembers, PORTAL_ROLES, revokeInvitation, setMemberStatus, type InvitationRow, type InviteInput, type MemberRow } from './repo'

const STATUS_LABEL: Record<MemberRow['status'], string> = { active: 'Ativo', disabled: 'Desativado', invited: 'Convidado' }
const STATUS_TONE = { active: 'success', disabled: 'neutral', invited: 'warning' } as const
const ROLE_TONE = { admin: 'primary', staff: 'primary', owner: 'orange', lessee: 'warning', vendor: 'neutral' } as const

export function UsuariosTab() {
  return (
    <div className="flex flex-col gap-4">
      <Members />
      <Invitations />
    </div>
  )
}

function Members() {
  const s = useSession()
  const list = useListState('config:usuarios')
  const q = useRepo('config:usuarios', (sess) => listMembers(sess, list.params), [list.params])
  const [confirm, setConfirm] = useState<MemberRow | null>(null)
  const [inviting, setInviting] = useState(false)
  const status = useRepoMutation(setMemberStatus, { success: (m) => (m.status === 'disabled' ? 'Acesso desativado.' : 'Acesso reativado.'), onSuccess: () => setConfirm(null) })

  const columns: Column<MemberRow>[] = [
    {
      key: 'name', header: 'Pessoa', sortable: true, firstDir: 'asc',
      cell: (m) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {m.name}
            {m.is_me && <span className="font-normal text-muted"> (você)</span>}
          </span>
          <span className="truncate text-xs text-muted">{m.email}</span>
        </span>
      ),
    },
    { key: 'role', header: 'Papel', sortable: true, firstDir: 'asc', cell: (m) => <Badge tone={ROLE_TONE[m.role]}>{ROLE[m.role]}</Badge> },
    { key: 'person', header: 'Pessoa ligada', hideBelow: 'md', cell: (m) => m.person_name ?? <span className="text-muted">Equipe</span> },
    { key: 'status', header: 'Situação', sortable: true, firstDir: 'asc', cell: (m) => <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge> },
    { key: 'created_at', header: 'Desde', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'lg', cell: (m) => formatDate(m.created_at.slice(0, 10)) },
    {
      key: 'acoes', header: '', className: 'w-px',
      cell: (m) =>
        m.status === 'disabled' ? (
          <Button size="sm" icon={<RotateCcw className="size-4" aria-hidden="true" />} loading={status.isPending && status.variables?.id === m.id} onClick={() => status.mutate({ id: m.id, status: 'active' })} aria-label={`Reativar o acesso de ${m.name}`}>
            <span className="hidden sm:inline">Reativar</span>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<Ban className="size-4" aria-hidden="true" />} onClick={() => setConfirm(m)} aria-label={`Desativar o acesso de ${m.name}`}>
            <span className="hidden sm:inline">Desativar</span>
          </Button>
        ),
    },
  ]

  const exportList = async (format: ExportFormat) => {
    const all = await listMembers(s, { ...list.params, page: 1, pageSize: 100_000 })
    await downloadTable(
      'usuarios.csv',
      all.rows,
      [
        { label: 'Nome', value: (m) => m.name },
        { label: 'E-mail', value: (m) => m.email },
        { label: 'Papel', value: (m) => ROLE[m.role] },
        { label: 'Pessoa ligada', value: (m) => m.person_name ?? '' },
        { label: 'Situação', value: (m) => STATUS_LABEL[m.status] },
        { label: 'Desde', value: (m) => formatDate(m.created_at.slice(0, 10)) },
      ],
      format,
    )
  }

  return (
    <Section
      title="Usuários"
      info="Uma pessoa pode ter mais de um papel na mesma conta (dona de um imóvel e inquilina de outro): cada papel é uma linha."
      actions={
        <Button size="sm" variant="primary" icon={<UserPlus className="size-4" aria-hidden="true" />} onClick={() => setInviting(true)}>
          Convidar
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <ListToolbar
          state={list}
          noun={['acesso', 'acessos']}
          total={q.data?.total}
          totalAll={q.data?.totalAll}
          facets={q.data?.facets}
          onExport={exportList}
          searchPlaceholder="Buscar por nome, e-mail ou pessoa"
          filters={[
            { key: 'role', label: 'Papel', options: invitableRoles(s).map((r) => ({ value: r, label: ROLE[r] })) },
            { key: 'status', label: 'Situação', options: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })) },
          ]}
        />
        <DataTable
          caption="Usuários da conta"
          columns={columns}
          rows={q.data?.rows}
          rowKey={(m) => m.id}
          sort={list.sort}
          onSort={list.toggleSort}
          loading={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={<EmptyState title="Ninguém encontrado" description={list.activeFilterCount ? 'Nada passa nos filtros ligados. Limpe os filtros para ver todos.' : 'Convide a primeira pessoa.'} />}
        />
        {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </div>
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={`Desativar o acesso de ${confirm.name}?`}
          message={
            <p>
              {confirm.name} ({ROLE[confirm.role].toLowerCase()}) deixa de entrar na conta a partir de agora. Os registros e a auditoria continuam; dá para reativar depois.
            </p>
          }
          confirmLabel="Desativar"
          danger
          loading={status.isPending}
          onConfirm={() => status.mutate({ id: confirm.id, status: 'disabled' })}
        />
      )}
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </Section>
  )
}

function Invitations() {
  const s = useSession()
  const q = useRepo('config:convites', listInvitations)
  const [revoking, setRevoking] = useState<InvitationRow | null>(null)
  const revoke = useRepoMutation(revokeInvitation, { success: 'Convite revogado.', onSuccess: () => setRevoking(null) })
  const columns: Column<InvitationRow>[] = [
    { key: 'email', header: 'E-mail', cell: (i) => <span className="font-medium">{i.email}</span> },
    { key: 'role', header: 'Papel', cell: (i) => ROLE[i.role] },
    { key: 'person', header: 'Pessoa ligada', hideBelow: 'md', cell: (i) => i.person_name ?? <span className="text-muted">Equipe</span> },
    { key: 'by', header: 'Convidado por', hideBelow: 'lg', cell: (i) => i.invited_by },
    { key: 'expires', header: 'Vence em', align: 'right', hideBelow: 'sm', cell: (i) => formatDate(i.expires_at.slice(0, 10)) },
    {
      key: 'acoes', header: '', className: 'w-px',
      cell: (i) => (
        <Button size="sm" variant="ghost" icon={<MailX className="size-4" aria-hidden="true" />} onClick={() => setRevoking(i)} aria-label={`Revogar o convite de ${i.email}`}>
          <span className="hidden sm:inline">Revogar</span>
        </Button>
      ),
    },
  ]
  return (
    <Section title="Convites pendentes" info="O convite vale 7 dias. Revogar faz o link parar de funcionar na hora; a auditoria guarda quem revogou.">
      <DataTable
        caption="Convites pendentes"
        columns={columns}
        rows={q.data}
        rowKey={(i) => i.id}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        empty={<EmptyState title="Nenhum convite pendente" description={`Os convites enviados aparecem aqui até serem aceitos ou vencerem. Hoje é ${formatDate(s.today)}.`} />}
      />
      {revoking && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRevoking(null)}
          title={`Revogar o convite de ${revoking.email}?`}
          message={<p>O link enviado para {revoking.email} para de funcionar agora. Para dar acesso depois, mande outro convite.</p>}
          confirmLabel="Revogar"
          danger
          loading={revoke.isPending}
          onConfirm={() => revoke.mutate(revoking.id)}
        />
      )}
    </Section>
  )
}

const ROLE_HINT: Record<Role, string> = {
  admin: 'Vê e configura tudo da conta, inclusive usuários e auditoria.',
  // A antiga aba "Papéis e permissões" virou a seção abaixo dos usuários, nesta mesma aba (06/11).
  staff: 'Nasce sem permissão: libere os módulos em "Permissões dos colaboradores", nesta mesma aba.',
  owner: 'Portal do proprietário: só os imóveis da pessoa ligada.',
  lessee: 'Portal do inquilino: só o contrato e as cobranças da pessoa ligada.',
  vendor: 'Portal do prestador: só os chamados atribuídos à pessoa ligada.',
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const s = useSession()
  const roles = invitableRoles(s)
  const form = useForm<InviteInput>({ resolver: zodResolver(inviteSchema), mode: 'onBlur', defaultValues: { email: '', role: roles[0], person_id: null } })
  const { register, handleSubmit, control, setValue, formState } = form
  const role = useWatch({ control, name: 'role' })
  const portal = PORTAL_ROLES.includes(role)
  const people = useRepo('config:convite-pessoas', (sess) => listInvitablePeople(sess, role), [role], { enabled: portal })
  const save = useRepoMutation(inviteUser, { success: (i) => `Convite enviado para ${i.email}.`, onSuccess: onClose })
  const submit = handleSubmit((v) => save.mutate({ ...v, person_id: portal ? v.person_id || null : null }))
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Convidar para a conta"
      description="No modo de demonstração o e-mail não sai: o convite fica registrado e aparece na lista de pendentes."
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={save.isPending} loadingText="Enviando…" onClick={submit}>
            Convidar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <Field label="E-mail" required error={formState.errors.email?.message}>
          {({ id, describedBy, invalid }) => <Input id={id} type="email" autoComplete="off" aria-describedby={describedBy} aria-invalid={invalid} {...register('email')} />}
        </Field>
        <Field label="Papel" required hint={ROLE_HINT[role]} error={formState.errors.role?.message}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              {...register('role', { onChange: () => setValue('person_id', null) })}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {portal && (
          <Field label="Pessoa do cadastro" required hint="Quem não combina com o papel aparece desabilitado, com o motivo." error={formState.errors.person_id?.message}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} {...register('person_id', { setValueAs: (v: string) => v || null })}>
                <option value="">{people.isLoading ? 'Carregando…' : 'Escolha a pessoa'}</option>
                {people.data?.map((p) => (
                  <option key={p.id} value={p.id} disabled={!!p.reason}>
                    {/* O motivo inteiro tem o conserto depois dos dois-pontos; na opção cabe só a causa. */}
                    {p.reason ? `${p.name} (${p.reason.split(':')[0].replace(`${p.name} `, '')})` : p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </form>
    </Dialog>
  )
}
