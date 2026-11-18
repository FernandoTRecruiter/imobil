// Testes do módulo Imóveis: as regras que a tela promete e que o banco vai cobrar na fase 2.
// Cada teste parte do banco fictício de 04/11/2026 (resetForTest), com o "hoje" fixo na sessão.
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSession, type Session } from '@/auth/session'
import { AccessError, RuleError } from '@/data/api'
import { ORG, USER } from '@/data/seed'
import { getDb, resetForTest } from '@/data/store'
import { leaseCovers } from '@/data/rules'
import { getUnit, listProperties } from '@/data/views/units'
import { archiveProperty, archiveUnit, createProperty, setPropertyOwners, updateUnit } from './repo'
import type { NewPropertyInput } from './schemas'
import { codeRanges, planStructure, structureProblem } from './structure'
import { PROPERTY_OLD_TABS } from './PropertyPage'
import { OLD_SEARCH_KEYS, parseImoveisSearch } from './PropertiesPage'
import { resolveTab } from './tabs'
import { UNIT_OLD_TABS, UNIT_TAB_VALUES, unitRedirect } from './UnitPage'

const TODAY = '2026-11-04'

function session(userId: string): Session {
  const s = buildSession(getDb(), userId)!
  s.today = TODAY
  return s
}

/** Uma pessoa da imobiliária que serve de dona nos cadastros de teste. */
function anyAgencyPerson(): { id: string; name: string } {
  const p = getDb().people.find((x) => x.organization_id === ORG.agency && !x.deleted_at && !x.user_id)!
  return { id: p.id, name: p.name }
}

function condoInput(over: Partial<NewPropertyInput['structure']> = {}, owners?: NewPropertyInput['owners']): NewPropertyInput {
  const p = anyAgencyPerson()
  return {
    kind: 'condominium',
    name: 'Residencial Teste',
    address: { cep: '30140-071', street: 'Rua das Flores', number: '100', complement: '', district: 'Savassi', city: 'Belo Horizonte', state: 'mg' },
    portfolio_id: '',
    manager_user_id: '',
    notes: '',
    structure: { template: 'tower', code: '', blocks: 2, floors: 3, unitsPerFloor: 2, startNumber: 101, unit: { kind: 'apartment', area_m2: 60, bedrooms: 2, bathrooms: 1, parking_spots: 1, asking_rent: '1.900,00' }, ...over },
    owners: owners ?? [{ person_id: p.id, name: p.name, share_pct: 100 }],
    staff: [],
  }
}

beforeEach(() => {
  resetForTest(TODAY)
})

describe('estrutura gerada pelo modelo', () => {
  it('2 blocos x 3 andares x 2 por andar, começando no 101, gera A-101 ... B-302', () => {
    const plan = planStructure({ template: 'tower', code: '', blocks: 2, floors: 3, unitsPerFloor: 2, startNumber: 101 })
    const codes = plan.blocks.flatMap((b) => b.floors.flatMap((f) => f.units.map((u) => u.code)))
    expect(codes).toEqual(['A-101', 'A-102', 'A-201', 'A-202', 'A-301', 'A-302', 'B-101', 'B-102', 'B-201', 'B-202', 'B-301', 'B-302'])
    expect(plan.blocks.map((b) => b.name)).toEqual(['Bloco A', 'Bloco B'])
    expect(codeRanges(plan)).toBe('A-101 a A-302 · B-101 a B-302')
  })

  it('um bloco só não leva letra; início 11 pula de 10 em 10; casas em fila numeram seguido', () => {
    const one = planStructure({ template: 'tower', code: '', blocks: 1, floors: 2, unitsPerFloor: 3, startNumber: 11 })
    expect(one.blocks[0].floors.flatMap((f) => f.units.map((u) => u.code))).toEqual(['11', '12', '13', '21', '22', '23'])
    const rows = planStructure({ template: 'row_houses', code: '', blocks: 2, floors: 1, unitsPerFloor: 3, startNumber: 1 })
    expect(rows.blocks.flatMap((b) => b.floors.flatMap((f) => f.units.map((u) => u.code)))).toEqual(['Casa 1', 'Casa 2', 'Casa 3', 'Casa 4', 'Casa 5', 'Casa 6'])
  })

  it('recusa numeração que mudaria o andar no meio (190 com 20 por andar) e o excesso de unidades', () => {
    expect(structureProblem({ template: 'tower', code: '', blocks: 1, floors: 2, unitsPerFloor: 20, startNumber: 190 })?.field).toBe('unitsPerFloor')
    expect(structureProblem({ template: 'tower', code: '', blocks: 20, floors: 50, unitsPerFloor: 20, startNumber: 101 })?.message).toMatch(/até 500/)
    expect(structureProblem({ template: 'tower', code: '', blocks: 1, floors: 2, unitsPerFloor: 20, startNumber: 101 })).toBeNull()
  })
})

