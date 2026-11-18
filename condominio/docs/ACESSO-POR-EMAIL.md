# Acesso do morador por e-mail e senha (construído em 17/11/2026)

> A portaria cadastra o morador com o **e-mail** dele e, na mesma hora, o sistema manda um **convite** com o link para criar a senha. O morador toca no link, cria a senha e passa a entrar com e-mail e senha. Não existe tela de "primeiro acesso". Quem não usa e-mail continua entrando com apartamento e o código da portaria; a forma de acesso é escolhida no cadastro (dá para ter as duas). Se a pessoa deixa de morar, a portaria desativa e o acesso acaba na hora. A equipe entra do mesmo jeito: o síndico cadastra o funcionário e ele recebe o convite.

## Por que o convite resolve

O link chega só na caixa de entrada daquele e-mail: quem cria a senha prova que lê o e-mail. Ninguém consegue chegar antes do morador.

## Como funciona, passo a passo

| passo | quem | o que acontece | onde está |
|---|---|---|---|
| 1 | portaria | cadastra com e-mail (e, se quiser, também um código) | `cond_criar_morador` |
| 2 | sistema | a função do servidor `convidar` confere no banco se quem pediu pode (`cond_convite_pedir`) e manda o convite com a chave de serviço | `supabase/functions/convidar` |
| 3 | morador | toca no link (`?token_hash=...&type=invite`), abre **Criar sua senha**, salva | `src/CriarSenha.tsx` |
| 4 | morador | entra com e-mail e senha; o banco acha o morador pelo e-mail confirmado da sessão | `cond_conferir` |
| 5 | morador | esqueceu: **Esqueci a senha** manda o link de troca (`type=recovery`) | `api.esqueciSenha` |
| 6 | portaria | link vencido: **Reenviar convite** | `cond_convite_pedir` + `convidar` |
| 7 | portaria | se mudou: **Desativar**; toda função confere `ativo` a cada chamada | `cond_editar_morador` |

## Cuidados que ficaram no desenho

1. **E-mail digitado errado vai para um estranho**, que cria a senha e entra como o morador. Por isso a portaria lê o e-mail de volta com a pessoa, e cada convite fica na auditoria com quem mandou.
2. **O app confirma o link só no Salvar**, nunca ao abrir: alguns provedores de e-mail abrem os links sozinhos para procurar vírus, o que gastaria o link antes do morador. E o endereço do app já usa `#` para as páginas, por isso o link usa `?token_hash=` (o jeito padrão do Supabase usaria `#` e daria conflito).
3. **Cadastro aberto desligado:** só a função `convidar` (e o painel do Supabase) cria usuário.
4. **Casal com o mesmo e-mail** é uma conta só; quem quiser conta própria precisa de e-mail próprio ou usa o código.

Publicação (SMTP, textos dos e-mails, funções, segredos): `docs/PUBLICAR.md`, fase 3.
