/* =============================================================================
   vagas.ts: as vagas de garagem como as tabelas mostram ("de quem é aquela vaga").

   Pedido do Fernando (06/11/2026): "mapear as vagas de garagem e mostrar nas tabelas de quem é
   quem aquela vaga e unidades". Vaga é unidade do tipo "parking" (seed/exemplos.ts): contrato,
   cobrança e situação vêm do mesmo lugar das outras unidades (toUnitRows). Aqui só se junta, vaga
   por vaga:
     1. onde ela fica: a área de fora dos blocos (zone, "Estacionamento externo") ou o andar da
        garagem ("1º subsolo");
     2. quem aluga hoje (o locatário da locação vigente), a mensalidade e o fim do contrato;
     3. "Mora/aluga aqui": o código da casa, apartamento ou sala que ESSA pessoa aluga ou de que é
        dona no MESMO imóvel. Vazio = alguém de fora. A vaga não é atrelada a apartamento ("é
        administrada à parte"): o vínculo é da pessoa, e é ele que a coluna mostra.

   ESCOPO (espelho da RLS): tudo sai de toUnitRows, que já passa por see.unit. A coluna "Mora/aluga
   aqui" só olha as unidades que a sessão enxerga: a inquilina vê o código do próprio apartamento,
   nunca o de outra pessoa. A lista "de uma pessoa" confere antes se a sessão enxerga a pessoa.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { AccessError, connect } from '@/data/api'
import { runList, type ListConfig, type ListParams, type ListResult } from '@/data/query'
import type { Db } from '@/data/db'
import { see, type Scope } from '@/data/scope'
import type { Cents, Id, IsoDate, UnitStatus } from '@/data/types'
import { isSpot, toUnitRows, type UnitRow } from '@/data/views/units'
import type { MapPin } from '@/modules/mapa/repo'

/** Quem aluga a vaga em relação ao imóvel: morador (aluga ou é dono de unidade ali), de fora, ou ninguém. */
export type RenterKind = 'morador' | 'de_fora' | 'sem'

export const RENTER_KIND: Record<RenterKind, string> = { morador: 'Mora ou aluga no imóvel', de_fora: 'De fora', sem: 'Sem locatário' }

export interface SpotRow {
  id: Id
  code: string
  property_id: Id
  property_name: string
  district: string
  /** Onde fica: o nome da área de fora ("Estacionamento externo") ou o andar da garagem ("1º subsolo"). */
  place: string
  /** Andar da garagem (-1, -2); null na área de fora. Serve à ordem: 1º subsolo antes do 2º. */
  floor_level: number | null
  status: UnitStatus
  /** Pedido do anúncio, para a vaga sem locação vigente. */
  asking_rent_cents: Cents | null
  /** Locação vigente hoje (null = vaga sem locatário). */
  lease: { id: Id; code: string; rent_cents: Cents; end_date: IsoDate } | null
  renter_id: Id | null
  renter_name: string
  /** Códigos das unidades que o locatário aluga ou de que é dono no MESMO imóvel ([] = de fora). */
  resident_codes: string[]
  renter_kind: RenterKind
}

/** Junta os códigos do jeito que cabe numa célula: "A-301, B-203 e mais 2". */
export function residentLabel(codes: string[], max = 2): string {
  if (codes.length <= max) return codes.join(', ')
  return `${codes.slice(0, max).join(', ')} e mais ${codes.length - max}`
}

/**
 * "Mora/aluga aqui", a regra (pura, testada em vagas.test.ts). Para cada "imóvel:pessoa", os códigos
 * das casas, apartamentos e salas daquele imóvel que a pessoa ALUGA hoje (locação vigente) e, depois,
 * os de que é DONA hoje. Recebe as linhas já filtradas pelo escopo: o que a sessão não vê não entra.
 * Passo a passo:
 *   1. só unidade que não é vaga e não está arquivada (a vaga não é moradia);
 *   2. o locatário da locação vigente ganha o código (é quem "mora/aluga");
 *   3. cada dono atual ganha o código também (dono de apartamento que aluga vaga é morador do condomínio);
 *   4. sem repetir: quem aluga e é dono da mesma unidade aparece uma vez, os aluguéis primeiro.
 */
export function homesByPerson(units: Pick<UnitRow, 'code' | 'kind' | 'property_id' | 'deleted_at' | 'lease' | 'owners'>[]): Map<string, string[]> {
  const leased = new Map<string, string[]>()
  const owned = new Map<string, string[]>()
  const push = (m: Map<string, string[]>, key: string, code: string) => m.set(key, [...(m.get(key) ?? []), code])
  for (const u of units) {
    if (isSpot(u) || u.deleted_at) continue
    if (u.lease?.lessee_id) push(leased, `${u.property_id}:${u.lease.lessee_id}`, u.code)
    for (const o of u.owners) push(owned, `${u.property_id}:${o.person_id}`, u.code)
  }
  const byCode = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true })
  const out = new Map<string, string[]>()
  for (const key of new Set([...leased.keys(), ...owned.keys()])) {
    const first = [...(leased.get(key) ?? [])].sort(byCode)
    const then = [...(owned.get(key) ?? [])].filter((c) => !first.includes(c)).sort(byCode)
    out.set(key, [...first, ...then])
  }
  return out
}

