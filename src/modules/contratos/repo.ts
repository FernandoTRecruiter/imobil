/* =============================================================================
   Contratos: o repositório do módulo (a "porta" de leitura e gravação dos contratos).

   Segue a forma do módulo de referência (documentos): conectar -> escopo -> regra -> gravar
   -> auditar. O que mora aqui, na ordem da vida de uma locação:
     1. lista da tela e indicadores (locação por padrão; administração entra como filtro);
     2. criar a locação em RASCUNHO (o assistente de 5 etapas);
     3. mudar a situação SÓ pelos caminhos de CONTRACT_TRANSITIONS, sempre com evento na linha
        do tempo; ativar gera as cobranças mensais; rescindir cancela as futuras em aberto;
     4. reajuste, aditivo, observação e renovação;
     5. documentos do contrato.

   Regras que o banco repete na fase 2 (ficam aqui e não na tela, porque a tela pode ser contornada):
   - duas locações da mesma unidade não "seguram" o mesmo período (a trava EXCLUDE do Postgres);
   - uma garantia só (Lei 8.245/91, art. 37, parágrafo único) e caução de até 3 aluguéis (art. 38, § 2º);
   - reajuste no máximo uma vez por ano (Lei 10.192/2001, art. 2º, § 1º);
   - cobrança mensal tem chave (contrato + competência): gerar de novo não duplica.
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { can, isPortal } from '@/auth/permissions'
import { AccessError, audit, connect, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { ADJUSTMENT_INDEX, CONTRACT_STATUS } from '@/data/labels'
import type { ListParams, ListResult } from '@/data/query'
import { canTransition, CONTRACT_TRANSITIONS, HOLDING_STATUSES, leaseCovers, leasesOverlap, paidByEntry } from '@/data/rules'
import { see, type Scope } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type { Cents, Contract, ContractEvent, ContractEventKind, ContractParty, ContractStatus, DocumentFile, FinancialEntry, Id, IsoDate, PartyRole, Person } from '@/data/types'
import { getContractDetail, listContracts, toContractRows, type ContractDetail, type ContractRow } from '@/data/views/contracts'
import { lookup, ownersOf } from '@/data/views/lookup'
import { toUnitRows, type UnitRow } from '@/data/views/units'
import { addDays, addMonths, dueDateFor, formatDate, formatMonth, monthsBetween, monthStart, parseDateBR } from '@/lib/dates'
import { documentError, normalizeDocument } from '@/lib/documents'
import { applyPct, formatBRL } from '@/lib/money'
import { newId } from '@/lib/random'

/* ---------------------------------------------------------------- validações comuns */

/** Data 'AAAA-MM-DD' que existe no calendário (31/02 é recusado aqui, e não lá no banco). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.')
  .refine((v) => parseDateBR(v) === v, 'Essa data não existe no calendário.')

const STATUSES = ['draft', 'in_review', 'awaiting_approval', 'awaiting_signature', 'active', 'ended', 'terminated'] as const
const INDEXES = ['IGPM', 'IPCA', 'INPC', 'fixed', 'none'] as const
const GUARANTEES = ['none', 'deposit', 'guarantor', 'insurance', 'capitalization'] as const

/** Período no formato da tela: "01/12/2026 a 31/05/2029". */
function period(k: Pick<Contract, 'start_date' | 'end_date'>): string {
  return `${formatDate(k.start_date)} a ${formatDate(k.end_date)}`
}

/** Fim de um contrato de N meses: o dia anterior ao "mesmo dia" N meses depois (01/12 + 30 meses = 31/05). */
export function endDateFor(start: IsoDate, months: number): IsoDate {
  return addDays(addMonths(start, months), -1)
}

/* ---------------------------------------------------------------- 1. lista e indicadores */

/** Sem escolha no filtro "Tipo", a lista mostra só locação (administração é o contrato com o dono, outro assunto). */
export const DEFAULT_CONTRACT_KINDS = ['lease']

/**
 * Lista da tela de Contratos. Usa a view pronta (listContracts) e só acrescenta o padrão "locação".
 * O "M" do contador ("N de M") passa a contar só os tipos em vista. Sem isso a tela diria
 * "45 de 160 contratos" sem nenhum filtro ligado, e a pessoa iria procurar o filtro que não ligou.
 * `fixed` é o recorte que a tela não deixa tirar (a aba Contratos da ficha do imóvel passa
 * { property: [id] }; a da unidade, { unit: [id] }): ele entra no resultado E na base do "M".
 */
export async function listContractsForScreen(s: Session, params: ListParams, fixed: Record<string, string[]> = {}): Promise<ListResult<ContractRow>> {
  const kinds = params.filters?.kind?.length ? params.filters.kind : DEFAULT_CONTRACT_KINDS
  const [result, base] = await Promise.all([
    listContracts(s, { ...params, filters: { ...params.filters, ...fixed, kind: kinds } }),
    listContracts(s, { filters: { ...fixed, kind: kinds }, page: 1, pageSize: 1 }),
  ])
  return { ...result, totalAll: base.total }
}

export interface ContractKpis {
  active: number
  ending60: number
  awaitingSignature: number
  overdueCents: Cents
  overdueContracts: number
}

/** Indicadores da faixa de cima. Só locações que a sessão enxerga (o escopo já cortou o resto). */
export async function contractKpis(s: Session): Promise<ContractKpis> {
  const { db, sc } = await connect(s)
  const leases = toContractRows(db, sc, s.today).filter((k) => k.kind === 'lease')
  const active = leases.filter((k) => k.status === 'active')
  return {
    active: active.length,
    // Mesma conta do filtro "Vence em 60 dias" da view: clicar no indicador mostra exatamente estes.
    ending60: active.filter((k) => k.days_to_end >= 0 && k.days_to_end <= 60).length,
    awaitingSignature: leases.filter((k) => k.status === 'awaiting_signature').length,
    overdueCents: leases.reduce((a, k) => a + k.overdue_cents, 0),
    overdueContracts: leases.filter((k) => k.overdue_cents > 0).length,
  }
}

/* ---------------------------------------------------------------- detalhe */

