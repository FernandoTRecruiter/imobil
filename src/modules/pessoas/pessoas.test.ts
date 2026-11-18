// Testes do módulo Pessoas: documento único, CNPJ com letras, arquivar, escopo, a linha aberta da pessoa em
// "Contratos e pessoas" (contratos com o papel dela, unidades, vagas, documentos) e a regra das abas de baixo.
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { AccessError } from '@/data/api'
import { ORG, USER } from '@/data/seed'
import { getDb, resetForTest } from '@/data/store'
import { listPeople } from '@/data/views/contracts'
import { cnpjFromBase, formatDocument } from '@/lib/documents'
import { archivePerson, createPerson, getPersonLinks, listPeopleForScreen, personSchema, updatePerson, type PersonInput } from './repo'
import { personTabs, pickPersonTab } from './PersonSelected'

const TODAY = '2026-11-04'

function session(userId: string): Session {
  const s = buildSession(getDb(), userId)!
  s.today = TODAY
  return s
}

function input(over: Partial<PersonInput> = {}): PersonInput {
  return { kind: 'PF', name: 'Teste da Silva', document: '529.982.247-25', email: 'teste@example.com', phone: '(31) 99999-0000', tags: [], vendor_categories: [], notes: '', ...over }
}

beforeEach(() => {
  resetForTest(TODAY)
})

describe('cadastro de pessoa', () => {
  it('documento repetido na mesma organização é recusado com o nome de quem já tem', async () => {
    const s = session(USER.admin)
    const existing = getDb().people.find((p) => p.organization_id === ORG.agency && p.kind === 'PF')!
    await expect(createPerson(s, input({ document: formatDocument(existing.document) }))).rejects.toThrow(`Já existe ${existing.name} com este CPF`)
  })

  it('o mesmo CPF em OUTRA organização é aceito (cada conta tem o próprio cadastro)', async () => {
    const marina = getDb().people.find((p) => p.organization_id === ORG.landlord && p.kind === 'PF')!
    const row = await createPerson(session(USER.admin), input({ document: marina.document, name: 'Homônima em outra conta' }))
    expect(row.organization_id).toBe(ORG.agency)
  })

  it('aceita CNPJ alfanumérico válido e guarda sem pontuação', async () => {
    const cnpj = cnpjFromBase('12ABC34501DE')
    const row = await createPerson(session(USER.admin), input({ kind: 'PJ', name: 'Empresa Nova Ltda', document: formatDocument(cnpj) }))
    expect(row.document).toBe(cnpj)
  })

  it('erro de formulário diz causa e conserto (CPF curto, PF com CNPJ)', () => {
    const short = personSchema.safeParse(input({ document: '123.456.789-0' }))
    expect(short.success).toBe(false)
    expect(short.error?.issues[0].message).toMatch(/10 caracteres: CPF tem 11/)
    const mixed = personSchema.safeParse(input({ kind: 'PF', document: cnpjFromBase('112223330001') }))
    expect(mixed.error?.issues[0].message).toMatch(/Pessoa física usa CPF/)
  })

  it('editar mantendo o próprio documento passa; trocar para o de outra pessoa é recusado', async () => {
    const s = session(USER.admin)
    const row = await createPerson(s, input())
    await expect(updatePerson(s, { ...input({ name: 'Teste Renomeado' }), id: row.id })).resolves.toMatchObject({ name: 'Teste Renomeado' })
    const other = getDb().people.find((p) => p.organization_id === ORG.agency && p.kind === 'PF' && p.id !== row.id)!
    await expect(updatePerson(s, { ...input({ document: other.document }), id: row.id })).rejects.toThrow(/Já existe/)
  })

  it('quem só vê pessoas não cadastra', async () => {
    await expect(createPerson(session(USER.staff), input())).rejects.toBeInstanceOf(AccessError)
  })
})

describe('arquivar pessoa', () => {
  it('recusa com contrato vigente; sem vínculo arquiva e restaura', async () => {
    const s = session(USER.admin)
    const db = getDb()
    const lesseeParty = db.contract_parties.find((cp) => cp.role === 'lessee' && db.contracts.some((k) => k.id === cp.contract_id && k.status === 'active' && k.organization_id === ORG.agency))!
    await expect(archivePerson(s, { id: lesseeParty.person_id })).rejects.toThrow(/contrato vigente/)
    const fresh = await createPerson(s, input())
    expect((await archivePerson(s, { id: fresh.id })).deleted_at).not.toBeNull()
    const visible = await listPeople(s, { search: 'Teste da Silva' })
    expect(visible.total).toBe(0) // arquivada some da lista
    expect((await archivePerson(s, { id: fresh.id, restore: true })).deleted_at).toBeNull()
  })
})

