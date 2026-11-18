// Testes do Mapa: a conta do 3D (giro, ordem de pintura, corpos girados, faixa em volta do pátio),
// as implantações dos 4 exemplos (blocos, andares, vagas e o "mostrar no mapa"), o texto acessível
// das unidades, o escopo da cena, a aprovação da planta (permissão + auditoria) e os pinos.
// Rodar: npx vitest run src/modules/mapa
import { describe, expect, it } from 'vitest'
import { buildSession } from '@/auth/session'
import { AccessError, RuleError } from '@/data/api'
import { resetForTest } from '@/data/store'
import { ORG, USER } from '@/data/seed'
import { EXEMPLOS } from '@/data/seed/exemplos'
import { bandCells, bodyFaces, bodyOf, centroid, depthCompare, depthOrder, fromView, quarterTurn, rectPoly, rotate, toView, zoomAt, type Rot, type Site } from './iso'
import { buildLayout, fitCode, floorSlots, trailCrumbs, typologySummary, unitAriaLabel } from './layout'
import { draw, targetRect } from './draw'
import { IMPLANTACOES, implantacaoFor, layoutFor } from './implantacao'
import { blocoH } from './implantacao/formas'
import { LYNX_DEPTH, LYNX_SPINE } from './implantacao/lynx'
import { approveFloorplan, getMapScene, getUnitFloorplan, listMapPins, listMapProperties } from './repo'
import { listUnits } from '@/data/views/units'
import { createProperty } from '@/modules/imoveis/repo'
import { groupNearby } from './cluster'
import { createHoverChannel } from './hover'
import { easeOut, lerpView } from './usePanZoom'
import { boxPoly, wallShade } from './iso'
import { cameraOf, cosSin, easeInOut, easeOutTurn, endOfTurn, facesAt, frameOfSvg, framePoint, meet, pivotAt, pzOfFrame, RETARGET_MS, rotOf, svgPoint, TURN_MS, tweenAt, type Frame, type SvgView, type Tween } from './giro'
import { balloonNextAt, balloonReducer, BALLOON_HIDE_MS, placeBalloon, type BalloonState } from './balao'

const db = resetForTest('2026-11-04')
const session = (userId: string) => {
  const s = buildSession(db, userId)!
  s.today = '2026-11-04'
  return s
}
// Desde 06/11 os dados fictícios são os 4 exemplos de seed/exemplos.ts; o condomínio de prédios é o Mount Juic.
const acacias = () => db.properties.find((p) => p.name === 'Condomínio Mount Juic')!

describe('giro de 90 graus', () => {
  const site: Site = { w: 10, h: 6 }
  it('quatro quartos de volta trazem o ponto e o terreno de volta à origem', () => {
    let p: [number, number] = [3, 1.5]
    let s = site
    for (let i = 0; i < 4; i++) ({ p, site: s } = quarterTurn(p[0], p[1], s))
    expect(p).toEqual([3, 1.5])
    expect(s).toEqual(site)
  })
  it('girar 4 vezes para qualquer lado volta ao ângulo inicial', () => {
    let r: Rot = 0
    for (let i = 0; i < 4; i++) r = rotate(r, 1)
    expect(r).toBe(0)
    for (let i = 0; i < 4; i++) r = rotate(r, -1)
    expect(r).toBe(0)
    expect(rotate(0, -1)).toBe(3)
  })
  it('toView é o mesmo que r quartos de volta, e fromView desfaz', () => {
    for (const r of [0, 1, 2, 3] as Rot[]) {
      let p: [number, number] = [7, 2]
      let s = site
      for (let i = 0; i < r; i++) ({ p, site: s } = quarterTurn(p[0], p[1], s))
      expect(toView(7, 2, r, site)).toEqual(p)
      expect(fromView(...toView(7, 2, r, site), r, site)).toEqual([7, 2])
    }
  })
})

// A ordem de pintura das caixas antigas saiu com o motor de caixas (06/11): a dos corpos é testada em
// "motor dos corpos", mais abaixo. Fica o zoom, que é o mesmo.
describe('zoom', () => {
  it('zoom em volta de um ponto mantém o ponto no lugar', () => {
    const t = zoomAt({ k: 1, x: 10, y: 20 }, 2, 110, 70)
    expect([(110 - t.x) / t.k, (70 - t.y) / t.k]).toEqual([100, 50])
  })
})

