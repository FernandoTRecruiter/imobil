/* =============================================================================
   manutencao/vistorias.ts: vistorias de entrada, periódica e de saída.

   O QUE RESOLVE: registrar o estado do imóvel cômodo a cômodo (bom, regular, ruim ou não
   vistoriado, com observação por item), concluir a vistoria e, na de SAÍDA, apontar o que
   piorou desde a de ENTRADA. É essa comparação que decide desconto de caução ou reparo.

   ESCOPO: inspections não tem regra própria em scope.ts. Quem vê (seeInspection):
   - equipe: todas da organização;
   - proprietário e inquilino: as das unidades deles (scope.ts já monta a lista inspectionIds);
   - prestador: nenhuma.
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, audit, connect, diff, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { INSPECTION_KIND } from '@/data/labels'
import { runList, type ListParams, type ListResult } from '@/data/query'
import { leaseCovers } from '@/data/rules'
import { see, type Scope } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type { Condition, DocumentFile, Id, Inspection, InspectionKind, InspectionRoom, Unit } from '@/data/types'
import { lookup, unitLabel, type Lookup } from '@/data/views/lookup'
import { formatDate } from '@/lib/dates'
import { normalize } from '@/lib/text'
import { newId } from '@/lib/random'
import { teamOf } from '@/modules/processos/repo'
import { parseInput } from './repo'

export const INSPECTION_STATUS: Record<Inspection['status'], string> = { scheduled: 'Agendada', done: 'Concluída', canceled: 'Cancelada' }
export const KINDS = ['move_in', 'periodic', 'move_out'] as const satisfies readonly InspectionKind[]
/** O tipo dentro de uma frase: "vistoria de saída" (o rótulo sozinho, "Saída", não cabe depois de "vistoria"). */
export const KIND_PHRASE: Record<InspectionKind, string> = { move_in: 'de entrada', periodic: 'periódica', move_out: 'de saída' }
export const CONDITIONS = ['good', 'fair', 'poor', 'na'] as const satisfies readonly Condition[]

function seeInspection(sc: Scope, i: Inspection): boolean {
  return i.organization_id === sc.orgId && (sc.all || sc.inspectionIds.has(i.id))
}

/* ---------------------------------------------------------------- regras puras (testadas) */

/** Nota de cada estado para comparar: maior = melhor. "Não vistoriado" não entra na comparação. */
const RANK: Record<Exclude<Condition, 'na'>, number> = { good: 3, fair: 2, poor: 1 }

export interface WorseItem {
  room: string
  item: string
  from: Condition
  to: Condition
  note: string
}

/**
 * Itens que PIORARAM da vistoria de entrada para a de saída.
 * Liga cômodo com cômodo e item com item pelo NOME, sem acento e sem caixa ("Cozinha" = "cozinha").
 * Item novo na saída, ou não vistoriado em uma das duas, fica de fora: não dá para dizer que piorou.
 */
export function worsenedItems(entrada: InspectionRoom[], saida: InspectionRoom[]): WorseItem[] {
  const before = new Map<string, Condition>()
  for (const r of entrada) for (const it of r.items) before.set(`${normalize(r.name)}|${normalize(it.name)}`, it.condition)
  const out: WorseItem[] = []
  for (const r of saida) {
    for (const it of r.items) {
      const from = before.get(`${normalize(r.name)}|${normalize(it.name)}`)
      if (!from || from === 'na' || it.condition === 'na') continue
      if (RANK[it.condition] < RANK[from]) out.push({ room: r.name, item: it.name, from, to: it.condition, note: it.note })
    }
  }
  return out
}

const BASE_ITEMS = ['Piso', 'Paredes e pintura', 'Portas e fechaduras', 'Janelas', 'Tomadas e iluminação']
const WET_ROOMS = ['Cozinha', 'Banheiro', 'Copa']

