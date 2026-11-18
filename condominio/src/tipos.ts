/* O formato dos dados que o app troca com o banco (o mesmo nos dois modos: demonstração e Supabase).
   Hora: texto 'AAAA-MM-DDTHH:mm' no relógio do condomínio (sem fuso), igual ao que o banco devolve. */
import type { Servico } from './config'

export type Status = 'aberta' | 'em_analise' | 'confirmada' | 'concluida' | 'recusada' | 'cancelada'

/** O que cada pessoa da equipe pode fazer (marcado pelo síndico em Pessoas > Funcionários). */
export type Permissao = 'reservas' | 'moradores' | 'denuncias' | 'noticias' | 'admin'

export interface Passo {
  status: Status
  nota: string | null
  por_papel: string // 'morador' ou o cargo de quem respondeu (ex.: 'Síndico')
  por_nome?: string | null // só a equipe recebe
  em: string // ISO com fuso (momento da gravação)
}

export interface Detalhes {
  obs?: string
  // estacionamento
  placa?: string
  veiculo?: string
  para?: string
  ate?: string // 'AAAA-MM-DD' (só no envio)
  // denúncia
  categoria?: string
  local?: string
  quando?: string
  descricao?: string
}

export interface Solicitacao {
  id: string
  protocolo: number
  servico: Servico
  apto: string | null // nulo = denúncia anônima
  inicio: string | null
  fim: string | null
  status: Status
  pago: boolean | null // só nos serviços que cobram
  detalhes: Detalhes
  anonima: boolean
  criado_em: string
  historico: Passo[]
  morador?: string | null // nome; só a equipe recebe
}

/** Horário ocupado visto pelo morador: sem dono, só "é meu" ou não. */
export interface Ocupado {
  servico: Servico
  inicio: string
  fim: string
  minha: boolean
}

export interface Morador {
  id: string
  nome: string
  apto: string
  telefone: string | null
  email: string | null
  cpf: string | null // só números
  vaga: string | null // vaga de garagem (nulo = não tem)
  desde: string | null // 'AAAA-MM-DD'
  ativo: boolean
  criado_em: string
  // informações de acesso
  tem_codigo: boolean
  codigo_gerado_em: string | null
  convite_enviado_em: string | null
  ultimo_acesso: string | null
  senha_criada: boolean
  ultimo_login: string | null
}

/** O que a portaria preenche no cadastro. */
export interface DadosMorador {
  nome: string
  apto: string
  telefone: string
  email: string
  cpf: string
  vaga: string
  desde: string
  ativo: boolean
  /** Gerar código mesmo tendo e-mail (para quem prefere não usar e-mail). */
  gerar_codigo?: boolean
}

/** O que o celular do morador guarda depois de entrar. Com código: apto + código. Com e-mail: a sessão. */
export interface Credencial {
  nome: string
  apto: string
  codigo?: string
  email?: string
}

export interface MembroEquipe {
  nome: string
  cargo: string
  permissoes: Permissao[]
}

export interface Funcionario extends MembroEquipe {
  id: string
  email: string
  ativo: boolean
  convite_enviado_em: string | null
  criado_em: string
  ultimo_login: string | null
}

export interface DadosFuncionario {
  nome: string
  email: string
  cargo: string
  permissoes: Permissao[]
  ativo: boolean
}

/** Resultado de um cadastro: o código (uma vez só) e/ou o convite por e-mail. */
export interface ResultadoCadastro {
  id: string
  codigo: string | null
  convite: { email: string; erro?: string; linkDemo?: string } | null
}

export interface Pedido {
  servico: Servico
  inicio: string | null // reserva: início do horário; estacionamento: 'AAAA-MM-DDT00:00' do primeiro dia
  detalhes: Detalhes
  anonima?: boolean
}

/** Feriado, ponto facultativo ou emenda (calculados pelo banco; o síndico pode ajustar). */
export interface DiaEspecial {
  dia: string // 'AAAA-MM-DD'
  tipo: 'feriado' | 'facultativo'
  nome: string
  origem: 'nacional' | 'local' | 'emenda' | 'ajuste'
}

/** Linha da auditoria da equipe. */
export interface Auditoria {
  acao: string
  alvo: string | null
  detalhe: string | null
  por_papel: string | null
  por_nome: string | null
  em: string
}

export interface HistoricoMorador {
  solicitacoes: Solicitacao[]
  auditoria: Auditoria[]
}

/** Modelo de e-mail (texto com {{nome}}, {{apto}} e {{condominio}}). */
export interface Modelo {
  id: string
  nome: string
  assunto: string
  corpo: string
}

export type Recorrencia = 'diaria' | 'semanal' | 'mensal'

export interface Envio {
  id: string
  assunto: string
  corpo: string
  destino: { todos?: boolean; ids?: string[] }
  quando: string // ISO: o próximo envio (ou quando foi, se já saiu)
  recorrencia: Recorrencia | null
  ativo: boolean
  cancelado: boolean
  ultimo_envio: string | null
  total_enviados: number
  criado_por: string | null
  criado_em: string
  destinatarios: number
  falhas: number
}

export interface NovoEnvio {
  assunto: string
  corpo: string
  destino: { todos?: boolean; ids?: string[] }
  quando: string | null // ISO; nulo = agora
  recorrencia: Recorrencia | null
}

/** Aviso ou pergunta frequente da aba Notificações do morador. */
export interface Aviso {
  id: string
  tipo: 'aviso' | 'faq'
  titulo: string
  texto: string
  fixado: boolean
  publicado: boolean
  ordem: number
  atualizado_em: string
  atualizado_por?: string | null
}

export type DadosAviso = Pick<Aviso, 'tipo' | 'titulo' | 'texto' | 'fixado' | 'publicado' | 'ordem'>

/** Link do e-mail de convite ou de troca de senha (ou o atalho da demonstração). */
export type LinkSenha = { token_hash: string; tipo: 'invite' | 'recovery' } | { demo: string }
