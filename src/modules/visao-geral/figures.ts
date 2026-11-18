/* =============================================================================
   figures.ts: O QUE cada bloco da Visão geral mostra, em texto pronto (sem React).

   Por que separado da tela: o app e o HTML do Power BI desenham os MESMOS blocos (macroBlocks).
   Cada um põe a própria moldura (o "i" e o link do app; a dica nativa do navegador no Power BI),
   mas rótulo, número, seta e fórmula saem daqui. Trocar um texto aqui troca nos dois.

   A seta (▲▼) só diz a direção e o tamanho da mudança, na cor do texto: subir a vacância é ruim e
   subir a ocupação é bom, e pintar de verde ou vermelho seria julgar por quem lê.
   ============================================================================= */
import { formatDate, formatMonth } from '@/lib/dates'
import { formatBRLShort } from '@/lib/money'
import { plural } from '@/lib/text'
import { formatRate } from './charts'
import type { Macro } from './macro'
import { FORMULAS, PERIOD_LABEL } from './metrics'

/** Destinos que um número pode abrir (o app troca pela lista já filtrada; o Power BI ignora). */
export type LinkKey =
  | 'available' | 'spots' | 'received' | 'overdue' | 'transfers' | 'upkeep'
  | 'leases' | 'ending' | 'requestsOpen' | 'requestsLate' | 'routines'

export interface Delta {
  /** "▲ 1,2 p.p.", "▼ 3", "sem variação". */
  text: string
  /** A mesma coisa por extenso, para o leitor de tela e a dica. */
  said: string
}

export interface Figure {
  key: string
  label: string
  value: string
  hint?: string
  delta?: Delta | null
  info: string
  /** Tendência de 12 meses (o último ponto é hoje). */
  spark?: { values: number[]; said: string }
  link?: LinkKey
}

export interface Block {
  key: 'carteira' | 'financeiro' | 'clientes' | 'manutencao' | 'equipe'
  title: string
  /** Período do bloco (soma do período) ou "hoje" (foto de hoje). */
  when: string
  info: string
  headline: Figure
  rows: Figure[]
}

/* ---------------------------------------------------------------- números e setas */

const num1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const SAME: Delta = { text: 'sem variação', said: 'igual ao período anterior' }

/** Taxa: a diferença em pontos percentuais (92,4% para 93,6% = ▲ 1,2 p.p.). Sem base num dos lados, sem seta. */
export function deltaRate(now: number | null, prev: number | null): Delta | null {
  if (now === null || prev === null) return null
  const pp = Math.round((now - prev) * 1000) / 10
  if (pp === 0) return SAME
  const size = num1(Math.abs(pp))
  return { text: `${pp > 0 ? '▲' : '▼'} ${size} p.p.`, said: `${pp > 0 ? 'subiu' : 'caiu'} ${size} ${Math.abs(pp) === 1 ? 'ponto percentual' : 'pontos percentuais'} em relação ao período anterior` }
}

