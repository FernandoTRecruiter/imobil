/* O modo demonstração segue as mesmas regras do banco (os casos principais de banco.test.ts). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { criarDemo, MORADORES_DEMO, restaurarDemo } from '../src/dados/demo'
import { agoraLocal, diaDe, periodosDoDia, somaDias } from '../src/regras'
import { SERVICOS_PADRAO } from '../src/config'
import type { Credencial, DadosMorador } from '../src/tipos'

// O Node não tem localStorage/sessionStorage: um de memória basta.
function memoria(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  }
}
vi.stubGlobal('localStorage', memoria())
vi.stubGlobal('sessionStorage', memoria())

const porApto = (apto: string) => MORADORES_DEMO.find((m) => m.apto === apto)!
const comCodigo = (apto: string): Credencial => ({ apto, codigo: porApto(apto).codigo!, nome: porApto(apto).nome })
// Marcos (102) e Otávio (604) entram por código e têm no máximo uma reserva perto de hoje na
// semente: os testes não esbarram no limite por semana em nenhum dia em que rodarem.
const credM = comCodigo('102')
const credO = comCodigo('604')
const novo = (d: Partial<DadosMorador>): DadosMorador => ({ nome: '', apto: '', telefone: '', email: '', cpf: '', vaga: '', desde: '', ativo: true, ...d })
let api = criarDemo()

/** Um horário de lavagem livre daqui a 5 dias (a semente usa de hoje até +4). */
function horarioLivre(): string {
  const dia = somaDias(diaDe(agoraLocal()), 5)
  return periodosDoDia(SERVICOS_PADRAO[0].config, dia)[14].inicio // 21:00
}

beforeEach(async () => {
  restaurarDemo()
  api = criarDemo()
  await api.sairEquipe()
  await api.sairMorador()
})

describe('demonstração: entrada', () => {
  it('entra com o código e recusa o errado', async () => {
    expect((await api.entrar('101', porApto('101').codigo!.toLowerCase())).nome).toBe('Luíza Prado')
    await expect(api.entrar('101', 'ERRADO')).rejects.toThrow('codigo_invalido')
  })

  it('5 erros travam o apartamento', async () => {
    for (let i = 0; i < 5; i++) await expect(api.entrar('102', 'X')).rejects.toThrow('codigo_invalido')
    await expect(api.entrar('102', porApto('102').codigo!)).rejects.toThrow('bloqueado')
  })

  it('entra com e-mail e senha; a sessão fica lembrada; senha errada é recusada', async () => {
    await expect(api.entrarEmail('tiago@exemplo.com', 'errada')).rejects.toThrow('login_invalido')
    const c = await api.entrarEmail('Tiago@Exemplo.com', 'morador1')
    expect(c).toMatchObject({ nome: 'Tiago Nunes', apto: '202', email: 'tiago@exemplo.com' })
    expect((await api.sessaoMorador())?.apto).toBe('202')
    expect((await api.minhas(c, [])).length).toBeGreaterThan(0)
    await api.sairMorador()
    expect(await api.sessaoMorador()).toBeNull()
  })

  it('convite: cadastro com e-mail, link do convite cria a senha, e desativar corta o acesso', async () => {
    await api.entrarEquipe('portaria@demo', '')
    const r = await api.criarMorador(novo({ nome: 'Nova Moradora', apto: '701', email: 'nova@exemplo.com', cpf: '529.982.247-25', vaga: 'g-30' }))
    expect(r.codigo).toBeNull()
    expect(r.convite?.linkDemo).toContain('demo=nova%40exemplo.com')
    expect(await api.definirSenha({ demo: 'nova@exemplo.com' }, 'senha-nova-1')).toBe('morador')
    const c = (await api.sessaoMorador())!
    expect(c.apto).toBe('701')
    const m = (await api.moradores()).find((x) => x.apto === '701')!
    expect(m).toMatchObject({ senha_criada: true, tem_codigo: false, vaga: 'G-30', cpf: '52998224725' })
    await api.editarMorador(m.id, novo({ nome: 'Nova Moradora', apto: '701', email: 'nova@exemplo.com', ativo: false }))
    await expect(api.minhas(c, [])).rejects.toThrow('sem_cadastro')
  })

  it('CPF errado e e-mail repetido são recusados', async () => {
    await api.entrarEquipe('portaria@demo', '')
    await expect(api.criarMorador(novo({ nome: 'X Y', apto: '702', cpf: '529.982.247-24' }))).rejects.toThrow('cpf_invalido')
    await expect(api.criarMorador(novo({ nome: 'X Y', apto: '702', email: 'tiago@exemplo.com' }))).rejects.toThrow('email_repetido')
  })

  it('código novo derruba o antigo', async () => {
    await api.entrarEquipe('portaria@demo', '')
    const { codigo } = await api.criarMorador(novo({ nome: 'Sem Email', apto: '703' }))
    expect(codigo).toMatch(/^[A-Z0-9]{6}$/)
    const id = (await api.moradores()).find((m) => m.apto === '703')!.id
    const outro = await api.novoCodigo(id)
    await expect(api.entrar('703', codigo!)).rejects.toThrow('codigo_invalido')
    expect((await api.entrar('703', outro.codigo)).apto).toBe('703')
  })
})

