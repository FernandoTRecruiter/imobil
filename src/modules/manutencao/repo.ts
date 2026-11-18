/* =============================================================================
   manutencao/repo.ts: o caminho de um chamado de manutenção, do aberto ao concluído.

   O QUE RESOLVE: inquilino, proprietário ou equipe abre o chamado; a equipe faz a triagem,
   escolhe o prestador e registra o orçamento; orçamento alto espera o "sim" do proprietário;
   o prestador executa e conclui; ao concluir, a conta a pagar ao prestador nasce sozinha.

   POR QUE TUDO PASSA POR AQUI: cada mudança de situação confere QUEM pode (papel e escopo),
   EM QUE situação pode (a ordem das etapas) e grava a auditoria. A tela só esconde botão;
   quem diz "não" é este arquivo (e, na fase 2, a função do banco que muda o status).

   Mapa das situações (o banco guarda o código, a tela mostra o rótulo de labels.ts):
     open -> triage -> quote -> awaiting_owner -> approved -> in_progress -> done
                         \________(até R$ 500)________/
     qualquer uma antes de "done" pode virar "canceled" (com motivo).

   E-MAILS DO CHAMADO (regra "Pedido aberto" da aba Automações e comunicados, em Tarefas):
   - abriu o chamado: e-mail e aviso no sistema para o responsável da imobiliária;
   - mudou de situação: e-mail para quem pediu (inquilino ou proprietário).
   Os dois só saem com a regra LIGADA, nunca repetem (chave de duplicidade) e cada disparo fica
   no registro de execuções. Na fase 2 isto vira um gatilho do banco na tabela de chamados.
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, audit, connect, diff, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { CHARGED_TO, MAINTENANCE_CATEGORY, MAINTENANCE_STATUS, PRIORITY } from '@/data/labels'
import { see, type Scope } from '@/data/scope'
import { getDb, upsertRows } from '@/data/store'
import type {
  AuditAction, Cents, ChargedTo, DocumentFile, FinancialEntry, Id, IsoDate, IsoDateTime, MaintenanceCategory, MaintenancePriority,
  MaintenanceRequest, MaintenanceStatus, OrgKind, Unit,
} from '@/data/types'
import { toMaintenanceRows, type MaintenanceRow } from '@/data/views/finance'
import { lookup, unitLabel } from '@/data/views/lookup'
import { toUnitRows } from '@/data/views/units'
import { addDays, monthStart, todayIn } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { newId } from '@/lib/random'
import { enabledRule, profileOf, queueEmail, queueNotice, recordRun, responsibleFor } from '@/modules/comunicacao/outbox'

/* ---------------------------------------------------------------- regras fixas do módulo */

/**
 * Orçamento ACIMA deste valor espera a aprovação do proprietário; até ele, a equipe aprova direto.
 * R$ 500,00 é o limite "combinado" de demonstração. Na fase 2 ele vira uma configuração por
 * conta (cada imobiliária combina o seu com os proprietários no contrato de administração).
 */
export const OWNER_APPROVAL_ABOVE_CENTS: Cents = 50_000

/** Prazo do chamado, em dias a partir da abertura, por prioridade (o mesmo critério do gerador de dados). */
export const DUE_DAYS_BY_PRIORITY: Record<MaintenancePriority, number> = { urgent: 1, high: 3, medium: 7, low: 15 }

/** A conta a pagar ao prestador vence 5 dias depois da conclusão (o mesmo prazo do gerador). */
export const PAYABLE_DUE_DAYS = 5

export const CATEGORIES = ['plumbing', 'electrical', 'painting', 'locksmith', 'appliance', 'structure', 'cleaning', 'other'] as const satisfies readonly MaintenanceCategory[]
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const satisfies readonly MaintenancePriority[]
export const CHARGED_OPTIONS = ['owner', 'lessee', 'agency'] as const satisfies readonly ChargedTo[]
const CLOSED: MaintenanceStatus[] = ['done', 'canceled']

/** As 6 etapas que a tela desenha, na ordem. */
export const FLOW_STEPS = ['Aberto', 'Triagem', 'Orçamento', 'Aprovação do proprietário', 'Execução', 'Concluído']

/**
 * Em qual etapa do desenho cada situação está (o número é a etapa ATUAL; as anteriores ganham o "feito").
 * "approved" já passou da aprovação e espera a execução, por isso fica na etapa 4, igual a "in_progress".
 * "done" devolve 6 (todas feitas). "canceled" devolve -1: a tela mostra o aviso de cancelado no lugar.
 */
export function flowStep(status: MaintenanceStatus): number {
  const map: Record<MaintenanceStatus, number> = { open: 0, triage: 1, quote: 2, awaiting_owner: 3, approved: 4, in_progress: 4, done: 6, canceled: -1 }
  return map[status]
}

