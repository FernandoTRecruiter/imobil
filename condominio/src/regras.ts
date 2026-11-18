/* =============================================================================
   Regras puras (sem tela e sem banco): datas, horários de cada serviço, nomes das situações,
   o que a equipe pode fazer em cada situação e as mensagens de erro.
   O banco (supabase/schema.sql) confere as mesmas regras na hora de gravar; aqui elas servem para
   a tela mostrar o certo antes de enviar e para o modo demonstração.
   ============================================================================= */
import type { ConfigServico, Servico, ServicoDef } from './config'
import type { DiaEspecial, Solicitacao, Status } from './tipos'

/* ------------------------------------------------------------------ datas */

const dois = (n: number) => String(n).padStart(2, '0')

/** "Agora" no relógio do aparelho, no formato do app ('AAAA-MM-DDTHH:mm'). */
export function agoraLocal(d = new Date()): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`
}

export const diaDe = (dt: string) => dt.slice(0, 10)
export const horaDe = (dt: string) => dt.slice(11, 16)

/** Soma dias a 'AAAA-MM-DD' (meio-dia em UTC para o horário de verão nunca pular um dia). */
export function somaDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = domingo ... 6 = sábado. */
export function diaDaSemana(dia: string): number {
  return new Date(`${dia}T12:00:00Z`).getUTCDay()
}

/** Segunda-feira da semana do dia (a semana do limite "por semana" vai de segunda a domingo). */
export function segundaDa(dia: string): string {
  return somaDias(dia, -((diaDaSemana(dia) + 6) % 7))
}

export function diferencaDias(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000)
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** 'qua 18/11' */
export function diaCurto(dia: string): string {
  return `${SEMANA[diaDaSemana(dia)]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}

/** 'Novembro 2026' */
export function mesTitulo(dia: string): string {
  const m = MESES[Number(dia.slice(5, 7)) - 1]
  return `${m[0].toUpperCase()}${m.slice(1)} ${dia.slice(0, 4)}`
}

/** Data e hora de um momento ISO com fuso (ex.: histórico): '18/11 14:05'. */
export function momento(iso: string): string {
  const l = agoraLocal(new Date(iso))
  return `${l.slice(8, 10)}/${l.slice(5, 7)} ${l.slice(11, 16)}`
}

/** Primeiro dia do mês e as 6 semanas (42 dias, começando no domingo) que a grade do mês mostra. */
export function gradeDoMes(dia: string): string[] {
  const primeiro = `${dia.slice(0, 7)}-01`
  const inicio = somaDias(primeiro, -diaDaSemana(primeiro))
  return Array.from({ length: 42 }, (_, i) => somaDias(inicio, i))
}