/** Checklist inicial de uma unidade (os mesmos cômodos e itens do gerador), tudo "não vistoriado". */
export function defaultRooms(u: Pick<Unit, 'kind' | 'bedrooms'>): InspectionRoom[] {
  const names =
    u.kind === 'parking' ? ['Vaga']
      : u.kind === 'office' || u.kind === 'store' ? ['Salão', 'Copa', 'Banheiro']
        : u.kind === 'warehouse' ? ['Galpão', 'Banheiro']
          : ['Sala', 'Cozinha', ...Array.from({ length: Math.max(1, u.bedrooms) }, (_, i) => `Quarto ${i + 1}`), 'Banheiro']
  return names.map((name) => ({
    name,
    items: (name === 'Vaga' ? ['Piso', 'Demarcação'] : [...BASE_ITEMS, ...(WET_ROOMS.includes(name) ? ['Louças e metais'] : [])]).map((item) => ({ name: item, condition: 'na' as const, note: '' })),
  }))
}

/* ---------------------------------------------------------------- leitura */

export interface InspectionRow extends Inspection {
  unit_code: string
  unit_label: string
  property_id: Id
  property_name: string
  inspector_name: string | null
  contract_code: string | null
  /** Itens com estado avaliado (diferente de "não vistoriado") e o total de itens. */
  items_checked: number
  items_total: number
  items_poor: number
}

function toInspectionRows(db: Db, sc: Scope, L: Lookup = lookup(db)): InspectionRow[] {
  return db.inspections
    .filter((i) => seeInspection(sc, i))
    .map((i) => {
      const u = L.unit.get(i.unit_id)
      const items = i.rooms.flatMap((r) => r.items)
      return {
        ...i, unit_code: u?.code ?? '', unit_label: u ? unitLabel(L, u) : '', property_id: u?.property_id ?? '',
        property_name: u ? (L.property.get(u.property_id)?.name ?? '') : '',
        inspector_name: i.inspector_user_id ? (L.userName.get(i.inspector_user_id) ?? null) : null,
        contract_code: i.contract_id ? (L.contract.get(i.contract_id)?.code ?? null) : null,
        items_checked: items.filter((x) => x.condition !== 'na').length, items_total: items.length, items_poor: items.filter((x) => x.condition === 'poor').length,
      }
    })
}

const STATUS_RANK: Record<Inspection['status'], number> = { scheduled: 0, done: 1, canceled: 2 }

/**
 * Filtros: kind, status, property. Ordens: date (feita em; se não foi feita, agendada para), unit.
 * Ordem declarada: as agendadas primeiro (a mais próxima em cima), depois as feitas (a mais nova em cima).
 * Devolve também as opções do filtro "Imóvel" (nome de cada imóvel que aparece na lista).
 */
