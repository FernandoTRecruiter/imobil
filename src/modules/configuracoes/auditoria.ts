/* =============================================================================
   auditoria.ts: como a auditoria vira texto legível ("Situação manual: Disponível → Bloqueada").

   A auditoria guarda o valor do BANCO (centavos, códigos em inglês, ids). Esta tradução fica
   num lugar só porque duas telas mostram auditoria: Configurações > Auditoria e o painel
   "Histórico" do Data Manager. Mudar um rótulo aqui muda nas duas.
   ============================================================================= */
import { PERSON_TAG, ROLE, UNIT_STATUS, STAFF_ROLE } from '@/data/labels'
import type { AuditAction, AuditLog, Id } from '@/data/types'
import { formatDate } from '@/lib/dates'
import { formatDocument } from '@/lib/documents'
import { formatBRL } from '@/lib/money'

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  create: 'Criou', update: 'Alterou', archive: 'Arquivou ou excluiu', restore: 'Restaurou', status: 'Mudou a situação',
  approve: 'Aprovou', payment: 'Registrou pagamento', import: 'Importou', undo: 'Desfez',
}

/** Nome em português de cada tabela que aparece na auditoria. */
export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  organizations: 'Empresa', memberships: 'Acesso de usuário', invitations: 'Convite', portfolios: 'Carteira',
  unit_status_config: 'Situação e cor', properties: 'Imóvel', units: 'Unidade', people: 'Pessoa', contracts: 'Contrato',
  contract_parties: 'Parte de contrato', financial_entries: 'Lançamento', payments: 'Pagamento', owner_transfers: 'Repasse',
  documents: 'Documento', maintenance_requests: 'Chamado', inspections: 'Vistoria', tasks: 'Tarefa', workflow_instances: 'Processo',
  import_batches: 'Importação', property_owners: 'Proprietário', buildings: 'Bloco', floors: 'Andar', automation_rules: 'Automação',
}

export function entityLabel(entity: string): string {
  return AUDIT_ENTITY_LABEL[entity] ?? entity
}

/** Rótulo de cada coluna que pode aparecer em "mudanças". Coluna sem rótulo aparece com o nome técnico. */
export const FIELD_LABEL: Record<string, string> = {
  name: 'Nome', document: 'Documento', timezone: 'Fuso horário', brand_color: 'Cor da marca', plan: 'Plano',
  area_m2: 'Área (m²)', bedrooms: 'Quartos', bathrooms: 'Banheiros', parking_spots: 'Vagas', zone: 'Área externa', asking_rent_cents: 'Aluguel pedido',
  manual_status: 'Situação manual', notes: 'Observações', portfolio_id: 'Carteira', manager_user_id: 'Responsável',
  email: 'E-mail', phone: 'Telefone', tags: 'Papéis declarados', deleted_at: 'Arquivado em', status: 'Situação',
  permissions: 'Permissões', label: 'Rótulo', color: 'Cor', role: 'Papel', person_id: 'Pessoa ligada', expires_at: 'Vence em',
  address: 'Endereço', kind: 'Tipo', code: 'Código', undone_at: 'Desfeito em', import_batch_id: 'Lote de importação',
  photo: 'Foto', active: 'Ativo', note: 'Observação', every_months: 'A cada (meses)', next_date: 'Próxima data', title: 'Título',
}

/** Nomes para trocar id por gente (quem é o responsável, qual é a carteira). */
export interface NameBook {
  user: Map<Id, string>
  portfolio: Map<Id, string>
  person: Map<Id, string>
}

/** Valor do banco -> texto da tela. Passo a passo: vazio, depois pelo nome da coluna, depois pelo tipo. */
export function formatAuditValue(field: string, value: unknown, names: NameBook): string {
  if (value === null || value === undefined || value === '') return 'vazio'
  if (Array.isArray(value)) {
    if (!value.length) return 'nenhum'
    if (field === 'tags') return value.map((t) => PERSON_TAG[t as keyof typeof PERSON_TAG] ?? String(t)).join(', ')
    return value.map(String).join(', ')
  }
  if (typeof value === 'boolean') return value ? 'sim' : 'não'
  if (field.endsWith('_cents') && typeof value === 'number') return formatBRL(value)
  if (field === 'manual_status' || (field === 'status' && typeof value === 'string' && value in UNIT_STATUS)) return UNIT_STATUS[value as keyof typeof UNIT_STATUS] ?? String(value)
  // Papel pode ser de acesso (admin, staff...) ou da equipe do prédio (caretaker = zelador...).
  if (field === 'role' && typeof value === 'string') return ROLE[value as keyof typeof ROLE] ?? STAFF_ROLE[value as keyof typeof STAFF_ROLE] ?? value
  if (field === 'photo') return value ? 'foto enviada' : 'sem foto'
  if (field === 'portfolio_id') return names.portfolio.get(String(value)) ?? 'carteira removida'
  if (field === 'manager_user_id' || field.endsWith('user_id')) return names.user.get(String(value)) ?? 'usuário'
  if (field === 'person_id') return names.person.get(String(value)) ?? 'pessoa'
  if (field === 'document' && typeof value === 'string') return formatDocument(value)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return formatDate(value.slice(0, 10))
  if (typeof value === 'object') {
    // Endereço (e outros objetos): os valores na ordem, sem as chaves.
    return Object.values(value as Record<string, unknown>).filter((v) => v !== '' && v !== null).join(', ') || 'vazio'
  }
  return String(value)
}

export interface ChangeLine {
  field: string
  label: string
  from: string
  to: string
}

export function describeChanges(changes: AuditLog['changes'], names: NameBook): ChangeLine[] {
  if (!changes) return []
  return Object.entries(changes).map(([field, ch]) => ({
    field, label: FIELD_LABEL[field] ?? field, from: formatAuditValue(field, ch.from, names), to: formatAuditValue(field, ch.to, names),
  }))
}

/** "Área (m²): 64 → 70; Quartos: 2 → 3" para resumo e exportação. */
export function changesText(changes: AuditLog['changes'], names: NameBook): string {
  return describeChanges(changes, names).map((c) => `${c.label}: ${c.from} → ${c.to}`).join('; ')
}