export function somaMeses(dia: string, n: number): string {
  const [a, m] = dia.split('-').map(Number)
  const total = a * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${dois((total % 12) + 1)}-01`
}

/* ------------------------------------------------------------------ horários dos serviços */

export interface Horario {
  inicio: string // 'AAAA-MM-DDTHH:mm'
  fim: string
  rotulo: string
}

const minutosDe = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const hhmm = (min: number) => `${dois(Math.floor(min / 60))}:${dois(min % 60)}`

/** O dia é feriado ou ponto facultativo? (a lista vem do banco ou de feriados.ts) */
export const especialDo = (dia: string, especiais: DiaEspecial[]) => especiais.find((e) => e.dia === dia)

/**
 * Os horários reserváveis de um serviço num dia. Igual a cond_periodos no banco (o teste confere).
 * "especiais" = feriados do período: o serviço que fecha em feriado não tem horário nesse dia.
 */
export function periodosDoDia(cfg: ConfigServico, dia: string, especiais: DiaEspecial[] = []): Horario[] {
  if (cfg.tipo !== 'horario' && cfg.tipo !== 'periodo') return []
  if (!cfg.dias.includes(diaDaSemana(dia))) return []
  const esp = especialDo(dia, especiais)
  if (esp && cfg[esp.tipo] === 'fecha') return []
  if (cfg.tipo === 'periodo') {
    return cfg.periodos.map((p) => ({ inicio: `${dia}T${p.de}`, fim: `${dia}T${p.ate}`, rotulo: p.rotulo }))
  }
  const lista: Horario[] = []
  for (let t = minutosDe(cfg.abre); t + cfg.minutos <= minutosDe(cfg.fecha); t += cfg.minutos) {
    lista.push({ inicio: `${dia}T${hhmm(t)}`, fim: `${dia}T${hhmm(t + cfg.minutos)}`, rotulo: hhmm(t) })
  }
  return lista
}

/** Os dias em que dá para reservar a partir de hoje (dentro do horizonte, só nos dias abertos e sem feriado que feche). */
export function diasReservaveis(cfg: ConfigServico, hoje: string, especiais: DiaEspecial[] = []): string[] {
  if (cfg.tipo !== 'horario' && cfg.tipo !== 'periodo') return []
  return Array.from({ length: cfg.horizonte + 1 }, (_, i) => somaDias(hoje, i)).filter((d) => periodosDoDia(cfg, d, especiais).length > 0)
}

/** Nome do serviço pela chave (as regras vêm do banco ou do config.ts). */
export function nomeServico(chave: Servico, servicos: ServicoDef[]): string {
  return servicos.find((s) => s.chave === chave)?.nome ?? chave
}

/** "qua 18/11 · 14:00 às 15:00", "qua 18/11 · Tarde (13:00 às 17:00)", "18/11 a 20/11" ou "enviada 18/11 14:05". */
export function descreverQuando(s: Pick<Solicitacao, 'servico' | 'inicio' | 'fim' | 'criado_em'>, servicos: ServicoDef[]): string {
  if (s.servico === 'denuncia' || !s.inicio || !s.fim) return `enviada ${momento(s.criado_em)}`
  const dia = diaDe(s.inicio)
  if (s.servico === 'estacionamento') {
    const ultimo = somaDias(diaDe(s.fim), -1)
    return ultimo <= dia ? diaCurto(dia) : `${diaCurto(dia)} a ${diaCurto(ultimo)}`
  }
  const faixa = `${horaDe(s.inicio)} às ${horaDe(s.fim)}`
  if (s.servico === 'diaria') {
    const cfg = servicos.find((x) => x.chave === 'diaria')?.config
    const per = cfg ? periodosDoDia(cfg, dia).find((h) => h.inicio === s.inicio) : undefined
    return `${diaCurto(dia)} · ${per?.rotulo ?? faixa}${per ? ` (${faixa})` : ''}`
  }
  return `${diaCurto(dia)} · ${faixa}`
}

/** A solicitação acontece neste dia? (estacionamento ocupa do primeiro ao último dia; denúncia, o dia em que chegou) */
export function noDia(s: Pick<Solicitacao, 'servico' | 'inicio' | 'fim' | 'criado_em'>, dia: string): boolean {
  if (!s.inicio || !s.fim) return diaDe(agoraLocal(new Date(s.criado_em))) === dia
  if (s.servico === 'estacionamento') return dia >= diaDe(s.inicio) && dia < diaDe(s.fim)
  return diaDe(s.inicio) === dia
}

/* ------------------------------------------------------------------ placa */

export const normalizarPlaca = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '')
/** Placa antiga (ABC1234) ou Mercosul (ABC1D23). */
export const placaValida = (p: string) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(normalizarPlaca(p))

/* ------------------------------------------------------------------ situações */

/** Reserva confirmada cujo horário já acabou aparece como concluída (sem precisar de ninguém clicar). */
export function statusEfetivo(s: Pick<Solicitacao, 'status' | 'fim'>, agora: string): Status {
  if (s.status === 'confirmada' && s.fim && s.fim <= agora) return 'concluida'
  return s.status
}

const ROTULOS: Record<Status, string> = {
  aberta: 'Aberta',
  em_analise: 'Em análise',
  confirmada: 'Confirmada',
  concluida: 'Concluída',
  recusada: 'Recusada',
  cancelada: 'Cancelada',
}
const ROTULOS_POR_SERVICO: Partial<Record<Servico, Partial<Record<Status, string>>>> = {
  estacionamento: { aberta: 'Aguardando portaria', confirmada: 'Liberado' },
  denuncia: { aberta: 'Recebida', concluida: 'Resolvida', recusada: 'Arquivada' },
}

export function rotuloStatus(servico: Servico, status: Status): string {
  return ROTULOS_POR_SERVICO[servico]?.[status] ?? ROTULOS[status]
}

/** Tom do selo: 'espera' (falta alguém agir), 'ok', 'fim' (encerrada sem problema), 'nao' (recusada/cancelada). */
export function tomStatus(status: Status): 'espera' | 'ok' | 'fim' | 'nao' {
  if (status === 'aberta' || status === 'em_analise') return 'espera'
  if (status === 'confirmada') return 'ok'
  if (status === 'concluida') return 'fim'
  return 'nao'
}

export interface Passagem {
  para: Status
  rotulo: string
  exigeNota: boolean
}

/**
 * O que a equipe pode fazer em cada situação. É a mesma tabela de cond_atualizar no banco.
 * Denúncia: resolver ou arquivar exige resposta (é o que quem denunciou vai ler).
 */
export function passagens(servico: Servico, status: Status): Passagem[] {
  const p = (para: Status, rotulo: string, exigeNota = false): Passagem => ({ para, rotulo, exigeNota })
  if ((servico === 'lavagem' || servico === 'diaria') && status === 'confirmada') return [p('cancelada', 'Cancelar reserva')]
  if (servico === 'estacionamento' && status === 'aberta') return [p('confirmada', 'Liberar vaga'), p('recusada', 'Recusar')]
  if (servico === 'estacionamento' && status === 'confirmada') return [p('concluida', 'Encerrar'), p('cancelada', 'Cancelar')]
  if (servico === 'denuncia' && status === 'aberta') {
    return [p('em_analise', 'Começar análise'), p('concluida', 'Resolver', true), p('recusada', 'Arquivar', true)]
  }
  if (servico === 'denuncia' && status === 'em_analise') return [p('concluida', 'Resolver', true), p('recusada', 'Arquivar', true)]
  return []
}

/** O morador pode cancelar? (mesma regra de cond_cancelar) */
export function moradorCancela(s: Solicitacao, agora: string): boolean {
  if (s.anonima) return false
  if (s.status !== 'aberta' && s.status !== 'confirmada') return false
  if ((s.servico === 'lavagem' || s.servico === 'diaria') && s.inicio && s.inicio <= agora) return false
  if (s.servico === 'estacionamento' && s.fim && s.fim <= agora) return false
  return true
}

/** Pagamento pendente: diária ou estacionamento ainda não pago e não cancelado/recusado. */
export function pagamentoPendente(s: Solicitacao): boolean {
  return s.pago === false && s.status !== 'cancelada' && s.status !== 'recusada'
}

/* ------------------------------------------------------------------ mensagens */

/** Código de erro do banco (ou do modo demonstração) em frase para a pessoa. */
export const MENSAGENS: Record<string, string> = {
  codigo_invalido: 'Apartamento ou código não confere. Confira com a portaria.',
  bloqueado: 'Muitas tentativas erradas neste apartamento. Tente de novo em 15 minutos.',
  ocupado: 'Esse horário acabou de ser reservado por outro apartamento. Escolha outro.',
  horario_invalido: 'Esse horário não está na grade do serviço.',
  horario_passou: 'Esse horário já passou.',
  fora_do_horizonte: 'Ainda não abriu a reserva para esse dia.',
  limite_semana: 'Seu apartamento já chegou ao limite de reservas desse serviço nesta semana.',
  data_invalida: 'Confira as datas: a entrada não pode ser no passado e a saída vem depois da entrada.',
  placa_invalida: 'Placa no formato ABC1234 ou ABC1D23.',
  categoria_invalida: 'Escolha o tipo da denúncia.',
  descricao_curta: 'Conte o que aconteceu em pelo menos 10 letras.',
  nao_cancela: 'Essa solicitação não pode mais ser cancelada.',
  nao_encontrada: 'Solicitação não encontrada.',
  passagem_invalida: 'Essa mudança não vale para a situação atual. Recarregue a página.',
  resposta_obrigatoria: 'Escreva a resposta: é o que quem denunciou vai ler.',
  sem_permissao: 'Seu usuário não tem acesso a isso.',
  dados_invalidos: 'Confira nome (2 letras ou mais) e apartamento (letras, números e hífen).',
  servico_invalido: 'Serviço desconhecido.',
  periodo_invalido: 'Período inválido.',
  dia_fechado: 'Esse serviço não funciona neste dia (feriado).',
  login_invalido: 'E-mail ou senha não conferem.',
  sem_cadastro: 'Este e-mail não está cadastrado como morador. Confira com a portaria.',
  servico_inativo: 'Este serviço não está disponível no momento.',
  cpf_invalido: 'CPF não confere. Confira os números.',
  email_invalido: 'E-mail mal escrito. Confira.',
  email_repetido: 'Este e-mail já está em outro cadastro.',
  sem_forma_de_acesso: 'Sem e-mail e sem código a pessoa não consegue entrar. Gere um código ou informe o e-mail.',
  ultimo_admin: 'Pelo menos uma pessoa precisa continuar com a permissão de administrar.',
  link_vencido: 'Este link venceu ou já foi usado. Peça um novo (Esqueci a senha, ou à portaria).',
  link_invalido: 'Link inválido.',
  senha_fraca: 'Senha fraca: use pelo menos 8 caracteres.',
  sem_destinatarios: 'Nenhum destinatário com e-mail. Cadastre o e-mail dos moradores.',
  data_passada: 'A data do envio já passou.',
  falha_email: 'O cadastro foi salvo, mas o e-mail não saiu. Use Reenviar convite.',
}

export function mensagem(erro: unknown): string {
  const codigo = erro instanceof Error ? erro.message : String(erro)
  return MENSAGENS[codigo] ?? 'Não deu certo agora. Confira a internet e tente de novo.'
}

/* ------------------------------------------------------------------ busca */

/** Busca sem acento e com vários termos: todos precisam aparecer no texto. */
export function bate(texto: string, busca: string): boolean {
  const limpa = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const alvo = limpa(texto)
  return limpa(busca).split(/\s+/).filter(Boolean).every((t) => alvo.includes(t))
}

/* ------------------------------------------------------------------ CPF */

/** Os dois dígitos verificadores de um CPF a partir dos 9 primeiros (o mesmo cálculo de cond_cpf_valido). */
export function cpfDigitos(base9: string): string {
  const d = base9.split('').map(Number)
  const dv = (n: number) => {
    const s = d.slice(0, n).reduce((acc, x, i) => acc + x * (n + 1 - i), 0)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  d.push(dv(9))
  d.push(dv(10))
  return d.slice(9).join('')
}

/** CPF válido: 11 números, não todos iguais, dígitos verificadores certos. Aceita com ponto e traço. */
export function cpfValido(cpf: string): boolean {
  const n = cpf.replace(/\D/g, '')
  return /^\d{11}$/.test(n) && !/^(\d)\1{10}$/.test(n) && cpfDigitos(n.slice(0, 9)) === n.slice(9)
}

/** 52998224725 -> 529.982.247-25 */
export const formatarCpf = (cpf: string) => cpf.replace(/\D/g, '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')

/** Na tabela o CPF aparece mascarado (dado pessoal): ***.982.247-** */
export const mascararCpf = (cpf: string) => formatarCpf(cpf).replace(/^\d{3}/, '***').replace(/\d{2}$/, '**')

/* ------------------------------------------------------------------ estatísticas de moradores (Pessoas) */

export interface Estatisticas {
  ativos: number
  comEmail: number
  soCodigo: number
  comVaga: number
  /** Meses de moradia, na média dos ativos (desde quando mora; sem a data, desde o cadastro). */
  estadiaMediaMeses: number
  /** Pedidos (reservas e denúncias identificadas) nos últimos 90 dias, por morador ativo. */
  pedidosPorMorador: number
  /** Quantas lavagens começaram em cada hora (mais pedida primeiro). */
  horasLavagem: { rotulo: string; n: number }[]
  /** Diárias por período (manhã, tarde). */
  periodosDiaria: { rotulo: string; n: number }[]
}

export function estatisticas(
  moradores: { ativo: boolean; email: string | null; tem_codigo: boolean; vaga: string | null; desde: string | null; criado_em: string }[],
  itens: Solicitacao[],
  agora: string,
): Estatisticas {
  const ativos = moradores.filter((m) => m.ativo)
  const hoje = diaDe(agora)
  const meses = ativos.map((m) => diferencaDias(m.desde ?? diaDe(agoraLocal(new Date(m.criado_em))), hoje) / 30.44)
  const desde90 = somaDias(hoje, -90)
  const recentes = itens.filter((s) => s.apto && s.status !== 'cancelada' && diaDe(s.inicio ?? agoraLocal(new Date(s.criado_em))) >= desde90)
  const conta = (lista: string[]) => {
    const m = new Map<string, number>()
    for (const x of lista) m.set(x, (m.get(x) ?? 0) + 1)
    return [...m.entries()].map(([rotulo, n]) => ({ rotulo, n })).sort((a, b) => b.n - a.n || a.rotulo.localeCompare(b.rotulo))
  }
  return {
    ativos: ativos.length,
    comEmail: ativos.filter((m) => m.email).length,
    soCodigo: ativos.filter((m) => !m.email).length,
    comVaga: ativos.filter((m) => m.vaga).length,
    estadiaMediaMeses: meses.length ? meses.reduce((a, b) => a + b, 0) / meses.length : 0,
    pedidosPorMorador: ativos.length ? recentes.length / ativos.length : 0,
    horasLavagem: conta(itens.filter((s) => s.servico === 'lavagem' && s.inicio && s.status !== 'cancelada').map((s) => `${s.inicio!.slice(11, 13)}h`)),
    periodosDiaria: conta(itens.filter((s) => s.servico === 'diaria' && s.inicio && s.status !== 'cancelada').map((s) => (s.inicio!.slice(11, 13) < '12' ? 'Manhã' : 'Tarde'))),
  }
}
