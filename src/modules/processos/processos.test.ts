// Testes de processos: aprovação que segura etapa, automação que não duplica, quem vê qual tarefa.
// Rodar: npx vitest run src/modules/processos
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { AccessError, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { ORG, USER } from '@/data/seed'
import { resetForTest } from '@/data/store'
import {
  advanceInstance, approveTask, createTask, EVENT_TRIGGERS, listTasks, pendingApprovals, runAutomations, saveTemplate, setTaskStatus, updateRule, type TemplateInput,
} from './repo'
import { resolveProcessTab } from './ProcessesPage'

const TODAY = '2026-11-04'
let db: Db
beforeEach(() => {
  db = resetForTest(TODAY)
})

function session(userId: string): Session {
  const s = buildSession(db, userId)!
  s.today = TODAY
  return s
}

/** O processo de renovação da A-301 (Carlos), parado na etapa "Aprovação do proprietário". */
function renewalA301() {
  const inst = db.workflow_instances.find((i) => i.organization_id === ORG.agency && i.title.includes('(A-301)'))!
  const task = db.tasks.find((t) => t.workflow_instance_id === inst.id && t.step_index === inst.current_step)!
  return { inst, task }
}

describe('etapa que exige aprovação', () => {
  it('não avança sem aprovação; aprovada pelo proprietário, avança e cria a tarefa da próxima', async () => {
    const admin = session(USER.admin)
    const { inst, task } = renewalA301()
    expect(task.requires_approval).toBe(true)
    await expect(advanceInstance(admin, { id: inst.id })).rejects.toBeInstanceOf(RuleError)
    await expect(setTaskStatus(admin, { id: task.id, status: 'done' })).rejects.toBeInstanceOf(RuleError) // "feito" sem aprovar, não

    const approved = await approveTask(session(USER.owner), { id: task.id })
    expect(approved).toMatchObject({ approved_by: USER.owner, status: 'done' })

    const { instance, task: next } = await advanceInstance(admin, { id: inst.id })
    expect(instance.current_step).toBe(inst.current_step + 1)
    expect(next).toMatchObject({ step_index: inst.current_step + 1, workflow_instance_id: inst.id, status: 'todo', contract_id: inst.contract_id })
    expect(next?.title).toContain('Aditivo assinado')
  })

  it('a última etapa encerra o processo', async () => {
    const admin = session(USER.admin)
    const { inst, task } = renewalA301()
    await approveTask(admin, { id: task.id }) // o administrador também aprova (registrando a resposta do dono)
    await advanceInstance(admin, { id: inst.id })
    const { instance, task: next } = await advanceInstance(admin, { id: inst.id })
    expect(instance.status).toBe('done')
    expect(next).toBeNull()
  })
})

describe('quem vê e quem mexe nas tarefas', () => {
  it('o proprietário vê só as aprovações das unidades dele; a inquilina não vê tarefa', async () => {
    const mine = await pendingApprovals(session(USER.owner))
    expect(mine.map((t) => t.title)).toEqual([renewalA301().task.title])
    expect((await listTasks(session(USER.lessee), {})).totalAll).toBe(0)
    expect((await listTasks(session(USER.vendor), {})).totalAll).toBe(0)
  })
  it('colaborador aprova? não: aprovação é do administrador ou do dono', async () => {
    const leasing = session(USER.leasing) // edita processos, mas não é administradora
    await expect(approveTask(leasing, { id: renewalA301().task.id })).rejects.toBeInstanceOf(AccessError)
  })
  it('quem não edita processos muda só a própria tarefa e não cria tarefa', async () => {
    const staff = session(USER.staff) // financeiro: vê processos, não edita
    const own = db.tasks.find((t) => t.assignee_user_id === USER.staff)!
    expect((await setTaskStatus(staff, { id: own.id, status: 'doing' })).status).toBe('doing')
    const other = db.tasks.find((t) => t.organization_id === ORG.agency && t.assignee_user_id === USER.admin && t.status === 'todo')!
    await expect(setTaskStatus(staff, { id: other.id, status: 'doing' })).rejects.toBeInstanceOf(AccessError)
    await expect(createTask(staff, { title: 'Ligar para o síndico', description: '', assignee_user_id: '', due_date: '', requires_approval: false })).rejects.toBeInstanceOf(AccessError)
  })
})

describe('automações', () => {
  it('rodar duas vezes não duplica tarefa nem aviso', async () => {
    const admin = session(USER.admin)
    const first = await runAutomations(admin)
    const tasks = db.tasks.length
    const notes = db.notifications.length
    const instances = db.workflow_instances.length
    const requests = db.maintenance_requests.length
    const emails = db.email_outbox.length
    const second = await runAutomations(admin)
    expect(second.created).toBe(0)
    // A rotina de manutenção que abriu o chamado empurrou a data: na segunda rodada ela nem está vencida
    // (não conta como "já existia"). Todo o resto conta.
    const routines = new Set(db.automation_rules.filter((r) => r.trigger === 'maintenance_schedule_due').map((r) => r.id))
    const opened = first.rules.filter((r) => routines.has(r.id)).reduce((n, r) => n + r.created, 0)
    expect(opened).toBe(1)
    expect(second.skipped).toBe(first.created + first.skipped - opened)
    expect(db.tasks.length).toBe(tasks)
    expect(db.notifications.length).toBe(notes)
    expect(db.workflow_instances.length).toBe(instances)
    expect(db.maintenance_requests.length).toBe(requests)
    expect(db.email_outbox.length).toBe(emails)
    // Uma execução gravada por regra ligada da rodada diária, a cada rodada (o gatilho por acontecimento não entra).
    const daily = db.automation_rules.filter((r) => r.organization_id === ORG.agency && r.enabled && !EVENT_TRIGGERS.includes(r.trigger)).length
    expect(db.automation_runs.filter((r) => r.organization_id === ORG.agency).length).toBe(7 * 3 + daily * 2)
  })
  it('reconhece o que a rotina de ontem já criou (renovações da semente não abrem de novo)', async () => {
    const result = await runAutomations(session(USER.admin))
    const rule = db.automation_rules.find((r) => r.organization_id === ORG.agency && r.trigger === 'contract_ends_in_days' && r.action === 'create_task')!
    const ends = result.rules.find((r) => r.id === rule.id)!
    expect(ends.created).toBe(0)
    expect(ends.skipped).toBeGreaterThan(0)
  })
  it('mudar os dias da regra não abre uma segunda renovação para o mesmo contrato', async () => {
    const admin = session(USER.admin)
    const rule = db.automation_rules.find((r) => r.organization_id === ORG.agency && r.trigger === 'contract_ends_in_days')!
    const after = await updateRule(admin, { id: rule.id, enabled: true, days: 45 })
    expect(after.name).toContain('45 dias')
    const result = await runAutomations(admin)
    expect(result.rules.find((r) => r.id === rule.id)!.created).toBe(0)
  })
  it('e-mail de renovação: inquilino e proprietários do contrato que vence, uma vez só (o que a rotina antiga mandou é reconhecido)', async () => {
    const admin = session(USER.admin)
    const rule = db.automation_rules.find((r) => r.organization_id === ORG.agency && r.trigger === 'contract_ends_in_days' && r.action === 'email')!
    const first = (await runAutomations(admin)).rules.find((r) => r.id === rule.id)!
    expect(first.created).toBeGreaterThan(0) // os proprietários: a rotina antiga só tinha mandado ao inquilino
    expect(first.skipped).toBeGreaterThan(0) // os inquilinos: e-mail já na caixa de saída
    const renewal = db.email_outbox.filter((e) => e.organization_id === ORG.agency && e.reason === 'renewal')
    expect(renewal.every((e) => e.entity === 'contracts' && e.status === 'simulated')).toBe(true)
    expect(new Set(renewal.map((e) => e.dedupe_key)).size).toBe(renewal.length)
    const second = (await runAutomations(admin)).rules.find((r) => r.id === rule.id)!
    expect(second).toMatchObject({ created: 0, skipped: first.created + first.skipped })
    expect(db.email_outbox.filter((e) => e.organization_id === ORG.agency && e.reason === 'renewal')).toHaveLength(renewal.length)
    // Histórico: uma linha por contrato que recebeu e-mail novo.
    expect(db.audit_logs.filter((a) => a.entity === 'contracts' && a.summary.startsWith(`Automação "${rule.name}"`)).length).toBeGreaterThan(0)
  })
  it('regra desligada não roda', async () => {
    const admin = session(USER.admin)
    const rules = db.automation_rules.filter((r) => r.organization_id === ORG.agency)
    for (const r of rules) await updateRule(admin, { id: r.id, enabled: false, days: r.days })
    const result = await runAutomations(admin)
    expect(result.rules).toHaveLength(0)
  })
})

describe('modelos de processo', () => {
  it('com processo em andamento, etapa não sai nem troca de lugar; prazo muda', async () => {
    const admin = session(USER.admin)
    const tpl = db.workflow_templates.find((t) => t.organization_id === ORG.agency && t.key === 'renewal')!
    const steps = tpl.steps.map((st, i) => ({ ...st, from: i as number | null }))
    const base: TemplateInput = { id: tpl.id, name: tpl.name, steps }
    await expect(saveTemplate(admin, { ...base, steps: steps.slice(1) })).rejects.toBeInstanceOf(RuleError)
    await expect(saveTemplate(admin, { ...base, steps: [steps[1], steps[0], ...steps.slice(2)] })).rejects.toBeInstanceOf(RuleError)
    const saved = await saveTemplate(admin, { ...base, steps: [{ ...steps[0], sla_days: 9 }, ...steps.slice(1), { title: 'Arquivar o aditivo', role: 'staff', sla_days: 2, requires_approval: false, from: null }] })
    expect(saved.steps[0].sla_days).toBe(9)
    expect(saved.steps).toHaveLength(tpl.steps.length + 1)
  })
})

describe('abas da tela (Automações e Comunicados viraram uma em 06/11)', () => {
  it('aba antiga lembrada no navegador cai na aba que a recebeu; valor estranho abre Tarefas', () => {
    expect(resolveProcessTab('automacoes')).toBe('automacoes-comunicados')
    expect(resolveProcessTab('comunicados')).toBe('automacoes-comunicados')
    expect(resolveProcessTab('andamento')).toBe('processos')
    expect(resolveProcessTab('modelos')).toBe('processos')
    // A Visão geral grava "tarefas" antes de abrir as atrasadas: precisa seguir valendo.
    expect(resolveProcessTab('tarefas')).toBe('tarefas')
    expect(resolveProcessTab(null)).toBe('tarefas')
    expect(resolveProcessTab('inexistente')).toBe('tarefas')
  })
})
