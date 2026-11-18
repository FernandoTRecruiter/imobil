/* =============================================================================
   charts.tsx: os gráficos da Visão geral e dos Relatórios, sem biblioteca (decisão 015).

   - MonthBars: série no tempo em SVG simples (barras por mês). O resumo em texto fica com
     quem usa (figcaption), porque é ele que sabe o que importa dizer.
   - Sparkline: a tendência minúscula ao lado do número dos blocos da Visão geral (07/11).
     Até 07/11 havia aqui também o RateList (ocupação por imóvel); saiu junto com o bloco.

   Sem Radix e sem roteador: o HTML do Power BI desenha com estes mesmos componentes.
   ============================================================================= */
import { useLayoutEffect, useRef, useState } from 'react'
import type { IsoDate } from '@/data/types'
import { formatMonth } from '@/lib/dates'
import { cn } from '@/components/ui/cn'

/* ---------------------------------------------------------------- números para a tela */

/** 0,924 -> "92,4%". Sem dado (nada alugável, nada venceu) vira "0%" e a dica explica. */
export function formatRate(rate: number | null, digits = 1): string {
  if (rate === null || !Number.isFinite(rate)) return '0%'
  return `${(rate * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
}

/**
 * Teto "redondo" do eixo: 237.000 vira 250.000. Assim as linhas de grade caem em números que
 * se leem de relance (0, metade, teto). Passo a passo: acha a casa decimal (10, 100, 1000...)
 * e escolhe o menor entre 1, 2, 2,5, 5 e 10 vezes essa casa que cobre o valor.
 */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * mag >= v) return step * mag
  return 10 * mag
}

/* ---------------------------------------------------------------- MonthBars */

export interface MonthSeries {
  key: string
  label: string
  values: number[]
  /** Cor por variável de tema (var(--primary)); a mais clara usa a mesma cor com opacidade. */
  color: string
  opacity?: number
}

interface MonthBarsProps {
  months: IsoDate[]
  series: MonthSeries[]
  /** Formata o eixo e a dica ("R$ 12 mil", "92%"). */
  format: (v: number) => string
  /** Régua fixa (ex.: 1 para taxa). Sem ela, o maior valor arredondado para cima. */
  max?: number
  ariaLabel: string
  /** Clique (ou Enter) num mês: leva ao filtro daquele mês. */
  onSelect?: (month: IsoDate) => void
  height?: number
}

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function MonthBars({ months, series, format, max, ariaLabel, onSelect, height = 220 }: MonthBarsProps) {
  // Passo 1: medir a largura de verdade. Com viewBox fixo o texto encolheria junto no celular
  // (letra de 5 px); medindo, a letra fica sempre do mesmo tamanho e só as barras se ajustam.
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Passo 2: escala. Teto redondo, grade em 0, metade e teto.
  const top = max ?? niceCeil(Math.max(0, ...series.flatMap((s) => s.values)))
  const ticks = [0, top / 2, top]
  // Espaço do eixo pelo rótulo mais longo (~7 px por letra a 11 px) + folga: com menos, "100%" saía cortado.
  const padL = Math.max(...ticks.map((t) => format(t).length)) * 7 + 14
  const padR = 4
  const padT = 10
  const padB = 24
  const plotW = Math.max(0, width - padL - padR)
  const plotH = height - padT - padB
  const colW = months.length ? plotW / months.length : 0
  const gap = 2
  const groupW = Math.min(colW * 0.72, 40 * series.length)
  const barW = series.length ? Math.max(1, (groupW - gap * (series.length - 1)) / series.length) : 0
  const y = (v: number) => padT + plotH - (top > 0 ? (Math.min(v, top) / top) * plotH : 0)
  const fontSize = colW < 28 ? 10 : 11
  const interactive = !!onSelect

  return (
    <div ref={box} className="w-full min-w-0">
      {width > 0 && (
        <svg width={width} height={height} role={interactive ? 'group' : 'img'} aria-label={ariaLabel} className="block text-muted">
          {ticks.map((t) => (
            <g key={t} aria-hidden="true">
              <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--border)' }} />
              <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor">
                {format(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const x0 = padL + i * colW
            // Passo 3: cada mês é um grupo com dica (title) e, se clicável, foco de teclado.
            const said = `${formatMonth(m)}: ${series.map((s) => `${s.label.toLowerCase()} ${format(s.values[i] ?? 0)}`).join(', ')}`
            return (
              <g
                key={m}
                className={cn('group outline-none', interactive && 'cursor-pointer')}
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? 'button' : undefined}
                aria-label={interactive ? said : undefined}
                onClick={interactive ? () => onSelect(m) : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelect(m)
                        }
                      }
                    : undefined
                }
              >
                <title>{said}</title>
                <rect
                  x={x0 + 1}
                  y={padT}
                  width={Math.max(0, colW - 2)}
                  height={plotH}
                  rx={4}
                  className={cn('fill-transparent', interactive && 'group-hover:fill-[var(--surface-2)] group-focus-visible:stroke-[var(--focus)] group-focus-visible:stroke-2')}
                />
                {series.map((s, j) => {
                  const v = s.values[i] ?? 0
                  const h = Math.max(0, y(0) - y(v))
                  return <rect key={s.key} x={x0 + (colW - groupW) / 2 + j * (barW + gap)} y={y(0) - h} width={barW} height={h} rx={2} style={{ fill: s.color, opacity: s.opacity ?? 1 }} />
                })}
                <text x={x0 + colW / 2} y={height - 6} textAnchor="middle" fontSize={fontSize} fill="currentColor" aria-hidden="true">
                  {MES[Number(m.slice(5, 7)) - 1]}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

/** Legenda das séries: cor + texto (cor nunca sozinha). */
export function SeriesLegend({ series }: { series: Pick<MonthSeries, 'key' | 'label' | 'color' | 'opacity'>[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color, opacity: s.opacity ?? 1 }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  )
}

/* ---------------------------------------------------------------- Sparkline */

/**
 * Tendência minúscula (12 pontos): uma linha fina na cor do texto apagado e o ponto de hoje em
 * azul. Passo a passo:
 * 1. a régua vai do menor ao maior valor da série, com 3 px de folga em volta (sem folga, o ponto
 *    de hoje, que tem raio, sairia cortado na borda);
 * 2. série reta (todos iguais) fica no meio da altura, em vez de dividir por zero;
 * 3. o desenho é só imagem (role="img"): o que ela diz vai no aria-label, e o número está ao lado.
 * Atenção: com a régua do menor ao maior, uma variação de 92% para 93% parece grande. É de
 * propósito (a pergunta é "subiu ou caiu?"); o tamanho real está no número e na seta.
 */
export function Sparkline({ values, label, width = 72, height = 26 }: { values: number[]; label: string; width?: number; height?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = 3
  const span = max - min
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2)
  const y = (v: number) => (span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - pad * 2))
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = values.length - 1
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="shrink-0 text-faint">
      <title>{label}</title>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(values[last])} r={2.5} style={{ fill: 'var(--primary)' }} />
    </svg>
  )
}