describe('texto e tamanho das unidades', () => {
  it('rótulo do leitor de tela: código, situação e quartos', () => {
    expect(unitAriaLabel({ code: 'A-301', building_id: 'b', property_name: 'X', status: 'occupied', bedrooms: 3, area_m2: 86, kind: 'apartment' })).toBe('A-301, Ocupada, 3 quartos')
    expect(unitAriaLabel({ code: 'A-102', building_id: 'b', property_name: 'X', status: 'available', bedrooms: 1, area_m2: 40, kind: 'apartment' })).toBe('A-102, Disponível, 1 quarto')
    expect(unitAriaLabel({ code: 'Sala 101', building_id: 'b', property_name: 'X', status: 'reserved', bedrooms: 0, area_m2: 40, kind: 'office' })).toBe('Sala 101, Reservada, 40 m²')
    expect(unitAriaLabel({ code: 'Casa', building_id: null, property_name: 'Casa Sabiá, 120', status: 'occupied', bedrooms: 2, area_m2: 90, kind: 'house' })).toBe('Casa Sabiá, 120, Ocupada, 2 quartos')
    // Vaga do estacionamento externo: sem bloco, mas o nome é o código dela, não o do imóvel.
    expect(unitAriaLabel({ code: 'E-014', building_id: null, property_name: 'X', status: 'available', bedrooms: 0, area_m2: 12, kind: 'parking' })).toBe('E-014, Disponível, vaga de garagem')
  })
  it('desenho automático (reserva): todas as unidades da cena viram caixa ou vaga, com rótulo próprio', async () => {
    const scene = await getMapScene(session(USER.admin), acacias().id)
    const layout = buildLayout(scene)
    // 120 apartamentos nos 6 blocos + 60 vagas do estacionamento externo (a vaga também é unidade).
    expect(scene.units).toHaveLength(180)
    expect(layout.units.size).toBe(180)
    expect(new Set(scene.units.map(unitAriaLabel)).size).toBe(180)
    // O Bloco A tem 4 andares: a ordem de tabulação começa pelo andar mais alto dele.
    expect(layout.tabOrder.slice(0, 4).map((id) => scene.units.find((u) => u.id === id)!.code)).toEqual(['A-401', 'A-402', 'A-403', 'A-404'])
  })
  it('vagas do andar: 4 aptos em 2 fileiras; 5 salas em uma; código encurta se não cabe', () => {
    expect(floorSlots(4, 4, 2)).toEqual([[0, 0, 2, 1], [2, 0, 4, 1], [0, 1, 2, 2], [2, 1, 4, 2]])
    expect(floorSlots(5, 6, 2)).toHaveLength(5)
    expect(floorSlots(5, 6, 2).every(([, y0, , y1]) => y0 === 0 && y1 === 2)).toBe(true)
    expect(fitCode('A-301', 44)).toBe('A-301')
    expect(fitCode('Sala 101', 26.4)).toBe('S101')
    expect(fitCode('Sala 101', 10)).toBe('')
  })
  it('resumo por tipologia conta total e disponíveis', () => {
    const rows = typologySummary([
      { bedrooms: 2, kind: 'apartment', status: 'available' },
      { bedrooms: 2, kind: 'apartment', status: 'occupied' },
      { bedrooms: 3, kind: 'apartment', status: 'occupied' },
      { bedrooms: 0, kind: 'store', status: 'available' },
    ])
    expect(rows).toEqual([
      { key: 'q2', label: '2 quartos', total: 2, available: 1 },
      { key: 'q3', label: '3 quartos', total: 1, available: 0 },
      { key: 'k:store', label: 'Loja', total: 1, available: 1 },
    ])
  })
})

describe('escopo do mapa', () => {
  it('proprietário convidado vê na cena só as unidades dele, e o volume do prédio sem dado alheio', async () => {
    const scene = await getMapScene(session(USER.owner), acacias().id)
    expect(scene.units.map((u) => u.code).sort()).toEqual(['A-301', 'A-302', 'B-504'])
    const layout = buildLayout(scene)
    expect(layout.shapes.filter((x) => x.kind === 'unit')).toHaveLength(3)
    expect(layout.shapes.filter((x) => x.kind === 'slot').every((x) => x.unitId === null)).toBe(true)
  })
  it('a imobiliária não abre a cena nem a planta de outra organização', async () => {
    const marina = db.properties.find((p) => p.name === 'Edifício Le Plaza')!
    await expect(getMapScene(session(USER.admin), marina.id)).rejects.toBeInstanceOf(AccessError)
    const a102 = db.units.find((u) => u.code === 'A-102')!
    await expect(getUnitFloorplan(session(USER.landlord), a102.id)).rejects.toBeInstanceOf(AccessError)
  })
})

