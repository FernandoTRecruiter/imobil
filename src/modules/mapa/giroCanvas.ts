/* =============================================================================
   giroCanvas.ts: PINTA o giro suave num <canvas> por cima do desenho SVG, quadro a quadro.

   Por que canvas (07/11/2026, medido no Edge, modo de desenvolvimento): trocar o giro no SVG
   custava de 100 a 280 ms num quadro só (Mount Juic): o React refaz centenas de caminhos e o
   navegador recalcula a cor (color-mix) de cada um. Pintar os mesmos ~1.000 polígonos num canvas
   leva poucos ms. Então, durante o giro, o canvas (opaco, da cor da prancha) cobre o SVG parado;
   no fim, o SVG do giro novo entra de uma vez e o canvas some, no mesmo quadro.

   As cores: o desenho tem a cor no CSS (mapa.css: por classe e atributo, com color-mix e as
   variáveis do tema claro ou escuro). Para o canvas pintar IGUAL, a "sonda" monta, escondida dentro
   do desenho, um elemento de cada tipo que a cena usa (unidade ocupada, vaga apagada, gramado...)
   e lê a cor que o navegador calculou (getComputedStyle). Uma vez por giro.

   O que fica de fora enquanto gira (volta no fim, com o SVG): códigos das unidades, nomes no chão,
   números das vagas, selos e anéis. O anel da unidade ESCOLHIDA gira junto: a pessoa não perde de
   vista a unidade que estava olhando.
   ============================================================================= */
import { centroid, cornersWith, depthOrder, FH, hullPts, prismFaces, PLANTA_S, TW, type Body, type Pt } from './iso'
import { frameTools, type Frame, type Pivot } from './giro'
import type { Layout, Shape } from './layout'

/** O jeito de pintar uma coisa, lido do CSS: preenchimento, contorno (cor, largura, tracejado), opacidade. */
export interface Paint {
  fill: string | null
  stroke: string | null
  width: number
  dash: number[]
  alpha: number
  cap: CanvasLineCap
  join: CanvasLineJoin
}

/** Material de um corpo: a cor de cada degrau de face (topo, depois paredes 0 a 4) e o contorno. */
interface Material {
  fills: (string | null)[]
  stroke: string | null
  width: number
}

/** Como um corpo aparece no desenho (quem sabe é o IsoCanvas): a classe, os atributos e se está "fantasma" (andar acima do isolado). */
export interface Look {
  cls: string
  attrs: Record<string, string | undefined>
  ghost: boolean
}

/** Tudo que o giro pinta, lido UMA vez no clique: formas no mundo (células) e o jeito de pintar cada uma. */
export interface TurnScene {
  bg: string | null
  ground: { poly: Pt[]; paint: Paint }[]
  lines: { pts: Pt[]; closed: boolean; paint: Paint }[]
  spots: { poly: Pt[]; paint: Paint }[]
  shadows: { poly: Pt[]; len: number }[]
  shadowPaint: Paint
  slabs: { body: Body; paint: Paint }[]
  bodies: { body: Body; mat: Material; alpha: number; tree?: { x: number; y: number; r: number; h: number } }[]
  tree: { trunk: Paint; crown: Paint; light: Paint }
  focus: Body[]
  focusPaint: Paint
}

/* ---------------------------------------------------------------- 1. a sonda das cores */

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Degraus de face, na ordem do Material.fills. */
const SHADES = ['t', '0', '1', '2', '3', '4'] as const

/**
 * Cor do CSS para o canvas. O navegador devolve color-mix já resolvido como "color(srgb r g b / a)";
 * aqui vira rgba(), que todo canvas entende. "none" e transparente viram null (não pinta).
 */
export function canvasColor(css: string): string | null {
  const v = css.trim()
  if (!v || v === 'none' || v.startsWith('url(') || v === 'transparent' || /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(v)) return null
  const m = v.match(/^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([-\d.e]+)(%?))?\s*\)$/)
  if (!m) return v
  const c = (x: string) => Math.round(Math.min(1, Math.max(0, Number(x))) * 255)
  const a = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1)
  return a <= 0 ? null : `rgba(${c(m[1])}, ${c(m[2])}, ${c(m[3])}, ${a})`
}

function paintOf(el: Element): Paint {
  const cs = getComputedStyle(el)
  const dash = cs.strokeDasharray === 'none' ? [] : cs.strokeDasharray.split(/[\s,]+/).map(parseFloat).filter((n) => n > 0)
  return {
    fill: canvasColor(cs.fill),
    stroke: canvasColor(cs.stroke),
    width: parseFloat(cs.strokeWidth) || 0,
    dash,
    alpha: parseFloat(cs.opacity) || 0,
    cap: (cs.strokeLinecap as CanvasLineCap) || 'butt',
    join: (cs.strokeLinejoin as CanvasLineJoin) || 'miter',
  }
}

