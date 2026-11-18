/* =============================================================================
   Pessoas: repositório do módulo (o cadastro único de pessoa física e jurídica).

   A LISTA e o detalhe já existem em data/views/contracts.ts (listPeople, getPerson), com os
   papéis calculados das ligações: dono (property_owners), locatário e fiador (contract_parties).
   Aqui fica o que é só deste módulo:
     1. cadastrar, editar e arquivar pessoa (documento único por organização), com foto opcional;
     2. o cadastro rápido da equipe do prédio (zelador, porteiro, síndico: nome, telefone e foto);
     3. o que a tela "Contratos e pessoas" mostra da pessoa (07/11/2026): a lista com "contratos
        vigentes", a linha aberta (contratos com o papel dela, unidades de que é dona, vagas que
        aluga, documentos dela) e as listas das abas de baixo (chamados de prestador, histórico).

   Por que o documento é a chave de "mesma pessoa": nome se escreve de vários jeitos ("João"
   e "Joao"), CPF e CNPJ não. Comparamos o documento NORMALIZADO (sem pontuação, letra
   maiúscula), senão "123.456.789-09" e "12345678909" passariam como duas pessoas.
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, audit, connect, diff, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { runList, type ListParams, type ListResult } from '@/data/query'
import { HOLDING_STATUSES } from '@/data/rules'
import { see, type Scope } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type { DocumentFile, Id, MaintenanceCategory, PartyRole, Person, PersonTag } from '@/data/types'
import { listPeople, toContractRows, type ContractRow, type PersonRow } from '@/data/views/contracts'
import { toMaintenanceRows, type MaintenanceRow } from '@/data/views/finance'
import { isSpot, toUnitRows, type UnitRow } from '@/data/views/units'
import { documentError, normalizeDocument, onlyDigits } from '@/lib/documents'
import { newId } from '@/lib/random'
import { plural } from '@/lib/text'
import { buildHistory, type HistoryEntry } from '@/modules/imoveis/history'
import { photoAuditChange, photoSchema } from './foto'

/* ---------------------------------------------------------------- formulário */

export const PERSON_TAGS = ['vendor', 'contact', 'caretaker', 'syndic'] as const satisfies readonly PersonTag[]
export const MAINTENANCE_CATEGORIES = ['plumbing', 'electrical', 'painting', 'locksmith', 'appliance', 'structure', 'cleaning', 'other'] as const satisfies readonly MaintenanceCategory[]

/** E-mail simples: texto, arroba, domínio com ponto. A prova de que existe é o convite chegar, não a regex. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Regras de campo reaproveitadas pelo cadastro completo e pelo cadastro rápido da equipe do prédio. */
const nameField = z.string().trim().min(3, 'Nome com pelo menos 3 letras.').max(120, 'Nome até 120 caracteres.')
const phoneField = z.string().trim().refine((v) => v === '' || [10, 11].includes(onlyDigits(v).length), 'Telefone com DDD: 10 ou 11 números, ex.: (31) 99999-0000.')

/** Quantidade pequena (dependentes, veículos): vazio ou um número de 0 a 20, com o erro dizendo o conserto. */
const countField = (label: string) => z.string().trim().refine((v) => v === '' || (/^\d{1,2}$/.test(v) && Number(v) <= 20), `${label}: um número de 0 a 20, ou deixe em branco.`)

/** Papéis declarados de quem trabalha no prédio (não assina contrato nem recebe repasse). */
const BUILDING_STAFF_TAGS: PersonTag[] = ['caretaker', 'syndic', 'contact']

/**
 * CPF opcional só para quem é APENAS equipe do prédio (zelador, síndico, contato): ninguém pede o
 * CPF do porteiro para anotar o ramal. Quem tem outro papel (prestador, ou sem papel declarado,
 * que é o caso de dono, inquilino e fiador) continua com documento obrigatório.
 */
export function documentOptional(tags: readonly PersonTag[]): boolean {
  return tags.length > 0 && tags.every((t) => BUILDING_STAFF_TAGS.includes(t))
}

