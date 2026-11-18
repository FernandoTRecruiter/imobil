/* =============================================================================
   exportar.ts: baixar o que a lista mostra, em planilha do Excel (.xlsx) ou em CSV.

   Por que um lugar só (07/11/2026, "filtros enormes com 'baixar CSV' e 'Exportar planilha',
   tudo muito contra-intuitivo"): cada tela tinha o próprio botão com um nome diferente. Agora
   toda lista tem UM botão "Exportar" (ListToolbar) com as duas saídas, e as duas saem daqui:
     - CSV: o mesmo de antes (lib/csv.ts: ponto e vírgula, BOM, valor "1234,56");
     - .xlsx: a planilha de verdade (SheetJS, já instalado), com número como NÚMERO.

   A regra que transforma texto em número na planilha é pelo NOME da coluna: coluna cujo nome
   termina com a unidade entre parênteses ("Aluguel (R$)", "Área (m²)", "Ocupação (%)") tem o
   texto "1.234,56" convertido em 1234,56 numérico. Por que pelo nome e não por tentativa: o
   código da unidade "0101" parece número e perderia o zero da frente. Também valem "(meses)" e
   "(dias)" (tempo de contrato, dias para vencer). Dinheiro ganha o formato
   "#.##0,00" na célula. Data continua texto ("04/11/2026"): é como a tela mostra.
   ============================================================================= */
import { downloadText, toCsv, type CsvColumn } from './csv'

export type ExportFormat = 'xlsx' | 'csv'

/** As saídas do botão "Exportar", na ordem do menu (planilha primeiro: é o que quase todo mundo quer). */
export const EXPORT_FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'xlsx', label: 'Planilha Excel (.xlsx)', hint: 'número já vira número' },
  { value: 'csv', label: 'CSV', hint: 'texto com ponto e vírgula' },
]

export type SheetValue = string | number | null

/** Nome de coluna com unidade no fim: "(R$)", "(%)", "(m²)", "(meses)" ou "(dias)". */
const UNIT_IN_LABEL = /\((R\$|%|m²|meses|dias)\)\s*$/
/** Número escrito em pt-BR: "1234,56", "1.234,5", "-12", "65". */
const PT_NUMBER = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/

/**
 * O valor de uma célula da planilha. Passo a passo:
 *   1. vazio (null, undefined, "") vira célula vazia;
 *   2. número continua número;
 *   3. texto numérico em coluna com unidade no nome vira número (tira o ponto de milhar e troca a vírgula);
 *   4. o resto continua texto (código, nome, data).
 */
export function sheetCell(label: string, v: string | number | null | undefined): SheetValue {
  if (v === null || v === undefined || v === '') return null // passo 1
  if (typeof v === 'number') return Number.isFinite(v) ? v : null // passo 2
  const s = String(v)
  if (UNIT_IN_LABEL.test(label) && PT_NUMBER.test(s)) return Number(s.replace(/\./g, '').replace(',', '.')) // passo 3
  return s // passo 4
}

/** Cabeçalho + linhas, do jeito que a planilha recebe (primeira linha = nomes das colunas). */
export function toSheetRows<T>(rows: T[], columns: CsvColumn<T>[]): SheetValue[][] {
  return [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => sheetCell(c.label, c.value(r))))]
}

/**
 * Monta o arquivo .xlsx em memória (sem baixar): é o que o teste lê de volta. Cada aba ganha a
 * largura de coluna pelo maior texto (até 60) e o formato de dinheiro nas colunas "(R$)".
 */
export async function xlsxBytes(sheets: { name: string; rows: SheetValue[][] }[]): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const sh of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sh.rows)
    const head = sh.rows[0] ?? []
    // Largura de cada coluna pelo maior texto dela (até 60), para a planilha abrir legível.
    ws['!cols'] = head.map((_, ci) => ({ wch: Math.min(60, Math.max(10, ...sh.rows.map((r) => String(r[ci] ?? '').length + 2))) }))
    // Dinheiro com duas casas e ponto de milhar (o Excel em pt-BR mostra "1.234,56").
    head.forEach((h, ci) => {
      if (typeof h !== 'string' || !/\(R\$\)\s*$/.test(h)) return
      for (let ri = 1; ri < sh.rows.length; ri++) {
        const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })]
        if (cell && typeof cell.v === 'number') cell.z = '#,##0.00'
      }
    })
    XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31) || 'Dados') // o Excel aceita no máximo 31 letras no nome da aba
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array
}

/** Baixa a planilha (uma aba por item de "sheets"). Texto entra como texto: o CPF "012..." continua com o zero. */
export async function downloadXlsx(fileName: string, sheets: { name: string; rows: SheetValue[][] }[]): Promise<void> {
  const bytes = await xlsxBytes(sheets)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * A porta única das telas: baixa as linhas com as colunas pedidas no formato escolhido.
 * "name" é o nome do arquivo sem extensão (a extensão vem do formato; ".csv" antigo no nome é tirado).
 */
export async function downloadTable<T>(name: string, rows: T[], columns: CsvColumn<T>[], format: ExportFormat, sheetName = 'Dados'): Promise<void> {
  const base = name.replace(/\.(csv|xlsx)$/i, '')
  if (format === 'csv') {
    downloadText(`${base}.csv`, toCsv(rows, columns))
    return
  }
  await downloadXlsx(`${base}.xlsx`, [{ name: sheetName, rows: toSheetRows(rows, columns) }])
}