/** Ordem das partes na linha aberta da tabela: quem aluga para quem, depois quem garante. */
const PARTY_ORDER: PartyRole[] = ['lessor', 'lessee', 'guarantor', 'representative']

/**
 * Partes na ordem de leitura do contrato (locador, locatário, fiador, procurador) e, no mesmo papel,
 * a maior fatia primeiro e depois o nome. Sem ordem fixa, duas aberturas do mesmo contrato podiam
 * listar os donos em ordem diferente, e a pessoa acharia que algo mudou.
 */
export function sortParties<T extends { role: PartyRole; name: string; share_pct: number | null }>(parties: T[]): T[] {
  return [...parties].sort(
    (a, b) => PARTY_ORDER.indexOf(a.role) - PARTY_ORDER.indexOf(b.role) || (b.share_pct ?? 0) - (a.share_pct ?? 0) || a.name.localeCompare(b.name, 'pt-BR'),
  )
}

export interface ContractView extends ContractDetail {
  parent: { id: Id; code: string } | null
  /** Renovação já criada a partir deste contrato (rascunho em diante). */
  renewal: { id: Id; code: string; status: ContractStatus } | null
  /** Outras locações da mesma unidade que seguram um período que cruza com este (só a equipe vê). */
  clashes: { id: Id; code: string; status: ContractStatus; start_date: IsoDate; end_date: IsoDate }[]
  /** A partir de quando o próximo reajuste pode valer (um por ano, contado do início ou do último). */
  nextAdjustmentFrom: IsoDate
}

/**
 * Contrato com partes, linha do tempo e vizinhos (contrato anterior, renovação, conflitos).
 * Portal (proprietário e inquilino): a linha do tempo mostra o que aconteceu com o contrato, sem as
 * observações internas da equipe; das outras partes aparece só o nome (na fase 2, a view de
 * pessoas do portal expõe só o nome). É a regra de escopo deste módulo, escrita aqui.
 */
export async function getContract(s: Session, id: Id): Promise<ContractView> {
  // As duas consultas saem juntas: a espera simulada da rede acontece uma vez só.
  const [detail, { db, sc }] = await Promise.all([getContractDetail(s, id), connect(s)])
  const k = detail.contract
  const portal = isPortal(s)
  const events = portal ? detail.events.filter((e) => e.kind !== 'note') : detail.events
  const parties = sortParties(portal ? detail.parties.map((p) => (p.person_id === s.personId ? p : { ...p, document: '', email: '', phone: '' })) : detail.parties)
  const parent = k.parent_contract_id ? db.contracts.find((x) => x.id === k.parent_contract_id && see.contract(sc, x)) : undefined
  const child = db.contracts.find((x) => x.parent_contract_id === k.id && x.status !== 'terminated' && see.contract(sc, x))
  const clashes =
    sc.all && k.kind === 'lease' && k.unit_id
      ? db.contracts
          .filter((x) => x.id !== k.id && x.organization_id === k.organization_id && x.kind === 'lease' && x.unit_id === k.unit_id && HOLDING_STATUSES.includes(x.status) && leasesOverlap(x, k))
          .map((x) => ({ id: x.id, code: x.code, status: x.status, start_date: x.start_date, end_date: x.end_date }))
      : []
  return {
    contract: k,
    parties,
    events,
    parent: parent ? { id: parent.id, code: parent.code } : null,
    renewal: child ? { id: child.id, code: child.code, status: child.status } : null,
    clashes,
    nextAdjustmentFrom: minAdjustmentDate(db, k),
  }
}

/**
 * As partes da locação vigente HOJE numa unidade (a mesma que UnitRow.lease aponta), numa leitura só.
 * Por que existe ao lado de getContractDetail: a ficha do imóvel lê a unidade escolhida, as contagens
 * e estas partes AO MESMO TEMPO; pelo id do contrato, teria de esperar a unidade chegar para saber
 * qual contrato ler (duas esperas seguidas, uns 300 ms a mais a cada escolha no 3D).
 * Sem locação vigente, ou com o contrato fora do escopo da sessão, a lista volta vazia.
 */
export async function getUnitLeaseParties(s: Session, unitId: Id): Promise<ContractDetail['parties']> {
  const { db, sc } = await connect(s)
  if (!db.units.some((u) => u.id === unitId && see.unit(sc, u))) throw new AccessError('Unidade não encontrada ou fora do seu acesso.')
  // A última que cobre hoje, como o Map de toUnitRows (que decide o UnitRow.lease).
  const k = db.contracts.filter((x) => x.unit_id === unitId && leaseCovers(x, s.today)).pop()
  if (!k || !see.contract(sc, k)) return []
  const L = lookup(db)
  return sortParties(
    (L.partiesByContract.get(k.id) ?? []).map((p) => {
      const person = L.person.get(p.person_id)
      return { ...p, name: person?.name ?? 'Pessoa', document: person?.document ?? '', email: person?.email ?? '', phone: person?.phone ?? '' }
    }),
  )
}

/* ---------------------------------------------------------------- 2. criar locação */

/** Pessoa nova cadastrada dentro do assistente (mesma regra do cadastro de Pessoas: documento válido e único na conta). */
const newPersonSchema = z.object({
  kind: z.enum(['PF', 'PJ']),
  name: z.string().trim().min(3, 'Nome com pelo menos 3 letras.').max(120, 'Nome longo demais: até 120 caracteres.'),
  document: z.string(),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'E-mail incompleto: falta o @ ou o domínio.'),
  phone: z.string().trim().max(30),
})
export type NewPersonInput = z.infer<typeof newPersonSchema>

/** Parte do contrato: alguém que já existe (person_id) OU alguém novo (new_person). */
const partyInputSchema = z.union([z.object({ person_id: z.string().min(1, 'Escolha a pessoa.') }), z.object({ new_person: newPersonSchema })])
export type PartyInput = z.infer<typeof partyInputSchema>

