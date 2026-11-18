/* O menu: cada item diz a ação que precisa (matriz F). O menu de cada pessoa sai do mesmo filtro que protege a página. */
import { Building2, FileText, House, LayoutDashboard, ListChecks, Settings, Wallet, Wrench, type LucideIcon } from 'lucide-react'
import type { Action, Feature } from '@/auth/permissions'
import { can, hasFeature, isPortal } from '@/auth/permissions'
import type { Session } from '@/auth/session'

export interface NavItem {
  to: string
  label: string
  /** Nome no portal (proprietário, inquilino, prestador), quando muda. */
  portalLabel?: Partial<Record<'owner' | 'lessee' | 'vendor', string>>
  icon: LucideIcon
  action: Action
  /** Outra ação que também mostra o item (Contratos e pessoas: quem vê pessoas sem ver contratos, como o colaborador da manutenção). */
  orAction?: Action
  feature?: Feature
  teamOnly?: boolean
  /** Outros endereços que pertencem a este item (ex.: /unidades é parte de Imóveis), para o menu ficar marcado. */
  also?: string[]
}

/*
   Menu enxuto (05/11, pedido do Fernando: "simplificar a vida do usuário"): 7 itens no lugar de 12.
   - Mapa entrou em Imóveis (06/11: tela única, mapa em cima e a tabela de imóveis ou de unidades
     embaixo; o 3D fica na página de cada imóvel);
   - Relatórios virou botão no topo da Visão geral (o endereço /relatorios continua);
   - Dados (importar planilha, editar em lote) virou botão em Configurações e em Imóveis;
   - Processos passou a se chamar Tarefas (é o que a pessoa vai fazer ali);
   - Pessoas e Contratos viraram "Contratos e pessoas" (07/11): uma tabela de contratos que abre com
     as partes e os documentos, e a categoria Pessoas para quem não tem contrato;
   - Documentos saiu do menu (07/11): documento sempre pertence a alguma coisa e aparece onde ela mora
     (contrato, imóvel, unidade, chamado, pessoa). Proprietário e inquilino veem os deles em "Meus contratos".
   Os endereços antigos marcam o item novo no menu (campo "also") ou redirecionam (/pessoas, /documentos).
*/
export const NAV: NavItem[] = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard, action: 'overview:view', also: ['/relatorios'] },
  { to: '/portal', label: 'Início', icon: House, action: 'portal:home' },
  { to: '/imoveis', label: 'Imóveis', icon: Building2, action: 'properties:view', portalLabel: { owner: 'Meus imóveis' }, also: ['/unidades', '/mapa'] },
  {
    to: '/contratos', label: 'Contratos e pessoas', icon: FileText, action: 'contracts:view', orAction: 'people:view',
    portalLabel: { owner: 'Meus contratos', lessee: 'Meus contratos' }, also: ['/pessoas'],
  },
  { to: '/financeiro', label: 'Financeiro', icon: Wallet, action: 'finance:view', portalLabel: { owner: 'Extratos e repasses', lessee: 'Cobranças' } },
  { to: '/manutencao', label: 'Manutenção', icon: Wrench, action: 'maintenance:view', portalLabel: { owner: 'Chamados', lessee: 'Chamados', vendor: 'Meus chamados' }, also: ['/vistorias'] },
  { to: '/processos', label: 'Tarefas', icon: ListChecks, action: 'workflows:view', teamOnly: true },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, action: 'settings:manage', teamOnly: true, also: ['/dados'] },
]

export function navFor(s: Session): { to: string; label: string; icon: LucideIcon; also: string[] }[] {
  const portal = isPortal(s)
  const role = s.roles.find((r) => r === 'owner' || r === 'lessee' || r === 'vendor')
  const allowed = (n: NavItem) => can(s, n.action) || (!!n.orAction && can(s, n.orAction))
  return NAV.filter((n) => allowed(n) && (!n.feature || hasFeature(s, n.feature)) && !(portal && n.teamOnly)).map((n) => ({
    to: n.to,
    label: (portal && role && n.portalLabel?.[role]) || n.label,
    icon: n.icon,
    also: n.also ?? [],
  }))
}

/** O item do menu está ativo neste endereço? "/" só no início exato; os outros também nas páginas filhas e nos "also". */
export function isNavActive(item: { to: string; also: string[] }, pathname: string): boolean {
  if (item.to === '/') return pathname === '/'
  return [item.to, ...item.also].some((p) => pathname === p || pathname.startsWith(p + '/'))
}
