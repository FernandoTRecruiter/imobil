/* =============================================================================
   iso.ts: a CONTA do 3D isométrico. Só números: nada de React, nada de desenho.

   Por que separado: é a parte que pode errar sem ninguém ver (um prédio pintado na
   frente de outro que está mais perto). Isolada, ela tem teste próprio (mapa.test.ts).
   Base: o ambiente-mapa.js do portfólio, reescrito em TypeScript para prédios.

   Como um ponto do terreno vira um ponto da tela, em 3 passos:
   1. MUNDO: x (leste), y (sul) em CÉLULAS do terreno e z em ANDARES (1 = um andar).
   2. VISTA: girar a câmera é girar o terreno em quartos de volta. O ponto (x, y) vira
      (a, b) "na vista". Girar não muda o desenho de nada: só troca esta conta.
   3. TELA: no 3D, cada célula vira um losango (a conta clássica do isométrico 2 para 1):
         X = (a - b) * TW / 2            andar para a direita no terreno = descer à direita
         Y = (a + b) * TH / 2 - z * FH   andar para a frente = descer; subir um andar = subir FH
      Na "Planta" (vista de cima) é só um quadriculado: X = a * S, Y = b * S.

   Quem é pintado primeiro (o "pintor": o que está atrás vai antes e o da frente cobre):
   - Primeiro por ANDAR (faixa de altura): a câmera olha de cima, então o que está
     inteiro ACIMA de um plano nunca é coberto pelo que está inteiro ABAIXO dele.
     Por isso todo objeto cabe numa faixa só (prédio alto é empilhado andar por andar).
   - Dentro da faixa, pela PLANTA: P vai antes de Q se P está atrás de Q (separados no
     eixo a ou no eixo b). Uma ordenação topológica resolve o caso que a soma simples
     (a + b) erra: um bloco comprido atrás de um pequeno.
   ============================================================================= */

export type Rot = 0 | 1 | 2 | 3
export type ViewMode = '3d' | 'planta'
export type Vec3 = [number, number, number]
/** Losango de 1 célula: 44 x 22 px (2 para 1). Um andar sobe 18 px. Na planta, a célula tem 26 px. */
export const TW = 44
export const TH = 22
export const FH = 18
export const PLANTA_S = 26

/** Tamanho do terreno inteiro, em células (w no eixo x, h no eixo y). */
export interface Site {
  w: number
  h: number
}

const EPS = 1e-6

/* ---------------------------------------------------------------- 1. giro */

/** Um quarto de volta: (x, y) num terreno w x h vira (h - y, x) num terreno h x w. */
export function quarterTurn(x: number, y: number, site: Site): { p: [number, number]; site: Site } {
  return { p: [site.h - y, x], site: { w: site.h, h: site.w } }
}

/**
 * Ponto do mundo na vista girada r quartos de volta. É o mesmo que aplicar quarterTurn r vezes
 * (o teste confere), escrito direto para não repetir conta a cada ponto.
 */
export function toView(x: number, y: number, r: Rot, site: Site): [number, number] {
  if (r === 1) return [site.h - y, x]
  if (r === 2) return [site.w - x, site.h - y]
  if (r === 3) return [y, site.w - x]
  return [x, y]
}

/** O caminho de volta: da vista para o mundo. */
export function fromView(a: number, b: number, r: Rot, site: Site): [number, number] {
  if (r === 1) return [b, site.h - a]
  if (r === 2) return [site.w - a, site.h - b]
  if (r === 3) return [site.w - b, a]
  return [a, b]
}

/** Girar 90 graus para a direita (+1) ou para a esquerda (-1). Quatro giros voltam ao começo. */
export function rotate(r: Rot, dir: 1 | -1): Rot {
  return (((r + dir) % 4) + 4) % 4 as Rot
}

/* ---------------------------------------------------------------- 2. projeção */

/** Da vista para a tela (px). O quadro do desenho (viewBox) é ajustado depois, por isso não há deslocamento aqui. */
export function project(a: number, b: number, z: number, mode: ViewMode): [number, number] {
  if (mode === 'planta') return [a * PLANTA_S, b * PLANTA_S]
  return [((a - b) * TW) / 2, ((a + b) * TH) / 2 - z * FH]
}

/**
 * Para onde a câmera olha, na vista: qualquer ponto andando nesta direção cai no MESMO ponto
 * da tela. No 3D, andar 1 em a e 1 em b desce TH na tela; subir TH/FH andares sobe o mesmo TH.
 * Uma face só aparece se aponta para este lado (é o "descarte de face de trás").
 */
