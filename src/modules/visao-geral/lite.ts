/* =============================================================================
   lite.ts: transforma o "banco" nas linhas Lite que metrics.ts sabe contar.

   Por que um tradutor só: três lugares precisam das MESMAS linhas, e cada um com a sua
   cópia acabaria contando diferente:
   1. a tela (repo.ts da Visão geral);
   2. o HTML do Power BI quando o relatório não manda dado (usa os dados fictícios);
   3. o gerador dos CSVs de exemplo do Power BI (scripts/gera-powerbi.mjs).

   Segurança: cada tabela passa pelo escopo (see.*), o espelho da RLS. Quem chama já
   decide se o dinheiro entra (opts.money): sem permissão de financeiro, os lançamentos
   nem saem daqui, então a tela não tem o que mostrar por engano.

   Vaga de garagem (06/11/2026) NÃO vira linha de unidade aqui: ocupação, vacância e as
   contagens dos filtros falam de casa, apartamento e sala. Desde 07/11 a vaga tem lista
   própria (spots), para a conta "vagas alugadas" da Visão geral. O contrato e a cobrança da
   vaga continuam (locação a vencer, reajuste e receita são dinheiro e prazo de verdade).

   Datas de evento (abertura e conclusão de chamado, tarefa feita, último pagamento) viram o
   DIA no fuso da organização: "2026-11-04T23:30Z" é dia 04 em Brasília só depois de converter.
   ============================================================================= */
import type { Db } from '@/data/db'
import { see, type Scope } from '@/data/scope'
import type { Id, IsoDate } from '@/data/types'
import { lookup } from '@/data/views/lookup'
import { todayIn } from '@/lib/dates'
import type { ContractLite, EntryLite, LiteData, MaintenanceLite, RoutineLite, TaskLite, UnitLite } from './metrics'

export function buildLite(db: Db, sc: Scope, opts: { money: boolean }): LiteData {
  const L = lookup(db)
  const tz = db.organizations.find((o) => o.id === sc.orgId)?.timezone
  /** Dia de um instante no fuso da organização (null fica null; texto inválido também). */
  const dayOf = (at: string | null | undefined): IsoDate | null => {
    if (!at) return null
    const t = Date.parse(at)
    return Number.isFinite(t) ? todayIn(tz, new Date(t)) : null
  }

  // Passo 1: unidades visíveis, sem as arquivadas (nem as de imóvel arquivado). Vaga vai para "spots".
  const units: UnitLite[] = []
  const spots: UnitLite[] = []
  for (const u of db.units) {
    if (!see.unit(sc, u) || u.deleted_at) continue
    const p = L.property.get(u.property_id)
    if (!p || p.deleted_at) continue
    const row: UnitLite = {
      id: u.id, code: u.code, manual_status: u.manual_status, property_id: p.id, property_name: p.name,
      portfolio_id: p.portfolio_id, portfolio_name: p.portfolio_id ? (L.portfolioName.get(p.portfolio_id) ?? null) : null,
      manager_id: p.manager_user_id, manager_name: p.manager_user_id ? (L.userName.get(p.manager_user_id) ?? null) : null,
    }
    ;(u.kind === 'parking' ? spots : units).push(row)
  }

  // Passo 2: contratos visíveis (locação e administração; quem conta decide o tipo).
  const contracts: ContractLite[] = db.contracts
    .filter((k) => see.contract(sc, k))
    .map((k) => ({
      id: k.id, code: k.code, kind: k.kind, status: k.status, unit_id: k.unit_id, property_id: k.property_id,
      start_date: k.start_date, end_date: k.end_date, adjustment_index: k.adjustment_index, adjustment_month: k.adjustment_month,
      parent_id: k.parent_contract_id,
    }))

  // Passo 3: lançamentos, só com permissão de dinheiro. O "pago" e o dia do último pagamento saem dos pagamentos.
  const paid = new Map<Id, { cents: number; last: IsoDate }>()
  if (opts.money) {
    for (const p of db.payments) {
      const cur = paid.get(p.entry_id)
      paid.set(p.entry_id, { cents: (cur?.cents ?? 0) + p.amount_cents, last: !cur || p.paid_at > cur.last ? p.paid_at : cur.last })
    }
  }
  const entries: EntryLite[] = opts.money
    ? db.financial_entries
        .filter((e) => see.entry(sc, e))
        .map((e) => ({
          id: e.id, direction: e.direction, category: e.category, status: e.status, due_date: e.due_date,
          amount_cents: e.amount_cents, paid_cents: paid.get(e.id)?.cents ?? 0, paid_at: paid.get(e.id)?.last ?? null, property_id: e.property_id,
        }))
    : []

  // Passo 4: chamados de manutenção visíveis, com abertura e conclusão (tempo de resolução) e o responsável.
  const maintenance: MaintenanceLite[] = db.maintenance_requests
    .filter((r) => see.maintenance(sc, r))
    .map((r) => ({
      id: r.id, status: r.status, property_id: r.property_id, due_date: r.due_date, quote_cents: r.quote_cents,
      opened_on: dayOf(r.created_at), closed_on: dayOf(r.closed_at), assignee_id: r.assignee_user_id,
    }))

  // Passo 5: tarefas e rotinas. Não têm regra em "see": só a equipe as vê, as da própria organização
  // (a mesma regra de seeTask, em processos/repo.ts). Portal fica sem nenhuma.
  const propOf = new Map<Id, Id>()
  for (const u of db.units) propOf.set(u.id, u.property_id)
  for (const k of db.contracts) propOf.set(k.id, k.property_id)
  for (const r of db.maintenance_requests) propOf.set(r.id, r.property_id)
  const tasks: TaskLite[] = !sc.all
    ? []
    : db.tasks
        .filter((t) => t.organization_id === sc.orgId)
        .map((t) => ({
          id: t.id, status: t.status, due_date: t.due_date,
          // atalho: a tarefa não grava "feita em"; vale a aprovação ou a última alteração da tarefa feita.
          // Tarefa feita e editada depois parece feita mais tarde. Melhorar com uma coluna completed_at
          // gravada por setTaskStatus (fase 2, junto com a RLS de tasks).
          done_on: t.status === 'done' ? dayOf(t.approved_at ?? t.updated_at) : null,
          property_id: [t.unit_id, t.contract_id, t.maintenance_id].map((id) => (id ? propOf.get(id) : undefined)).find((p) => !!p) ?? null,
          assignee_id: t.assignee_user_id,
        }))
  const routines: RoutineLite[] = !sc.all
    ? []
    : db.maintenance_schedules
        .filter((x) => x.organization_id === sc.orgId)
        .map((x) => ({ id: x.id, property_id: x.property_id, next_date: x.next_date, status: x.active ? 'on' : 'off' }))

  return { units, spots, contracts, entries, maintenance, tasks, routines }
}
