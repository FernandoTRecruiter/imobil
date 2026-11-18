/* =============================================================================
   csv.ts: exportar o que está na tela para o Excel brasileiro abrir certo.
   Três detalhes que evitam o arquivo "quebrado":
   1. separador ponto e vírgula (no Excel em pt-BR a vírgula é decimal);
   2. BOM no começo (marca invisível que avisa o Excel que o texto é UTF-8: sem ela "Ação" vira "AÃ§Ã£o");
   3. valor em reais como "1234,56", sem R$ e sem ponto de milhar, para virar número na planilha.
   ============================================================================= */
import type { Cents } from '@/data/types'

export interface CsvColumn<T> {
  label: string
  value: (row: T) => string | number | null | undefined
}

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => cell(c.label)).join(';')
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(';'))
  return '﻿' + [head, ...body].join('\r\n')
}

/** Centavos para número de planilha pt-BR: 123456 -> "1234,56". */
export function csvMoney(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  const neg = cents < 0
  const abs = Math.abs(cents)
  return `${neg ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
