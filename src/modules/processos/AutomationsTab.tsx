/* =============================================================================
   Automações (aba Automações e comunicados, em Tarefas): as regras ("contrato vence em 60 dias -> abre a renovação"), ligar e
   desligar, os dias de cada uma, o registro de cada rodada (com o erro, quando deu erro) e,
   embaixo, a caixa de saída de e-mail (o que as regras e os comunicados mandaram).

   "Rodar agora (simulação)": faz o que a rotina diária faria (na fase 2: pg_cron + função do
   banco). Cria só o que ainda não existe (pela chave de duplicidade) e diz "N criadas, M já
   existiam". Rodar de novo em seguida: 0 criadas.
   ============================================================================= */
import { useState } from 'react'
import { Play } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can } from '@/auth/permissions'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { formatDateTime } from '@/lib/dates'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input } from '@/components/ui/Field'
import { InfoTip } from '@/components/ui/InfoTip'
import { Card, Section } from '@/components/ui/Layout'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { OutboxSection } from '@/modules/comunicacao/OutboxSection'
import { actionText, EVENT_TRIGGERS, listAutomations, ruleUsesDays, runAutomations, TRIGGER_TEXT, updateRule, type RuleRow, type RunResult } from './repo'

const RUNS_SHOWN = 30

/** "1 criada, 3 já existiam": o plural certo dos dois números. */
function countText(created: number, skipped: number): string {
  return `${created} ${created === 1 ? 'criada' : 'criadas'}, ${skipped} já ${skipped === 1 ? 'existia' : 'existiam'}`
}