describe('imóvel avulso: a cena é só dele (06/11/2026)', () => {
  // Avulso = imóvel sem bloco cadastrado. Antes, todos os avulsos (de endereços diferentes) eram
  // desenhados juntos num terreno inventado; agora cada ficha mostra só o imóvel dela.
  // Os 4 exemplos (seed/exemplos.ts) não têm avulso: o teste cadastra um pela mesma porta da tela.
  const looseOf = async (kind: 'house' | 'apartment') => {
    const owner = db.people.find((x) => x.organization_id === ORG.agency && !x.deleted_at && !x.user_id && x.kind === 'PF' && x.document)!
    const { property } = await createProperty(session(USER.admin), {
      kind, name: kind === 'house' ? 'Casa Teste do Mapa, 10' : 'Apartamento Teste do Mapa, 20',
      address: { cep: '30140-071', street: 'Rua das Flores', number: kind === 'house' ? '10' : '20', complement: '', district: 'Savassi', city: 'Belo Horizonte', state: 'MG' },
      portfolio_id: '', manager_user_id: '', notes: '',
      structure: {
        template: 'single', code: kind === 'house' ? 'Casa' : 'Apto 302', blocks: 1, floors: 1, unitsPerFloor: 1, startNumber: 101,
        unit: { kind, area_m2: 80, bedrooms: 2, bathrooms: 1, parking_spots: 1, asking_rent: '' },
      },
      owners: [{ person_id: owner.id, name: owner.name, share_pct: 100 }],
      staff: [],
    })
    return property
  }

  it('apartamento avulso: só as unidades dele, num bloco só, com o prédio em volta como volume', async () => {
    const p = await looseOf('apartment')
    const scene = await getMapScene(session(USER.admin), p.id)
    const own = db.units.filter((u) => u.property_id === p.id && !u.deleted_at).map((u) => u.id).sort()
    expect(scene.units.map((u) => u.id).sort()).toEqual(own)
    expect(scene.units.every((u) => u.property_id === p.id)).toBe(true)
    expect(scene.title).toBe(p.name)
    expect(scene.buildings).toHaveLength(1)
    expect(scene.buildings[0]).toMatchObject({ property_id: p.id, template: 'tower', base_floors: 2, site_x: 0, site_y: 0 })
    const layout = buildLayout(scene)
    expect(layout.units.size).toBe(own.length)
    expect(layout.shapes.filter((x) => x.kind === 'slot' && x.unitId === null).length).toBeGreaterThan(0) // o prédio em volta
  })
  it('casa avulsa: só ela, com telhado', async () => {
    const p = await looseOf('house')
    const scene = await getMapScene(session(USER.admin), p.id)
    expect(scene.units.every((u) => u.property_id === p.id)).toBe(true)
    expect(scene.buildings).toHaveLength(1)
    expect(buildLayout(scene).shapes.some((x) => x.kind === 'roof')).toBe(true)
  })
  it('a trilha não repete o nome: o "bloco" do avulso tem o nome do imóvel', () => {
    const t = trailCrumbs([{ label: 'Apartamento Sabiá, 958', k: 'imovel' }, { label: 'Apartamento Sabiá, 958', k: 'bloco' }, { label: 'Unidade', k: 'andar' }])
    expect(t.map((c) => c.label)).toEqual(['Apartamento Sabiá, 958', 'Unidade'])
    expect(t[0].k).toBe('bloco') // fica o elo mais fundo: é ele que diz onde a pessoa está
    expect(trailCrumbs([{ label: 'Residencial' }, { label: 'Bloco A' }, { label: '3º andar' }])).toHaveLength(3)
  })
})

describe('aprovar a planta que veio da importação automática', () => {
  const a102 = () => db.units.find((u) => u.code === 'A-102')!
  it('exige a permissão de editar imóveis', async () => {
    // Bruno é colaborador do financeiro: vê imóveis, não edita.
    await expect(approveFloorplan(session(USER.staff), { unitId: a102().id })).rejects.toBeInstanceOf(AccessError)
    await expect(approveFloorplan(session(USER.owner), { unitId: a102().id })).rejects.toBeInstanceOf(AccessError)
    expect((await getUnitFloorplan(session(USER.admin), a102().id)).review).toBe('draft')
  })
  it('com permissão: aprova, registra na auditoria e não aprova duas vezes', async () => {
    const s = session(USER.admin)
    const before = db.audit_logs.length
    const r = await approveFloorplan(s, { unitId: a102().id })
    expect(r).toMatchObject({ code: 'A-102', count: 4 })
    const plan = await getUnitFloorplan(s, a102().id)
    expect(plan.review).toBe('approved')
    expect(plan.elements.every((e) => e.review_status === 'approved')).toBe(true)
    const log = db.audit_logs.slice(before).find((l) => l.entity === 'units' && l.entity_id === a102().id)
    expect(log).toMatchObject({ action: 'approve', actor_user_id: USER.admin })
    expect(log?.changes).toEqual({ review_status: { from: 'draft', to: 'approved' } })
    await expect(approveFloorplan(s, { unitId: a102().id })).rejects.toBeInstanceOf(RuleError)
  })
  it('recusa entrada vazia (zod)', async () => {
    await expect(approveFloorplan(session(USER.admin), { unitId: '  ' })).rejects.toThrow('Escolha a unidade da planta.')
  })
})

describe('pinos próximos viram um grupo', () => {
  // Três imóveis: dois a 10 px um do outro (empilhariam) e um longe.
  const pts = [
    { id: 'pequeno', x: 100, y: 100, units: 1 },
    { id: 'grande', x: 108, y: 106, units: 64 },
    { id: 'longe', x: 400, y: 300, units: 8 },
  ]
  const groups = groupNearby(pts, (p) => p, (p) => p.units)

  it('junta os que ficariam um em cima do outro e deixa o distante sozinho', () => {
    expect(groups.map((g) => g.items.map((p) => p.id))).toEqual([['grande', 'pequeno'], ['longe']])
  })
  it('o pino do grupo fica sobre o maior imóvel', () => {
    expect(groups[0].at).toEqual({ x: 108, y: 106 })
  })
  it('com distância mínima menor, os dois se separam', () => {
    expect(groupNearby(pts, (p) => p, (p) => p.units, 5)).toHaveLength(3)
  })
})

