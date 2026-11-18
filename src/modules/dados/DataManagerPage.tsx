/* =============================================================================
   Data Manager (Dados): unidades, imóveis e pessoas numa tabela tipo planilha.

   O que a tela faz: editar na própria célula só os campos liberados (cada gravação passa
   pela porta da entidade no repo.ts, com zod e regra), escolher colunas (lembradas),
   selecionar em lote (mudar situação ou carteira, arquivar, restaurar) com confirmação que
   diz quantos mudam, buscar, filtrar com contagem, paginar, exportar CSV e XLSX e ver o
   histórico (auditoria) da linha escolhida.

   Anatomia da casa: PageHeader -> abas -> ListToolbar -> (barra de lote) -> grade -> Pagination.
   ============================================================================= */
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, ArrowUpRight, History, Upload, X } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { hasFeature } from '@/auth/permissions'
import type { Session } from '@/auth/session'
import { useRepo, useRepoMutation } from '@/data/hooks'
import { PERSON_TAG, PROPERTY_KIND, UNIT_KIND, UNIT_STATUS } from '@/data/labels'
import type { ListParams, ListResult } from '@/data/query'
import type { ManualUnitStatus, UnitStatus } from '@/data/types'
import { csvMoney, downloadText, toCsv } from '@/lib/csv'
import { formatDateTime } from '@/lib/dates'
import { formatDocument, formatPhone } from '@/lib/documents'
import { formatBRL, parseBRL } from '@/lib/money'
import { readJSON, writeJSON } from '@/lib/storage'
import { plural } from '@/lib/text'
import type { ExportFormat } from '@/lib/exportar'
import { useListState } from '@/lib/useListState'
import { Badge, UnitStatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { PageHeader, Section, Timeline } from '@/components/ui/Layout'
import type { ColumnChooserState } from '@/components/ui/columns'
import { ListToolbar, type FilterDef } from '@/components/ui/ListToolbar'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { Grade, type GridColumn, type Parsed, type SaveArgs } from './Grade'
import { ENTITY_KEY } from './memoria'
import { downloadXlsx } from './planilha'
import {
  BULK_ACTIONS, DM_ENTITY_NOUN, dmOptions, listDmPeople, listDmProperties, listDmUnits, listHistory, MANUAL_STATUSES, PERSON_TAGS, previewBulk, runBulk, saveCell,
  type BulkAction, type DmEntity, type DmOptions, type DmPerson, type DmProperty, type DmUnit,
} from './repo'

const ENTITY_TABS: { value: DmEntity; label: string }[] = [
  { value: 'units', label: 'Unidades' },
  { value: 'properties', label: 'Imóveis' },
  { value: 'people', label: 'Pessoas' },
]

/** Link com cara de botão principal (o Button do app é <button>; navegação pede <a>). */
export const LINK_BUTTON = 'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium whitespace-nowrap text-on-primary shadow-card hover:bg-primary-hover'

export function DataManagerPage() {
  return (
    <Guard action="data:import" what="o Data Manager">
      <DataManager />
    </Guard>
  )
}

function DataManager() {
  const s = useSession()
  const [entity, setEntityState] = useState<DmEntity>(() => {
    const saved = readJSON<DmEntity>(ENTITY_KEY)
    return saved && ENTITY_TABS.some((t) => t.value === saved) ? saved : 'units'
  })
  const setEntity = (e: DmEntity) => {
    setEntityState(e)
    writeJSON(ENTITY_KEY, e)
  }
  const options = useRepo('dm:opcoes', dmOptions)
  const ctx: Ctx = { agency: hasFeature(s, 'portfolios'), options: options.data ?? { portfolios: [], team: [], properties: [] } }
  return (
    <>
      <PageHeader
        eyebrow="Dados"
        title="Data Manager"
        description="Corrija muitos cadastros como numa planilha. Cada célula passa pelas mesmas regras da tela do cadastro; o que não pode mudar aqui não abre para edição."
        actions={
          <Link to="/dados/importar" className={LINK_BUTTON}>
            <Upload className="size-4" aria-hidden="true" /> Importar planilha
          </Link>
        }
      />
      <Tabs value={entity} onValueChange={(v) => setEntity(v as DmEntity)} tabs={ENTITY_TABS}>
        {ENTITY_TABS.map((t) => (
          <TabPanel key={t.value} value={t.value} className="mt-4 flex flex-col gap-3 focus-visible:outline-none">
            {entity === 'units' && t.value === 'units' && <EntitySheet cfg={unitConfig(ctx)} />}
            {entity === 'properties' && t.value === 'properties' && <EntitySheet cfg={propertyConfig(ctx)} />}
            {entity === 'people' && t.value === 'people' && <EntitySheet cfg={personConfig()} />}
          </TabPanel>
        ))}
      </Tabs>
    </>
  )
}

/* ---------------------------------------------------------------- configuração por entidade */

interface Ctx {
  agency: boolean
  options: DmOptions
}

interface SheetConfig<T> {
  entity: DmEntity
  list: (s: Session, params: ListParams) => Promise<ListResult<T>>
  columns: GridColumn<T>[]
  filters: (facets: Record<string, Record<string, number>> | undefined) => FilterDef[]
  rowLabel: (r: T) => string
  href: (r: T) => string
  searchPlaceholder: string
}

const muted = (t: string) => <span className="text-muted">{t}</span>
const EMPTY = muted('vazio')

/** Número com vírgula ou ponto ("64,5" ou "64.5"); com vírgula, o ponto é milhar ("1.234,5"). */
function parseNumberBR(text: string): number | null {
  const t = text.trim().replace(/\s|m²|m2/gi, '')
  if (!t) return null
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : NaN
}

const parseArea = (t: string): Parsed => {
  const n = parseNumberBR(t)
  if (n === null) return { error: 'Informe a área em m² (ex.: 64,5).' }
  if (Number.isNaN(n)) return { error: 'Área precisa ser número (ex.: 64,5).' }
  return { value: n }
}
const parseInt0 = (label: string) => (t: string): Parsed => {
  const v = t.trim()
  if (!v) return { error: `Informe ${label.toLowerCase()} (0 se não tiver).` }
  if (!/^-?\d+$/.test(v)) return { error: `${label} precisa ser número inteiro.` }
  return { value: Number(v) }
}
const parseMoney = (t: string): Parsed => {
  if (!t.trim()) return { value: null }
  const c = parseBRL(t)
  return c === null ? { error: 'Valor em reais: use 1.900,00 (ou deixe vazio).' } : { value: c }
}
const parseText = (t: string): Parsed => ({ value: t.trim() })
const ORIGIN_LABEL: Record<string, string> = { importada: 'Planilha', tela: 'Tela' }
const originCell = (o: string) => <Badge tone={o === 'importada' ? 'primary' : 'neutral'}>{ORIGIN_LABEL[o]}</Badge>
const archivedBlock = (r: { deleted_at: string | null }) => (r.deleted_at ? 'Arquivado: restaure para editar.' : null)
const ARCHIVED_FILTER: FilterDef = { key: 'archived', label: 'Arquivados', options: [{ value: 'nao', label: 'Ativos' }, { value: 'sim', label: 'Arquivados' }] }
const ORIGIN_FILTER: FilterDef = { key: 'origin', label: 'Origem', options: [{ value: 'importada', label: 'Planilha' }, { value: 'tela', label: 'Tela' }] }

function unitConfig(ctx: Ctx): SheetConfig<DmUnit> {
  const int = (key: 'bedrooms' | 'bathrooms' | 'parking_spots', header: string, sortKey: string): GridColumn<DmUnit> => ({
    key, header, sortKey, firstDir: 'desc', align: 'right', minWidth: 'min-w-24',
    cell: (r) => r[key], exportValue: (r) => r[key],
    edit: { kind: 'input', field: key, inputMode: 'numeric', initial: (r) => String(r[key]), parse: parseInt0(header), blocked: archivedBlock },
  })
  const columns: GridColumn<DmUnit>[] = [
    { key: 'code', header: 'Código', sortKey: 'code', locked: true, minWidth: 'min-w-24', cell: (r) => <span className="font-medium">{r.code}</span>, exportValue: (r) => r.code },
    { key: 'property', header: 'Imóvel', sortKey: 'property', cell: (r) => <span className="block max-w-56 truncate" title={r.property_name}>{r.property_name}</span>, exportValue: (r) => r.property_name },
    { key: 'status', header: 'Situação', sortKey: 'status', cell: (r) => <UnitStatusBadge status={r.status} />, exportValue: (r) => UNIT_STATUS[r.status] },
    {
      key: 'manual', header: 'Situação manual', sortKey: 'manual', minWidth: 'min-w-36',
      cell: (r) => UNIT_STATUS[r.manual_status], exportValue: (r) => UNIT_STATUS[r.manual_status],
      edit: {
        kind: 'select', field: 'manual_status', initial: (r) => r.manual_status, blocked: archivedBlock,
        options: MANUAL_STATUSES.map((v) => ({ value: v, label: UNIT_STATUS[v] })), parse: (v) => ({ value: v as ManualUnitStatus }),
      },
    },
    { key: 'kind', header: 'Tipo', sortKey: 'kind', cell: (r) => UNIT_KIND[r.kind], exportValue: (r) => UNIT_KIND[r.kind] },
    {
      key: 'area', header: 'Área (m²)', sortKey: 'area', firstDir: 'desc', align: 'right', minWidth: 'min-w-24',
      cell: (r) => r.area_m2.toLocaleString('pt-BR'), exportValue: (r) => r.area_m2,
      edit: { kind: 'input', field: 'area_m2', inputMode: 'decimal', initial: (r) => String(r.area_m2).replace('.', ','), parse: parseArea, blocked: archivedBlock },
    },
    int('bedrooms', 'Quartos', 'bedrooms'),
    int('bathrooms', 'Banheiros', 'bathrooms'),
    int('parking_spots', 'Vagas', 'parking'),
    {
      key: 'rent', header: 'Aluguel pedido', sortKey: 'rent', firstDir: 'desc', align: 'right', minWidth: 'min-w-32',
      cell: (r) => (r.asking_rent_cents === null ? EMPTY : formatBRL(r.asking_rent_cents)), exportValue: (r) => (r.asking_rent_cents === null ? null : r.asking_rent_cents / 100),
      edit: { kind: 'input', field: 'asking_rent_cents', inputMode: 'decimal', initial: (r) => (r.asking_rent_cents === null ? '' : csvMoney(r.asking_rent_cents)), parse: parseMoney, blocked: archivedBlock },
    },
    { key: 'lessee', header: 'Inquilino', sortKey: 'lessee', cell: (r) => r.lease?.lessee_name ?? '', exportValue: (r) => r.lease?.lessee_name ?? '' },
    ...(ctx.agency ? [{ key: 'portfolio', header: 'Carteira', sortKey: 'portfolio', hidden: true, cell: (r: DmUnit) => r.portfolio_name ?? '', exportValue: (r: DmUnit) => r.portfolio_name ?? '' }] : []),
    {
      key: 'notes', header: 'Observações', sortKey: 'notes', hidden: true, minWidth: 'min-w-48',
      cell: (r) => (r.notes ? <span title={r.notes}>{r.notes}</span> : EMPTY), exportValue: (r) => r.notes,
      edit: { kind: 'input', field: 'notes', initial: (r) => r.notes, parse: parseText, blocked: archivedBlock },
    },
    { key: 'origin', header: 'Origem', hidden: true, cell: (r) => originCell(r.origin), exportValue: (r) => ORIGIN_LABEL[r.origin] },
  ]
  return {
    entity: 'units', list: listDmUnits, columns, rowLabel: (r) => `${r.code} (${r.property_name})`, href: (r) => `/unidades/${r.id}`,
    searchPlaceholder: 'Buscar por código, imóvel, bairro ou inquilino',
    filters: () => [
      { key: 'status', label: 'Situação', options: (Object.keys(UNIT_STATUS) as UnitStatus[]).map((v) => ({ value: v, label: UNIT_STATUS[v] })) },
      { key: 'kind', label: 'Tipo', options: Object.entries(UNIT_KIND).map(([value, label]) => ({ value, label })) },
      { key: 'property', label: 'Imóvel', options: ctx.options.properties.map((p) => ({ value: p.id, label: p.name })) },
      ...(ctx.agency ? [{ key: 'portfolio', label: 'Carteira', options: ctx.options.portfolios.map((p) => ({ value: p.id, label: p.name })) }] : []),
      ARCHIVED_FILTER,
      ORIGIN_FILTER,
    ],
  }
}

function propertyConfig(ctx: Ctx): SheetConfig<DmProperty> {
  const portfolioName = new Map(ctx.options.portfolios.map((p) => [p.id, p.name]))
  const managerName = new Map(ctx.options.team.map((m) => [m.userId, m.name]))
  const columns: GridColumn<DmProperty>[] = [
    {
      key: 'name', header: 'Nome', sortKey: 'name', locked: true, minWidth: 'min-w-56',
      cell: (r) => <span className="font-medium">{r.name}</span>, exportValue: (r) => r.name,
      edit: { kind: 'input', field: 'name', initial: (r) => r.name, parse: parseText, blocked: archivedBlock },
    },
    { key: 'kind', header: 'Tipo', sortKey: 'kind', cell: (r) => PROPERTY_KIND[r.kind], exportValue: (r) => PROPERTY_KIND[r.kind] },
    { key: 'address', header: 'Endereço', cell: (r) => <span className="block max-w-56 truncate">{`${r.address.street}, ${r.address.number}`}</span>, exportValue: (r) => `${r.address.street}, ${r.address.number}` },
    { key: 'district', header: 'Bairro', sortKey: 'district', cell: (r) => r.address.district, exportValue: (r) => r.address.district },
    ...(ctx.agency
      ? ([
          {
            key: 'portfolio', header: 'Carteira', sortKey: 'portfolio', minWidth: 'min-w-36',
            cell: (r) => (r.portfolio_id ? (portfolioName.get(r.portfolio_id) ?? r.portfolio_name ?? '') : EMPTY), exportValue: (r) => r.portfolio_name ?? '',
            edit: {
              kind: 'select', field: 'portfolio_id', initial: (r) => r.portfolio_id ?? '', blocked: archivedBlock,
              options: [{ value: '', label: 'Sem carteira' }, ...ctx.options.portfolios.map((p) => ({ value: p.id, label: p.name }))], parse: (v) => ({ value: v || null }),
            },
          },
          {
            key: 'manager', header: 'Responsável', sortKey: 'manager', minWidth: 'min-w-40',
            cell: (r) => (r.manager_user_id ? (managerName.get(r.manager_user_id) ?? r.manager_name ?? '') : EMPTY), exportValue: (r) => r.manager_name ?? '',
            edit: {
              kind: 'select', field: 'manager_user_id', initial: (r) => r.manager_user_id ?? '', blocked: archivedBlock,
              options: [{ value: '', label: 'Sem responsável' }, ...ctx.options.team.map((m) => ({ value: m.userId, label: m.name }))], parse: (v) => ({ value: v || null }),
            },
          },
        ] satisfies GridColumn<DmProperty>[])
      : []),
    { key: 'units', header: 'Unidades', sortKey: 'units', firstDir: 'desc', align: 'right', cell: (r) => r.units_total, exportValue: (r) => r.units_total },
    { key: 'occupancy', header: 'Ocupação', sortKey: 'occupancy', firstDir: 'desc', align: 'right', cell: (r) => `${r.occupancy_pct.toLocaleString('pt-BR')}%`, exportValue: (r) => r.occupancy_pct },
    {
      key: 'notes', header: 'Observações', sortKey: 'notes', hidden: true, minWidth: 'min-w-48',
      cell: (r) => (r.notes ? <span title={r.notes}>{r.notes}</span> : EMPTY), exportValue: (r) => r.notes,
      edit: { kind: 'input', field: 'notes', initial: (r) => r.notes, parse: parseText, blocked: archivedBlock },
    },
    { key: 'origin', header: 'Origem', hidden: true, cell: (r) => originCell(r.origin), exportValue: (r) => ORIGIN_LABEL[r.origin] },
  ]
  return {
    entity: 'properties', list: listDmProperties, columns, rowLabel: (r) => r.name, href: (r) => `/imoveis/${r.id}`,
    searchPlaceholder: 'Buscar por nome, rua, bairro ou proprietário',
    filters: (facets) => [
      { key: 'kind', label: 'Tipo', options: Object.entries(PROPERTY_KIND).map(([value, label]) => ({ value, label })) },
      ...(ctx.agency
        ? [
            { key: 'portfolio', label: 'Carteira', options: ctx.options.portfolios.map((p) => ({ value: p.id, label: p.name })) },
            { key: 'manager', label: 'Responsável', options: ctx.options.team.map((m) => ({ value: m.userId, label: m.name })) },
          ]
        : []),
      { key: 'district', label: 'Bairro', options: Object.keys(facets?.district ?? {}).sort((a, b) => a.localeCompare(b, 'pt-BR')).map((d) => ({ value: d, label: d })) },
      ARCHIVED_FILTER,
      ORIGIN_FILTER,
    ],
  }
}

const LINK_ROLE: Record<string, string> = { owner: 'Proprietário', lessee: 'Inquilino', guarantor: 'Fiador' }

function personConfig(): SheetConfig<DmPerson> {
  const tagOptions = PERSON_TAGS.map((t) => ({ value: t, label: PERSON_TAG[t] }))
  const columns: GridColumn<DmPerson>[] = [
    {
      key: 'name', header: 'Nome', sortKey: 'name', locked: true, minWidth: 'min-w-56',
      cell: (r) => <span className="font-medium">{r.name}</span>, exportValue: (r) => r.name,
      edit: { kind: 'input', field: 'name', initial: (r) => r.name, parse: parseText, blocked: archivedBlock },
    },
    { key: 'kind', header: 'Tipo', sortKey: 'kind', cell: (r) => r.kind, exportValue: (r) => r.kind },
    { key: 'document', header: 'CPF/CNPJ', cell: (r) => <span className="num whitespace-nowrap">{formatDocument(r.document)}</span>, exportValue: (r) => formatDocument(r.document) },
    {
      key: 'email', header: 'E-mail', sortKey: 'email', minWidth: 'min-w-56',
      cell: (r) => r.email || EMPTY, exportValue: (r) => r.email,
      edit: { kind: 'input', field: 'email', inputMode: 'email', initial: (r) => r.email, parse: parseText, blocked: archivedBlock },
    },
    {
      key: 'phone', header: 'Telefone', sortKey: 'phone', minWidth: 'min-w-36',
      cell: (r) => (r.phone ? <span className="num whitespace-nowrap">{formatPhone(r.phone)}</span> : EMPTY), exportValue: (r) => formatPhone(r.phone),
      edit: { kind: 'input', field: 'phone', inputMode: 'tel', initial: (r) => formatPhone(r.phone), parse: parseText, blocked: archivedBlock },
    },
    {
      key: 'tags', header: 'Papéis declarados', minWidth: 'min-w-40',
      cell: (r) => (r.tags.length ? r.tags.map((t) => PERSON_TAG[t]).join(', ') : EMPTY), exportValue: (r) => r.tags.map((t) => PERSON_TAG[t]).join(', '),
      edit: { kind: 'tags', field: 'tags', initial: (r) => r.tags, options: tagOptions, blocked: archivedBlock },
    },
    {
      key: 'links', header: 'Ligações', cell: (r) => r.roles.filter((x) => x in LINK_ROLE).map((x) => LINK_ROLE[x]).join(', '),
      exportValue: (r) => r.roles.filter((x) => x in LINK_ROLE).map((x) => LINK_ROLE[x]).join(', '),
    },
    { key: 'units_owned', header: 'Unidades', sortKey: 'units_owned', firstDir: 'desc', align: 'right', hidden: true, cell: (r) => r.units_owned, exportValue: (r) => r.units_owned },
    { key: 'active_leases', header: 'Locações vigentes', sortKey: 'active_leases', firstDir: 'desc', align: 'right', hidden: true, cell: (r) => r.active_leases, exportValue: (r) => r.active_leases },
    { key: 'origin', header: 'Origem', hidden: true, cell: (r) => originCell(r.origin), exportValue: (r) => ORIGIN_LABEL[r.origin] },
  ]
  return {
    entity: 'people', list: listDmPeople, columns, rowLabel: (r) => r.name, href: (r) => `/pessoas/${r.id}`,
    searchPlaceholder: 'Buscar por nome, documento, e-mail ou telefone',
    filters: () => [
      { key: 'kind', label: 'Tipo', options: [{ value: 'PF', label: 'Pessoa física' }, { value: 'PJ', label: 'Pessoa jurídica' }] },
      { key: 'tag', label: 'Papel declarado', options: tagOptions },
      { key: 'role', label: 'Ligação', options: Object.entries(LINK_ROLE).map(([value, label]) => ({ value, label })) },
      ARCHIVED_FILTER,
      ORIGIN_FILTER,
    ],
  }
}

/* ---------------------------------------------------------------- a planilha de uma entidade */

/**
 * Grava uma célula e já mostra o valor novo: troca o campo na lista guardada no cache (sem esperar
 * a releitura) e depois pede a releitura de tudo (contagens e colunas calculadas). O erro sobe para
 * a célula, que mostra a mensagem do repositório; por isso aqui não se usa o useRepoMutation, que
 * mostraria o erro também num aviso flutuante.
 */
function useCellSaver(entity: DmEntity) {
  const s = useSession()
  const qc = useQueryClient()
  return async ({ id, field, value }: SaveArgs) => {
    const saved = (await saveCell(s, { entity, id, field, value })) as unknown as Record<string, unknown>
    qc.setQueriesData<ListResult<{ id: string }>>({ queryKey: [`dm:${entity}`] }, (old) => old && { ...old, rows: old.rows.map((r) => (r.id === id ? { ...r, [field]: saved[field] } : r)) })
    void qc.invalidateQueries()
  }
}

/** Seleção que vale para a busca e os filtros atuais: mudou o recorte, a seleção zera (não arquiva o que não está à vista). */
interface Selection {
  key: string
  ids: Set<string>
}

function EntitySheet<T extends { id: string; deleted_at: string | null }>({ cfg }: { cfg: SheetConfig<T> }) {
  const s = useSession()
  const { entity } = cfg
  const noun = DM_ENTITY_NOUN[entity]
  const list = useListState(`dados:${entity}`)
  const q = useRepo(`dm:${entity}`, (sess) => cfg.list(sess, list.params), [list.params])
  const save = useCellSaver(entity)
  const colKey = `imobil:dados:colunas:${entity}`
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => readJSON<string[]>(colKey) ?? cfg.columns.filter((c) => !c.hidden).map((c) => c.key))
  const columns = cfg.columns.filter((c) => c.locked || visibleKeys.includes(c.key))
  const selKey = JSON.stringify([list.params.search, list.params.filters])
  const [sel, setSel] = useState<Selection>({ key: selKey, ids: new Set() })
  const selected = sel.key === selKey ? sel.ids : new Set<string>()
  const [active, setActive] = useState<T | null>(null)
  const [bulk, setBulk] = useState<BulkAction | null>(null)

  const setSelected = (ids: Set<string>) => setSel({ key: selKey, ids })
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const togglePage = (ids: string[], on: boolean) => {
    const next = new Set(selected)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    setSelected(next)
  }
  const selectAllFiltered = async () => {
    const all = await cfg.list(s, { ...list.params, page: 1, pageSize: 100_000 })
    setSelected(new Set(all.rows.map((r) => r.id)))
  }
  const toggleColumn = (key: string) => {
    const next = visibleKeys.includes(key) ? visibleKeys.filter((k) => k !== key) : [...visibleKeys, key]
    setVisibleKeys(next)
    writeJSON(colKey, next)
  }
  const resetColumns = () => {
    const next = cfg.columns.filter((c) => !c.hidden).map((c) => c.key)
    setVisibleKeys(next)
    writeJSON(colKey, next)
  }

  /** Exporta o recorte inteiro (todas as páginas) com as colunas à vista. */
  const exportRows = async () => (await cfg.list(s, { ...list.params, page: 1, pageSize: 100_000 })).rows
  // Um "Exportar" só (07/11/2026): a barra mostra o menu; aqui cada formato monta o seu arquivo.
  const exportList = (format: ExportFormat) => (format === 'xlsx' ? exportXlsx() : exportCsv())
  /** O menu "Colunas" da barra, com a escolha desta grade (guardada em imobil:dados:colunas:<entidade>). */
  const defaultKeys = cfg.columns.filter((c) => !c.hidden).map((c) => c.key)
  const chooser: ColumnChooserState = {
    items: cfg.columns.map((c) => ({ key: c.key, label: c.header, visible: !!c.locked || visibleKeys.includes(c.key), locked: !!c.locked })),
    toggle: toggleColumn,
    reset: resetColumns,
    changed: visibleKeys.length !== defaultKeys.length || visibleKeys.some((k) => !defaultKeys.includes(k)),
  }
  const exportCsv = async () => {
    const rows = await exportRows()
    downloadText(
      `${noun[1]}.csv`,
      toCsv(rows, columns.map((c) => ({ label: c.header, value: (r: T) => {
        const v = c.exportValue(r)
        return typeof v === 'number' ? v.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 2 }) : v
      } }))),
    )
  }
  const exportXlsx = async () => {
    const rows = await exportRows()
    await downloadXlsx(`${noun[1]}.xlsx`, [{ name: noun[1], rows: [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => c.exportValue(r)))] }])
  }

  const facets = q.data?.facets
  const total = q.data?.total ?? 0
  return (
    <>
      <ListToolbar
        state={list}
        noun={noun}
        total={q.data?.total}
        totalAll={q.data?.totalAll}
        facets={facets}
        onExport={exportList}
        columns={chooser}
        searchPlaceholder={cfg.searchPlaceholder}
        filters={cfg.filters(facets)}
      />

      {selected.size > 0 && (
        <BulkBar
          entity={entity}
          count={selected.size}
          total={total}
          agency={hasFeature(s, 'portfolios')}
          onAction={setBulk}
          onSelectAll={() => void selectAllFiltered()}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div className={active ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]' : 'grid'}>
        <div className="flex min-w-0 flex-col gap-3">
          <Grade
            caption={`Data Manager: ${noun[1]}`}
            columns={columns}
            rows={q.data?.rows}
            loading={q.isPending || q.isPlaceholderData}
            error={q.error}
            onRetry={() => q.refetch()}
            sort={list.sort}
            onSort={list.toggleSort}
            selected={selected}
            onToggle={toggle}
            onTogglePage={togglePage}
            activeId={active?.id ?? null}
            onActivate={setActive}
            rowLabel={cfg.rowLabel}
            onSave={save}
            empty={<EmptyState title={`Nenhum${entity === 'properties' ? '' : 'a'} ${noun[0]} encontrad${entity === 'properties' ? 'o' : 'a'}`} description={list.activeFilterCount ? 'Nada passa nos filtros ligados. Limpe os filtros para ver tudo.' : 'Cadastre pela tela ou importe uma planilha.'} />}
            actions={(r) => (
              <span className="inline-flex items-center gap-1">
                <button className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text" aria-label={`Histórico de ${cfg.rowLabel(r)}`} onClick={() => setActive(r)}>
                  <History className="size-4" aria-hidden="true" />
                </button>
                <Link to={cfg.href(r)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text" aria-label={`Abrir ${cfg.rowLabel(r)}`}>
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </Link>
              </span>
            )}
          />
          {q.data && <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={list.setPage} onPageSize={list.setPageSize} />}
        </div>
        {active && <HistoryPanel entity={entity} id={active.id} label={cfg.rowLabel(active)} onClose={() => setActive(null)} />}
      </div>

      {bulk && (
        <BulkConfirm
          entity={entity}
          ids={[...selected]}
          action={bulk}
          onClose={() => setBulk(null)}
          onDone={() => {
            setBulk(null)
            setSelected(new Set())
          }}
        />
      )}
    </>
  )
}

/* ---------------------------------------------------------------- ações em lote */

const STATUS_NONE = ''
const PORTFOLIO_NONE = '__sem__'

function BulkBar({ entity, count, total, agency, onAction, onSelectAll, onClear }: { entity: DmEntity; count: number; total: number; agency: boolean; onAction: (a: BulkAction) => void; onSelectAll: () => void; onClear: () => void }) {
  const opts = useRepo('dm:opcoes', dmOptions)
  const kinds = BULK_ACTIONS[entity]
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft px-3 py-2 text-sm" role="region" aria-label="Ações em lote">
      <strong className="num mr-1 text-[var(--st-occupied-fg)]">{plural(count, 'selecionado', 'selecionados')}</strong>
      {kinds.includes('status') && (
        <select
          aria-label="Mudar a situação manual dos selecionados"
          className="h-8 rounded-lg border border-border bg-surface px-2 text-[13px]"
          value={STATUS_NONE}
          onChange={(e) => e.target.value && onAction({ kind: 'status', status: e.target.value })}
        >
          <option value={STATUS_NONE}>Mudar situação para…</option>
          {MANUAL_STATUSES.map((v) => (
            <option key={v} value={v}>
              {UNIT_STATUS[v]}
            </option>
          ))}
        </select>
      )}
      {kinds.includes('portfolio') && agency && (
        <select
          aria-label="Mudar a carteira dos selecionados"
          className="h-8 rounded-lg border border-border bg-surface px-2 text-[13px]"
          value=""
          onChange={(e) => e.target.value && onAction({ kind: 'portfolio', portfolioId: e.target.value === PORTFOLIO_NONE ? null : e.target.value })}
        >
          <option value="">Mudar carteira para…</option>
          {opts.data?.portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={PORTFOLIO_NONE}>Sem carteira</option>
        </select>
      )}
      <Button size="sm" icon={<Archive className="size-4" aria-hidden="true" />} onClick={() => onAction({ kind: 'archive' })}>
        Arquivar
      </Button>
      <Button size="sm" icon={<ArchiveRestore className="size-4" aria-hidden="true" />} onClick={() => onAction({ kind: 'restore' })}>
        Restaurar
      </Button>
      <span className="ml-auto flex flex-wrap items-center gap-3">
        {total > count && (
          <button className="text-xs font-medium text-primary hover:underline" onClick={onSelectAll}>
            Selecionar todos os {total.toLocaleString('pt-BR')} filtrados
          </button>
        )}
        <button className="text-xs font-medium text-primary hover:underline" onClick={onClear}>
          Limpar seleção
        </button>
      </span>
    </div>
  )
}

/** Verbo do botão e raiz do particípio ("arquivad" + a/as/o/os, concordando com unidade, imóvel ou pessoa). */
const BULK_VERB: Record<BulkAction['kind'], [string, string]> = {
  archive: ['Arquivar', 'arquivad'], restore: ['Restaurar', 'restaurad'], status: ['Mudar situação de', 'atualizad'], portfolio: ['Mudar carteira de', 'atualizad'],
}

/** Confirmação que diz QUANTOS mudam (e quais ficam de fora, com o motivo) antes de gravar. */
function BulkConfirm({ entity, ids, action, onClose, onDone }: { entity: DmEntity; ids: string[]; action: BulkAction; onClose: () => void; onDone: () => void }) {
  const noun = DM_ENTITY_NOUN[entity]
  const fem = entity !== 'properties' // unidade e pessoa são femininos; imóvel, masculino
  const participle = (n: number) => `${BULK_VERB[action.kind][1]}${fem ? 'a' : 'o'}${n === 1 ? '' : 's'}`
  const opts = useRepo('dm:opcoes', dmOptions)
  const preview = useRepo('dm:previa-lote', (s) => previewBulk(s, { entity, ids, action }), [entity, ids, action])
  const run = useRepoMutation(runBulk, {
    success: (p) => `${plural(p.change.length, noun[0], noun[1])} ${participle(p.change.length)}.${p.skip.length ? ` ${p.skip.length} ficaram de fora.` : ''}`,
    onSuccess: onDone,
  })
  const n = preview.data?.change.length
  const target =
    action.kind === 'status'
      ? ` para ${UNIT_STATUS[action.status as ManualUnitStatus]}`
      : action.kind === 'portfolio'
        ? ` para ${action.portfolioId ? (opts.data?.portfolios.find((p) => p.id === action.portfolioId)?.name ?? 'a carteira escolhida') : 'sem carteira'}`
        : ''
  let message: ReactNode
  if (preview.isPending) message = <Skeleton className="h-16" />
  else if (preview.error) message = <ErrorState error={preview.error} />
  else {
    const p = preview.data!
    message = (
      <div className="flex flex-col gap-3">
        <p>
          {p.change.length ? (
            <>
              Mudam <strong>{plural(p.change.length, noun[0], noun[1])}</strong>
              {target}: {p.change.slice(0, 4).map((c) => c.label).join('; ')}
              {p.change.length > 4 ? ` e mais ${p.change.length - 4}.` : '.'}
            </>
          ) : (
            <strong>Nenhum registro muda.</strong>
          )}
        </p>
        {p.skip.length > 0 && (
          <div>
            <p className="font-medium">Ficam de fora {p.skip.length}:</p>
            <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-muted">
              {p.skip.slice(0, 20).map((x) => (
                <li key={x.id}>
                  {x.label}: {x.reason}
                </li>
              ))}
              {p.skip.length > 20 && <li>e mais {p.skip.length - 20}</li>}
            </ul>
          </div>
        )}
        {action.kind === 'archive' && entity === 'properties' && p.change.length > 0 && <p className="text-xs text-muted">As unidades ativas de cada imóvel são arquivadas junto; restaurar o imóvel devolve as mesmas.</p>}
      </div>
    )
  }
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${BULK_VERB[action.kind][0]} ${plural(ids.length, noun[0], noun[1])}${target}?`}
      message={message}
      confirmLabel={n ? `${BULK_VERB[action.kind][0].split(' ')[0]} ${plural(n, noun[0], noun[1])}` : 'Confirmar'}
      danger={action.kind === 'archive'}
      loading={run.isPending}
      onConfirm={() => run.mutate({ entity, ids, action })}
    />
  )
}

/* ---------------------------------------------------------------- histórico */

function HistoryPanel({ entity, id, label, onClose }: { entity: DmEntity; id: string; label: string; onClose: () => void }) {
  const s = useSession()
  const q = useRepo('dm:historico', (sess) => listHistory(sess, { entity, id }), [entity, id])
  return (
    <Section
      title="Histórico"
      className="self-start xl:sticky xl:top-28"
      actions={
        <button className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text" aria-label="Fechar histórico" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </button>
      }
    >
      <p className="mb-3 text-sm font-semibold [overflow-wrap:anywhere]">{label}</p>
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.restricted ? (
        <p className="text-sm text-muted">A auditoria guarda o antes e o depois de cada mudança e só o administrador da conta vê.</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <Timeline
            empty="Nenhuma mudança registrada para este registro."
            items={q.data.items.map((it) => ({
              id: it.id,
              when: formatDateTime(it.at, s.org.timezone),
              who: it.who,
              title: it.summary,
              detail: it.changes.length ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                  {it.changes.map((c) => (
                    <li key={c.field}>
                      <span className="font-medium text-text">{c.label}:</span> {c.from} → {c.to}
                    </li>
                  ))}
                </ul>
              ) : undefined,
            }))}
          />
        </div>
      )}
    </Section>
  )
}
