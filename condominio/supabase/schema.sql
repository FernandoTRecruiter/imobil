-- =============================================================================
-- Condomínio: o banco inteiro (Supabase / Postgres 15+).
--
-- Como usar: no painel do Supabase, SQL Editor, colar este arquivo e rodar. Pode rodar de novo
-- depois de uma mudança: tudo usa "if not exists" ou "create or replace", e os serviços são
-- regravados com os valores daqui.
--
-- Segurança, em poucas frases:
--   - O MORADOR entra de dois jeitos: e-mail e senha (convite que a portaria manda; o Supabase Auth
--     cuida da senha) ou apartamento + código (para quem não usa e-mail). As funções cond_* conferem
--     um dos dois a cada chamada.
--   - A EQUIPE entra com e-mail e senha. Quem ela é e o que pode fazer está em cond_equipe
--     (permissões marcadas pelo síndico), achada pelo e-mail confirmado da sessão.
--   - Ninguém lê nem grava as tabelas direto: tudo passa por uma função que confere a regra.
--
-- Hora: o condomínio vive no horário de Brasília. "inicio" e "fim" são hora local, sem fuso
-- (timestamp), e "agora" vem de cond_agora().
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Serviços: as regras de cada serviço (horários, quantos dias à frente, limite por semana).
--    É o ÚNICO lugar de onde o app tira essas regras em produção. Para mudar um horário, mudar
--    aqui e rodar o arquivo de novo (o src/config.ts tem a mesma tabela para o modo demonstração;
--    o teste tests/banco.test.ts avisa se os dois ficarem diferentes).
--    ativo: false = o serviço some do app (estacionamento, desligado em 17/11).
--    dias: 0 = domingo ... 6 = sábado.
--    feriado / facultativo: "fecha" = sem horários nesses dias; "abre" = funciona normal.
--    cobra: true = nasce com "pagamento pendente" e a equipe marca quando recebe (desligado em 17/11).
-- -----------------------------------------------------------------------------
create table if not exists cond_servicos (
  chave text primary key check (chave in ('lavagem', 'diaria', 'estacionamento', 'denuncia')),
  nome text not null,
  ativo boolean not null default true,
  config jsonb not null
);
alter table cond_servicos add column if not exists ativo boolean not null default true;

insert into cond_servicos (chave, nome, ativo, config) values
  ('lavagem', 'Lavagem e secagem', true,
   '{"tipo":"horario","abre":"07:00","fecha":"22:00","minutos":60,"dias":[0,1,2,3,4,5,6],"horizonte":7,"por_semana":3,"feriado":"abre","facultativo":"abre","cobra":false}'),
  ('diaria', 'Diária', true,
   '{"tipo":"periodo","periodos":[{"rotulo":"Manhã","de":"08:00","ate":"12:00"},{"rotulo":"Tarde","de":"13:00","ate":"17:00"}],"dias":[1,2,3,4,5,6],"horizonte":14,"por_semana":2,"feriado":"fecha","facultativo":"abre","cobra":false}'),
  ('estacionamento', 'Estacionamento', false,
   '{"tipo":"pedido","max_dias":7,"cobra":false}'),
  ('denuncia', 'Denúncia', true,
   '{"tipo":"denuncia","categorias":["Barulho","Área comum","Segurança","Animais","Lixo e limpeza","Obras","Outro"]}')
on conflict (chave) do update set nome = excluded.nome, ativo = excluded.ativo, config = excluded.config;

-- -----------------------------------------------------------------------------
-- 1b. Feriados. Calculados pelo próprio banco, para qualquer ano, sem serviço de fora:
--     - nacionais fixos (lei) e Carnaval (ponto facultativo, calculado pela Páscoa): em cond_dias_especiais;
--     - os da cidade e do estado: tabela cond_feriados_locais (data fixa OU dias depois da Páscoa);
--     - emendas: feriado na terça faz da segunda uma emenda; feriado na quinta faz da sexta;
--     - ajustes do síndico: cond_dias_ajuste (decreto de ponto facultativo, emenda que não houve,
--       dia que o condomínio fecha). O ajuste vence o cálculo.
-- -----------------------------------------------------------------------------
create table if not exists cond_feriados_locais (
  nome text primary key,
  mes int check (mes between 1 and 12),
  dia int check (dia between 1 and 31),
  pascoa int, -- dias depois do domingo de Páscoa (negativo = antes); preenchido no lugar de mes/dia
  lei text,
  check ((pascoa is null) <> (mes is null and dia is null))
);
-- Belo Horizonte (Lei municipal 11.397/2022). Só entra se a tabela estiver vazia: rodar o arquivo de
-- novo não desfaz a troca de cidade. Outra cidade: apagar estas linhas e inserir as dela.
-- A Sexta-feira da Paixão é municipal pela Lei 9.093/1995 (cada cidade declara); BH declara.
insert into cond_feriados_locais (nome, mes, dia, pascoa, lei)
select * from (values
  ('Sexta-feira da Paixão', null::int, null::int, -2, 'BH, Lei 11.397/2022'),
  ('Corpus Christi', null, null, 60, 'BH, Lei 11.397/2022'),
  ('Assunção de Nossa Senhora', 8, 15, null::int, 'BH, Lei 11.397/2022'),
  ('Imaculada Conceição', 12, 8, null, 'BH, Lei 11.397/2022')
) v
where not exists (select 1 from cond_feriados_locais);

create table if not exists cond_dias_ajuste (
  dia date primary key,
  tipo text not null check (tipo in ('feriado', 'facultativo', 'normal')), -- normal = apaga o calculado
  nome text check (nome is null or length(nome) <= 80),
  por_nome text,
  em timestamptz not null default now()
);


-- -----------------------------------------------------------------------------
-- 2. Tabelas
-- -----------------------------------------------------------------------------

-- CPF: confere os dois dígitos verificadores (e recusa 111.111.111-11 e parecidos).
create or replace function cond_cpf_valido(p text) returns boolean
language plpgsql immutable as $$
declare
  d int[];
  s int;
  r int;
begin
  if p is null or p !~ '^[0-9]{11}$' or p ~ '^(.)\1{10}$' then return false; end if;
  d := array(select substr(p, i, 1)::int from generate_series(1, 11) i);
  s := 0;
  for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
  r := (s * 10) % 11;
  if r = 10 then r := 0; end if;
  if r <> d[10] then return false; end if;
  s := 0;
  for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
  r := (s * 10) % 11;
  if r = 10 then r := 0; end if;
  return r = d[11];
end;
$$;

-- Moradores: cadastrados pela portaria. Entram por e-mail (convite) ou por código; um dos dois é
-- obrigatório. O código fica só como hash (bcrypt): nem a equipe consegue ler depois.
create table if not exists cond_moradores (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 2 and 120),
  apto text not null check (apto ~ '^[A-Z0-9-]{1,10}$'),
  telefone text check (telefone is null or length(telefone) <= 30),
  email text check (email is null or (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(email) <= 200)),
  cpf text check (cpf is null or cond_cpf_valido(cpf)),
  vaga text check (vaga is null or length(vaga) <= 20), -- vaga de garagem do morador (nulo = não tem)
  desde date, -- desde quando mora (para o tempo de estadia); nulo = data do cadastro
  codigo_hash text,
  codigo_gerado_em timestamptz,
  convite_enviado_em timestamptz,
  ultimo_acesso timestamptz,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  check (email is not null or codigo_hash is not null)
);
create index if not exists cond_moradores_apto on cond_moradores (apto);
create unique index if not exists cond_moradores_email on cond_moradores (email) where email is not null;

-- Tentativas de entrada erradas por apartamento: 5 erros seguidos travam o apartamento por 15 min.
create table if not exists cond_tentativas (
  apto text primary key,
  falhas int not null default 0,
  bloqueado_ate timestamptz
);

-- Equipe: quem entra no painel e o que cada um pode fazer. A pessoa é achada pelo e-mail da sessão.
--   reservas  = calendário, solicitações (menos denúncia), cancelar reserva, liberar vaga, pagamento
--   moradores = cadastrar, editar, desativar, código novo, convite, histórico
--   denuncias = ver e responder denúncias
--   noticias  = e-mails para os moradores (em massa, agendados, modelos)
--   admin     = estatísticas, funcionários e permissões, feriados, auditoria
create table if not exists cond_equipe (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  nome text not null check (length(btrim(nome)) between 2 and 120),
  cargo text not null check (length(btrim(cargo)) between 2 and 40),
  permissoes text[] not null default '{}' check (permissoes <@ array['reservas', 'moradores', 'denuncias', 'noticias', 'admin']),
  ativo boolean not null default true,
  convite_enviado_em timestamptz,
  criado_em timestamptz not null default now()
);

