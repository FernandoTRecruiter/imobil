/* =============================================================================
   contratos.ts: contratos de administração e de locação, partes e linha do tempo.

   Regra que o gerador respeita (e que o repositório e o banco vão cobrar): uma unidade
   nunca tem duas locações vigentes no mesmo período. Por isso a locação anterior sempre
   termina ANTES de a atual começar.

   Vaga de garagem (unidade "parking") é alugada por contrato de locação normal, mais curto e sem
   fiador. As vagas entram DEPOIS das casas e apartamentos: parte de quem aluga vaga é morador do
   próprio imóvel (inquilino ou dono de um apartamento), e o morador só existe depois da locação dele.
   ============================================================================= */
import { addDays, addMonths, parts, toIso } from '@/lib/dates'
import { applyPct } from '@/lib/money'
import type { AdjustmentIndex, Contract, ContractStatus, GuaranteeType, Id, IsoDate, Person } from '../types'
import { ORG, USER } from './catalogo'
import { adminOf, base, makePerson, nextSeq, ts, type Ctx, type UnitPlan } from './ctx'

/* ---------------------------------------------------------------- Passo 4a: administração */
/** Um contrato de administração por dono e imóvel da imobiliária: é dele que sai a taxa do repasse. */
export function seedManagementContracts(c: Ctx): void {
  const seen = new Set<string>()
  for (const o of c.db.property_owners) {
    if (o.organization_id !== ORG.agency) continue
    const key = `${o.person_id}:${o.property_id}`
    if (seen.has(key)) continue
    seen.add(key)
    const fee = c.rng.chance(0.6) ? 10 : 8
    c.feeByOwner[key] = fee
    const start = o.since
    const k: Contract = {
      ...base(c, ORG.agency, start),
      kind: 'management', code: `ADM-${String(nextSeq(c, 'adm')).padStart(4, '0')}`, unit_id: null, property_id: o.property_id,
      status: 'active', start_date: start, end_date: addDays(addMonths(start, 60), -1), rent_cents: 0, due_day: 10,
      adjustment_index: 'none', adjustment_month: 1, guarantee_type: 'none', deposit_cents: 0, admin_fee_pct: fee,
      late_fee_pct: 0, interest_pct_month: 0, notes: 'Repasse até o dia 10 do mês seguinte ao recebimento.',
      reviewed_by: USER.admin, approved_by: USER.admin, parent_contract_id: null, import_batch_id: null,
    }
    c.db.contracts.push(k)
    party(c, k, o.person_id, 'lessor', 100)
    event(c, k, 'created', start, null, 'active', {}, 'Contrato de administração assinado.')
  }
}

/* ---------------------------------------------------------------- ajudantes */
function party(c: Ctx, k: Contract, personId: Id, role: 'lessor' | 'lessee' | 'guarantor' | 'representative', share: number | null): void {
  c.db.contract_parties.push({ ...base(c, k.organization_id, k.start_date), contract_id: k.id, person_id: personId, role, share_pct: share })
}

function event(c: Ctx, k: Contract, kind: 'created' | 'status' | 'adjustment' | 'note', date: IsoDate, from: ContractStatus | null, to: ContractStatus | null, payload: Record<string, string | number | null>, note: string, by: Id | null = adminOf(k.organization_id)): void {
  c.db.contract_events.push({
    ...base(c, k.organization_id, date, by), contract_id: k.id, kind, effective_date: date,
    from_status: from, to_status: to, payload, note, document_id: null,
  })
}

function pickIndex(c: Ctx): AdjustmentIndex {
  const r = c.rng.float()
  return r < 0.55 ? 'IPCA' : r < 0.95 ? 'IGPM' : 'fixed'
}

/** Percentual de reajuste fictício por índice (valores plausíveis, não são índices reais). */
function adjustmentPct(c: Ctx, index: AdjustmentIndex): number {
  if (index === 'IPCA') return c.rng.int(360, 540) / 100
  if (index === 'IGPM') return c.rng.int(200, 650) / 100
  if (index === 'INPC') return c.rng.int(340, 520) / 100
  if (index === 'fixed') return 5
  return 0
}

function pickGuarantee(c: Ctx, commercial: boolean): GuaranteeType {
  const r = c.rng.float()
  if (commercial) return r < 0.5 ? 'insurance' : r < 0.85 ? 'guarantor' : 'deposit'
  return r < 0.4 ? 'guarantor' : r < 0.7 ? 'insurance' : r < 0.95 ? 'deposit' : 'none'
}

