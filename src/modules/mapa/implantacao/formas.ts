/* =============================================================================
   formas.ts: as peças com que as implantações são montadas. Cada função devolve a FORMA
   (polígonos convexos em células); quem chama decide onde ela fica no terreno.

   - blocoH: o prédio em H da referência (duas alas ligadas pelo núcleo), 4 apartamentos por
     andar, um em cada ponta;
   - torre: planta quadrada com núcleo no meio e as salas na coroa em volta;
   - anel: prédio que contorna um pátio (o triângulo de cantos arredondados do Lynx);
   - filaDeCasas: casas lado a lado, de frente para a rua interna;
   - fileiraDeVagas: vagas lado a lado, com o código de exemplos.ts na ordem;
   - e miudezas: piscina com deck, quadra com marcação, parquinho, portaria, árvores em fila.
   ============================================================================= */
import { bandCells, boxPoly, rectPoly, type Pt } from '../iso'
import { SPOT_D, SPOT_W } from '../layout'
import type { BlocoSpec, Implantacao, PlantaAndar, VolumeSpec } from './tipos'

/** Divide um retângulo alinhado à grade em n partes iguais ao longo de x ou de y. */
export function splitBox(x0: number, y0: number, x1: number, y1: number, n: number, along: 'x' | 'y'): Pt[][] {
  return Array.from({ length: n }, (_, i) => {
    const t0 = i / n
    const t1 = (i + 1) / n
    return along === 'x' ? boxPoly(x0 + (x1 - x0) * t0, y0, x0 + (x1 - x0) * t1, y1) : boxPoly(x0, y0 + (y1 - y0) * t0, x1, y0 + (y1 - y0) * t1)
  })
}

/* ---------------------------------------------------------------- prédio em H */

/** Medidas do H (células): ala de 2 de largura e 6,4 de comprimento, vão de 1,6 entre as alas. */
export const H = { wing: 2, len: 6.4, gap: 1.6, tip: 2.6, bridge: 1.8 }
export const H_W = H.wing * 2 + H.gap

/**
 * Bloco em H com o canto de cima à esquerda em (x, y); as alas correm em y. Planta de 4
 * apartamentos, um em cada ponta, na ordem: fundos-esquerda, fundos-direita, frente-direita,
 * frente-esquerda (o sentido do relógio visto de cima). O meio das alas e a ponte são o núcleo
 * (escada e elevador), neutros. Andar com outra quantidade: cada ala dividida por igual.
 */
export function blocoH(name: string, x: number, y: number, tag?: string): BlocoSpec {
  const { wing, len, gap, tip, bridge } = H
  const xr = x + wing + gap
  const midY0 = y + tip
  const midY1 = y + len - tip
  const by0 = y + (len - bridge) / 2
  const left = boxPoly(x, y, x + wing, y + len)
  const right = boxPoly(xr, y, xr + wing, y + len)
  const ponte = boxPoly(x + wing, by0, xr, by0 + bridge)
  const plan = (n: number): PlantaAndar => {
    if (n === 4)
      return {
        units: [[boxPoly(x, y, x + wing, midY0)], [boxPoly(xr, y, xr + wing, midY0)], [boxPoly(xr, midY1, xr + wing, y + len)], [boxPoly(x, midY1, x + wing, y + len)]],
        neutral: [boxPoly(x, midY0, x + wing, midY1), boxPoly(xr, midY0, xr + wing, midY1), ponte],
      }
    const nl = Math.ceil(n / 2)
    return { units: [...splitBox(x, y, x + wing, y + len, nl, 'y'), ...splitBox(xr, y, xr + wing, y + len, n - nl, 'y')].map((p) => [p]), neutral: [ponte] }
  }
  return {
    name, tag, plan, plate: [left, right, ponte],
    roofTop: [{ poly: boxPoly(x + wing + 0.2, by0 + 0.3, xr - 0.2, by0 + bridge - 0.3), h: 0.55 }],
  }
}

/* ---------------------------------------------------------------- torre */

/**
 * Torre de planta quadrada (lado "size"), com a coroa de salas de largura "depth" em volta do
 * núcleo. As salas de um andar são pedaços iguais da coroa, começando no canto de trás à
 * esquerda e seguindo o relógio: 4 salas = os 4 lados; 2 salas = duas metades; 1 = a coroa inteira.
 */
export function torre(name: string, cx: number, cy: number, size: number, depth: number, basement?: Pt[][]): BlocoSpec {
  const h = (size - depth) / 2
  const spine: Pt[] = [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]]
  const core = size / 2 - depth
  const nucleo = boxPoly(cx - core, cy - core, cx + core, cy + core)
  return {
    name, basement, groundTone: 'vidro',
    plan: (n) => ({ units: bandCells(spine, depth, n), neutral: [nucleo] }),
    plate: [boxPoly(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2)],
    roofTop: [{ poly: boxPoly(cx - core + 0.15, cy - core + 0.15, cx + core - 0.15, cy + core - 0.15), h: 0.9 }],
  }
}

