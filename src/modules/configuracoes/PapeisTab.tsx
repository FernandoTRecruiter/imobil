/* =============================================================================
   Configurações > Usuários e permissões (seção abaixo dos usuários): matriz permissão x
   colaborador, com caixa de marcar. Só existe na conta de imobiliária.

   Linhas = permissões (agrupadas por módulo); colunas = colaboradores. Assim a tabela cresce
   para baixo quando entra módulo novo e cabe no celular com poucos colaboradores.
   Marcar "Editar" marca "Ver" junto; desmarcar "Ver" desmarca o que depende dele.
   Nada grava até "Salvar"; cada colaborador alterado vira uma linha de auditoria.
   ============================================================================= */
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useRepo, useRepoMutation } from '@/data/hooks'
import type { Permission } from '@/data/types'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Layout'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { listStaffPermissions, normalizePermissions, PERMISSION_GROUPS, PERMISSION_LABEL, saveStaffPermissions, type MemberRow } from './repo'

export function PapeisTab() {
  const q = useRepo('config:permissoes', listStaffPermissions)
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-96" />
  // key: depois de salvar, os dados novos remontam a matriz (o rascunho volta a ser o gravado).
  return <Matrix key={q.data.map((m) => `${m.id}:${m.permissions.join(',')}`).join('|')} staff={q.data} />
}

function Matrix({ staff }: { staff: MemberRow[] }) {
  const [draft, setDraft] = useState<Record<string, Permission[]>>(() => Object.fromEntries(staff.map((m) => [m.id, m.permissions])))
  const save = useRepoMutation(saveStaffPermissions, { success: (n) => `Permissões salvas (${n} ${n === 1 ? 'colaborador' : 'colaboradores'}).` })
  const changed = staff.filter((m) => draft[m.id].join(',') !== m.permissions.join(','))

  /** Liga ou desliga uma permissão já resolvendo as dependências ("Editar" precisa de "Ver"). */
  const toggle = (id: string, perm: Permission) => {
    const cur = draft[id]
    let next: Permission[]
    if (cur.includes(perm)) {
      const dependents = PERMISSION_GROUPS.flatMap((g) => g.items).filter((i) => i.needs === perm).map((i) => i.perm)
      next = cur.filter((p) => p !== perm && !dependents.includes(p))
    } else next = normalizePermissions([...cur, perm])
    setDraft({ ...draft, [id]: normalizePermissions(next) })
  }

  return (
    <Section
      title="Permissões dos colaboradores"
      info="O administrador tem todas as permissões. Configurações, usuários e auditoria nunca são liberadas a colaborador."
      actions={
        changed.length > 0 && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setDraft(Object.fromEntries(staff.map((m) => [m.id, m.permissions])))}>
              Descartar
            </Button>
            <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate({ changes: changed.map((m) => ({ membershipId: m.id, permissions: draft[m.id] })) })}>
              Salvar ({changed.length})
            </Button>
          </>
        )
      }
    >
      <p className="mb-4 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span>
          Esta tela só esconde do colaborador o que ele não pode usar. Quem protege o dado é o banco: cada leitura e cada gravação conferem a permissão de novo, mesmo que alguém chegue pelo endereço direto.
        </span>
      </p>
      {staff.length === 0 ? (
        <EmptyState title="Nenhum colaborador" description="Convide colaboradores na aba Usuários; eles aparecem aqui sem nenhuma permissão." />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Permissões por colaborador</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky top-0 left-0 z-20 border-b border-border bg-surface-2 px-3 py-2.5 text-left text-[11px] font-semibold tracking-wide text-muted uppercase">
                  Permissão
                </th>
                {staff.map((m) => (
                  <th key={m.id} scope="col" className="sticky top-0 z-10 min-w-28 border-b border-border bg-surface-2 px-3 py-2 text-center text-xs font-semibold">
                    <span className="block">{m.name.split(' ')[0]}</span>
                    <span className={cn('block text-[11px] font-normal', m.status === 'active' ? 'text-muted' : 'text-warning-fg')}>{m.status === 'active' ? m.name.split(' ').slice(1).join(' ') : 'desativado'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((g) =>
                g.items.map((it, i) => (
                  <tr key={it.perm} className="bg-surface">
                    <th scope="row" className={cn('sticky left-0 bg-surface px-3 py-2 text-left font-normal', i === g.items.length - 1 && 'border-b border-border')}>
                      {i === 0 && <span className="block text-xs font-semibold text-muted">{g.module}</span>}
                      <span>{it.label}</span>
                    </th>
                    {staff.map((m) => {
                      const on = draft[m.id].includes(it.perm)
                      const dirty = on !== m.permissions.includes(it.perm)
                      return (
                        <td key={m.id} className={cn('px-3 py-2 text-center', i === g.items.length - 1 && 'border-b border-border', dirty && 'bg-primary-soft/60')}>
                          <input
                            type="checkbox"
                            className="size-5 cursor-pointer accent-[var(--primary)]"
                            checked={on}
                            onChange={() => toggle(m.id, it.perm)}
                            aria-label={`${PERMISSION_LABEL[it.perm]} para ${m.name}`}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
      {changed.length > 0 && <p className="mt-3 text-xs text-muted" aria-live="polite">{changed.length} {changed.length === 1 ? 'colaborador com mudança' : 'colaboradores com mudança'} ainda não salva (fundo azul).</p>}
    </Section>
  )
}
