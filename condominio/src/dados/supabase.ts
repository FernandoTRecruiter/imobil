/* =============================================================================
   Modo Supabase: cada função da Api vira uma chamada a uma função cond_* do banco
   (supabase/schema.sql) ou a uma função do servidor (supabase/functions).
   - Morador com código: a chave pública (anon) + apartamento e código em toda chamada.
   - Morador com e-mail e equipe: sessão do Supabase Auth (e-mail e senha); o banco acha a pessoa
     pelo e-mail confirmado da sessão.
   ============================================================================= */
import { createClient } from '@supabase/supabase-js'
import type { ServicoDef } from '../config'
import type { Auditoria, Aviso, Credencial, DiaEspecial, Envio, Funcionario, HistoricoMorador, MembroEquipe, Modelo, Morador, Solicitacao } from '../tipos'
import type { Api } from './api'

export function criarSupabase(url: string, chave: string): Api {
  const sb = createClient(url, chave, { auth: { persistSession: true, storageKey: 'condominio:sessao', detectSessionInUrl: false } })

  /** Chama uma função do banco. Erro de rede ou do Postgres e {"erro": ...} viram Error(código). */
  async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await sb.rpc(fn, args)
    if (error) throw new Error(error.code === '42501' ? 'sem_permissao' : 'falha_rede')
    if (data && typeof data === 'object' && !Array.isArray(data) && 'erro' in data) throw new Error(String((data as { erro: string }).erro))
    return data as T
  }

  /** Código: manda apartamento e código. E-mail: manda nulos (o banco usa a sessão). */
  const cred = (c: Credencial) => (c.codigo ? { p_apto: c.apto, p_codigo: c.codigo } : { p_apto: null, p_codigo: null })

  /** Pede o convite à função do servidor (ela confere a permissão no banco). */
  async function convidar(tipo: 'morador' | 'equipe', id: string, email: string) {
    const { data, error } = await sb.functions.invoke('convidar', { body: { tipo, id } })
    if (error || data?.erro) return { email, erro: (data?.erro as string) ?? 'falha_email' }
    return { email }
  }

  const entrarComSenha = async (email: string, senha: string) => {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha })
    if (error) throw new Error('login_invalido')
  }

  return {
    modo: 'supabase',
    regras: () => rpc<ServicoDef[]>('cond_regras'),
    feriados: async (de, ate) => (await rpc<{ itens: DiaEspecial[] }>('cond_feriados', { p_de: de, p_ate: ate })).itens,

    // ---------------------------------------------------------------- morador
    entrar: (apto, codigo) => rpc('cond_entrar', { p_apto: apto, p_codigo: codigo }),
    entrarEmail: async (email, senha) => {
      await entrarComSenha(email, senha)
      try {
        const r = await rpc<{ nome: string; apto: string }>('cond_entrar', { p_apto: null, p_codigo: null })
        return { ...r, email: email.trim().toLowerCase() }
      } catch (e) {
        await sb.auth.signOut() // é da equipe ou foi desativado: não deixa a sessão aberta
        throw e
      }
    },
    sessaoMorador: async () => {
      const { data } = await sb.auth.getSession()
      if (!data.session) return null
      try {
        const r = await rpc<{ nome: string; apto: string }>('cond_entrar', { p_apto: null, p_codigo: null })
        return { ...r, email: data.session.user.email ?? '' }
      } catch {
        return null
      }
    },
    sairMorador: async () => {
      await sb.auth.signOut()
    },
    esqueciSenha: async (email) => {
      // Resposta igual com ou sem cadastro: não revela quem mora no condomínio.
      await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: location.origin + location.pathname })
    },
    definirSenha: async (link, senha) => {
      if (!('token_hash' in link)) throw new Error('link_invalido')
      const v = await sb.auth.verifyOtp({ token_hash: link.token_hash, type: link.tipo })
      if (v.error) throw new Error('link_vencido')
      const u = await sb.auth.updateUser({ password: senha })
      if (u.error) throw new Error('senha_fraca')
      const eu = await rpc<MembroEquipe | null>('cond_eu')
      return eu ? 'equipe' : 'morador'
    },
    minhas: async (c, tokens) => (await rpc<{ itens: Solicitacao[] }>('cond_minhas', { ...cred(c), p_tokens: tokens })).itens,
    ocupacao: async (c, de, ate) => (await rpc<{ itens: [] }>('cond_ocupacao', { ...cred(c), p_de: de, p_ate: ate })).itens,
    solicitar: (c, p) =>
      rpc('cond_solicitar', { ...cred(c), p_servico: p.servico, p_inicio: p.inicio, p_detalhes: p.detalhes, p_anonima: p.anonima ?? false }),
    cancelar: async (c, id) => {
      await rpc('cond_cancelar', { ...cred(c), p_id: id })
    },
    avisos: async (c) => (await rpc<{ itens: Aviso[] }>('cond_avisos_morador', cred(c))).itens,

    // ---------------------------------------------------------------- equipe
    equipeAtual: async () => {
      const { data } = await sb.auth.getSession()
      if (!data.session) return null
      return rpc<MembroEquipe | null>('cond_eu')
    },
    entrarEquipe: async (email, senha) => {
      await entrarComSenha(email, senha)
      const eu = await rpc<MembroEquipe | null>('cond_eu')
      if (!eu) {
        await sb.auth.signOut() // conta existe, mas não está na equipe (ou foi desativada)
        throw new Error('sem_permissao')
      }
      return eu
    },
    sairEquipe: async () => {
      await sb.auth.signOut()
    },
    painel: (de, ate) => rpc('cond_painel', { p_de: de ?? null, p_ate: ate ?? null }),
    atualizar: async (id, m) => {
      await rpc('cond_atualizar', { p_id: id, p_status: m.status ?? null, p_nota: m.nota ?? null, p_pago: m.pago ?? null })
    },
    moradores: async () => (await rpc<{ itens: Morador[] }>('cond_lista_moradores')).itens,
    criarMorador: async (d) => {
      const r = await rpc<{ id: string; codigo: string | null; convidar: boolean }>('cond_criar_morador', { p: d })
      return { id: r.id, codigo: r.codigo, convite: r.convidar ? await convidar('morador', r.id, d.email) : null }
    },
    editarMorador: async (id, d) => {
      const r = await rpc<{ canceladas: number; convidar: boolean }>('cond_editar_morador', { p_id: id, p: d })
      return { canceladas: r.canceladas, convite: r.convidar ? await convidar('morador', id, d.email) : null }
    },
    novoCodigo: (id) => rpc('cond_novo_codigo', { p_id: id }),
    reenviarConvite: async (tipo, id) => {
      const { data, error } = await sb.functions.invoke('convidar', { body: { tipo, id } })
      if (error || data?.erro) throw new Error((data?.erro as string) ?? 'falha_email')
      return { email: '' }
    },
    historicoMorador: (id) => rpc<HistoricoMorador>('cond_historico_morador', { p_id: id }),
    funcionarios: async () => (await rpc<{ itens: Funcionario[] }>('cond_lista_equipe')).itens,
    salvarFuncionario: async (id, d) => {
      const r = await rpc<{ id: string; convidar: boolean }>('cond_salvar_equipe', { p_id: id, p: d })
      return { id: r.id, convite: r.convidar ? await convidar('equipe', r.id, d.email) : null }
    },
    ajustarDia: (dia, tipo, nome) => rpc('cond_ajustar_dia', { p_dia: dia, p_tipo: tipo, p_nome: nome ?? null }),
    auditoria: async () => (await rpc<{ itens: Auditoria[] }>('cond_lista_auditoria')).itens,
    modelos: async () => (await rpc<{ itens: Modelo[] }>('cond_lista_modelos')).itens,
    salvarModelo: (id, m) => rpc('cond_salvar_modelo', { p_id: id, p_nome: m.nome, p_assunto: m.assunto, p_corpo: m.corpo }),
    apagarModelo: async (id) => {
      await rpc('cond_apagar_modelo', { p_id: id })
    },
    envios: async () => (await rpc<{ itens: Envio[] }>('cond_lista_envios')).itens,
    criarEnvio: async (e) => {
      const r = await rpc<{ id: string; destinatarios: number }>('cond_criar_envio', {
        p_assunto: e.assunto,
        p_corpo: e.corpo,
        p_destino: e.destino,
        p_quando: e.quando,
        p_recorrencia: e.recorrencia,
      })
      // "Agora": já chama o envio (sem esperar o agendador de 5 em 5 minutos). Falhar aqui não perde nada.
      if (!e.quando) void sb.functions.invoke('enviar-noticias', { body: {} })
      return r
    },
    cancelarEnvio: async (id) => {
      await rpc('cond_cancelar_envio', { p_id: id })
    },
    listaAvisos: async () => (await rpc<{ itens: Aviso[] }>('cond_lista_avisos')).itens,
    salvarAviso: (id, a) => rpc('cond_salvar_aviso', { p_id: id, p: a }),
    apagarAviso: async (id) => {
      await rpc('cond_apagar_aviso', { p_id: id })
    },
  }
}
