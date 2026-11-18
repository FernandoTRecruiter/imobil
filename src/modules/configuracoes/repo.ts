/* =============================================================================
   Configurações: o repositório da conta (empresa, usuários e convites, permissões dos
   colaboradores, carteiras, situações e cores, auditoria).

   Quem entra: só o administrador (settings:manage). O colaborador nunca recebe essa
   permissão (ver GRANTABLE): é a matriz F do plano ("Configurações, usuários, auditoria:
   admin sim, colaborador não").

   Tabelas sem regra em scope.ts (memberships, invitations, portfolios, unit_status_config,
   audit_logs): o filtro é organization_id === s.org.id, escrito aqui em cada leitura. Na
   fase 2 cada uma ganha a política de RLS "is_admin(org)".

   Ordem de toda gravação: permissão -> zod -> regra (RuleError com causa e conserto) ->
   upsertRows -> audit com o antes e depois (diff).
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { hasFeature } from '@/auth/permissions'
import { AccessError, audit, connect, diff, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { ROLE, UNIT_STATUS } from '@/data/labels'
import { runList, type ListParams, type ListResult } from '@/data/query'
import { see } from '@/data/scope'
import { deleteRows, upsertRows } from '@/data/store'
import type { AuditLog, Id, Invitation, Membership, Organization, Permission, Portfolio, Role, UnitStatus, UnitStatusConfig } from '@/data/types'
import { addDays, daysBetween, formatDate, todayIn } from '@/lib/dates'
import { documentError, normalizeDocument } from '@/lib/documents'
import { newId } from '@/lib/random'
import { normalize } from '@/lib/text'
import { AUDIT_ACTION_LABEL, changesText, describeChanges, entityLabel, type ChangeLine, type NameBook } from './auditoria'

/* ---------------------------------------------------------------- portas */

/** Configurações são do administrador. Checar o PAPEL (e não só a permissão) fecha a porta de um colaborador com a permissão gravada por engano. */
function requireAdmin(s: Session): void {
  if (!s.roles.includes('admin')) throw new AccessError('Configurações, usuários e auditoria são só do administrador da conta.')
}

function check<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data)
  if (!r.success) throw new RuleError(r.error.issues[0]?.message ?? 'Valor inválido.')
  return r.data
}

const HEX = /^#[0-9a-fA-F]{6}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function names(db: Db, orgId: Id): NameBook {
  return {
    user: new Map(db.profiles.map((p) => [p.id, p.full_name])),
    portfolio: new Map(db.portfolios.filter((p) => p.organization_id === orgId).map((p) => [p.id, p.name])),
    person: new Map(db.people.filter((p) => p.organization_id === orgId).map((p) => [p.id, p.name])),
  }
}

/* ---------------------------------------------------------------- empresa */

/** Fusos do Brasil pelo NOME (não "-03:00" fixo: o nome acompanha se o horário de verão voltar). */
export const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'Brasília (SP, RJ, MG, ES, Sul, GO, DF), UTC-3' },
  { value: 'America/Bahia', label: 'Bahia, UTC-3' },
  { value: 'America/Fortaleza', label: 'CE, RN, PB, PI e MA, UTC-3' },
  { value: 'America/Recife', label: 'Pernambuco, UTC-3' },
  { value: 'America/Maceio', label: 'Alagoas e Sergipe, UTC-3' },
  { value: 'America/Belem', label: 'Pará e Amapá, UTC-3' },
  { value: 'America/Araguaina', label: 'Tocantins, UTC-3' },
  { value: 'America/Campo_Grande', label: 'Mato Grosso do Sul, UTC-4' },
  { value: 'America/Cuiaba', label: 'Mato Grosso, UTC-4' },
  { value: 'America/Manaus', label: 'Amazonas, UTC-4' },
  { value: 'America/Porto_Velho', label: 'Rondônia, UTC-4' },
  { value: 'America/Boa_Vista', label: 'Roraima, UTC-4' },
  { value: 'America/Rio_Branco', label: 'Acre, UTC-5' },
  { value: 'America/Noronha', label: 'Fernando de Noronha, UTC-2' },
] as const
const TZ_VALUES = TIMEZONES.map((t) => t.value) as [string, ...string[]]

