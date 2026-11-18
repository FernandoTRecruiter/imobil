// Testes da manutenção: o caminho do chamado, quem pode dar cada passo e as vistorias.
// Rodar: npx vitest run src/modules/manutencao
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { ORG, USER } from '@/data/seed'
import { resetForTest } from '@/data/store'
import type { ChargedTo, InspectionRoom } from '@/data/types'
import { addDays, addMonths } from '@/lib/dates'
import { runAutomations, updateRule } from '@/modules/processos/repo'
import {
  assignVendor, completeRequest, decideQuote, getRequestDetail, listOpenTargets, needsOwnerApproval, notifyRequestOpened, openRequest, OWNER_APPROVAL_ABOVE_CENTS,
  registerQuote, startWork, triageRequest,
} from './repo'
import { listSchedules, nextDateAfterRun, saveSchedule, setScheduleActive } from './rotinas'
import { escapeHtml, reportHtml } from './laudo'
import { completeInspection, getInspection, scheduleInspection, worsenedItems } from './vistorias'

const TODAY = '2026-11-04'
let db: Db
beforeEach(() => {
  db = resetForTest(TODAY)
})

/** Sessão da persona com o "hoje" fixo (o teste não pode depender do relógio). */
function session(userId: string): Session {
  const s = buildSession(db, userId)!
  s.today = TODAY
  return s
}
const unitId = (code: string) => db.units.find((u) => u.organization_id === ORG.agency && u.code === code)!.id
const byCode = (code: string) => db.maintenance_requests.find((r) => r.organization_id === ORG.agency && r.code === code)!
const eduardo = () => db.memberships.find((m) => m.user_id === USER.vendor)!.person_id!

/** Leva um chamado novo, numa unidade, até o orçamento registrado (pelo caminho da equipe). */
async function untilQuote(unitCode: string, cents: number, charged: ChargedTo = 'owner') {
  const admin = session(USER.admin)
  const r = await openRequest(admin, { unit_id: unitId(unitCode), category: 'plumbing', priority: 'high', title: 'Vazamento no tanque', description: '', photos: [] })
  await triageRequest(admin, { id: r.id, category: 'plumbing', priority: 'high', due_date: TODAY })
  await assignVendor(admin, { id: r.id, vendor_person_id: eduardo() })
  return registerQuote(admin, { id: r.id, quote_cents: cents, charged_to: charged })
}

describe('limite de aprovação do proprietário', () => {
  it('acima de R$ 500,00 espera o proprietário; até R$ 500,00 fica aprovado direto', async () => {
    expect(OWNER_APPROVAL_ABOVE_CENTS).toBe(50_000)
    expect(needsOwnerApproval('agency', 50_000)).toBe(false)
    expect(needsOwnerApproval('agency', 50_001)).toBe(true)
    expect((await untilQuote('B-102', 50_000)).status).toBe('approved')
    expect((await untilQuote('B-102', 50_001)).status).toBe('awaiting_owner')
  })
  it('na conta de proprietário independente não há aprovação dele para ele mesmo', () => {
    expect(needsOwnerApproval('landlord', 9_999_999)).toBe(false)
  })
})

describe('aprovação do orçamento', () => {
  it('o proprietário aprova o orçamento da unidade dele', async () => {
    const owner = session(USER.owner)
    const r = byCode('CH-0001') // A-301, de Carlos, aguardando o proprietário
    const after = await decideQuote(owner, { id: r.id, approve: true, comment: '' })
    expect(after.status).toBe('approved')
    expect(after.quote_status).toBe('approved')
    expect(after.quote_decided_by).toBe(USER.owner)
  })
  it('e não o de unidade de outro dono (o chamado nem existe para ele)', async () => {
    const other = await untilQuote('B-102', 85_000)
    expect(other.status).toBe('awaiting_owner')
    await expect(decideQuote(session(USER.owner), { id: other.id, approve: true, comment: '' })).rejects.toBeInstanceOf(AccessError)
    expect(db.maintenance_requests.find((x) => x.id === other.id)!.status).toBe('awaiting_owner')
  })
  it('o prestador não aprova orçamento, nem o do chamado atribuído a ele', async () => {
    const vendor = session(USER.vendor)
    const r = byCode('CH-0001')
    expect(r.vendor_person_id).toBe(eduardo())
    expect(can(vendor, 'quotes:approve')).toBe(false)
    await expect(decideQuote(vendor, { id: r.id, approve: true, comment: '' })).rejects.toBeInstanceOf(AccessError)
  })
  it('recusar exige o motivo e devolve o chamado para "Orçamento"', async () => {
    const owner = session(USER.owner)
    const r = byCode('CH-0001')
    await expect(decideQuote(owner, { id: r.id, approve: false, comment: '' })).rejects.toBeInstanceOf(RuleError)
    const after = await decideQuote(owner, { id: r.id, approve: false, comment: 'Valor alto, peçam outro orçamento.' })
    expect(after.status).toBe('quote')
    expect(after.quote_status).toBe('rejected')
  })
})

