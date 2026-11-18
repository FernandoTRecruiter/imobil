/* =============================================================================
   operacao.ts: manutenção, vistorias, processos e tarefas, automações, avisos,
   documentos, auditoria, importação e o modelo do 3D.
   ============================================================================= */
import { addDays, daysBetween, dueDateFor, formatMonth, monthStart } from '@/lib/dates'
import { CONTRACT_STATUS } from '../labels'
import { formatBRL } from '@/lib/money'
import type {
  BuildingModel, ChargedTo, Contract, Id, InspectionKind, InspectionRoom, MaintenanceCategory, MaintenancePriority, MaintenanceRequest,
  MaintenanceStatus, Person, Property, Role, Unit, UnitStatus, WorkflowTemplate,
} from '../types'
import { MAINTENANCE_TITLES, ORG, USER } from './catalogo'
import { adminOf, base, nextSeq, ts, type Ctx } from './ctx'
import { newEntry, pay } from './financeiro'

const PRIORITY_DAYS: Record<MaintenancePriority, number> = { urgent: 1, high: 3, medium: 7, low: 15 }

function unitOf(c: Ctx, id: Id): Unit {
  return c.db.units.find((u) => u.id === id)!
}
function activeLeaseOf(c: Ctx, unitId: Id): Contract | undefined {
  return c.db.contracts.find((k) => k.kind === 'lease' && k.unit_id === unitId && k.status === 'active')
}
function lesseeOf(c: Ctx, k: Contract | undefined): Id | null {
  return k ? (c.db.contract_parties.find((p) => p.contract_id === k.id && p.role === 'lessee')?.person_id ?? null) : null
}
function vendorFor(c: Ctx, orgId: Id, cat: MaintenanceCategory): Person {
  const pool = c.db.people.filter((p) => p.organization_id === orgId && p.tags.includes('vendor'))
  const fit = pool.filter((p) => p.vendor_categories.includes(cat))
  if (orgId === ORG.agency && (cat === 'plumbing' || cat === 'electrical') && c.rng.chance(0.6)) return c.persons.eduardo
  return fit.length ? c.rng.pick(fit) : c.rng.pick(pool)
}

/* ---------------------------------------------------------------- Passo 6: manutenção */
/**
 * Um chamado. Com "unit", é da unidade; com "common" (e sem unit), é de ÁREA COMUM do imóvel
 * (estacionamento, piscina, portão): unit_id vazio, sem solicitante inquilino, título fixo.
 */
interface ReqSpec {
  unit: Unit | null
  common?: { property: Property; title: string }
  status: MaintenanceStatus
  category?: MaintenanceCategory
  quote?: number
  charged?: ChargedTo
  vendor?: Person
  daysAgo?: number
}

function makeRequest(c: Ctx, s: ReqSpec): MaintenanceRequest {
  const { rng, ref } = c
  const orgId = s.unit?.organization_id ?? s.common!.property.organization_id
  const category = s.category ?? rng.pick<MaintenanceCategory>(['plumbing', 'plumbing', 'electrical', 'electrical', 'painting', 'locksmith', 'appliance', 'structure', 'cleaning', 'other'])
  const priority = rng.pick<MaintenancePriority>(['low', 'medium', 'medium', 'high', 'urgent'])
  const opened = addDays(ref, -(s.daysAgo ?? rng.int(1, 170)))
  const withVendor = !['open', 'triage'].includes(s.status)
  const withQuote = ['awaiting_owner', 'approved', 'in_progress', 'done'].includes(s.status) || (s.status === 'canceled' && rng.chance(0.5))
  const lease = s.unit ? activeLeaseOf(c, s.unit.id) : undefined
  const owner = orgId === ORG.agency ? USER.admin : USER.landlord
  const closedOn = addDays(opened, rng.int(2, 12))
  const r: MaintenanceRequest = {
    ...base(c, orgId, opened, lease && rng.chance(0.5) ? owner : adminOf(orgId)),
    code: `CH-${String(nextSeq(c, `ch-${orgId}`)).padStart(4, '0')}`,
    unit_id: s.unit?.id ?? null, property_id: s.unit?.property_id ?? s.common!.property.id, requester_person_id: lesseeOf(c, lease),
    category, priority, title: s.common?.title ?? rng.pick(MAINTENANCE_TITLES[category]),
    description: s.common ? 'Aviso da portaria: área comum, sem unidade ligada.' : 'Relato do solicitante: o problema começou há alguns dias e piora com o uso.',
    status: s.status, vendor_person_id: withVendor ? (s.vendor ?? vendorFor(c, orgId, category)).id : null,
    assignee_user_id: orgId === ORG.agency ? USER.maint : USER.landlord,
    due_date: addDays(opened, PRIORITY_DAYS[priority]), quote_cents: withQuote ? (s.quote ?? rng.int(12, 260) * 1000) : null,
    quote_status: !withQuote ? 'none' : s.status === 'awaiting_owner' ? 'pending' : s.status === 'canceled' ? 'rejected' : 'approved',
    quote_decided_by: withQuote && s.status !== 'awaiting_owner' ? owner : null,
    charged_to: s.charged ?? rng.pick<ChargedTo>(['owner', 'owner', 'owner', 'lessee', 'agency']),
    closed_at: s.status === 'done' || s.status === 'canceled' ? ts(closedOn > ref ? ref : closedOn) : null,
  }
  c.db.maintenance_requests.push(r)
  // Serviço concluído vira conta a pagar ao prestador (quando quem arca não é o inquilino, que paga direto).
  if (r.status === 'done' && r.quote_cents && r.charged_to !== 'lessee') {
    const closed = r.closed_at!.slice(0, 10)
    const e = newEntry(c, orgId, {
      direction: 'payable', category: 'maintenance', description: `${r.code}: ${r.title}`, contract_id: null,
      unit_id: r.unit_id, property_id: r.property_id, person_id: r.vendor_person_id, competence: monthStart(closed),
      due_date: addDays(closed, 5), amount_cents: r.quote_cents, charged_to: r.charged_to,
    })
    if (e.due_date <= ref) pay(c, e, e.due_date, e.amount_cents, 'pix')
  }
  return r
}

