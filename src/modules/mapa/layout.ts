/* =============================================================================
   layout.ts: da CENA (blocos, andares, unidades que vêm do repo) para as FORMAS do
   desenho (corpos no terreno, chão, vagas). Também sem React: dá para testar.

   Dois caminhos chegam no MESMO formato (Layout), e o draw.ts não sabe qual veio:
   - IMPLANTAÇÃO (implantacao/): o empreendimento tem o desenho do terreno feito à mão
     (forma real dos prédios, ruas, lazer, estacionamento). Regra do Fernando: "se tem planta,
     usa a planta";
   - AUTOMÁTICO (buildLayout, aqui): imóvel sem implantação (cadastrado pela pessoa, ou
     antigo). Cada bloco vira um prédio retangular e cada andar é dividido em partes iguais
     pela quantidade de unidades. É o comportamento de antes, que continua valendo.

   O que sai do automático, em 5 peças:
   1. CAIXA DE CADA UNIDADE: o andar do bloco (modelo building_models: largura x
      profundidade em células) é dividido em partes iguais; a unidade ocupa a parte da
      posição dela (Unit.position). Parte sem unidade visível vira caixa neutra (é volume
      do prédio, sem dado de ninguém).
   2. CASAS: caixa de um andar + telhado de duas águas por cima.
   3. SUBSOLO: andar de nível negativo vira uma laje abaixo do chão, vista "em raio X"; as
      vagas dele não têm desenho próprio (nada de interior), a laje responde por elas.
   4. VAGAS SEM BLOCO (estacionamento à parte): fileiras de vagas ao lado dos prédios.
   5. VIZINHANÇA: o terreno do imóvel no meio, rua em volta e quadras com prédios baixos
      e neutros (é só cenário: dá a sensação de cidade, sem competir).
   E o TEXTO: o rótulo que o leitor de tela lê em cada unidade e o resumo por tipologia.
   ============================================================================= */
import { UNIT_KIND, UNIT_STATUS } from '@/data/labels'
import type { UnitStatus } from '@/data/types'
import { isSpot, type UnitRow } from '@/data/views/units'
import { mulberry32 } from '@/lib/random'
import { plural } from '@/lib/text'
import { bodyOf, boxPoly, type Body, type Pt, type Site, type Solid } from './iso'
import type { MapScene } from './repo'

/* ---------------------------------------------------------------- o formato comum */

export type ShapeKind = 'unit' | 'roof' | 'slot' | 'ctx' | 'volume' | 'tree'

/** Tom de um volume de apoio: branco (maquete), vidro (salão, academia) ou madeira (deck, pérgola). */
export type VolumeTone = 'branco' | 'vidro' | 'madeira'

/** Uma forma pronta para a conta do iso.ts, com o que ela representa. */
export interface Shape {
  key: string
  kind: ShapeKind
  body: Body
  buildingId: string | null
  unitId: string | null
  /** Nível do andar (para isolar andar); null = fora de prédio. */
  level: number | null
  /** Arestas da base que dão para FORA do prédio (onde o código pode ir). Sem a lista: todas. */
  outer?: boolean[]
  tone?: VolumeTone
  /** Árvore: copa redonda sobre um tronco; o corpo é só o espaço que ela ocupa (para a ordem de pintura). */
  tree?: { x: number; y: number; r: number; h: number }
}

/** Chão: pintado antes de tudo, na ordem da lista (o de baixo primeiro). */
export type GroundKind = 'rua' | 'quadra' | 'lote' | 'base' | 'asfalto' | 'calcada' | 'grama' | 'piso' | 'estac' | 'agua' | 'esporte' | 'areia' | 'deck' | 'rampa'

export interface GroundPiece {
  key: string
  kind: GroundKind
  poly: Pt[]
}

/** Linha pintada no chão: faixa da rua (tracejada), marcação da quadra, divisa do terreno. */
export interface GroundLine {
  key: string
  kind: 'faixa' | 'marca' | 'divisa'
  pts: Pt[]
  closed?: boolean
}

/** Texto no chão: nome de rua, de área (estacionamento) e de lazer. */
export interface GroundText {
  key: string
  kind: 'rua' | 'zona' | 'lazer'
  text: string
  at: Pt
}