const esc = (s: string) => s.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`)
const attrsOf = (a: Record<string, string | undefined>) =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(v!)}"`)
    .join('')

/**
 * Monta a sonda das cores: todas as "receitas" (a marcação de cada tipo de coisa, com a chave
 * dela) de uma vez, num SVG escondido com a classe do desenho, dentro de quem chama (host): as
 * variáveis de cor e o tema valem lá dentro. Devolve, por chave, o elemento a ler (o marcado com
 * data-alvo, ou o primeiro) e "remove", para tirar a sonda da página depois da leitura.
 */
function probe(host: Element, recipes: Map<string, string>): { els: Map<string, Element>; remove: () => void } {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'iso-svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none'
  const keys = [...recipes.keys()]
  svg.innerHTML = keys.map((k, i) => `<g data-probe="${i}">${recipes.get(k)}</g>`).join('')
  host.appendChild(svg)
  const els = new Map<string, Element>()
  keys.forEach((k, i) => {
    const box = svg.querySelector(`[data-probe="${i}"]`)!
    els.set(k, box.querySelector('[data-alvo]') ?? box.firstElementChild!)
  })
  return { els, remove: () => svg.remove() }
}

/* ---------------------------------------------------------------- 2. a cena do giro */

export interface TurnInput {
  layout: Layout
  /** Como cada corpo aparece (classe, atributos, fantasma); null = não pinta. */
  lookOf: (s: Shape) => Look | null
  /** Vagas: a classe e os atributos (situação, apagada). */
  spotLook: (unitId: string | null) => { cls: string; attrs: Record<string, string | undefined> }
  /** A laje de subsolo acesa (alvo no subsolo), se houver. */
  focusSlab: string | null
  /** As peças da unidade escolhida (o anel que gira junto); [] = nenhuma. */
  focus: Body[]
}

/**
 * Monta a cena do giro: as formas do layout (no mundo) e a tinta de cada uma, lida do CSS de
 * verdade (sonda). host = o elemento do desenho (a sonda herda o tema e as variáveis dele).
 */
export function buildTurnScene(host: Element, input: TurnInput): TurnScene {
  const { layout } = input
  const recipes = new Map<string, string>()
  const want = (key: string, markup: string) => {
    if (!recipes.has(key)) recipes.set(key, markup)
    return key
  }
  // 1. Receitas: chão, linhas, vagas, sombra, subsolo, árvore, anel e um material por aparência.
  const groundKeys = layout.ground.map((g) => want(`g:${g.kind}`, `<path class="g-${esc(g.kind)}"/>`))
  const lineKeys = layout.lines.map((l) => want(`l:${l.kind}`, `<path class="l-${esc(l.kind)}"/>`))
  const spotKeys = layout.spots.map((s) => {
    const look = input.spotLook(s.unitId)
    return want(`s:${look.cls}${attrsOf(look.attrs)}`, `<g class="${esc(look.cls)}"${attrsOf(look.attrs)}><path data-alvo=""/></g>`)
  })
  want('sombra', '<path class="iso-sombra"/>')
  want('sub', '<g class="iso-sub"><path data-alvo=""/></g>')
  want('sub:foco', '<g class="iso-sub" data-focus=""><path data-alvo=""/></g>')
  want('ghost', '<g data-ghost=""></g>')
  want('tree', '<g class="iso-tree"><path class="tr"/><circle class="cr"/><circle class="hl"/></g>')
  want('anel', '<path class="iso-ring" data-focus=""/>')
  const looks = layout.shapes.map((s) => input.lookOf(s))
  const matKeys = looks.map((lk) => (lk ? want(`m:${lk.cls}${attrsOf(lk.attrs)}`, `<g class="${esc(lk.cls)}"${attrsOf(lk.attrs)}>${SHADES.map((sh) => `<path class="f f-${sh}"/>`).join('')}</g>`) : null))

  // 2. A sonda: monta, lê e tira.
  const { els, remove } = probe(host, recipes)
  const paints = new Map<string, Paint>()
  const paint = (key: string) => {
    let p = paints.get(key)
    if (!p) paints.set(key, (p = paintOf(els.get(key)!)))
    return p
  }
  const mats = new Map<string, Material>()
  const material = (key: string): Material => {
    let m = mats.get(key)
    if (!m) {
      const faces = [...els.get(key)!.children]
      const first = paintOf(faces[0])
      mats.set(key, (m = { fills: faces.map((f) => canvasColor(getComputedStyle(f).fill)), stroke: first.stroke, width: first.width }))
    }
    return m
  }
  const ghostAlpha = paint('ghost').alpha
  const treeEl = els.get('tree')!
  const tree = { trunk: paintOf(treeEl.children[0]), crown: paintOf(treeEl.children[1]), light: paintOf(treeEl.children[2]) }
  const scene: TurnScene = {
    bg: canvasColor(getComputedStyle(host.closest('.iso-board') ?? host).backgroundColor),
    ground: layout.ground.map((g, i) => ({ poly: g.poly, paint: paint(groundKeys[i]) })),
    lines: layout.lines.map((l, i) => ({ pts: l.pts, closed: !!l.closed, paint: paint(lineKeys[i]) })),
    spots: layout.spots.map((s, i) => ({ poly: s.poly, paint: paint(spotKeys[i]) })),
    // 3. Sombras (as mesmas do draw.ts: base de cada bloco, volume no chão e árvore) e lajes de
    //    subsolo. Sempre na cena: o quadro decide quanto aparecem (nada na planta, aos poucos na passagem).
    shadows: [
      ...layout.buildings.flatMap((b) => b.plate.map((poly) => ({ poly, len: Math.min(4, b.top * 0.45) }))),
      ...layout.shapes.filter((s) => (s.kind === 'volume' && s.body.z0 < 0.05) || s.kind === 'tree').map((s) => ({ poly: s.body.poly, len: Math.min(4, s.body.z1 * (s.kind === 'tree' ? 0.7 : 1) * 0.45) })),
    ],
    shadowPaint: paint('sombra'),
    slabs: layout.slabs.flatMap((sl) => sl.pieces.map((poly) => ({ body: { poly, z0: sl.z0, z1: sl.z1 }, paint: paint(sl.key === input.focusSlab ? 'sub:foco' : 'sub') }))),
    bodies: [],
    tree,
    focus: input.focus,
    focusPaint: paint('anel'),
  }
  layout.shapes.forEach((s, i) => {
    const lk = looks[i]
    const key = matKeys[i]
    if (!lk || !key) return
    scene.bodies.push({ body: s.body, mat: material(key), alpha: lk.ghost ? ghostAlpha : 1, tree: s.tree })
  })
  remove()
  return scene
}