describe('createProperty', () => {
  it('grava imóvel, blocos, andares, unidades com os códigos certos, donos e modelo do 3D', async () => {
    const s = session(USER.admin)
    const before = getDb().units.length
    const { property, units } = await createProperty(s, condoInput())
    const db = getDb()
    expect(units).toBe(12)
    expect(db.units.length).toBe(before + 12)
    const mine = db.units.filter((u) => u.property_id === property.id)
    expect(mine.map((u) => u.code).sort()).toEqual(['A-101', 'A-102', 'A-201', 'A-202', 'A-301', 'A-302', 'B-101', 'B-102', 'B-201', 'B-202', 'B-301', 'B-302'])
    expect(mine.every((u) => u.asking_rent_cents === 190000 && u.manual_status === 'available' && u.organization_id === ORG.agency)).toBe(true)
    expect(db.buildings.filter((b) => b.property_id === property.id)).toHaveLength(2)
    expect(db.building_models.filter((m) => db.buildings.some((b) => b.id === m.building_id && b.property_id === property.id)).map((m) => m.template)).toEqual(['tower', 'tower'])
    expect(db.property_owners.filter((o) => o.property_id === property.id).map((o) => [o.unit_id, o.share_pct])).toEqual([[null, 100]])
    expect(property.address.cep).toBe('30140071')
    expect(property.address.state).toBe('MG')
    expect(db.audit_logs.some((l) => l.entity_id === property.id && l.action === 'create')).toBe(true)
  })

  it('casa avulsa ganha uma unidade só, sem bloco', async () => {
    const s = session(USER.admin)
    const input = condoInput({ template: 'single', code: 'Casa', unit: { kind: 'house', area_m2: 120, bedrooms: 3, bathrooms: 2, parking_spots: 2, asking_rent: '' } })
    const { property, units } = await createProperty(s, { ...input, kind: 'house' })
    expect(units).toBe(1)
    const u = getDb().units.filter((x) => x.property_id === property.id)
    expect(u.map((x) => [x.code, x.building_id, x.asking_rent_cents])).toEqual([['Casa', null, null]])
  })

  it('as fatias dos donos precisam somar 100', async () => {
    const s = session(USER.admin)
    const people = getDb().people.filter((x) => x.organization_id === ORG.agency && !x.deleted_at).slice(0, 2)
    const owners = [
      { person_id: people[0].id, name: people[0].name, share_pct: 60 },
      { person_id: people[1].id, name: people[1].name, share_pct: 30 },
    ]
    await expect(createProperty(s, condoInput({}, owners))).rejects.toThrow(/somam 90%.*Faltam 10%/)
    // 33,33 + 33,33 + 33,34 fecha 100 (a soma é feita em centésimos inteiros).
    const three = getDb().people.filter((x) => x.organization_id === ORG.agency && !x.deleted_at).slice(0, 3)
    const ok = await createProperty(s, condoInput({}, three.map((p, i) => ({ person_id: p.id, name: p.name, share_pct: i === 2 ? 33.34 : 33.33 }))))
    expect(ok.units).toBe(12)
  })

  it('o colaborador sem "editar imóveis" não cadastra, e dono de outra conta é recusado', async () => {
    await expect(createProperty(session(USER.staff), condoInput())).rejects.toBeInstanceOf(AccessError)
    const marina = getDb().people.find((p) => p.organization_id === ORG.landlord)!
    await expect(createProperty(session(USER.admin), condoInput({}, [{ person_id: marina.id, name: marina.name, share_pct: 100 }]))).rejects.toBeInstanceOf(RuleError)
  })
})

