/* =============================================================================
   montar.ts: IMPLANTAÇÃO (a forma, feita à mão) + CENA (o banco: blocos, andares, unidades,
   vagas) = LAYOUT (o formato que o draw.ts desenha, o mesmo do caminho automático).

   Como cada coisa da cena acha o seu lugar (sempre por nome e código, nunca por id):
   - bloco: pelo NOME ("Bloco A"). Bloco da implantação que a sessão não enxerga (o proprietário
     convidado só vê os blocos onde tem unidade) é desenhado do mesmo jeito, neutro, com os
     andares de exemplos.ts: o prédio existe e qualquer um o vê da rua;
   - andar: pelo NÍVEL, de baixo para cima; subsolo (nível negativo) vira laje abaixo do chão;
   - unidade: pela POSIÇÃO no andar (a ordem da planta); sem posição, na primeira parte livre;
   - vaga: pelo CÓDIGO (E-001). Vaga que a sessão não vê fica só pintada no chão.
   Unidade que não achou lugar (bloco novo cadastrado pela pessoa, andar a mais) não some: a
   tabela embaixo do desenho continua mostrando todas.
   ============================================================================= */
import { EXEMPLOS } from '@/data/seed/exemplos'
import type { UnitRow } from '@/data/views/units'
import { boxPoly, type Body, type Pt } from '../iso'
import { assignSlots, emptyLayout, isSpot, ROOF, slabKey, type Layout, type Shape } from '../layout'
import type { MapScene, SceneFloor } from '../repo'
import type { BlocoSpec, Implantacao } from './tipos'

const same = (p: Pt, q: Pt) => Math.abs(p[0] - q[0]) < 1e-4 && Math.abs(p[1] - q[1]) < 1e-4

/**
 * Quais arestas de cada peça dão para FORA (não encostam em outra peça do mesmo andar).
 * É onde o código da unidade pode ir: numa parede que dá para a rua ou para o pátio, nunca
 * numa divisa com o vizinho de andar.
 */
export function outerEdges(pieces: Pt[][]): boolean[][] {
  const edges = pieces.map((p) => p.map((a, i) => [a, p[(i + 1) % p.length]] as [Pt, Pt]))
  return edges.map((es, pi) =>
    es.map(([a, b]) => !edges.some((other, oi) => oi !== pi && other.some(([c, d]) => (same(a, d) && same(b, c)) || (same(a, c) && same(b, d))))),
  )
}

/** Os andares do bloco: os da cena; sem o bloco na cena, os de exemplos.ts, sem unidade (só volume). */
function floorsOf(spec: Implantacao, block: BlocoSpec, scene: MapScene): { id: string; floors: SceneFloor[] } {
  const sb = scene.buildings.find((b) => b.name === block.name)
  if (sb) return { id: sb.id, floors: sb.floors }
  const ex = EXEMPLOS.find((e) => e.key === spec.key)?.blocks.find((b) => b.name === block.name)
  return {
    id: `implantacao:${spec.key}:${block.name}`,
    floors: (ex?.floors ?? []).map((f) => ({ id: null, level: f.level, label: f.label, slots: f.units.length, units: [] })),
  }
}

