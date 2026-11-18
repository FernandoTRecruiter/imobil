/* =============================================================================
   types.ts: o CONTRATO entre as telas e o banco.

   Cada interface aqui é uma tabela da seção E do docs/PLANO.md, com os mesmos nomes de
   coluna que o Postgres vai ter na fase 2 (por isso snake_case). Hoje quem preenche estes
   tipos são os dados fictícios; na fase 2, o Supabase. As telas não mudam.

   Três convenções que valem para todo o arquivo:
   1. Dinheiro é Cents (inteiro em centavos): R$ 1.234,56 = 123456. Conta com vírgula no
      JavaScript erra (0,1 + 0,2 = 0,30000000000000004); com inteiro, não.
   2. Data sem hora (vencimento, início de contrato) é IsoDate 'AAAA-MM-DD'. Data com hora
      (quando algo aconteceu) é IsoDateTime com fuso. Misturar as duas é o erro clássico do
      "venceu ontem" que aparece às 21h.
   3. Toda linha de operação carrega organization_id: é por ele que a RLS do banco (e, hoje,
      o escopo do repositório) separa uma imobiliária da outra.
   ============================================================================= */

export type Id = string
export type Cents = number
export type IsoDate = string
export type IsoDateTime = string

/** Colunas que toda tabela de operação tem. */
export interface Base {
  id: Id
  organization_id: Id
  created_at: IsoDateTime
  updated_at: IsoDateTime
  created_by: Id | null
}

/** Exclusão lógica: a linha fica escondida, não some (histórico e auditoria continuam de pé). */
export interface SoftDelete {
  deleted_at: IsoDateTime | null
}

/* ----------------------------------------------------------- Conta e acesso */

export type OrgKind = 'landlord' | 'agency'

export interface Organization {
  id: Id
  kind: OrgKind
  name: string
  document: string // CNPJ ou CPF, só dígitos
  timezone: string // nome IANA, ex.: 'America/Sao_Paulo'
  plan: 'starter' | 'pro'
  brand_color: string
  is_demo: boolean
  created_at: IsoDateTime
}

/** Quem faz login. Na fase 2 liga em auth.users do Supabase (que guarda e-mail e senha). */
export interface Profile {
  id: Id
  full_name: string
  email: string
  avatar_color: string
}

export type Role = 'admin' | 'staff' | 'owner' | 'lessee' | 'vendor'

/** Permissões por módulo do colaborador (staff). Admin tem todas; portais têm as próprias. */
export type Permission =
  | 'properties:view'
  | 'properties:edit'
  | 'people:view'
  | 'people:edit'
  | 'contracts:view'
  | 'contracts:edit'
  | 'contracts:approve'
  | 'finance:view'
  | 'finance:edit'
  | 'transfers:approve'
  | 'maintenance:view'
  | 'maintenance:edit'
  | 'workflows:view'
  | 'workflows:edit'
  | 'data:import'
  | 'reports:view'
  | 'settings:manage'

export interface Membership {
  id: Id
  organization_id: Id
  user_id: Id
  role: Role
  /** Para owner, lessee e vendor: a pessoa (em people) que este login representa. */
  person_id: Id | null
  /** Só vale para staff. */
  permissions: Permission[]
  /** Só vale para staff: null = todas as carteiras. */
  portfolio_ids: Id[] | null
  status: 'active' | 'invited' | 'disabled'
  created_at: IsoDateTime
}

export interface Invitation extends Base {
  email: string
  role: Role
  person_id: Id | null
  expires_at: IsoDateTime
  accepted_at: IsoDateTime | null
}

/* ----------------------------------------------------------- Pessoas */

/** Papel declarado (o que não sai de uma ligação). Proprietário, inquilino e fiador saem das ligações. */
export type PersonTag = 'vendor' | 'contact' | 'caretaker' | 'syndic'

export interface Address {
  cep: string
  street: string
  number: string
  complement: string
  district: string
  city: string
  state: string
}

