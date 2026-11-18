/* =============================================================================
   Imóveis: repositório do módulo (imóvel, blocos, andares, unidades e donos).

   As LISTAS de imóveis e unidades já existem prontas em data/views/units.ts (listProperties,
   listUnits, getUnit, getPropertyStructure): as telas usam essas. Aqui fica o que é só
   deste módulo:
     1. cadastrar o imóvel com a estrutura gerada e, se informada, a equipe do prédio (createProperty);
     2. editar e arquivar imóvel e unidade, trocar as fatias dos donos;
     3. leituras de apoio das telas de detalhe (donos, documentos, histórico, contagens).
   A equipe do prédio mora em equipe.ts; a linha do tempo do imóvel, em timeline.ts.

   Toda gravação segue a ordem da casa: permissão -> zod -> regra de negócio (RuleError com
   causa e conserto) -> upsertRows -> audit -> devolve a linha. Nada é apagado de verdade:
   arquivar preenche deleted_at; trocar dono fecha a fatia antiga (until) e abre a nova.
   ============================================================================= */
import type { z } from 'zod'
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, audit, connect, diff, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { CONTRACT_STATUS, PROPERTY_KIND, STAFF_ROLE } from '@/data/labels'
import { runList, type ListParams, type ListResult } from '@/data/query'
import { HOLDING_STATUSES, leaseCovers } from '@/data/rules'
import { see, type Scope } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type { Building, BuildingModel, Contract, DocumentFile, Floor, Id, Person, Property, PropertyOwner, PropertyStaff, Unit } from '@/data/types'
import { addDays } from '@/lib/dates'
import { onlyDigits } from '@/lib/documents'
import { parseBRL } from '@/lib/money'
import { newId } from '@/lib/random'
import { plural } from '@/lib/text'
import { LINK_KIND_LABEL, VISIBILITY_LABEL, type LinkKind } from '@/modules/documentos/repo'
import { newQuickPerson } from '@/modules/pessoas/repo'
import { buildHistory, type HistoryEntry } from './history'
import {
  newPropertySchema, ownersEditSchema, propertyEditSchema, STAFF_ROLE_TAG, TEMPLATES_BY_KIND, unitEditSchema,
  type NewPropertyInput, type OwnersEditInput, type PropertyEditInput, type UnitEditInput,
} from './schemas'
import { planStructure } from './structure'

export { LINK_KIND_LABEL, VISIBILITY_LABEL }

/* ---------------------------------------------------------------- ajudantes */

/**
 * Valida com o esquema e, se falhar, devolve a PRIMEIRA mensagem como RuleError.
 * Sem isso, o erro do zod chegaria à tela como um texto técnico (lista de "issues" em JSON).
 */
export function parseOrRule<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input)
  if (!r.success) throw new RuleError(r.error.issues[0]?.message ?? 'Dados inválidos: confira o formulário.')
  return r.data
}

/** Só quem é da equipe E tem "editar imóveis" grava aqui (o colaborador do financeiro só vê). */
export function requireEditor(s: Session, sc: Scope): void {
  if (!sc.all || !can(s, 'properties:edit')) throw new AccessError('Seu papel não permite alterar imóveis. Quem administra a conta pode liberar em Configurações.')
}

/** Colunas comuns de toda linha nova (o banco preencheria sozinho na fase 2). */
export function baseRow(s: Session, now: string) {
  return { id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id }
}

/** Dono vigente na data: sem "até" ou com "até" de hoje em diante (mesma regra do scope.ts). */
function ownerCurrent(o: PropertyOwner, today: string): boolean {
  return !o.until || o.until >= today
}

/** Confere carteira e responsável: precisam ser DESTA organização (id de outra conta seria vazamento). */
function checkPortfolioAndManager(db: Db, s: Session, portfolioId: string, managerId: string): void {
  if (portfolioId && !db.portfolios.some((p) => p.id === portfolioId && p.organization_id === s.org.id)) {
    throw new RuleError('A carteira escolhida não existe mais nesta conta. Escolha outra ou deixe sem carteira.')
  }
  if (managerId && !db.memberships.some((m) => m.user_id === managerId && m.organization_id === s.org.id && m.status === 'active' && (m.role === 'admin' || m.role === 'staff'))) {
    throw new RuleError('O responsável escolhido não está mais na equipe. Escolha outra pessoa da equipe.')
  }
}