describe('linha aberta da pessoa (contratos por pessoa)', () => {
  it('Carlos: dono de A-301, A-302, B-504 e da Casa 07 (50%); locador em contratos, cada um com o papel dele', async () => {
    const s = session(USER.admin)
    const carlos = getDb().people.find((p) => p.user_id === USER.owner)!
    const d = await getPersonLinks(s, carlos.id)
    expect(d.units.map((u) => u.code).sort()).toEqual(['A-301', 'A-302', 'B-504', 'Casa 07'])
    expect(d.units.find((u) => u.code === 'Casa 07')?.share_pct).toBe(50)
    expect(d.contracts.length).toBeGreaterThan(0)
    // Cada contrato da lista tem a pessoa como parte, com o papel que o banco tem para ela.
    for (const k of d.contracts) {
      const roles = getDb().contract_parties.filter((cp) => cp.contract_id === k.id && cp.person_id === carlos.id).map((cp) => cp.role)
      expect(k.roles.sort()).toEqual(roles.sort())
    }
    expect(d.contracts.some((k) => k.roles.includes('lessor'))).toBe(true)
    // O mais novo primeiro.
    expect(d.contracts.every((k, i, all) => i === 0 || all[i - 1].start_date >= k.start_date)).toBe(true)
  })

  it('Daniela: locatária da B-203 e da vaga E-014; a vaga aparece em "Vagas que aluga", não em unidades', async () => {
    const s = session(USER.admin)
    const daniela = getDb().people.find((p) => p.user_id === USER.lessee)!
    const d = await getPersonLinks(s, daniela.id)
    const codes = d.contracts.filter((k) => k.status === 'active').map((k) => k.unit_label ?? '')
    expect(codes.some((c) => c.includes('B-203'))).toBe(true)
    expect(codes.some((c) => c.includes('E-014'))).toBe(true)
    expect(d.contracts.filter((k) => k.status === 'active').every((k) => k.roles.includes('lessee'))).toBe(true)
    expect(d.spots.map((v) => v.code)).toEqual(['E-014'])
    expect(d.units).toEqual([])
  })

  it('documentos da pessoa: só os pendurados nela (extrato de repasse), e o portal só vê o que foi liberado', async () => {
    const db = getDb()
    const carlos = db.people.find((p) => p.user_id === USER.owner)!
    const team = await getPersonLinks(session(USER.admin), carlos.id)
    expect(team.documents.length).toBeGreaterThan(0)
    expect(team.documents.every((doc) => doc.person_id === carlos.id)).toBe(true)
    // O próprio Carlos (portal) vê os extratos dele, que estão marcados para o proprietário.
    const own = await getPersonLinks(session(USER.owner), carlos.id)
    expect(own.documents.every((doc) => doc.visible_to_owner)).toBe(true)
  })

  it('o proprietário não abre a linha de quem não está nos contratos dele', async () => {
    const owner = session(USER.owner)
    const stranger = getDb().people.find((p) => p.organization_id === ORG.agency && p.tags.includes('syndic'))!
    await expect(getPersonLinks(owner, stranger.id)).rejects.toBeInstanceOf(AccessError)
  })

  it('"Contratos vigentes" da lista conta cada contrato vigente uma vez, em qualquer papel', async () => {
    const s = session(USER.admin)
    const db = getDb()
    const carlos = db.people.find((p) => p.user_id === USER.owner)!
    const page = await listPeopleForScreen(s, { search: carlos.name })
    const row = page.rows.find((r) => r.id === carlos.id)!
    const expected = new Set(db.contract_parties.filter((cp) => cp.person_id === carlos.id && db.contracts.some((k) => k.id === cp.contract_id && k.status === 'active')).map((cp) => cp.contract_id)).size
    expect(row.active_contracts).toBe(expected)
    expect(expected).toBeGreaterThan(0)
  })
})

describe('abas de baixo da pessoa escolhida', () => {
  const all = { finance: true, requests: false, history: true }
  const view = (tabs: ReturnType<typeof personTabs>) => tabs.map((t) => [t.value, t.label, t.count, t.sections.join('+')])

  it('quem não presta serviço: Financeiro (com o número) e Histórico', () => {
    expect(view(personTabs({ entries: 30, requests: 0 }, all))).toEqual([
      ['financeiro', 'Financeiro', 30, 'financeiro'],
      ['historico', 'Histórico', undefined, ''],
    ])
  })

  it('prestadora: chamados embaixo do financeiro, sem número (lançamento + chamado não se somam)', () => {
    const tabs = personTabs({ entries: 5, requests: 7 }, { ...all, requests: true })
    expect(view(tabs)[0]).toEqual(['financeiro', 'Financeiro e chamados', undefined, 'financeiro+chamados'])
  })

  it('sem permissão de financeiro, a prestadora vê só "Chamados"; sem nada, não há abas', () => {
    const only = personTabs({ entries: 5, requests: 7 }, { finance: false, requests: true, history: false })
    expect(view(only)).toEqual([['financeiro', 'Chamados', 7, 'chamados']])
    expect(personTabs({ entries: 5, requests: 0 }, { finance: false, requests: false, history: false })).toEqual([])
  })

  it('aba pedida no endereço abre se existe; valor estranho cai na primeira; sem abas, nenhuma', () => {
    const tabs = personTabs({ entries: 24, requests: 3 }, { ...all, requests: true })
    expect(pickPersonTab(tabs, 'historico')).toBe('historico')
    expect(pickPersonTab(tabs, 'qualquer')).toBe('financeiro')
    expect(pickPersonTab(tabs, undefined)).toBe('financeiro')
    expect(pickPersonTab([], 'financeiro')).toBeUndefined()
  })

  it('sem contagem (erro ao contar): as seções aparecem e abre no Financeiro', () => {
    const tabs = personTabs(undefined, { ...all, requests: true })
    expect(tabs[0].sections).toEqual(['financeiro', 'chamados'])
    expect(pickPersonTab(tabs, undefined)).toBe('financeiro')
  })
})
