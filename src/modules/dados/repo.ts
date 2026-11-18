/* =============================================================================
   Dados > Data Manager: o repositório da tabela editável de unidades, imóveis e pessoas.

   O que resolve: corrigir muitos cadastros rápido (área, aluguel pedido, carteira, telefone)
   sem abrir registro por registro, e arquivar ou mudar a situação de vários de uma vez.

   A REGRA DE OURO deste arquivo: o Data Manager não tem escrita genérica. Cada entidade tem
   a sua função (updateUnit, updateProperty, updatePerson) com a LISTA de campos que podem
   mudar, o zod de cada campo e a regra de negócio. Um "salvar qualquer coluna" deixaria a
   pessoa marcar unidade como ocupada à mão ou trocar o documento de alguém, furando as
   regras que o resto do sistema confia (no banco da fase 2 isso seria uma função por tabela).

   Ordem de toda gravação: permissão -> escopo (see.*) -> campos permitidos -> zod -> regra
   (RuleError com causa e conserto) -> upsertRows -> audit com o "antes e depois" (diff).
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { can, hasFeature } from '@/auth/permissions'
import { AccessError, audit, connect, diff, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { runList, type ListConfig, type ListParams, type ListResult } from '@/data/query'
import { see, type Scope } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type { AuditLog, Id, ManualUnitStatus, Person, PersonTag, Property, Unit } from '@/data/types'
import { toPersonRows, type PersonRow } from '@/data/views/contracts'
import { lookup } from '@/data/views/lookup'
import { toPropertyRows, toUnitRows, type PropertyRow, type UnitRow } from '@/data/views/units'
import { onlyDigits } from '@/lib/documents'
import { AUDIT_ACTION_LABEL, changesText, describeChanges, type ChangeLine, type NameBook } from '@/modules/configuracoes/auditoria'
import { activeTeam, archiveBlockPerson, archiveBlockProperty, archiveBlockUnit, restoreBlockUnit, vendorTagRemovalBlock, type TeamMember } from './regras'

export type DmEntity = 'units' | 'properties' | 'people'
export const DM_ENTITY_NOUN: Record<DmEntity, [string, string]> = { units: ['unidade', 'unidades'], properties: ['imóvel', 'imóveis'], people: ['pessoa', 'pessoas'] }

/** Origem do cadastro: veio de planilha (tem lote) ou foi feito pela tela. */
export type Origin = 'importada' | 'tela'

export interface DmUnit extends UnitRow {
  portfolio_name: string | null
  origin: Origin
}
export interface DmProperty extends PropertyRow {
  origin: Origin
}
export interface DmPerson extends PersonRow {
  origin: Origin
}

/* ---------------------------------------------------------------- portas de acesso */

/** O Data Manager é ferramenta de quem tem "importar dados" (admin sempre; colaborador se liberado). */
function requireTool(s: Session): void {
  if (!can(s, 'data:import')) throw new AccessError('O Data Manager pede a permissão "Importar e editar em massa". Quem administra a conta libera em Configurações.')
}

/** Editar pede também a permissão do cadastro: o Data Manager não dá mais poder que a tela do cadastro. */
export function requireEdit(s: Session, entity: DmEntity): void {
  const need = entity === 'people' ? 'people:edit' : 'properties:edit'
  if (!can(s, need)) throw new AccessError(entity === 'people' ? 'Editar pessoas pede a permissão "Pessoas: editar".' : 'Editar imóveis e unidades pede a permissão "Imóveis: editar".')
}

/** Primeira mensagem do zod como RuleError (a tela mostra direto na célula). */
function check<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data)
  if (!r.success) throw new RuleError(r.error.issues[0]?.message ?? 'Valor inválido.')
  return r.data
}

/** Só os campos da lista entram; qualquer outro é recusado com o motivo. */
function onlyAllowed(patch: Record<string, unknown>, allowed: readonly string[], what: string): void {
  const extra = Object.keys(patch).filter((k) => !allowed.includes(k))
  if (extra.length) throw new RuleError(`${what}: o campo "${extra[0]}" não se edita no Data Manager. Use a tela do cadastro.`)
  if (!Object.keys(patch).length) throw new RuleError('Nada para salvar.')
}