/** Uma vaga no chão. unitId null = vaga que a sessão não vê (ou que não é administrada): só a pintura. */
export interface SpotPlace {
  key: string
  unitId: string | null
  code: string
  zone: string
  poly: Pt[]
}

/** Laje de subsolo (abaixo do chão), desenhada em raio X. */
export interface SlabPlace {
  key: string
  buildingId: string
  level: number
  label: string
  pieces: Pt[][]
  z0: number
  z1: number
}

export interface BuildingBox {
  id: string
  name: string
  /** Retângulo que envolve o bloco (selo, enquadrar). */
  x0: number
  y0: number
  x1: number
  y1: number
  /** Altura do topo (andares), para o selo ficar em cima. */
  top: number
  /** Andares de baixo para cima (nível e nome), sem os subsolos. */
  levels: { level: number; label: string }[]
  /** Unidades do bloco que não são vaga (o selo e o balão contam moradia e sala; vaga tem tabela própria). */
  units: UnitRow[]
  /** A base do bloco em peças convexas (sombra). */
  plate: Pt[][]
  /** Nome curto embaixo do selo ("Bloco A"), quando a cena tem vários blocos. */
  tag?: string
}

export interface UnitPlace {
  /** As peças da unidade (uma caixa; várias no canto arredondado). */
  bodies: Body[]
  buildingId: string | null
  level: number | null
  /** O topo da caixa fica à mostra (último andar, sem telhado)? */
  openTop: boolean
  /** Tem telhado por cima (casa): o anel inclui o telhado. */
  roofed: boolean
  /** Vaga no chão. */
  spot?: boolean
  /** Vaga de subsolo: sem desenho próprio; a laje (chave) responde por ela. */
  slab?: string
}

export interface Layout {
  site: Site
  /** O que o quadro inicial enquadra (o terreno): a vizinhança passa da borda, como uma cidade que continua. */
  frame: Pt[]
  shapes: Shape[]
  ground: GroundPiece[]
  lines: GroundLine[]
  texts: GroundText[]
  spots: SpotPlace[]
  slabs: SlabPlace[]
  buildings: BuildingBox[]
  units: Map<string, UnitPlace>
  /** Ordem de leitura para o Tab: bloco, andar de cima para baixo, posição; depois as vagas. */
  tabOrder: string[]
}

export const slabKey = (buildingId: string, level: number) => `${buildingId}|${level}`

/* ---------------------------------------------------------------- partes de um andar */

/**
 * Divide o andar (w x d células) em n partes iguais, em 1 ou 2 fileiras. Escolhe a divisão
 * com partes mais "quadradas" (a razão entre o lado maior e o menor mais perto de 1); parte
 * que sobra pesa um pouco. Empate: 2 fileiras (frente e fundos, como num prédio de verdade).
 * Ex.: 4 aptos em 4 x 2 = 2 x 2 partes de 2 x 1; 5 salas em 6 x 2 = 5 partes de 1,2 x 2.
 */
export function floorSlots(n: number, w: number, d: number): [number, number, number, number][] {
  if (n <= 0) return []
  let best = { rows: 1, cols: n, score: Infinity }
  for (let rows = 1; rows <= Math.min(2, n); rows++) {
    if (rows === 2 && d < 2) continue
    const cols = Math.ceil(n / rows)
    const cw = w / cols
    const rh = d / rows
    const score = Math.max(cw / rh, rh / cw) + (rows * cols - n) * 0.25
    if (score < best.score - 1e-9 || (Math.abs(score - best.score) < 1e-9 && rows > best.rows)) best = { rows, cols, score }
  }
  const cw = w / best.cols
  const rh = d / best.rows
  return Array.from({ length: n }, (_, i) => {
    const col = i % best.cols
    const row = Math.floor(i / best.cols)
    return [col * cw, row * rh, (col + 1) * cw, (row + 1) * rh] as [number, number, number, number]
  })
}

/** Cada unidade na parte da posição dela; sem posição (ou posição ocupada), na primeira parte livre. */
export function assignSlots<T extends { position: number | null }>(units: T[], slots: number): (T | null)[] {
  const out: (T | null)[] = new Array(slots).fill(null)
  const rest: T[] = []
  for (const u of units) {
    const i = (u.position ?? 0) - 1
    if (i >= 0 && i < slots && !out[i]) out[i] = u
    else rest.push(u)
  }
  for (const u of rest) {
    const free = out.indexOf(null)
    if (free >= 0) out[free] = u
  }
  return out
}

