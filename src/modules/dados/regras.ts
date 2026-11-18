/* =============================================================================
   regras.ts: as perguntas de negócio que o módulo Dados faz ao banco.
   "Esta unidade pode ser arquivada?", "esta pessoa já é usada em algum contrato?",
   "quem é a equipe ativa?". Cada função responde UMA pergunta e devolve o motivo em
   texto (causa + conserto) ou null quando pode.

   Por que separado do repositório: a edição na célula, a ação em lote e o desfazer da
   importação fazem as mesmas perguntas. Uma resposta só evita a regra divergir entre elas.
   Na fase 2 estas checagens viram chaves estrangeiras e funções do banco (o DELETE de uma
   unidade com contrato é recusado pela própria chave estrangeira).
   ============================================================================= */
import type { Db } from '@/data/db'
import { HOLDING_STATUSES } from '@/data/rules'
import type { Contract, Id, ImportBatch, IsoDate, MaintenanceRequest, Person, Property, Unit } from '@/data/types'
import { formatDate, formatDateTime } from '@/lib/dates'

/** "A, B, C e mais 4": lista curta para caber numa mensagem. */
export function shortList(items: string[], max = 3): string {
  if (items.length <= max) return items.join(', ')
  return `${items.slice(0, max).join(', ')} e mais ${items.length - max}`
}

/**
 * Momento de um registro como número. ARMADILHA evitada: comparar o TEXTO de duas datas com
 * fusos diferentes ("12:00-03:00" e "14:00Z") dá a ordem errada; Date.parse põe as duas em UTC.
 */
export function moment(iso: string): number {
  return Date.parse(iso)
}

/* ---------------------------------------------------------------- unidade */

/** Locações que seguram a unidade agora ou adiante (aguardando assinatura ou vigente, sem ter acabado). */
export function holdingLeases(db: Db, unitId: Id, today: IsoDate): Contract[] {
  return db.contracts.filter((k) => k.kind === 'lease' && k.unit_id === unitId && HOLDING_STATUSES.includes(k.status) && k.end_date >= today)
}

export function archiveBlockUnit(db: Db, u: Unit, today: IsoDate): string | null {
  const ks = holdingLeases(db, u.id, today)
  if (!ks.length) return null
  const k = ks[0]
  return `tem locação ${k.status === 'active' ? 'vigente' : 'aguardando assinatura'} (${shortList(ks.map((x) => x.code))}) até ${formatDate(k.end_date)}: encerre o contrato antes de arquivar`
}

export function restoreBlockUnit(db: Db, u: Unit): string | null {
  const p = db.properties.find((x) => x.id === u.property_id)
  return p?.deleted_at ? `o imóvel "${p.name}" está arquivado: restaure o imóvel primeiro` : null
}

/* ---------------------------------------------------------------- imóvel */

export function archiveBlockProperty(db: Db, p: Property, today: IsoDate): string | null {
  const busy = db.units
    .filter((u) => u.property_id === p.id && !u.deleted_at)
    .flatMap((u) => holdingLeases(db, u.id, today).map((k) => `${u.code} (${k.code})`))
  return busy.length ? `tem unidade com locação vigente ou aguardando assinatura: ${shortList(busy)}. Encerre os contratos antes de arquivar` : null
}

/* ---------------------------------------------------------------- pessoa */

/** Chamados em aberto em que a pessoa é o prestador. */
export function openVendorJobs(db: Db, personId: Id): MaintenanceRequest[] {
  return db.maintenance_requests.filter((r) => r.vendor_person_id === personId && r.status !== 'done' && r.status !== 'canceled')
}

/** Tirar o papel "prestador" de quem tem chamado aberto deixaria o chamado sem dono: recusa. */
export function vendorTagRemovalBlock(db: Db, p: Person, nextTags: readonly string[]): string | null {
  if (!p.tags.includes('vendor') || nextTags.includes('vendor')) return null
  const jobs = openVendorJobs(db, p.id)
  return jobs.length
    ? `${p.name} é prestador em ${jobs.length} chamado${jobs.length > 1 ? 's' : ''} aberto${jobs.length > 1 ? 's' : ''} (${shortList(jobs.map((j) => j.code))}): conclua ou troque o prestador antes de tirar o papel`
    : null
}

export function archiveBlockPerson(db: Db, p: Person, today: IsoDate): string | null {
  const live = db.contract_parties
    .filter((cp) => cp.person_id === p.id)
    .map((cp) => db.contracts.find((k) => k.id === cp.contract_id))
    .filter((k): k is Contract => !!k && HOLDING_STATUSES.includes(k.status) && k.end_date >= today)
  if (live.length) return `é parte de contrato vigente (${shortList(live.map((k) => k.code))}): encerre o contrato antes de arquivar`
  const owns = db.property_owners.filter((o) => o.person_id === p.id && (!o.until || o.until >= today))
  if (owns.length) return `é proprietário em ${owns.length} cadastro${owns.length > 1 ? 's' : ''} de imóvel: transfira a propriedade antes de arquivar`
  if (db.memberships.some((m) => m.person_id === p.id && m.status === 'active')) return 'tem acesso ativo ao portal: desative o acesso em Configurações > Usuários antes'
  const jobs = openVendorJobs(db, p.id)
  if (jobs.length) return `é prestador em chamados abertos (${shortList(jobs.map((j) => j.code))}): troque o prestador antes`
  return null
}

/* ---------------------------------------------------------------- equipe */

export interface TeamMember {
  userId: Id
  name: string
  email: string
}

/**
 * Equipe ativa (administrador e colaborador) da organização: quem pode ser "Responsável".
 * profiles não tem organization_id (a mesma pessoa pode estar em duas contas): o filtro
 * passa pelos vínculos (memberships) DESTA organização.
 */
