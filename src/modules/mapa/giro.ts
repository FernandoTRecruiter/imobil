/* =============================================================================
   giro.ts: a CONTA do giro suave do 3D e da passagem 3D <-> planta. Só números: nada de React,
   nada de desenho (quem pinta é o giroCanvas.ts; quem comanda é o IsoCanvas.tsx).

   Por que existe (07/11/2026, pedido do Fernando: "girar ele tinha que ser algo smooth"): o
   desenho de sempre só conhece quartos de volta (iso.ts, toView). Para o giro ANDAR, cada quadro
   precisa da projeção de verdade num ângulo qualquer: girar os pontos do terreno em volta de um
   pivô, projetar, decidir de novo as faces visíveis (pela normal) e a ordem de pintura.

   A câmera contínua, em 4 números (Camera):
     vista:  (a, b) = (x, y) menos o pivô, girado do ângulo psi
     tela:   X = (a - b) * cx          Y = (a + b) * cy - (z - z do pivô) * h
   - 3D: psi = quartos * 90 graus, cx = TW/2, cy = TH/2, h = FH. É a projeção do iso.ts, sem o
     deslocamento (o deslocamento vira "onde o pivô aparece na tela");
   - planta: psi = quartos * 90 graus - 45 graus, cx = cy = S/√2, h = 0. A planta é o 3D girado 45
     graus, sem altura e sem o achatamento do losango.
   Por isso girar e passar para a planta são o MESMO movimento: os 4 números andam juntos.

   Começo e fim batem com o SVG: o primeiro quadro é exatamente o que está na tela e o último é
   exatamente o desenho novo com o zoom calculado já no clique (endOfTurn). A troca do quadro
   pintado pelo SVG, no fim, não pula. E o fim cai num quarto de volta EXATO: o destino é guardado
   em quartos inteiros (nunca somando ângulos quebrados), e cos/sin dos quartos são 0, 1 e -1 sem
   resto (cosSin). Mil giros depois, nada escorregou.
   ============================================================================= */
import { FH, fromView, PLANTA_S, prismFaces, project, TH, toView, TW, ZOOM_MAX, ZOOM_MIN, type Body, type PanZoom, type Pt, type RawFace, type Rot, type Site, type Vec3, type ViewMode } from './iso'

/** Duração de um quarto de volta: o bastante para o olho acompanhar, curto para não esperar. */
export const TURN_MS = 400
/** Clique de novo no meio do giro: o resto do caminho, um pouco mais curto (já está andando). */
export const RETARGET_MS = 340

const QUARTER = Math.PI / 2
const EPS = 1e-6

/* ---------------------------------------------------------------- 1. a câmera */

/** Câmera contínua: ângulo do terreno na vista (psi, radianos) e as três medidas da projeção. */
export interface Camera {
  psi: number
  cx: number
  cy: number
  h: number
}

/**
 * A câmera de um quarto de volta e de um modo. "quartos" pode passar de 3 ou ser negativo
 * (girar para a direita a partir do 3 vai ao 4, não volta ao 0 pelo caminho mais longo).
 */
export function cameraOf(quarters: number, mode: ViewMode): Camera {
  return mode === '3d'
    ? { psi: quarters * QUARTER, cx: TW / 2, cy: TH / 2, h: FH }
    : { psi: quarters * QUARTER - Math.PI / 4, cx: PLANTA_S / Math.SQRT2, cy: PLANTA_S / Math.SQRT2, h: 0 }
}

/** O giro de 0 a 3 de uma contagem de quartos de volta (qualquer inteiro). */
export const rotOf = (quarters: number): Rot => ((((quarters % 4) + 4) % 4) as Rot)

/**
 * cos e sin do ângulo, EXATOS nos quartos de volta. Em ponto flutuante, cos(90 graus) dá 6e-17 e
 * não 0: o fim do giro tem de cair no desenho de 90 graus sem resto nenhum.
 */
export function cosSin(psi: number): [number, number] {
  const q = psi / QUARTER
  const n = Math.round(q)
  if (Math.abs(q - n) < 1e-9) return ([[1, 0], [0, 1], [-1, 0], [0, -1]] as [number, number][])[rotOf(n)]
  return [Math.cos(psi), Math.sin(psi)]
}

/** O ponto do mundo em volta do qual o terreno gira: (x, y) em células e a altura z (andares) que fica parada na tela. */
export interface Pivot {
  x: number
  y: number
  z: number
}

/** Mundo para vista: (x, y) menos o pivô, girado de psi. */
export function viewAround(psi: number, pv: Pivot): (x: number, y: number) => Pt {
  const [c, s] = cosSin(psi)
  return (x, y) => {
    const dx = x - pv.x
    const dy = y - pv.y
    return [dx * c - dy * s, dx * s + dy * c]
  }
}

