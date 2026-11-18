/* =============================================================================
   Financeiro: lançamentos a receber e a pagar, baixa (pagamento) e cancelamento.

   A LISTA vem pronta da view (data/views/finance.ts: listEntries, com "vencido" calculado com o
   hoje da sessão e os totais do recorte). Aqui moram as GRAVAÇÕES, no formato do módulo de
   referência: permissão -> validação (zod) -> regra (RuleError com causa e conserto) -> gravar
   -> auditar.

   Três regras que valem para toda gravação deste arquivo:
   1. Nada some: lançamento é CANCELADO (status), pagamento nunca é apagado.
   2. "Vencido" e "pago" saem dos fatos: lançamento fica "pago" quando a soma dos pagamentos
      cobre o valor; pagamento parcial deixa o saldo em aberto.
   3. Lançamento de repasse (e a taxa retida nele) só se mexe pela tela Repasses; assim o
      repasse e a conta a pagar dele nunca discordam.
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, audit, connect, nowIso, RuleError } from '@/data/api'
import { ENTRY_CATEGORY, PAYMENT_METHOD } from '@/data/labels'
import { paidByEntry } from '@/data/rules'
import { see } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type { EntryCategory, FinancialEntry, Id, Payment } from '@/data/types'
import { toUnitRows } from '@/data/views/units'
import { addMonths, dueDateFor, formatDate, formatMonth, monthStart, parts } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { newId } from '@/lib/random'
import { isoDateSchema } from '@/modules/contratos/repo'

/** Só a equipe com finance:edit grava (o portal nunca grava no financeiro). */
function assertCanEdit(s: Session, all: boolean): void {
  if (!all || !can(s, 'finance:edit')) throw new AccessError('Gravar no financeiro pede a permissão de editar o financeiro.')
}

/** Lançamento que nasce de um repasse: a baixa e o cancelamento dele são feitos pelo repasse. */
function assertNotTransfer(e: FinancialEntry): void {
  if (e.transfer_id) throw new RuleError(`"${e.description}" faz parte de um repasse ao proprietário: mexa nele pela tela Repasses.`)
}

/* ---------------------------------------------------------------- baixa */

export const paymentSchema = z.object({
  entry_id: z.string().min(1),
  amount_cents: z.number().int().min(1, 'O valor da baixa precisa ser maior que zero.'),
  paid_at: isoDateSchema,
  method: z.enum(['pix', 'boleto', 'transfer', 'cash', 'card', 'other']),
  reference: z.string().trim().max(120, 'Referência de até 120 caracteres.'),
})
export type PaymentInput = z.infer<typeof paymentSchema>

export interface PaymentResult {
  entry: FinancialEntry
  payment: Payment
  /** O que ainda falta depois desta baixa (0 = quitado). */
  open_cents: number
}

/**
 * Dar baixa: registra o que entrou (ou saiu) de verdade. Passo a passo:
 *   1. permissão e formato;
 *   2. lançamento visível, em aberto e fora de repasse;
 *   3. valor maior que zero e até o saldo em aberto (parcial é permitido); data até hoje;
 *   4. grava o pagamento; se a soma cobre o valor, o lançamento vira "pago";
 *   5. auditoria.
 */
export async function registerPayment(s: Session, input: PaymentInput): Promise<PaymentResult> {
  // 1.
  const { db, sc } = await connect(s)
  assertCanEdit(s, sc.all)
  const d = paymentSchema.parse(input)
  // 2.
  const e = db.financial_entries.find((x) => x.id === d.entry_id)
  if (!e || !see.entry(sc, e)) throw new AccessError('Lançamento não encontrado ou fora do seu acesso.')
  if (e.status !== 'open') throw new RuleError(`"${e.description}" já está ${e.status === 'paid' ? 'quitado' : 'cancelado'}: não há saldo para baixar.`)
  assertNotTransfer(e)
  // 3.
  const paidBefore = paidByEntry(db.payments.filter((p) => p.entry_id === e.id)).get(e.id) ?? 0
  const open = e.amount_cents - paidBefore
  if (d.amount_cents > open) {
    throw new RuleError(`A baixa de ${formatBRL(d.amount_cents)} passa do saldo em aberto (${formatBRL(open)}). Para registrar a mais, lance a diferença como outro lançamento.`)
  }
  if (d.paid_at > s.today) throw new RuleError(`Data no futuro: a baixa registra o que já aconteceu. Use hoje (${formatDate(s.today)}) ou uma data anterior.`)
  // 4.
  const now = nowIso()
  const payment: Payment = {
    id: newId(), organization_id: e.organization_id, created_at: now, updated_at: now, created_by: s.user.id,
    entry_id: e.id, paid_at: d.paid_at, amount_cents: d.amount_cents, method: d.method, reference: d.reference,
  }
  const left = open - d.amount_cents
  const entry: FinancialEntry = left === 0 ? { ...e, status: 'paid', updated_at: now } : e
  upsertRows('payments', [payment])
  if (left === 0) upsertRows('financial_entries', [entry])
  // 5.
  audit(s, 'financial_entries', e.id, 'payment', `Baixa de ${formatBRL(d.amount_cents)} em "${e.description}" (${PAYMENT_METHOD[d.method]}, ${formatDate(d.paid_at)})${left ? `; saldo em aberto ${formatBRL(left)}` : '; quitado'}`)
  return { entry, payment, open_cents: left }
}

