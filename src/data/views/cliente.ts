/* =============================================================================
   views/cliente.ts: os números de RELACIONAMENTO que as tabelas mostram (07/11/2026, pedido do
   Fernando: "tempo de contrato, tempo total que é cliente, número de dependentes, se tem animais").
   Nada daqui é gravado: tudo sai dos contratos e das cobranças na hora (regra 006: fato com data
   ganha de campo que alguém esquece de atualizar). Na fase 2 vira parte das views do Postgres.

     - Cliente desde: o início do PRIMEIRO contrato da pessoa com esta conta, em qualquer papel
       (locatário, locador, fiador), contando só contrato que aconteceu de fato (vigente, encerrado
       ou rescindido, com início até hoje). Rascunho e proposta não contam;
     - Tempo como cliente: de "cliente desde" até hoje, em meses inteiros;
     - Tempo de contrato: duração (início ao fim), quanto já passou e quanto falta (só vigente);
     - Pontualidade: % das cobranças A RECEBER da pessoa que venceram nos últimos 12 meses e foram
       pagas INTEIRAS até o vencimento. Cancelada não conta; vencida em aberto e paga com atraso
       contam como "fora do prazo". Sem cobrança vencida no período: sem número (não é 100%);
     - Renovações: quantas vezes o contrato foi renovado até chegar nele (a corrente de
       parent_contract_id para trás).

   Quem vê (LGPD, ver types.ts > Person): a equipe da conta vê tudo; no portal, a pessoa vê o que é
   DELA. Dependentes, animais, veículos, ocupação, pontualidade e "cliente desde" de outra pessoa
   saem vazios (canSeeHousehold). Esconder na view, e não só na tela, é o que a RLS fará.
   ============================================================================= */
import { addDays, addMonths, monthsBetween } from '@/lib/dates'
import type { Db } from '../db'
import type { Scope } from '../scope'
import type { Contract, ContractStatus, Id, IsoDate } from '../types'

/** Contratos que aconteceram de fato (rascunho, revisão e assinatura pendente ainda não). */
export const HAPPENED: ContractStatus[] = ['active', 'ended', 'terminated']

/** A sessão pode ver o cadastro de moradia e o histórico desta pessoa? Equipe sim; portal, só o próprio. */
export function canSeeHousehold(sc: Pick<Scope, 'all' | 'personId'>, personId: Id | null | undefined): boolean {
  return !!personId && (sc.all || sc.personId === personId)
}

/** Meses inteiros de "from" até hoje (nunca negativo). */
export function monthsSince(from: IsoDate | null, today: IsoDate): number | null {
  return from ? Math.max(0, monthsBetween(from, today)) : null
}

/**
 * Cliente desde, por pessoa: o menor início entre os contratos que aconteceram, em qualquer papel.
 * Uma passada nos contratos e outra nas partes (a tabela de pessoas pede para todas de uma vez).
 */
export function clientSinceMap(db: Pick<Db, 'contracts' | 'contract_parties'>, today: IsoDate): Map<Id, IsoDate> {
  const start = new Map<Id, IsoDate>()
  for (const k of db.contracts) if (HAPPENED.includes(k.status) && k.start_date <= today) start.set(k.id, k.start_date)
  const out = new Map<Id, IsoDate>()
  for (const p of db.contract_parties) {
    const d = start.get(p.contract_id)
    if (!d) continue
    const cur = out.get(p.person_id)
    if (!cur || d < cur) out.set(p.person_id, d)
  }
  return out
}

export interface ContractTerm {
  /** Do início ao fim, em meses (01/01 a 31/12 = 12). */
  duration: number
  /** Quanto já passou (0 se ainda não começou; no máximo a duração). */
  elapsed: number
  /** Quanto falta até o fim; só para vigente (null nos outros). */
  remaining: number | null
}