/**
 * Para onde a câmera olha (a direção que cai num ponto só da tela): (1, 1, 2cy/h). No 3D dá
 * (1, 1, TH/FH), a mesma do iso.ts. Sem altura (planta), olha reto de cima: (0, 0, 1).
 */
export function camToward(cam: Camera): Vec3 {
  return cam.h > EPS ? [1, 1, (2 * cam.cy) / cam.h] : [0, 0, 1]
}

/* ---------------------------------------------------------------- 2. o quadro */

/** Um quadro do giro: a câmera, a escala (px da tela por unidade da projeção) e onde o pivô aparece (px). */
export interface Frame {
  cam: Camera
  scale: number
  at: Pt
}

/** As ferramentas de um quadro: mundo para vista (tv), vista para px (P), a direção da câmera e se ela olha reto de cima. */
export function frameTools(f: Frame, pv: Pivot) {
  const tv = viewAround(f.cam.psi, pv)
  const { cx, cy, h } = f.cam
  const P = (p: Pt, z: number): Pt => [f.at[0] + f.scale * (p[0] - p[1]) * cx, f.at[1] + f.scale * ((p[0] + p[1]) * cy - (z - pv.z) * h)]
  const toward = camToward(f.cam)
  return { tv, P, toward, fromAbove: toward[0] === 0 && toward[1] === 0 }
}

/** O ponto (x, y, z) do mundo na tela (px) num quadro. */
export function framePoint(f: Frame, pv: Pivot, x: number, y: number, z: number): Pt {
  const { tv, P } = frameTools(f, pv)
  return P(tv(x, y), z)
}

/** As faces visíveis de um corpo num quadro (px): a mesma regra do desenho (prismFaces), num ângulo qualquer. */
export function facesAt(b: Body, f: Frame, pv: Pivot): RawFace[] {
  const { tv, P, toward } = frameTools(f, pv)
  return prismFaces(b, tv, P, toward)
}

/* ---------------------------------------------------------------- 3. o caminho no tempo */

/** Entra e sai devagar (cúbica): o giro que começa parado. */
export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
/** Sai devagar: o giro redirecionado já está andando, não pode parar para recomeçar. */
export const easeOutTurn = (p: number) => 1 - Math.pow(1 - p, 3)

/**
 * Um quadro entre a e b (e de 0 a 1). Ângulo, medidas e a posição do pivô andam em linha reta; a
 * escala anda em proporção (de 1 para 4 passa por 2), que o olho lê como velocidade constante.
 * Nas pontas devolve o próprio a ou b: o fim é EXATO (sem conta que deixe resto).
 */
export function lerpFrame(a: Frame, b: Frame, e: number): Frame {
  if (e <= 0) return a
  if (e >= 1) return b
  const l = (p: number, q: number) => p + (q - p) * e
  return {
    cam: { psi: l(a.cam.psi, b.cam.psi), cx: l(a.cam.cx, b.cam.cx), cy: l(a.cam.cy, b.cam.cy), h: l(a.cam.h, b.cam.h) },
    scale: a.scale * Math.pow(b.scale / a.scale, e),
    at: [l(a.at[0], b.at[0]), l(a.at[1], b.at[1])],
  }
}

/** Um trecho do giro: de onde, para onde, quando começou, quanto dura e a curva. */
export interface Tween {
  from: Frame
  to: Frame
  start: number
  ms: number
  ease: (p: number) => number
}

/** O quadro de um instante (ms, o relógio do requestAnimationFrame) e se o trecho acabou. */
export function tweenAt(t: Tween, now: number): { frame: Frame; done: boolean } {
  const p = t.ms > 0 ? Math.min(1, Math.max(0, (now - t.start) / t.ms)) : 1
  return { frame: p >= 1 ? t.to : lerpFrame(t.from, t.to, t.ease(p)), done: p >= 1 }
}

/* ---------------------------------------------------------------- 4. o SVG (começo e fim do giro) */

export interface Size {
  w: number
  h: number
}
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** O "meet" do SVG (preserveAspectRatio xMidYMid meet): px por unidade do quadro e o deslocamento do quadro no elemento. */
export function meet(view: Box, size: Size): { s: number; ox: number; oy: number } {
  const s = Math.min(size.w / view.w, size.h / view.h)
  return { s, ox: (size.w - view.w * s) / 2 - view.x * s, oy: (size.h - view.h * s) / 2 - view.y * s }
}

