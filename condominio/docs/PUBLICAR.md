# Publicar e manter no ar (Supabase + Netlify + Resend)

> São três peças. O **Supabase** guarda os dados, faz o login (equipe e moradores com e-mail) e roda duas funções pequenas no servidor: `convidar` (manda o convite para criar a senha) e `enviar-noticias` (manda os e-mails da aba Notícias). O **Netlify** hospeda o site (o Supabase não hospeda site: devolve HTML como texto puro, de propósito). O **Resend** entrega os e-mails (convites, troca de senha e notícias). Este roteiro leva do zero até o condomínio usando, e depois explica como atualizar, cuidar e resolver problema.

Cada fase segue o mesmo formato: **o que faz**, **por quê** e **como conferir**. Não pule a coluna de conferir.

## Fase 0. Antes de começar

| item | o que é | por quê |
|---|---|---|
| E-mail do condomínio | um e-mail da administração (não o pessoal de ninguém) | as contas ficam no nome do condomínio: o dado é dele (LGPD: o condomínio é o controlador) e a conta não some se uma pessoa sair |
| Domínio | um endereço próprio (ex.: `condominiox.com.br`, cerca de R$ 40 por ano no registro.br) | o Resend só entrega e-mail para qualquer pessoa a partir de um domínio verificado; sem domínio, os convites não saem |
| Seu acesso | você entra como **membro** das contas | para dar suporte sem ser o dono |
| Gerenciador de senhas | onde guardar a senha do banco e as chaves | a senha do banco não aparece de novo depois de criada |
| Lista da equipe | nome, e-mail, cargo e poderes de cada um (pelo menos o síndico) | fase 1.4 |

**O que nunca vai para o site, o repositório ou uma conversa:** a senha do banco, a chave `service_role` do Supabase e a chave do Resend. A única chave que pode ir no site é a `anon` (pública).

## Fase 1. Supabase (o banco)

| passo | o que faz | por quê | confere |
|---|---|---|---|
| 1.1 Criar o projeto | supabase.com, entrar com o e-mail do condomínio, **New project**. Região: **South America (São Paulo)**. Senha do banco: gerar e guardar | São Paulo deixa o app rápido e o dado no Brasil | o painel do projeto abre |
| 1.2 Rodar o banco | **SQL Editor**, New query, colar `supabase/schema.sql` inteiro, **Run** | cria tabelas, regras, travas, feriados, modelos de e-mail e perguntas frequentes | aparece "Success". Depois `select chave, ativo from cond_servicos;` mostra 4 linhas (estacionamento `false`) |
| 1.3 Fechar o cadastro aberto | **Authentication > Sign In / Providers > Email**: desligar **Allow new users to sign up** | só entra quem foi convidado pela portaria ou pelo síndico (o convite funciona com isso desligado) | a opção fica desligada |
| 1.4 Primeiro síndico | no SQL Editor: `insert into cond_equipe (email, nome, cargo, permissoes) values ('sindico@exemplo.com.br', 'Helena', 'Síndico', array['reservas','moradores','denuncias','noticias','admin']);` Depois **Authentication > Users > Invite user** com o mesmo e-mail | o síndico cadastra o resto da equipe pelo próprio app (Pessoas > Funcionários) | o e-mail de convite chega (depois da fase 3) |
| 1.5 Endereço do site | **Authentication > URL Configuration**: **Site URL** = endereço do Netlify (fase 2); em **Redirect URLs**, o mesmo endereço | os links dos e-mails voltam para o app | preencher depois da fase 2 |
| 1.6 Pegar as chaves | **Project Settings > API**: **Project URL** e a chave **anon public** | vão nas variáveis do Netlify | guardadas no gerenciador |

**Plano:** o grátis serve para começar, mas **pausa o projeto depois de 7 dias sem acesso** e não tem cópia de segurança automática. Para uso de verdade, o **Pro (US$ 25 por mês)** tira a pausa e faz backup diário.

## Fase 2. Netlify (o site)

**Jeito A (recomendado): repositório privado no GitHub ligado ao Netlify.** Cada mudança enviada ao GitHub vira site novo sozinha.