export interface Person extends Base, SoftDelete {
  kind: 'PF' | 'PJ'
  name: string
  document: string // CPF ou CNPJ sem pontuação (CNPJ pode ter letras desde jul/2026); único dentro da organização
  email: string
  phone: string
  address: Address | null
  notes: string
  tags: PersonTag[]
  vendor_categories: MaintenanceCategory[]
  user_id: Id | null
  /** Lote de importação que criou a pessoa (é o que permite desfazer). Opcional: cadastro pela tela não tem. */
  import_batch_id?: Id | null
  /**
   * Foto opcional (zelador, porteiro, síndico...). Na fase 1 é uma imagem pequena embutida (data:,
   * reduzida para ~160 px no navegador); na fase 2, arquivo no Storage privado com link que expira.
   */
  photo?: string | null
  /*
   * Moradia e convivência (07/11/2026, pedido do Fernando: dependentes, animais, veículos). Todos
   * opcionais: cadastro antigo, importação e cadastro rápido da equipe do prédio não têm.
   * LGPD: são dados PESSOAIS comuns (não "sensíveis" no sentido do art. 5º, II: nada de saúde,
   * religião, biometria), coletados para regra do prédio (animais, vaga) e seguro, com a finalidade
   * dita no formulário. Quem vê: a equipe da conta e a própria pessoa; no portal, o dado de OUTRA
   * pessoa sai mascarado pela view (data/views/cliente.ts, canSeeHousehold), espelho da RLS da fase 2.
   * Na fase 2 viram colunas anuláveis de people (dependents int, pets text, vehicles int, occupation text).
   */
  /** Quantas pessoas dependem dela e moram junto (null = não informado). */
  dependents?: number | null
  /** Animais de estimação em texto curto ("1 cachorro", "2 gatos"); vazio = nenhum ou não informado. */
  pets?: string
  /** Quantos veículos (null = não informado); serve para vaga e portaria. Placa não é guardada (dado a mais sem uso hoje). */
  vehicles?: number | null
  /** Ocupação ou profissão (texto livre curto). */
  occupation?: string
}

/* ----------------------------------------------------------- Imóveis */

export type PropertyKind = 'house' | 'apartment' | 'condominium' | 'building' | 'commercial' | 'land'
export type UnitKind = 'apartment' | 'house' | 'room' | 'office' | 'store' | 'warehouse' | 'parking'
/** Status escolhido à mão. "Ocupada" NÃO está aqui: ela vem do contrato vigente (ver lib/unitStatus). */
export type ManualUnitStatus = 'available' | 'reserved' | 'maintenance' | 'blocked'
export type UnitStatus = ManualUnitStatus | 'occupied'

export interface Portfolio extends Base {
  name: string
  color: string
}

export interface Property extends Base, SoftDelete {
  kind: PropertyKind
  name: string
  address: Address
  lat: number | null
  lng: number | null
  portfolio_id: Id | null
  manager_user_id: Id | null // responsável na imobiliária
  notes: string
  import_batch_id: Id | null
}

/**
 * Dono e a fatia dele. unit_id vazio = dono do imóvel inteiro (casa, prédio de um investidor só);
 * unit_id preenchido = dono só daquela unidade (cada apartamento de um condomínio tem matrícula e
 * dono próprios). A soma das fatias vigentes de cada unidade é 100.
 */
export interface PropertyOwner extends Base {
  property_id: Id
  unit_id: Id | null
  person_id: Id
  share_pct: number
  since: IsoDate
  until: IsoDate | null
}

export interface Building extends Base {
  property_id: Id
  name: string
  /** Posição do bloco no terreno, em células do mapa isométrico. */
  site_x: number
  site_y: number
}

export interface Floor extends Base {
  building_id: Id
  level: number // ordem: 0 = térreo, -1 = subsolo
  label: string // "Térreo", "Mezanino", "Cobertura"
}

export interface Unit extends Base, SoftDelete {
  property_id: Id
  building_id: Id | null
  floor_id: Id | null
  code: string
  kind: UnitKind
  area_m2: number
  bedrooms: number
  bathrooms: number
  parking_spots: number
  features: string[]
  manual_status: ManualUnitStatus
  /** Ordem da unidade no andar (para o espelho e o 3D). */
  position: number | null
  /**
   * Área de fora dos blocos onde a unidade fica ("Estacionamento externo"). Hoje só a vaga de
   * estacionamento externo usa: ela não tem bloco nem andar, e o nome da área é o que a tabela e o
   * 3D mostram. Unidade dentro de um bloco (inclusive vaga de garagem no subsolo) fica com null.
   */
  zone: string | null
  asking_rent_cents: Cents | null
  notes: string
  import_batch_id: Id | null
}

/* ----------------------------------------------------------- Contratos */

export type ContractKind = 'lease' | 'management' | 'other'
export type ContractStatus =
  | 'draft'
  | 'in_review'
  | 'awaiting_approval'
  | 'awaiting_signature'
  | 'active'
  | 'ended'
  | 'terminated'
