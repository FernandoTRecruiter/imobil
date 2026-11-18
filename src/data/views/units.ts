/* =============================================================================
   views/units.ts: unidades e imóveis como as telas mostram (com dono, inquilino, situação).
   Na fase 2 vira uma VIEW do Postgres com security_invoker = true (senão a view ignora a RLS).
   Usada por: Imóveis, Mapa, Contratos (escolher unidade), Visão geral, Dados, Portal.

   Vaga de garagem (06/11/2026) é unidade do tipo "parking": aparece em toUnitRows como qualquer
   unidade (tem ficha, contrato e cobrança), mas NÃO entra nas contas de unidade do imóvel
   (unidades, ocupadas, disponíveis, ocupação). Misturar 60 vagas com 120 apartamentos faria a
   ocupação do condomínio dizer outra coisa. As vagas têm contagem própria (spots_*).
   ============================================================================= */
import type { Session } from '@/auth/session'
import { AccessError, connect } from '../api'
import type { Db } from '../db'
import { runList, type ListParams, type ListResult } from '../query'
import { effectiveUnitStatus, leaseCovers, occupiedUnitIds } from '../rules'
import { see, type Scope } from '../scope'
import type { Address, Cents, Id, IsoDate, ManualUnitStatus, Property, PropertyKind, UnitKind, UnitStatus } from '../types'
import { canSeeHousehold, contractTerm, lesseeSinceMap } from './cliente'
import { lesseeOf, lookup, ownersOf, unitLabel, type Lookup } from './lookup'

export interface UnitRow {
  id: Id
  code: string
  label: string
  kind: UnitKind
  area_m2: number
  bedrooms: number
  bathrooms: number
  parking_spots: number
  features: string[]
  notes: string
  manual_status: ManualUnitStatus
  status: UnitStatus
  asking_rent_cents: Cents | null
  property_id: Id
  property_name: string
  property_kind: PropertyKind
  building_id: Id | null
  building_name: string | null
  floor_id: Id | null
  floor_label: string | null
  floor_level: number | null
  position: number | null
  /** Área de fora dos blocos (vaga do estacionamento externo); null dentro de um bloco. */
  zone: string | null
  district: string
  city: string
  portfolio_id: Id | null
  owners: { person_id: Id; name: string; share_pct: number }[]
  owners_label: string
  /** Locação vigente hoje (null = sem inquilino). */
  lease: { id: Id; code: string; start_date: IsoDate; end_date: IsoDate; rent_cents: Cents; lessee_id: Id | null; lessee_name: string } | null
  /*
   * O locatário de hoje (07/11/2026, colunas opcionais e o Comparar). Vazios sem locação vigente.
   * Dependentes e animais são dado da PESSOA: no portal saem vazios quando não são do próprio
   * locatário (o dono da unidade não vê a família do inquilino; views/cliente.ts, canSeeHousehold).
   */
  /** Início da primeira locação deste locatário nesta unidade (a renovação não zera). */
  lessee_since: IsoDate | null
  /** Tempo da locação vigente em meses: quanto passou e a duração. */
  lease_elapsed_months: number | null
  lease_duration_months: number | null
  lessee_dependents: number | null
  lessee_pets: string | null
  import_batch_id: Id | null
  deleted_at: string | null
}

export function toUnitRows(db: Db, sc: Scope, today: IsoDate, L: Lookup = lookup(db)): UnitRow[] {
  const occupied = occupiedUnitIds(db, today)
  const leaseByUnit = new Map(db.contracts.filter((k) => leaseCovers(k, today) && k.unit_id).map((k) => [k.unit_id!, k]))
  const lesseeSince = lesseeSinceMap(db, today)
  return db.units
    .filter((u) => see.unit(sc, u))
    .map((u) => {
      const p = L.property.get(u.property_id)!
      const owners = ownersOf(L, u, today)
      const k = leaseByUnit.get(u.id)
      const lessee = k ? lesseeOf(L, k.id) : null
      const floor = u.floor_id ? L.floor.get(u.floor_id) : undefined
      const term = k ? contractTerm(k, today) : null
      const person = lessee ? L.person.get(lessee.id) : undefined
      const household = !!person && canSeeHousehold(sc, person.id)
      return {
        id: u.id, code: u.code, label: unitLabel(L, u), kind: u.kind, area_m2: u.area_m2, bedrooms: u.bedrooms, bathrooms: u.bathrooms,
        parking_spots: u.parking_spots, features: u.features, notes: u.notes, manual_status: u.manual_status,
        status: effectiveUnitStatus(u, occupied), asking_rent_cents: u.asking_rent_cents,
        property_id: p.id, property_name: p.name, property_kind: p.kind,
        building_id: u.building_id, building_name: u.building_id ? (L.buildingName.get(u.building_id) ?? null) : null,
        floor_id: u.floor_id, floor_label: floor?.label ?? null, floor_level: floor?.level ?? null, position: u.position, zone: u.zone,
        district: p.address.district, city: p.address.city, portfolio_id: p.portfolio_id,
        owners, owners_label: owners.map((o) => (o.share_pct < 100 ? `${o.name} (${o.share_pct}%)` : o.name)).join(', '),
        lease: k ? { id: k.id, code: k.code, start_date: k.start_date, end_date: k.end_date, rent_cents: k.rent_cents, lessee_id: lessee?.id ?? null, lessee_name: lessee?.name ?? '' } : null,
        lessee_since: k && lessee ? (lesseeSince.get(`${u.id}:${lessee.id}`) ?? k.start_date) : null,
        lease_elapsed_months: term?.elapsed ?? null, lease_duration_months: term?.duration ?? null,
        lessee_dependents: household ? (person!.dependents ?? null) : null, lessee_pets: household ? person!.pets || null : null,
        import_batch_id: u.import_batch_id, deleted_at: u.deleted_at,
      }
    })
}

