/* =============================================================================
   dates.ts: datas como TEXTO 'AAAA-MM-DD', sem hora.

   Por quê: new Date('2026-02-28') é lido como meia-noite em UTC; no Brasil (UTC-3) isso
   vira 27/02 às 21h e a tela mostra o dia errado. Trabalhando com o texto e com
   Date.UTC só para contar dias, o fuso não entra onde não deve.
   "Hoje" é o único lugar onde o fuso importa: é calculado no fuso da organização.
   ============================================================================= */
import type { IsoDate } from '@/data/types'

export const DEFAULT_TZ = 'America/Sao_Paulo'

/** Data de hoje no fuso pedido. O formato en-CA do Intl já devolve 'AAAA-MM-DD'. */
export function todayIn(tz: string = DEFAULT_TZ, now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function parts(iso: IsoDate): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return [y, m, d]
}

export function toIso(y: number, m: number, d: number): IsoDate {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Primeiro dia do mês da data: a "competência" do lançamento. */
export function monthStart(iso: IsoDate): IsoDate {
  const [y, m] = parts(iso)
  return toIso(y, m, 1)
}

/** Soma meses mantendo o dia, e cai no último dia quando o mês é curto (31/01 + 1 = 28/02). */
export function addMonths(iso: IsoDate, n: number): IsoDate {
  const [y, m, d] = parts(iso)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return toIso(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

/**
 * Vencimento de uma competência com o dia combinado no contrato.
 * ARMADILHA que esta função evita: encadear addMonths a partir do vencimento anterior faz o
 * dia 31 virar 28 em fevereiro e ficar 28 PARA SEMPRE. Aqui cada mês parte do dia combinado.
 */
export function dueDateFor(competence: IsoDate, dueDay: number): IsoDate {
  const [y, m] = parts(competence)
  return toIso(y, m, Math.min(dueDay, daysInMonth(y, m)))
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  const [y, m, d] = parts(iso)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/** Dias de a até b (positivo se b é depois de a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ya, ma, da] = parts(a)
  const [yb, mb, db] = parts(b)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000)
}

/** Meses inteiros entre duas datas (para tempo de contrato). */
export function monthsBetween(a: IsoDate, b: IsoDate): number {
  const [ya, ma, da] = parts(a)
  const [yb, mb, db] = parts(b)
  return (yb - ya) * 12 + (mb - ma) - (db < da ? 1 : 0)
}

/** '2026-11-04' -> '04/11/2026'. */
export function formatDate(iso: IsoDate | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = parts(iso)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** '2026-11-01' -> 'nov/2026'. */
export function formatMonth(iso: IsoDate): string {
  const [y, m] = parts(iso)
  return `${MESES[m - 1]}/${y}`
}

/** Data e hora de um evento, no fuso da organização: '04/11/2026 14:32'. */
export function formatDateTime(isoDateTime: string, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoDateTime))
}

/** Lê "04/11/2026", "4/11/26" ou "2026-11-04" (planilha e formulário). Null se não for data válida. */
export function parseDateBR(input: string | null | undefined): IsoDate | null {
  if (!input) return null
  const s = input.trim()
  let y: number, m: number, d: number
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (br) [d, m, y] = [Number(br[1]), Number(br[2]), Number(br[3].length === 2 ? '20' + br[3] : br[3])]
  else return null
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null
  return toIso(y, m, d)
}