describe('página Imóveis: a tabela e os pinos do mapa seguem os mesmos filtros', () => {
  const all = { page: 1, pageSize: 100_000 }

  it('tabela de imóveis: "Situação" = imóvel com pelo menos uma unidade nessa situação', async () => {
    const s = session(USER.admin)
    const list = await listMapProperties(s, { ...all, filters: { status: ['available'] } })
    // Situação do imóvel olha só moradia e sala (vaga tem lista própria): compara com as unidades sem vaga, como a página faz.
    const units = await listUnits(s, { ...all, filters: { status: ['available'], spot: ['nao'] } })
    expect(list.total).toBeGreaterThan(0)
    expect(list.rows.every((p) => p.status_counts.available > 0)).toBe(true)
    expect(new Set(list.rows.map((p) => p.id))).toEqual(new Set(units.rows.map((u) => u.property_id)))
  })

  it('categoria Imóveis: os pinos são o resultado inteiro, não só a página aberta', async () => {
    const s = session(USER.admin)
    // A imobiliária tem 3 imóveis (Luar, Mount Juic e Lynx): página de 2 deixa um de fora da tabela, não do mapa.
    const page = await listMapProperties(s, { pageSize: 2 })
    const pins = await listMapPins(s, 'imoveis', {})
    expect(page.rows).toHaveLength(2)
    expect(pins).toHaveLength(page.total)
    expect(pins.every((p) => p.matched === null)).toBe(true)
  })

  it('categoria Unidades: pino = imóvel com unidade no resultado, contando quantas', async () => {
    const s = session(USER.admin)
    const filters = { status: ['available'] }
    const units = await listUnits(s, { ...all, filters })
    const expected = new Map<string, number>()
    for (const u of units.rows) expected.set(u.property_id, (expected.get(u.property_id) ?? 0) + 1)
    const pins = await listMapPins(s, 'unidades', { filters })
    expect(new Map(pins.map((p) => [p.id, p.matched]))).toEqual(expected)
    expect(pins.reduce((a, p) => a + (p.matched ?? 0), 0)).toBe(units.total)
    // A busca vale para os pinos também: código de unidade que não existe não deixa pino nenhum.
    expect(await listMapPins(s, 'unidades', { search: 'zzz-nao-existe' })).toEqual([])
  })

  it('escopo: o proprietário só vê pino de imóvel onde tem unidade', async () => {
    const s = session(USER.owner)
    const mine = new Set((await listUnits(s, all)).rows.map((u) => u.property_id))
    const pins = await listMapPins(s, 'unidades', {})
    expect(pins.length).toBeGreaterThan(0)
    expect(pins.every((p) => mine.has(p.id))).toBe(true)
  })
})

describe('motor dos corpos: prisma girado, ordem de pintura, faixa em volta do pátio', () => {
  const site: Site = { w: 30, h: 30 }
  it('prisma girado 30 graus: aparecem o topo e só as paredes viradas para a câmera, em qualquer giro', () => {
    const body = { poly: rectPoly(10, 10, 4, 2, 30), z0: 0, z1: 1 }
    for (const r of [0, 1, 2, 3] as Rot[]) {
      const faces = bodyFaces(body, r, site, '3d')
      expect(faces.filter((f) => f.shade === 't')).toHaveLength(1)
      // Base de 4 lados girada (sem lado paralelo à diagonal da vista): sempre 2 paredes à mostra.
      expect(faces.filter((f) => f.edge >= 0)).toHaveLength(2)
    }
    // Sem giro: normais a 30 graus (escura-média) e 120 graus (de frente para a luz).
    const shades = bodyFaces(body, 0, site, '3d').filter((f) => f.edge >= 0).map((f) => f.shade).sort()
    expect(shades).toEqual([0, 2])
    expect(bodyFaces(body, 0, site, 'planta').map((f) => f.shade)).toEqual(['t'])
    // A caixa antiga pelo motor novo: esquerda clara (0) e direita escura (3), como antes (l e r).
    expect(bodyFaces(bodyOf({ form: 'box', x0: 1, y0: 1, x1: 3, y1: 2, z0: 0, z1: 1 }), 0, site, '3d').map((f) => f.shade).sort()).toEqual([0, 3, 't'])
  })
  it('ordem de pintura: o da frente depois do de trás (girado ou não); empilhado, o de baixo primeiro', () => {
    const item = (poly: [number, number][], z0 = 0, z1 = 1) => ({ vp: poly, z0, z1 })
    const tras = item(rectPoly(5, 5, 3, 1.5, 25))
    const frente = item(rectPoly(8, 8, 3, 1.5, 25), 0, 0.3) // mais baixo e na frente: cobre o alto de trás
    expect(depthCompare(tras, frente)).toBe(-1)
    expect(depthOrder([frente, tras], '3d')).toEqual([tras, frente])
    const baixo = item(rectPoly(5, 5, 2, 2), 0, 1)
    const cima = item(rectPoly(5, 5, 2, 2), 1, 2)
    expect(depthOrder([cima, baixo], '3d')).toEqual([baixo, cima])
    // Lado a lado na tela (diagonal): nenhuma ordem obrigatória.
    expect(depthCompare(item(rectPoly(2, 8, 1, 1)), item(rectPoly(8, 2, 1, 1)))).toBe(0)
  })
  it('triângulo arredondado do Lynx: 16 unidades por andar, em ordem, no sentido do relógio a partir da frente', () => {
    const cells = bandCells(LYNX_SPINE, LYNX_DEPTH, 16)
    expect(cells).toHaveLength(16)
    expect(cells.every((c) => c.length > 0 && c.every((p) => p.length === 4))).toBe(true)
    // Ângulo de cada unidade em volta do centro (12,5; 13): cresce de uma para a seguinte (o relógio, visto de cima).
    const angle = (c: [number, number][][]) => {
      const [x, y] = centroid(c.flat())
      return Math.atan2(y - 13, x - 12.5)
    }
    const ang = cells.map(angle)
    const steps = ang.slice(1).map((a, i) => (a - ang[i] + 2 * Math.PI) % (2 * Math.PI))
    expect(steps.every((s) => s > 0 && s < Math.PI / 2)).toBe(true)
    // A unidade 1 começa no meio da frente (a rua, y maior): fica do lado de baixo do centro.
    expect(centroid(cells[0].flat())[1]).toBeGreaterThan(13)
    // Toda peça é convexa (a ordem de pintura depende disso).
    const convex = (p: [number, number][]) => {
      const cr = p.map((a, i) => {
        const b = p[(i + 1) % p.length]
        const c = p[(i + 2) % p.length]
        return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
      })
      return cr.every((v) => v >= -1e-9) || cr.every((v) => v <= 1e-9)
    }
    expect(cells.flat().every(convex)).toBe(true)
  })
  it('bloco em H: 4 apartamentos por andar, um em cada ponta; outra quantidade divide as alas', () => {
    const h = blocoH('Bloco X', 0, 0)
    const plan = h.plan(4)
    expect(plan.units).toHaveLength(4)
    expect(plan.units.every((u) => u.length === 1)).toBe(true)
    expect(plan.neutral).toHaveLength(3) // meio das duas alas + ponte
    expect(h.plan(6).units).toHaveLength(6)
    expect(h.plate).toHaveLength(3)
  })
})