/** As pessoas indicadas como donas existem, são desta conta e não estão arquivadas? */
function checkOwnerPeople(db: Db, s: Session, owners: { person_id: Id; name: string }[]): void {
  for (const o of owners) {
    const p = db.people.find((x) => x.id === o.person_id && x.organization_id === s.org.id)
    if (!p || p.deleted_at) throw new RuleError(`${o.name || 'Uma das pessoas'} não está mais no cadastro (arquivada ou de outra conta). Escolha outra pessoa.`)
    // A equipe do prédio pode ser cadastrada sem CPF; dono, não (o repasse e o informe de rendimentos pedem).
    if (!p.document) throw new RuleError(`${p.name} está no cadastro sem CPF ou CNPJ. Complete o documento em Pessoas antes de torná-la proprietária.`)
  }
}

function addressOf(a: NewPropertyInput['address']): Property['address'] {
  return { cep: onlyDigits(a.cep), street: a.street, number: a.number, complement: a.complement, district: a.district, city: a.city, state: a.state.toUpperCase() }
}

/** Contratos que "seguram" as unidades (vigente ou aguardando assinatura): impedem arquivar. */
function holdingContracts(db: Db, orgId: Id, unitIds: Set<Id>): Contract[] {
  return db.contracts.filter((k) => k.organization_id === orgId && !!k.unit_id && unitIds.has(k.unit_id) && HOLDING_STATUSES.includes(k.status))
}

export interface ArchiveBlocker {
  contract_id: Id
  contract_code: string
  unit_id: Id
  unit_code: string
  status_label: string
}

function blockersOf(db: Db, orgId: Id, unitIds: Set<Id>): ArchiveBlocker[] {
  const code = new Map(db.units.map((u) => [u.id, u.code]))
  return holdingContracts(db, orgId, unitIds)
    .map((k) => ({ contract_id: k.id, contract_code: k.code, unit_id: k.unit_id!, unit_code: code.get(k.unit_id!) ?? '', status_label: CONTRACT_STATUS[k.status].toLowerCase() }))
    .sort((a, b) => a.unit_code.localeCompare(b.unit_code, 'pt-BR', { numeric: true }))
}

/** "A-101 (LOC-0001), A-102 (LOC-0007) e mais 12": a lista cabe numa mensagem. */
function blockerList(list: ArchiveBlocker[], max = 5): string {
  const shown = list.slice(0, max).map((b) => `${b.unit_code} (${b.contract_code})`).join(', ')
  return list.length > max ? `${shown} e mais ${list.length - max}` : shown
}

/* ---------------------------------------------------------------- opções dos formulários e filtros */

export interface Option {
  value: string
  label: string
}

/** Carteiras e equipe da organização (para os campos "Carteira" e "Responsável"). Só a equipe usa. */
export async function listFormOptions(s: Session): Promise<{ portfolios: Option[]; managers: Option[] }> {
  const { db, sc } = await connect(s)
  if (!sc.all) throw new AccessError()
  const portfolios = db.portfolios.filter((p) => p.organization_id === s.org.id).map((p) => ({ value: p.id, label: p.name }))
  const names = new Map(db.profiles.map((p) => [p.id, p.full_name]))
  const ids = new Set(db.memberships.filter((m) => m.organization_id === s.org.id && m.status === 'active' && (m.role === 'admin' || m.role === 'staff')).map((m) => m.user_id))
  const managers = [...ids].map((id) => ({ value: id, label: names.get(id) ?? 'Pessoa da equipe' }))
  const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label, 'pt-BR')
  return { portfolios: portfolios.sort(byLabel), managers: managers.sort(byLabel) }
}

export interface PlaceOptions {
  properties: (Option & { hasBuildings: boolean; units: number })[]
  portfolios: Option[]
  districts: Option[]
  managers: Option[]
}

/**
 * Rótulos dos filtros da lista (imóvel, carteira, bairro, responsável), só com o que a sessão
 * enxerga. As contagens vêm das "facets" da lista; aqui vem só o NOME de cada opção.
 */
