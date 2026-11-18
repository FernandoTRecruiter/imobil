/* =============================================================================
   Modo demonstração: o mesmo contrato da Api, com dados fictícios guardados no navegador
   (localStorage 'condominio:demo:v3'). Serve para mostrar o sistema sem banco e para desenvolver.
   As regras são as mesmas do banco (supabase/schema.sql); o teste tests/demo.test.ts confere os
   casos principais nos dois lados.
   - As datas da semente são relativas a HOJE, para a demonstração nunca ficar "velha".
   - E-mail de verdade não sai daqui: convite e notícias ficam registrados como "enviados", e o
     convite ganha um link de demonstração que abre a tela de criar a senha.
   - "Restaurar" (tela de entrada) volta tudo ao original.
   ============================================================================= */
import { FERIADOS_LOCAIS_PADRAO, SERVICOS_PADRAO, type ServicoDef } from '../config'
import { diasEspeciais, type Ajuste } from '../feriados'
import { agoraLocal, cpfDigitos, cpfValido, diaDe, diferencaDias, normalizarPlaca, passagens, periodosDoDia, placaValida, segundaDa, somaDias } from '../regras'
import type {
  Auditoria,
  Aviso,
  Credencial,
  DadosMorador,
  Envio,
  Funcionario,
  MembroEquipe,
  Modelo,
  Morador,
  Passo,
  Permissao,
  ResultadoCadastro,
  Solicitacao,
  Status,
} from '../tipos'
import type { Api } from './api'

const CHAVE = 'condominio:demo:v3' // v3 (17/11): e-mail, funcionários com permissões, notícias, avisos
const CHAVE_EQUIPE = 'condominio:demo:equipe'
const CHAVE_MORADOR = 'condominio:demo:sessao-morador'

interface MoradorDemo extends Morador {
  codigo: string | null
  senha: string | null
}
interface FuncionarioDemo extends Funcionario {
  senha: string | null
}
interface SolicitacaoDemo extends Solicitacao {
  morador_id: string | null
  token: string | null
}
interface Banco {
  moradores: MoradorDemo[]
  equipe: FuncionarioDemo[]
  solicitacoes: SolicitacaoDemo[]
  tentativas: Record<string, { falhas: number; bloqueado_ate: number | null }>
  seq: number
  ajustes: Ajuste[]
  auditoria: (Auditoria & { alvo_id: string | null })[]
  modelos: Modelo[]
  envios: Envio[]
  avisos: Aviso[]
}

/** Moradores da demonstração (fictícios). A tela de entrada mostra como entrar com cada um. */
export const MORADORES_DEMO: { nome: string; apto: string; codigo: string | null; email: string | null; senha: string | null; telefone: string | null; vaga: string | null; desdeAnos: number }[] = [
  { nome: 'Luíza Prado', apto: '101', codigo: 'LUZ101', email: 'luiza@exemplo.com', senha: 'morador1', telefone: '(31) 99812-4410', vaga: 'G-01', desdeAnos: 4 },
  { nome: 'Marcos Teixeira', apto: '102', codigo: 'MRC102', email: null, senha: null, telefone: null, vaga: null, desdeAnos: 9 },
  { nome: 'Tiago Nunes', apto: '202', codigo: null, email: 'tiago@exemplo.com', senha: 'morador1', telefone: '(31) 99733-0912', vaga: 'G-07', desdeAnos: 1 },
  { nome: 'Beatriz Lima', apto: '203', codigo: null, email: 'beatriz@exemplo.com', senha: null, telefone: null, vaga: null, desdeAnos: 0 },
  { nome: 'Sônia Barros', apto: '303', codigo: 'SNB303', email: null, senha: null, telefone: '(31) 98854-2201', vaga: 'G-12', desdeAnos: 15 },
  { nome: 'Henrique Sales', apto: '401', codigo: null, email: 'henrique@exemplo.com', senha: 'morador1', telefone: null, vaga: 'G-15', desdeAnos: 3 },
  { nome: 'Camila Rocha', apto: '502', codigo: null, email: 'camila@exemplo.com', senha: 'morador1', telefone: '(31) 99901-7745', vaga: null, desdeAnos: 2 },
  { nome: 'Otávio Mendes', apto: '604', codigo: 'TVM604', email: null, senha: null, telefone: null, vaga: 'G-20', desdeAnos: 6 },
]

/** Funcionários da demonstração. Os botões "Entrar como" da tela da equipe usam estes e-mails. */
const TODAS: Permissao[] = ['reservas', 'moradores', 'denuncias', 'noticias', 'admin']
const EQUIPE_DEMO: { email: string; nome: string; cargo: string; permissoes: Permissao[] }[] = [
  { email: 'portaria@demo', nome: 'Jorge', cargo: 'Portaria', permissoes: ['reservas', 'moradores', 'noticias'] },
  { email: 'sindico@demo', nome: 'Helena Castro', cargo: 'Síndico', permissoes: TODAS },
  { email: 'zeladoria@demo', nome: 'Rita Campos', cargo: 'Zeladoria', permissoes: ['reservas'] },
]

