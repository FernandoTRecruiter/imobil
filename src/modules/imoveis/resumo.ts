/* =============================================================================
   resumo.ts: o que a ficha curta (FichaCurta.tsx, ao lado do mapa) mostra, na página Imóveis e na Visão geral.

   Pedido do Fernando (06/11/2026): "não quero mudança direto de aba/página por interações
   simples. quero que o mapa seja sempre o foco, tabela pequena à direita com informações simples".
   Então clicar num pino ou numa linha só ESCOLHE, e o painel mostra o básico do escolhido. Este
   arquivo junta esse básico em duas leituras:
     1. getPropertyBrief: um imóvel (endereço, unidades, ocupação, disponíveis, vagas, aluguel em
        vigor, vencido e responsável);
     2. summarizeProperties: o resumo dos imóveis do recorte (nada escolhido), somando os mesmos números.
   A unidade escolhida usa getUnit (data/views/units), a mesma leitura da ficha da unidade.

   ESCOPO (espelho da RLS): imóveis e unidades pela visão da lista (toPropertyRows e toUnitRows, com
   see.*); o vencido pelos lançamentos que a sessão enxerga (toEntryRows, com see.entry) e só para quem
   tem "finance:view": sem a permissão o campo nem é calculado (volta null e o painel não mostra a linha).
   ============================================================================= */
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, connect } from '@/data/api'
import type { Cents, EntryCategory, Id, PropertyKind } from '@/data/types'
import { toEntryRows } from '@/data/views/finance'
import { isSpot, toPropertyRows, toUnitRows, type PropertyRow } from '@/data/views/units'

/** O que conta como receita do imóvel no "Vencido" (a mesma lista da Visão geral: sem taxa, repasse e caução). */
const REVENUE: EntryCategory[] = ['rent', 'condo_fee', 'iptu', 'maintenance', 'other']

/** Os números que o painel mostra, de um imóvel ou do recorte inteiro (mesma conta nos dois). */
export interface BriefNumbers {
  /** Casas, apartamentos, salas e lojas (as vagas de garagem contam à parte). */
  units_total: number
  units_occupied: number
  /** Alugáveis = todas menos as bloqueadas (a base da ocupação). */
  units_rentable: number
  units_available: number
  spots_total: number
  spots_rented: number
  /** Soma dos aluguéis vigentes hoje, das unidades e das vagas. */
  rent_roll_cents: Cents
}

export interface PropertyBrief extends BriefNumbers {
  id: Id
  name: string
  kind: PropertyKind
  district: string
  /** "Rua das Acácias, 450" (o complemento, quando há, vem junto). */
  street_line: string
  manager_name: string | null
  /** Saldo vencido das cobranças do imóvel; null = a sessão não vê o financeiro. */
  overdue_cents: Cents | null
}

/** Alugáveis de cada imóvel: unidades que não são vaga, nem arquivadas, nem bloqueadas (a base da ocupação). */
function rentableByProperty(units: ReturnType<typeof toUnitRows>): Map<Id, number> {
  const m = new Map<Id, number>()
  for (const u of units) if (!isSpot(u) && !u.deleted_at && u.status !== 'blocked') m.set(u.property_id, (m.get(u.property_id) ?? 0) + 1)
  return m
}

function numbersOf(rows: PropertyRow[], rentable: Map<Id, number>): BriefNumbers {
  const sum = (f: (p: PropertyRow) => number) => rows.reduce((a, p) => a + f(p), 0)
  return {
    units_total: sum((p) => p.units_total),
    units_occupied: sum((p) => p.units_occupied),
    units_rentable: sum((p) => rentable.get(p.id) ?? 0),
    units_available: sum((p) => p.units_available),
    spots_total: sum((p) => p.spots_total),
    spots_rented: sum((p) => p.spots_rented),
    rent_roll_cents: sum((p) => p.rent_roll_cents),
  }
}

/**
 * O básico de um imóvel para o painel. Passo a passo:
 * 1. o imóvel pela visão da lista (escopo); fora do acesso ou arquivado = erro de acesso;
 * 2. os números (as mesmas contas da tabela de imóveis) e as alugáveis, para "55 de 64";
 * 3. o vencido: cobranças de receita do imóvel em aberto e já vencidas, só o saldo que falta
 *    (open_cents, a conta do Financeiro), e só para quem vê o financeiro.
 */
export async function getPropertyBrief(s: Session, propertyId: Id): Promise<PropertyBrief> {
  const { db, sc } = await connect(s)
  const p = toPropertyRows(db, sc, s.today).find((x) => x.id === propertyId && !x.deleted_at)
  if (!p) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  const numbers = numbersOf([p], rentableByProperty(toUnitRows(db, sc, s.today)))
  const overdue = can(s, 'finance:view')
    ? toEntryRows(db, sc, s.today)
        .filter((e) => e.property_id === p.id && e.direction === 'receivable' && REVENUE.includes(e.category) && e.state === 'overdue')
        .reduce((a, e) => a + e.open_cents, 0)
    : null
  const a = p.address
  return {
    ...numbers, id: p.id, name: p.name, kind: p.kind, district: a.district, manager_name: p.manager_name, overdue_cents: overdue,
    street_line: `${a.street}, ${a.number}${a.complement ? ` ${a.complement}` : ''}`,
  }
}

/**
 * Resumo do recorte (nada escolhido): os imóveis que estão no mapa agora, somados.
 * `propertyIds` são os ids dos pinos (o mapa e a tabela seguem a mesma busca e os mesmos filtros);
 * id que a sessão não enxerga simplesmente não entra (o escopo filtra antes de somar).
 */
export async function summarizeProperties(s: Session, propertyIds: Id[]): Promise<BriefNumbers & { properties: number }> {
  const { db, sc } = await connect(s)
  const ids = new Set(propertyIds)
  const rows = toPropertyRows(db, sc, s.today).filter((p) => ids.has(p.id) && !p.deleted_at)
  return { properties: rows.length, ...numbersOf(rows, rentableByProperty(toUnitRows(db, sc, s.today))) }
}
