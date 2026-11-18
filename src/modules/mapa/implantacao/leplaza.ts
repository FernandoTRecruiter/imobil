/* =============================================================================
   Edifício Le Plaza: torre comercial de 25 andares na esquina da Avenida Afonso Pena com uma
   rua lateral. Administramos só os andares 4, 12, 13 e 25 (salas em cor); os outros são
   volume branco. A garagem fica em dois subsolos dentro do prédio: o 3D é só o lado de fora,
   então ela aparece pela RAMPA de entrada (na rua lateral) e, quando alguém pede "mostrar no
   mapa" numa vaga, pela laje do subsolo dela, em raio X abaixo do chão.
   Em volta: a praça da torre (piso com canteiros), a marquise da entrada, a avenida com
   canteiro central e prédios vizinhos neutros (cenário).

   Planta do terreno (x leste, y sul):
       [vizinhos]
       [viz] [ praça | TORRE | rampa ] |rua lateral|
       ================ Avenida Afonso Pena (canteiro no meio) ================
   ============================================================================= */
import { EXEMPLOS } from '@/data/seed/exemplos'
import { boxPoly } from '../iso'
import { arvoresEmFila, rua, torre } from './formas'
import type { Implantacao } from './tipos'

const ex = EXEMPLOS.find((e) => e.key === 'leplaza')!
const pista1 = rua('x', 0, 27, 19.6, 21.9, 0)
const pista2 = rua('x', 0, 27, 22.5, 24.8, 0)
const lateral = rua('y', 0, 19.6, 19.6, 22.8, 0)

export const LEPLAZA: Implantacao = {
  key: 'leplaza',
  site: { w: 27, h: 27 },
  lot: [[5, 5], [18.2, 5], [18.2, 18.2], [5, 18.2]],
  ground: [
    // Calçadas largas da esquina, as duas pistas da avenida e a rua lateral.
    { kind: 'calcada', poly: boxPoly(0, 18.2, 27, 19.6) },
    { kind: 'calcada', poly: boxPoly(18.2, 0, 19.6, 18.2) },
    { kind: 'calcada', poly: boxPoly(0, 24.8, 27, 26) },
    { kind: 'calcada', poly: boxPoly(22.8, 0, 24, 19.6) },
    ...pista1.ground,
    ...pista2.ground,
    ...lateral.ground,
    // Lotes vizinhos (oeste e norte): piso, para o prédio vizinho não ficar sobre o gramado.
    { kind: 'piso', poly: boxPoly(0, 0, 4.6, 18.2) },
    { kind: 'piso', poly: boxPoly(4.6, 0, 18.2, 4.6) },
    // A praça da torre e os canteiros nos cantos.
    { kind: 'piso', poly: boxPoly(5.4, 5.4, 17.8, 17.8) },
    { kind: 'grama', poly: boxPoly(5.8, 5.8, 8.4, 8.4) },
    { kind: 'grama', poly: boxPoly(5.8, 14.6, 8.6, 17.4) },
    { kind: 'grama', poly: boxPoly(14.8, 5.8, 17.4, 8.4) },
    // Garagem: a travessia da calçada e a rampa que desce para os subsolos.
    { kind: 'piso', poly: boxPoly(18.2, 14.2, 19.6, 16.2) },
    { kind: 'rampa', poly: boxPoly(15, 14.2, 18.2, 16.2) },
  ],
  lines: [...pista1.lines, ...pista2.lines, ...lateral.lines],
  texts: [
    { kind: 'rua', text: ex.address.street, at: [9, 23.65] },
    { kind: 'lazer', text: 'Entrada da garagem', at: [16.6, 17.1] },
  ],
  blocks: [torre('Torre', 11.6, 10.8, 5, 1.6, [boxPoly(5.8, 5.8, 17.4, 17.4)])],
  parking: [],
  volumes: [
    // Marquise da entrada (laje fina no 1º andar, na frente da torre) e as muretas da rampa.
    { key: 'marquise', poly: boxPoly(10.1, 13.3, 13.1, 14.7), z0: 0.82, z1: 0.92 },
    { key: 'mureta-n', poly: boxPoly(15, 14.02, 18.2, 14.2), z0: 0, z1: 0.32 },
    { key: 'mureta-s', poly: boxPoly(15, 16.2, 18.2, 16.38), z0: 0, z1: 0.32 },
    // Vizinhos: cenário, mais apagado que a torre.
    { key: 'viz-1', poly: boxPoly(0.6, 0.6, 4.2, 4.2), z0: 0, z1: 3, ctx: true },
    { key: 'viz-2', poly: boxPoly(0.6, 5.4, 4.2, 11), z0: 0, z1: 8, ctx: true },
    { key: 'viz-3', poly: boxPoly(0.6, 11.8, 4.2, 17.6), z0: 0, z1: 4, ctx: true },
    { key: 'viz-4', poly: boxPoly(5.4, 0.6, 11, 4.2), z0: 0, z1: 10, ctx: true },
    { key: 'viz-5', poly: boxPoly(11.8, 0.6, 17.6, 4.2), z0: 0, z1: 5, ctx: true },
  ],
  trees: [
    ...arvoresEmFila(1.4, 18.9, 25.8, 18.9, 8), // calçada da avenida
    ...arvoresEmFila(17.4, 22.2, 25.4, 22.2, 3), // canteiro central (a oeste fica livre para o nome da avenida)
    { x: 1.6, y: 22.2 },
    ...arvoresEmFila(18.9, 1.5, 18.9, 12.6, 4), // calçada da rua lateral
    { x: 7.1, y: 7.1 }, { x: 7.2, y: 16 }, { x: 16.1, y: 7.1 },
  ],
}