export async function listPlaceOptions(s: Session): Promise<PlaceOptions> {
  const { db, sc } = await connect(s)
  const props = db.properties.filter((p) => see.property(sc, p) && !p.deleted_at)
  const withBuildings = new Set(db.buildings.filter((b) => b.organization_id === s.org.id).map((b) => b.property_id))
  const unitCount = new Map<Id, number>()
  for (const u of db.units) if (see.unit(sc, u) && !u.deleted_at) unitCount.set(u.property_id, (unitCount.get(u.property_id) ?? 0) + 1)
  const names = new Map(db.profiles.map((p) => [p.id, p.full_name]))
  const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label, 'pt-BR')
  const managerIds = [...new Set(props.map((p) => p.manager_user_id).filter((x): x is Id => !!x))]
  return {
    properties: props.map((p) => ({ value: p.id, label: p.name, hasBuildings: withBuildings.has(p.id), units: unitCount.get(p.id) ?? 0 })).sort(byLabel),
    portfolios: db.portfolios.filter((p) => p.organization_id === s.org.id).map((p) => ({ value: p.id, label: p.name })).sort(byLabel),
    districts: [...new Set(props.map((p) => p.address.district))].map((d) => ({ value: d, label: d })).sort(byLabel),
    managers: managerIds.map((id) => ({ value: id, label: names.get(id) ?? 'Pessoa da equipe' })).sort(byLabel),
  }
}

/* ---------------------------------------------------------------- cadastrar imóvel */

/**
 * Cria imóvel, blocos, andares, unidades, donos e o modelo do 3D numa tacada só.
 * Passo a passo:
 *   1. permissão e validação (o mesmo esquema da tela);
 *   2. regras: o tipo aceita a estrutura? carteira, responsável e donos são desta conta?
 *   3. gera os códigos com planStructure (a mesma conta da prévia do assistente);
 *   4. monta as linhas e grava tabela por tabela;
 *   5. uma linha de auditoria com o resumo ("Cadastrou o condomínio X com 64 unidades").
 * Os donos entram como donos do IMÓVEL INTEIRO (unit_id vazio): valem para todas as unidades
 * até alguém registrar um dono próprio numa unidade.
 * Equipe do prédio (etapa opcional): cada pessoa vira ficha nova em Pessoas (pede "editar pessoas")
 * e uma ligação em property_staff. A permissão é conferida ANTES de gravar qualquer linha.
 */
export async function createProperty(s: Session, input: NewPropertyInput): Promise<{ property: Property; units: number }> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const data = parseOrRule(newPropertySchema, input)
  if (!TEMPLATES_BY_KIND[data.kind].includes(data.structure.template)) {
    throw new RuleError(`${PROPERTY_KIND[data.kind]} não combina com a estrutura escolhida. Volte à etapa Estrutura e escolha de novo.`)
  }
  checkPortfolioAndManager(db, s, data.portfolio_id, data.manager_user_id)
  checkOwnerPeople(db, s, data.owners)

  const plan = planStructure(data.structure)
  const now = nowIso()
  const rent = data.structure.unit.asking_rent ? parseBRL(data.structure.unit.asking_rent) : null
  const property: Property = {
    ...baseRow(s, now), deleted_at: null, kind: data.kind, name: data.name, address: addressOf(data.address),
    // atalho: imóvel novo nasce sem latitude e longitude (o ViaCEP não traz coordenada); geocodificar o endereço na fase 2.
    lat: null, lng: null,
    portfolio_id: data.portfolio_id || null, manager_user_id: data.manager_user_id || null, notes: data.notes, import_batch_id: null,
  }
  const unitRow = (code: string, buildingId: Id | null, floorId: Id | null, position: number | null): Unit => ({
    ...baseRow(s, now), deleted_at: null, property_id: property.id, building_id: buildingId, floor_id: floorId, code,
    kind: data.structure.unit.kind, area_m2: data.structure.unit.area_m2, bedrooms: data.structure.unit.bedrooms,
    bathrooms: data.structure.unit.bathrooms, parking_spots: data.structure.unit.parking_spots, features: [],
    // zone vazio: o cadastro em etapas gera unidades dentro de blocos; área de fora (estacionamento) não nasce aqui.
    manual_status: 'available', position, zone: null, asking_rent_cents: rent, notes: '', import_batch_id: null,
  })

  const buildings: Building[] = []
  const floors: Floor[] = []
  const units: Unit[] = []
  const models: BuildingModel[] = []
  const rows = data.structure.template === 'row_houses'
  let siteX = 2
  for (const pb of plan.blocks) {
    const upf = Math.max(...pb.floors.map((f) => f.units.length))
    // Mesma conta de largura do gerador de dados fictícios, para o 3D desenhar igual.
    const width = rows ? upf * 2 : Math.ceil(upf / 2) * 2
    const b: Building = { ...baseRow(s, now), property_id: property.id, name: pb.name, site_x: siteX, site_y: 2 }
    siteX += width + 3
    buildings.push(b)
    for (const pf of pb.floors) {
      const f: Floor = { ...baseRow(s, now), building_id: b.id, level: pf.level, label: pf.label }
      floors.push(f)
      for (const pu of pf.units) units.push(unitRow(pu.code, b.id, f.id, pu.position))
    }
    models.push({ ...baseRow(s, now), building_id: b.id, template: rows ? 'row_houses' : 'tower', floors: pb.floors.length, units_per_floor: upf, width, depth: rows ? 3 : 2 })
  }
  for (const pu of plan.loose) units.push(unitRow(pu.code, null, null, null))
  const owners: PropertyOwner[] = data.owners.map((o) => ({ ...baseRow(s, now), property_id: property.id, unit_id: null, person_id: o.person_id, share_pct: o.share_pct, since: s.today, until: null }))
  // Equipe: monta tudo antes de gravar (newQuickPerson recusa sem "editar pessoas", e aí o imóvel nem nasce).
  const staffPeople: Person[] = data.staff.map((m) => newQuickPerson(s, sc, { name: m.name, phone: m.phone, photo: m.photo }, STAFF_ROLE_TAG[m.role]))
  const staff: PropertyStaff[] = data.staff.map((m, i) => ({ ...baseRow(s, now), property_id: property.id, person_id: staffPeople[i].id, role: m.role, note: m.note, active: true }))

  upsertRows('properties', [property])
  if (buildings.length) upsertRows('buildings', buildings)
  if (floors.length) upsertRows('floors', floors)
  upsertRows('units', units)
  upsertRows('property_owners', owners)
  if (models.length) upsertRows('building_models', models)
  audit(s, 'properties', property.id, 'create', `Cadastrou ${PROPERTY_KIND[property.kind].toLowerCase()} "${property.name}" com ${plural(units.length, 'unidade', 'unidades')}`)
  if (staff.length) {
    upsertRows('people', staffPeople)
    upsertRows('property_staff', staff)
    staffPeople.forEach((p, i) => {
      audit(s, 'people', p.id, 'create', `Cadastrou ${p.name} (equipe do prédio de "${property.name}")`)
      audit(s, 'property_staff', staff[i].id, 'create', `Adicionou ${p.name} como ${STAFF_ROLE[staff[i].role].toLowerCase()} de "${property.name}"`)
    })
  }
  return { property, units: units.length }
}

