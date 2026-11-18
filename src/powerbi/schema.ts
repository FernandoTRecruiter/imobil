/* =============================================================================
   schema.ts: o ESQUEMA que a medida DAX manda para o HTML da Visão geral no Power BI.

   Uma lista só (POWERBI_TABLES) decide, coluna por coluna:
   1. o nome da coluna no modelo do Power BI e no CSV de exemplo (em português);
   2. o campo do JSON (o mesmo nome do tipo Lite de metrics.ts);
   3. o formato (texto, código, data, inteiro, dinheiro).
   Dela saem: a medida (scripts/gera-powerbi.mjs), os CSVs de exemplo, o adaptador que
   lê window.DADOS_BRUTOS e o teste de ida e volta. Mudar uma coluna é mudar aqui.

   Três cuidados que vêm do DAX (e que a simulação daqui repete):
   - número sai SEMPRE inteiro (dinheiro em centavos: Valor * 100). FORMAT com casas decimais
     escreveria "8,50" num modelo em português, e a vírgula quebraria o JSON;
   - texto troca aspas por apóstrofo, barra invertida por barra e quebra de linha por espaço,
     e "<" vira a sequência de escape u003c do JavaScript, que volta a ser "<" ao ser lida
     (senão um "</script>" dentro de um nome fecharia o script antes da hora);
   - data sai 'AAAA-MM-DD'; vazia vira "" e a linha que precisa dela é descartada com aviso.
   ============================================================================= */
import { ADJUSTMENT_INDEX, CONTRACT_KIND, CONTRACT_STATUS, ENTRY_CATEGORY, MAINTENANCE_STATUS, UNIT_STATUS } from '@/data/labels'
import type { Cents, IsoDate } from '@/data/types'
import { csvMoney, toCsv } from '@/lib/csv'
import { parseDateBR } from '@/lib/dates'
import { normalize } from '@/lib/text'
import type { ContractLite, EntryLite, LiteData, MaintenanceLite, RoutineLite, TaskLite, UnitLite } from '@/modules/visao-geral/metrics'

/* ---------------------------------------------------------------- 1. As colunas */

export type ColumnType = 'texto' | 'codigo' | 'data' | 'inteiro' | 'dinheiro'

export interface PbColumn {
  /** Nome da coluna no modelo do Power BI (troque na medida pelo nome do SEU modelo). */
  column: string
  /** Campo do JSON = campo do tipo Lite. */
  field: string
  type: ColumnType
  /** Vazio é permitido? Se não, a linha sem o valor é descartada (e vira aviso). */
  required: boolean
  /** Para 'codigo': rótulo em português (ou o próprio código) -> código. */
  codes?: Record<string, string>
  /** Para 'codigo': o que vale quando o texto não é reconhecido. */
  fallback?: string
}

export interface PbTable {
  /** Nome da tabela no modelo (e do CSV de exemplo: Unidades.csv...). */
  table: string
  key: keyof LiteData
  columns: PbColumn[]
}

/** Rótulo e código aceitos, mais apelidos que sistemas de origem costumam usar. */
function codes(labels: Record<string, string>, aliases: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [code, label] of Object.entries(labels)) {
    out[code] = code
    out[label] = code
  }
  return { ...out, ...aliases }
}

const MANUAL_UNIT = Object.fromEntries(Object.entries(UNIT_STATUS).filter(([k]) => k !== 'occupied')) as Record<string, string>

/** Situação da tarefa (os rótulos de processos/repo.ts, repetidos aqui para o HTML do Power BI não carregar o módulo de Processos). */
const TASK_STATUS_LABEL = { todo: 'A fazer', doing: 'Fazendo', done: 'Feito', canceled: 'Cancelada' }

/** As colunas de unidade servem para a tabela Unidades e para a tabela Vagas (o mesmo formato). */
const UNIT_COLUMNS: PbColumn[] = [
  { column: 'IdUnidade', field: 'id', type: 'texto', required: true },
  { column: 'Unidade', field: 'code', type: 'texto', required: true },
  // "Ocupada" não é escolha manual: vem do contrato. Se a origem mandar, conta como disponível e o contrato decide.
  { column: 'SituacaoManual', field: 'manual_status', type: 'codigo', required: false, codes: codes(MANUAL_UNIT, { Ocupada: 'available', Vaga: 'available' }), fallback: 'available' },
  { column: 'IdImovel', field: 'property_id', type: 'texto', required: true },
  { column: 'Imovel', field: 'property_name', type: 'texto', required: true },
]

