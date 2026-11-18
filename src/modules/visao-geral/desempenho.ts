/* =============================================================================
   desempenho.ts: o desempenho de cada colaborador na Visão geral (07/11/2026).

   Pedido do Fernando (07/11): o desempenho dos colaboradores, além de clientes e financeiro.
   Regras que valem aqui (e no DECISOES 047):
   1. Mede RESULTADO do trabalho, nunca vigilância: nada de tempo conectado, cliques ou acessos.
   2. A quem cada coisa pertence:
      - carteira = imóveis em que a pessoa é a responsável (properties.manager_user_id);
      - tarefas e chamados = os atribuídos a ela (assignee_user_id);
      - contratos novos e renovados, inadimplência e vacância = os da carteira dela.
   3. O tamanho da carteira vai junto em toda linha: dez chamados resolvidos não querem dizer a
      mesma coisa para quem cuida de 20 unidades e para quem cuida de 120.
   4. Quem vê: a tabela de todos só com "team:performance" (admin); o resto da equipe vê só a
      própria linha ("Meu desempenho"). Isso é decidido no repo.ts, a porta dos dados.
   Função pura, como metrics.ts: as fórmulas são as MESMAS dos blocos (macro.ts), só recortadas
   por pessoa. O Power BI não recebe coluna de pessoa: lá só aparecem os números da equipe somada.
   ============================================================================= */
import type { Id, IsoDate } from '@/data/types'
import { resolutionOf, signedOf, taskStatsOf, type Resolution, type Signed, type TaskStats } from './macro'
import { occupancyOf, periodOf, revenueOf, unitStatuses, type LiteData, type PeriodKey } from './metrics'

export interface Member {
  id: Id
  name: string
}

export interface StaffRow {
  user_id: Id
  name: string
  /** Carteira: imóveis em que é responsável e as unidades deles (sem vaga de garagem). */
  properties: number
  units: number
  tasks: TaskStats
  requests: Resolution
  signed: Signed
  /** Da carteira dele, no período (null = nada venceu ou sem acesso a dinheiro). */
  delinquency: number | null
  /** Da carteira dele, hoje (null = nenhuma unidade alugável). */
  vacancy: number | null
}

/**
 * Uma linha por colaborador. Passo a passo:
 * 1. os imóveis de que cada um é responsável (pelas unidades e vagas, que trazem o responsável);
 * 2. tarefas e chamados pelo responsável de cada um;
 * 3. contratos, cobranças e unidades pelos imóveis da carteira;
 * 4. a ordem: maior carteira primeiro (é a régua para ler o resto), depois o nome.
 */
export function staffRows(d: LiteData, members: Member[], today: IsoDate, key: PeriodKey): StaffRow[] {
  const period = periodOf(today, key)
  return members
    .map((m): StaffRow => {
      const units = d.units.filter((u) => u.manager_id === m.id)
      const props = new Set([...units, ...d.spots.filter((u) => u.manager_id === m.id)].map((u) => u.property_id))
      const occupancy = occupancyOf(unitStatuses(units, d.contracts, today).values())
      const revenue = revenueOf(d.entries.filter((e) => !!e.property_id && props.has(e.property_id)), period, today)
      return {
        user_id: m.id,
        name: m.name,
        properties: props.size,
        units: units.length,
        tasks: taskStatsOf(d.tasks.filter((t) => t.assignee_id === m.id), period, today),
        requests: resolutionOf(d.maintenance.filter((r) => r.assignee_id === m.id), period, today),
        signed: signedOf(d.contracts.filter((k) => props.has(k.property_id)), period, today),
        delinquency: revenue.delinquency,
        vacancy: occupancy.vacancy,
      }
    })
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name, 'pt-BR'))
}