/** Vaga é unidade do tipo "parking": fica fora do selo, do balão do bloco e da tabela de unidades (regra da camada de dados). */
export { isSpot }

/* ---------------------------------------------------------------- o caminho automático */

const LOT_MARGIN = 1.6 // folga do terreno em volta dos blocos
const STREET = 1.4 // largura da rua
const BLOCK = 3.2 // profundidade das quadras vizinhas
const RINGS = 2 // anéis de quadras em volta do terreno (a cidade precisa encher o quadro)
export const ROOF = 0.55 // altura do telhado (em andares)
/** Vaga: 0,7 x 1,4 célula (uma célula tem uns 4 m: 2,8 x 5,6 m). Fileira do automático: até 12 vagas. */
export const SPOT_W = 0.7
export const SPOT_D = 1.4
const SPOTS_PER_ROW = 12

/** Número estável a partir de um texto (FNV-1a): mesma cena, mesma vizinhança, em toda abertura. */
export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Um layout vazio para preencher (os dois caminhos começam daqui). */
export function emptyLayout(site: Site, frame: Pt[]): Layout {
  return { site, frame, shapes: [], ground: [], lines: [], texts: [], spots: [], slabs: [], buildings: [], units: new Map(), tabOrder: [] }
}

/**
 * Monta o desenho automático da cena. Passo a passo:
 * 1. contorno dos blocos (posição site_x/site_y + largura x profundidade do modelo) e, abaixo
 *    deles, o espaço das fileiras de vagas sem bloco;
 * 2. terreno = contorno + folga; mundo = terreno + rua + quadras; tudo deslocado para começar em 0;
 * 3. bloco a bloco, andar a andar: subsolo vira laje; os outros andares, partes, unidades,
 *    caixas neutras e telhados;
 * 4. vagas sem bloco em fileiras, na ordem do código;
 * 5. prédios vizinhos baixos nas quadras em volta, um andar por forma.
 */
