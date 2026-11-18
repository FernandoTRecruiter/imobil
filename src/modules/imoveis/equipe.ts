/* =============================================================================
   equipe.ts: a EQUIPE DO PRÉDIO (zelador, porteiro, síndico, limpeza, segurança) de cada imóvel.

   A tabela property_staff liga uma pessoa (people) a um imóvel com um papel e uma observação
   curta (turno, ramal). A foto, quando houver, mora na pessoa: o mesmo zelador em dois prédios
   tem uma foto só.

   QUEM VÊ (see.staff, espelho da RLS): a equipe da conta vê todos; proprietário e inquilino veem
   a equipe do imóvel deles (é para isso que ela serve: saber a quem chamar). Desta pessoa o
   portal recebe só nome, telefone, papel e foto, mesmo sem enxergar a ficha dela em Pessoas.
   Na fase 2 isso vira uma VIEW que expõe só essas colunas (a ficha completa continua protegida).

   QUEM GRAVA: só a equipe da conta com "editar imóveis". Cadastrar a pessoa na hora (cadastro
   rápido) pede também "editar pessoas", porque cria uma ficha em Pessoas.
   Nada é apagado: quem sai da equipe fica com active = false ("Desativar", com Desfazer).
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { AccessError, audit, connect, diff, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { STAFF_ROLE } from '@/data/labels'
import { see, type Scope } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type { Id, IsoDate, Person, Property, PropertyStaff, StaffRole } from '@/data/types'
import { newQuickPerson, quickPersonSchema } from '@/modules/pessoas/repo'
import { baseRow, parseOrRule, requireEditor } from './repo'
import { STAFF_ROLE_TAG, STAFF_ROLES, staffNoteField, staffRoleField } from './schemas'

/* ---------------------------------------------------------------- leitura */

export interface StaffRow {
  id: Id
  property_id: Id
  person_id: Id
  name: string
  phone: string
  /** Só para a equipe da conta; o portal recebe vazio. */
  email: string
  photo: string | null
  role: StaffRole
  note: string
  active: boolean
  since: IsoDate
}

const ROLE_RANK = new Map<StaffRole, number>(STAFF_ROLES.map((r, i) => [r, i]))

/** Linhas da equipe (já filtradas pelo escopo) com o nome, o telefone e a foto da pessoa. */
export function toStaffRows(db: Db, sc: Scope, propertyId: Id): StaffRow[] {
  const people = new Map(db.people.filter((p) => p.organization_id === sc.orgId).map((p) => [p.id, p]))
  return db.property_staff
    .filter((r) => r.property_id === propertyId && see.staff(sc, r) && (sc.all || r.active)) // portal não vê quem já saiu
    .map((r) => {
      const p = people.get(r.person_id)
      return {
        id: r.id, property_id: r.property_id, person_id: r.person_id, name: p?.name ?? 'Pessoa removida', phone: p?.phone ?? '',
        email: sc.all ? (p?.email ?? '') : '', photo: p?.photo ?? null, role: r.role, note: r.note, active: r.active, since: r.created_at.slice(0, 10),
      }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || ROLE_RANK.get(a.role)! - ROLE_RANK.get(b.role)! || a.name.localeCompare(b.name, 'pt-BR'))
}

/** O imóvel existe e a sessão o enxerga? (toda leitura e gravação começa por aqui) */
function requireProperty(db: Db, sc: Scope, id: Id): Property {
  const p = db.properties.find((x) => x.id === id)
  if (!p || !see.property(sc, p)) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  return p
}

/** Equipe do imóvel: ativos primeiro, na ordem dos papéis (síndico, zelador, porteiro...). */
export async function listPropertyStaff(s: Session, propertyId: Id): Promise<StaffRow[]> {
  const { db, sc } = await connect(s)
  requireProperty(db, sc, propertyId)
  return toStaffRows(db, sc, propertyId)
}

/* ---------------------------------------------------------------- gravação */

export const addStaffSchema = z
  .object({
    property_id: z.string().min(1, 'Escolha o imóvel.'),
    role: staffRoleField,
    note: staffNoteField,
    /** Pessoa já cadastrada... */
    person_id: z.string().nullable(),
    /** ...ou cadastro rápido (nome, telefone, foto). Uma das duas, nunca as duas. */
    new_person: quickPersonSchema.nullable(),
  })
  .refine((v) => !!v.person_id !== !!v.new_person, { message: 'Escolha uma pessoa já cadastrada ou cadastre uma nova (uma das duas).' })
export type AddStaffInput = z.infer<typeof addStaffSchema>

export const updateStaffSchema = z.object({
  id: z.string().min(1),
  role: staffRoleField,
  note: staffNoteField,
})
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>

/** Imóvel arquivado não muda de equipe (a ficha dele está congelada até restaurar). */
function requireOpen(p: Property): void {
  if (p.deleted_at) throw new RuleError(`"${p.name}" está arquivado. Restaure o imóvel antes de mexer na equipe dele.`)
}

/** A mesma pessoa no mesmo papel, ativa, no mesmo imóvel (fora a própria linha). */
function activeTwin(db: Db, propertyId: Id, personId: Id, role: StaffRole, exceptId: Id | null): PropertyStaff | undefined {
  return db.property_staff.find((r) => r.property_id === propertyId && r.person_id === personId && r.role === role && r.active && r.id !== exceptId)
}

const lower = (role: StaffRole) => STAFF_ROLE[role].toLowerCase()

/**
 * Põe alguém na equipe do prédio. Passo a passo:
 *   1. permissão (editar imóveis) e validação (zod);
 *   2. o imóvel existe, a sessão o vê e ele não está arquivado;
 *   3. a pessoa: a escolhida (desta conta, não arquivada) ou a do cadastro rápido (pede "editar pessoas");
 *   4. regra: a mesma pessoa no mesmo papel não entra duas vezes; se ela já esteve e foi desativada,
 *      a linha antiga volta (o histórico continua numa linha só);
 *   5. grava a pessoa nova (se houver) e a ligação, cada uma com a sua linha na auditoria.
 */
export async function addPropertyStaff(s: Session, input: AddStaffInput): Promise<PropertyStaff> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const data = parseOrRule(addStaffSchema, input)
  const property = requireProperty(db, sc, data.property_id)
  requireOpen(property)

  let person: Person
  let created = false
  if (data.person_id) {
    const p = db.people.find((x) => x.id === data.person_id && x.organization_id === s.org.id)
    if (!p || p.deleted_at) throw new RuleError('A pessoa escolhida não está mais no cadastro (arquivada ou de outra conta). Escolha outra pessoa.')
    person = p
  } else {
    person = newQuickPerson(s, sc, data.new_person!, STAFF_ROLE_TAG[data.role])
    created = true
  }

  const twin = activeTwin(db, property.id, person.id, data.role, null)
  if (twin) throw new RuleError(`${person.name} já está como ${lower(data.role)} deste imóvel. Para mudar turno ou ramal, edite a linha dele na equipe.`)

  const now = nowIso()
  if (created) {
    upsertRows('people', [person])
    audit(s, 'people', person.id, 'create', `Cadastrou ${person.name} (equipe do prédio de "${property.name}")`)
  }
  const old = db.property_staff.find((r) => r.property_id === property.id && r.person_id === person.id && r.role === data.role && !r.active)
  if (old) {
    const back: PropertyStaff = { ...old, active: true, note: data.note, updated_at: now }
    upsertRows('property_staff', [back])
    audit(s, 'property_staff', back.id, 'restore', `${person.name} voltou à equipe de "${property.name}" como ${lower(data.role)}`, diff(old, back))
    return back
  }
  const row: PropertyStaff = { ...baseRow(s, now), property_id: property.id, person_id: person.id, role: data.role, note: data.note, active: true }
  upsertRows('property_staff', [row])
  audit(s, 'property_staff', row.id, 'create', `Adicionou ${person.name} como ${lower(data.role)} de "${property.name}"`)
  return row
}

