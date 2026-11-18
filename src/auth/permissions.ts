/* =============================================================================
   permissions.ts: a matriz de papéis da seção F do plano, num lugar só.

   ATENÇÃO, que é a regra mais importante do produto: isto decide o que a TELA mostra.
   Quem protege o dado é o escopo do repositório (hoje) e a RLS do banco (fase 2).
   Esconder um botão nunca é segurança: quem tem o link ou o console do navegador tenta
   do mesmo jeito, e é o banco que tem de dizer não.
   ============================================================================= */
import type { Permission, Role } from '@/data/types'
import type { Session } from './session'

/**
 * Ações além das permissões por módulo: as dos portais e as que não são de um módulo só.
 * 'team:performance' (07/11/2026): ver o desempenho de CADA colaborador na Visão geral. Não é
 * permissão que se dá a colaborador (não está em Permission): só o admin tem. O colaborador vê
 * só a própria linha ("Meu desempenho"); quem decide isso de verdade é o repo.ts da Visão geral.
 */
export type Action =
  | Permission
  | 'overview:view'
  | 'team:performance'
  | 'portal:home'
  | 'maintenance:open'
  | 'maintenance:work'
  | 'quotes:approve'
  | 'documents:view'
  | 'notifications:view'

const PORTAL: Partial<Record<Role, Action[]>> = {
  owner: ['portal:home', 'properties:view', 'contracts:view', 'finance:view', 'maintenance:view', 'maintenance:open', 'quotes:approve', 'documents:view', 'notifications:view'],
  lessee: ['portal:home', 'contracts:view', 'finance:view', 'maintenance:view', 'maintenance:open', 'documents:view', 'notifications:view'],
  vendor: ['portal:home', 'maintenance:view', 'maintenance:work', 'notifications:view'],
}

/** O que só existe na conta de imobiliária (proprietário independente não tem repasse nem equipe). */
export type Feature = 'transfers' | 'portfolios' | 'team' | 'owner_portal'

export function hasFeature(s: Session, f: Feature): boolean {
  return s.org.kind === 'agency' || !['transfers', 'portfolios', 'team', 'owner_portal'].includes(f)
}

export function can(s: Session, a: Action): boolean {
  if (s.roles.includes('admin')) {
    if (a === 'portal:home' || a === 'maintenance:work') return false
    if (a === 'transfers:approve') return hasFeature(s, 'transfers')
    return true
  }
  if (s.roles.includes('staff')) {
    // Todo colaborador vê a visão geral (cada bloco dela confere a própria permissão), documentos e avisos.
    if (a === 'overview:view' || a === 'documents:view' || a === 'notifications:view' || a === 'maintenance:open') return true
    if (s.permissions.has(a as Permission)) return true
  }
  return s.roles.some((r) => PORTAL[r]?.includes(a))
}

/** Pessoa de portal: não é admin nem colaborador (proprietário convidado, inquilino, prestador). */
export function isPortal(s: Session): boolean {
  return !s.roles.includes('admin') && !s.roles.includes('staff')
}

/** Primeira tela depois de entrar. */
export function homeOf(s: Session): '/' | '/portal' {
  return isPortal(s) ? '/portal' : '/'
}