/** As vagas que a sessão enxerga, já com o lugar, o locatário e o "Mora/aluga aqui". */
function spotRows(units: UnitRow[]): SpotRow[] {
  const homes = homesByPerson(units)
  return units
    .filter((u) => isSpot(u) && !u.deleted_at)
    .map((u) => {
      const renter = u.lease?.lessee_id ?? null
      const resident = renter ? (homes.get(`${u.property_id}:${renter}`) ?? []) : []
      return {
        id: u.id, code: u.code, property_id: u.property_id, property_name: u.property_name, district: u.district,
        place: u.zone ?? u.floor_label ?? '', floor_level: u.floor_level, status: u.status, asking_rent_cents: u.asking_rent_cents,
        lease: u.lease ? { id: u.lease.id, code: u.lease.code, rent_cents: u.lease.rent_cents, end_date: u.lease.end_date } : null,
        renter_id: renter, renter_name: u.lease?.lessee_name ?? '', resident_codes: resident,
        renter_kind: !renter ? 'sem' : resident.length ? 'morador' : 'de_fora',
      }
    })
}

/** De quem são as vagas pedidas: de um imóvel (ficha do imóvel), das que uma pessoa aluga (ficha da pessoa) ou todas. */
export interface SpotScope {
  propertyId?: Id
  personId?: Id
}

/**
 * Busca, filtros e ordens da tabela de vagas. Uma constante porque a tabela e os pinos do mapa
 * passam pela MESMA regra (o mapa nunca mostra vaga que a tabela, com os mesmos filtros, não mostraria).
 * Filtros: status, property, place (área ou andar), renter (morador, de fora, sem), district.
 */
const SPOT_LIST: ListConfig<SpotRow> = {
  search: (r) => [r.code, r.property_name, r.place, r.renter_name, ...r.resident_codes, r.lease?.code],
  filters: { status: (r) => r.status, property: (r) => r.property_id, place: (r) => r.place, renter: (r) => r.renter_kind, district: (r) => r.district },
  sorts: {
    code: (r) => r.code, property: (r) => r.property_name, place: (r) => r.place, status: (r) => r.status, renter: (r) => r.renter_name || null,
    resident: (r) => r.resident_codes[0] ?? null, rent: (r) => r.lease?.rent_cents ?? r.asking_rent_cents, end_date: (r) => r.lease?.end_date ?? null,
  },
  // Imóvel, depois o lugar (área de fora antes da garagem; 1º subsolo antes do 2º), depois o código.
  defaultSort: (a, b) =>
    a.property_name.localeCompare(b.property_name, 'pt-BR') ||
    (b.floor_level ?? 1) - (a.floor_level ?? 1) ||
    a.place.localeCompare(b.place, 'pt-BR') ||
    a.code.localeCompare(b.code, 'pt-BR', { numeric: true }),
}

/** As vagas do recorte pedido, pelo escopo. "De uma pessoa" = as que ela aluga hoje. */
function spotsIn(db: Db, sc: Scope, today: IsoDate, where: SpotScope): SpotRow[] {
  if (where.personId) {
    const p = db.people.find((x) => x.id === where.personId)
    if (!p || !see.person(sc, p)) throw new AccessError('Pessoa não encontrada ou fora do seu acesso.')
  }
  return spotRows(toUnitRows(db, sc, today)).filter(
    (r) => (!where.propertyId || r.property_id === where.propertyId) && (!where.personId || r.renter_id === where.personId),
  )
}

export async function listSpots(s: Session, params: ListParams, where: SpotScope = {}): Promise<ListResult<SpotRow>> {
  const { db, sc } = await connect(s)
  return runList(spotsIn(db, sc, s.today, where), params, SPOT_LIST)
}

/**
 * Pinos do mapa da categoria Vagas (página Imóveis): um pino por imóvel que tem vaga no resultado
 * da MESMA busca e dos MESMOS filtros da tabela. Os números do pino são das VAGAS do imóvel (total,
 * alugadas, ocupação das vagas), nunca das unidades: o mapa não mistura as duas contas.
 * Passo a passo:
 *   1. o resultado inteiro da lista (sem página), contando quantas vagas de cada imóvel passaram;
 *   2. todas as vagas visíveis de cada um desses imóveis, para o total e a ocupação do pino.
 */
export async function listSpotPins(s: Session, params: Pick<ListParams, 'search' | 'filters'>): Promise<MapPin[]> {
  const { db, sc } = await connect(s)
  const all = spotsIn(db, sc, s.today, {})
  const result = runList(all, { search: params.search, filters: params.filters, page: 1, pageSize: Number.MAX_SAFE_INTEGER }, SPOT_LIST)
  const matched = new Map<Id, number>()
  for (const r of result.rows) matched.set(r.property_id, (matched.get(r.property_id) ?? 0) + 1)
  return [...matched.entries()].flatMap(([propertyId, n]) => {
    const p = db.properties.find((x) => x.id === propertyId)
    if (!p) return []
    const spots = all.filter((r) => r.property_id === propertyId)
    const rented = spots.filter((r) => r.status === 'occupied').length
    const rentable = spots.filter((r) => r.status !== 'blocked').length
    return [{
      id: p.id, name: p.name, district: p.address.district, lat: p.lat, lng: p.lng,
      units_total: spots.length, units_occupied: rented, units_rentable: rentable,
      occupancy_pct: rentable ? Math.round((rented / rentable) * 1000) / 10 : 0, matched: n,
      noun: ['vaga', 'vagas'], // a dica do pino diz "vagas" e "alugado", não "unidades" e "ocupado"
    }]
  })
}
