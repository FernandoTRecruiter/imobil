/* =============================================================================
   repo.ts da Visão geral: a única porta de dados da tela.

   Formato do módulo de referência (documentos), adaptado a um painel:
     1. connect(s) -> escopo (espelho da RLS) -> linhas Lite (lite.ts);
     2. filtros que a pessoa escolheu -> fórmulas puras (macro.ts, desempenho.ts);
     3. alertas e números com o DESTINO pronto (lista e filtros), para o link abrir a lista já filtrada.

   Quem vê o quê (matriz F do plano):
   - só a equipe (admin e colaborador) tem Visão geral;
   - sem "finance:view", nenhum lançamento sai daqui (os blocos de dinheiro nem têm o que mostrar);
   - proprietário independente (conta sem imobiliária) não tem carteira, repasse nem equipe;
   - desempenho da equipe (07/11): a tabela de todos só com "team:performance" (admin); o resto da
     equipe recebe só a PRÓPRIA linha. A regra mora aqui, não na tela: a linha dos outros nem sai.
   Cada alerta e cada link de número só existem se a pessoa pode abrir a lista para onde levam.

   Até 07/11 esta porta também trazia a atividade recente e as unidades disponíveis do painel ao lado
   do mapa (getAvailable). A Visão geral virou um painel de números macro, sem mapa: a média de dias
   das disponíveis passou para macro.ts (availableOf) e a atividade saiu da tela.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { can, hasFeature } from '@/auth/permissions'
import { AccessError, connect } from '@/data/api'
import type { SortDir } from '@/data/query'
import type { Id, IsoDate } from '@/data/types'
import { formatDate, formatMonth, monthStart } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { plural } from '@/lib/text'
import { staffRows, type StaffRow } from './desempenho'
import type { LinkKey } from './figures'
import { buildLite } from './lite'
import { computeMacro, type Macro } from './macro'
import {
  DEFAULT_PERIOD, filterLite, filterOptions, isPeriodKey, NONE, REVENUE_CATEGORIES,
  type FilterOptions, type LiteFilter, type PeriodKey, type UnitLite,
} from './metrics'

export interface OverviewFilters extends LiteFilter {
  period: PeriodKey
}

export const DEFAULT_FILTERS: OverviewFilters = { period: DEFAULT_PERIOD, property: '', portfolio: '', manager: '' }

/** Para onde um alerta (ou um número) leva: a rota, a chave da lista (useListState) e os filtros a gravar antes. */
export interface ListTarget {
  to: '/imoveis' | '/contratos' | '/financeiro' | '/financeiro/repasses' | '/manutencao' | '/processos'
  list: string
  filters: Record<string, string[]>
  sort: { key: string; dir: SortDir } | null
  /** Outra escolha lembrada da tela de destino (ex.: a aba que abre), gravada junto. */
  remember?: { key: string; value: string }
  /** Parte do endereço que escolhe a categoria (Imóveis: unidades ou vagas) ou a aba (Manutenção: rotinas). */
  search?: { lista?: 'unidades' | 'vagas'; aba?: 'rotinas' }
  /** O que a lista mostra, para o leitor de tela ("Ver unidades disponíveis"). */
  action?: string
}

export interface OverviewAlert {
  key: string
  tone: 'danger' | 'warning' | 'primary'
  title: string
  detail: string
  action: string
  target: ListTarget
}

/** O bloco da equipe: a tabela de todos, só a própria linha, ou nada (conta sem equipe). */
export interface TeamBlock {
  mode: 'team' | 'self' | 'none'
  rows: StaffRow[]
}

export interface OverviewData {
  /** Os números macro (Macro estende o Overview de metrics.ts: ocupação, receita, prazos...). */
  overview: Macro
  /** Os filtros que valeram (id que não existe mais nesta conta vira "todos"). */
  filters: OverviewFilters
  options: FilterOptions
  /** Imóveis do recorte (null = sem filtro de imóvel, carteira ou responsável). */
  propertyIds: Id[] | null
  show: {
    money: boolean
    transfers: boolean
    portfolios: boolean
    managers: boolean
    /** Pode abrir Imóveis (os números de unidade viram link para a lista filtrada). */
    units: boolean
  }
  alerts: OverviewAlert[]
  /** Destino de cada número que abre uma lista (só os que a pessoa pode abrir). */
  links: Partial<Record<LinkKey, ListTarget>>
  team: TeamBlock
  /** Unidades da conta inteira, sem filtro (zero = conta nova: mostrar o estado vazio com ação). */
  unitsInAccount: number
}

/**
 * Tarefas atrasadas: a lista "tarefas" do módulo de Processos, com o filtro "atrasada" dele, e a
 * aba Tarefas aberta (a tela de Processos lembra a última aba em imobil:processos:aba).
 */
const TASKS_LATE: Omit<ListTarget, 'sort'> = { to: '/processos', list: 'tarefas', filters: { atrasada: ['sim'] }, remember: { key: 'imobil:processos:aba', value: 'tarefas' } }