-- Solicitações: tudo o que o morador pede (reserva, estacionamento, denúncia) numa tabela só.
--   pago: só nos serviços que cobram; nulo nos outros.
--   morador_id e apto: nulos na denúncia anônima, que só é achada de volta pelo token
--   (o celular de quem denunciou guarda o token; o banco guarda só o hash dele).
create table if not exists cond_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  protocolo bigint generated always as identity unique,
  servico text not null references cond_servicos (chave),
  morador_id uuid references cond_moradores (id),
  apto text,
  inicio timestamp,
  fim timestamp,
  status text not null check (status in ('aberta', 'em_analise', 'confirmada', 'concluida', 'recusada', 'cancelada')),
  pago boolean,
  detalhes jsonb not null default '{}',
  token_hash text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- Um horário de lavagem ou período de diária só pode ter UMA reserva ativa.
create unique index if not exists cond_solicitacoes_horario_unico
  on cond_solicitacoes (servico, inicio)
  where servico in ('lavagem', 'diaria') and status not in ('cancelada', 'recusada');
create index if not exists cond_solicitacoes_inicio on cond_solicitacoes (inicio);
create index if not exists cond_solicitacoes_morador on cond_solicitacoes (morador_id);

-- Histórico: cada mudança de situação e cada resposta. por_papel = 'morador' ou o cargo de quem
-- respondeu (o morador lê o cargo, nunca o nome).
create table if not exists cond_historico (
  id bigint generated always as identity primary key,
  solicitacao_id uuid not null references cond_solicitacoes (id) on delete cascade,
  status text not null,
  nota text check (nota is null or length(nota) <= 1000),
  por_papel text not null,
  por_nome text,
  em timestamptz not null default now()
);
create index if not exists cond_historico_solicitacao on cond_historico (solicitacao_id);

-- Auditoria do que a equipe faz fora das solicitações (cadastro, código, convite, permissões,
-- feriado, e-mail). alvo_id liga a linha ao morador ou funcionário (para o histórico de cada um).
create table if not exists cond_auditoria (
  id bigint generated always as identity primary key,
  acao text not null,
  alvo text,
  alvo_id uuid,
  detalhe text,
  por_papel text,
  por_nome text,
  em timestamptz not null default now()
);
alter table cond_auditoria add column if not exists alvo_id uuid;
create index if not exists cond_auditoria_alvo on cond_auditoria (alvo_id);

-- Notícias: modelos de e-mail, envios (agora, agendados ou recorrentes) e o registro de cada envio.
-- Quem manda de verdade é a função supabase/functions/enviar-noticias (ver docs/PUBLICAR.md).
create table if not exists cond_modelos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 2 and 60),
  assunto text not null check (length(btrim(assunto)) between 1 and 150),
  corpo text not null check (length(btrim(corpo)) between 1 and 5000),
  criado_em timestamptz not null default now()
);
-- Os dois modelos prontos. Só entram se não houver nenhum (rodar de novo não duplica).
insert into cond_modelos (nome, assunto, corpo)
select * from (values
  ('Aviso de denúncia', 'Aviso da administração',
   E'Olá, {{nome}}.\n\nA administração recebeu relatos sobre uma situação envolvendo o apartamento {{apto}}: [descreva o ocorrido, sem citar quem relatou].\n\nPedimos a sua atenção às regras do condomínio para que a convivência siga boa para todos. Se quiser conversar sobre o assunto, procure a administração.\n\nAtenciosamente,\nAdministração do {{condominio}}'),
  ('Encomenda na portaria', 'Sua encomenda está na portaria',
   E'Olá, {{nome}}.\n\nHá uma encomenda para o apartamento {{apto}} aguardando na portaria há alguns dias. Por favor, retire assim que puder.\n\nObrigado,\nPortaria do {{condominio}}')
) v
where not exists (select 1 from cond_modelos);

create table if not exists cond_envios (
  id uuid primary key default gen_random_uuid(),
  assunto text not null check (length(btrim(assunto)) between 1 and 150),
  corpo text not null check (length(btrim(corpo)) between 1 and 5000),
  destino jsonb not null, -- {"todos": true} ou {"ids": ["<id do morador>", ...]}
  quando timestamptz not null, -- próximo envio
  recorrencia text check (recorrencia is null or recorrencia in ('diaria', 'semanal', 'mensal')),
  ativo boolean not null default true, -- false = já enviado (sem repetição) ou cancelado
  cancelado boolean not null default false,
  processando_em timestamptz, -- trava contra duas execuções mandarem o mesmo e-mail
  ultimo_envio timestamptz,
  total_enviados int not null default 0,
  criado_por text,
  criado_em timestamptz not null default now()
);
create index if not exists cond_envios_quando on cond_envios (quando) where ativo;

create table if not exists cond_envio_log (
  id bigint generated always as identity primary key,
  envio_id uuid not null references cond_envios (id) on delete cascade,
  morador_id uuid,
  email text,
  ok boolean not null,
  erro text,
  em timestamptz not null default now()
);
create index if not exists cond_envio_log_envio on cond_envio_log (envio_id);

-- Avisos e perguntas frequentes da aba "Notificações" do morador. O síndico (permissão "noticias")
-- escreve, ordena, fixa no topo e publica; rascunho não aparece para o morador.
create table if not exists cond_avisos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('aviso', 'faq')),
  titulo text not null check (length(btrim(titulo)) between 2 and 120),
  texto text not null check (length(btrim(texto)) between 1 and 4000),
  fixado boolean not null default false, -- aviso fixado fica no topo
  publicado boolean not null default true,
  ordem int not null default 0, -- ordem das perguntas frequentes
  atualizado_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
-- Perguntas frequentes de partida (só entram se a tabela estiver vazia).
insert into cond_avisos (tipo, titulo, texto, ordem)
select * from (values
  ('faq', 'Como reservo a lavanderia?', 'Em Solicitar, escolha Lavagem e secagem, o dia e um horário livre. Cada horário tem 1 hora e cada apartamento pode reservar até 3 vezes por semana.', 1),
  ('faq', 'Posso cancelar uma reserva?', 'Sim, até o horário começar: em Solicitar, abra a reserva em Acompanhar e toque em Cancelar.', 2),
  ('faq', 'A denúncia anônima é mesmo anônima?', 'É. O sistema não grava o seu apartamento nem o seu nome. Só o seu celular consegue acompanhar a resposta do síndico.', 3),
  ('faq', 'Esqueci o código ou a senha', 'Código: peça um novo na portaria. Senha: na tela de entrada, toque em Esqueci a senha e siga o link que chega no seu e-mail.', 4)
) v (tipo, titulo, texto, ordem)
where not exists (select 1 from cond_avisos);

-- -----------------------------------------------------------------------------
-- 3. Funções de apoio (internas: o app não chama)
-- -----------------------------------------------------------------------------

-- "Agora" no relógio do condomínio. O ajuste cond.agora existe só para os testes fixarem a hora.
create or replace function cond_agora() returns timestamp
language sql stable as $$
  select coalesce(nullif(current_setting('cond.agora', true), '')::timestamp,
                  (now() at time zone 'America/Sao_Paulo')::timestamp)
$$;

-- Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). Carnaval, Paixão e
-- Corpus Christi saem dele. O mesmo cálculo está em src/feriados.ts (o teste compara os dois).
create or replace function cond_pascoa(p_ano int) returns date
language plpgsql immutable as $$
declare
  a int := p_ano % 19;
  b int := p_ano / 100;
  c int := p_ano % 100;
  d int := b / 4;
  e int := b % 4;
  f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;
  k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