export function activeTeam(db: Db, orgId: Id): TeamMember[] {
  const ids = new Set(db.memberships.filter((m) => m.organization_id === orgId && m.status === 'active' && (m.role === 'admin' || m.role === 'staff')).map((m) => m.user_id))
  return db.profiles
    .filter((p) => ids.has(p.id))
    .map((p) => ({ userId: p.id, name: p.full_name, email: p.email }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

/* ---------------------------------------------------------------- desfazer importação */

/**
 * O que USA uma unidade criada pelo lote (qualquer um destes impede o desfazer).
 * Contrato conta em qualquer status: até o rascunho guarda a unidade na história dele.
 */
export function usesOfUnit(db: Db, u: Unit, batch: ImportBatch): string[] {
  const out: string[] = []
  const ks = db.contracts.filter((k) => k.unit_id === u.id)
  if (ks.length) out.push(`contrato${ks.length > 1 ? 's' : ''} ${shortList(ks.map((k) => k.code))}`)
  const mr = db.maintenance_requests.filter((r) => r.unit_id === u.id)
  if (mr.length) out.push(`chamado${mr.length > 1 ? 's' : ''} ${shortList(mr.map((r) => r.code))}`)
  const insp = db.inspections.filter((i) => i.unit_id === u.id)
  if (insp.length) out.push(`${insp.length} vistoria${insp.length > 1 ? 's' : ''}`)
  const fe = db.financial_entries.filter((e) => e.unit_id === u.id)
  if (fe.length) out.push(`${fe.length} lançamento${fe.length > 1 ? 's' : ''} financeiro${fe.length > 1 ? 's' : ''}`)
  const docs = db.documents.filter((d) => d.unit_id === u.id && !d.deleted_at)
  if (docs.length) out.push(`${docs.length} documento${docs.length > 1 ? 's' : ''}`)
  if (db.property_owners.some((o) => o.unit_id === u.id && moment(o.created_at) > moment(batch.created_at))) out.push('proprietário ligado depois')
  if (db.tasks.some((t) => t.unit_id === u.id)) out.push('tarefa de processo')
  if (db.floorplan_elements.some((f) => f.unit_id === u.id)) out.push('planta desenhada')
  return out
}

/** O que usa um imóvel criado pelo lote, além das unidades dele (essas são conferidas uma a uma). */
export function usesOfProperty(db: Db, p: Property, batch: ImportBatch): string[] {
  const out: string[] = []
  const ks = db.contracts.filter((k) => k.property_id === p.id && !k.unit_id)
  if (ks.length) out.push(`contrato${ks.length > 1 ? 's' : ''} de administração ${shortList(ks.map((k) => k.code))}`)
  const extraUnits = db.units.filter((u) => u.property_id === p.id && u.import_batch_id !== batch.id)
  if (extraUnits.length) out.push(`unidade${extraUnits.length > 1 ? 's' : ''} cadastrada${extraUnits.length > 1 ? 's' : ''} depois (${shortList(extraUnits.map((u) => u.code))})`)
  if (db.buildings.some((b) => b.property_id === p.id)) out.push('bloco cadastrado depois')
  if (db.financial_entries.some((e) => e.property_id === p.id && !e.unit_id)) out.push('lançamento financeiro do imóvel')
  if (db.documents.some((d) => d.property_id === p.id && !d.deleted_at)) out.push('documento do imóvel')
  if (db.property_owners.some((o) => o.property_id === p.id && moment(o.created_at) > moment(batch.created_at))) out.push('proprietário ligado depois')
  return out
}

export function usesOfPerson(db: Db, p: Person, batch: ImportBatch): string[] {
  const out: string[] = []
  const parties = db.contract_parties.filter((cp) => cp.person_id === p.id)
  if (parties.length) {
    const codes = parties.map((cp) => db.contracts.find((k) => k.id === cp.contract_id)?.code ?? 'contrato')
    out.push(`parte do contrato ${shortList([...new Set(codes)])}`)
  }
  const owns = db.property_owners.filter((o) => o.person_id === p.id && moment(o.created_at) > moment(batch.created_at))
  if (owns.length) out.push(`proprietário de ${shortList(owns.map((o) => db.properties.find((x) => x.id === o.property_id)?.name ?? 'imóvel'))}`)
  const mr = db.maintenance_requests.filter((r) => r.vendor_person_id === p.id || r.requester_person_id === p.id)
  if (mr.length) out.push(`chamado${mr.length > 1 ? 's' : ''} ${shortList(mr.map((r) => r.code))}`)
  const fe = db.financial_entries.filter((e) => e.person_id === p.id)
  if (fe.length) out.push(`${fe.length} lançamento${fe.length > 1 ? 's' : ''} financeiro${fe.length > 1 ? 's' : ''}`)
  if (db.owner_transfers.some((t) => t.owner_person_id === p.id)) out.push('repasse')
  if (db.documents.some((d) => d.person_id === p.id && !d.deleted_at)) out.push('documento')
  if (p.user_id || db.memberships.some((m) => m.person_id === p.id)) out.push('acesso ao portal')
  if (db.invitations.some((i) => i.person_id === p.id && !i.accepted_at)) out.push('convite enviado')
  return out
}

/** Registro que o lote atualizou e que alguém mudou DEPOIS: devolver o "antes" apagaria a mudança nova. */
export function changedAfter(row: { updated_at: string }, batch: ImportBatch, tz?: string): string | null {
  return moment(row.updated_at) > moment(batch.created_at) ? `alterado depois da importação (em ${formatDateTime(row.updated_at, tz)})` : null
}
