/* =============================================================================
   Blocos de página. Toda tela usa os mesmos (anatomia única: cabeçalho, indicadores,
   barra de lista, tabela) para o olho não precisar reaprender a cada módulo.

   Densidade (07/11/2026, pedido do Fernando: "deixa os dash mais slim e comprimidos; o mapa, que
   é o principal, fica menor que 3 heroes"): o cabeçalho cabe numa linha (título de 22 px, a linha
   de apoio ao lado ou logo abaixo, as ações na mesma linha), o indicador é uma faixa baixa (rótulo
   e número lado a lado) e as seções têm menos respiro. Tudo pelas peças daqui: as telas ficam mais
   baixas sem mexer nelas. As propriedades de cada peça continuam as mesmas (só entrou "info" no
   cabeçalho, opcional).
   ============================================================================= */
import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from './cn'
import { InfoTip } from './InfoTip'

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border border-border bg-surface shadow-card', className)}>{children}</div>
}

/** Seção com título dentro de um cartão. */
export function Section({ title, actions, children, className, info }: { title: string; actions?: ReactNode; children: ReactNode; className?: string; info?: ReactNode }) {
  return (
    <Card className={cn('flex min-w-0 flex-col', className)}>
      {/* flex-wrap: no celular, título e botões não cabem na mesma linha; os botões descem em vez de alargar a página (06/11). */}
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-1.5">
        <h2 className="flex items-center gap-1 text-[15px] font-medium">
          {title}
          {info && <InfoTip>{info}</InfoTip>}
        </h2>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="min-w-0 px-4 py-3">{children}</div>
    </Card>
  )
}

/**
 * Cabeçalho da página, numa linha só quando cabe: sobretítulo (o módulo) e título lado a lado,
 * a descrição numa linha (cortada com "…"; o texto inteiro fica no "title" e no leitor de tela) e
 * as ações à direita. Texto de "como funciona" vai no "i" (info), não na descrição.
 * Por que o sobretítulo ao lado e não em cima: em cima ele custava uma linha inteira em toda tela,
 * só para repetir o nome do item do menu.
 */