describe('conclusão e conta a pagar', () => {
  it('concluir com quem paga = proprietário cria a conta a pagar ao prestador', async () => {
    const admin = session(USER.admin)
    const r = await untilQuote('B-102', 30_000, 'owner')
    const before = db.financial_entries.length
    const { request, payable } = await completeRequest(admin, { id: r.id, note: 'Troca do sifão e vedação.' })
    expect(request.status).toBe('done')
    expect(db.financial_entries.length).toBe(before + 1)
    expect(payable).toMatchObject({
      direction: 'payable', category: 'maintenance', amount_cents: 30_000, person_id: eduardo(), charged_to: 'owner', status: 'open',
      unit_id: unitId('B-102'), due_date: addDays(TODAY, 5), competence: '2026-11-01',
    })
  })
  it('quem paga = inquilino: ele acerta direto com o prestador, sem conta a pagar', async () => {
    const r = await untilQuote('B-102', 30_000, 'lessee')
    const before = db.financial_entries.length
    const { payable } = await completeRequest(session(USER.admin), { id: r.id, note: 'Serviço feito.' })
    expect(payable).toBeNull()
    expect(db.financial_entries.length).toBe(before)
  })
  it('o prestador inicia e conclui o chamado dele, e a conta nasce mesmo ele sem ver o financeiro', async () => {
    const vendor = session(USER.vendor)
    const r = await untilQuote('B-102', 42_000, 'agency')
    await expect(completeRequest(vendor, { id: r.id, note: 'Feito.' })).rejects.toBeInstanceOf(RuleError) // ainda não iniciou
    expect((await startWork(vendor, { id: r.id })).status).toBe('in_progress')
    const { payable } = await completeRequest(vendor, { id: r.id, note: 'Troquei o registro.' })
    expect(payable?.amount_cents).toBe(42_000)
  })
  it('o prestador não mexe em chamado de outro prestador', async () => {
    const other = byCode('CH-0010') // atribuído a outra empresa
    expect(other.vendor_person_id).not.toBe(eduardo())
    await expect(startWork(session(USER.vendor), { id: other.id })).rejects.toBeInstanceOf(AccessError)
  })
  it('a linha do tempo registra cada mudança de situação', async () => {
    const admin = session(USER.admin)
    const r = await untilQuote('B-102', 20_000)
    await completeRequest(admin, { id: r.id, note: 'Concluído sem pendências.' })
    const { timeline } = await getRequestDetail(admin, r.id)
    const text = timeline.map((t) => t.summary).join(' | ')
    expect(text).toContain('Chamado aberto')
    expect(text).toContain('Triagem feita')
    expect(text).toContain('Prestador atribuído')
    expect(text).toContain('aprovado direto')
    expect(text).toContain('Chamado concluído')
    expect(db.audit_logs.filter((a) => a.entity_id === r.id && a.action === 'status').length).toBe(4)
  })
})