export const newLeaseSchema = z.object({
  unit_id: z.string().min(1, 'Escolha a unidade.'),
  lessee: partyInputSchema,
  rent_cents: z.number().int().min(1, 'Informe o aluguel.'),
  due_day: z.number().int().min(1, 'Dia de vencimento de 1 a 31.').max(31, 'Dia de vencimento de 1 a 31.'),
  start_date: isoDateSchema,
  months: z.number().int().min(1, 'Prazo de pelo menos 1 mês.').max(120, 'Prazo de até 120 meses (10 anos).'),
  adjustment_index: z.enum(INDEXES),
  adjustment_month: z.number().int().min(1).max(12),
  late_fee_pct: z.number().min(0, 'Multa não pode ser negativa.').max(20, 'Multa de até 20%.'),
  interest_pct_month: z.number().min(0, 'Juros não podem ser negativos.').max(10, 'Juros de até 10% ao mês.'),
  guarantee_type: z.enum(GUARANTEES),
  deposit_cents: z.number().int().min(0),
  guarantor: partyInputSchema.nullable(),
  notes: z.string().max(1000, 'Observação de até 1.000 caracteres.'),
})
export type NewLeaseInput = z.infer<typeof newLeaseSchema>

const GUARANTEE_RULE =
  'A Lei do Inquilinato (art. 37) aceita uma garantia só por contrato: escolha caução, fiador, seguro-fiança ou título de capitalização, e deixe as outras em branco.'

/**
 * Garantia única e limite da caução. A tela já oferece UMA escolha (botões de opção), mas a regra
 * mora aqui: uma chamada direta ao repositório (ou à API, na fase 2) não passa pela tela.
 */
export function checkGuarantee(d: Pick<NewLeaseInput, 'guarantee_type' | 'deposit_cents' | 'guarantor' | 'rent_cents'>): void {
  const hasDeposit = d.deposit_cents > 0
  const hasGuarantor = !!d.guarantor
  const t = d.guarantee_type
  // O que não é da modalidade escolhida precisa vir vazio (duas garantias = contrato nulo nessa parte).
  if ((t !== 'deposit' && hasDeposit) || (t !== 'guarantor' && hasGuarantor)) throw new RuleError(GUARANTEE_RULE)
  if (t === 'deposit') {
    if (!hasDeposit) throw new RuleError('Caução escolhida sem valor: informe quanto o locatário deposita (até 3 aluguéis).')
    const max = d.rent_cents * 3
    if (d.deposit_cents > max) {
      throw new RuleError(`Caução de ${formatBRL(d.deposit_cents)} passa de 3 aluguéis (${formatBRL(max)}), o limite da Lei 8.245, art. 38. Reduza para até ${formatBRL(max)}.`)
    }
  }
  if (t === 'guarantor' && !hasGuarantor) throw new RuleError('Fiador escolhido sem pessoa: indique quem é o fiador.')
}

/** A locação da mesma unidade que já segura um período que cruza com este (a trava EXCLUDE do banco), ou nada. */
export function findClash(db: Db, orgId: Id, unitId: Id, p: Pick<Contract, 'start_date' | 'end_date'>, ignoreId?: Id): Contract | undefined {
  return db.contracts.find(
    (k) => k.organization_id === orgId && k.kind === 'lease' && k.unit_id === unitId && k.id !== ignoreId && HOLDING_STATUSES.includes(k.status) && leasesOverlap(k, p),
  )
}

function clashMessage(unitCode: string, k: Contract): string {
  return `A unidade ${unitCode} já está com a locação ${k.code} (${CONTRACT_STATUS[k.status].toLowerCase()}) de ${period(k)}. Comece depois de ${formatDate(k.end_date)} ou escolha outra unidade.`
}

/** Pessoa da parte: confere a que já existe ou monta a nova (sem gravar ainda: grava só se o resto passar). */
function resolveParty(db: Db, sc: Scope, s: Session, input: PartyInput, role: 'locatário' | 'fiador'): { person: Person; isNew: boolean } {
  if ('person_id' in input) {
    const p = db.people.find((x) => x.id === input.person_id)
    if (!p || !see.person(sc, p) || p.deleted_at) throw new RuleError(`O ${role} escolhido não existe mais ou é de outra conta. Escolha de novo.`)
    return { person: p, isNew: false }
  }
  const n = input.new_person
  const problem = documentError(n.document)
  if (problem) throw new RuleError(`Documento do ${role}: ${problem}`)
  const doc = normalizeDocument(n.document)
  if ((n.kind === 'PF') !== (doc.length === 11)) throw new RuleError(`Documento do ${role}: pessoa física usa CPF (11 dígitos) e pessoa jurídica usa CNPJ (14).`)
  const dup = db.people.find((x) => x.organization_id === s.org.id && !x.deleted_at && normalizeDocument(x.document) === doc)
  if (dup) throw new RuleError(`Já existe ${dup.name} com este documento. Escolha a pessoa cadastrada em vez de criar outra.`)
  const now = nowIso()
  const person: Person = {
    id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id, deleted_at: null,
    kind: n.kind, name: n.name.trim(), document: doc, email: n.email.trim(), phone: n.phone.replace(/\D/g, ''),
    address: null, notes: '', tags: [], vendor_categories: [], user_id: null,
  }
  return { person, isNew: true }
}

/**
 * Taxa de administração de cada dono por imóvel: vem do contrato de ADMINISTRAÇÃO (é ele que diz
 * quanto a imobiliária cobra). Chave "pessoa:imóvel". Se houver mais de um, vale o mais recente.
 * Usada aqui (taxa da locação nova) e no repasse (financeiro/repasses.ts).
 */
export function managementFeeMap(db: Db, orgId: Id): Map<string, { pct: number; code: string }> {
  const out = new Map<string, { pct: number; code: string }>()
  const mgmt = db.contracts
    .filter((k) => k.organization_id === orgId && k.kind === 'management' && ['active', 'ended', 'terminated'].includes(k.status))
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1)) // do mais antigo ao mais novo: o novo sobrescreve
  const ids = new Set(mgmt.map((k) => k.id))
  const lessors = new Map<Id, Id[]>()
  for (const p of db.contract_parties) if (ids.has(p.contract_id) && p.role === 'lessor') lessors.set(p.contract_id, [...(lessors.get(p.contract_id) ?? []), p.person_id])
  for (const k of mgmt) for (const person of lessors.get(k.id) ?? []) out.set(`${person}:${k.property_id}`, { pct: k.admin_fee_pct, code: k.code })
  return out
}

