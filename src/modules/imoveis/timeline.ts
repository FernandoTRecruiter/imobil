/* =============================================================================
   timeline.ts: a LINHA DO TEMPO ÚNICA do imóvel (aba Documentos e histórico do detalhe e painel ao lado do 3D).

   Junta, do mais novo para o mais velho, cinco fontes que antes ficavam espalhadas:
     1. cadastro: auditoria do imóvel, das unidades e da equipe do prédio (quem mudou o quê);
     2. contratos: os eventos dos contratos das unidades (criado, mudou de situação, reajuste...);
     3. chamados: abertura e fechamento dos chamados das unidades (+ o que a auditoria registrou);
     4. comunicados: os enviados para este imóvel;
     5. e-mails simulados (email_outbox) cujo assunto é contrato, chamado ou comunicado do imóvel.

   ESCOPO (espelho da RLS), fonte por fonte:
   - auditoria e e-mails: só a equipe da conta (a auditoria é da administração, regra do history.ts;
     o e-mail traz endereço de outras pessoas);
   - contratos, chamados e comunicados: cada linha passa pelo see.* dela. O proprietário convidado
     vê só os contratos e chamados das unidades dele e os comunicados enviados a proprietários.

   DUAS ARMADILHAS que a junção evita:
   - linha repetida: mudança de situação de contrato existe na auditoria E em contract_events. Do
     contrato vale só o evento (é a linha do tempo oficial dele, e o dono também a vê); do chamado
     e do comunicado, a criação vem da própria linha, então o "create" da auditoria sai;
   - enxurrada de e-mail: um comunicado para 40 inquilinos são 40 e-mails. Viram UMA linha
     ("para 40 pessoas"), agrupados por assunto, motivo e dia.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, connect } from '@/data/api'
import { ANNOUNCEMENT_AUDIENCE, CONTRACT_STATUS, EMAIL_REASON, MAINTENANCE_CATEGORY, STAFF_ROLE } from '@/data/labels'
import { see } from '@/data/scope'
import type { AuditLog, ContractEvent, Id, StaffRole } from '@/data/types'
import { parts } from '@/lib/dates'
import { plural } from '@/lib/text'
import { FIELD_LABEL, formatAuditValue, type NameBook } from '@/modules/configuracoes/auditoria'
import { joinNames } from '@/data/views/lookup'

export type TimelineKind = 'cadastro' | 'contrato' | 'chamado' | 'comunicado' | 'email'

export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  cadastro: 'Cadastro e equipe', contrato: 'Contratos', chamado: 'Chamados', comunicado: 'Comunicados', email: 'E-mails',
}

export interface TimelineItem {
  id: string
  kind: TimelineKind
  /** Quando aconteceu: data ('AAAA-MM-DD', evento de contrato) ou data e hora (o resto). */
  at: string
  dateOnly: boolean
  title: string
  /** Linhas de detalhe ("Papel: Porteiro → Zelador", "Para 12 pessoas"). */
  detail: string[]
  /** Quem fez (só a equipe vê nome de colaborador; no portal fica vazio). */
  who: string | null
  /** Para onde o título leva (só quando a sessão pode abrir aquela tela). */
  link: string | null
}

export interface PropertyTimeline {
  /** As linhas pedidas (da fonte escolhida, até o limite). */
  items: TimelineItem[]
  /** Quantas linhas cada fonte tem no total, para o filtro mostrar a contagem. */
  counts: Record<TimelineKind, number>
  /** Quantas linhas a fonte escolhida tem (o "N" de "mostrando 30 de N"). */
  total: number
}

/** Quantas linhas vêm por vez: condomínio grande com anos de contrato passaria de mil; a tela pede mais. */
export const TIMELINE_PAGE = 30

/** Chave de ordem: data sem hora conta como meio-dia de Brasília (15h UTC), para cair no meio do dia. */
function sortKey(at: string, dateOnly: boolean): number {
  if (!dateOnly) return new Date(at).getTime()
  const [y, m, d] = parts(at)
  return Date.UTC(y, m - 1, d, 15)
}

/** Rótulos de coluna que só existem nas tabelas novas (equipe e foto); o resto vem da auditoria da Configurações. */
const EXTRA_FIELD_LABEL: Record<string, string> = { active: 'Na equipe', note: 'Observação', photo: 'Foto', role: 'Papel' }

/** "Papel: Porteiro → Zelador". O papel da equipe do prédio não é o papel de usuário (ROLE): traduz aqui. */
function changeLines(entity: string, changes: AuditLog['changes'], names: NameBook): string[] {
  if (!changes) return []
  const lines = Object.entries(changes).map(([field, ch]) => {
    const label = (entity === 'property_staff' ? EXTRA_FIELD_LABEL[field] : undefined) ?? FIELD_LABEL[field] ?? EXTRA_FIELD_LABEL[field] ?? field
    const value = (v: unknown) => (entity === 'property_staff' && field === 'role' && typeof v === 'string' ? (STAFF_ROLE[v as StaffRole] ?? v) : formatAuditValue(field, v, names))
    return `${label}: ${value(ch.from)} → ${value(ch.to)}`
  })
  return lines.length > 5 ? [...lines.slice(0, 5), `e mais ${lines.length - 5} alterações`] : lines
}

