/* =============================================================================
   PowerBiOverview: a Visão geral que roda DENTRO do visual HTML Content do Power BI.

   Desde 07/11/2026 é o mesmo painel de números macro do app: os blocos Carteira, Financeiro,
   Clientes e Manutenção saem de figures.ts (texto) e macro.ts (conta) e são desenhados pelo mesmo
   Blocos.tsx. O que muda em relação ao app:
   - sem roteador e sem Radix: o HTML vai inteiro dentro de uma medida DAX, cada KB pesa;
   - sem links para listas (não há app para onde ir); os alertas são texto;
   - sem filtro de imóvel: no Power BI quem filtra é a segmentação do relatório, ANTES
     de os dados chegarem aqui. O período continua aqui dentro;
   - Equipe SOMADA, nunca por colaborador: o Power BI não recebe coluna de pessoa (relatório
     compartilhado com desempenho de cada um seria avaliação exposta a quem não deve ver);
   - o "i" de cada número é a dica nativa do navegador (atributo title), sem biblioteca.
   ============================================================================= */
import { useMemo, useState } from 'react'
import { CircleAlert, CircleCheck, Clock3, Info, TrendingUp } from 'lucide-react'
import { formatBRL } from '@/lib/money'
import { formatDate, formatMonth, monthStart } from '@/lib/dates'
import { readJSON, writeJSON } from '@/lib/storage'
import { plural } from '@/lib/text'
import { cn } from '@/components/ui/cn'
import { MacroBlock, type BlockShell } from '@/modules/visao-geral/Blocos'
import { compareInfo, compareLabel, macroBlocks, teamTotalsBlock } from '@/modules/visao-geral/figures'
import { computeMacro, type Macro } from '@/modules/visao-geral/macro'
import { DEFAULT_PERIOD, isPeriodKey, isTransfer, PERIOD_KEYS, PERIOD_LABEL, type PeriodKey } from '@/modules/visao-geral/metrics'
import type { Source } from './dados'

const PERIOD_STORE = 'imobil:powerbi:periodo'

/** "i" com a fórmula: dica nativa do navegador no passar do mouse; o leitor de tela lê o aria-label. */
function FormulaHint({ formula, label }: { formula: string; label: string }) {
  return (
    <span title={formula} aria-label={`${label}: ${formula}`} role="img" className="inline-grid size-5 cursor-help place-items-center rounded-full text-muted">
      <Info className="size-3.5" aria-hidden="true" />
    </span>
  )
}

/** A moldura do Power BI: só o "i"; nenhum número vira link. */
const SHELL: BlockShell = { info: (text, label) => <FormulaHint formula={text} label={label} /> }

