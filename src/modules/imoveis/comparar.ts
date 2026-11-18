/* =============================================================================
   comparar.ts: os números do "Comparar" de imóveis e de unidades (07/11/2026, pedido do
   Fernando: "deixar eu comparar imóveis e unidades").

   O repositório monta cada coisa escolhida com os números que a tela de comparação mostra, e os
   indicadores (PROPERTY_METRICS, UNIT_METRICS) dizem como cada linha se lê e qual lado é o bom.
   A tabela em si (melhor e pior de cada linha) é do kit: components/ui/compare-model.ts.

   Regras de conta (as mesmas das outras telas, para o número bater):
     - unidade, ocupação e disponíveis: a view de imóveis (vaga de garagem fora da conta, regra 042);
     - aluguel médio por m²: soma dos aluguéis vigentes das casas, apartamentos e salas OCUPADOS ÷
       soma da área deles (vaga fora: ela não tem área que se compare com moradia);
     - vencido: saldo em aberto das cobranças a receber com vencimento antes de hoje;
     - inadimplência: vencido ÷ tudo o que venceu (pago ou não) nos últimos 12 meses (a mesma ideia
       da Visão geral: "em atraso ÷ já venceu");
     - chamados abertos: nem concluídos nem cancelados (áreas comuns contam para o imóvel);
     - contratos que vencem em 90 dias: locações vigentes com fim entre hoje e daqui a 90 dias.
   Escopo: tudo passa pelo "see" (espelho da RLS). Id que a sessão não enxerga é ignorado em
   silêncio (link velho, outra persona): comparar não é porta para dado de fora.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { connect } from '@/data/api'
import { UNIT_KIND, UNIT_STATUS } from '@/data/labels'
import { paidByEntry } from '@/data/rules'
import { see } from '@/data/scope'
import type { Id } from '@/data/types'
import { toContractRows } from '@/data/views/contracts'
import { isSpot, toPropertyRows, toUnitRows, type PropertyRow, type UnitRow } from '@/data/views/units'
import type { MetricDef } from '@/components/ui/compare-model'
import { addMonths } from '@/lib/dates'
import { rentPerM2 } from './components'

/* ---------------------------------------------------------------- imóveis */

export interface PropertyCompareItem extends PropertyRow {
  rent_per_m2_cents: number | null
  overdue_cents: number
  delinquency_pct: number | null
  open_requests: number
  ending_90: number
}

/** Os imóveis escolhidos, na ordem em que foram marcados, com os números da comparação. */
export async function getPropertyComparison(s: Session, ids: Id[]): Promise<PropertyCompareItem[]> {
  const { db, sc } = await connect(s)
  const wanted = new Set(ids)
  const props = toPropertyRows(db, sc, s.today).filter((p) => wanted.has(p.id) && !p.deleted_at)
  const units = toUnitRows(db, sc, s.today).filter((u) => wanted.has(u.property_id) && !u.deleted_at)
  const paid = paidByEntry(db.payments)
  const from = addMonths(s.today, -12)
  const leases = toContractRows(db, sc, s.today).filter((k) => wanted.has(k.property_id) && k.kind === 'lease' && k.status === 'active')
  const byId = new Map(
    props.map((p) => {
      // Aluguel por m²: só moradia e sala ocupadas (a vaga não tem área comparável).
      const occ = units.filter((u) => u.property_id === p.id && !isSpot(u) && u.lease && u.area_m2 > 0)
      const area = occ.reduce((a, u) => a + u.area_m2, 0)
      const rent = occ.reduce((a, u) => a + (u.lease?.rent_cents ?? 0), 0)
      // Vencido e o que venceu no período (divisor da inadimplência), das cobranças a receber que a sessão vê.
      let overdue = 0
      let dueTotal = 0
      for (const e of db.financial_entries) {
        if (e.property_id !== p.id || e.direction !== 'receivable' || e.status === 'canceled' || e.due_date >= s.today || !see.entry(sc, e)) continue
        const open = e.status === 'open' ? e.amount_cents - (paid.get(e.id) ?? 0) : 0
        overdue += open
        if (e.due_date >= from) dueTotal += e.amount_cents
      }
      const open = db.maintenance_requests.filter((r) => r.property_id === p.id && !['done', 'canceled'].includes(r.status) && see.maintenance(sc, r)).length
      const ending = leases.filter((k) => k.property_id === p.id && k.days_to_end >= 0 && k.days_to_end <= 90).length
      const item: PropertyCompareItem = {
        ...p,
        rent_per_m2_cents: area > 0 ? Math.round(rent / area) : null,
        overdue_cents: overdue,
        delinquency_pct: dueTotal > 0 ? Math.round((overdue / dueTotal) * 1000) / 10 : null,
        open_requests: open,
        ending_90: ending,
      }
      return [p.id, item] as const
    }),
  )
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
}

