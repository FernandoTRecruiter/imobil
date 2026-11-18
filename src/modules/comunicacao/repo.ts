/* =============================================================================
   comunicacao/repo.ts: comunicados aos inquilinos e proprietários, e a caixa de saída de e-mail.

   O QUE RESOLVE: a administração avisa "o elevador do Bloco B para na terça" uma vez só, e o
   aviso chega a cada pessoa certa por e-mail e, para quem tem acesso ao portal, no sino e na
   tela inicial do portal. Tudo fica registrado: o comunicado (quando, para quantos), cada e-mail
   na caixa de saída e a auditoria.

   QUEM RECEBE (o "recorte" do comunicado):
   - inquilinos: locatários com locação vigente (situação "Vigente" e já começada) no imóvel
     escolhido ou, em "Todos os imóveis", em qualquer imóvel da conta;
   - proprietários: donos vigentes do imóvel (da unidade ou do imóvel inteiro);
   - ambos: a soma, sem repetir quem é as duas coisas.
   Por que "Vigente" e não "a data do contrato cobre hoje": locação vencida em que o inquilino
   continua morando segue vigente (prorrogada por prazo indeterminado) e ele precisa do aviso.

   NÃO DUPLICA: cada e-mail e cada aviso leva a chave announcement:comunicado:pessoa; enviar é
   uma vez só (comunicado enviado não muda nem reenvia). Ver outbox.ts para o envio de verdade
   na fase 2 (Edge Function + Resend).

   ESCOPO: comunicado tem regra em scope.ts (see.announcement): a equipe vê todos; inquilino e
   dono só os enviados ao público dele, do imóvel dele ou de todos. email_outbox não tem regra
   em scope.ts: só a equipe da própria organização lê a caixa de saída (regra deste arquivo).
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, audit, connect, diff, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { ANNOUNCEMENT_AUDIENCE } from '@/data/labels'
import { runList, type ListParams, type ListResult } from '@/data/query'
import { see, type Scope } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type { Announcement, AnnouncementAudience, EmailMessage, Id, IsoDate } from '@/data/types'
import { formatDateTime } from '@/lib/dates'
import { newId } from '@/lib/random'
import { parseInput } from '@/modules/manutencao/repo'
import { loginOf, queueEmail, queueNotice } from './outbox'

export const AUDIENCES = ['lessees', 'owners', 'everyone'] as const satisfies readonly AnnouncementAudience[]

/** Comunicado e caixa de saída: só a equipe da conta enxerga; enviar e editar, quem edita processos (ou o admin). */
function teamCanView(s: Session, sc: Scope): boolean {
  return sc.all && can(s, 'workflows:view')
}
function requireEdit(s: Session, sc: Scope): void {
  if (!sc.all || !can(s, 'workflows:edit')) throw new AccessError('Só a equipe com permissão de editar processos (Tarefas) escreve e envia comunicado.')
}

/* ---------------------------------------------------------------- quem recebe */

export interface Recipient {
  person_id: Id
  name: string
  email: string
  role: 'lessee' | 'owner'
  /** Login da pessoa no portal desta conta (null = só e-mail). */
  user_id: Id | null
}

/**
 * O recorte do comunicado: as pessoas que recebem, sem repetir, em ordem de nome.
 * Vaga de garagem não conta (06/11): quem SÓ aluga uma vaga no estacionamento não mora no prédio
 * e não deve receber "manutenção do elevador"; e as vagas externas são do próprio condomínio, que
 * não é destinatário de comunicado aos proprietários. Conta quem aluga ou é dono de casa,
 * apartamento ou sala.
 */