/* ---------------------------------------------------------------- editar e arquivar imóvel */

export async function updateProperty(s: Session, input: PropertyEditInput): Promise<Property> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const data = parseOrRule(propertyEditSchema, input)
  const before = db.properties.find((p) => p.id === data.id)
  if (!before || !see.property(sc, before)) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  checkPortfolioAndManager(db, s, data.portfolio_id, data.manager_user_id)
  const after: Property = {
    ...before, name: data.name, address: addressOf(data.address), portfolio_id: data.portfolio_id || null,
    manager_user_id: data.manager_user_id || null, notes: data.notes, updated_at: nowIso(),
  }
  const changes = diff(before, after)
  if (!changes) return before // nada mudou: não grava nem polui a auditoria
  upsertRows('properties', [after])
  audit(s, 'properties', after.id, 'update', `Alterou os dados do imóvel "${after.name}"`, changes)
  return after
}

/** Para a tela mostrar ANTES de pedir confirmação o que impede arquivar o imóvel. */
export async function listPropertyArchiveBlockers(s: Session, id: Id): Promise<ArchiveBlocker[]> {
  const { db, sc } = await connect(s)
  if (!sc.all) throw new AccessError()
  const p = db.properties.find((x) => x.id === id)
  if (!p || !see.property(sc, p)) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  return blockersOf(db, s.org.id, new Set(db.units.filter((u) => u.property_id === id).map((u) => u.id)))
}

/**
 * Arquivar o imóvel arquiva junto as unidades dele, com a MESMA data e hora em deleted_at.
 * É essa marca igual que permite o "Desfazer" devolver só as unidades arquivadas por esta ação
 * (uma unidade arquivada antes, sozinha, continua arquivada).
 * Recusa se alguma unidade tem contrato vigente ou aguardando assinatura.
 */