describe('donos do imóvel inteiro', () => {
  it('trocar as fatias fecha a antiga (até ontem) e abre a nova; soma diferente de 100 é recusada', async () => {
    const s = session(USER.admin)
    const { property } = await createProperty(s, condoInput())
    const [a, b] = getDb().people.filter((x) => x.organization_id === ORG.agency && !x.deleted_at).slice(5, 7)
    await expect(setPropertyOwners(s, { property_id: property.id, owners: [{ person_id: a.id, name: a.name, share_pct: 70 }] })).rejects.toThrow(/somam 70%/)
    await setPropertyOwners(s, { property_id: property.id, owners: [{ person_id: a.id, name: a.name, share_pct: 50 }, { person_id: b.id, name: b.name, share_pct: 50 }] })
    const rows = getDb().property_owners.filter((o) => o.property_id === property.id)
    expect(rows.filter((o) => !o.until || o.until >= TODAY).map((o) => o.share_pct)).toEqual([50, 50])
    expect(rows.filter((o) => o.until === '2026-11-03')).toHaveLength(1)
  })
})

describe('arquivar', () => {
  it('unidade com locação vigente é recusada; sem contrato, arquiva e o "Desfazer" devolve', async () => {
    const s = session(USER.admin)
    const db = getDb()
    const occupied = db.units.find((u) => u.organization_id === ORG.agency && db.contracts.some((k) => k.unit_id === u.id && leaseCovers(k, TODAY)))!
    await expect(archiveUnit(s, { id: occupied.id })).rejects.toThrow(/Não dá para arquivar/)
    const { property } = await createProperty(s, condoInput())
    const free = getDb().units.find((u) => u.property_id === property.id)!
    expect((await archiveUnit(s, { id: free.id })).deleted_at).not.toBeNull()
    expect((await archiveUnit(s, { id: free.id, restore: true })).deleted_at).toBeNull()
  })

  it('imóvel com contrato vigente numa unidade é recusado com a lista; sem contrato arquiva junto as unidades', async () => {
    const s = session(USER.admin)
    const condo = getDb().properties.find((p) => p.name === 'Condomínio Mount Juic')!
    await expect(archiveProperty(s, { id: condo.id })).rejects.toThrow(/LOC-/)
    const { property } = await createProperty(s, condoInput())
    await archiveProperty(s, { id: property.id })
    expect(getDb().units.filter((u) => u.property_id === property.id).every((u) => !!u.deleted_at)).toBe(true)
    await archiveProperty(s, { id: property.id, restore: true })
    expect(getDb().units.filter((u) => u.property_id === property.id).every((u) => !u.deleted_at)).toBe(true)
  })

  it('situação manual de unidade ocupada não muda (ocupada vem do contrato)', async () => {
    const s = session(USER.admin)
    const db = getDb()
    const u = db.units.find((x) => x.organization_id === ORG.agency && db.contracts.some((k) => k.unit_id === x.id && leaseCovers(k, TODAY)))!
    const input = { id: u.id, code: u.code, kind: u.kind, area_m2: u.area_m2, bedrooms: u.bedrooms, bathrooms: u.bathrooms, parking_spots: u.parking_spots, features: u.features.join(', '), asking_rent: '', manual_status: 'blocked' as const, notes: '' }
    await expect(updateUnit(s, input)).rejects.toThrow(/ocupada/)
  })
})