export function recipientsOf(db: Db, orgId: Id, today: IsoDate, audience: AnnouncementAudience, propertyId: Id | null): Recipient[] {
  const people = new Map(db.people.filter((p) => p.organization_id === orgId && !p.deleted_at).map((p) => [p.id, p]))
  const liveProperty = (id: Id) => db.properties.some((p) => p.id === id && p.organization_id === orgId && !p.deleted_at)
  const spots = new Set(db.units.filter((u) => u.organization_id === orgId && u.kind === 'parking').map((u) => u.id))
  const isSpotUnit = (unitId: Id | null) => !!unitId && spots.has(unitId)
  const found = new Map<Id, Recipient['role']>()
  if (audience === 'lessees' || audience === 'everyone') {
    for (const k of db.contracts) {
      if (k.organization_id !== orgId || k.kind !== 'lease' || k.status !== 'active' || k.start_date > today) continue
      if ((propertyId && k.property_id !== propertyId) || !liveProperty(k.property_id) || isSpotUnit(k.unit_id)) continue
      for (const p of db.contract_parties) if (p.contract_id === k.id && p.role === 'lessee' && !found.has(p.person_id)) found.set(p.person_id, 'lessee')
    }
  }
  if (audience === 'owners' || audience === 'everyone') {
    for (const o of db.property_owners) {
      if (o.organization_id !== orgId || o.since > today || (o.until && o.until < today)) continue
      if ((propertyId && o.property_id !== propertyId) || !liveProperty(o.property_id) || isSpotUnit(o.unit_id)) continue
      if (!found.has(o.person_id)) found.set(o.person_id, 'owner')
    }
  }
  const out: Recipient[] = []
  for (const [id, role] of found) {
    const p = people.get(id)
    if (p) out.push({ person_id: id, name: p.name, email: p.email, role, user_id: loginOf(db, orgId, id) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export interface RecipientPreview {
  total: number
  withEmail: number
  withLogin: number
}

/** Quantos recebem (o formulário mostra antes de enviar: "vai para 55 pessoas"). */
export async function previewRecipients(s: Session, input: { audience: AnnouncementAudience; property_id: Id | '' }): Promise<RecipientPreview> {
  const { db, sc } = await connect(s)
  if (!teamCanView(s, sc)) return { total: 0, withEmail: 0, withLogin: 0 }
  const list = recipientsOf(db, s.org.id, s.today, input.audience, input.property_id || null)
  return { total: list.length, withEmail: list.filter((r) => r.email.trim()).length, withLogin: list.filter((r) => r.user_id).length }
}

/** Imóveis para o campo "Imóvel" do comunicado. */
export async function listAnnouncementProperties(s: Session): Promise<{ id: Id; name: string }[]> {
  const { db, sc } = await connect(s)
  if (!teamCanView(s, sc)) return []
  return db.properties
    .filter((p) => see.property(sc, p) && !p.deleted_at)
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

/* ---------------------------------------------------------------- lista da equipe */

export interface AnnouncementRow extends Announcement {
  /** null = todos os imóveis. */
  property_name: string | null
  state: 'draft' | 'sent'
  author_name: string | null
}

/** Filtros: situacao ('rascunho' | 'enviado'), publico, imovel (id ou 'todos'). Ordens: sent_at, title, recipients. */
export async function listAnnouncements(s: Session, params: ListParams): Promise<ListResult<AnnouncementRow>> {
  const { db, sc } = await connect(s)
  const names = new Map(db.profiles.map((p) => [p.id, p.full_name]))
  const props = new Map(db.properties.map((p) => [p.id, p.name]))
  const rows: AnnouncementRow[] = teamCanView(s, sc)
    ? db.announcements
        .filter((a) => see.announcement(sc, a))
        .map((a) => ({
          ...a, property_name: a.property_id ? (props.get(a.property_id) ?? 'Imóvel removido') : null, state: a.sent_at ? 'sent' : 'draft',
          author_name: a.created_by ? (names.get(a.created_by) ?? null) : null,
        }))
    : []
  return runList(rows, params, {
    search: (a) => [a.title, a.body, a.property_name ?? 'Todos os imóveis', ANNOUNCEMENT_AUDIENCE[a.audience]],
    filters: { situacao: (a) => (a.sent_at ? 'enviado' : 'rascunho'), publico: (a) => a.audience, imovel: (a) => a.property_id ?? 'todos' },
    sorts: { sent_at: (a) => a.sent_at, title: (a) => a.title, recipients: (a) => (a.sent_at ? a.recipients : null) },
    // Ordem declarada: os rascunhos (o que falta fazer) em cima; depois os enviados, o mais novo primeiro.
    defaultSort: (a, b) => Number(!!a.sent_at) - Number(!!b.sent_at) || ((b.sent_at ?? b.created_at) < (a.sent_at ?? a.created_at) ? -1 : 1),
  })
}

/* ---------------------------------------------------------------- escrever e enviar */

export const announcementSchema = z.object({
  /** Vazio = comunicado novo. */
  id: z.string(),
  title: z.string().trim().min(3, 'Dê um título com pelo menos 3 letras (ex.: "Manutenção do elevador").').max(120, 'Título longo demais: até 120 caracteres.'),
  body: z.string().trim().min(10, 'Escreva o comunicado (pelo menos 10 letras): é o texto do e-mail e do aviso.').max(4000, 'Texto longo demais: até 4.000 caracteres.'),
  audience: z.enum(AUDIENCES, { message: 'Escolha quem recebe.' }),
  /** Vazio = todos os imóveis da conta. */
  property_id: z.string(),
  /** true = salva e já envia; false = guarda como rascunho. */
  send: z.boolean(),
})
export type AnnouncementInput = z.infer<typeof announcementSchema>

export interface SendResult {
  announcement: Announcement
  /** Pessoas no recorte. */
  people: number
  emails: number
  notices: number
  /** Pessoas sem e-mail no cadastro (receberam só o aviso, se têm portal). */
  missing: number
}

/**
 * Entrega o comunicado: e-mail para cada pessoa do recorte e aviso no sino de quem tem portal.
 * Passo a passo: recorte -> para cada pessoa, e-mail (chave) e aviso (chave) -> marca enviado,
 * com a data e o número de pessoas -> UMA linha de auditoria com o resumo.
 * Recebe o recorte já calculado: quem chama confere antes de gravar se há alguém para receber.
 */
function deliver(s: Session, a: Announcement, people: Recipient[]): SendResult {
  let emails = 0
  let notices = 0
  let missing = 0
  for (const p of people) {
    const key = `announcement:${a.id}:${p.person_id}`
    const mail = queueEmail(s, { to_email: p.email, to_name: p.name, subject: `Comunicado: ${a.title}`, body: a.body, reason: 'announcement', entity: 'announcements', entity_id: a.id, dedupe_key: key })
    if (mail === 'created') emails++
    if (mail === 'no_email') missing++
    if (p.user_id && queueNotice(s, { user_id: p.user_id, title: `Comunicado: ${a.title}`, body: a.body, link: '/portal', dedupe_key: key }) === 'created') notices++
  }
  const after: Announcement = { ...a, sent_at: nowIso(), recipients: people.length, updated_at: nowIso() }
  upsertRows('announcements', [after])
  const rest = missing ? `; ${missing} sem e-mail no cadastro` : ''
  audit(s, 'announcements', a.id, 'status', `Enviou o comunicado "${a.title}" para ${people.length} ${people.length === 1 ? 'pessoa' : 'pessoas'} (${emails} e-mails simulados, ${notices} avisos no portal${rest})`, diff(a, after))
  return { announcement: after, people: people.length, emails, notices, missing }
}

function emptyRecipients(audience: AnnouncementAudience, propertyName: string | null): RuleError {
  const who = ANNOUNCEMENT_AUDIENCE[audience].toLowerCase()
  return new RuleError(`Ninguém para receber: ${propertyName ? `o ${propertyName}` : 'a conta'} não tem ${who} com contrato ou propriedade vigente. Troque o público ou o imóvel, ou salve como rascunho.`)
}

/**
 * Salva o comunicado (novo ou rascunho) e, com send = true, já envia.
 * Regras: só a equipe que edita processos; comunicado enviado não muda (o que as pessoas leram
 * fica como leram: para corrigir, um comunicado novo); enviar exige alguém no recorte, conferido
 * ANTES de gravar, para o erro não deixar um rascunho a mais para trás.
 */
export async function saveAnnouncement(s: Session, input: AnnouncementInput): Promise<SendResult> {
  const data = parseInput(announcementSchema, input)
  const { db, sc } = await connect(s)
  requireEdit(s, sc)
  const property = data.property_id ? db.properties.find((p) => p.id === data.property_id && see.property(sc, p) && !p.deleted_at) : null
  if (data.property_id && !property) throw new RuleError('O imóvel escolhido não existe mais nesta conta. Escolha outro ou "Todos os imóveis".')
  const before = data.id ? db.announcements.find((a) => a.id === data.id && a.organization_id === s.org.id) : undefined
  if (data.id && !before) throw new AccessError('Comunicado não encontrado nesta conta.')
  if (before?.sent_at) throw new RuleError(`"${before.title}" já foi enviado em ${formatDateTime(before.sent_at, s.org.timezone)} e não muda mais. Para corrigir, escreva um comunicado novo.`)
  const people = recipientsOf(db, s.org.id, s.today, data.audience, property?.id ?? null)
  if (data.send && people.length === 0) throw emptyRecipients(data.audience, property?.name ?? null)

  const now = nowIso()
  const row: Announcement = {
    id: before?.id ?? newId(), organization_id: s.org.id, created_at: before?.created_at ?? now, updated_at: now, created_by: before?.created_by ?? s.user.id,
    title: data.title, body: data.body, audience: data.audience, property_id: property?.id ?? null, sent_at: null, recipients: 0,
  }
  upsertRows('announcements', [row])
  if (before) audit(s, 'announcements', row.id, 'update', `Rascunho do comunicado "${row.title}" alterado`, diff(before, row))
  else audit(s, 'announcements', row.id, 'create', `Comunicado "${row.title}" escrito (${ANNOUNCEMENT_AUDIENCE[row.audience].toLowerCase()}, ${property?.name ?? 'todos os imóveis'})`)
  if (!data.send) return { announcement: row, people: people.length, emails: 0, notices: 0, missing: 0 }
  return deliver(s, row, people)
}

/** Envia um rascunho já salvo (botão "Enviar" da lista). Enviado uma vez, não envia de novo. */
export async function sendAnnouncement(s: Session, input: { id: Id }): Promise<SendResult> {
  const { db, sc } = await connect(s)
  requireEdit(s, sc)
  const a = db.announcements.find((x) => x.id === input.id && x.organization_id === s.org.id)
  if (!a) throw new AccessError('Comunicado não encontrado nesta conta.')
  if (a.sent_at) throw new RuleError(`"${a.title}" já foi enviado em ${formatDateTime(a.sent_at, s.org.timezone)}: cada comunicado sai uma vez só.`)
  const people = recipientsOf(db, s.org.id, s.today, a.audience, a.property_id)
  if (people.length === 0) throw emptyRecipients(a.audience, a.property_id ? (db.properties.find((p) => p.id === a.property_id)?.name ?? null) : null)
  return deliver(s, a, people)
}

/* ---------------------------------------------------------------- portal */

export interface PortalAnnouncement {
  id: Id
  title: string
  body: string
  sent_at: string
  property_name: string | null
  /** Tem aviso no sino ainda não lido. */
  unread: boolean
  /** Avisos desta pessoa ligados ao comunicado (o "Marcar como lido" marca estes). */
  notice_ids: Id[]
}

/**
 * Comunicados que o inquilino ou o proprietário vê na tela inicial do portal, do mais novo ao
 * mais antigo. Quem decide o que ele vê é see.announcement (público e imóvel dele).
 * "Não lido" vem do aviso no sino (chave announcement:comunicado:pessoa) ainda sem read_at;
 * comunicado sem aviso (enviado antes de a pessoa ter portal) conta como lido.
 */
export function announcementsForPortal(db: Db, s: Session, sc: Scope): PortalAnnouncement[] {
  const props = new Map(db.properties.map((p) => [p.id, p.name]))
  // Só os enviados (rascunho nunca chega ao portal); o filtro com tipo diz ao TypeScript que sent_at não é nulo daqui em diante.
  const sent = db.announcements.filter((a): a is Announcement & { sent_at: string } => !!a.sent_at && see.announcement(sc, a))
  return sent
    .sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1))
    .map((a) => {
      const notes = db.notifications.filter((n) => n.organization_id === s.org.id && n.user_id === s.user.id && n.dedupe_key === `announcement:${a.id}:${s.personId}`)
      return {
        id: a.id, title: a.title, body: a.body, sent_at: a.sent_at, property_name: a.property_id ? (props.get(a.property_id) ?? null) : null,
        unread: notes.some((n) => !n.read_at), notice_ids: notes.filter((n) => !n.read_at).map((n) => n.id),
      }
    })
}

/* ---------------------------------------------------------------- caixa de saída */

export interface OutboxRow extends EmailMessage {
  /** A que o e-mail se refere, para gente ler ("Contrato LOC-2026-0014") e para o link. */
  ref: { kind: 'contract' | 'request' | 'announcement' | 'other'; label: string }
}

/** Filtros: motivo (reason), situacao (status). Ordens: created_at, to_name, subject. Só a equipe. */
export async function listOutbox(s: Session, params: ListParams): Promise<ListResult<OutboxRow>> {
  const { db, sc } = await connect(s)
  let rows: OutboxRow[] = []
  if (teamCanView(s, sc)) {
    const contracts = new Map(db.contracts.map((k) => [k.id, k.code]))
    const requests = new Map(db.maintenance_requests.map((r) => [r.id, r.code]))
    const notes = new Map(db.announcements.map((a) => [a.id, a.title]))
    const refOf = (e: EmailMessage): OutboxRow['ref'] => {
      if (e.entity === 'contracts') return { kind: 'contract', label: `Contrato ${contracts.get(e.entity_id) ?? 'removido'}` }
      if (e.entity === 'maintenance_requests') return { kind: 'request', label: `Chamado ${requests.get(e.entity_id) ?? 'removido'}` }
      if (e.entity === 'announcements') return { kind: 'announcement', label: `Comunicado "${notes.get(e.entity_id) ?? 'removido'}"` }
      return { kind: 'other', label: e.entity }
    }
    rows = db.email_outbox.filter((e) => e.organization_id === s.org.id).map((e) => ({ ...e, ref: refOf(e) }))
  }
  return runList(rows, params, {
    search: (e) => [e.to_name, e.to_email, e.subject, e.ref.label],
    filters: { motivo: (e) => e.reason, situacao: (e) => e.status },
    sorts: { created_at: (e) => e.created_at, to_name: (e) => e.to_name, subject: (e) => e.subject },
    defaultSort: (a, b) => (a.created_at < b.created_at ? 1 : -1),
  })
}