export async function archiveProperty(s: Session, args: { id: Id; restore?: boolean }): Promise<Property> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const p = db.properties.find((x) => x.id === args.id)
  if (!p || !see.property(sc, p)) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  const units = db.units.filter((u) => u.property_id === p.id)
  const now = nowIso()
  if (args.restore) {
    if (!p.deleted_at) return p
    const stamp = p.deleted_at
    const back = units.filter((u) => u.deleted_at === stamp).map((u) => ({ ...u, deleted_at: null, updated_at: now }))
    const row = { ...p, deleted_at: null, updated_at: now }
    upsertRows('properties', [row])
    if (back.length) upsertRows('units', back)
    audit(s, 'properties', p.id, 'restore', `Restaurou o imóvel "${p.name}" e ${plural(back.length, 'unidade', 'unidades')}`)
    return row
  }
  if (p.deleted_at) return p
  const blockers = blockersOf(db, s.org.id, new Set(units.map((u) => u.id)))
  if (blockers.length) {
    throw new RuleError(`Não dá para arquivar "${p.name}": ${plural(blockers.length, 'unidade tem', 'unidades têm')} contrato vigente ou aguardando assinatura (${blockerList(blockers)}). Encerre ou rescinda esses contratos antes.`)
  }
  const gone = units.filter((u) => !u.deleted_at).map((u) => ({ ...u, deleted_at: now, updated_at: now }))
  const row = { ...p, deleted_at: now, updated_at: now }
  upsertRows('properties', [row])
  if (gone.length) upsertRows('units', gone)
  audit(s, 'properties', p.id, 'archive', `Arquivou o imóvel "${p.name}" e ${plural(gone.length, 'unidade', 'unidades')}`)
  return row
}

/* ---------------------------------------------------------------- editar e arquivar unidade */

/** "varanda, suíte; varanda" -> ["varanda", "suíte"] (sem repetição nem vazio). */
export function parseFeatures(text: string): string[] {
  return [...new Set(text.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean))]
}

export async function updateUnit(s: Session, input: UnitEditInput): Promise<Unit> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const data = parseOrRule(unitEditSchema, input)
  const before = db.units.find((u) => u.id === data.id)
  if (!before || !see.unit(sc, before)) throw new AccessError('Unidade não encontrada ou fora do seu acesso.')
  // Regra: "ocupada" vem do contrato vigente. Mudar a situação manual de uma unidade ocupada não
  // mudaria nada na tela e esconderia o erro de quem tentou; por isso a recusa explica o porquê.
  const lease = db.contracts.find((k) => k.unit_id === before.id && leaseCovers(k, s.today))
  if (lease && data.manual_status !== before.manual_status) {
    throw new RuleError(`A unidade está ocupada: a situação vem do contrato vigente ${lease.code}. Ela volta a ser escolhida à mão quando o contrato acabar.`)
  }
  const clash = db.units.find((u) => u.property_id === before.property_id && u.id !== before.id && !u.deleted_at && u.code.toLowerCase() === data.code.toLowerCase())
  if (clash) throw new RuleError(`Já existe a unidade ${clash.code} neste imóvel. Use outro código.`)
  const after: Unit = {
    ...before, code: data.code, kind: data.kind, area_m2: data.area_m2, bedrooms: data.bedrooms, bathrooms: data.bathrooms,
    parking_spots: data.parking_spots, features: parseFeatures(data.features), asking_rent_cents: data.asking_rent ? parseBRL(data.asking_rent) : null,
    manual_status: data.manual_status, notes: data.notes, updated_at: nowIso(),
  }
  const changes = diff(before, after)
  if (!changes) return before
  upsertRows('units', [after])
  audit(s, 'units', after.id, 'update', `Alterou a unidade ${after.code}`, changes)
  return after
}

/** Arquivar unidade: recusado com contrato vigente ou aguardando assinatura. "Desfazer" devolve. */
export async function archiveUnit(s: Session, args: { id: Id; restore?: boolean }): Promise<Unit> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const u = db.units.find((x) => x.id === args.id)
  if (!u || !see.unit(sc, u)) throw new AccessError('Unidade não encontrada ou fora do seu acesso.')
  const now = nowIso()
  if (args.restore) {
    if (!u.deleted_at) return u
    const p = db.properties.find((x) => x.id === u.property_id)
    if (p?.deleted_at) throw new RuleError(`O imóvel "${p.name}" está arquivado. Restaure o imóvel primeiro; as unidades dele voltam junto.`)
    const clash = db.units.find((x) => x.property_id === u.property_id && x.id !== u.id && !x.deleted_at && x.code.toLowerCase() === u.code.toLowerCase())
    if (clash) throw new RuleError(`Já existe outra unidade ${clash.code} ativa neste imóvel. Mude o código dela antes de restaurar esta.`)
    const row = { ...u, deleted_at: null, updated_at: now }
    upsertRows('units', [row])
    audit(s, 'units', u.id, 'restore', `Restaurou a unidade ${u.code}`)
    return row
  }
  if (u.deleted_at) return u
  const blockers = blockersOf(db, s.org.id, new Set([u.id]))
  if (blockers.length) {
    const b = blockers[0]
    throw new RuleError(`Não dá para arquivar ${u.code}: o contrato ${b.contract_code} está ${b.status_label}. Encerre ou rescinda o contrato antes.`)
  }
  const row = { ...u, deleted_at: now, updated_at: now }
  upsertRows('units', [row])
  audit(s, 'units', u.id, 'archive', `Arquivou a unidade ${u.code}`)
  return row
}

