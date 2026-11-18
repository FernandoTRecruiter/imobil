/* =============================================================================
   Condomínio Mount Juic: seis blocos em H (A a F, de 4 a 6 andares, 4 apartamentos por andar)
   em duas fileiras, estacionamento externo com 60 vagas (E-001 a E-060) a leste da avenida
   interna, e o lazer na frente: piscina com deck, salão de festas, quadra e parquinho.
   A portaria fica no portão, onde a avenida interna encontra a Rua Sucupira.
   Inspiração: a planta de implantação de referência (blocos em H, fileiras de vagas numeradas).

   Planta do terreno (x leste, y sul; a rua do endereço embaixo):
       [ A ][ B ][ C ] |av| [ vagas E-001 a E-060 ]
       [ D ][ E ][ F ] |  | [ jardim              ]
       [piscina][salão][quadra] |portaria|
       ======================== Rua Sucupira ========================
   ============================================================================= */
import { EXEMPLOS } from '@/data/seed/exemplos'
import { boxPoly } from '../iso'
import { arvoresEmFila, blocoH, fileiraDeVagas, parquinho, pavilhao, piscina, quadra, rua } from './formas'
import type { Implantacao } from './tipos'

const ex = EXEMPLOS.find((e) => e.key === 'montjuic')!
const vagas = ex.parking[0]
const fileira = (i: number) => vagas.spots.slice(i * 15, (i + 1) * 15)

const ruaFrente = rua('x', 0, 50, 34.2, 37.6, 1.2)
const q = quadra(19.6, 23.4, 28.2, 28.4)
const parque = parquinho('parquinho', 3.4, 29.6, 8.4, 32.2)

export const MONTJUIC: Implantacao = {
  key: 'montjuic',
  site: { w: 50, h: 40 },
  lot: [[1, 1], [49, 1], [49, 33], [1, 33]],
  ground: [
    ...ruaFrente.ground,
    // Avenida interna (do portão até o fundo) e o estacionamento a leste dela.
    { kind: 'asfalto', poly: boxPoly(30.4, 2.2, 33, 33) },
    { kind: 'estac', poly: boxPoly(33, 2.2, 47.4, 12.6) },
    // Caminhos de pedestre entre as fileiras de blocos e na frente delas.
    { kind: 'piso', poly: boxPoly(2, 10.2, 30.4, 11.6) },
    { kind: 'piso', poly: boxPoly(2, 21, 30.4, 22.2) },
    { kind: 'piso', poly: boxPoly(9.8, 2.2, 11, 21) },
    { kind: 'piso', poly: boxPoly(19, 2.2, 20.2, 21) },
    ...piscina(3, 23.6, 11, 28.6),
    ...q.ground,
    ...parque.ground,
  ],
  lines: [...ruaFrente.lines, ...q.lines],
  texts: [
    { kind: 'rua', text: ex.address.street, at: [8, 36.1] },
    { kind: 'zona', text: vagas.zone, at: [40.4, 13.4] },
    { kind: 'lazer', text: 'Piscina', at: [7, 29.15] },
    { kind: 'lazer', text: 'Salão de festas', at: [15.2, 27.9] },
    { kind: 'lazer', text: 'Quadra', at: [23.9, 29] },
    { kind: 'lazer', text: 'Playground', at: [11.2, 31.2] },
    { kind: 'lazer', text: 'Portaria', at: [36.4, 30.8] },
  ],
  blocks: [
    blocoH('Bloco A', 3, 2.6, 'Bloco A'),
    blocoH('Bloco B', 12.2, 2.6, 'Bloco B'),
    blocoH('Bloco C', 21.4, 2.6, 'Bloco C'),
    blocoH('Bloco D', 3, 13.4, 'Bloco D'),
    blocoH('Bloco E', 12.2, 13.4, 'Bloco E'),
    blocoH('Bloco F', 21.4, 13.4, 'Bloco F'),
  ],
  // Quatro fileiras de 15: a 2ª e a 3ª encostadas pelas costas, cada par de frente para um corredor.
  parking: [
    {
      zone: vagas.zone,
      spots: [
        ...fileiraDeVagas(fileira(0), 35.2, 2.8, 'x'),
        ...fileiraDeVagas(fileira(1), 35.2, 6, 'x'),
        ...fileiraDeVagas(fileira(2), 35.2, 7.4, 'x'),
        ...fileiraDeVagas(fileira(3), 35.2, 10.6, 'x'),
      ],
    },
  ],
  volumes: [
    ...pavilhao('portaria', 33.4, 29.8, 35.2, 31.4, 0.8),
    ...pavilhao('salao', 12.6, 23.8, 17.8, 27.2, 1, 'vidro'),
    ...parque.volumes,
  ],
  trees: [
    ...arvoresEmFila(2.2, 33.6, 29.6, 33.6, 9), // calçada da frente, até o portão
    ...arvoresEmFila(34.6, 33.6, 48.4, 33.6, 5),
    ...arvoresEmFila(2, 1.7, 29.6, 1.7, 10), // fundo do terreno, atrás dos blocos
    ...arvoresEmFila(35, 16, 47, 16, 5), // jardim a leste
    ...arvoresEmFila(36.5, 19.5, 47, 19.5, 4),
    ...arvoresEmFila(35, 23, 47, 23, 5),
    ...arvoresEmFila(36.5, 26.5, 47, 26.5, 4),
    ...arvoresEmFila(48.2, 3, 48.2, 12, 4),
    { x: 1.8, y: 12 }, { x: 1.8, y: 20 }, { x: 29.4, y: 9.4 }, { x: 29.4, y: 20 },
  ],
}