/** Taxa padrão quando o dono não tem contrato de administração (a mesma que os dados fictícios usam). */
export const DEFAULT_ADMIN_FEE_PCT = 10

/** Próximo código LOC-AAAA-NNNN: o número segue a sequência da conta (o ano é o do início). */
function nextLeaseCode(db: Db, orgId: Id, start: IsoDate): string {
  let max = 0
  for (const k of db.contracts) {
    if (k.organization_id !== orgId) continue
    const m = /^LOC-\d{4}-(\d+)$/.exec(k.code)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `LOC-${start.slice(0, 4)}-${String(max + 1).padStart(4, '0')}`
}

function newEvent(s: Session, k: Contract, e: { kind: ContractEventKind; date: IsoDate; from?: ContractStatus | null; to?: ContractStatus | null; payload?: ContractEvent['payload']; note?: string }): ContractEvent {
  const now = nowIso()
  return {
    id: newId(), organization_id: k.organization_id, created_at: now, updated_at: now, created_by: s.user.id,
    contract_id: k.id, kind: e.kind, effective_date: e.date, from_status: e.from ?? null, to_status: e.to ?? null,
    payload: e.payload ?? {}, note: e.note ?? '', document_id: null,
  }
}

function newParty(s: Session, k: Contract, personId: Id, role: ContractParty['role'], share: number | null): ContractParty {
  const now = nowIso()
  return { id: newId(), organization_id: k.organization_id, created_at: now, updated_at: now, created_by: s.user.id, contract_id: k.id, person_id: personId, role, share_pct: share }
}

export interface LeaseContext {
  unit: UnitRow
  /** Locadores = donos vigentes da unidade, com a fatia de cada um (só leitura no assistente). */
  lessors: { person_id: Id; name: string; share_pct: number }[]
  admin_fee_pct: number
  admin_contract_code: string | null
  /** Locações desta unidade que seguram algum período (para avisar o início possível antes de gravar). */
  holding: { id: Id; code: string; status: ContractStatus; start_date: IsoDate; end_date: IsoDate }[]
}

/** O que o assistente precisa saber da unidade escolhida: donos, taxa e quem já segura a unidade. */
export async function getLeaseContext(s: Session, unitId: Id): Promise<LeaseContext> {
  const { db, sc } = await connect(s)
  const unit = toUnitRows(db, sc, s.today).find((u) => u.id === unitId)
  if (!unit) throw new AccessError('Unidade não encontrada ou fora do seu acesso.')
  const first = unit.owners[0]
  const fee = s.org.kind === 'agency' && first ? managementFeeMap(db, s.org.id).get(`${first.person_id}:${unit.property_id}`) : undefined
  return {
    unit,
    lessors: unit.owners,
    admin_fee_pct: s.org.kind === 'agency' ? (fee?.pct ?? DEFAULT_ADMIN_FEE_PCT) : 0,
    admin_contract_code: fee?.code ?? null,
    holding: db.contracts
      .filter((k) => k.organization_id === s.org.id && k.kind === 'lease' && k.unit_id === unitId && HOLDING_STATUSES.includes(k.status))
      .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))
      .map((k) => ({ id: k.id, code: k.code, status: k.status, start_date: k.start_date, end_date: k.end_date })),
  }
}

/**
 * Cria a locação em RASCUNHO (nada é cobrado nem ocupa a unidade ainda).
 * Passo a passo:
 *   1. permissão (equipe com contracts:edit) e validação do formato (zod);
 *   2. unidade visível e não arquivada; fim depois do início; sem conflito com quem segura a unidade;
 *   3. garantia única e limite da caução;
 *   4. pessoas: locadores = donos da unidade; locatário e fiador (existentes ou novos);
 *   5. só então grava: pessoas novas, contrato, partes, evento "criado" e auditoria.
 * Validar TUDO antes de gravar QUALQUER coisa evita deixar uma pessoa criada pela metade
 * quando a regra recusa o contrato no passo seguinte.
 */