describe('abrir chamado', () => {
  it('a inquilina abre chamado na própria unidade e acompanha; em outra unidade, não', async () => {
    const lessee = session(USER.lessee)
    const mine = await openRequest(lessee, { unit_id: unitId('B-203'), category: 'electrical', priority: 'medium', title: 'Lâmpada da sala piscando', description: 'Desde ontem.', photos: [{ name: 'sala.jpg', size: 2048, mime: 'image/jpeg' }] })
    expect(mine.requester_person_id).toBe(lessee.personId)
    expect(mine.due_date).toBe(addDays(TODAY, 7))
    const detail = await getRequestDetail(lessee, mine.id)
    expect(detail.documents.map((d) => d.name)).toEqual(['sala.jpg'])
    await expect(openRequest(lessee, { unit_id: unitId('A-301'), category: 'other', priority: 'low', title: 'Teste de acesso', description: '', photos: [] })).rejects.toBeInstanceOf(RuleError)
  })
  it('o prestador não abre chamado', async () => {
    await expect(openRequest(session(USER.vendor), { unit_id: unitId('B-102'), category: 'other', priority: 'low', title: 'Teste de acesso', description: '', photos: [] })).rejects.toBeInstanceOf(AccessError)
  })
  it('o código continua a sequência da conta', async () => {
    const r = await openRequest(session(USER.admin), { unit_id: unitId('B-102'), category: 'other', priority: 'low', title: 'Vidro trincado', description: '', photos: [] })
    const n = db.maintenance_requests.filter((x) => x.organization_id === ORG.agency).length
    expect(r.code).toBe(`CH-${String(n).padStart(4, '0')}`)
  })
})

describe('vistorias', () => {
  const room = (name: string, items: [string, InspectionRoom['items'][number]['condition']][]): InspectionRoom => ({ name, items: items.map(([n, c]) => ({ name: n, condition: c, note: '' })) })

  it('compara a saída com a entrada pelo nome, sem acento e sem caixa', () => {
    const entrada = [room('Cozinha', [['Piso', 'good'], ['Louças e metais', 'fair'], ['Janelas', 'na']])]
    const saida = [room('cozinha', [['piso', 'poor'], ['Louças e metais', 'good'], ['Janelas', 'poor'], ['Item novo', 'poor']])]
    expect(worsenedItems(entrada, saida)).toEqual([{ room: 'cozinha', item: 'piso', from: 'good', to: 'poor', note: '' }])
  })

  it('a vistoria de saída usa o checklist da entrada e aponta o que piorou', async () => {
    const admin = session(USER.admin)
    // Qualquer unidade da imobiliária com vistoria de entrada concluída (e sem vistoria de saída agendada):
    // fixar o código (era A-303) quebrava quando os dados fictícios mudavam.
    const entrada = db.inspections.find(
      (i) => i.organization_id === admin.org.id && i.kind === 'move_in' && i.status === 'done' &&
        !db.inspections.some((o) => o.unit_id === i.unit_id && o.kind === 'move_out' && o.status === 'scheduled'),
    )!
    const unit = entrada.unit_id
    const saida = await scheduleInspection(admin, { unit_id: unit, kind: 'move_out', scheduled_date: TODAY, inspector_user_id: USER.maint })
    expect(saida.rooms.map((r) => r.name)).toEqual(entrada.rooms.map((r) => r.name))
    // Repete os estados da entrada e piora UM item que estava bom.
    const rooms = entrada.rooms.map((r) => ({ ...r, items: r.items.map((it) => ({ ...it })) }))
    const target = rooms.flatMap((r) => r.items.map((it) => ({ r, it }))).find(({ it }) => it.condition === 'good')!
    target.it.condition = 'poor'
    await completeInspection(admin, { id: saida.id, rooms })
    const detail = await getInspection(admin, saida.id)
    expect(detail.inspection.status).toBe('done')
    expect(detail.baseline?.inspection.id).toBe(entrada.id)
    expect(detail.baseline?.worse).toHaveLength(1)
    expect(detail.baseline?.worse[0]).toMatchObject({ room: target.r.name, item: target.it.name, from: 'good', to: 'poor' })
  })

  it('não conclui sem nenhum item avaliado, e só a equipe agenda', async () => {
    const admin = session(USER.admin)
    const i = await scheduleInspection(admin, { unit_id: unitId('B-102'), kind: 'periodic', scheduled_date: TODAY, inspector_user_id: '' })
    await expect(completeInspection(admin, { id: i.id, rooms: i.rooms })).rejects.toBeInstanceOf(RuleError)
    await expect(scheduleInspection(admin, { unit_id: unitId('B-102'), kind: 'periodic', scheduled_date: TODAY, inspector_user_id: '' })).rejects.toBeInstanceOf(RuleError) // duplicada
    await expect(scheduleInspection(session(USER.owner), { unit_id: unitId('A-301'), kind: 'periodic', scheduled_date: TODAY, inspector_user_id: '' })).rejects.toBeInstanceOf(AccessError)
  })
})

