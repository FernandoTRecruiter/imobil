/* =============================================================================
   dados.ts: de onde o HTML do Power BI tira os números.

   Regra (a mesma do dashboard do portfólio): se a medida DAX colocou dados em
   window.DADOS_BRUTOS, usa eles; se não (o HTML aberto direto no navegador, para conferir),
   usa os dados fictícios do app, como a administradora da imobiliária vê.
   ============================================================================= */
import { buildSession } from '@/auth/session'
import { scopeFor } from '@/data/scope'
import { seedDb, USER } from '@/data/seed'
import type { IsoDate } from '@/data/types'
import { todayIn } from '@/lib/dates'
import { buildLite } from '@/modules/visao-geral/lite'
import type { LiteData } from '@/modules/visao-geral/metrics'
import { fromDadosBrutos } from './schema'

/** Os dados fictícios da imobiliária, como a administradora (Ana) vê, já em linhas Lite. */
export function exampleLite(hoje: IsoDate): { lite: LiteData; organizacao: string } {
  const db = seedDb(hoje)
  const s = buildSession(db, USER.admin)
  if (!s) throw new Error('Persona da administradora não encontrada nos dados fictícios.')
  s.today = hoje
  return { lite: buildLite(db, scopeFor(db, s), { money: true }), organizacao: s.org.name }
}

export interface Source {
  data: LiteData
  hoje: IsoDate
  organizacao: string
  /** true = dados fictícios (nada veio do Power BI). */
  demo: boolean
  warnings: string[]
}

/** Lê o que veio do Power BI; sem nada, cai nos dados fictícios com o "hoje" do fuso de Brasília. */
export function loadSource(raw: unknown, now: IsoDate = todayIn()): Source {
  if (raw === undefined || raw === null) {
    const ex = exampleLite(now)
    return { data: ex.lite, hoje: now, organizacao: ex.organizacao, demo: true, warnings: [] }
  }
  const a = fromDadosBrutos(raw)
  return { data: a.data, hoje: a.hoje ?? now, organizacao: a.organizacao ?? 'Minha carteira', demo: false, warnings: a.warnings }
}