export async function createLease(s: Session, input: NewLeaseInput): Promise<Contract> {
  // 1.
  const { db, sc } = await connect(s)
  if (!sc.all || !can(s, 'contracts:edit')) throw new AccessError('Só a equipe com permissão de editar contratos cria uma locação.')
  const d = newLeaseSchema.parse(input)
  // 2.
  const u = db.units.find((x) => x.id === d.unit_id)
  if (!u || !see.unit(sc, u)) throw new RuleError('A unidade escolhida não existe mais ou é de outra conta. Escolha de novo.')
  if (u.deleted_at) throw new RuleError(`A unidade ${u.code} está arquivada: restaure a unidade em Imóveis antes de alugar.`)
  const end = endDateFor(d.start_date, d.months)
  if (end <= d.start_date) throw new RuleError('O fim do contrato precisa ser depois do início.')
  const clash = findClash(db, s.org.id, u.id, { start_date: d.start_date, end_date: end })
  if (clash) throw new RuleError(clashMessage(u.code, clash))
  // 3.
  checkGuarantee(d)
  // 4.
  const L = lookup(db)
  const lessors = ownersOf(L, u, s.today)
  if (!lessors.length) throw new RuleError(`A unidade ${u.code} não tem proprietário cadastrado: inclua o dono em Imóveis antes de alugar.`)
  const lessee = resolveParty(db, sc, s, d.lessee, 'locatário')
  const guarantor = d.guarantor ? resolveParty(db, sc, s, d.guarantor, 'fiador') : null
  if (lessors.some((o) => o.person_id === lessee.person.id)) throw new RuleError(`${lessee.person.name} é dono desta unidade: o locatário precisa ser outra pessoa.`)
  if (guarantor && (guarantor.person.id === lessee.person.id || guarantor.person.document === lessee.person.document)) {
    throw new RuleError('O fiador precisa ser outra pessoa: o locatário não pode garantir o próprio contrato.')
  }
  const fee = s.org.kind === 'agency' ? (managementFeeMap(db, s.org.id).get(`${lessors[0].person_id}:${u.property_id}`)?.pct ?? DEFAULT_ADMIN_FEE_PCT) : 0
  // 5.
  const now = nowIso()
  const k: Contract = {
    id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id,
    kind: 'lease', code: nextLeaseCode(db, s.org.id, d.start_date), unit_id: u.id, property_id: u.property_id, status: 'draft',
    start_date: d.start_date, end_date: end, rent_cents: d.rent_cents, due_day: d.due_day,
    adjustment_index: d.adjustment_index, adjustment_month: d.adjustment_month, guarantee_type: d.guarantee_type,
    deposit_cents: d.guarantee_type === 'deposit' ? d.deposit_cents : 0, admin_fee_pct: fee,
    late_fee_pct: d.late_fee_pct, interest_pct_month: d.interest_pct_month, notes: d.notes.trim(),
    reviewed_by: null, approved_by: null, parent_contract_id: null, import_batch_id: null,
  }
  const newPeople = [lessee, guarantor].filter((p): p is { person: Person; isNew: boolean } => !!p && p.isNew).map((p) => p.person)
  if (newPeople.length) upsertRows('people', newPeople)
  for (const p of newPeople) audit(s, 'people', p.id, 'create', `Cadastrou ${p.name} ao criar a locação ${k.code}`)
  upsertRows('contracts', [k])
  upsertRows('contract_parties', [
    ...lessors.map((o) => newParty(s, k, o.person_id, 'lessor', o.share_pct)),
    newParty(s, k, lessee.person.id, 'lessee', null),
    ...(guarantor ? [newParty(s, k, guarantor.person.id, 'guarantor', null)] : []),
  ])
  upsertRows('contract_events', [newEvent(s, k, { kind: 'created', date: s.today, to: 'draft', note: 'Contrato criado em rascunho.' })])
  audit(s, 'contracts', k.id, 'create', `Criou a locação ${k.code} (${u.code}, ${formatBRL(k.rent_cents)})`)
  return k
}

/* ---------------------------------------------------------------- 3. situação */

/** Texto do botão de cada caminho permitido (a tela e os testes usam o mesmo). */
export function transitionLabel(from: ContractStatus, to: ContractStatus): string {
  if (to === 'in_review') return from === 'draft' ? 'Enviar para revisão' : 'Devolver para revisão'
  if (to === 'draft') return 'Devolver para rascunho'
  if (to === 'awaiting_approval') return 'Enviar para aprovação'
  if (to === 'awaiting_signature') return 'Aprovar e aguardar assinatura'
  if (to === 'active') return 'Registrar assinatura e ativar'
  if (to === 'ended') return 'Encerrar'
  return from === 'active' ? 'Rescindir' : 'Cancelar contrato'
}

/** Caminho "para a frente" (vira o botão principal); os outros vão para "Mais ações". */
export function isForwardStep(from: ContractStatus, to: ContractStatus): boolean {
  const flow: ContractStatus[] = ['draft', 'in_review', 'awaiting_approval', 'awaiting_signature', 'active']
  return flow.indexOf(to) === flow.indexOf(from) + 1 && flow.includes(to)
}

/** Aprovar pede contracts:approve; todo o resto pede contracts:edit. */
export function permissionFor(from: ContractStatus, to: ContractStatus): 'contracts:approve' | 'contracts:edit' {
  return from === 'awaiting_approval' && to === 'awaiting_signature' ? 'contracts:approve' : 'contracts:edit'
}

/**
 * HORIZONTE das cobranças mensais (decisão do módulo, documentada aqui):
 * da competência do início até 12 meses depois de hoje (ou do início, se o contrato começa no
 * futuro), sem passar da competência do fim. Por que 12: o ano à frente fica visível para o
 * inquilino e para o proprietário, e um contrato de 30 meses não cria de uma vez linhas que ainda
 * vão mudar (reajuste, rescisão). Depois o horizonte CRESCE: a mesma geração roda de novo (botão
 * "Gerar próximas cobranças" hoje; rotina diária na fase 2) e cria só o que falta.
 */
export function rentHorizon(k: Pick<Contract, 'start_date' | 'end_date'>, today: IsoDate): { from: IsoDate; to: IsoDate } {
  const anchor = k.start_date > today ? k.start_date : today
  const limit = monthStart(addMonths(anchor, 12))
  const last = monthStart(k.end_date)
  return { from: monthStart(k.start_date), to: limit < last ? limit : last }
}

/**
 * Competências de aluguel que faltam gerar. A série CONTINUA de onde parou (a última competência
 * que já existe, inclusive cancelada) e não volta para preencher meses antigos: os contratos
 * fictícios só têm cobrança dos últimos 12 meses, e "preencher buracos" criaria anos de aluguel
 * vencido que nunca existiu. A chave é contrato + competência: rodar duas vezes não duplica.
 */
export function missingRentCompetences(db: Db, k: Contract, today: IsoDate): IsoDate[] {
  const mine = db.financial_entries.filter((e) => e.recurrence_group === k.id && e.category === 'rent')
  const have = new Set(mine.map((e) => e.competence))
  const lastDone = mine.reduce((max, e) => (e.competence > max ? e.competence : max), '')
  const { from, to } = rentHorizon(k, today)
  const out: IsoDate[] = []
  for (let m = lastDone ? addMonths(lastDone, 1) : from; m <= to; m = addMonths(m, 1)) if (!have.has(m)) out.push(m)
  return out
}