export const personSchema = z
  .object({
    kind: z.enum(['PF', 'PJ'], { error: 'Escolha pessoa física ou jurídica.' }),
    name: nameField,
    document: z.string().trim(),
    email: z.string().trim().max(120, 'E-mail até 120 caracteres.').refine((v) => v === '' || EMAIL.test(v), 'E-mail incompleto: confira o @ e o domínio (ex.: nome@empresa.com.br).'),
    phone: phoneField,
    tags: z.array(z.enum(PERSON_TAGS)),
    vendor_categories: z.array(z.enum(MAINTENANCE_CATEGORIES)),
    notes: z.string().trim().max(1000, 'Observações até 1.000 caracteres.'),
    /** Opcional. undefined = não mexer na foto que já existe; null = tirar a foto. */
    photo: photoSchema.nullable().optional(),
    /*
     * Moradia e convivência (07/11/2026), todos opcionais e em texto como o formulário manda.
     * undefined = quem chamou não mandou (importação, cadastro rápido): mantém o que já existe.
     * LGPD: dado pessoal comum, para regra do prédio e seguro; quem vê está em views/cliente.ts.
     */
    dependents: countField('Dependentes').optional(),
    pets: z.string().trim().max(60, 'Animais até 60 letras (ex.: 1 cachorro e 2 gatos).').optional(),
    vehicles: countField('Veículos').optional(),
    occupation: z.string().trim().max(80, 'Ocupação até 80 letras.').optional(),
  })
  .superRefine((v, ctx) => {
    if (!normalizeDocument(v.document) && documentOptional(v.tags)) return // equipe do prédio sem CPF
    // documentError diz a causa ("Tem 10 caracteres: CPF tem 11 e CNPJ tem 14") e aceita o CNPJ com letras.
    const err = documentError(v.document)
    if (err) return ctx.addIssue({ code: 'custom', path: ['document'], message: err })
    const n = normalizeDocument(v.document)
    if (v.kind === 'PF' && n.length !== 11) ctx.addIssue({ code: 'custom', path: ['document'], message: 'Pessoa física usa CPF (11 números). Se é empresa, marque Pessoa jurídica.' })
    if (v.kind === 'PJ' && n.length !== 14) ctx.addIssue({ code: 'custom', path: ['document'], message: 'Pessoa jurídica usa CNPJ (14 caracteres). Se é pessoa física, marque Pessoa física.' })
  })
export type PersonInput = z.infer<typeof personSchema>

/* ---------------------------------------------------------------- ajudantes */

function parseOrRule<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input)
  if (!r.success) throw new RuleError(r.error.issues[0]?.message ?? 'Dados inválidos: confira o formulário.')
  return r.data
}

function requireEditor(s: Session, sc: Scope): void {
  if (!sc.all || !can(s, 'people:edit')) throw new AccessError('Seu papel não permite alterar o cadastro de pessoas. Quem administra a conta pode liberar em Configurações.')
}

/**
 * Regra do documento único por organização. Procura também entre as ARQUIVADAS: cadastrar de
 * novo quem foi arquivado criaria duas fichas da mesma pessoa (e o histórico se partiria).
 */
function checkUniqueDocument(db: Db, orgId: Id, document: string, exceptId: Id | null): void {
  if (!document) return // sem documento (equipe do prédio): não há o que comparar
  const twin = db.people.find((p) => p.organization_id === orgId && p.id !== exceptId && normalizeDocument(p.document) === document)
  if (!twin) return
  const what = document.length === 11 ? 'CPF' : 'CNPJ'
  throw new RuleError(twin.deleted_at ? `Já existe ${twin.name} com este ${what}, arquivada. Restaure o cadastro em vez de criar outro.` : `Já existe ${twin.name} com este ${what}. Abra o cadastro dela em vez de criar outro.`)
}