/** Tempo de contrato. O fim é o último dia: a conta usa o dia seguinte para "fechar" o mês. */
export function contractTerm(k: Pick<Contract, 'start_date' | 'end_date' | 'status'>, today: IsoDate): ContractTerm {
  const after = addDays(k.end_date, 1)
  const duration = Math.max(0, monthsBetween(k.start_date, after))
  const until = today < after ? today : after
  const elapsed = k.start_date > today ? 0 : Math.min(duration, Math.max(0, monthsBetween(k.start_date, until)))
  return { duration, elapsed, remaining: k.status === 'active' ? Math.max(0, monthsBetween(today, after)) : null }
}

export interface Punctuality {
  onTime: number
  total: number
}

/** % com uma casa (null sem cobrança vencida no período). */
export function punctualityPct(p: Punctuality | undefined): number | null {
  return p && p.total ? Math.round((p.onTime / p.total) * 1000) / 10 : null
}

/**
 * Pontualidade por pessoa, nos últimos 12 meses. Passo a passo:
 *   1. quanto de cada cobrança foi pago ATÉ o vencimento (pagamento depois do vencimento não conta);
 *   2. para cada cobrança a receber, não cancelada, com pessoa, que venceu de hoje-12 meses até ontem:
 *      soma 1 no total e, se o pago até o vencimento cobre o valor, 1 em "no prazo".
 */
export function punctualityMap(db: Pick<Db, 'financial_entries' | 'payments'>, today: IsoDate): Map<Id, Punctuality> {
  const from = addMonths(today, -12)
  const due = new Map<Id, { due: IsoDate; amount: number }>()
  for (const e of db.financial_entries) {
    if (e.direction !== 'receivable' || e.status === 'canceled' || !e.person_id || e.due_date < from || e.due_date >= today) continue
    due.set(e.id, { due: e.due_date, amount: e.amount_cents })
  }
  // Passo 1.
  const paidInTime = new Map<Id, number>()
  for (const p of db.payments) {
    const d = due.get(p.entry_id)
    if (d && p.paid_at <= d.due) paidInTime.set(p.entry_id, (paidInTime.get(p.entry_id) ?? 0) + p.amount_cents)
  }
  // Passo 2.
  const out = new Map<Id, Punctuality>()
  for (const e of db.financial_entries) {
    const d = due.get(e.id)
    if (!d) continue
    const cur = out.get(e.person_id!) ?? { onTime: 0, total: 0 }
    cur.total++
    if ((paidInTime.get(e.id) ?? 0) >= d.amount) cur.onTime++
    out.set(e.person_id!, cur)
  }
  return out
}

/** Quantas renovações vieram antes deste contrato (corrente de parent_contract_id; trava em 50 contra laço). */
export function renewalsOf(byId: Map<Id, Pick<Contract, 'parent_contract_id'>>, k: Pick<Contract, 'parent_contract_id'>): number {
  let n = 0
  let cur = k.parent_contract_id
  while (cur && n < 50) {
    n++
    cur = byId.get(cur)?.parent_contract_id ?? null
  }
  return n
}

/**
 * Locatário desde, por "unidade:pessoa": o início mais antigo das locações daquela pessoa naquela
 * unidade que aconteceram (a renovação é outro contrato; quem renovou continua "desde" o primeiro).
 */
export function lesseeSinceMap(db: Pick<Db, 'contracts' | 'contract_parties'>, today: IsoDate): Map<string, IsoDate> {
  const lease = new Map<Id, Contract>()
  for (const k of db.contracts) if (k.kind === 'lease' && k.unit_id && HAPPENED.includes(k.status) && k.start_date <= today) lease.set(k.id, k)
  const out = new Map<string, IsoDate>()
  for (const p of db.contract_parties) {
    const k = p.role === 'lessee' ? lease.get(p.contract_id) : undefined
    if (!k) continue
    const key = `${k.unit_id}:${p.person_id}`
    const cur = out.get(key)
    if (!cur || k.start_date < cur) out.set(key, k.start_date)
  }
  return out
}
