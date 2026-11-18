/* =============================================================================
   scope.ts: o ESPELHO DA RLS. Decide, linha por linha, o que cada sessão enxerga.

   Hoje roda no navegador sobre os dados fictícios; na fase 2 estas mesmas regras viram
   políticas de RLS no Postgres (uma função por recurso: can_see_unit, can_see_contract...).
   Por isso a lógica fica aqui, num lugar só, e todo repositório passa por ela.

   Regras (seção F do plano):
   - admin e colaborador: tudo da PRÓPRIA organização, nada de outra;
   - proprietário: as unidades de que é dono (da unidade ou do imóvel inteiro) e o que pendura nelas;
   - inquilino: os contratos em que é locatário e o que pendura neles;
   - prestador: os chamados atribuídos a ele.
   ============================================================================= */
import type { Session } from '@/auth/session'
import type { Db } from './db'
import type { Announcement, Contract, DocumentFile, FinancialEntry, Id, MaintenanceRequest, Person, PropertyStaff } from './types'

export interface Scope {
  orgId: Id
  /** true = admin ou colaborador: vê tudo da organização. */
  all: boolean
  role: 'team' | 'owner' | 'lessee' | 'vendor'
  personId: Id | null
  unitIds: Set<Id>
  propertyIds: Set<Id>
  contractIds: Set<Id>
  maintenanceIds: Set<Id>
  inspectionIds: Set<Id>
  personIds: Set<Id>
}

export function scopeFor(db: Db, s: Session): Scope {
  const orgId = s.org.id
  const team = s.roles.includes('admin') || s.roles.includes('staff')
  const sc: Scope = {
    orgId, all: team, role: team ? 'team' : s.roles.includes('owner') ? 'owner' : s.roles.includes('lessee') ? 'lessee' : 'vendor',
    personId: s.personId, unitIds: new Set(), propertyIds: new Set(), contractIds: new Set(), maintenanceIds: new Set(), inspectionIds: new Set(), personIds: new Set(),
  }
  if (team || !s.personId) return sc
  const me = s.personId
  const inOrg = <T extends { organization_id: Id }>(rows: T[]) => rows.filter((r) => r.organization_id === orgId)

  if (s.roles.includes('owner')) {
    for (const o of inOrg(db.property_owners)) {
      if (o.person_id !== me || (o.until && o.until < s.today)) continue
      if (o.unit_id) sc.unitIds.add(o.unit_id)
      else inOrg(db.units).filter((u) => u.property_id === o.property_id).forEach((u) => sc.unitIds.add(u.id))
    }
    for (const k of inOrg(db.contracts)) {
      const mine = (k.unit_id && sc.unitIds.has(k.unit_id)) || db.contract_parties.some((p) => p.contract_id === k.id && p.person_id === me)
      if (mine) sc.contractIds.add(k.id)
    }
  }
  if (s.roles.includes('lessee')) {
    for (const p of db.contract_parties) {
      if (p.organization_id !== orgId || p.person_id !== me || p.role !== 'lessee') continue
      sc.contractIds.add(p.contract_id)
      const k = db.contracts.find((x) => x.id === p.contract_id)
      if (k?.unit_id) sc.unitIds.add(k.unit_id)
    }
  }
  // Chamado de ÁREA COMUM (sem unidade): o dono de qualquer unidade do imóvel vê (ele divide o custo);
  // o inquilino não (para avisar inquilino existe o comunicado); o prestador vê se for dele.
  const ownedPropertyIds = new Set(inOrg(db.units).filter((u) => sc.unitIds.has(u.id)).map((u) => u.property_id))
  for (const r of inOrg(db.maintenance_requests)) {
    const vendorMine = s.roles.includes('vendor') && r.vendor_person_id === me
    const ownerMine = s.roles.includes('owner') && (r.unit_id ? sc.unitIds.has(r.unit_id) : ownedPropertyIds.has(r.property_id))
    const lesseeMine = s.roles.includes('lessee') && (r.requester_person_id === me || (!!r.unit_id && sc.unitIds.has(r.unit_id)))
    if (vendorMine || ownerMine || lesseeMine) sc.maintenanceIds.add(r.id)
    if (vendorMine && r.unit_id) sc.unitIds.add(r.unit_id) // o prestador vê a unidade do chamado (só o endereço na tela)
    if (vendorMine && !r.unit_id) sc.propertyIds.add(r.property_id) // área comum: o endereço do imóvel
  }
  for (const u of inOrg(db.units)) if (sc.unitIds.has(u.id)) sc.propertyIds.add(u.property_id)
  for (const i of inOrg(db.inspections)) if (sc.unitIds.has(i.unit_id) && s.roles.some((r) => r === 'owner' || r === 'lessee')) sc.inspectionIds.add(i.id)
  // Pessoas visíveis: a própria e as partes dos contratos visíveis (na fase 2, por uma view que expõe só nome).
  sc.personIds.add(me)
  for (const p of db.contract_parties) if (sc.contractIds.has(p.contract_id)) sc.personIds.add(p.person_id)
  return sc
}