describe('demonstração: reservas e denúncia', () => {
  it('horário reservado por um aparece ocupado (sem dono) para o outro e não pode ser pego', async () => {
    const h = horarioLivre()
    await api.solicitar(credM, { servico: 'lavagem', inicio: h, detalhes: {} })
    await expect(api.solicitar(credO, { servico: 'lavagem', inicio: h, detalhes: {} })).rejects.toThrow('ocupado')
    const oc = await api.ocupacao(credO, diaDe(h), diaDe(h))
    expect(oc.find((o) => o.inicio === h)).toEqual({ servico: 'lavagem', inicio: h, fim: h.slice(0, 11) + '22:00', minha: false })
  })

  it('estacionamento desligado é recusado; diária sem cobrança nasce sem pagamento', async () => {
    const amanha = somaDias(diaDe(agoraLocal()), 1)
    await expect(api.solicitar(credM, { servico: 'estacionamento', inicio: `${amanha}T00:00`, detalhes: { ate: amanha, placa: 'ABC1D23' } })).rejects.toThrow('servico_inativo')
    const dia = somaDias(diaDe(agoraLocal()), 6)
    const per = periodosDoDia(SERVICOS_PADRAO[1].config, dia, await api.feriados(dia, dia))
    if (!per.length) return // domingo ou feriado: sem diária
    const r = await api.solicitar(credM, { servico: 'diaria', inicio: per[1].inicio, detalhes: {} })
    expect((await api.minhas(credM, [])).find((s) => s.id === r.id)!.pago).toBeNull()
  })

  it('denúncia anônima: sem apto, acompanhada pelo token; quem não tem "denuncias" não vê', async () => {
    const r = await api.solicitar(credM, { servico: 'denuncia', inicio: null, detalhes: { categoria: 'Barulho', descricao: 'Som alto todas as noites' }, anonima: true })
    expect((await api.minhas(credM, [])).some((s) => s.id === r.id)).toBe(false)
    expect((await api.minhas(credM, [r.token!])).find((s) => s.id === r.id)).toMatchObject({ apto: null, anonima: true })
    await api.entrarEquipe('portaria@demo', '')
    expect((await api.painel()).itens.some((s) => s.servico === 'denuncia')).toBe(false)
    await api.entrarEquipe('sindico@demo', '')
    await expect(api.atualizar(r.id, { status: 'concluida' })).rejects.toThrow('resposta_obrigatoria')
    await api.atualizar(r.id, { status: 'concluida', nota: 'Resolvido com o morador' })
    expect((await api.minhas(credM, [r.token!])).find((s) => s.id === r.id)!.historico.at(-1)).toMatchObject({ nota: 'Resolvido com o morador', por_papel: 'Síndico', por_nome: null })
  })
})