export async function listInspections(s: Session, params: ListParams): Promise<ListResult<InspectionRow> & { propertyOptions: { value: string; label: string }[] }> {
  const { db, sc } = await connect(s)
  const rows = toInspectionRows(db, sc)
  const props = new Map(rows.map((r) => [r.property_id, r.property_name]))
  const result = runList(rows, params, {
    search: (r) => [r.unit_code, r.property_name, r.inspector_name, r.contract_code, INSPECTION_KIND[r.kind]],
    filters: { kind: (r) => r.kind, status: (r) => r.status, property: (r) => r.property_id },
    sorts: { date: (r) => r.done_date ?? r.scheduled_date, unit: (r) => r.unit_code },
    defaultSort: (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.status === 'scheduled' ? a.scheduled_date.localeCompare(b.scheduled_date) : b.scheduled_date.localeCompare(a.scheduled_date)),
  })
  return { ...result, propertyOptions: [...props].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')) }
}

export interface InspectionDetail {
  inspection: InspectionRow
  address: string
  /** Na vistoria de saída: a de entrada usada na comparação e os itens que pioraram. */
  baseline: { inspection: InspectionRow; worse: WorseItem[] } | null
  documents: DocumentFile[]
}

/**
 * A vistoria de entrada que serve de base para a de saída: a do MESMO contrato; se não houver,
 * a última de entrada concluída da mesma unidade antes desta.
 */
function findBaseline(rows: InspectionRow[], i: InspectionRow): InspectionRow | null {
  if (i.kind !== 'move_out') return null
  const until = i.done_date ?? i.scheduled_date
  const entries = rows.filter((x) => x.unit_id === i.unit_id && x.kind === 'move_in' && x.status === 'done' && x.id !== i.id && (x.done_date ?? x.scheduled_date) <= until)
  const sameContract = i.contract_id ? entries.find((x) => x.contract_id === i.contract_id) : undefined
  return sameContract ?? entries.sort((a, b) => (b.done_date ?? '').localeCompare(a.done_date ?? ''))[0] ?? null
}

export async function getInspection(s: Session, id: Id): Promise<InspectionDetail> {
  const { db, sc } = await connect(s)
  const L = lookup(db)
  const rows = toInspectionRows(db, sc, L)
  const inspection = rows.find((r) => r.id === id)
  if (!inspection) throw new AccessError('Vistoria não encontrada ou fora do seu acesso.')
  const p = L.property.get(inspection.property_id)
  const address = p ? `${p.address.street}, ${p.address.number} · ${p.address.district}, ${p.address.city}` : ''
  const base = findBaseline(rows, inspection)
  const documents = db.documents.filter((d) => d.inspection_id === id && see.document(sc, d))
  return { inspection, address, baseline: base ? { inspection: base, worse: worsenedItems(base.rooms, inspection.rooms) } : null, documents }
}

/* ---------------------------------------------------------------- gravação */

function requireTeamEdit(s: Session, sc: Scope): void {
  if (!sc.all || !can(s, 'maintenance:edit')) throw new AccessError('Só a equipe com permissão de editar a manutenção agenda e preenche vistorias.')
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida: escolha no calendário.')

export const scheduleSchema = z.object({
  unit_id: z.string().min(1, 'Escolha a unidade.'),
  kind: z.enum(KINDS, { message: 'Escolha o tipo da vistoria.' }),
  scheduled_date: isoDate,
  inspector_user_id: z.string(),
})
export type ScheduleInput = z.infer<typeof scheduleSchema>

/**
 * Agenda a vistoria.
 * Passo a passo: permissão -> unidade no escopo -> data de hoje em diante -> vistoriador é da equipe ->
 * não há outra do mesmo tipo já agendada para a unidade -> liga ao contrato da unidade -> monta o
 * checklist (na de saída, os mesmos cômodos e itens da de entrada, para a comparação casar).
 */
export async function scheduleInspection(s: Session, input: ScheduleInput): Promise<Inspection> {
  const data = parseInput(scheduleSchema, input)
  const { db, sc } = await connect(s)
  requireTeamEdit(s, sc)
  const unit = db.units.find((u) => u.id === data.unit_id)
  if (!unit || !see.unit(sc, unit) || unit.deleted_at) throw new RuleError('A unidade escolhida não existe mais ou está arquivada.')
  if (data.scheduled_date < s.today) throw new RuleError('A data ficou no passado: para registrar uma vistoria já feita, agende para hoje e conclua em seguida.')
  if (data.inspector_user_id && !teamOf(db, s.org.id).some((m) => m.id === data.inspector_user_id)) throw new RuleError('O vistoriador escolhido não é da equipe desta conta.')
  const dup = db.inspections.find((i) => i.organization_id === s.org.id && i.unit_id === unit.id && i.kind === data.kind && i.status === 'scheduled')
  if (dup) throw new RuleError(`Já existe vistoria ${KIND_PHRASE[data.kind]} agendada para ${unit.code} em ${formatDate(dup.scheduled_date)}. Abra a que existe em vez de agendar outra.`)

  // Contrato: a locação vigente hoje; sem ela, a que está para começar (vistoria de entrada).
  const leases = db.contracts.filter((k) => see.contract(sc, k) && k.kind === 'lease' && k.unit_id === unit.id)
  const contract = leases.find((k) => leaseCovers(k, s.today)) ?? leases.find((k) => k.status === 'awaiting_signature') ?? null
  const entrada = data.kind === 'move_out'
    ? db.inspections.filter((i) => i.organization_id === s.org.id && i.unit_id === unit.id && i.kind === 'move_in' && i.status === 'done').sort((a, b) => (b.done_date ?? '').localeCompare(a.done_date ?? ''))[0]
    : undefined
  const rooms = entrada ? entrada.rooms.map((r) => ({ name: r.name, items: r.items.map((it) => ({ name: it.name, condition: 'na' as const, note: '' })) })) : defaultRooms(unit)

  const now = nowIso()
  const row: Inspection = {
    id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id,
    unit_id: unit.id, contract_id: contract?.id ?? null, kind: data.kind, scheduled_date: data.scheduled_date, done_date: null,
    inspector_user_id: data.inspector_user_id || null, status: 'scheduled', rooms,
  }
  upsertRows('inspections', [row])
  audit(s, 'inspections', row.id, 'create', `Agendou a vistoria ${KIND_PHRASE[row.kind]} de ${unit.code} para ${formatDate(row.scheduled_date)}`)
  return row
}

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Item sem nome: escreva o que foi vistoriado ou remova a linha.').max(80, 'Nome de item longo demais: até 80 caracteres.'),
  condition: z.enum(CONDITIONS),
  note: z.string().trim().max(500, 'Observação longa demais: até 500 caracteres.'),
})
const roomSchema = z.object({
  name: z.string().trim().min(1, 'Cômodo sem nome: dê um nome ou remova o cômodo.').max(60, 'Nome de cômodo longo demais: até 60 caracteres.'),
  items: z.array(itemSchema).min(1, 'Cômodo sem itens: inclua pelo menos um ou remova o cômodo.').max(60),
})
export const checklistSchema = z.object({ id: z.string(), rooms: z.array(roomSchema).min(1, 'A vistoria precisa de pelo menos um cômodo.').max(40, 'Mais de 40 cômodos: confira.') })
export type ChecklistInput = z.infer<typeof checklistSchema>

