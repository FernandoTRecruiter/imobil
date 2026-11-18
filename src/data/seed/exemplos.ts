/* =============================================================================
   Os 4 empreendimentos de exemplo (06/11/2026, pedido do Fernando: "limitar a esses 4").
   FONTE ÚNICA para duas peças que precisam bater:
     - a semente (seed/*.ts): cria imóvel, blocos, andares, unidades e vagas a partir daqui;
     - a implantação do 3D (src/modules/mapa/implantacao): desenha o lado de fora (prédios,
       estacionamento, lazer) e acha cada bloco, andar e vaga pelos NOMES e CÓDIGOS daqui.
   Mudou um nome ou uma contagem aqui, as duas acompanham. Nada de interior: só o exterior.

   Vaga de garagem é UNIDADE do tipo "parking" (o tipo já existia): ganha contrato, cobrança,
   dono e situação sem tela nova. Vaga de estacionamento externo não tem bloco nem andar e leva
   o nome da área em `zone`; vaga da garagem dentro do prédio fica no andar de subsolo dele.
   Em nenhum dos 4 a vaga é atrelada a apartamento: é alugada à parte, a quem quiser.

   Dados fictícios: nomes, endereços e coordenadas inventados (as coordenadas caem em bairros
   de Belo Horizonte só para o mapa ter onde pôr o pino).
   ============================================================================= */
import type { PropertyKind, UnitKind } from '../types'

export interface ExemploAndar {
  /** 0 = térreo, -1 = subsolo. */
  level: number
  label: string
  /** Códigos das unidades administradas neste andar. Vazio = andar só de volume (existe no prédio, não é nosso). */
  units: string[]
  kind?: UnitKind
  /** Garagem dentro do prédio: códigos das vagas deste andar (unidades "parking"). */
  parking?: string[]
}

export interface ExemploBloco {
  name: string
  /** Forma do bloco na implantação (a geometria mora em src/modules/mapa/implantacao). */
  shape: 'h' | 'slab' | 'tower' | 'rounded_triangle' | 'house'
  floors: ExemploAndar[]
}

export interface ExemploArea {
  /** Nome que aparece na tabela e no 3D ("Estacionamento externo"). */
  zone: string
  spots: string[]
}

export interface Exemplo {
  key: 'luar' | 'montjuic' | 'leplaza' | 'lynx'
  /** De quem é a conta: a imobiliária de demonstração ou a proprietária independente. */
  org: 'agency' | 'landlord'
  name: string
  kind: PropertyKind
  address: { street: string; number: string; district: string; cep: string }
  lat: number
  lng: number
  blocks: ExemploBloco[]
  /** Estacionamento à parte (fora dos blocos). Vazio quando cada unidade tem a própria garagem. */
  parking: ExemploArea[]
  /** Lazer e apoio desenhados na implantação (não são unidades). */
  amenities: ('pool' | 'court' | 'playground' | 'party_hall' | 'guardhouse' | 'gym')[]
}

/* ---------------------------------------------------------------- ajudantes de código */

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
/** Apartamentos de um andar: bloco A, 3º andar, 4 por andar → A-301, A-302, A-303, A-304. */
const apts = (prefix: string, level: number, perFloor: number) => range(1, perFloor).map((u) => `${prefix}${level}${pad(u)}`)
const vagas = (prefix: string, n: number) => range(1, n).map((i) => `${prefix}-${pad(i, 3)}`)
const andares = (prefix: string, total: number, perFloor: number): ExemploAndar[] => [
  { level: 0, label: 'Térreo', units: [] }, // portaria e hall: volume, sem unidade
  ...range(1, total).map((lv) => ({ level: lv, label: `${lv}º andar`, units: apts(prefix, lv, perFloor) })),
]

/* ---------------------------------------------------------------- os 4 */