/* ---------------------------------------------------------------- donos */

export interface OwnerShareRow {
  person_id: Id
  name: string
  share_pct: number
  since: string
}

export interface PropertyOwners {
  /** Donos do imóvel inteiro (valem para as unidades sem dono próprio). */
  whole: OwnerShareRow[]
  /** Donos por unidade, agrupados por pessoa. */
  perUnit: { person_id: Id; name: string; units: { id: Id; code: string; share_pct: number }[] }[]
  /** Quantas unidades (visíveis) têm dono próprio. */
  unitsWithOwnOwners: number
  unitsVisible: number
}

export async function getPropertyOwners(s: Session, id: Id): Promise<PropertyOwners> {
  const { db, sc } = await connect(s)
  const p = db.properties.find((x) => x.id === id)
  if (!p || !see.property(sc, p)) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  const units = db.units.filter((u) => u.property_id === id && !u.deleted_at && see.unit(sc, u))
  const unitById = new Map(units.map((u) => [u.id, u]))
  const name = new Map(db.people.map((x) => [x.id, x.name]))
  const current = db.property_owners.filter((o) => o.property_id === id && o.organization_id === s.org.id && ownerCurrent(o, s.today))
  const whole = current
    .filter((o) => !o.unit_id)
    .map((o) => ({ person_id: o.person_id, name: name.get(o.person_id) ?? 'Pessoa', share_pct: o.share_pct, since: o.since }))
    .sort((a, b) => b.share_pct - a.share_pct || a.name.localeCompare(b.name, 'pt-BR'))
  const groups = new Map<Id, PropertyOwners['perUnit'][number]>()
  const withOwn = new Set<Id>()
  for (const o of current) {
    const u = o.unit_id ? unitById.get(o.unit_id) : undefined
    if (!u) continue
    withOwn.add(u.id)
    const g = groups.get(o.person_id) ?? { person_id: o.person_id, name: name.get(o.person_id) ?? 'Pessoa', units: [] }
    g.units.push({ id: u.id, code: u.code, share_pct: o.share_pct })
    groups.set(o.person_id, g)
  }
  const perUnit = [...groups.values()]
    .map((g) => ({ ...g, units: g.units.sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true })) }))
    .sort((a, b) => b.units.length - a.units.length || a.name.localeCompare(b.name, 'pt-BR'))
  return { whole, perUnit, unitsWithOwnOwners: withOwn.size, unitsVisible: units.length }
}

/**
 * Troca os donos do imóvel inteiro (as fatias precisam somar 100).
 * Nada é apagado: a fatia que muda ou sai ganha "até ontem" e a nova começa hoje. Assim o
 * repasse de um mês antigo continua sabendo quem era dono naquele mês.
 */