/** Nomes para a auditoria virar texto (responsável, carteira, pessoa). */
export function nameBook(db: Db, orgId: Id): NameBook {
  return {
    user: new Map(db.profiles.map((p) => [p.id, p.full_name])),
    portfolio: new Map(db.portfolios.filter((p) => p.organization_id === orgId).map((p) => [p.id, p.name])),
    person: new Map(db.people.filter((p) => p.organization_id === orgId).map((p) => [p.id, p.name])),
  }
}

/* ---------------------------------------------------------------- listas */

/** Arquivado só aparece quando o filtro "Arquivado" está ligado (mesma regra das listas de Imóveis e Pessoas). */
function hideArchived<T extends { deleted_at: string | null }>(rows: T[], params: ListParams): T[] {
  return (params.filters?.archived ?? []).length ? rows : rows.filter((r) => !r.deleted_at)
}

const archivedOf = (r: { deleted_at: string | null }) => (r.deleted_at ? 'sim' : 'nao')

const UNIT_LIST: ListConfig<DmUnit> = {
  search: (r) => [r.code, r.property_name, r.district, r.owners_label, r.lease?.lessee_name, r.notes],
  filters: {
    status: (r) => r.status, manual: (r) => r.manual_status, kind: (r) => r.kind, property: (r) => r.property_id,
    portfolio: (r) => r.portfolio_id, archived: archivedOf, origin: (r) => r.origin,
  },
  sorts: {
    code: (r) => r.code, property: (r) => r.property_name, status: (r) => r.status, manual: (r) => r.manual_status, kind: (r) => r.kind,
    area: (r) => r.area_m2, bedrooms: (r) => r.bedrooms, bathrooms: (r) => r.bathrooms, parking: (r) => r.parking_spots,
    rent: (r) => r.asking_rent_cents, lessee: (r) => r.lease?.lessee_name ?? null, portfolio: (r) => r.portfolio_name, notes: (r) => r.notes,
  },
  defaultSort: (a, b) => a.property_name.localeCompare(b.property_name, 'pt-BR') || a.code.localeCompare(b.code, 'pt-BR', { numeric: true }),
}

/** Filtros: status, manual, kind, property, portfolio, archived, origin. */
export async function listDmUnits(s: Session, params: ListParams): Promise<ListResult<DmUnit>> {
  requireTool(s)
  const { db, sc } = await connect(s)
  const L = lookup(db)
  const rows: DmUnit[] = toUnitRows(db, sc, s.today, L).map((u) => ({
    ...u, portfolio_name: u.portfolio_id ? (L.portfolioName.get(u.portfolio_id) ?? null) : null, origin: u.import_batch_id ? 'importada' : 'tela',
  }))
  return runList(hideArchived(rows, params), params, UNIT_LIST)
}

const PROPERTY_LIST: ListConfig<DmProperty> = {
  search: (r) => [r.name, r.address.street, r.address.number, r.address.district, r.owners_label, r.notes],
  filters: { kind: (r) => r.kind, portfolio: (r) => r.portfolio_id, manager: (r) => r.manager_user_id, district: (r) => r.address.district, archived: archivedOf, origin: (r) => r.origin },
  sorts: {
    name: (r) => r.name, kind: (r) => r.kind, district: (r) => r.address.district, portfolio: (r) => r.portfolio_name, manager: (r) => r.manager_name,
    units: (r) => r.units_total, occupancy: (r) => r.occupancy_pct, notes: (r) => r.notes,
  },
  defaultSort: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
}

/** Filtros: kind, portfolio, manager, district, archived, origin. */
export async function listDmProperties(s: Session, params: ListParams): Promise<ListResult<DmProperty>> {
  requireTool(s)
  const { db, sc } = await connect(s)
  const rows: DmProperty[] = toPropertyRows(db, sc, s.today).map((p) => ({ ...p, origin: p.import_batch_id ? 'importada' : 'tela' }))
  return runList(hideArchived(rows, params), params, PROPERTY_LIST)
}

