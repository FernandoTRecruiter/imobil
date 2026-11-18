/* =============================================================================
   comunicacao/outbox.ts: as três peças que TODA automação de aviso usa.

   1. queueEmail: põe um e-mail na caixa de saída (email_outbox).
   2. queueNotice: põe um aviso dentro do sistema (notifications, o sino do menu).
   3. recordRun: grava a execução da regra em automation_runs (com o erro, quando dá erro).

   POR QUE UM LUGAR SÓ: renovação de contrato (Tarefas), pedido de manutenção (Manutenção),
   rotina de manutenção e comunicado aos inquilinos mandam e-mail. Se cada módulo escrevesse
   a sua versão, um deles ia esquecer a chave de duplicidade e mandar o mesmo e-mail duas vezes.

   A REGRA QUE SEGURA TUDO (idempotência, "rodar duas vezes dá o mesmo resultado"):
   cada e-mail e cada aviso leva uma dedupe_key (chave de duplicidade) no formato
   motivo:registro:destinatário. Antes de gravar, a função procura a chave; se já existe,
   não grava e responde 'skipped' (já existia). Na fase 2 a mesma garantia vem de um
   índice único (organization_id, dedupe_key) no Postgres: mesmo duas rodadas ao mesmo
   tempo não passam as duas.

   ENVIO DE VERDADE (fase 2), passo a passo:
   a) o repositório grava a linha como hoje, só que com status 'pending' em vez de 'simulated';
   b) um gatilho do banco (ou o pg_cron a cada minuto) chama a Edge Function "enviar-email";
   c) a função lê as linhas pendentes, chama a API do Resend com a chave guardada no cofre
      do Supabase (a chave NUNCA vai para o navegador) e grava 'sent' ou 'failed';
   d) o que falhou fica com o erro e entra na tentativa seguinte, sem gerar linha nova.
   Na fase 1 (esta), nada sai da máquina: status 'simulated' mostra o que SERIA enviado.

   Estas funções têm a mesma forma do audit() de data/api.ts: recebem a sessão e gravam pelo
   upsertRows. Quem decide QUEM recebe e QUANDO é o módulo que chama.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { nowIso } from '@/data/api'
import type { Db } from '@/data/db'
import { getDb, upsertRows } from '@/data/store'
import type { AutomationRule, AutomationRun, AutomationTrigger, EmailMessage, Id, Notification } from '@/data/types'
import { newId } from '@/lib/random'

/** Resultado de cada tentativa de gravar: criado agora, já existia, ou sem e-mail para mandar. */
export type QueueResult = 'created' | 'skipped' | 'no_email'

/** O que o módulo informa para montar o e-mail (o resto, id, data e status, sai daqui). */
export interface EmailDraft {
  to_email: string
  to_name: string
  subject: string
  body: string
  reason: EmailMessage['reason']
  /** Tabela do registro a que o e-mail se refere ('contracts', 'maintenance_requests', 'announcements'). */
  entity: string
  entity_id: Id
  dedupe_key: string
}

/** Rótulo do status do e-mail (labels.ts é compartilhado; o rótulo mora aqui até ir para lá). */
export const EMAIL_STATUS: Record<EmailMessage['status'], string> = { simulated: 'Simulado', sent: 'Enviado', failed: 'Falhou' }

/**
 * Põe o e-mail na caixa de saída, se a chave ainda não existe na organização.
 * Pessoa sem e-mail cadastrado devolve 'no_email': quem chamou decide se isso vira erro na execução.
 */
export function queueEmail(s: Session, draft: EmailDraft): QueueResult {
  const db = getDb()
  if (!draft.to_email.trim()) return 'no_email'
  if (db.email_outbox.some((e) => e.organization_id === s.org.id && e.dedupe_key === draft.dedupe_key)) return 'skipped'
  const row: EmailMessage = { id: newId(), organization_id: s.org.id, ...draft, to_email: draft.to_email.trim(), status: 'simulated', created_at: nowIso() }
  upsertRows('email_outbox', [row])
  return 'created'
}

