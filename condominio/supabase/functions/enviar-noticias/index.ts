/* =============================================================================
   Função do servidor "enviar-noticias" (Supabase Edge Function, Deno).
   Manda os e-mails da aba Notícias: os "agora", os agendados que venceram e os repetidos.
   Quem chama:
     - o agendador do Supabase (Cron), a cada 5 minutos (docs/PUBLICAR.md, fase 2c);
     - o app, logo depois de criar um envio "agora", para não esperar o próximo ciclo.
   Chamar duas vezes ao mesmo tempo é seguro: cond_envios_devidos "pega" cada envio com uma trava.
   Passo a passo:
     1. Pega no banco os envios vencidos, com a lista de destinatários (moradores ativos com e-mail).
     2. Para cada destinatário, troca {{nome}}, {{apto}} e {{condominio}} e manda pelo Resend.
     3. Registra o resultado (cond_envio_concluir), que marca a próxima data se o envio repete.
   Variáveis (Edge Functions > Secrets): RESEND_API_KEY, REMETENTE (ex.: "Condomínio <avisos@exemplo.com.br>"),
   NOME_CONDOMINIO.
   ============================================================================= */
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Destinatario {
  id: string
  nome: string
  apto: string
  email: string
}
interface Envio {
  id: string
  assunto: string
  corpo: string
  destinatarios: Destinatario[]
}

/** Troca os campos do modelo pelos dados de cada morador. */
function preencher(texto: string, d: Destinatario, condominio: string): string {
  return texto
    .replaceAll('{{nome}}', d.nome.split(' ')[0])
    .replaceAll('{{apto}}', d.apto)
    .replaceAll('{{condominio}}', condominio)
}

/** Texto simples vira HTML simples (parágrafos), com os caracteres especiais escapados. */
function html(texto: string): string {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const chave = Deno.env.get('RESEND_API_KEY')
  const remetente = Deno.env.get('REMETENTE')
  const condominio = Deno.env.get('NOME_CONDOMINIO') ?? 'condomínio'
  if (!chave || !remetente) return new Response(JSON.stringify({ erro: 'sem_configuracao' }), { status: 500, headers: CORS })

  // 1. O que está vencido
  const { data: envios, error } = await admin.rpc('cond_envios_devidos')
  if (error) return new Response(JSON.stringify({ erro: 'falha_banco' }), { status: 500, headers: CORS })

  let total = 0
  for (const envio of (envios ?? []) as Envio[]) {
    const resultados: { id: string; email: string; ok: boolean; erro?: string }[] = []
    // 2. Um e-mail por pessoa (o nome muda em cada um), um de cada vez (respeita o limite do Resend).
    for (const d of envio.destinatarios) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: remetente,
            to: [d.email],
            subject: preencher(envio.assunto, d, condominio),
            text: preencher(envio.corpo, d, condominio),
            html: html(preencher(envio.corpo, d, condominio)),
          }),
        })
        resultados.push({ id: d.id, email: d.email, ok: r.ok, erro: r.ok ? undefined : `HTTP ${r.status}` })
      } catch (e) {
        resultados.push({ id: d.id, email: d.email, ok: false, erro: String(e).slice(0, 200) })
      }
    }
    // 3. Registra e marca a próxima data (se repete)
    await admin.rpc('cond_envio_concluir', { p_id: envio.id, p_resultados: resultados })
    total += resultados.filter((r) => r.ok).length
  }
  return new Response(JSON.stringify({ ok: true, enviados: total }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
