/* =============================================================================
   imoveis.ts: organizações, personas, imóveis, blocos, andares, unidades, vagas e donos.

   Desde 06/11/2026 (pedido do Fernando: "limitar a esses 4"), TUDO sai de exemplos.ts, a fonte
   única que o 3D também lê. Nada de imóvel avulso nem de empreendimento inventado aqui.
     Imobiliária Aurora
       Condomínio Luar: 18 casas em 3 ruas, um dono por casa (a Casa 07 é do Carlos com a esposa, 50/50).
       Condomínio Mount Juic: 6 blocos em H, 120 apartamentos (dono por apartamento) e 60 vagas no
         estacionamento externo. A vaga é do condomínio (pessoa jurídica) e é alugada à parte.
       Lynx Residence: 48 apartamentos (dono por apartamento) e 36 vagas externas, também do condomínio.
     Marina Lopes (proprietária independente)
       Edifício Le Plaza: 9 salas nos andares 4, 12, 13 e 25 e 24 vagas em 2 subsolos; ela é dona de tudo.

   Regras que o gerador respeita (o 3D e as métricas dependem delas):
   1. TODO andar da lista vira linha em floors, inclusive o que é só volume (sem unidade nossa):
      o 3D desenha o prédio inteiro, andar por andar.
   2. Vaga é unidade do tipo "parking". A do estacionamento externo não tem bloco nem andar e leva
      o nome da área em zone; a da garagem fica no andar de subsolo do bloco, com zone vazio.
   3. A vaga NUNCA é ligada a apartamento: tem dono próprio e contrato próprio.
   ============================================================================= */
import { addDays } from '@/lib/dates'
import type { Building, Floor, Id, Membership, Permission, Person, Property, Unit, UnitKind } from '../types'
import { EXTRA_STAFF, ORG, PERSONAS, USER, VENDOR_DEFS } from './catalogo'
import { base, makePerson, ts, type Ctx, type UnitPlan } from './ctx'
import { EXEMPLOS, type Exemplo } from './exemplos'
import { cnpjFromBase, cpfFromBase } from '@/lib/documents'

const COLORS = ['#2b59c3', '#0e7c66', '#b45309', '#7c3aed', '#be185d', '#0369a1', '#4d7c0f', '#c2410c']