export function seedMaintenance(c: Ctx): void {
  const { rng } = c
  const byCode = (code: string) => c.plans.find((p) => p.orgId === ORG.agency && p.unit.code === code)!.unit
  const propByName = (name: string) => c.db.properties.find((p) => p.name === name)!
  // Os sorteios só pegam casa, apartamento ou sala: os títulos (pia, chuveiro, quarto) não servem para vaga.
  const homePlans = c.plans.filter((x) => x.unit.kind !== 'parking')
  // Casos fixos que as personas precisam ver no portal (a Casa 07 é a que o Carlos divide com a esposa).
  makeRequest(c, { unit: byCode('A-301'), status: 'awaiting_owner', category: 'plumbing', quote: 85000, daysAgo: 4, vendor: c.persons.eduardo })
  makeRequest(c, { unit: byCode('Casa 07'), status: 'awaiting_owner', category: 'structure', quote: 230000, daysAgo: 6 })
  makeRequest(c, { unit: byCode('B-203'), status: 'triage', category: 'electrical', daysAgo: 1 })
  makeRequest(c, { unit: byCode('B-203'), status: 'done', category: 'plumbing', quote: 32000, charged: 'owner', daysAgo: 70, vendor: c.persons.eduardo })
  for (const st of ['quote', 'approved', 'in_progress', 'in_progress', 'done'] as MaintenanceStatus[]) {
    const p = rng.pick(homePlans.filter((x) => x.orgId === ORG.agency && x.fate === 'occupied'))
    makeRequest(c, { unit: p.unit, status: st, category: rng.pick(['plumbing', 'electrical'] as const), vendor: c.persons.eduardo, daysAgo: rng.int(2, 40) })
  }
  const dist: MaintenanceStatus[] = ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'in_progress', 'approved', 'awaiting_owner', 'quote', 'triage', 'open', 'open', 'canceled', 'done', 'done']
  for (const st of dist) {
    const p = rng.pick(homePlans.filter((x) => x.orgId === ORG.agency && ['occupied', 'maintenance'].includes(x.fate)))
    makeRequest(c, { unit: p.unit, status: st })
  }
  for (const st of ['done', 'done', 'in_progress', 'open'] as MaintenanceStatus[]) {
    const p = rng.pick(homePlans.filter((x) => x.orgId === ORG.landlord && x.fate === 'occupied'))
    makeRequest(c, { unit: p.unit, status: st })
  }
  // Áreas comuns (sem unidade): o estacionamento externo e o lazer também quebram. Nenhum espera o
  // proprietário: o portal do Carlos mostra só os orçamentos das unidades dele.
  const mj = propByName('Condomínio Mount Juic')
  const lynx = propByName('Lynx Residence')
  const luar = propByName('Condomínio Luar')
  makeRequest(c, { unit: null, common: { property: mj, title: 'Postes do estacionamento externo apagados' }, status: 'in_progress', category: 'electrical', quote: 64000, vendor: c.persons.eduardo, daysAgo: 5 })
  makeRequest(c, { unit: null, common: { property: lynx, title: 'Portão do estacionamento não fecha sozinho' }, status: 'triage', category: 'structure', daysAgo: 2 })
  makeRequest(c, { unit: null, common: { property: luar, title: 'Bomba da piscina fazendo barulho' }, status: 'done', category: 'appliance', quote: 41000, charged: 'owner', daysAgo: 35 })
}

