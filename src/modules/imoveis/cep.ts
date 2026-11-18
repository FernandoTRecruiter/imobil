/* =============================================================================
   cep.ts: consulta o endereço pelo CEP no ViaCEP (serviço gratuito, sem chave).

   Três cuidados, porque é dado que vem de FORA:
   1. tempo limite de 4 s (AbortController): sem ele, rede lenta deixaria o campo "buscando"
      para sempre e a pessoa sem saber se pode digitar;
   2. a resposta é conferida (zod) antes de usar: serviço de terceiro pode mudar o formato;
   3. qualquer falha vira um motivo legível, e a tela segue no preenchimento manual.
   ============================================================================= */
import { z } from 'zod'
import { onlyDigits } from '@/lib/documents'

export type CepResult =
  | { ok: true; street: string; district: string; city: string; state: string }
  | { ok: false; reason: 'invalid' | 'not_found' | 'timeout' | 'offline' }

/** O ViaCEP responde {"erro": true} (ou "true", em versões novas) quando o CEP não existe. */
const viaCepSchema = z.object({
  logradouro: z.string().optional(),
  bairro: z.string().optional(),
  localidade: z.string().optional(),
  uf: z.string().optional(),
  erro: z.union([z.boolean(), z.string()]).optional(),
})

export const CEP_TIMEOUT_MS = 4000

export async function lookupCep(cep: string, timeoutMs = CEP_TIMEOUT_MS): Promise<CepResult> {
  const digits = onlyDigits(cep)
  if (digits.length !== 8) return { ok: false, reason: 'invalid' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: ctrl.signal })
    if (res.status === 400) return { ok: false, reason: 'invalid' }
    if (!res.ok) return { ok: false, reason: 'offline' }
    const parsed = viaCepSchema.safeParse(await res.json())
    if (!parsed.success) return { ok: false, reason: 'offline' }
    const j = parsed.data
    if (j.erro === true || j.erro === 'true' || !j.localidade) return { ok: false, reason: 'not_found' }
    return { ok: true, street: j.logradouro ?? '', district: j.bairro ?? '', city: j.localidade, state: (j.uf ?? '').toUpperCase() }
  } catch {
    return { ok: false, reason: ctrl.signal.aborted ? 'timeout' : 'offline' }
  } finally {
    clearTimeout(timer)
  }
}

/** Texto que a tela mostra para cada falha: o que houve e o que fazer. */
export const CEP_FAIL_MESSAGE: Record<Extract<CepResult, { ok: false }>['reason'], string> = {
  invalid: 'CEP com formato inválido: são 8 números.',
  not_found: 'CEP não encontrado nos Correios: confira os números ou preencha o endereço à mão.',
  timeout: `O serviço de CEP não respondeu em ${CEP_TIMEOUT_MS / 1000} s. Preencha o endereço à mão; dá para tentar de novo depois.`,
  offline: 'Não deu para consultar o CEP agora (sem conexão com o serviço). Preencha o endereço à mão.',
}
