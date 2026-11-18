/* =============================================================================
   processos/repo.ts: tarefas, processos em andamento, modelos de processo e automações.

   O QUE RESOLVE: o trabalho da administração que tem passo a passo (renovar contrato,
   cobrar atraso, fazer vistoria) vira um PROCESSO com etapas; cada etapa vira uma TAREFA
   com responsável e prazo. As AUTOMAÇÕES olham os dados todo dia e abrem o processo sozinhas
   ("contrato vence em 60 dias" -> processo de renovação), sem abrir dois para o mesmo caso.

   TRÊS REGRAS QUE ESTE ARQUIVO SEGURA (a tela só esconde botão):
   1. Etapa que exige aprovação só avança aprovada.
   2. A mesma automação, para o mesmo registro, não cria duas tarefas (dedupe_key).
   3. Modelo com processo em andamento não perde nem reordena etapa (o processo perderia
      a etapa em que está, porque guarda só o NÚMERO da etapa atual).

   ESCOPO: tasks, workflow_* e automation_* não têm regra em scope.ts; a regra de quem vê
   está aqui, em seeTask e em requireTeam (na fase 2 vira a política de RLS dessas tabelas).
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, audit, connect, diff, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { ADJUSTMENT_INDEX } from '@/data/labels'
import { runList, type ListParams, type ListResult } from '@/data/query'
import { paidByEntry } from '@/data/rules'
import { see, type Scope } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type {
  AutomationRule, AutomationRun, Contract, EmailMessage, Id, IsoDate, Notification, Role, Task, WorkflowInstance, WorkflowStepTemplate, WorkflowTemplate,
} from '@/data/types'
import { lookup, ownersOf, unitLabel, type Lookup } from '@/data/views/lookup'
import { addDays, daysBetween, formatDate, parts } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { newId } from '@/lib/random'
import { queueEmail, recordRun } from '@/modules/comunicacao/outbox'
import { parseInput } from '@/modules/manutencao/repo'
import { runDueSchedules } from '@/modules/manutencao/rotinas'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida: escolha no calendário.')

/* ---------------------------------------------------------------- equipe da conta */

export interface TeamMember {
  id: Id
  name: string
  role: Role
}

/**
 * Administradores e colaboradores ativos da organização: quem pode ser responsável por tarefa
 * e por vistoria. memberships não tem regra em scope.ts: filtramos pela organização da sessão.
 */