/** Monta (sem gravar) as cobranças de aluguel que faltam, com a mesma forma das cobranças fictícias. */
export function buildRentEntries(db: Db, k: Contract, today: IsoDate, userId: Id): FinancialEntry[] {
  const lessee = db.contract_parties.find((p) => p.contract_id === k.id && p.role === 'lessee')
  if (!lessee) throw new RuleError(`O contrato ${k.code} não tem locatário: inclua o locatário antes de gerar cobranças.`)
  const now = nowIso()
  return missingRentCompetences(db, k, today).map((m) => ({
    id: newId(), organization_id: k.organization_id, created_at: now, updated_at: now, created_by: userId,
    direction: 'receivable', category: 'rent', description: `Aluguel ${formatMonth(m)}`,
    contract_id: k.id, unit_id: k.unit_id, property_id: k.property_id, person_id: lessee.person_id,
    // dueDateFor parte do dia combinado em cada mês: o dia 31 vira 28/02 e volta a 31 em março.
    competence: m, due_date: dueDateFor(m, k.due_day), amount_cents: k.rent_cents, charged_to: null,
    status: 'open', recurrence_group: k.id, transfer_id: null, import_batch_id: null,
  }))
}

/**
 * Cobranças a receber do contrato, em aberto, de competência DEPOIS do mês de `date`.
 * A do próprio mês da saída fica: as cobranças fictícias cobram o mês cheio no início e no fim do
 * contrato, e o proporcional (dias usados) é ajuste manual no MVP. Das que sobram, as SEM pagamento
 * são canceladas; as com pagamento parcial ficam em aberto (não se cancela o que já recebeu dinheiro).
 */
function openReceivablesAfter(db: Db, k: Contract, date: IsoDate): { cancel: FinancialEntry[]; kept: FinancialEntry[] } {
  const paid = paidByEntry(db.payments)
  const month = monthStart(date)
  const later = db.financial_entries.filter((e) => e.contract_id === k.id && e.direction === 'receivable' && e.status === 'open' && e.competence > month)
  return { cancel: later.filter((e) => !paid.get(e.id)), kept: later.filter((e) => !!paid.get(e.id)) }
}

export const transitionSchema = z.object({
  id: z.string().min(1),
  to: z.enum(STATUSES),
  note: z.string().trim().max(500, 'Observação de até 500 caracteres.'),
  /** Só para rescindir: o dia da saída (entrega das chaves). */
  date: isoDateSchema.optional(),
})
export type TransitionInput = z.infer<typeof transitionSchema>

export interface TransitionResult {
  contract: Contract
  created: number
  canceled: number
  /** Cobranças com pagamento parcial que ficaram em aberto (não se cancela o que já recebeu dinheiro). */
  kept: number
}

/**
 * Muda a situação do contrato. Passo a passo:
 *   1. contrato visível; permissão do caminho (aprovar = contracts:approve; o resto = contracts:edit);
 *   2. o caminho existe em CONTRACT_TRANSITIONS (qualquer outro é recusado);
 *   3. entrar em "aguardando assinatura" ou "vigente" confere de novo a sobreposição: entre o
 *      rascunho e a aprovação, outra locação pode ter passado a segurar a unidade;
 *   4. efeitos: ativar gera as cobranças; encerrar só depois do fim; rescindir grava o dia da saída,
 *      encurta o fim e cancela as cobranças futuras em aberto;
 *   5. grava contrato + evento (de/para, com o fim planejado na rescisão) + auditoria.
 */
export async function changeContractStatus(s: Session, input: TransitionInput): Promise<TransitionResult> {
  // 1.
  const { db, sc } = await connect(s)
  const d = transitionSchema.parse(input)
  const k = db.contracts.find((x) => x.id === d.id)
  if (!k || !see.contract(sc, k)) throw new AccessError('Contrato não encontrado ou fora do seu acesso.')
  const from = k.status
  const needed = permissionFor(from, d.to)
  if (!sc.all || !can(s, needed)) {
    throw new AccessError(needed === 'contracts:approve' ? 'Aprovar contrato pede a permissão de aprovação.' : 'Mudar a situação do contrato pede a permissão de editar contratos.')
  }
  // 2.
  if (!canTransition(from, d.to)) {
    const ways = CONTRACT_TRANSITIONS[from].map((t) => CONTRACT_STATUS[t].toLowerCase())
    throw new RuleError(`De "${CONTRACT_STATUS[from]}" o contrato não vai para "${CONTRACT_STATUS[d.to]}". ${ways.length ? `Caminhos possíveis: ${ways.join(', ')}.` : 'Esta situação é final.'}`)
  }
  // 3.
  if (k.kind === 'lease' && k.unit_id && HOLDING_STATUSES.includes(d.to)) {
    const clash = findClash(db, k.organization_id, k.unit_id, k, k.id)
    if (clash) throw new RuleError(clashMessage(db.units.find((u) => u.id === k.unit_id)?.code ?? 'escolhida', clash))
  }
  // 4.
  const next: Contract = { ...k, status: d.to, updated_at: nowIso() }
  let created: FinancialEntry[] = []
  let cancel: FinancialEntry[] = []
  let kept: FinancialEntry[] = []
  let effective = s.today
  const payload: ContractEvent['payload'] = {}
  if (from === 'in_review' && d.to === 'awaiting_approval') next.reviewed_by = s.user.id
  if (d.to === 'awaiting_signature' && from === 'awaiting_approval') next.approved_by = s.user.id
  if (d.to === 'active' && k.kind === 'lease') {
    created = buildRentEntries(db, next, s.today, s.user.id)
    payload.entries_created = created.length
  }
  if (d.to === 'ended') {
    if (s.today < k.end_date) throw new RuleError(`O prazo vai até ${formatDate(k.end_date)}. Para encerrar antes do fim, use "Rescindir".`)
    ;({ cancel, kept } = openReceivablesAfter(db, k, k.end_date))
  }
  if (d.to === 'terminated') {
    if (from === 'active') {
      // Rescisão: o dia é o da SAÍDA, nunca no futuro. Gravada antes, a unidade apareceria vaga
      // (a ocupação vem do contrato vigente) com o inquilino ainda morando nela.
      const exit = d.date ?? s.today
      if (exit > s.today) throw new RuleError('Registre a rescisão no dia da saída (entrega das chaves), não antes. O aviso prévio vai como observação.')
      if (exit < k.start_date) throw new RuleError(`A saída não pode ser antes do início do contrato (${formatDate(k.start_date)}).`)
      if (exit > k.end_date) throw new RuleError(`A saída é depois do fim do prazo (${formatDate(k.end_date)}): use "Encerrar".`)
      if (d.note.length < 3) throw new RuleError('Conte o motivo da rescisão (fica na linha do tempo do contrato).')
      payload.planned_end = k.end_date
      next.end_date = exit
      effective = exit
      ;({ cancel, kept } = openReceivablesAfter(db, k, exit))
    } else {
      // Antes de assinar não há cobrança; cancela o que houver por garantia (qualquer competência).
      ;({ cancel, kept } = openReceivablesAfter(db, k, '1900-01-01'))
    }
  }
  if (cancel.length) payload.entries_canceled = cancel.length
  // 5.
  upsertRows('contracts', [next])
  if (created.length) upsertRows('financial_entries', created)
  if (cancel.length) upsertRows('financial_entries', cancel.map((e) => ({ ...e, status: 'canceled' as const, updated_at: nowIso() })))
  const autoNote =
    d.to === 'active' && created.length
      ? `${created.length} cobranças mensais geradas (${formatMonth(created[0].competence)} a ${formatMonth(created[created.length - 1].competence)}).`
      : cancel.length
        ? `${cancel.length} cobranças futuras canceladas.`
        : ''
  upsertRows('contract_events', [newEvent(s, k, { kind: 'status', date: effective, from, to: d.to, payload, note: [d.note, autoNote].filter(Boolean).join(' ') })])
  audit(s, 'contracts', k.id, needed === 'contracts:approve' ? 'approve' : 'status', `Contrato ${k.code}: ${CONTRACT_STATUS[from]} → ${CONTRACT_STATUS[d.to]}`, {
    status: { from, to: d.to },
    ...(next.end_date !== k.end_date ? { end_date: { from: k.end_date, to: next.end_date } } : {}),
  })
  return { contract: next, created: created.length, canceled: cancel.length, kept: kept.length }
}

