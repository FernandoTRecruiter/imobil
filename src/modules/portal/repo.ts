/* =============================================================================
   portal/repo.ts: o "Início" de quem entra pelo portal (proprietário, inquilino, prestador).

   O QUE RESOLVE: cada pessoa de fora da equipe vê, numa tela só, o que é dela e o que pede
   ação AGORA: o proprietário, os orçamentos e as etapas que esperam o "sim" dele; o inquilino,
   o contrato, as cobranças e os chamados; o prestador, os chamados atribuídos por situação.

   UMA CONSULTA, VÁRIAS PARTES: tudo sai de um connect() só (uma "ida ao banco") e passa
   pelas mesmas visões das outras telas (toUnitRows, toEntryRows...), que já filtram pelo escopo.
   Quem tem dois papéis (dono de um imóvel e inquilino de outro) recebe as duas partes.
   Os COMUNICADOS da administração (obra, assembleia, falta de água) valem para proprietário e
   inquilino e aparecem uma vez só, mesmo para quem tem os dois papéis.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, connect } from '@/data/api'
import { see } from '@/data/scope'
import type { Cents, DocumentFile, Id, IsoDate, OwnerTransfer } from '@/data/types'
import { toContractRows, type ContractRow } from '@/data/views/contracts'
import { toEntryRows, toMaintenanceRows, type EntryRow, type MaintenanceRow } from '@/data/views/finance'
import { lookup } from '@/data/views/lookup'
import { toUnitRows } from '@/data/views/units'
import { monthStart } from '@/lib/dates'
import { announcementsForPortal, type PortalAnnouncement } from '@/modules/comunicacao/repo'
import { pendingApprovalsIn, type TaskRow } from '@/modules/processos/repo'

export interface OwnerHome {
  units: number
  occupied: number
  /** Aluguel pago pelos inquilinos das unidades dele neste mês (valor cheio, antes da taxa e da divisão entre donos). */
  receivedMonthCents: Cents
  lastTransfer: { month: IsoDate; net_cents: Cents; status: OwnerTransfer['status']; paid_at: IsoDate | null } | null
  quotes: MaintenanceRow[]
  approvals: TaskRow[]
  /** Locações vigentes das unidades dele, da que termina primeiro para a última (até 5). */
  upcomingEnds: ContractRow[]
}

export interface LesseeHome {
  contract: ContractRow | null
  /** Próxima cobrança em aberto que ainda não venceu. */
  nextDue: EntryRow | null
  /** Em aberto: as vencidas primeiro (a mais antiga em cima), depois as a vencer. */
  openEntries: EntryRow[]
  requests: MaintenanceRow[]
  documents: DocumentFile[]
}

export interface VendorRequest extends MaintenanceRow {
  /** Endereço do imóvel: é o que o prestador precisa saber do imóvel (matriz F do plano). */
  address: string
}

export interface PortalHomeData {
  owner: OwnerHome | null
  lessee: LesseeHome | null
  vendor: { requests: VendorRequest[] } | null
  /** Comunicados para proprietário e inquilino, do mais novo ao mais antigo (prestador não recebe: lista vazia). */
  announcements: PortalAnnouncement[]
}

const OPEN_FIRST = (a: MaintenanceRow, b: MaintenanceRow) =>
  Number(['done', 'canceled'].includes(a.status)) - Number(['done', 'canceled'].includes(b.status)) || (a.created_at < b.created_at ? 1 : -1)

export async function getPortalHome(s: Session): Promise<PortalHomeData> {
  const { db, sc } = await connect(s)
  if (!can(s, 'portal:home')) throw new AccessError('O Início do portal é de proprietário, inquilino e prestador.')
  const L = lookup(db)
  const maintenance = toMaintenanceRows(db, sc, s.today, L)
  const out: PortalHomeData = { owner: null, lessee: null, vendor: null, announcements: [] }
  if (s.roles.includes('owner') || s.roles.includes('lessee')) out.announcements = announcementsForPortal(db, s, sc)

  if (s.roles.includes('owner')) {
    const units = toUnitRows(db, sc, s.today, L).filter((u) => !u.deleted_at)
    const entries = toEntryRows(db, sc, s.today, L)
    // Recebido no mês: pagamentos deste mês nas cobranças de aluguel que ele enxerga (as das unidades dele).
    const rentIds = new Set(entries.filter((e) => e.direction === 'receivable' && e.category === 'rent').map((e) => e.id))
    const month = monthStart(s.today)
    const received = db.payments.filter((p) => rentIds.has(p.entry_id) && monthStart(p.paid_at) === month).reduce((a, p) => a + p.amount_cents, 0)
    // owner_transfers não tem regra em scope.ts: o dono vê só os repasses DELE (pessoa do login), fora o rascunho do mês.
    const last = db.owner_transfers
      .filter((t) => t.organization_id === s.org.id && t.owner_person_id === s.personId && t.status !== 'draft')
      .sort((a, b) => (a.month < b.month ? 1 : -1))[0]
    out.owner = {
      units: units.length,
      occupied: units.filter((u) => u.status === 'occupied').length,
      receivedMonthCents: received,
      lastTransfer: last ? { month: last.month, net_cents: last.net_cents, status: last.status, paid_at: last.paid_at } : null,
      quotes: maintenance.filter((r) => r.status === 'awaiting_owner').sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
      approvals: pendingApprovalsIn(db, s, sc),
      upcomingEnds: toContractRows(db, sc, s.today, L)
        .filter((k) => k.kind === 'lease' && k.status === 'active' && k.days_to_end >= 0)
        .sort((a, b) => a.end_date.localeCompare(b.end_date))
        .slice(0, 5),
    }
  }

  if (s.roles.includes('lessee')) {
    const mine = toContractRows(db, sc, s.today, L).filter((k) => k.kind === 'lease' && k.lessee_id === s.personId)
    // Quem aluga apartamento E vaga (a Daniela) tem duas locações vigentes: o contrato do Início é o da
    // moradia; a vaga aparece nas cobranças e nos documentos, como qualquer outra coisa dela.
    const home = (k: ContractRow) => !k.unit_id || L.unit.get(k.unit_id)?.kind !== 'parking'
    const contract =
      mine.find((k) => k.status === 'active' && home(k)) ?? mine.find((k) => k.status === 'active') ?? mine.sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0] ?? null
    const open = toEntryRows(db, sc, s.today, L).filter((e) => e.state === 'overdue' || e.state === 'forecast')
    const overdue = open.filter((e) => e.state === 'overdue').sort((a, b) => a.due_date.localeCompare(b.due_date))
    const forecast = open.filter((e) => e.state === 'forecast').sort((a, b) => a.due_date.localeCompare(b.due_date))
    out.lessee = {
      contract,
      nextDue: forecast[0] ?? null,
      openEntries: [...overdue, ...forecast],
      requests: maintenance.filter((r) => r.requester_person_id === s.personId || (contract?.unit_id && r.unit_id === contract.unit_id)).sort(OPEN_FIRST),
      documents: db.documents.filter((d) => see.document(sc, d)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    }
  }

  if (s.roles.includes('vendor')) {
    const addressOf = (propertyId: Id) => {
      const p = L.property.get(propertyId)
      return p ? `${p.address.street}, ${p.address.number} · ${p.address.district}` : ''
    }
    out.vendor = { requests: maintenance.map((r) => ({ ...r, address: addressOf(r.property_id) })).sort(OPEN_FIRST) }
  }
  return out
}