export function teamOf(db: Db, orgId: Id): TeamMember[] {
  const names = new Map(db.profiles.map((p) => [p.id, p.full_name]))
  const out = new Map<Id, TeamMember>()
  for (const m of db.memberships) {
    if (m.organization_id !== orgId || m.status !== 'active' || (m.role !== 'admin' && m.role !== 'staff') || out.has(m.user_id)) continue
    out.set(m.user_id, { id: m.user_id, name: names.get(m.user_id) ?? 'Usuário', role: m.role })
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

/** A equipe (só a própria equipe consulta; portal recebe lista vazia). */
export async function listTeam(s: Session): Promise<TeamMember[]> {
  const { db, sc } = await connect(s)
  return sc.all ? teamOf(db, s.org.id) : []
}

/** Ações de processo da equipe: ser da equipe E ter "editar processos". */
function requireWorkflowEdit(s: Session, sc: Scope): void {
  if (!sc.all || !can(s, 'workflows:edit')) throw new AccessError('Só a equipe com permissão de editar processos faz isto.')
}

/* ---------------------------------------------------------------- índices de processo */

interface Index {
  L: Lookup
  inst: Map<Id, WorkflowInstance>
  tpl: Map<Id, WorkflowTemplate>
}

function indexOf(db: Db): Index {
  return { L: lookup(db), inst: new Map(db.workflow_instances.map((i) => [i.id, i])), tpl: new Map(db.workflow_templates.map((t) => [t.id, t])) }
}

/** Etapa (do modelo) a que a tarefa pertence; null = tarefa avulsa ou etapa que não existe mais. */
function stepOf(t: Task, ix: Index): WorkflowStepTemplate | null {
  if (!t.workflow_instance_id || t.step_index === null) return null
  const inst = ix.inst.get(t.workflow_instance_id)
  const tpl = inst ? ix.tpl.get(inst.template_id) : undefined
  return tpl?.steps[t.step_index] ?? null
}

/**
 * Quem vê qual tarefa:
 * - equipe: todas as da organização;
 * - proprietário: só as de etapa do PROPRIETÁRIO (as aprovações dele) nos contratos e unidades dele;
 * - inquilino e prestador: nenhuma (tarefa é trabalho interno da administração).
 */
function seeTask(sc: Scope, t: Task, role: Role | null): boolean {
  if (t.organization_id !== sc.orgId) return false
  if (sc.all) return true
  if (sc.role !== 'owner' || role !== 'owner') return false
  return (!!t.contract_id && sc.contractIds.has(t.contract_id)) || (!!t.unit_id && sc.unitIds.has(t.unit_id))
}

/**
 * Quem aprova: o administrador (qualquer etapa) e o proprietário (a etapa dele, nas unidades dele).
 * Colaborador não aprova: aprovação existe justamente para alguém acima conferir.
 */
function canApprove(s: Session, sc: Scope, t: Task, role: Role | null): boolean {
  if (!t.requires_approval || t.approved_by || t.status === 'done' || t.status === 'canceled') return false
  if (sc.all) return s.roles.includes('admin')
  return sc.role === 'owner' && role === 'owner' && can(s, 'quotes:approve')
}

/** Quem muda a situação (A fazer, Fazendo, Feito): quem edita processos ou o próprio responsável. */
function canEditTask(s: Session, sc: Scope, t: Task): boolean {
  return sc.all && (can(s, 'workflows:edit') || t.assignee_user_id === s.user.id)
}

/* ---------------------------------------------------------------- tarefas */

export type TaskStatus = Task['status']
export const TASK_STATUS: Record<TaskStatus, string> = { todo: 'A fazer', doing: 'Fazendo', done: 'Feito', canceled: 'Cancelada' }

export interface TaskRow extends Task {
  assignee_name: string | null
  /** Chave do modelo do processo ('renewal'...) ou 'avulsa'. */
  process_key: string
  process_name: string
  instance_title: string | null
  step_role: Role | null
  /** Passou do prazo e ainda não foi feita. */
  late: boolean
  contract_code: string | null
  unit_code: string | null
  can_approve: boolean
  can_edit: boolean
}

function toTaskRows(db: Db, s: Session, sc: Scope, ix: Index = indexOf(db)): TaskRow[] {
  const out: TaskRow[] = []
  for (const t of db.tasks) {
    const step = stepOf(t, ix)
    const role = step?.role ?? null
    if (!seeTask(sc, t, role)) continue
    const inst = t.workflow_instance_id ? ix.inst.get(t.workflow_instance_id) : undefined
    const tpl = inst ? ix.tpl.get(inst.template_id) : undefined
    out.push({
      ...t,
      assignee_name: t.assignee_user_id ? (ix.L.userName.get(t.assignee_user_id) ?? null) : null,
      process_key: tpl?.key ?? 'avulsa', process_name: tpl?.name ?? 'Avulsa', instance_title: inst?.title ?? null, step_role: role,
      late: !!t.due_date && t.due_date < s.today && (t.status === 'todo' || t.status === 'doing'),
      contract_code: t.contract_id ? (ix.L.contract.get(t.contract_id)?.code ?? null) : null,
      unit_code: t.unit_id ? (ix.L.unit.get(t.unit_id)?.code ?? null) : null,
      can_approve: canApprove(s, sc, t, role), can_edit: canEditTask(s, sc, t),
    })
  }
  return out
}

const STATUS_ORDER: Record<TaskStatus, number> = { doing: 0, todo: 1, done: 2, canceled: 3 }

/**
 * Filtros: status, responsavel ('eu' | id do usuário | 'sem'), atrasada ('sim'), processo (chave do modelo ou 'avulsa'),
 * aprovacao ('pendente' | 'aprovada'). Ordens: due_date, title, status, assignee.
 */
export async function listTasks(s: Session, params: ListParams): Promise<ListResult<TaskRow>> {
  const { db, sc } = await connect(s)
  return runList(toTaskRows(db, s, sc), params, {
    search: (t) => [t.title, t.description, t.process_name, t.assignee_name, t.contract_code, t.unit_code],
    filters: {
      status: (t) => t.status,
      // Uma tarefa minha conta em "Eu" e no meu nome: o número de cada opção bate com o que aparece.
      responsavel: (t) => (t.assignee_user_id ? (t.assignee_user_id === s.user.id ? ['eu', t.assignee_user_id] : [t.assignee_user_id]) : ['sem']),
      atrasada: (t) => (t.late ? 'sim' : null),
      processo: (t) => t.process_key,
      aprovacao: (t) => (!t.requires_approval ? null : t.approved_by ? 'aprovada' : 'pendente'),
    },
    sorts: { due_date: (t) => t.due_date, title: (t) => t.title, status: (t) => STATUS_ORDER[t.status], assignee: (t) => t.assignee_name },
    // Ordem declarada: o que está em andamento primeiro; dentro dele, o prazo mais perto; sem prazo no fim.
    defaultSort: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
  })
}

/**
 * Aprovações que ESTA sessão pode dar agora (o "Aprovações pendentes" do portal do proprietário).
 * Versão que recebe o banco já aberto: o portal monta várias partes numa consulta só.
 */
export function pendingApprovalsIn(db: Db, s: Session, sc: Scope): TaskRow[] {
  return toTaskRows(db, s, sc)
    .filter((t) => t.can_approve)
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
}

export async function pendingApprovals(s: Session): Promise<TaskRow[]> {
  const { db, sc } = await connect(s)
  return pendingApprovalsIn(db, s, sc)
}

/** Carrega a tarefa passando pelo escopo (o que não se vê "não existe"). */
async function loadTask(s: Session, id: Id) {
  const { db, sc } = await connect(s)
  const ix = indexOf(db)
  const t = db.tasks.find((x) => x.id === id)
  const role = t ? (stepOf(t, ix)?.role ?? null) : null
  if (!t || !seeTask(sc, t, role)) throw new AccessError('Tarefa não encontrada ou fora do seu acesso.')
  return { db, sc, ix, t, role }
}

export const statusSchema = z.object({ id: z.string(), status: z.enum(['todo', 'doing', 'done'], { message: 'Escolha A fazer, Fazendo ou Feito.' }) })

/** Muda a situação da tarefa. Tarefa que exige aprovação só vira "Feito" aprovada. */
export async function setTaskStatus(s: Session, input: z.infer<typeof statusSchema>): Promise<Task> {
  const data = parseInput(statusSchema, input)
  const { sc, t } = await loadTask(s, data.id)
  if (!canEditTask(s, sc, t)) throw new AccessError('Só o responsável pela tarefa ou quem edita processos muda a situação dela.')
  if (t.status === 'canceled') throw new RuleError(`A tarefa "${t.title}" foi cancelada: não muda mais de situação.`)
  if (t.status === data.status) throw new RuleError(`A tarefa já está em "${TASK_STATUS[data.status]}".`)
  if (data.status === 'done' && t.requires_approval && !t.approved_by) throw new RuleError(`A tarefa "${t.title}" exige aprovação: aprove antes de marcar como feita.`)
  const after: Task = { ...t, status: data.status, updated_at: nowIso() }
  upsertRows('tasks', [after])
  audit(s, 'tasks', t.id, 'status', `Tarefa "${t.title}": ${TASK_STATUS[t.status]} → ${TASK_STATUS[data.status]}`, diff(t, after))
  return after
}

/** Aprova a tarefa (e ela fica feita). Avançar o processo continua sendo um passo da equipe. */
export async function approveTask(s: Session, input: { id: Id }): Promise<Task> {
  const { sc, t, role } = await loadTask(s, input.id)
  if (!t.requires_approval) throw new RuleError(`A tarefa "${t.title}" não pede aprovação: basta marcar como feita.`)
  if (t.approved_by) throw new RuleError(`A tarefa "${t.title}" já foi aprovada.`)
  if (!canApprove(s, sc, t, role)) throw new AccessError('Quem aprova é o administrador ou, na etapa dele, o proprietário.')
  const now = nowIso()
  const after: Task = { ...t, approved_by: s.user.id, approved_at: now, status: 'done', updated_at: now }
  upsertRows('tasks', [after])
  audit(s, 'tasks', t.id, 'approve', `Aprovou "${t.title}"`, diff(t, after))
  return after
}

export const newTaskSchema = z.object({
  title: z.string().trim().min(3, 'Dê um título com pelo menos 3 letras.').max(120, 'Título longo demais: até 120 caracteres.'),
  description: z.string().trim().max(1000, 'Descrição longa demais: até 1.000 caracteres.'),
  assignee_user_id: z.string(),
  due_date: z.union([isoDate, z.literal('')]),
  requires_approval: z.boolean(),
})
export type NewTaskInput = z.infer<typeof newTaskSchema>

/** Tarefa avulsa (fora de processo). Responsável vazio = "sem responsável"; prazo vazio = sem prazo. */
export async function createTask(s: Session, input: NewTaskInput): Promise<Task> {
  const data = parseInput(newTaskSchema, input)
  const { db, sc } = await connect(s)
  requireWorkflowEdit(s, sc)
  if (data.assignee_user_id && !teamOf(db, s.org.id).some((m) => m.id === data.assignee_user_id)) throw new RuleError('O responsável escolhido não é da equipe desta conta.')
  if (data.due_date && data.due_date < s.today) throw new RuleError('O prazo ficou antes de hoje: escolha hoje ou uma data depois.')
  const now = nowIso()
  const t: Task = {
    id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id,
    title: data.title, description: data.description, workflow_instance_id: null, step_index: null,
    assignee_user_id: data.assignee_user_id || null, due_date: data.due_date || null, status: 'todo',
    requires_approval: data.requires_approval, approved_by: null, approved_at: null,
    contract_id: null, unit_id: null, maintenance_id: null, dedupe_key: null,
  }
  upsertRows('tasks', [t])
  audit(s, 'tasks', t.id, 'create', `Criou a tarefa "${t.title}"`)
  return t
}

/* ---------------------------------------------------------------- processos em andamento */

export interface InstanceRow extends WorkflowInstance {
  template_name: string
  template_key: string
  steps: WorkflowStepTemplate[]
  /** Etapas já feitas (a barra de progresso é feitas ÷ total). */
  steps_done: number
  progress_pct: number
  current_title: string | null
  current_task: { id: Id; status: TaskStatus; requires_approval: boolean; approved: boolean; assignee_name: string | null } | null
  contract_code: string | null
  unit_code: string | null
  /** null = pode avançar; texto = por que ainda não (a tela mostra no lugar do botão). */
  advance_blocker: string | null
}

export const INSTANCE_STATUS: Record<WorkflowInstance['status'], string> = { running: 'Em andamento', done: 'Concluído', canceled: 'Cancelado' }

function toInstanceRows(db: Db, s: Session): InstanceRow[] {
  const ix = indexOf(db)
  const rows: InstanceRow[] = []
  for (const inst of db.workflow_instances) {
    if (inst.organization_id !== s.org.id) continue
    const tpl = ix.tpl.get(inst.template_id)
    const steps = tpl?.steps ?? []
    const step = steps[inst.current_step]
    const cur = db.tasks.find((t) => t.workflow_instance_id === inst.id && t.step_index === inst.current_step && t.status !== 'canceled')
    const done = inst.status === 'done' ? steps.length : Math.min(inst.current_step, steps.length)
    const contract = inst.contract_id ? ix.L.contract.get(inst.contract_id) : undefined
    let blocker: string | null = null
    if (inst.status !== 'running') blocker = `Processo ${INSTANCE_STATUS[inst.status].toLowerCase()}.`
    else if (!step) blocker = 'A etapa atual não existe mais no modelo.'
    else if (step.requires_approval && !cur?.approved_by) blocker = `"${step.title}" exige aprovação antes de avançar.`
    rows.push({
      ...inst, template_name: tpl?.name ?? 'Modelo removido', template_key: tpl?.key ?? '', steps,
      steps_done: done, progress_pct: steps.length ? Math.round((done / steps.length) * 100) : 0,
      current_title: inst.status === 'running' ? (step?.title ?? null) : null,
      current_task: cur ? { id: cur.id, status: cur.status, requires_approval: cur.requires_approval, approved: !!cur.approved_by, assignee_name: cur.assignee_user_id ? (ix.L.userName.get(cur.assignee_user_id) ?? null) : null } : null,
      contract_code: contract?.code ?? null, unit_code: contract?.unit_id ? (ix.L.unit.get(contract.unit_id)?.code ?? null) : null,
      advance_blocker: blocker,
    })
  }
  return rows
}

/** Filtros: status, modelo (chave). Ordens: started_at, progress. Só a equipe enxerga processos. */
export async function listInstances(s: Session, params: ListParams): Promise<ListResult<InstanceRow>> {
  const { db, sc } = await connect(s)
  const rows = sc.all ? toInstanceRows(db, s) : []
  return runList(rows, params, {
    search: (r) => [r.title, r.template_name, r.contract_code, r.unit_code, r.current_title],
    filters: { status: (r) => r.status, modelo: (r) => r.template_key },
    sorts: { started_at: (r) => r.started_at, progress: (r) => r.progress_pct },
    defaultSort: (a, b) => Number(a.status !== 'running') - Number(b.status !== 'running') || (a.started_at < b.started_at ? 1 : -1),
  })
}

/** Responsável padrão de uma etapa nova: depende do papel da etapa no modelo. */
function assigneeForRole(db: Db, s: Session, role: Role): Id | null {
  if (role === 'owner' || role === 'vendor' || role === 'lessee') return null // aprovam ou agem pelo portal, não pela lista da equipe
  if (role === 'admin') return teamOf(db, s.org.id).find((m) => m.role === 'admin')?.id ?? s.user.id
  return s.user.id // etapa da equipe: fica com quem avançou o processo
}

/** Cria a tarefa de uma etapa do processo (prazo = hoje + prazo da etapa). */
function stepTask(db: Db, s: Session, inst: WorkflowInstance, steps: WorkflowStepTemplate[], index: number, dedupe: string | null): Task {
  const step = steps[index]
  const contract = inst.contract_id ? db.contracts.find((k) => k.id === inst.contract_id) : undefined
  const now = nowIso()
  return {
    id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id,
    title: `${step.title} · ${inst.title}`, description: '', workflow_instance_id: inst.id, step_index: index,
    assignee_user_id: assigneeForRole(db, s, step.role), due_date: addDays(s.today, step.sla_days), status: 'todo',
    requires_approval: step.requires_approval, approved_by: null, approved_at: null,
    contract_id: inst.contract_id, unit_id: contract?.unit_id ?? null, maintenance_id: inst.maintenance_id, dedupe_key: dedupe,
  }
}

/**
 * Avança o processo para a próxima etapa.
 * Passo a passo: permissão -> processo em andamento? -> a etapa atual exige aprovação e não foi
 * aprovada? recusa -> marca a tarefa da etapa atual como feita -> cria a tarefa da próxima etapa
 * (ou encerra o processo, se era a última) -> auditoria.
 */
export async function advanceInstance(s: Session, input: { id: Id }): Promise<{ instance: WorkflowInstance; task: Task | null }> {
  const { db, sc } = await connect(s)
  requireWorkflowEdit(s, sc)
  const inst = db.workflow_instances.find((i) => i.id === input.id && i.organization_id === s.org.id)
  if (!inst) throw new AccessError('Processo não encontrado nesta conta.')
  if (inst.status !== 'running') throw new RuleError(`O processo "${inst.title}" está ${INSTANCE_STATUS[inst.status].toLowerCase()}: não avança mais.`)
  const tpl = db.workflow_templates.find((t) => t.id === inst.template_id)
  const step = tpl?.steps[inst.current_step]
  if (!tpl || !step) throw new RuleError('A etapa atual não existe mais no modelo deste processo. Confira o modelo em "Modelos".')
  const current = db.tasks.filter((t) => t.workflow_instance_id === inst.id && t.step_index === inst.current_step && t.status !== 'canceled')
  if (step.requires_approval && !current.some((t) => t.approved_by)) {
    throw new RuleError(`A etapa "${step.title}" exige aprovação: aprove a tarefa dela antes de avançar o processo.`)
  }
  const now = nowIso()
  const closed = current.filter((t) => t.status !== 'done').map((t) => ({ ...t, status: 'done' as const, updated_at: now }))
  if (closed.length) upsertRows('tasks', closed)

  const next = inst.current_step + 1
  if (next >= tpl.steps.length) {
    const after: WorkflowInstance = { ...inst, status: 'done', current_step: tpl.steps.length, completed_at: now, updated_at: now }
    upsertRows('workflow_instances', [after])
    audit(s, 'workflow_instances', inst.id, 'status', `Processo "${inst.title}" concluído (última etapa: ${step.title})`, diff(inst, after))
    return { instance: after, task: null }
  }
  const after: WorkflowInstance = { ...inst, current_step: next, updated_at: now }
  const task = stepTask(db, s, after, tpl.steps, next, null)
  upsertRows('workflow_instances', [after])
  upsertRows('tasks', [task])
  audit(s, 'workflow_instances', inst.id, 'status', `Processo "${inst.title}": "${step.title}" feita, agora "${tpl.steps[next].title}"`, diff(inst, after))
  return { instance: after, task }
}

/* ---------------------------------------------------------------- modelos */

export interface TemplateRow extends WorkflowTemplate {
  /** Processos em andamento com este modelo (enquanto houver, etapa não sai nem muda de lugar). */
  running: number
}

export async function listTemplates(s: Session): Promise<TemplateRow[]> {
  const { db, sc } = await connect(s)
  if (!sc.all) return []
  return db.workflow_templates
    .filter((t) => t.organization_id === s.org.id)
    .map((t) => ({ ...t, running: db.workflow_instances.filter((i) => i.template_id === t.id && i.status === 'running').length }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

/** Quem faz cada etapa (os mesmos papéis do banco; etapa de proprietário, prestador ou inquilino é feita pelo portal). */
export const STEP_ROLES = ['staff', 'admin', 'owner', 'vendor', 'lessee'] as const satisfies readonly Role[]

export const stepInputSchema = z.object({
  title: z.string().trim().min(3, 'Etapa sem nome: escreva pelo menos 3 letras.').max(80, 'Nome de etapa longo demais: até 80 caracteres.'),
  role: z.enum(STEP_ROLES, { message: 'Escolha quem faz a etapa.' }),
  sla_days: z.number({ message: 'Prazo em dias: use um número.' }).int('Prazo em dias inteiros.').min(1, 'Prazo de pelo menos 1 dia.').max(365, 'Prazo acima de 1 ano: confira.'),
  requires_approval: z.boolean(),
  /** Posição que a etapa tinha antes da edição (null = etapa nova). É o que mostra se houve troca de ordem. */
  from: z.number().int().nullable(),
})
export const templateSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(3, 'Dê um nome com pelo menos 3 letras.').max(80, 'Nome longo demais: até 80 caracteres.'),
  steps: z.array(stepInputSchema).min(1, 'O modelo precisa de pelo menos uma etapa.').max(30, 'Mais de 30 etapas: divida em dois processos.'),
})
export type TemplateInput = z.infer<typeof templateSchema>

/**
 * Salva o modelo. Com processo em andamento, as etapas que já existiam precisam ficar no mesmo
 * lugar (o processo guarda só o NÚMERO da etapa atual: tirar ou trocar de lugar faria ele "pular").
 * Mudar nome, prazo, quem faz e aprovação, e incluir etapa no fim, pode sempre.
 */
export async function saveTemplate(s: Session, input: TemplateInput): Promise<WorkflowTemplate> {
  const data = parseInput(templateSchema, input)
  const { db, sc } = await connect(s)
  requireWorkflowEdit(s, sc)
  const tpl = db.workflow_templates.find((t) => t.id === data.id && t.organization_id === s.org.id)
  if (!tpl) throw new AccessError('Modelo não encontrado nesta conta.')
  const running = db.workflow_instances.filter((i) => i.template_id === tpl.id && i.status === 'running').length
  if (running > 0) {
    const kept = tpl.steps.every((_, i) => data.steps[i]?.from === i)
    if (!kept) {
      throw new RuleError(`Há ${running} ${running === 1 ? 'processo' : 'processos'} em andamento com este modelo. Enquanto houver, dá para mudar nome, prazo, quem faz e aprovação das etapas e incluir etapas no fim; remover ou trocar de lugar, não.`)
    }
  }
  const after: WorkflowTemplate = {
    ...tpl, name: data.name, updated_at: nowIso(),
    steps: data.steps.map((st) => ({ title: st.title, role: st.role, sla_days: st.sla_days, requires_approval: st.requires_approval })),
  }
  upsertRows('workflow_templates', [after])
  audit(s, 'workflow_templates', tpl.id, 'update', `Modelo "${after.name}" atualizado (${after.steps.length} etapas)`, diff(tpl, after))
  return after
}

/* ---------------------------------------------------------------- automações */

export const TRIGGER_TEXT: Record<AutomationRule['trigger'], (days: number) => string> = {
  contract_ends_in_days: (d) => `Locação vigente que termina em até ${d} ${d === 1 ? 'dia' : 'dias'}`,
  adjustment_month: () => 'Locação vigente no mês de reajuste',
  entry_overdue_days: (d) => `Cobrança em aberto vencida há ${d} ${d === 1 ? 'dia' : 'dias'} ou mais`,
  maintenance_schedule_due: (d) => (d === 0 ? 'Rotina de manutenção no dia marcado' : `Rotina de manutenção a até ${d} ${d === 1 ? 'dia' : 'dias'} da data marcada`),
  request_opened: () => 'Chamado aberto ou com situação nova (na hora, sem esperar a rotina diária)',
}
export const ACTION_TEXT: Record<AutomationRule['action'], string> = { create_task: 'Abre o processo (tarefa)', notify: 'Avisa o responsável', email: 'Envia e-mail (simulado na demonstração)' }

/**
 * Gatilhos que disparam na HORA do acontecimento (abrir ou mudar o chamado), dentro da própria
 * gravação (manutencao/repo.ts). A rotina diária e o "Rodar agora" não passam por eles: não há o
 * que procurar nos dados, o e-mail já saiu quando o chamado foi aberto.
 */
export const EVENT_TRIGGERS: readonly AutomationRule['trigger'][] = ['request_opened']

/** A regra usa o número de dias? (reajuste é "no mês"; pedido aberto é "na hora") */
export function ruleUsesDays(trigger: AutomationRule['trigger']): boolean {
  return trigger !== 'adjustment_month' && !EVENT_TRIGGERS.includes(trigger)
}

/** O que a regra faz, em uma frase (o gatilho muda o sentido da ação: "e-mail" de renovação vai a outras pessoas). */
export function actionText(r: AutomationRule): string {
  if (r.trigger === 'maintenance_schedule_due') return 'Abre o chamado, avisa o responsável e manda e-mail a ele e ao prestador (simulado)'
  if (r.trigger === 'request_opened') return 'E-mail e aviso ao responsável; quando a situação muda, e-mail a quem pediu (simulado)'
  if (r.action === 'email' && r.trigger === 'contract_ends_in_days') return 'E-mail ao inquilino e aos proprietários (simulado)'
  return ACTION_TEXT[r.action]
}

export interface RuleRow extends AutomationRule {
  last_run: AutomationRun | null
}
export interface RunRow extends AutomationRun {
  rule_name: string
}

/** Regras e o registro das execuções (o mais novo em cima). Só a equipe enxerga. */
export async function listAutomations(s: Session): Promise<{ rules: RuleRow[]; runs: RunRow[] }> {
  const { db, sc } = await connect(s)
  if (!sc.all) return { rules: [], runs: [] }
  const rules = db.automation_rules.filter((r) => r.organization_id === s.org.id)
  const names = new Map(rules.map((r) => [r.id, r.name]))
  const runs = db.automation_runs
    .filter((r) => r.organization_id === s.org.id)
    .sort((a, b) => (a.ran_at < b.ran_at ? 1 : -1))
    .map((r) => ({ ...r, rule_name: names.get(r.rule_id) ?? 'Regra removida' }))
  return {
    rules: rules.map((r) => ({ ...r, last_run: runs.find((x) => x.rule_id === r.id) ?? null })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    runs: runs.slice(0, 100),
  }
}

export const ruleSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  days: z.number({ message: 'Dias: use um número.' }).int('Dias inteiros.').min(0, 'Dias não pode ser negativo.').max(365, 'Mais de 365 dias: confira.'),
})

/**
 * Liga, desliga ou muda os dias da regra.
 * O nome costuma citar os dias ("vence em 60 dias"): quando o número aparece no nome, ele é
 * trocado junto, para o nome não contradizer a regra.
 */
export async function updateRule(s: Session, input: z.infer<typeof ruleSchema>): Promise<AutomationRule> {
  const data = parseInput(ruleSchema, input)
  const { db, sc } = await connect(s)
  requireWorkflowEdit(s, sc)
  const rule = db.automation_rules.find((r) => r.id === data.id && r.organization_id === s.org.id)
  if (!rule) throw new AccessError('Regra não encontrada nesta conta.')
  // Rotina de manutenção aceita 0 (abre no próprio dia); as outras precisam de pelo menos 1.
  const usesDays = ruleUsesDays(rule.trigger)
  if (usesDays && rule.trigger !== 'maintenance_schedule_due' && data.days < 1) throw new RuleError('Use pelo menos 1 dia: com 0 a regra não acharia nada antes de acontecer.')
  const days = usesDays ? data.days : rule.days
  const name = days !== rule.days ? rule.name.replace(new RegExp(`\\b${rule.days} (dias?)\\b`), `${days} ${days === 1 ? 'dia' : 'dias'}`) : rule.name
  const after: AutomationRule = { ...rule, enabled: data.enabled, days, name, updated_at: nowIso() }
  upsertRows('automation_rules', [after])
  audit(s, 'automation_rules', rule.id, 'update', `Automação "${after.name}": ${after.enabled ? 'ligada' : 'desligada'}${days !== rule.days ? `, ${days} dias` : ''}`, diff(rule, after))
  return after
}

/** Um caso que a regra achou nos dados (um contrato, normalmente). */
interface Hit {
  id: Id
  contract: Contract | null
  label: string
  title: string
  body: string
  link: string
  /** Quem recebe o aviso: o responsável pelo imóvel ou, sem ele, o administrador. */
  recipient: Id | null
}

/** Procura nos dados de HOJE o que a regra pede. Só lê dentro do escopo da equipe (see.contract / see.entry). */
function findHits(db: Db, s: Session, sc: Scope, rule: AutomationRule, L: Lookup): Hit[] {
  const admin = teamOf(db, s.org.id).find((m) => m.role === 'admin')?.id ?? null
  const team = new Set(teamOf(db, s.org.id).map((m) => m.id))
  const recipientOf = (k: Contract) => {
    const manager = L.property.get(k.property_id)?.manager_user_id ?? null
    return manager && team.has(manager) ? manager : admin
  }
  const unitCode = (k: Contract) => (k.unit_id ? (L.unit.get(k.unit_id)?.code ?? '') : '')
  const leases = db.contracts.filter((k) => see.contract(sc, k) && k.kind === 'lease' && k.status === 'active')

  if (rule.trigger === 'contract_ends_in_days') {
    return leases
      .map((k) => ({ k, left: daysBetween(s.today, k.end_date) }))
      .filter(({ left }) => left >= 0 && left <= rule.days)
      .map(({ k, left }) => ({
        id: k.id, contract: k, label: `${k.code} (${unitCode(k)})`, title: `Contrato ${k.code} vence em ${left} ${left === 1 ? 'dia' : 'dias'}`,
        body: `Unidade ${unitCode(k)}. Fim em ${formatDate(k.end_date)}.`, link: `/contratos/${k.id}`, recipient: recipientOf(k),
      }))
  }
  if (rule.trigger === 'adjustment_month') {
    const [, month] = parts(s.today)
    // Só quem já tem perto de um ano de contrato (330 dias): o primeiro reajuste é no aniversário de 12 meses,
    // e o contrato que COMEÇOU neste mês ainda não reajusta.
    return leases
      .filter((k) => k.adjustment_index !== 'none' && k.adjustment_month === month && daysBetween(k.start_date, s.today) >= 330)
      .map((k) => ({
        id: k.id, contract: k, label: `${k.code} (${unitCode(k)})`, title: `Reajuste de ${k.code} neste mês`,
        body: `Índice ${ADJUSTMENT_INDEX[k.adjustment_index]}, unidade ${unitCode(k)}.`, link: `/contratos/${k.id}`, recipient: recipientOf(k),
      }))
  }
  // Rotina de manutenção e pedido aberto não procuram contrato: têm caminho próprio em runAutomations.
  // (Antes desta guarda, os dois caíam no ramo da cobrança abaixo e criavam tarefa de cobrança por engano.)
  if (rule.trigger !== 'entry_overdue_days') return []
  // entry_overdue_days: agrupa por contrato (um caso por inquilino em atraso, não um por boleto).
  const paid = paidByEntry(db.payments)
  const byContract = new Map<Id, { k: Contract; open: number; count: number; maxDays: number }>()
  for (const e of db.financial_entries) {
    if (!see.entry(sc, e) || e.direction !== 'receivable' || e.status !== 'open' || !e.contract_id) continue
    const late = daysBetween(e.due_date, s.today)
    if (late < rule.days) continue
    const k = L.contract.get(e.contract_id)
    if (!k) continue
    const acc = byContract.get(k.id) ?? { k, open: 0, count: 0, maxDays: 0 }
    acc.open += Math.max(0, e.amount_cents - (paid.get(e.id) ?? 0))
    acc.count += 1
    acc.maxDays = Math.max(acc.maxDays, late)
    byContract.set(k.id, acc)
  }
  return [...byContract.values()].map(({ k, open, count, maxDays }) => ({
    id: k.id, contract: k, label: `${k.code} (${unitCode(k)})`, title: `Cobrança vencida há ${maxDays} dias: ${k.code}`,
    body: `${count} ${count === 1 ? 'cobrança' : 'cobranças'} em aberto, ${formatBRL(open)}.`, link: `/contratos/${k.id}`, recipient: recipientOf(k),
  }))
}

/**
 * Chave de duplicidade (dedupe_key) do que a regra cria. Os formatos são os mesmos que a rotina
 * "de verdade" (a do gerador de dados) usou, para a simulação reconhecer o que já existe:
 * - tarefa: regra + dias + contrato (uma vez por contrato);
 * - aviso: regra + contrato + DIA (mesma regra, mesmo registro, mesmo dia = um aviso só).
 */
function taskKey(rule: AutomationRule, hit: Hit): string {
  return `${rule.trigger}:${rule.days}:${hit.id}`
}
function noticeKey(rule: AutomationRule, hit: Hit, today: IsoDate): string {
  if (rule.trigger === 'contract_ends_in_days') return `ends${rule.days}:${hit.id}:${today}`
  if (rule.trigger === 'adjustment_month') return `adjustment_month:${hit.id}:${today.slice(0, 7)}` // reajuste é mensal: um aviso por mês
  return `${rule.trigger}:${rule.days}:${hit.id}:${today}`
}

/**
 * A tarefa desta regra para este contrato já existe? Compara a regra e o contrato, sem os dias:
 * mudar a regra de 60 para 30 dias não pode abrir uma segunda renovação para o mesmo contrato.
 * atalho: cobrança usa um caso por CONTRATO para sempre (formato do gerador); um segundo atraso do
 * mesmo contrato, meses depois, não abre outro processo. Melhorar quando a cobrança tiver
 * episódio próprio (ex.: chave com a competência mais antiga em aberto).
 */
function taskExists(db: Db, orgId: Id, rule: AutomationRule, hit: Hit): boolean {
  return db.tasks.some((t) => t.organization_id === orgId && !!t.dedupe_key && t.dedupe_key.startsWith(`${rule.trigger}:`) && t.dedupe_key.endsWith(`:${hit.id}`))
}

/** Qual processo cada gatilho abre (sem o modelo na conta, vira tarefa avulsa). */
const PROCESS_FOR: Partial<Record<AutomationRule['trigger'], WorkflowTemplate['key']>> = { contract_ends_in_days: 'renewal', entry_overdue_days: 'delinquency' }

export interface RunResult {
  created: number
  skipped: number
  rules: { id: Id; name: string; created: number; skipped: number; status: 'ok' | 'error'; error: string | null }[]
}

/** Motivo do e-mail de cada gatilho de contrato (o rótulo sai de EMAIL_REASON em labels.ts). */
const EMAIL_REASON_FOR: Partial<Record<AutomationRule['trigger'], EmailMessage['reason']>> = {
  contract_ends_in_days: 'renewal', entry_overdue_days: 'charge_due', adjustment_month: 'other',
}

/**
 * Ação "e-mail" num contrato achado pela regra: um e-mail para o inquilino e um para cada
 * proprietário vigente da unidade. Chave motivo:contrato:pessoa (o formato que a rotina antiga já
 * gravou: o e-mail de renovação que já foi não vai de novo).
 * Devolve as contagens e quem ficou sem e-mail (vira o erro da execução, sem parar a rodada).
 * Uma linha de auditoria no CONTRATO quando algo saiu: é o que o histórico do imóvel mostra.
 */
function emailHit(s: Session, rule: AutomationRule, hit: Hit, L: Lookup): { created: number; skipped: number; missing: string[] } {
  const out = { created: 0, skipped: 0, missing: [] as string[] }
  const k = hit.contract
  if (!k) return out
  const reason = EMAIL_REASON_FOR[rule.trigger] ?? 'other'
  const unit = k.unit_id ? L.unit.get(k.unit_id) : undefined
  const where = unit ? unitLabel(L, unit) : (L.property.get(k.property_id)?.name ?? '')
  const lesseeId = L.partiesByContract.get(k.id)?.find((p) => p.role === 'lessee')?.person_id ?? null
  const lessee = lesseeId ? L.person.get(lesseeId) : undefined
  const owners = unit ? ownersOf(L, unit, s.today) : []
  const left = daysBetween(s.today, k.end_date)
  const renewal = rule.trigger === 'contract_ends_in_days'
  const people = [
    ...(lessee ? [{ id: lessee.id, role: 'inquilino' as const }] : []),
    ...owners.filter((o) => o.person_id !== lesseeId).map((o) => ({ id: o.person_id, role: 'proprietário' as const })),
  ]
  const sent: string[] = []
  for (const { id, role } of people) {
    const person = L.person.get(id)
    if (!person) continue
    const mail = queueEmail(s, {
      to_email: person.email, to_name: person.name, reason, entity: 'contracts', entity_id: k.id, dedupe_key: `${reason}:${k.id}:${person.id}`,
      subject: !renewal ? hit.title : role === 'inquilino' ? `Seu contrato ${k.code} vence em ${left} ${left === 1 ? 'dia' : 'dias'}` : `Contrato ${k.code} do seu imóvel vence em ${left} ${left === 1 ? 'dia' : 'dias'}`,
      body: !renewal
        ? hit.body
        : role === 'inquilino'
          ? `O contrato de locação ${k.code} (${where}) termina em ${formatDate(k.end_date)}. Vamos conversar sobre a renovação: responda este e-mail ou fale com a administração pelo portal.`
          : `A locação ${k.code} (${where}${lessee ? `, inquilino ${lessee.name}` : ''}) termina em ${formatDate(k.end_date)}. A administração vai propor a renovação; responda se quiser mudar alguma condição.`,
    })
    if (mail === 'created') {
      out.created++
      sent.push(`${person.name} (${role})`)
    } else if (mail === 'skipped') out.skipped++
    else out.missing.push(person.name)
  }
  if (sent.length) audit(s, 'contracts', k.id, 'update', `Automação "${rule.name}": e-mail${sent.length > 1 ? 's' : ''} para ${sent.join(', ')}, simulado`)
  return out
}

/** "3 pessoas sem e-mail (Ana, Bruno e mais 1)": o erro da execução, curto. */
function missingText(names: string[]): string {
  const shown = names.slice(0, 2).join(', ')
  const more = names.length > 2 ? ` e mais ${names.length - 2}` : ''
  return `${names.length} ${names.length === 1 ? 'pessoa' : 'pessoas'} sem e-mail no cadastro (${shown}${more}): cadastre o e-mail em Pessoas. O resto foi.`
}

/**
 * "Rodar agora (simulação)": aplica as regras LIGADAS aos dados atuais, como a rotina diária faria
 * (na fase 2: pg_cron + Edge Function). Cria tarefa, aviso, chamado ou e-mail só se a chave ainda
 * não existe e grava uma execução por regra em automation_runs (com o erro, se der erro).
 * Rodar duas vezes seguidas: a segunda cria 0 e conta tudo como "já existia".
 * Regras de gatilho por acontecimento (EVENT_TRIGGERS) não entram: rodam na hora do acontecimento.
 */
export async function runAutomations(s: Session): Promise<RunResult> {
  const { db, sc } = await connect(s)
  requireWorkflowEdit(s, sc)
  const L = lookup(db)
  const result: RunResult = { created: 0, skipped: 0, rules: [] }
  for (const rule of db.automation_rules.filter((r) => r.organization_id === s.org.id && r.enabled && !EVENT_TRIGGERS.includes(r.trigger))) {
    let created = 0
    let skipped = 0
    let error: string | null = null
    // Problemas que não param a rodada (pessoa sem e-mail, rotina sem unidade): viram o erro no fim.
    const problems: string[] = []
    const missing: string[] = []
    try {
      if (rule.trigger === 'maintenance_schedule_due') {
        const r = runDueSchedules(db, s, rule)
        created = r.created
        skipped = r.skipped
        problems.push(...r.problems)
      }
      for (const hit of findHits(db, s, sc, rule, L)) {
        if (rule.action === 'create_task') {
          if (taskExists(db, s.org.id, rule, hit)) {
            skipped++
            continue
          }
          createFromRule(db, s, rule, hit)
          created++
        } else if (rule.action === 'email') {
          const r = emailHit(s, rule, hit, L)
          created += r.created
          skipped += r.skipped
          missing.push(...r.missing)
        } else {
          if (!hit.recipient) throw new Error('Ninguém para receber o aviso: a conta não tem administrador ativo.')
          const key = noticeKey(rule, hit, s.today)
          if (db.notifications.some((n) => n.organization_id === s.org.id && n.user_id === hit.recipient && n.dedupe_key === key)) {
            skipped++
            continue
          }
          const n: Notification = {
            id: newId(), organization_id: s.org.id, user_id: hit.recipient, title: hit.title, body: hit.body, link: hit.link, dedupe_key: key,
            channel: 'in_app', status: 'sent', attempts: 1, last_error: null, created_at: nowIso(), read_at: null,
          }
          upsertRows('notifications', [n])
          created++
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Erro desconhecido ao rodar a regra.'
    }
    if (missing.length) problems.push(missingText(missing))
    if (!error && problems.length) error = problems.join(' ')
    const run = recordRun(s, rule, created, skipped, error)
    result.created += created
    result.skipped += skipped
    result.rules.push({ id: rule.id, name: rule.name, created, skipped, status: run.status, error })
  }
  return result
}

/** Abre o processo do gatilho (renovação, cobrança) com a 1ª tarefa levando a chave; sem modelo, tarefa avulsa. */
function createFromRule(db: Db, s: Session, rule: AutomationRule, hit: Hit): void {
  const key = taskKey(rule, hit)
  const now = nowIso()
  const tplKey = PROCESS_FOR[rule.trigger]
  const tpl = tplKey ? db.workflow_templates.find((t) => t.organization_id === s.org.id && t.key === tplKey) : undefined
  if (tpl && tpl.steps.length) {
    const inst: WorkflowInstance = {
      id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id,
      template_id: tpl.id, title: hit.label, contract_id: hit.contract?.id ?? null, maintenance_id: null,
      status: 'running', current_step: 0, started_at: now, completed_at: null,
    }
    upsertRows('workflow_instances', [inst])
    upsertRows('tasks', [stepTask(db, s, inst, tpl.steps, 0, key)])
    audit(s, 'workflow_instances', inst.id, 'create', `Automação "${rule.name}" abriu o processo "${tpl.name}" de ${hit.label}`)
    return
  }
  const t: Task = {
    id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id,
    title: hit.title, description: hit.body, workflow_instance_id: null, step_index: null,
    assignee_user_id: hit.recipient, due_date: addDays(s.today, 5), status: 'todo', requires_approval: false, approved_by: null, approved_at: null,
    contract_id: hit.contract?.id ?? null, unit_id: hit.contract?.unit_id ?? null, maintenance_id: null, dedupe_key: key,
  }
  upsertRows('tasks', [t])
  audit(s, 'tasks', t.id, 'create', `Automação "${rule.name}" criou a tarefa "${t.title}"`)
}