/* ---------------------------------------------------------------- Passo 1: contas e personas */
export function seedAccounts(c: Ctx): void {
  const { db, ref } = c
  db.organizations.push(
    { id: ORG.agency, kind: 'agency', name: 'Imobiliária Aurora', document: cnpjFromBase('47285169' + '0001'), timezone: 'America/Sao_Paulo', plan: 'pro', brand_color: '#2b59c3', is_demo: true, created_at: ts(addDays(ref, -980)) },
    { id: ORG.landlord, kind: 'landlord', name: 'Imóveis de Marina Lopes', document: cpfFromBase('318274650'), timezone: 'America/Sao_Paulo', plan: 'starter', brand_color: '#2b59c3', is_demo: true, created_at: ts(addDays(ref, -420)) },
  )
  const everyone = [...PERSONAS.map((p) => ({ userId: p.userId, name: p.name, email: p.email })), ...EXTRA_STAFF]
  everyone.forEach((p, i) => db.profiles.push({ id: p.userId, full_name: p.name, email: p.email, avatar_color: COLORS[i % COLORS.length] }))

  // Pessoas por trás das personas de portal (o login aponta para a pessoa em people).
  c.persons.carlos = makePerson(c, ORG.agency, 'PF', 'Carlos Mendes', { user_id: USER.owner, email: 'carlos.mendes@example.com' })
  c.persons.helena = makePerson(c, ORG.agency, 'PF', 'Helena Mendes')
  c.persons.daniela = makePerson(c, ORG.agency, 'PF', 'Daniela Freitas', { user_id: USER.lessee, email: 'daniela.freitas@example.com' })
  c.persons.marina = makePerson(c, ORG.landlord, 'PF', 'Marina Lopes', { user_id: USER.landlord, email: 'marina.lopes@example.com' })

  // Prestadores: o primeiro é a persona Eduardo.
  VENDOR_DEFS.forEach((v, i) => {
    const p = makePerson(c, ORG.agency, v.kind, v.name, { tags: ['vendor'], vendor_categories: [...v.categories] })
    if (v.persona) {
      p.user_id = USER.vendor
      p.email = 'eduardo@example.com'
      c.persons.eduardo = p
    }
    c.persons[`vendor${i}`] = p
  })
  // Marina tem os próprios prestadores.
  c.persons.marinaVendor1 = makePerson(c, ORG.landlord, 'PF', 'Sérgio Pinheiro', { tags: ['vendor'], vendor_categories: ['plumbing', 'electrical'] })
  c.persons.marinaVendor2 = makePerson(c, ORG.landlord, 'PJ', 'Casa Nova Reformas Ltda', { tags: ['vendor'], vendor_categories: ['painting', 'structure'] })
  // Contatos de condomínio (síndico e zelador) para o cadastro de pessoas não ficar só de dono e inquilino.
  c.persons.syndic = makePerson(c, ORG.agency, 'PF', undefined, { tags: ['syndic'], notes: 'Síndico do Condomínio Mount Juic.' })
  c.persons.caretakerLuar = makePerson(c, ORG.agency, 'PF', undefined, { tags: ['caretaker'], notes: 'Zelador do Condomínio Luar.' })
  // O condomínio como pessoa jurídica: recebe a taxa de condomínio de unidade vaga e é o DONO das vagas
  // do estacionamento externo (área comum que o condomínio aluga por meio da imobiliária).
  c.persons.condoLuar = makePerson(c, ORG.agency, 'PJ', 'Condomínio Luar', { tags: ['contact'] })
  c.persons.condoMontjuic = makePerson(c, ORG.agency, 'PJ', 'Condomínio Mount Juic', { tags: ['contact'] })
  c.persons.condoLynx = makePerson(c, ORG.agency, 'PJ', 'Condomínio Lynx Residence', { tags: ['contact'] })

  const staffPerms: Record<string, Permission[]> = {
    [USER.staff]: ['properties:view', 'people:view', 'contracts:view', 'finance:view', 'finance:edit', 'transfers:approve', 'reports:view', 'maintenance:view', 'workflows:view'],
    [USER.leasing]: ['properties:view', 'properties:edit', 'people:view', 'people:edit', 'contracts:view', 'contracts:edit', 'workflows:view', 'workflows:edit', 'maintenance:view', 'reports:view'],
    [USER.maint]: ['properties:view', 'people:view', 'maintenance:view', 'maintenance:edit', 'workflows:view', 'workflows:edit'],
  }
  const m = (orgId: Id, userId: Id, role: Membership['role'], personId: Id | null = null): Membership => ({
    id: c.rng.uuid(), organization_id: orgId, user_id: userId, role, person_id: personId,
    permissions: staffPerms[userId] ?? [], portfolio_ids: null, status: 'active', created_at: ts(addDays(ref, -300)),
  })
  db.memberships.push(
    m(ORG.agency, USER.admin, 'admin'),
    m(ORG.agency, USER.staff, 'staff'),
    m(ORG.agency, USER.leasing, 'staff'),
    m(ORG.agency, USER.maint, 'staff'),
    m(ORG.agency, USER.owner, 'owner', c.persons.carlos.id),
    m(ORG.agency, USER.lessee, 'lessee', c.persons.daniela.id),
    m(ORG.agency, USER.vendor, 'vendor', c.persons.eduardo.id),
    m(ORG.landlord, USER.landlord, 'admin', c.persons.marina.id),
  )
  // Um convite pendente, para a tela de usuários mostrar o estado "convidado".
  db.invitations.push({ ...base(c, ORG.agency, addDays(ref, -3)), email: 'lucas.prado@example.com', role: 'staff', person_id: null, expires_at: ts(addDays(ref, 4)), accepted_at: null })
}

