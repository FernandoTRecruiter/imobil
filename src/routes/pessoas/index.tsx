// Rota /pessoas/: a lista de pessoas virou a categoria Pessoas de "Contratos e pessoas" (07/11/2026).
// O endereço continua valendo: troca para /contratos?lista=pessoas sem deixar rastro no "voltar".
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/pessoas/')({
  beforeLoad: () => {
    throw redirect({ to: '/contratos', search: { lista: 'pessoas' }, replace: true })
  },
})