/** Monta os campos da pessoa a partir do formulário (categorias só valem para prestador). */
function fieldsOf(data: PersonInput): Pick<Person, 'kind' | 'name' | 'document' | 'email' | 'phone' | 'tags' | 'vendor_categories' | 'notes'> {
  return {
    kind: data.kind, name: data.name, document: normalizeDocument(data.document), email: data.email.toLowerCase(), phone: onlyDigits(data.phone),
    tags: [...new Set(data.tags)], vendor_categories: data.tags.includes('vendor') ? [...new Set(data.vendor_categories)] : [], notes: data.notes,
  }
}

/**
 * Moradia e convivência do formulário para a linha da pessoa. Campo que não veio (undefined) fica
 * como estava; vazio vira "não informado" (null no número, texto vazio no texto).
 */
function householdOf(data: PersonInput, before?: Person): Pick<Person, 'dependents' | 'pets' | 'vehicles' | 'occupation'> {
  const count = (v: string | undefined, old: number | null | undefined) => (v === undefined ? (old ?? null) : v === '' ? null : Number(v))
  const text = (v: string | undefined, old: string | undefined) => (v === undefined ? (old ?? '') : v)
  // Empresa não tem dependente, animal nem ocupação (o formulário esconde, mas o valor digitado antes de trocar o tipo ficaria).
  const pf = data.kind === 'PF'
  return {
    dependents: pf ? count(data.dependents, before?.dependents) : null,
    pets: pf ? text(data.pets, before?.pets) : '',
    vehicles: count(data.vehicles, before?.vehicles),
    occupation: pf ? text(data.occupation, before?.occupation) : '',
  }
}

/* ---------------------------------------------------------------- gravar */

export async function createPerson(s: Session, input: PersonInput): Promise<Person> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const data = parseOrRule(personSchema, input)
  const fields = fieldsOf(data)
  checkUniqueDocument(db, s.org.id, fields.document, null)
  const now = nowIso()
  const row: Person = { id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id, deleted_at: null, ...fields, ...householdOf(data), address: null, user_id: null, photo: data.photo ?? null }
  upsertRows('people', [row])
  audit(s, 'people', row.id, 'create', `Cadastrou ${row.name}`)
  return row
}

export async function updatePerson(s: Session, input: PersonInput & { id: Id }): Promise<Person> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const data = parseOrRule(personSchema, input)
  const before = db.people.find((p) => p.id === input.id)
  if (!before || !see.person(sc, before)) throw new AccessError('Pessoa não encontrada ou fora do seu acesso.')
  const fields = fieldsOf(data)
  checkUniqueDocument(db, s.org.id, fields.document, before.id)
  // Foto: undefined (quem chamou não mandou) mantém a atual; null tira; texto troca.
  const photo = data.photo === undefined ? (before.photo ?? null) : data.photo
  const after: Person = { ...before, ...fields, ...householdOf(data, before), photo, updated_at: nowIso() }
  // Ficha antiga não tem as colunas novas (undefined); sem igualar ao "vazio" de cada uma, toda edição acusaria mudança.
  const changes = diff({ ...before, photo: before.photo ?? null, ...householdOf({ ...data, dependents: undefined, pets: undefined, vehicles: undefined, occupation: undefined }, before) }, after)
  if (!changes) return before
  if (changes.photo) changes.photo = photoAuditChange(before.photo, after.photo)
  upsertRows('people', [after])
  audit(s, 'people', after.id, 'update', `Alterou o cadastro de ${after.name}`, changes)
  return after
}

/* ---------------------------------------------------------------- cadastro rápido (equipe do prédio) */

/** Nome, telefone e foto: o mínimo para anotar o zelador ou o porteiro sem abrir a ficha completa. */
export const quickPersonSchema = z.object({
  name: nameField,
  phone: phoneField,
  photo: photoSchema.nullable(),
})
export type QuickPersonInput = z.infer<typeof quickPersonSchema>

/**
 * Monta (sem gravar) a pessoa do cadastro rápido da equipe do prédio. Quem chama grava junto com a
 * ligação ao imóvel e audita. Mesma porta do cadastro completo: só a equipe com "editar pessoas"
 * cria ficha, mesmo quando a criação vem de outra tela (Imóveis).
 * Fica sem CPF (documentOptional): dá para completar depois em Pessoas > Editar.
 */
