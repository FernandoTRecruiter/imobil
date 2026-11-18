/* =============================================================================
   db.ts: o "banco" em memória. Uma lista por tabela, com os nomes que o Postgres terá.
   ============================================================================= */
import type {
  AuditLog, AutomationRule, AutomationRun, Building, BuildingModel, Contract, ContractEvent, ContractParty,
  DocumentFile, FinancialEntry, Floor, FloorplanElement, ImportBatch, Inspection, Invitation, MaintenanceRequest,
  Membership, Notification, Organization, OwnerTransfer, Payment, Person, Portfolio, Profile, Property, PropertyOwner,
  Task, Unit, UnitStatusConfig, WorkflowInstance, WorkflowTemplate, PropertyStaff, MaintenanceSchedule, Announcement, EmailMessage,
} from './types'

export interface Db {
  organizations: Organization[]
  profiles: Profile[]
  memberships: Membership[]
  invitations: Invitation[]
  people: Person[]
  portfolios: Portfolio[]
  properties: Property[]
  property_owners: PropertyOwner[]
  buildings: Building[]
  floors: Floor[]
  units: Unit[]
  contracts: Contract[]
  contract_parties: ContractParty[]
  contract_events: ContractEvent[]
  financial_entries: FinancialEntry[]
  payments: Payment[]
  owner_transfers: OwnerTransfer[]
  documents: DocumentFile[]
  maintenance_requests: MaintenanceRequest[]
  inspections: Inspection[]
  workflow_templates: WorkflowTemplate[]
  workflow_instances: WorkflowInstance[]
  tasks: Task[]
  automation_rules: AutomationRule[]
  automation_runs: AutomationRun[]
  notifications: Notification[]
  audit_logs: AuditLog[]
  import_batches: ImportBatch[]
  building_models: BuildingModel[]
  floorplan_elements: FloorplanElement[]
  unit_status_config: UnitStatusConfig[]
  property_staff: PropertyStaff[]
  maintenance_schedules: MaintenanceSchedule[]
  announcements: Announcement[]
  email_outbox: EmailMessage[]
}

export type TableName = keyof Db
/** Tipo da linha de uma tabela: Row<'units'> = Unit. */
export type Row<T extends TableName> = Db[T][number]

export const TABLES: TableName[] = [
  'organizations', 'profiles', 'memberships', 'invitations', 'people', 'portfolios', 'properties', 'property_owners',
  'buildings', 'floors', 'units', 'contracts', 'contract_parties', 'contract_events', 'financial_entries', 'payments',
  'owner_transfers', 'documents', 'maintenance_requests', 'inspections', 'workflow_templates', 'workflow_instances',
  'tasks', 'automation_rules', 'automation_runs', 'notifications', 'audit_logs', 'import_batches', 'building_models',
  'floorplan_elements', 'unit_status_config', 'property_staff', 'maintenance_schedules', 'announcements', 'email_outbox',
]

export function emptyDb(): Db {
  return Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Db
}