/* ---------------------------------------------------------------- Passo 8: vistorias */
function roomsFor(u: Unit, kind: InspectionKind, c: Ctx, done: boolean): InspectionRoom[] {
  const names = u.kind === 'office' || u.kind === 'store'
    ? ['Salão', 'Copa', 'Banheiro']
    : ['Sala', 'Cozinha', ...Array.from({ length: Math.max(1, u.bedrooms) }, (_, i) => `Quarto ${i + 1}`), 'Banheiro']
  const items = ['Piso', 'Paredes e pintura', 'Portas e fechaduras', 'Janelas', 'Tomadas e iluminação']
  return names.map((name) => ({
    name,
    items: [...items, ...(name === 'Cozinha' || name === 'Banheiro' || name === 'Copa' ? ['Louças e metais'] : [])].map((item) => {
      if (!done) return { name: item, condition: 'na' as const, note: '' }
      const r = c.rng.float()
      const worn = kind === 'move_out' ? 0.25 : 0.08
      return { name: item, condition: r < worn ? ('fair' as const) : r < worn + 0.03 ? ('poor' as const) : ('good' as const), note: r < worn ? 'Desgaste de uso normal.' : '' }
    }),
  }))
}

export function seedInspections(c: Ctx): void {
  const { db, ref } = c
  for (const k of db.contracts.filter((x) => x.kind === 'lease')) {
    const u = unitOf(c, k.unit_id!)
    // Vaga não tem vistoria de entrada e saída (não há cômodo a conferir).
    if (u.kind === 'parking') continue
    const by = k.organization_id === ORG.agency ? USER.maint : USER.landlord
    if (k.status === 'active' && daysBetween(k.start_date, ref) <= 180) {
      db.inspections.push({ ...base(c, k.organization_id, addDays(k.start_date, -2), by), unit_id: u.id, contract_id: k.id, kind: 'move_in', scheduled_date: addDays(k.start_date, -2), done_date: addDays(k.start_date, -2), inspector_user_id: by, status: 'done', rooms: roomsFor(u, 'move_in', c, true) })
    }
    if (['ended', 'terminated'].includes(k.status) && daysBetween(k.end_date, ref) <= 120) {
      db.inspections.push({ ...base(c, k.organization_id, k.end_date, by), unit_id: u.id, contract_id: k.id, kind: 'move_out', scheduled_date: addDays(k.end_date, 1), done_date: addDays(k.end_date, 1), inspector_user_id: by, status: 'done', rooms: roomsFor(u, 'move_out', c, true) })
    }
  }
  // Três vistorias periódicas agendadas para as próximas semanas.
  c.plans.filter((p) => p.orgId === ORG.agency && p.fate === 'occupied' && p.unit.kind !== 'parking').slice(5, 8).forEach((p, i) => {
    const when = addDays(ref, 6 + i * 7)
    db.inspections.push({ ...base(c, ORG.agency, ref, USER.maint), unit_id: p.unit.id, contract_id: activeLeaseOf(c, p.unit.id)?.id ?? null, kind: 'periodic', scheduled_date: when, done_date: null, inspector_user_id: USER.maint, status: 'scheduled', rooms: roomsFor(p.unit, 'periodic', c, false) })
  })
}

