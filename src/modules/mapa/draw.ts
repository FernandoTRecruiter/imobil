/* =============================================================================
   draw.ts: do layout (corpos no terreno, chão, vagas) para o DESENHO de um giro e de um modo
   (3D ou planta): caminhos SVG já na ordem de pintura, rótulos, anéis de foco e selos.

   É a parte "cara" (centenas de faces), por isso a tela guarda o resultado (useMemo) e só
   refaz quando muda a cena, o giro ou o modo. Filtro, seleção, foco e andar isolado NÃO
   refazem a conta: viram atributos na hora de desenhar.
   ============================================================================= */
import type { UnitRow } from '@/data/views/units'
import { bodyCorners, bodyFaces, bodyView, boundsOf, centroid, depthOrder, hullPath, project, toView, TW, type Body, type Pt, type Rot, type Shade, type ViewMode } from './iso'
import { fitCode, slabKey, type GroundLine, type GroundPiece, type GroundText, type Layout, type ShapeKind, type VolumeTone } from './layout'

export interface Label {
  x: number
  y: number
  text: string
}

export interface Painted {
  key: string
  kind: ShapeKind
  unitId: string | null
  buildingId: string | null
  level: number | null
  tone?: VolumeTone
  faces: { d: string; shade: Shade }[]
  /** Onde o código pode ir: no topo (t) ou numa parede que dá para fora (side). A tela escolhe conforme o andar isolado. */
  labels: { t?: Label; side?: Label }
  /** Árvore: centro e raio da copa e o tronco, já na tela. */
  tree?: { cx: number; cy: number; r: number; trunk: string }
}

export interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Drawing {
  view: ViewBox
  ground: { key: string; kind: GroundPiece['kind']; d: string }[]
  lines: { key: string; kind: GroundLine['kind']; d: string }[]
  texts: { key: string; kind: GroundText['kind']; x: number; y: number; text: string }[]
  shadows: string[]
  /** Vagas no chão (pintadas pela situação), com o número quando cabe. */
  spots: { key: string; unitId: string | null; d: string; label?: Label }[]
  /** Lajes de subsolo (raio X). */
  slabs: { key: string; buildingId: string; level: number; faces: string[] }[]
  painted: Painted[]
  /** Contorno de cada unidade (anel do foco e da seleção) e o retângulo dela na tela (enquadrar). */
  rings: Map<string, string>
  unitRects: Map<string, ViewBox>
  /** Ponto de cima de cada unidade (onde o balão aponta). */
  anchors: Map<string, Pt>
  /** Contorno e retângulo de cada andar de cada bloco (chave slabKey): o foco num andar ou num subsolo. */
  levelRings: Map<string, string>
  levelRects: Map<string, ViewBox>
  badges: { id: string; x: number; y: number }[]
  /** Retângulo de cada bloco na tela (enquadrar ao escolher o bloco). */
  buildingRects: Map<string, ViewBox>
  /** Contorno de cada bloco (do chão ao telhado): acende quando o mouse passa no bloco. */
  buildingRings: Map<string, string>
  /** Unidades com o topo à mostra (último andar, sem telhado): o código vai no topo. */
  openTop: Set<string>
}

/** O alvo do "mostrar no mapa": uma unidade (apartamento, casa, sala ou vaga) ou um andar de um bloco. */
export type MapTarget = { unitId: string } | { buildingId: string; level: number }

/**
 * Retângulo do alvo na tela do desenho (o que o zoom enquadra): a unidade ou a vaga; a vaga de
 * subsolo, que não tem desenho próprio, enquadra a laje do subsolo dela; o andar, o andar inteiro.
 */
export function targetRect(d: Drawing, layout: Layout, t: MapTarget | null): ViewBox | undefined {
  if (!t) return undefined
  if ('unitId' in t) {
    const slab = layout.units.get(t.unitId)?.slab
    return slab ? d.levelRects.get(slab) : d.unitRects.get(t.unitId)
  }
  return d.levelRects.get(slabKey(t.buildingId, t.level))
}

const r1 = (v: number) => Math.round(v * 10) / 10
const pathOf = (pts: Pt[], close = true) => 'M' + pts.map((p) => `${r1(p[0])},${r1(p[1])}`).join('L') + (close ? 'Z' : '')

/** Número da vaga para escrever nela: "E-014" vira "14" (o código inteiro fica no balão e no leitor de tela). */
export function spotNumber(code: string): string {
  const m = code.match(/(\d+)\D*$/)
  return m ? String(Number(m[1])) : code
}

/** Cantos de um bloco na tela (base de cada peça do chão até o topo): o retângulo, o contorno e o selo saem daqui. */
const plateCorners = (b: Layout['buildings'][number], rot: Rot, site: Layout['site'], mode: ViewMode): Pt[] => b.plate.flatMap((p) => bodyCorners({ poly: p, z0: 0, z1: b.top }, rot, site, mode))