/**
 * O orçamento precisa do "sim" do proprietário?
 * Só na imobiliária e só acima do limite. Na conta de proprietário independente quem registra
 * o orçamento JÁ É o dono: pedir aprovação dele para ele mesmo seria um clique inútil.
 */
export function needsOwnerApproval(orgKind: OrgKind, quoteCents: Cents): boolean {
  return orgKind === 'agency' && quoteCents > OWNER_APPROVAL_ABOVE_CENTS
}

/* ---------------------------------------------------------------- ajudantes de gravação */

/**
 * Valida a entrada com o zod e, se falhar, recusa com a mensagem do PRIMEIRO problema.
 * Por que não o .parse() direto: o erro do zod traz a lista inteira em JSON, e o aviso da tela
 * mostraria aquele texto técnico. Aqui sai só a frase com causa e conserto, escrita no esquema.
 * Os outros módulos do T5 (vistorias, processos) usam este mesmo ajudante.
 */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input)
  if (!r.success) throw new RuleError(r.error.issues[0]?.message ?? 'Dados inválidos: confira o formulário.')
  return r.data
}

/** Carrega o chamado já passando pelo escopo: o que a sessão não enxerga "não existe" (como na RLS). */
async function loadRequest(s: Session, id: Id): Promise<{ db: Db; sc: Scope; r: MaintenanceRequest }> {
  const { db, sc } = await connect(s)
  const r = db.maintenance_requests.find((x) => x.id === id)
  if (!r || !see.maintenance(sc, r)) throw new AccessError('Chamado não encontrado ou fora do seu acesso.')
  return { db, sc, r }
}

/** Ações da equipe: precisa ser da equipe (escopo "all") E ter a permissão de editar manutenção. Rotinas (rotinas.ts) usam a mesma. */
export function requireTeamEdit(s: Session, sc: Scope): void {
  if (!sc.all || !can(s, 'maintenance:edit')) throw new AccessError('Só a equipe com permissão de editar a manutenção faz isto.')
}

/** Recusa a ação se o chamado não está numa das situações esperadas, dizendo em qual ele está. */
function expectStatus(r: MaintenanceRequest, allowed: MaintenanceStatus[], what: string): void {
  if (allowed.includes(r.status)) return
  const list = allowed.map((st) => `"${MAINTENANCE_STATUS[st]}"`).join(' ou ')
  throw new RuleError(`O chamado ${r.code} está "${MAINTENANCE_STATUS[r.status]}": só dá para ${what} quando está ${list}. Recarregue a página para ver a situação atual.`)
}

/**
 * Grava a nova versão do chamado e a auditoria (com o "de X para Y" de cada campo).
 * A auditoria do chamado é também a LINHA DO TEMPO que a tela mostra: por isso toda mudança
 * de situação usa a ação 'status' e um resumo escrito para gente ler.
 * Toda mudança de situação passa por aqui, então é aqui que sai o e-mail para quem pediu.
 * getDb(): commit é síncrono e roda logo depois do connect() de quem chamou (é o mesmo banco).
 */
function commit(s: Session, before: MaintenanceRequest, patch: Partial<MaintenanceRequest>, action: AuditAction, summary: string): MaintenanceRequest {
  const after: MaintenanceRequest = { ...before, ...patch, updated_at: nowIso() }
  upsertRows('maintenance_requests', [after])
  audit(s, 'maintenance_requests', after.id, action, summary, diff(before, after))
  if (before.status !== after.status) notifyRequestUpdate(getDb(), s, before, after)
  return after
}

/* ---------------------------------------------------------------- e-mails do chamado */

/**
 * Pedido aberto: e-mail e aviso no sistema para o responsável da imobiliária.
 * Passo a passo:
 * 1. a regra "Pedido aberto" está ligada? Desligada, não manda nada (e não registra execução);
 * 2. quem é o responsável (o do imóvel ou, sem ele, o administrador);
 * 3. quem abriu É o responsável? Não manda e-mail para a própria pessoa (ela já sabe);
 * 4. e-mail + aviso, cada um com a sua chave (request_opened:chamado:usuário, o formato que a
 *    rotina antiga já usou: o que existe é reconhecido e não repete);
 * 5. uma linha na auditoria do chamado (aparece na linha do tempo e no histórico do imóvel)
 *    e uma execução no registro da regra (com erro, se não houve para quem mandar).
 * Erro aqui nunca desfaz o chamado: o pedido já foi gravado e é o que importa para quem pediu.
 */
