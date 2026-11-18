/* =============================================================================
   Equipe.tsx: o bloco de desempenho dos colaboradores na Visão geral (só no app).

   Duas formas, decididas no repo.ts (a linha dos outros nem chega aqui sem permissão):
   - "team" (admin, ação team:performance): tabela, uma linha por colaborador, maior carteira primeiro;
   - "self" (os outros colaboradores): "Meu desempenho", a própria linha em números soltos.
   Conta sem equipe (proprietário independente) não mostra o bloco.

   Por que a carteira vem primeiro em toda linha: é a régua para ler o resto. O "i" do bloco
   termina com "Compare sempre com o tamanho da carteira." (pedido do Fernando, 07/11).
   Tabela larga rola DENTRO da moldura (a página nunca rola de lado), com o nome grudado à esquerda.
   ============================================================================= */
import type { ReactNode } from 'react'
import { InfoTip } from '@/components/ui/InfoTip'
import { cn } from '@/components/ui/cn'
import { formatRate } from './charts'
import type { StaffRow } from './desempenho'
import { FORMULAS } from './metrics'
import type { TeamBlock } from './repo'

const TEAM_INFO =
  'Resultado do trabalho no período, nunca tempo conectado ou cliques. Carteira = imóveis em que a pessoa é a responsável (com a vacância de hoje e a inadimplência do período deles); tarefas e chamados = os atribuídos a ela; contratos = os que começaram nos imóveis da carteira.'

const num1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
/** Número em Geist Mono; texto ("sem base", "sem carteira") na fonte de texto e apagado. */
const cellTone = (v: string) => (/^\d/.test(v) ? 'num' : 'font-sans text-faint')
const rate = (r: number | null) => (r === null ? 'sem base' : formatRate(r, 0))
const days = (d: number | null) => (d === null ? 'sem base' : `${num1(d)} d`)

interface Column {
  key: string
  group: string
  label: string
  /** O título por extenso (cabeçalho curto na tabela; o "title" e o "Meu desempenho" usam este). */
  long: string
  value: (r: StaffRow) => string
  money?: boolean
}

/** As colunas, na ordem da régua: carteira, tarefas, chamados, contratos. */
const COLUMNS: Column[] = [
  { key: 'imoveis', group: 'Carteira', label: 'Imóveis', long: 'Imóveis da carteira', value: (r) => String(r.properties) },
  { key: 'unidades', group: 'Carteira', label: 'Unidades', long: 'Unidades da carteira', value: (r) => String(r.units) },
  { key: 'vacancia', group: 'Carteira', label: 'Vacância', long: 'Vacância da carteira', value: (r) => (r.units ? rate(r.vacancy) : 'sem carteira') },
  { key: 'inadimplencia', group: 'Carteira', label: 'Inadimpl.', long: 'Inadimplência da carteira', value: (r) => (r.units ? rate(r.delinquency) : 'sem carteira'), money: true },
  { key: 'noprazo', group: 'Tarefas', label: 'No prazo', long: 'Tarefas no prazo', value: (r) => (r.tasks.measured ? `${rate(r.tasks.rate)} (${r.tasks.onTime}/${r.tasks.measured})` : 'sem base') },
  { key: 'atrasadas', group: 'Tarefas', label: 'Atrasadas', long: 'Tarefas atrasadas', value: (r) => String(r.tasks.late) },
  { key: 'resolvidos', group: 'Chamados', label: 'Resolvidos', long: 'Chamados resolvidos', value: (r) => String(r.requests.count) },
  { key: 'tempo', group: 'Chamados', label: 'Tempo médio', long: 'Tempo médio de resolução', value: (r) => (r.requests.count ? days(r.requests.avgDays) : 'sem base') },
  { key: 'novos', group: 'Contratos', label: 'Novos', long: 'Contratos novos', value: (r) => String(r.signed.fresh) },
  { key: 'renovacoes', group: 'Contratos', label: 'Renovações', long: 'Renovações', value: (r) => String(r.signed.renewals) },
]

function Frame({ title, when, info, children, className }: { title: string; when: string; info: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby="bloco-equipe" className={cn('flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card', className)}>
      <header className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-3.5">
        <h2 id="bloco-equipe" className="flex items-center gap-1 text-[15px] font-medium">
          {title}
          <InfoTip label={`Sobre o bloco ${title}`}>{info}</InfoTip>
        </h2>
        <span className="text-xs text-faint">{when}</span>
      </header>
      {children}
    </section>
  )
}

export function TeamSection({ team, money, when, meId, className }: { team: TeamBlock; money: boolean; when: string; meId: string; className?: string }) {
  if (team.mode === 'none' || !team.rows.length) return null
  const cols = COLUMNS.filter((c) => money || !c.money)
  const info = (
    <>
      {TEAM_INFO} {FORMULAS.tasksOnTime}
      <span className="mt-1 block font-medium">Compare sempre com o tamanho da carteira.</span>
    </>
  )

  if (team.mode === 'self') {
    const me = team.rows[0]
    return (
      <Frame title="Meu desempenho" when={when} info={info} className={className}>
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-5">
          {cols.map((c) => (
            <div key={c.key} className="flex min-w-0 flex-col bg-surface px-3.5 py-2">
              <dt className="truncate text-xs text-muted">{c.long}</dt>
              <dd className={cn('text-[15px] leading-6 font-medium', cellTone(c.value(me)))}>{c.value(me)}</dd>
            </div>
          ))}
        </dl>
      </Frame>
    )
  }

  // Cabeçalho em dois andares: o grupo (Carteira, Tarefas...) em cima e a coluna embaixo.
  const groups = cols.reduce<{ name: string; span: number }[]>((acc, c) => {
    const last = acc[acc.length - 1]
    if (last && last.name === c.group) last.span++
    else acc.push({ name: c.group, span: 1 })
    return acc
  }, [])
  return (
    <Frame title="Equipe" when={when} info={info} className={className}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <caption className="sr-only">Desempenho de cada colaborador no período. Compare sempre com o tamanho da carteira.</caption>
          <thead className="text-xs text-muted">
            <tr className="border-b border-border">
              <th scope="col" rowSpan={2} className="sticky left-0 z-10 bg-surface px-3.5 py-1.5 text-left font-normal">
                Colaborador
              </th>
              {groups.map((g) => (
                <th key={g.name} scope="colgroup" colSpan={g.span} className="border-l border-border px-2 py-1.5 text-center font-normal">
                  {g.name}
                </th>
              ))}
            </tr>
            <tr className="border-b border-border">
              {cols.map((c, i) => (
                <th key={c.key} scope="col" title={c.long} className={cn('px-2 py-1.5 text-right font-normal whitespace-nowrap', (i === 0 || cols[i - 1].group !== c.group) && 'border-l border-border')}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {team.rows.map((r) => (
              <tr key={r.user_id}>
                <th scope="row" className="sticky left-0 z-10 max-w-48 truncate bg-surface px-3.5 py-2 text-left font-normal">
                  {r.name}
                  {r.user_id === meId && <span className="text-muted"> (você)</span>}
                </th>
                {cols.map((c, i) => {
                  const v = c.value(r)
                  return (
                    <td key={c.key} className={cn('px-2 py-2 text-right whitespace-nowrap', cellTone(v), (i === 0 || cols[i - 1].group !== c.group) && 'border-l border-border')}>
                      {v}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  )
}
