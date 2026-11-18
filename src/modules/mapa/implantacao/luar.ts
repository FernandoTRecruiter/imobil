/* =============================================================================
   Condomínio Luar: 18 casas em três ruas internas (Rua 1, 2 e 3, seis casas em cada), todas
   administradas. Cada casa tem garagem própria ao lado (desenhada, sem nada a administrar),
   entrada de carro e piscina no quintal. Na frente do terreno, junto do portão: portaria,
   salão de festas, piscina com deck e parquinho. A leste, um bosque.
   Inspiração: as implantações de condomínio de casas de referência (fileiras ao longo das
   ruas internas, lazer junto da entrada).

   Planta do terreno (x leste, y sul; a rua do endereço embaixo):
       | | casas 13 a 18 (Rua 3)  | bosque
       | |======= Rua 3 =========|
       | | casas 07 a 12 (Rua 2)  |
       | |======= Rua 2 =========|
       | | casas 01 a 06 (Rua 1)  |
       | |======= Rua 1 =========|
       |portaria| salão | piscina | parquinho
       ===================== Rua das Andorinhas =====================
   ============================================================================= */
import { EXEMPLOS } from '@/data/seed/exemplos'
import { boxPoly } from '../iso'
import { arvoresEmFila, filaDeCasas, parquinho, pavilhao, piscina, rua } from './formas'
import type { Implantacao } from './tipos'

const ex = EXEMPLOS.find((e) => e.key === 'luar')!
const ruaFrente = rua('x', 0, 36, 31.2, 34.6, 1.2)
// Rua interna em y = rua: as casas ficam ao norte dela (de frente para quem chega pela rua).
const RUAS = [
  { name: 'Rua 1', y: 22.6 },
  { name: 'Rua 2', y: 15 },
  { name: 'Rua 3', y: 7.4 },
]
const filas = RUAS.map((r) => filaDeCasas(r.name, 4.4, r.y, 6))
const parque = parquinho('parquinho', 22.4, 25.6, 26.6, 28.8)

export const LUAR: Implantacao = {
  key: 'luar',
  site: { w: 36, h: 36 },
  lot: [[1, 1], [35, 1], [35, 30], [1, 30]],
  ground: [
    ...ruaFrente.ground,
    // Ligação do portão (a oeste) às três ruas internas.
    { kind: 'asfalto', poly: boxPoly(1.8, 7.4, 3.8, 30) },
    ...RUAS.map((r) => ({ kind: 'asfalto' as const, poly: boxPoly(3.8, r.y, 27.6, r.y + 1.8) })),
    ...filas.flatMap((f) => f.ground),
    ...piscina(14.6, 25.2, 21, 29.2),
    ...parque.ground,
  ],
  lines: [...ruaFrente.lines, ...filas.flatMap((f) => f.lines)],
  texts: [
    { kind: 'rua', text: ex.address.street, at: [9, 33.1] },
    ...RUAS.map((r) => ({ kind: 'rua' as const, text: r.name, at: [16, r.y + 1.05] as [number, number] })),
    { kind: 'lazer', text: 'Portaria', at: [5.05, 29.85] },
    { kind: 'lazer', text: 'Salão de festas', at: [10.5, 29.35] },
    { kind: 'lazer', text: 'Piscina', at: [17.8, 29.7] },
    { kind: 'lazer', text: 'Playground', at: [24.5, 29.35] },
  ],
  blocks: filas.map((f) => f.bloco),
  parking: [],
  volumes: [
    ...filas.flatMap((f) => f.volumes),
    ...pavilhao('portaria', 4.2, 27.8, 5.9, 29.4, 0.8),
    ...pavilhao('salao', 8, 25.4, 13, 28.8, 1, 'vidro'),
    ...parque.volumes,
  ],
  trees: [
    ...arvoresEmFila(29, 2.5, 34, 2.5, 3), // bosque a leste
    ...arvoresEmFila(30.2, 5.5, 34, 5.5, 2),
    ...arvoresEmFila(29, 8.5, 34, 8.5, 3),
    ...arvoresEmFila(30.2, 11.5, 34, 11.5, 2),
    ...arvoresEmFila(29, 14.5, 34, 14.5, 3),
    ...arvoresEmFila(30.2, 17.5, 34, 17.5, 2),
    ...arvoresEmFila(29, 20.5, 34, 20.5, 3),
    ...arvoresEmFila(29, 24, 34, 28.8, 3),
    ...arvoresEmFila(2.2, 30.6, 34, 30.6, 9), // calçada da frente
    { x: 7, y: 25.4 }, { x: 13.8, y: 29 }, { x: 21.7, y: 25.3 },
  ],
}