describe('implantações dos 4 exemplos', () => {
  const ex = (key: string) => EXEMPLOS.find((e) => e.key === key)!
  const sceneOf = async (name: string, user: string = USER.admin) => getMapScene(session(user), db.properties.find((p) => p.name === name)!.id)

  it('cada exemplo tem implantação, achada pelo nome; imóvel sem implantação usa o desenho automático', () => {
    for (const e of EXEMPLOS) expect(implantacaoFor(e.name)?.key).toBe(e.key)
    expect(implantacaoFor('Casa Teste do Mapa, 10')).toBeNull()
  })
  it('as vagas desenhadas são exatamente as de exemplos.ts, na mesma ordem', () => {
    for (const key of ['montjuic', 'lynx'] as const) {
      const spec = IMPLANTACOES[key]
      expect(spec.parking.map((z) => z.zone)).toEqual(ex(key).parking.map((z) => z.zone))
      expect(spec.parking.flatMap((z) => z.spots.map((s) => s.code))).toEqual(ex(key).parking.flatMap((z) => z.spots))
    }
    expect(IMPLANTACOES.luar.parking).toEqual([])
    expect(IMPLANTACOES.leplaza.parking).toEqual([])
  })
  it('Mount Juic: 6 blocos em H com 4 por andar, 60 vagas no estacionamento (e não uma torre de vagas)', async () => {
    const scene = await sceneOf('Condomínio Mount Juic')
    const layout = layoutFor(scene)
    expect(layout.buildings.map((b) => b.name)).toEqual(['Bloco A', 'Bloco B', 'Bloco C', 'Bloco D', 'Bloco E', 'Bloco F'])
    expect(layout.spots).toHaveLength(60)
    expect(layout.spots.every((s) => s.unitId && scene.units.find((u) => u.id === s.unitId)?.code === s.code)).toBe(true)
    expect(layout.units.size).toBe(180)
    for (const b of layout.buildings) {
      const perLevel = new Map<number, number>()
      for (const [, p] of layout.units) if (p.buildingId === b.id) perLevel.set(p.level!, (perLevel.get(p.level!) ?? 0) + 1)
      expect([...perLevel.values()].every((n) => n === 4)).toBe(true)
    }
    // O selo conta só apartamento: as vagas não entram na ocupação do bloco.
    expect(layout.buildings.every((b) => b.units.every((u) => u.kind !== 'parking'))).toBe(true)
    // Ordem do Tab: o andar mais alto do Bloco A primeiro; as vagas depois de todos os apartamentos.
    const code = (id: string) => scene.units.find((u) => u.id === id)!.code
    expect(layout.tabOrder.slice(0, 4).map(code)).toEqual(['A-401', 'A-402', 'A-403', 'A-404'])
    expect(layout.tabOrder.slice(120).map(code)).toEqual(ex('montjuic').parking[0].spots)
  })
  it('Lynx: 16 unidades por andar, do 2º ao 4º, na ordem do código', async () => {
    const scene = await sceneOf('Lynx Residence')
    const layout = layoutFor(scene)
    const b = layout.buildings[0]
    expect(b.levels.map((l) => l.label)).toEqual(ex('lynx').blocks[0].floors.map((f) => f.label))
    const byId = new Map(scene.units.map((u) => [u.id, u]))
    for (const n of [2, 3, 4]) {
      const ids = layout.tabOrder.filter((id) => byId.get(id)?.floor_label === `${n}º andar`)
      expect(ids.map((id) => byId.get(id)!.code)).toEqual(Array.from({ length: 16 }, (_, i) => `${n}${String(i + 1).padStart(2, '0')}`))
    }
    expect(layout.spots).toHaveLength(36)
  })
  it('Luar: 18 casas com telhado e garagem (a garagem é volume, não unidade)', async () => {
    const layout = layoutFor(await sceneOf('Condomínio Luar'))
    expect(layout.units.size).toBe(18)
    expect([...layout.units.values()].every((p) => p.roofed)).toBe(true)
    expect(layout.shapes.filter((s) => s.kind === 'volume' && s.key.includes('garagem'))).toHaveLength(18)
  })
  it('mostrar no mapa: a vaga enquadra a própria vaga; a vaga do subsolo, a laje do subsolo; o andar, o andar', async () => {
    const mj = layoutFor(await sceneOf('Condomínio Mount Juic'))
    const mjScene = await sceneOf('Condomínio Mount Juic')
    const spot = mjScene.units.find((u) => u.code === 'E-014')!
    const d1 = draw(mj, new Map(mjScene.units.map((u) => [u.id, u])), 0, '3d')
    expect(targetRect(d1, mj, { unitId: spot.id })).toEqual(d1.unitRects.get(spot.id))
    expect(d1.rings.get(spot.id)).toBeTruthy()

    const lpScene = await sceneOf('Edifício Le Plaza', USER.landlord)
    const lp = layoutFor(lpScene)
    const g1 = lpScene.units.find((u) => u.code === 'G1-003')!
    const place = lp.units.get(g1.id)!
    expect(place.slab).toBeTruthy()
    expect(lp.slabs.find((s) => s.key === place.slab)).toMatchObject({ level: -1, z0: -1, z1: 0 })
    expect(lp.tabOrder).not.toContain(g1.id) // sem desenho próprio: a laje responde por ela
    const d2 = draw(lp, new Map(lpScene.units.map((u) => [u.id, u])), 0, '3d')
    expect(targetRect(d2, lp, { unitId: g1.id })).toEqual(d2.levelRects.get(place.slab!))
    const torre = lp.buildings[0]
    expect(targetRect(d2, lp, { buildingId: torre.id, level: -2 })).toBeTruthy()
    expect(targetRect(d2, lp, { buildingId: torre.id, level: 12 })).toEqual(d2.levelRects.get(`${torre.id}|12`))
    // Torre: 26 andares de pé (térreo ao 25º) e só os andares 4, 12, 13 e 25 têm unidade.
    expect(torre.levels).toHaveLength(26)
    expect([...new Set([...lp.units.values()].filter((p) => !p.slab).map((p) => p.level))].sort((a, b) => a! - b!)).toEqual([4, 12, 13, 25])
  })
  it('proprietário convidado: só as unidades dele em cor; os outros blocos ficam de pé, neutros', async () => {
    const scene = await sceneOf('Condomínio Mount Juic', USER.owner)
    const layout = layoutFor(scene)
    expect(layout.buildings).toHaveLength(6)
    expect(layout.shapes.filter((x) => x.kind === 'unit').map((x) => x.unitId).every((id) => scene.units.some((u) => u.id === id))).toBe(true)
    expect(layout.shapes.filter((x) => x.kind === 'slot').every((x) => x.unitId === null)).toBe(true)
  })
})