/**
 * "Gerar próximas cobranças": a mesma geração da ativação, sob demanda (faz o horizonte crescer).
 * Idempotente: só cria a competência que ainda não existe. Na fase 2 a rotina diária chama esta função.
 */
export async function generateRentEntries(s: Session, args: { id: Id }): Promise<{ created: number; to: IsoDate | null }> {
  const { db, sc } = await connect(s)
  const k = db.contracts.find((x) => x.id === args.id)
  if (!k || !see.contract(sc, k)) throw new AccessError('Contrato não encontrado ou fora do seu acesso.')
  if (!sc.all || !(can(s, 'contracts:edit') || can(s, 'finance:edit'))) throw new AccessError('Gerar cobranças pede permissão de editar contratos ou o financeiro.')
  if (k.kind !== 'lease' || k.status !== 'active') throw new RuleError('Só locação vigente gera cobrança mensal.')
  const rows = buildRentEntries(db, k, s.today, s.user.id)
  if (rows.length) {
    upsertRows('financial_entries', rows)
    audit(s, 'contracts', k.id, 'update', `Gerou ${rows.length} cobranças de aluguel do contrato ${k.code}`)
  }
  return { created: rows.length, to: rows.length ? rows[rows.length - 1].competence : null }
}

/* ---------------------------------------------------------------- 4. reajuste, aditivo, observação, renovação */

/** Lei 10.192/2001: reajuste uma vez por ano, contado do início ou do último reajuste. */
function minAdjustmentDate(db: Db, k: Contract): IsoDate {
  const last = db.contract_events
    .filter((e) => e.contract_id === k.id && e.kind === 'adjustment')
    .reduce((max, e) => (e.effective_date > max ? e.effective_date : max), '')
  return addMonths(last || k.start_date, 12)
}

export const adjustmentSchema = z.object({
  id: z.string().min(1),
  index: z.enum(INDEXES),
  pct: z.number().min(-50, 'Percentual abaixo de -50%: confira o índice.').max(100, 'Percentual acima de 100%: confira o índice.'),
  effective_date: isoDateSchema,
  note: z.string().trim().max(500),
})
export type AdjustmentInput = z.infer<typeof adjustmentSchema>

/**
 * Registra o reajuste: o aluguel novo vale para as cobranças EM ABERTO que vencem a partir da data
 * (as já pagas ou com pagamento parcial ficam como estão: mexer nelas mudaria o que já foi recebido).
 * No MVP a pessoa digita o percentual; o índice automático (Banco Central) é a fase 2.
 */
export async function registerAdjustment(s: Session, input: AdjustmentInput): Promise<{ contract: Contract; updated: number }> {
  const { db, sc } = await connect(s)
  const d = adjustmentSchema.parse(input)
  const k = db.contracts.find((x) => x.id === d.id)
  if (!k || !see.contract(sc, k)) throw new AccessError('Contrato não encontrado ou fora do seu acesso.')
  if (!sc.all || !can(s, 'contracts:edit')) throw new AccessError('Registrar reajuste pede a permissão de editar contratos.')
  if (k.kind !== 'lease' || k.status !== 'active') throw new RuleError('Reajuste só em locação vigente.')
  if (d.effective_date < k.start_date || d.effective_date > k.end_date) throw new RuleError(`A data do reajuste precisa estar dentro do contrato (${period(k)}).`)
  const min = minAdjustmentDate(db, k)
  if (d.effective_date < min) throw new RuleError(`Reajuste só uma vez por ano (Lei 10.192/2001): o próximo pode valer a partir de ${formatDate(min)}.`)
  const to = k.rent_cents + applyPct(k.rent_cents, d.pct)
  if (to <= 0) throw new RuleError('O aluguel reajustado ficaria zerado ou negativo: confira o percentual.')
  const paid = paidByEntry(db.payments)
  const affected = db.financial_entries.filter(
    (e) => e.contract_id === k.id && e.category === 'rent' && e.status === 'open' && e.due_date >= d.effective_date && !paid.get(e.id),
  )
  const next: Contract = { ...k, rent_cents: to, adjustment_index: d.index, updated_at: nowIso() }
  upsertRows('contracts', [next])
  if (affected.length) upsertRows('financial_entries', affected.map((e) => ({ ...e, amount_cents: to, updated_at: nowIso() })))
  upsertRows('contract_events', [
    newEvent(s, k, {
      kind: 'adjustment', date: d.effective_date,
      payload: { index: d.index, pct: d.pct, from_cents: k.rent_cents, to_cents: to, entries_updated: affected.length },
      note: d.note || `Reajuste anual pelo ${d.index === 'fixed' ? 'percentual fixo' : ADJUSTMENT_INDEX[d.index]}.`,
    }),
  ])
  audit(s, 'contracts', k.id, 'update', `Reajuste de ${d.pct.toLocaleString('pt-BR')}% no contrato ${k.code}: ${formatBRL(k.rent_cents)} para ${formatBRL(to)}`, {
    rent_cents: { from: k.rent_cents, to },
  })
  return { contract: next, updated: affected.length }
}