begin
  return make_date(p_ano, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end;
$$;

-- Feriados, pontos facultativos e emendas entre duas datas, já com os ajustes do síndico.
-- tipo: 'feriado' ou 'facultativo'. origem: nacional, local, emenda ou ajuste.
create or replace function cond_dias_especiais(p_de date, p_ate date)
returns table (dia date, tipo text, nome text, origem text)
language sql stable set search_path = public as $$
  with anos as (
    select generate_series(extract(year from p_de)::int, extract(year from p_ate)::int) as ano
  ),
  base as (
    -- Nacionais (Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023)
    select make_date(a.ano, n.mes, n.dia) as dia, 'feriado' as tipo, n.nome, 'nacional' as origem
      from anos a cross join (values
        (1, 1, 'Confraternização Universal'), (4, 21, 'Tiradentes'), (5, 1, 'Dia do Trabalho'),
        (9, 7, 'Independência do Brasil'), (10, 12, 'Nossa Senhora Aparecida'), (11, 2, 'Finados'),
        (11, 15, 'Proclamação da República'), (11, 20, 'Dia da Consciência Negra'), (12, 25, 'Natal')
      ) n (mes, dia, nome)
    union all
    -- Carnaval: ponto facultativo (segunda e terça, 48 e 47 dias antes da Páscoa)
    select cond_pascoa(a.ano) - x.antes, 'facultativo', 'Carnaval', 'nacional'
      from anos a cross join (values (48), (47)) x (antes)
    union all
    -- Estado e cidade
    select case when l.pascoa is not null then cond_pascoa(a.ano) + l.pascoa else make_date(a.ano, l.mes, l.dia) end,
           'feriado', l.nome, 'local'
      from anos a cross join cond_feriados_locais l
  ),
  -- Um registro por dia; feriado vence ponto facultativo.
  unicos as (
    select distinct on (b.dia) b.* from base b order by b.dia, (b.tipo = 'feriado') desc, b.nome
  ),
  emendas as (
    select distinct on (1)
           case extract(dow from u.dia)::int when 2 then u.dia - 1 else u.dia + 1 end as dia,
           'facultativo' as tipo, 'Emenda de ' || u.nome as nome, 'emenda' as origem
      from unicos u
     where u.tipo = 'feriado' and extract(dow from u.dia)::int in (2, 4)
     order by 1, u.nome
  ),
  tudo as (
    select * from unicos
    union all
    select e.* from emendas e where not exists (select 1 from unicos u where u.dia = e.dia)
  )
  select t.dia, t.tipo, t.nome, t.origem from tudo t
   where t.dia between p_de and p_ate and not exists (select 1 from cond_dias_ajuste j where j.dia = t.dia)
  union all
  select j.dia, j.tipo, coalesce(j.nome, case j.tipo when 'feriado' then 'Feriado' else 'Ponto facultativo' end), 'ajuste'
    from cond_dias_ajuste j
   where j.tipo <> 'normal' and j.dia between p_de and p_ate
  order by 1
$$;

-- Os horários reserváveis de um serviço num dia (lavagem: blocos; diária: manhã e tarde).
-- Faz as contas em minutos do dia (inteiro) para nunca dar a volta na meia-noite.
create or replace function cond_periodos(p_servico text, p_dia date)
returns table (de timestamp, ate timestamp, rotulo text)
language plpgsql stable as $$
declare
  c jsonb;
  m int;
  t int;
  fim int;
  esp text;
begin
  select config into c from cond_servicos where chave = p_servico;
  if c is null or not (c ? 'dias') then return; end if;
  -- Feriado ou ponto facultativo num serviço que fecha nesses dias: nenhum horário.
  select x.tipo into esp from cond_dias_especiais(p_dia, p_dia) x limit 1;
  if esp is not null and coalesce(c ->> esp, 'abre') = 'fecha' then return; end if;
  -- Dia fechado (ex.: diária no domingo): nenhum horário.
  if not exists (select 1 from jsonb_array_elements_text(c -> 'dias') d where d::int = extract(dow from p_dia)::int) then
    return;
  end if;
  if c ->> 'tipo' = 'horario' then
    m := (c ->> 'minutos')::int;
    t := extract(epoch from (c ->> 'abre')::time)::int / 60;
    fim := extract(epoch from (c ->> 'fecha')::time)::int / 60;
    while t + m <= fim loop
      de := p_dia + make_interval(mins => t);
      ate := p_dia + make_interval(mins => t + m);
      rotulo := to_char(de, 'HH24:MI');
      return next;
      t := t + m;
    end loop;
  elsif c ->> 'tipo' = 'periodo' then
    return query
      select p_dia + (p ->> 'de')::time, p_dia + (p ->> 'ate')::time, p ->> 'rotulo'
      from jsonb_array_elements(c -> 'periodos') p;
  end if;
end;
$$;

-- E-mail confirmado da sessão (nulo = sem login por e-mail, como o morador que usa código).
create or replace function cond_email_sessao() returns text
language sql stable as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
$$;

-- Confere quem é o morador: (1) sessão por e-mail de um morador ativo; senão (2) apartamento +
-- código. Devolve o morador ou o erro. Não usa "raise" no erro de propósito: um erro desfaz a
-- transação inteira e apagaria a contagem de tentativas (e o bloqueio nunca aconteceria).
create or replace function cond_conferir(p_apto text, p_codigo text, out r cond_moradores, out erro text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  t cond_tentativas;
  sessao text := cond_email_sessao();
begin
  -- 1. Sessão por e-mail
  if sessao is not null then
    select m.* into r from cond_moradores m where m.email = sessao and m.ativo limit 1;
    if r.id is not null then
      update cond_moradores set ultimo_acesso = now() where id = r.id;
      return;
    end if;
    if coalesce(btrim(p_apto), '') = '' then
      erro := 'sem_cadastro';
      return;
    end if;
  end if;
  -- 2. Apartamento + código
  p_apto := upper(btrim(coalesce(p_apto, '')));
  p_codigo := upper(btrim(coalesce(p_codigo, '')));
  -- Apartamento fora do formato ou código gigante: recusa sem gravar nada (senão alguém enche a
  -- tabela de tentativas com apartamentos inventados).
  if p_apto !~ '^[A-Z0-9-]{1,10}$' or length(p_codigo) > 20 then
    erro := 'codigo_invalido';
    return;
  end if;
  select * into t from cond_tentativas where apto = p_apto;
  if t.bloqueado_ate is not null and t.bloqueado_ate > now() then
    erro := 'bloqueado';
    return;
  end if;
  select m.* into r from cond_moradores m
   where m.apto = p_apto and m.ativo and m.codigo_hash is not null and p_codigo <> ''
     and m.codigo_hash = crypt(p_codigo, m.codigo_hash)
   limit 1;
  if r.id is null then
    insert into cond_tentativas as x (apto, falhas) values (p_apto, 1)
    on conflict (apto) do update set
      falhas = case when x.falhas + 1 >= 5 then 0 else x.falhas + 1 end,
      bloqueado_ate = case when x.falhas + 1 >= 5 then now() + interval '15 minutes' else null end;
    erro := 'codigo_invalido';
    return;
  end if;
  delete from cond_tentativas where apto = p_apto;
  update cond_moradores set ultimo_acesso = now() where id = r.id;
end;
$$;

-- Código novo: 6 caracteres sem os que confundem (0/O, 1/I/L). 31^6 = 887 milhões de
-- combinações; com o bloqueio de 5 erros a cada 15 min, adivinhar não é viável.
create or replace function cond_gerar_codigo() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := gen_random_bytes(6);
  s text := '';
begin
  for i in 0..5 loop
    s := s || substr(alfabeto, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return s;
end;
$$;

-- Quem da equipe está logado (pelo e-mail da sessão) e se pode fazer algo.
create or replace function cond_equipe_atual() returns cond_equipe
language sql stable security definer set search_path = public as $$
  select e.* from cond_equipe e where e.email = cond_email_sessao() and e.ativo limit 1
$$;

create or replace function cond_pode(p_permissao text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p_permissao = any (e.permissoes) from cond_equipe e where e.email = cond_email_sessao() and e.ativo limit 1), false)
$$;

-- Grava uma linha de auditoria com quem está logado.
create or replace function cond_registrar(p_acao text, p_alvo text, p_detalhe text, p_alvo_id uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into cond_auditoria (acao, alvo, alvo_id, detalhe, por_papel, por_nome)
  select p_acao, p_alvo, p_alvo_id, p_detalhe, e.cargo, e.nome from cond_equipe e where e.email = cond_email_sessao() and e.ativo
$$;

-- Linha da solicitação no formato que o app usa (o morador recebe o cargo, nunca o nome de quem respondeu).
create or replace function cond_json(s cond_solicitacoes, p_para_equipe boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'protocolo', s.protocolo, 'servico', s.servico, 'apto', s.apto,
    'inicio', to_char(s.inicio, 'YYYY-MM-DD"T"HH24:MI'), 'fim', to_char(s.fim, 'YYYY-MM-DD"T"HH24:MI'),
    'status', s.status, 'pago', s.pago, 'detalhes', s.detalhes,
    'anonima', s.servico = 'denuncia' and s.morador_id is null,
    'criado_em', s.criado_em,
    'historico', coalesce((
      select jsonb_agg(jsonb_build_object(
               'status', h.status, 'nota', h.nota, 'por_papel', h.por_papel,
               'por_nome', case when p_para_equipe then h.por_nome end, 'em', h.em) order by h.em, h.id)
        from cond_historico h where h.solicitacao_id = s.id), '[]'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- 4. Funções do MORADOR (sessão por e-mail OU apartamento + código, conferidos a cada chamada).
--    Todas devolvem {"erro": "..."} em vez de dar erro, pelo motivo explicado em cond_conferir.
-- -----------------------------------------------------------------------------

-- Entrar: confere e devolve nome e apartamento. Com sessão por e-mail, chamar com nulos.
create or replace function cond_entrar(p_apto text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
begin
  select * into m from cond_conferir(p_apto, p_codigo);
  if m.erro is not null then return jsonb_build_object('erro', m.erro); end if;
  return jsonb_build_object('nome', (m.r).nome, 'apto', (m.r).apto);
end;
$$;

-- Regras dos serviços (sem dado de ninguém): qualquer um pode ler.
create or replace function cond_regras() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_agg(jsonb_build_object('chave', chave, 'nome', nome, 'ativo', ativo, 'config', config)
                   order by array_position(array['lavagem', 'diaria', 'estacionamento', 'denuncia'], chave))
    from cond_servicos
$$;

-- Minhas solicitações: as do morador + as denúncias anônimas cujo token o celular guardou.
create or replace function cond_minhas(p_apto text, p_codigo text, p_tokens text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  hashes text[];
begin
  select * into m from cond_conferir(p_apto, p_codigo);
  if m.erro is not null then return jsonb_build_object('erro', m.erro); end if;
  select coalesce(array_agg(encode(digest(t, 'sha256'), 'hex')), '{}') into hashes
    from unnest(coalesce(p_tokens, '{}')) t;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(cond_json(s, false) order by s.criado_em desc)
      from cond_solicitacoes s
     where s.morador_id = (m.r).id or (s.token_hash is not null and s.token_hash = any (hashes))), '[]'::jsonb));
end;
$$;

-- Ocupação: quais horários de lavagem e diária já têm dono, sem dizer quem (só "minha" ou não).
create or replace function cond_ocupacao(p_apto text, p_codigo text, p_de date, p_ate date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
begin
  select * into m from cond_conferir(p_apto, p_codigo);
  if m.erro is not null then return jsonb_build_object('erro', m.erro); end if;
  if p_ate < p_de or p_ate - p_de > 62 then return jsonb_build_object('erro', 'periodo_invalido'); end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object(
             'servico', s.servico,
             'inicio', to_char(s.inicio, 'YYYY-MM-DD"T"HH24:MI'),
             'fim', to_char(s.fim, 'YYYY-MM-DD"T"HH24:MI'),
             'minha', s.morador_id = (m.r).id) order by s.inicio)
      from cond_solicitacoes s
     where s.servico in ('lavagem', 'diaria') and s.status not in ('cancelada', 'recusada')
       and s.inicio >= p_de and s.inicio < p_ate + 1), '[]'::jsonb));
end;
$$;

-- Fazer uma solicitação. Confere a regra do serviço e grava só os campos conhecidos de "detalhes"
-- (o que vier a mais do celular é descartado).
create or replace function cond_solicitar(
  p_apto text, p_codigo text, p_servico text, p_inicio timestamp, p_detalhes jsonb, p_anonima boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  c jsonb;
  ativo boolean;
  agora timestamp := cond_agora();
  per record;
  v_fim timestamp;
  v_status text;
  v_pago boolean;
  v_det jsonb;
  v_token text;
  v_anon boolean := coalesce(p_anonima, false);
  nova cond_solicitacoes;
  d jsonb := coalesce(p_detalhes, '{}');
  de_dia date;
  ate_dia date;
begin
  select * into m from cond_conferir(p_apto, p_codigo);
  if m.erro is not null then return jsonb_build_object('erro', m.erro); end if;
  select s.config, s.ativo into c, ativo from cond_servicos s where s.chave = p_servico;
  if c is null then return jsonb_build_object('erro', 'servico_invalido'); end if;
  if not ativo then return jsonb_build_object('erro', 'servico_inativo'); end if;
  -- Uma solicitação por vez por apartamento e serviço: sem isso, dois toques no mesmo segundo
  -- passam juntos pela contagem do limite por semana. A trava some no fim da transação.
  perform pg_advisory_xact_lock(hashtext('condominio:' || p_servico || ':' || (m.r).apto));
  -- Serviço que cobra nasce com pagamento pendente; os outros, sem pagamento (nulo).
  v_pago := case when coalesce((c ->> 'cobra')::boolean, false) then false end;

  if p_servico in ('lavagem', 'diaria') then
    -- O início tem de ser um dos horários do dia, no futuro e dentro do horizonte.
    select * into per from cond_periodos(p_servico, p_inicio::date) x where x.de = p_inicio;
    if per.de is null then
      -- Diz o motivo certo quando o dia está fechado por feriado.
      if exists (select 1 from cond_dias_especiais(p_inicio::date, p_inicio::date) x where coalesce(c ->> x.tipo, 'abre') = 'fecha') then
        return jsonb_build_object('erro', 'dia_fechado');
      end if;
      return jsonb_build_object('erro', 'horario_invalido');
    end if;
    if per.de <= agora then return jsonb_build_object('erro', 'horario_passou'); end if;
    if p_inicio::date > agora::date + (c ->> 'horizonte')::int then
      return jsonb_build_object('erro', 'fora_do_horizonte');
    end if;
    if (select count(*) from cond_solicitacoes s
         where s.servico = p_servico and s.apto = (m.r).apto and s.status not in ('cancelada', 'recusada')
           and date_trunc('week', s.inicio) = date_trunc('week', p_inicio)) >= (c ->> 'por_semana')::int then
      return jsonb_build_object('erro', 'limite_semana');
    end if;
    v_fim := per.ate;
    v_status := 'confirmada';
    v_det := jsonb_strip_nulls(jsonb_build_object('obs', left(nullif(btrim(d ->> 'obs'), ''), 300)));
    v_anon := false;

  elsif p_servico = 'estacionamento' then
    -- Do dia "de" (inicio) até o dia "ate" (detalhes.ate), inclusive. Placa no padrão brasileiro.
    de_dia := p_inicio::date;
    begin
      ate_dia := (d ->> 'ate')::date;
    exception when others then
      return jsonb_build_object('erro', 'data_invalida');
    end;
    if de_dia is null or ate_dia is null or de_dia < agora::date or ate_dia < de_dia
       or ate_dia - de_dia >= (c ->> 'max_dias')::int then
      return jsonb_build_object('erro', 'data_invalida');
    end if;
    if upper(regexp_replace(coalesce(d ->> 'placa', ''), '[^A-Za-z0-9]', '', 'g')) !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then
      return jsonb_build_object('erro', 'placa_invalida');
    end if;
    p_inicio := de_dia::timestamp;
    v_fim := (ate_dia + 1)::timestamp;
    v_status := 'aberta';
    v_det := jsonb_strip_nulls(jsonb_build_object(
      'placa', upper(regexp_replace(d ->> 'placa', '[^A-Za-z0-9]', '', 'g')),
      'veiculo', left(nullif(btrim(d ->> 'veiculo'), ''), 80),
      'para', left(nullif(btrim(d ->> 'para'), ''), 80),
      'obs', left(nullif(btrim(d ->> 'obs'), ''), 300)));
    v_anon := false;

  else -- denuncia (sem limite de quantidade, de propósito: o canal nunca recusa)
    if not exists (select 1 from jsonb_array_elements_text(c -> 'categorias') x where x = d ->> 'categoria') then
      return jsonb_build_object('erro', 'categoria_invalida');
    end if;
    if length(btrim(coalesce(d ->> 'descricao', ''))) < 10 then
      return jsonb_build_object('erro', 'descricao_curta');
    end if;
    p_inicio := null;
    v_fim := null;
    v_status := 'aberta';
    v_pago := null;
    v_det := jsonb_strip_nulls(jsonb_build_object(
      'categoria', d ->> 'categoria',
      'local', left(nullif(btrim(d ->> 'local'), ''), 120),
      'quando', left(nullif(btrim(d ->> 'quando'), ''), 60),
      'descricao', left(btrim(d ->> 'descricao'), 2000)));
    if v_anon then
      v_token := encode(gen_random_bytes(16), 'hex');
    end if;
  end if;

  begin
    insert into cond_solicitacoes (servico, morador_id, apto, inicio, fim, status, pago, detalhes, token_hash)
    values (p_servico,
            case when v_anon then null else (m.r).id end,
            case when v_anon then null else (m.r).apto end,
            p_inicio, v_fim, v_status, v_pago, v_det,
            case when v_token is not null then encode(digest(v_token, 'sha256'), 'hex') end)
    returning * into nova;
  exception when unique_violation then
    return jsonb_build_object('erro', 'ocupado');
  end;
  insert into cond_historico (solicitacao_id, status, por_papel) values (nova.id, v_status, 'morador');
  return jsonb_build_object('id', nova.id, 'protocolo', nova.protocolo, 'token', v_token);
end;
$$;

-- Cancelar a própria solicitação: reserva antes de começar; estacionamento antes de terminar;
-- denúncia só enquanto ninguém começou a analisar. Denúncia anônima não se cancela (não tem dono).
create or replace function cond_cancelar(p_apto text, p_codigo text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  s cond_solicitacoes;
begin
  select * into m from cond_conferir(p_apto, p_codigo);
  if m.erro is not null then return jsonb_build_object('erro', m.erro); end if;
  select * into s from cond_solicitacoes where id = p_id and morador_id = (m.r).id for update;
  if s.id is null then return jsonb_build_object('erro', 'nao_encontrada'); end if;
  if s.status not in ('aberta', 'confirmada')
     or (s.servico in ('lavagem', 'diaria') and s.inicio <= cond_agora())
     or (s.servico = 'estacionamento' and s.fim <= cond_agora()) then
    return jsonb_build_object('erro', 'nao_cancela');
  end if;
  update cond_solicitacoes set status = 'cancelada', atualizado_em = now() where id = s.id;
  insert into cond_historico (solicitacao_id, status, por_papel) values (s.id, 'cancelada', 'morador');
  return jsonb_build_object('ok', true);
end;
$$;

-- Feriados, pontos facultativos e emendas para o calendário (informação pública).
create or replace function cond_feriados(p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 400 then
    return jsonb_build_object('erro', 'periodo_invalido');
  end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object('dia', x.dia, 'tipo', x.tipo, 'nome', x.nome, 'origem', x.origem) order by x.dia)
      from cond_dias_especiais(p_de, p_ate) x), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Funções da EQUIPE (login por e-mail; cada uma confere a permissão)
-- -----------------------------------------------------------------------------

-- Quem sou eu na equipe (nome, cargo e permissões). Nulo = não é da equipe.
create or replace function cond_eu() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nome', e.nome, 'cargo', e.cargo, 'permissoes', to_jsonb(e.permissoes))
    from cond_equipe e where e.email = cond_email_sessao() and e.ativo
$$;

-- Painel: o que a pessoa pode ver (reservas e/ou denúncias), com o nome do morador. Sem período: de
-- 90 dias atrás em diante. Com período (ex.: o mês do calendário): o que toca aquele intervalo.
drop function if exists cond_painel();
create or replace function cond_painel(p_de date default null, p_ate date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_reservas boolean := cond_pode('reservas');
  v_denuncias boolean := cond_pode('denuncias');
begin
  if not (v_reservas or v_denuncias) then return jsonb_build_object('erro', 'sem_permissao'); end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(cond_json(s, true) || jsonb_build_object('morador', mo.nome) order by coalesce(s.inicio, s.criado_em::timestamp))
      from cond_solicitacoes s left join cond_moradores mo on mo.id = s.morador_id
     where ((s.servico = 'denuncia' and v_denuncias) or (s.servico <> 'denuncia' and v_reservas))
       and coalesce(s.fim, s.criado_em::timestamp) >= coalesce(p_de::timestamp, cond_agora() - interval '90 days')
       and (p_ate is null or coalesce(s.inicio, s.criado_em::timestamp) < (p_ate + 1)::timestamp)), '[]'::jsonb));
