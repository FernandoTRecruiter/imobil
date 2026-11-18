/* =============================================================================
   random.ts: sorteio com SEMENTE FIXA para os dados fictícios.
   Mesma semente = mesmos dados em toda máquina e em todo teste. Sem isso, um teste que
   espera "64 unidades" passaria hoje e falharia amanhã.
   ============================================================================= */

/** mulberry32: gerador pequeno e conhecido; devolve números entre 0 e 1. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Rng {
  private next: () => number
  constructor(seed: number) {
    this.next = mulberry32(seed)
  }
  float(): number {
    return this.next()
  }
  /** Inteiro de min a max, os dois inclusos. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  digits(n: number): string {
    let s = ''
    for (let i = 0; i < n; i++) s += String(this.int(0, 9))
    return s
  }
  /** Id no formato uuid v4, mas previsível (vem da semente). */
  uuid(): string {
    const h = () => Math.floor(this.next() * 16).toString(16)
    const block = (n: number) => Array.from({ length: n }, h).join('')
    return `${block(8)}-${block(4)}-4${block(3)}-${'89ab'[this.int(0, 3)]}${block(3)}-${block(12)}`
  }
}

/** Id aleatório de verdade, para o que a pessoa cria na tela. */
export function newId(): string {
  return crypto.randomUUID()
}