export const eventSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['note', 'amendment']),
  effective_date: isoDateSchema,
  note: z.string().trim().min(3, 'Escreva pelo menos 3 letras.').max(1000, 'Até 1.000 caracteres.'),
})
export type EventInput = z.infer<typeof eventSchema>

/** Observação (interna da equipe) ou aditivo (muda o contrato por acordo das partes) na linha do tempo. */
export async function addContractEvent(s: Session, input: EventInput): Promise<ContractEvent> {
  const { db, sc } = await connect(s)
  const d = eventSchema.parse(input)
  const k = db.contracts.find((x) => x.id === d.id)
  if (!k || !see.contract(sc, k)) throw new AccessError('Contrato não encontrado ou fora do seu acesso.')
  if (!sc.all || !can(s, 'contracts:edit')) throw new AccessError('Registrar na linha do tempo pede a permissão de editar contratos.')
  if (d.kind === 'note' && d.effective_date > s.today) throw new RuleError('Observação registra o que já aconteceu: use hoje ou uma data anterior.')
  const ev = newEvent(s, k, { kind: d.kind, date: d.effective_date, note: d.note })
  upsertRows('contract_events', [ev])
  audit(s, 'contracts', k.id, 'update', `${d.kind === 'note' ? 'Observação' : 'Aditivo'} no contrato ${k.code}`)
  return ev
}

/**
 * Renovar: cria um contrato NOVO em rascunho, ligado ao anterior (parent_contract_id), começando no
 * dia seguinte ao fim. Mesmo prazo, aluguel atual, mesmas partes e garantia; os locadores vêm dos
 * donos de HOJE (a unidade pode ter mudado de dono). O novo passa por revisão e aprovação como qualquer
 * contrato; o anterior segue vigente até o fim.
 */
export async function renewContract(s: Session, args: { id: Id }): Promise<Contract> {
  const { db, sc } = await connect(s)
  const k = db.contracts.find((x) => x.id === args.id)
  if (!k || !see.contract(sc, k)) throw new AccessError('Contrato não encontrado ou fora do seu acesso.')
  if (!sc.all || !can(s, 'contracts:edit')) throw new AccessError('Renovar pede a permissão de editar contratos.')
  if (k.kind !== 'lease' || k.status !== 'active' || !k.unit_id) throw new RuleError('Só locação vigente pode ser renovada.')
  const existing = db.contracts.find((x) => x.parent_contract_id === k.id && x.status !== 'terminated')
  if (existing) throw new RuleError(`Este contrato já tem a renovação ${existing.code} (${CONTRACT_STATUS[existing.status].toLowerCase()}). Continue por ela.`)
  const u = db.units.find((x) => x.id === k.unit_id)!
  const start = addDays(k.end_date, 1)
  // Mesmo prazo do anterior, em meses: do início dele até o dia seguinte ao fim (01/06 a 31/05 = 12).
  const months = Math.max(1, monthsBetween(k.start_date, start))
  const end = endDateFor(start, months)
  const clash = findClash(db, k.organization_id, k.unit_id, { start_date: start, end_date: end }, k.id)
  if (clash) throw new RuleError(clashMessage(u.code, clash))
  const L = lookup(db)
  const lessors = ownersOf(L, u, s.today)
  const old = db.contract_parties.filter((p) => p.contract_id === k.id)
  const now = nowIso()
  const renewed: Contract = {
    ...k, id: newId(), created_at: now, updated_at: now, created_by: s.user.id, code: nextLeaseCode(db, k.organization_id, start),
    status: 'draft', start_date: start, end_date: end, adjustment_month: Number(start.slice(5, 7)),
    reviewed_by: null, approved_by: null, parent_contract_id: k.id, import_batch_id: null, notes: `Renovação de ${k.code}.`,
  }
  upsertRows('contracts', [renewed])
  upsertRows('contract_parties', [
    ...(lessors.length ? lessors.map((o) => newParty(s, renewed, o.person_id, 'lessor', o.share_pct)) : old.filter((p) => p.role === 'lessor').map((p) => newParty(s, renewed, p.person_id, 'lessor', p.share_pct))),
    ...old.filter((p) => p.role !== 'lessor').map((p) => newParty(s, renewed, p.person_id, p.role, p.share_pct)),
  ])
  upsertRows('contract_events', [
    newEvent(s, renewed, { kind: 'created', date: s.today, to: 'draft', payload: { parent_code: k.code }, note: `Renovação de ${k.code}, criada em rascunho.` }),
    newEvent(s, k, { kind: 'renewal', date: s.today, payload: { new_contract_id: renewed.id, new_code: renewed.code }, note: `Renovação criada: ${renewed.code} (${period(renewed)}).` }),
  ])
  audit(s, 'contracts', renewed.id, 'create', `Renovou ${k.code} em ${renewed.code} (rascunho)`)
  return renewed
}

/* ---------------------------------------------------------------- 5. documentos */

/** Documentos ligados ao contrato que a sessão enxerga (see.document já aplica "quem vê" do portal). */
export async function listContractDocuments(s: Session, contractId: Id): Promise<DocumentFile[]> {
  const { db, sc } = await connect(s)
  return db.documents.filter((d) => d.contract_id === contractId && see.document(sc, d)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}