/* ---------------------------------------------------------------- prédio em anel */

/** Prédio que contorna um pátio: a faixa de largura "depth" em volta do eixo, dividida por igual em cada andar. */
export function anel(name: string, spine: Pt[], depth: number): BlocoSpec {
  return { name, groundTone: 'vidro', plan: (n) => ({ units: bandCells(spine, depth, n), neutral: [] }), plate: bandCells(spine, depth, 1)[0] }
}

/* ---------------------------------------------------------------- casas */

export interface FilaDeCasas {
  bloco: BlocoSpec
  /** Garagem de cada casa (volume neutro: não se administra) e o que fica no chão do lote. */
  volumes: VolumeSpec[]
  ground: Implantacao['ground']
  lines: Implantacao['lines']
}

/**
 * Casas lado a lado, de frente para a rua que passa em y = rua (as casas ficam ao norte dela).
 * Cada lote tem "pitch" de largura e "depth" de fundo; a casa (2,2 x 2,4) fica a 1 célula da rua,
 * com a garagem ao lado, a entrada de carro até a rua e a piscina no quintal. A planta de um
 * andar com n casas põe uma casa por lote, da esquerda para a direita.
 */
export function filaDeCasas(name: string, x0: number, rua: number, count: number, pitch = 3.6, depth = 5.8): FilaDeCasas {
  const body = (i: number): Pt[] => {
    const x = x0 + i * pitch + 0.35
    return boxPoly(x, rua - 1 - 2.4, x + 2.2, rua - 1)
  }
  const volumes: VolumeSpec[] = []
  const ground: Implantacao['ground'] = []
  const lines: Implantacao['lines'] = []
  for (let i = 0; i < count; i++) {
    const lx = x0 + i * pitch
    const gx = lx + 2.7
    volumes.push({ key: `garagem:${name}:${i}`, poly: boxPoly(gx, rua - 2.7, gx + 0.75, rua - 0.7), z0: 0, z1: 0.62 })
    ground.push({ kind: 'piso', poly: boxPoly(gx, rua - 0.7, gx + 0.75, rua) })
    ground.push({ kind: 'deck', poly: boxPoly(lx + 0.45, rua - depth + 0.35, lx + 2.45, rua - 3.55) })
    ground.push({ kind: 'agua', poly: boxPoly(lx + 0.65, rua - depth + 0.55, lx + 1.95, rua - 3.75) })
    // Divisa entre os lotes: uma linha fina (a cerca), do fundo até perto da calçada.
    lines.push({ kind: 'divisa', pts: [[lx, rua - depth], [lx, rua - 0.3]] })
  }
  lines.push({ kind: 'divisa', pts: [[x0 + count * pitch, rua - depth], [x0 + count * pitch, rua - 0.3]] })
  lines.push({ kind: 'divisa', pts: [[x0, rua - depth], [x0 + count * pitch, rua - depth]] })
  const bloco: BlocoSpec = {
    name, gable: 'x',
    plan: (n) => ({ units: Array.from({ length: n }, (_, i) => [body(i)]), neutral: [] }),
    plate: Array.from({ length: count }, (_, i) => body(i)),
  }
  return { bloco, volumes, ground, lines }
}

/* ---------------------------------------------------------------- vagas */

/**
 * Vagas lado a lado a partir de (x, y), ao longo de x ("x": a vaga tem SPOT_W de largura em x e
 * SPOT_D de fundo em y) ou de y. Recebe os códigos e devolve uma vaga por código, na ordem.
 */
export function fileiraDeVagas(codes: string[], x: number, y: number, along: 'x' | 'y'): { code: string; poly: Pt[] }[] {
  return codes.map((code, i) =>
    along === 'x'
      ? { code, poly: boxPoly(x + i * SPOT_W + 0.04, y, x + (i + 1) * SPOT_W - 0.04, y + SPOT_D) }
      : { code, poly: boxPoly(x, y + i * SPOT_W + 0.04, x + SPOT_D, y + (i + 1) * SPOT_W - 0.04) },
  )
}

/* ---------------------------------------------------------------- lazer e apoio */

/** Piscina: deck em volta e a água no meio. */
export function piscina(x0: number, y0: number, x1: number, y1: number, borda = 0.6): Implantacao['ground'] {
  return [
    { kind: 'deck', poly: boxPoly(x0, y0, x1, y1) },
    { kind: 'agua', poly: boxPoly(x0 + borda, y0 + borda, x1 - borda, y1 - borda) },
  ]
}