export const PLAN_LABEL: Record<Organization['plan'], string> = { starter: 'Essencial', pro: 'Profissional' }

export const companySchema = z.object({
  name: z.string().trim().min(2, 'Nome com menos de 2 letras: escreva o nome da empresa ou o seu.').max(120, 'Nome acima de 120 caracteres: encurte.'),
  document: z.string().superRefine((v, ctx) => {
    const e = documentError(v)
    if (e) ctx.addIssue({ code: 'custom', message: e })
  }),
  timezone: z.enum(TZ_VALUES, { error: 'Escolha um fuso da lista.' }),
  brand_color: z.string().trim().regex(HEX, 'Cor no formato #RRGGBB (ex.: #2B59C3).'),
})
export type CompanyInput = z.infer<typeof companySchema>

export async function getCompany(s: Session): Promise<Organization> {
  requireAdmin(s)
  const { db } = await connect(s)
  const org = db.organizations.find((o) => o.id === s.org.id)
  if (!org) throw new AccessError()
  return org
}

export async function saveCompany(s: Session, input: CompanyInput): Promise<Organization> {
  requireAdmin(s)
  const { db } = await connect(s)
  const data = check(companySchema, input)
  const org = db.organizations.find((o) => o.id === s.org.id)
  if (!org) throw new AccessError()
  // O plano NÃO entra aqui: ele muda pela cobrança da assinatura, não por formulário.
  const after: Organization = { ...org, name: data.name, document: normalizeDocument(data.document), timezone: data.timezone, brand_color: data.brand_color.toLowerCase() }
  const changes = diff(org, after)
  if (!changes) return org
  upsertRows('organizations', [after])
  audit(s, 'organizations', org.id, 'update', `Alterou os dados da empresa (${changesText(changes, names(db, s.org.id))})`, changes)
  return after
}

/* ---------------------------------------------------------------- contraste (situações e cor da marca) */

/** Luminância relativa da WCAG: o quanto a cor "acende" (0 = preto, 1 = branco). */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/**
 * Contraste entre duas cores (1 a 21). A WCAG pede pelo menos 3:1 para forma e texto grande
 * (o selo do mapa com o número dentro) e 4,5:1 para texto comum.
 */
export function contrastRatio(a: string, b = '#ffffff'): number {
  if (!HEX.test(a) || !HEX.test(b)) return 1
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100
}

/* ---------------------------------------------------------------- usuários */

export interface MemberRow {
  id: Id
  user_id: Id
  name: string
  email: string
  role: Role
  status: Membership['status']
  person_id: Id | null
  person_name: string | null
  permissions: Permission[]
  created_at: string
  is_me: boolean
}

function memberRows(db: Db, s: Session): MemberRow[] {
  const profile = new Map(db.profiles.map((p) => [p.id, p]))
  const person = new Map(db.people.filter((p) => p.organization_id === s.org.id).map((p) => [p.id, p.name]))
  return db.memberships
    .filter((m) => m.organization_id === s.org.id)
    .map((m) => ({
      id: m.id, user_id: m.user_id, name: profile.get(m.user_id)?.full_name ?? 'Usuário', email: profile.get(m.user_id)?.email ?? '', role: m.role, status: m.status,
      person_id: m.person_id, person_name: m.person_id ? (person.get(m.person_id) ?? null) : null, permissions: m.permissions, created_at: m.created_at, is_me: m.user_id === s.user.id,
    }))
}

const ROLE_ORDER: Role[] = ['admin', 'staff', 'owner', 'lessee', 'vendor']

/** Filtros: role, status. Ordens: name, role, status, created_at. */
export async function listMembers(s: Session, params: ListParams): Promise<ListResult<MemberRow>> {
  requireAdmin(s)
  const { db } = await connect(s)
  return runList(memberRows(db, s), params, {
    search: (r) => [r.name, r.email, r.person_name],
    filters: { role: (r) => r.role, status: (r) => r.status },
    sorts: { name: (r) => r.name, role: (r) => ROLE_ORDER.indexOf(r.role), status: (r) => r.status, created_at: (r) => r.created_at },
    defaultSort: (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, 'pt-BR'),
  })
}