export const POWERBI_TABLES: PbTable[] = [
  { table: 'Unidades', key: 'units', columns: UNIT_COLUMNS },
  // Vaga de garagem: a mesma forma de Unidades, numa tabela à parte (07/11/2026). Opcional.
  { table: 'Vagas', key: 'spots', columns: UNIT_COLUMNS },
  {
    table: 'Contratos',
    key: 'contracts',
    columns: [
      { column: 'IdContrato', field: 'id', type: 'texto', required: true },
      { column: 'Contrato', field: 'code', type: 'texto', required: true },
      { column: 'TipoContrato', field: 'kind', type: 'codigo', required: true, codes: codes(CONTRACT_KIND), fallback: 'other' },
      { column: 'Situacao', field: 'status', type: 'codigo', required: true, codes: codes(CONTRACT_STATUS, { Ativo: 'active' }), fallback: 'draft' },
      { column: 'IdUnidade', field: 'unit_id', type: 'texto', required: false },
      { column: 'IdImovel', field: 'property_id', type: 'texto', required: true },
      { column: 'Inicio', field: 'start_date', type: 'data', required: true },
      { column: 'Fim', field: 'end_date', type: 'data', required: true },
      { column: 'Indice', field: 'adjustment_index', type: 'codigo', required: false, codes: codes(ADJUSTMENT_INDEX), fallback: 'none' },
      { column: 'MesReajuste', field: 'adjustment_month', type: 'inteiro', required: false },
      // Renovação = contrato com o anterior preenchido; vazio = locação nova.
      { column: 'IdContratoAnterior', field: 'parent_id', type: 'texto', required: false },
    ],
  },
  {
    table: 'Lancamentos',
    key: 'entries',
    columns: [
      { column: 'IdLancamento', field: 'id', type: 'texto', required: true },
      { column: 'Tipo', field: 'direction', type: 'codigo', required: true, codes: codes({ receivable: 'A receber', payable: 'A pagar' }, { Receita: 'receivable', Despesa: 'payable' }) },
      { column: 'Categoria', field: 'category', type: 'codigo', required: false, codes: codes(ENTRY_CATEGORY), fallback: 'other' },
      // "Vencido" não é situação gravada: é "em aberto" com vencimento antes de hoje.
      { column: 'Situacao', field: 'status', type: 'codigo', required: true, codes: codes({ open: 'Em aberto', paid: 'Pago', canceled: 'Cancelado' }, { Aberto: 'open', Vencido: 'open', Recebido: 'paid', Quitado: 'paid' }) },
      { column: 'Vencimento', field: 'due_date', type: 'data', required: true },
      { column: 'Valor', field: 'amount_cents', type: 'dinheiro', required: true },
      { column: 'ValorPago', field: 'paid_cents', type: 'dinheiro', required: false },
      // Dia do último pagamento: pontualidade e a comparação com o período anterior.
      { column: 'UltimoPagamento', field: 'paid_at', type: 'data', required: false },
      { column: 'IdImovel', field: 'property_id', type: 'texto', required: false },
    ],
  },
  {
    table: 'Chamados',
    key: 'maintenance',
    columns: [
      { column: 'IdChamado', field: 'id', type: 'texto', required: true },
      { column: 'Situacao', field: 'status', type: 'codigo', required: true, codes: codes(MAINTENANCE_STATUS) },
      { column: 'IdImovel', field: 'property_id', type: 'texto', required: true },
      { column: 'Prazo', field: 'due_date', type: 'data', required: false },
      { column: 'Orcamento', field: 'quote_cents', type: 'dinheiro', required: false },
      { column: 'Abertura', field: 'opened_on', type: 'data', required: false },
      { column: 'Conclusao', field: 'closed_on', type: 'data', required: false },
    ],
  },
  // Sem coluna de responsável, de propósito: o Power BI mostra só a equipe somada (dado de pessoa
  // em relatório compartilhado vira avaliação de colaborador exposta a quem não deve ver).
  {
    table: 'Tarefas',
    key: 'tasks',
    columns: [
      { column: 'IdTarefa', field: 'id', type: 'texto', required: true },
      { column: 'Situacao', field: 'status', type: 'codigo', required: true, codes: codes(TASK_STATUS_LABEL, { Pendente: 'todo', 'Em andamento': 'doing', Concluida: 'done', Cancelado: 'canceled' }) },
      { column: 'Prazo', field: 'due_date', type: 'data', required: false },
      { column: 'Conclusao', field: 'done_on', type: 'data', required: false },
      { column: 'IdImovel', field: 'property_id', type: 'texto', required: false },
    ],
  },
  {
    table: 'Rotinas',
    key: 'routines',
    columns: [
      { column: 'IdRotina', field: 'id', type: 'texto', required: true },
      { column: 'IdImovel', field: 'property_id', type: 'texto', required: true },
      { column: 'ProximaData', field: 'next_date', type: 'data', required: true },
      { column: 'Situacao', field: 'status', type: 'codigo', required: false, codes: codes({ on: 'Ligada', off: 'Desligada' }, { Ativa: 'on', Inativa: 'off', Sim: 'on', Nao: 'off' }), fallback: 'on' },
    ],
  },
]