/** Modelos de e-mail e perguntas frequentes de partida (os mesmos do schema.sql). */
const MODELOS_PADRAO: Omit<Modelo, 'id'>[] = [
  {
    nome: 'Aviso de denúncia',
    assunto: 'Aviso da administração',
    corpo:
      'Olá, {{nome}}.\n\nA administração recebeu relatos sobre uma situação envolvendo o apartamento {{apto}}: [descreva o ocorrido, sem citar quem relatou].\n\nPedimos a sua atenção às regras do condomínio para que a convivência siga boa para todos. Se quiser conversar sobre o assunto, procure a administração.\n\nAtenciosamente,\nAdministração do {{condominio}}',
  },
  {
    nome: 'Encomenda na portaria',
    assunto: 'Sua encomenda está na portaria',
    corpo: 'Olá, {{nome}}.\n\nHá uma encomenda para o apartamento {{apto}} aguardando na portaria há alguns dias. Por favor, retire assim que puder.\n\nObrigado,\nPortaria do {{condominio}}',
  },
]
const FAQ_PADRAO: [string, string][] = [
  ['Como reservo a lavanderia?', 'Em Solicitar, escolha Lavagem e secagem, o dia e um horário livre. Cada horário tem 1 hora e cada apartamento pode reservar até 3 vezes por semana.'],
  ['Posso cancelar uma reserva?', 'Sim, até o horário começar: em Solicitar, abra a reserva em Acompanhar e toque em Cancelar.'],
  ['A denúncia anônima é mesmo anônima?', 'É. O sistema não grava o seu apartamento nem o seu nome. Só o seu celular consegue acompanhar a resposta do síndico.'],
  ['Esqueci o código ou a senha', 'Código: peça um novo na portaria. Senha: na tela de entrada, toque em Esqueci a senha e siga o link que chega no seu e-mail.'],
]

/* ------------------------------------------------------------------ guardar e ler */

function ler(): Banco {
  try {
    const bruto = localStorage.getItem(CHAVE)
    if (bruto) return JSON.parse(bruto) as Banco
  } catch {
    // navegador sem localStorage (janela privada) ou dado corrompido: recomeça da semente
  }
  const b = semente()
  gravar(b)
  return b
}

function gravar(b: Banco) {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(b))
  } catch {
    // sem localStorage a demonstração funciona, só não lembra depois de recarregar
  }
}

function lerSessao(chave: string): string | null {
  try {
    return localStorage.getItem(chave)
  } catch {
    return null
  }
}
function gravarSessao(chave: string, valor: string | null) {
  try {
    if (valor) localStorage.setItem(chave, valor)
    else localStorage.removeItem(chave)
  } catch {
    /* sem localStorage: vale só nesta tela */
  }
}

export function restaurarDemo() {
  for (const k of [CHAVE, CHAVE_EQUIPE, CHAVE_MORADOR, 'condominio:tokens']) gravarSessao(k, null)
}

/* ------------------------------------------------------------------ semente */

