/* =============================================================================
   Teste do banco de verdade: roda supabase/schema.sql num Postgres dentro do Node (PGlite) e
   chama as funções como o app chamaria, com o papel de cada um:
     'anon'      = morador que entra com apartamento + código
     { email }   = alguém logado por e-mail (equipe ou morador convidado)
     'servico'   = as funções do servidor (convite, envio de e-mail), com a chave de serviço
   O que o Supabase já traz pronto (esquema auth, auth.jwt(), papéis) é imitado no STUB abaixo.
   ============================================================================= */
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { FERIADOS_LOCAIS_PADRAO, SERVICOS_PADRAO } from '../src/config'
import { diasEspeciais } from '../src/feriados'
import { periodosDoDia } from '../src/regras'

const SCHEMA = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf-8')
const STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, last_sign_in_at timestamptz, email_confirmed_at timestamptz);
  create or replace function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
  -- Como o Supabase: tabelas novas nascem abertas para anon e authenticated (o schema.sql fecha).
  alter default privileges in schema public grant all on tables to anon, authenticated;
`
const PORTARIA = { email: 'portaria@condominio.example' }
const SINDICO = { email: 'sindico@condominio.example' }
const LUIZA = { email: 'luiza@exemplo.com' } // moradora que entra por e-mail
const AGORA = '2026-11-18T10:00' // quarta-feira

type Quem = 'anon' | 'super' | 'servico' | { email: string }
let db: PGlite

/** Entra no papel certo dentro de uma transação (o "set local" some no fim dela). */
async function comoQuem(tx: any, quem: Quem, agora: string) {
  await tx.query(`select set_config('cond.agora', $1, true)`, [agora])
  if (quem === 'super') return
  const papel = typeof quem === 'object' ? 'authenticated' : quem === 'servico' ? 'service_role' : 'anon'
  const claims = typeof quem === 'object' ? { email: quem.email, role: papel } : { role: papel }
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
  await tx.exec(`set local role ${papel}`)
}

/** Chama uma função como "quem" e devolve o JSON. */
async function chamar(quem: Quem, sql: string, args: unknown[] = [], agora = AGORA): Promise<any> {
  return db.transaction(async (tx) => {
    await comoQuem(tx, quem, agora)
    const r = await tx.query<{ r: any }>(`select ${sql} as r`, args)
    return r.rows[0].r
  })
}

/** Espera um erro de permissão do Postgres (ex.: anon lendo tabela). */
async function negado(quem: Quem, sql: string): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await comoQuem(tx, quem, AGORA)
      await tx.query(sql)
    })
    return false
  } catch (e) {
    return /permission denied/i.test(String(e))
  }
}

const json = (o: unknown) => JSON.stringify(o)
let codA = '' // código da moradora do 101
let codB = '' // código do morador do 202
let idLuiza = ''

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(STUB)
  await db.exec(SCHEMA)
  await db.exec(SCHEMA) // rodar duas vezes não pode quebrar (o roteiro manda rodar de novo após mudança)
  await db.exec(`
    insert into cond_equipe (email, nome, cargo, permissoes) values
      ('portaria@condominio.example', 'Jorge', 'Portaria', array['reservas', 'moradores', 'noticias']),
      ('sindico@condominio.example', 'Helena', 'Síndico', array['reservas', 'moradores', 'denuncias', 'noticias', 'admin']);`)
  codA = (await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Ana Prado', apto: ' 101 ' })])).codigo
  codB = (await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Tiago Nunes', apto: '202', telefone: '86 99999-0000' })])).codigo
  idLuiza = (await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Luíza Prado', apto: '301', email: 'Luiza@Exemplo.com', vaga: 'g-12' })])).id
})

describe('regras do banco = regras do app', () => {
  it('a tabela de serviços do banco é a mesma do src/config.ts (inclusive o que está desligado)', async () => {
    expect(await chamar('anon', 'cond_regras()')).toEqual(SERVICOS_PADRAO)
  })

  it('os horários de cada dia saem iguais no banco e no app (uma semana inteira)', async () => {
    for (const servico of ['lavagem', 'diaria'] as const) {
      for (let d = 15; d <= 21; d++) {
        const dia = `2026-11-${d}`
        const banco = await db.query<{ de: string }>(`select to_char(de, 'YYYY-MM-DD"T"HH24:MI') as de from cond_periodos($1, $2::date) order by de`, [servico, dia])
        const cfg = SERVICOS_PADRAO.find((s) => s.chave === servico)!.config
        expect(banco.rows.map((x) => x.de)).toEqual(periodosDoDia(cfg, dia, diasEspeciais(dia, dia, FERIADOS_LOCAIS_PADRAO)).map((p) => p.inicio))
      }
    }
  })
})

describe('morador: entrada', () => {
  it('cadastro sem e-mail gera código de 6 caracteres sem os que confundem', () => {
    expect(codA).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)
  })

  it('cadastro com e-mail não gera código e pede o convite', async () => {
    const r = await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Beatriz Lima', apto: '203', email: 'bia@exemplo.com' })])
    expect(r.codigo).toBeNull()
    expect(r.convidar).toBe(true)
  })

  it('entra com apto + código (aceita minúscula e espaço); código de outro apto não', async () => {
    expect(await chamar('anon', `cond_entrar('101', $1)`, [` ${codA.toLowerCase()} `])).toEqual({ nome: 'Ana Prado', apto: '101' })
    expect((await chamar('anon', `cond_entrar('101', $1)`, [codB])).erro).toBe('codigo_invalido')
  })

  it('entra pela sessão de e-mail (convite aceito), sem apartamento nem código', async () => {
    expect(await chamar(LUIZA, 'cond_entrar(null, null)')).toEqual({ nome: 'Luíza Prado', apto: '301' })
  })

  it('e-mail que não é de morador ativo recebe sem_cadastro', async () => {
    expect((await chamar({ email: 'estranho@x.example' }, 'cond_entrar(null, null)')).erro).toBe('sem_cadastro')
  })

  it('5 erros seguidos travam o apartamento, e o bloqueio fica gravado', async () => {
    const m = await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Sônia Barros', apto: '303' })])
    for (let i = 0; i < 5; i++) expect((await chamar('anon', `cond_entrar('303', 'ERRADO')`)).erro).toBe('codigo_invalido')
    expect((await chamar('anon', `cond_entrar('303', $1)`, [m.codigo])).erro).toBe('bloqueado')
  })

  it('morador desativado não entra, nem por código nem pela sessão de e-mail', async () => {
    const m = await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Ex Morador', apto: '404', email: 'ex@exemplo.com', gerar_codigo: true })])
    expect((await chamar({ email: 'ex@exemplo.com' }, 'cond_entrar(null, null)')).nome).toBe('Ex Morador')
    await chamar(PORTARIA, `cond_editar_morador($1, $2::jsonb)`, [m.id, json({ nome: 'Ex Morador', apto: '404', email: 'ex@exemplo.com', ativo: false })])
    expect((await chamar('anon', `cond_entrar('404', $1)`, [m.codigo])).erro).toBe('codigo_invalido')
    expect((await chamar({ email: 'ex@exemplo.com' }, 'cond_entrar(null, null)')).erro).toBe('sem_cadastro')
  })

  it('novo código: o antigo para de valer', async () => {
    const m = await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Rafael Duarte', apto: '505' })])
    const novo = (await chamar(PORTARIA, `cond_novo_codigo($1)`, [m.id])).codigo
    expect((await chamar('anon', `cond_entrar('505', $1)`, [m.codigo])).erro).toBe('codigo_invalido')
    expect((await chamar('anon', `cond_entrar('505', $1)`, [novo])).nome).toBe('Rafael Duarte')
  })
})

describe('morador: cadastro', () => {
  it('CPF com dígito errado é recusado; certo é guardado só com números', async () => {
    expect((await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Teste Cpf', apto: '601', cpf: '529.982.247-24' })])).erro).toBe('cpf_invalido')
    expect((await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Teste Cpf', apto: '601', cpf: '111.111.111-11' })])).erro).toBe('cpf_invalido')
    const ok = await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Teste Cpf', apto: '601', cpf: '529.982.247-25' })])
    const m = (await chamar(PORTARIA, 'cond_lista_moradores()')).itens.find((x: any) => x.id === ok.id)
    expect(m.cpf).toBe('52998224725')
  })

  it('e-mail repetido e e-mail mal escrito são recusados', async () => {
    expect((await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Outra', apto: '602', email: 'luiza@exemplo.com' })])).erro).toBe('email_repetido')
    expect((await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Outra', apto: '602', email: 'sem-arroba' })])).erro).toBe('email_invalido')
  })

  it('lista traz e-mail, vaga e informações de acesso, mas nunca o código', async () => {
    const r = await chamar(PORTARIA, 'cond_lista_moradores()')
    expect(r.itens.find((x: any) => x.id === idLuiza)).toMatchObject({ email: 'luiza@exemplo.com', vaga: 'G-12', tem_codigo: false, senha_criada: false })
    expect(JSON.stringify(r)).not.toMatch(/codigo_hash/)
  })

  it('convite: a portaria pede para morador; só quem tem "admin" pede para funcionário', async () => {
    expect((await chamar(PORTARIA, `cond_convite_pedir('morador', $1)`, [idLuiza])).email).toBe('luiza@exemplo.com')
    const eq = await db.query<{ id: string }>(`select id from cond_equipe where email = 'portaria@condominio.example'`)
    expect((await chamar(PORTARIA, `cond_convite_pedir('equipe', $1)`, [eq.rows[0].id])).erro).toBe('sem_permissao')
    expect((await chamar(SINDICO, `cond_convite_pedir('equipe', $1)`, [eq.rows[0].id])).email).toBe('portaria@condominio.example')
  })
})

describe('morador: reservas', () => {
  it('reserva a lavagem num horário livre', async () => {
    expect((await chamar('anon', `cond_solicitar('101', $1, 'lavagem', '2026-11-18T14:00', '{}'::jsonb)`, [codA])).protocolo).toBeGreaterThan(0)
  })

  it('o mesmo horário não pode ser reservado duas vezes (nem por quem entrou por e-mail)', async () => {
    expect((await chamar(LUIZA, `cond_solicitar(null, null, 'lavagem', '2026-11-18T14:00', '{}'::jsonb)`)).erro).toBe('ocupado')
  })

  it('horário que passou, fora da grade ou além do horizonte é recusado', async () => {
    const f = (inicio: string) => chamar('anon', `cond_solicitar('202', $1, 'lavagem', $2::timestamp, '{}'::jsonb)`, [codB, inicio])
    expect((await f('2026-11-18T08:00')).erro).toBe('horario_passou')
    expect((await f('2026-11-18T14:30')).erro).toBe('horario_invalido')
    expect((await f('2026-11-18T22:00')).erro).toBe('horario_invalido')
    expect((await f('2026-11-26T09:00')).erro).toBe('fora_do_horizonte')
  })

  it('diária: não abre no domingo; sem cobrança (desligada), nasce sem pagamento', async () => {
    const f = (inicio: string) => chamar('anon', `cond_solicitar('202', $1, 'diaria', $2::timestamp, '{}'::jsonb)`, [codB, inicio])
    expect((await f('2026-11-22T08:00')).erro).toBe('horario_invalido')
    const ok = await f('2026-11-19T13:00')
    expect((await chamar('anon', `cond_minhas('202', $1)`, [codB])).itens.find((x: any) => x.id === ok.id).pago).toBeNull()
  })

  it('com a cobrança ligada, a diária nasce com pagamento pendente', async () => {
    await db.exec(`update cond_servicos set config = jsonb_set(config, '{cobra}', 'true') where chave = 'diaria'`)
    const ok = await chamar('anon', `cond_solicitar('101', $1, 'diaria', '2026-11-21T08:00', '{}'::jsonb)`, [codA])
    expect((await chamar('anon', `cond_minhas('101', $1)`, [codA])).itens.find((x: any) => x.id === ok.id).pago).toBe(false)
    await db.exec(`update cond_servicos set config = jsonb_set(config, '{cobra}', 'false') where chave = 'diaria'`)
  })

  it('limite por semana: a 4ª lavagem da semana é recusada', async () => {
    const f = (inicio: string) => chamar('anon', `cond_solicitar('101', $1, 'lavagem', $2::timestamp, '{}'::jsonb)`, [codA, inicio])
    expect((await f('2026-11-19T07:00')).protocolo).toBeGreaterThan(0)
    expect((await f('2026-11-20T07:00')).protocolo).toBeGreaterThan(0)
    expect((await f('2026-11-21T07:00')).erro).toBe('limite_semana')
    expect((await f('2026-11-23T07:00')).protocolo).toBeGreaterThan(0)
  })

  it('ocupação mostra o horário ocupado sem dizer de quem', async () => {
    const r = await chamar('anon', `cond_ocupacao('202', $1, '2026-11-18', '2026-11-18')`, [codB])
    expect(r.itens).toEqual([{ servico: 'lavagem', inicio: '2026-11-18T14:00', fim: '2026-11-18T15:00', minha: false }])
    expect(JSON.stringify(r)).not.toMatch(/101|Ana/)
  })

  it('cancela a própria reserva e o horário volta a ficar livre', async () => {
    const r = await chamar('anon', `cond_solicitar('101', $1, 'lavagem', '2026-11-24T20:00', '{}'::jsonb)`, [codA])
    expect((await chamar('anon', `cond_cancelar('202', $1, $2)`, [codB, r.id])).erro).toBe('nao_encontrada')
    expect((await chamar('anon', `cond_cancelar('101', $1, $2)`, [codA, r.id])).ok).toBe(true)
    expect((await chamar(LUIZA, `cond_solicitar(null, null, 'lavagem', '2026-11-24T20:00', '{}'::jsonb)`)).protocolo).toBeGreaterThan(0)
  })
})

describe('estacionamento (desligado em 17/11)', () => {
  it('desligado: o pedido é recusado', async () => {
    const r = await chamar('anon', `cond_solicitar('202', $1, 'estacionamento', '2026-11-20T00:00', $2::jsonb)`, [codB, json({ ate: '2026-11-21', placa: 'ABC1D23' })])
    expect(r.erro).toBe('servico_inativo')
  })

  it('ligado de novo: funciona com as mesmas regras (placa, datas)', async () => {
    await db.exec(`update cond_servicos set ativo = true where chave = 'estacionamento'`)
    const f = (inicio: string, det: object) => chamar('anon', `cond_solicitar('202', $1, 'estacionamento', $2::timestamp, $3::jsonb)`, [codB, inicio, json(det)])
    expect((await f('2026-11-20T00:00', { ate: '2026-11-20', placa: 'AB1234' })).erro).toBe('placa_invalida')
    expect((await f('2026-11-17T00:00', { ate: '2026-11-18', placa: 'ABC1234' })).erro).toBe('data_invalida')
    const ok = await f('2026-11-20T00:00', { ate: '2026-11-21', placa: 'abc-1d23', extra: 'descartado' })
    const item = (await chamar('anon', `cond_minhas('202', $1)`, [codB])).itens.find((x: any) => x.id === ok.id)
    expect(item).toMatchObject({ status: 'aberta', inicio: '2026-11-20T00:00', fim: '2026-11-22T00:00', detalhes: { placa: 'ABC1D23' } })
    await db.exec(`update cond_servicos set ativo = false where chave = 'estacionamento'`)
  })
})

describe('denúncia', () => {
  let tokenAnon = ''
  let idAnon = ''
  let idIdent = ''

  it('anônima não grava apto nem morador, e devolve o token para acompanhar', async () => {
    const r = await chamar('anon', `cond_solicitar('101', $1, 'denuncia', null, $2::jsonb, true)`, [codA, json({ categoria: 'Barulho', local: 'Bloco B', descricao: 'Som alto depois das 23h quase todo dia' })])
    tokenAnon = r.token
    idAnon = r.id
    expect(tokenAnon).toMatch(/^[0-9a-f]{32}$/)
    const linha = await db.query<{ morador_id: string | null; apto: string | null }>('select morador_id, apto from cond_solicitacoes where id = $1', [idAnon])
    expect(linha.rows[0]).toEqual({ morador_id: null, apto: null })
  })

  it('quem denunciou acha a anônima só com o token', async () => {
    expect((await chamar('anon', `cond_minhas('101', $1)`, [codA])).itens.some((x: any) => x.id === idAnon)).toBe(false)
    const com = await chamar('anon', `cond_minhas('101', $1, $2::text[])`, [codA, [tokenAnon]])
    expect(com.itens.find((x: any) => x.id === idAnon)).toMatchObject({ anonima: true, apto: null })
  })

  it('descrição curta ou categoria fora da lista é recusada; sem limite de quantidade', async () => {
    const f = (det: object) => chamar('anon', `cond_solicitar('202', $1, 'denuncia', null, $2::jsonb)`, [codB, json(det)])
    expect((await f({ categoria: 'Barulho', descricao: 'curta' })).erro).toBe('descricao_curta')
    expect((await f({ categoria: 'Inventada', descricao: 'Descrição com tamanho suficiente' })).erro).toBe('categoria_invalida')
    for (let i = 0; i < 7; i++) expect((await f({ categoria: 'Obras', descricao: 'Obra fora do horário permitido' })).protocolo).toBeGreaterThan(0)
    idIdent = (await f({ categoria: 'Área comum', descricao: 'Lâmpada queimada na escada do 2º andar' })).id
  })

  it('sem a permissão "denuncias" (portaria) não vê denúncia nenhuma; o síndico vê', async () => {
    expect((await chamar(PORTARIA, 'cond_painel()')).itens.some((x: any) => x.servico === 'denuncia')).toBe(false)
    expect((await chamar(SINDICO, 'cond_painel()')).itens.filter((x: any) => x.servico === 'denuncia').length).toBe(9)
    expect((await chamar(PORTARIA, `cond_atualizar($1, 'em_analise')`, [idIdent])).erro).toBe('nao_encontrada')
  })

  it('resolver exige resposta, e quem denunciou lê a resposta com o cargo (nunca o nome)', async () => {
    expect((await chamar(SINDICO, `cond_atualizar($1, 'concluida')`, [idAnon])).erro).toBe('resposta_obrigatoria')
    expect((await chamar(SINDICO, `cond_atualizar($1, 'concluida', 'Morador notificado por escrito')`, [idAnon])).ok).toBe(true)
    const item = (await chamar('anon', `cond_minhas('101', $1, $2::text[])`, [codA, [tokenAnon]])).itens.find((x: any) => x.id === idAnon)
    expect(item.historico.at(-1)).toMatchObject({ status: 'concluida', nota: 'Morador notificado por escrito', por_papel: 'Síndico', por_nome: null })
  })
})

describe('equipe e permissões', () => {
  it('passagem fora da regra e cancelamento de reserva passada são recusados', async () => {
    const lav = (await chamar(PORTARIA, 'cond_painel()')).itens.find((x: any) => x.servico === 'lavagem' && x.inicio === '2026-11-18T14:00')
    expect((await chamar(PORTARIA, `cond_atualizar($1, 'em_analise')`, [lav.id])).erro).toBe('passagem_invalida')
    expect((await chamar(PORTARIA, `cond_atualizar($1, 'cancelada')`, [lav.id], '2026-11-18T16:00')).erro).toBe('passagem_invalida')
  })

  it('o síndico cadastra funcionário com poderes; quem não tem "admin" não vê a equipe', async () => {
    const r = await chamar(SINDICO, `cond_salvar_equipe(null, $1::jsonb)`, [json({ email: 'Zelador@Condominio.example', nome: 'Rita', cargo: 'Zeladoria', permissoes: ['reservas'] })])
    expect(r.convidar).toBe(true)
    expect((await chamar(PORTARIA, 'cond_lista_equipe()')).erro).toBe('sem_permissao')
    const zel = { email: 'zelador@condominio.example' }
    expect(await chamar(zel, 'cond_eu()')).toEqual({ nome: 'Rita', cargo: 'Zeladoria', permissoes: ['reservas'] })
    expect((await chamar(zel, 'cond_lista_moradores()')).erro).toBe('sem_permissao') // não tem "moradores"
    await chamar(SINDICO, `cond_salvar_equipe($1, $2::jsonb)`, [r.id, json({ email: 'zelador@condominio.example', nome: 'Rita', cargo: 'Zeladoria', permissoes: ['reservas'], ativo: false })])
    expect(await chamar(zel, 'cond_eu()')).toBeNull()
    expect((await chamar(zel, 'cond_painel()')).erro).toBe('sem_permissao')
  })

  it('não deixa o condomínio sem ninguém com "admin"', async () => {
    const eq = await db.query<{ id: string }>(`select id from cond_equipe where email = 'sindico@condominio.example'`)
    const r = await chamar(SINDICO, `cond_salvar_equipe($1, $2::jsonb)`, [eq.rows[0].id, json({ email: 'sindico@condominio.example', nome: 'Helena', cargo: 'Síndico', permissoes: ['reservas'] })])
    expect(r.erro).toBe('ultimo_admin')
    expect((await chamar(SINDICO, 'cond_eu()')).permissoes).toContain('admin')
  })

  it('histórico do morador: solicitações dele e o que a equipe fez no cadastro', async () => {
    const h = await chamar(SINDICO, `cond_historico_morador($1)`, [idLuiza])
    expect(h.solicitacoes.length).toBeGreaterThan(0)
    expect(h.auditoria.map((a: any) => a.acao)).toEqual(expect.arrayContaining(['morador_cadastrado', 'convite_enviado']))
  })

  it('desativar o morador cancela as reservas futuras e libera o horário', async () => {
    const m = await chamar(PORTARIA, `cond_criar_morador($1::jsonb)`, [json({ nome: 'Otávio Mendes', apto: '707' })])
    expect((await chamar('anon', `cond_solicitar('707', $1, 'lavagem', '2026-11-21T21:00', '{}'::jsonb)`, [m.codigo])).protocolo).toBeGreaterThan(0)
    const e = await chamar(PORTARIA, `cond_editar_morador($1, $2::jsonb)`, [m.id, json({ nome: 'Otávio Mendes', apto: '707', ativo: false })])
    expect(e.canceladas).toBe(1)
    const ocup = (await chamar('anon', `cond_ocupacao('202', $1, '2026-11-21', '2026-11-21')`, [codB])).itens
    expect(ocup.some((o: any) => o.inicio === '2026-11-21T21:00')).toBe(false)
  })

  it('painel com período devolve só o que toca o intervalo', async () => {
    const comData = (await chamar(SINDICO, `cond_painel('2026-11-19', '2026-11-19')`)).itens.filter((x: any) => x.inicio)
    expect(comData.length).toBeGreaterThan(0)
    expect(comData.every((x: any) => x.inicio.slice(0, 10) <= '2026-11-19' && x.fim >= '2026-11-19')).toBe(true)
  })
})

describe('notícias (e-mail para os moradores)', () => {
  it('os dois modelos prontos existem: aviso de denúncia e encomenda na portaria', async () => {
    expect((await chamar(PORTARIA, 'cond_lista_modelos()')).itens.map((m: any) => m.nome)).toEqual(['Aviso de denúncia', 'Encomenda na portaria'])
  })

  it('envio para todos vai só para quem tem e-mail e está ativo; o servidor pega e conclui', async () => {
    const r = await chamar(PORTARIA, `cond_criar_envio('Aviso', 'Olá, {{nome}}', '{"todos": true}'::jsonb)`)
    expect(r.destinatarios).toBe(2) // Luíza e Beatriz (o ex-morador está desativado)
    const meu = (await chamar('servico', 'cond_envios_devidos()')).find((d: any) => d.id === r.id)
    expect(meu.destinatarios.map((d: any) => d.email).sort()).toEqual(['bia@exemplo.com', 'luiza@exemplo.com'])
    expect((await chamar('servico', 'cond_envios_devidos()')).some((d: any) => d.id === r.id)).toBe(false) // já pego
    await chamar('servico', `cond_envio_concluir($1, $2::jsonb)`, [r.id, json(meu.destinatarios.map((d: any) => ({ id: d.id, email: d.email, ok: true })))])
    expect((await chamar(PORTARIA, 'cond_lista_envios()')).itens.find((x: any) => x.id === r.id)).toMatchObject({ ativo: false, total_enviados: 2, falhas: 0 })
  })

  it('envio semanal: depois de mandar, marca a próxima semana', async () => {
    const r = await chamar(PORTARIA, `cond_criar_envio('Lembrete', 'Coleta seletiva amanhã', $1::jsonb, null, 'semanal')`, [json({ ids: [idLuiza] })])
    expect(r.destinatarios).toBe(1)
    await chamar('servico', 'cond_envios_devidos()')
    const c = await chamar('servico', `cond_envio_concluir($1, '[]'::jsonb)`, [r.id])
    expect(new Date(c.proximo).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000)
    expect((await chamar(PORTARIA, `cond_cancelar_envio($1)`, [r.id])).ok).toBe(true)
  })

  it('sem destinatário com e-mail, não cria; sem a permissão, não envia', async () => {
    expect((await chamar(PORTARIA, `cond_criar_envio('X', 'Y', $1::jsonb)`, [json({ ids: ['00000000-0000-0000-0000-000000000000'] })])).erro).toBe('sem_destinatarios')
    expect((await chamar({ email: 'estranho@x.example' }, `cond_criar_envio('X', 'Y', '{"todos": true}'::jsonb)`)).erro).toBe('sem_permissao')
  })

  it('só o servidor pega os envios (nem morador nem equipe)', async () => {
    expect(await negado('anon', 'select cond_envios_devidos()')).toBe(true)
    expect(await negado(PORTARIA, 'select cond_envios_devidos()')).toBe(true)
  })
})

describe('notificações (avisos e perguntas frequentes)', () => {
  it('o morador vê avisos publicados primeiro (fixado no topo) e as perguntas; rascunho não aparece', async () => {
    await chamar(SINDICO, `cond_salvar_aviso(null, $1::jsonb)`, [json({ tipo: 'aviso', titulo: 'Manutenção do elevador', texto: 'Sábado das 8h às 12h.', fixado: true })])
    await chamar(SINDICO, `cond_salvar_aviso(null, $1::jsonb)`, [json({ tipo: 'aviso', titulo: 'Rascunho', texto: 'ainda não', publicado: false })])
    const vis = (await chamar('anon', `cond_avisos_morador('101', $1)`, [codA])).itens
    expect(vis[0]).toMatchObject({ tipo: 'aviso', titulo: 'Manutenção do elevador', fixado: true })
    expect(vis.filter((x: any) => x.tipo === 'faq')).toHaveLength(4)
    expect(vis.some((x: any) => x.titulo === 'Rascunho')).toBe(false)
    expect(JSON.stringify(vis)).not.toMatch(/Helena/) // quem editou não aparece para o morador
    expect((await chamar(SINDICO, 'cond_lista_avisos()')).itens.some((x: any) => x.titulo === 'Rascunho')).toBe(true)
  })

  it('sem entrar não lê; sem "noticias" não edita', async () => {
    expect((await chamar('anon', `cond_avisos_morador('101', 'ERRADO')`)).erro).toBe('codigo_invalido')
    expect((await chamar({ email: 'estranho@x.example' }, `cond_salvar_aviso(null, '{"tipo":"aviso","titulo":"X","texto":"Y"}'::jsonb)`)).erro).toBe('sem_permissao')
    expect((await chamar(SINDICO, `cond_salvar_aviso(null, '{"tipo":"outro","titulo":"X","texto":"Y"}'::jsonb)`)).erro).toBe('dados_invalidos')
  })
})

describe('feriados (Belo Horizonte)', () => {
  it('2026: nacionais, os 4 de BH, Carnaval e as emendas', async () => {
    const r = await chamar('anon', `cond_feriados('2026-01-01', '2026-12-31')`)
    expect(r.itens.map((x: any) => `${x.dia} ${x.tipo} ${x.nome}`)).toEqual([
      '2026-01-01 feriado Confraternização Universal',
      '2026-01-02 facultativo Emenda de Confraternização Universal', // 01/01/2026 é quinta
      '2026-02-16 facultativo Carnaval',
      '2026-02-17 facultativo Carnaval',
      '2026-04-03 feriado Sexta-feira da Paixão',
      '2026-04-20 facultativo Emenda de Tiradentes',
      '2026-04-21 feriado Tiradentes',
      '2026-05-01 feriado Dia do Trabalho',
      '2026-06-04 feriado Corpus Christi',
      '2026-06-05 facultativo Emenda de Corpus Christi',
      '2026-08-15 feriado Assunção de Nossa Senhora',
      '2026-09-07 feriado Independência do Brasil',
      '2026-10-12 feriado Nossa Senhora Aparecida',
      '2026-11-02 feriado Finados',
      '2026-11-15 feriado Proclamação da República',
      '2026-11-20 feriado Dia da Consciência Negra',
      '2026-12-07 facultativo Emenda de Imaculada Conceição',
      '2026-12-08 feriado Imaculada Conceição',
      '2026-12-25 feriado Natal',
    ])
  })

  it('o cálculo do banco e o do app dão o mesmo resultado de 2024 a 2035', async () => {
    expect((await chamar('anon', `cond_feriados('2024-01-01', '2035-12-31')`)).erro).toBe('periodo_invalido')
    for (let ano = 2024; ano <= 2035; ano++) {
      const banco = (await chamar('anon', `cond_feriados($1::date, $2::date)`, [`${ano}-01-01`, `${ano}-12-31`])).itens
      expect(banco, String(ano)).toEqual(diasEspeciais(`${ano}-01-01`, `${ano}-12-31`, FERIADOS_LOCAIS_PADRAO))
    }
  })

  it('diária fecha no feriado (com o motivo certo); lavagem abre', async () => {
    expect((await chamar('anon', `cond_solicitar('202', $1, 'diaria', '2026-11-20T08:00', '{}'::jsonb)`, [codB])).erro).toBe('dia_fechado')
    expect((await chamar('anon', `cond_solicitar('202', $1, 'lavagem', '2026-11-20T21:00', '{}'::jsonb)`, [codB])).protocolo).toBeGreaterThan(0)
  })

  it('quem tem "admin" marca e desfaz feriado; a portaria não pode', async () => {
    expect((await chamar(PORTARIA, `cond_ajustar_dia('2026-11-23', 'feriado', 'X')`)).erro).toBe('sem_permissao')
    expect((await chamar(SINDICO, `cond_ajustar_dia('2026-11-23', 'feriado', 'Decreto da prefeitura')`)).ok).toBe(true)
    expect((await chamar('anon', `cond_solicitar('101', $1, 'diaria', '2026-11-23T08:00', '{}'::jsonb)`, [codA])).erro).toBe('dia_fechado')
    await chamar(SINDICO, `cond_ajustar_dia('2026-11-23', null)`)
    expect((await chamar('anon', `cond_feriados('2026-11-23', '2026-11-23')`)).itens).toEqual([])
  })
})

describe('portas fechadas', () => {
  it('apartamento inventado não grava tentativa (não enche a tabela)', async () => {
    const antes = (await db.query<{ n: number }>('select count(*)::int as n from cond_tentativas')).rows[0].n
    expect((await chamar('anon', `cond_entrar('../../ETC', 'X')`)).erro).toBe('codigo_invalido')
    expect((await chamar('anon', `cond_entrar(repeat('9', 500), 'X')`)).erro).toBe('codigo_invalido')
    expect((await db.query<{ n: number }>('select count(*)::int as n from cond_tentativas')).rows[0].n).toBe(antes)
  })

  it('ninguém lê tabela direto (nem morador nem equipe)', async () => {
    for (const t of ['cond_moradores', 'cond_solicitacoes', 'cond_historico', 'cond_equipe', 'cond_tentativas', 'cond_auditoria', 'cond_dias_ajuste', 'cond_modelos', 'cond_envios', 'cond_envio_log', 'cond_avisos']) {
      expect(await negado('anon', `select * from ${t}`), t).toBe(true)
      expect(await negado(SINDICO, `select * from ${t}`), t).toBe(true)
    }
  })

  it('morador (anon) não chama as funções da equipe nem as internas', async () => {
    for (const f of ['cond_painel()', 'cond_lista_moradores()', `cond_criar_morador('{}'::jsonb)`, 'cond_lista_equipe()', 'cond_lista_auditoria()', `cond_ajustar_dia('2026-11-23', 'feriado')`, 'cond_lista_envios()', 'cond_lista_avisos()']) {
      expect(await negado('anon', `select ${f}`), f).toBe(true)
    }
    expect(await negado('anon', `select * from cond_conferir('101', 'AAAAAA')`)).toBe(true)
  })

  it('alguém logado que não é da equipe recebe sem_permissao', async () => {
    const estranho = { email: 'estranho@x.example' }
    expect((await chamar(estranho, 'cond_painel()')).erro).toBe('sem_permissao')
    expect((await chamar(estranho, `cond_criar_morador('{"nome":"X","apto":"1"}'::jsonb)`)).erro).toBe('sem_permissao')
    expect(await chamar(estranho, 'cond_eu()')).toBeNull()
  })
})