/**
 * Desativa ou reativa um acesso. Duas travas, nesta ordem:
 * 1. o último administrador ativo não sai (a conta ficaria sem ninguém para gerenciá-la);
 * 2. ninguém desativa o próprio acesso (evita se trancar do lado de fora sem querer).
 */
export async function setMemberStatus(s: Session, args: { id: Id; status: 'active' | 'disabled' }): Promise<Membership> {
  requireAdmin(s)
  const { db } = await connect(s)
  const m = db.memberships.find((x) => x.id === args.id && x.organization_id === s.org.id)
  if (!m) throw new AccessError('Acesso não encontrado nesta conta.')
  const who = db.profiles.find((p) => p.id === m.user_id)?.full_name ?? 'Usuário'
  if (args.status === 'disabled') {
    if (m.status === 'disabled') throw new RuleError(`O acesso de ${who} já está desativado.`)
    const otherAdmins = db.memberships.filter((x) => x.organization_id === s.org.id && x.role === 'admin' && x.status === 'active' && x.id !== m.id)
    if (m.role === 'admin' && otherAdmins.length === 0)
      throw new RuleError(`${who} é o último administrador ativo: a conta ficaria sem ninguém para gerenciá-la. Convide ou reative outro administrador antes.`)
    if (m.user_id === s.user.id) throw new RuleError('Você não pode desativar o próprio acesso: peça a outro administrador.')
  } else if (m.status === 'active') {
    throw new RuleError(`O acesso de ${who} já está ativo.`)
  }
  const after: Membership = { ...m, status: args.status }
  upsertRows('memberships', [after])
  audit(s, 'memberships', m.id, 'status', `${args.status === 'disabled' ? 'Desativou' : 'Reativou'} o acesso de ${who} (${ROLE[m.role]})`, diff(m, after))
  return after
}

/* ---------------------------------------------------------------- convites */

export interface InvitationRow extends Invitation {
  person_name: string | null
  invited_by: string
}

const isPending = (i: Invitation, now: number) => !i.accepted_at && Date.parse(i.expires_at) > now

/** Convites pendentes (não aceitos e ainda dentro da validade), do mais novo para o mais velho. */
export async function listInvitations(s: Session): Promise<InvitationRow[]> {
  requireAdmin(s)
  const { db } = await connect(s)
  const now = Date.now()
  const person = new Map(db.people.filter((p) => p.organization_id === s.org.id).map((p) => [p.id, p.name]))
  const user = new Map(db.profiles.map((p) => [p.id, p.full_name]))
  return db.invitations
    .filter((i) => i.organization_id === s.org.id && isPending(i, now))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((i) => ({ ...i, person_name: i.person_id ? (person.get(i.person_id) ?? null) : null, invited_by: i.created_by ? (user.get(i.created_by) ?? 'Usuário') : 'Sistema' }))
}

/** Papéis que esta conta convida: o proprietário independente não tem equipe nem portal do proprietário. */
export function invitableRoles(s: Session): Role[] {
  return hasFeature(s, 'team') ? ['admin', 'staff', 'owner', 'lessee', 'vendor'] : ['lessee', 'vendor']
}

export const PORTAL_ROLES: Role[] = ['owner', 'lessee', 'vendor']

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().regex(EMAIL_RE, 'E-mail incompleto: use nome@exemplo.com.br.'),
  role: z.enum(['admin', 'staff', 'owner', 'lessee', 'vendor'], { error: 'Escolha o papel do convidado.' }),
  person_id: z.string().nullable(),
})
export type InviteInput = z.infer<typeof inviteSchema>

/** Pessoas que podem ser ligadas a um convite de portal, com o motivo quando não podem. */
export async function listInvitablePeople(s: Session, role: Role): Promise<{ id: Id; name: string; reason: string | null }[]> {
  requireAdmin(s)
  const { db, sc } = await connect(s)
  return db.people
    .filter((p) => see.person(sc, p) && !p.deleted_at)
    .map((p) => ({ id: p.id, name: p.name, reason: personRoleBlock(db, s, p.id, role) }))
    .sort((a, b) => Number(!!a.reason) - Number(!!b.reason) || a.name.localeCompare(b.name, 'pt-BR'))
}