function semente(): Banco {
  const hoje = diaDe(agoraLocal())
  const d = (n: number) => somaDias(hoje, n)
  const atras = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString()
  const moradores: MoradorDemo[] = MORADORES_DEMO.map((m, i) => {
    const base = String(123456780 + i * 111111).slice(0, 9)
    return {
      id: `m${i + 1}`,
      nome: m.nome,
      apto: m.apto,
      telefone: m.telefone,
      email: m.email,
      cpf: i % 3 === 2 ? null : base + cpfDigitos(base),
      vaga: m.vaga,
      desde: m.desdeAnos ? `${Number(hoje.slice(0, 4)) - m.desdeAnos}${hoje.slice(4, 8)}01` : null,
      ativo: true,
      criado_em: atras(24 * (90 - i)),
      tem_codigo: !!m.codigo,
      codigo_gerado_em: m.codigo ? atras(24 * (90 - i)) : null,
      convite_enviado_em: m.email ? atras(24 * (60 - i)) : null,
      ultimo_acesso: i === 3 ? null : atras(3 + i * 7),
      senha_criada: !!m.senha,
      ultimo_login: m.senha ? atras(3 + i * 7) : null,
      codigo: m.codigo,
      senha: m.senha,
    }
  })
  const equipe: FuncionarioDemo[] = EQUIPE_DEMO.map((e, i) => ({
    id: `e${i + 1}`,
    ...e,
    ativo: true,
    convite_enviado_em: atras(24 * 100),
    criado_em: atras(24 * 100),
    ultimo_login: atras(1 + i),
    senha: null, // demonstração: a senha da equipe não é conferida
  }))
  const mor = (apto: string) => moradores.find((m) => m.apto === apto)!
  let seq = 1000
  const lista: SolicitacaoDemo[] = []
  const passo = (status: Status, por: string, horas: number, nota: string | null = null, nome: string | null = null): Passo => ({ status, nota, por_papel: por, por_nome: nome, em: atras(horas) })
  function add(s: Partial<SolicitacaoDemo> & Pick<Solicitacao, 'servico' | 'status'>, apto: string | null, historico?: Passo[]) {
    seq += 1
    const m = apto ? mor(apto) : null
    // Cada pedido da semente foi feito num momento diferente: o de protocolo maior é o mais novo.
    const hist = historico ?? [passo(s.status, 'morador', 70 - (seq - 1000) * 3)]
    lista.push({
      id: `s${seq}`,
      protocolo: seq,
      apto: m?.apto ?? null,
      morador_id: m?.id ?? null,
      morador: m?.nome ?? null,
      inicio: null,
      fim: null,
      pago: null,
      detalhes: {},
      anonima: !m && s.servico === 'denuncia',
      token: null,
      criado_em: hist[0].em,
      historico: hist,
      ...s,
    })
  }
  const lav = (dia: string, hora: string, apto: string) =>
    add({ servico: 'lavagem', status: 'confirmada', inicio: `${dia}T${hora}`, fim: `${dia}T${String(Number(hora.slice(0, 2)) + 1).padStart(2, '0')}:00` }, apto)
  const dia = (data: string, manha: boolean, apto: string) =>
    add({ servico: 'diaria', status: 'confirmada', inicio: `${data}T${manha ? '08:00' : '13:00'}`, fim: `${data}T${manha ? '12:00' : '17:00'}` }, apto)

  // Passado (para o calendário e as estatísticas não começarem vazios)
  lav(d(-9), '19:00', '202')
  lav(d(-8), '19:00', '101')
  lav(d(-6), '20:00', '401')
  lav(d(-5), '19:00', '303')
  lav(d(-3), '09:00', '102')
  lav(d(-2), '19:00', '101')
  dia(d(-7), true, '502')
  dia(d(-2), true, '502')
  // Hoje e os próximos dias
  lav(d(0), '08:00', '203')
  lav(d(0), '18:00', '101')
  lav(d(0), '20:00', '401')
  lav(d(1), '07:00', '202')
  lav(d(1), '10:00', '604')
  lav(d(2), '19:00', '303')
  lav(d(3), '08:00', '101')
  dia(d(0), false, '101')
  dia(d(1), true, '202')
  dia(d(2), false, '303')
  dia(d(4), true, '604')
  add(
    { servico: 'denuncia', status: 'aberta', detalhes: { categoria: 'Barulho', local: 'Bloco B, 3º andar', quando: 'Sexta e sábado depois das 23h', descricao: 'Som alto até de madrugada nos últimos dois fins de semana.' } },
    null,
    [passo('aberta', 'morador', 20)],
  )
  add(
    { servico: 'denuncia', status: 'em_analise', detalhes: { categoria: 'Área comum', local: 'Garagem', descricao: 'Carro estacionado na vaga de outra unidade há três dias.' } },
    '401',
    [passo('aberta', 'morador', 50), passo('em_analise', 'Síndico', 26, 'Vamos identificar o veículo pela câmera e falar com o dono.', 'Helena Castro')],
  )
  add(
    { servico: 'denuncia', status: 'concluida', detalhes: { categoria: 'Lixo e limpeza', local: 'Lixeira do térreo', descricao: 'Lixo sendo deixado fora do contêiner, atraindo bichos.' } },
    '102',
    [passo('aberta', 'morador', 120), passo('concluida', 'Síndico', 96, 'Aviso fixado no elevador e coleta extra combinada com a limpeza.', 'Helena Castro')],
  )
  const modelos = MODELOS_PADRAO.map((m, i) => ({ id: `t${i + 1}`, ...m }))
  const avisos: Aviso[] = [
    { id: 'a1', tipo: 'aviso', titulo: 'Manutenção do elevador social', texto: `No sábado (${d(4).slice(8)}/${d(4).slice(5, 7)}), das 8h às 12h, o elevador social fica parado para a manutenção preventiva. Use o de serviço.`, fixado: true, publicado: true, ordem: 0, atualizado_em: atras(30), atualizado_por: 'Helena Castro' },
    { id: 'a2', tipo: 'aviso', titulo: 'Coleta seletiva', texto: 'O lixo reciclável sai às terças e sextas. Separe papel, plástico e vidro nos contêineres azuis da garagem.', fixado: false, publicado: true, ordem: 0, atualizado_em: atras(200), atualizado_por: 'Helena Castro' },
    ...FAQ_PADRAO.map(([titulo, texto], i): Aviso => ({ id: `f${i + 1}`, tipo: 'faq', titulo, texto, fixado: false, publicado: true, ordem: i + 1, atualizado_em: atras(500), atualizado_por: null })),
  ]
  const envios: Envio[] = [
    { id: 'n1', assunto: 'Dedetização das áreas comuns', corpo: 'Olá, {{nome}}.\n\nNa próxima quinta haverá dedetização das áreas comuns. Mantenha os animais dentro de casa.', destino: { todos: true }, quando: atras(48), recorrencia: null, ativo: false, cancelado: false, ultimo_envio: atras(48), total_enviados: 5, criado_por: 'Helena Castro', criado_em: atras(49), destinatarios: 5, falhas: 0 },
    { id: 'n2', assunto: 'Lembrete: coleta seletiva', corpo: 'Olá, {{nome}}. Amanhã é dia de coleta seletiva.', destino: { todos: true }, quando: new Date(Date.now() + 2 * 86_400_000).toISOString(), recorrencia: 'semanal', ativo: true, cancelado: false, ultimo_envio: atras(5 * 24), total_enviados: 10, criado_por: 'Jorge', criado_em: atras(30 * 24), destinatarios: 5, falhas: 0 },
  ]
  const auditoria: Banco['auditoria'] = moradores.map((m, i) => ({ acao: 'morador_cadastrado', alvo: m.apto, alvo_id: m.id, detalhe: m.nome, por_papel: 'Portaria', por_nome: 'Jorge', em: atras(24 * (90 - i)) }))
  return { moradores, equipe, solicitacoes: lista, tentativas: {}, seq, ajustes: [], auditoria, modelos, envios, avisos }
}

/* ------------------------------------------------------------------ regras (as mesmas do banco) */

const falha = (codigo: string): never => {
  throw new Error(codigo)
}
const espera = () => new Promise((r) => setTimeout(r, 120)) // simula a ida ao servidor
const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const ativa = (s: Solicitacao) => s.status !== 'cancelada' && s.status !== 'recusada'
const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)

/** Quem é o morador: sessão por e-mail (sem código) ou apartamento + código, com o bloqueio do banco. */
function quem(b: Banco, c: Credencial): MoradorDemo {
  if (!c.codigo) {
    const email = lerSessao(CHAVE_MORADOR)
    const m = email ? b.moradores.find((x) => x.email === email && x.ativo) : undefined
    return m ?? falha('sem_cadastro')
  }
  return conferir(b, c.apto, c.codigo)
}