| passo | o que faz | por quê | confere |
|---|---|---|---|
| 2.1 Repositório | subir a pasta do projeto num repositório **privado** no GitHub (o `.gitignore` deixa o `.env` de fora) | o Netlify gera o site a partir dele | `.env` não aparece no GitHub |
| 2.2 Ligar | app.netlify.com, **Add new project > Import an existing project > GitHub**, escolher o repositório | o Netlify lê o `netlify.toml` (`npm run build`, pasta `dist`) | a tela mostra esse build |
| 2.3 Variáveis | **Project configuration > Environment variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_NOME_CONDOMINIO` | sem elas o app abre em modo demonstração | as três listadas |
| 2.4 Publicar | **Deploys > Trigger deploy** | põe no ar | deploy verde, endereço `nome.netlify.app` |
| 2.5 Endereço | **Domain management**: nome do site ou o domínio próprio | endereço fácil de mandar | o endereço abre |

**Jeito B (linha de comando):** na pasta do projeto, com o `.env` preenchido: `npx netlify-cli login`, `npx netlify-cli sites:create --name nome-do-condominio`, `npm run check`, `npx netlify-cli deploy --dir=dist --prod`.

**Plano do Netlify:** o grátis dá 300 créditos por mês; um condomínio usa pouco, mas se os créditos acabarem o site pode ser pausado até o mês virar. Plano Personal: US$ 9 por mês.

## Fase 3. E-mail (Resend) e as funções do servidor

| passo | o que faz | por quê | confere |
|---|---|---|---|
| 3.1 Resend | resend.com, conta com o e-mail do condomínio, **Domains > Add domain**, colar os registros DNS no registro.br | só domínio verificado manda e-mail para qualquer pessoa | domínio "Verified" |
| 3.2 Chave | **API Keys > Create** (permissão de envio) | a função de notícias usa | guardada no gerenciador |
| 3.3 E-mail do login | Supabase, **Authentication > Emails > SMTP Settings**: host `smtp.resend.com`, porta 465, usuário `resend`, senha = a chave, remetente `avisos@exemplo.com.br` (o seu domínio) | o envio embutido do Supabase é só para teste (poucos por hora) | salvar sem erro |
| 3.4 Textos dos e-mails | **Authentication > Emails > Templates**. **Invite user**: botão com o link `{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=invite`. **Reset password**: `{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery`. Escrever em português ("Você foi cadastrado no condomínio. Toque para criar sua senha.") | o app confirma o link só quando a pessoa toca Salvar (proteção contra provedor que abre link sozinho) | mandar um convite de teste e abrir |
| 3.5 Limite | **Authentication > Rate Limits**: e-mails por hora (padrão 30) | no cadastro inicial do prédio, os convites saem em lote | ajustar ao tamanho do prédio |
| 3.6 Funções | instalar a linha de comando do Supabase e, na pasta do projeto: `npx supabase login`, `npx supabase functions deploy convidar --project-ref <ref>` e `npx supabase functions deploy enviar-noticias --project-ref <ref>` (o `<ref>` está na URL do projeto) | as duas funções rodam no servidor com a chave de serviço, que nunca vai no site | **Edge Functions** lista as duas |
| 3.7 Segredos das funções | **Edge Functions > Secrets**: `SITE_URL` (endereço do Netlify), `RESEND_API_KEY`, `REMETENTE` (ex.: `Condomínio X <avisos@exemplo.com.br>`), `NOME_CONDOMINIO` | a função de convite precisa do endereço; a de notícias, do Resend | quatro segredos listados |
| 3.8 Agendador | **Database > Extensions**: ligar `pg_cron` e `pg_net`. No SQL Editor: `select cron.schedule('cond-noticias', '*/5 * * * *', $$ select net.http_post(url := '<Project URL>/functions/v1/enviar-noticias', headers := jsonb_build_object('Authorization', 'Bearer <chave anon>', 'Content-Type', 'application/json'), body := '{}'::jsonb) $$);` | manda os e-mails agendados e os repetidos a cada 5 minutos | **Integrations > Cron** mostra o job rodando |

O plano grátis do Resend manda até 3.000 e-mails por mês (100 por dia). Um aviso para 120 moradores toda semana cabe; um lembrete diário para o prédio inteiro não cabe.

## Fase 4. Conferir antes de entregar (teste de fumaça)

Pelo celular, no endereço publicado:

1. A tela de entrada abre **sem** o quadro "Demonstração" (se aparecer, faltaram as variáveis da fase 2).
2. O síndico aceita o convite (link do e-mail), cria a senha e cai no painel.
3. Em Pessoas > Funcionários, cadastrar a portaria com os poderes de portaria: o convite chega.
4. A portaria cadastra um morador com e-mail (convite chega) e um sem e-mail (aparece o código).
5. O morador com e-mail cria a senha, entra e reserva uma lavagem. O outro entra com apartamento e código e vê o mesmo horário "ocupado", sem nome.
6. Uma denúncia anônima: o síndico vê, a portaria não. O síndico responde e resolve; o morador vê a resposta.
7. Em Notícias, publicar um aviso: aparece na aba Notificações do morador. Mandar um e-mail de teste para um morador: chega.
8. "Esqueci a senha" na entrada: o link chega e troca a senha.
9. Desativar os moradores de teste: o acesso deles acaba na hora.

## Fase 5. Depois de publicado

| tarefa | como | quem |
|---|---|---|
| Mudar tela ou texto | mudar o código, `npm run check`, enviar ao GitHub (publica sozinho) | suporte |
| Mudar regra (horário, limite, feriado da cidade, ligar estacionamento ou cobrança) | `supabase/schema.sql` **e** `src/config.ts`; rodar o `schema.sql` inteiro de novo e publicar o site | suporte |
| Mudar uma função do servidor | editar `supabase/functions/...` e repetir o `functions deploy` | suporte |
| Pessoas na equipe e poderes | o próprio síndico, em Pessoas > Funcionários | síndico |
| Cópia de segurança no plano grátis | **toda semana**: Table Editor, cada tabela `cond_*`, **Export to CSV**, guardar numa pasta do condomínio. No Pro é automático | suporte |
| Ver a auditoria completa | SQL Editor: `select * from cond_auditoria order by em desc limit 100;` | suporte ou síndico |

## Problemas comuns

| sintoma | causa provável | o que fazer |
|---|---|---|
| "Sem conexão com o sistema agora" para todo mundo | projeto **pausado** (plano grátis, 7 dias parado) | **Restore project** no Supabase; pensar no Pro |
| Convite não chega | SMTP não configurado, domínio não verificado ou limite por hora | fases 3.1, 3.3 e 3.5; conferir o spam |
| "Este link venceu ou já foi usado" | o convite vale 24 horas e só uma vez | Reenviar convite (portaria) ou Esqueci a senha |
| Equipe entra e recebe "não tem acesso" | o e-mail não está em `cond_equipe` ou está desativado | o síndico confere em Pessoas > Funcionários |
| E-mails agendados não saem | agendador parado ou segredos faltando | fase 3.8 (Cron) e 3.7 (Secrets); o log fica em Edge Functions > enviar-noticias > Logs |
| O site abre em modo demonstração | variáveis do Netlify faltando | fase 2.3 e publicar de novo |