/* ---------------------------------------------------------------- novo lançamento */

/**
 * Categorias que se lançam à mão. As outras nascem de um processo e só dele:
 * aluguel nasce do contrato ativado (com a chave contrato + competência), repasse e taxa nascem
 * do repasse aprovado. Lançar aluguel à mão abriria a porta para cobrar o mesmo mês duas vezes.
 */
export const MANUAL_CATEGORIES: EntryCategory[] = ['condo_fee', 'iptu', 'maintenance', 'deposit', 'other']

export const newEntrySchema = z.object({
  direction: z.enum(['receivable', 'payable']),
  category: z.enum(['rent', 'condo_fee', 'iptu', 'admin_fee', 'maintenance', 'transfer', 'deposit', 'other']),
  description: z.string().trim().min(3, 'Descreva com pelo menos 3 letras.').max(120, 'Descrição de até 120 caracteres.'),
  person_id: z.string().nullable(),
  unit_id: z.string().nullable(),
  contract_id: z.string().nullable(),
  competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência no formato AAAA-MM.'),
  due_date: isoDateSchema,
  amount_cents: z.number().int().min(1, 'O valor precisa ser maior que zero.'),
  charged_to: z.enum(['owner', 'lessee', 'agency']).nullable(),
  repeat: z.number().int().min(1, 'Repita de 1 a 36 vezes.').max(36, 'Repita de 1 a 36 vezes.'),
})
export type NewEntryInput = z.infer<typeof newEntrySchema>

/**
 * Cria um lançamento ou uma série mensal (repetir N vezes). Passo a passo:
 *   1. permissão, formato e categoria permitida à mão;
 *   2. ligações (contrato, unidade, pessoa) visíveis na conta; o contrato decide a unidade e o imóvel;
 *   3. série: cada mês parte do dia do primeiro vencimento (dueDateFor), então o dia 31 vira 28/02
 *      e volta a 31 em março; todas as parcelas levam o mesmo recurrence_group;
 *   4. grava e audita.
 */
export async function createEntries(s: Session, input: NewEntryInput): Promise<FinancialEntry[]> {
  // 1.
  const { db, sc } = await connect(s)
  assertCanEdit(s, sc.all)
  const d = newEntrySchema.parse(input)
  if (!MANUAL_CATEGORIES.includes(d.category)) {
    throw new RuleError(`${ENTRY_CATEGORY[d.category]} não se lança à mão: aluguel nasce do contrato ativado; repasse e taxa de administração nascem do repasse aprovado.`)
  }
  if (d.charged_to === 'agency' && s.org.kind !== 'agency') throw new RuleError('"Imobiliária" como quem arca só existe em conta de imobiliária.')
  // 2.
  let unitId = d.unit_id
  let propertyId: Id | null = null
  if (d.contract_id) {
    const k = db.contracts.find((x) => x.id === d.contract_id)
    if (!k || !see.contract(sc, k)) throw new RuleError('O contrato escolhido não existe mais ou é de outra conta.')
    if (unitId && k.unit_id && unitId !== k.unit_id) throw new RuleError(`O contrato ${k.code} é de outra unidade: escolha a unidade dele ou tire o contrato.`)
    unitId = k.unit_id
    propertyId = k.property_id
  }
  if (unitId) {
    const u = db.units.find((x) => x.id === unitId)
    if (!u || !see.unit(sc, u)) throw new RuleError('A unidade escolhida não existe mais ou é de outra conta.')
    propertyId = u.property_id
  }
  if (d.person_id) {
    const p = db.people.find((x) => x.id === d.person_id)
    if (!p || !see.person(sc, p) || p.deleted_at) throw new RuleError('A pessoa escolhida não existe mais ou é de outra conta.')
  }
  // 3.
  const group = d.repeat > 1 ? newId() : null
  const firstMonth = `${d.competence}-01`
  const dueMonth = monthStart(d.due_date)
  const dueDay = parts(d.due_date)[2]
  const now = nowIso()
  const rows: FinancialEntry[] = Array.from({ length: d.repeat }, (_, i) => ({
    id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id,
    direction: d.direction, category: d.category,
    description: d.repeat > 1 ? `${d.description.trim()} (${i + 1}/${d.repeat})` : d.description.trim(),
    contract_id: d.contract_id, unit_id: unitId, property_id: propertyId, person_id: d.person_id,
    competence: addMonths(firstMonth, i), due_date: dueDateFor(addMonths(dueMonth, i), dueDay),
    amount_cents: d.amount_cents, charged_to: d.charged_to, status: 'open', recurrence_group: group, transfer_id: null, import_batch_id: null,
  }))
  // 4.
  upsertRows('financial_entries', rows)
  for (const r of rows) audit(s, 'financial_entries', r.id, 'create', `Lançou "${r.description}" (${formatBRL(r.amount_cents)}, vence ${formatDate(r.due_date)})`)
  return rows
}

