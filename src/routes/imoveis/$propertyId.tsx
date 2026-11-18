// Rota /imoveis/$propertyId: só liga o endereço à página do módulo (a página mora em src/modules/imoveis).
// ?unidade=<id> abre a ficha com a unidade (ou vaga) escolhida: o painel ao lado do 3D mostra a
// ficha curta dela e as abas de baixo são as dela. ?aba= escolhe a aba de baixo (do imóvel:
// unidades, vagas, manutencao, historico; da unidade: contratos, chamados, historico). Valores de
// antes (pessoas, equipe, estrutura, documentos...) continuam valendo (PROPERTY_OLD_TABS e
// UNIT_OLD_TABS); aba desconhecida a página troca pela primeira.
import { createFileRoute } from '@tanstack/react-router'
import { PropertyPage } from '@/modules/imoveis/PropertyPage'

export const Route = createFileRoute('/imoveis/$propertyId')({
  // Endereço é dado de fora: só texto passa.
  validateSearch: (search: Record<string, unknown>): { aba?: string; unidade?: string } => ({
    ...(typeof search.aba === 'string' ? { aba: search.aba } : {}),
    ...(typeof search.unidade === 'string' && search.unidade ? { unidade: search.unidade } : {}),
  }),
  component: function RouteComponent() {
    const { propertyId } = Route.useParams()
    const { aba, unidade } = Route.useSearch()
    return <PropertyPage id={propertyId} tab={aba} unitId={unidade} />
  },
})