/* ---------------------------------------------------------------- Passo 9: processos e tarefas */
const TEMPLATES: { key: WorkflowTemplate['key']; name: string; steps: [string, Role, number, boolean][] }[] = [
  { key: 'renewal', name: 'Renovação de contrato', steps: [['Contato com o inquilino', 'staff', 5, false], ['Proposta de reajuste e prazo', 'staff', 5, false], ['Aprovação do proprietário', 'owner', 7, true], ['Aditivo assinado', 'staff', 10, false]] },
  { key: 'new_lease', name: 'Nova locação', steps: [['Análise cadastral', 'staff', 3, false], ['Aprovação do proprietário', 'owner', 3, true], ['Contrato e garantia', 'staff', 5, false], ['Assinatura', 'staff', 5, false], ['Vistoria de entrada', 'staff', 2, false], ['Entrega das chaves', 'staff', 1, false]] },
  { key: 'termination', name: 'Rescisão', steps: [['Aviso registrado', 'staff', 1, false], ['Vistoria de saída', 'staff', 5, false], ['Cálculo de multa e acerto', 'admin', 5, true], ['Devolução das chaves', 'staff', 2, false]] },
  { key: 'maintenance', name: 'Manutenção com orçamento', steps: [['Triagem', 'staff', 1, false], ['Orçamento', 'vendor', 3, false], ['Aprovação do proprietário', 'owner', 3, true], ['Execução', 'vendor', 7, false], ['Conclusão e fotos', 'staff', 1, false]] },
  { key: 'inspection', name: 'Vistoria periódica', steps: [['Agendar com o inquilino', 'staff', 5, false], ['Vistoriar', 'staff', 3, false], ['Enviar laudo', 'staff', 2, false]] },
  { key: 'delinquency', name: 'Inadimplência', steps: [['Lembrete amigável', 'staff', 3, false], ['Contato por telefone', 'staff', 7, false], ['Notificação formal', 'admin', 20, true], ['Encaminhar ao jurídico', 'admin', 15, true]] },
  { key: 'onboarding', name: 'Captação de imóvel', steps: [['Cadastro do imóvel', 'staff', 2, false], ['Documentos do proprietário', 'staff', 5, false], ['Contrato de administração', 'admin', 5, true], ['Fotos e anúncio', 'staff', 3, false]] },
]

export function seedWorkflows(c: Ctx): void {
  const { db, ref, rng } = c
  for (const orgId of [ORG.agency, ORG.landlord]) {
    for (const t of TEMPLATES) {
      if (orgId === ORG.landlord && !['renewal', 'new_lease', 'maintenance', 'delinquency'].includes(t.key)) continue
      db.workflow_templates.push({ ...base(c, orgId, '2025-01-15'), key: t.key, name: t.name, steps: t.steps.map(([title, role, sla_days, requires_approval]) => ({ title, role: orgId === ORG.landlord ? 'admin' : role, sla_days, requires_approval })) })
    }
  }
  const tpl = (orgId: Id, key: string) => db.workflow_templates.find((t) => t.organization_id === orgId && t.key === key)!
  const start = (orgId: Id, key: string, title: string, k: Contract | null, step: number, dedupe: string | null) => {
    const t = tpl(orgId, key)
    const startedOn = addDays(ref, -rng.int(2, 12))
    const inst = { ...base(c, orgId, startedOn), template_id: t.id, title, contract_id: k?.id ?? null, maintenance_id: null, status: 'running' as const, current_step: step, started_at: ts(startedOn), completed_at: null }
    db.workflow_instances.push(inst)
    t.steps.forEach((s, i) => {
      if (i > step) return
      const assignee = s.role === 'owner' ? null : orgId === ORG.landlord ? USER.landlord : s.role === 'admin' ? USER.admin : USER.leasing
      db.tasks.push({
        ...base(c, orgId, startedOn), title: `${s.title} · ${title}`, description: '', workflow_instance_id: inst.id, step_index: i,
        assignee_user_id: assignee, due_date: addDays(startedOn, s.sla_days * (i + 1)), status: i < step ? 'done' : rng.chance(0.4) ? 'doing' : 'todo',
        requires_approval: s.requires_approval, approved_by: i < step && s.requires_approval ? USER.admin : null,
        approved_at: i < step && s.requires_approval ? ts(addDays(startedOn, i + 1)) : null,
        contract_id: k?.id ?? null, unit_id: k?.unit_id ?? null, maintenance_id: null, dedupe_key: i === 0 ? dedupe : null,
      })
    })
  }
  const unitCode = (k: Contract) => unitOf(c, k.unit_id!).code
  for (const k of db.contracts.filter((x) => x.kind === 'lease')) {
    const left = daysBetween(ref, k.end_date)
    if (k.status === 'active' && left >= 0 && left <= 60) {
      const step = unitCode(k) === 'A-301' && k.organization_id === ORG.agency ? 2 : rng.int(0, 1)
      start(k.organization_id, 'renewal', `${k.code} (${unitCode(k)})`, k, step, `contract_ends_in_days:60:${k.id}`)
    }
    if (['awaiting_signature', 'in_review'].includes(k.status)) start(k.organization_id, 'new_lease', `${k.code} (${unitCode(k)})`, k, k.status === 'in_review' ? 0 : 3, null)
    if (k.status === 'active' && c.payProfile[k.id] === 'delinquent') start(k.organization_id, 'delinquency', `${k.code} (${unitCode(k)})`, k, rng.int(0, 2), `entry_overdue_days:5:${k.id}`)
  }
  // Tarefas avulsas (sem processo), uma delas já atrasada.
  const loose: [Id, Id, string, number][] = [
    [ORG.agency, USER.admin, 'Conferir os carnês de IPTU 2027 das casas do Condomínio Luar', 20],
    [ORG.agency, USER.leasing, 'Atualizar as fotos dos anúncios das unidades vagas', 7],
    [ORG.agency, USER.admin, 'Renovar o seguro do estacionamento externo do Mount Juic', -2],
    [ORG.agency, USER.staff, 'Responder o proprietário sobre o extrato do mês passado', 1],
    [ORG.landlord, USER.landlord, 'Pesquisar o valor de mercado para a sala vaga', 10],
  ]
  for (const [orgId, who, title, due] of loose) {
    db.tasks.push({ ...base(c, orgId, addDays(ref, -5)), title, description: '', workflow_instance_id: null, step_index: null, assignee_user_id: who, due_date: addDays(ref, due), status: 'todo', requires_approval: false, approved_by: null, approved_at: null, contract_id: null, unit_id: null, maintenance_id: null, dedupe_key: null })
  }
}