/* ---------------------------------------------------------------- ajudantes de imóvel */
interface UnitSpec {
  code: string
  kind: UnitKind
  area: number
  bedrooms: number
  bathrooms: number
  parking: number
  rent: number // em reais, pedido de aluguel
  features: string[]
}

function makeUnit(c: Ctx, prop: Property, b: Building | null, f: Floor | null, s: UnitSpec, position: number | null, zone: string | null = null): Unit {
  const u: Unit = {
    ...base(c, prop.organization_id, prop.created_at.slice(0, 10)),
    deleted_at: null,
    property_id: prop.id,
    building_id: b?.id ?? null,
    floor_id: f?.id ?? null,
    code: s.code,
    kind: s.kind,
    area_m2: s.area,
    bedrooms: s.bedrooms,
    bathrooms: s.bathrooms,
    parking_spots: s.parking,
    features: s.features,
    manual_status: 'available',
    position,
    zone,
    asking_rent_cents: Math.round(s.rent / 50) * 50 * 100,
    notes: '',
    import_batch_id: null,
  }
  c.db.units.push(u)
  return u
}

function addOwner(c: Ctx, prop: Property, unit: Unit | null, person: Person, share: number): void {
  c.db.property_owners.push({
    ...base(c, prop.organization_id, prop.created_at.slice(0, 10)),
    property_id: prop.id, unit_id: unit?.id ?? null, person_id: person.id, share_pct: share,
    since: prop.created_at.slice(0, 10), until: null,
  })
}

/** Destino de uma casa, apartamento ou sala: 84% ocupada, o resto entre vaga, reservada, em obra e bloqueada. */
function plan(c: Ctx, unit: Unit, orgId: Id, commercial: boolean): UnitPlan {
  const r = c.rng.float()
  const fate: UnitPlan['fate'] = r < 0.84 ? 'occupied' : r < 0.92 ? 'available' : r < 0.95 ? 'reserved' : r < 0.99 ? 'maintenance' : 'blocked'
  const p: UnitPlan = { unit, orgId, commercial, fate }
  c.plans.push(p)
  return p
}

/**
 * Destino das vagas de um estacionamento (pedido de 06/11): cerca de 70% alugadas, as bloqueadas e
 * em manutenção pedidas, o resto disponível. A ordem é sorteada para a vaga alugada não ficar toda
 * no começo da fileira. Quem aluga cada vaga só é escolhido depois das locações das casas e
 * apartamentos (contratos.ts), porque parte dos locatários são moradores do próprio imóvel.
 */
function planSpots(c: Ctx, spots: Unit[], orgId: Id, extra: { blocked: number; maintenance: number }): UnitPlan[] {
  const order = spots.map((u) => ({ u, k: c.rng.float() })).sort((a, b) => a.k - b.k).map((x) => x.u)
  const rented = Math.round(spots.length * 0.7)
  return order.map((unit, i) => {
    const fate: UnitPlan['fate'] =
      i < rented ? 'occupied' : i < rented + extra.blocked ? 'blocked' : i < rented + extra.blocked + extra.maintenance ? 'maintenance' : 'available'
    const p: UnitPlan = { unit, orgId, commercial: false, fate }
    c.plans.push(p)
    return p
  })
}

/** O que a montagem de um exemplo devolve: o imóvel, as casas/apartamentos/salas e as vagas. */
interface Built {
  property: Property
  homes: Unit[]
  spots: Unit[]
}

/** Tipo da unidade quando o andar não diz: casa no condomínio de casas, sala no comercial, apartamento no resto. */
function defaultKind(ex: Exemplo): UnitKind {
  return ex.kind === 'commercial' ? 'office' : 'apartment'
}