export function buildLayout(scene: MapScene): Layout {
  const bs = scene.buildings
  // 1. Vagas sem bloco ficam numa faixa abaixo dos blocos (ou no começo do terreno, sem bloco).
  const lots = scene.lots ?? []
  const spotRows = lots.reduce((n, l) => n + Math.ceil(l.units.length / SPOTS_PER_ROW), 0)
  const blocksBottom = bs.length ? Math.max(...bs.map((b) => b.site_y + b.depth)) : 0
  const parkY = bs.length ? blocksBottom + 1.6 : 0
  const parkW = Math.min(SPOTS_PER_ROW, Math.max(0, ...lots.map((l) => l.units.length))) * SPOT_W
  const parkH = spotRows ? spotRows * SPOT_D + (spotRows - 1) * 0.5 : 0
  const bx0 = Math.min(0, ...bs.map((b) => b.site_x))
  const by0 = Math.min(0, ...bs.map((b) => b.site_y))
  const bx1 = Math.max(2, parkW, ...bs.map((b) => b.site_x + b.width))
  const by1 = Math.max(2, spotRows ? parkY + parkH : 0, ...bs.map((b) => b.site_y + b.depth))
  // 2. Terreno e mundo.
  const ring = (STREET + BLOCK) * RINGS
  const ox = -(bx0 - LOT_MARGIN - ring)
  const oy = -(by0 - LOT_MARGIN - ring)
  const lot = { x0: bx0 - LOT_MARGIN + ox, y0: by0 - LOT_MARGIN + oy, x1: bx1 + LOT_MARGIN + ox, y1: by1 + LOT_MARGIN + oy }
  const site: Site = { w: lot.x1 + ring, h: lot.y1 + ring }
  const L = emptyLayout(site, boxPoly(lot.x0, lot.y0, lot.x1, lot.y1))
  const push = (s: Omit<Shape, 'body'> & { solid: Solid }) => {
    const { solid, ...rest } = s
    L.shapes.push({ ...rest, body: bodyOf(solid) })
  }

  // 3. Blocos.
  for (const b of bs) {
    const x = b.site_x + ox
    const y = b.site_y + oy
    const house = b.template === 'house' || b.template === 'row_houses'
    const gap = house ? 0.14 : 0 // casas em fila: uma folga para cada casa ser uma casa
    // 3a. Volume embaixo (apartamento avulso: o prédio em volta, neutro).
    for (let k = 0; k < b.base_floors; k++) {
      push({ key: `base:${b.id}:${k}`, kind: 'slot', buildingId: b.id, unitId: null, level: null, solid: { form: 'box', x0: x, y0: y, x1: x + b.width, y1: y + b.depth, z0: k, z1: k + 1 } })
    }
    // 3b. Subsolos: laje abaixo do chão; as vagas dele apontam para a laje.
    for (const f of b.floors.filter((f) => f.level < 0)) {
      const key = slabKey(b.id, f.level)
      L.slabs.push({ key, buildingId: b.id, level: f.level, label: f.label, pieces: [boxPoly(x, y, x + b.width, y + b.depth)], z0: f.level, z1: f.level + 1 })
      for (const u of f.units) L.units.set(u.id, { bodies: [{ poly: boxPoly(x, y, x + b.width, y + b.depth), z0: f.level, z1: f.level + 1 }], buildingId: b.id, level: f.level, openTop: false, roofed: false, slab: key })
    }
    // 3c. Andares do chão para cima.
    const floors = b.floors.filter((f) => f.level >= 0)
    floors.forEach((f, i) => {
      const z0 = b.base_floors + i
      const slots = floorSlots(Math.max(f.slots, f.units.length), b.width, b.depth)
      const top = i === floors.length - 1
      if (!slots.length) {
        push({ key: `vol:${b.id}:${f.level}`, kind: 'slot', buildingId: b.id, unitId: null, level: f.level, solid: { form: 'box', x0: x, y0: y, x1: x + b.width, y1: y + b.depth, z0, z1: z0 + 1 } })
        return
      }
      assignSlots(f.units, slots.length).forEach((u, j) => {
        const [sx0, sy0, sx1, sy1] = slots[j]
        const solid: Solid = { form: 'box', x0: x + sx0 + gap, y0: y + sy0 + gap, x1: x + sx1 - gap, y1: y + sy1 - gap, z0, z1: z0 + 1 }
        // Aresta para fora: a da borda do bloco (o código vai na fachada, não numa parede de dentro).
        const outer = [Math.abs(sy0) < 1e-6, Math.abs(sx1 - b.width) < 1e-6, Math.abs(sy1 - b.depth) < 1e-6, Math.abs(sx0) < 1e-6]
        if (!u) {
          push({ key: `slot:${b.id}:${f.level}:${j}`, kind: 'slot', buildingId: b.id, unitId: null, level: f.level, solid, outer })
          if (house) push({ key: `roof:${b.id}:${f.level}:${j}`, kind: 'roof', buildingId: b.id, unitId: null, level: f.level, solid: { ...solid, form: 'gable', z0: z0 + 1, z1: z0 + 1 + ROOF } })
          return
        }
        push({ key: `u:${u.id}`, kind: 'unit', buildingId: b.id, unitId: u.id, level: f.level, solid, outer })
        const bodies = [bodyOf(solid)]
        if (house) {
          const ridge = sx1 - sx0 >= sy1 - sy0 ? 'x' : 'y'
          const roof: Solid = { ...solid, form: 'gable', ridge, z0: z0 + 1, z1: z0 + 1 + ROOF }
          push({ key: `roof:${u.id}`, kind: 'roof', buildingId: b.id, unitId: u.id, level: f.level, solid: roof })
          bodies.push(bodyOf(roof))
        }
        L.units.set(u.id, { bodies, buildingId: b.id, level: f.level, openTop: top && !house, roofed: house })
      })
    })
    for (const f of [...floors].reverse()) L.tabOrder.push(...f.units.map((u) => u.id))
    L.buildings.push({
      id: b.id, name: b.name, x0: x, y0: y, x1: x + b.width, y1: y + b.depth,
      top: b.base_floors + floors.length + (house ? ROOF : 0),
      levels: floors.map((f) => ({ level: f.level, label: f.label })),
      units: floors.flatMap((f) => f.units).filter((u) => !isSpot(u)),
      plate: [boxPoly(x, y, x + b.width, y + b.depth)],
    })
  }

  // 4. Vagas sem bloco: uma fileira de até 12 por vez, na ordem do código (E-001, E-002...).
  let row = 0
  for (const lotZone of lots) {
    const sorted = [...lotZone.units].sort((p, q) => p.code.localeCompare(q.code, 'pt-BR', { numeric: true }))
    sorted.forEach((u, i) => {
      const r = row + Math.floor(i / SPOTS_PER_ROW)
      const sx = bx0 + ox + (i % SPOTS_PER_ROW) * SPOT_W
      const sy = parkY + oy + r * (SPOT_D + 0.5)
      const poly = boxPoly(sx + 0.04, sy, sx + SPOT_W - 0.04, sy + SPOT_D)
      L.spots.push({ key: `vaga:${u.id}`, unitId: u.id, code: u.code, zone: lotZone.zone, poly })
      L.units.set(u.id, { bodies: [{ poly, z0: 0, z1: 0 }], buildingId: null, level: null, openTop: true, roofed: false, spot: true })
      L.tabOrder.push(u.id)
    })
    if (sorted.length) L.texts.push({ key: `zona:${lotZone.zone}`, kind: 'zona', text: lotZone.zone, at: [bx0 + ox, parkY + oy + row * (SPOT_D + 0.5) - 0.45] })
    row += Math.ceil(sorted.length / SPOTS_PER_ROW)
  }

  // 5. Vizinhança: quadras em anéis em volta do terreno (o meio da grade é o próprio terreno),
  //    cada uma com prédios baixos. Faixas de um eixo: [quadra][rua][quadra][rua][TERRENO][rua][quadra]...
  const bands = (lo: number, hi: number): [number, number][] => {
    const out: [number, number][] = []
    for (let r = RINGS; r >= 1; r--) out.push([lo - r * (STREET + BLOCK), lo - r * (STREET + BLOCK) + BLOCK])
    out.push([lo, hi])
    for (let r = 1; r <= RINGS; r++) out.push([hi + STREET + (r - 1) * (STREET + BLOCK), hi + r * (STREET + BLOCK)])
    return out
  }
  const xs = bands(lot.x0, lot.x1)
  const ys = bands(lot.y0, lot.y1)
  // Chão na ordem de pintura: rua (o mundo todo), quadras, terreno.
  L.ground.push({ key: 'rua', kind: 'rua', poly: boxPoly(0, 0, site.w, site.h) })
  const rnd = mulberry32(hashStr(scene.key))
  xs.forEach(([qx0, qx1], i) =>
    ys.forEach(([qy0, qy1], j) => {
      if (i === RINGS && j === RINGS) return
      L.ground.push({ key: `q${i}${j}`, kind: 'quadra', poly: boxPoly(qx0, qy0, qx1, qy1) })
      const corner = i !== RINGS && j !== RINGS
      const along = qx1 - qx0 >= qy1 - qy0 // a quadra é comprida em x?
      const len = along ? qx1 - qx0 : qy1 - qy0
      const across = along ? qy1 - qy0 : qx1 - qx0
      const count = Math.max(1, Math.min(6, Math.round(len / 3.4)))
      for (let n = 0; n < count; n++) {
        if (rnd() < 0.18) continue // um terreno vazio de vez em quando: a cidade não é um bloco só
        const seg = len / count
        const a0 = n * seg + 0.35
        const a1 = (n + 1) * seg - 0.35
        const depth = Math.min(across - 0.7, 1.3 + rnd() * 1.1)
        const c0 = (across - depth) / 2
        const floors = 1 + Math.floor(rnd() * (corner ? 3 : 2))
        const [x0, x1, y0, y1] = along ? [qx0 + a0, qx0 + a1, qy0 + c0, qy0 + c0 + depth] : [qx0 + c0, qx0 + c0 + depth, qy0 + a0, qy0 + a1]
        if (x1 - x0 < 0.6 || y1 - y0 < 0.6) continue
        push({ key: `ctx:${i}${j}:${n}`, kind: 'ctx', buildingId: null, unitId: null, level: null, solid: { form: 'box', x0, y0, x1, y1, z0: 0, z1: floors } })
      }
    }),
  )
  L.ground.push({ key: 'lote', kind: 'lote', poly: L.frame })
  return L
}