// Câmera suave (07/11): o caminho do zoom e o canal do "mouse em cima".
describe('câmera do 3D e canal do mouse', () => {
  const cx = 500
  const cy = 300
  const from = { k: 1, x: 0, y: 0 }
  const to = { k: 4, x: -900, y: -600 }
  it('começa e termina exatamente onde deve', () => {
    expect(lerpView(from, to, 0, cx, cy)).toEqual(from)
    expect(lerpView(from, to, 1, cx, cy)).toEqual(to)
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.5) // saída suave: anda mais no começo
  })
  it('na metade, o zoom é a média geométrica (1 para 4 passa por 2) e o centro anda em linha reta', () => {
    const mid = lerpView(from, to, 0.5, cx, cy)
    expect(mid.k).toBeCloseTo(2, 10)
    // Ponto do desenho no centro do quadro: começo (500, 300), fim ((500 + 900) / 4, (300 + 600) / 4) = (350, 225).
    const center = (t: { k: number; x: number; y: number }) => [(cx - t.x) / t.k, (cy - t.y) / t.k]
    const [mx, my] = center(mid)
    expect(mx).toBeCloseTo((500 + 350) / 2, 10)
    expect(my).toBeCloseTo((300 + 225) / 2, 10)
  })
  it('canal do mouse: avisa só quando muda e para de avisar quem saiu', () => {
    const ch = createHoverChannel()
    let calls = 0
    const off = ch.subscribe(() => calls++)
    ch.set('a')
    ch.set('a') // repetido: ninguém é avisado
    ch.set(null)
    expect(calls).toBe(2)
    expect(ch.get()).toBeNull()
    off()
    ch.set('b')
    expect(calls).toBe(2)
    expect(ch.get()).toBe('b')
  })
})

