// Rota /contratos/: a tela "Contratos e pessoas" (src/modules/contratos/ContratosPessoasPage.tsx).
// ?lista=pessoas troca a tabela para as pessoas; ?contrato=<id> e ?pessoa=<id> são o escolhido
// (linha aberta, ficha curta ao lado, detalhes embaixo); ?aba= é a aba dos detalhes. As regras do
// endereço moram em src/modules/contratos/endereco.ts (testadas em contratos.test.ts).
import { createFileRoute } from '@tanstack/react-router'
import { ContratosPessoasPage } from '@/modules/contratos/ContratosPessoasPage'
import { parseContratosSearch } from '@/modules/contratos/endereco'

export const Route = createFileRoute('/contratos/')({
  // Endereço é dado de fora: valor desconhecido é ignorado em vez de quebrar a tela.
  validateSearch: parseContratosSearch,
  component: function RouteComponent() {
    return <ContratosPessoasPage search={Route.useSearch()} />
  },
})
