// Rota /mapa/: o Mapa foi juntado à página Imóveis (05/11; desde 06/11 ele fica no topo dela, sem
// aba). Endereço antigo (favorito, link salvo) continua funcionando: redireciona para Imóveis.
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/mapa/')({
  beforeLoad: () => {
    throw redirect({ to: '/imoveis' })
  },
})