function towardCamera(mode: ViewMode): Vec3 {
  return mode === 'planta' ? [0, 0, 1] : [1, 1, TH / FH]
}

/* ---------------------------------------------------------------- 3. formas */

/**
 * Uma forma do desenho. Caixa (andar de prédio, unidade, prédio vizinho) ou telhado de duas
 * águas (casa). Coordenadas do MUNDO; z0 e z1 em andares e dentro de UMA faixa de altura.
 */
export interface Solid {
  form: 'box' | 'gable'
  x0: number
  y0: number
  x1: number
  y1: number
  z0: number
  z1: number
  /** Telhado: a cumeeira (o "espigão" do meio) corre ao longo de x ou de y. */
  ridge?: 'x' | 'y'
}

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]]
const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
const mean = (pts: Vec3[]): Vec3 => {
  const n = pts.length
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n, pts.reduce((s, p) => s + p[2], 0) / n]
}

/** Arredonda para 1 casa: o SVG fica menor e a conta não muda nada que o olho veja. */
const r1 = (v: number) => Math.round(v * 10) / 10

/** Contorno externo (envoltória convexa, algoritmo da "corrente monótona"): é o anel do foco e da seleção. */
export function hullPath(points: [number, number][]): string {
  const ring = hullPts(points)
  return ring.length ? 'M' + ring.map((p) => p.map(r1).join(',')).join('L') + 'Z' : ''
}

/** Os cantos da envoltória convexa, em ordem (o giro contínuo pinta a sombra com eles, sem passar por texto). */
export function hullPts(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1])
  if (pts.length < 3) return []
  const turn = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/* ---------------------------------------------------------------- 5. quadro, zoom e arrastar */

/** Quadro do desenho (viewBox) que cabe todos os pontos, com uma folga em volta. */
export function boundsOf(points: [number, number][], pad = 24): { x: number; y: number; w: number; h: number } {
  if (!points.length) return { x: 0, y: 0, w: 100, h: 100 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of points) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + pad * 2), h: Math.ceil(y1 - y0 + pad * 2) }
}

/** Zoom e deslocamento: o ponto p do desenho aparece em k * p + (x, y). */
export interface PanZoom {
  k: number
  x: number
  y: number
}
export const ZOOM_MIN = 0.6
export const ZOOM_MAX = 6

/**
 * Zoom em volta de um ponto (o do mouse, o meio da pinça ou o centro do quadro): o ponto debaixo
 * do dedo continua debaixo do dedo. Conta: o ponto do desenho sob q é (q - t) / k; com o k novo,
 * o deslocamento novo é q - k' * esse ponto.
 */
export function zoomAt(t: PanZoom, factor: number, qx: number, qy: number): PanZoom {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, t.k * factor))
  const px = (qx - t.x) / t.k
  const py = (qy - t.y) / t.k
  return { k, x: qx - k * px, y: qy - k * py }
}

/** Enquadrar um retângulo do desenho (um bloco escolhido): centro do retângulo no centro do quadro. */
export function fitRect(view: { x: number; y: number; w: number; h: number }, rect: { x: number; y: number; w: number; h: number }, kMax = 3): PanZoom {
  const k = Math.min(kMax, Math.max(1, Math.min(view.w / Math.max(rect.w, 1), view.h / Math.max(rect.h, 1)) * 0.75))
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  return { k, x: view.x + view.w / 2 - k * cx, y: view.y + view.h / 2 - k * cy }
}

/* =============================================================================
   6. CORPOS: o motor das implantações (06/11/2026).

   Até aqui tudo era caixa alinhada à grade (e o telhado da casa). A implantação de cada
   empreendimento pede forma de verdade: bloco em H, ala girada, triângulo de cantos
   arredondados em volta de um pátio, árvore, vaga de garagem. A peça comum é o PRISMA:
   um polígono CONVEXO no chão, subido de z0 até z1. Forma côncava (o H, o anel do triângulo)
   vira várias peças convexas lado a lado: é isso que deixa a ordem de pintura simples e certa.

   As funções antigas (Solid, visibleFaces, paintOrder por faixa) continuam aqui sem mudança:
   a maquete da Visão geral ainda usa. O 3D do imóvel passou todo para os corpos.
   ============================================================================= */

