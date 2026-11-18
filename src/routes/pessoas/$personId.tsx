// Rota /pessoas/$personId: a página própria da pessoa saiu em 07/11/2026; ela mora em "Contratos e
// pessoas", escolhida na categoria Pessoas. O endereço continua valendo para todo link do app: troca
// para /contratos?lista=pessoas&pessoa=<id> e traduz o ?aba= antigo (personRedirect, em endereco.ts).
import { createFileRoute, redirect } from '@tanstack/react-router'
import { personRedirect } from '@/modules/contratos/endereco'

export const Route = createFileRoute('/pessoas/$personId')({
  // Endereço é dado de fora: só texto passa.
  validateSearch: (search: Record<string, unknown>): { aba?: string } => (typeof search.aba === 'string' ? { aba: search.aba } : {}),
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/contratos', search: personRedirect(params.personId, search.aba), replace: true })
  },
})