export function AutomationsTab() {
  const s = useSession()
  const q = useRepo('automacoes', listAutomations)
  const [result, setResult] = useState<RunResult | null>(null)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const run = useRepoMutation(runAutomations, {
    success: (r) => `Simulação: ${countText(r.created, r.skipped)}.`,
    onSuccess: setResult,
  })
  const edit = can(s, 'workflows:edit')

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-96" />
  const { rules, runs } = q.data
  const errors = runs.filter((r) => r.status === 'error').length
  const shown = (onlyErrors ? runs.filter((r) => r.status === 'error') : runs).slice(0, RUNS_SHOWN)

  return (
    <>
      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="flex min-w-0 flex-1 basis-72 items-center gap-1 text-sm">
          A rotina roda sozinha todo dia às 6h. Aqui dá para rodar agora e ver o efeito.
          <InfoTip label="Como a simulação evita repetir">
            Cada tarefa ou aviso leva uma chave: regra + registro (+ dia, no aviso). Se a chave já existe, nada é criado e a contagem vai para "já existiam". Por isso rodar duas vezes não duplica.
          </InfoTip>
        </p>
        {edit && (
          <Button variant="primary" icon={<Play className="size-4" aria-hidden="true" />} loading={run.isPending} loadingText="Rodando…" onClick={() => run.mutate(undefined)}>
            Rodar agora (simulação)
          </Button>
        )}
      </Card>

      {result && (
        <Section title="Resultado da simulação" actions={<Button size="sm" variant="ghost" onClick={() => setResult(null)}>Fechar</Button>}>
          <p className="text-sm">
            <strong className="num">{result.created}</strong> {result.created === 1 ? 'criada' : 'criadas'}, <strong className="num">{result.skipped}</strong> já {result.skipped === 1 ? 'existia' : 'existiam'}.
            {result.rules.length === 0 && ' Nenhuma regra ligada.'}
          </p>
          {result.rules.length > 0 && (
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
              {result.rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 basis-60">{r.name}</span>
                  {/* Com erro, a contagem fica: a rodada segue nos outros casos (ex.: uma pessoa sem e-mail não segura as outras). */}
                  <span className="num text-xs text-muted">{countText(r.created, r.skipped)}</span>
                  {r.status === 'error' && <span className="basis-full text-xs font-medium text-danger-fg">Erro: {r.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <Section title="Regras" info='Ligada: entra na rotina diária e no "Rodar agora". Desligada: fica guardada, sem rodar.'>
        {rules.length === 0 ? (
          <EmptyState title="Nenhuma regra de automação" />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rules.map((r) => (
              <RuleItem key={`${r.id}:${r.updated_at}`} rule={r} edit={edit} />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Registro das execuções"
        actions={<Checkbox label={`Só com erro (${errors})`} checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />}
      >
        {shown.length === 0 ? (
          <p className="text-sm text-muted">{onlyErrors ? 'Nenhuma execução com erro.' : 'A regra ainda não rodou.'}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Registro das execuções das automações</caption>
              <thead>
                {/* Cabeçalho no mesmo desenho do DataTable (a caixa de saída logo abaixo usa ele). */}
                <tr className="bg-surface-2 text-left text-xs text-muted">
                  <th scope="col" className="px-3 py-2.5 font-medium">Quando</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Regra</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Situação</th>
                  <th scope="col" className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Criadas</th>
                  <th scope="col" className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Já existiam</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.ran_at, s.org.timezone)}</td>
                    <td className="px-3 py-2">
                      {r.rule_name}
                      {r.error && <span className="mt-0.5 block text-xs font-medium text-danger-fg">{r.error}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={r.status === 'ok' ? 'success' : 'danger'}>{r.status === 'ok' ? 'Certo' : 'Erro'}</Badge>
                    </td>
                    <td className="num hidden px-3 py-2 text-right sm:table-cell">{r.created_count}</td>
                    <td className="num hidden px-3 py-2 text-right sm:table-cell">{r.skipped_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {runs.length > RUNS_SHOWN && !onlyErrors && <p className="mt-2 text-xs text-muted">Mostrando as {RUNS_SHOWN} execuções mais recentes.</p>}
      </Section>

      <OutboxSection />
    </>
  )
}

/**
 * Uma regra: ligar ou desligar na hora; os dias com "Salvar" quando mudam.
 * Regra de gatilho por acontecimento (pedido aberto) não tem dias: dispara na hora em que acontece.
 * Rotina de manutenção aceita 0 dias (abre no próprio dia marcado).
 */
function RuleItem({ rule: r, edit }: { rule: RuleRow; edit: boolean }) {
  const [days, setDays] = useState(String(r.days))
  const save = useRepoMutation(updateRule, { success: (x) => `"${x.name}" ${x.enabled ? 'ligada' : 'desligada'}.` })
  const usesDays = ruleUsesDays(r.trigger)
  const event = EVENT_TRIGGERS.includes(r.trigger)
  const minDays = r.trigger === 'maintenance_schedule_due' ? 0 : 1
  const changed = usesDays && days !== String(r.days)
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <p className={cn('text-sm font-medium', !r.enabled && 'text-muted')}>{r.name}</p>
          <p className="text-xs text-muted">
            Quando: {TRIGGER_TEXT[r.trigger](r.days).toLowerCase()} · Faz: {actionText(r).toLowerCase()}
          </p>
          <p className="text-xs text-muted">
            {r.last_run ? (
              <>
                {event ? 'Último disparo' : 'Última rodada'} {formatDateTime(r.last_run.ran_at)}:{' '}
                {r.last_run.status === 'ok' ? countText(r.last_run.created_count, r.last_run.skipped_count) : <span className="font-medium text-danger-fg">erro</span>}
              </>
            ) : event ? (
              'Ainda não disparou.'
            ) : (
              'Ainda não rodou.'
            )}
          </p>
        </div>
        <Checkbox
          label={r.enabled ? 'Ligada' : 'Desligada'}
          role="switch"
          aria-checked={r.enabled}
          checked={r.enabled}
          disabled={!edit || save.isPending}
          onChange={(e) => save.mutate({ id: r.id, enabled: e.target.checked, days: r.days })}
        />
      </div>
      {usesDays && edit && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            {r.trigger === 'maintenance_schedule_due' ? 'Dias antes da data' : 'Dias'}
            <span className="block w-24">
              <Input type="number" min={minDays} max={365} inputMode="numeric" className="text-sm text-text" value={days} onChange={(e) => setDays(e.target.value)} />
            </span>
          </label>
          {changed && (
            <>
              <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate({ id: r.id, enabled: r.enabled, days: Number(days) })}>
                Salvar dias
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDays(String(r.days))}>
                Desfazer
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  )
}