/* ---------------------------------------------------------------- 2. Lite -> CSV de exemplo */

/** Rótulo em português de um código (o CSV de exemplo usa o texto que uma pessoa usaria). */
function labelOf(col: PbColumn, code: string): string {
  if (!col.codes) return code
  const label = Object.entries(col.codes).find(([text, c]) => c === code && text !== code)
  return label ? label[0] : code
}

function csvCell(col: PbColumn, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (col.type === 'dinheiro') return csvMoney(value as Cents)
  if (col.type === 'codigo') return labelOf(col, String(value))
  return String(value)
}

export interface CsvFile {
  table: string
  name: string
  text: string
  rows: number
}

/** As tabelas Lite em CSV (separador ";", UTF-8 com BOM, valor "1234,56"): o Excel e o Power BI em português abrem certo. */
export function liteToCsv(d: LiteData): CsvFile[] {
  return POWERBI_TABLES.map((t) => {
    const rows = d[t.key] as unknown as Record<string, unknown>[]
    return {
      table: t.table,
      name: `${t.table}.csv`,
      rows: rows.length,
      text: toCsv(rows, t.columns.map((c) => ({ label: c.column, value: (r) => csvCell(c, r[c.field]) }))),
    }
  })
}

/* ---------------------------------------------------------------- 3. CSV -> JSON (o que a medida DAX faz) */

/**
 * Lê CSV com ";" e aspas (o formato de lib/csv). Passo a passo: tira o BOM; anda caractere por
 * caractere; dentro de aspas, "" é uma aspa e ";" ou quebra de linha não separam nada.
 */
export function parseCsv(text: string): string[][] {
  // O BOM (marca invisível de UTF-8 que o lib/csv põe no começo) sai antes de ler.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ';') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c !== ''))
}

