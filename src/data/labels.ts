/* =============================================================================
   labels.ts: o texto em português de cada código guardado no banco.
   O banco guarda 'awaiting_signature'; a tela mostra "Aguardando assinatura".
   Um lugar só: trocar um rótulo aqui troca em todas as telas e exportações.
   ============================================================================= */
import type {
  AnnouncementAudience, EmailReason, StaffRole,
  AdjustmentIndex, ChargedTo, Condition, ContractKind, ContractStatus, EntryCategory, GuaranteeType, InspectionKind,
  MaintenanceCategory, MaintenancePriority, MaintenanceStatus, PartyRole, PaymentMethod, PersonTag, PropertyKind, Role,
  UnitKind, UnitStatus,
} from './types'

export const UNIT_STATUS: Record<UnitStatus, string> = {
  available: 'Disponível', occupied: 'Ocupada', reserved: 'Reservada', maintenance: 'Em manutenção', blocked: 'Bloqueada',
}
export const PROPERTY_KIND: Record<PropertyKind, string> = {
  house: 'Casa', apartment: 'Apartamento', condominium: 'Condomínio', building: 'Edifício', commercial: 'Comercial', land: 'Terreno',
}
export const UNIT_KIND: Record<UnitKind, string> = {
  apartment: 'Apartamento', house: 'Casa', room: 'Quarto', office: 'Sala', store: 'Loja', warehouse: 'Galpão', parking: 'Vaga',
}
export const CONTRACT_KIND: Record<ContractKind, string> = { lease: 'Locação', management: 'Administração', other: 'Outro' }
export const CONTRACT_STATUS: Record<ContractStatus, string> = {
  draft: 'Rascunho', in_review: 'Em revisão', awaiting_approval: 'Aguardando aprovação', awaiting_signature: 'Aguardando assinatura',
  active: 'Vigente', ended: 'Encerrado', terminated: 'Rescindido',
}
export const ADJUSTMENT_INDEX: Record<AdjustmentIndex, string> = { IGPM: 'IGP-M', IPCA: 'IPCA', INPC: 'INPC', fixed: 'Percentual fixo', none: 'Sem reajuste' }
export const GUARANTEE: Record<GuaranteeType, string> = {
  none: 'Sem garantia', deposit: 'Caução', guarantor: 'Fiador', insurance: 'Seguro-fiança', capitalization: 'Título de capitalização',
}
export const PARTY_ROLE: Record<PartyRole, string> = { lessor: 'Locador', lessee: 'Locatário', guarantor: 'Fiador', representative: 'Procurador' }
export const ENTRY_CATEGORY: Record<EntryCategory, string> = {
  rent: 'Aluguel', condo_fee: 'Condomínio', iptu: 'IPTU', admin_fee: 'Taxa de administração', maintenance: 'Manutenção',
  transfer: 'Repasse', deposit: 'Caução', other: 'Outro',
}
export const CHARGED_TO: Record<ChargedTo, string> = { owner: 'Proprietário', lessee: 'Inquilino', agency: 'Imobiliária' }
export const PAYMENT_METHOD: Record<PaymentMethod, string> = { pix: 'PIX', boleto: 'Boleto', transfer: 'Transferência', cash: 'Dinheiro', card: 'Cartão', other: 'Outro' }
export const MAINTENANCE_STATUS: Record<MaintenanceStatus, string> = {
  open: 'Aberto', triage: 'Em triagem', quote: 'Orçamento', awaiting_owner: 'Aguardando proprietário', approved: 'Aprovado',
  in_progress: 'Em execução', done: 'Concluído', canceled: 'Cancelado',
}
export const MAINTENANCE_CATEGORY: Record<MaintenanceCategory, string> = {
  plumbing: 'Hidráulica', electrical: 'Elétrica', painting: 'Pintura', locksmith: 'Serralheria e chaves', appliance: 'Equipamentos',
  structure: 'Estrutura', cleaning: 'Limpeza', other: 'Outros',
}
export const PRIORITY: Record<MaintenancePriority, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente' }
export const INSPECTION_KIND: Record<InspectionKind, string> = { move_in: 'Entrada', periodic: 'Periódica', move_out: 'Saída' }
export const CONDITION: Record<Condition, string> = { good: 'Bom', fair: 'Regular', poor: 'Ruim', na: 'Não vistoriado' }
export const ROLE: Record<Role, string> = { admin: 'Administrador', staff: 'Colaborador', owner: 'Proprietário', lessee: 'Inquilino', vendor: 'Prestador' }
export const PERSON_TAG: Record<PersonTag, string> = { vendor: 'Prestador', contact: 'Contato', caretaker: 'Zelador', syndic: 'Síndico' }

/** Em que "família" de cor cada situação cai (para selo e mapa). */
export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'orange'
export const CONTRACT_STATUS_TONE: Record<ContractStatus, Tone> = {
  draft: 'neutral', in_review: 'warning', awaiting_approval: 'warning', awaiting_signature: 'primary', active: 'success', ended: 'neutral', terminated: 'danger',
}
export const MAINTENANCE_STATUS_TONE: Record<MaintenanceStatus, Tone> = {
  open: 'warning', triage: 'warning', quote: 'primary', awaiting_owner: 'orange', approved: 'primary', in_progress: 'primary', done: 'success', canceled: 'neutral',
}
export const PRIORITY_TONE: Record<MaintenancePriority, Tone> = { low: 'neutral', medium: 'primary', high: 'orange', urgent: 'danger' }

export const STAFF_ROLE: Record<StaffRole, string> = {
  caretaker: 'Zelador', doorman: 'Porteiro', syndic: 'Síndico', cleaning: 'Limpeza', security: 'Segurança', other: 'Outro',
}
export const ANNOUNCEMENT_AUDIENCE: Record<AnnouncementAudience, string> = { lessees: 'Inquilinos', owners: 'Proprietários', everyone: 'Inquilinos e proprietários' }
export const EMAIL_REASON: Record<EmailReason, string> = {
  renewal: 'Renovação de contrato', request_opened: 'Pedido aberto', request_update: 'Pedido atualizado',
  routine_maintenance: 'Manutenção de rotina', announcement: 'Comunicado', charge_due: 'Cobrança a vencer', other: 'Outro',
}
