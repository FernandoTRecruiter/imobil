/* =============================================================================
   A porta única entre as telas e os dados. As telas só chamam "api.xxx".
   - Sem VITE_SUPABASE_URL no .env: modo DEMONSTRAÇÃO (dados fictícios no navegador, para mostrar
     a quem quiser ver e para desenvolver sem internet).
   - Com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY: o banco de verdade.
   Erro sempre chega como Error com o CÓDIGO na mensagem (ex.: 'ocupado'); regras.ts/mensagem()
   transforma o código em frase.
   ============================================================================= */
import { useEffect, useState } from 'react'
import type { ServicoDef } from '../config'
import type {
  Auditoria,
  Aviso,
  Credencial,
  DadosAviso,
  DadosFuncionario,
  DadosMorador,
  DiaEspecial,
  Envio,
  Funcionario,
  HistoricoMorador,
  LinkSenha,
  MembroEquipe,
  Modelo,
  Morador,
  NovoEnvio,
  Ocupado,
  Pedido,
  ResultadoCadastro,
  Solicitacao,
  Status,
} from '../tipos'
import { criarDemo } from './demo'
import { criarSupabase } from './supabase'

export interface Mudanca {
  status?: Status
  nota?: string
  pago?: boolean
}

export interface Api {
  modo: 'demo' | 'supabase'
  regras(): Promise<ServicoDef[]>
  /** Feriados, pontos facultativos e emendas do período (público). */
  feriados(de: string, ate: string): Promise<DiaEspecial[]>

  // ---------------------------------------------------------------- morador
  /** Entrar com apartamento + código. */
  entrar(apto: string, codigo: string): Promise<{ nome: string; apto: string }>
  /** Entrar com e-mail e senha (a senha foi criada pelo link do convite). */
  entrarEmail(email: string, senha: string): Promise<Credencial>
  /** Sessão por e-mail ainda aberta neste aparelho (nulo = precisa entrar). */
  sessaoMorador(): Promise<Credencial | null>
  sairMorador(): Promise<void>
  /** Manda o link de trocar a senha (sempre responde igual, para não revelar quem mora ali). */
  esqueciSenha(email: string): Promise<void>
  /** Cria ou troca a senha pelo link do e-mail. Devolve para onde ir: morador ou equipe. */
  definirSenha(link: LinkSenha, senha: string): Promise<'morador' | 'equipe'>
  minhas(c: Credencial, tokens: string[]): Promise<Solicitacao[]>
  ocupacao(c: Credencial, de: string, ate: string): Promise<Ocupado[]>
  solicitar(c: Credencial, p: Pedido): Promise<{ id: string; protocolo: number; token: string | null }>
  cancelar(c: Credencial, id: string): Promise<void>
  /** Avisos e perguntas frequentes publicados (aba Notificações). */
  avisos(c: Credencial): Promise<Aviso[]>

  // ---------------------------------------------------------------- equipe
  equipeAtual(): Promise<MembroEquipe | null>
  entrarEquipe(email: string, senha: string): Promise<MembroEquipe>
  sairEquipe(): Promise<void>
  /** Sem período: de 90 dias atrás em diante. */
  painel(de?: string, ate?: string): Promise<{ itens: Solicitacao[] }>
  atualizar(id: string, m: Mudanca): Promise<void>
  moradores(): Promise<Morador[]>
  criarMorador(d: DadosMorador): Promise<ResultadoCadastro>
  editarMorador(id: string, d: DadosMorador): Promise<{ canceladas: number; convite: ResultadoCadastro['convite'] }>
  novoCodigo(id: string): Promise<{ codigo: string }>
  reenviarConvite(tipo: 'morador' | 'equipe', id: string): Promise<NonNullable<ResultadoCadastro['convite']>>
  historicoMorador(id: string): Promise<HistoricoMorador>
  funcionarios(): Promise<Funcionario[]>
  salvarFuncionario(id: string | null, d: DadosFuncionario): Promise<{ id: string; convite: ResultadoCadastro['convite'] }>
  /** tipo nulo = volta ao cálculo automático. Devolve quantas reservas já existem no dia. */
  ajustarDia(dia: string, tipo: 'feriado' | 'facultativo' | 'normal' | null, nome?: string): Promise<{ reservas_no_dia: number }>
  auditoria(): Promise<Auditoria[]>
  modelos(): Promise<Modelo[]>
  salvarModelo(id: string | null, m: Omit<Modelo, 'id'>): Promise<{ id: string }>
  apagarModelo(id: string): Promise<void>
  envios(): Promise<Envio[]>
  criarEnvio(e: NovoEnvio): Promise<{ id: string; destinatarios: number }>
  cancelarEnvio(id: string): Promise<void>
  listaAvisos(): Promise<Aviso[]>
  salvarAviso(id: string | null, a: DadosAviso): Promise<{ id: string }>
  apagarAviso(id: string): Promise<void>
}

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const chave = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export const api: Api = url && chave ? criarSupabase(url, chave) : criarDemo()

/* As regras dos serviços mudam raramente: lidas uma vez por abertura do app e guardadas aqui. */
let regrasCache: Promise<ServicoDef[]> | null = null

/** Regras dos serviços para as telas (nulo enquanto carrega; erro = sem internet). "servicos" = só os ligados. */
export function useRegras(): { servicos: ServicoDef[] | null; erro: boolean } {
  const [estado, setEstado] = useState<{ todos: ServicoDef[] | null; erro: boolean }>({ todos: null, erro: false })
  useEffect(() => {
    let vivo = true
    regrasCache ??= api.regras()
    regrasCache
      .then((s) => vivo && setEstado({ todos: s, erro: false }))
      .catch(() => {
        regrasCache = null // tenta de novo na próxima abertura
        if (vivo) setEstado({ todos: null, erro: true })
      })
    return () => {
      vivo = false
    }
  }, [])
  return { servicos: estado.todos?.filter((s) => s.ativo) ?? null, erro: estado.erro }
}

/** Algum serviço ligado cobra? Sem isso, tudo de pagamento some da tela. */
export const algumCobra = (servicos: ServicoDef[]) => servicos.some((s) => s.ativo && 'cobra' in s.config && s.config.cobra)
