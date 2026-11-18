// Testes da comunicação: comunicado que chega a quem deve, uma vez só, e a caixa de saída só da equipe.
// Rodar: npx vitest run src/modules/comunicacao
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { AccessError, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { ORG, USER } from '@/data/seed'
import { resetForTest } from '@/data/store'
import { listAnnouncements, listOutbox, previewRecipients, recipientsOf, saveAnnouncement, sendAnnouncement } from './repo'
import { queueEmail } from './outbox'

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
const property = (name: string) => db.properties.find((p) => p.name === name)!
const daniela = () => db.memberships.find((m) => m.user_id === USER.lessee)!.person_id!

describe('enviar comunicado', () => {
  it('ao prédio: um e-mail por pessoa e aviso no portal para quem tem acesso (a Daniela recebe), sem duplicar', async () => {
    const admin = session(USER.admin)
    const condo = property('Condomínio Mount Juic')
    const emails = db.email_outbox.length
    const notes = db.notifications.length
    const r = await saveAnnouncement(admin, { id: '', title: 'Falta de água na quinta', body: 'A concessionária corta a água das 8h às 14h.', audience: 'lessees', property_id: condo.id, send: true })

    expect(r.people).toBe(recipientsOf(db, ORG.agency, TODAY, 'lessees', condo.id).length)
    expect(r.people).toBeGreaterThan(1)
    expect(r.emails).toBe(r.people - r.missing)
    expect(db.email_outbox.length - emails).toBe(r.emails)
    expect(db.email_outbox.filter((e) => e.entity === 'announcements' && e.entity_id === r.announcement.id).every((e) => e.status === 'simulated' && e.reason === 'announcement')).toBe(true)
    // A Daniela (B-203, com portal) é a única inquilina do prédio com login: um aviso, com a chave da pessoa.
    expect(r.notices).toBe(1)
    expect(db.notifications.filter((n) => n.user_id === USER.lessee && n.dedupe_key === `announcement:${r.announcement.id}:${daniela()}`)).toHaveLength(1)
    expect(db.notifications.length - notes).toBe(1)
    expect(r.announcement.sent_at).not.toBeNull()
    expect(r.announcement.recipients).toBe(r.people)

    // Enviar de novo: recusado, e nada novo na caixa de saída nem no sino.
    await expect(sendAnnouncement(admin, { id: r.announcement.id })).rejects.toBeInstanceOf(RuleError)
    await expect(saveAnnouncement(admin, { id: r.announcement.id, title: 'Outro título', body: 'Texto qualquer do comunicado.', audience: 'lessees', property_id: condo.id, send: false })).rejects.toBeInstanceOf(RuleError)
    expect(db.email_outbox.length - emails).toBe(r.emails)
    expect(db.notifications.length - notes).toBe(1)

    // Histórico: a criação e o envio, com entity/entity_id do comunicado.
    const logs = db.audit_logs.filter((a) => a.entity === 'announcements' && a.entity_id === r.announcement.id)
    expect(logs.map((l) => l.action).sort()).toEqual(['create', 'status'])
  })

  it('rascunho não manda nada; enviar o rascunho da assembleia manda aos proprietários do condomínio', async () => {
    const admin = session(USER.admin)
    const draft = db.announcements.find((a) => a.title === 'Assembleia de condomínio')!
    expect(draft.sent_at).toBeNull()
    const preview = await previewRecipients(admin, { audience: 'owners', property_id: draft.property_id! })
    const emails = db.email_outbox.length
    const r = await sendAnnouncement(admin, { id: draft.id })
    expect(r.people).toBe(preview.total)
    expect(db.email_outbox.length - emails).toBe(preview.withEmail)
    // A segunda chamada da entrega (mesma chave) não grava: a fila é idempotente por si só.
    const again = db.email_outbox.find((e) => e.entity_id === draft.id)!
    expect(queueEmail(admin, { ...again })).toBe('skipped')
  })

  it('sem ninguém no recorte, recusa ANTES de gravar (não fica rascunho a mais)', async () => {
    const admin = session(USER.admin)
    const leased = new Set(db.contracts.filter((k) => k.kind === 'lease' && k.status === 'active').map((k) => k.property_id))
    const empty = db.properties.find((p) => p.organization_id === ORG.agency && !leased.has(p.id))
    if (!empty) return // os dados fictícios mudaram e todo imóvel tem inquilino: o caso não existe
    const count = db.announcements.length
    await expect(saveAnnouncement(admin, { id: '', title: 'Aviso sem ninguém', body: 'Ninguém deveria receber isto.', audience: 'lessees', property_id: empty.id, send: true })).rejects.toBeInstanceOf(RuleError)
    expect(db.announcements.length).toBe(count)
  })

  it('quem só vê processos vê a lista mas não escreve; o portal não vê a lista da equipe', async () => {
    const staff = session(USER.staff) // financeiro: workflows:view, sem workflows:edit
    expect((await listAnnouncements(staff, {})).totalAll).toBe(3)
    await expect(saveAnnouncement(staff, { id: '', title: 'Teste de permissão', body: 'Não deveria gravar.', audience: 'everyone', property_id: '', send: false })).rejects.toBeInstanceOf(AccessError)
    expect((await listAnnouncements(session(USER.lessee), {})).totalAll).toBe(0)
  })
})

describe('vaga de garagem não faz de ninguém morador', () => {
  it('quem só aluga vaga não recebe comunicado aos inquilinos; o condomínio dono das vagas não recebe o dos proprietários', () => {
    const condo = property('Condomínio Mount Juic')
    const spots = new Set(db.units.filter((u) => u.property_id === condo.id && u.kind === 'parking').map((u) => u.id))
    // Locatários de casa ou apartamento do prédio (o recorte certo) e locatários SÓ de vaga (os que não devem receber).
    const homeLessees = new Set<string>()
    const spotLessees = new Set<string>()
    for (const k of db.contracts) {
      if (k.property_id !== condo.id || k.kind !== 'lease' || k.status !== 'active' || k.start_date > TODAY) continue
      const parties = db.contract_parties.filter((p) => p.contract_id === k.id && p.role === 'lessee').map((p) => p.person_id)
      for (const id of parties) (k.unit_id && spots.has(k.unit_id) ? spotLessees : homeLessees).add(id)
    }
    const onlySpot = [...spotLessees].filter((id) => !homeLessees.has(id))
    expect(onlySpot.length).toBeGreaterThan(0) // os dados têm gente de fora alugando vaga
    const lessees = recipientsOf(db, ORG.agency, TODAY, 'lessees', condo.id).map((r) => r.person_id)
    expect(onlySpot.some((id) => lessees.includes(id))).toBe(false)
    expect(lessees.every((id) => homeLessees.has(id))).toBe(true)
    const owners = recipientsOf(db, ORG.agency, TODAY, 'owners', condo.id).map((r) => r.name)
    expect(owners).not.toContain('Condomínio Mount Juic')
  })
})

describe('caixa de saída', () => {
  it('só a equipe lê; o filtro por motivo conta o que aparece', async () => {
    const admin = session(USER.admin)
    const all = await listOutbox(admin, {})
    expect(all.totalAll).toBe(db.email_outbox.filter((e) => e.organization_id === ORG.agency).length)
    const renewal = await listOutbox(admin, { filters: { motivo: ['renewal'] }, pageSize: 1000 })
    expect(renewal.rows.every((e) => e.reason === 'renewal' && e.ref.kind === 'contract')).toBe(true)
    expect(all.facets.motivo.renewal).toBe(renewal.total)
    expect((await listOutbox(session(USER.lessee), {})).totalAll).toBe(0)
    expect((await listOutbox(session(USER.owner), {})).totalAll).toBe(0)
  })
})