export type AdjustmentIndex = 'IGPM' | 'IPCA' | 'INPC' | 'fixed' | 'none'
/** A Lei do Inquilinato (art. 37) proíbe mais de uma modalidade de garantia no mesmo contrato. */
export type GuaranteeType = 'none' | 'deposit' | 'guarantor' | 'insurance' | 'capitalization'
export type PartyRole = 'lessor' | 'lessee' | 'guarantor' | 'representative'

export interface Contract extends Base {
  kind: ContractKind
  code: string
  unit_id: Id | null // locação aponta uma unidade
  property_id: Id
  status: ContractStatus
  start_date: IsoDate
  end_date: IsoDate
  rent_cents: Cents
  due_day: number // 1 a 31; mês curto cai no último dia
  adjustment_index: AdjustmentIndex
  adjustment_month: number // 1 a 12
  guarantee_type: GuaranteeType
  deposit_cents: Cents // caução: até 3 aluguéis (Lei 8.245, art. 38)
  admin_fee_pct: number // taxa de administração da imobiliária
  late_fee_pct: number
  interest_pct_month: number
  notes: string
  reviewed_by: Id | null
  approved_by: Id | null
  parent_contract_id: Id | null
  import_batch_id: Id | null
}

export interface ContractParty extends Base {
  contract_id: Id
  person_id: Id
  role: PartyRole
  share_pct: number | null
}

export type ContractEventKind = 'created' | 'status' | 'adjustment' | 'amendment' | 'renewal' | 'note'

/** Linha do tempo única do contrato: tudo o que aconteceu, com data de efeito e quem fez. */
export interface ContractEvent extends Base {
  contract_id: Id
  kind: ContractEventKind
  effective_date: IsoDate
  from_status: ContractStatus | null
  to_status: ContractStatus | null
  payload: Record<string, string | number | null>
  note: string
  document_id: Id | null
}

/* ----------------------------------------------------------- Financeiro */

export type EntryDirection = 'receivable' | 'payable'
export type EntryCategory =
  | 'rent'
  | 'condo_fee'
  | 'iptu'
  | 'admin_fee'
  | 'maintenance'
  | 'transfer'
  | 'deposit'
  | 'other'
export type ChargedTo = 'owner' | 'lessee' | 'agency'

/** "Vencido" não é gravado: é aberto + vencimento antes de hoje no fuso da organização. */
export interface FinancialEntry extends Base {
  direction: EntryDirection
  category: EntryCategory
  description: string
  contract_id: Id | null
  unit_id: Id | null
  property_id: Id | null
  person_id: Id | null // contraparte: quem paga (a receber) ou quem recebe (a pagar)
  competence: IsoDate // primeiro dia do mês de referência
  due_date: IsoDate
  amount_cents: Cents
  charged_to: ChargedTo | null
  status: 'open' | 'paid' | 'canceled'
  recurrence_group: Id | null
  transfer_id: Id | null
  import_batch_id: Id | null
}

export type PaymentMethod = 'pix' | 'boleto' | 'transfer' | 'cash' | 'card' | 'other'

export interface Payment extends Base {
  entry_id: Id
  paid_at: IsoDate
  amount_cents: Cents
  method: PaymentMethod
  reference: string
}

export interface OwnerTransfer extends Base {
  owner_person_id: Id
  month: IsoDate
  gross_cents: Cents
  admin_fee_cents: Cents
  expenses_cents: Cents
  net_cents: Cents
  status: 'draft' | 'approved' | 'paid'
  approved_by: Id | null
  approved_at: IsoDateTime | null
  paid_at: IsoDate | null
}

/* ----------------------------------------------------------- Documentos */

/**
 * Ligado a UMA entidade (no banco, um CHECK exige exatamente uma das chaves preenchida).
 * Visibilidade em duas marcações independentes: o contrato assinado é do proprietário E do
 * inquilino; a matrícula do imóvel é só interna (as duas falsas).
 */
export interface DocumentFile extends Base, SoftDelete {
  name: string
  mime: string
  size: number
  visible_to_owner: boolean
  visible_to_lessee: boolean
  property_id: Id | null
  unit_id: Id | null
  contract_id: Id | null
  person_id: Id | null
  maintenance_id: Id | null
  inspection_id: Id | null
  storage_path: string
}

/* ----------------------------------------------------------- Manutenção e vistorias */