export function PowerBiOverview({ source }: { source: Source }) {
  const [period, setPeriod] = useState<PeriodKey>(() => {
    const saved = readJSON<string>(PERIOD_STORE)
    return isPeriodKey(saved) ? saved : DEFAULT_PERIOD
  })
  const m = useMemo(() => computeMacro(source.data, source.hoje, period), [source, period])
  // Sem tabela de lançamentos, os blocos de dinheiro somem (em vez de mostrar R$ 0 que não é verdade).
  const money = source.data.entries.length > 0
  const transfers = source.data.entries.some(isTransfer)
  const blocks = macroBlocks(m, { money, transfers })
  const team = teamTotalsBlock(m)
  const alerts = buildAlerts(m, money)

  if (!source.data.units.length) {
    return (
      <main className="mx-auto flex max-w-[1280px] flex-col gap-2 p-4">
        <h1 className="text-xl font-medium">Visão geral</h1>
        <p className="text-sm text-muted">Nenhuma unidade chegou da tabela Unidades. Confira a medida e os filtros do relatório.</p>
        <Warnings list={source.warnings} />
      </main>
    )
  }

  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-3 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-medium">
            Visão geral <span className="text-muted">· {source.organizacao}</span>
          </h1>
          <p className="text-sm text-muted">Dados de {formatDate(source.hoje)}</p>
          {source.demo && <p className="mt-1 inline-block rounded-md bg-[color-mix(in_srgb,var(--warning)_13%,transparent)] px-2 py-0.5 text-xs font-medium text-warning-fg">Dados fictícios: a medida não mandou dados</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            Período
            <select className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-text" value={period} onChange={(e) => {
              const v = e.target.value as PeriodKey
              setPeriod(v)
              writeJSON(PERIOD_STORE, v)
            }}>
              {PERIOD_KEYS.map((k) => (
                <option key={k} value={k}>
                  {PERIOD_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <p className="flex items-center gap-1 text-xs text-muted">
            Setas comparam com {compareLabel(m)}
            <FormulaHint formula={compareInfo(m)} label="Com o que as setas comparam" />
          </p>
        </div>
      </header>

      <Warnings list={source.warnings} />

      <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {blocks.map((b) => (
          <MacroBlock key={b.key} block={b} shell={SHELL} />
        ))}
      </div>

      <div className={cn('grid gap-3', team && 'lg:grid-cols-3')}>
        <section aria-labelledby="pbi-atencao" className={cn('rounded-2xl border border-border bg-surface shadow-card', team && 'lg:col-span-2')}>
          <h2 id="pbi-atencao" className="flex min-h-10 items-center gap-1.5 px-4 pt-1.5 text-[15px] font-medium">
            Pede atenção <span className="num text-xs font-normal text-faint">{alerts.length}</span>
          </h2>
          <div className="px-4 pb-3">
            {alerts.length ? (
              <ul className="grid gap-x-6 sm:grid-cols-2">
                {alerts.map((a) => (
                  <li key={a.key} className="flex min-w-0 items-start gap-3 py-2">
                    <a.icon className={cn('mt-0.5 size-4 shrink-0', a.cls)} strokeWidth={1.5} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm">{a.title}</p>
                      <p className="truncate text-xs text-muted">{a.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted">
                <CircleCheck className="size-4 text-success" strokeWidth={1.5} aria-hidden="true" /> Nada pedindo atenção agora
              </p>
            )}
          </div>
        </section>
        {team && <MacroBlock block={team} shell={SHELL} />}
      </div>
    </main>
  )
}

function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null
  return (
    <div role="status" className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-warning-fg">
      <p className="font-medium">Conferir no modelo do Power BI:</p>
      <ul className="mt-1 list-disc pl-4">
        {list.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

/** Os mesmos alertas da tela do app, em texto (aqui não há lista para onde ir). */
function buildAlerts(m: Macro, money: boolean) {
  const out: { key: string; icon: typeof CircleAlert; cls: string; title: string; detail: string }[] = []
  const danger = { icon: CircleAlert, cls: 'text-danger-fg' }
  const warning = { icon: Clock3, cls: 'text-warning-fg' }
  if (money && m.overdue.lateCount > 0) out.push({ key: 'cobrancas', ...danger, title: `${plural(m.overdue.lateCount, 'cobrança vencida', 'cobranças vencidas')} há mais de 5 dias`, detail: `${formatBRL(m.overdue.lateCents)} em aberto · a mais antiga com ${m.overdue.oldestDays} dias` })
  if (m.requests.late > 0) out.push({ key: 'chamados', ...danger, title: `${plural(m.requests.late, 'chamado passou', 'chamados passaram')} do prazo`, detail: `${plural(m.requests.open, 'chamado aberto', 'chamados abertos')} no total` })
  if (m.ending.d60 > 0) out.push({ key: 'contratos', ...warning, title: `${plural(m.ending.d60, 'locação vence', 'locações vencem')} em até 60 dias`, detail: `${m.ending.d30} em até 30 dias · ${m.ending.d90} em até 90 dias` })
  if (m.requests.awaitingOwner > 0) out.push({ key: 'orcamentos', ...warning, title: `${plural(m.requests.awaitingOwner, 'orçamento aguarda', 'orçamentos aguardam')} o proprietário`, detail: money ? `${formatBRL(m.requests.awaitingOwnerCents)} no total` : 'A decisão é do proprietário' })
  if (m.tasks.late > 0) out.push({ key: 'tarefas', ...warning, title: plural(m.tasks.late, 'tarefa atrasada', 'tarefas atrasadas'), detail: 'Da equipe inteira' })
  if (m.adjustments.length > 0) {
    const codes = m.adjustments.map((k) => k.code)
    out.push({ key: 'reajustes', icon: TrendingUp, cls: 'text-[var(--st-occupied-fg)]', title: `${plural(codes.length, 'reajuste', 'reajustes')} em ${formatMonth(monthStart(m.today))}`, detail: codes.length > 3 ? `${codes.slice(0, 3).join(', ')} e mais ${codes.length - 3}` : codes.join(', ') })
  }
  return out
}