/* ---------------------------------------------------------------- cancelar e desfazer */

export const cancelSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(3, 'Conte o motivo com pelo menos 3 letras (fica na auditoria).').max(300, 'Motivo de até 300 caracteres.'),
})
export type CancelInput = z.infer<typeof cancelSchema>

/**
 * Cancelar: só lançamento em aberto e SEM pagamento. Com pagamento, cancelar apagaria da conta
 * um dinheiro que entrou; o caminho é baixar o saldo ou lançar um ajuste. O motivo vai para a auditoria.
 */
export async function cancelEntry(s: Session, input: CancelInput): Promise<FinancialEntry> {
  const { db, sc } = await connect(s)
  assertCanEdit(s, sc.all)
  const d = cancelSchema.parse(input)
  const e = db.financial_entries.find((x) => x.id === d.id)
  if (!e || !see.entry(sc, e)) throw new AccessError('Lançamento não encontrado ou fora do seu acesso.')
  assertNotTransfer(e)
  if (e.status !== 'open') throw new RuleError(`"${e.description}" já está ${e.status === 'paid' ? 'quitado' : 'cancelado'}.`)
  if (db.payments.some((p) => p.entry_id === e.id)) throw new RuleError(`"${e.description}" já tem pagamento registrado: dê baixa no saldo ou lance um ajuste em vez de cancelar.`)
  const row: FinancialEntry = { ...e, status: 'canceled', updated_at: nowIso() }
  upsertRows('financial_entries', [row])
  audit(s, 'financial_entries', e.id, 'update', `Cancelou "${e.description}" (${formatBRL(e.amount_cents)}). Motivo: ${d.reason}`, { status: { from: 'open', to: 'canceled' } })
  return row
}

/** "Desfazer" do cancelamento: volta a ficar em aberto (nunca a cobrança de um contrato que já acabou). */
export async function restoreEntry(s: Session, args: { id: Id }): Promise<FinancialEntry> {
  const { db, sc } = await connect(s)
  assertCanEdit(s, sc.all)
  const e = db.financial_entries.find((x) => x.id === args.id)
  if (!e || !see.entry(sc, e)) throw new AccessError('Lançamento não encontrado ou fora do seu acesso.')
  if (e.status !== 'canceled') throw new RuleError(`"${e.description}" não está cancelado.`)
  const k = e.contract_id ? db.contracts.find((x) => x.id === e.contract_id) : undefined
  if (k && ['ended', 'terminated'].includes(k.status) && e.competence > monthStart(k.end_date)) {
    throw new RuleError(`O contrato ${k.code} acabou em ${formatDate(k.end_date)}: a cobrança de ${formatMonth(e.competence)} não volta.`)
  }
  const row: FinancialEntry = { ...e, status: 'open', updated_at: nowIso() }
  upsertRows('financial_entries', [row])
  audit(s, 'financial_entries', e.id, 'undo', `Desfez o cancelamento de "${e.description}"`, { status: { from: 'canceled', to: 'open' } })
  return row
}

/* ---------------------------------------------------------------- opções dos formulários e filtros */

export interface UnitOption {
  id: Id
  code: string
  label: string
  property_id: Id
  property_name: string
  /** Locação vigente hoje: o formulário oferece ligar o lançamento a ela. */
  lease: { id: Id; code: string; lessee_name: string } | null
}

/** Unidades para o formulário de lançamento (as que a sessão enxerga, sem as arquivadas). */
export async function listUnitOptions(s: Session): Promise<UnitOption[]> {
  const { db, sc } = await connect(s)
  return toUnitRows(db, sc, s.today)
    .filter((u) => !u.deleted_at)
    .map((u) => ({ id: u.id, code: u.code, label: u.label, property_id: u.property_id, property_name: u.property_name, lease: u.lease ? { id: u.lease.id, code: u.lease.code, lessee_name: u.lease.lessee_name } : null }))
    .sort((a, b) => a.property_name.localeCompare(b.property_name, 'pt-BR') || a.code.localeCompare(b.code, 'pt-BR', { numeric: true }))
}

/** Imóveis para o filtro "Imóvel" (o nome; a contagem vem das facets da lista). */
export async function listPropertyOptions(s: Session): Promise<{ value: Id; label: string }[]> {
  const { db, sc } = await connect(s)
  return db.properties
    .filter((p) => see.property(sc, p) && !p.deleted_at)
    .map((p) => ({ value: p.id, label: p.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}