export type MaintenanceCategory = 'plumbing' | 'electrical' | 'painting' | 'locksmith' | 'appliance' | 'structure' | 'cleaning' | 'other'
export type MaintenancePriority = 'low' | 'medium' | 'high' | 'urgent'
export type MaintenanceStatus =
  | 'open'
  | 'triage'
  | 'quote'
  | 'awaiting_owner'
  | 'approved'
  | 'in_progress'
  | 'done'
  | 'canceled'

export interface MaintenanceRequest extends Base {
  code: string
  /** null = ÁREA COMUM do imóvel (caixa d'água, elevador, fachada): não é de nenhuma unidade. */
  unit_id: Id | null
  property_id: Id
  requester_person_id: Id | null
  category: MaintenanceCategory
  priority: MaintenancePriority
  title: string
  description: string
  status: MaintenanceStatus
  vendor_person_id: Id | null
  assignee_user_id: Id | null
  due_date: IsoDate | null
  quote_cents: Cents | null
  quote_status: 'none' | 'pending' | 'approved' | 'rejected'
  quote_decided_by: Id | null
  charged_to: ChargedTo | null
  closed_at: IsoDateTime | null
}

export type InspectionKind = 'move_in' | 'periodic' | 'move_out'
export type Condition = 'good' | 'fair' | 'poor' | 'na'

export interface InspectionItem {
  name: string
  condition: Condition
  note: string
}
export interface InspectionRoom {
  name: string
  items: InspectionItem[]
}

export interface Inspection extends Base {
  unit_id: Id
  contract_id: Id | null
  kind: InspectionKind
  scheduled_date: IsoDate
  done_date: IsoDate | null
  inspector_user_id: Id | null
  status: 'scheduled' | 'done' | 'canceled'
  rooms: InspectionRoom[]
}

/* ----------------------------------------------------------- Processos, tarefas e avisos */

export interface WorkflowStepTemplate {
  title: string
  role: Role
  sla_days: number
  requires_approval: boolean
}

export interface WorkflowTemplate extends Base {
  key: 'new_lease' | 'renewal' | 'termination' | 'onboarding' | 'maintenance' | 'inspection' | 'delinquency'
  name: string
  steps: WorkflowStepTemplate[]
}

export interface WorkflowInstance extends Base {
  template_id: Id
  title: string
  contract_id: Id | null
  maintenance_id: Id | null
  status: 'running' | 'done' | 'canceled'
  current_step: number
  started_at: IsoDateTime
  completed_at: IsoDateTime | null
}

export interface Task extends Base {
  title: string
  description: string
  workflow_instance_id: Id | null
  step_index: number | null
  assignee_user_id: Id | null
  due_date: IsoDate | null
  status: 'todo' | 'doing' | 'done' | 'canceled'
  requires_approval: boolean
  approved_by: Id | null
  approved_at: IsoDateTime | null
  contract_id: Id | null
  unit_id: Id | null
  maintenance_id: Id | null
  /** Chave da automação que criou a tarefa (garante que a mesma regra não cria duas). */
  dedupe_key: string | null
}

export type AutomationTrigger = 'contract_ends_in_days' | 'adjustment_month' | 'entry_overdue_days' | 'maintenance_schedule_due' | 'request_opened'

export interface AutomationRule extends Base {
  name: string
  trigger: AutomationTrigger
  days: number
  /** email = grava na caixa de saída (email_outbox); na fase 1 o envio é simulado. */
  action: 'create_task' | 'notify' | 'email'
  enabled: boolean
}

export interface AutomationRun {
  id: Id
  organization_id: Id
  rule_id: Id
  ran_at: IsoDateTime
  status: 'ok' | 'error'
  created_count: number
  skipped_count: number
  error: string | null
}

export interface Notification {
  id: Id
  organization_id: Id
  user_id: Id
  title: string
  body: string
  link: string | null
  /** Mesma regra + mesmo registro + mesmo dia = um aviso só. */
  dedupe_key: string
  channel: 'in_app' | 'email'
  status: 'pending' | 'sent' | 'failed'
  attempts: number
  last_error: string | null
  created_at: IsoDateTime
  read_at: IsoDateTime | null
}

/* ----------------------------------------------------------- Auditoria e importação */

export type AuditAction = 'create' | 'update' | 'archive' | 'restore' | 'status' | 'approve' | 'payment' | 'import' | 'undo'

export interface AuditLog {
  id: Id
  organization_id: Id
  actor_user_id: Id | null
  entity: string
  entity_id: Id
  action: AuditAction
  summary: string
  changes: Record<string, { from: unknown; to: unknown }> | null
  at: IsoDateTime
}