export const EXEMPLOS: Exemplo[] = [
  {
    // 1. Condomínio de casas: todas administradas; cada casa tem garagem própria (nada a administrar).
    key: 'luar',
    org: 'agency',
    name: 'Condomínio Luar',
    kind: 'condominium',
    address: { street: 'Rua das Andorinhas', number: '800', district: 'Pampulha', cep: '31270-100' },
    lat: -19.8545,
    lng: -43.9712,
    // Três ruas internas de casas, como as fileiras da implantação de referência.
    blocks: [
      { name: 'Rua 1', shape: 'house', floors: [{ level: 0, label: 'Térreo', units: range(1, 6).map((i) => `Casa ${pad(i)}`), kind: 'house' }] },
      { name: 'Rua 2', shape: 'house', floors: [{ level: 0, label: 'Térreo', units: range(7, 12).map((i) => `Casa ${pad(i)}`), kind: 'house' }] },
      { name: 'Rua 3', shape: 'house', floors: [{ level: 0, label: 'Térreo', units: range(13, 18).map((i) => `Casa ${pad(i)}`), kind: 'house' }] },
    ],
    parking: [],
    amenities: ['guardhouse', 'pool', 'party_hall', 'playground'],
  },
  {
    // 2. Condomínio de prédios de até 6 andares (blocos em H, 4 apartamentos por andar);
    //    estacionamento externo administrado à parte, sem vínculo com apartamento.
    key: 'montjuic',
    org: 'agency',
    name: 'Condomínio Mount Juic',
    kind: 'condominium',
    address: { street: 'Rua Sucupira', number: '1500', district: 'Buritis', cep: '30575-120' },
    lat: -19.9761,
    lng: -43.9668,
    blocks: [
      { name: 'Bloco A', shape: 'h', floors: andares('A-', 4, 4) },
      { name: 'Bloco B', shape: 'h', floors: andares('B-', 5, 4) },
      { name: 'Bloco C', shape: 'h', floors: andares('C-', 6, 4) },
      { name: 'Bloco D', shape: 'h', floors: andares('D-', 6, 4) },
      { name: 'Bloco E', shape: 'h', floors: andares('E-', 5, 4) },
      { name: 'Bloco F', shape: 'h', floors: andares('F-', 4, 4) },
    ],
    parking: [{ zone: 'Estacionamento externo', spots: vagas('E', 60) }],
    amenities: ['guardhouse', 'pool', 'court', 'playground', 'party_hall'],
  },
  {
    // 3. Prédio comercial de 25 andares; administramos só os andares 4, 12, 13 e 25 (os outros
    //    são volume). Garagem à parte no próprio prédio (2 subsolos). Conta da proprietária independente.
    key: 'leplaza',
    org: 'landlord',
    name: 'Edifício Le Plaza',
    kind: 'commercial',
    address: { street: 'Avenida Afonso Pena', number: '3300', district: 'Funcionários', cep: '30130-009' },
    lat: -19.9312,
    lng: -43.9325,
    blocks: [
      {
        name: 'Torre',
        shape: 'tower',
        floors: [
          { level: -2, label: '2º subsolo', units: [], parking: vagas('G2', 12) },
          { level: -1, label: '1º subsolo', units: [], parking: vagas('G1', 12) },
          ...range(0, 25).map((lv): ExemploAndar => {
            const label = lv === 0 ? 'Térreo' : `${lv}º andar`
            if (lv === 4) return { level: lv, label, units: ['Sala 401', 'Sala 402', 'Sala 403', 'Sala 404'], kind: 'office' }
            if (lv === 12) return { level: lv, label, units: ['Sala 1201', 'Sala 1202'], kind: 'office' }
            if (lv === 13) return { level: lv, label, units: ['Sala 1301', 'Sala 1302'], kind: 'office' }
            if (lv === 25) return { level: lv, label, units: ['Cobertura 2501'], kind: 'office' }
            return { level: lv, label, units: [] }
          }),
        ],
      },
    ],
    parking: [],
    amenities: [],
  },
  {
    // 4. Prédio largo de 4 andares em triângulo de cantos arredondados: térreo de lojas e hall
    //    (volume), unidades do 2º ao 4º andar, 16 por andar; estacionamento externo à parte.
    key: 'lynx',
    org: 'agency',
    name: 'Lynx Residence',
    kind: 'building',
    address: { street: 'Rua Paraíba', number: '1100', district: 'Savassi', cep: '30130-141' },
    lat: -19.9367,
    lng: -43.9338,
    blocks: [
      {
        name: 'Lynx',
        shape: 'rounded_triangle',
        // "4 andares, unidades no 2º, 3º e 4º": o 1º é o térreo (lojas e hall, volume). O nível conta do
        // chão (0 = térreo); o rótulo e o código seguem a numeração que o Fernando usou.
        floors: [
          { level: 0, label: 'Térreo (1º andar)', units: [] },
          ...[2, 3, 4].map((n) => ({ level: n - 1, label: `${n}º andar`, units: range(1, 16).map((u) => `${n}${pad(u)}`) })),
        ],
      },
    ],
    parking: [{ zone: 'Estacionamento externo', spots: vagas('L', 36) }],
    amenities: ['gym', 'playground'],
  },
]