export type Pt = [number, number]

/**
 * Um corpo do desenho: prisma de base convexa (coordenadas do MUNDO, em células; altura em
 * andares). Com "ridge", vira telhado de duas águas sobre o retângulo que envolve a base
 * (z0 = beiral, z1 = cumeeira), correndo ao longo de x ou de y.
 */
export interface Body {
  poly: Pt[]
  z0: number
  z1: number
  ridge?: 'x' | 'y'
}

/** Sombreado da face: t = de cima; 0 a 4 = parede, da mais clara (virada para a luz) à mais escura. */
export type Shade = 't' | 0 | 1 | 2 | 3 | 4

/** Face pronta: caminho SVG, sombreado, a aresta da base de onde ela sobe (-1 = topo ou água do telhado) e o meio dela na tela. */
export interface BodyFace {
  d: string
  shade: Shade
  edge: number
  /** Meio da face na tela e a largura útil (para decidir se o código cabe). */
  cx: number
  cy: number
  w: number
}

/** A caixa antiga (x0..x1, y0..y1) como corpo: o desenho de reserva (imóvel sem implantação) usa. */
export function bodyOf(s: Solid): Body {
  const poly: Pt[] = [[s.x0, s.y0], [s.x1, s.y0], [s.x1, s.y1], [s.x0, s.y1]]
  return s.form === 'gable' ? { poly, z0: s.z0, z1: s.z1, ridge: s.ridge ?? (s.x1 - s.x0 >= s.y1 - s.y0 ? 'x' : 'y') } : { poly, z0: s.z0, z1: s.z1 }
}

/** Retângulo girado: centro (cx, cy), lados w (ao longo do ângulo) e d, ângulo em graus. Os 4 cantos em ordem. */
export function rectPoly(cx: number, cy: number, w: number, d: number, deg = 0): Pt[] {
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as Pt[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c])
}

/** Retângulo alinhado à grade, pelos cantos. */
export const boxPoly = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

export const centroid = (pts: Pt[]): Pt => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]

/** A base do corpo na vista girada (o giro é uma rotação de verdade: a ordem dos cantos não inverte). */
export function bodyView(b: Body, r: Rot, site: Site): Pt[] {
  return b.poly.map(([x, y]) => toView(x, y, r, site))
}

/**
 * Luz: vem de cima e da esquerda da tela, igual em qualquer giro (a conta é feita NA VISTA).
 * A parede cuja normal aponta para +b (lado esquerdo da tela) é a mais clara; para +a (direito),
 * escura. Entre as duas, a parede girada pega um degrau intermediário: 5 degraus bastam para o
 * canto arredondado parecer redondo sem gradiente.
 * Conta: brilho = cosseno do ângulo entre a normal e a direção da luz (112,5 graus na vista).
 */
const LIGHT = (112.5 * Math.PI) / 180
export function wallShade(na: number, nb: number): 0 | 1 | 2 | 3 | 4 {
  const lum = Math.cos(Math.atan2(nb, na) - LIGHT)
  return lum > 0.7 ? 0 : lum > 0.2 ? 1 : lum > -0.3 ? 2 : lum > -0.7 ? 3 : 4
}

