/* =============================================================================
   api.ts: o que todo repositório usa (fonte de dados, demora simulada, erros, auditoria).

   FONTE DE DADOS: VITE_DATA_SOURCE no .env.local escolhe "mock" (padrão) ou "supabase".
   Na fase 2, cada função de repositório ganha a versão Supabase com a mesma assinatura;
   as telas não mudam, porque só conhecem os ganchos (hooks) e os tipos.
   ============================================================================= */
import type { Session } from '@/auth/session'
import { getDb } from './store'
import { scopeFor, type Scope } from './scope'
import type { Db } from './db'
import type { AuditAction, AuditLog, Id } from './types'
import { newId } from '@/lib/random'
import { upsertRows } from './store'

export const DATA_SOURCE = (import.meta.env?.VITE_DATA_SOURCE as string | undefined) ?? 'mock'

/** Regra de negócio recusou (mensagem pronta para a tela: causa + o que fazer). */
export class RuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuleError'
  }
}

/** A sessão não tem acesso (na fase 2, é o "0 linhas" ou o erro 403 da RLS). */
export class AccessError extends Error {
  constructor(message = 'Você não tem acesso a este registro.') {
    super(message)
    this.name = 'AccessError'
  }
}

const isTest = import.meta.env?.MODE === 'test'

/** Demora de rede simulada: assim a tela mostra o "carregando" como vai mostrar de verdade. */
export function delay(ms = 140 + Math.random() * 160): Promise<void> {
  return isTest ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))
}

/**
 * Abre uma "conexão": confere a fonte, devolve o banco e o escopo da sessão.
 * Todo repositório começa por aqui, para nenhuma consulta escapar do escopo.
 */
export async function connect(s: Session): Promise<{ db: Db; sc: Scope }> {
  if (DATA_SOURCE !== 'mock') throw new Error('Fonte "supabase" ainda não ligada: é a fase 2 (ver docs/ARQUITETURA.md).')
  await delay()
  const db = getDb()
  return { db, sc: scopeFor(db, s) }
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** Registra na auditoria (quem, quando, o quê). Na fase 2 é um gatilho do banco que faz isto. */
export function audit(s: Session, entity: string, entityId: Id, action: AuditAction, summary: string, changes: AuditLog['changes'] = null): void {
  upsertRows('audit_logs', [{ id: newId(), organization_id: s.org.id, actor_user_id: s.user.id, entity, entity_id: entityId, action, summary, changes, at: nowIso() }])
}

/** Diferença entre duas versões de uma linha, para a auditoria mostrar "de X para Y". */
export function diff<T extends object>(before: T, after: T): AuditLog['changes'] {
  const out: NonNullable<AuditLog['changes']> = {}
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (k === 'updated_at') continue
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[String(k)] = { from: before[k], to: after[k] }
  }
  return Object.keys(out).length ? out : null
}