/** Título de cada evento de contrato, em pt-BR (o banco guarda 'status', 'adjustment'...). */
function contractEventTitle(code: string, e: ContractEvent): string {
  switch (e.kind) {
    case 'created':
      return `Contrato ${code} criado`
    case 'status':
      return `Contrato ${code}: ${e.from_status ? CONTRACT_STATUS[e.from_status] : 'Novo'} → ${e.to_status ? CONTRACT_STATUS[e.to_status] : ''}`
    case 'adjustment':
      return `Contrato ${code}: reajuste`
    case 'amendment':
      return `Contrato ${code}: aditivo`
    case 'renewal':
      return `Contrato ${code}: renovação`
    default:
      return `Contrato ${code}: observação`
  }
}

/**
 * A linha do tempo do imóvel. Passo a passo:
 *   1. o imóvel existe e a sessão o vê;
 *   2. junta os ids do que pendura nele (unidades, contratos, chamados, equipe, comunicados);
 *   3. monta as linhas de cada fonte, já filtradas pelo escopo;
 *   4. ordena do mais novo para o mais velho, conta por fonte, filtra pela fonte pedida e corta no limite.
 * O filtro e o corte ficam aqui (e não na tela) para a contagem e a lista nunca discordarem.
 */
export async function propertyTimeline(s: Session, propertyId: Id, opts: { kind?: TimelineKind | null; limit?: number } = {}): Promise<PropertyTimeline> {
  // 1. o imóvel
  const { db, sc } = await connect(s)
  const property = db.properties.find((p) => p.id === propertyId)
  if (!property || !see.property(sc, property)) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  const org = s.org.id
  const team = sc.all

  // 2. o que pendura no imóvel (unidade arquivada entra: o passado dela é passado do imóvel)
  const units = db.units.filter((u) => u.property_id === propertyId && u.organization_id === org)
  const unitIds = new Set(units.map((u) => u.id))
  const unitCode = new Map(units.map((u) => [u.id, u.code]))
  const contracts = db.contracts.filter((k) => k.organization_id === org && ((k.unit_id && unitIds.has(k.unit_id)) || k.property_id === propertyId))
  const requests = db.maintenance_requests.filter((r) => r.organization_id === org && ((!!r.unit_id && unitIds.has(r.unit_id)) || r.property_id === propertyId))
  const announcements = db.announcements.filter((a) => a.organization_id === org && a.property_id === propertyId)
  const staffIds = new Set(db.property_staff.filter((r) => r.organization_id === org && r.property_id === propertyId).map((r) => r.id))

  const userName = new Map(db.profiles.map((p) => [p.id, p.full_name]))
  const who = (id: Id | null) => (team ? (id ? (userName.get(id) ?? 'Pessoa removida') : 'Sistema') : null)
  const canContracts = can(s, 'contracts:view')
  const canRequests = can(s, 'maintenance:view')
  const items: TimelineItem[] = []

  // 3a. auditoria (só a equipe)
  if (team) {
    const names: NameBook = {
      user: userName,
      portfolio: new Map(db.portfolios.map((p) => [p.id, p.name])),
      person: new Map(db.people.map((p) => [p.id, p.name])),
    }
    const wanted: Record<string, Set<Id>> = {
      properties: new Set([propertyId]), units: unitIds, property_staff: staffIds,
      maintenance_requests: new Set(requests.map((r) => r.id)), announcements: new Set(announcements.map((a) => a.id)),
    }
    let hasCreate = false
    for (const l of db.audit_logs) {
      if (l.organization_id !== org || !wanted[l.entity]?.has(l.entity_id)) continue
      // Criação de chamado e comunicado já vem da própria linha (3c e 3d): a da auditoria repetiria.
      if ((l.entity === 'maintenance_requests' || l.entity === 'announcements') && l.action === 'create') continue
      if (l.entity === 'properties' && l.action === 'create') hasCreate = true
      const kind: TimelineKind = l.entity === 'maintenance_requests' ? 'chamado' : l.entity === 'announcements' ? 'comunicado' : 'cadastro'
      const link = l.entity === 'units' && unitIds.has(l.entity_id) ? `/unidades/${l.entity_id}` : l.entity === 'maintenance_requests' && canRequests ? `/manutencao/${l.entity_id}` : null
      items.push({ id: `a:${l.id}`, kind, at: l.at, dateOnly: false, title: l.summary, detail: changeLines(l.entity, l.changes, names), who: who(l.actor_user_id), link })
    }
    // Os dados fictícios nascem prontos, sem o "create" na auditoria: a data e o autor saem da própria linha.
    if (!hasCreate) items.push({ id: `criado:${property.id}`, kind: 'cadastro', at: property.created_at, dateOnly: false, title: `Cadastro do imóvel "${property.name}"`, detail: [], who: who(property.created_by), link: null })
  }

  // 3b. contratos: os eventos (a linha do tempo oficial de cada contrato), só dos contratos visíveis
  const visibleContracts = new Map(contracts.filter((k) => see.contract(sc, k)).map((k) => [k.id, k]))
  for (const e of db.contract_events) {
    const k = visibleContracts.get(e.contract_id)
    if (!k) continue
    const detail = [k.unit_id ? `Unidade ${unitCode.get(k.unit_id) ?? ''}` : 'Imóvel inteiro', e.note].filter(Boolean)
    items.push({ id: `c:${e.id}`, kind: 'contrato', at: e.effective_date, dateOnly: true, title: contractEventTitle(k.code, e), detail, who: who(e.created_by), link: canContracts ? `/contratos/${k.id}` : null })
  }

  // 3c. chamados visíveis: abertura e, se houver, fechamento
  for (const r of requests.filter((x) => see.maintenance(sc, x))) {
    const link = canRequests ? `/manutencao/${r.id}` : null
    const where = `${r.unit_id ? `Unidade ${unitCode.get(r.unit_id) ?? ''}` : 'Áreas comuns'} · ${MAINTENANCE_CATEGORY[r.category]}`
    items.push({ id: `m:${r.id}`, kind: 'chamado', at: r.created_at, dateOnly: false, title: `Chamado ${r.code} aberto: ${r.title}`, detail: [where], who: who(r.created_by), link })
    if (r.closed_at && (r.status === 'done' || r.status === 'canceled')) {
      items.push({ id: `mf:${r.id}`, kind: 'chamado', at: r.closed_at, dateOnly: false, title: `Chamado ${r.code} ${r.status === 'done' ? 'concluído' : 'cancelado'}`, detail: [where], who: null, link })
    }
  }

  // 3d. comunicados enviados para este imóvel (rascunho não é fato ainda: aparece pela auditoria, para a equipe)
  for (const a of announcements.filter((x) => x.sent_at && see.announcement(sc, x))) {
    items.push({
      id: `n:${a.id}`, kind: 'comunicado', at: a.sent_at!, dateOnly: false, title: `Comunicado enviado: ${a.title}`,
      detail: [`Para ${ANNOUNCEMENT_AUDIENCE[a.audience].toLowerCase()} · ${plural(a.recipients, 'destinatário', 'destinatários')}`], who: who(a.created_by), link: null,
    })
  }

  // 3e. e-mails simulados (só a equipe), agrupados por assunto + motivo + dia
  if (team) {
    const subject = new Map<string, string>([
      ...contracts.map((k) => [`contracts:${k.id}`, `contrato ${k.code}`] as const),
      ...requests.map((r) => [`maintenance_requests:${r.id}`, `chamado ${r.code}`] as const),
      ...announcements.map((a) => [`announcements:${a.id}`, `comunicado "${a.title}"`] as const),
    ])
    const groups = new Map<string, { first: string; reason: keyof typeof EMAIL_REASON; about: string; names: string[] }>()
    for (const m of db.email_outbox) {
      const about = m.organization_id === org ? subject.get(`${m.entity}:${m.entity_id}`) : undefined
      if (!about) continue
      const key = `${m.entity}:${m.entity_id}:${m.reason}:${m.created_at.slice(0, 10)}`
      const g = groups.get(key) ?? { first: m.created_at, reason: m.reason, about, names: [] }
      if (m.created_at < g.first) g.first = m.created_at
      g.names.push(m.to_name)
      groups.set(key, g)
    }
    for (const [key, g] of groups) {
      const shown = g.names.length > 3 ? [...g.names.slice(0, 3), `mais ${g.names.length - 3}`] : g.names
      items.push({
        id: `e:${key}`, kind: 'email', at: g.first, dateOnly: false, title: `E-mail simulado: ${EMAIL_REASON[g.reason]} (${g.about})`,
        detail: [`Para ${joinNames(shown)}`], who: 'Sistema', link: null,
      })
    }
  }

  // 4. ordem, contagem, filtro e corte
  items.sort((a, b) => sortKey(b.at, b.dateOnly) - sortKey(a.at, a.dateOnly))
  const counts: Record<TimelineKind, number> = { cadastro: 0, contrato: 0, chamado: 0, comunicado: 0, email: 0 }
  for (const it of items) counts[it.kind] += 1
  const chosen = opts.kind ? items.filter((it) => it.kind === opts.kind) : items
  return { items: chosen.slice(0, Math.max(1, opts.limit ?? TIMELINE_PAGE)), counts, total: chosen.length }
}