end;
$$;

-- Mudar a situação, responder ou marcar pagamento. As passagens permitidas são as mesmas de
-- src/regras.ts (passagens). Denúncia pede a permissão "denuncias"; o resto, "reservas".
create or replace function cond_atualizar(p_id uuid, p_status text default null, p_nota text default null, p_pago boolean default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  eu cond_equipe := cond_equipe_atual();
  s cond_solicitacoes;
  permitido text[];
  nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  if eu.id is null then return jsonb_build_object('erro', 'sem_permissao'); end if;
  select * into s from cond_solicitacoes where id = p_id for update;
  if s.id is null
     or (s.servico = 'denuncia' and not ('denuncias' = any (eu.permissoes)))
     or (s.servico <> 'denuncia' and not ('reservas' = any (eu.permissoes))) then
    return jsonb_build_object('erro', 'nao_encontrada');
  end if;

  if p_status is not null and p_status <> s.status then
    permitido := case
      when s.servico in ('lavagem', 'diaria') and s.status = 'confirmada' then array['cancelada']
      when s.servico = 'estacionamento' and s.status = 'aberta' then array['confirmada', 'recusada']
      when s.servico = 'estacionamento' and s.status = 'confirmada' then array['concluida', 'cancelada']
      when s.servico = 'denuncia' and s.status = 'aberta' then array['em_analise', 'concluida', 'recusada']
      when s.servico = 'denuncia' and s.status = 'em_analise' then array['concluida', 'recusada']
      else array[]::text[] end;
    if not (p_status = any (permitido)) then return jsonb_build_object('erro', 'passagem_invalida'); end if;
    -- Reserva que já acabou não se cancela (só pagamento e nota).
    if s.servico in ('lavagem', 'diaria') and s.fim <= cond_agora() then
      return jsonb_build_object('erro', 'passagem_invalida');
    end if;
    if s.servico = 'denuncia' and p_status in ('concluida', 'recusada') and nota is null then
      return jsonb_build_object('erro', 'resposta_obrigatoria');
    end if;
    update cond_solicitacoes set status = p_status, atualizado_em = now() where id = s.id;
    insert into cond_historico (solicitacao_id, status, nota, por_papel, por_nome) values (s.id, p_status, nota, eu.cargo, eu.nome);
  elsif nota is not null then
    insert into cond_historico (solicitacao_id, status, nota, por_papel, por_nome) values (s.id, s.status, nota, eu.cargo, eu.nome);
  end if;

  if p_pago is not null and s.pago is not null and p_pago <> s.pago then
    update cond_solicitacoes set pago = p_pago, atualizado_em = now() where id = s.id;
    insert into cond_historico (solicitacao_id, status, nota, por_papel, por_nome)
    values (s.id, coalesce(p_status, s.status), case when p_pago then 'Pagamento recebido' else 'Pagamento desmarcado' end, eu.cargo, eu.nome);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Morador no formato da tela da equipe (sem o hash do código), com as informações de acesso.
-- senha_criada / ultimo_login vêm do Supabase Auth (só quem entra por e-mail tem).
create or replace function cond_morador_json(m cond_moradores) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'nome', m.nome, 'apto', m.apto, 'telefone', m.telefone, 'email', m.email, 'cpf', m.cpf,
    'vaga', m.vaga, 'desde', m.desde, 'ativo', m.ativo, 'criado_em', m.criado_em,
    'tem_codigo', m.codigo_hash is not null, 'codigo_gerado_em', m.codigo_gerado_em,
    'convite_enviado_em', m.convite_enviado_em, 'ultimo_acesso', m.ultimo_acesso,
    'senha_criada', exists (select 1 from auth.users u where lower(u.email) = m.email and u.last_sign_in_at is not null),
    'ultimo_login', (select max(u.last_sign_in_at) from auth.users u where lower(u.email) = m.email))