export function PageHeader({ eyebrow, title, muted, description, actions, info }: { eyebrow?: string; title: string; muted?: string; description?: string; actions?: ReactNode; info?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {/* Base de 16rem (e não 0): no celular, título e ações não cabem lado a lado e as ações descem para a linha de baixo. */}
      <div className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          {eyebrow && (
            <p className="shrink-0 text-[13px] text-faint">
              {eyebrow}
              <span aria-hidden="true" className="ml-2 text-border-strong">
                /
              </span>
            </p>
          )}
          <h1 className="min-w-0 text-[22px] leading-7 font-medium">
            {title}
            {muted && <span className="text-muted"> {muted}</span>}
          </h1>
          {info && (
            <span className="self-center">
              <InfoTip label="Sobre esta tela">{info}</InfoTip>
            </span>
          )}
        </div>
        {description && (
          <p className="max-w-full min-w-0 truncate text-[13px] text-muted" title={description}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * Cabeçalho de detalhe (imóvel, contrato, chamado): o "voltar" pequeno AO LADO do título (como o
 * sobretítulo do PageHeader: "‹ Imóveis / Condomínio..."), selo e ações na mesma linha, contexto
 * embaixo. Em cima, o "voltar" custava uma linha inteira só para ele.
 */
export function DetailHeader({ back, title, badge, meta, actions }: { back?: ReactNode; title: string; badge?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {back && (
              <span className="flex shrink-0 items-center gap-2 text-[13px] [&_a]:text-[13px]">
                {back}
                <span aria-hidden="true" className="text-border-strong">
                  /
                </span>
              </span>
            )}
            <h1 className="text-[22px] leading-7 font-medium">{title}</h1>
            {badge}
          </div>
          {meta && <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

/** Pares rótulo/valor em grade (dados de um registro). */
export function DescriptionList({ items, columns = 2 }: { items: { label: string; value: ReactNode; info?: ReactNode }[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-2.5', columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="flex items-center gap-1 text-xs font-medium text-muted">
            {it.label}
            {it.info && <InfoTip>{it.info}</InfoTip>}
          </dt>
          <dd className="mt-0.5 text-sm [overflow-wrap:anywhere]">{it.value === '' || it.value === null || it.value === undefined ? <span className="text-muted">Não informado</span> : it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Indicador em faixa baixa (cerca de 56 px): à esquerda o rótulo (com o "i" da fórmula) e a linha de
 * apoio; à direita o número. Quando os dois não cabem lado a lado (celular, coluna de 2, ou um valor
 * longo como "R$ 4.660,00" num cartão estreito), o número desce para a linha de baixo SOZINHO: o
 * rótulo pede pelo menos 8rem (flex-wrap), e espremer o rótulo até uma palavra por linha nunca acontece.
 * Quem decide é a largura do próprio cartão e do valor, não a da janela.
 * Clicável sem botão dentro de botão: o rótulo é o botão e o "::after" dele estica por cima do cartão
 * inteiro (o cartão todo responde ao clique); o "i" fica numa camada acima, como botão separado.
 */
export function KpiTile({ label, value, hint, info, emphasis, tone, onClick }: { label: string; value: ReactNode; hint?: ReactNode; info?: ReactNode; emphasis?: boolean; tone?: 'danger' | 'success'; onClick?: () => void }) {
  return (
    <div
      className={cn(
        // "emphasis" não pinta mais o cartão inteiro de azul (cromo quieto): o destaque vai só no número.
        // flex-col + flex-1 por dentro: na faixa, o cartão estica até a altura do mais alto, e o conteúdo fica no meio dele.
        'relative flex min-w-0 flex-col rounded-xl border border-border bg-surface text-left shadow-card',
        onClick && 'transition-[border-color,background-color] duration-150 ease-out hover:border-border-strong hover:bg-surface-2/40',
      )}
    >
      <div className="flex min-h-14 flex-1 flex-wrap content-center items-center justify-between gap-x-3 gap-y-0.5 px-3.5 py-2">
        <div className="min-w-0 flex-[1_1_8rem]">
          <span className="flex min-h-5 items-center gap-1 text-[13px] leading-5 text-muted">
            {onClick ? (
              <button
                onClick={onClick}
                className="text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[var(--focus)]"
              >
                {label}
              </button>
            ) : (
              label
            )}
            {info && (
              <span className="relative z-10">
                <InfoTip>{info}</InfoTip>
              </span>
            )}
          </span>
          {hint && <span className="block text-xs leading-4 text-faint">{hint}</span>}
        </div>
        <span className={cn('num shrink-0 text-[22px] leading-7 font-medium whitespace-nowrap', emphasis && 'text-primary', tone === 'danger' && 'text-danger-fg', tone === 'success' && 'text-success-fg')}>{value}</span>
      </div>
    </div>
  )
}

export interface TimelineItem {
  id: string
  when: string
  title: ReactNode
  detail?: ReactNode
  who?: string
}

/** Linha do tempo (contrato, chamado, auditoria): o mais novo em cima. */
export function Timeline({ items, empty = 'Nada registrado ainda.' }: { items: TimelineItem[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>
  return (
    <ol className="relative flex flex-col gap-3 border-l border-border pl-5">
      {items.map((it) => (
        <li key={it.id} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-primary" aria-hidden="true" />
          <p className="text-sm font-medium">{it.title}</p>
          {it.detail && <div className="mt-0.5 text-sm text-muted">{it.detail}</div>}
          <p className="mt-0.5 text-xs text-muted">
            {it.when}
            {it.who ? ` · ${it.who}` : ''}
          </p>
        </li>
      ))}
    </ol>
  )
}

/** Etapas de um formulário longo (cadastro de imóvel, contrato): onde estou e o que falta. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Etapas">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === current ? 'step' : undefined}>
          <span
            className={cn(
              'grid size-7 place-items-center rounded-full text-xs font-bold',
              i < current ? 'bg-primary text-on-primary' : i === current ? 'border-2 border-primary text-primary' : 'border border-border text-muted',
            )}
          >
            {i < current ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
          </span>
          <span className={cn('text-sm', i === current ? 'font-semibold' : 'text-muted')}>{s}</span>
          {i < steps.length - 1 && <span className="mx-1 hidden h-px w-6 bg-border sm:block" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  )
}