describe('demonstração: equipe, notícias e avisos', () => {
  it('o síndico cadastra funcionário com poderes; zeladoria só vê reservas; nunca fica sem admin', async () => {
    await api.entrarEquipe('sindico@demo', '')
    const r = await api.salvarFuncionario(null, { nome: 'Caio Ramos', email: 'caio@exemplo.com', cargo: 'Zeladoria', permissoes: ['reservas'], ativo: true })
    expect(r.convite?.linkDemo).toBeTruthy()
    const eu = (await api.funcionarios()).find((f) => f.email === 'sindico@demo')!
    await expect(api.salvarFuncionario(eu.id, { nome: eu.nome, email: eu.email, cargo: eu.cargo, permissoes: ['reservas'], ativo: true })).rejects.toThrow()
    await api.entrarEquipe('zeladoria@demo', '')
    expect((await api.painel()).itens.length).toBeGreaterThan(0)
    await expect(api.moradores()).rejects.toThrow('sem_permissao')
    await expect(api.funcionarios()).rejects.toThrow('sem_permissao')
  })

  it('síndico marca feriado: diária fecha naquele dia; portaria não pode', async () => {
    let dia = somaDias(diaDe(agoraLocal()), 3)
    while (periodosDoDia(SERVICOS_PADRAO[1].config, dia, await api.feriados(dia, dia)).length === 0) dia = somaDias(dia, 1)
    await api.entrarEquipe('portaria@demo', '')
    await expect(api.ajustarDia(dia, 'feriado', 'Teste')).rejects.toThrow('sem_permissao')
    await api.entrarEquipe('sindico@demo', '')
    await api.ajustarDia(dia, 'feriado', 'Decreto')
    await expect(api.solicitar(credO, { servico: 'diaria', inicio: dia + 'T08:00', detalhes: {} })).rejects.toThrow('dia_fechado')
    expect((await api.auditoria())[0]).toMatchObject({ acao: 'dia_ajustado', por_nome: 'Helena Castro' })
  })

  it('e-mail agora sai na hora; o agendado semanal fica esperando', async () => {
    await api.entrarEquipe('portaria@demo', '')
    expect((await api.modelos()).map((m) => m.nome)).toEqual(['Aviso de denúncia', 'Encomenda na portaria'])
    const agora = await api.criarEnvio({ assunto: 'Teste', corpo: 'Olá {{nome}}', destino: { todos: true }, quando: null, recorrencia: null })
    const daqui = new Date(Date.now() + 86_400_000).toISOString()
    const agendado = await api.criarEnvio({ assunto: 'Toda semana', corpo: 'Lembrete', destino: { todos: true }, quando: daqui, recorrencia: 'semanal' })
    const lista = await api.envios()
    expect(lista.find((e) => e.id === agora.id)).toMatchObject({ ativo: false, total_enviados: agora.destinatarios })
    expect(lista.find((e) => e.id === agendado.id)).toMatchObject({ ativo: true, total_enviados: 0, recorrencia: 'semanal' })
    await expect(api.criarEnvio({ assunto: 'X', corpo: 'Y', destino: { ids: ['nao-existe'] }, quando: null, recorrencia: null })).rejects.toThrow('sem_destinatarios')
  })

  it('avisos: o morador vê os publicados (fixado em cima); rascunho só a equipe vê', async () => {
    await api.entrarEquipe('sindico@demo', '')
    await api.salvarAviso(null, { tipo: 'aviso', titulo: 'Rascunho secreto', texto: 'ainda não', fixado: false, publicado: false, ordem: 0 })
    expect((await api.listaAvisos()).some((a) => a.titulo === 'Rascunho secreto')).toBe(true)
    const vis = await api.avisos(credM)
    expect(vis[0]).toMatchObject({ tipo: 'aviso', fixado: true })
    expect(vis.some((a) => a.titulo === 'Rascunho secreto')).toBe(false)
    expect(vis.filter((a) => a.tipo === 'faq')).toHaveLength(4)
  })

  it('sem login da equipe, painel é recusado', async () => {
    await expect(api.painel()).rejects.toThrow('sem_permissao')
  })
})