describe('escopo (espelho da RLS)', () => {
  it('o proprietário não enxerga imóvel alheio pela lista de imóveis', async () => {
    const created = await createProperty(session(USER.admin), condoInput())
    const owner = session(USER.owner)
    const list = await listProperties(owner, { pageSize: 1000 })
    const names = list.rows.map((r) => r.name)
    expect(names).toContain('Condomínio Mount Juic')
    expect(names).not.toContain('Lynx Residence')
    expect(list.rows.some((r) => r.id === created.property.id)).toBe(false)
    expect(list.totalAll).toBe(2) // o Mount Juic (3 apartamentos dele) e o Luar (a casa dividida com a esposa)
  })

  it('a proprietária independente não enxerga nada da imobiliária: só o Le Plaza', async () => {
    const list = await listProperties(session(USER.landlord), { pageSize: 1000 })
    expect(list.rows.map((r) => r.name)).toEqual(['Edifício Le Plaza'])
    expect(list.rows.every((r) => getDb().properties.find((p) => p.id === r.id)?.organization_id === ORG.landlord)).toBe(true)
    // As 9 salas são unidades; as 24 vagas da garagem têm contagem própria.
    expect(list.rows[0]).toMatchObject({ units_total: 9, spots_total: 24 })
  })
})

describe('ficha do imóvel com o mapa em foco (07/11/2026): endereço antigo continua abrindo', () => {
  // Valores de ?aba= de antes. Outras telas e links guardados usam estes: nenhum pode cair no vazio.
  const tabsOf = (...values: string[]) => values.map((value) => ({ value }))

  it('imóvel: as abas antigas caem nas de hoje (donos e equipe foram para o painel; Vagas virou a troca de dentro de Unidades)', () => {
    // 07/11: o imóvel é o centro: Unidades (com "Unidades | Vagas" dentro) | Contratos | Manutenção | Documentos e histórico.
    const now = tabsOf('unidades', 'contratos', 'manutencao', 'historico')
    const expected: Record<string, string> = {
      estrutura: 'unidades', unidades: 'unidades', pessoas: 'unidades', proprietarios: 'unidades', equipe: 'unidades',
      vagas: 'unidades', contratos: 'contratos', manutencao: 'manutencao', documentos: 'historico', historico: 'historico',
    }
    for (const [old, tab] of Object.entries(expected)) expect(resolveTab(old, now, PROPERTY_OLD_TABS), old).toBe(tab)
  })
  it('imóvel, para quem não vê manutenção: ?aba=manutencao abre Unidades', () => {
    expect(resolveTab('manutencao', tabsOf('unidades', 'historico'), PROPERTY_OLD_TABS)).toBe('unidades')
  })

  it('unidade escolhida: as abas da página antiga da unidade caem nas três de hoje', () => {
    const now = tabsOf(...UNIT_TAB_VALUES)
    const expected: Record<string, string> = {
      resumo: 'contratos', pessoas: 'contratos', contratos: 'contratos', financeiro: 'contratos', manutencao: 'chamados', documentos: 'historico', historico: 'historico',
    }
    for (const [old, tab] of Object.entries(expected)) expect(resolveTab(old, now, UNIT_OLD_TABS), old).toBe(tab)
  })

  it('sem ?aba=, valor desconhecido, nome herdado do objeto ou aba escondida pela permissão: abre a primeira', () => {
    const noMaintenance = tabsOf('contratos', 'historico') // quem não vê Manutenção
    expect(resolveTab(undefined, noMaintenance, UNIT_OLD_TABS)).toBe('contratos')
    expect(resolveTab('qualquer', noMaintenance, UNIT_OLD_TABS)).toBe('contratos')
    expect(resolveTab('constructor', noMaintenance, UNIT_OLD_TABS)).toBe('contratos')
    expect(resolveTab('manutencao', noMaintenance, UNIT_OLD_TABS)).toBe('contratos')
  })

  it('/unidades/<id> vira a ficha do imóvel da unidade, com ela escolhida e a aba traduzida', async () => {
    const u = await getUnit(session(USER.admin), getDb().units.find((x) => x.code === 'Casa 09')!.id)
    const luar = getDb().properties.find((p) => p.name === 'Condomínio Luar')!
    expect(unitRedirect(u)).toEqual({ propertyId: luar.id, search: { unidade: u.id } })
    expect(unitRedirect(u, 'financeiro')).toEqual({ propertyId: luar.id, search: { unidade: u.id, aba: 'contratos' } })
    expect(unitRedirect(u, 'manutencao').search).toEqual({ unidade: u.id, aba: 'chamados' })
    expect(unitRedirect(u, 'historico').search).toEqual({ unidade: u.id, aba: 'historico' })
    // Aba desconhecida (ou nome herdado do objeto) fica de fora: a ficha abre na primeira.
    expect(unitRedirect(u, 'qualquer').search).toEqual({ unidade: u.id })
    expect(unitRedirect(u, 'constructor').search).toEqual({ unidade: u.id })
    // A vaga do estacionamento externo vai para o imóvel dela do mesmo jeito.
    const vaga = await getUnit(session(USER.admin), getDb().units.find((x) => x.code === 'E-014')!.id)
    expect(unitRedirect(vaga).propertyId).toBe(getDb().properties.find((p) => p.name === 'Condomínio Mount Juic')!.id)
  })
  it('o redirecionamento lê a unidade pelo escopo: unidade de outra conta não é achada', async () => {
    const sala = getDb().units.find((x) => x.code === 'Sala 401')!
    await expect(getUnit(session(USER.admin), sala.id)).rejects.toBeInstanceOf(AccessError)
  })
})