const bbox = (polys: Pt[][]) => {
  const xs = polys.flat().map((p) => p[0])
  const ys = polys.flat().map((p) => p[1])
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/**
 * Monta o layout. Passo a passo:
 * 1. chão, linhas e textos da implantação (o lote como gramado embaixo de tudo);
 * 2. bloco a bloco: subsolos (laje), andares de baixo para cima (planta do andar com a
 *    quantidade de unidades dele), telhado das casas e volumes do topo;
 * 3. vagas do estacionamento à parte, pelo código;
 * 4. volumes de apoio e árvores;
 * 5. ordem do Tab: bloco, andar de cima para baixo, posição; depois as vagas.
 */
export function buildImplantacao(scene: MapScene, spec: Implantacao): Layout {
  // O quadro inicial enquadra o LOTE (e os prédios, que o draw.ts soma): a rua e a calçada passam
  // da borda, como a cidade que continua. Enquadrar a prancha inteira deixaria o prédio pequeno.
  const L = emptyLayout(spec.site, spec.lot)
  // 1. Chão: a prancha (o mundo todo), o lote e o que a implantação pinta por cima.
  L.ground.push({ key: 'base', kind: 'base', poly: boxPoly(0, 0, spec.site.w, spec.site.h) }, { key: 'lote', kind: 'grama', poly: spec.lot })
  spec.ground.forEach((g, i) => L.ground.push({ key: `g${i}`, ...g }))
  spec.lines.forEach((l, i) => L.lines.push({ key: `l${i}`, ...l }))
  spec.texts.forEach((t, i) => L.texts.push({ key: `t${i}`, ...t }))
  L.lines.push({ key: 'divisa', kind: 'divisa', pts: spec.lot, closed: true })

  // 2. Blocos.
  for (const block of spec.blocks) {
    const { id, floors } = floorsOf(spec, block, scene)
    const shape = (s: Omit<Shape, 'buildingId'>) => L.shapes.push({ ...s, buildingId: id })
    // 2a. Subsolos: laje abaixo do chão; as vagas dele apontam para ela (nada de interior).
    for (const f of floors.filter((f) => f.level < 0)) {
      const key = slabKey(id, f.level)
      const pieces = block.basement ?? block.plate
      L.slabs.push({ key, buildingId: id, level: f.level, label: f.label, pieces, z0: f.level, z1: f.level + 1 })
      for (const u of f.units) L.units.set(u.id, { bodies: pieces.map((p) => ({ poly: p, z0: f.level, z1: f.level + 1 })), buildingId: id, level: f.level, openTop: false, roofed: false, slab: key })
    }
    // 2b. Andares do chão para cima: o nível conta a ordem, a altura conta a posição na pilha.
    const above = floors.filter((f) => f.level >= 0).sort((a, b) => a.level - b.level)
    const order: string[][] = []
    above.forEach((f, z) => {
      const top = z === above.length - 1
      const n = Math.max(f.slots, f.units.length)
      if (!n) {
        block.plate.forEach((p, i) => shape({ key: `vol:${id}:${f.level}:${i}`, kind: 'slot', unitId: null, level: f.level, body: { poly: p, z0: z, z1: z + 1 }, tone: f.level === 0 ? block.groundTone : undefined }))
        order.push([])
        return
      }
      const plan = block.plan(n)
      const all = [...plan.units.flat(), ...plan.neutral]
      const outer = outerEdges(all)
      let pi = 0
      const ids: string[] = []
      assignSlots(f.units, plan.units.length).forEach((u, j) => {
        const bodies: Body[] = []
        plan.units[j].forEach((p, k) => {
          const body = { poly: p, z0: z, z1: z + 1 }
          bodies.push(body)
          shape({ key: u ? `u:${u.id}:${k}` : `slot:${id}:${f.level}:${j}:${k}`, kind: u ? 'unit' : 'slot', unitId: u?.id ?? null, level: f.level, body, outer: outer[pi++] })
        })
        if (block.gable) {
          for (const [k, p] of plan.units[j].entries()) {
            const roof = { poly: p, z0: z + 1, z1: z + 1 + ROOF, ridge: block.gable }
            shape({ key: u ? `roof:${u.id}:${k}` : `roof:${id}:${f.level}:${j}:${k}`, kind: 'roof', unitId: u?.id ?? null, level: f.level, body: roof })
            bodies.push(roof)
          }
        }
        if (u) {
          L.units.set(u.id, { bodies, buildingId: id, level: f.level, openTop: top && !block.gable, roofed: !!block.gable })
          ids.push(u.id)
        }
      })
      plan.neutral.forEach((p, i) => shape({ key: `nucleo:${id}:${f.level}:${i}`, kind: 'slot', unitId: null, level: f.level, body: { poly: p, z0: z, z1: z + 1 }, outer: outer[pi++] }))
      order.push(ids)
    })
    const height = above.length
    for (const [i, rt] of (block.roofTop ?? []).entries()) shape({ key: `topo:${id}:${i}`, kind: 'volume', unitId: null, level: null, body: { poly: rt.poly, z0: height, z1: height + rt.h } })
    for (const ids of [...order].reverse()) L.tabOrder.push(...ids)
    const placed = above.flatMap((f) => f.units).filter((u) => L.units.has(u.id))
    L.buildings.push({
      id, name: block.name, ...bbox(block.plate),
      top: height + (block.gable ? ROOF : 0) + (block.roofTop?.length && !block.gable ? Math.max(...block.roofTop.map((r) => r.h)) : 0),
      levels: above.map((f) => ({ level: f.level, label: f.label })),
      units: placed.filter((u) => !isSpot(u)),
      plate: block.plate,
      tag: block.tag,
    })
  }

  // 3. Vagas do estacionamento à parte, pelo código.
  const spotUnits = new Map<string, UnitRow>()
  for (const lot of scene.lots) for (const u of lot.units) spotUnits.set(u.code, u)
  for (const zone of spec.parking)
    for (const s of zone.spots) {
      const u = spotUnits.get(s.code)
      L.spots.push({ key: `vaga:${zone.zone}:${s.code}`, unitId: u?.id ?? null, code: s.code, zone: zone.zone, poly: s.poly })
      if (!u) continue
      L.units.set(u.id, { bodies: [{ poly: s.poly, z0: 0, z1: 0 }], buildingId: null, level: null, openTop: true, roofed: false, spot: true })
      L.tabOrder.push(u.id)
    }

  // 4. Volumes de apoio e árvores (a árvore ocupa um quadrado do tamanho da copa).
  for (const v of spec.volumes) L.shapes.push({ key: `v:${v.key}`, kind: v.ctx ? 'ctx' : 'volume', buildingId: null, unitId: null, level: null, body: { poly: v.poly, z0: v.z0, z1: v.z1, ridge: v.ridge }, tone: v.tone })
  spec.trees.forEach((t, i) => {
    const r = t.r ?? 0.5
    const h = t.h ?? 1.55
    L.shapes.push({ key: `arvore:${i}`, kind: 'tree', buildingId: null, unitId: null, level: null, body: { poly: boxPoly(t.x - r, t.y - r, t.x + r, t.y + r), z0: 0, z1: h }, tree: { x: t.x, y: t.y, r, h } })
  })
  return L
}