const PEOPLE_LIST: ListConfig<DmPerson> = {
  search: (r) => [r.name, r.document, r.email, r.phone],
  filters: { kind: (r) => r.kind, tag: (r) => r.tags, role: (r) => r.roles, archived: archivedOf, origin: (r) => r.origin },
  sorts: { name: (r) => r.name, kind: (r) => r.kind, email: (r) => r.email, phone: (r) => r.phone, units_owned: (r) => r.units_owned, active_leases: (r) => r.active_leases },
  defaultSort: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
}

/** Filtros: kind, tag (papel declarado), role (todos os papéis), archived, origin. */
export async function listDmPeople(s: Session, params: ListParams): Promise<ListResult<DmPerson>> {
  requireTool(s)
  const { db, sc } = await connect(s)
  const rows: DmPerson[] = toPersonRows(db, sc, s.today).map((p) => ({ ...p, origin: p.import_batch_id ? 'importada' : 'tela' }))
  return runList(hideArchived(rows, params), params, PEOPLE_LIST)
}

export interface DmOptions {
  portfolios: { id: Id; name: string }[]
  team: TeamMember[]
  properties: { id: Id; name: string }[]
}

/** Opções dos selects (carteira, responsável) e do filtro de imóvel. */
export async function dmOptions(s: Session): Promise<DmOptions> {
  requireTool(s)
  const { db, sc } = await connect(s)
  return {
    portfolios: hasFeature(s, 'portfolios') ? db.portfolios.filter((p) => p.organization_id === s.org.id).map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) : [],
    team: activeTeam(db, s.org.id),
    properties: db.properties.filter((p) => see.property(sc, p) && !p.deleted_at).map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  }
}

/* ---------------------------------------------------------------- edição na célula */

const intIn = (label: string, max: number) =>
  z.number({ error: `${label} precisa ser número.` }).int(`${label} precisa ser número inteiro.`).min(0, `${label} negativo: use 0 ou mais.`).max(max, `${label} acima de ${max}: confira o valor.`)

export const UNIT_EDITABLE = ['area_m2', 'bedrooms', 'bathrooms', 'parking_spots', 'asking_rent_cents', 'manual_status', 'notes'] as const
export const MANUAL_STATUSES: ManualUnitStatus[] = ['available', 'reserved', 'maintenance', 'blocked']

const unitPatchSchema = z
  .object({
    area_m2: z.number({ error: 'Área precisa ser número.' }).positive('Área precisa ser maior que zero.').max(100_000, 'Área acima de 100.000 m²: confira o valor.'),
    bedrooms: intIn('Quartos', 50),
    bathrooms: intIn('Banheiros', 50),
    parking_spots: intIn('Vagas', 100),
    asking_rent_cents: z
      .number({ error: 'Aluguel precisa ser valor em reais.' })
      .int('Aluguel em centavos inteiros.')
      .min(0, 'Aluguel negativo: informe o valor sem sinal.')
      .max(100_000_000_00, 'Aluguel acima de R$ 100 milhões: confira o valor.')
      .nullable(),
    // "Ocupada" fica de fora DE PROPÓSITO: ela vem do contrato vigente (rules.ts), nunca da mão.
    manual_status: z.enum(MANUAL_STATUSES, { error: 'Ocupada vem do contrato vigente, não se marca à mão: escolha Disponível, Reservada, Em manutenção ou Bloqueada.' }),
    notes: z.string().trim().max(1000, 'Observação acima de 1.000 caracteres: encurte o texto.'),
  })
  .partial()

