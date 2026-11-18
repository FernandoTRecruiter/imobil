# Manual da administração

> Para a portaria, o síndico e a administradora. O sistema substitui o grupo de WhatsApp em três coisas: reserva da **lavanderia** (lavagem e secagem), reserva da **diária** (manhã ou tarde) e **denúncia**, e ainda leva os **avisos** e os **e-mails** da administração para os moradores. O morador usa pelo celular; a equipe usa pelo computador ou pelo celular. Nada aqui exige conhecimento técnico; o que é técnico fica com o suporte (última seção).

## Endereços

| quem | endereço |
|---|---|
| Morador | o endereço do sistema (ex.: `condominiox.com.br`) |
| Equipe | o mesmo endereço com `/#/adm` no final |

## Quem faz o quê (os poderes)

Cada pessoa da equipe tem os **poderes** que o síndico marcar em Pessoas > Funcionários:

| poder | libera |
|---|---|
| Reservas | calendário e solicitações (menos denúncias); cancelar reserva |
| Moradores | cadastrar, editar, desativar, mandar convite, gerar código, ver o histórico |
| Denúncias | ver e responder denúncias |
| Notícias | avisos do app, perguntas frequentes, e-mails para os moradores |
| Administrar | estatísticas, funcionários e poderes, feriados |

Combinações prontas: **Portaria** (reservas, moradores, notícias), **Zeladoria** (reservas) e **Síndico** (todos). Sem o poder de denúncias a pessoa não vê denúncia nenhuma, de propósito: uma denúncia pode ser sobre ela.

## O cabeçalho e os números do topo

As páginas ficam numa linha embaixo do nome do sistema. Os números do topo (Hoje, Próximos 7 dias, **Denúncias em aberto** em vermelho) também **filtram**: clicar mostra só aquilo, na mesma página; clicar de novo tira. A barra de filtros acompanha a rolagem da página (no computador), e o botão **Limpar** fica vermelho quando há algum filtro ligado. Em Solicitações, o período "de / até" mostra o que acontece naqueles dias (a denúncia conta pelo dia em que chegou).

## Moradores (portaria)

**Cadastrar.** Pessoas (ou Moradores) > **Cadastrar morador**: nome, apartamento, e-mail, telefone, CPF, desde quando mora e se tem vaga de garagem (e qual). Tudo é opcional, menos nome e apartamento.
- **Com e-mail (recomendado):** ao salvar, o morador recebe o **convite** para criar a senha. Leia o e-mail de volta com ele antes de salvar: e-mail errado vai para outra pessoa. O link vale 24 horas; depois, **Reenviar convite**.
- **Sem e-mail** (quem não usa, idoso, por exemplo): aparece um **código** de 6 letras e números, uma vez só. **Copiar mensagem** e cole no WhatsApp do morador. Dá para ter os dois: marque "Gerar também um código".

**O detalhe do morador** (clique na linha) tem três abas: **Dados**, **Histórico** (o que ele pediu e o que a equipe fez no cadastro) e **Acesso** (convite, senha criada, último acesso, código). Os botões: Editar, Enviar e-mail, Reenviar convite, Código novo, Desativar.

**Esqueceu a senha:** ele mesmo resolve em "Esqueci a senha" na entrada. **Perdeu o código:** **Código novo** (o antigo para de valer na hora).

**Se mudou:** **Desativar**. O acesso acaba na hora e as reservas futuras são canceladas. O histórico fica.

**Filtros:** período de cadastro (de / até), busca, "sem acesso há 30 dias" e "mostrar desativados". A tabela ordena clicando no cabeçalho e **Exportar** baixa a planilha. O CPF aparece mascarado na tabela e inteiro no detalhe.

## Síndico

**Estatísticas** (Pessoas > Moradores): moradores ativos, tempo médio de moradia, pedidos por morador nos últimos 90 dias e os favoritos de todos os tempos (horário da lavanderia e período da diária, contando todo o histórico).

