// Rota /imoveis/: só liga o endereço à página do módulo (a página mora em src/modules/imoveis).
// ?lista=imoveis|unidades|vagas escolhe a tabela embaixo do mapa; ?imovel=<id>&unidade=<id> é o que
// está escolhido no mapa (a ficha curta ao lado mostra o básico). Endereços de antes da tela única
// (06/11) continuam valendo: ?modo=... é aceito e ignorado (?modo=imoveis vira ?lista=imoveis).
import { createFileRoute, redirect } from '@tanstack/react-router'
import { OLD_SEARCH_KEYS, parseImoveisSearch, PropertiesPage } from '@/modules/imoveis/PropertiesPage'

export const Route = createFileRoute('/imoveis/')({
  // Endereço é dado de fora: valor desconhecido é ignorado em vez de quebrar a tela.
  validateSearch: parseImoveisSearch,
  // Sobrou chave antiga (?modo=, ?bloco=): troca pelo endereço de hoje, sem empilhar no Voltar.
  // location.search é o endereço CRU (antes da validação acima, que joga essas chaves fora).
  beforeLoad: ({ location }) => {
    const raw = location.search as Record<string, unknown>
    if (OLD_SEARCH_KEYS.some((k) => k in raw)) throw redirect({ to: '/imoveis', search: parseImoveisSearch(raw), replace: true })
  },
  component: function RouteComponent() {
    return <PropertiesPage search={Route.useSearch()} />
  },
})