/** Telhado de duas águas: os 4 cantos do beiral e as 2 pontas da cumeeira, no mundo. */
function gableWorld(b: Body): { eave: Pt[]; ridge: Pt[] } {
  const xs = b.poly.map((p) => p[0])
  const ys = b.poly.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const eave = boxPoly(x0, y0, x1, y1)
  const ridge: Pt[] = b.ridge === 'x' ? [[x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]] : [[(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]]
  return { eave, ridge }
}

/** Os cantos do corpo na tela (envoltória do anel do foco e quadro do desenho). */
export function bodyCorners(b: Body, r: Rot, site: Site, mode: ViewMode): Pt[] {
  return cornersWith(b, (x, y) => toView(x, y, r, site), (p, z) => project(p[0], p[1], z, mode))
}

/** Os mesmos cantos, com a vista (tv) e a projeção (P) de quem chama: o giro contínuo usa no anel da unidade escolhida. */
export function cornersWith(b: Body, tv: (x: number, y: number) => Pt, P: (p: Pt, z: number) => Pt): Pt[] {
  const out: Pt[] = []
  for (const [x, y] of b.poly) {
    const v = tv(x, y)
    out.push(P(v, b.z0))
    out.push(P(v, b.ridge ? b.z0 : b.z1))
  }
  if (b.ridge) for (const p of gableWorld(b).ridge) out.push(P(tv(p[0], p[1]), b.z1))
  return out
}

const pathOfScreen = (pts: Pt[]) => 'M' + pts.map((p) => `${r1(p[0])},${r1(p[1])}`).join('L') + 'Z'

/**
 * Face "crua", antes de virar caminho SVG: os cantos já na tela, o sombreado, a aresta da base de
 * onde ela sobe (-1 = topo ou água do telhado) e o tipo (parede, topo ou água/empena do telhado).
 */
export interface RawFace {
  pts: Pt[]
  shade: Shade
  edge: number
  kind: 'wall' | 'top' | 'roof'
}

/**
 * O coração das faces de um corpo, sem saber de giro nem de modo (07/11/2026, giro suave). Quem
 * chama diz três coisas: como o mundo vira vista (tv), como a vista vira tela (P) e para onde a
 * câmera olha (cam). O desenho de sempre (bodyFaces, quartos de volta) e o giro contínuo (giro.ts,
 * um ângulo qualquer no meio do caminho) passam por aqui: a regra de face visível e de luz é UMA só.
 * Passo a passo:
 * 1. a base vai para a vista; a normal de cada parede é a perpendicular da aresta virada para FORA
 *    (comparando com o centro da base, que é convexa);
 * 2. a parede só aparece se a normal aponta para a câmera (produto com cam > 0). Com a câmera
 *    olhando reto de cima (planta), parede nenhuma aparece. O topo sempre aparece;
 * 3. telhado: as duas águas e as duas empenas (os triângulos das pontas), com a mesma regra,
 *    agora com a normal 3D (a água de trás aparece, porque a câmera está acima dela).
 */
export function prismFaces(b: Body, tv: (x: number, y: number) => Pt, P: (p: Pt, z: number) => Pt, cam: Vec3): RawFace[] {
  const out: RawFace[] = []
  // Câmera reto de cima: a direção dela não tem parte no chão (é a planta, ou o fim da passagem para ela).
  const fromAbove = Math.abs(cam[0]) <= EPS && Math.abs(cam[1]) <= EPS
  if (b.ridge) {
    const g = gableWorld(b)
    const e = g.eave.map(([x, y]) => tv(x, y))
    const k = g.ridge.map(([x, y]) => tv(x, y))
    const v3 = (p: Pt, z: number): Vec3 => [p[0], p[1], z]
    // Águas e empenas: ao longo de x, as águas sobem das bordas y0 (cantos 0,1) e y1 (3,2); ao longo de y, das bordas x0 (0,3) e x1 (1,2).
    const parts: Vec3[][] =
      b.ridge === 'x'
        ? [
            [v3(e[0], b.z0), v3(e[1], b.z0), v3(k[1], b.z1), v3(k[0], b.z1)],
            [v3(e[3], b.z0), v3(e[2], b.z0), v3(k[1], b.z1), v3(k[0], b.z1)],
            [v3(e[0], b.z0), v3(e[3], b.z0), v3(k[0], b.z1)],
            [v3(e[1], b.z0), v3(e[2], b.z0), v3(k[1], b.z1)],
          ]
        : [
            [v3(e[0], b.z0), v3(e[3], b.z0), v3(k[1], b.z1), v3(k[0], b.z1)],
            [v3(e[1], b.z0), v3(e[2], b.z0), v3(k[1], b.z1), v3(k[0], b.z1)],
            [v3(e[0], b.z0), v3(e[1], b.z0), v3(k[0], b.z1)],
            [v3(e[3], b.z0), v3(e[2], b.z0), v3(k[1], b.z1)],
          ]
    const center = mean(parts.flat())
    for (const f of parts) {
      let n = cross(sub(f[1], f[0]), sub(f[2], f[0]))
      if (dot(n, sub(mean(f), center)) < 0) n = [-n[0], -n[1], -n[2]]
      if (dot(n, cam) <= EPS) continue
      // Água virada para trás (normal para -a e -b): vista de cima, é "topo". As outras pegam a
      // luz pelo lado para onde apontam, um degrau mais claras que a parede (a água inclina para o céu).
      const shade: Shade = fromAbove || (n[0] <= EPS && n[1] <= EPS) ? 't' : (Math.max(0, wallShade(n[0], n[1]) - 1) as Shade)
      out.push({ pts: f.map((p) => P([p[0], p[1]], p[2])), shade, edge: -1, kind: 'roof' })
    }
    return out
  }
  const v = b.poly.map(([x, y]) => tv(x, y))
  const [ca, cb] = centroid(v)
  if (!fromAbove && b.z1 - b.z0 > EPS) {
    for (let i = 0; i < v.length; i++) {
      const p = v[i]
      const q = v[(i + 1) % v.length]
      let na = q[1] - p[1]
      let nb = -(q[0] - p[0])
      if (na * ((p[0] + q[0]) / 2 - ca) + nb * ((p[1] + q[1]) / 2 - cb) < 0) [na, nb] = [-na, -nb]
      if (na * cam[0] + nb * cam[1] <= EPS) continue
      out.push({ pts: [P(p, b.z0), P(q, b.z0), P(q, b.z1), P(p, b.z1)], shade: wallShade(na, nb), edge: i, kind: 'wall' })
    }
  }
  out.push({ pts: v.map((p) => P(p, b.z1)), shade: 't', edge: -1, kind: 'top' })
  return out
}

/**
 * As faces VISÍVEIS de um corpo num quarto de volta (r) e num modo, como caminho SVG, com o
 * sombreado e o lugar do código. A conta é a do prismFaces (com a câmera do 3D: a parede aparece
 * se a + b > 0 na vista; na planta, só o topo); aqui entram o caminho e a largura útil de cada face.
 */
export function bodyFaces(b: Body, r: Rot, site: Site, mode: ViewMode): BodyFace[] {
  const tv = (x: number, y: number) => toView(x, y, r, site)
  const P = (p: Pt, z: number) => project(p[0], p[1], z, mode)
  return prismFaces(b, tv, P, towardCamera(mode)).map((f) => {
    const [cx, cy] = centroid(f.pts)
    const xs = f.pts.map((p) => p[0])
    const span = Math.max(...xs) - Math.min(...xs)
    // Largura útil: a da parede, de ponta a ponta; a da água do telhado, inteira; no topo do 3D (um
    // losango), no meio dele, na altura de uma linha de texto, cabe uns 60% da largura.
    const w = f.kind === 'wall' ? Math.abs(f.pts[1][0] - f.pts[0][0]) : f.kind === 'roof' ? span : span * (mode === 'planta' ? 0.9 : 0.6)
    return { d: pathOfScreen(f.pts), shade: f.shade, edge: f.edge, cx: r1(cx), cy: r1(cy), w }
  })
}

/* ---------------------------------------------------------------- 7. ordem de pintura dos corpos */

/** Um item para ordenar: a base na VISTA (polígono convexo) e a faixa de altura. */
export interface DepthItem {
  vp: Pt[]
  z0: number
  z1: number
}

/** Onde o polígono convexo corta a reta a - b = c: o trecho de a + b (null = não corta). */
function sliceAt(vp: Pt[], c: number): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < vp.length; i++) {
    const p = vp[i]
    const q = vp[(i + 1) % vp.length]
    const up = p[0] - p[1] - c
    const uq = q[0] - q[1] - c
    if (Math.abs(up) <= EPS) {
      lo = Math.min(lo, p[0] + p[1])
      hi = Math.max(hi, p[0] + p[1])
    }
    if ((up < -EPS && uq > EPS) || (up > EPS && uq < -EPS)) {
      const t = up / (up - uq)
      const v = p[0] + p[1] + t * (q[0] + q[1] - p[0] - p[1])
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
  }
  return lo <= hi ? [lo, hi] : null
}