/** Confere o checklist e devolve a versão limpa. Nome de cômodo repetido estragaria a comparação. */
function cleanRooms(input: ChecklistInput): InspectionRoom[] {
  const data = parseInput(checklistSchema, input)
  const seen = new Set<string>()
  for (const r of data.rooms) {
    const k = normalize(r.name)
    if (seen.has(k)) throw new RuleError(`Dois cômodos chamados "${r.name}": dê nomes diferentes (ex.: "Quarto 1" e "Quarto 2").`)
    seen.add(k)
  }
  return data.rooms
}

async function loadEditable(s: Session, id: Id) {
  const { db, sc } = await connect(s)
  requireTeamEdit(s, sc)
  const i = db.inspections.find((x) => x.id === id)
  if (!i || !seeInspection(sc, i)) throw new AccessError('Vistoria não encontrada ou fora do seu acesso.')
  if (i.status !== 'scheduled') throw new RuleError(`A vistoria está "${INSPECTION_STATUS[i.status]}": o checklist não muda mais (o laudo já vale como registro).`)
  return { db, i, unitCode: db.units.find((u) => u.id === i.unit_id)?.code ?? '' }
}

/** Salva o checklist sem concluir (a vistoria pode ser preenchida aos poucos). */
export async function saveChecklist(s: Session, input: ChecklistInput): Promise<Inspection> {
  const rooms = cleanRooms(input)
  const { i, unitCode } = await loadEditable(s, input.id)
  const after: Inspection = { ...i, rooms, updated_at: nowIso() }
  upsertRows('inspections', [after])
  const checked = rooms.flatMap((r) => r.items).filter((x) => x.condition !== 'na').length
  audit(s, 'inspections', i.id, 'update', `Checklist da vistoria de ${unitCode} salvo (${checked} itens avaliados)`, diff(i, after))
  return after
}

/** Conclui: grava o checklist, a data de hoje e fecha a edição. Precisa de pelo menos um item avaliado. */
export async function completeInspection(s: Session, input: ChecklistInput): Promise<Inspection> {
  const rooms = cleanRooms(input)
  const { i, unitCode } = await loadEditable(s, input.id)
  const items = rooms.flatMap((r) => r.items)
  const checked = items.filter((x) => x.condition !== 'na').length
  if (checked === 0) throw new RuleError('Nenhum item foi avaliado: marque o estado de pelo menos um item antes de concluir.')
  const after: Inspection = { ...i, rooms, status: 'done', done_date: s.today, updated_at: nowIso() }
  upsertRows('inspections', [after])
  const poor = items.filter((x) => x.condition === 'poor').length
  audit(s, 'inspections', i.id, 'status', `Vistoria de ${unitCode} concluída: ${checked} de ${items.length} itens avaliados${poor ? `, ${poor} em estado ruim` : ''}`, diff(i, after))
  return after
}