$$;

create or replace function cond_lista_moradores() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not cond_pode('moradores') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(cond_morador_json(m) order by m.apto, m.nome) from cond_moradores m), '[]'::jsonb));
end;
$$;

-- Lê e confere os campos do cadastro (usado no criar e no editar). Erro vem em "erro".
create or replace function cond_campos_morador(p jsonb, out nome text, out apto text, out telefone text, out email text,
  out cpf text, out vaga text, out desde date, out erro text)
language plpgsql immutable as $$
begin
  nome := btrim(coalesce(p ->> 'nome', ''));
  apto := upper(btrim(coalesce(p ->> 'apto', '')));
  telefone := nullif(btrim(coalesce(p ->> 'telefone', '')), '');
  email := nullif(lower(btrim(coalesce(p ->> 'email', ''))), '');
  cpf := nullif(regexp_replace(coalesce(p ->> 'cpf', ''), '[^0-9]', '', 'g'), '');
  vaga := nullif(upper(btrim(coalesce(p ->> 'vaga', ''))), '');
  begin
    desde := nullif(p ->> 'desde', '')::date;
  exception when others then
    erro := 'data_invalida';
    return;
  end;
  if length(nome) < 2 or apto !~ '^[A-Z0-9-]{1,10}$' then erro := 'dados_invalidos'; return; end if;
  if email is not null and email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then erro := 'email_invalido'; return; end if;
  if cpf is not null and not cond_cpf_valido(cpf) then erro := 'cpf_invalido'; return; end if;