export async function updateUnit(s: Session, args: { id: Id; patch: Record<string, unknown> }): Promise<Unit> {
  requireTool(s)
  requireEdit(s, 'units')
  const { db, sc } = await connect(s)
  const u = db.units.find((x) => x.id === args.id)
  if (!u || !see.unit(sc, u)) throw new AccessError('Unidade não encontrada ou fora do seu acesso.')
  onlyAllowed(args.patch, UNIT_EDITABLE, 'Unidade')
  const data = check(unitPatchSchema, args.patch)
  if (u.deleted_at) throw new RuleError(`A unidade ${u.code} está arquivada: restaure antes de editar.`)
  const after: Unit = { ...u, ...data, updated_at: nowIso() }
  const changes = diff(u, after)
  if (!changes) return u
  upsertRows('units', [after])
  audit(s, 'units', u.id, 'update', `Editou a unidade ${u.code} no Data Manager (${changesText(changes, nameBook(db, s.org.id))})`, changes)
  return after
}

export const PROPERTY_EDITABLE = ['name', 'portfolio_id', 'manager_user_id', 'notes'] as const

const propertyPatchSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome com menos de 2 letras: escreva o nome do imóvel.').max(120, 'Nome acima de 120 caracteres: encurte.'),
    portfolio_id: z.string().min(1, 'Carteira inválida.').nullable(),
    manager_user_id: z.string().min(1, 'Responsável inválido.').nullable(),
    notes: z.string().trim().max(2000, 'Observação acima de 2.000 caracteres: encurte o texto.'),
  })
  .partial()

export async function updateProperty(s: Session, args: { id: Id; patch: Record<string, unknown> }): Promise<Property> {
  requireTool(s)
  requireEdit(s, 'properties')
  const { db, sc } = await connect(s)
  const p = db.properties.find((x) => x.id === args.id)
  if (!p || !see.property(sc, p)) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  onlyAllowed(args.patch, PROPERTY_EDITABLE, 'Imóvel')
  const data = check(propertyPatchSchema, args.patch)
  if (p.deleted_at) throw new RuleError(`"${p.name}" está arquivado: restaure antes de editar.`)
  if (data.portfolio_id) {
    if (!hasFeature(s, 'portfolios')) throw new RuleError('Conta de proprietário não usa carteiras.')
    if (!db.portfolios.some((x) => x.id === data.portfolio_id && x.organization_id === s.org.id))
      throw new RuleError('Essa carteira não existe nesta conta: escolha uma da lista ou crie em Configurações > Carteiras.')
  }
  if (data.manager_user_id && !activeTeam(db, s.org.id).some((m) => m.userId === data.manager_user_id))
    throw new RuleError('O responsável precisa ser alguém da equipe com acesso ativo: escolha da lista ou reative o acesso em Configurações > Usuários.')
  const after: Property = { ...p, ...data, updated_at: nowIso() }
  const changes = diff(p, after)
  if (!changes) return p
  upsertRows('properties', [after])
  audit(s, 'properties', p.id, 'update', `Editou o imóvel "${p.name}" no Data Manager (${changesText(changes, nameBook(db, s.org.id))})`, changes)
  return after
}

export const PERSON_EDITABLE = ['name', 'email', 'phone', 'tags'] as const
export const PERSON_TAGS: PersonTag[] = ['vendor', 'contact', 'caretaker', 'syndic']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const personPatchSchema = z
  .object({
    name: z.string().trim().min(2, 'Nome com menos de 2 letras: escreva o nome completo.').max(120, 'Nome acima de 120 caracteres: encurte.'),
    email: z.string().trim().toLowerCase().refine((v) => v === '' || EMAIL_RE.test(v), 'E-mail incompleto: use nome@exemplo.com.br (ou deixe vazio).'),
    phone: z
      .string()
      .transform((v) => onlyDigits(v))
      .refine((d) => d === '' || (d.length >= 10 && d.length <= 11), 'Telefone com DDD: 10 ou 11 números (ex.: 31 99999-0000).'),
    tags: z.array(z.enum(PERSON_TAGS, { error: 'Papel declarado inválido: use Prestador, Contato, Zelador ou Síndico.' })).max(4),
  })
  .partial()