/* ---------------------------------------------------------------- Passo 10: automações e avisos */
export function seedAutomations(c: Ctx): void {
  const { db, ref, rng } = c
  const rules: [Id, string, 'contract_ends_in_days' | 'adjustment_month' | 'entry_overdue_days', number, 'create_task' | 'notify'][] = [
    [ORG.agency, 'Contrato vence em 60 dias: criar tarefa de renovação', 'contract_ends_in_days', 60, 'create_task'],
    [ORG.agency, 'Mês de reajuste: avisar o responsável', 'adjustment_month', 0, 'notify'],
    [ORG.agency, 'Cobrança vencida há 5 dias: criar tarefa de cobrança', 'entry_overdue_days', 5, 'create_task'],
    [ORG.landlord, 'Contrato vence em 60 dias: me avisar', 'contract_ends_in_days', 60, 'notify'],
    [ORG.landlord, 'Cobrança vencida há 3 dias: me avisar', 'entry_overdue_days', 3, 'notify'],
  ]
  for (const [orgId, name, trigger, days, action] of rules) {
    const r = { ...base(c, orgId, '2025-02-01'), name, trigger, days, action, enabled: true }
    db.automation_rules.push(r)
    for (let d = 6; d >= 0; d--) {
      const failed = d === 3 && action === 'notify' && orgId === ORG.agency
      db.automation_runs.push({ id: rng.uuid(), organization_id: orgId, rule_id: r.id, ran_at: `${addDays(ref, -d)}T06:00:00-03:00`, status: failed ? 'error' : 'ok', created_count: failed ? 0 : rng.int(0, 2), skipped_count: rng.int(1, 6), error: failed ? 'E-mail não enviado: serviço de e-mail não configurado (ambiente de demonstração).' : null })
    }
  }

  const note = (orgId: Id, userId: Id, title: string, body: string, link: string | null, key: string, daysAgo = 0, read = false) =>
    db.notifications.push({ id: rng.uuid(), organization_id: orgId, user_id: userId, title, body, link, dedupe_key: key, channel: 'in_app', status: 'sent', attempts: 1, last_error: null, created_at: `${addDays(ref, -daysAgo)}T06:00:00-03:00`, read_at: read ? `${addDays(ref, -daysAgo)}T09:00:00-03:00` : null })

  for (const k of db.contracts.filter((x) => x.kind === 'lease' && x.status === 'active')) {
    const left = daysBetween(ref, k.end_date)
    if (left < 0 || left > 60) continue
    const code = unitOf(c, k.unit_id!).code
    const who = k.organization_id === ORG.agency ? USER.admin : USER.landlord
    note(k.organization_id, who, `Contrato ${k.code} vence em ${left} dias`, `Unidade ${code}. A tarefa de renovação já foi criada.`, `/contratos/${k.id}`, `ends60:${k.id}:${ref}`, rng.int(0, 3), rng.chance(0.3))
  }
  for (const r of db.maintenance_requests.filter((x) => x.status === 'awaiting_owner')) {
    const code = r.unit_id ? unitOf(c, r.unit_id).code : 'áreas comuns'
    note(r.organization_id, adminOf(r.organization_id), `Orçamento aguardando o proprietário: ${r.code}`, `${r.title} (${code}), ${formatBRL(r.quote_cents ?? 0)}.`, `/manutencao/${r.id}`, `quote:${r.id}`, 1)
    const isCarlos = db.property_owners.some((o) => o.person_id === c.persons.carlos.id && (o.unit_id === r.unit_id || (o.unit_id === null && o.property_id === r.property_id)))
    if (isCarlos) note(ORG.agency, USER.owner, `Orçamento de ${formatBRL(r.quote_cents ?? 0)} aguarda sua aprovação`, `${r.title} na unidade ${code}.`, `/manutencao/${r.id}`, `quote-owner:${r.id}`, 1)
  }
  const overdue = db.financial_entries.filter((e) => e.organization_id === ORG.agency && e.direction === 'receivable' && e.status === 'open' && e.due_date < ref).length
  note(ORG.agency, USER.admin, `${overdue} cobranças vencidas`, 'Veja quem está em atraso e há quantos dias.', '/financeiro?aba=vencido', `overdue:${ref}`)
  note(ORG.agency, USER.staff, `Repasses de ${formatMonth(monthStart(addDays(ref, -28)))} prontos para conferência`, 'Confira os demonstrativos antes de aprovar.', '/financeiro/repasses', `transfers:${ref}`, 2)
  // A Daniela tem duas locações (o apartamento e a vaga): o aviso do aluguel é o do apartamento.
  const contratoDaniela = db.contracts.find((k) => k.status === 'active' && lesseeOf(c, k) === c.persons.daniela.id && unitOf(c, k.unit_id!).kind !== 'parking')
  if (contratoDaniela) {
    const due = dueDateFor(monthStart(addDays(ref, 20)), contratoDaniela.due_day)
    note(ORG.agency, USER.lessee, `Seu aluguel vence em ${formatDateShort(due)}`, `Valor: ${formatBRL(contratoDaniela.rent_cents)}.`, '/financeiro', `rent-due:${contratoDaniela.id}:${due}`)
  }
  const triage = db.maintenance_requests.find((r) => r.status === 'triage' && r.requester_person_id === c.persons.daniela.id)
  if (triage) note(ORG.agency, USER.lessee, `Seu chamado ${triage.code} está em triagem`, triage.title, `/manutencao/${triage.id}`, `req:${triage.id}`, 0, true)
  for (const r of db.maintenance_requests.filter((x) => x.vendor_person_id === c.persons.eduardo.id && ['quote', 'approved', 'in_progress'].includes(x.status))) {
    note(ORG.agency, USER.vendor, `Chamado atribuído: ${r.code}`, r.title, `/manutencao/${r.id}`, `vendor:${r.id}`, rng.int(0, 5))
  }
  // Um e-mail que falhou: o aviso fica registrado com o erro, e nada é reenviado em duplicidade.
  db.notifications.push({ id: rng.uuid(), organization_id: ORG.agency, user_id: USER.admin, title: 'Resumo diário por e-mail', body: 'Contratos, cobranças e chamados do dia.', link: null, dedupe_key: `digest:${addDays(ref, -3)}`, channel: 'email', status: 'failed', attempts: 3, last_error: 'Serviço de e-mail não configurado (ambiente de demonstração).', created_at: `${addDays(ref, -3)}T06:00:00-03:00`, read_at: null })
}