// Giro suave (07/11): a câmera contínua começa no desenho que está na tela, passa pelos ângulos do
// meio e termina EXATAMENTE no desenho de 90 graus, sem resto, mesmo depois de muitos giros.
describe('giro suave do 3D', () => {
  const site: Site = { w: 30, h: 20 }
  const size = { w: 800, h: 500 }
  const view0 = { x: -500, y: -100, w: 1200, h: 700 }
  const view1 = { x: -400, y: -120, w: 1100, h: 720 }
  const sv0: SvgView = { rot: 3, mode: '3d', site, view: view0, size, pz: { k: 2.2, x: -300, y: -150 } }
  const pts: [number, number, number][] = [[0, 0, 0], [30, 20, 0], [7, 13, 4.5], [22, 3, 1], [15, 10, 25]]
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))

  it('o pivô é o ponto do mundo debaixo do meio do quadro, na altura pedida', () => {
    const pv = pivotAt(sv0, 400, 250, 2)
    close(svgPoint(sv0, pv.x, pv.y, pv.z), [400, 250])
    const planta: SvgView = { ...sv0, mode: 'planta', rot: 1 }
    const pp = pivotAt(planta, 120, 330, 0)
    close(svgPoint(planta, pp.x, pp.y, 0), [120, 330])
  })

  it('o primeiro quadro é o SVG de agora e o último é o SVG novo (3D e planta), com o pivô parado e o mesmo zoom', () => {
    const pivot = pivotAt(sv0, 400, 250, 2)
    const first = frameOfSvg(sv0, pivot)
    for (const [x, y, z] of pts) close(framePoint(first, pivot, x, y, z), svgPoint(sv0, x, y, z))
    const start = { whole: false, at: svgPoint(sv0, pivot.x, pivot.y, pivot.z), scale: meet(view0, size).s * sv0.pz.k }
    for (const mode of ['3d', 'planta'] as const) {
      const end = endOfTurn({ ...start, pivot, quarters: 4, mode, site, view: view1, size })
      const sv1: SvgView = { rot: 0, mode, site, view: view1, size, pz: end.pz }
      for (const [x, y, z] of pts) close(framePoint(end.frame, pivot, x, y, z), svgPoint(sv1, x, y, z))
      close(svgPoint(sv1, pivot.x, pivot.y, pivot.z), [400, 250]) // o ponto do meio continua no meio
      expect(meet(view1, size).s * end.pz.k).toBeCloseTo(start.scale, 9) // mesmo zoom
    }
    // Vendo o desenho inteiro: termina no desenho inteiro do giro novo.
    expect(endOfTurn({ ...start, whole: true, pivot, quarters: 4, mode: '3d', site, view: view1, size }).pz).toEqual({ k: 1, x: 0, y: 0 })
  })

  it('o ângulo no meio do caminho: curva que entra e sai devagar, e o fim é o próprio destino', () => {
    const pivot = { x: 15, y: 10, z: 0 }
    const from = frameOfSvg(sv0, pivot)
    const to: Frame = { cam: cameraOf(4, '3d'), scale: from.scale, at: from.at }
    const tw: Tween = { from, to, start: 1000, ms: TURN_MS, ease: easeInOut }
    expect(tweenAt(tw, 1000).frame.cam.psi).toBeCloseTo((3 * Math.PI) / 2, 12)
    expect(tweenAt(tw, 1000 + TURN_MS / 4).frame.cam.psi).toBeCloseTo((3 * Math.PI) / 2 + easeInOut(0.25) * (Math.PI / 2), 12)
    expect(tweenAt(tw, 1000 + TURN_MS / 2).frame.cam.psi).toBeCloseTo((7 * Math.PI) / 4, 12)
    expect(easeInOut(0.25)).toBeLessThan(0.25) // começa devagar
    const last = tweenAt(tw, 1000 + TURN_MS + 5)
    expect(last.done).toBe(true)
    expect(last.frame).toBe(to)
    expect(cosSin(last.frame.cam.psi)).toEqual([1, 0]) // 360 graus: cos 1 e sin 0, sem resto
  })

  it('mil giros para os dois lados, redirecionados no meio: termina num quarto de volta exato, igual ao SVG', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const pivot = { x: 15, y: 10, z: 3 }
    let q = 0
    let now = 0
    let tw: Tween | null = null
    for (let i = 0; i < 1000; i++) {
      q += rnd() < 0.5 ? 1 : -1
      const to: Frame = { cam: cameraOf(q, '3d'), scale: 3, at: [400, 250] }
      const from: Frame = tw ? tweenAt(tw, now).frame : to
      tw = { from, to, start: now, ms: RETARGET_MS, ease: easeOutTurn }
      now += rnd() * 500 // às vezes no meio do giro, às vezes depois de acabar
    }
    const end = tweenAt(tw!, now + 10_000)
    expect(end.done).toBe(true)
    expect(end.frame.cam.psi).toBe(q * (Math.PI / 2))
    expect(cosSin(end.frame.cam.psi)).toEqual([[1, 0], [0, 1], [-1, 0], [0, -1]][rotOf(q)])
    const rot = rotOf(q)
    const pz = pzOfFrame(end.frame, pivot, rot, '3d', site, view1, size)
    for (const [x, y, z] of pts) close(framePoint(end.frame, pivot, x, y, z), svgPoint({ rot, mode: '3d', site, view: view1, size, pz }, x, y, z))
  })

  it('faces num ângulo do meio (45 graus): só as paredes viradas para a câmera; a de quina some', () => {
    const pivot = { x: 10, y: 10, z: 0 }
    const at45: Frame = { cam: { ...cameraOf(0, '3d'), psi: Math.PI / 4 }, scale: 1, at: [0, 0] }
    // Prisma girado 30 graus no terreno, visto a 45: normais a -15 e 75 graus (para a câmera); 165 e 255 ficam atrás.
    const faces = facesAt({ poly: rectPoly(10, 10, 4, 2, 30), z0: 0, z1: 1 }, at45, pivot)
    const walls = faces.filter((f) => f.kind === 'wall')
    expect(walls.map((f) => f.edge)).toEqual([0, 1])
    const rad = (d: number) => (d * Math.PI) / 180
    expect(walls.map((f) => f.shade)).toEqual([wallShade(Math.cos(rad(-15)), Math.sin(rad(-15))), wallShade(Math.cos(rad(75)), Math.sin(rad(75)))])
    expect(faces.filter((f) => f.kind === 'top')).toHaveLength(1)
    // Caixa alinhada à grade vista a 45 graus: só a parede de frente (+x); as duas de lado ficam de quina e somem.
    const box = facesAt({ poly: boxPoly(9, 9, 11, 10), z0: 0, z1: 2 }, at45, pivot).filter((f) => f.kind === 'wall')
    expect(box.map((f) => f.edge)).toEqual([1])
    // Câmera de planta (sem altura): só o topo.
    expect(facesAt({ poly: rectPoly(10, 10, 4, 2, 30), z0: 0, z1: 1 }, { cam: cameraOf(0, 'planta'), scale: 1, at: [0, 0] }, pivot).map((f) => f.kind)).toEqual(['top'])
    // Num quarto de volta, as faces são as mesmas do desenho de sempre (mesmas paredes, mesma luz).
    const body = { poly: rectPoly(10, 10, 4, 2, 30), z0: 0, z1: 1 }
    for (const r of [0, 1, 2, 3] as Rot[]) {
      const turn = facesAt(body, { cam: cameraOf(r, '3d'), scale: 1, at: [0, 0] }, pivot)
      expect(turn.map((f) => [f.edge, f.shade])).toEqual(bodyFaces(body, r, { w: 30, h: 30 }, '3d').map((f) => [f.edge, f.shade]))
    }
  })
})