export function newQuickPerson(s: Session, sc: Scope, input: QuickPersonInput, tag: PersonTag): Person {
  requireEditor(s, sc)
  const data = parseOrRule(quickPersonSchema, input)
  const now = nowIso()
  return {
    id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id, deleted_at: null,
    kind: 'PF', name: data.name, document: '', email: '', phone: onlyDigits(data.phone), address: null, notes: '',
    tags: [tag], vendor_categories: [], user_id: null, photo: data.photo,
  }
}

export interface PersonArchiveBlockers {
  contracts: { id: Id; code: string; role: PartyRole }[]
  units: number
  hasLogin: boolean
}

/** O que impede arquivar: contrato vigente ou aguardando assinatura, fatia de dono vigente, login no portal. */
function archiveBlockers(db: Db, s: Session, personId: Id): PersonArchiveBlockers {
  const p = db.people.find((x) => x.id === personId)
  const holding = new Map(db.contracts.filter((k) => k.organization_id === s.org.id && HOLDING_STATUSES.includes(k.status)).map((k) => [k.id, k]))
  const contracts = db.contract_parties
    .filter((cp) => cp.person_id === personId && holding.has(cp.contract_id))
    .map((cp) => ({ id: cp.contract_id, code: holding.get(cp.contract_id)!.code, role: cp.role }))
  const units = db.property_owners.filter((o) => o.person_id === personId && (!o.until || o.until >= s.today)).length
  return { contracts, units, hasLogin: !!p?.user_id }
}

export async function getPersonArchiveBlockers(s: Session, id: Id): Promise<PersonArchiveBlockers> {
  const { db, sc } = await connect(s)
  const p = db.people.find((x) => x.id === id)
  if (!p || !see.person(sc, p) || !sc.all) throw new AccessError()
  return archiveBlockers(db, s, id)
}

/**
 * Arquivar = esconder da lista sem apagar (o histórico de contratos e pagamentos continua de pé).
 * Recusado quando a pessoa ainda "segura" algo: contrato vigente ou aguardando assinatura,
 * fatia de dono vigente (a unidade ficaria com dono arquivado) ou login no portal.
 */
export async function archivePerson(s: Session, args: { id: Id; restore?: boolean }): Promise<Person> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const p = db.people.find((x) => x.id === args.id)
  if (!p || !see.person(sc, p)) throw new AccessError('Pessoa não encontrada ou fora do seu acesso.')
  const now = nowIso()
  if (args.restore) {
    if (!p.deleted_at) return p
    checkUniqueDocument(db, s.org.id, normalizeDocument(p.document), p.id)
    const row = { ...p, deleted_at: null, updated_at: now }
    upsertRows('people', [row])
    audit(s, 'people', p.id, 'restore', `Restaurou o cadastro de ${p.name}`)
    return row
  }
  if (p.deleted_at) return p
  const b = archiveBlockers(db, s, p.id)
  if (b.contracts.length) {
    const list = b.contracts.slice(0, 4).map((k) => k.code).join(', ')
    throw new RuleError(`Não dá para arquivar ${p.name}: ${plural(b.contracts.length, 'contrato vigente ou aguardando assinatura', 'contratos vigentes ou aguardando assinatura')} (${list}${b.contracts.length > 4 ? '...' : ''}). Encerre ou rescinda antes.`)
  }
  if (b.units) throw new RuleError(`Não dá para arquivar ${p.name}: é dona de ${plural(b.units, 'fatia de imóvel', 'fatias de imóvel')} hoje. Passe as fatias para outra pessoa antes.`)
  if (b.hasLogin) throw new RuleError(`Não dá para arquivar ${p.name}: tem acesso ao portal. Desative o acesso em Configurações antes.`)
  const row = { ...p, deleted_at: now, updated_at: now }
  upsertRows('people', [row])
  audit(s, 'people', p.id, 'archive', `Arquivou o cadastro de ${p.name}`)
  return row
}

/* ---------------------------------------------------------------- abas do detalhe */