export function notifyRequestOpened(db: Db, s: Session, r: MaintenanceRequest): void {
  const rule = enabledRule(db, s.org.id, 'request_opened')
  if (!rule) return
  const who = responsibleFor(db, s.org.id, r.property_id, r.assignee_user_id)
  if (!who) {
    recordRun(s, rule, 0, 0, `Chamado ${r.code}: a conta não tem administrador ativo para receber o aviso. Ative um administrador em Configurações.`)
    return
  }
  if (who === s.user.id) return
  const person = profileOf(db, who)
  if (!person) {
    recordRun(s, rule, 0, 0, `Chamado ${r.code}: o responsável não tem perfil de acesso. Confira os usuários em Configurações.`)
    return
  }
  const unit = db.units.find((u) => u.id === r.unit_id)
  const L = lookup(db)
  const where = unit ? unitLabel(L, unit) : ''
  const key = `request_opened:${r.id}:${who}`
  const mail = queueEmail(s, {
    to_email: person.email, to_name: person.name, subject: `Pedido aberto: ${r.code} · ${r.title}`,
    body: `${s.user.full_name} abriu o chamado ${r.code} em ${where} (${MAINTENANCE_CATEGORY[r.category]}, prioridade ${PRIORITY[r.priority].toLowerCase()}). Ele está esperando a triagem.`,
    reason: 'request_opened', entity: 'maintenance_requests', entity_id: r.id, dedupe_key: key,
  })
  const notice = queueNotice(s, { user_id: who, title: `Pedido aberto: ${r.code}`, body: `${r.title} · ${where}`, link: `/manutencao/${r.id}`, dedupe_key: key })
  const created = Number(mail === 'created') + Number(notice === 'created')
  const skipped = Number(mail === 'skipped') + Number(notice === 'skipped')
  // Ação 'update' (e não 'create'): a linha do tempo do chamado trata 'create' como "chamado aberto".
  if (created) audit(s, 'maintenance_requests', r.id, 'update', `E-mail de pedido aberto para ${person.name} (responsável), simulado, e aviso no sistema`)
  recordRun(s, rule, created, skipped, mail === 'no_email' ? `${person.name} está sem e-mail no perfil: o aviso no sistema foi, o e-mail não.` : null)
}

/**
 * Mudou de situação: e-mail para quem pediu (requester_person_id), se a regra "Pedido aberto" está ligada.
 * Não manda quando: o chamado foi aberto pela equipe (não há "quem pediu"), ou quem mudou é a
 * própria pessoa que pediu (o proprietário que aprovou o orçamento já sabe que aprovou).
 * atalho: a chave leva a situação (request_update:chamado:situação:pessoa); um chamado que VOLTA
 * para uma situação (orçamento recusado e refeito) não manda o segundo e-mail daquela situação.
 * Melhorar com um contador de mudanças no chamado, se a equipe pedir.
 */
export function notifyRequestUpdate(db: Db, s: Session, before: MaintenanceRequest, after: MaintenanceRequest): void {
  const rule = enabledRule(db, s.org.id, 'request_opened')
  const pid = after.requester_person_id
  if (!rule || !pid || pid === s.personId) return
  const person = db.people.find((p) => p.id === pid && p.organization_id === s.org.id)
  if (!person) return
  const from = MAINTENANCE_STATUS[before.status]
  const to = MAINTENANCE_STATUS[after.status]
  const mail = queueEmail(s, {
    to_email: person.email, to_name: person.name, subject: `Chamado ${after.code}: ${to}`,
    body: `O chamado ${after.code} (${after.title}) passou de "${from}" para "${to}". Acompanhe pelo portal de ${s.org.name}.`,
    reason: 'request_update', entity: 'maintenance_requests', entity_id: after.id, dedupe_key: `request_update:${after.id}:${after.status}:${pid}`,
  })
  if (mail === 'created') audit(s, 'maintenance_requests', after.id, 'update', `E-mail de atualização para ${person.name} (quem pediu), simulado`)
  recordRun(s, rule, Number(mail === 'created'), Number(mail === 'skipped'), mail === 'no_email' ? `${person.name} está sem e-mail no cadastro: cadastre em Pessoas para ela receber as atualizações do chamado ${after.code}.` : null)
}

/**
 * Próximo código do chamado na conta (CH-0031...).
 * Lê os chamados da ORGANIZAÇÃO inteira, e não só os do escopo: a inquilina não enxerga os
 * chamados dos outros, mas o número dela não pode repetir o deles. Na fase 2 isto é uma
 * sequência do banco por organização (e a tela nunca vê a lista).
 */