export async function setPropertyOwners(s: Session, input: OwnersEditInput): Promise<PropertyOwner[]> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const data = parseOrRule(ownersEditSchema, input)
  const p = db.properties.find((x) => x.id === data.property_id)
  if (!p || !see.property(sc, p)) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  checkOwnerPeople(db, s, data.owners)
  const current = db.property_owners.filter((o) => o.property_id === p.id && !o.unit_id && o.organization_id === s.org.id && ownerCurrent(o, s.today))
  const now = nowIso()
  const yesterday = addDays(s.today, -1)
  const nextByPerson = new Map(data.owners.map((o) => [o.person_id, o.share_pct]))
  // Mantém quem continua com a MESMA fatia; fecha o resto.
  const kept = current.filter((o) => nextByPerson.get(o.person_id) === o.share_pct)
  const closed = current.filter((o) => !kept.includes(o)).map((o) => ({ ...o, until: yesterday, updated_at: now }))
  const keptIds = new Set(kept.map((o) => o.person_id))
  const opened: PropertyOwner[] = data.owners
    .filter((o) => !keptIds.has(o.person_id))
    .map((o) => ({ ...baseRow(s, now), property_id: p.id, unit_id: null, person_id: o.person_id, share_pct: o.share_pct, since: s.today, until: null }))
  if (!closed.length && !opened.length) return kept
  upsertRows('property_owners', [...closed, ...opened])
  const name = new Map(db.people.map((x) => [x.id, x.name]))
  const describe = (list: { person_id: Id; share_pct: number }[]) => list.map((o) => `${name.get(o.person_id) ?? 'Pessoa'} ${o.share_pct}%`).join(', ') || 'nenhum'
  audit(s, 'properties', p.id, 'update', `Mudou os proprietários de "${p.name}"`, { owners: { from: describe(current), to: describe(data.owners) } })
  return [...kept, ...opened]
}

/* ---------------------------------------------------------------- documentos do imóvel e da unidade */

export interface PlaceDocumentRow extends DocumentFile {
  linkKind: LinkKind
  linkLabel: string
  linkHref: string
  visibilityKey: 'internal' | 'owner' | 'lessee' | 'both'
}

export type PlaceTarget = { propertyId: Id } | { unitId: Id }

/** As unidades, contratos, vistorias e chamados que "penduram" no imóvel ou na unidade. */
function placeIds(db: Db, sc: Scope, target: PlaceTarget) {
  const unitIds = new Set(
    'unitId' in target ? [target.unitId] : db.units.filter((u) => u.property_id === target.propertyId && u.organization_id === sc.orgId).map((u) => u.id),
  )
  const contractIds = new Set(db.contracts.filter((k) => (k.unit_id && unitIds.has(k.unit_id)) || ('propertyId' in target && k.property_id === target.propertyId)).map((k) => k.id))
  const inspectionIds = new Set(db.inspections.filter((i) => unitIds.has(i.unit_id)).map((i) => i.id))
  // Chamado de área comum (sem unidade) pertence ao imóvel inteiro.
  const maintenanceIds = new Set(db.maintenance_requests.filter((r) => (r.unit_id ? unitIds.has(r.unit_id) : 'propertyId' in target && r.property_id === target.propertyId)).map((r) => r.id))
  return { unitIds, contractIds, inspectionIds, maintenanceIds }
}

/**
 * Documentos do imóvel e das unidades dele (inclui contrato, vistoria e orçamento de chamado
 * dessas unidades). Cada linha passa por see.document: o proprietário vê só o que foi marcado
 * para ele; a matrícula (interna) fica só para a equipe.
 */
export async function listPlaceDocuments(s: Session, target: PlaceTarget, params: ListParams): Promise<ListResult<PlaceDocumentRow>> {
  const { db, sc } = await connect(s)
  const ok = 'unitId' in target ? db.units.some((u) => u.id === target.unitId && see.unit(sc, u)) : db.properties.some((p) => p.id === target.propertyId && see.property(sc, p))
  if (!ok) throw new AccessError('Registro não encontrado ou fora do seu acesso.')
  const ids = placeIds(db, sc, target)
  const unitCode = new Map(db.units.map((u) => [u.id, u.code]))
  const contractCode = new Map(db.contracts.map((k) => [k.id, k.code]))
  const inspectionUnit = new Map(db.inspections.map((i) => [i.id, i.unit_id]))
  const requestCode = new Map(db.maintenance_requests.map((r) => [r.id, r.code]))
  const propertyName = new Map(db.properties.map((p) => [p.id, p.name]))
  const rows: PlaceDocumentRow[] = db.documents
    .filter((d) => see.document(sc, d))
    .filter(
      (d) =>
        ('propertyId' in target && d.property_id === target.propertyId) || (!!d.unit_id && ids.unitIds.has(d.unit_id)) ||
        (!!d.contract_id && ids.contractIds.has(d.contract_id)) || (!!d.inspection_id && ids.inspectionIds.has(d.inspection_id)) ||
        (!!d.maintenance_id && ids.maintenanceIds.has(d.maintenance_id)),
    )
    .map((d) => {
      // Mesma ordem de prioridade do módulo Documentos: o vínculo mais específico ganha.
      // O rótulo NÃO repete o tipo (a tela já escreve "Vistoria" antes do código).
      const link: Pick<PlaceDocumentRow, 'linkKind' | 'linkLabel' | 'linkHref'> = d.contract_id
        ? { linkKind: 'contract', linkLabel: contractCode.get(d.contract_id) ?? 'Contrato', linkHref: `/contratos/${d.contract_id}` }
        : d.inspection_id
          ? { linkKind: 'inspection', linkLabel: unitCode.get(inspectionUnit.get(d.inspection_id) ?? '') ?? '', linkHref: `/vistorias/${d.inspection_id}` }
          : d.maintenance_id
            ? { linkKind: 'maintenance', linkLabel: requestCode.get(d.maintenance_id) ?? 'Chamado', linkHref: `/manutencao/${d.maintenance_id}` }
            : d.unit_id
              ? { linkKind: 'unit', linkLabel: unitCode.get(d.unit_id) ?? 'Unidade', linkHref: `/unidades/${d.unit_id}` }
              : { linkKind: 'property', linkLabel: propertyName.get(d.property_id ?? '') ?? 'Imóvel', linkHref: `/imoveis/${d.property_id}` }
      const visibilityKey: PlaceDocumentRow['visibilityKey'] = d.visible_to_owner && d.visible_to_lessee ? 'both' : d.visible_to_owner ? 'owner' : d.visible_to_lessee ? 'lessee' : 'internal'
      return { ...d, ...link, visibilityKey }
    })
  return runList(rows, params, {
    search: (r) => [r.name, r.linkLabel],
    filters: { vinculo: (r) => r.linkKind },
    sorts: { name: (r) => r.name, created_at: (r) => r.created_at },
    defaultSort: (a, b) => (a.created_at < b.created_at ? 1 : -1),
  })
}

