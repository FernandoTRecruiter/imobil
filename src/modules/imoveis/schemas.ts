/* =============================================================================
   schemas.ts: as regras de formulário de Imóveis (zod), num lugar só.

   Por que separado do repo.ts: a TELA valida com estes esquemas (para o erro aparecer no
   campo, com causa e conserto) e o REPOSITÓRIO valida de novo com os mesmos (a tela não é
   a única porta: na fase 2, quem chama a API direto também passa por aqui).
   Os esquemas não transformam o tipo do valor (só aparam espaços), então o que o formulário
   guarda é exatamente o que o repositório recebe.
   ============================================================================= */
import { z } from 'zod'
import type { ManualUnitStatus, PersonTag, PropertyKind, StaffRole, UnitKind } from '@/data/types'
import { onlyDigits } from '@/lib/documents'
import { parseBRL } from '@/lib/money'
import { quickPersonSchema } from '@/modules/pessoas/repo'
import { LIMITS, structureProblem, type StructureTemplate } from './structure'

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const

/** Tipos que o assistente cadastra. Terreno fica de fora: no modelo, toda locação aponta uma unidade alugável. */
export const WIZARD_KINDS = ['house', 'apartment', 'condominium', 'building', 'commercial'] as const satisfies readonly PropertyKind[]
export type WizardKind = (typeof WIZARD_KINDS)[number]

export const UNIT_KINDS = ['apartment', 'house', 'room', 'office', 'store', 'warehouse', 'parking'] as const satisfies readonly UnitKind[]

/** Situações que se escolhem à mão. "Ocupada" não está aqui: vem do contrato vigente. */
export const MANUAL_STATUSES = ['available', 'reserved', 'maintenance', 'blocked'] as const satisfies readonly ManualUnitStatus[]

/** Que estrutura cada tipo de imóvel aceita (casa e apartamento avulso têm uma unidade só). */
export const TEMPLATES_BY_KIND: Record<WizardKind, StructureTemplate[]> = {
  house: ['single'],
  apartment: ['single'],
  condominium: ['tower', 'row_houses'],
  building: ['tower'],
  commercial: ['tower'],
}

/* ---------------------------------------------------------------- peças reutilizadas */

/** Número inteiro com a faixa no texto do erro ("Blocos: de 1 a 20."). */
function intField(name: string, min: number, max: number) {
  return z
    .number({ error: `Informe ${name.toLowerCase()} (só números).` })
    .int(`${name}: use um número inteiro.`)
    .min(min, `${name}: de ${min} a ${max}.`)
    .max(max, `${name}: de ${min} a ${max}.`)
}

/** Valor em reais digitado como texto ("1.900,00"); vazio vale (não informado). */
export const moneyText = z
  .string()
  .trim()
  .refine((v) => v === '' || (parseBRL(v) ?? -1) >= 0, 'Valor em reais, ex.: 1.900,00.')

/** Fatia com no máximo 2 casas decimais (33,33 + 33,33 + 33,34 = 100). */
const shareField = z
  .number({ error: 'Informe a fatia em % (só números).' })
  .gt(0, 'A fatia precisa ser maior que 0%.')
  .max(100, 'A fatia vai até 100%.')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use até 2 casas decimais na fatia.')

/**
 * Soma das fatias feita em centésimos INTEIROS: 33,33 + 33,33 + 33,34 dá 100 exato.
 * Somando direto com vírgula, o JavaScript daria 99,99999999999999 e recusaria a soma certa.
 */
export function sharesSum(list: { share_pct: number }[]): number {
  return list.reduce((a, o) => a + Math.round((Number.isFinite(o.share_pct) ? o.share_pct : 0) * 100), 0) / 100
}

export function formatPct(n: number): string {
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
}

export const addressSchema = z.object({
  cep: z.string().trim().refine((v) => onlyDigits(v).length === 8, 'CEP tem 8 números, ex.: 30140-071.'),
  street: z.string().trim().min(2, 'Informe a rua ou avenida.').max(120, 'Rua até 120 caracteres.'),
  number: z.string().trim().min(1, 'Informe o número (use "s/n" se não tiver).').max(12, 'Número até 12 caracteres.'),
  complement: z.string().trim().max(60, 'Complemento até 60 caracteres.'),
  district: z.string().trim().min(2, 'Informe o bairro.').max(60, 'Bairro até 60 caracteres.'),
  city: z.string().trim().min(2, 'Informe a cidade.').max(60, 'Cidade até 60 caracteres.'),
  state: z
    .string()
    .trim()
    .refine((v) => (UFS as readonly string[]).includes(v.toUpperCase()), 'UF com 2 letras, ex.: MG.'),
})
export type AddressInput = z.infer<typeof addressSchema>

/** Dono e fatia. "name" só serve para a tela mostrar; o repositório confere a pessoa pelo id. */
export const ownerShareSchema = z.object({
  person_id: z.string().min(1, 'Escolha a pessoa.'),
  name: z.string(),
  share_pct: shareField,
})
export type OwnerShareInput = z.infer<typeof ownerShareSchema>

