/* =============================================================================
   cadastro.ts (passo 15, o ÚLTIMO do gerador): o que a tela de 07/11/2026 pediu e os dados
   fictícios ainda não tinham.
     1. renovações: algumas locações vigentes antigas ganham o contrato ANTERIOR do mesmo
        locatário (renovado), para "Renovações", "Cliente desde" e "Locatário desde" terem o que
        mostrar. O anterior acaba na véspera do atual (sem cruzar) e fica INTEIRO antes da janela do
        financeiro (12 meses): por isso ele não precisa de cobrança, e nada do que já existia muda;
     2. moradia e convivência das pessoas físicas: dependentes, animais, veículos e ocupação.
   Por que é o último passo: ele usa o mesmo sorteio com semente, e nada sorteia depois dele. Assim
   todos os dados de antes continuam IGUAIS (os testes e a Visão geral não mudam) e este passo só
   acrescenta. Personas com login (portal) ficam de fora das renovações: a história delas é fixa.
   ============================================================================= */
import { addDays, addMonths, monthStart, monthsBetween } from '@/lib/dates'
import type { Contract, ContractParty, ContractStatus, IsoDate } from '../types'
import { FIRST_NAMES_F } from './catalogo'
import { adminOf, base, nextSeq, ts, type Ctx } from './ctx'

/** Ocupações [masculino, feminino]: o gênero sai do primeiro nome (catalogo.ts), para não ler "Ana, engenheiro". */
const OCCUPATIONS: [string, string][] = [
  ['Professor', 'Professora'], ['Engenheiro', 'Engenheira'], ['Enfermeiro', 'Enfermeira'], ['Analista de sistemas', 'Analista de sistemas'],
  ['Advogado', 'Advogada'], ['Comerciante', 'Comerciante'], ['Médico', 'Médica'], ['Arquiteto', 'Arquiteta'], ['Contador', 'Contadora'],
  ['Estudante', 'Estudante'], ['Aposentado', 'Aposentada'], ['Designer', 'Designer'], ['Vendedor', 'Vendedora'], ['Servidor público', 'Servidora pública'],
]
const PETS = ['1 cachorro', '1 cachorro', '2 cachorros', '1 gato', '1 gato', '2 gatos', '1 cachorro e 1 gato', '1 pássaro']

export function seedCadastro(c: Ctx): void {
  seedRenewals(c)
  seedHouseholds(c)
}

/* ---------------------------------------------------------------- 1. renovações */

/**
 * Passo a passo, para cada locação vigente de casa, apartamento ou sala que começou antes da janela
 * do financeiro, de locatário sem login:
 *   1. sorteia se houve renovação (45%) e quantas (1 ou, às vezes, 2);
 *   2. o contrato anterior tem o mesmo prazo e acaba na véspera do atual; se cruzaria com outra
 *      locação da unidade (o inquilino de antes), para ali;
 *   3. as partes são as mesmas (locadores, locatário, fiador) e a linha do tempo conta a história:
 *      criado, aprovado, vigente, "renovação criada" e "fim do prazo; seguiu na renovação";
 *   4. o atual aponta para o anterior (parent_contract_id), como faz o "Renovar" da tela.
 */
function seedRenewals(c: Ctx): void {
  const { db, rng, ref } = c
  const windowStart = monthStart(addMonths(ref, -12))
  const kind = new Map(db.units.map((u) => [u.id, u.kind]))
  const people = new Map(db.people.map((p) => [p.id, p]))
  const holding: ContractStatus[] = ['active', 'ended', 'terminated', 'awaiting_signature']
  const candidates = db.contracts.filter((k) => k.kind === 'lease' && k.status === 'active' && k.unit_id && kind.get(k.unit_id) !== 'parking' && k.start_date < windowStart)
  for (const current of candidates) {
    const lessee = db.contract_parties.find((p) => p.contract_id === current.id && p.role === 'lessee')
    if (!lessee || people.get(lessee.person_id)?.user_id) continue
    if (!rng.chance(0.45)) continue // passo 1
    const rounds = rng.chance(0.3) ? 2 : 1
    let child = current
    for (let i = 0; i < rounds; i++) {
      // Passo 2: mesmo prazo do atual; nada antes de 2019 (os dados contam uns poucos anos).
      const months = Math.max(12, monthsBetween(child.start_date, addDays(child.end_date, 1)))
      const end = addDays(child.start_date, -1)
      const start = addMonths(child.start_date, -months)
      const clash = db.contracts.some((k) => k.unit_id === child.unit_id && holding.includes(k.status) && k.start_date <= end && start <= k.end_date)
      if (clash || start < '2019-01-01') break
      const prev = previousLease(c, child, start, end)
      child.parent_contract_id = prev.id // passo 4
      child = prev
    }
  }
}

