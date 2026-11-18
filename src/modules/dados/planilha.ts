/* =============================================================================
   planilha.ts: transforma o arquivo que a pessoa escolheu (CSV ou XLSX) em linhas e colunas.

   Por que existe: o assistente de importação precisa de uma tabela simples (lista de linhas,
   cada linha uma lista de células) sem se importar se veio do Excel, do Google Planilhas ou
   de um sistema antigo. Aqui só se LÊ; validar o conteúdo é do importacao.ts.

   Base: o parseCSV e a adivinhação de colunas do financas-pessoais (portfólio), adaptados:
   1. separador escolhido pela CONSTÂNCIA (mesmo número de colunas em várias linhas), e não só
      pela primeira linha: um título "Imóveis, novembro" no topo enganava a versão antiga;
   2. aspas só abrem campo no COMEÇO da célula (Rua "A" sem aspas em volta não quebra a linha);
   3. acento: tenta UTF-8 e, se aparecer o caractere de substituição, relê como Windows-1252,
      que é o que o Excel brasileiro grava no "CSV (separado por vírgulas)";
   4. coluna adivinhada por sinônimo normalizado ("CPF", "CPF/CNPJ" e "Documento" viram o mesmo
      campo), com a última escolha da pessoa vencendo a adivinhação.
   ============================================================================= */
import { toIso } from '@/lib/dates'

/** Uma célula: texto (CSV e XLSX), número ou verdadeiro/falso (só XLSX). */
export type Cell = string | number | boolean | null

export interface Sheet {
  name: string
  rows: Cell[][]
  /** Número da linha no arquivo de cada item de rows (1 = primeira linha). Linha vazia some de
   *  rows, mas a numeração continua a do arquivo: "linha 9" na prévia é a linha 9 do Excel. */
  lines: number[]
}

export type Delimiter = ';' | ',' | '\t'
export type Encoding = 'utf-8' | 'windows-1252'

export interface ReadResult {
  kind: 'csv' | 'xlsx'
  sheets: Sheet[]
  /** Só no CSV: como o texto foi lido e qual separador foi achado (a tela mostra para a pessoa conferir). */
  encoding: Encoding | null
  delimiter: Delimiter | null
}

/** Limites de um lote: acima disso a tela pede para dividir (o navegador trava e a prévia fica ilegível). */
export const MAX_ROWS = 5000
export const MAX_BYTES = 10 * 1024 * 1024

export const DELIMITER_LABEL: Record<Delimiter, string> = { ';': 'ponto e vírgula', ',': 'vírgula', '\t': 'tabulação' }

/* ---------------------------------------------------------------- texto e acento */

/** Caractere de substituição (U+FFFD): é o que o leitor UTF-8 põe no lugar de um byte que não entende. */
const REPLACEMENT = String.fromCharCode(0xfffd)
/** BOM (U+FEFF): marca invisível que alguns programas põem no começo de um texto UTF-8. */
const BOM = String.fromCharCode(0xfeff)

/** Tira o BOM do começo (senão o primeiro cabeçalho vira "?Nome" e não bate com "Nome"). */
function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text
}

/**
 * Bytes -> texto. Passo a passo:
 * 1. lê como UTF-8 sem travar (byte inválido vira o caractere de substituição U+FFFD);
 * 2. se apareceu o U+FFFD, o arquivo não era UTF-8: relê como Windows-1252 (Excel brasileiro);
 * 3. tira o BOM.
 * Armadilha evitada: ler tudo como UTF-8 transforma "Ação" em "A" + dois U+FFFD + "o" e o CPF
 * continua certo, então o erro só apareceria depois, no nome da pessoa.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: Encoding } {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes(REPLACEMENT)) return { text: stripBom(utf8), encoding: 'utf-8' }
  return { text: stripBom(new TextDecoder('windows-1252').decode(bytes)), encoding: 'windows-1252' }
}

/* ---------------------------------------------------------------- separador */

/** Quantas vezes o separador aparece na linha, fora de aspas. */
function countOutsideQuotes(line: string, d: Delimiter): number {
  let n = 0
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === d && !quoted) n++
  }
  return n
}

/**
 * Descobre o separador olhando as 10 primeiras linhas com conteúdo.
 * Para cada candidato, conta quantas linhas têm o MESMO número de separadores (a "moda");
 * vence quem repete mais vezes, com pelo menos um separador. Empate: ";" (padrão do Excel
 * brasileiro), depois "," e por último tabulação.
 * Por que constância e não "o que mais aparece": num CSV com ";" os valores "1.234,56" têm
 * vírgula; uma linha com cinco valores teria mais vírgulas que pontos e vírgulas.
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 10)
  let best: { d: Delimiter; score: number; cols: number } = { d: ';', score: 0, cols: 0 }
  for (const d of [';', ',', '\t'] as const) {
    const counts = lines.map((l) => countOutsideQuotes(l, d))
    const freq = new Map<number, number>()
    for (const c of counts) if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1)
    let mode = 0
    let score = 0
    for (const [c, f] of freq) if (f > score || (f === score && c > mode)) [mode, score] = [c, f]
    if (score > best.score || (score === best.score && score > 0 && mode > best.cols)) best = { d, score, cols: mode }
  }
  return best.d
}

/* ---------------------------------------------------------------- CSV */