/** A pessoa combina com o papel do portal? (é dona de algo, locatária em contrato, prestadora). */
function personRoleBlock(db: Db, s: Session, personId: Id, role: Role): string | null {
  const p = db.people.find((x) => x.id === personId)
  if (!p) return 'pessoa não encontrada'
  if (role === 'owner' && !db.property_owners.some((o) => o.organization_id === s.org.id && o.person_id === personId && (!o.until || o.until >= s.today)))
    return `${p.name} não é proprietário de nenhum imóvel: ligue a pessoa a um imóvel antes de convidar como proprietário`
  if (role === 'lessee' && !db.contract_parties.some((cp) => cp.organization_id === s.org.id && cp.person_id === personId && cp.role === 'lessee'))
    return `${p.name} não é locatário em nenhum contrato: cadastre o contrato antes de convidar como inquilino`
  if (role === 'vendor' && !p.tags.includes('vendor')) return `${p.name} não está marcado como prestador: marque o papel "Prestador" no cadastro antes`
  return null
}

export async function inviteUser(s: Session, input: InviteInput): Promise<Invitation> {
  requireAdmin(s)
  const { db, sc } = await connect(s)
  const data = check(inviteSchema, input)
  if (!invitableRoles(s).includes(data.role)) throw new RuleError(`Conta de proprietário não convida ${ROLE[data.role].toLowerCase()}: só inquilino e prestador têm portal aqui.`)
  const portal = PORTAL_ROLES.includes(data.role)
  const personId = portal ? data.person_id : null
  if (portal) {
    if (!personId) throw new RuleError('Para o portal, ligue o convite a uma pessoa do cadastro: é ela que define o que o convidado vai ver.')
    const p = db.people.find((x) => x.id === personId)
    if (!p || !see.person(sc, p) || p.deleted_at) throw new RuleError('A pessoa escolhida não existe nesta conta ou está arquivada.')
    const block = personRoleBlock(db, s, personId, data.role)
    if (block) throw new RuleError(`${block}.`)
  }
  // Mesmo e-mail com o MESMO papel: já tem acesso ou já foi convidado. Papel diferente pode (dono de um imóvel e inquilino de outro).
  const profile = db.profiles.find((p) => p.email.toLowerCase() === data.email)
  const same = profile && db.memberships.find((m) => m.organization_id === s.org.id && m.user_id === profile.id && m.role === data.role)
  if (same?.status === 'active') throw new RuleError(`Esse e-mail já é ${ROLE[data.role].toLowerCase()} com acesso ativo nesta conta.`)
  if (same?.status === 'disabled') throw new RuleError('Esse acesso existe e está desativado: reative na lista de usuários em vez de convidar de novo.')
  const now = Date.now()
  const pending = db.invitations.find((i) => i.organization_id === s.org.id && i.email.toLowerCase() === data.email && i.role === data.role && isPending(i, now))
  if (pending) throw new RuleError(`Já existe convite pendente para esse e-mail como ${ROLE[data.role].toLowerCase()} (vence em ${formatDate(pending.expires_at.slice(0, 10))}): revogue antes de mandar outro.`)
  const at = nowIso()
  const inv: Invitation = {
    id: newId(), organization_id: s.org.id, created_at: at, updated_at: at, created_by: s.user.id,
    email: data.email, role: data.role, person_id: personId,
    // Validade de 7 dias. Na fase 2 o código do convite fica guardado só como hash e o e-mail sai por SMTP próprio.
    expires_at: `${addDays(s.today, 7)}T23:59:59-03:00`, accepted_at: null,
  }
  upsertRows('invitations', [inv])
  audit(s, 'invitations', inv.id, 'create', `Convidou ${inv.email} como ${ROLE[inv.role].toLowerCase()}`)
  return inv
}

