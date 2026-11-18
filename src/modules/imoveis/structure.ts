/* =============================================================================
   structure.ts: monta a ESTRUTURA de um imóvel novo (blocos, andares e códigos das
   unidades) a partir de poucos números.

   É a parte "paramétrica" do cadastro: em vez de digitar 64 apartamentos, a pessoa diz
   "2 blocos, 8 andares, 4 por andar, começando no 101" e o sistema gera A-101 ... B-804.

   Função PURA (sem banco e sem tela): a mesma conta serve à prévia do assistente e à
   gravação no repositório. Assim a prévia nunca mostra um código diferente do que é gravado.
   ============================================================================= */

/**
 * single     = casa ou apartamento avulso: uma unidade só, sem bloco nem andar;
 * tower      = prédio(s) com andares (condomínio vertical, edifício, comercial);
 * row_houses = casas em fila dentro de um condomínio (um "andar" só, o térreo).
 */
export type StructureTemplate = 'single' | 'tower' | 'row_houses'

export interface StructureInput {
  template: StructureTemplate
  /** Código da unidade única (só no 'single'): "Casa", "Apto 302". */
  code: string
  blocks: number
  floors: number
  unitsPerFloor: number
  /** Número da primeira unidade do primeiro andar: 101 gera 101, 102... e 201, 202... */
  startNumber: number
}

export interface PlannedUnit {
  code: string
  /** Ordem no andar (1, 2, 3...), usada pelo espelho e pelo 3D. */
  position: number
}
export interface PlannedFloor {
  level: number
  label: string
  units: PlannedUnit[]
}
export interface PlannedBlock {
  name: string
  /** Do andar mais baixo para o mais alto (a tela inverte para desenhar o espelho). */
  floors: PlannedFloor[]
}
export interface StructurePlan {
  blocks: PlannedBlock[]
  /** Unidade sem bloco (casa ou apartamento avulso). */
  loose: PlannedUnit[]
  total: number
}

/** Limites do cadastro em etapas. Acima disso o caminho é a importação de planilha. */
export const LIMITS = { blocks: 20, floors: 50, unitsPerFloor: 20, total: 500 } as const

/** Letra do bloco: 0 -> A, 1 -> B... (o limite de 20 blocos cabe no alfabeto). */
export function blockLetter(i: number): string {
  return String.fromCharCode(65 + i)
}

/**
 * Quanto o número pula de um andar para o outro.
 * 101 -> 201 pula 100; 11 -> 21 pula 10; começando em 1 a numeração é corrida (1, 2, 3...),
 * sem o andar dentro do número (devolve 0 para dizer isso).
 */
export function floorStep(startNumber: number): number {
  if (startNumber >= 100) return 100
  if (startNumber >= 10) return 10
  return 0
}

export function countUnits(s: Pick<StructureInput, 'template' | 'blocks' | 'floors' | 'unitsPerFloor'>): number {
  if (s.template === 'single') return 1
  if (s.template === 'row_houses') return s.blocks * s.unitsPerFloor
  return s.blocks * s.floors * s.unitsPerFloor
}

/**
 * O que impede gerar os códigos (ou null se está tudo certo). A mensagem diz a causa e o conserto,
 * e "field" diz em qual campo do formulário o erro aparece.
 */
export function structureProblem(s: StructureInput): { field: keyof StructureInput; message: string } | null {
  if (s.template === 'single') return s.code.trim() ? null : { field: 'code', message: 'Dê um código à unidade, ex.: Casa ou Apto 302.' }
  const total = countUnits(s)
  if (total > LIMITS.total) {
    return { field: 'unitsPerFloor', message: `Isso dá ${total} unidades: o cadastro em etapas vai até ${LIMITS.total}. Para mais, cadastre por partes ou use a importação de planilha.` }
  }
  if (s.template === 'tower') {
    // ARMADILHA: começando em 190 com 20 por andar, o 1º andar iria até 209 e o "2" do 209
    // pareceria o 2º andar. A regra exige que todas as unidades do andar fiquem na mesma centena
    // (ou dezena), para o número sempre dizer o andar certo.
    const step = floorStep(s.startNumber)
    if (step && (s.startNumber % step) + s.unitsPerFloor - 1 >= step) {
      const suggestion = Math.floor(s.startNumber / step) * step + 1
      const last = s.startNumber + s.unitsPerFloor - 1
      return {
        field: 'unitsPerFloor',
        message: `Começando em ${s.startNumber}, a ${s.unitsPerFloor}ª unidade do andar seria ${last} e mudaria o número do andar. Comece em ${suggestion}${step === 10 ? ' ou use 101 (cabem até 99 por andar)' : ''}, ou diminua as unidades por andar.`,
      }
    }
  }
  return null
}

/**
 * Gera blocos, andares e códigos.
 * Passo a passo (prédio):
 *   1. cada bloco ganha a letra (A, B...) e o nome "Bloco A"; com 1 bloco só, o código fica sem letra;
 *   2. cada andar i (0 = primeiro) soma i x "pulo" ao número inicial (101, 201, 301...);
 *   3. cada unidade j do andar soma j (101, 102, 103...);
 *   4. numeração corrida (início abaixo de 10): conta seguida dentro do bloco (1, 2, 3...).
 * Casas em fila: "Casa 1", "Casa 2"... seguido entre as quadras, num andar só (térreo).
 */
export function planStructure(s: StructureInput): StructurePlan {
  if (s.template === 'single') return { blocks: [], loose: [{ code: s.code.trim(), position: 1 }], total: 1 }

  const blocks: PlannedBlock[] = []
  if (s.template === 'row_houses') {
    let n = s.startNumber
    for (let b = 0; b < s.blocks; b++) {
      const units = Array.from({ length: s.unitsPerFloor }, (_, j) => ({ code: `Casa ${n + j}`, position: j + 1 }))
      n += s.unitsPerFloor
      blocks.push({ name: s.blocks > 1 ? `Quadra ${blockLetter(b)}` : 'Casas', floors: [{ level: 0, label: 'Térreo', units }] })
    }
    return { blocks, loose: [], total: countUnits(s) }
  }

  const step = floorStep(s.startNumber)
  for (let b = 0; b < s.blocks; b++) {
    const prefix = s.blocks > 1 ? `${blockLetter(b)}-` : ''
    const floors: PlannedFloor[] = []
    for (let i = 0; i < s.floors; i++) {
      const units: PlannedUnit[] = []
      for (let j = 0; j < s.unitsPerFloor; j++) {
        const number = step ? s.startNumber + i * step + j : s.startNumber + i * s.unitsPerFloor + j
        units.push({ code: `${prefix}${number}`, position: j + 1 })
      }
      floors.push({ level: i + 1, label: `${i + 1}º andar`, units })
    }
    blocks.push({ name: s.blocks > 1 ? `Bloco ${blockLetter(b)}` : 'Bloco único', floors })
  }
  return { blocks, loose: [], total: countUnits(s) }
}

/** Resumo dos códigos para a prévia: "A-101 a A-804 · B-101 a B-804". */
export function codeRanges(plan: StructurePlan): string {
  if (plan.loose.length) return plan.loose.map((u) => u.code).join(', ')
  return plan.blocks
    .map((b) => {
      const all = b.floors.flatMap((f) => f.units)
      if (!all.length) return ''
      return all.length === 1 ? all[0].code : `${all[0].code} a ${all[all.length - 1].code}`
    })
    .filter(Boolean)
    .join(' · ')
}
