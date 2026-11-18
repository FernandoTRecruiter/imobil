/* =============================================================================
   money.ts: dinheiro sempre em CENTAVOS INTEIROS.

   Por quê: o JavaScript guarda número com vírgula em binário e erra na conta
   (0.1 + 0.2 = 0.30000000000000004). Em centavos inteiros (R$ 1.234,56 = 123456) a soma
   é exata. Só dividimos por 100 na hora de MOSTRAR.
   ============================================================================= */
import type { Cents } from '@/data/types'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** 123456 -> "R$ 1.234,56" (o Intl põe um espaço que não quebra entre R$ e o número). */
export function formatBRL(cents: Cents): string {
  return brl.format(cents / 100)
}

/** Versão curta para indicador: 1234567 -> "R$ 12,3 mil". */
export function formatBRLShort(cents: Cents): string {
  const reais = cents / 100
  const abs = Math.abs(reais)
  if (abs >= 1_000_000) return `R$ ${(reais / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 10_000) return `R$ ${(reais / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  return formatBRL(cents)
}

/**
 * Lê o que a pessoa digitou ou o que veio da planilha e devolve centavos (ou null se não der).
 * Aceita "1.234,56", "1234,56", "R$ 1.234,56", "1234.56" e "1234".
 * Passo a passo: tira R$ e espaços; descobre qual sinal é o decimal; junta inteiro + 2 casas
 * como TEXTO (sem passar por número com vírgula, que traria o erro do binário de volta).
 */
export function parseBRL(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null
  let s = input.replace(/R\$/gi, '').replace(/\s/g, '').trim()
  if (!s) return null
  const negative = s.startsWith('-')
  if (negative) s = s.slice(1)
  let intPart: string
  let fracPart = ''
  if (s.includes(',')) {
    // Padrão brasileiro: ponto separa milhar, vírgula separa os centavos.
    const [i, f = ''] = s.split(',')
    intPart = i.replace(/\./g, '')
    fracPart = f
  } else {
    // Sem vírgula: o último ponto só é decimal se tiver 1 ou 2 casas depois ("1234.5").
    const m = s.match(/^(.*)\.(\d{1,2})$/)
    if (m) {
      intPart = m[1].replace(/\./g, '')
      fracPart = m[2]
    } else {
      intPart = s.replace(/\./g, '')
    }
  }
  if (!/^\d+$/.test(intPart || '0') || !/^\d*$/.test(fracPart)) return null
  // Mais de 2 casas: arredonda a terceira (meio para cima).
  const third = fracPart.length > 2 ? Number(fracPart[2]) : 0
  const cents = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2)) + (third >= 5 ? 1 : 0)
  return negative ? -cents : cents
}

/**
 * Percentual de um valor, arredondado ao centavo (meio para cima): applyPct(150000, 10) = 15000.
 * Conta feita com BigInt (inteiro sem limite) para não perder precisão em valor grande.
 */
export function applyPct(cents: Cents, pct: number): Cents {
  const p = BigInt(Math.round(pct * 10_000)) // 8,5% vira 85000 (4 casas de precisão)
  const raw = BigInt(Math.round(cents)) * p
  const sign = raw < 0n ? -1n : 1n
  const abs = raw < 0n ? -raw : raw
  return Number(sign * ((abs + 500_000n) / 1_000_000n))
}

/**
 * Rateio que SEMPRE fecha: divide um total entre pesos (ex.: % de cada proprietário) e dá o
 * centavo que sobra para quem tem a maior fração (empate: quem vem primeiro na lista).
 * Exemplo: 100001 (R$ 1.000,01) em 50/50 = [50001, 50000]; a soma volta a ser 100001.
 */
export function splitByShares(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (!weights.length || sum <= 0) return weights.map(() => 0)
  const raw = weights.map((w) => (total * w) / sum)
  const parts = raw.map((r) => Math.floor(r))
  let left = total - parts.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    parts[i] += 1
    left -= 1
  }
  return parts
}

/** Soma segura de uma lista de centavos. */
export function sumCents(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0)
}