/** Revogar = vencer agora: o link do convite deixa de valer e a linha fica para a história. */
export async function revokeInvitation(s: Session, id: Id): Promise<Invitation> {
  requireAdmin(s)
  const { db } = await connect(s)
  const inv = db.invitations.find((i) => i.id === id && i.organization_id === s.org.id)
  if (!inv) throw new AccessError('Convite não encontrado nesta conta.')
  if (!isPending(inv, Date.now())) throw new RuleError('Esse convite não está mais pendente (já foi aceito ou venceu).')
  const at = nowIso()
  const after: Invitation = { ...inv, expires_at: at, updated_at: at }
  upsertRows('invitations', [after])
  audit(s, 'invitations', inv.id, 'update', `Revogou o convite de ${inv.email}`, diff(inv, after))
  return after
}

/* ---------------------------------------------------------------- papéis e permissões */

/** Módulos e ações que o administrador libera ao colaborador ("Ver" vem junto com "Editar" e "Aprovar"). */
export const PERMISSION_GROUPS: { module: string; items: { perm: Permission; label: string; needs?: Permission }[]; feature?: 'transfers' }[] = [
  { module: 'Imóveis e unidades', items: [{ perm: 'properties:view', label: 'Ver' }, { perm: 'properties:edit', label: 'Editar', needs: 'properties:view' }] },
  { module: 'Pessoas', items: [{ perm: 'people:view', label: 'Ver' }, { perm: 'people:edit', label: 'Editar', needs: 'people:view' }] },
  { module: 'Contratos', items: [{ perm: 'contracts:view', label: 'Ver' }, { perm: 'contracts:edit', label: 'Editar', needs: 'contracts:view' }, { perm: 'contracts:approve', label: 'Aprovar', needs: 'contracts:view' }] },
  { module: 'Financeiro', items: [{ perm: 'finance:view', label: 'Ver' }, { perm: 'finance:edit', label: 'Editar e dar baixa', needs: 'finance:view' }] },
  { module: 'Repasses', feature: 'transfers', items: [{ perm: 'transfers:approve', label: 'Aprovar repasse', needs: 'finance:view' }] },
  { module: 'Manutenção', items: [{ perm: 'maintenance:view', label: 'Ver' }, { perm: 'maintenance:edit', label: 'Editar', needs: 'maintenance:view' }] },
  { module: 'Processos', items: [{ perm: 'workflows:view', label: 'Ver' }, { perm: 'workflows:edit', label: 'Editar', needs: 'workflows:view' }] },
  { module: 'Dados', items: [{ perm: 'data:import', label: 'Importar e editar em massa' }] },
  { module: 'Relatórios', items: [{ perm: 'reports:view', label: 'Ver' }] },
]
/** Tudo o que pode ser liberado. "settings:manage" fica de fora DE PROPÓSITO (matriz F: só o admin). */
export const GRANTABLE: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.perm))
const NEEDS = new Map(PERMISSION_GROUPS.flatMap((g) => g.items.filter((i) => i.needs).map((i) => [i.perm, i.needs!] as const)))
export const PERMISSION_LABEL: Record<string, string> = Object.fromEntries(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => [i.perm, `${g.module}: ${i.label.toLowerCase()}`])))

/** Completa as dependências (editar traz ver) e põe na ordem da lista: a mesma escolha vira sempre a mesma lista. */
export function normalizePermissions(perms: Permission[]): Permission[] {
  const set = new Set(perms)
  for (const p of [...set]) {
    const need = NEEDS.get(p)
    if (need) set.add(need)
  }
  return GRANTABLE.filter((p) => set.has(p))
}

/** Colaboradores (staff) da conta, com as permissões de hoje. */
export async function listStaffPermissions(s: Session): Promise<MemberRow[]> {
  requireAdmin(s)
  if (!hasFeature(s, 'team')) return []
  const { db } = await connect(s)
  return memberRows(db, s)
    .filter((m) => m.role === 'staff')
    .sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || a.name.localeCompare(b.name, 'pt-BR'))
}

const permissionsSchema = z.object({
  changes: z
    .array(z.object({ membershipId: z.string().min(1), permissions: z.array(z.string()) }))
    .min(1, 'Nada mudou: marque ou desmarque alguma permissão antes de salvar.'),
})