/** A linha da equipe existe e a sessão a vê? Devolve a linha, o imóvel e o nome da pessoa. */
function requireStaff(db: Db, sc: Scope, id: Id): { row: PropertyStaff; property: Property; name: string } {
  const row = db.property_staff.find((r) => r.id === id)
  if (!row || !see.staff(sc, row)) throw new AccessError('Pessoa da equipe não encontrada ou fora do seu acesso.')
  const property = requireProperty(db, sc, row.property_id)
  return { row, property, name: db.people.find((p) => p.id === row.person_id)?.name ?? 'Pessoa' }
}

/** Troca o papel ou a observação (turno, ramal). A auditoria guarda o "de X para Y". */
export async function updatePropertyStaff(s: Session, input: UpdateStaffInput): Promise<PropertyStaff> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const data = parseOrRule(updateStaffSchema, input)
  const { row: before, property, name } = requireStaff(db, sc, data.id)
  requireOpen(property)
  if (before.active && data.role !== before.role && activeTwin(db, property.id, before.person_id, data.role, before.id)) {
    throw new RuleError(`${name} já está como ${lower(data.role)} deste imóvel em outra linha. Desative uma das duas.`)
  }
  const after: PropertyStaff = { ...before, role: data.role, note: data.note, updated_at: nowIso() }
  const changes = diff(before, after)
  if (!changes) return before // nada mudou: não grava nem polui a auditoria
  upsertRows('property_staff', [after])
  audit(s, 'property_staff', after.id, 'update', `Alterou ${name} na equipe de "${property.name}"`, changes)
  return after
}

/**
 * Desativar (saiu do prédio) ou reativar. A linha nunca é apagada: o histórico do imóvel continua
 * sabendo quem foi zelador em cada época. Reativar é recusado se a mesma pessoa já voltou no
 * mesmo papel por outra linha.
 */
export async function setPropertyStaffActive(s: Session, args: { id: Id; active: boolean }): Promise<PropertyStaff> {
  const { db, sc } = await connect(s)
  requireEditor(s, sc)
  const { row: before, property, name } = requireStaff(db, sc, args.id)
  requireOpen(property)
  if (before.active === args.active) return before
  if (args.active && activeTwin(db, property.id, before.person_id, before.role, before.id)) {
    throw new RuleError(`${name} já está ativa como ${lower(before.role)} deste imóvel. Não há o que reativar.`)
  }
  const after: PropertyStaff = { ...before, active: args.active, updated_at: nowIso() }
  upsertRows('property_staff', [after])
  audit(
    s, 'property_staff', after.id, args.active ? 'restore' : 'archive',
    args.active ? `${name} voltou à equipe de "${property.name}"` : `${name} saiu da equipe de "${property.name}" (${lower(before.role)})`,
    diff(before, after),
  )
  return after
}