/** A pessoa existe e a sessão a enxerga? (toda aba começa por aqui) */
function requirePerson(db: Db, sc: Scope, id: Id): Person {
  const p = db.people.find((x) => x.id === id)
  if (!p || !see.person(sc, p)) throw new AccessError('Pessoa não encontrada ou fora do seu acesso.')
  return p
}

/* ---------------------------------------------------------------- tela Contratos e pessoas */

/** Linha da categoria Pessoas: a linha da view com quantos contratos vigentes a pessoa tem, em qualquer papel. */
export interface PersonListRow extends PersonRow {
  active_contracts: number
}

/**
 * Lista da categoria Pessoas. A view (listPeople) faz busca, filtros, ordem e página; aqui só se
 * acrescenta "contratos vigentes" nas linhas da PÁGINA (locador, locatário ou fiador; o dono conta
 * os contratos de administração e as locações das unidades dele). Contar na página, e não na lista
 * inteira, basta: a coluna não ordena nem filtra.
 */
export async function listPeopleForScreen(s: Session, params: ListParams): Promise<ListResult<PersonListRow>> {
  // As duas leituras saem juntas: a espera simulada da rede acontece uma vez só.
  const [result, { db, sc }] = await Promise.all([listPeople(s, params), connect(s)])
  const active = new Set(db.contracts.filter((k) => k.status === 'active' && see.contract(sc, k)).map((k) => k.id))
  const count = new Map<Id, Set<Id>>()
  for (const cp of db.contract_parties) {
    if (!active.has(cp.contract_id)) continue
    // Set por pessoa: quem é locador E fiador do mesmo contrato conta o contrato uma vez só.
    const set = count.get(cp.person_id) ?? new Set<Id>()
    set.add(cp.contract_id)
    count.set(cp.person_id, set)
  }
  return { ...result, rows: result.rows.map((p) => ({ ...p, active_contracts: count.get(p.id)?.size ?? 0 })) }
}

/** O que a linha aberta da pessoa mostra: tudo que a liga aos imóveis, em listas curtas. */
export interface PersonLinks {
  /** Contratos de que é parte, com o papel dela em cada um (o mais novo primeiro). */
  contracts: { id: Id; code: string; kind: ContractRow['kind']; status: ContractRow['status']; roles: PartyRole[]; unit_label: string | null; property_name: string; start_date: string; end_date: string }[]
  /** Unidades (casa, apartamento, sala) de que é dona hoje, com a fatia dela. */
  units: { id: Id; code: string; property_id: Id; property_name: string; share_pct: number; status: UnitRow['status'] }[]
  /** Vagas de garagem de que é dona (só o número: a lista seria longa e repetiria o imóvel). */
  ownedSpots: number
  /** Vagas de garagem que ela ALUGA hoje (o mesmo recorte da VagasTable com personId). */
  spots: { id: Id; code: string; property_id: Id; property_name: string; place: string }[]
  /** Documentos ligados à própria pessoa (extrato de repasse, por exemplo). Os do contrato ficam no contrato. */
  documents: DocumentFile[]
}

/**
 * Contratos, unidades, vagas e documentos de uma pessoa. Passo a passo:
 *   1. a pessoa existe e a sessão a enxerga (senão, AccessError: link velho ou outra persona);
 *   2. contratos: os papéis dela saem de contract_parties; a linha só entra se a sessão enxerga o
 *      contrato (o proprietário não vê, por esta porta, o contrato de outra unidade do inquilino dele);
 *   3. unidades e vagas: a view de unidades (que já aplica o escopo), separando vaga de garagem;
 *   4. documentos: os pendurados na pessoa, pela regra de "quem vê" (see.document).
 */