/** Vaga de garagem? (a regra de "não misturar vaga com moradia" mora nesta pergunta). */
export const isSpot = (u: { kind: UnitKind }) => u.kind === 'parking'

/**
 * Filtros: status, kind, property, portfolio, district, archived ('sim'/'nao'). Ordens: code, property, status, rent, area, end_date.
 * Recorte "spot" ('sim' = só vagas, 'nao' = sem vagas): NÃO é filtro da pessoa, é qual lista a tela
 * pede. Ele corta ANTES de contar, para o "N de M" e as contagens das opções falarem só do que a
 * lista mostra. Vem dentro de filters porque é o único canal que passa por quem repassa os
 * parâmetros da tabela (os pinos do mapa, listMapPins). Sem ele, a lista traz tudo (o contrato
 * precisa escolher vaga também).
 */
export async function listUnits(s: Session, params: ListParams): Promise<ListResult<UnitRow>> {
  const { db, sc } = await connect(s)
  // Passo 1: o recorte (só vagas, sem vagas ou tudo) sai dos filtros e corta as linhas antes de qualquer conta.
  const { spot, ...filters } = params.filters ?? {}
  const rows = toUnitRows(db, sc, s.today).filter((r) => !spot?.length || spot.includes(isSpot(r) ? 'sim' : 'nao'))
  // Passo 2: arquivada só aparece se pedir. O padrão "não arquivadas" vira um FILTRO aplicado aqui dentro (e não
  // um corte antes de contar): assim a opção "arquivadas" mostra quantas existem antes de ser ligada.
  const asked = (filters.archived ?? []).length > 0
  const effective = { ...params, filters: asked ? filters : { ...filters, archived: ['nao'] } }
  const result = runList(rows, effective, {
    search: (r) => [r.code, r.property_name, r.district, r.zone, r.owners_label, r.lease?.lessee_name, r.lease?.code],
    filters: {
      status: (r) => r.status, kind: (r) => r.kind, property: (r) => r.property_id, portfolio: (r) => r.portfolio_id,
      district: (r) => r.district, archived: (r) => (r.deleted_at ? 'sim' : 'nao'),
    },
    sorts: {
      code: (r) => r.code, property: (r) => r.property_name, status: (r) => r.status,
      rent: (r) => r.lease?.rent_cents ?? r.asking_rent_cents, area: (r) => r.area_m2, end_date: (r) => r.lease?.end_date ?? null,
    },
    defaultSort: (a, b) => a.property_name.localeCompare(b.property_name, 'pt-BR') || a.code.localeCompare(b.code, 'pt-BR', { numeric: true }),
  })
  // O "M" de "N de M" sem filtro nenhum continua sendo só as não arquivadas.
  if (!asked) result.totalAll = rows.filter((r) => !r.deleted_at).length
  return result
}

export async function getUnit(s: Session, id: Id): Promise<UnitRow> {
  const { db, sc } = await connect(s)
  const u = toUnitRows(db, sc, s.today).find((r) => r.id === id)
  if (!u) throw new AccessError('Unidade não encontrada ou fora do seu acesso.')
  return u
}

/* ---------------------------------------------------------------- imóveis */

export interface PropertyRow {
  id: Id
  name: string
  kind: PropertyKind
  address: Address
  lat: number | null
  lng: number | null
  portfolio_id: Id | null
  portfolio_name: string | null
  manager_user_id: Id | null
  manager_name: string | null
  notes: string
  /** Casas, apartamentos, salas e lojas (as vagas de garagem NÃO entram: ver spots_*). */
  units_total: number
  units_occupied: number
  units_available: number
  /** Ocupadas ÷ alugáveis, só das unidades acima (bloqueada não conta como alugável). */
  occupancy_pct: number
  /** Vagas de garagem do imóvel (não arquivadas) e quantas têm locação vigente hoje. */
  spots_total: number
  spots_rented: number
  /** Soma dos aluguéis vigentes hoje, das unidades E das vagas (é o dinheiro que o imóvel rende). */
  rent_roll_cents: Cents
  owners_label: string
  buildings_count: number
  import_batch_id: Id | null
  deleted_at: string | null
}