/** Donos vigentes da unidade: os da própria unidade ou, se não houver, os do imóvel inteiro. */
export function ownersOfUnit(c: Ctx, unitId: Id, propertyId: Id): { person_id: Id; share_pct: number }[] {
  const own = c.db.property_owners.filter((o) => o.unit_id === unitId)
  return own.length ? own : c.db.property_owners.filter((o) => o.property_id === propertyId && o.unit_id === null)
}

interface LeaseOpts {
  plan: UnitPlan
  start: IsoDate
  months: number
  status: ContractStatus
  lessee?: Person
  /** Para rescisão: o contrato acaba antes do previsto nesta data. */
  terminatedOn?: IsoDate
}

/* ---------------------------------------------------------------- criar uma locação */
function makeLease(c: Ctx, o: LeaseOpts): Contract {
  const { rng, ref } = c
  const u = o.plan.unit
  const orgId = o.plan.orgId
  const plannedEnd = addDays(addMonths(o.start, o.months), -1)
  const end = o.terminatedOn ?? plannedEnd
  const spot = u.kind === 'parking'
  const lessee = o.lessee ?? makePerson(c, orgId, o.plan.commercial && rng.chance(0.6) ? 'PJ' : 'PF')
  const index = pickIndex(c)
  // Vaga: garantia leve (sem garantia ou caução); fiador para R$ 200 por mês seria desproporcional.
  const guarantee: GuaranteeType = spot ? (rng.chance(0.7) ? 'none' : 'deposit') : pickGuarantee(c, o.plan.commercial)

  // Aluguel inicial: o pedido de hoje "descontado" pelos anos que passaram, e depois os reajustes de cada aniversário.
  const years = Math.max(0, (Number(ref.slice(0, 4)) - Number(o.start.slice(0, 4))))
  let rent = Math.round(((u.asking_rent_cents ?? 200000) / Math.pow(1.045, years)) * (rng.int(94, 100) / 100) / 5000) * 5000
  const history = [{ from: o.start, cents: rent }]
  const adjustments: { date: IsoDate; pct: number; from: number; to: number }[] = []
  for (let k = 1; ; k++) {
    const when = addMonths(o.start, 12 * k)
    if (when > ref || when > end) break
    const pct = adjustmentPct(c, index)
    const next = rent + applyPct(rent, pct)
    adjustments.push({ date: when, pct, from: rent, to: next })
    rent = next
    history.push({ from: when, cents: rent })
  }

  const firstOwner = ownersOfUnit(c, u.id, u.property_id)[0]
  const fee = orgId === ORG.agency ? (c.feeByOwner[`${firstOwner?.person_id}:${u.property_id}`] ?? 10) : 0
  const reviewer = orgId === ORG.agency ? USER.leasing : USER.landlord
  const approver = orgId === ORG.agency ? USER.admin : USER.landlord
  const before = ['draft', 'in_review'].includes(o.status)
  // Âncora da linha do tempo: o início do contrato, ou ontem se o início ainda não chegou
  // (contrato que começa no mês que vem não pode ter evento com data no futuro).
  const anchor = o.start <= ref ? o.start : addDays(ref, -1)
  const k: Contract = {
    ...base(c, orgId, addDays(anchor, -20), reviewer),
    kind: 'lease',
    code: `LOC-${o.start.slice(0, 4)}-${String(nextSeq(c, `loc-${orgId}`)).padStart(4, '0')}`,
    unit_id: u.id, property_id: u.property_id, status: o.status, start_date: o.start, end_date: end,
    rent_cents: rent, due_day: rng.chance(0.06) ? 31 : rng.pick([5, 5, 10, 10, 10, 15, 20]),
    adjustment_index: index, adjustment_month: parts(o.start)[1], guarantee_type: guarantee,
    deposit_cents: guarantee === 'deposit' ? history[0].cents * rng.int(2, 3) : 0,
    admin_fee_pct: fee, late_fee_pct: 10, interest_pct_month: 1, notes: '',
    reviewed_by: before ? null : reviewer, approved_by: before || o.status === 'awaiting_approval' ? null : approver,
    parent_contract_id: null, import_batch_id: null,
  }
  c.db.contracts.push(k)
  c.rentHistory[k.id] = history

  // Partes: os donos da unidade são os locadores (com a fatia de cada um).
  for (const ow of ownersOfUnit(c, u.id, u.property_id)) party(c, k, ow.person_id, 'lessor', ow.share_pct)
  party(c, k, lessee.id, 'lessee', null)
  if (guarantee === 'guarantor') party(c, k, makePerson(c, orgId, 'PF').id, 'guarantor', null)

  // Linha do tempo: do rascunho até o status atual, um passo de cada vez.
  const flow: ContractStatus[] = ['draft', 'in_review', 'awaiting_approval', 'awaiting_signature', 'active']
  const target = ['ended', 'terminated'].includes(o.status) ? 'active' : o.status
  event(c, k, 'created', addDays(anchor, -20), null, 'draft', {}, 'Contrato criado.', reviewer)
  const offsets = [-20, -16, -12, -8, 0]
  for (let i = 1; i <= flow.indexOf(target); i++) {
    event(c, k, 'status', addDays(anchor, offsets[i]), flow[i - 1], flow[i], {}, '', i >= 3 ? approver : reviewer)
  }
  for (const a of adjustments) {
    event(c, k, 'adjustment', a.date, null, null, { index, pct: a.pct, from_cents: a.from, to_cents: a.to }, `Reajuste anual pelo ${index === 'fixed' ? 'percentual fixo' : index}.`)
  }
  if (o.status === 'ended') event(c, k, 'status', end, 'active', 'ended', {}, 'Fim do prazo; chaves entregues.')
  if (o.status === 'terminated') event(c, k, 'status', end, 'active', 'terminated', { planned_end: plannedEnd }, 'Rescisão por acordo entre as partes, com multa proporcional ao tempo que faltava.')
  return k
}

