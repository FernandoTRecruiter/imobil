/* =============================================================================
   Lynx Residence: prédio largo de 4 andares em TRIÂNGULO DE CANTOS ARREDONDADOS em volta de
   um pátio. Térreo (o "1º andar") de lojas e hall, só volume (envidraçado); do 2º ao 4º andar,
   16 unidades por andar ao longo do perímetro (201 a 216, 301..., 401...), a unidade 1 no meio
   da frente (a Rua Paraíba) e as outras no sentido do relógio, visto de cima. No pátio, o
   parquinho com árvores; a leste, o estacionamento externo (L-001 a L-036) e a academia.

   Planta do terreno (x leste, y sul):
             /\                 [vagas L-001..L-018 | L-019..L-036]  [academia]
            /  \  pátio
           (____)
       ======================== Rua Paraíba ========================
   ============================================================================= */
import { EXEMPLOS } from '@/data/seed/exemplos'
import { boxPoly, roundedTriangleSpine } from '../iso'
import { anel, arvoresEmFila, fileiraDeVagas, parquinho, pavilhao, rua } from './formas'
import type { Implantacao } from './tipos'

const ex = EXEMPLOS.find((e) => e.key === 'lynx')!
const vagas = ex.parking[0]
const ruaFrente = rua('x', 0, 40, 29.2, 32.6, 1.2)
const patio = parquinho('patio', 10.6, 11.4, 14.4, 14.4)

/** Eixo das paredes do Lynx: centro (12,5; 13), 4,6 do centro a cada lado, cantos com raio 2,2. Faixa de 2,4 (uns 10 m). */
export const LYNX_SPINE = roundedTriangleSpine(12.5, 13, 4.6, 2.2, 6)
export const LYNX_DEPTH = 2.4

export const LYNX: Implantacao = {
  key: 'lynx',
  site: { w: 40, h: 35 },
  lot: [[1, 1], [38, 1], [38, 28], [1, 28]],
  ground: [
    ...ruaFrente.ground,
    // Caminho da calçada até a entrada (meio da frente do prédio).
    { kind: 'piso', poly: boxPoly(11.2, 18.4, 13.8, 28) },
    { kind: 'piso', poly: boxPoly(4.4, 19.4, 20.6, 20.6) },
    // Estacionamento externo, com saída para a rua da frente.
    { kind: 'estac', poly: boxPoly(25.2, 5.2, 30.8, 28) },
    ...patio.ground,
  ],
  lines: ruaFrente.lines,
  texts: [
    { kind: 'rua', text: ex.address.street, at: [6, 31.1] },
    { kind: 'zona', text: vagas.zone, at: [28, 19.5] },
    { kind: 'lazer', text: 'Academia', at: [34.7, 10.5] },
    { kind: 'lazer', text: 'Playground', at: [12.5, 15.1] },
  ],
  blocks: [anel('Lynx', LYNX_SPINE, LYNX_DEPTH)],
  // Duas fileiras de 18, ao longo de y, de frente uma para a outra pelo corredor.
  parking: [{ zone: vagas.zone, spots: [...fileiraDeVagas(vagas.spots.slice(0, 18), 25.6, 6, 'y'), ...fileiraDeVagas(vagas.spots.slice(18), 28.8, 6, 'y')] }],
  volumes: [...pavilhao('academia', 32.6, 6, 36.8, 9.6, 1, 'vidro'), ...patio.volumes],
  trees: [
    { x: 12.5, y: 9 }, { x: 10, y: 14.9 }, { x: 15, y: 14.9 }, // pátio
    ...arvoresEmFila(2.4, 27.2, 23.6, 27.2, 7), // frente
    ...arvoresEmFila(2.4, 3, 2.4, 25, 7), // oeste
    ...arvoresEmFila(5, 2.4, 23, 2.4, 6), // fundo
    ...arvoresEmFila(33, 13, 33, 26, 5), // leste, entre as vagas e a divisa
    ...arvoresEmFila(36.4, 14.5, 36.4, 26, 4),
    { x: 21.6, y: 6 }, { x: 22.4, y: 22.4 }, { x: 3.8, y: 22.4 },
  ],
}
