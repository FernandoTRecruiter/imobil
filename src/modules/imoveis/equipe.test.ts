// Testes da equipe do prédio, das rotinas da ficha e da linha do tempo única do imóvel.
// Banco fictício de 04/11/2026 (resetForTest), "hoje" fixo na sessão. O que se cobra aqui é o que
// vira RLS na fase 2: quem vê, quem grava, e que a junção das fontes não vaza nem repete linha.
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { AccessError, RuleError } from '@/data/api'
import { ORG, USER } from '@/data/seed'
import { getDb, resetForTest } from '@/data/store'
import { scopeFor } from '@/data/scope'
import { addPropertyStaff, listPropertyStaff, setPropertyStaffActive, updatePropertyStaff } from './equipe'
import { getPropertySheet } from './ficha'
import { createProperty, setPropertyOwners } from './repo'
import type { NewPropertyInput } from './schemas'
import { propertyTimeline } from './timeline'

const TODAY = '2026-11-04'

function session(userId: string): Session {
  const s = buildSession(getDb(), userId)!
  s.today = TODAY
  return s
}

const prop = (name: string) => getDb().properties.find((p) => p.name === name)!
// O condomínio onde o Carlos (proprietário convidado) tem apartamentos e um imóvel em que ele não tem nada.
const MOUNT_JUIC = 'Condomínio Mount Juic'
const LYNX = 'Lynx Residence'

beforeEach(() => {
  resetForTest(TODAY)
})

describe('equipe do prédio: leitura e escopo', () => {
  it('a equipe da conta vê síndico, zelador e porteiro do Mount Juic, nessa ordem, com telefone', async () => {
    const rows = await listPropertyStaff(session(USER.admin), prop(MOUNT_JUIC).id)
    expect(rows.map((r) => r.role)).toEqual(['syndic', 'caretaker', 'doorman'])
    expect(rows.every((r) => r.active && r.phone.length >= 10)).toBe(true)
  })

  it('o proprietário vê a equipe do prédio dele (sem e-mail) e não abre a de imóvel alheio', async () => {
    const owner = session(USER.owner)
    const rows = await listPropertyStaff(owner, prop(MOUNT_JUIC).id)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.email === '')).toBe(true)
    await expect(listPropertyStaff(owner, prop(LYNX).id)).rejects.toBeInstanceOf(AccessError)
  })

  it('o prestador vê o imóvel do chamado dele, mas não a equipe do prédio', async () => {
    const vendor = session(USER.vendor)
    const sc = scopeFor(getDb(), vendor)
    // Um imóvel que o prestador enxerga (pela unidade do chamado) e que tem equipe cadastrada.
    const staffed = new Set(getDb().property_staff.map((r) => r.property_id))
    const pid = [...sc.propertyIds].find((id) => staffed.has(id))!
    expect(pid).toBeTruthy()
    await expect(listPropertyStaff(vendor, pid)).resolves.toEqual([])
  })
})

