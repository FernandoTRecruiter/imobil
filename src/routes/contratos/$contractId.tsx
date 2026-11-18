// Rota /contratos/$contractId: a página própria do contrato saiu em 07/11/2026; o contrato mora em
// "Contratos e pessoas", escolhido (linha aberta, ficha curta, detalhes). Este endereço continua
// valendo para todo link do app, aviso guardado e e-mail antigo: troca para /contratos?contrato=<id>
// sem deixar rastro no "voltar". Quem confere se a pessoa pode ver o contrato é o repositório, na tela.
import { createFileRoute, redirect } from '@tanstack/react-router'
import { contractRedirect } from '@/modules/contratos/endereco'

export const Route = createFileRoute('/contratos/$contractId')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/contratos', search: contractRedirect(params.contractId), replace: true })
  },
})