function setManual(p: UnitPlan, s: 'reserved' | 'maintenance' | 'blocked', note = ''): void {
  p.unit.manual_status = s
  if (note) p.unit.notes = note
}

function durationFor(c: Ctx, p: UnitPlan): number {
  if (p.unit.kind === 'parking') return c.rng.pick([12, 12, 24])
  return p.commercial ? c.rng.pick([36, 36, 60]) : c.rng.pick([30, 30, 30, 12, 36])
}

/**
 * Quem pode alugar vaga como MORADOR de cada imóvel: inquilino de locação vigente de casa, apartamento
 * ou sala do imóvel (no prédio comercial, a empresa que aluga a sala) e dono de uma delas. Ficam de fora
 * as personas com login (o portal delas conta uma história fixa). O condomínio, dono das vagas, não entra
 * porque só é dono de vaga.
 */
function residentsByProperty(c: Ctx): Map<Id, Id[]> {
  const { db } = c
  const kindOf = new Map(db.units.map((u) => [u.id, u.kind]))
  const person = new Map(db.people.map((p) => [p.id, p]))
  const out = new Map<Id, Set<Id>>()
  const add = (propertyId: Id, personId: Id) => {
    const p = person.get(personId)
    if (!p || p.user_id) return
    out.set(propertyId, (out.get(propertyId) ?? new Set<Id>()).add(personId))
  }
  for (const k of db.contracts) {
    if (k.kind !== 'lease' || k.status !== 'active' || !k.unit_id || kindOf.get(k.unit_id) === 'parking') continue
    for (const cp of db.contract_parties) if (cp.contract_id === k.id && cp.role === 'lessee') add(k.property_id, cp.person_id)
  }
  for (const o of db.property_owners) if (o.unit_id && kindOf.get(o.unit_id) !== 'parking') add(o.property_id, o.person_id)
  return new Map([...out].map(([k, v]) => [k, [...v]]))
}

/**
 * Quem aluga uma vaga: um pouco mais da metade das vezes, um MORADOR do mesmo imóvel que ainda não
 * aluga vaga ali; senão, alguém de fora (pessoa fictícia nova; no prédio comercial da Marina, às vezes
 * uma empresa que trabalha perto). "renting" guarda "imóvel:pessoa" de quem já tem vaga vigente.
 */
function spotRenter(c: Ctx, p: UnitPlan, residents: Map<Id, Id[]>, renting: Set<string>): Person {
  const pool = (residents.get(p.unit.property_id) ?? []).filter((id) => !renting.has(`${p.unit.property_id}:${id}`))
  if (pool.length && c.rng.chance(0.55)) return c.db.people.find((x) => x.id === c.rng.pick(pool))!
  return makePerson(c, p.orgId, p.orgId === ORG.landlord && c.rng.chance(0.3) ? 'PJ' : 'PF')
}

