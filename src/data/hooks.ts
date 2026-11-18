/* =============================================================================
   hooks.ts: os ganchos (hooks) que as telas usam para ler e gravar.

   A tela nunca chama o repositório direto: chama useRepo / useRepoMutation, que cuidam
   de "carregando", "erro", cache e de recarregar depois de gravar.

   SEGURANÇA DE TELA: a chave do cache leva o usuário e a organização. Sem isso, ao trocar
   de persona a tela mostraria por um instante os dados guardados da persona anterior.
   ============================================================================= */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/auth/SessionProvider'
import type { Session } from '@/auth/session'
import { useToast } from '@/components/ui/Toast'

export function useRepo<T>(name: string, fn: (s: Session) => Promise<T>, deps: unknown[] = [], opts: { enabled?: boolean } = {}) {
  const s = useSession()
  return useQuery({
    queryKey: [name, s.user.id, s.org.id, ...deps],
    queryFn: () => fn(s),
    // Ao trocar de página, filtro ou escolha, a leitura anterior fica na tela (a tabela esmaece)
    // até a nova chegar: sem o "pisca" do esqueleto a cada clique (07/11, "tá muito travado").
    // Só vale para a MESMA consulta da MESMA pessoa: trocar de persona não reaproveita a tela
    // da persona anterior (é a regra de segurança do cabeçalho; a troca de persona não remonta a tela).
    placeholderData: (prev, prevQuery) => {
      const k = prevQuery?.queryKey
      return k && k[0] === name && k[1] === s.user.id && k[2] === s.org.id ? prev : undefined
    },
    enabled: opts.enabled,
  })
}

export function useRepoMutation<A, R>(fn: (s: Session, args: A) => Promise<R>, opts: { success?: string | ((r: R) => string); onSuccess?: (r: R) => void; silent?: boolean } = {}) {
  const s = useSession()
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (args: A) => fn(s, args),
    onSuccess: (r) => {
      void qc.invalidateQueries() // qualquer gravação pode mudar contagens de outras telas
      const msg = typeof opts.success === 'function' ? opts.success(r) : opts.success
      if (msg && !opts.silent) toast.success(msg)
      opts.onSuccess?.(r)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Não foi possível salvar. Tente de novo.'),
  })
}