/**
 * Tamanho, quartos e aluguel pedido de cada unidade. Valores plausíveis para Belo Horizonte em 2026,
 * inventados. "position" é a ordem no andar (1 = canto): nos prédios, o canto é o apartamento maior.
 */
function specFor(c: Ctx, ex: Exemplo, kind: UnitKind, code: string, level: number, position: number, perFloor: number): UnitSpec {
  const { rng } = c
  if (kind === 'parking') {
    // Vaga: aluguel barato (R$ 150 a R$ 350). Garagem coberta no Centro custa mais que pátio de condomínio.
    const garage = ex.key === 'leplaza'
    const rent = garage ? rng.int(260, 320) : ex.key === 'lynx' ? rng.int(190, 260) : rng.int(160, 220)
    return { code, kind, area: 12, bedrooms: 0, bathrooms: 0, parking: 1, rent, features: garage ? ['coberta'] : [] }
  }
  if (kind === 'house') {
    const bedrooms = rng.pick([3, 3, 4])
    return { code, kind, area: rng.int(150, 190), bedrooms, bathrooms: bedrooms - 1, parking: 2, rent: rng.int(4600, 5600), features: ['quintal', 'churrasqueira'] }
  }
  if (kind === 'office') {
    if (code.startsWith('Cobertura')) return { code, kind, area: 240, bedrooms: 0, bathrooms: 3, parking: 0, rent: 18500, features: ['terraço', 'ar-condicionado'] }
    const big = perFloor <= 2
    return { code, kind, area: big ? 72 : rng.int(36, 46), bedrooms: 0, bathrooms: 1, parking: 0, rent: big ? rng.int(5200, 6000) : rng.int(2600, 3400), features: ['ar-condicionado'] }
  }
  // Apartamento. No Mount Juic (4 por andar) os cantos têm 3 quartos; no Lynx (16 por andar), um a cada 4.
  const big = perFloor <= 4 ? position === 1 || position === perFloor : position % 4 === 1
  const lynx = ex.key === 'lynx'
  const area = lynx ? (big ? 62 : 38) : big ? 74 : 56
  const rent = (lynx ? (big ? 2900 : 1900) : big ? 2600 : 1950) * (1 + level * 0.015)
  return { code, kind, area, bedrooms: big ? (lynx ? 2 : 3) : lynx ? 1 : 2, bathrooms: big ? 2 : 1, parking: 0, rent, features: big ? ['varanda', 'suíte'] : ['varanda'] }
}

/**
 * Monta um exemplo inteiro: imóvel, blocos, TODOS os andares (inclusive os de volume), unidades e
 * vagas. Passo a passo:
 * 1. imóvel com o endereço e as coordenadas de exemplos.ts (o pino cai onde o 3D espera);
 * 2. bloco a bloco, a posição no terreno em grade (o 3D novo usa a implantação; esta é a do 3D atual);
 * 3. andar a andar, as unidades do andar e, se for garagem, as vagas do andar;
 * 4. estacionamentos de fora dos blocos: vagas sem bloco nem andar, com o nome da área.
 */