/* ---------------------------------------------------------------- uma regra por tabela */
type WithOrg = { organization_id: Id }
const sameOrg = (sc: Scope, r: WithOrg) => r.organization_id === sc.orgId

export const see = {
  /** Equipe do imóvel (zelador, porteiro, síndico): a equipe da conta vê tudo; dono e inquilino veem a do próprio imóvel. */
  staff: (sc: Scope, r: PropertyStaff) => sameOrg(sc, r) && (sc.all || ((sc.role === 'owner' || sc.role === 'lessee') && sc.propertyIds.has(r.property_id))),
  /** Comunicado: a equipe vê todos; inquilino e dono só os enviados ao público dele, do imóvel dele (ou de todos os imóveis). */
  announcement: (sc: Scope, a: Announcement) => {
    if (!sameOrg(sc, a)) return false
    if (sc.all) return true
    if (!a.sent_at) return false
    const audience = sc.role === 'lessee' ? ['lessees', 'everyone'] : sc.role === 'owner' ? ['owners', 'everyone'] : []
    return audience.includes(a.audience) && (a.property_id === null || sc.propertyIds.has(a.property_id))
  },
  property: (sc: Scope, r: WithOrg & { id: Id }) => sameOrg(sc, r) && (sc.all || sc.propertyIds.has(r.id)),
  unit: (sc: Scope, r: WithOrg & { id: Id }) => sameOrg(sc, r) && (sc.all || sc.unitIds.has(r.id)),
  contract: (sc: Scope, r: Contract) => sameOrg(sc, r) && (sc.all || sc.contractIds.has(r.id)),
  person: (sc: Scope, r: Person) => sameOrg(sc, r) && (sc.all || sc.personIds.has(r.id)),
  maintenance: (sc: Scope, r: MaintenanceRequest) => sameOrg(sc, r) && (sc.all || sc.maintenanceIds.has(r.id)),
  entry: (sc: Scope, e: FinancialEntry) => {
    if (!sameOrg(sc, e)) return false
    if (sc.all) return true
    if (sc.role === 'owner') {
      const onMyUnit = !!e.unit_id && sc.unitIds.has(e.unit_id) && ((e.direction === 'receivable' && e.category === 'rent') || e.charged_to === 'owner')
      const toMe = e.person_id === sc.personId && (e.category === 'transfer' || e.category === 'admin_fee')
      return onMyUnit || toMe
    }
    if (sc.role === 'lessee') return e.direction === 'receivable' && e.person_id === sc.personId
    return false // prestador não vê financeiro (matriz F)
  },
  document: (sc: Scope, d: DocumentFile) => {
    if (!sameOrg(sc, d) || d.deleted_at) return false
    if (sc.all) return true
    const linked =
      (d.contract_id && sc.contractIds.has(d.contract_id)) || (d.unit_id && sc.unitIds.has(d.unit_id)) ||
      (d.property_id && sc.propertyIds.has(d.property_id)) || (d.maintenance_id && sc.maintenanceIds.has(d.maintenance_id)) ||
      (d.inspection_id && sc.inspectionIds.has(d.inspection_id)) || d.person_id === sc.personId
    if (sc.role === 'owner') return d.visible_to_owner && !!linked
    if (sc.role === 'lessee') return d.visible_to_lessee && !!linked
    // Prestador (matriz F): vê os anexos do chamado ATRIBUÍDO a ele (fotos, orçamento), nada além.
    if (sc.role === 'vendor') return !!d.maintenance_id && sc.maintenanceIds.has(d.maintenance_id)
    return false
  },
}