/** Quadra poliesportiva: o piso verde e a marcação (contorno, meio, círculo central, áreas). */
export function quadra(x0: number, y0: number, x1: number, y1: number): { ground: Implantacao['ground']; lines: Implantacao['lines'] } {
  const m = 0.35
  const [a0, b0, a1, b1] = [x0 + m, y0 + m, x1 - m, y1 - m]
  const cx = (a0 + a1) / 2
  const cy = (b0 + b1) / 2
  const r = (b1 - b0) * 0.16
  const circle: Pt[] = Array.from({ length: 16 }, (_, i) => [cx + Math.cos((i / 16) * Math.PI * 2) * r, cy + Math.sin((i / 16) * Math.PI * 2) * r])
  const area = (b1 - b0) * 0.36
  return {
    ground: [{ kind: 'esporte', poly: boxPoly(x0, y0, x1, y1) }],
    lines: [
      { kind: 'marca', pts: boxPoly(a0, b0, a1, b1), closed: true },
      { kind: 'marca', pts: [[cx, b0], [cx, b1]] },
      { kind: 'marca', pts: circle, closed: true },
      { kind: 'marca', pts: [[a0, cy - area], [a0 + 1.1, cy - area], [a0 + 1.1, cy + area], [a0, cy + area]] },
      { kind: 'marca', pts: [[a1, cy - area], [a1 - 1.1, cy - area], [a1 - 1.1, cy + area], [a1, cy + area]] },
    ],
  }
}

/** Parquinho: a areia e três brinquedos baixos (escorregador, balanço, casinha). */
export function parquinho(key: string, x0: number, y0: number, x1: number, y1: number): { ground: Implantacao['ground']; volumes: VolumeSpec[] } {
  const w = x1 - x0
  const d = y1 - y0
  return {
    ground: [{ kind: 'areia', poly: boxPoly(x0, y0, x1, y1) }],
    volumes: [
      { key: `${key}:escorregador`, poly: rectPoly(x0 + w * 0.28, y0 + d * 0.35, 0.5, 1.2), z0: 0, z1: 0.45, tone: 'madeira' },
      { key: `${key}:casinha`, poly: boxPoly(x0 + w * 0.6, y0 + d * 0.2, x0 + w * 0.6 + 0.7, y0 + d * 0.2 + 0.7), z0: 0, z1: 0.38, tone: 'madeira' },
      { key: `${key}:balanco`, poly: boxPoly(x0 + w * 0.55, y0 + d * 0.68, x0 + w * 0.55 + 1.1, y0 + d * 0.68 + 0.18), z0: 0, z1: 0.42, tone: 'madeira' },
    ],
  }
}

/** Volume com laje de cobertura um pouco maior (portaria, salão, academia): o beiral dá o acabamento. */
export function pavilhao(key: string, x0: number, y0: number, x1: number, y1: number, h: number, tone: VolumeSpec['tone'] = 'branco'): VolumeSpec[] {
  return [
    { key, poly: boxPoly(x0, y0, x1, y1), z0: 0, z1: h, tone },
    { key: `${key}:laje`, poly: boxPoly(x0 - 0.18, y0 - 0.18, x1 + 0.18, y1 + 0.18), z0: h, z1: h + 0.1 },
  ]
}

/** Árvores em fila, de (x0, y0) até (x1, y1), com tamanho que varia um pouco (fixo pela posição). */
export function arvoresEmFila(x0: number, y0: number, x1: number, y1: number, n: number): Implantacao['trees'] {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1)
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, r: 0.48 + ((i * 37) % 5) * 0.04 }
  })
}

/** Rua com as duas calçadas e a faixa do meio tracejada, ao longo de x (de x0 a x1) ou de y. */
export function rua(along: 'x' | 'y', from: number, to: number, a0: number, a1: number, calcada = 1): { ground: Implantacao['ground']; lines: Implantacao['lines'] } {
  const box = (p0: number, p1: number) => (along === 'x' ? boxPoly(from, p0, to, p1) : boxPoly(p0, from, p1, to))
  const mid = (a0 + a1) / 2
  const dashes: Implantacao['lines'] = []
  for (let s = from + 0.6; s + 1 < to; s += 2.2) dashes.push({ kind: 'faixa', pts: along === 'x' ? [[s, mid], [s + 1, mid]] : [[mid, s], [mid, s + 1]] })
  return {
    ground: [
      ...(calcada > 0 ? [{ kind: 'calcada' as const, poly: box(a0 - calcada, a0) }, { kind: 'calcada' as const, poly: box(a1, a1 + calcada) }] : []),
      { kind: 'asfalto', poly: box(a0, a1) },
    ],
    lines: dashes,
  }
}