const uRange = (vp: Pt[]): [number, number] => {
  let lo = Infinity
  let hi = -Infinity
  for (const [a, b] of vp) {
    lo = Math.min(lo, a - b)
    hi = Math.max(hi, a - b)
  }
  return [lo, hi]
}

/**
 * P vai antes de Q (-1), depois (1) ou tanto faz (0)? No 3D. Por que funciona, em 3 passos:
 * 1. a tela tem X = (a - b) * TW / 2: dois corpos só se cobrem se as faixas de a - b se cruzam;
 * 2. o raio que sai da câmera anda na reta a - b = c (constante) e chega mais perto dela quanto
 *    MAIOR o a + b. Com as bases convexas e separadas, o trecho de uma na reta fica inteiro à
 *    frente do da outra (e é o mesmo lado em toda reta comum: trocar de lado exigiria cruzar).
 *    O corpo da frente cobre o de trás em QUALQUER altura: um prédio baixo na frente de um alto;
 * 3. bases que se sobrepõem (andares empilhados, telhado sobre a casa): o de cima vai depois.
 */
export function depthCompare(p: DepthItem, q: DepthItem, pu = uRange(p.vp), qu = uRange(q.vp)): -1 | 0 | 1 {
  const lo = Math.max(pu[0], qu[0])
  const hi = Math.min(pu[1], qu[1])
  if (hi - lo <= EPS) return 0
  const c = (lo + hi) / 2
  const sp = sliceAt(p.vp, c)
  const sq = sliceAt(q.vp, c)
  if (sp && sq) {
    if (sp[1] <= sq[0] + EPS) return -1
    if (sq[1] <= sp[0] + EPS) return 1
  }
  if (p.z1 <= q.z0 + EPS) return -1
  if (q.z1 <= p.z0 + EPS) return 1
  return 0
}

