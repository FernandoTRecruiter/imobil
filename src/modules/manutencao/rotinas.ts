/* =============================================================================
   manutencao/rotinas.ts: manutenção de rotina (a cada N meses o chamado abre sozinho).

   O QUE RESOLVE: limpeza de caixa d'água a cada 6 meses, extintores todo ano, dedetização...
   A equipe cadastra a ROTINA uma vez (imóvel, o que fazer, a cada quantos meses, a próxima data,
   o prestador). A rotina diária (aba Automações e comunicados, regra "Rotina de manutenção chegou") olha as
   rotinas ligadas e, quando a data chega, faz quatro coisas:
   1. abre o chamado com a MESMA função da tela (createRequestRow, em repo.ts);
   2. empurra a próxima data em N meses e guarda qual chamado abriu (last_request_id);
   3. avisa o responsável no sistema e manda e-mail a ele e ao prestador (simulado na fase 1);
   4. grava a auditoria da rotina e do chamado (aparece no histórico do imóvel).

   NUNCA ABRE DOIS (idempotência): a chave schedule:<rotina>:<data> fica gravada no aviso ao
   responsável. Antes de abrir, a rodada procura a chave; achou, conta "já existia" e não abre.
   Rodar duas vezes no mesmo dia: a segunda não abre nada (e a data já andou, de todo jeito).
   Na fase 2: coluna dedupe_key em maintenance_requests com índice único, e esta função vira a
   Edge Function chamada pelo pg_cron todo dia às 6h.

   ESCOPO: maintenance_schedules não tem regra em scope.ts. Regra deste arquivo: só a equipe da
   própria organização vê e mexe (é trabalho interno da administração); portal não vê rotina,
   vê o chamado que ela abriu, como qualquer outro.
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { AccessError, audit, connect, diff, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { MAINTENANCE_CATEGORY } from '@/data/labels'
import { runList, type ListParams, type ListResult } from '@/data/query'
import { see } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type { AutomationRule, Id, IsoDate, MaintenanceCategory, MaintenanceSchedule, Unit } from '@/data/types'
import { lookup } from '@/data/views/lookup'
import { addDays, addMonths, formatDate } from '@/lib/dates'
import { newId } from '@/lib/random'
import { profileOf, queueEmail, queueNotice, responsibleFor } from '@/modules/comunicacao/outbox'
import { CATEGORIES, createRequestRow, DUE_DAYS_BY_PRIORITY, parseInput, requireTeamEdit } from './repo'

/* ---------------------------------------------------------------- leitura */

export interface ScheduleRow extends MaintenanceSchedule {
  property_name: string
  /** Código da unidade; null = áreas comuns (o imóvel inteiro). */
  unit_code: string | null
  vendor_name: string | null
  last_request_code: string | null
  /** Ligada e com a data já passada: a próxima rodada abre o chamado. */
  overdue: boolean
}

function toScheduleRows(db: Db, s: Session): ScheduleRow[] {
  const L = lookup(db)
  const codes = new Map(db.maintenance_requests.map((r) => [r.id, r.code]))
  return db.maintenance_schedules
    .filter((x) => x.organization_id === s.org.id)
    .map((x) => ({
      ...x,
      property_name: L.property.get(x.property_id)?.name ?? 'Imóvel removido',
      unit_code: x.unit_id ? (L.unit.get(x.unit_id)?.code ?? null) : null,
      vendor_name: x.vendor_person_id ? (L.person.get(x.vendor_person_id)?.name ?? null) : null,
      last_request_code: x.last_request_id ? (codes.get(x.last_request_id) ?? null) : null,
      overdue: x.active && x.next_date < s.today,
    }))
}

/** Filtros: imovel (id), situacao ('ligada' | 'desligada'), vencida ('sim'), categoria. Ordens: next_date, title, every_months. */
export async function listSchedules(s: Session, params: ListParams): Promise<ListResult<ScheduleRow>> {
  const { db, sc } = await connect(s)
  const rows = sc.all ? toScheduleRows(db, s) : []
  return runList(rows, params, {
    search: (r) => [r.title, r.description, r.property_name, r.unit_code, r.vendor_name, MAINTENANCE_CATEGORY[r.category]],
    filters: {
      imovel: (r) => r.property_id,
      situacao: (r) => (r.active ? 'ligada' : 'desligada'),
      vencida: (r) => (r.overdue ? 'sim' : null),
      categoria: (r) => r.category,
    },
    sorts: { next_date: (r) => r.next_date, title: (r) => r.title, every_months: (r) => r.every_months },
    // Ordem declarada: as ligadas primeiro e, dentro delas, a data mais perto em cima.
    defaultSort: (a, b) => Number(!a.active) - Number(!b.active) || a.next_date.localeCompare(b.next_date),
  })
}

