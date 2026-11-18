/* =============================================================================
   lookup.ts: índices (id -> linha) e nomes legíveis, montados uma vez por consulta.
   Sem índice, cada linha da tabela procuraria o nome do dono numa lista inteira
   (milhares de voltas); com Map, é uma consulta direta.
   ============================================================================= */
import type { Db } from '../db'
import type { Contract, ContractParty, Id, Person, Property, PropertyOwner, Unit } from '../types'

export interface Lookup {
  unit: Map<Id, Unit>
  property: Map<Id, Property>
  person: Map<Id, Person>
  contract: Map<Id, Contract>
  userName: Map<Id, string>
  buildingName: Map<Id, string>
  floor: Map<Id, { label: string; level: number }>
  portfolioName: Map<Id, string>
  partiesByContract: Map<Id, ContractParty[]>
  ownersByUnit: Map<Id, PropertyOwner[]>
  ownersByProperty: Map<Id, PropertyOwner[]>
}

function group<T>(rows: T[], key: (r: T) => Id | null): Map<Id, T[]> {
  const m = new Map<Id, T[]>()
  for (const r of rows) {
    const k = key(r)
    if (!k) continue
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

export function lookup(db: Db): Lookup {
  return {
    unit: new Map(db.units.map((u) => [u.id, u])),
    property: new Map(db.properties.map((p) => [p.id, p])),
    person: new Map(db.people.map((p) => [p.id, p])),
    contract: new Map(db.contracts.map((k) => [k.id, k])),
    userName: new Map(db.profiles.map((p) => [p.id, p.full_name])),
    buildingName: new Map(db.buildings.map((b) => [b.id, b.name])),
    floor: new Map(db.floors.map((f) => [f.id, { label: f.label, level: f.level }])),
    portfolioName: new Map(db.portfolios.map((p) => [p.id, p.name])),
    partiesByContract: group(db.contract_parties, (p) => p.contract_id),
    ownersByUnit: group(db.property_owners.filter((o) => o.unit_id), (o) => o.unit_id),
    ownersByProperty: group(db.property_owners.filter((o) => !o.unit_id), (o) => o.property_id),
  }
}

/** Donos vigentes da unidade: os da própria unidade ou, se não houver, os do imóvel inteiro. */
export function ownersOf(L: Lookup, u: Unit, today: string): { person_id: Id; name: string; share_pct: number }[] {
  const rows = L.ownersByUnit.get(u.id) ?? L.ownersByProperty.get(u.property_id) ?? []
  return rows
    .filter((o) => !o.until || o.until >= today)
    .map((o) => ({ person_id: o.person_id, name: L.person.get(o.person_id)?.name ?? 'Pessoa', share_pct: o.share_pct }))
}

/** Locatário principal do contrato. */
export function lesseeOf(L: Lookup, contractId: Id): Person | null {
  const p = L.partiesByContract.get(contractId)?.find((x) => x.role === 'lessee')
  return p ? (L.person.get(p.person_id) ?? null) : null
}

/**
 * "Condomínio Mount Juic · A-301" (casa avulsa: só o nome do imóvel). A vaga do estacionamento externo
 * também não tem bloco, mas tem área (zone): leva o código, senão "Condomínio Mount Juic" sozinho não diria qual vaga.
 */
export function unitLabel(L: Lookup, u: Unit): string {
  const p = L.property.get(u.property_id)
  return u.building_id || u.zone ? `${p?.name ?? ''} · ${u.code}` : (p?.name ?? u.code)
}

/** Junta nomes com "e": "Ana, Bruno e Clara". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}
