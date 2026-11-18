/* =============================================================================
   ficha.ts: as ROTINAS DE MANUTENÇÃO de um imóvel, para a ficha dele (/imoveis/<id>).

   Era a leitura do antigo painel do imóvel ao lado do 3D (situação das unidades, vencido,
   comunicados, documentos). O painel saiu em 06/11/2026 ("uma ficha por coisa") e o resto já
   aparece nas abas da ficha; aqui ficou só a lista de rotinas, que a ficha lê por getPropertySheet.

   ESCOPO: o imóvel passa pela mesma visão da lista (toPropertyRows, com see.property). As rotinas
   (maintenance_schedules) não têm regra no scope.ts; a regra fica escrita aqui, igual à da equipe
   do prédio: a equipe da conta vê todas; proprietário e inquilino veem as do imóvel deles (o que
   vai acontecer nas áreas comuns), prestador não vê. Na fase 2 vira uma política de RLS na mesma tabela.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { AccessError, connect } from '@/data/api'
import type { Db } from '@/data/db'
import type { Scope } from '@/data/scope'
import type { Id, IsoDate, MaintenanceCategory, MaintenanceSchedule } from '@/data/types'
import { toPropertyRows, type PropertyRow } from '@/data/views/units'

export interface ScheduleRow {
  id: Id
  title: string
  category: MaintenanceCategory
  every_months: number
  next_date: IsoDate
  /** A data da próxima já passou e a rotina ainda não abriu o chamado. */
  late: boolean
  unit_code: string | null
  vendor_name: string | null
}

export interface PropertySheet {
  /**
   * O imóvel da leitura. A ficha confere property.id antes de desenhar: com a leitura anterior ainda
   * na tela (troca de imóvel), as rotinas de outro imóvel não aparecem por um instante.
   */
  property: PropertyRow
  schedules: ScheduleRow[]
}

/** Regra escrita aqui (sem regra no scope.ts): equipe vê todas; dono e inquilino, as do imóvel deles. */
export function seeSchedule(sc: Scope, r: MaintenanceSchedule): boolean {
  if (r.organization_id !== sc.orgId) return false
  return sc.all || ((sc.role === 'owner' || sc.role === 'lessee') && sc.propertyIds.has(r.property_id))
}

function schedulesOf(db: Db, sc: Scope, propertyId: Id, today: IsoDate): ScheduleRow[] {
  const unitCode = new Map(db.units.map((u) => [u.id, u.code]))
  const personName = new Map(db.people.map((p) => [p.id, p.name]))
  return db.maintenance_schedules
    .filter((r) => r.property_id === propertyId && r.active && seeSchedule(sc, r))
    .map((r) => ({
      id: r.id, title: r.title, category: r.category, every_months: r.every_months, next_date: r.next_date, late: r.next_date < today,
      unit_code: r.unit_id ? (unitCode.get(r.unit_id) ?? null) : null,
      // Nome do prestador só para a equipe: o portal não abre a ficha de prestador.
      vendor_name: sc.all && r.vendor_person_id ? (personName.get(r.vendor_person_id) ?? null) : null,
    }))
    .sort((a, b) => (a.next_date < b.next_date ? -1 : 1))
}

/**
 * As rotinas do imóvel. Passo a passo:
 *   1. o imóvel pela mesma visão da lista (é também a conferência de acesso: fora do escopo, erro);
 *   2. as rotinas ativas dele que a sessão pode ver, da próxima data para a mais distante.
 */
export async function getPropertySheet(s: Session, propertyId: Id): Promise<PropertySheet> {
  const { db, sc } = await connect(s)
  const property = toPropertyRows(db, sc, s.today).find((p) => p.id === propertyId)
  if (!property) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  return { property, schedules: schedulesOf(db, sc, propertyId, s.today) }
}