/* ---------------------------------------------------------------- contagens das abas e histórico */

export interface PlaceCounts {
  contracts: number
  entries: number
  maintenance: number
  documents: number
}

/** Documentos visíveis do imóvel ou da unidade e do que pendura neles (contagem das abas e painel do imóvel). */
export function documentsOfPlace(db: Db, sc: Scope, target: PlaceTarget): DocumentFile[] {
  const ids = placeIds(db, sc, target)
  return db.documents.filter(
    (d) =>
      see.document(sc, d) &&
      (('propertyId' in target && d.property_id === target.propertyId) || (!!d.unit_id && ids.unitIds.has(d.unit_id)) || (!!d.contract_id && ids.contractIds.has(d.contract_id)) ||
        (!!d.inspection_id && ids.inspectionIds.has(d.inspection_id)) || (!!d.maintenance_id && ids.maintenanceIds.has(d.maintenance_id))),
  )
}

/** Quantos registros cada aba tem (só o que a sessão enxerga), para o número ao lado do nome da aba. */
export async function placeCounts(s: Session, target: PlaceTarget): Promise<PlaceCounts> {
  const { db, sc } = await connect(s)
  const ids = placeIds(db, sc, target)
  const docs = documentsOfPlace(db, sc, target)
  return {
    contracts: db.contracts.filter((k) => !!k.unit_id && ids.unitIds.has(k.unit_id) && see.contract(sc, k)).length,
    entries: db.financial_entries.filter((e) => !!e.unit_id && ids.unitIds.has(e.unit_id) && see.entry(sc, e)).length,
    maintenance: db.maintenance_requests.filter((r) => ids.maintenanceIds.has(r.id) && see.maintenance(sc, r)).length,
    documents: docs.length,
  }
}

/** Histórico da unidade: ela, os contratos, os chamados e as baixas de pagamento dela. Só a equipe. */
export async function unitHistory(s: Session, id: Id): Promise<HistoryEntry[]> {
  const { db, sc } = await connect(s)
  if (!sc.all) throw new AccessError('O histórico é visto pela equipe da conta.')
  const u = db.units.find((x) => x.id === id)
  if (!u || !see.unit(sc, u)) throw new AccessError('Unidade não encontrada ou fora do seu acesso.')
  const ids = placeIds(db, sc, { unitId: id })
  const entryIds = db.financial_entries.filter((e) => e.unit_id === id).map((e) => e.id)
  return buildHistory(
    db, s.org.id,
    [{ entity: 'units', ids: [id] }, { entity: 'contracts', ids: ids.contractIds }, { entity: 'maintenance_requests', ids: ids.maintenanceIds }, { entity: 'financial_entries', ids: entryIds }],
    { entity: 'units', id, at: u.created_at, by: u.created_by, summary: `Cadastro da unidade ${u.code}` },
  )
}