function conferir(b: Banco, apto: string, codigo: string): MoradorDemo {
  apto = apto.trim().toUpperCase()
  codigo = codigo.trim().toUpperCase()
  // Mesmo corte do banco: apartamento fora do formato nem conta tentativa.
  if (!/^[A-Z0-9-]{1,10}$/.test(apto) || codigo.length > 20) return falha('codigo_invalido')
  const t = b.tentativas[apto]
  if (t?.bloqueado_ate && t.bloqueado_ate > Date.now()) falha('bloqueado')
  const m = b.moradores.find((x) => x.apto === apto && x.ativo && x.codigo !== null && x.codigo === codigo)
  if (!m) {
    const falhas = (t?.falhas ?? 0) + 1
    b.tentativas[apto] = falhas >= 5 ? { falhas: 0, bloqueado_ate: Date.now() + 15 * 60_000 } : { falhas, bloqueado_ate: null }
    gravar(b)
    return falha('codigo_invalido')
  }
  delete b.tentativas[apto]
  m.ultimo_acesso = new Date().toISOString()
  gravar(b)
  return m
}

const paraMorador = (s: SolicitacaoDemo): Solicitacao => {
  const { morador_id: _m, token: _t, morador: _n, ...resto } = s
  return { ...copia(resto), historico: s.historico.map((h) => ({ ...h, por_nome: null })) }
}

/** Morador como a equipe vê (sem código nem senha). */
const paraEquipe = ({ codigo, senha: _s, ...m }: MoradorDemo): Morador => ({ ...m, tem_codigo: codigo !== null })

function novoCodigo(): string {
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alfabeto[Math.floor(Math.random() * alfabeto.length)]).join('')
}

function equipeLogada(b: Banco): FuncionarioDemo | null {
  const email = lerSessao(CHAVE_EQUIPE)
  return (email && b.equipe.find((e) => e.email === email && e.ativo)) || null
}

/** Exige alguém da equipe com a permissão pedida. */
function exigir(b: Banco, permissao: Permissao): FuncionarioDemo {
  const eu = equipeLogada(b)
  if (!eu || !eu.permissoes.includes(permissao)) falha('sem_permissao')
  return eu!
}

/** Feriados do período com os ajustes do síndico (o mesmo que cond_dias_especiais). */
const especiais = (b: Banco, de: string, ate: string) => diasEspeciais(de, ate, FERIADOS_LOCAIS_PADRAO, b.ajustes)

/** Linha de auditoria (o que a equipe fez fora das solicitações). */
function registrar(b: Banco, eu: MembroEquipe, acao: string, alvo: string | null, detalhe: string | null, alvo_id: string | null = null) {
  b.auditoria.unshift({ acao, alvo, alvo_id, detalhe, por_papel: eu.cargo, por_nome: eu.nome, em: new Date().toISOString() })
}

/** Confere e limpa os campos do cadastro (o mesmo que cond_campos_morador). */
function campos(d: DadosMorador) {
  const nome = d.nome.trim()
  const apto = d.apto.trim().toUpperCase()
  const email = d.email.trim().toLowerCase() || null
  const cpf = d.cpf.replace(/\D/g, '') || null
  if (nome.length < 2 || !/^[A-Z0-9-]{1,10}$/.test(apto)) falha('dados_invalidos')
  if (email && !emailOk(email)) falha('email_invalido')
  if (cpf && !cpfValido(cpf)) falha('cpf_invalido')
  return { nome, apto, email, cpf, telefone: d.telefone.trim() || null, vaga: d.vaga.trim().toUpperCase() || null, desde: d.desde || null }
}

/** Convite simulado: registra e devolve o link de demonstração que abre a tela de criar a senha. */
function convite(b: Banco, eu: MembroEquipe, alvo: { id: string; email: string | null; convite_enviado_em: string | null }, rotulo: string) {
  if (!alvo.email) return null
  alvo.convite_enviado_em = new Date().toISOString()
  registrar(b, eu, 'convite_enviado', rotulo, alvo.email, alvo.id)
  return { email: alvo.email, linkDemo: `#/criar-senha?demo=${encodeURIComponent(alvo.email)}` }
}

/** Quantos moradores ativos com e-mail recebem um envio. */
const destinatarios = (b: Banco, destino: Envio['destino']) =>
  b.moradores.filter((m) => m.ativo && m.email && (destino.todos || destino.ids?.includes(m.id))).length

/** Próxima data de um envio que repete. */
function proximo(quando: string, rec: Envio['recorrencia']): string {
  const d = new Date(quando)
  do {
    if (rec === 'diaria') d.setDate(d.getDate() + 1)
    else if (rec === 'semanal') d.setDate(d.getDate() + 7)
    else d.setMonth(d.getMonth() + 1)
  } while (d.getTime() <= Date.now())
  return d.toISOString()
}

/** Na demonstração, "mandar" é marcar como enviado o que venceu (o banco faz isso pela função do servidor). */
function processarEnvios(b: Banco) {
  for (const e of b.envios) {
    if (!e.ativo || Date.parse(e.quando) > Date.now()) continue
    e.total_enviados += destinatarios(b, e.destino)
    e.ultimo_envio = new Date().toISOString()
    if (e.recorrencia) e.quando = proximo(e.quando, e.recorrencia)
    else e.ativo = false
  }
}

/* ------------------------------------------------------------------ a Api */