export async function updatePerson(s: Session, args: { id: Id; patch: Record<string, unknown> }): Promise<Person> {
  requireTool(s)
  requireEdit(s, 'people')
  const { db, sc } = await connect(s)
  const p = db.people.find((x) => x.id === args.id)
  if (!p || !see.person(sc, p)) throw new AccessError('Pessoa não encontrada ou fora do seu acesso.')
  onlyAllowed(args.patch, PERSON_EDITABLE, 'Pessoa')
  const data = check(personPatchSchema, args.patch)
  if (p.deleted_at) throw new RuleError(`${p.name} está arquivada: restaure antes de editar.`)
  if (data.tags) {
    data.tags = [...new Set(data.tags)]
    const block = vendorTagRemovalBlock(db, p, data.tags)
    if (block) throw new RuleError(`${block}.`)
  }
  const after: Person = { ...p, ...data, updated_at: nowIso() }
  const changes = diff(p, after)
  if (!changes) return p
  upsertRows('people', [after])
  audit(s, 'people', p.id, 'update', `Editou ${p.name} no Data Manager (${changesText(changes, nameBook(db, s.org.id))})`, changes)
  return after
}

/**
 * Uma célula = uma gravação. Esta função só ESCOLHE a porta (updateUnit, updateProperty,
 * updatePerson); quem confere campo, valor e regra é a porta de cada entidade.
 */
export async function saveCell(s: Session, args: { entity: DmEntity; id: Id; field: string; value: unknown }): Promise<unknown> {
  const patch = { [args.field]: args.value }
  if (args.entity === 'units') return updateUnit(s, { id: args.id, patch })
  if (args.entity === 'properties') return updateProperty(s, { id: args.id, patch })
  return updatePerson(s, { id: args.id, patch })
}

/* ---------------------------------------------------------------- ações em lote */

export type BulkAction = { kind: 'archive' } | { kind: 'restore' } | { kind: 'status'; status: string } | { kind: 'portfolio'; portfolioId: Id | null }
export const BULK_ACTIONS: Record<DmEntity, BulkAction['kind'][]> = { units: ['status', 'archive', 'restore'], properties: ['portfolio', 'archive', 'restore'], people: ['archive', 'restore'] }

export interface BulkInput {
  entity: DmEntity
  ids: Id[]
  action: BulkAction
}
export interface BulkItem {
  id: Id
  label: string
  reason?: string
}
/** O que muda e o que fica de fora (com o motivo). A tela mostra isso ANTES de confirmar. */
export interface BulkPlan {
  change: BulkItem[]
  skip: BulkItem[]
}

const bulkInputSchema = z.object({
  entity: z.enum(['units', 'properties', 'people']),
  ids: z.array(z.string().min(1)).min(1, 'Selecione ao menos um registro.').max(5000, 'Mais de 5.000 registros de uma vez: filtre e faça em partes.'),
  action: z.union([
    z.object({ kind: z.literal('archive') }),
    z.object({ kind: z.literal('restore') }),
    z.object({ kind: z.literal('status'), status: z.string() }),
    z.object({ kind: z.literal('portfolio'), portfolioId: z.string().min(1).nullable() }),
  ]),
})

const UNIT_STATUS_PT: Record<ManualUnitStatus, string> = { available: 'Disponível', reserved: 'Reservada', maintenance: 'Em manutenção', blocked: 'Bloqueada' }

