// Rota raiz: toda página aparece dentro da moldura (AppShell). Endereço inexistente cai no "não encontrado".
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { AppShell } from '@/app/AppShell'
import { EmptyState } from '@/components/ui/States'

export const Route = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  notFoundComponent: () => (
    <EmptyState
      title="Página não encontrada"
      description="O endereço não existe ou o registro foi arquivado."
      action={
        <Link to="/" className="font-medium text-primary hover:underline">
          Voltar ao início
        </Link>
      }
    />
  ),
})