end;
$$;

-- Cadastrar morador. Com e-mail: o app pede o convite em seguida (função convidar). Sem e-mail, ou
-- se a portaria pedir, gera o código e devolve UMA vez.
create or replace function cond_criar_morador(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  f record;
  cod text;
  novo cond_moradores;
begin
  if not cond_pode('moradores') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  select * into f from cond_campos_morador(p);
  if f.erro is not null then return jsonb_build_object('erro', f.erro); end if;
  if f.email is null or coalesce((p ->> 'gerar_codigo')::boolean, false) then cod := cond_gerar_codigo(); end if;
  begin
    insert into cond_moradores (nome, apto, telefone, email, cpf, vaga, desde, codigo_hash, codigo_gerado_em)
    values (f.nome, f.apto, f.telefone, f.email, f.cpf, f.vaga, f.desde,
            case when cod is not null then crypt(cod, gen_salt('bf')) end, case when cod is not null then now() end)
    returning * into novo;
  exception when unique_violation then
    return jsonb_build_object('erro', 'email_repetido');
  end;
  perform cond_registrar('morador_cadastrado', novo.apto, novo.nome, novo.id);
  return jsonb_build_object('id', novo.id, 'codigo', cod, 'convidar', novo.email is not null);
end;
$$;

-- Editar. Desativar (morador que se mudou) cancela as reservas e pedidos que ainda não começaram e
-- corta o acesso na hora (as funções conferem "ativo" a cada chamada). O histórico fica.
create or replace function cond_editar_morador(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  f record;
  antes cond_moradores;
  ativo_novo boolean := coalesce((p ->> 'ativo')::boolean, true);
  eu cond_equipe := cond_equipe_atual();
  x record;
  canceladas int := 0;
begin
  if not cond_pode('moradores') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  select * into f from cond_campos_morador(p);
  if f.erro is not null then return jsonb_build_object('erro', f.erro); end if;
  select * into antes from cond_moradores where id = p_id for update;
  if antes.id is null then return jsonb_build_object('erro', 'nao_encontrado'); end if;
  if f.email is null and antes.codigo_hash is null then return jsonb_build_object('erro', 'sem_forma_de_acesso'); end if;
  begin
    update cond_moradores set nome = f.nome, apto = f.apto, telefone = f.telefone, email = f.email, cpf = f.cpf,
           vaga = f.vaga, desde = f.desde, ativo = ativo_novo
     where id = p_id;
  exception when unique_violation then
    return jsonb_build_object('erro', 'email_repetido');
  end;
  if antes.ativo and not ativo_novo then
    for x in
      update cond_solicitacoes set status = 'cancelada', atualizado_em = now()
       where morador_id = p_id and servico in ('lavagem', 'diaria', 'estacionamento')
         and status in ('aberta', 'confirmada') and inicio > cond_agora()
      returning id
    loop
      insert into cond_historico (solicitacao_id, status, nota, por_papel, por_nome)
      values (x.id, 'cancelada', 'Cancelada porque o morador foi desativado', eu.cargo, eu.nome);
      canceladas := canceladas + 1;
    end loop;
    perform cond_registrar('morador_desativado', antes.apto, antes.nome || ' (' || canceladas || ' reservas canceladas)', p_id);
  elsif not antes.ativo and ativo_novo then
    perform cond_registrar('morador_reativado', f.apto, f.nome, p_id);
  else
    perform cond_registrar('morador_editado', f.apto, f.nome, p_id);
  end if;
  return jsonb_build_object('ok', true, 'canceladas', canceladas,
                            'convidar', f.email is not null and f.email is distinct from antes.email and ativo_novo);
end;
$$;

-- Código novo: o antigo deixa de valer na hora (morador esqueceu ou o código vazou).
create or replace function cond_novo_codigo(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  cod text := cond_gerar_codigo();
  m cond_moradores;
begin
  if not cond_pode('moradores') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  update cond_moradores set codigo_hash = crypt(cod, gen_salt('bf')), codigo_gerado_em = now() where id = p_id returning * into m;
  if m.id is null then return jsonb_build_object('erro', 'nao_encontrado'); end if;
  perform cond_registrar('codigo_novo', m.apto, m.nome, m.id);
  return jsonb_build_object('codigo', cod);
end;
$$;

-- Pedido de convite (chamado pela função convidar, com o login de quem pediu): confere a permissão,
-- marca a data, grava na auditoria e devolve o e-mail. Quem manda o e-mail é a função, com a chave
-- de serviço (que nunca vai no site).
create or replace function cond_convite_pedir(p_tipo text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_alvo text;
begin
  if p_tipo = 'morador' then
    if not cond_pode('moradores') then return jsonb_build_object('erro', 'sem_permissao'); end if;
    update cond_moradores set convite_enviado_em = now() where id = p_id and ativo and email is not null
    returning email, apto into v_email, v_alvo;
  elsif p_tipo = 'equipe' then
    if not cond_pode('admin') then return jsonb_build_object('erro', 'sem_permissao'); end if;
    update cond_equipe set convite_enviado_em = now() where id = p_id and ativo
    returning email, nome into v_email, v_alvo;
  else
    return jsonb_build_object('erro', 'dados_invalidos');
  end if;
  if v_email is null then return jsonb_build_object('erro', 'nao_encontrado'); end if;
  perform cond_registrar('convite_enviado', v_alvo, v_email, p_id);
  return jsonb_build_object('email', v_email);
end;
$$;

-- Histórico de um morador: as solicitações dele (anônimas não aparecem: não têm dono) e o que a
-- equipe fez no cadastro.
create or replace function cond_historico_morador(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not cond_pode('moradores') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  return jsonb_build_object(
    'solicitacoes', coalesce((
      select jsonb_agg(cond_json(s, true) order by s.criado_em desc) from cond_solicitacoes s
       where s.morador_id = p_id and (s.servico <> 'denuncia' or cond_pode('denuncias'))), '[]'::jsonb),
    'auditoria', coalesce((
      select jsonb_agg(to_jsonb(a) - 'id' - 'alvo_id' order by a.em desc) from cond_auditoria a where a.alvo_id = p_id), '[]'::jsonb));
end;
$$;

-- Funcionários (só quem tem "admin").
create or replace function cond_lista_equipe() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not cond_pode('admin') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'email', e.email, 'nome', e.nome, 'cargo', e.cargo, 'permissoes', to_jsonb(e.permissoes),
             'ativo', e.ativo, 'convite_enviado_em', e.convite_enviado_em, 'criado_em', e.criado_em,
             'ultimo_login', (select max(u.last_sign_in_at) from auth.users u where lower(u.email) = e.email))
             order by e.ativo desc, e.nome)
      from cond_equipe e), '[]'::jsonb));
end;
$$;