/* ---------------------------------------------------------------- 3. pintar um quadro */

/** A camada das sombras (um canvas fora da página, do tamanho do quadro), reaproveitada de giro em giro. */
let shadowCanvas: HTMLCanvasElement | null = null
function shadowLayer(w: number, h: number): CanvasRenderingContext2D | null {
  shadowCanvas ??= document.createElement('canvas')
  if (shadowCanvas.width !== w || shadowCanvas.height !== h) {
    shadowCanvas.width = w
    shadowCanvas.height = h
  }
  return shadowCanvas.getContext('2d')
}

function trace(ctx: CanvasRenderingContext2D, pts: Pt[], close = true) {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  if (close) ctx.closePath()
}

/** Preenche e contorna o caminho atual com a tinta; as medidas do CSS (no quadro do desenho) vão para px pela escala. */
function apply(ctx: CanvasRenderingContext2D, p: Paint, scale: number) {
  if (p.fill) {
    ctx.fillStyle = p.fill
    ctx.fill()
  }
  if (p.stroke && p.width > 0) {
    ctx.strokeStyle = p.stroke
    ctx.lineWidth = p.width * scale
    ctx.setLineDash(p.dash.length ? p.dash.map((d) => d * scale) : [])
    ctx.lineCap = p.cap
    ctx.lineJoin = p.join
    ctx.stroke()
  }
}

/**
 * Pinta um quadro do giro (w x h px do elemento, dpr = px reais por px). Passo a passo:
 * 1. a prancha (fundo opaco: cobre o SVG parado embaixo);
 * 2. chão, linhas pintadas e vagas, em z = 0;
 * 3. no que ainda é 3D: sombras (esfumadas) e lajes de subsolo, mais fracas quanto mais perto da planta;
 * 4. os corpos na ordem de pintura do quadro (depthOrder, recalculada no ângulo de agora), cada um
 *    com as faces visíveis (prismFaces) na cor do degrau de luz; árvore é tronco e copa;
 * 5. o anel da unidade escolhida, por cima de tudo (como no desenho).
 */