export async function getPersonLinks(s: Session, personId: Id): Promise<PersonLinks> {
  const { db, sc } = await connect(s)
  requirePerson(db, sc, personId) // passo 1
  // Passo 2.
  const roles = new Map<Id, PartyRole[]>()
  for (const cp of db.contract_parties) if (cp.person_id === personId) roles.set(cp.contract_id, [...(roles.get(cp.contract_id) ?? []), cp.role])
  const contracts = toContractRows(db, sc, s.today)
    .filter((k) => roles.has(k.id))
    .sort((a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : a.code.localeCompare(b.code)))
    .map((k) => ({ id: k.id, code: k.code, kind: k.kind, status: k.status, roles: roles.get(k.id)!, unit_label: k.unit_label, property_name: k.property_name, start_date: k.start_date, end_date: k.end_date }))
  // Passo 3.
  const units = toUnitRows(db, sc, s.today).filter((u) => !u.deleted_at)
  const owned = units.filter((u) => u.owners.some((o) => o.person_id === personId))
  const byPlace = (a: { property_name: string; code: string }, b: { property_name: string; code: string }) =>
    a.property_name.localeCompare(b.property_name, 'pt-BR') || a.code.localeCompare(b.code, 'pt-BR', { numeric: true })
  return {
    contracts,
    units: owned
      .filter((u) => !isSpot(u))
      .map((u) => ({ id: u.id, code: u.code, property_id: u.property_id, property_name: u.property_name, share_pct: u.owners.find((o) => o.person_id === personId)!.share_pct, status: u.status }))
      .sort(byPlace),
    ownedSpots: owned.filter(isSpot).length,
    spots: units
      .filter((u) => isSpot(u) && u.lease?.lessee_id === personId)
      .map((u) => ({ id: u.id, code: u.code, property_id: u.property_id, property_name: u.property_name, place: u.zone ?? [u.building_name, u.floor_label].filter(Boolean).join(', ') }))
      .sort(byPlace),
    // Passo 4.
    documents: db.documents.filter((d) => d.person_id === personId && see.document(sc, d)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
  }
}

/** Chamados atribuídos à pessoa como prestadora. */
export async function listVendorRequests(s: Session, personId: Id, params: ListParams): Promise<ListResult<MaintenanceRow>> {
  const { db, sc } = await connect(s)
  requirePerson(db, sc, personId)
  return runList(toMaintenanceRows(db, sc, s.today).filter((r) => r.vendor_person_id === personId), params, {
    search: (r) => [r.code, r.title, r.unit_code, r.property_name],
    filters: { status: (r) => r.status, open: (r) => (['done', 'canceled'].includes(r.status) ? 'fechado' : 'aberto') },
    sorts: { created_at: (r) => r.created_at, due_date: (r) => r.due_date, quote: (r) => r.quote_cents },
    defaultSort: (a, b) => (a.created_at < b.created_at ? 1 : -1),
  })
}

export interface PersonCounts {
  /** Lançamentos em que a pessoa paga ou recebe (o "M" do "N de M" da aba Financeiro). */
  entries: number
  /** Chamados atribuídos a ela como prestadora (a seção Chamados só aparece para quem presta serviço). */
  requests: number
}

/**
 * Números das abas de baixo (só o que a sessão enxerga). Unidades, contratos e vagas saíram daqui em
 * 07/11/2026: moram na linha aberta da tabela (getPersonLinks), com a lista inteira.
 */
export async function personCounts(s: Session, personId: Id): Promise<PersonCounts> {
  const { db, sc } = await connect(s)
  requirePerson(db, sc, personId)
  return {
    entries: db.financial_entries.filter((e) => e.person_id === personId && see.entry(sc, e)).length,
    requests: db.maintenance_requests.filter((r) => r.vendor_person_id === personId && see.maintenance(sc, r)).length,
  }
}

/** Histórico da pessoa: o cadastro dela e os contratos de que é parte. Só a equipe. */
export async function personHistory(s: Session, personId: Id): Promise<HistoryEntry[]> {
  const { db, sc } = await connect(s)
  if (!sc.all) throw new AccessError('O histórico é visto pela equipe da conta.')
  const p = requirePerson(db, sc, personId)
  const contractIds = db.contract_parties.filter((cp) => cp.person_id === personId).map((cp) => cp.contract_id)
  return buildHistory(db, s.org.id, [{ entity: 'people', ids: [personId] }, { entity: 'contracts', ids: contractIds }], {
    entity: 'people', id: p.id, at: p.created_at, by: p.created_by, summary: `Cadastro de ${p.name}`,
  })
}