/**
 * Lê o CSV num laço de um caractere por vez (máquina de estados com "dentro de aspas" e "fora").
 * Regras do formato: aspas no começo da célula abrem um campo que pode ter separador e quebra
 * de linha dentro; "" dentro de aspas vale uma aspa; \r\n, \n e \r terminam a linha.
 * Linhas totalmente vazias são descartadas (o Excel costuma deixar algumas no fim), mas cada
 * registro guarda a linha do arquivo em que começou, para a prévia apontar a linha certa.
 */
export function parseCsvRecords(text: string, delimiter: Delimiter = detectDelimiter(text)): { cells: string[]; line: number }[] {
  const src = stripBom(text)
  const out: { cells: string[]; line: number }[] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let fieldStarted = false // já entrou algum caractere nesta célula? (aspa só é especial no começo)
  let line = 1 // linha física atual do arquivo
  let rowLine = 1 // linha em que o registro atual começou
  const endField = () => {
    row.push(field)
    field = ''
    fieldStarted = false
  }
  const endRow = () => {
    endField()
    if (row.some((cell) => cell.trim() !== '')) out.push({ cells: row, line: rowLine })
    row = []
    line++
    rowLine = line
  }
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else {
        if (c === '\n') line++ // quebra DENTRO de aspas: a célula continua, a contagem de linhas também
        field += c
      }
      continue
    }
    if (c === '"' && !fieldStarted) {
      quoted = true
      fieldStarted = true
    } else if (c === delimiter) endField()
    else if (c === '\n') endRow()
    else if (c === '\r') {
      if (src[i + 1] === '\n') i++
      endRow()
    } else {
      field += c
      fieldStarted = true
    }
  }
  if (field !== '' || row.length) endRow()
  return out
}

/** Só as células (para quem não precisa do número da linha). */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  return parseCsvRecords(text, delimiter).map((r) => r.cells)
}

/* ---------------------------------------------------------------- célula e data */

/** Célula como texto limpo (número vira "123"; vazio vira ""). */
export function cellText(c: Cell | undefined): string {
  if (c === null || c === undefined) return ''
  if (typeof c === 'boolean') return c ? 'sim' : 'não'
  return String(c).trim()
}

export function isEmptyCell(c: Cell | undefined): boolean {
  return cellText(c) === ''
}

/**
 * Número de série do Excel (dias desde 30/12/1899) -> 'AAAA-MM-DD'.
 * Por que à mão e em UTC: a data do Excel não tem fuso; convertendo no fuso do navegador, o
 * dia 01/03 viraria 28/02 às 21h no Brasil. Só a parte inteira importa (a fração é a hora).
 */
export function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 2_958_465) return null
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000)
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/* ---------------------------------------------------------------- cabeçalho e colunas */

/**
 * Chave de comparação de cabeçalho: sem acento, sem caixa e só letras e números.
 * NFKD (e não NFD) também desmonta "²" em "2" e "º" em "o": "Área (m²)" vira "aream2".
 */
export function headerKey(s: string): string {
  return s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Qual linha é o cabeçalho: a primeira, entre as 10 primeiras, com pelo menos 2 nomes
 * conhecidos (ou 1, se a linha tiver uma coluna só). Sem nenhuma, a primeira linha.
 * Por que procurar: planilha exportada de outro sistema costuma ter título e data em cima.
 */
export function findHeaderRow(rows: Cell[][], knownSynonyms: string[]): number {
  const known = new Set(knownSynonyms.map(headerKey))
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = rows[i].map((c) => headerKey(cellText(c))).filter(Boolean)
    const hits = cells.filter((c) => known.has(c)).length
    if (hits >= Math.min(2, cells.length) && hits > 0) return i
  }
  return 0
}

export interface GuessField {
  key: string
  label: string
  synonyms: string[]
}

/**
 * Sugere a coluna de cada campo. Passo a passo:
 * 1. a escolha lembrada da última importação desta entidade vale primeiro (pelo NOME da coluna);
 * 2. depois, pontuação por par campo x coluna: 3 = nome igual a um sinônimo; 2 = um contém o
 *    outro (só com 4 letras ou mais, senão "n" acharia "nome");
 * 3. os pares são distribuídos do maior ponto para o menor, uma coluna por campo.
 * Devolve campo -> índice da coluna (null = não importar).
 */