export const PROPERTY_METRICS: MetricDef<PropertyCompareItem>[] = [
  { key: 'units', label: 'Unidades', kind: 'int', value: (p) => p.units_total, info: 'Casas, apartamentos e salas (as vagas de garagem contam à parte).' },
  { key: 'occupancy', label: 'Ocupação', kind: 'pct', better: 'higher', value: (p) => p.occupancy_pct, info: 'Ocupadas ÷ alugáveis (bloqueada não conta). Ocupada = locação vigente hoje.' },
  { key: 'available', label: 'Disponíveis', kind: 'int', value: (p) => p.units_available, info: 'Prontas para alugar hoje.' },
  { key: 'spots', label: 'Vagas de garagem', kind: 'int', value: (p) => p.spots_total },
  { key: 'rent_roll', label: 'Aluguel em vigor', kind: 'money', better: 'higher', value: (p) => p.rent_roll_cents, info: 'Soma dos aluguéis vigentes hoje, das unidades e das vagas.' },
  { key: 'rent_m2', label: 'Aluguel médio por m²', kind: 'money', better: 'higher', value: (p) => p.rent_per_m2_cents, info: 'Aluguéis vigentes das unidades ocupadas ÷ a área delas (vaga fora).' },
  { key: 'overdue', label: 'Vencido', kind: 'money', better: 'lower', value: (p) => p.overdue_cents, info: 'Saldo em aberto das cobranças a receber com vencimento antes de hoje.' },
  { key: 'delinquency', label: 'Inadimplência', kind: 'pct', better: 'lower', value: (p) => p.delinquency_pct, info: 'Vencido em aberto ÷ tudo o que venceu (pago ou não) nos últimos 12 meses.' },
  { key: 'requests', label: 'Chamados abertos', kind: 'int', better: 'lower', value: (p) => p.open_requests, info: 'Nem concluídos nem cancelados; inclui os das áreas comuns.' },
  { key: 'ending', label: 'Contratos que vencem em 90 dias', kind: 'int', value: (p) => p.ending_90, info: 'Locações vigentes com fim entre hoje e daqui a 90 dias: hora de falar em renovação.' },
]

/* ---------------------------------------------------------------- unidades */

export interface UnitCompareItem extends UnitRow {
  rent_cents: number | null
  rent_per_m2_cents: number | null
  open_requests: number
}

/** As unidades escolhidas, na ordem em que foram marcadas, com os chamados abertos de cada uma. */
export async function getUnitComparison(s: Session, ids: Id[]): Promise<UnitCompareItem[]> {
  const { db, sc } = await connect(s)
  const wanted = new Set(ids)
  const rows = new Map(toUnitRows(db, sc, s.today).filter((u) => wanted.has(u.id)).map((u) => [u.id, u]))
  const open = new Map<Id, number>()
  for (const r of db.maintenance_requests) {
    if (!r.unit_id || !wanted.has(r.unit_id) || ['done', 'canceled'].includes(r.status) || !see.maintenance(sc, r)) continue
    open.set(r.unit_id, (open.get(r.unit_id) ?? 0) + 1)
  }
  return ids.flatMap((id) => {
    const u = rows.get(id)
    return u ? [{ ...u, rent_cents: u.lease?.rent_cents ?? u.asking_rent_cents, rent_per_m2_cents: rentPerM2(u), open_requests: open.get(id) ?? 0 }] : []
  })
}

export const UNIT_METRICS: MetricDef<UnitCompareItem>[] = [
  { key: 'status', label: 'Situação', kind: 'text', value: (u) => UNIT_STATUS[u.status] },
  { key: 'kind', label: 'Tipo', kind: 'text', value: (u) => UNIT_KIND[u.kind] },
  { key: 'area', label: 'Área', kind: 'area', value: (u) => u.area_m2 },
  { key: 'bedrooms', label: 'Quartos', kind: 'int', value: (u) => (u.bedrooms ? u.bedrooms : null) },
  { key: 'rent', label: 'Aluguel', kind: 'money', value: (u) => u.rent_cents, info: 'O vigente; sem locação, o valor pedido no anúncio.' },
  { key: 'rent_m2', label: 'Aluguel por m²', kind: 'money', better: 'higher', value: (u) => u.rent_per_m2_cents, info: 'Aluguel ÷ área (sem locação, do valor pedido).' },
  { key: 'lessee', label: 'Locatário', kind: 'text', value: (u) => u.lease?.lessee_name || null },
  { key: 'lessee_since', label: 'Locatário desde', kind: 'date', value: (u) => u.lessee_since, info: 'Início da primeira locação dele nesta unidade (a renovação não zera).' },
  { key: 'term', label: 'Tempo de contrato', kind: 'months', value: (u) => u.lease_elapsed_months, info: 'Quanto já passou da locação vigente.' },
  { key: 'end', label: 'Fim do contrato', kind: 'date', value: (u) => u.lease?.end_date ?? null },
  { key: 'dependents', label: 'Dependentes do locatário', kind: 'int', value: (u) => u.lessee_dependents },
  { key: 'pets', label: 'Animais do locatário', kind: 'text', value: (u) => (u.lease ? u.lessee_pets || (u.lessee_dependents !== null ? 'nenhum' : null) : null) },
  { key: 'requests', label: 'Chamados abertos', kind: 'int', better: 'lower', value: (u) => u.open_requests },
]

/** Nome curto de cada unidade no cabeçalho e no arquivo ("A-301 · Condomínio Luar"). */
export const unitCompareName = (u: Pick<UnitRow, 'code' | 'property_name'>) => `${u.code} · ${u.property_name}`
