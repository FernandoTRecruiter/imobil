/* =============================================================================
   ctx.ts: o "estojo" que todos os passos do gerador compartilham.
   Guarda o sorteio (com semente), o banco que está sendo montado, a data de referência
   ("hoje" dos dados) e ajudantes para criar linha, pessoa e endereço.
   ============================================================================= */
import { Rng } from '@/lib/random'
import { cnpjFromBase, cpfFromBase } from '@/lib/documents'
import { addDays } from '@/lib/dates'
import { normalize } from '@/lib/text'
import { emptyDb, type Db } from '../db'
import type { Address, Base, Id, IsoDate, Person, Unit } from '../types'
import { COMPANY_KINDS, COMPANY_WORDS, DISTRICTS, FIRST_NAMES_F, FIRST_NAMES_M, ORG, SEED, STREETS, SURNAMES, USER } from './catalogo'

/** O que o gerador sabe de cada unidade além da própria linha (destino e quem é dono). */
export interface UnitPlan {
  unit: Unit
  orgId: Id
  commercial: boolean
  fate: 'occupied' | 'available' | 'reserved' | 'maintenance' | 'blocked'
  /** Forçado para as personas (ex.: a inquilina Daniela mora nesta unidade). */
  forcedLessee?: Person
  paymentProfile?: 'good' | 'late' | 'delinquent'
}

export interface Ctx {
  rng: Rng
  db: Db
  ref: IsoDate
  plans: UnitPlan[]
  persons: Record<string, Person> // personas e pessoas com papel fixo (carlos, helena, daniela...)
  seq: Record<string, number>
  /** Nomes já sorteados nesta geração (fica no contexto para "Restaurar dados" repetir os mesmos nomes). */
  usedNames: Set<string>
  /** Aluguel em vigor por período de cada contrato (muda a cada reajuste). */
  rentHistory: Record<Id, { from: IsoDate; cents: number }[]>
  /** Como cada inquilino paga: em dia, atrasando ou inadimplente. */
  payProfile: Record<Id, 'good' | 'late' | 'delinquent'>
  /** Taxa de administração por dono e imóvel ("pessoa:imóvel" -> %). */
  feeByOwner: Record<string, number>
  /** Forma de cada bloco em exemplos.ts (id do bloco -> forma): o modelo do 3D sai dela (passo 13). */
  shapes: Record<Id, string>
}

export function createCtx(ref: IsoDate): Ctx {
  return { rng: new Rng(SEED), db: emptyDb(), ref, plans: [], persons: {}, seq: {}, usedNames: new Set(), rentHistory: {}, payProfile: {}, feeByOwner: {}, shapes: {} }
}

/** Data e hora no fuso de Brasília, no formato que o banco devolve. */
export function ts(d: IsoDate, hour = 12): string {
  return `${d}T${String(hour).padStart(2, '0')}:00:00-03:00`
}

export function adminOf(orgId: Id): Id {
  return orgId === ORG.agency ? USER.admin : USER.landlord
}

/** Colunas comuns de toda linha (id, organização, quando e por quem). */
export function base(c: Ctx, orgId: Id, createdOn: IsoDate, by: Id | null = adminOf(orgId)): Base {
  return { id: c.rng.uuid(), organization_id: orgId, created_at: ts(createdOn), updated_at: ts(createdOn), created_by: by }
}

/** Próximo número de uma sequência (LOC-0001, CH-0001...). */
export function nextSeq(c: Ctx, key: string): number {
  c.seq[key] = (c.seq[key] ?? 0) + 1
  return c.seq[key]
}

export function randomName(c: Ctx): string {
  for (let i = 0; i < 50; i++) {
    const first = c.rng.chance(0.5) ? c.rng.pick(FIRST_NAMES_F) : c.rng.pick(FIRST_NAMES_M)
    const name = `${first} ${c.rng.pick(SURNAMES)} ${c.rng.pick(SURNAMES)}`
    if (!c.usedNames.has(name)) {
      c.usedNames.add(name)
      return name
    }
  }
  return `${c.rng.pick(FIRST_NAMES_F)} ${c.rng.pick(SURNAMES)} ${nextSeq(c, 'nome')}`
}

export function randomCompany(c: Ctx): string {
  return `${c.rng.pick(COMPANY_WORDS)} ${c.rng.pick(COMPANY_KINDS)}`
}

export function makeAddress(c: Ctx, district = c.rng.pick(DISTRICTS).name, street = c.rng.pick(STREETS), number?: string): Address {
  return {
    cep: '3' + c.rng.int(0, 1) + c.rng.digits(6),
    street,
    number: number ?? String(c.rng.int(10, 2400)),
    complement: '',
    district,
    city: 'Belo Horizonte',
    state: 'MG',
  }
}

export function coordsOf(c: Ctx, district: string): { lat: number; lng: number } {
  const d = DISTRICTS.find((x) => x.name === district) ?? DISTRICTS[0]
  return { lat: d.lat + (c.rng.float() - 0.5) * 0.012, lng: d.lng + (c.rng.float() - 0.5) * 0.012 }
}

/** Cria uma pessoa fictícia com documento válido, e-mail @example.com e telefone inexistente. */
export function makePerson(c: Ctx, orgId: Id, kind: 'PF' | 'PJ', name?: string, extra: Partial<Person> = {}): Person {
  const finalName = name ?? (kind === 'PF' ? randomName(c) : randomCompany(c))
  const slug = normalize(finalName).replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')
  const p: Person = {
    ...base(c, orgId, addDays(c.ref, -c.rng.int(40, 900))),
    deleted_at: null,
    kind,
    name: finalName,
    document: kind === 'PF' ? cpfFromBase(c.rng.digits(9)) : cnpjFromBase(c.rng.digits(8) + '0001'),
    email: `${slug}@example.com`,
    phone: '310' + c.rng.digits(8),
    address: kind === 'PF' && c.rng.chance(0.6) ? makeAddress(c) : null,
    notes: '',
    tags: [],
    vendor_categories: [],
    user_id: null,
    ...extra,
  }
  c.db.people.push(p)
  return p
}