export function criarDemo(): Api {
  const regras = SERVICOS_PADRAO
  const servicoDe = (chave: string): ServicoDef => regras.find((r) => r.chave === chave) ?? falha('servico_invalido')

  return {
    modo: 'demo',
    regras: async () => copia(regras),
    feriados: async (de, ate) => especiais(ler(), de, ate),

    // ---------------------------------------------------------------- morador
    entrar: async (apto, codigo) => {
      await espera()
      const m = conferir(ler(), apto, codigo)
      return { nome: m.nome, apto: m.apto }
    },
    entrarEmail: async (email, senha) => {
      await espera()
      const b = ler()
      const m = b.moradores.find((x) => x.email === email.trim().toLowerCase() && x.ativo)
      if (!m || !m.senha || m.senha !== senha) falha('login_invalido')
      gravarSessao(CHAVE_MORADOR, m!.email)
      m!.ultimo_login = m!.ultimo_acesso = new Date().toISOString()
      gravar(b)
      return { nome: m!.nome, apto: m!.apto, email: m!.email! }
    },
    sessaoMorador: async () => {
      const email = lerSessao(CHAVE_MORADOR)
      const m = email ? ler().moradores.find((x) => x.email === email && x.ativo) : undefined
      return m ? { nome: m.nome, apto: m.apto, email: m.email! } : null
    },
    sairMorador: async () => gravarSessao(CHAVE_MORADOR, null),
    esqueciSenha: async () => {
      await espera() // na demonstração nada sai; a tela mostra a mesma mensagem de sempre
    },
    definirSenha: async (link, senha) => {
      await espera()
      if (!('demo' in link)) falha('link_invalido')
      if (senha.length < 8) falha('senha_fraca')
      const email = (link as { demo: string }).demo.toLowerCase()
      const b = ler()
      const f = b.equipe.find((e) => e.email === email && e.ativo)
      if (f) {
        f.senha = senha
        gravarSessao(CHAVE_EQUIPE, email)
        gravar(b)
        return 'equipe'
      }
      const m = b.moradores.find((x) => x.email === email && x.ativo) ?? falha('link_vencido')
      m.senha = senha
      m.senha_criada = true
      m.ultimo_login = m.ultimo_acesso = new Date().toISOString()
      gravarSessao(CHAVE_MORADOR, email)
      gravar(b)
      return 'morador'
    },
    minhas: async (c, tokens) => {
      await espera()
      const b = ler()
      const m = quem(b, c)
      return b.solicitacoes
        .filter((s) => s.morador_id === m.id || (s.token !== null && tokens.includes(s.token)))
        .sort((x, y) => y.criado_em.localeCompare(x.criado_em))
        .map(paraMorador)
    },
    ocupacao: async (c, de, ate) => {
      await espera()
      const b = ler()
      const m = quem(b, c)
      return b.solicitacoes
        .filter((s) => (s.servico === 'lavagem' || s.servico === 'diaria') && ativa(s) && s.inicio && diaDe(s.inicio) >= de && diaDe(s.inicio) <= ate)
        .map((s) => ({ servico: s.servico, inicio: s.inicio!, fim: s.fim!, minha: s.morador_id === m.id }))
    },
    solicitar: async (c, p) => {
      await espera()
      const b = ler()
      const m = quem(b, c)
      const sv = servicoDe(p.servico)
      if (!sv.ativo) falha('servico_inativo')
      const config = sv.config
      const agora = agoraLocal()
      const d = p.detalhes
      const cobra = 'cobra' in config && config.cobra
      const base = { servico: p.servico, apto: m.apto, morador_id: m.id, morador: m.nome, anonima: false, token: null as string | null }
      let resto: Partial<SolicitacaoDemo>

      if (config.tipo === 'horario' || config.tipo === 'periodo') {
        const esp = p.inicio ? especiais(b, diaDe(p.inicio), diaDe(p.inicio)) : []
        const per = p.inicio ? periodosDoDia(config, diaDe(p.inicio), esp).find((h) => h.inicio === p.inicio) : undefined
        if (!per) return falha(esp.some((e) => config[e.tipo] === 'fecha') ? 'dia_fechado' : 'horario_invalido')
        if (per.inicio <= agora) falha('horario_passou')
        if (diferencaDias(diaDe(agora), diaDe(per.inicio)) > config.horizonte) falha('fora_do_horizonte')
        if (b.solicitacoes.some((s) => s.servico === p.servico && ativa(s) && s.inicio === per.inicio)) falha('ocupado')
        const semana = segundaDa(diaDe(per.inicio))
        const naSemana = b.solicitacoes.filter((s) => s.servico === p.servico && s.apto === m.apto && ativa(s) && s.inicio && segundaDa(diaDe(s.inicio)) === semana)
        if (naSemana.length >= config.por_semana) falha('limite_semana')
        resto = { inicio: per.inicio, fim: per.fim, status: 'confirmada', pago: cobra ? false : null, detalhes: d.obs?.trim() ? { obs: d.obs.trim().slice(0, 300) } : {} }
      } else if (config.tipo === 'pedido') {
        const de = p.inicio ? diaDe(p.inicio) : ''
        const ate = d.ate ?? ''
        if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de < diaDe(agora) || ate < de || diferencaDias(de, ate) >= config.max_dias) {
          falha('data_invalida')
        }
        if (!placaValida(d.placa ?? '')) falha('placa_invalida')
        const limpo = (x?: string, n = 80) => (x?.trim() ? x.trim().slice(0, n) : undefined)
        resto = {
          inicio: `${de}T00:00`,
          fim: `${somaDias(ate, 1)}T00:00`,
          status: 'aberta',
          pago: cobra ? false : null,
          detalhes: JSON.parse(JSON.stringify({ placa: normalizarPlaca(d.placa!), veiculo: limpo(d.veiculo), para: limpo(d.para), obs: limpo(d.obs, 300) })),
        }
      } else {
        // denúncia: sem limite de quantidade, de propósito
        if (!config.categorias.includes(d.categoria ?? '')) falha('categoria_invalida')
        if ((d.descricao ?? '').trim().length < 10) falha('descricao_curta')
        resto = {
          status: 'aberta',
          detalhes: JSON.parse(JSON.stringify({ categoria: d.categoria, local: d.local?.trim() || undefined, quando: d.quando?.trim() || undefined, descricao: d.descricao!.trim().slice(0, 2000) })),
        }
        if (p.anonima) Object.assign(base, { apto: null, morador_id: null, morador: null, anonima: true, token: crypto.randomUUID().replace(/-/g, '') })
      }

      b.seq += 1
      const nova: SolicitacaoDemo = { id: `s${b.seq}`, protocolo: b.seq, inicio: null, fim: null, pago: null, detalhes: {}, criado_em: new Date().toISOString(), historico: [], ...base, ...(resto as Pick<Solicitacao, 'status'>) }
      nova.historico = [{ status: nova.status, nota: null, por_papel: 'morador', por_nome: null, em: nova.criado_em }]
      b.solicitacoes.push(nova)
      gravar(b)
      return { id: nova.id, protocolo: nova.protocolo, token: nova.token }
    },
    cancelar: async (c, id) => {
      await espera()
      const b = ler()
      const m = quem(b, c)
      const s = b.solicitacoes.find((x) => x.id === id && x.morador_id === m.id) ?? falha('nao_encontrada')
      const agora = agoraLocal()
      if ((s.status !== 'aberta' && s.status !== 'confirmada') || ((s.servico === 'lavagem' || s.servico === 'diaria') && s.inicio! <= agora) || (s.servico === 'estacionamento' && s.fim! <= agora)) {
        falha('nao_cancela')
      }
      s.status = 'cancelada'
      s.historico.push({ status: 'cancelada', nota: null, por_papel: 'morador', por_nome: null, em: new Date().toISOString() })
      gravar(b)
    },
    avisos: async (c) => {
      await espera()
      const b = ler()
      quem(b, c)
      return copia(
        b.avisos
          .filter((a) => a.publicado)
          .sort((x, y) => Number(y.tipo === 'aviso') - Number(x.tipo === 'aviso') || Number(y.fixado) - Number(x.fixado) || x.ordem - y.ordem || y.atualizado_em.localeCompare(x.atualizado_em))
          .map(({ atualizado_por: _p, ...a }) => a),
      )
    },

    // ---------------------------------------------------------------- equipe
    equipeAtual: async () => {
      const eu = equipeLogada(ler())
      return eu ? { nome: eu.nome, cargo: eu.cargo, permissoes: eu.permissoes } : null
    },
    entrarEquipe: async (email, senha) => {
      await espera()
      const b = ler()
      const e = b.equipe.find((x) => x.email === email.trim().toLowerCase() && x.ativo)
      if (!e || (e.senha && e.senha !== senha)) falha('login_invalido')
      e!.ultimo_login = new Date().toISOString()
      gravarSessao(CHAVE_EQUIPE, e!.email)
      gravar(b)
      return { nome: e!.nome, cargo: e!.cargo, permissoes: e!.permissoes }
    },
    sairEquipe: async () => gravarSessao(CHAVE_EQUIPE, null),
    painel: async (de, ate) => {
      await espera()
      const b = ler()
      const eu = equipeLogada(b)
      const reservas = !!eu?.permissoes.includes('reservas')
      const denuncias = !!eu?.permissoes.includes('denuncias')
      if (!reservas && !denuncias) falha('sem_permissao')
      // Mesmo recorte do banco: sem período, de 90 dias atrás em diante.
      const desde = de ? `${de}T00:00` : agoraLocal(new Date(Date.now() - 90 * 86_400_000))
      const quando = (s: Solicitacao, x: 'inicio' | 'fim') => s[x] ?? agoraLocal(new Date(s.criado_em))
      const itens = b.solicitacoes
        .filter((s) => (s.servico === 'denuncia' ? denuncias : reservas))
        .filter((s) => quando(s, 'fim') >= desde && (!ate || quando(s, 'inicio') < `${somaDias(ate, 1)}T00:00`))
        .map(({ morador_id: _m, token: _t, ...s }) => copia(s))
      return { itens }
    },
    atualizar: async (id, mud) => {
      await espera()
      const b = ler()
      const s = b.solicitacoes.find((x) => x.id === id)
      const eu = equipeLogada(b)
      if (!s || !eu || !eu.permissoes.includes(s.servico === 'denuncia' ? 'denuncias' : 'reservas')) return falha('nao_encontrada')
      const nota = mud.nota?.trim() || null
      const em = new Date().toISOString()
      const passo = (status: Status, n: string | null): Passo => ({ status, nota: n, por_papel: eu.cargo, por_nome: eu.nome, em })
      if (mud.status && mud.status !== s.status) {
        if (!passagens(s.servico, s.status).some((p) => p.para === mud.status)) falha('passagem_invalida')
        if ((s.servico === 'lavagem' || s.servico === 'diaria') && s.fim! <= agoraLocal()) falha('passagem_invalida')
        if (s.servico === 'denuncia' && (mud.status === 'concluida' || mud.status === 'recusada') && !nota) falha('resposta_obrigatoria')
        s.status = mud.status
        s.historico.push(passo(mud.status, nota))
      } else if (nota) {
        s.historico.push(passo(s.status, nota))
      }
      if (mud.pago !== undefined && s.pago !== null && mud.pago !== s.pago) {
        s.pago = mud.pago
        s.historico.push(passo(s.status, mud.pago ? 'Pagamento recebido' : 'Pagamento desmarcado'))
      }
      gravar(b)
    },
    moradores: async () => {
      await espera()
      const b = ler()
      exigir(b, 'moradores')
      return b.moradores.map(paraEquipe).sort((x, y) => x.apto.localeCompare(y.apto, 'pt-BR', { numeric: true }) || x.nome.localeCompare(y.nome, 'pt-BR'))
    },
    criarMorador: async (d): Promise<ResultadoCadastro> => {
      await espera()
      const b = ler()
      const eu = exigir(b, 'moradores')
      const f = campos(d)
      if (f.email && b.moradores.some((m) => m.email === f.email)) falha('email_repetido')
      const codigo = !f.email || d.gerar_codigo ? novoCodigo() : null
      const agora = new Date().toISOString()
      const m: MoradorDemo = {
        id: crypto.randomUUID(),
        ...f,
        ativo: true,
        criado_em: agora,
        tem_codigo: !!codigo,
        codigo_gerado_em: codigo ? agora : null,
        convite_enviado_em: null,
        ultimo_acesso: null,
        senha_criada: false,
        ultimo_login: null,
        codigo,
        senha: null,
      }
      b.moradores.push(m)
      registrar(b, eu, 'morador_cadastrado', m.apto, m.nome, m.id)
      const c = convite(b, eu, m, m.apto)
      gravar(b)
      return { id: m.id, codigo, convite: c }
    },
    editarMorador: async (id, d) => {
      await espera()
      const b = ler()
      const eu = exigir(b, 'moradores')
      const f = campos(d)
      const m = b.moradores.find((x) => x.id === id) ?? falha('nao_encontrado')
      if (!f.email && !m.codigo) falha('sem_forma_de_acesso')
      if (f.email && b.moradores.some((x) => x.id !== id && x.email === f.email)) falha('email_repetido')
      const antes = { ...m }
      Object.assign(m, f, { ativo: d.ativo })
      let canceladas = 0
      if (antes.ativo && !d.ativo) {
        // Desativar libera os horários futuros (igual ao banco).
        const agora = agoraLocal()
        for (const s of b.solicitacoes) {
          if (s.morador_id === id && s.servico !== 'denuncia' && (s.status === 'aberta' || s.status === 'confirmada') && s.inicio! > agora) {
            s.status = 'cancelada'
            s.historico.push({ status: 'cancelada', nota: 'Cancelada porque o morador foi desativado', por_papel: eu.cargo, por_nome: eu.nome, em: new Date().toISOString() })
            canceladas += 1
          }
        }
        registrar(b, eu, 'morador_desativado', antes.apto, `${antes.nome} (${canceladas} reservas canceladas)`, id)
      } else if (!antes.ativo && d.ativo) {
        registrar(b, eu, 'morador_reativado', m.apto, m.nome, id)
      } else {
        registrar(b, eu, 'morador_editado', m.apto, m.nome, id)
      }
      const c = f.email && f.email !== antes.email && d.ativo ? convite(b, eu, m, m.apto) : null
      if (c) {
        m.senha = null
        m.senha_criada = false
      }
      gravar(b)
      return { canceladas, convite: c }
    },
    novoCodigo: async (id) => {
      await espera()
      const b = ler()
      const eu = exigir(b, 'moradores')
      const m = b.moradores.find((x) => x.id === id) ?? falha('nao_encontrado')
      m.codigo = novoCodigo()
      m.tem_codigo = true
      m.codigo_gerado_em = new Date().toISOString()
      registrar(b, eu, 'codigo_novo', m.apto, m.nome, m.id)
      gravar(b)
      return { codigo: m.codigo }
    },
    reenviarConvite: async (tipo, id) => {
      await espera()
      const b = ler()
      const eu = exigir(b, tipo === 'morador' ? 'moradores' : 'admin')
      const alvo = tipo === 'morador' ? b.moradores.find((x) => x.id === id && x.ativo) : b.equipe.find((x) => x.id === id && x.ativo)
      const c = alvo ? convite(b, eu, alvo, tipo === 'morador' ? (alvo as MoradorDemo).apto : alvo.nome) : null
      gravar(b)
      return c ?? falha('nao_encontrado')
    },
    historicoMorador: async (id) => {
      await espera()
      const b = ler()
      const eu = exigir(b, 'moradores')
      return {
        solicitacoes: b.solicitacoes
          .filter((s) => s.morador_id === id && (s.servico !== 'denuncia' || eu.permissoes.includes('denuncias')))
          .sort((x, y) => y.criado_em.localeCompare(x.criado_em))
          .map(({ morador_id: _m, token: _t, ...s }) => copia(s)),
        auditoria: b.auditoria.filter((a) => a.alvo_id === id).map(({ alvo_id: _a, ...a }) => a),
      }
    },
    funcionarios: async () => {
      await espera()
      const b = ler()
      exigir(b, 'admin')
      return b.equipe.map(({ senha: _s, ...e }) => copia(e)).sort((x, y) => Number(y.ativo) - Number(x.ativo) || x.nome.localeCompare(y.nome, 'pt-BR'))
    },
    salvarFuncionario: async (id, d) => {
      await espera()
      const b = ler()
      const eu = exigir(b, 'admin')
      const email = d.email.trim().toLowerCase()
      if (!emailOk(email)) falha('email_invalido')
      if (d.nome.trim().length < 2 || d.cargo.trim().length < 2) falha('dados_invalidos')
      if (b.equipe.some((e) => e.id !== id && e.email === email)) falha('email_repetido')
      const novo = { email, nome: d.nome.trim(), cargo: d.cargo.trim(), permissoes: d.permissoes, ativo: d.ativo }
      const outros = b.equipe.filter((e) => e.id !== id)
      if (!outros.concat([{ ...novo } as FuncionarioDemo]).some((e) => e.ativo && e.permissoes.includes('admin'))) falha('ultimo_admin')
      let f = id ? b.equipe.find((e) => e.id === id) : undefined
      const emailAntes = f?.email
      if (id && !f) falha('nao_encontrado')
      if (f) Object.assign(f, novo)
      else {
        f = { id: crypto.randomUUID(), ...novo, convite_enviado_em: null, criado_em: new Date().toISOString(), ultimo_login: null, senha: null }
        b.equipe.push(f)
      }
      registrar(b, eu, id ? 'funcionario_editado' : 'funcionario_cadastrado', f.nome, `${f.cargo}: ${f.permissoes.join(', ')}${f.ativo ? '' : ' (desativado)'}`, f.id)
      const c = f.ativo && (!id || emailAntes !== f.email) ? convite(b, eu, f, f.nome) : null
      gravar(b)
      return { id: f.id, convite: c }
    },
    ajustarDia: async (dia, tipo, nome) => {
      await espera()
      const b = ler()
      const eu = exigir(b, 'admin')
      b.ajustes = b.ajustes.filter((a) => a.dia !== dia)
      if (tipo) b.ajustes.push({ dia, tipo, nome: nome?.trim() ? nome.trim().slice(0, 80) : null })
      registrar(b, eu, 'dia_ajustado', `${dia.slice(8)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`, `${tipo ?? 'automático'}${nome ? `: ${nome}` : ''}`)
      gravar(b)
      return { reservas_no_dia: b.solicitacoes.filter((s) => (s.servico === 'lavagem' || s.servico === 'diaria') && s.status === 'confirmada' && s.inicio?.startsWith(dia)).length }
    },
    auditoria: async () => {
      await espera()
      const b = ler()
      exigir(b, 'admin')
      return copia(b.auditoria.slice(0, 300).map(({ alvo_id: _a, ...a }) => a))
    },
    modelos: async () => {
      const b = ler()
      exigir(b, 'noticias')
      return copia(b.modelos).sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'))
    },
    salvarModelo: async (id, m) => {
      await espera()
      const b = ler()
      exigir(b, 'noticias')
      if (m.nome.trim().length < 2 || !m.assunto.trim() || !m.corpo.trim()) falha('dados_invalidos')
      const existente = id ? b.modelos.find((x) => x.id === id) : undefined
      if (id && !existente) falha('nao_encontrado')
      const salvo = existente ?? { id: crypto.randomUUID(), ...m }
      Object.assign(salvo, { nome: m.nome.trim(), assunto: m.assunto.trim(), corpo: m.corpo })
      if (!existente) b.modelos.push(salvo)
      gravar(b)
      return { id: salvo.id }
    },
    apagarModelo: async (id) => {
      const b = ler()
      exigir(b, 'noticias')
      b.modelos = b.modelos.filter((m) => m.id !== id)
      gravar(b)
    },
    envios: async () => {
      await espera()
      const b = ler()
      exigir(b, 'noticias')
      processarEnvios(b)
      gravar(b)
      return copia(b.envios.map((e) => ({ ...e, destinatarios: destinatarios(b, e.destino) }))).sort((x, y) => y.criado_em.localeCompare(x.criado_em))
    },
    criarEnvio: async (e) => {
      await espera()
      const b = ler()
      const eu = exigir(b, 'noticias')
      if (!e.assunto.trim() || !e.corpo.trim()) falha('dados_invalidos')
      if (e.quando && Date.parse(e.quando) < Date.now() - 5 * 60_000) falha('data_passada')
      const n = destinatarios(b, e.destino)
      if (!n) falha('sem_destinatarios')
      const agora = new Date().toISOString()
      const novo: Envio = { id: crypto.randomUUID(), assunto: e.assunto.trim(), corpo: e.corpo, destino: e.destino, quando: e.quando ?? agora, recorrencia: e.recorrencia, ativo: true, cancelado: false, ultimo_envio: null, total_enviados: 0, criado_por: eu.nome, criado_em: agora, destinatarios: n, falhas: 0 }
      b.envios.push(novo)
      registrar(b, eu, 'noticia_criada', novo.assunto, `${n} destinatário(s)${e.recorrencia ? `, repete: ${e.recorrencia}` : ''}`, novo.id)
      processarEnvios(b)
      gravar(b)
      return { id: novo.id, destinatarios: n }
    },
    cancelarEnvio: async (id) => {
      await espera()
      const b = ler()
      const eu = exigir(b, 'noticias')
      const e = b.envios.find((x) => x.id === id && x.ativo) ?? falha('nao_encontrada')
      e.ativo = false
      e.cancelado = true
      registrar(b, eu, 'noticia_cancelada', e.assunto, null, e.id)
      gravar(b)
    },
    listaAvisos: async () => {
      const b = ler()
      exigir(b, 'noticias')
      return copia(b.avisos).sort((x, y) => Number(y.tipo === 'aviso') - Number(x.tipo === 'aviso') || Number(y.fixado) - Number(x.fixado) || x.ordem - y.ordem || y.atualizado_em.localeCompare(x.atualizado_em))
    },
    salvarAviso: async (id, a) => {
      await espera()
      const b = ler()
      const eu = exigir(b, 'noticias')
      if ((a.tipo !== 'aviso' && a.tipo !== 'faq') || a.titulo.trim().length < 2 || !a.texto.trim()) falha('dados_invalidos')
      const existente = id ? b.avisos.find((x) => x.id === id) : undefined
      if (id && !existente) falha('nao_encontrado')
      const salvo: Aviso = existente ?? ({ id: crypto.randomUUID() } as Aviso)
      Object.assign(salvo, { ...a, titulo: a.titulo.trim(), texto: a.texto.trim(), atualizado_em: new Date().toISOString(), atualizado_por: eu.nome })
      if (!existente) b.avisos.push(salvo)
      registrar(b, eu, 'aviso_salvo', salvo.titulo, salvo.publicado ? 'publicado' : 'rascunho', salvo.id)
      gravar(b)
      return { id: salvo.id }
    },
    apagarAviso: async (id) => {
      const b = ler()
      const eu = exigir(b, 'noticias')
      const a = b.avisos.find((x) => x.id === id)
      b.avisos = b.avisos.filter((x) => x.id !== id)
      if (a) registrar(b, eu, 'aviso_apagado', a.titulo, null, a.id)
      gravar(b)
    },
  }
}