/** Contagem: a diferença inteira (12 para 9 = ▼ 3). */
export function deltaCount(now: number, prev: number): Delta {
  const d = now - prev
  if (d === 0) return SAME
  return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d)}`, said: `${Math.abs(d)} a ${d > 0 ? 'mais' : 'menos'} que no período anterior` }
}

/** Dinheiro: a diferença em reais, curta ("▲ R$ 12,3 mil"). */
export function deltaMoney(now: number, prev: number): Delta {
  const d = now - prev
  if (d === 0) return SAME
  const size = formatBRLShort(Math.abs(d)).replace(/,00$/, '')
  return { text: `${d > 0 ? '▲' : '▼'} ${size}`, said: `${size} a ${d > 0 ? 'mais' : 'menos'} que no período anterior` }
}

/** Dias (tempo médio): a diferença com uma casa ("▼ 0,8 dia"). */
export function deltaDays(now: number | null, prev: number | null): Delta | null {
  if (now === null || prev === null) return null
  const d = Math.round((now - prev) * 10) / 10
  if (d === 0) return SAME
  const size = num1(Math.abs(d))
  const unit = Math.abs(d) === 1 ? 'dia' : 'dias'
  return { text: `${d > 0 ? '▲' : '▼'} ${size} ${unit}`, said: `${size} ${unit} a ${d > 0 ? 'mais' : 'menos'} que no período anterior` }
}

/** "jun a ago/2026" (ou "out/2026" no mês atual): o período com que as setas comparam. */
export function compareLabel(m: Pick<Macro, 'prevPeriod'>): string {
  const { months } = m.prevPeriod
  const first = formatMonth(months[0])
  const last = formatMonth(months[months.length - 1])
  if (months.length === 1) return last
  return first.slice(4) === last.slice(4) ? `${first.slice(0, 3)} a ${last}` : `${first} a ${last}`
}

/** O texto do "i" da comparação: os dois tipos de seta. */
export function compareInfo(m: Pick<Macro, 'prevPeriod' | 'prevToday' | 'period'>): string {
  return `Números do período (receita, contratos, chamados resolvidos) comparam com ${compareLabel(m)}, vistos até ${formatDate(m.prevToday)}. Números de hoje (ocupação, locações vigentes, chamados abertos) comparam com o dia ${formatDate(m.prevToday)}.`
}

const rateOrNone = (r: number | null) => (r === null ? 'sem base' : formatRate(r))
const daysText = (d: number | null) => (d === null ? 'sem base' : `${num1(d)} ${Math.round(d * 10) === 10 ? 'dia' : 'dias'}`)
const MONEY_SHORT = (c: number) => formatBRLShort(c).replace(/,00$/, '')

/* ---------------------------------------------------------------- os blocos */

export interface BlockShow {
  money: boolean
  transfers: boolean
}

/**
 * Os blocos da Visão geral, na ordem da tela. Cada um: o número de destaque (com tendência) e
 * até quatro linhas. Bloco ou linha que a pessoa não pode ver (dinheiro sem "finance:view",
 * repasse em conta sem imobiliária) não entra.
 */
export function macroBlocks(m: Macro, show: BlockShow): Block[] {
  const period = PERIOD_LABEL[m.period.key].toLowerCase()
  const months = m.monthly.map((p) => p.month)
  const trendSaid = (what: string) => `${what} de ${formatMonth(months[0])} a ${formatMonth(months[months.length - 1])}`
  const onDate = `Seta: comparação com ${formatDate(m.prevToday)}.`
  const inPrev = `Seta: comparação com ${compareLabel(m)}.`
  const blocks: Block[] = []

  // 1. Carteira (foto de hoje).
  const o = m.occupancy
  const carteira: Figure[] = [
    { key: 'vacancia', label: 'Vacância', value: formatRate(o.vacancy), hint: plural(o.vacant, 'vazia', 'vazias'), delta: deltaRate(o.vacancy, m.occupancyPrev.vacancy), info: `${FORMULAS.vacancy} ${onDate}` },
    {
      key: 'disponiveis', label: 'Disponíveis', value: String(m.available.count), link: 'available', info: FORMULAS.available,
      hint: m.available.avgDays !== null ? `há ${Math.round(m.available.avgDays)} dias, em média` : m.available.count ? 'nunca alugadas' : 'nenhuma agora',
    },
  ]
  if (m.spots.units > 0) {
    carteira.push({
      key: 'vagas', label: 'Vagas alugadas', value: String(m.spots.occupied), link: 'spots', info: `${FORMULAS.spots} ${onDate}`,
      hint: `de ${m.spots.rentable} · ${formatRate(m.spots.rate, 0)}`, delta: deltaCount(m.spots.occupied, m.spotsPrev.occupied),
    })
  }
  blocks.push({
    key: 'carteira', title: 'Carteira', when: 'hoje', info: 'Casas, apartamentos e salas, hoje. Vaga de garagem tem a conta dela.',
    headline: {
      key: 'ocupacao', label: 'Ocupação', value: formatRate(o.rate), info: `${FORMULAS.occupancy} ${onDate}`,
      hint: o.rentable ? `${o.occupied} de ${plural(o.rentable, 'alugável', 'alugáveis')}` : 'Sem unidade alugável',
      delta: deltaRate(o.rate, m.occupancyPrev.rate),
      spark: { values: m.occupancyTrend.map((r) => (r ?? 0) * 100), said: trendSaid('Ocupação no fim de cada mês,') },
    },
    rows: carteira,
  })

  // 2. Financeiro (soma do período), só com acesso a dinheiro.
  if (show.money) {
    const r = m.revenue
    const rows: Figure[] = [
      {
        key: 'inadimplencia', label: 'Inadimplência', value: formatRate(r.delinquency), link: 'overdue', info: `${FORMULAS.delinquency} ${inPrev}`,
        hint: r.dueSoFar ? `${MONEY_SHORT(r.overdue)} vencidos` : 'Nada venceu ainda', delta: deltaRate(r.delinquency, m.revenuePrev.delinquency),
      },
    ]
    if (show.transfers) {
      rows.push({
        key: 'repasses', label: 'Repasses', value: MONEY_SHORT(m.transfers.total), link: 'transfers', info: `${FORMULAS.transfers} ${inPrev}`,
        hint: `${MONEY_SHORT(m.transfers.paid)} pagos`, delta: deltaMoney(m.transfers.total, m.transfersPrev.total),
      })
    }
    rows.push({
      key: 'manutencao', label: 'Despesas de manutenção', value: MONEY_SHORT(m.upkeep.total), link: 'upkeep', info: `${FORMULAS.upkeep} ${inPrev}`,
      hint: `${MONEY_SHORT(m.upkeep.paid)} pagos`, delta: deltaMoney(m.upkeep.total, m.upkeepPrev.total),
    })
    blocks.push({
      key: 'financeiro', title: 'Financeiro', when: period, info: 'Pelo vencimento: o que vence no período escolhido.',
      headline: {
        key: 'recebida', label: 'Receita recebida', value: MONEY_SHORT(r.received), link: 'received', info: `${FORMULAS.received} ${inPrev}`,
        hint: r.forecast ? `de ${MONEY_SHORT(r.forecast)} (${formatRate(r.received / r.forecast, 0)})` : 'Nada previsto',
        delta: deltaMoney(r.received, m.revenuePrev.received),
        // O mês atual fica FORA da tendência: ainda está correndo, e o ponto dele sempre cairia (o que
        // vence no fim do mês ainda não foi pago), parecendo uma queda que não aconteceu.
        spark: {
          values: m.monthly.slice(0, -1).map((p) => p.received),
          said: `Receita recebida por mês de vencimento, de ${formatMonth(months[0])} a ${formatMonth(months[months.length - 2])} (o mês atual ainda está correndo)`,
        },
      },
      rows,
    })
  }

  // 3. Clientes (locações e locatários).
  const clientes: Figure[] = [
    { key: 'vencendo', label: 'Vencendo', hint: 'em 30 · 60 · 90 dias', value: `${m.ending.d30} · ${m.ending.d60} · ${m.ending.d90}`, link: 'ending', info: FORMULAS.ending },
    { key: 'novos', label: 'Novos contratos', value: String(m.signed.fresh), delta: deltaCount(m.signed.fresh, m.signedPrev.fresh), info: `${FORMULAS.fresh} ${inPrev}` },
    { key: 'renovacoes', label: 'Renovações', value: String(m.signed.renewals), delta: deltaCount(m.signed.renewals, m.signedPrev.renewals), info: `${FORMULAS.renewals} ${inPrev}` },
  ]
  if (show.money) {
    const p = m.punctuality
    clientes.push({
      key: 'pontualidade', label: 'Pontualidade', value: rateOrNone(p.rate), info: `${FORMULAS.punctuality} ${inPrev}`,
      hint: p.due ? `${p.onTime} de ${p.due} em dia` : 'Nada venceu ainda', delta: deltaRate(p.rate, m.punctualityPrev.rate),
    })
  }
  blocks.push({
    key: 'clientes', title: 'Clientes', when: period, info: 'Locações vigentes hoje; contratos novos, renovações e pontualidade no período.',
    headline: {
      key: 'locacoes', label: 'Locações vigentes', value: String(m.leases.active), link: 'leases', info: `${FORMULAS.leases} ${onDate}`,
      hint: m.spots.occupied ? `${m.spots.occupied} delas de vaga` : undefined,
      delta: deltaCount(m.leases.active, m.leases.activePrev),
      spark: { values: m.leases.trend, said: trendSaid('Locações vigentes no fim de cada mês,') },
    },
    rows: clientes,
  })

  // 4. Manutenção.
  const q = m.requests
  blocks.push({
    key: 'manutencao', title: 'Manutenção', when: period, info: 'Chamados abertos e atrasados hoje; resolvidos no período.',
    headline: {
      key: 'abertos', label: 'Chamados abertos', value: String(q.open), link: 'requestsOpen', info: `${FORMULAS.requests} ${onDate}`,
      hint: q.awaitingOwner ? `${q.awaitingOwner} ${q.awaitingOwner === 1 ? 'aguarda' : 'aguardam'} o proprietário` : undefined,
      delta: deltaCount(q.open, m.requestsPrev.open),
      spark: { values: m.requestsTrend, said: trendSaid('Chamados abertos no fim de cada mês,') },
    },
    rows: [
      { key: 'atrasados', label: 'Atrasados', value: String(q.late), link: 'requestsLate', delta: deltaCount(q.late, m.requestsPrev.late), info: `${FORMULAS.requests} ${onDate}` },
      {
        key: 'resolucao', label: 'Tempo de resolução', value: daysText(m.resolution.avgDays), info: `${FORMULAS.resolution} ${inPrev}`,
        hint: `média de ${plural(m.resolution.count, 'resolvido', 'resolvidos')}`, delta: deltaDays(m.resolution.avgDays, m.resolutionPrev.avgDays),
      },
      { key: 'rotinas', label: 'Rotinas vencidas', value: String(m.routines.overdue), link: 'routines', hint: `de ${plural(m.routines.active, 'ligada', 'ligadas')}`, info: FORMULAS.routines },
    ],
  })
  return blocks
}

/**
 * A equipe SOMADA (o Power BI mostra só isto; o app mostra por colaborador). Sem tarefa nenhuma
 * nos dados, o bloco não aparece (em vez de "0%" que não quer dizer nada).
 */
export function teamTotalsBlock(m: Macro): Block | null {
  if (!m.tasks.measured && !m.tasks.late && !m.tasksPrev.measured) return null
  const inPrev = `Seta: comparação com ${compareLabel(m)}.`
  return {
    key: 'equipe', title: 'Equipe', when: PERIOD_LABEL[m.period.key].toLowerCase(),
    info: 'A equipe inteira, somada. O desempenho por colaborador fica só no app: dado de pessoa não vai para relatório compartilhado.',
    headline: {
      key: 'noprazo', label: 'Tarefas no prazo', value: rateOrNone(m.tasks.rate), info: `${FORMULAS.tasksOnTime} ${inPrev}`,
      hint: m.tasks.measured ? `${m.tasks.onTime} de ${m.tasks.measured}` : undefined, delta: deltaRate(m.tasks.rate, m.tasksPrev.rate),
    },
    rows: [
      { key: 'tarefas-atrasadas', label: 'Tarefas atrasadas', value: String(m.tasks.late), delta: deltaCount(m.tasks.late, m.tasksPrev.late), info: `${FORMULAS.tasksLate} Seta: comparação com ${formatDate(m.prevToday)}.` },
      { key: 'resolvidos', label: 'Chamados resolvidos', value: String(m.resolution.count), delta: deltaCount(m.resolution.count, m.resolutionPrev.count), info: `${FORMULAS.resolution} ${inPrev}` },
    ],
  }
}
