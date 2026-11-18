/* =============================================================================
   Moldura do app: faixa de demonstração, barra lateral, barra de cima e o conteúdo.
   A faixa e a barra de cima têm altura FIXA: ligar filtro ou avisar nunca empurra o topo.
   Densidade (07/11/2026, "deixa mais slim"): faixa de 28 px e barra de 48 px (eram 36 e 56), e o
   conteúdo com 12 px entre os blocos da página: o mapa e o 3D começam mais perto do topo.
   ============================================================================= */
import { useState, type ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Dialog as R } from 'radix-ui'
import { Bell, Menu, PanelLeftClose, PanelLeftOpen, RotateCcw, X } from 'lucide-react'
import { useSession, useSessionApi } from '@/auth/SessionProvider'
import { demoInfo } from '@/data/store'
import { formatDate } from '@/lib/dates'
import { readJSON, writeJSON } from '@/lib/storage'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/components/ui/cn'
import { useUnreadCount } from '@/modules/avisos/repo'
import { isNavActive, navFor } from './nav'
import { BrandMark } from './BrandMark'
import { PersonaSwitcher } from './PersonaSwitcher'

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex h-12 items-center gap-2.5 px-4" aria-label="Imobil, início">
      <BrandMark />
      {!compact && <span className="text-[17px] font-medium">Imobil</span>}
    </Link>
  )
}

function NavList({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const s = useSession()
  // O "ativo" é calculado aqui (e não pelo Link) para valer também em endereços que não são filhos do item,
  // como /unidades/... dentro de Imóveis.
  const pathname = useRouterState({ select: (st) => st.location.pathname })
  return (
    <nav aria-label="Principal" className="flex flex-col gap-0.5 px-2">
      {navFor(s).map((n) => {
        const active = isNavActive(n, pathname)
        return (
          <Link
            key={n.to}
            to={n.to}
            onClick={onNavigate}
            title={compact ? n.label : undefined}
            aria-label={compact ? n.label : undefined}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // Ativo = degrau de superfície e texto primário; só o ícone leva o azul (cromo quieto).
              'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-text',
              compact && 'justify-center px-0',
              active ? 'bg-surface-2 font-medium text-text [&_svg]:text-primary' : 'text-muted',
            )}
          >
            <n.icon className="size-[18px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
            {!compact && <span className="truncate">{n.label}</span>}
          </Link>
        )
      })}
    </nav>
  )
}

function DemoBanner() {
  const { resetDemo } = useSessionApi()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const info = demoInfo()
  return (
    <div className="sticky top-0 z-40 flex h-7 items-center justify-center gap-3 bg-ink px-4 text-xs text-on-ink">
      <span className="truncate">
        <strong className="font-semibold">Demonstração</strong>
        <span className="hidden sm:inline"> · nomes, documentos e valores são fictícios · dados de {formatDate(info.ref)}</span>
        {!info.persistOk && <span className="text-amber-300"> · este navegador não guarda alterações: valem até fechar a aba</span>}
      </span>
      <button className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded-md px-2 font-medium underline-offset-2 hover:underline" onClick={() => setConfirm(true)}>
        <RotateCcw className="size-3.5" aria-hidden="true" /> Restaurar dados
      </button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Restaurar os dados de demonstração?"
        message="Tudo o que você criou, alterou ou importou nesta demonstração some, e os dados fictícios voltam ao original com a data de hoje."
        confirmLabel="Restaurar"
        danger
        onConfirm={() => {
          resetDemo()
          setConfirm(false)
          toast.success('Dados de demonstração restaurados.')
        }}
      />
    </div>
  )
}

function BellLink() {
  const unread = useUnreadCount()
  return (
    <Link to="/avisos" className="relative grid size-10 place-items-center rounded-full transition-colors duration-150 hover:bg-surface-2" aria-label={unread ? `Avisos: ${unread} não lidos` : 'Avisos'}>
      <Bell className="size-5" aria-hidden="true" />
      {unread > 0 && <span className="num absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
    </Link>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const s = useSession()
  const [compact, setCompact] = useState<boolean>(() => readJSON('imobil:sidebar-compact') ?? false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const toggle = () => {
    setCompact(!compact)
    writeJSON('imobil:sidebar-compact', !compact)
  }
  return (
    <div className="min-h-dvh">
      <a href="#conteudo" className="sr-only z-50 rounded-lg bg-primary px-3 py-2 text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Pular para o conteúdo
      </a>
      <DemoBanner />
      <div className="flex">
        <aside className={cn('sticky top-7 hidden h-[calc(100dvh-28px)] shrink-0 flex-col border-r border-border bg-surface lg:flex', compact ? 'w-[72px]' : 'w-60')}>
          <Brand compact={compact} />
          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            <NavList compact={compact} />
          </div>
          <button onClick={toggle} className="m-2 flex h-9 items-center justify-center gap-2 rounded-xl text-xs font-medium text-muted hover:bg-surface-2" aria-label={compact ? 'Expandir menu' : 'Recolher menu'}>
            {compact ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
            {!compact && 'Recolher'}
          </button>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="sticky top-7 z-30 flex h-12 items-center gap-2 border-b border-border bg-bg px-4 sm:px-6">
            <R.Root open={mobileOpen} onOpenChange={setMobileOpen}>
              <R.Trigger asChild>
                <button className="grid size-10 place-items-center rounded-full hover:bg-surface-2 lg:hidden" aria-label="Abrir menu">
                  <Menu className="size-5" aria-hidden="true" />
                </button>
              </R.Trigger>
              <R.Portal>
                <R.Overlay className="fixed inset-0 z-50 animate-fade-in bg-slate-950/40" />
                <R.Content className="fixed inset-y-0 left-0 z-50 flex w-72 animate-sheet-in flex-col bg-surface shadow-pop">
                  <R.Title className="sr-only">Menu</R.Title>
                  <R.Description className="sr-only">Navegação principal</R.Description>
                  <div className="flex items-center justify-between pr-2">
                    <Brand />
                    <R.Close className="grid size-10 place-items-center rounded-full hover:bg-surface-2" aria-label="Fechar menu">
                      <X className="size-5" aria-hidden="true" />
                    </R.Close>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto py-2">
                    <NavList onNavigate={() => setMobileOpen(false)} />
                  </div>
                </R.Content>
              </R.Portal>
            </R.Root>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{s.org.name}</p>
              <p className="truncate text-xs text-muted">{s.org.kind === 'agency' ? 'Imobiliária' : 'Proprietário independente'}</p>
            </div>
            <BellLink />
            <PersonaSwitcher />
          </div>
          <main id="conteudo" className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 pt-3 pb-8 sm:px-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
