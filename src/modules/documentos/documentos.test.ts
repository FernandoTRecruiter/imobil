// Testes dos documentos anexados onde moram (07/11/2026): o "Pertence a" de cada lugar, o envio pendurado
// em contrato, unidade, imóvel ou pessoa, quem pode enviar e para onde vai o endereço antigo /documentos.
// Rodar: npx vitest run src/modules/documentos
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { AccessError, RuleError } from '@/data/api'
import { ORG, USER } from '@/data/seed'
import { getDb, resetForTest } from '@/data/store'
import { listPlaceDocuments } from '@/modules/imoveis/repo'
import { documentsHome } from './parts'
import { listAttachTargets, listDocuments, uploadDocument, type UploadInput } from './repo'

const TODAY = '2026-11-04'

function session(userId: string): Session {
  const s = buildSession(getDb(), userId)!
  s.today = TODAY
  return s
}

const upload = (target: string, over: Partial<UploadInput> = {}): UploadInput => ({ name: 'Laudo de teste.pdf', target, owner: true, lessee: false, size: 1024, mime: 'application/pdf', ...over })

beforeEach(() => {
  resetForTest(TODAY)
})

describe('"Pertence a" de cada lugar', () => {
  it('no imóvel: o próprio imóvel, os contratos dele e as unidades ativas dele; nada de outro imóvel', async () => {
    const db = getDb()
    const luar = db.properties.find((p) => p.name === 'Condomínio Luar')!
    const groups = await listAttachTargets(session(USER.admin), { propertyId: luar.id })
    expect(groups.map((g) => g.label)).toEqual(['Imóvel', 'Contratos', 'Unidades'])
    expect(groups[0].options).toEqual([{ value: `property:${luar.id}`, label: 'Imóvel Condomínio Luar' }])
    const ids = groups.flatMap((g) => g.options.map((o) => o.value.split(':')))
    for (const [kind, id] of ids) {
      if (kind === 'contract') expect(db.contracts.find((k) => k.id === id)?.property_id).toBe(luar.id)
      if (kind === 'unit') expect(db.units.find((u) => u.id === id)).toMatchObject({ property_id: luar.id, deleted_at: null })
    }
  })

  it('na unidade: ela e os contratos dela', async () => {
    const db = getDb()
    const b203 = db.units.find((u) => u.code === 'B-203')!
    const groups = await listAttachTargets(session(USER.admin), { unitId: b203.id })
    expect(groups[0].options).toEqual([{ value: `unit:${b203.id}`, label: 'Unidade B-203' }])
    expect(groups[1].options.length).toBe(db.contracts.filter((k) => k.unit_id === b203.id).length)
  })

  it('imóvel de outra conta é recusado (o Le Plaza é da proprietária independente)', async () => {
    const plaza = getDb().properties.find((p) => p.organization_id === ORG.landlord)!
    await expect(listAttachTargets(session(USER.admin), { propertyId: plaza.id })).rejects.toBeInstanceOf(AccessError)
  })
})

describe('anexar', () => {
  it('pendurado num contrato aparece na aba "Documentos e histórico" do imóvel dele', async () => {
    const db = getDb()
    const s = session(USER.admin)
    const k = db.contracts.find((x) => x.organization_id === ORG.agency && x.kind === 'lease' && x.status === 'active')!
    const doc = await uploadDocument(s, upload(`contract:${k.id}`, { name: 'Aditivo assinado.pdf', lessee: true }))
    expect(doc).toMatchObject({ contract_id: k.id, unit_id: null, property_id: null, person_id: null, visible_to_lessee: true })
    const place = await listPlaceDocuments(s, { propertyId: k.property_id }, { search: 'Aditivo assinado' })
    expect(place.rows.map((r) => r.id)).toEqual([doc.id])
  })

  it('pendurado no imóvel e numa pessoa: cada um grava o vínculo certo', async () => {
    const db = getDb()
    const s = session(USER.admin)
    const luar = db.properties.find((p) => p.name === 'Condomínio Luar')!
    const person = db.people.find((p) => p.organization_id === ORG.agency && !p.deleted_at)!
    expect(await uploadDocument(s, upload(`property:${luar.id}`))).toMatchObject({ property_id: luar.id, contract_id: null, unit_id: null })
    expect(await uploadDocument(s, upload(`person:${person.id}`))).toMatchObject({ person_id: person.id, property_id: null })
  })

  it('o portal não envia; registro de outra conta e vínculo desconhecido são recusados', async () => {
    const db = getDb()
    const k = db.contracts.find((x) => x.organization_id === ORG.agency && x.kind === 'lease')!
    await expect(uploadDocument(session(USER.owner), upload(`contract:${k.id}`))).rejects.toBeInstanceOf(AccessError)
    await expect(uploadDocument(session(USER.lessee), upload(`contract:${k.id}`))).rejects.toBeInstanceOf(AccessError)
    const plaza = db.properties.find((p) => p.organization_id === ORG.landlord)!
    await expect(uploadDocument(session(USER.admin), upload(`property:${plaza.id}`))).rejects.toBeInstanceOf(RuleError)
    await expect(uploadDocument(session(USER.admin), upload(`maintenance:${k.id}`))).rejects.toThrow(/Escolha a que o documento pertence/)
  })

  it('o que o inquilino vê segue a marcação "quem vê"', async () => {
    const db = getDb()
    const daniela = session(USER.lessee)
    const mine = db.contract_parties.find((cp) => cp.person_id === daniela.personId && cp.role === 'lessee')!
    const admin = session(USER.admin)
    await uploadDocument(admin, upload(`contract:${mine.contract_id}`, { name: 'Só para a equipe.pdf', owner: false, lessee: false }))
    await uploadDocument(admin, upload(`contract:${mine.contract_id}`, { name: 'Para a inquilina.pdf', owner: false, lessee: true }))
    const names = (await listDocuments(daniela, { pageSize: 500 })).rows.map((r) => r.name)
    expect(names).toContain('Para a inquilina.pdf')
    expect(names).not.toContain('Só para a equipe.pdf')
  })
})

describe('endereço antigo /documentos', () => {
  it('equipe vai para Imóveis; proprietário e inquilino, para "Meus contratos"; prestador não tem documentos', () => {
    expect(documentsHome(session(USER.admin))).toBe('/imoveis')
    expect(documentsHome(session(USER.staff))).toBe('/imoveis')
    expect(documentsHome(session(USER.owner))).toBe('/contratos')
    expect(documentsHome(session(USER.lessee))).toBe('/contratos')
    expect(documentsHome(session(USER.vendor))).toBeNull()
  })
})
