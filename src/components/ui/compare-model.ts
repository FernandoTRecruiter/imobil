/* =============================================================================
   compare-model.ts: a parte SEM tela do "Comparar" (pedido de 07/11/2026: "deixar eu comparar
   imóveis e unidades"). Recebe as coisas escolhidas e a lista de indicadores e devolve a tabela
   pronta: uma linha por indicador, uma célula por coisa, com o melhor e o pior de cada linha.

   Regra do melhor e do pior (marca discreta na tela, cor do texto):
     1. só vale para indicador numérico que diz qual lado é bom ("higher" ou "lower");
     2. precisa de pelo menos dois valores preenchidos e diferentes (todos iguais: ninguém ganha);
     3. empate no topo: todos os empatados levam a marca.
   Ficam fora de propósito: texto (locatário), data (fim do contrato) e o que não tem lado bom
   (área, quartos: maior não é "melhor" para todo mundo).
   ============================================================================= */
import type { CsvColumn } from '@/lib/csv'
import { formatDate } from '@/lib/dates'
import { formatBRL } from '@/lib/money'

export type MetricKind = 'int' | 'pct' | 'money' | 'area' | 'months' | 'text' | 'date'

export interface MetricDef<T> {
  key: string
  label: string
  kind: MetricKind
  /** Qual lado é o bom; sem isto, a linha não marca melhor nem pior. */
  better?: 'higher' | 'lower'
  value: (item: T) => number | string | null
  /** Fórmula curta (vai no "i" da linha). */
  info?: string
}

export interface CompareCell {
  text: string
  raw: number | string | null
  mark: 'best' | 'worst' | null
}

export interface CompareRow {
  key: string
  label: string
  info?: string
  cells: CompareCell[]
}

/** "1 ano e 4 meses", "8 meses", "menos de 1 mês". Vazio quando não há número. */
export function formatMonths(n: number | null): string {
  if (n === null) return ''
  if (n < 1) return 'menos de 1 mês'
  const y = Math.floor(n / 12)
  const m = n % 12
  const ys = y ? `${y} ${y === 1 ? 'ano' : 'anos'}` : ''
  const ms = m ? `${m} ${m === 1 ? 'mês' : 'meses'}` : ''
  return [ys, ms].filter(Boolean).join(' e ')
}

/** O texto de uma célula, pelo tipo do indicador (vazio vira "sem dado", não zero). */
export function formatMetric(kind: MetricKind, v: number | string | null): string {
  if (v === null || v === '') return 'sem dado'
  if (typeof v === 'string') return kind === 'date' ? formatDate(v) : v
  switch (kind) {
    case 'money':
      return formatBRL(v)
    case 'pct':
      return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
    case 'area':
      return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m²`
    case 'months':
      return formatMonths(v)
    default:
      return v.toLocaleString('pt-BR')
  }
}

/** A tabela do Comparar: uma linha por indicador, uma célula por coisa, na ordem recebida. */
export function buildComparison<T>(items: T[], metrics: MetricDef<T>[]): CompareRow[] {
  return metrics.map((m) => {
    const raws = items.map((it) => m.value(it))
    const nums = raws.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    // Passos 1 e 2 do cabeçalho: lado bom definido, dois ou mais números, e não todos iguais.
    const rank = !!m.better && nums.length >= 2 && Math.max(...nums) !== Math.min(...nums)
    const best = m.better === 'higher' ? Math.max(...nums) : Math.min(...nums)
    const worst = m.better === 'higher' ? Math.min(...nums) : Math.max(...nums)
    return {
      key: m.key,
      label: m.label,
      info: m.info,
      cells: raws.map((raw) => ({
        raw,
        text: formatMetric(m.kind, raw),
        // Passo 3: empate leva a mesma marca.
        mark: rank && typeof raw === 'number' ? (raw === best ? 'best' : raw === worst ? 'worst' : null) : null,
      })),
    }
  })
}

/** Unidade no nome da coluna do arquivo: a planilha transforma "1234,56" em número (lib/exportar.ts). */
const UNIT_SUFFIX: Partial<Record<MetricKind, string>> = { money: ' (R$)', pct: ' (%)', area: ' (m²)', months: ' (meses)' }

/**
 * O Comparar no arquivo: uma LINHA por coisa e uma coluna por indicador (a tela mostra ao contrário,
 * mas na planilha cada coisa numa linha é o que deixa ordenar e filtrar). Número sai cru (dinheiro em
 * reais, com vírgula), com a unidade no nome da coluna.
 */
export function comparisonExport<T>(nameOf: (t: T) => string, metrics: MetricDef<T>[], firstLabel: string): CsvColumn<T>[] {
  return [
    { label: firstLabel, value: nameOf },
    ...metrics.map((m) => ({
      label: `${m.label}${UNIT_SUFFIX[m.kind] ?? ''}`,
      value: (t: T) => {
        const v = m.value(t)
        if (v === null || typeof v === 'string') return m.kind === 'date' && v ? formatDate(v) : v
        if (m.kind === 'money') return (v / 100).toFixed(2).replace('.', ',')
        return String(Math.round(v * 10) / 10).replace('.', ',')
      },
    })),
  ]
}