/** Onde fica o selo do bloco: no 3D, flutuando acima do telhado; na planta, logo acima da borda de cima do bloco (no meio cobriria os códigos). */
function badgeAt(b: Layout['buildings'][number], box: ViewBox, rot: Rot, site: Layout['site'], mode: ViewMode): Pt {
  const [a, bb] = toView((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, rot, site)
  const [px, py] = project(a, bb, b.top, mode)
  return mode === '3d' ? [px, py - 30] : [box.x + box.w / 2, box.y - 18]
}

/**
 * O quadro do desenho (viewBox) de um giro e de um modo, sem montar o desenho: o terreno, todo
 * corpo que não é vizinho e o selo de cada bloco, com folga (mais em cima, para a trilha não cobrir
 * o selo). O draw usa esta mesma conta; o giro suave (giro.ts) usa para saber, já no clique, onde o
 * desenho novo vai assentar (sem esperar a conta inteira dele).
 */
export function sceneView(layout: Layout, rot: Rot, mode: ViewMode): ViewBox {
  const { site } = layout
  const corners: Pt[] = layout.frame.map(([x, y]) => project(...toView(x, y, rot, site), 0, mode))
  for (const s of layout.shapes) if (s.kind !== 'ctx') corners.push(...bodyCorners(s.body, rot, site, mode))
  for (const b of layout.buildings) {
    const [x, y] = badgeAt(b, boundsOf(plateCorners(b, rot, site, mode), 0), rot, site, mode)
    corners.push([x, y - 16])
  }
  const fit = boundsOf(corners, 28)
  return { ...fit, y: fit.y - 36, h: fit.h + 36 }
}

/**
 * Monta o desenho. Passo a passo:
 * 1. chão (na ordem da lista), linhas pintadas, textos e vagas, achatados em z = 0;
 * 2. sombra de cada bloco, volume e árvore: a base esticada para a direita da tela (luz da esquerda);
 * 3. lajes de subsolo (abaixo do chão) e corpos na ordem de pintura (iso.ts), com as faces
 *    visíveis e os lugares do código;
 * 4. anel, retângulo e ponto do balão de cada unidade; contorno de cada andar; selo e contorno de
 *    cada bloco; o quadro (viewBox) que cabe o terreno (sceneView).
 */
export function draw(layout: Layout, units: Map<string, UnitRow>, rot: Rot, mode: ViewMode): Drawing {
  const { site } = layout
  const flat = (pts: Pt[]): Pt[] =>
    pts.map(([x, y]) => {
      const [a, b] = toView(x, y, rot, site)
      return project(a, b, 0, mode)
    })

  // 1. Chão, linhas, textos e vagas.
  const ground = layout.ground.map((g) => ({ key: g.key, kind: g.kind, d: pathOf(flat(g.poly)) }))
  const lines = layout.lines.map((l) => ({ key: l.key, kind: l.kind, d: pathOf(flat(l.pts), !!l.closed) }))
  const texts = layout.texts.map((t) => {
    const [x, y] = flat([t.at])[0]
    return { key: t.key, kind: t.kind, x: r1(x), y: r1(y), text: t.text }
  })
  const spots = layout.spots.map((s) => {
    const scr = flat(s.poly)
    const [cx, cy] = centroid(scr)
    const xs = scr.map((p) => p[0])
    const text = fitCode(spotNumber(s.code), Math.max(...xs) - Math.min(...xs), 6)
    return { key: s.key, unitId: s.unitId, d: pathOf(scr), label: text ? { x: r1(cx), y: r1(cy), text } : undefined }
  })

  // 2. Sombras (só no 3D: de cima não há sombra para ver). Comprimento pela altura, com teto.
  const shadows: string[] = []
  const shadowOf = (poly: Pt[], top: number) => {
    const len = Math.min(4, top * 0.45)
    const v = poly.map(([x, y]) => toView(x, y, rot, site))
    const moved = v.map(([a, b]) => [a + len, b + len * 0.25] as Pt)
    shadows.push(hullPath([...v, ...moved].map(([a, b]) => project(a, b, 0, mode))))
  }
  if (mode === '3d') {
    for (const b of layout.buildings) for (const p of b.plate) shadowOf(p, b.top)
    for (const s of layout.shapes) if ((s.kind === 'volume' && s.body.z0 < 0.05) || s.kind === 'tree') shadowOf(s.body.poly, s.body.z1 * (s.kind === 'tree' ? 0.7 : 1))
  }

  // 3. Subsolos e corpos.
  const slabs = mode === '3d' ? layout.slabs.map((sl) => ({ key: sl.key, buildingId: sl.buildingId, level: sl.level, faces: sl.pieces.flatMap((p) => bodyFaces({ poly: p, z0: sl.z0, z1: sl.z1 }, rot, site, mode).map((f) => f.d)) })) : []
  const items = layout.shapes.map((s) => ({ s, vp: bodyView(s.body, rot, site), z0: s.body.z0, z1: s.body.z1 }))
  // Rótulo de cada unidade: a peça que leva o código é a de maior topo (código no topo) e a de
  // parede de fora mais larga (código na fachada). Decidido antes, para pôr o texto numa peça só.
  const labelHost = new Map<string, { t?: { key: string; w: number; label: Label }; side?: { key: string; w: number; label: Label } }>()
  const facesOf = new Map<string, ReturnType<typeof bodyFaces>>()
  for (const { s } of items) {
    const faces = bodyFaces(s.body, rot, site, mode)
    facesOf.set(s.key, faces)
    const u = s.kind === 'unit' && s.unitId ? units.get(s.unitId) : undefined
    if (!u) continue
    const host = labelHost.get(u.id) ?? {}
    for (const f of faces) {
      const text = fitCode(u.code, f.w)
      if (!text) continue
      const label = { x: f.cx, y: f.cy, text }
      if (f.edge < 0 && f.shade === 't' && !s.body.ridge) {
        if (!host.t || f.w > host.t.w) host.t = { key: s.key, w: f.w, label }
      } else if (f.edge >= 0 && s.outer?.[f.edge] !== false) {
        if (!host.side || f.w > host.side.w) host.side = { key: s.key, w: f.w, label }
      }
    }
    labelHost.set(u.id, host)
  }
  const painted: Painted[] = depthOrder(items, mode).map(({ s }) => {
    const labels: Painted['labels'] = {}
    const host = s.unitId ? labelHost.get(s.unitId) : undefined
    if (host?.t?.key === s.key) labels.t = host.t.label
    if (host?.side?.key === s.key && mode === '3d') labels.side = host.side.label
    const p: Painted = { key: s.key, kind: s.kind, unitId: s.unitId, buildingId: s.buildingId, level: s.level, tone: s.tone, faces: (facesOf.get(s.key) ?? []).map((f) => ({ d: f.d, shade: f.shade })), labels }
    if (s.tree) {
      // Copa: um círculo no alto (3D) ou no chão (planta); tronco do chão até a copa.
      const { x, y, r, h } = s.tree
      const [a, b] = toView(x, y, rot, site)
      const rr = mode === '3d' ? (r * TW) / 2 : r * 26
      const [gx, gy] = project(a, b, 0, mode)
      const [cx, cy] = mode === '3d' ? [gx, project(a, b, h, mode)[1] + rr] : [gx, gy]
      p.faces = []
      p.tree = { cx: r1(cx), cy: r1(cy), r: r1(rr), trunk: mode === '3d' ? `M${r1(gx)},${r1(gy)}L${r1(cx)},${r1(cy)}` : '' }
    }
    return p
  })

  // 4a. Anéis, retângulos e pontos do balão das unidades.
  const rings = new Map<string, string>()
  const unitRects = new Map<string, ViewBox>()
  const anchors = new Map<string, Pt>()
  for (const [id, place] of layout.units) {
    const pts = place.bodies.flatMap((b: Body) => bodyCorners(b, rot, site, mode))
    rings.set(id, hullPath(pts))
    const box = boundsOf(pts, 0)
    unitRects.set(id, box)
    anchors.set(id, [r1(box.x + box.w / 2), r1(box.y)])
  }
  // 4b. Contorno de cada andar de cada bloco (foco num andar) e de cada subsolo.
  const byLevel = new Map<string, Pt[]>()
  for (const s of layout.shapes) {
    if (!s.buildingId || s.level === null || (s.kind !== 'unit' && s.kind !== 'slot')) continue
    const key = slabKey(s.buildingId, s.level)
    byLevel.set(key, [...(byLevel.get(key) ?? []), ...bodyCorners(s.body, rot, site, mode)])
  }
  for (const sl of layout.slabs) byLevel.set(sl.key, sl.pieces.flatMap((p) => bodyCorners({ poly: p, z0: sl.z0, z1: sl.z1 }, rot, site, mode)))
  const levelRings = new Map<string, string>()
  const levelRects = new Map<string, ViewBox>()
  for (const [key, pts] of byLevel) {
    levelRings.set(key, hullPath(pts))
    levelRects.set(key, boundsOf(pts, 0))
  }
  // 4c. Selos, retângulos e contornos dos blocos.
  const badges: Drawing['badges'] = []
  const buildingRects = new Map<string, ViewBox>()
  const buildingRings = new Map<string, string>()
  for (const b of layout.buildings) {
    const pts = plateCorners(b, rot, site, mode)
    const box = boundsOf(pts, 0)
    buildingRects.set(b.id, box)
    buildingRings.set(b.id, hullPath(pts))
    const [x, y] = badgeAt(b, box, rot, site, mode)
    badges.push({ id: b.id, x: r1(x), y: r1(y) })
  }
  const openTop = new Set([...layout.units].filter(([, place]) => place.openTop).map(([id]) => id))
  const view = sceneView(layout, rot, mode)
  return { view, ground, lines, texts, shadows, spots, slabs, painted, rings, unitRects, anchors, levelRings, levelRects, badges, buildingRects, buildingRings, openTop }
}