export const ownersSchema = z
  .array(ownerShareSchema)
  .min(1, 'Escolha pelo menos um proprietário.')
  .superRefine((list, ctx) => {
    const seen = new Set<string>()
    list.forEach((o, i) => {
      if (seen.has(o.person_id)) ctx.addIssue({ code: 'custom', path: [i, 'person_id'], message: `${o.name || 'Esta pessoa'} aparece duas vezes: junte as fatias numa linha só.` })
      seen.add(o.person_id)
    })
    const sum = sharesSum(list)
    if (list.length && sum !== 100) {
      ctx.addIssue({ code: 'custom', message: `As fatias somam ${formatPct(sum)}: precisam somar 100%. ${sum < 100 ? `Faltam ${formatPct(100 - sum)}.` : `Sobram ${formatPct(sum - 100)}.`}` })
    }
  })

/* ---------------------------------------------------------------- equipe do prédio */

/** Papéis da equipe do prédio, na ordem em que aparecem (quem responde pelo prédio primeiro). */
export const STAFF_ROLES = ['syndic', 'caretaker', 'doorman', 'security', 'cleaning', 'other'] as const satisfies readonly StaffRole[]

/** Que papel declarado a pessoa NOVA da equipe ganha (é o que o filtro "Papel" da lista de Pessoas enxerga). */
export const STAFF_ROLE_TAG: Record<StaffRole, PersonTag> = {
  caretaker: 'caretaker', syndic: 'syndic', doorman: 'contact', security: 'contact', cleaning: 'contact', other: 'contact',
}

export const staffRoleField = z.enum(STAFF_ROLES, { error: 'Escolha o papel (zelador, porteiro...).' })

/** Observação curta da ligação: turno, ramal ("seg a sex, 7h às 16h"). */
export const staffNoteField = z.string().trim().max(120, 'Observação até 120 caracteres (turno, ramal).')

/** Uma pessoa da equipe na etapa opcional do cadastro de imóvel: vira ficha nova + ligação ao salvar. */
export const staffDraftSchema = quickPersonSchema.extend({ role: staffRoleField, note: staffNoteField })
export type StaffDraftInput = z.infer<typeof staffDraftSchema>

/* ---------------------------------------------------------------- cadastro em etapas */

/** Características que valem para todas as unidades geradas (cada uma se ajusta depois). */
export const unitDefaultsSchema = z.object({
  kind: z.enum(UNIT_KINDS, { error: 'Escolha o tipo da unidade.' }),
  area_m2: z.number({ error: 'Informe a área em m² (só números).' }).positive('Área maior que zero.').max(100_000, 'Área até 100.000 m².'),
  bedrooms: intField('Quartos', 0, 50),
  bathrooms: intField('Banheiros', 0, 50),
  parking_spots: intField('Vagas', 0, 100),
  asking_rent: moneyText,
})

export const structureSchema = z
  .object({
    template: z.enum(['single', 'tower', 'row_houses']),
    code: z.string().trim().max(30, 'Código até 30 caracteres.'),
    blocks: intField('Blocos', 1, LIMITS.blocks),
    floors: intField('Andares por bloco', 1, LIMITS.floors),
    unitsPerFloor: intField('Unidades por andar', 1, LIMITS.unitsPerFloor),
    startNumber: intField('Número inicial', 1, 9999),
    unit: unitDefaultsSchema,
  })
  .superRefine((v, ctx) => {
    const p = structureProblem(v)
    if (p) ctx.addIssue({ code: 'custom', path: [p.field], message: p.message })
  })

export const newPropertySchema = z.object({
  kind: z.enum(WIZARD_KINDS, { error: 'Escolha o tipo do imóvel.' }),
  name: z.string().trim().min(3, 'Nome com pelo menos 3 letras.').max(120, 'Nome até 120 caracteres.'),
  address: addressSchema,
  /** '' = sem carteira. */
  portfolio_id: z.string(),
  /** '' = sem responsável. */
  manager_user_id: z.string(),
  notes: z.string().trim().max(1000, 'Observações até 1.000 caracteres.'),
  structure: structureSchema,
  owners: ownersSchema,
  /** Etapa opcional "Equipe do prédio": lista vazia = pular. */
  staff: z.array(staffDraftSchema).max(10, 'Até 10 pessoas da equipe no cadastro; o resto se adiciona depois no imóvel.'),
})
export type NewPropertyInput = z.infer<typeof newPropertySchema>

/* ---------------------------------------------------------------- edições */

export const propertyEditSchema = z.object({
  id: z.string().min(1),
  name: newPropertySchema.shape.name,
  address: addressSchema,
  portfolio_id: z.string(),
  manager_user_id: z.string(),
  notes: newPropertySchema.shape.notes,
})
export type PropertyEditInput = z.infer<typeof propertyEditSchema>

export const unitEditSchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(1, 'Informe o código, ex.: A-101.').max(30, 'Código até 30 caracteres.'),
  kind: unitDefaultsSchema.shape.kind,
  area_m2: unitDefaultsSchema.shape.area_m2,
  bedrooms: unitDefaultsSchema.shape.bedrooms,
  bathrooms: unitDefaultsSchema.shape.bathrooms,
  parking_spots: unitDefaultsSchema.shape.parking_spots,
  /** Separadas por vírgula: "varanda, suíte". */
  features: z.string().trim().max(300, 'Características até 300 caracteres.'),
  asking_rent: moneyText,
  manual_status: z.enum(MANUAL_STATUSES),
  notes: z.string().trim().max(1000, 'Observações até 1.000 caracteres.'),
})
export type UnitEditInput = z.infer<typeof unitEditSchema>

export const ownersEditSchema = z.object({ property_id: z.string().min(1), owners: ownersSchema })
export type OwnersEditInput = z.infer<typeof ownersEditSchema>
