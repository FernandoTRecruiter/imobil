/* =============================================================================
   tipos.ts: o formato de uma IMPLANTAÇÃO, o desenho do terreno de um empreendimento feito
   à mão (a "planta de implantação" do arquiteto: lote, ruas, prédios, lazer, estacionamento).

   Medidas: CÉLULA no chão (x leste, y sul; uma célula tem uns 4 m) e ANDAR na altura, as
   mesmas do iso.ts. A frente do terreno (a rua do endereço) fica no y maior: no 3D, sem
   girar, é o lado de quem olha.

   O que a implantação NÃO tem: unidade, situação, nome de pessoa. Ela diz ONDE e com que
   FORMA; os blocos, andares, unidades e vagas vêm da cena (o banco), achados pelo NOME do
   bloco, pelo NÍVEL do andar e pelo CÓDIGO da unidade ou da vaga (nunca pelo id). Por isso a
   mesma implantação serve para qualquer pessoa: cada uma vê colorido só o que o escopo deixa.
   ============================================================================= */
import type { Exemplo } from '@/data/seed/exemplos'
import type { Pt } from '../iso'
import type { GroundKind, GroundLine, GroundText, VolumeTone } from '../layout'

/** As divisões de UM andar: as unidades na ordem da posição (1, 2, 3...) e as partes neutras (núcleo, circulação). */
export interface PlantaAndar {
  /** Cada unidade é uma lista de peças convexas (o canto arredondado tem várias). */
  units: Pt[][][]
  neutral: Pt[][]
}

/** Um bloco (prédio, fila de casas, torre) e a forma dele. */
export interface BlocoSpec {
  /** O nome do bloco no banco ("Bloco A", "Rua 1", "Torre", "Lynx"). */
  name: string
  /**
   * Divisões de um andar com n unidades. Regra: se o bloco tem planta (o H tem 4 apartamentos
   * nas 4 pontas), usa a planta; se o andar tem outra quantidade, divide a forma por igual.
   */
  plan: (n: number) => PlantaAndar
  /** A base inteira em peças convexas: andar só de volume (térreo de hall ou de lojas), sombra. */
  plate: Pt[][]
  /** A base do subsolo, quando a garagem é maior que a torre (ocupa o lote). */
  basement?: Pt[][]
  /** Casa: telhado de duas águas sobre cada unidade, com a cumeeira ao longo de x ou de y. */
  gable?: 'x' | 'y'
  /** Volumes no topo (caixa d'água, casa de máquinas). */
  roofTop?: { poly: Pt[]; h: number }[]
  /** Tom do térreo quando ele é só volume (vidro = lojas ou hall). */
  groundTone?: VolumeTone
  /** Nome curto embaixo do selo (Bloco A); sem ele, só o selo. */
  tag?: string
}

/** Um volume baixo de apoio: portaria, salão, academia, brinquedo, garagem da casa, mureta. */
export interface VolumeSpec {
  key: string
  poly: Pt[]
  z0: number
  z1: number
  tone?: VolumeTone
  ridge?: 'x' | 'y'
  /** Prédio vizinho (fora do terreno): cenário, mais apagado. */
  ctx?: boolean
}

export interface Implantacao {
  key: Exemplo['key']
  /** Tamanho do mundo (células). Tudo cabe nele; o quadro inicial mostra ele inteiro. */
  site: { w: number; h: number }
  /** O lote (pode ser irregular): pintado como gramado; o resto se desenha por cima. */
  lot: Pt[]
  /** Chão na ordem de pintura (rua, calçada, piso, estacionamento, piscina...). */
  ground: { kind: GroundKind; poly: Pt[] }[]
  lines: { kind: GroundLine['kind']; pts: Pt[]; closed?: boolean }[]
  texts: { kind: GroundText['kind']; text: string; at: Pt }[]
  blocks: BlocoSpec[]
  /** Estacionamento à parte: cada vaga com o código de exemplos.ts, na ordem. */
  parking: { zone: string; spots: { code: string; poly: Pt[] }[] }[]
  volumes: VolumeSpec[]
  trees: { x: number; y: number; r?: number; h?: number }[]
}
