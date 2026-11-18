/* =============================================================================
   repo.ts dos Relatórios: a única porta de dados da tela.

   1. connect(s) -> escopo (espelho da RLS) -> linhas das views (já com nomes);
   2. filtros (período, imóvel, carteira, proprietário) -> contas puras (reports.ts).
   Tudo é calculado aqui e não na tela: na fase 2 isto vira consulta no banco.

   Quem vê o quê:
   - só a equipe com "reports:view";
   - sem "finance:view", nenhum lançamento nem repasse sai daqui (as abas de dinheiro somem);
   - repasse e taxa de administração só existem na conta de imobiliária.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { can, hasFeature } from '@/auth/permissions'
import { AccessError, connect } from '@/data/api'
import { see } from '@/data/scope'
import type { IsoDate } from '@/data/types'
import { toContractRows } from '@/data/views/contracts'
import { toEntryRows, toMaintenanceRows } from '@/data/views/finance'
import { lookup } from '@/data/views/lookup'
import { toUnitRows } from '@/data/views/units'
import { isPeriodKey, NONE } from '@/modules/visao-geral/metrics'
import {
  applyReportFilters, buildReports, DEFAULT_REPORT_FILTERS, reportOptions,
  type ReportFilters, type ReportInput, type ReportOptions, type Reports, type TransferRow,
} from './reports'

export interface ReportsShow {
  /** Abas e colunas de dinheiro. */
  money: boolean
  /** Aba de repasses (imobiliária com permissão de financeiro). */
  transfers: boolean
  /** Coluna de taxa de administração (só imobiliária cobra taxa). */
  fee: boolean
  portfolios: boolean
  /** Filtro de proprietário (some quando a conta tem um dono só). */
  owners: boolean
}

export interface ReportsData {
  today: IsoDate
  reports: Reports
  /** Os filtros que valeram (id que não existe nesta conta vira "todos"). */
  filters: ReportFilters
  options: ReportOptions
  show: ReportsShow
}

export async function getReports(s: Session, input: Partial<ReportFilters>): Promise<ReportsData> {
  const { db, sc } = await connect(s)
  if (!sc.all || !can(s, 'reports:view')) throw new AccessError('Os relatórios são da equipe da conta.')
  const money = can(s, 'finance:view')
  const agency = hasFeature(s, 'transfers')
  const L = lookup(db)

  // Passo 1: as linhas das views, todas pelo escopo. Unidade arquivada (ou de imóvel arquivado) fica de fora.
  const units = toUnitRows(db, sc, s.today, L).filter((u) => !u.deleted_at && !L.property.get(u.property_id)?.deleted_at)
  // Repasses e carteiras não têm regra em "see": a equipe vê os da própria organização (regra escrita aqui).
  const transfers: TransferRow[] =
    money && agency
      ? db.owner_transfers
          .filter((t) => t.organization_id === s.org.id)
          .map((t) => ({
            id: t.id, owner_person_id: t.owner_person_id, owner_name: L.person.get(t.owner_person_id)?.name ?? 'Proprietário', month: t.month,
            gross_cents: t.gross_cents, admin_fee_cents: t.admin_fee_cents, expenses_cents: t.expenses_cents, net_cents: t.net_cents, status: t.status,
          }))
      : []
  const base: ReportInput = {
    today: s.today,
    units,
    unitCreated: new Map(db.units.filter((u) => see.unit(sc, u)).map((u) => [u.id, u.created_at.slice(0, 10)])),
    portfolioName: new Map(db.portfolios.filter((p) => p.organization_id === s.org.id).map((p) => [p.id, p.name])),
    contracts: toContractRows(db, sc, s.today, L),
    entries: money ? toEntryRows(db, sc, s.today, L) : [],
    maintenance: toMaintenanceRows(db, sc, s.today, L),
    transfers,
  }

  // Passo 2: o que aparece para esta pessoa e os filtros que valem.
  const ownerIds = new Set(units.flatMap((u) => u.owners.map((o) => o.person_id)))
  const show: ReportsShow = { money, transfers: money && agency, fee: agency, portfolios: hasFeature(s, 'portfolios'), owners: ownerIds.size > 1 }
  const has = (pred: (u: (typeof units)[number]) => boolean) => units.some(pred)
  const filters: ReportFilters = {
    period: isPeriodKey(input.period) ? input.period : DEFAULT_REPORT_FILTERS.period,
    property: input.property && has((u) => u.property_id === input.property) ? input.property : '',
    portfolio: show.portfolios && input.portfolio && has((u) => (input.portfolio === NONE ? u.portfolio_id === null : u.portfolio_id === input.portfolio)) ? input.portfolio : '',
    owner: show.owners && input.owner && ownerIds.has(input.owner) ? input.owner : '',
  }

  // Passo 3: as contas, sobre o recorte.
  return { today: s.today, reports: buildReports(applyReportFilters(base, filters), filters.period), filters, options: reportOptions(base, filters), show }
}