export async function saveStaffPermissions(s: Session, input: { changes: { membershipId: Id; permissions: string[] }[] }): Promise<number> {
  requireAdmin(s)
  if (!hasFeature(s, 'team')) throw new RuleError('Conta de proprietário não tem colaboradores.')
  const { db } = await connect(s)
  const data = check(permissionsSchema, input)
  const out: Membership[] = []
  const logs: [Membership, Membership, string][] = []
  for (const ch of data.changes) {
    const m = db.memberships.find((x) => x.id === ch.membershipId && x.organization_id === s.org.id)
    if (!m) throw new AccessError('Acesso não encontrado nesta conta.')
    const who = db.profiles.find((p) => p.id === m.user_id)?.full_name ?? 'Usuário'
    if (m.role !== 'staff') throw new RuleError(`${who} é ${ROLE[m.role].toLowerCase()}: permissão por módulo vale só para colaborador (o administrador já tem todas).`)
    if (ch.permissions.includes('settings:manage')) throw new RuleError('Configurações, usuários e auditoria são só do administrador: não dá para liberar a um colaborador.')
    const unknown = ch.permissions.find((p) => !GRANTABLE.includes(p as Permission))
    if (unknown) throw new RuleError(`Permissão "${unknown}" não existe.`)
    if (ch.permissions.includes('transfers:approve') && !hasFeature(s, 'transfers')) throw new RuleError('Repasse só existe na conta de imobiliária.')
    const after: Membership = { ...m, permissions: normalizePermissions(ch.permissions as Permission[]) }
    if (!diff(m, after)) continue
    out.push(after)
    const added = after.permissions.filter((p) => !m.permissions.includes(p)).map((p) => `+${PERMISSION_LABEL[p]}`)
    const removed = m.permissions.filter((p) => !after.permissions.includes(p)).map((p) => `-${PERMISSION_LABEL[p] ?? p}`)
    logs.push([m, after, `Mudou as permissões de ${who}: ${[...added, ...removed].join(', ')}`])
  }
  if (!out.length) throw new RuleError('Nada mudou: as permissões escolhidas já eram as de antes.')
  upsertRows('memberships', out)
  for (const [m, after, summary] of logs) audit(s, 'memberships', m.id, 'update', summary, diff(m, after))
  return out.length
}

/* ---------------------------------------------------------------- carteiras */

export interface PortfolioRow extends Portfolio {
  properties: number
  limited_staff: number
}

function requirePortfolios(s: Session): void {
  requireAdmin(s)
  if (!hasFeature(s, 'portfolios')) throw new RuleError('Conta de proprietário não usa carteiras.')
}

/** Ordens: name, properties. */
export async function listPortfolios(s: Session, params: ListParams): Promise<ListResult<PortfolioRow>> {
  requirePortfolios(s)
  const { db } = await connect(s)
  const rows = db.portfolios
    .filter((p) => p.organization_id === s.org.id)
    .map((p) => ({
      ...p,
      properties: db.properties.filter((x) => x.portfolio_id === p.id && !x.deleted_at).length,
      limited_staff: db.memberships.filter((m) => m.organization_id === s.org.id && m.portfolio_ids?.includes(p.id)).length,
    }))
  return runList(rows, params, {
    search: (r) => [r.name],
    sorts: { name: (r) => r.name, properties: (r) => r.properties },
    defaultSort: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
  })
}

export const portfolioSchema = z.object({
  id: z.string().nullable(),
  name: z.string().trim().min(2, 'Nome com menos de 2 letras.').max(40, 'Nome acima de 40 caracteres: encurte.'),
  color: z.string().trim().regex(HEX, 'Cor no formato #RRGGBB (ex.: #0E7C66).'),
})
export type PortfolioInput = z.infer<typeof portfolioSchema>

