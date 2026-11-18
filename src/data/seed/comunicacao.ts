/* =============================================================================
   comunicacao.ts (passo 14 do gerador): equipe dos imóveis, rotinas de manutenção,
   comunicados e a caixa de saída de e-mail (simulada).

   Fica no FIM do gerador de propósito: usar o sorteio aqui não muda nada do que foi gerado antes.
   ============================================================================= */
import { addDays, daysBetween } from '@/lib/dates'
import type { Announcement, EmailMessage, Id, MaintenanceSchedule, Person, PropertyStaff, StaffRole } from '../types'
import { ORG, USER } from './catalogo'
import { adminOf, base, makePerson, ts, type Ctx } from './ctx'

function propByName(c: Ctx, name: string) {
  return c.db.properties.find((p) => p.name === name)
}

export function seedCommunication(c: Ctx): void {
  const { db, ref, rng } = c
  const A = ORG.agency

  /* 14a. Equipe dos imóveis. Quem já existia (síndico e zelador criados no passo 1) é reaproveitado. */
  const staff = (orgId: Id, propertyName: string, role: StaffRole, person: Person, note: string) => {
    const p = propByName(c, propertyName)
    if (!p) return
    const row: PropertyStaff = { ...base(c, orgId, '2025-02-01'), property_id: p.id, person_id: person.id, role, note, active: true }
    db.property_staff.push(row)
  }
  const newStaff = (orgId: Id, tag: 'caretaker' | 'contact') => makePerson(c, orgId, 'PF', undefined, { tags: [tag] })
  staff(A, 'Condomínio Mount Juic', 'syndic', c.persons.syndic, 'Mandato até dez/2027')
  staff(A, 'Condomínio Mount Juic', 'caretaker', newStaff(A, 'caretaker'), 'Seg a sex, 7h às 16h')
  staff(A, 'Condomínio Mount Juic', 'doorman', newStaff(A, 'contact'), 'Portaria 24 h, ramal 9')
  staff(A, 'Condomínio Luar', 'caretaker', c.persons.caretakerLuar, 'Seg a sáb, 8h às 14h')
  staff(A, 'Condomínio Luar', 'doorman', newStaff(A, 'contact'), 'Portaria 24 h na entrada da Rua das Andorinhas')
  staff(A, 'Lynx Residence', 'caretaker', newStaff(A, 'caretaker'), 'Seg a sex, 8h às 18h')
  staff(A, 'Lynx Residence', 'security', newStaff(A, 'contact'), 'Estacionamento: noite e fim de semana')
  staff(ORG.landlord, 'Edifício Le Plaza', 'cleaning', newStaff(ORG.landlord, 'contact'), 'Salas da Marina: terças e sextas')

  /* 14b. Rotinas de manutenção. A do Condomínio Luar já venceu: a automação abre o chamado na próxima rodada. */
  const vendor = (name: string) => db.people.find((p) => p.name === name)?.id ?? null
  const schedule = (orgId: Id, propertyName: string, title: string, category: MaintenanceSchedule['category'], every: number, nextIn: number, vendorName: string | null) => {
    const p = propByName(c, propertyName)
    if (!p) return
    db.maintenance_schedules.push({
      ...base(c, orgId, addDays(ref, -200)), property_id: p.id, unit_id: null, category, title,
      description: `Rotina a cada ${every} meses, nas áreas comuns.`, every_months: every, next_date: addDays(ref, nextIn),
      vendor_person_id: vendorName ? vendor(vendorName) : null, active: true, last_request_id: null,
    })
  }
  schedule(A, 'Condomínio Mount Juic', "Limpeza da caixa d'água", 'cleaning', 6, 20, 'Brilho Limpeza Ltda')
  schedule(A, 'Lynx Residence', 'Recarga e revisão dos extintores', 'other', 12, 45, null)
  schedule(A, 'Condomínio Luar', 'Dedetização das áreas comuns', 'cleaning', 6, -2, 'Brilho Limpeza Ltda')
  schedule(ORG.landlord, 'Edifício Le Plaza', 'Revisão da parte elétrica das salas', 'electrical', 12, 60, 'Sérgio Pinheiro')

  /* 14c. Comunicados: dois enviados (um para um prédio, um para todos) e um rascunho. */
  const activeLessees = (propertyId: Id | null, orgId: Id) => {
    const ids = new Set<Id>()
    for (const k of db.contracts) {
      if (k.organization_id !== orgId || k.kind !== 'lease' || k.status !== 'active') continue
      if (propertyId && k.property_id !== propertyId) continue
      const p = db.contract_parties.find((x) => x.contract_id === k.id && x.role === 'lessee')
      if (p) ids.add(p.person_id)
    }
    return [...ids].map((id) => db.people.find((p) => p.id === id)!).filter(Boolean)
  }
  const outbox = (orgId: Id, to: Person, subject: string, body: string, reason: EmailMessage['reason'], entity: string, entityId: Id, when: string) => {
    db.email_outbox.push({
      id: rng.uuid(), organization_id: orgId, to_email: to.email, to_name: to.name, subject, body, reason, entity, entity_id: entityId,
      status: 'simulated', dedupe_key: `${reason}:${entityId}:${to.id}`, created_at: ts(when, 9),
    })
  }
  const announce = (propertyName: string | null, title: string, body: string, audience: Announcement['audience'], sentDaysAgo: number | null) => {
    const p = propertyName ? propByName(c, propertyName) : null
    const people = sentDaysAgo === null ? [] : activeLessees(p?.id ?? null, A)
    const a: Announcement = {
      ...base(c, A, addDays(ref, -(sentDaysAgo ?? 1) - 1), USER.admin), title, body, audience, property_id: p?.id ?? null,
      sent_at: sentDaysAgo === null ? null : ts(addDays(ref, -sentDaysAgo), 10), recipients: people.length,
    }
    db.announcements.push(a)
    if (sentDaysAgo === null) return
    for (const person of people) outbox(A, person, `Comunicado: ${title}`, body, 'announcement', 'announcements', a.id, addDays(ref, -sentDaysAgo))
    db.audit_logs.push({ id: rng.uuid(), organization_id: A, actor_user_id: USER.admin, entity: 'announcements', entity_id: a.id, action: 'create', summary: `Enviou o comunicado "${title}" para ${people.length} inquilinos`, changes: null, at: ts(addDays(ref, -sentDaysAgo), 10) })
    // A inquilina da demonstração (Daniela, Mount Juic) recebe o aviso no portal.
    const daniela = c.persons.daniela
    if (people.some((x) => x.id === daniela.id)) {
      db.notifications.push({ id: rng.uuid(), organization_id: A, user_id: USER.lessee, title: `Comunicado: ${title}`, body, link: '/portal', dedupe_key: `announcement:${a.id}:${daniela.id}`, channel: 'in_app', status: 'sent', attempts: 1, last_error: null, created_at: ts(addDays(ref, -sentDaysAgo), 10), read_at: null })
    }
  }
  announce('Condomínio Mount Juic', 'Manutenção do elevador do Bloco B', 'Na próxima terça, das 9h às 12h, o elevador do Bloco B fica parado para manutenção preventiva.', 'lessees', 3)
  announce(null, 'Novo canal de atendimento', 'Pedidos de manutenção agora podem ser abertos direto pelo portal, a qualquer hora.', 'everyone', 10)
  announce('Condomínio Luar', 'Assembleia de condomínio', 'Assembleia ordinária no dia 20, às 19h, no salão de festas. Pauta: orçamento de 2027.', 'owners', null)

  /* 14d. Regras de automação novas (e-mail e rotina de manutenção). */
  const rule = (orgId: Id, name: string, trigger: 'contract_ends_in_days' | 'maintenance_schedule_due' | 'request_opened', days: number, action: 'email' | 'create_task') =>
    db.automation_rules.push({ ...base(c, orgId, '2025-02-01'), name, trigger, days, action, enabled: true })
  rule(A, 'Contrato vence em 60 dias: e-mail ao inquilino e ao proprietário', 'contract_ends_in_days', 60, 'email')
  rule(A, 'Rotina de manutenção chegou: abrir o chamado e avisar por e-mail', 'maintenance_schedule_due', 1, 'create_task')
  rule(A, 'Pedido aberto: e-mail ao responsável', 'request_opened', 1, 'email')
  rule(ORG.landlord, 'Rotina de manutenção chegou: abrir o chamado', 'maintenance_schedule_due', 1, 'create_task')

  /* 14e. E-mails de renovação (contratos que vencem em até 60 dias) e de pedido aberto nos últimos 14 dias. */
  for (const k of db.contracts) {
    if (k.kind !== 'lease' || k.status !== 'active') continue
    const left = daysBetween(ref, k.end_date)
    if (left < 0 || left > 60) continue
    const lessee = db.contract_parties.find((x) => x.contract_id === k.id && x.role === 'lessee')
    const person = lessee && db.people.find((p) => p.id === lessee.person_id)
    if (person) outbox(k.organization_id, person, `Seu contrato ${k.code} vence em ${left} dias`, 'Vamos conversar sobre a renovação. Responda este e-mail ou fale com a administração pelo portal.', 'renewal', 'contracts', k.id, addDays(ref, -Math.min(left, 3)))
  }
  for (const r of db.maintenance_requests) {
    const opened = r.created_at.slice(0, 10)
    if (daysBetween(opened, ref) > 14) continue
    const who = db.profiles.find((p) => p.id === (r.assignee_user_id ?? adminOf(r.organization_id)))
    if (!who) continue
    db.email_outbox.push({
      id: rng.uuid(), organization_id: r.organization_id, to_email: who.email, to_name: who.full_name, subject: `Pedido aberto: ${r.code} · ${r.title}`,
      body: 'Um novo chamado foi aberto e está esperando a triagem.', reason: 'request_opened', entity: 'maintenance_requests', entity_id: r.id,
      status: 'simulated', dedupe_key: `request_opened:${r.id}:${who.id}`, created_at: ts(opened, 11),
    })
  }
  db.email_outbox.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}