describe('endereço da página Imóveis (?lista=, ?imovel=, ?unidade=) e os endereços de antes da tela única', () => {
  it('lista vale; modo antigo é ignorado, menos modo=imoveis, que vira lista=imoveis', () => {
    expect(parseImoveisSearch({ lista: 'unidades' })).toEqual({ lista: 'unidades' })
    expect(parseImoveisSearch({ lista: 'vagas' })).toEqual({ lista: 'vagas' })
    expect(parseImoveisSearch({ modo: 'unidades', lista: 'imoveis' })).toEqual({ lista: 'imoveis' })
    expect(parseImoveisSearch({ modo: 'imoveis' })).toEqual({ lista: 'imoveis' })
    expect(parseImoveisSearch({ modo: 'mapa' })).toEqual({})
    expect(parseImoveisSearch({ lista: 'qualquer' })).toEqual({})
  })
  it('escolha: ?imovel= escolhe o imóvel no mapa (inclusive o link antigo do 3D); unidade só junto do imóvel', () => {
    expect(parseImoveisSearch({ imovel: 'abc-123' })).toEqual({ imovel: 'abc-123' })
    expect(parseImoveisSearch({ modo: 'unidades', imovel: 'abc-123', unidade: 'u1', bloco: 'b' })).toEqual({ imovel: 'abc-123', unidade: 'u1' })
    expect(parseImoveisSearch({ lista: 'vagas', imovel: 'abc', unidade: 'v9' })).toEqual({ lista: 'vagas', imovel: 'abc', unidade: 'v9' })
    expect(parseImoveisSearch({ unidade: 'u1' })).toEqual({}) // unidade sem imóvel não é escolha
    expect(parseImoveisSearch({ imovel: 'avulsos', bloco: 'avulso:abc' })).toEqual({}) // a caixa dos avulsos não é imóvel
    expect(parseImoveisSearch({ imovel: '' })).toEqual({})
    expect(parseImoveisSearch({ imovel: 42 })).toEqual({})
    expect(parseImoveisSearch({ imovel: 'x'.repeat(81) })).toEqual({})
    expect(OLD_SEARCH_KEYS).toEqual(['modo', 'bloco'])
  })
})
