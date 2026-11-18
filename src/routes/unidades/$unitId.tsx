// Rota /unidades/$unitId: a unidade não tem mais página própria (07/11/2026); ela mora na ficha do
// imóvel, escolhida. Este endereço continua valendo para todo link do app (pessoa, contrato,
// financeiro...): troca para /imoveis/<imóvel>?unidade=<id>, sem deixar rastro no "voltar", e
// traduz o ?aba= antigo (resumo, pessoas, financeiro, manutencao, documentos) para a aba de hoje.
// A troca é feita por um componente (UnitRedirect) e não no beforeLoad da rota: achar o imóvel
// da unidade precisa da sessão (persona e escopo), que mora no React.
import { createFileRoute } from '@tanstack/react-router'
import { UnitRedirect } from '@/modules/imoveis/UnitPage'

export const Route = createFileRoute('/unidades/$unitId')({
  // Endereço é dado de fora: só texto passa.
  validateSearch: (search: Record<string, unknown>): { aba?: string } => (typeof search.aba === 'string' ? { aba: search.aba } : {}),
  component: function RouteComponent() {
    const { unitId } = Route.useParams()
    const { aba } = Route.useSearch()
    return <UnitRedirect id={unitId} tab={aba} />
  },
})