/** O que o SVG mostra: giro, modo, terreno, quadro (viewBox), tamanho do elemento e zoom. */
export interface SvgView {
  rot: Rot
  mode: ViewMode
  site: Site
  view: Box
  size: Size
  pz: PanZoom
}

/** Ponto do mundo em px do elemento, no desenho do SVG: s * (k * projeção + t) + deslocamento. */
export function svgPoint(sv: SvgView, x: number, y: number, z: number): Pt {
  const { s, ox, oy } = meet(sv.view, sv.size)
  const [px, py] = project(...toView(x, y, sv.rot, sv.site), z, sv.mode)
  return [s * (sv.pz.k * px + sv.pz.x) + ox, s * (sv.pz.k * py + sv.pz.y) + oy]
}

/**
 * O caminho de volta: o ponto do mundo que aparece no px (sx, sy), na altura z. Passo a passo:
 * 1. desfaz o quadro e o zoom (px para a projeção);
 * 2. desfaz a projeção: no 3D, X dá a - b e Y (mais a altura) dá a + b; na planta, é só dividir;
 * 3. da vista para o mundo (fromView).
 */
export function pivotAt(sv: SvgView, sx: number, sy: number, z: number): Pivot {
  const { s, ox, oy } = meet(sv.view, sv.size)
  const X = ((sx - ox) / s - sv.pz.x) / sv.pz.k
  const Y = ((sy - oy) / s - sv.pz.y) / sv.pz.k
  let a: number
  let b: number
  if (sv.mode === 'planta') {
    a = X / PLANTA_S
    b = Y / PLANTA_S
  } else {
    const u = (2 * X) / TW
    const w = (2 * (Y + z * FH)) / TH
    a = (u + w) / 2
    b = (w - u) / 2
  }
  const [x, y] = fromView(a, b, sv.rot, sv.site)
  return { x, y, z }
}

/** O quadro que mostra exatamente o que o SVG mostra (o primeiro quadro do giro). */
export function frameOfSvg(sv: SvgView, pv: Pivot): Frame {
  return { cam: cameraOf(sv.rot, sv.mode), scale: meet(sv.view, sv.size).s * sv.pz.k, at: svgPoint(sv, pv.x, pv.y, pv.z) }
}

/** O zoom do SVG (PanZoom) que mostra exatamente o mesmo que um quadro de quarto de volta (o último quadro do giro). */
export function pzOfFrame(f: Frame, pv: Pivot, rot: Rot, mode: ViewMode, site: Site, view: Box, size: Size): PanZoom {
  const { s, ox, oy } = meet(view, size)
  const k = f.scale / s
  const [px, py] = project(...toView(pv.x, pv.y, rot, site), pv.z, mode)
  return { k, x: (f.at[0] - ox) / s - k * px, y: (f.at[1] - oy) / s - k * py }
}

/** O zoom está no começo (vista inteira, sem aproximar nem arrastar)? */
export const isWhole = (pz: PanZoom) => Math.abs(pz.k - 1) < 1e-3 && Math.abs(pz.x) < 0.5 && Math.abs(pz.y) < 0.5

/**
 * O fim do giro: o último quadro e o zoom do SVG que mostra o mesmo. Duas regras:
 * 1. a pessoa olhava o desenho inteiro (zoom do começo): termina no desenho inteiro do giro novo
 *    (o terreno deitado pode ter outra proporção; manter a escala cortaria uma ponta);
 * 2. a pessoa tinha aproximado: o pivô fica no MESMO lugar da tela e a escala é a mesma (o zoom
 *    que sair dos limites do botão + e - é trazido para dentro deles, e o giro anda até ele).
 * "start" é o começo do giro (num redirecionamento, o do primeiro clique: a regra vale sobre ele).
 */
export function endOfTurn(o: { whole: boolean; at: Pt; scale: number; pivot: Pivot; quarters: number; mode: ViewMode; site: Site; view: Box; size: Size }): { frame: Frame; pz: PanZoom } {
  const rot = rotOf(o.quarters)
  const cam = cameraOf(o.quarters, o.mode)
  const { s } = meet(o.view, o.size)
  if (o.whole) {
    const pz: PanZoom = { k: 1, x: 0, y: 0 }
    return { pz, frame: { cam, scale: s, at: svgPoint({ rot, mode: o.mode, site: o.site, view: o.view, size: o.size, pz }, o.pivot.x, o.pivot.y, o.pivot.z) } }
  }
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, o.scale / s))
  const frame: Frame = { cam, scale: s * k, at: o.at }
  return { frame, pz: pzOfFrame(frame, o.pivot, rot, o.mode, o.site, o.view, o.size) }
}