-- Criar (p_id nulo) ou editar um funcionário. Nunca deixa o condomínio sem ninguém com "admin".
create or replace function cond_salvar_equipe(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p ->> 'email', ''))), '');
  v_nome text := btrim(coalesce(p ->> 'nome', ''));
  v_cargo text := btrim(coalesce(p ->> 'cargo', ''));
  v_perm text[] := coalesce(array(select jsonb_array_elements_text(p -> 'permissoes')), '{}');
  v_ativo boolean := coalesce((p ->> 'ativo')::boolean, true);
  antes cond_equipe;
  salvo cond_equipe;
begin
  if not cond_pode('admin') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then return jsonb_build_object('erro', 'email_invalido'); end if;
  if length(v_nome) < 2 or length(v_cargo) < 2 then return jsonb_build_object('erro', 'dados_invalidos'); end if;
  if not (v_perm <@ array['reservas', 'moradores', 'denuncias', 'noticias', 'admin']) then return jsonb_build_object('erro', 'dados_invalidos'); end if;
  if p_id is not null then select * into antes from cond_equipe where id = p_id for update; end if;
  begin
    if p_id is null then
      insert into cond_equipe (email, nome, cargo, permissoes, ativo) values (v_email, v_nome, v_cargo, v_perm, v_ativo) returning * into salvo;
    else
      update cond_equipe set email = v_email, nome = v_nome, cargo = v_cargo, permissoes = v_perm, ativo = v_ativo
       where id = p_id returning * into salvo;
      if salvo.id is null then return jsonb_build_object('erro', 'nao_encontrado'); end if;
    end if;
  exception when unique_violation then
    return jsonb_build_object('erro', 'email_repetido');
  end;
  if not exists (select 1 from cond_equipe where ativo and 'admin' = any (permissoes)) then
    raise exception 'ultimo_admin'; -- desfaz a mudança (nada foi gravado ainda além dela)
  end if;
  perform cond_registrar(case when p_id is null then 'funcionario_cadastrado' else 'funcionario_editado' end,
                        salvo.nome, salvo.cargo || ': ' || array_to_string(salvo.permissoes, ', ') || case when salvo.ativo then '' else ' (desativado)' end, salvo.id);
  return jsonb_build_object('id', salvo.id, 'convidar', salvo.ativo and (antes.id is null or antes.email <> salvo.email));
exception when raise_exception then
  if sqlerrm = 'ultimo_admin' then return jsonb_build_object('erro', 'ultimo_admin'); end if;
  raise;
end;
$$;

-- Síndico ajusta um dia: 'feriado', 'facultativo', 'normal' ou nulo (volta ao cálculo automático).
-- Não cancela reserva já feita: devolve quantas existem no dia para decidir e avisar.
create or replace function cond_ajustar_dia(p_dia date, p_tipo text, p_nome text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  eu cond_equipe := cond_equipe_atual();
begin
  if not cond_pode('admin') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  if p_dia is null or (p_tipo is not null and p_tipo not in ('feriado', 'facultativo', 'normal')) then
    return jsonb_build_object('erro', 'dados_invalidos');
  end if;
  if p_tipo is null then
    delete from cond_dias_ajuste where dia = p_dia;
  else
    insert into cond_dias_ajuste (dia, tipo, nome, por_nome)
    values (p_dia, p_tipo, left(nullif(btrim(coalesce(p_nome, '')), ''), 80), eu.nome)
    on conflict (dia) do update set tipo = excluded.tipo, nome = excluded.nome, por_nome = excluded.por_nome, em = now();
  end if;
  perform cond_registrar('dia_ajustado', to_char(p_dia, 'DD/MM/YYYY'), coalesce(p_tipo, 'automático') || coalesce(': ' || p_nome, ''));
  return jsonb_build_object('ok', true, 'reservas_no_dia', (
    select count(*) from cond_solicitacoes s
     where s.servico in ('lavagem', 'diaria') and s.status = 'confirmada' and s.inicio::date = p_dia));
end;
$$;

-- Auditoria (as últimas 300 ações da equipe).
create or replace function cond_lista_auditoria() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not cond_pode('admin') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(to_jsonb(a) - 'id' order by a.em desc)
      from (select * from cond_auditoria order by em desc, id desc limit 300) a), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Notícias (permissão "noticias")
-- -----------------------------------------------------------------------------
create or replace function cond_lista_modelos() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not cond_pode('noticias') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'assunto', assunto, 'corpo', corpo) order by nome) from cond_modelos), '[]'::jsonb));
end;
$$;

create or replace function cond_salvar_modelo(p_id uuid, p_nome text, p_assunto text, p_corpo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  salvo cond_modelos;
begin
  if not cond_pode('noticias') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  if p_id is null then
    insert into cond_modelos (nome, assunto, corpo) values (btrim(p_nome), btrim(p_assunto), p_corpo) returning * into salvo;
  else
    update cond_modelos set nome = btrim(p_nome), assunto = btrim(p_assunto), corpo = p_corpo where id = p_id returning * into salvo;
  end if;
  if salvo.id is null then return jsonb_build_object('erro', 'nao_encontrado'); end if;
  return jsonb_build_object('id', salvo.id);
exception when check_violation then
  return jsonb_build_object('erro', 'dados_invalidos');
end;
$$;

create or replace function cond_apagar_modelo(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not cond_pode('noticias') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  delete from cond_modelos where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Quem recebe um envio: moradores ativos com e-mail (todos ou os escolhidos).
create or replace function cond_destinatarios(p_destino jsonb) returns setof cond_moradores
language sql stable security definer set search_path = public as $$
  select m.* from cond_moradores m
   where m.ativo and m.email is not null
     and (coalesce((p_destino ->> 'todos')::boolean, false)
          or m.id::text in (select jsonb_array_elements_text(coalesce(p_destino -> 'ids', '[]'::jsonb))))
$$;

-- Criar um envio: agora (p_quando nulo), agendado ou repetido (diaria, semanal, mensal).
create or replace function cond_criar_envio(p_assunto text, p_corpo text, p_destino jsonb, p_quando timestamptz default null, p_recorrencia text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  eu cond_equipe := cond_equipe_atual();
  novo cond_envios;
  n int;
begin
  if not cond_pode('noticias') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  if p_recorrencia is not null and p_recorrencia not in ('diaria', 'semanal', 'mensal') then return jsonb_build_object('erro', 'dados_invalidos'); end if;
  if p_quando is not null and p_quando < now() - interval '5 minutes' then return jsonb_build_object('erro', 'data_passada'); end if;
  select count(*) into n from cond_destinatarios(p_destino);
  if n = 0 then return jsonb_build_object('erro', 'sem_destinatarios'); end if;
  begin
    insert into cond_envios (assunto, corpo, destino, quando, recorrencia, criado_por)
    values (btrim(p_assunto), p_corpo, p_destino, coalesce(p_quando, now()), p_recorrencia, eu.nome)
    returning * into novo;
  exception when check_violation then
    return jsonb_build_object('erro', 'dados_invalidos');
  end;
  perform cond_registrar('noticia_criada', novo.assunto, n || ' destinatário(s)' || coalesce(', repete: ' || p_recorrencia, ''), novo.id);
  return jsonb_build_object('id', novo.id, 'destinatarios', n);
end;
$$;

create or replace function cond_lista_envios() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not cond_pode('noticias') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'assunto', e.assunto, 'corpo', e.corpo, 'destino', e.destino, 'quando', e.quando,
             'recorrencia', e.recorrencia, 'ativo', e.ativo, 'cancelado', e.cancelado, 'ultimo_envio', e.ultimo_envio,
             'total_enviados', e.total_enviados, 'criado_por', e.criado_por, 'criado_em', e.criado_em,
             'destinatarios', (select count(*) from cond_destinatarios(e.destino)),
             'falhas', (select count(*) from cond_envio_log l where l.envio_id = e.id and not l.ok))
             order by e.criado_em desc)
      from (select * from cond_envios order by criado_em desc limit 200) e), '[]'::jsonb));
end;
$$;

create or replace function cond_cancelar_envio(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e cond_envios;
begin
  if not cond_pode('noticias') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  update cond_envios set ativo = false, cancelado = true where id = p_id and ativo returning * into e;
  if e.id is null then return jsonb_build_object('erro', 'nao_encontrada'); end if;
  perform cond_registrar('noticia_cancelada', e.assunto, null, e.id);
  return jsonb_build_object('ok', true);
end;
$$;

-- Avisos e perguntas frequentes. O morador lê só os publicados (precisa estar logado: são do
-- condomínio, não do público). A equipe com "noticias" lê todos (inclusive rascunhos) e edita.
create or replace function cond_aviso_json(a cond_avisos) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', a.id, 'tipo', a.tipo, 'titulo', a.titulo, 'texto', a.texto, 'fixado', a.fixado,
                            'publicado', a.publicado, 'ordem', a.ordem, 'atualizado_em', a.atualizado_em, 'atualizado_por', a.atualizado_por)