/** Calcula o lote sem gravar nada. Usada pela prévia (contagem do ConfirmDialog) e de novo na gravação. */
function planBulk(db: Db, sc: Scope, s: Session, input: BulkInput): BulkPlan {
  const { entity, action } = input
  if (!BULK_ACTIONS[entity].includes(action.kind)) throw new RuleError('Esta ação não existe para este tipo de registro.')
  if (action.kind === 'status' && !MANUAL_STATUSES.includes(action.status as ManualUnitStatus))
    throw new RuleError('Ocupada vem do contrato vigente, não se marca à mão: escolha Disponível, Reservada, Em manutenção ou Bloqueada.')
  if (action.kind === 'portfolio') {
    if (!hasFeature(s, 'portfolios')) throw new RuleError('Conta de proprietário não usa carteiras.')
    if (action.portfolioId && !db.portfolios.some((p) => p.id === action.portfolioId && p.organization_id === s.org.id))
      throw new RuleError('Essa carteira não existe nesta conta: escolha uma da lista ou crie em Configurações > Carteiras.')
  }
  const plan: BulkPlan = { change: [], skip: [] }
  for (const id of new Set(input.ids)) {
    const rec =
      entity === 'units' ? db.units.find((u) => u.id === id && see.unit(sc, u))
      : entity === 'properties' ? db.properties.find((p) => p.id === id && see.property(sc, p))
      : db.people.find((p) => p.id === id && see.person(sc, p))
    if (!rec) {
      plan.skip.push({ id, label: 'Registro', reason: 'não encontrado ou fora do seu acesso' })
      continue
    }
    const label = 'code' in rec ? `${rec.code} · ${db.properties.find((p) => p.id === rec.property_id)?.name ?? ''}` : rec.name
    let reason: string | null
    if (action.kind === 'archive') {
      reason = rec.deleted_at
        ? 'já está arquivado'
        : entity === 'units' ? archiveBlockUnit(db, rec as Unit, s.today)
        : entity === 'properties' ? archiveBlockProperty(db, rec as Property, s.today)
        : archiveBlockPerson(db, rec as Person, s.today)
    } else if (action.kind === 'restore') {
      reason = !rec.deleted_at ? 'não está arquivado' : entity === 'units' ? restoreBlockUnit(db, rec as Unit) : null
    } else if (action.kind === 'status') {
      const u = rec as Unit
      reason = u.deleted_at ? 'está arquivada' : u.manual_status === action.status ? `já está ${UNIT_STATUS_PT[u.manual_status]}` : null
    } else {
      const p = rec as Property
      reason = p.deleted_at ? 'está arquivado' : p.portfolio_id === action.portfolioId ? 'já está nessa carteira' : null
    }
    if (reason) plan.skip.push({ id, label, reason })
    else plan.change.push({ id, label })
  }
  return plan
}

export async function previewBulk(s: Session, input: BulkInput): Promise<BulkPlan> {
  requireTool(s)
  requireEdit(s, input.entity)
  const { db, sc } = await connect(s)
  return planBulk(db, sc, s, check(bulkInputSchema, input) as BulkInput)
}

/**
 * Grava o lote. Recalcula o plano (o que a tela mostrou pode ter mudado nesse meio-tempo) e
 * aplica SÓ no que pode mudar; o que ficou de fora volta na resposta com o motivo.
 * Arquivar imóvel arquiva junto as unidades dele, com o MESMO horário: é por esse horário que
 * restaurar o imóvel devolve só as unidades que foram arquivadas com ele.
 */