/**
 * Ordem de pintura dos corpos. Passo a passo:
 * 1. na PLANTA (vista de cima) basta a altura: o mais alto por cima;
 * 2. no 3D, a faixa de a - b de cada corpo; os pares são visitados numa varredura (ordenados
 *    pelo começo da faixa), então par que não se cruza na tela nem é comparado;
 * 3. "P antes de Q" (depthCompare) vira uma seta; a ordenação topológica (algoritmo de Kahn)
 *    pinta quem não tem ninguém atrás pendente; no empate, o mais ao fundo (menor a + b) e o mais
 *    baixo primeiro, para o resultado ser estável;
 * 4. se sobrar alguém (ciclo, raro com bases convexas), entra pela profundidade.
 */
export function depthOrder<T extends DepthItem>(items: T[], mode: ViewMode): T[] {
  const depth = items.map((it) => {
    const [ca, cb] = centroid(it.vp)
    return ca + cb
  })
  const idx = items.map((_, i) => i)
  if (mode === 'planta') return idx.sort((i, j) => items[i].z0 - items[j].z0 || items[i].z1 - items[j].z1 || depth[i] - depth[j]).map((i) => items[i])
  const n = items.length
  const ur = items.map((it) => uRange(it.vp))
  const after: number[][] = Array.from({ length: n }, () => [])
  const pending = new Array<number>(n).fill(0)
  const byStart = [...idx].sort((i, j) => ur[i][0] - ur[j][0])
  for (let x = 0; x < n; x++) {
    const i = byStart[x]
    for (let y = x + 1; y < n; y++) {
      const j = byStart[y]
      if (ur[j][0] >= ur[i][1] - EPS) break // daqui em diante ninguém cruza a faixa de i
      const rel = depthCompare(items[i], items[j], ur[i], ur[j])
      if (rel === -1) {
        after[i].push(j)
        pending[j]++
      } else if (rel === 1) {
        after[j].push(i)
        pending[i]++
      }
    }
  }
  const rank = (i: number) => depth[i] + items[i].z0 * 1e-3
  const done = new Array<boolean>(n).fill(false)
  const out: T[] = []
  // Fila de prontos mantida em ordem de profundidade: n é de centenas, a inserção simples basta.
  const ready = idx.filter((i) => pending[i] === 0).sort((i, j) => rank(i) - rank(j))
  while (ready.length) {
    const i = ready.shift()!
    done[i] = true
    out.push(items[i])
    for (const j of after[i]) {
      if (--pending[j] === 0) {
        let k = 0
        while (k < ready.length && rank(ready[k]) <= rank(j)) k++
        ready.splice(k, 0, j)
      }
    }
  }
  out.push(...idx.filter((i) => !done[i]).sort((i, j) => rank(i) - rank(j)).map((i) => items[i]))
  return out
}

/* ---------------------------------------------------------------- 8. faixa em volta de um eixo (anel, coroa da torre) */

/**
 * A faixa de largura "depth" em volta de um eixo FECHADO e convexo (o anel do prédio em volta do
 * pátio, a coroa de salas em volta do núcleo da torre), cortada em n pedaços de comprimento igual
 * medido no eixo. Devolve, para cada pedaço, as peças convexas (uma por trecho do eixo que ele
 * pega). Passo a passo:
 * 1. bordas de dentro e de fora pelo "esquadro" (miter): cada canto anda na bissetriz, na distância
 *    certa para a parede ficar com a largura cheia;
 * 2. comprimento acumulado no eixo; o pedaço j vai de j * total / n até (j + 1) * total / n,
 *    começando no primeiro ponto do eixo (quem chama escolhe onde fica a unidade 1);
 * 3. em cada trecho do eixo que o pedaço pega, a peça é o quadrilátero entre as bordas, cortado
 *    na MESMA fração da borda de dentro e da de fora (sempre convexo).
 */