function buildExample(c: Ctx, ex: Exemplo, orgId: Id, portfolioId: Id | null, managerId: Id | null, notes: string): Built {
  const { db } = c
  const created = addDays(c.ref, -c.rng.int(700, 1100))
  const property: Property = {
    ...base(c, orgId, created),
    deleted_at: null,
    kind: ex.kind,
    name: ex.name,
    address: { cep: ex.address.cep.replace(/\D/g, ''), street: ex.address.street, number: ex.address.number, complement: '', district: ex.address.district, city: 'Belo Horizonte', state: 'MG' },
    lat: ex.lat,
    lng: ex.lng,
    portfolio_id: portfolioId,
    manager_user_id: managerId,
    notes,
    import_batch_id: null,
  }
  db.properties.push(property)

  const homes: Unit[] = []
  const spots: Unit[] = []
  const cols = Math.min(3, ex.blocks.length)
  ex.blocks.forEach((blk, bi) => {
    // Casas em fila ficam uma rua embaixo da outra; prédios, em grade de até 3 por linha.
    const rows = blk.shape === 'house'
    const b: Building = {
      ...base(c, orgId, created), property_id: property.id, name: blk.name,
      site_x: rows ? 1 : 1 + (bi % cols) * 8, site_y: rows ? 1 + bi * 5 : 1 + Math.floor(bi / cols) * 7,
    }
    db.buildings.push(b)
    c.shapes[b.id] = blk.shape
    for (const fl of blk.floors) {
      const f: Floor = { ...base(c, orgId, created), building_id: b.id, level: fl.level, label: fl.label }
      db.floors.push(f)
      const kind = fl.kind ?? (blk.shape === 'house' ? 'house' : defaultKind(ex))
      fl.units.forEach((code, i) => homes.push(makeUnit(c, property, b, f, specFor(c, ex, kind, code, fl.level, i + 1, fl.units.length), i + 1)))
      ;(fl.parking ?? []).forEach((code, i) => spots.push(makeUnit(c, property, b, f, specFor(c, ex, 'parking', code, fl.level, i + 1, 0), i + 1)))
    }
  })
  for (const area of ex.parking) {
    area.spots.forEach((code, i) => spots.push(makeUnit(c, property, null, null, specFor(c, ex, 'parking', code, 0, i + 1, 0), i + 1, area.zone)))
  }
  return { property, homes, spots }
}

const example = (key: Exemplo['key']) => EXEMPLOS.find((e) => e.key === key)!