// Balão do clique (07/11): abre no clique, fica com o mouse em cima, some 2 s depois que o mouse sai.
describe('balão dos mapas', () => {
  type S = BalloonState<string> | null
  const open = (inside: boolean, now = 0, fadeMs = 180): S => balloonReducer<string>(null, { type: 'open', target: 'u1', inside, now, fadeMs })
  const inside = (s: S, v: boolean, now: number) => balloonReducer<string>(s, { type: 'inside', inside: v, now })
  const tick = (s: S, now: number) => balloonReducer<string>(s, { type: 'tick', now })

  it('abre no clique e fica aberto enquanto o mouse está em cima (nenhum relógio)', () => {
    const s = open(true)
    expect(s).toMatchObject({ target: 'u1', inside: true, fadeAt: null, closeAt: null })
    expect(balloonNextAt(s)).toBeNull()
    expect(tick(s, 60_000)).toBe(s)
    expect(inside(s, true, 5)).toBe(s) // nada mudou: o mesmo estado (a tela não redesenha)
  })

  it('saiu: 2 s depois esmaece e some; voltar antes (ou durante o esmaecer) zera a conta', () => {
    let s = inside(open(true), false, 1000)
    expect(s?.fadeAt).toBe(1000 + BALLOON_HIDE_MS)
    expect(tick(s, 2999)).toBe(s)
    const back = inside(s, true, 2500)
    expect(back).toMatchObject({ inside: true, fadeAt: null })
    expect(tick(back, 9000)).toBe(back)
    s = tick(inside(back, false, 4000), 6000)
    expect(s).toMatchObject({ fadeAt: null, closeAt: 6180 }) // esmaecendo
    expect(inside(s, true, 6100)).toMatchObject({ inside: true, fadeAt: null, closeAt: null })
    expect(tick(s, 6180)).toBeNull()
  })

  it('Esc e clique no vazio fecham; aberto pelo teclado com o foco já fora, conta 2 s; sem movimento, some direto', () => {
    expect(balloonReducer<string>(open(true), { type: 'close' })).toBeNull()
    expect(open(false, 500)?.fadeAt).toBe(2500)
    expect(tick(open(false, 0, 0), 2000)).toBeNull()
  })

  it('o balão nunca cobre a coisa que explica e fica dentro do desenho', () => {
    const area = { w: 700, h: 460 }
    const box = { w: 248, h: 120 }
    // No meio: acima. Perto do topo: abaixo. Coisa alta encostada em cima e embaixo: ao lado.
    expect(placeBalloon({ x: 300, y: 250, w: 40, h: 30 }, box, area).side).toBe('above')
    expect(placeBalloon({ x: 300, y: 40, w: 40, h: 30 }, box, area).side).toBe('below')
    expect(placeBalloon({ x: 100, y: 20, w: 60, h: 420 }, box, area).side).toBe('right')
    type R = { x: number; y: number; w: number; h: number }
    const overlap = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    for (let x = -20; x <= 680; x += 35)
      for (let y = -10; y <= 440; y += 25) {
        const anchor = { x, y, w: 36, h: 28 }
        const p = placeBalloon(anchor, box, area)
        const r = { x: p.left, y: p.top, w: box.w, h: box.h }
        expect(overlap(r, anchor)).toBe(false)
        expect(r.x).toBeGreaterThanOrEqual(8)
        expect(r.y).toBeGreaterThanOrEqual(8)
        expect(r.x + r.w).toBeLessThanOrEqual(area.w - 8)
        expect(r.y + r.h).toBeLessThanOrEqual(area.h - 8)
      }
  })
})