describe('laudo da vistoria', () => {
  it('texto digitado entra como texto, nunca como código', async () => {
    expect(escapeHtml(`<script>alert("x")</script> & '`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;')
    const admin = session(USER.admin)
    const i = await scheduleInspection(admin, { unit_id: unitId('B-102'), kind: 'periodic', scheduled_date: TODAY, inspector_user_id: '' })
    const rooms = i.rooms.map((r, k) => (k === 0 ? { ...r, items: r.items.map((it, j) => (j === 0 ? { ...it, condition: 'poor' as const, note: '<img src=x onerror=alert(1)>' } : it)) } : r))
    await completeInspection(admin, { id: i.id, rooms })
    const html = reportHtml(await getInspection(admin, i.id), 'Imobiliária Aurora', '04/11/2026 10:00')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('Laudo de vistoria periódica · B-102')
    expect(html).toContain('1 em estado ruim')
  })
})

describe('rotinas de manutenção', () => {
  const mangueiras = () => db.maintenance_schedules.find((x) => x.title === 'Dedetização das áreas comuns')!
  const routineRule = () => db.automation_rules.find((r) => r.organization_id === ORG.agency && r.trigger === 'maintenance_schedule_due')!

  it('a rotina vencida abre 1 chamado, avança a data em 6 meses, avisa e manda e-mail; a segunda rodada não abre outro', async () => {
    const admin = session(USER.admin)
    const sch = mangueiras()
    expect(sch.next_date < TODAY).toBe(true) // venceu há 2 dias
    const requests = db.maintenance_requests.length
    const first = await runAutomations(admin)
    expect(first.rules.find((r) => r.id === routineRule().id)).toMatchObject({ created: 1, skipped: 0, status: 'ok' })
    expect(db.maintenance_requests.length).toBe(requests + 1)

    const after = db.maintenance_schedules.find((x) => x.id === sch.id)!
    expect(after.next_date).toBe(addMonths(sch.next_date, 6))
    const req = db.maintenance_requests.find((r) => r.id === after.last_request_id)!
    expect(req).toMatchObject({ property_id: sch.property_id, vendor_person_id: sch.vendor_person_id, category: 'cleaning', status: 'open', requester_person_id: null })
    expect(req.due_date! >= TODAY).toBe(true) // a data já passou: o prazo conta de hoje, o chamado não nasce atrasado
    expect(db.email_outbox.filter((e) => e.reason === 'routine_maintenance' && e.entity_id === req.id)).toHaveLength(2) // responsável e prestador
    expect(db.notifications.filter((n) => n.dedupe_key === `schedule:${sch.id}:${sch.next_date}`)).toHaveLength(1)
    expect(db.audit_logs.some((a) => a.entity === 'maintenance_schedules' && a.entity_id === sch.id && a.summary.includes(req.code))).toBe(true)

    const second = await runAutomations(admin)
    expect(second.rules.find((r) => r.id === routineRule().id)).toMatchObject({ created: 0 })
    expect(db.maintenance_requests.length).toBe(requests + 1)
    expect(db.email_outbox.filter((e) => e.reason === 'routine_maintenance' && e.entity_id === req.id)).toHaveLength(2)
  })

  it('a chave segura até a data voltar para trás: a mesma rotina na mesma data não abre o segundo chamado', async () => {
    const admin = session(USER.admin)
    const sch = mangueiras()
    await runAutomations(admin)
    db.maintenance_schedules = db.maintenance_schedules.map((x) => (x.id === sch.id ? { ...x, next_date: sch.next_date } : x)) // alguém volta a data à mão
    const requests = db.maintenance_requests.length
    const again = await runAutomations(admin)
    expect(again.rules.find((r) => r.id === routineRule().id)).toMatchObject({ created: 0, skipped: 1 })
    expect(db.maintenance_requests.length).toBe(requests)
  })

  it('rotina parada há muito tempo abre um chamado e pula para a próxima data futura', () => {
    expect(nextDateAfterRun('2025-01-31', 6, TODAY)).toBe('2027-01-31')
    expect(nextDateAfterRun('2026-11-02', 6, '2026-11-05')).toBe('2027-05-02')
    expect(nextDateAfterRun('2026-01-31', 1, '2026-02-01')).toBe('2026-02-28') // mês curto: último dia
  })

  it('desligada não abre; data nova no passado é recusada; só a equipe que edita manutenção mexe', async () => {
    const admin = session(USER.admin)
    await setScheduleActive(admin, { id: mangueiras().id, active: false })
    const requests = db.maintenance_requests.length
    await runAutomations(admin)
    expect(db.maintenance_requests.length).toBe(requests)

    const base = { id: '', property_id: mangueiras().property_id, unit_id: '', category: 'cleaning' as const, title: 'Limpeza das calhas', description: '', every_months: 3, vendor_person_id: '', active: true }
    await expect(saveSchedule(admin, { ...base, next_date: addDays(TODAY, -1) })).rejects.toBeInstanceOf(RuleError)
    const created = await saveSchedule(admin, { ...base, next_date: addDays(TODAY, 10) })
    expect(created.every_months).toBe(3)
    await expect(saveSchedule(session(USER.staff), { ...base, next_date: addDays(TODAY, 10) })).rejects.toBeInstanceOf(AccessError)
    expect((await listSchedules(session(USER.lessee), {})).totalAll).toBe(0)
    expect((await listSchedules(session(USER.vendor), {})).totalAll).toBe(0)
  })
})

describe('e-mails do chamado (regra "Pedido aberto")', () => {
  const daniUnit = async () => (await listOpenTargets(session(USER.lessee)))[0].value

  it('a inquilina abre: e-mail e aviso ao responsável do prédio; a triagem manda e-mail para ela; nada repete', async () => {
    const lessee = session(USER.lessee)
    const admin = session(USER.admin)
    const r = await openRequest(lessee, { unit_id: await daniUnit(), category: 'plumbing', priority: 'medium', title: 'Torneira pingando', description: '', photos: [] })
    const manager = db.properties.find((p) => p.id === r.property_id)!.manager_user_id!
    const opened = db.email_outbox.filter((e) => e.entity_id === r.id && e.reason === 'request_opened')
    expect(opened).toHaveLength(1)
    expect(opened[0].to_email).toBe(db.profiles.find((p) => p.id === manager)!.email)
    expect(db.notifications.filter((n) => n.user_id === manager && n.dedupe_key === `request_opened:${r.id}:${manager}`)).toHaveLength(1)
    notifyRequestOpened(db, lessee, r) // dispara de novo: a chave segura
    expect(db.email_outbox.filter((e) => e.entity_id === r.id && e.reason === 'request_opened')).toHaveLength(1)

    await triageRequest(admin, { id: r.id, category: 'plumbing', priority: 'medium', due_date: TODAY })
    const update = db.email_outbox.filter((e) => e.entity_id === r.id && e.reason === 'request_update')
    expect(update).toHaveLength(1)
    expect(update[0].to_email).toBe('daniela.freitas@example.com')
    const rule = db.automation_rules.find((x) => x.organization_id === ORG.agency && x.trigger === 'request_opened')!
    expect(db.automation_runs.filter((x) => x.rule_id === rule.id && x.status === 'ok')).toHaveLength(3) // aberto, de novo (0 criadas), triagem
    expect(db.audit_logs.filter((a) => a.entity === 'maintenance_requests' && a.entity_id === r.id && a.summary.startsWith('E-mail'))).toHaveLength(2)
  })

  it('com a regra desligada, o chamado abre e nenhum e-mail sai', async () => {
    const admin = session(USER.admin)
    const rule = db.automation_rules.find((x) => x.organization_id === ORG.agency && x.trigger === 'request_opened')!
    await updateRule(admin, { id: rule.id, enabled: false, days: rule.days })
    const emails = db.email_outbox.length
    const r = await openRequest(session(USER.lessee), { unit_id: await daniUnit(), category: 'electrical', priority: 'high', title: 'Tomada sem energia', description: '', photos: [] })
    await triageRequest(admin, { id: r.id, category: 'electrical', priority: 'high', due_date: TODAY })
    expect(db.email_outbox.length).toBe(emails)
  })
})