export function paintTurn(ctx: CanvasRenderingContext2D, scene: TurnScene, f: Frame, pv: Pivot, w: number, h: number, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  if (scene.bg) {
    ctx.fillStyle = scene.bg
    ctx.fillRect(0, 0, w, h)
  } else ctx.clearRect(0, 0, w, h)
  const { tv, P, toward, fromAbove } = frameTools(f, pv)
  const k = f.scale
  const flat = (pts: Pt[]) => pts.map(([x, y]) => P(tv(x, y), 0))
  // Quanto de 3D há neste quadro: 1 no 3D, 0 na planta (a sombra e o subsolo somem aos poucos).
  const depth = Math.min(1, Math.max(0, f.cam.h / FH))

  // 2. Chão.
  for (const g of scene.ground) {
    trace(ctx, flat(g.poly))
    apply(ctx, g.paint, k)
  }
  for (const l of scene.lines) {
    if (l.pts.length < 2) continue
    trace(ctx, flat(l.pts), l.closed)
    apply(ctx, l.paint, k)
  }
  for (const s of scene.spots) {
    trace(ctx, flat(s.poly))
    apply(ctx, s.paint, k)
  }

  // 3. Sombras e subsolos. As sombras vão numa camada à parte, sem esfumar, e a camada inteira entra
  //    esfumada UMA vez (como o grupo com filtro do SVG). Esfumar sombra por sombra custava um passe
  //    de desfoque para cada uma, a cada quadro.
  if (depth > 0.01 && scene.shadows.length && scene.shadowPaint.fill) {
    const layer = shadowLayer(ctx.canvas.width, ctx.canvas.height)
    if (layer) {
      layer.setTransform(dpr, 0, 0, dpr, 0, 0)
      layer.clearRect(0, 0, w, h)
      layer.fillStyle = scene.shadowPaint.fill
      for (const s of scene.shadows) {
        const v = s.poly.map(([x, y]) => tv(x, y))
        const moved = v.map(([a, b]) => [a + s.len, b + s.len * 0.25] as Pt)
        const hull = hullPts([...v, ...moved].map((p) => P(p, 0)))
        if (hull.length < 3) continue
        trace(layer, hull)
        layer.fill()
      }
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = depth
      ctx.filter = `blur(${(3 * k * dpr).toFixed(2)}px)`
      ctx.drawImage(layer.canvas, 0, 0)
      ctx.restore()
    }
  }
  if (depth > 0.01) {
    ctx.globalAlpha = depth
    for (const sl of scene.slabs) {
      for (const face of prismFaces(sl.body, tv, P, toward)) {
        trace(ctx, face.pts)
        apply(ctx, sl.paint, k)
      }
    }
    ctx.globalAlpha = 1
  }

  // 4. Corpos na ordem de pintura deste ângulo.
  const items = scene.bodies.map((it) => ({ it, vp: it.body.poly.map(([x, y]) => tv(x, y)), z0: it.body.z0, z1: it.body.z1 }))
  const strokeMin = 0.25 // contorno mais fino que isto some na tela: não vale o traço
  for (const { it } of depthOrder(items, fromAbove ? 'planta' : '3d')) {
    ctx.globalAlpha = it.alpha
    if (it.tree) {
      // Árvore: como no draw.ts (copa no alto no 3D, no chão na planta), com o meio-termo na passagem.
      const v = tv(it.tree.x, it.tree.y)
      const g = P(v, 0)
      const top = P(v, it.tree.h)
      const rr = it.tree.r * (PLANTA_S + (TW / 2 - PLANTA_S) * depth) * k
      const c: Pt = [g[0], top[1] + rr * depth]
      if (depth > 0.01 && scene.tree.trunk.stroke) {
        trace(ctx, [g, c], false)
        apply(ctx, { ...scene.tree.trunk, fill: null }, k)
      }
      ctx.beginPath()
      ctx.arc(c[0], c[1], rr, 0, Math.PI * 2)
      apply(ctx, scene.tree.crown, k)
      ctx.beginPath()
      ctx.arc(c[0] - rr * 0.28, c[1] - rr * 0.3, rr * 0.55, 0, Math.PI * 2)
      apply(ctx, { ...scene.tree.light, stroke: null }, k)
      continue
    }
    const sw = it.mat.width * k
    for (const face of prismFaces(it.body, tv, P, toward)) {
      trace(ctx, face.pts)
      const fill = it.mat.fills[face.shade === 't' ? 0 : face.shade + 1]
      if (fill) {
        ctx.fillStyle = fill
        ctx.fill()
      }
      if (it.mat.stroke && sw >= strokeMin) {
        ctx.strokeStyle = it.mat.stroke
        ctx.lineWidth = sw
        ctx.setLineDash([])
        ctx.lineJoin = 'round'
        ctx.stroke()
      }
    }
  }
  ctx.globalAlpha = 1

  // 5. Anel da unidade escolhida.
  if (scene.focus.length) {
    const ring = hullPts(scene.focus.flatMap((b) => cornersWith(b, tv, P)))
    if (ring.length >= 3) {
      trace(ctx, ring)
      apply(ctx, scene.focusPaint, k)
    }
  }
}

/** Centro do terreno (o pivô do giro quando a pessoa olha o desenho inteiro). */
export const sceneCenter = (layout: Layout): Pt => centroid(layout.frame)