export interface ImportRowError {
  row: number
  column: string
  message: string
  level: 'error' | 'warning'
}

/** Registro que o lote ATUALIZOU (regra "duplicado: atualizar"): a versão de antes, para o desfazer devolver. */
export interface ImportUpdatedRecord {
  table: 'people' | 'properties' | 'units'
  id: Id
  before: Record<string, unknown>
}

export interface ImportBatch extends Base {
  entity: 'properties' | 'units' | 'people' | 'contracts' | 'entries'
  file_name: string
  mapping: Record<string, string>
  rows_total: number
  rows_ok: number
  rows_warning: number
  rows_error: number
  errors: ImportRowError[]
  undone_at: IsoDateTime | null
  /** Opcional: só existe quando o lote atualizou registros que já existiam. */
  updated_records?: ImportUpdatedRecord[]
}

/* ----------------------------------------------------------- Espacial (3D) */

export interface BuildingModel extends Base {
  building_id: Id
  template: 'tower' | 'slab' | 'row_houses' | 'house'
  floors: number
  units_per_floor: number
  /** Largura e profundidade em células do mapa. */
  width: number
  depth: number
}

/** Preparado para a importação futura de planta (PDF, DXF, IFC): a IA grava rascunho, a pessoa aprova. */
export interface FloorplanElement extends Base {
  floor_id: Id | null
  unit_id: Id | null
  kind: 'room' | 'wall' | 'door' | 'window'
  label: string
  polygon: [number, number][]
  source: 'template' | 'manual' | 'ai_import'
  review_status: 'draft' | 'approved'
}

/** Rótulo e cor configuráveis por organização para cada situação de unidade. */
export interface UnitStatusConfig {
  /** Id fixo "organização:situação": sem id, o patch do modo de demonstração não consegue guardar a troca de cor. */
  id: Id
  organization_id: Id
  status: UnitStatus
  label: string
  color: string
}

/* ----------------------------------------------------------- Equipe do imóvel e comunicação (05/11) */

/** Quem trabalha no imóvel ou responde por ele, além do responsável da imobiliária (manager_user_id). */
export type StaffRole = 'caretaker' | 'doorman' | 'syndic' | 'cleaning' | 'security' | 'other'

/** Liga uma pessoa (people) a um imóvel com um papel. A foto, quando houver, mora na pessoa. */
export interface PropertyStaff extends Base {
  property_id: Id
  person_id: Id
  role: StaffRole
  /** Turno, ramal, observação curta ("seg a sex, 7h às 16h"). */
  note: string
  active: boolean
}

/**
 * Manutenção de rotina: a cada N meses o sistema abre o chamado sozinho (limpeza de caixa d'água,
 * dedetização, extintores). A rotina diária cria o chamado quando next_date chega e empurra a data;
 * dedupe por (rotina + data) para nunca abrir dois.
 */
export interface MaintenanceSchedule extends Base {
  property_id: Id
  unit_id: Id | null
  category: MaintenanceCategory
  title: string
  description: string
  every_months: number
  next_date: IsoDate
  vendor_person_id: Id | null
  active: boolean
  last_request_id: Id | null
}

export type AnnouncementAudience = 'lessees' | 'owners' | 'everyone'

/** Comunicado da administração (obra no prédio, assembleia, falta de água): vira aviso no portal e e-mail. */
export interface Announcement extends Base {
  title: string
  body: string
  audience: AnnouncementAudience
  /** null = todos os imóveis da conta. */
  property_id: Id | null
  sent_at: IsoDateTime | null
  recipients: number
}

export type EmailReason = 'renewal' | 'request_opened' | 'request_update' | 'routine_maintenance' | 'announcement' | 'charge_due' | 'other'

/**
 * Caixa de saída de e-mail. Na fase 1 nada é enviado de verdade (status "simulated"): o registro mostra
 * o que SERIA enviado, para quem e por quê. Na fase 2 uma Edge Function envia (Resend) e grava sent/failed.
 * dedupe_key única: a mesma razão, para o mesmo registro e destinatário, não gera dois e-mails.
 */
export interface EmailMessage {
  id: Id
  organization_id: Id
  to_email: string
  to_name: string
  subject: string
  body: string
  reason: EmailReason
  entity: string
  entity_id: Id
  status: 'simulated' | 'sent' | 'failed'
  dedupe_key: string
  created_at: IsoDateTime
}