export interface ScheduleOptions {
  properties: { id: Id; name: string; units: { id: Id; code: string }[] }[]
  vendors: { id: Id; name: string; categories: MaintenanceCategory[] }[]
}

/** Imóveis (com as unidades) e prestadores para o formulário da rotina. Só a equipe. */
export async function scheduleOptions(s: Session): Promise<ScheduleOptions> {
  const { db, sc } = await connect(s)
  if (!sc.all) return { properties: [], vendors: [] }
  const byCode = (a: Unit, b: Unit) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true })
  const properties = db.properties
    .filter((p) => see.property(sc, p) && !p.deleted_at)
    .map((p) => ({ id: p.id, name: p.name, units: db.units.filter((u) => u.property_id === p.id && !u.deleted_at).sort(byCode).map((u) => ({ id: u.id, code: u.code })) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const vendors = db.people
    .filter((p) => see.person(sc, p) && !p.deleted_at && p.tags.includes('vendor'))
    .map((p) => ({ id: p.id, name: p.name, categories: p.vendor_categories }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return { properties, vendors }
}

/* ---------------------------------------------------------------- gravação */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida: escolha no calendário.')

export const scheduleSchema = z.object({
  /** Vazio = rotina nova. */
  id: z.string(),
  property_id: z.string().min(1, 'Escolha o imóvel.'),
  /** Vazio = áreas comuns (o imóvel inteiro). */
  unit_id: z.string(),
  category: z.enum(CATEGORIES, { message: 'Escolha a categoria.' }),
  title: z.string().trim().min(3, 'Diga o serviço em pelo menos 3 letras (ex.: "Limpeza da caixa d\'água").').max(120, 'Título longo demais: até 120 caracteres.'),
  description: z.string().trim().max(1000, 'Descrição longa demais: até 1.000 caracteres.'),
  every_months: z.number({ message: 'A cada quantos meses: use um número.' }).int('Use meses inteiros.').min(1, 'Pelo menos a cada 1 mês.').max(60, 'Mais de 5 anos entre uma vez e outra: confira o número.'),
  next_date: isoDate,
  /** Vazio = sem prestador (a equipe escolhe na triagem). */
  vendor_person_id: z.string(),
  active: z.boolean(),
})
export type ScheduleInput = z.infer<typeof scheduleSchema>

/**
 * Cria ou edita a rotina.
 * Passo a passo: permissão (equipe que edita manutenção) -> validação -> o imóvel, a unidade e o
 * prestador existem e são desta conta? -> a próxima data, quando muda, não pode ficar no passado
 * (abriria o chamado na hora, sem ninguém pedir) -> grava -> auditoria.
 */
export async function saveSchedule(s: Session, input: ScheduleInput): Promise<MaintenanceSchedule> {
  const data = parseInput(scheduleSchema, input)
  const { db, sc } = await connect(s)
  requireTeamEdit(s, sc)
  const property = db.properties.find((p) => p.id === data.property_id)
  if (!property || !see.property(sc, property) || property.deleted_at) throw new RuleError('O imóvel escolhido não existe mais nesta conta. Escolha outro na lista.')
  const unit = data.unit_id ? db.units.find((u) => u.id === data.unit_id) : null
  if (data.unit_id && (!unit || unit.property_id !== property.id || unit.deleted_at)) throw new RuleError(`A unidade escolhida não é do ${property.name}. Escolha uma unidade dele ou "Áreas comuns".`)
  const vendor = data.vendor_person_id ? db.people.find((p) => p.id === data.vendor_person_id) : null
  if (data.vendor_person_id && (!vendor || !see.person(sc, vendor) || vendor.deleted_at || !vendor.tags.includes('vendor'))) {
    throw new RuleError('Prestador não encontrado nesta conta. Cadastre em Pessoas com o papel "Prestador" ou deixe em branco.')
  }
  const before = data.id ? db.maintenance_schedules.find((x) => x.id === data.id && x.organization_id === s.org.id) : undefined
  if (data.id && !before) throw new AccessError('Rotina não encontrada nesta conta.')
  if ((!before || before.next_date !== data.next_date) && data.next_date < s.today) {
    throw new RuleError('A próxima data ficou no passado: escolha hoje ou uma data depois. É nesse dia que a rotina abre o chamado.')
  }
  const now = nowIso()
  const row: MaintenanceSchedule = {
    id: before?.id ?? newId(), organization_id: s.org.id, created_at: before?.created_at ?? now, updated_at: now, created_by: before?.created_by ?? s.user.id,
    property_id: property.id, unit_id: unit?.id ?? null, category: data.category, title: data.title, description: data.description,
    every_months: data.every_months, next_date: data.next_date, vendor_person_id: vendor?.id ?? null, active: data.active,
    last_request_id: before?.last_request_id ?? null,
  }
  upsertRows('maintenance_schedules', [row])
  if (before) audit(s, 'maintenance_schedules', row.id, 'update', `Rotina "${row.title}" alterada`, diff(before, row))
  else audit(s, 'maintenance_schedules', row.id, 'create', `Rotina criada: ${row.title} em ${property.name}, a cada ${monthsText(row.every_months)}, a partir de ${formatDate(row.next_date)}`)
  return row
}

/** Liga ou desliga a rotina (desligada fica guardada e não abre chamado). */
export async function setScheduleActive(s: Session, input: { id: Id; active: boolean }): Promise<MaintenanceSchedule> {
  const { db, sc } = await connect(s)
  requireTeamEdit(s, sc)
  const before = db.maintenance_schedules.find((x) => x.id === input.id && x.organization_id === s.org.id)
  if (!before) throw new AccessError('Rotina não encontrada nesta conta.')
  if (before.active === input.active) throw new RuleError(`A rotina "${before.title}" já está ${input.active ? 'ligada' : 'desligada'}.`)
  const after: MaintenanceSchedule = { ...before, active: input.active, updated_at: nowIso() }
  upsertRows('maintenance_schedules', [after])
  audit(s, 'maintenance_schedules', after.id, 'update', `Rotina "${after.title}" ${after.active ? 'ligada' : 'desligada'}`, diff(before, after))
  return after
}

/** "1 mês" / "6 meses". */
export function monthsText(n: number): string {
  return `${n} ${n === 1 ? 'mês' : 'meses'}`
}

/* ---------------------------------------------------------------- a rodada diária */

/**
 * Próxima data depois da rodada: N meses depois da atual, pulando os ciclos que já ficaram para
 * trás (rotina parada há um ano abre UM chamado, não dois). Conta sempre a partir da data
 * original (k x N meses), e não encadeando: encadear faria o dia 31 virar 28 em fevereiro e
 * ficar 28 para sempre (a mesma armadilha do dueDateFor).
 * atalho: se a antecedência da regra for maior que o período da rotina (regra com 40 dias e rotina
 * mensal), um ciclo dentro da antecedência é pulado. Melhorar se alguém precisar dessa combinação.
 */
export function nextDateAfterRun(current: IsoDate, everyMonths: number, horizon: IsoDate): IsoDate {
  let k = 1
  while (addMonths(current, k * everyMonths) <= horizon) k++
  return addMonths(current, k * everyMonths)
}

export interface ScheduleRunResult {
  created: number
  skipped: number
  /** Problemas por rotina (imóvel sem unidade, conta sem responsável): a rodada segue nas outras. */
  problems: string[]
}

/**
 * Roda o gatilho "Rotina de manutenção chegou" (chamado por runAutomations, em Tarefas).
 * Vence a rotina LIGADA cuja data é hoje, já passou ou está a até rule.days dias (antecedência).
 * Passo a passo, para cada rotina vencida:
 * 1. chave schedule:<id>:<data> já gravada? conta como "já existia" e segue;
 * 2. acha a unidade (a da rotina ou, em área comum, a primeira do imóvel) e o responsável;
 * 3. abre o chamado (prazo = a data da rotina; se ela já passou, o prazo normal a partir de hoje,
 *    para o chamado não nascer atrasado);
 * 4. empurra a data, grava last_request_id e a auditoria da rotina;
 * 5. aviso ao responsável (leva a chave) e e-mails ao responsável e ao prestador.
 */
export function runDueSchedules(db: Db, s: Session, rule: AutomationRule): ScheduleRunResult {
  const out: ScheduleRunResult = { created: 0, skipped: 0, problems: [] }
  const horizon = addDays(s.today, Math.max(0, rule.days))
  const due = db.maintenance_schedules.filter((x) => x.organization_id === s.org.id && x.active && x.next_date <= horizon)
  for (const sch of due) {
    const key = `schedule:${sch.id}:${sch.next_date}`
    if (db.notifications.some((n) => n.organization_id === s.org.id && n.dedupe_key === key)) {
      out.skipped++
      continue
    }
    const property = db.properties.find((p) => p.id === sch.property_id && p.organization_id === s.org.id && !p.deleted_at)
    // Rotina de área comum (sem unidade) abre o chamado SEM unidade: ele é do imóvel, não de um apartamento.
    const unit = sch.unit_id ? (db.units.find((u) => u.id === sch.unit_id && !u.deleted_at) ?? null) : null
    const who = responsibleFor(db, s.org.id, sch.property_id)
    const whoProfile = who ? profileOf(db, who) : null
    if (!property || (sch.unit_id && !unit)) {
      out.problems.push(`Rotina "${sch.title}": o imóvel ou a unidade não existe mais. Edite a rotina em Manutenção > Rotinas.`)
      continue
    }
    if (!who || !whoProfile) {
      out.problems.push(`Rotina "${sch.title}": a conta não tem administrador ativo para responder pelo chamado.`)
      continue
    }

    const where = unit ? `${property.name} · ${unit.code}` : `${property.name} (áreas comuns)`
    const request = createRequestRow(
      db, s,
      {
        unit, property_id: property.id, category: sch.category, priority: 'medium', title: unit ? sch.title : `${sch.title} (áreas comuns)`,
        description: sch.description, requester_person_id: null, vendor_person_id: sch.vendor_person_id,
        due_date: sch.next_date >= s.today ? sch.next_date : addDays(s.today, DUE_DAYS_BY_PRIORITY.medium),
      },
      `Chamado aberto pela rotina "${sch.title}" (a cada ${monthsText(sch.every_months)})`,
    )
    const after: MaintenanceSchedule = { ...sch, next_date: nextDateAfterRun(sch.next_date, sch.every_months, horizon), last_request_id: request.id, updated_at: nowIso() }
    upsertRows('maintenance_schedules', [after])
    audit(s, 'maintenance_schedules', sch.id, 'update', `Rotina "${sch.title}": abriu o chamado ${request.code}; próxima data ${formatDate(after.next_date)}`, diff(sch, after))

    queueNotice(s, { user_id: who, title: `Rotina de manutenção: ${request.code}`, body: `${sch.title} · ${where}`, link: `/manutencao/${request.id}`, dedupe_key: key })
    const vendor = sch.vendor_person_id ? db.people.find((p) => p.id === sch.vendor_person_id) : undefined
    const subject = `Manutenção de rotina: ${sch.title} · ${request.code}`
    const sent: string[] = []
    const toTeam = queueEmail(s, {
      to_email: whoProfile.email, to_name: whoProfile.name, subject,
      body: `A rotina "${sch.title}" (a cada ${monthsText(sch.every_months)}) chegou: o chamado ${request.code} foi aberto em ${where}${vendor ? `, com ${vendor.name}` : ''}. Faça a triagem para seguir.`,
      reason: 'routine_maintenance', entity: 'maintenance_requests', entity_id: request.id, dedupe_key: `${key}:${who}`,
    })
    if (toTeam === 'created') sent.push(`${whoProfile.name} (responsável)`)
    if (vendor) {
      const toVendor = queueEmail(s, {
        to_email: vendor.email, to_name: vendor.name, subject,
        body: `Serviço de rotina em ${where}: ${sch.title}. Data marcada: ${formatDate(sch.next_date)}. A imobiliária entra em contato para combinar o horário. Referência: chamado ${request.code}.`,
        reason: 'routine_maintenance', entity: 'maintenance_requests', entity_id: request.id, dedupe_key: `${key}:${vendor.id}`,
      })
      if (toVendor === 'created') sent.push(`${vendor.name} (prestador)`)
      if (toVendor === 'no_email') out.problems.push(`Rotina "${sch.title}": ${vendor.name} está sem e-mail no cadastro; o chamado ${request.code} abriu, o e-mail ao prestador não foi.`)
    }
    if (sent.length) audit(s, 'maintenance_requests', request.id, 'update', `E-mail da rotina para ${sent.join(' e ')}, simulado, e aviso no sistema`)
    out.created++
  }
  return out
}