/* ---------------------------------------------------------------- texto */

/** Nome curto da unidade na cena: o código; no avulso, o nome do imóvel (o código "Casa" se repete). Vaga é sempre o código. */
export function unitName(u: Pick<UnitRow, 'code' | 'building_id' | 'property_name' | 'kind'>): string {
  return u.building_id || u.kind === 'parking' ? u.code : u.property_name
}

/** O que a unidade "é" em poucas palavras: "3 quartos", "vaga" ou, sem quarto (loja, sala), a área. */
export function typologyText(u: Pick<UnitRow, 'bedrooms' | 'area_m2' | 'kind'>): string {
  if (u.kind === 'parking') return 'vaga de garagem'
  return u.bedrooms > 0 ? plural(u.bedrooms, 'quarto', 'quartos') : `${u.area_m2.toLocaleString('pt-BR')} m²`
}

/**
 * Trilha (Imóvel › Bloco › Andar) sem nome repetido em seguida. No imóvel avulso o "bloco" tem o
 * nome do próprio imóvel e, sem esta regra, a trilha diria "Apartamento Sabiá, 958 › Apartamento
 * Sabiá, 958". Passo a passo: percorre na ordem; elo com o mesmo nome do anterior TOMA O LUGAR
 * dele (fica o mais fundo, que é o que diz onde a pessoa está e para onde o clique volta).
 */
