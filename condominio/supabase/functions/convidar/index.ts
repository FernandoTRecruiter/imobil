/* =============================================================================
   Função do servidor "convidar" (Supabase Edge Function, Deno).
   Por que existe: mandar convite exige a chave de serviço do Supabase, que NUNCA pode ir no site.
   Passo a passo:
     1. O app chama esta função com o login de quem está na equipe: { tipo: 'morador'|'equipe', id }.
     2. A função pergunta ao banco (cond_convite_pedir, com o login de quem chamou) se essa pessoa pode
        convidar; o banco confere a permissão, marca a data, grava na auditoria e devolve o e-mail.
     3. Com a chave de serviço, manda o convite (link para criar a senha). Se a pessoa já tem conta
        (reenvio, ou e-mail trocado), manda o link de trocar a senha, que serve igual.
   Publicar: docs/PUBLICAR.md, fase 2b. Variável extra: SITE_URL (endereço do site no Netlify).
   ============================================================================= */
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const servico = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const site = Deno.env.get('SITE_URL') ?? ''

  let pedido: { tipo?: string; id?: string }
  try {
    pedido = await req.json()
  } catch {
    return resposta({ erro: 'dados_invalidos' }, 400)
  }
  if ((pedido.tipo !== 'morador' && pedido.tipo !== 'equipe') || !pedido.id) return resposta({ erro: 'dados_invalidos' }, 400)

  // 2. O banco decide se quem chamou pode (com o login dele, não com a chave de serviço).
  const comoQuemChamou = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data, error } = await comoQuemChamou.rpc('cond_convite_pedir', { p_tipo: pedido.tipo, p_id: pedido.id })
  if (error) return resposta({ erro: 'sem_permissao' }, 403)
  if (data?.erro) return resposta({ erro: data.erro }, 403)
  const email = data.email as string

  // 3. Convite novo; se a conta já existe, link de trocar a senha.
  const admin = createClient(url, servico, { auth: { persistSession: false } })
  const convite = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: site })
  if (convite.error) {
    const troca = await createClient(url, anon).auth.resetPasswordForEmail(email, { redirectTo: site })
    if (troca.error) return resposta({ erro: 'falha_email' }, 502)
  }
  return resposta({ ok: true })
})