export function bandCells(spine: Pt[], depth: number, n: number): Pt[][][] {
  const k = spine.length
  const [ccx, ccy] = centroid(spine)
  const normal = (p: Pt, q: Pt): Pt => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
    let nx = (q[1] - p[1]) / len
    let ny = -(q[0] - p[0]) / len
    if (nx * ((p[0] + q[0]) / 2 - ccx) + ny * ((p[1] + q[1]) / 2 - ccy) < 0) [nx, ny] = [-nx, -ny]
    return [nx, ny]
  }
  const inner: Pt[] = []
  const outer: Pt[] = []
  for (let i = 0; i < k; i++) {
    const n0 = normal(spine[(i - 1 + k) % k], spine[i])
    const n1 = normal(spine[i], spine[(i + 1) % k])
    const f = 1 + n0[0] * n1[0] + n0[1] * n1[1]
    const m: Pt = [(n0[0] + n1[0]) / f, (n0[1] + n1[1]) / f]
    outer.push([spine[i][0] + (m[0] * depth) / 2, spine[i][1] + (m[1] * depth) / 2])
    inner.push([spine[i][0] - (m[0] * depth) / 2, spine[i][1] - (m[1] * depth) / 2])
  }
  const lens = spine.map((p, i) => Math.hypot(spine[(i + 1) % k][0] - p[0], spine[(i + 1) % k][1] - p[1]))
  const start: number[] = []
  let total = 0
  for (const l of lens) {
    start.push(total)
    total += l
  }
  const lerp = (p: Pt, q: Pt, t: number): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
  const cells: Pt[][][] = []
  for (let j = 0; j < n; j++) {
    const s0 = (j * total) / n
    const s1 = ((j + 1) * total) / n
    const pieces: Pt[][] = []
    for (let i = 0; i < k; i++) {
      const a = Math.max(s0, start[i])
      const b = Math.min(s1, start[i] + lens[i])
      if (b - a <= 1e-6 || lens[i] <= 1e-9) continue
      const t0 = (a - start[i]) / lens[i]
      const t1 = (b - start[i]) / lens[i]
      const i2 = (i + 1) % k
      pieces.push([lerp(inner[i], inner[i2], t0), lerp(inner[i], inner[i2], t1), lerp(outer[i], outer[i2], t1), lerp(outer[i], outer[i2], t0)])
    }
    cells.push(pieces)
  }
  return cells
}

/**
 * Eixo de um triângulo de cantos arredondados (o Lynx): centro, distância do centro a cada lado
 * (o "apótema", medido no eixo da parede) e raio do arredondado. Começa no MEIO do lado da frente
 * (+y, o da rua) e anda no sentido do relógio visto de cima (x leste, y sul). Cada canto vira
 * "steps" trechos retos (o arco de 120 graus aproximado).
 */
export function roundedTriangleSpine(cx: number, cy: number, apothem: number, radius: number, steps = 6): Pt[] {
  // Normais dos lados (para fora): frente (+y, 90 graus), depois 210 e 330, no sentido do relógio.
  const sides = [90, 210, 330].map((d) => (d * Math.PI) / 180)
  const pts: Pt[] = [[cx + Math.cos(sides[0]) * apothem, cy + Math.sin(sides[0]) * apothem]]
  for (let s = 0; s < 3; s++) {
    const a0 = sides[s]
    const a1 = sides[(s + 1) % 3] + (s === 2 ? 2 * Math.PI : 0)
    // Centro do arco: na bissetriz do canto, a (apótema - raio) / cos(60 graus) do centro.
    const mid = (a0 + a1) / 2
    const dist = (apothem - radius) / Math.cos((a1 - a0) / 2)
    const ax = cx + Math.cos(mid) * dist
    const ay = cy + Math.sin(mid) * dist
    for (let t = 0; t <= steps; t++) {
      const ang = a0 + ((a1 - a0) * t) / steps
      pts.push([ax + Math.cos(ang) * radius, ay + Math.sin(ang) * radius])
    }
  }
  return pts
}