export function trailCrumbs<T extends { label: string }>(crumbs: T[]): T[] {
  const out: T[] = []
  for (const c of crumbs) {
    if (out.length && out[out.length - 1].label === c.label) out[out.length - 1] = c
    else out.push(c)
  }
  return out
}

/** Rótulo do leitor de tela: "A-301, Ocupada, 3 quartos"; "E-014, Disponível, vaga de garagem". */
export function unitAriaLabel(u: Pick<UnitRow, 'code' | 'building_id' | 'property_name' | 'status' | 'bedrooms' | 'area_m2' | 'kind'>): string {
  return `${unitName(u)}, ${UNIT_STATUS[u.status]}, ${typologyText(u)}`
}

/**
 * Código que cabe na face: "A-301" cabe; "Sala 101" vira "S101" e, se nem isso couber,
 * fica sem texto (o nome continua no leitor de tela e no balão). Conta da largura:
 * cada letra de 9 px ocupa uns 5,6 px.
 */
export function fitCode(code: string, width: number, px = 9): string {
  const fits = (t: string) => t.length * px * 0.62 <= width - 4
  if (fits(code)) return code
  const parts = code.split(/\s+/)
  const short = parts.length > 1 ? parts[0][0] + parts[parts.length - 1] : code
  return fits(short) ? short : ''
}

export interface TypologyRow {
  key: string
  label: string
  total: number
  available: number
}

/** Resumo por tipologia (balão do bloco): quantas de cada nº de quartos (ou tipo, sem quarto) e quantas disponíveis. */
export function typologySummary(us: Pick<UnitRow, 'bedrooms' | 'kind' | 'status'>[]): TypologyRow[] {
  const m = new Map<string, TypologyRow & { order: number }>()
  for (const u of us) {
    const key = u.bedrooms > 0 ? `q${u.bedrooms}` : `k:${u.kind}`
    const row = m.get(key) ?? { key, label: u.bedrooms > 0 ? plural(u.bedrooms, 'quarto', 'quartos') : UNIT_KIND[u.kind], total: 0, available: 0, order: u.bedrooms > 0 ? u.bedrooms : 100 }
    row.total++
    if (u.status === 'available') row.available++
    m.set(key, row)
  }
  return [...m.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'pt-BR')).map((r) => ({ key: r.key, label: r.label, total: r.total, available: r.available }))
}

/** Ocupadas ÷ alugáveis (bloqueada não conta), a mesma conta da tela de Imóveis. */
export function occupancyOf(us: Pick<UnitRow, 'status'>[]): number {
  const rentable = us.filter((u) => u.status !== 'blocked').length
  return rentable ? Math.round((us.filter((u) => u.status === 'occupied').length / rentable) * 100) : 0
}

/** Contagem por situação (legenda). */
export function countByStatus(us: Pick<UnitRow, 'status'>[]): Record<UnitStatus, number> {
  const c: Record<UnitStatus, number> = { available: 0, occupied: 0, reserved: 0, maintenance: 0, blocked: 0 }
  for (const u of us) c[u.status]++
  return c
}
