/* =============================================================================
   Blocos.tsx: o DESENHO de um bloco da Visão geral, o mesmo no app e no Power BI.

   Anatomia (uma só para os quatro blocos e para a equipe somada do Power BI):
   1. cabeçalho fino: título + "i" à esquerda; "hoje" ou o período à direita;
   2. o número de destaque: rótulo, número grande (Geist Mono), a seta que compara com o período
      anterior, a dica curta e, à direita, a tendência de 12 meses (Sparkline);
   3. até quatro linhas: rótulo e dica à esquerda, número e seta à direita.

   Sem roteador e sem Radix: quem usa entrega a "moldura" (shell):
   - info: o "i" (no app, o InfoTip; no Power BI, a dica nativa do navegador);
   - link: transforma o rótulo num link que cobre a linha inteira (só o app). A seta ↗ ao lado do
     rótulo avisa que o número abre uma lista: clicar nunca é surpresa.
   O "i" fica por cima do link (relative z-10), como no KpiTile: são dois alvos separados.
   ============================================================================= */
import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/components/ui/cn'
import { Sparkline } from './charts'
import type { Block, Delta, Figure } from './figures'

export interface BlockShell {
  info: (text: string, label: string) => ReactNode
  /** Devolve o link (com a classe STRETCHED) ou null quando o número não abre lista. */
  link?: (fig: Figure, label: ReactNode) => ReactNode | null
}

/** O link "esticado": o ::after cobre a linha toda, e o foco do teclado desenha o anel nela. */
export const STRETCHED =
  'after:absolute after:inset-0 after:content-[""] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[var(--focus)]'

function DeltaText({ delta, className }: { delta?: Delta | null; className?: string }) {
  if (!delta) return null
  return (
    <span className={cn(/\d/.test(delta.text) ? 'num' : 'font-sans', 'whitespace-nowrap text-muted', className)} title={delta.said}>
      <span aria-hidden="true">{delta.text}</span>
      <span className="sr-only">{delta.said}</span>
    </span>
  )
}

/** Rótulo com a seta ↗ quando é link, e o "i" por cima do link. */
function Label({ fig, shell, className }: { fig: Figure; shell: BlockShell; className?: string }) {
  const text = (
    <>
      {fig.label}
      {fig.link && <ArrowUpRight className="ml-0.5 inline size-3.5 align-[-2px] text-faint transition-colors group-hover:text-text" strokeWidth={1.5} aria-hidden="true" />}
    </>
  )
  const linked = shell.link?.(fig, text) ?? null
  return (
    <span className={cn('flex min-h-6 items-center gap-1', className)}>
      <span className="min-w-0">{linked ?? fig.label}</span>
      <span className="relative z-10 inline-flex">{shell.info(fig.info, `Como é calculado: ${fig.label}`)}</span>
    </span>
  )
}

function Headline({ fig, shell }: { fig: Figure; shell: BlockShell }) {
  const linked = !!fig.link && !!shell.link
  return (
    <div className={cn('group relative px-3.5 pt-2 pb-2.5', linked && 'transition-colors duration-150 hover:bg-surface-2/60')}>
      {/* O rótulo tem a linha inteira; a tendência fica na linha do número. Com a tendência ao lado do
          rótulo, "Locações vigentes ↗ i" não cabia em 1366 px e quebrava em duas linhas. */}
      <Label fig={fig} shell={shell} className="text-[13px] text-muted" />
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="num text-[26px] leading-8 font-medium whitespace-nowrap">{fig.value}</p>
          <p className="flex min-h-4 flex-wrap items-baseline gap-x-2 text-xs leading-4">
            <DeltaText delta={fig.delta} />
            {fig.hint && <span className="text-faint">{fig.hint}</span>}
          </p>
        </div>
        {fig.spark && <Sparkline values={fig.spark.values} label={fig.spark.said} />}
      </div>
    </div>
  )
}

function Row({ fig, shell }: { fig: Figure; shell: BlockShell }) {
  const linked = !!fig.link && !!shell.link
  return (
    <div className={cn('group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 py-1.5', linked && 'transition-colors duration-150 hover:bg-surface-2/60')}>
      <dt className="min-w-0">
        <Label fig={fig} shell={shell} className="text-[13px] text-muted" />
        {fig.hint && <span className="block truncate text-xs leading-4 text-faint">{fig.hint}</span>}
      </dt>
      <dd className="text-right">
        <span className="num block text-[15px] leading-6 font-medium whitespace-nowrap">{fig.value}</span>
        <DeltaText delta={fig.delta} className="block text-xs leading-4" />
      </dd>
    </div>
  )
}

export function MacroBlock({ block, shell, className }: { block: Block; shell: BlockShell; className?: string }) {
  const id = `bloco-${block.key}`
  return (
    <section aria-labelledby={id} className={cn('flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card', className)}>
      <header className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-3.5">
        <h2 id={id} className="flex items-center gap-1 text-[15px] font-medium">
          {block.title}
          {shell.info(block.info, `Sobre o bloco ${block.title}`)}
        </h2>
        <span className="text-xs text-faint">{block.when}</span>
      </header>
      <Headline fig={block.headline} shell={shell} />
      {block.rows.length > 0 && (
        <dl className="flex flex-col divide-y divide-border border-t border-border">
          {block.rows.map((f) => (
            <Row key={f.key} fig={f} shell={shell} />
          ))}
        </dl>
      )}
    </section>
  )
}