/* ---------------------------------------------------------------- Passo 4b: locações */
export function seedLeases(c: Ctx): void {
  const { rng, ref } = c
  const nextMonth = toIso(...(parts(addMonths(ref, 1)).slice(0, 2) as [number, number]), 1)
  let available = 0
  // Casas, apartamentos e salas primeiro; as vagas depois (o locatário da vaga pode ser morador).
  const homes = c.plans.filter((p) => p.unit.kind !== 'parking')
  const spots = c.plans.filter((p) => p.unit.kind === 'parking')
  let residents = new Map<Id, Id[]>()
  const renting = new Set<string>()
  const renterFor = (p: UnitPlan) => spotRenter(c, p, residents, renting)

  for (const p of [...homes, ...spots]) {
    const spot = p.unit.kind === 'parking'
    // Na primeira vaga, as locações de moradia já existem: é a hora de saber quem mora em cada imóvel.
    if (spot && p === spots[0]) residents = residentsByProperty(c)
    let months = durationFor(c, p)
    // A locação da persona (Daniela) começa 14 meses atrás: com prazo sorteado de 12 meses ela sairia
    // "vigente" com o fim já passado. Prazo fixo de 30 meses mantém o contrato dela dentro da vigência.
    // A vaga dela começou 8 meses atrás, com prazo de 12 (também dentro da vigência).
    if (p.forcedLessee) months = spot ? 12 : 30
    const randomStartBack = (back: number) => {
      const d = addMonths(ref, -back)
      const [y, m] = parts(d)
      return toIso(y, m, rng.int(1, 28))
    }

    if (p.fate === 'occupied') {
      let start: IsoDate
      if (p.unit.code === 'A-301') start = addDays(addMonths(addDays(ref, 45), -months), 1) // renovação aparece no portal do Carlos
      else if (p.forcedLessee) start = randomStartBack(spot ? 8 : 14)
      else if (rng.chance(0.09)) start = addDays(addMonths(addDays(ref, rng.int(5, 60)), -months), 1)
      else start = randomStartBack(rng.int(1, months - 3))

      // 35% das unidades ocupadas tiveram um inquilino antes (histórico da linha do tempo); vaga, 20%.
      if (rng.chance(spot ? 0.2 : 0.35)) {
        const prevEnd = addDays(start, -rng.int(10, 45))
        const prevMonths = spot ? 12 : rng.pick([12, 30])
        makeLease(c, { plan: p, start: addDays(addMonths(prevEnd, -prevMonths), 1), months: prevMonths, status: 'ended', lessee: spot ? renterFor(p) : undefined })
      }
      const lessee = p.forcedLessee ?? (spot ? renterFor(p) : undefined)
      const k = makeLease(c, { plan: p, start, months, status: 'active', lessee })
      if (spot && lessee) renting.add(`${p.unit.property_id}:${lessee.id}`)
      const r = rng.float()
      // Vaga atrasa menos que moradia (valor pequeno, costuma ser paga junto com o resto do mês).
      c.payProfile[k.id] =
        p.paymentProfile ??
        (spot ? (r < 0.88 ? 'good' : r < 0.97 ? 'late' : 'delinquent') : p.orgId === ORG.landlord ? (r < 0.15 ? 'late' : 'good') : r < 0.76 ? 'good' : r < 0.92 ? 'late' : 'delinquent')
    } else if (p.fate === 'available') {
      if (!spot) available++
      if (rng.chance(spot ? 0.4 : 0.6)) {
        const end = addDays(ref, -rng.int(20, 150))
        const prevMonths = spot ? 12 : rng.pick([12, 30])
        const start = addDays(addMonths(end, -prevMonths), 1)
        const terminated = !spot && available === 3
        makeLease(c, terminated
          ? { plan: p, start: addMonths(start, -10), months: prevMonths, status: 'terminated', terminatedOn: end }
          : { plan: p, start, months: prevMonths, status: 'ended', lessee: spot ? renterFor(p) : undefined })
      }
      // Duas casas ou apartamentos vagos já têm proposta em análise e um tem rascunho.
      if (!spot && p.orgId === ORG.agency && available <= 3) {
        makeLease(c, { plan: p, start: nextMonth, months, status: available <= 2 ? 'in_review' : 'draft' })
      }
    } else if (p.fate === 'reserved') {
      setManual(p, 'reserved')
      makeLease(c, { plan: p, start: nextMonth, months, status: 'awaiting_signature' })
    } else if (p.fate === 'maintenance') {
      setManual(p, 'maintenance', spot ? 'Repintura da demarcação e troca da lâmpada.' : 'Reforma para a próxima locação (pintura e piso).')
      const end = addDays(ref, -rng.int(15, 60))
      const prevMonths = spot ? 12 : rng.pick([12, 30])
      makeLease(c, { plan: p, start: addDays(addMonths(end, -prevMonths), 1), months: prevMonths, status: 'ended', lessee: spot ? renterFor(p) : undefined })
    } else {
      setManual(p, 'blocked', spot ? 'Bloqueada: área de manobra e de carga e descarga.' : 'Bloqueada pelo proprietário para uso próprio.')
    }
  }
  // Marca de quando os contratos foram mexidos por último (para a coluna "atualizado em").
  for (const k of c.db.contracts) k.updated_at = ts(k.start_date > ref ? ref : k.start_date)
}
