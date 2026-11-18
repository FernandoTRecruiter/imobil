// Rota /documentos/: a tela Documentos saiu do menu em 07/11/2026 (documento sempre pertence a alguma
// coisa e aparece onde ela mora). O endereço continua valendo: a equipe vai para Imóveis (a aba
// "Documentos e histórico" de cada imóvel); proprietário e inquilino, para "Meus contratos", onde fica
// a lista inteira dos documentos deles. Componente, e não beforeLoad, porque o destino depende da sessão.
import { createFileRoute } from '@tanstack/react-router'
import { DocumentsRedirect } from '@/modules/documentos/parts'

export const Route = createFileRoute('/documentos/')({ component: DocumentsRedirect })