export function guessMapping(headers: string[], fields: GuessField[], remembered: Record<string, string> = {}): Record<string, number | null> {
  const keys = headers.map(headerKey)
  const out: Record<string, number | null> = Object.fromEntries(fields.map((f) => [f.key, null]))
  const used = new Set<number>()

  for (const f of fields) {
    const want = remembered[f.key]
    if (!want) continue
    const i = keys.findIndex((k, idx) => k !== '' && k === headerKey(want) && !used.has(idx))
    if (i >= 0) {
      out[f.key] = i
      used.add(i)
    }
  }

  const pairs: { field: number; col: number; score: number }[] = []
  fields.forEach((f, fi) => {
    if (out[f.key] !== null) return
    const syn = [f.label, ...f.synonyms].map(headerKey).filter(Boolean)
    keys.forEach((k, ci) => {
      if (!k || used.has(ci)) return
      let score = 0
      for (const sk of syn) {
        if (k === sk) score = Math.max(score, 3)
        else if ((sk.length >= 4 && k.includes(sk)) || (k.length >= 4 && sk.includes(k))) score = Math.max(score, 2)
      }
      if (score) pairs.push({ field: fi, col: ci, score })
    })
  })
  pairs.sort((a, b) => b.score - a.score || a.field - b.field || a.col - b.col)
  for (const p of pairs) {
    const key = fields[p.field].key
    if (out[key] !== null || used.has(p.col)) continue
    out[key] = p.col
    used.add(p.col)
  }
  return out
}

/* ---------------------------------------------------------------- ler o arquivo */

/** CSV em bytes -> uma "aba" com as linhas. */
export function readCsvBytes(bytes: Uint8Array, name = 'CSV'): { sheet: Sheet; encoding: Encoding; delimiter: Delimiter } {
  const { text, encoding } = decodeText(bytes)
  const delimiter = detectDelimiter(text)
  const records = parseCsvRecords(text, delimiter)
  return { sheet: { name, rows: records.map((r) => r.cells.map((c) => c.trim())), lines: records.map((r) => r.line) }, encoding, delimiter }
}

/**
 * XLSX, XLS ou ODS em bytes -> abas com as linhas. O SheetJS só é baixado aqui (import dinâmico):
 * quem nunca importa não paga o tamanho dele.
 * raw: true mantém número como número (1234.567 não vira "1234.567" de texto, que seria lido
 * como milhar) e data como número de série (convertida sem fuso em excelSerialToIso).
 */
export async function readWorkbookBytes(bytes: Uint8Array): Promise<Sheet[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(bytes, { type: 'array' })
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]
    // A aba pode começar abaixo da linha 1 (ex.: dados de B3 a F20): a 1ª linha lida é a s.r + 1.
    const first = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r + 1 : 1
    const raw = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: '', blankrows: true })
    const rows: Cell[][] = []
    const lines: number[] = []
    raw.forEach((r, i) => {
      const cells = r.map((c) => (typeof c === 'string' ? c.trim() : c))
      if (cells.some((c) => !isEmptyCell(c))) {
        rows.push(cells)
        lines.push(first + i)
      }
    })
    return { name, rows, lines }
  })
}

/**
 * Monta e baixa um .xlsx (modelo de importação e exportação do Data Manager). Mora em
 * lib/exportar.ts desde 07/11/2026 (o "Exportar" de todas as listas usa o mesmo); fica
 * reexportado aqui para quem já importava deste arquivo.
 * Texto entra como texto: o CPF "012.345.678-90" do modelo continua com o zero da frente.
 */
export { downloadXlsx } from '@/lib/exportar'

/** O arquivo escolhido na tela (navegador). Erro sai com a causa e o conserto. */
export async function readSpreadsheetFile(file: File): Promise<ReadResult> {
  if (file.size === 0) throw new Error('O arquivo está vazio: salve a planilha de novo e escolha outra vez.')
  if (file.size > MAX_BYTES) throw new Error(`Arquivo com ${(file.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB: o limite é 10 MB. Divida a planilha em partes.`)
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (ext === 'csv' || ext === 'txt' || file.type === 'text/csv') {
    const { sheet, encoding, delimiter } = readCsvBytes(bytes, file.name)
    return { kind: 'csv', sheets: [sheet], encoding, delimiter }
  }
  if (!['xlsx', 'xls', 'ods', 'xlsm'].includes(ext)) throw new Error(`Formato ".${ext}" não é lido aqui: salve como .xlsx ou .csv e escolha de novo.`)
  try {
    return { kind: 'xlsx', sheets: await readWorkbookBytes(bytes), encoding: null, delimiter: null }
  } catch {
    throw new Error('Não consegui abrir a planilha (arquivo protegido por senha ou corrompido?). Salve de novo como .xlsx ou .csv.')
  }
}