describe('equipe do prédio: gravação', () => {
  it('cadastro rápido cria a pessoa sem CPF (com foto e papel) e a ligação, cada uma na auditoria', async () => {
    const s = session(USER.admin)
    const p = prop(LYNX)
    const row = await addPropertyStaff(s, {
      property_id: p.id, role: 'doorman', note: 'Noite, ramal 3', person_id: null,
      new_person: { name: 'Porteiro Novo da Silva', phone: '(31) 99999-0000', photo: 'data:image/webp;base64,AAAA' },
    })
    const db = getDb()
    const person = db.people.find((x) => x.id === row.person_id)!
    expect(person).toMatchObject({ name: 'Porteiro Novo da Silva', document: '', phone: '31999990000', tags: ['contact'], photo: 'data:image/webp;base64,AAAA' })
    expect(db.audit_logs.some((l) => l.entity === 'people' && l.entity_id === person.id && l.action === 'create')).toBe(true)
    expect(db.audit_logs.some((l) => l.entity === 'property_staff' && l.entity_id === row.id && l.action === 'create')).toBe(true)
  })

  it('a mesma pessoa no mesmo papel não entra duas vezes; desativar guarda o diff e "Desfazer" devolve', async () => {
    const s = session(USER.admin)
    const p = prop(MOUNT_JUIC)
    const caretaker = (await listPropertyStaff(s, p.id)).find((r) => r.role === 'caretaker')!
    await expect(addPropertyStaff(s, { property_id: p.id, role: 'caretaker', note: '', person_id: caretaker.person_id, new_person: null })).rejects.toThrow(/já está como zelador/)
    const off = await setPropertyStaffActive(s, { id: caretaker.id, active: false })
    expect(off.active).toBe(false)
    const log = getDb().audit_logs.find((l) => l.entity === 'property_staff' && l.entity_id === caretaker.id && l.action === 'archive')!
    expect(log.changes).toEqual({ active: { from: true, to: false } })
    expect((await setPropertyStaffActive(s, { id: caretaker.id, active: true })).active).toBe(true)
    // Desativada, a mesma pessoa adicionada de novo no mesmo papel volta pela linha antiga (histórico numa linha só).
    await setPropertyStaffActive(s, { id: caretaker.id, active: false })
    const back = await addPropertyStaff(s, { property_id: p.id, role: 'caretaker', note: 'Turno novo', person_id: caretaker.person_id, new_person: null })
    expect(back.id).toBe(caretaker.id)
    expect(back.note).toBe('Turno novo')
  })

  it('editar papel grava o "de X para Y"; nada mudou não polui a auditoria', async () => {
    const s = session(USER.admin)
    const doorman = (await listPropertyStaff(s, prop(MOUNT_JUIC).id)).find((r) => r.role === 'doorman')!
    const before = getDb().audit_logs.length
    await updatePropertyStaff(s, { id: doorman.id, role: 'doorman', note: doorman.note })
    expect(getDb().audit_logs.length).toBe(before)
    await updatePropertyStaff(s, { id: doorman.id, role: 'security', note: 'Portaria 24 h' })
    const log = getDb().audit_logs.find((l) => l.entity_id === doorman.id && l.action === 'update')!
    expect(log.changes?.role).toEqual({ from: 'doorman', to: 'security' })
  })

  it('quem não edita imóveis não grava; cadastro rápido pede também "editar pessoas"', async () => {
    const p = prop(MOUNT_JUIC)
    const quick = { property_id: p.id, role: 'other' as const, note: '', person_id: null, new_person: { name: 'Fulano de Tal', phone: '', photo: null } }
    await expect(addPropertyStaff(session(USER.staff), quick)).rejects.toBeInstanceOf(AccessError) // colaborador do financeiro
    await expect(addPropertyStaff(session(USER.owner), quick)).rejects.toBeInstanceOf(AccessError) // proprietário convidado
    const leasing = session(USER.leasing)
    leasing.permissions.delete('people:edit')
    await expect(addPropertyStaff(leasing, quick)).rejects.toThrow(/alterar o cadastro de pessoas/)
  })

  it('pessoa de outra conta é recusada e o dono não vira dono sem CPF', async () => {
    const s = session(USER.admin)
    const marina = getDb().people.find((x) => x.organization_id === ORG.landlord)!
    await expect(addPropertyStaff(s, { property_id: prop(MOUNT_JUIC).id, role: 'other', note: '', person_id: marina.id, new_person: null })).rejects.toBeInstanceOf(RuleError)
    // A pessoa do cadastro rápido (sem CPF) não vira proprietária até completar o documento.
    const vila = prop('Condomínio Luar')
    const row = await addPropertyStaff(s, { property_id: vila.id, role: 'caretaker', note: '', person_id: null, new_person: { name: 'Zelador Sem Documento', phone: '', photo: null } })
    await expect(setPropertyOwners(s, { property_id: vila.id, owners: [{ person_id: row.person_id, name: 'Zelador Sem Documento', share_pct: 100 }] })).rejects.toThrow(/sem CPF ou CNPJ/)
  })
})

describe('cadastro de imóvel com a equipe do prédio', () => {
  const input = (staff: NewPropertyInput['staff']): NewPropertyInput => {
    const owner = getDb().people.find((x) => x.organization_id === ORG.agency && !x.deleted_at && !x.user_id && x.document)!
    return {
      kind: 'building', name: 'Edifício Teste da Equipe',
      address: { cep: '30140-071', street: 'Rua das Flores', number: '10', complement: '', district: 'Savassi', city: 'Belo Horizonte', state: 'MG' },
      portfolio_id: '', manager_user_id: '', notes: '',
      structure: { template: 'tower', code: '', blocks: 1, floors: 2, unitsPerFloor: 2, startNumber: 101, unit: { kind: 'apartment', area_m2: 60, bedrooms: 2, bathrooms: 1, parking_spots: 1, asking_rent: '' } },
      owners: [{ person_id: owner.id, name: owner.name, share_pct: 100 }],
      staff,
    }
  }

  it('cria as pessoas e as ligações junto com o imóvel', async () => {
    const s = session(USER.admin)
    const { property } = await createProperty(s, input([
      { role: 'caretaker', name: 'Zelador do Teste', phone: '31988887777', note: 'Seg a sex', photo: null },
      { role: 'syndic', name: 'Síndica do Teste', phone: '', note: '', photo: null },
    ]))
    const rows = await listPropertyStaff(s, property.id)
    expect(rows.map((r) => [r.role, r.name])).toEqual([['syndic', 'Síndica do Teste'], ['caretaker', 'Zelador do Teste']])
  })

  it('sem "editar pessoas" o imóvel com equipe nem nasce (nada gravado pela metade)', async () => {
    const leasing = session(USER.leasing)
    leasing.permissions.delete('people:edit')
    const before = getDb().properties.length
    await expect(createProperty(leasing, input([{ role: 'caretaker', name: 'Zelador X', phone: '', note: '', photo: null }]))).rejects.toBeInstanceOf(AccessError)
    expect(getDb().properties.length).toBe(before)
    await expect(createProperty(leasing, input([]))).resolves.toMatchObject({ units: 4 })
  })
})