/** O contrato anterior (já encerrado) e a linha do tempo dele. Aluguel um pouco menor: era antes dos reajustes. */
function previousLease(c: Ctx, child: Contract, start: IsoDate, end: IsoDate): Contract {
  const { db, rng } = c
  const org = child.organization_id
  const firstRent = c.rentHistory[child.id]?.[0]?.cents ?? child.rent_cents
  const k: Contract = {
    ...child,
    ...base(c, org, addDays(start, -20)),
    code: `LOC-${start.slice(0, 4)}-${String(nextSeq(c, `loc-${org}`)).padStart(4, '0')}`,
    status: 'ended', start_date: start, end_date: end,
    rent_cents: Math.max(5000, Math.round(firstRent / (1.04 + rng.float() * 0.03) / 5000) * 5000),
    adjustment_month: Number(start.slice(5, 7)), parent_contract_id: null, import_batch_id: null, notes: '',
  }
  k.updated_at = ts(end)
  db.contracts.push(k)
  c.rentHistory[k.id] = [{ from: start, cents: k.rent_cents }]
  // Passo 3: as mesmas partes do contrato seguinte.
  for (const p of db.contract_parties.filter((x) => x.contract_id === child.id)) {
    const row: ContractParty = { ...base(c, org, start), contract_id: k.id, person_id: p.person_id, role: p.role, share_pct: p.share_pct }
    db.contract_parties.push(row)
  }
  const by = adminOf(org)
  const ev = (kind: 'created' | 'status' | 'renewal', date: IsoDate, from: ContractStatus | null, to: ContractStatus | null, note: string, payload: Record<string, string> = {}) =>
    db.contract_events.push({ ...base(c, org, date, by), contract_id: k.id, kind, effective_date: date, from_status: from, to_status: to, payload, note, document_id: null })
  ev('created', addDays(start, -20), null, 'draft', 'Contrato criado.')
  ev('status', addDays(start, -12), 'draft', 'in_review', '')
  ev('status', addDays(start, -8), 'in_review', 'awaiting_approval', '')
  ev('status', addDays(start, -4), 'awaiting_approval', 'awaiting_signature', '')
  ev('status', start, 'awaiting_signature', 'active', '')
  ev('renewal', addDays(end, -45), null, null, `Renovação criada: ${child.code}.`, { new_contract_id: child.id, new_code: child.code })
  ev('status', end, 'active', 'ended', `Fim do prazo; seguiu na renovação ${child.code}.`)
  return k
}

/* ---------------------------------------------------------------- 2. moradia e convivência */

/**
 * Pessoa física sem papel declarado (dono, inquilino, fiador e interessado; a equipe do prédio e os
 * prestadores ficam vazios: o dado não serve para nada neles). Empresa: só veículos (frota que usa a vaga).
 * Uns 15% ficam sem nada preenchido, como na vida real (cadastro incompleto).
 */
function seedHouseholds(c: Ctx): void {
  const { db, rng } = c
  for (const p of db.people) {
    if (p.tags.length) continue
    if (p.kind === 'PJ') {
      p.vehicles = rng.pick([0, 1, 1, 2, 3])
      continue
    }
    if (rng.chance(0.15)) continue
    p.dependents = rng.pick([0, 0, 0, 1, 1, 2, 2, 3, 4])
    p.pets = rng.chance(0.38) ? rng.pick(PETS) : ''
    p.vehicles = rng.pick([0, 1, 1, 1, 2])
    const female = FIRST_NAMES_F.includes(p.name.split(' ')[0])
    p.occupation = rng.pick(OCCUPATIONS)[female ? 1 : 0]
  }
}