export async function savePortfolio(s: Session, input: PortfolioInput): Promise<Portfolio> {
  requirePortfolios(s)
  const { db } = await connect(s)
  const data = check(portfolioSchema, input)
  const mine = db.portfolios.filter((p) => p.organization_id === s.org.id)
  if (mine.some((p) => p.id !== data.id && normalize(p.name) === normalize(data.name))) throw new RuleError(`Já existe a carteira "${data.name}": escolha outro nome.`)
  const at = nowIso()
  if (data.id) {
    const before = mine.find((p) => p.id === data.id)
    if (!before) throw new AccessError('Carteira não encontrada nesta conta.')
    const after: Portfolio = { ...before, name: data.name, color: data.color.toLowerCase(), updated_at: at }
    const changes = diff(before, after)
    if (!changes) return before
    upsertRows('portfolios', [after])
    audit(s, 'portfolios', after.id, 'update', `Alterou a carteira "${before.name}" (${changesText(changes, names(db, s.org.id))})`, changes)
    return after
  }
  const row: Portfolio = { id: newId(), organization_id: s.org.id, created_at: at, updated_at: at, created_by: s.user.id, name: data.name, color: data.color.toLowerCase() }
  upsertRows('portfolios', [row])
  audit(s, 'portfolios', row.id, 'create', `Criou a carteira "${row.name}"`)
  return row
}

/**
 * Excluir só carteira VAZIA: com imóvel ou colaborador limitado a ela, recusa e diz o conserto.
 * Carteira é configuração (não cadastro): sem nada pendurado, pode sumir de verdade; a auditoria
 * guarda que existiu (ação "archive", a mais próxima de "excluir" na lista de ações).
 */
export async function deletePortfolio(s: Session, id: Id): Promise<void> {
  requirePortfolios(s)
  const { db } = await connect(s)
  const p = db.portfolios.find((x) => x.id === id && x.organization_id === s.org.id)
  if (!p) throw new AccessError('Carteira não encontrada nesta conta.')
  const props = db.properties.filter((x) => x.portfolio_id === id)
  if (props.length) throw new RuleError(`A carteira "${p.name}" tem ${props.length} ${props.length === 1 ? 'imóvel' : 'imóveis'}: mova-os para outra carteira antes (Dados > Data Manager > Imóveis > Mudar carteira).`)
  const staff = db.memberships.filter((m) => m.organization_id === s.org.id && m.portfolio_ids?.includes(id))
  if (staff.length) throw new RuleError(`${staff.length} ${staff.length === 1 ? 'colaborador está limitado' : 'colaboradores estão limitados'} a "${p.name}": tire a limitação antes de excluir.`)
  deleteRows('portfolios', [id])
  audit(s, 'portfolios', id, 'archive', `Excluiu a carteira "${p.name}" (estava vazia)`)
}

/* ---------------------------------------------------------------- situações e cores */

export const STATUS_ORDER: UnitStatus[] = ['available', 'occupied', 'reserved', 'maintenance', 'blocked']
const DEFAULT_COLOR: Record<UnitStatus, string> = { available: '#15803d', occupied: '#2b59c3', reserved: '#b45309', maintenance: '#c2410c', blocked: '#64748b' }

/** As 5 situações da conta, na ordem fixa; situação sem linha gravada aparece com o padrão. */
export async function listStatusConfig(s: Session): Promise<UnitStatusConfig[]> {
  requireAdmin(s)
  const { db } = await connect(s)
  return STATUS_ORDER.map(
    (status) =>
      db.unit_status_config.find((c) => c.organization_id === s.org.id && c.status === status) ?? {
        id: `${s.org.id}:${status}`, organization_id: s.org.id, status, label: UNIT_STATUS[status], color: DEFAULT_COLOR[status],
      },
  )
}

const statusRowsSchema = z
  .array(
    z.object({
      status: z.enum(STATUS_ORDER as [UnitStatus, ...UnitStatus[]], { error: 'Situação inválida.' }),
      label: z.string().trim().min(2, 'Rótulo com menos de 2 letras.').max(30, 'Rótulo acima de 30 caracteres: encurte.'),
      color: z.string().trim().regex(HEX, 'Cor no formato #RRGGBB (ex.: #15803D).'),
    }),
  )
  .min(1)