/** O tratamento de texto da medida: aspas -> apóstrofo, barra invertida -> barra, quebra de linha -> espaço. */
export function cleanText(s: string): string {
  return s.replace(/\\/g, '/').replace(/"/g, "'").replace(/[\r\n]/g, ' ')
}

/** Número em português ("1.234,56") ou com ponto ("1234.56"), como o Power BI leria a coluna. */
function readNumber(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}

/** Uma célula do CSV como a medida DAX a escreveria no JSON. */
export function measureValue(col: PbColumn, cell: string): string | number | null {
  if (col.type === 'texto' || col.type === 'codigo') return cleanText(cell)
  if (col.type === 'data') return parseDateBR(cell) ?? ''
  const n = readNumber(cell)
  if (n === null) return null
  return Math.round(col.type === 'dinheiro' ? n * 100 : n)
}

export interface DadosBrutos {
  hoje?: string
  organizacao?: string
  unidades?: unknown
  vagas?: unknown
  contratos?: unknown
  lancamentos?: unknown
  chamados?: unknown
  tarefas?: unknown
  rotinas?: unknown
}

type RawKey = Exclude<keyof DadosBrutos, 'hoje' | 'organizacao'>

/** Nome da lista dentro de window.DADOS_BRUTOS para cada tabela (o gerador da medida usa o mesmo nome). */
export const RAW_KEY: Record<keyof LiteData, RawKey> = {
  units: 'unidades', spots: 'vagas', contracts: 'contratos', entries: 'lancamentos', maintenance: 'chamados', tasks: 'tarefas', routines: 'rotinas',
}

/** Simula a medida inteira a partir dos CSVs: é o "Power BI de mentira" do teste e do teste_csv.html. */
export function csvToDadosBrutos(files: Pick<CsvFile, 'table' | 'text'>[], meta: { hoje: IsoDate; organizacao: string }): DadosBrutos {
  const out: DadosBrutos = { hoje: meta.hoje, organizacao: meta.organizacao }
  for (const t of POWERBI_TABLES) {
    const file = files.find((f) => f.table === t.table)
    const [head = [], ...body] = file ? parseCsv(file.text) : []
    const index = t.columns.map((c) => head.indexOf(c.column))
    out[RAW_KEY[t.key]] = body.map((cells) => Object.fromEntries(t.columns.map((c, i) => [c.field, measureValue(c, index[i] >= 0 ? (cells[index[i]] ?? '') : '')])))
  }
  return out
}

/* ---------------------------------------------------------------- 4. window.DADOS_BRUTOS -> linhas Lite */

/** "Em manutenção", "em manutencao", "maintenance": todos viram a mesma chave de busca. */
const keyOf = (s: string) => normalize(s).replace(/[^a-z0-9]/g, '')

export interface Adapted {
  data: LiteData
  hoje: IsoDate | null
  organizacao: string | null
  /** O que veio fora do esperado (a tela mostra, para quem montou o modelo conferir). */
  warnings: string[]
}

/**
 * Lê o que a medida mandou e devolve as linhas Lite. Nunca confia no formato:
 * lista que não é lista vira vazia; código desconhecido vira o padrão da coluna (com aviso);
 * linha sem data ou valor obrigatório é descartada (com aviso). Melhor um número a menos,
 * avisado, do que um vencimento vazio contado como "vencido" (texto vazio é menor que qualquer data).
 */
export function fromDadosBrutos(raw: unknown): Adapted {
  const src = (raw && typeof raw === 'object' ? raw : {}) as DadosBrutos
  const warnings: string[] = []
  const data: LiteData = { units: [], spots: [], contracts: [], entries: [], maintenance: [], tasks: [], routines: [] }

  for (const t of POWERBI_TABLES) {
    const list = src[RAW_KEY[t.key]]
    const rows = Array.isArray(list) ? list : []
    if (list !== undefined && !Array.isArray(list)) warnings.push(`${t.table}: não veio uma lista.`)
    const lookup = new Map(t.columns.map((c) => [c, c.codes ? new Map(Object.entries(c.codes).map(([text, code]) => [keyOf(text), code])) : null]))
    let dropped = 0
    const unknown = new Map<string, number>()
    const out: Record<string, unknown>[] = []

    for (const r of rows) {
      const row = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
      const item: Record<string, unknown> = {}
      let ok = true
      for (const c of t.columns) {
        const v = row[c.field]
        if (c.type === 'texto') {
          const s = v === null || v === undefined ? '' : String(v).trim()
          if (!s && c.required) ok = false
          item[c.field] = s || (c.required ? '' : null)
        } else if (c.type === 'codigo') {
          const s = v === null || v === undefined ? '' : String(v)
          const code = lookup.get(c)!.get(keyOf(s))
          if (!code && c.required && !c.fallback) ok = false
          if (!code && s) unknown.set(c.column, (unknown.get(c.column) ?? 0) + 1)
          item[c.field] = code ?? c.fallback ?? ''
        } else if (c.type === 'data') {
          const d = typeof v === 'string' ? parseDateBR(v) : null
          if (!d && c.required) ok = false
          item[c.field] = d
        } else {
          const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null
          if (n === null && c.required) ok = false
          // Valor pago e mês de reajuste vazios valem 0; orçamento vazio continua vazio.
          item[c.field] = n ?? (c.field === 'quote_cents' ? null : 0)
        }
      }
      if (ok) out.push(item)
      else dropped++
    }
    if (dropped) warnings.push(`${t.table}: ${dropped} linha(s) sem campo obrigatório ficaram de fora.`)
    for (const [col, n] of unknown) warnings.push(`${t.table}[${col}]: ${n} valor(es) não reconhecido(s), contado(s) pelo padrão da coluna.`)
    ;(data[t.key] as unknown as Record<string, unknown>[]) = out
  }

  // Campos que o Power BI não manda: os de filtro (lá quem filtra é a segmentação do relatório) e os
  // de pessoa (responsável do imóvel, do chamado e da tarefa), que ficam só no app.
  const noFilter = { portfolio_id: null, portfolio_name: null, manager_id: null, manager_name: null }
  data.units = data.units.map((u) => ({ ...u, ...noFilter })) as UnitLite[]
  data.spots = data.spots.map((u) => ({ ...u, ...noFilter })) as UnitLite[]
  data.contracts = data.contracts as ContractLite[]
  data.entries = data.entries as EntryLite[]
  data.maintenance = data.maintenance.map((r) => ({ ...r, assignee_id: null })) as MaintenanceLite[]
  data.tasks = data.tasks.map((t) => ({ ...t, assignee_id: null })) as TaskLite[]
  data.routines = data.routines as RoutineLite[]

  const hoje = typeof src.hoje === 'string' ? parseDateBR(src.hoje) : null
  const organizacao = typeof src.organizacao === 'string' && src.organizacao.trim() ? src.organizacao.trim() : null
  return { data, hoje, organizacao, warnings }
}