/* ---------------------------------------------------------------- Passo 2: imóveis da imobiliária */
export function seedAgencyProperties(c: Ctx): void {
  const { db } = c
  const A = ORG.agency
  // Carteiras: os dois condomínios na Residencial; a Comercial existe sem imóvel ainda (a imobiliária a criou
  // para a captação de salas) e o Lynx ficou sem carteira, para o filtro mostrar o caso "Sem carteira".
  const pfRes = { ...base(c, A, '2024-03-01'), name: 'Residencial', color: '#2b59c3' }
  const pfCom = { ...base(c, A, '2024-03-01'), name: 'Comercial', color: '#0e7c66' }
  db.portfolios.push(pfRes, pfCom)

  /* Condomínio Luar: um dono por casa. A Casa 07 é do Carlos com a esposa (50/50, aparece no portal
     dele com a fatia); a Casa 12 é de um casal; o resto, de investidores (alguns com duas casas). */
  const luar = buildExample(c, example('luar'), A, pfRes.id, USER.leasing, 'Condomínio fechado de casas, com portaria 24 h, piscina e salão de festas.')
  const luarInvestors = Array.from({ length: 12 }, () => makePerson(c, A, 'PF'))
  const luarCouple = [makePerson(c, A, 'PF'), makePerson(c, A, 'PF')]
  luar.homes.forEach((u, i) => {
    if (u.code === 'Casa 07') {
      addOwner(c, luar.property, u, c.persons.carlos, 50)
      addOwner(c, luar.property, u, c.persons.helena, 50)
    } else if (u.code === 'Casa 12') {
      addOwner(c, luar.property, u, luarCouple[0], 50)
      addOwner(c, luar.property, u, luarCouple[1], 50)
    } else addOwner(c, luar.property, u, luarInvestors[i % luarInvestors.length], 100)
    const p = plan(c, u, A, false)
    if (u.code === 'Casa 07') {
      p.fate = 'occupied'
      p.paymentProfile = 'good'
    }
  })

  /* Condomínio Mount Juic: dono por apartamento. Carlos (persona) é dono de A-301, A-302 e B-504;
     um casal divide 3 apartamentos; o resto é de investidores. A Daniela (persona) mora na B-203. */
  const mj = buildExample(c, example('montjuic'), A, pfRes.id, USER.admin, 'Seis blocos de até 6 andares. Estacionamento externo administrado à parte: a vaga não é de nenhum apartamento.')
  const mjInvestors = Array.from({ length: 28 }, () => makePerson(c, A, 'PF'))
  const mjCouple = [makePerson(c, A, 'PF'), makePerson(c, A, 'PF')]
  let k = 0
  for (const u of mj.homes) {
    if (['A-301', 'A-302', 'B-504'].includes(u.code)) addOwner(c, mj.property, u, c.persons.carlos, 100)
    else if (['C-104', 'D-402', 'E-301'].includes(u.code)) {
      addOwner(c, mj.property, u, mjCouple[0], 50)
      addOwner(c, mj.property, u, mjCouple[1], 50)
    } else addOwner(c, mj.property, u, mjInvestors[k++ % mjInvestors.length], 100)
    const p = plan(c, u, A, false)
    if (u.code === 'B-203') {
      p.fate = 'occupied'
      p.forcedLessee = c.persons.daniela
      p.paymentProfile = 'good'
    }
    if (u.code === 'A-301') {
      p.fate = 'occupied'
      p.paymentProfile = 'good'
    }
    if (u.code === 'A-302') {
      p.fate = 'occupied'
      p.paymentProfile = 'delinquent'
    }
    if (u.code === 'B-504') p.fate = 'available'
  }
  // As vagas são do condomínio (uma linha de dono por vaga, para a vaga nunca herdar o dono de outra coisa).
  for (const u of mj.spots) addOwner(c, mj.property, u, c.persons.condoMontjuic, 100)
  const mjSpots = planSpots(c, mj.spots, A, { blocked: 1, maintenance: 1 })
  // A Daniela também aluga uma vaga do estacionamento externo (a E-014): ela é a moradora-locatária da demonstração.
  const daniSpot = mjSpots.find((p) => p.unit.code === 'E-014')!
  daniSpot.fate = 'occupied'
  daniSpot.forcedLessee = c.persons.daniela
  daniSpot.paymentProfile = 'good'

  /* Lynx Residence: dono por apartamento (investidores) e vagas externas do condomínio. */
  const lynx = buildExample(c, example('lynx'), A, null, USER.leasing, 'Térreo de lojas e hall (não administrados); apartamentos do 2º ao 4º andar.')
  const lynxInvestors = Array.from({ length: 14 }, () => makePerson(c, A, 'PF'))
  lynx.homes.forEach((u, i) => {
    addOwner(c, lynx.property, u, lynxInvestors[i % lynxInvestors.length], 100)
    plan(c, u, A, false)
  })
  for (const u of lynx.spots) addOwner(c, lynx.property, u, c.persons.condoLynx, 100)
  planSpots(c, lynx.spots, A, { blocked: 1, maintenance: 0 })
}

/* ---------------------------------------------------------------- Passo 3: imóveis da Marina */
export function seedLandlordProperties(c: Ctx): void {
  const L = ORG.landlord
  // Edifício Le Plaza: ela é dona das 9 salas e das 24 vagas (dona do imóvel inteiro, unit_id vazio).
  const lp = buildExample(c, example('leplaza'), L, null, null, 'Torre comercial de 25 andares. Só os andares 4, 12, 13 e 25 e as vagas dos 2 subsolos são da Marina.')
  addOwner(c, lp.property, null, c.persons.marina, 100)
  // 7 das 9 salas alugadas (sala comercial demora mais a alugar); a ordem segue o código.
  lp.homes.forEach((u, i) => {
    const p = plan(c, u, L, true)
    p.fate = i === 2 || i === 6 ? 'available' : 'occupied'
  })
  planSpots(c, lp.spots, L, { blocked: 0, maintenance: 1 })
}