/** Grava rótulo e cor. Contraste baixo NÃO trava (é aviso na tela): a decisão da cor é da conta. */
export async function saveStatusConfig(s: Session, rows: { status: UnitStatus; label: string; color: string }[]): Promise<number> {
  requireAdmin(s)
  const { db } = await connect(s)
  const data = check(statusRowsSchema, rows)
  const labels = data.map((r) => normalize(r.label))
  const dup = labels.find((l, i) => labels.indexOf(l) !== i)
  if (dup) throw new RuleError('Duas situações com o mesmo rótulo confundem a legenda do mapa: use nomes diferentes.')
  const current = await listStatusConfig(s)
  const changed: [UnitStatusConfig, UnitStatusConfig][] = []
  for (const r of data) {
    const before = current.find((c) => c.status === r.status)!
    const after: UnitStatusConfig = { ...before, label: r.label, color: r.color.toLowerCase() }
    if (diff(before, after)) changed.push([before, after])
  }
  if (!changed.length) throw new RuleError('Nada mudou: os rótulos e as cores já eram esses.')
  upsertRows('unit_status_config', changed.map(([, a]) => a))
  for (const [b, a] of changed) audit(s, 'unit_status_config', a.id, 'update', `Alterou a situação "${UNIT_STATUS[a.status]}" (${changesText(diff(b, a), names(db, s.org.id))})`, diff(b, a))
  return changed.length
}

/* ---------------------------------------------------------------- auditoria */

export interface AuditRow extends AuditLog {
  who: string
  entity_label: string
  action_label: string
  /** Antes e depois já traduzidos (nomes no lugar de ids, reais no lugar de centavos). */
  change_lines: ChangeLine[]
  changes_text: string
  /** Dia do registro no fuso da conta (o "at" vem com hora e fuso). */
  day: string
}

export const PERIODS = [
  { value: '1', label: 'Hoje' },
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
]

/**
 * Filtros: entity, action, actor, period ('1' | '7' | '30' | '90', contados de hoje para trás).
 * Ordens: at, who, entity. Devolve também as opções de "quem" e "o quê" que existem na conta.
 * A auditoria guarda o antes e o depois (pode ter dado pessoal): só o administrador vê (seção G do plano).
 */
export async function listAudit(s: Session, params: ListParams): Promise<ListResult<AuditRow> & { actors: { value: string; label: string }[]; entities: { value: string; label: string }[] }> {
  requireAdmin(s)
  const { db } = await connect(s)
  const nb = names(db, s.org.id)
  const rows: AuditRow[] = db.audit_logs
    .filter((a) => a.organization_id === s.org.id)
    .map((a) => ({
      ...a, who: a.actor_user_id ? (nb.user.get(a.actor_user_id) ?? 'Usuário') : 'Sistema', entity_label: entityLabel(a.entity),
      action_label: AUDIT_ACTION_LABEL[a.action], change_lines: describeChanges(a.changes, nb), changes_text: changesText(a.changes, nb), day: todayIn(s.org.timezone, new Date(a.at)),
    }))
  const result = runList(rows, params, {
    search: (r) => [r.summary, r.who, r.entity_label, r.changes_text],
    filters: {
      entity: (r) => r.entity, action: (r) => r.action, actor: (r) => r.actor_user_id ?? 'sistema',
      // Período: a linha entra em todo período que a contém (hoje está em "7 dias", "30 dias"...).
      period: (r) => PERIODS.map((p) => p.value).filter((d) => daysBetween(r.day, s.today) < Number(d)),
    },
    sorts: { at: (r) => Date.parse(r.at), who: (r) => r.who, entity: (r) => r.entity_label },
    defaultSort: (a, b) => Date.parse(b.at) - Date.parse(a.at),
  })
  const actorIds = [...new Set(rows.map((r) => r.actor_user_id ?? 'sistema'))]
  return {
    ...result,
    actors: actorIds.map((id) => ({ value: id, label: id === 'sistema' ? 'Sistema' : (nb.user.get(id) ?? 'Usuário') })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    entities: [...new Set(rows.map((r) => r.entity))].map((e) => ({ value: e, label: entityLabel(e) })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
  }
}