function formatDateShort(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

/* ---------------------------------------------------------------- Passo 11: documentos */
export function seedDocuments(c: Ctx): void {
  const { db, ref, rng } = c
  const doc = (orgId: Id, name: string, on: string, owner: boolean, lessee: boolean, link: Partial<Record<'property_id' | 'unit_id' | 'contract_id' | 'person_id' | 'maintenance_id' | 'inspection_id', Id>>) => {
    const b = base(c, orgId, on)
    db.documents.push({ ...b, deleted_at: null, name, mime: 'application/pdf', size: rng.int(80, 2400) * 1024, visible_to_owner: owner, visible_to_lessee: lessee, property_id: null, unit_id: null, contract_id: null, person_id: null, maintenance_id: null, inspection_id: null, ...link, storage_path: `${orgId}/${b.id}/${name}` })
  }
  for (const k of db.contracts.filter((x) => x.kind === 'lease' && ['active', 'ended', 'terminated', 'awaiting_signature'].includes(x.status))) {
    doc(k.organization_id, `Contrato de locação ${k.code}.pdf`, k.start_date > ref ? ref : k.start_date, true, true, { contract_id: k.id })
  }
  for (const i of db.inspections.filter((x) => x.status === 'done')) {
    doc(i.organization_id, `Laudo de vistoria ${i.kind === 'move_in' ? 'de entrada' : i.kind === 'move_out' ? 'de saída' : 'periódica'} ${unitOf(c, i.unit_id).code}.pdf`, i.done_date!, true, true, { inspection_id: i.id })
  }
  for (const p of db.properties) doc(p.organization_id, `Matrícula do imóvel ${p.name}.pdf`, p.created_at.slice(0, 10), false, false, { property_id: p.id })
  for (const t of db.owner_transfers.filter((x) => x.status === 'paid' && x.month >= monthStart(addDays(ref, -100)))) {
    doc(ORG.agency, `Extrato de repasse ${formatMonth(t.month)}.pdf`, t.paid_at!, true, false, { person_id: t.owner_person_id })
  }
  for (const r of db.maintenance_requests.filter((x) => x.quote_cents)) {
    doc(r.organization_id, `Orçamento ${r.code}.pdf`, r.created_at.slice(0, 10), true, false, { maintenance_id: r.id })
  }
}

/* ---------------------------------------------------------------- Passo 12: auditoria e importação */
export function seedAuditAndImport(c: Ctx): void {
  const { db, ref, rng } = c
  // Uma importação antiga: as 36 vagas do Lynx vieram de planilha quando a imobiliária assumiu o
  // estacionamento. Desfazer hoje seria recusado (as vagas já têm contrato).
  const lynx = db.properties.find((p) => p.name === 'Lynx Residence')!
  const vagas = db.units.filter((u) => u.property_id === lynx.id && u.kind === 'parking')
  const batch = {
    ...base(c, ORG.agency, addDays(ref, -75)), entity: 'units' as const, file_name: 'planilha-vagas-lynx.xlsx',
    mapping: { Imóvel: 'property', Vaga: 'code', Tipo: 'kind', 'Aluguel pedido': 'asking_rent' },
    rows_total: vagas.length + 2, rows_ok: vagas.length, rows_warning: 1, rows_error: 1,
    errors: [
      { row: 9, column: 'Aluguel pedido', message: 'Aluguel "duzentos": escreva só o número, ex.: 200,00.', level: 'error' as const },
      { row: 14, column: 'Área', message: 'Área vazia: importada sem área.', level: 'warning' as const },
    ],
    undone_at: null,
  }
  db.import_batches.push(batch)
  for (const u of vagas) u.import_batch_id = batch.id
  const log = (orgId: Id, actor: Id, entity: string, id: Id, action: 'create' | 'update' | 'status' | 'approve' | 'payment' | 'import', summary: string, at: string) =>
    db.audit_logs.push({ id: rng.uuid(), organization_id: orgId, actor_user_id: actor, entity, entity_id: id, action, summary, changes: null, at })
  log(ORG.agency, USER.admin, 'import_batches', batch.id, 'import', `Importou ${batch.rows_ok} vagas de ${batch.file_name}`, batch.created_at)
  const payEntry = new Map(db.financial_entries.map((e) => [e.id, e]))
  for (const p of db.payments.filter((x) => daysBetween(x.paid_at, ref) <= 6).slice(0, 25)) {
    const e = payEntry.get(p.entry_id)!
    log(p.organization_id, p.created_by!, 'financial_entries', e.id, 'payment', `Baixa de ${formatBRL(p.amount_cents)} em "${e.description}"`, `${p.paid_at}T15:${String(rng.int(10, 59))}:00-03:00`)
  }
  for (const ev of db.contract_events.filter((x) => x.kind === 'status' && daysBetween(x.effective_date, ref) <= 30 && daysBetween(x.effective_date, ref) >= 0)) {
    const k = db.contracts.find((x) => x.id === ev.contract_id)!
    // Rótulo em português (CONTRACT_STATUS), nunca o código do banco ("awaiting_signature").
    const de = ev.from_status ? CONTRACT_STATUS[ev.from_status] : 'Novo'
    const para = ev.to_status ? CONTRACT_STATUS[ev.to_status] : ''
    log(ev.organization_id, ev.created_by!, 'contracts', k.id, 'status', `Contrato ${k.code}: ${de} → ${para}`, `${ev.effective_date}T11:00:00-03:00`)
  }
  // Só aprovações dos últimos 30 dias e nunca no futuro (daysBetween >= 0).
  for (const t of db.owner_transfers.filter((x) => x.approved_at && daysBetween(x.approved_at.slice(0, 10), ref) <= 30 && daysBetween(x.approved_at.slice(0, 10), ref) >= 0)) {
    log(ORG.agency, USER.admin, 'owner_transfers', t.id, 'approve', `Aprovou o repasse de ${formatMonth(t.month)} (${formatBRL(t.net_cents)})`, t.approved_at!)
  }
  db.audit_logs.sort((a, b) => (a.at < b.at ? 1 : -1))
}

/* ---------------------------------------------------------------- Passo 13: modelo do 3D */
/**
 * Forma do bloco em exemplos.ts -> modelo que o 3D ATUAL sabe desenhar. O 3D novo lê a implantação
 * (src/modules/mapa/implantacao) direto de exemplos.ts; até ele entrar, estes modelos seguram a tela.
 * O prédio em H e o triângulo de cantos arredondados viram lâmina (bloco comprido); a casa vira casas em fila.
 */
const TEMPLATE_OF_SHAPE: Record<string, BuildingModel['template']> = { h: 'slab', slab: 'slab', tower: 'tower', rounded_triangle: 'slab', house: 'row_houses' }

export function seedSpatial(c: Ctx): void {
  const { db } = c
  for (const b of db.buildings) {
    const floors = db.floors.filter((f) => f.building_id === b.id)
    // Unidades por andar contam só casa, apartamento e sala: as 12 vagas do subsolo não alargam a torre.
    const upf = Math.max(1, ...floors.map((f) => db.units.filter((u) => u.floor_id === f.id && u.kind !== 'parking').length))
    const template = TEMPLATE_OF_SHAPE[c.shapes[b.id]] ?? 'tower'
    const rows = template === 'row_houses'
    const slab = template === 'slab'
    db.building_models.push({
      ...base(c, b.organization_id, b.created_at.slice(0, 10)), building_id: b.id,
      template, floors: floors.length, units_per_floor: upf,
      // Lâmina larga (16 por andar no Lynx) ganha profundidade em vez de virar uma régua de 24 células.
      width: rows ? upf * 2 : slab ? Math.min(12, Math.round(upf * 1.5)) : Math.ceil(upf / 2) * 2, depth: rows ? 3 : slab && upf > 8 ? 4 : 2,
    })
  }
  // Planta de modelo (aprovada) da A-101 e um rascunho "vindo da IA" da A-102 (Mount Juic, Bloco A),
  // para a revisão humana do plano.
  const a101 = db.units.find((u) => u.code === 'A-101')!
  const a102 = db.units.find((u) => u.code === 'A-102')!
  const room = (u: Unit, label: string, x1: number, y1: number, x2: number, y2: number, source: 'template' | 'ai_import', review: 'approved' | 'draft') =>
    db.floorplan_elements.push({ ...base(c, u.organization_id, '2025-06-01'), floor_id: u.floor_id, unit_id: u.id, kind: 'room', label, polygon: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], source, review_status: review })
  const plan101: [string, number, number, number, number][] = [['Sala', 0, 0, 5, 4], ['Cozinha', 5, 0, 8, 3], ['Banheiro', 8, 0, 10, 3], ['Quarto 1', 0, 4, 3.5, 7.5], ['Quarto 2', 3.5, 4, 6.5, 7.5], ['Suíte', 6.5, 3, 10, 7.5]]
  const plan102: [string, number, number, number, number][] = [['Sala e cozinha', 0, 0, 6, 4], ['Banheiro', 6, 0, 8, 2.5], ['Quarto 1', 0, 4, 4, 7], ['Quarto 2', 4, 4, 8, 7]]
  plan101.forEach(([l, x1, y1, x2, y2]) => room(a101, l, x1, y1, x2, y2, 'template', 'approved'))
  plan102.forEach(([l, x1, y1, x2, y2]) => room(a102, l, x1, y1, x2, y2, 'ai_import', 'draft'))

  const defaults: [UnitStatus, string, string][] = [
    ['available', 'Disponível', '#15803d'], ['occupied', 'Ocupada', '#2b59c3'], ['reserved', 'Reservada', '#b45309'],
    ['maintenance', 'Em manutenção', '#c2410c'], ['blocked', 'Bloqueada', '#64748b'],
  ]
  for (const o of db.organizations) for (const [status, label, color] of defaults) db.unit_status_config.push({ id: `${o.id}:${status}`, organization_id: o.id, status, label, color })
}