describe('rotinas de manutenção da ficha do imóvel', () => {
  it('traz as rotinas do imóvel pedido, com a próxima data', async () => {
    const sheet = await getPropertySheet(session(USER.admin), prop(MOUNT_JUIC).id)
    expect(sheet.property.id).toBe(prop(MOUNT_JUIC).id)
    expect(sheet.schedules.map((r) => r.title)).toEqual(["Limpeza da caixa d'água"])
    expect(sheet.schedules[0].next_date > TODAY).toBe(true)
  })

  it('a rotina vencida aparece como atrasada', async () => {
    const sheet = await getPropertySheet(session(USER.admin), prop('Condomínio Luar').id)
    expect(sheet.schedules[0]).toMatchObject({ late: true })
  })

  it('o proprietário vê as rotinas do imóvel dele, sem nome de prestador, e não abre o de outro', async () => {
    const sheet = await getPropertySheet(session(USER.owner), prop(MOUNT_JUIC).id)
    expect(sheet.schedules.length).toBeGreaterThan(0)
    expect(sheet.schedules.every((r) => r.vendor_name === null)).toBe(true)
    await expect(getPropertySheet(session(USER.owner), prop(LYNX).id)).rejects.toBeInstanceOf(AccessError)
  })
})

describe('linha do tempo única do imóvel', () => {
  it('junta as cinco fontes para a equipe da conta, do mais novo para o mais velho', async () => {
    const s = session(USER.admin)
    const p = prop(MOUNT_JUIC)
    await addPropertyStaff(s, { property_id: p.id, role: 'cleaning', note: '', person_id: null, new_person: { name: 'Limpeza Teste', phone: '', photo: null } })
    const t = await propertyTimeline(s, p.id, { limit: 10_000 })
    expect(t.counts.cadastro).toBeGreaterThan(0)
    expect(t.counts.contrato).toBeGreaterThan(0)
    expect(t.counts.comunicado).toBeGreaterThan(0)
    expect(t.counts.email).toBeGreaterThan(0)
    expect(t.items[0].title).toMatch(/Adicionou Limpeza Teste como limpeza/)
    const keys = t.items.map((it) => (it.dateOnly ? Date.UTC(+it.at.slice(0, 4), +it.at.slice(5, 7) - 1, +it.at.slice(8, 10), 15) : new Date(it.at).getTime()))
    expect(keys.every((k, i) => i === 0 || keys[i - 1] >= k)).toBe(true)
  })

  it('o comunicado para N inquilinos vira UMA linha de e-mail, e o "create" da auditoria não repete o envio', async () => {
    const s = session(USER.admin)
    const p = prop(MOUNT_JUIC)
    const t = await propertyTimeline(s, p.id, { kind: 'email', limit: 10_000 })
    const announcementEmails = t.items.filter((it) => /Comunicado/.test(it.title))
    expect(announcementEmails).toHaveLength(1)
    const sent = getDb().email_outbox.filter((m) => m.reason === 'announcement' && getDb().announcements.some((a) => a.id === m.entity_id && a.property_id === p.id))
    expect(sent.length).toBeGreaterThan(1)
    const all = await propertyTimeline(s, p.id, { kind: 'comunicado', limit: 10_000 })
    expect(all.items.filter((it) => /Manutenção do elevador/.test(it.title))).toHaveLength(1)
  })

  it('filtro e contagem concordam, e o corte respeita o limite', async () => {
    const s = session(USER.admin)
    const p = prop(MOUNT_JUIC)
    const t = await propertyTimeline(s, p.id, { kind: 'contrato', limit: 5 })
    expect(t.items).toHaveLength(5)
    expect(t.total).toBe(t.counts.contrato)
    expect(t.items.every((it) => it.kind === 'contrato')).toBe(true)
  })

  it('o proprietário vê só o que é dele: sem auditoria, sem e-mail, só contratos das unidades dele', async () => {
    const owner = session(USER.owner)
    const p = prop(MOUNT_JUIC)
    const t = await propertyTimeline(owner, p.id, { limit: 10_000 })
    expect(t.counts.cadastro).toBe(0)
    expect(t.counts.email).toBe(0)
    expect(t.items.every((it) => it.who === null)).toBe(true)
    const sc = scopeFor(getDb(), owner)
    const mine = new Set(getDb().contracts.filter((k) => sc.contractIds.has(k.id)).map((k) => k.code))
    const codes = t.items.filter((it) => it.kind === 'contrato').map((it) => /Contrato (\S+)/.exec(it.title)![1].replace(/:$/, ''))
    expect(codes.length).toBeGreaterThan(0)
    expect(codes.every((c) => mine.has(c))).toBe(true)
    // Comunicado só para inquilinos não aparece para o dono.
    expect(t.items.some((it) => /Manutenção do elevador/.test(it.title))).toBe(false)
    await expect(propertyTimeline(owner, prop(LYNX).id)).rejects.toBeInstanceOf(AccessError)
  })
})