**Funcionários** (Pessoas > Funcionários): cadastre quem trabalha no condomínio com o e-mail e os poderes; a pessoa recebe o convite. **Desative no mesmo dia** quem sair. O sistema não deixa ficar sem ninguém com o poder de administrar.

**Denúncias:** chegam como Recebida. **Começar análise** ao tratar; para **Resolver** ou **Arquivar** é obrigatório escrever a resposta, que quem denunciou lê. A anônima não diz quem enviou, e ninguém tem como descobrir. Não há limite de denúncias: o canal nunca recusa.

**Feriados e emendas:** o sistema já sabe os nacionais, os de Belo Horizonte, o Carnaval e as emendas prováveis. A diária não abre em feriado. Decreto de ponto facultativo ou emenda que o condomínio não faz: clique no dia no calendário e use **Marcar feriado ou emenda**.

## Notícias (portaria e síndico)

- **Avisos do app:** os avisos (com "Fixar no topo") e as perguntas frequentes da aba Notificações do morador aparecem direto no centro; clicar no cartão abre a edição ali mesmo. Ao lado, a **prévia** mostra exatamente como o morador vê. Desmarcar "Publicado" deixa como rascunho. Embaixo, os **e-mails enviados e agendados**, com o botão de cancelar o agendado.
- **E-mails:** para todos os moradores com e-mail ou para alguns; agora, agendado, ou repetindo (todo dia, semana ou mês). Em "Escolher moradores", atalhos mostram só um andar, quem tem vaga de garagem ou quem ainda não ativou o acesso, e "Marcar todos da lista" seleciona o grupo de uma vez. A prévia mostra o e-mail com o nome de um morador. Para um morador só: botão **Enviar e-mail** no detalhe dele.
- **Modelos:** textos prontos. Já vêm **Aviso de denúncia** (não cita quem denunciou) e **Encomenda na portaria**. `{{nome}}`, `{{apto}}` e `{{condominio}}` viram os dados de cada morador.

Quem entra só com código não tem e-mail e não recebe e-mails; os avisos do app chegam para todos.

## O que o morador vê (para tirar dúvidas)

- Entra com **e-mail e senha** ou com **apartamento e código**. O celular lembra.
- **Calendário:** as reservas dele e os horários livres e ocupados. Nunca vê de quem é o horário ocupado.
- **Solicitar:** lavagem e secagem (blocos de 1 hora, das 7h às 22h, até 7 dias à frente, até 3 por semana), diária (manhã ou tarde, segunda a sábado, até 14 dias à frente, até 2 por semana) e denúncia. Embaixo, Acompanhar, com as respostas da equipe.
- **Notificações:** avisos do condomínio, as últimas respostas da equipe aos pedidos dele e as perguntas frequentes.
- Ao enviar um pedido aparece uma tela de confirmação com o resumo e o número. Reserva faz um som curto (o ícone de alto-falante desliga); a denúncia não faz som e acolhe a pessoa.

## Cuidados

- O login da equipe é pessoal. Não deixe o computador da portaria aberto sem ninguém.
- O código do morador é pessoal; entregue só à própria pessoa.
- Denúncias têm dados de outras pessoas: não tire print, não encaminhe, não comente no grupo. Para avisar o morador denunciado, use o modelo "Aviso de denúncia", que não diz quem relatou.
- Combine com o suporte por quanto tempo as denúncias encerradas ficam guardadas.

## Peça ao suporte

| situação | prazo |
|---|---|
| Mudar horário da lavanderia, períodos da diária, limites, tipos de denúncia | quando decidir |
| Ligar o pedido de vaga de estacionamento ou a cobrança (hoje desligados) | quando decidir |
| O sistema mostra "Sem conexão com o sistema" para todo mundo | na hora |
| Convites ou e-mails não chegam | na hora |
| Relatório completo do que a equipe fez | quando precisar |