export function toPropertyRows(db: Db, sc: Scope, today: IsoDate): PropertyRow[] {
  const L = lookup(db)
  const units = toUnitRows(db, sc, today, L)
  const byProp = new Map<Id, UnitRow[]>()
  for (const u of units) if (!u.deleted_at) byProp.set(u.property_id, [...(byProp.get(u.property_id) ?? []), u])
  return db.properties
    .filter((p: Property) => see.property(sc, p))
    .map((p) => {
      const all = byProp.get(p.id) ?? []
      // As contas de unidade olham só para moradia e sala; a vaga tem contagem própria.
      const us = all.filter((u) => !isSpot(u))
      const spots = all.filter(isSpot)
      const rentable = us.filter((u) => u.status !== 'blocked').length
      const occ = us.filter((u) => u.status === 'occupied').length
      const owners = [...new Set(all.flatMap((u) => u.owners.map((o) => o.name)))]
      return {
        id: p.id, name: p.name, kind: p.kind, address: p.address, lat: p.lat, lng: p.lng, portfolio_id: p.portfolio_id,
        portfolio_name: p.portfolio_id ? (L.portfolioName.get(p.portfolio_id) ?? null) : null,
        manager_user_id: p.manager_user_id, manager_name: p.manager_user_id ? (L.userName.get(p.manager_user_id) ?? null) : null,
        notes: p.notes, units_total: us.length, units_occupied: occ, units_available: us.filter((u) => u.status === 'available').length,
        occupancy_pct: rentable ? Math.round((occ / rentable) * 1000) / 10 : 0,
        spots_total: spots.length, spots_rented: spots.filter((u) => u.status === 'occupied').length,
        rent_roll_cents: all.reduce((a, u) => a + (u.lease?.rent_cents ?? 0), 0),
        owners_label: owners.length > 2 ? `${owners.slice(0, 2).join(', ')} e mais ${owners.length - 2}` : owners.join(', '),
        buildings_count: db.buildings.filter((b) => b.property_id === p.id).length,
        import_batch_id: p.import_batch_id, deleted_at: p.deleted_at,
      }
    })
}

/** Filtros: kind, portfolio, district, manager. Ordens: name, units, occupancy, rent_roll. */
export async function listProperties(s: Session, params: ListParams): Promise<ListResult<PropertyRow>> {
  const { db, sc } = await connect(s)
  const rows = toPropertyRows(db, sc, s.today).filter((r) => !r.deleted_at)
  return runList(rows, params, {
    search: (r) => [r.name, r.address.street, r.address.district, r.owners_label],
    filters: { kind: (r) => r.kind, portfolio: (r) => r.portfolio_id, district: (r) => r.address.district, manager: (r) => r.manager_user_id },
    sorts: { name: (r) => r.name, units: (r) => r.units_total, occupancy: (r) => r.occupancy_pct, rent_roll: (r) => r.rent_roll_cents },
    defaultSort: (a, b) => b.units_total - a.units_total || a.name.localeCompare(b.name, 'pt-BR'),
  })
}

export interface PropertyStructure {
  property: PropertyRow
  buildings: { id: Id; name: string; site_x: number; site_y: number; floors: { id: Id; level: number; label: string; units: UnitRow[] }[] }[]
  /** Unidades sem bloco (casa avulsa, apartamento avulso). */
  looseUnits: UnitRow[]
}

/** Imóvel com blocos, andares (do mais alto para o mais baixo, como no espelho) e unidades. */
export async function getPropertyStructure(s: Session, id: Id): Promise<PropertyStructure> {
  const { db, sc } = await connect(s)
  const property = toPropertyRows(db, sc, s.today).find((p) => p.id === id)
  if (!property) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  const units = toUnitRows(db, sc, s.today).filter((u) => u.property_id === id && !u.deleted_at)
  const buildings = db.buildings
    .filter((b) => b.property_id === id && b.organization_id === s.org.id)
    .map((b) => ({
      id: b.id, name: b.name, site_x: b.site_x, site_y: b.site_y,
      floors: db.floors
        .filter((f) => f.building_id === b.id)
        .sort((x, y) => y.level - x.level)
        .map((f) => ({ id: f.id, level: f.level, label: f.label, units: units.filter((u) => u.floor_id === f.id).sort((x, y) => (x.position ?? 0) - (y.position ?? 0)) }))
        .filter((f) => f.units.length > 0 || sc.all),
    }))
    .filter((b) => b.floors.some((f) => f.units.length > 0))
  return { property, buildings, looseUnits: units.filter((u) => !u.building_id) }
}