$$;

create or replace function cond_avisos_morador(p_apto text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
begin
  select * into m from cond_conferir(p_apto, p_codigo);
  if m.erro is not null then return jsonb_build_object('erro', m.erro); end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(cond_aviso_json(a) - 'atualizado_por' - 'publicado' order by (a.tipo = 'aviso') desc, a.fixado desc, a.ordem, a.atualizado_em desc)
      from cond_avisos a where a.publicado), '[]'::jsonb));
end;
$$;

create or replace function cond_lista_avisos() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not cond_pode('noticias') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  return jsonb_build_object('itens', coalesce((
    select jsonb_agg(cond_aviso_json(a) order by (a.tipo = 'aviso') desc, a.fixado desc, a.ordem, a.atualizado_em desc) from cond_avisos a), '[]'::jsonb));
end;
$$;

create or replace function cond_salvar_aviso(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  eu cond_equipe := cond_equipe_atual();
  salvo cond_avisos;
begin
  if not cond_pode('noticias') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  begin
    if p_id is null then
      insert into cond_avisos (tipo, titulo, texto, fixado, publicado, ordem, atualizado_por)
      values (p ->> 'tipo', btrim(p ->> 'titulo'), btrim(p ->> 'texto'), coalesce((p ->> 'fixado')::boolean, false),
              coalesce((p ->> 'publicado')::boolean, true), coalesce((p ->> 'ordem')::int, 0), eu.nome)
      returning * into salvo;
    else
      update cond_avisos set tipo = p ->> 'tipo', titulo = btrim(p ->> 'titulo'), texto = btrim(p ->> 'texto'),
             fixado = coalesce((p ->> 'fixado')::boolean, false), publicado = coalesce((p ->> 'publicado')::boolean, true),
             ordem = coalesce((p ->> 'ordem')::int, 0), atualizado_por = eu.nome, atualizado_em = now()
       where id = p_id returning * into salvo;
      if salvo.id is null then return jsonb_build_object('erro', 'nao_encontrado'); end if;
    end if;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('erro', 'dados_invalidos');
  end;
  perform cond_registrar('aviso_salvo', salvo.titulo, case when salvo.publicado then 'publicado' else 'rascunho' end, salvo.id);
  return jsonb_build_object('id', salvo.id);
end;
$$;

create or replace function cond_apagar_aviso(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a cond_avisos;
begin
  if not cond_pode('noticias') then return jsonb_build_object('erro', 'sem_permissao'); end if;
  delete from cond_avisos where id = p_id returning * into a;
  if a.id is not null then perform cond_registrar('aviso_apagado', a.titulo, null, a.id); end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Usadas SÓ pela função enviar-noticias (chave de serviço). "Pega" os envios vencidos (trava de
-- 10 minutos contra duas execuções ao mesmo tempo) e devolve cada um com os destinatários.
create or replace function cond_envios_devidos() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[];
begin
  -- 1. Escolhe até 20 envios vencidos e livres (o "skip locked" pula o que outra execução já pegou).
  select array_agg(x.id) into ids from (
    select id from cond_envios
     where ativo and quando <= now() and (processando_em is null or processando_em < now() - interval '10 minutes')
     order by quando limit 20 for update skip locked) x;
  if ids is null then return '[]'::jsonb; end if;
  -- 2. Marca como "em envio".
  update cond_envios set processando_em = now() where id = any (ids);
  -- 3. Devolve cada um com os destinatários.
  return (select jsonb_agg(jsonb_build_object(
            'id', p.id, 'assunto', p.assunto, 'corpo', p.corpo,
            'destinatarios', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nome', d.nome, 'apto', d.apto, 'email', d.email))
                                         from cond_destinatarios(p.destino) d), '[]'::jsonb)))
            from cond_envios p where p.id = any (ids));
end;
$$;

-- Registra o resultado de um envio e marca o próximo (repetição) ou encerra.
create or replace function cond_envio_concluir(p_id uuid, p_resultados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e cond_envios;
  proximo timestamptz;
  ok_n int;
begin
  select * into e from cond_envios where id = p_id for update;
  if e.id is null then return jsonb_build_object('erro', 'nao_encontrada'); end if;
  insert into cond_envio_log (envio_id, morador_id, email, ok, erro)
  select p_id, nullif(r ->> 'id', '')::uuid, r ->> 'email', coalesce((r ->> 'ok')::boolean, false), r ->> 'erro'
    from jsonb_array_elements(coalesce(p_resultados, '[]'::jsonb)) r;
  select count(*) into ok_n from jsonb_array_elements(coalesce(p_resultados, '[]'::jsonb)) r where (r ->> 'ok')::boolean;
  if e.recorrencia is not null and not e.cancelado then
    proximo := e.quando;
    loop
      proximo := proximo + case e.recorrencia when 'diaria' then interval '1 day' when 'semanal' then interval '7 days' else interval '1 month' end;
      exit when proximo > now();
    end loop;
  end if;
  update cond_envios set processando_em = null, ultimo_envio = now(), total_enviados = total_enviados + ok_n,
         quando = coalesce(proximo, quando), ativo = proximo is not null
   where id = p_id;
  return jsonb_build_object('ok', true, 'proximo', proximo);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Portas fechadas: ninguém lê nem grava as tabelas direto. Tudo passa pelas funções acima.
--    (O Supabase dá acesso às tabelas novas para anon e authenticated por padrão; aqui tira.)
-- -----------------------------------------------------------------------------
alter table cond_servicos enable row level security;
alter table cond_moradores enable row level security;
alter table cond_tentativas enable row level security;
alter table cond_equipe enable row level security;
alter table cond_solicitacoes enable row level security;
alter table cond_historico enable row level security;
alter table cond_feriados_locais enable row level security;
alter table cond_dias_ajuste enable row level security;
alter table cond_auditoria enable row level security;
alter table cond_modelos enable row level security;
alter table cond_envios enable row level security;
alter table cond_envio_log enable row level security;
alter table cond_avisos enable row level security;

revoke all on cond_servicos, cond_moradores, cond_tentativas, cond_equipe, cond_solicitacoes, cond_historico,
  cond_feriados_locais, cond_dias_ajuste, cond_auditoria, cond_modelos, cond_envios, cond_envio_log, cond_avisos from anon, authenticated;

-- Funções: tirar de todo mundo; a chave de serviço (funções do servidor) chama todas; o resto
-- recebe só as que cada lado usa.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'cond\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.assinatura);
    execute format('grant execute on function %s to service_role', f.assinatura);
  end loop;
  -- Sequências dos números (protocolo etc.): também fechadas.
  for f in select c.oid::regclass as assinatura from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'cond\_%' loop
    execute format('revoke all on sequence %s from anon, authenticated', f.assinatura);
  end loop;
end $$;
grant execute on function cond_entrar(text, text), cond_regras(), cond_minhas(text, text, text[]),
  cond_ocupacao(text, text, date, date), cond_solicitar(text, text, text, timestamp, jsonb, boolean),
  cond_cancelar(text, text, uuid), cond_feriados(date, date), cond_avisos_morador(text, text)
  to anon, authenticated;
grant execute on function cond_eu(), cond_painel(date, date), cond_atualizar(uuid, text, text, boolean),
  cond_lista_moradores(), cond_criar_morador(jsonb), cond_editar_morador(uuid, jsonb), cond_novo_codigo(uuid),
  cond_convite_pedir(text, uuid), cond_historico_morador(uuid), cond_lista_equipe(), cond_salvar_equipe(uuid, jsonb),
  cond_ajustar_dia(date, text, text), cond_lista_auditoria(),
  cond_lista_modelos(), cond_salvar_modelo(uuid, text, text, text), cond_apagar_modelo(uuid),
  cond_criar_envio(text, text, jsonb, timestamptz, text), cond_lista_envios(), cond_cancelar_envio(uuid),
  cond_lista_avisos(), cond_salvar_aviso(uuid, jsonb), cond_apagar_aviso(uuid)
  to authenticated;