/** Põe o aviso no sino de UMA pessoa com login, se a chave ainda não existe para ela. */
export function queueNotice(s: Session, n: { user_id: Id; title: string; body: string; link: string | null; dedupe_key: string }): Exclude<QueueResult, 'no_email'> {
  const db = getDb()
  if (db.notifications.some((x) => x.organization_id === s.org.id && x.user_id === n.user_id && x.dedupe_key === n.dedupe_key)) return 'skipped'
  const row: Notification = {
    id: newId(), organization_id: s.org.id, ...n, channel: 'in_app', status: 'sent', attempts: 1, last_error: null, created_at: nowIso(), read_at: null,
  }
  upsertRows('notifications', [row])
  return 'created'
}

/** Grava uma execução da regra (o "Registro das execuções" da aba Automações e comunicados). */
export function recordRun(s: Session, rule: AutomationRule, created: number, skipped: number, error: string | null): AutomationRun {
  const run: AutomationRun = {
    id: newId(), organization_id: s.org.id, rule_id: rule.id, ran_at: nowIso(), status: error ? 'error' : 'ok',
    created_count: created, skipped_count: skipped, error,
  }
  upsertRows('automation_runs', [run])
  return run
}

/** A primeira regra LIGADA deste gatilho na organização (null = desligada ou inexistente: não manda nada). */
export function enabledRule(db: Db, orgId: Id, trigger: AutomationTrigger): AutomationRule | null {
  return db.automation_rules.find((r) => r.organization_id === orgId && r.trigger === trigger && r.enabled) ?? null
}

/** É administrador ou colaborador ativo da organização? (memberships não tem regra em scope.ts: filtro pela organização.) */
function isActiveTeam(db: Db, orgId: Id, userId: Id): boolean {
  return db.memberships.some((m) => m.organization_id === orgId && m.user_id === userId && m.status === 'active' && (m.role === 'admin' || m.role === 'staff'))
}

/**
 * Quem responde pelo assunto na conta, nesta ordem:
 * 1. a pessoa indicada (ex.: o responsável que fez a triagem do chamado), se ainda é da equipe;
 * 2. o responsável pelo imóvel (properties.manager_user_id), se ainda é da equipe;
 * 3. o primeiro administrador ativo.
 * Por que conferir "ainda é da equipe": o responsável pode ter saído da conta; mandar para quem
 * saiu é o aviso que ninguém lê. É a mesma regra das automações de contrato (Tarefas).
 */
export function responsibleFor(db: Db, orgId: Id, propertyId: Id | null, preferred: Id | null = null): Id | null {
  if (preferred && isActiveTeam(db, orgId, preferred)) return preferred
  const manager = propertyId ? (db.properties.find((p) => p.id === propertyId)?.manager_user_id ?? null) : null
  if (manager && isActiveTeam(db, orgId, manager)) return manager
  return db.memberships.find((m) => m.organization_id === orgId && m.role === 'admin' && m.status === 'active')?.user_id ?? null
}

/**
 * O login (usuário) de uma pessoa do cadastro, se ela tem acesso ativo ao portal desta conta.
 * Primeiro pelo vínculo (memberships.person_id), que é o que vale para o acesso; depois pelo
 * people.user_id (cadastro antigo, antes do convite virar vínculo).
 */
export function loginOf(db: Db, orgId: Id, personId: Id): Id | null {
  const m = db.memberships.find((x) => x.organization_id === orgId && x.person_id === personId && x.status === 'active')
  if (m) return m.user_id
  return db.people.find((p) => p.id === personId && p.organization_id === orgId)?.user_id ?? null
}

/** "Ana Ribeiro" a partir do id do login. */
export function profileOf(db: Db, userId: Id): { name: string; email: string } | null {
  const p = db.profiles.find((x) => x.id === userId)
  return p ? { name: p.full_name, email: p.email } : null
}