export async function runBulk(s: Session, input: BulkInput): Promise<BulkPlan> {
  requireTool(s)
  requireEdit(s, input.entity)
  const { db, sc } = await connect(s)
  const data = check(bulkInputSchema, input) as BulkInput
  const plan = planBulk(db, sc, s, data)
  if (!plan.change.length) throw new RuleError(`Nenhum registro muda: ${plan.skip[0]?.reason ?? 'nada selecionado'}.`)
  const now = nowIso()
  const names = nameBook(db, s.org.id)
  const ids = new Set(plan.change.map((c) => c.id))
  const { action } = data
  const verb = action.kind === 'archive' ? 'Arquivou' : action.kind === 'restore' ? 'Restaurou' : 'Alterou'
  const auditAction: AuditLog['action'] = action.kind === 'archive' ? 'archive' : action.kind === 'restore' ? 'restore' : 'update'

  if (data.entity === 'units') {
    const rows = db.units.filter((u) => ids.has(u.id))
    const next = rows.map((u) =>
      action.kind === 'status' ? { ...u, manual_status: action.status as ManualUnitStatus, updated_at: now } : { ...u, deleted_at: action.kind === 'archive' ? now : null, updated_at: now },
    )
    upsertRows('units', next)
    next.forEach((u, i) => {
      const ch = diff(rows[i], u)
      audit(s, 'units', u.id, auditAction, `${verb} a unidade ${u.code} (Data Manager, em lote)${action.kind === 'status' ? `: ${changesText(ch, names)}` : ''}`, ch)
    })
  } else if (data.entity === 'properties') {
    const rows = db.properties.filter((p) => ids.has(p.id))
    const next = rows.map((p) =>
      action.kind === 'portfolio' ? { ...p, portfolio_id: action.portfolioId, updated_at: now } : { ...p, deleted_at: action.kind === 'archive' ? now : null, updated_at: now },
    )
    upsertRows('properties', next)
    next.forEach((p, i) => audit(s, 'properties', p.id, auditAction, `${verb} o imóvel "${p.name}" (Data Manager, em lote)${action.kind === 'portfolio' ? `: ${changesText(diff(rows[i], p), names)}` : ''}`, diff(rows[i], p)))
    if (action.kind === 'archive' || action.kind === 'restore') {
      // Unidades acompanham o imóvel: arquivar leva as ativas; restaurar devolve as que saíram junto (mesmo horário).
      const byProp = new Map(rows.map((p) => [p.id, p]))
      const units = db.units.filter((u) => {
        const p = byProp.get(u.property_id)
        return p && (action.kind === 'archive' ? !u.deleted_at : !!u.deleted_at && u.deleted_at === p.deleted_at)
      })
      const nextUnits = units.map((u) => ({ ...u, deleted_at: action.kind === 'archive' ? now : null, updated_at: now }))
      upsertRows('units', nextUnits)
      nextUnits.forEach((u, i) => audit(s, 'units', u.id, auditAction, `${verb} a unidade ${u.code} junto com o imóvel "${byProp.get(u.property_id)?.name ?? ''}"`, diff(units[i], u)))
    }
  } else {
    const rows = db.people.filter((p) => ids.has(p.id))
    const next = rows.map((p) => ({ ...p, deleted_at: action.kind === 'archive' ? now : null, updated_at: now }))
    upsertRows('people', next)
    next.forEach((p, i) => audit(s, 'people', p.id, auditAction, `${verb} ${p.name} (Data Manager, em lote)`, diff(rows[i], p)))
  }
  return plan
}

/* ---------------------------------------------------------------- histórico da linha */

export interface HistoryItem {
  id: Id
  at: string
  who: string
  action: string
  summary: string
  changes: ChangeLine[]
}

/**
 * Auditoria de UM registro. A auditoria guarda o antes e o depois (pode ter dado pessoal):
 * pela seção G do plano, só o administrador vê. Os outros recebem "restrito" e a tela explica.
 */
export async function listHistory(s: Session, args: { entity: DmEntity; id: Id }): Promise<{ restricted: boolean; items: HistoryItem[] }> {
  requireTool(s)
  const { db, sc } = await connect(s)
  const visible =
    args.entity === 'units' ? db.units.some((u) => u.id === args.id && see.unit(sc, u))
    : args.entity === 'properties' ? db.properties.some((p) => p.id === args.id && see.property(sc, p))
    : db.people.some((p) => p.id === args.id && see.person(sc, p))
  if (!visible) throw new AccessError('Registro não encontrado ou fora do seu acesso.')
  if (!s.roles.includes('admin')) return { restricted: true, items: [] }
  const names = nameBook(db, s.org.id)
  const items = db.audit_logs
    .filter((a) => a.organization_id === s.org.id && a.entity === args.entity && a.entity_id === args.id)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((a) => ({ id: a.id, at: a.at, who: a.actor_user_id ? (names.user.get(a.actor_user_id) ?? 'Usuário') : 'Sistema', action: AUDIT_ACTION_LABEL[a.action], summary: a.summary, changes: describeChanges(a.changes, names) }))
  return { restricted: false, items }
}
