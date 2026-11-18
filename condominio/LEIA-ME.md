# Condomínio

> O morador do condomínio reserva **lavagem e secagem** e **diária**, faz **denúncia** (anônima, se quiser) e lê os **avisos** do condomínio pelo celular, e acompanha a resposta da administração. A **equipe** (portaria, zeladoria, síndico, cada um com os poderes que o síndico marcar) atende pela web: calendário, solicitações, moradores e funcionários, avisos do app e e-mails em massa ou agendados. Substitui o que hoje corre no grupo de WhatsApp. O morador entra com **e-mail e senha** (convite que a portaria manda) ou com **apartamento e código** (para quem não usa e-mail).

Versão de portfólio, **gerada** a partir da versão de produção (script `gera_portfolio.py`, que fica fora desta pasta). **Não editar aqui:** mudar na origem e gerar de novo. Documentação geral do projeto: `../DOCUMENTACAO.md`.

## O que tem

| parte | para quem | o que faz |
|---|---|---|
| Entrada | morador | e-mail e senha, ou apartamento e código; "Esqueci a senha" |
| Calendário | morador | as reservas dele e os horários livres e ocupados (ocupado nunca diz de quem); feriados de BH |
| Solicitar | morador | lavagem e secagem, diária, denúncia; tela de "pronto" com som; Acompanhar com as respostas |
| Notificações | morador | avisos do condomínio (fixado em cima), últimas respostas da equipe, perguntas frequentes |
| Calendário e Solicitações | equipe com "reservas" ou "denuncias" | números do topo que filtram, filtros, o dia escolhido, ações, horários livres |
| Pessoas / Moradores | equipe com "moradores" (e "admin" para Pessoas) | estatísticas, cadastro com e-mail, CPF, vaga, histórico e acesso de cada morador; funcionários e poderes |
| Notícias | equipe com "noticias" | avisos do app com prévia, e-mails agora, agendados ou repetidos, modelos |

**Desligados por chave (17/11):** o pedido de **estacionamento** (`ativo` no serviço) e a **cobrança** (`cobra` nas regras). Somem de todas as telas; voltam mudando um valor (ver "Mudar uma regra").

**Denúncia transparente:** quem denunciou vê cada passo e a resposta. Resolver ou arquivar exige resposta escrita. Na anônima o banco não grava apartamento nem morador. Sem limite de quantidade.

**Feriados (Belo Horizonte):** calculados pelo banco para qualquer ano (nacionais, os 4 de BH pela Lei 11.397/2022, Carnaval e emendas prováveis); o síndico ajusta decretos.

**Auditoria:** cadastro, convite, código novo, desativação, funcionários, feriado e e-mails ficam registrados com quem fez.

## Rodar no computador

```
npm install
npm run dev          # http://localhost:5190  (sem .env = modo demonstração)
npm run check        # tipos + 78 testes + build
npm run arquivo      # gera Condominio.html e Condominio-equipe.html: o app num arquivo só (sempre demonstração)
```

**Modo demonstração:** dados fictícios no navegador. Morador: a entrada mostra moradores de exemplo (aba E-mail, senha `morador1`; aba Código). Equipe: botões Portaria, Síndico e Zeladoria. Nenhum e-mail sai: o convite mostra um link de demonstração que abre a tela de criar a senha. "Restaurar dados de exemplo" volta tudo ao começo.

## Documentos

| documento | para quem | o que tem |
|---|---|---|
| [docs/PUBLICAR.md](docs/PUBLICAR.md) | quem instala e dá suporte | Supabase, Netlify e Resend do zero, funções do servidor, agendador, teste de fumaça, manutenção, problemas comuns |
| [docs/MANUAL-DA-ADMINISTRACAO.md](docs/MANUAL-DA-ADMINISTRACAO.md) | portaria, síndico, administradora | o dia a dia no sistema e o que pedir ao suporte |
| [docs/ACESSO-POR-EMAIL.md](docs/ACESSO-POR-EMAIL.md) | quem desenvolve | como o convite, a senha e o código funcionam |

## Mudar uma regra

| quero mudar | onde |
|---|---|
| horário da lavanderia, períodos da diária, dias abertos, dias à frente, limite por semana, tipos de denúncia | `supabase/schema.sql` seção 1 (rodar de novo) **e** `src/config.ts` (o teste avisa se ficarem diferentes) |
| ligar ou desligar um serviço; ligar a cobrança | `ativo` e `cobra` nos mesmos dois lugares |
| feriados de outra cidade | tabela `cond_feriados_locais` **e** `FERIADOS_LOCAIS_PADRAO` em `src/config.ts` |
| o que cada poder libera | funções `cond_*` no `schema.sql` (`cond_pode('...')`) e `PERMISSOES` em `src/adm/Funcionarios.tsx` |
| textos de erro | `MENSAGENS` em `src/regras.ts` |
| cores | variáveis no topo de `src/styles.css` |

## Onde está cada coisa

```
supabase/schema.sql          o banco inteiro: tabelas, funções cond_*, travas, feriados, modelos
supabase/functions/          convidar (convite por e-mail) e enviar-noticias (e-mails da aba Notícias)
src/config.ts, feriados.ts   regras e feriados (modo demonstração)
src/regras.ts                datas, horários, situações, CPF, estatísticas, mensagens
src/dados/                   api.ts (a porta única), demo.ts, supabase.ts
src/morador/                 Morador (entrar, calendário), Solicitar, Notificacoes
src/adm/                     Adm (moldura, filtros, números), Calendario, Solicitacoes, Pessoas, Funcionarios, Noticias
src/CriarSenha.tsx           criar ou trocar a senha pelo link do e-mail
tests/                       banco.test.ts (o SQL num Postgres local), demo.test.ts, regras.test.ts
scripts/                     gera-arquivo.mjs (arquivo único)
```

## Limites de hoje

- Não testado ainda contra um Supabase, Netlify e Resend de verdade: o banco é testado num Postgres local que imita o Supabase; as duas funções do servidor não têm teste automático.
- Denúncia sem foto.
- Denúncia anônima: limpar o navegador ou trocar de celular perde o acompanhamento. Os registros de acesso do Supabase (só o dono do projeto vê) guardam o IP de cada chamada por alguns dias.
- 5 códigos errados travam o apartamento por 15 minutos (um vizinho consegue travar outro de propósito).
- A equipe vê os últimos 90 dias de solicitações; o histórico de cada morador mostra tudo.
- Lavanderia é uma máquina (uma reserva por horário).
- Envio de e-mail em lote é um por vez (bom para um prédio; um condomínio de milhares de unidades pediria outro jeito).