/** Id guardado no navegador que não existe nesta conta (troca de persona, imóvel arquivado) vira "todos". */
function cleanFilters(f: Partial<OverviewFilters>, units: UnitLite[], show: OverviewData['show']): OverviewFilters {
  const exists = (key: (u: UnitLite) => Id | null, wanted: string | undefined) =>
    !!wanted && units.some((u) => (wanted === NONE ? key(u) === null : key(u) === wanted))
  return {
    period: isPeriodKey(f.period) ? f.period : DEFAULT_FILTERS.period,
    property: exists((u) => u.property_id, f.property) ? f.property! : '',
    portfolio: show.portfolios && exists((u) => u.portfolio_id, f.portfolio) ? f.portfolio! : '',
    manager: show.managers && exists((u) => u.manager_id, f.manager) ? f.manager! : '',
  }
}

/** "A, B e mais 3": lista curta de códigos para o detalhe de um alerta. */
function shortList(codes: string[], max = 3): string {
  if (codes.length <= max) return codes.join(', ')
  return `${codes.slice(0, max).join(', ')} e mais ${codes.length - max}`
}

export async function getOverview(s: Session, input: Partial<OverviewFilters>): Promise<OverviewData> {
  const { db, sc } = await connect(s)
  if (!sc.all || !can(s, 'overview:view')) throw new AccessError('A visão geral é da equipe da conta.')

  // Passo 1: o que esta pessoa pode ver e as linhas Lite já no escopo.
  const money = can(s, 'finance:view')
  const lite = buildLite(db, sc, { money })
  const show: OverviewData['show'] = {
    money,
    transfers: money && hasFeature(s, 'transfers'),
    portfolios: hasFeature(s, 'portfolios'),
    managers: hasFeature(s, 'team') && lite.units.some((u) => u.manager_id !== null),
    units: can(s, 'properties:view'),
  }

  // Passo 2: filtros que valem, opções com contagem, o recorte e os números.
  const filters = cleanFilters(input, lite.units, show)
  const options = filterOptions(lite.units, filters)
  const { data, propertyIds } = filterLite(lite, filters)
  const overview = computeMacro(data, s.today, filters.period)

  // Passo 3: alertas. O filtro de imóvel vai junto para a lista mostrar o mesmo recorte.
  const withProps = (f: Record<string, string[]>) => (propertyIds ? { ...f, property: propertyIds } : f)
  const target = (to: ListTarget['to'], list: string, f: Record<string, string[]>, sort: ListTarget['sort'] = null): ListTarget => ({ to, list, filters: withProps(f), sort })
  const alerts: OverviewAlert[] = []
  const { overdue, requests, ending, adjustments } = overview

  if (money && overdue.lateCount > 0) {
    alerts.push({
      key: 'cobrancas', tone: 'danger',
      title: `${plural(overdue.lateCount, 'cobrança vencida', 'cobranças vencidas')} há mais de 5 dias`,
      detail: `${formatBRL(overdue.lateCents)} em aberto · a mais antiga com ${overdue.oldestDays} dias`,
      // O filtro "atraso: mais5" abre exatamente as cobranças que o alerta conta, das mais antigas para as mais novas.
      action: 'Ver cobranças',
      target: target('/financeiro', 'financeiro', { state: ['overdue'], direction: ['receivable'], category: REVENUE_CATEGORIES, atraso: ['mais5'] }, { key: 'days_overdue', dir: 'desc' }),
    })
  }
  if (can(s, 'maintenance:view') && requests.late > 0) {
    alerts.push({
      key: 'chamados', tone: 'danger',
      title: `${plural(requests.late, 'chamado passou', 'chamados passaram')} do prazo`,
      detail: `${plural(requests.open, 'chamado aberto', 'chamados abertos')} no total`,
      action: 'Ver chamados', target: target('/manutencao', 'manutencao', { late: ['sim'] }),
    })
  }
  if (can(s, 'contracts:view') && ending.d60 > 0) {
    alerts.push({
      key: 'contratos', tone: 'warning',
      title: `${plural(ending.d60, 'locação vence', 'locações vencem')} em até 60 dias`,
      detail: `${ending.d30} em até 30 dias · ${ending.d90} em até 90 dias`,
      action: 'Ver contratos', target: target('/contratos', 'contratos', { kind: ['lease'], ending: ['60'] }),
    })
  }
  if (can(s, 'maintenance:view') && requests.awaitingOwner > 0) {
    alerts.push({
      key: 'orcamentos', tone: 'warning',
      title: `${plural(requests.awaitingOwner, 'orçamento aguarda', 'orçamentos aguardam')} o proprietário`,
      detail: money ? `${formatBRL(requests.awaitingOwnerCents)} no total` : 'A decisão é do proprietário, no portal',
      action: 'Ver chamados', target: target('/manutencao', 'manutencao', { status: ['awaiting_owner'] }),
    })
  }
  if (can(s, 'workflows:view')) {
    // As tarefas atrasadas são as da equipe (lite.ts, a regra de seeTask). Com filtro de imóvel, a
    // tarefa entra pelo imóvel da unidade, do contrato ou do chamado ligado a ela (filterLite).
    const late = data.tasks.filter((t) => (t.status === 'todo' || t.status === 'doing') && !!t.due_date && t.due_date < s.today)
    if (late.length > 0) {
      const oldest = late.reduce<IsoDate>((a, t) => (t.due_date! < a ? t.due_date! : a), late[0].due_date!)
      alerts.push({
        key: 'tarefas', tone: 'warning',
        title: plural(late.length, 'tarefa atrasada', 'tarefas atrasadas'),
        detail: `A mais antiga venceu em ${formatDate(oldest)}`,
        // Sem filtro de imóvel aqui: a lista de tarefas não tem esse filtro.
        action: 'Ver tarefas', target: { ...TASKS_LATE, sort: null },
      })
    }
  }
  if (can(s, 'contracts:view') && adjustments.length > 0) {
    alerts.push({
      key: 'reajustes', tone: 'primary',
      title: `${plural(adjustments.length, 'reajuste', 'reajustes')} em ${formatMonth(monthStart(s.today))}`,
      detail: shortList(adjustments.map((k) => k.code)),
      // A lista de Contratos não filtra por mês de reajuste; a unidade de cada um prende a lista nestes contratos.
      action: 'Ver contratos',
      target: { to: '/contratos', list: 'contratos', filters: { status: ['active'], unit: adjustments.flatMap((k) => (k.unit_id ? [k.unit_id] : [])) }, sort: null },
    })
  }

  // Passo 4: o destino de cada número. Só entra o link da lista que a pessoa pode abrir.
  // Dinheiro do período abre o Financeiro nas competências do período (o mês de referência da cobrança).
  const competence = overview.period.months.map((m) => m.slice(0, 7))
  const links: OverviewData['links'] = {}
  if (show.units) {
    links.available = { ...target('/imoveis', 'unidades', { status: ['available'] }), search: { lista: 'unidades' }, action: 'Ver unidades disponíveis' }
    links.spots = { ...target('/imoveis', 'vagas', { status: ['occupied'] }), search: { lista: 'vagas' }, action: 'Ver vagas alugadas' }
  }
  if (money) {
    links.received = { ...target('/financeiro', 'financeiro', { direction: ['receivable'], category: REVENUE_CATEGORIES, competence }), action: 'Ver cobranças do período' }
    links.overdue = { ...target('/financeiro', 'financeiro', { state: ['overdue'], direction: ['receivable'], category: REVENUE_CATEGORIES, competence }, { key: 'days_overdue', dir: 'desc' }), action: 'Ver cobranças vencidas do período' }
    links.upkeep = { ...target('/financeiro', 'financeiro', { direction: ['payable'], category: ['maintenance'], competence }), action: 'Ver despesas de manutenção do período' }
    if (show.transfers) links.transfers = { to: '/financeiro/repasses', list: 'repasses', filters: {}, sort: null, action: 'Ver repasses' }
  }
  if (can(s, 'contracts:view')) {
    links.leases = { ...target('/contratos', 'contratos', { kind: ['lease'], status: ['active'] }), action: 'Ver locações vigentes' }
    links.ending = { ...target('/contratos', 'contratos', { kind: ['lease'], ending: ['90'] }), action: 'Ver locações que vencem em até 90 dias' }
  }
  if (can(s, 'maintenance:view')) {
    links.requestsOpen = { ...target('/manutencao', 'manutencao', { open: ['aberto'] }), action: 'Ver chamados abertos' }
    links.requestsLate = { ...target('/manutencao', 'manutencao', { late: ['sim'] }), action: 'Ver chamados atrasados' }
    // A lista de rotinas filtra o imóvel pela chave "imovel" (rotinas.ts), não "property".
    links.routines = {
      to: '/manutencao', list: 'rotinas', sort: null, search: { aba: 'rotinas' }, action: 'Ver rotinas vencidas',
      filters: { vencida: ['sim'], ...(propertyIds ? { imovel: propertyIds } : {}) },
    }
  }

  // Passo 5: a equipe. Conta sem equipe (proprietário independente): nada. Quem não gerencia a
  // equipe recebe só a própria linha: a dos outros nem sai daqui.
  const members = db.memberships
    .filter((m) => m.organization_id === s.org.id && m.status === 'active' && (m.role === 'admin' || m.role === 'staff'))
    .map((m) => m.user_id)
  const names = new Map(db.profiles.map((p) => [p.id, p.full_name]))
  const everyone = [...new Set(members)].map((id) => ({ id, name: names.get(id) ?? 'Pessoa da equipe' }))
  const mode: TeamBlock['mode'] = !hasFeature(s, 'team') ? 'none' : can(s, 'team:performance') ? 'team' : 'self'
  const visible = mode === 'team' ? everyone : mode === 'self' ? everyone.filter((m) => m.id === s.user.id) : []
  const team: TeamBlock = { mode, rows: visible.length ? staffRows(data, visible, s.today, filters.period) : [] }

  return { overview, filters, options, propertyIds, show, alerts, links, team, unitsInAccount: lite.units.length }
}