function nextCode(db: Db, orgId: Id): string {
  let max = 0
  for (const r of db.maintenance_requests) {
    if (r.organization_id !== orgId) continue
    const m = /^CH-(\d+)$/.exec(r.code)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `CH-${String(max + 1).padStart(4, '0')}`
}

/* ---------------------------------------------------------------- anexos (fotos e documentos) */

const MB = 1024 * 1024
const fileSchema = z.object({
  name: z.string().trim().min(1, 'Arquivo sem nome.').max(120, 'Nome de arquivo longo demais: até 120 caracteres.'),
  size: z.number().int().min(1, 'Arquivo vazio.').max(10 * MB, 'Arquivo acima de 10 MB: reduza antes de anexar.'),
  mime: z.string(),
})
export type FileInfo = z.infer<typeof fileSchema>

/**
 * No modo de demonstração o arquivo NÃO é guardado: só o registro (nome, tipo, tamanho, a quem pertence).
 * Na fase 2 o arquivo vai para o Storage privado no caminho organização/documento/nome.
 */
function attachmentRows(s: Session, requestId: Id, files: FileInfo[], visibleToLessee: boolean): DocumentFile[] {
  const now = nowIso()
  return files.map((f) => {
    const id = newId()
    return {
      id, organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id, deleted_at: null,
      name: f.name, mime: f.mime || 'application/octet-stream', size: f.size, visible_to_owner: true, visible_to_lessee: visibleToLessee,
      property_id: null, unit_id: null, contract_id: null, person_id: null, maintenance_id: requestId, inspection_id: null,
      storage_path: `${s.org.id}/${id}/${f.name}`,
    }
  })
}

/* ---------------------------------------------------------------- leitura */

export interface MaintenanceSummary {
  open: number
  late: number
  awaitingOwner: number
  inProgress: number
  /** Soma dos orçamentos dos chamados concluídos no mês corrente (no fuso da organização). */
  monthCostCents: Cents
  monthDoneCount: number
  /** Imóveis que aparecem nos chamados visíveis (rótulos do filtro "Imóvel"). */
  properties: { value: string; label: string }[]
}

/** Dia (no fuso da organização) em que um instante aconteceu: "2026-12-01T01:00Z" ainda é 30/11 em Brasília. */
function dayOf(at: IsoDateTime, tz: string): IsoDate {
  return todayIn(tz, new Date(at))
}

/** Indicadores do topo da tela de chamados, sobre TUDO o que a sessão enxerga (não só a página). */
export async function maintenanceSummary(s: Session): Promise<MaintenanceSummary> {
  const { db, sc } = await connect(s)
  const rows = toMaintenanceRows(db, sc, s.today)
  const month = monthStart(s.today)
  const doneThisMonth = rows.filter((r) => r.status === 'done' && r.closed_at && monthStart(dayOf(r.closed_at, s.org.timezone)) === month)
  const props = new Map<string, string>()
  for (const r of rows) props.set(r.property_id, r.property_name)
  return {
    open: rows.filter((r) => !CLOSED.includes(r.status)).length,
    late: rows.filter((r) => r.late).length,
    awaitingOwner: rows.filter((r) => r.status === 'awaiting_owner').length,
    inProgress: rows.filter((r) => r.status === 'in_progress').length,
    monthCostCents: doneThisMonth.reduce((a, r) => a + (r.quote_cents ?? 0), 0),
    monthDoneCount: doneThisMonth.length,
    properties: [...props].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
  }
}

export interface TimelineEntry {
  id: string
  at: IsoDateTime
  who: string
  summary: string
}

export interface RequestDetail {
  request: MaintenanceRow
  /** Endereço do imóvel (o prestador precisa saber aonde ir, e só isso do imóvel). */
  address: string
  opened_by: string
  timeline: TimelineEntry[]
  documents: DocumentFile[]
}

/**
 * Chamado com a linha do tempo e os anexos.
 * LINHA DO TEMPO = recorte da auditoria só DESTE chamado, sem o "antes e depois" de cada campo
 * (o detalhe completo da auditoria é só do administrador, regra de LGPD do plano).
 * Chamados dos dados fictícios não têm auditoria: a abertura e o encerramento entram montados
 * a partir das datas do próprio chamado, para a linha do tempo não ficar vazia.
 */
export async function getRequestDetail(s: Session, id: Id): Promise<RequestDetail> {
  const { db, sc } = await connect(s)
  const L = lookup(db)
  const request = toMaintenanceRows(db, sc, s.today, L).find((x) => x.id === id)
  if (!request) throw new AccessError('Chamado não encontrado ou fora do seu acesso.')
  const p = L.property.get(request.property_id)
  const address = p ? `${p.address.street}, ${p.address.number}${p.address.complement ? ` ${p.address.complement}` : ''} · ${p.address.district}, ${p.address.city}` : ''
  const createdBy = request.created_by ? (L.userName.get(request.created_by) ?? null) : null
  const opened_by = request.requester_name ?? createdBy ?? 'Equipe'

  const logs = db.audit_logs
    .filter((a) => a.organization_id === s.org.id && a.entity === 'maintenance_requests' && a.entity_id === id)
    .map((a) => ({ id: a.id, at: a.at, who: a.actor_user_id ? (L.userName.get(a.actor_user_id) ?? 'Sistema') : 'Sistema', summary: a.summary, action: a.action, to: a.changes?.status?.to }))
  const timeline: TimelineEntry[] = logs.map(({ id: lid, at, who, summary }) => ({ id: lid, at, who, summary }))
  if (!logs.some((l) => l.action === 'create')) timeline.push({ id: `${id}:aberto`, at: request.created_at, who: opened_by, summary: 'Chamado aberto' })
  if (request.closed_at && !logs.some((l) => l.to === request.status)) {
    timeline.push({ id: `${id}:fechado`, at: request.closed_at, who: 'Equipe', summary: request.status === 'done' ? 'Chamado concluído' : 'Chamado cancelado' })
  }
  timeline.sort((a, b) => (a.at < b.at ? 1 : -1)) // o mais novo em cima

  const documents = db.documents.filter((d) => d.maintenance_id === id && see.document(sc, d)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  return { request, address, opened_by, timeline, documents }
}

/** Unidades em que a sessão pode abrir chamado (as que enxerga e não estão arquivadas). */
export async function listOpenTargets(s: Session): Promise<{ value: Id; label: string; group: string }[]> {
  const { db, sc } = await connect(s)
  return toUnitRows(db, sc, s.today)
    .filter((u) => !u.deleted_at)
    // Dentro de um imóvel com blocos ou com área de fora (a vaga do estacionamento externo), o código basta.
    .map((u) => ({ value: u.id, label: u.building_id || u.zone ? u.code : u.label, group: u.property_name }))
    .sort((a, b) => a.group.localeCompare(b.group, 'pt-BR') || a.label.localeCompare(b.label, 'pt-BR', { numeric: true }))
}

export interface VendorOption {
  id: Id
  name: string
  /** Atende a categoria do chamado (a tela mostra estes primeiro). */
  fits: boolean
  categories: MaintenanceCategory[]
}

/** Prestadores da conta para atribuir ao chamado (só a equipe escolhe prestador). */
export async function listVendorOptions(s: Session, category: MaintenanceCategory): Promise<VendorOption[]> {
  const { db, sc } = await connect(s)
  if (!sc.all) return []
  return db.people
    .filter((p) => see.person(sc, p) && !p.deleted_at && p.tags.includes('vendor'))
    .map((p) => ({ id: p.id, name: p.name, fits: p.vendor_categories.includes(category), categories: p.vendor_categories }))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || a.name.localeCompare(b.name, 'pt-BR'))
}

/* ---------------------------------------------------------------- abrir chamado */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida: escolha no calendário.')

export const openRequestSchema = z.object({
  unit_id: z.string().min(1, 'Escolha a unidade do problema.'),
  category: z.enum(CATEGORIES, { message: 'Escolha a categoria.' }),
  priority: z.enum(PRIORITIES, { message: 'Escolha a prioridade.' }),
  title: z.string().trim().min(5, 'Resuma o problema em pelo menos 5 letras (ex.: "Vazamento na pia").').max(120, 'Título longo demais: até 120 caracteres.'),
  description: z.string().trim().max(2000, 'Descrição longa demais: até 2.000 caracteres.'),
  photos: z.array(fileSchema.extend({ mime: z.string().regex(/^image\//, 'Só fotos (JPG, PNG, HEIC...).') })).max(5, 'No máximo 5 fotos por chamado.'),
})
export type OpenRequestInput = z.infer<typeof openRequestSchema>

/** O que define um chamado novo (o resto, código, situação e datas, sai de createRequestRow). */
export interface NewRequestFields {
  /** null = área comum do imóvel (aí property_id é obrigatório). */
  unit: Unit | null
  property_id?: Id
  category: MaintenanceCategory
  priority: MaintenancePriority
  title: string
  description: string
  requester_person_id: Id | null
  vendor_person_id: Id | null
  due_date: IsoDate
}

/**
 * Grava o chamado novo e a linha "aberto" da auditoria. É A função de abrir chamado do módulo:
 * a tela (openRequest) e a rotina de manutenção (rotinas.ts) passam por ela, para o código CH-,
 * a situação inicial e a auditoria saírem sempre do mesmo jeito.
 * Não confere permissão nem escopo: isso é de quem chama (openRequest confere; a rotina roda
 * como sistema, a partir da regra ligada pela equipe).
 */
export function createRequestRow(db: Db, s: Session, f: NewRequestFields, summary: string): MaintenanceRequest {
  const now = nowIso()
  const r: MaintenanceRequest = {
    id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id,
    code: nextCode(db, s.org.id), unit_id: f.unit?.id ?? null, property_id: f.unit?.property_id ?? f.property_id!, requester_person_id: f.requester_person_id,
    category: f.category, priority: f.priority, title: f.title, description: f.description,
    status: 'open', vendor_person_id: f.vendor_person_id, assignee_user_id: null, due_date: f.due_date,
    quote_cents: null, quote_status: 'none', quote_decided_by: null, charged_to: null, closed_at: null,
  }
  upsertRows('maintenance_requests', [r])
  audit(s, 'maintenance_requests', r.id, 'create', summary)
  return r
}

/**
 * Abre um chamado. Quem pode: equipe, proprietário (nas unidades dele) e inquilino (na dele).
 * Passo a passo: permissão -> validação -> a unidade está no escopo? -> grava o chamado
 * (createRequestRow) e o registro das fotos -> e-mail e aviso ao responsável (se a regra está ligada).
 */
export async function openRequest(s: Session, input: OpenRequestInput): Promise<MaintenanceRequest> {
  const { db, sc } = await connect(s)
  if (!can(s, 'maintenance:open')) throw new AccessError('O seu papel não abre chamados.')
  const data = parseInput(openRequestSchema, input)
  const unit = db.units.find((u) => u.id === data.unit_id)
  if (!unit || !see.unit(sc, unit) || unit.deleted_at) throw new RuleError('A unidade escolhida não existe mais ou está fora do seu acesso. Escolha outra na lista.')
  const r = createRequestRow(
    db, s,
    {
      unit, category: data.category, priority: data.priority, title: data.title, description: data.description,
      // Pessoa que pediu: no portal é a pessoa do login; a equipe abre "em nome da casa" (fica em created_by).
      requester_person_id: sc.all ? null : s.personId, vendor_person_id: null,
      due_date: addDays(s.today, DUE_DAYS_BY_PRIORITY[data.priority]),
    },
    `Chamado aberto: ${data.title} (${MAINTENANCE_CATEGORY[data.category]}, prioridade ${PRIORITY[data.priority].toLowerCase()})`,
  )
  // Foto de quem abriu: proprietário e inquilino veem (é o relato deles).
  if (data.photos.length) upsertRows('documents', attachmentRows(s, r.id, data.photos, true))
  notifyRequestOpened(db, s, r)
  return r
}

/* ---------------------------------------------------------------- equipe: triagem, prestador, orçamento */

export const triageSchema = z.object({
  id: z.string(),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  due_date: isoDate,
})
export type TriageInput = z.infer<typeof triageSchema>

/** Triagem: a equipe confere categoria, prioridade e prazo, e quem triou vira o responsável. */
export async function triageRequest(s: Session, input: TriageInput): Promise<MaintenanceRequest> {
  const data = parseInput(triageSchema, input)
  const { sc, r } = await loadRequest(s, data.id)
  requireTeamEdit(s, sc)
  expectStatus(r, ['open'], 'fazer a triagem')
  if (data.due_date < s.today) throw new RuleError('O prazo ficou antes de hoje: escolha hoje ou uma data depois.')
  return commit(s, r, { status: 'triage', category: data.category, priority: data.priority, due_date: data.due_date, assignee_user_id: s.user.id }, 'status', `Triagem feita: ${MAINTENANCE_CATEGORY[data.category]}, prioridade ${PRIORITY[data.priority].toLowerCase()}`)
}

export const assignVendorSchema = z.object({ id: z.string(), vendor_person_id: z.string().min(1, 'Escolha o prestador.') })

/** Atribui (ou troca) o prestador. Da triagem, o chamado passa a esperar o orçamento dele. */
export async function assignVendor(s: Session, input: z.infer<typeof assignVendorSchema>): Promise<MaintenanceRequest> {
  const data = parseInput(assignVendorSchema, input)
  const { db, sc, r } = await loadRequest(s, data.id)
  requireTeamEdit(s, sc)
  expectStatus(r, ['triage', 'quote'], 'atribuir o prestador')
  const vendor = db.people.find((p) => p.id === data.vendor_person_id)
  if (!vendor || !see.person(sc, vendor) || vendor.deleted_at || !vendor.tags.includes('vendor')) throw new RuleError('Prestador não encontrado nesta conta. Cadastre em Pessoas com o papel "Prestador".')
  const swap = r.vendor_person_id && r.vendor_person_id !== vendor.id
  return commit(s, r, { vendor_person_id: vendor.id, status: 'quote' }, r.status === 'triage' ? 'status' : 'update', swap ? `Prestador trocado para ${vendor.name}` : `Prestador atribuído: ${vendor.name}. Aguardando orçamento.`)
}

export const quoteSchema = z.object({
  id: z.string(),
  quote_cents: z.number().int().positive('O orçamento precisa ser maior que zero.').max(100_000_000, 'Valor acima de R$ 1 milhão: confira os zeros.'),
  charged_to: z.enum(CHARGED_OPTIONS, { message: 'Diga quem paga o serviço.' }),
})
export type QuoteInput = z.infer<typeof quoteSchema>

/**
 * Registra o orçamento do prestador e quem paga.
 * Acima do limite (na imobiliária) vai para "Aguardando proprietário"; até ele, fica aprovado
 * na hora, com a equipe como quem decidiu.
 */
export async function registerQuote(s: Session, input: QuoteInput): Promise<MaintenanceRequest> {
  const data = parseInput(quoteSchema, input)
  const { sc, r } = await loadRequest(s, data.id)
  requireTeamEdit(s, sc)
  expectStatus(r, ['quote'], 'registrar o orçamento')
  if (!r.vendor_person_id) throw new RuleError('Atribua o prestador antes de registrar o orçamento: o orçamento é dele.')
  const value = formatBRL(data.quote_cents)
  if (needsOwnerApproval(s.org.kind, data.quote_cents)) {
    return commit(s, r, { quote_cents: data.quote_cents, charged_to: data.charged_to, quote_status: 'pending', quote_decided_by: null, status: 'awaiting_owner' }, 'status', `Orçamento de ${value} registrado (paga: ${CHARGED_TO[data.charged_to].toLowerCase()}). Acima de ${formatBRL(OWNER_APPROVAL_ABOVE_CENTS)}: aguardando o proprietário.`)
  }
  return commit(s, r, { quote_cents: data.quote_cents, charged_to: data.charged_to, quote_status: 'approved', quote_decided_by: s.user.id, status: 'approved' }, 'status', `Orçamento de ${value} registrado e aprovado direto (até ${formatBRL(OWNER_APPROVAL_ABOVE_CENTS)}; paga: ${CHARGED_TO[data.charged_to].toLowerCase()}).`)
}

/* ---------------------------------------------------------------- proprietário: aprovar ou recusar */

export const decideSchema = z
  .object({ id: z.string(), approve: z.boolean(), comment: z.string().trim().max(500, 'Comentário longo demais: até 500 caracteres.') })
  .refine((d) => d.approve || d.comment.length >= 5, { message: 'Ao recusar, diga o motivo (pelo menos 5 letras): a equipe usa isso para buscar outro orçamento.', path: ['comment'] })
export type DecideInput = z.infer<typeof decideSchema>

/**
 * Aprovar ou recusar o orçamento. Quem pode: o proprietário (só nas unidades dele, o escopo
 * garante) e o administrador (registrando a resposta que o proprietário deu por telefone ou e-mail).
 * Recusado, o chamado volta para "Orçamento": a equipe pede outro ou cancela.
 */
export async function decideQuote(s: Session, input: DecideInput): Promise<MaintenanceRequest> {
  const data = parseInput(decideSchema, input)
  const { r } = await loadRequest(s, data.id)
  if (!can(s, 'quotes:approve')) throw new AccessError('Só o proprietário (ou o administrador por ele) aprova orçamento.')
  expectStatus(r, ['awaiting_owner'], data.approve ? 'aprovar o orçamento' : 'recusar o orçamento')
  const value = formatBRL(r.quote_cents ?? 0)
  const note = data.comment ? `: "${data.comment}"` : ''
  if (data.approve) return commit(s, r, { status: 'approved', quote_status: 'approved', quote_decided_by: s.user.id }, 'status', `Orçamento de ${value} aprovado${note}`)
  return commit(s, r, { status: 'quote', quote_status: 'rejected', quote_decided_by: s.user.id }, 'status', `Orçamento de ${value} recusado${note}`)
}

/* ---------------------------------------------------------------- prestador e equipe: executar e concluir */

/** Prestador avisa que começou o serviço (só o atribuído: o escopo dele só tem os chamados dele). */
export async function startWork(s: Session, input: { id: Id }): Promise<MaintenanceRequest> {
  const { r } = await loadRequest(s, input.id)
  if (!can(s, 'maintenance:work')) throw new AccessError('Só o prestador atribuído inicia a execução.')
  expectStatus(r, ['approved'], 'iniciar a execução')
  return commit(s, r, { status: 'in_progress' }, 'status', 'Execução iniciada pelo prestador')
}

export const completeSchema = z.object({ id: z.string(), note: z.string().trim().min(5, 'Conte em poucas palavras o que foi feito (pelo menos 5 letras).').max(1000, 'Observação longa demais: até 1.000 caracteres.') })
export type CompleteInput = z.infer<typeof completeSchema>

/**
 * Conclui o chamado. Prestador conclui o que está "Em execução"; a equipe também conclui o que
 * está "Aprovado" (serviço feito sem o prestador usar o portal).
 * Com orçamento e quem paga = proprietário ou imobiliária, nasce a CONTA A PAGAR ao prestador
 * (como o gerador faz). Quem paga = inquilino: ele acerta direto com o prestador, sem conta.
 * Devolve o chamado e a conta criada (ou null), para a tela dizer o que aconteceu.
 */
export async function completeRequest(s: Session, input: CompleteInput): Promise<{ request: MaintenanceRequest; payable: FinancialEntry | null }> {
  const data = parseInput(completeSchema, input)
  const { db, sc, r } = await loadRequest(s, data.id)
  const vendorActing = !sc.all && can(s, 'maintenance:work')
  if (vendorActing) expectStatus(r, ['in_progress'], 'concluir o serviço')
  else {
    requireTeamEdit(s, sc)
    expectStatus(r, ['approved', 'in_progress'], 'concluir')
  }
  if (r.quote_cents && !r.charged_to) throw new RuleError('Defina quem paga (proprietário, inquilino ou imobiliária) antes de concluir: é isso que decide a conta a pagar.')
  const request = commit(s, r, { status: 'done', closed_at: nowIso() }, 'status', `${vendorActing ? 'Serviço concluído pelo prestador' : 'Chamado concluído'}: ${data.note}`)

  let payable: FinancialEntry | null = null
  if (r.quote_cents && r.vendor_person_id && (r.charged_to === 'owner' || r.charged_to === 'agency')) {
    // Conta a pagar ao prestador. Quem grava é o sistema (na fase 2, um gatilho do banco), por isso
    // vale até quando quem concluiu é o prestador, que não enxerga o financeiro.
    const now = nowIso()
    payable = {
      id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id,
      direction: 'payable', category: 'maintenance', description: `${r.code}: ${r.title}`, contract_id: null,
      unit_id: r.unit_id, property_id: r.property_id, person_id: r.vendor_person_id, competence: monthStart(s.today),
      due_date: addDays(s.today, PAYABLE_DUE_DAYS), amount_cents: r.quote_cents, charged_to: r.charged_to,
      status: 'open', recurrence_group: null, transfer_id: null, import_batch_id: null,
    }
    upsertRows('financial_entries', [payable])
    const vendorName = db.people.find((p) => p.id === r.vendor_person_id)?.name ?? 'prestador'
    audit(s, 'financial_entries', payable.id, 'create', `Conta a pagar de ${formatBRL(payable.amount_cents)} a ${vendorName}, do chamado ${r.code} (paga: ${CHARGED_TO[r.charged_to].toLowerCase()})`)
  }
  return { request, payable }
}

/* ---------------------------------------------------------------- equipe: cancelar, quem paga, anexar */

export const cancelSchema = z.object({ id: z.string(), reason: z.string().trim().min(5, 'Diga o motivo do cancelamento (pelo menos 5 letras).').max(500, 'Motivo longo demais: até 500 caracteres.') })

/** Cancela com motivo (o chamado não é apagado: fica na lista como "Cancelado", com a história). */
export async function cancelRequest(s: Session, input: z.infer<typeof cancelSchema>): Promise<MaintenanceRequest> {
  const data = parseInput(cancelSchema, input)
  const { sc, r } = await loadRequest(s, data.id)
  requireTeamEdit(s, sc)
  if (CLOSED.includes(r.status)) throw new RuleError(`O chamado ${r.code} já está "${MAINTENANCE_STATUS[r.status]}": não dá para cancelar.`)
  return commit(s, r, { status: 'canceled', closed_at: nowIso() }, 'status', `Chamado cancelado: ${data.reason}`)
}

export const chargedSchema = z.object({ id: z.string(), charged_to: z.enum(CHARGED_OPTIONS, { message: 'Escolha quem paga.' }) })

/** Define (ou troca) quem paga. Depois de concluído não muda: a conta a pagar já foi lançada. */
export async function setChargedTo(s: Session, input: z.infer<typeof chargedSchema>): Promise<MaintenanceRequest> {
  const data = parseInput(chargedSchema, input)
  const { sc, r } = await loadRequest(s, data.id)
  requireTeamEdit(s, sc)
  if (CLOSED.includes(r.status)) throw new RuleError('Chamado encerrado: a conta a pagar já foi lançada. Ajuste o lançamento no Financeiro.')
  return commit(s, r, { charged_to: data.charged_to }, 'update', `Quem paga: ${CHARGED_TO[data.charged_to].toLowerCase()}`)
}

export const attachSchema = z.object({ id: z.string(), files: z.array(fileSchema).min(1, 'Escolha pelo menos um arquivo.').max(10, 'No máximo 10 arquivos de uma vez.') })

/** A equipe anexa orçamento, nota ou foto ao chamado (o proprietário vê; o inquilino, não). */
export async function attachToRequest(s: Session, input: z.infer<typeof attachSchema>): Promise<number> {
  const data = parseInput(attachSchema, input)
  const { sc, r } = await loadRequest(s, data.id)
  requireTeamEdit(s, sc)
  const rows = attachmentRows(s, r.id, data.files, false)
  upsertRows('documents', rows)
  audit(s, 'maintenance_requests', r.id, 'update', `Anexou ${rows.length === 1 ? `"${rows[0].name}"` : `${rows.length} arquivos`}`)
  return rows.length
}
