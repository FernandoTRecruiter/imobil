# Imobil: plano do Marco 0 (para aprovação)

04/11/2026. Escrito antes da primeira linha de código.
Quando aprovado, este arquivo vira `imobil/docs/PLANO.md`.

## Mini dicionário (vale para o documento todo)

- **Organização**: a conta cliente (uma imobiliária ou um proprietário). Em SaaS isso se chama "tenant", mas aqui "tenant" se confunde com inquilino; por isso o código usa `organization`.
- **Multi-tenant**: um sistema só atendendo várias organizações, cada uma vendo só o que é dela.
- **RLS (Row Level Security)**: regra escrita dentro do banco que decide, linha por linha, quem lê e quem grava. Se a tela errar, o banco ainda barra.
- **SPA (Single Page Application)**: site que roda inteiro no navegador e conversa direto com o banco; dispensa servidor próprio.
- **Migration**: arquivo SQL numerado que cria ou altera tabelas. O banco é montado rodando todos em ordem, sempre igual.

---

## A. Diagnóstico do estado atual e riscos

### Estado atual (inspecionado)

| # | item | o que encontrei |
|---|---|---|
| 1 | pasta `imobil` | não existe; o projeto começa do zero, nada a preservar |
| 2 | máquina | Node 26.12, npm 11.20, Bun 1.3, Git 2.55, Python 3.14; **sem Docker** e sem Supabase CLI |
| 3 | `people-analytics-dashboard/js/ambiente-mapa.js` (portfólio) | mapa isométrico em SVG (643 linhas): giro em 4 ângulos, planta/3D, andares, minimapa, pintura por profundidade. Base do Marco 6 |
| 4 | `financas-pessoais/index.html` (portfólio) | `parseCSV` (acha `;`, `,` ou tab), separador decimal, coluna adivinhada pelo nome com a última escolha lembrada, "repetir não duplica". Base do assistente de importação |
| 5 | `people-analytics-dashboard/js/graficos.js` (portfólio) | ordenação pelo cabeçalho |

Referências de mapa, o que aproveito de cada uma:
- **Real.Invest** (a principal): cidade isométrica clara, prédios coloridos pela situação com número em selo, painel lateral de lista, zoom +/-.
- **Residencial russo**: navegação Empreendimento → Bloco → Andar com trilha clicável, balão com resumo por tipologia (quantas de 1, 2, 3 quartos), filtro por nº de quartos.
- **outletbuddy** (escura): lista sincronizada com o mapa e cartão flutuante com "Mais detalhes".

### Riscos, do mais grave ao menos

1. **Escopo do tamanho de um sistema de mercado.** São 12 módulos, num mercado com Superlógica, Imobzi, Jetimob, Kenlo e outros. Sem um primeiro usuário real, o MVP é aposta. O 3D encanta na demonstração, mas ninguém troca de sistema por causa dele.
2. **Imobiliária não migra sem cobrança.** O briefing deixa boleto, PIX e banco para depois. Imobiliária vive de cobrar, conciliar e repassar; sem isso ela mantém o sistema atual e usa o nosso como planilha bonita. Para o proprietário independente, o MVP como está resolve. Por isso: validar primeiro com proprietário, ou trazer a cobrança para o MVP se o piloto for imobiliária (pergunta 1 da seção K).
3. **"Fazer tudo de primeira" x marcos.** Leio como "cada marco sai certo na primeira entrega", não "tudo de uma vez".
4. **Segurança no fim da fila.** O briefing põe os testes de RLS no Marco 7. Isolamento testado só no fim já vazou antes: o teste nasce no Marco 1 e cresce a cada tabela.
5. **Pilha pesada para "sem muita dependência".** Next.js mais 9 bibliotecas logo de saída contradiz a regra 11. A proposta abaixo tira Next.js, Recharts e Three.js do começo.
6. **Custo e operação.** O Supabase grátis não tem backup que se baixe; com dado real de cliente, plano pago (cerca de US$ 25/mês, backup diário) ou rotina própria de cópia (`pg_dump`). O e-mail embutido do Supabase manda poucos e-mails por hora: convites quebram sem SMTP próprio.
7. **LGPD fora do código.** Você será **operador** dos dados das imobiliárias (elas são **controladoras**): precisa de termo de tratamento de dados com cada cliente, termos de uso e política de privacidade. Código não resolve isso.

---

## B. Arquitetura proposta e justificativa

**Decisão 1: um produto só, com tipo de conta.**
- **O que:** uma aplicação; a organização é `landlord` (proprietário) ou `agency` (imobiliária). O tipo liga e desliga módulos: o proprietário não vê carteiras, repasses, equipe nem "portal do proprietário" (ele já é o dono).
- **Por quê:** o dado é o mesmo (imóvel, unidade, contrato, cobrança). Dois produtos são dois códigos para manter, e o proprietário que cresce teria de migrar.
- **Risco:** a tela do proprietário inchar com coisa de imobiliária. Trava: critério de aceite "proprietário não vê nenhum menu de imobiliária".

**Decisão 2: SPA + Supabase, sem servidor próprio.**

```
Navegador (React SPA)
   │  cada pedido leva o token de quem está logado
   ▼
Supabase
   ├─ Auth ............ login, convite, troca de senha
   ├─ Postgres ........ tabelas + RLS + funções  (a REGRA MORA AQUI)
   ├─ Storage ......... arquivos em bucket privado, link que expira
   ├─ Edge Functions .. o que exige segredo: enviar e-mail, aceitar convite
   └─ pg_cron ......... rotina diária: vencimentos, tarefas, avisos
```

- **Por quê:** regra no banco vale para qualquer caminho (tela, importação, Data Manager, console do navegador). Sem servidor nosso, o site é arquivo estático: hospedagem grátis ou quase.
- **Por que não Next.js:** ele serve quando há página pública que o Google precisa ler ou lógica de servidor própria. O MVP não tem nenhuma das duas, e Next.js cobra um conceito extra (componente de servidor x de cliente).
- **Fica para depois:** site público de anúncios; aí Next.js ou Astro fazem sentido.

**Decisão 3: dinheiro em centavos inteiros (`bigint`).** R$ 1.234,56 é gravado como 123456. Conta com vírgula no JavaScript erra (0,1 + 0,2 = 0,30000000000000004). No rateio entre proprietários o centavo que sobra vai para alguém de forma explícita (R$ 1.000,01 em 50/50 = 500,01 + 500,00), e a soma sempre fecha.

**Decisão 4: data e fuso.** Vencimento e competência são `date` (sem hora); eventos são `timestamptz` (com hora e fuso). "Hoje" é calculado no fuso da organização pelo nome (`America/Sao_Paulo`, não `-03:00` fixo, que quebra se o horário de verão voltar). Em UTC, uma conta que vence hoje apareceria vencida às 21h.

**Decisão 5: ocupação vem do contrato, não de um campo.** "Ocupada" = existe locação vigente hoje. Os outros status (disponível, reservada, manutenção, bloqueada) são escolhidos à mão. Quando há um fato com data, o fato ganha do status.

**Decisão 6: regras de negócio no banco.** Constraint (trava declarada na tabela), trigger (gatilho que roda a cada gravação) e função RPC (função do banco chamada pela tela). Exemplos: duas locações vigentes na mesma unidade no mesmo período são recusadas pelo próprio banco (`EXCLUDE` com intervalo de datas); mudança de status só por transição permitida, com histórico. O Data Manager edita pela mesma porta, então não fura a regra.

**Decisão 7: duas bases.** `imobil-dev` (desenvolvimento e dados fictícios) e `imobil-prod` (só cliente real), região São Paulo. Dado de demonstração nunca entra em produção. Sem Docker: a CLI do Supabase aplica as migrations direto na base de desenvolvimento.

**Decisão 8: idioma.** Código e banco em inglês (padrão das bibliotecas e da documentação que você vai ler); tela, documentação e comentários didáticos em pt-BR.

---

## C. Mapa de navegação e telas

Moldura: barra lateral compacta (ícone + rótulo, recolhe para só ícone), barra de cima com busca geral, troca de organização (para quem pertence a mais de uma), sino de avisos e avatar. Visual da referência Real.Invest: fundo claro, cartões brancos, azul como única cor de destaque; cor forte só com significado (situação da unidade). Identidade própria.

```
IMOBILIÁRIA (admin e colaborador)            PROPRIETÁRIO INDEPENDENTE
├─ Visão geral                               ├─ Visão geral
├─ Imóveis   Empreendimento › Bloco ›         ├─ Imóveis
│            Andar › Unidade                  ├─ Mapa
├─ Mapa      geográfico + isométrico          ├─ Pessoas (inquilinos, prestadores)
├─ Pessoas                                    ├─ Contratos
├─ Contratos                                  ├─ Financeiro
├─ Financeiro  Lançamentos · Repasses         ├─ Manutenção
├─ Manutenção  Chamados · Vistorias           ├─ Dados (importar e exportar)
├─ Processos   Tarefas · Modelos              └─ Configurações
├─ Dados       Data Manager · Importação
├─ Relatórios
└─ Configurações  Empresa · Usuários · Papéis · Carteiras · Modelos · Auditoria

PORTAL (mesma aplicação; o papel reduz o menu)
├─ Proprietário convidado: Meus imóveis · Contratos · Extratos e repasses · Documentos · Aprovações · Mensagens
├─ Inquilino: Meu contrato · Cobranças · Chamados · Documentos
└─ Prestador: Meus chamados (só os atribuídos a ele)
```

| # | tela | o que tem |
|---|---|---|
| 1 | Visão geral | faixa de indicadores (unidades, ocupação %, vacância %, a receber no mês, recebido, inadimplência, contratos vencendo em 60 dias); alertas com botão que leva à lista já filtrada; atividade recente; filtros de período, empreendimento, carteira e responsável |
| 2 | Imóveis | alternância **Tabela · Espelho · Mapa**. O **espelho** (nome que as incorporadoras usam para a grade andar × unidade colorida pela situação) chega no Marco 2 a custo quase zero e entrega boa parte do valor espacial antes do 3D |
| 3 | Detalhe da unidade | cabeçalho fixo com a situação; abas Resumo · Contratos · Pessoas · Financeiro · Manutenção · Documentos · Histórico |
| 4 | Cadastrar imóvel | etapas Tipo → Endereço (o CEP preenche) → Estrutura (blocos, andares e unidades por modelo) → Proprietários (% de cada) → Revisão; rascunho salvo a cada etapa |
| 5 | Contrato | etapas Unidade → Partes → Valores e reajuste → Garantia → Revisão; linha do tempo com cada evento e quem fez |
| 6 | Financeiro | abas **Previsto · Vencido · Recebido · Pago**; baixa manual numa janela; demonstrativo de repasse por proprietário |
| 7 | Mapa | geográfico com pinos e contagem → clicar abre o isométrico do empreendimento; trilha Empreendimento › Bloco › Andar; painel lateral da unidade com atalhos (contrato, pessoas, financeiro, manutenção); legenda; giro de 90°, zoom, planta/3D |
| 8 | Dados | Data Manager (tabela editável), assistente de importação, exportação |
| 9 | Configurações | empresa e identidade visual, usuários e convites, papéis, carteiras, status e cores, modelos de contrato e de processo, auditoria |

**Estados em toda tela:** carregando (esqueleto da tela), vazio com ação ("Cadastrar primeiro imóvel", "Importar planilha"), erro com motivo e "Tentar de novo", sucesso em aviso que some sozinho, confirmação com o nome do que vai sumir ou "Desfazer".

**QoL que toda tela leva:** ordenar pelo cabeçalho; busca sem acento com contador "N de M"; filtro com contagem verdadeira e "Limpar"; escolhas lembradas no navegador; exportar o que está na tela; "i" com a fórmula no lugar de parágrafo; clicar leva ao detalhe; cabeçalho que não mexe; 3 larguras e celular sem rolagem lateral.

---

## D. Fluxos principais

1. **Primeiro acesso, imobiliária:** cria a conta → cria a organização (tipo, nome, CNPJ) → convida colaboradores → escolhe "Importar planilha" ou "Cadastrar primeiro imóvel" → visão geral.
2. **Primeiro acesso, proprietário:** cria a conta → escolhe "proprietário" → cadastra o imóvel (casa ganha a unidade sozinha) → cadastra o inquilino → contrato → cobranças geradas.
3. **Importar planilha:** tipo de dado → arquivo e aba → amostra com mapeamento sugerido → regras para vazio e duplicado → validação (CPF/CNPJ, datas, valores, obrigatórios, referências) → prévia com válidos, avisos e erros por linha → grava em lote → relatório + "Desfazer" (só enquanto nada do lote foi usado depois).
4. **Nova locação:** unidade disponível → partes (locador, locatário, fiador) → valor, dia de vencimento, índice e mês de reajuste, garantia (uma modalidade só: a Lei do Inquilinato proíbe duas no mesmo contrato) → revisão → aprovação → aguardando assinatura (assinatura fora do sistema no MVP) → ativo → cobranças mensais geradas → unidade passa a ocupada.
5. **Recebimento:** cobrança vence → aparece em Vencido → baixa manual (valor, data, forma) → Recebido; pagamento parcial deixa o saldo aberto.
6. **Repasse (imobiliária):** fecha o mês → o sistema monta o demonstrativo por proprietário (aluguel recebido − taxa de administração − despesas do proprietário, rateado pela % de cada) → revisão → aprovação → pago.
7. **Renovação (processo):** a rotina diária acha contrato vencendo em 60 dias → cria a tarefa uma vez só → aviso no sistema e por e-mail → proposta → aprovação do proprietário (se habilitada) → aditivo ou novo período.
8. **Manutenção:** inquilino, proprietário ou colaborador abre o chamado → triagem → orçamento do prestador → aprovação do proprietário (acima do limite combinado) → execução → conclusão com fotos → despesa lançada com "quem paga" (proprietário, inquilino ou imobiliária).
9. **Convite de proprietário:** a imobiliária liga a pessoa ao imóvel → convida por e-mail → a pessoa cria a senha → entra no portal vendo só o que está ligado a ela.

---

## E. Modelo de dados inicial

**Regras que valem para todas as tabelas**
- Toda tabela operacional tem `organization_id` obrigatório e indexado.
- **Chave estrangeira composta** `(id, organization_id)`: o banco não aceita ligar um contrato da organização A a uma unidade da B, nem por erro de código.
- Chave `uuid`; `created_at`, `updated_at`, `created_by`; `deleted_at` (exclusão lógica, a linha fica escondida) nos cadastros. Contrato, pagamento e auditoria **nunca** são apagados: são cancelados ou encerrados.
- **Pessoa gravada uma vez só**: tabela `people` única (física ou jurídica). Ser proprietário, inquilino, fiador ou prestador vem da ligação, não de tabelas separadas. CPF/CNPJ é único dentro da organização (a mesma pessoa em duas imobiliárias são duas linhas, uma por organização, e uma não enxerga a outra).
- Dinheiro em `bigint` (centavos); percentual em `numeric(7,4)`.

```
organizations ─┬─ memberships ── profiles (login)
               ├─ people ─┬─ property_owners ── properties ─ buildings ─ floors ─ units
               │          └─ contract_parties ── contracts ── (aponta a unidade)
               │                                   ├─ contract_events
               │                                   └─ financial_entries ── payments
               ├─ documents · audit_logs · import_batches
               └─ depois: owner_transfers · maintenance_requests · inspections · workflows · tasks · notifications
```

| # | tabela | o que guarda | marco |
|---|---|---|---|
| 1 | `organizations` | tipo (`landlord`/`agency`), nome, CNPJ/CPF, fuso, plano, logo e cor | 1 |
| 2 | `profiles` | quem faz login; liga em `auth.users` do Supabase, que guarda e-mail e senha | 1 |
| 3 | `memberships` | quem pertence a qual organização e com qual papel (admin, staff, owner, lessee, vendor); para owner, lessee e vendor aponta a pessoa em `people`; para staff guarda as permissões por módulo (`finance:edit`) | 1 |
| 4 | `invitations` | convite: e-mail, papel, validade; o código do convite fica guardado só como hash | 1 |
| 5 | `people` | física ou jurídica, nome, CPF/CNPJ, contatos, endereço, observações, `user_id` quando tem acesso ao portal | 2 |
| 6 | `properties` | imóvel ou empreendimento: tipo, nome, endereço completo, latitude e longitude, carteira | 2 |
| 7 | `property_owners` | pessoa × imóvel × % (o banco confere soma = 100% por unidade), com vigência para guardar a troca de dono. `unit_id` vazio = dono do imóvel inteiro; preenchido = dono só daquela unidade (corrigido em 04/11: no condomínio cada apartamento tem matrícula e dono próprios) | 2 |
| 8 | `buildings` | bloco ou torre; posição no terreno para o mapa | 2 |
| 9 | `floors` | andar: `level` (ordem) e `label` ("Térreo", "Mezanino", "Cobertura") | 2 |
| 10 | `units` | unidade alugável: código, tipo, área, quartos, banheiros, vagas, características, status manual, posição no andar. Casa sozinha = imóvel com 1 unidade criada automaticamente, então **toda locação aponta para uma unidade** | 2 |
| 11 | `portfolios` | carteiras, para agrupar imóveis e limitar o colaborador | P1 |
| 12 | `import_batches` | lote de importação: tipo, arquivo, mapeamento, contagens, erros por linha, desfeito em. Cada linha importada leva `import_batch_id`, que é o que permite desfazer | 3 |
| 13 | `audit_logs` | quem, quando, tabela, linha, ação, antes e depois; só cresce | 1 |
| 14 | `contracts` | tipo (locação, administração, outro), unidade ou imóvel, status, início, fim, aluguel, dia de vencimento, índice e mês de reajuste, garantia (uma modalidade), caução (até 3 aluguéis), taxa de administração, multa e juros, quem criou, revisou e aprovou, contrato anterior (renovação). Trava `EXCLUDE`: mesma unidade com períodos que se cruzam, ambos vigentes, é recusado | 4 |
| 15 | `contract_parties` | pessoa × contrato × papel (locador, locatário, fiador, procurador) + % quando há mais de um locador | 4 |
| 16 | `contract_events` | linha do tempo única do contrato: mudança de status, reajuste (índice e %), aditivo, renovação, observação; data de efeito, quem fez, documento. Status só muda por função que confere a transição permitida | 4 |
| 17 | `financial_entries` | a receber ou a pagar: categoria (aluguel, condomínio, IPTU, taxa, manutenção, repasse, outro), competência, vencimento, valor, ligação com contrato, unidade, imóvel e pessoa, `charged_to` (quem arca). **"Vencido" não é gravado**: é aberto + vencimento antes de hoje no fuso da organização. Despesa é lançamento a pagar: a `expenses` do briefing vira categoria, sem tabela duplicada | 4 |
| 18 | `payments` | baixa manual: data, valor, forma, referência, quem registrou; aceita parcial; o lançamento vira "pago" quando a soma alcança o valor | 4 |
| 19 | `documents` | arquivo no Storage + nome, tipo, tamanho, visibilidade (interno, proprietário, inquilino), ligado a UMA entidade por chave estrangeira de verdade (o banco exige exatamente uma preenchida) | 4 |
| 20 | `owner_transfers` + `owner_transfer_items` | repasse por proprietário e mês, com os lançamentos que o compõem; rascunho, aprovado, pago | 5 |
| 21 | `maintenance_requests` | chamado: unidade, quem abriu, categoria, prioridade, status, prestador, responsável, prazo, orçamento, aprovação do proprietário, quem paga | 5 |
| 22 | `inspections` | vistoria de entrada, periódica ou saída; checklist por cômodo em JSON; fotos em `documents` | 5 |
| 23 | `workflow_templates`, `workflow_instances`, `tasks` | modelo de processo com etapas (responsável, prazo, exige aprovação), processo em andamento ligado a contrato ou chamado, tarefas (também avulsas) | 5 |
| 24 | `automation_rules`, `automation_runs` | regra ("contrato vence em N dias → tarefa + aviso") e o registro de cada execução com sucesso ou erro | 5 |
| 25 | `notifications` | aviso no sistema e por e-mail com `dedupe_key` única (mesma regra, mesmo contrato, mesmo dia = um aviso só), tentativas, último erro | 5 |
| 26 | `building_models` | modelo paramétrico do bloco (torre, lâmina, casas em fila, casa): andares, unidades por andar, formato, orientação | 6 |
| 27 | `floorplan_elements` | cômodos, paredes, portas e janelas como polígonos em metros, com `source` (modelo, manual, IA) e `review_status` (rascunho, aprovado). A importação futura de PDF, DXF ou IFC grava aqui como rascunho; a pessoa revisa; só o aprovado vira 3D. Cobre a `unit_rooms` do briefing | 6 |

Alertas simples do MVP (contrato vencendo, reajuste do mês) são **consulta na hora**, sem tabela; tarefa e aviso gravados chegam com os processos no Marco 5.

---

## F. Matriz de papéis e permissões

| módulo | Admin da imobiliária | Colaborador | Proprietário (portal) | Inquilino | Prestador |
|---|---|---|---|---|---|
| Visão geral | tudo | conforme permissão | só os seus imóveis | não | não |
| Imóveis e unidades | edita e arquiva | vê; edita com permissão | vê os seus | vê a própria unidade | só o endereço do chamado |
| Pessoas | edita | vê; edita com permissão | só o próprio cadastro | só o próprio cadastro | só o próprio cadastro |
| Contratos | edita e aprova | edita; aprova com permissão | vê os seus; aprova renovação se habilitado | vê o próprio | não |
| Financeiro | edita, dá baixa, aprova repasse | vê; edita com permissão | extratos e repasses dos seus | as próprias cobranças | não |
| Manutenção | tudo | tudo | abre; aprova orçamento dos seus | abre e acompanha os seus | vê e atualiza os atribuídos |
| Documentos | todos | os dos módulos que acessa | marcados "proprietário", dos seus imóveis | marcados "inquilino", do próprio contrato | anexos do chamado atribuído |
| Dados (Data Manager, importar) | sim | com permissão | não | não | não |
| Configurações, usuários, auditoria | sim | não | não | não | não |

1. Na conta de **proprietário independente**, ele é o admin da própria organização; o papel "proprietário convidado" só existe na imobiliária.
2. Colaborador nasce sem permissão administrativa; o admin liga ver/editar por módulo e, no P1, por carteira.
3. Uma pessoa pode ter mais de um papel na mesma organização (proprietário de um imóvel e inquilino de outro); o acesso é a soma.
4. A tela só esconde o que o banco já recusaria; quem decide é a RLS.
5. Aprovar contrato, aprovar repasse, desativar usuário, importar e desfazer importação vão para a auditoria com nome e hora.

---

## G. Estratégia multi-tenant e LGPD

**Modelo:** banco único, esquema único, `organization_id` em toda linha + RLS. Descartados: um esquema por cliente (cada mudança vira N migrations) e um banco por cliente (caro, e o briefing pede para não criar instalação isolada por cliente).

**Camadas contra vazamento entre organizações**
1. RLS ligada em **toda** tabela exposta. Tabela sem política = ninguém lê (o padrão é negar).
2. As políticas chamam poucas funções auxiliares: `is_member(org)`, `has_permission(org, 'finance:edit')`, `can_see_property(id)`, `can_see_contract(id)`, `is_assigned_vendor(chamado)`. Limitar colaborador por carteira no P1 muda **uma** função, não 27 políticas.
3. Essas funções são `SECURITY DEFINER` com `search_path` vazio (sem isso, uma função de mesmo nome criada em outro lugar pode ser chamada no lugar da nossa) e usam `(select auth.uid())`, que o Postgres calcula uma vez por consulta em vez de uma vez por linha.
4. Chave estrangeira composta (seção E): ligação entre organizações é impossível no banco.
5. View sempre com `security_invoker = true`. Sem isso a view roda com o poder de quem a criou e **ignora a RLS**: é a armadilha mais comum do Supabase.
6. A chave `service_role` (que ignora a RLS) só existe em Edge Function e script local; nunca no navegador nem no Git. `.env.example` vai sem valores.
7. Storage: bucket privado, caminho começando pelo `organization_id`, política que confere pertença e visibilidade do documento, link assinado de poucos minutos.
8. **Bateria de isolamento desde o Marco 1**: duas organizações de teste, um usuário por papel, tentativas de ler e gravar o proibido; o esperado é zero linhas ou erro. Roda antes de toda publicação.
9. Quem pertence a duas organizações escolhe a ativa na tela; a RLS libera as duas e a tela filtra a escolhida. A segurança não depende dessa escolha.

**LGPD: o que o sistema faz**
1. Coleta só o necessário para locar (nome, CPF/CNPJ, contato, endereço). Sem foto de documento, renda, score ou dado de saúde no MVP.
2. Exporta os dados de uma pessoa (JSON/CSV) e anonimiza a pedido, preservando o que a lei manda guardar (contrato e lançamento ficam; o nome vira "Titular anonimizado").
3. Log técnico só com ids, nunca nome, CPF ou e-mail. A auditoria, que guarda antes e depois, só o admin vê.
4. Banco na região São Paulo (evita a discussão de transferência internacional, art. 33); criptografia em repouso e em trânsito pelo provedor.
5. Dado fictício só na base de desenvolvimento, com faixa "Ambiente de demonstração" na tela.

**LGPD: o que precisa de advogado** (não afirmo conformidade automática)
1. Papéis: você operador dos dados dos clientes e controlador dos dados de conta; termo de tratamento de dados com cada cliente.
2. Prazos de guarda e de exclusão (as regras fiscal e cível costumam pedir anos; o número exato é decisão jurídica).
3. Base legal de cada tratamento (quem define é o cliente, que é o controlador).
4. Roteiro de incidente: o regulamento da ANPD de 2024 dá poucos dias úteis para comunicar; ter o roteiro escrito antes do primeiro cliente.
5. Termos de uso e política de privacidade.

---

## H. Roadmap: MVP e evoluções

**MVP para validar com o primeiro usuário real = Marcos 1 a 4.** Evoluções = 5 a 7.

| marco | entrega | pronto quando |
|---|---|---|
| 0 | este plano | você aprovar |
| 1 Fundação | projeto, design system (tokens, moldura, tabela, formulário, estados), login, criar organização, convite, papéis, RLS, auditoria, bateria de isolamento, duas bases, publicação | usuário de A não lê nem grava nada de B (bateria verde); login, convite e troca de organização funcionam |
| 2 Cadastros | imóveis, blocos, andares, unidades por modelo paramétrico, pessoas, proprietários com %, Data Manager, espelho andar × unidade | criar, editar, filtrar e arquivar; empreendimento de 2 blocos × 5 andares × 4 unidades criado por modelo em menos de 2 minutos |
| 3 Migração | assistente de importação (imóveis, unidades, pessoas), modelos de planilha, exportação CSV/XLSX, desfazer lote | planilha de 500 linhas com 20 erros: prévia mostra 480 válidas e os 20 com linha, coluna e motivo; desfazer remove as 480 |
| 4 Operação | contratos e partes, transições com histórico, cobranças recorrentes, baixa manual, despesas, documentos, alertas, visão geral; importação de contratos e lançamentos | fluxos 4 e 5 da seção D de ponta a ponta; cada indicador bate com a soma feita direto na tabela |
| 5 Portal e processos | portais do proprietário, inquilino e prestador; repasses; manutenção e vistorias; processo de renovação; tarefas; avisos e e-mail; documento gerado por modelo | proprietário convidado vê exatamente os seus imóveis; a rotina rodada 2 vezes no mesmo dia cria a tarefa 1 vez |
| 6 Espacial | mapa geográfico; isométrico por modelo ligado às unidades reais; status com cor e legenda configuráveis; giro, zoom, planta | clicar na unidade do 3D abre o mesmo registro da tabela; sem o 3D (celular fraco) tudo segue pela lista |
| 7 Lançamento | revisão de segurança independente, acessibilidade, desempenho com volume, backup e restauração, monitoramento, documentação | uma restauração de backup feita de verdade; checklist de produção completo |

**O que mudei em relação ao briefing, e por quê**
1. Teste de RLS sai do Marco 7 e nasce no 1: isolamento conferido só no fim já vazou antes.
2. Espelho andar × unidade adiantado para o 2: custo baixo, boa parte do valor espacial.
3. Importação de contratos e lançamentos vai para o 4: no 3 essas tabelas ainda não existem. O assistente é um só; cada entidade ganha seu perfil quando nasce.
4. Visão geral no fim do 4: os indicadores dependem de contrato e lançamento.
5. Documento gerado por modelo vai para o 5: o 4 já é o marco mais pesado.

**Fora do MVP, com o motivo:** boleto/PIX e conciliação (exige contrato com intermediador de pagamento; volta à pauta se o piloto for imobiliária), assinatura eletrônica (adaptador, fornecedor escolhido depois), reajuste automático por IGP-M/IPCA (API do Banco Central; no MVP a pessoa digita o %), DIMOB e informe de rendimentos, compra e venda, domínio próprio por cliente, tema escuro (os tokens já nascem prontos para ele), planta por IA, app nativo.

---

## I. Dependências por etapa

| # | dependência | para que serve | marco |
|---|---|---|---|
| 1 | `vite`, `react`, `react-dom`, `typescript` | base: monta o site e roda em desenvolvimento | 1 |
| 2 | `@supabase/supabase-js` | conversa com banco, login e arquivos | 1 |
| 3 | `tailwindcss` + `@tailwindcss/vite` | estilo por tokens (cores, espaços) num lugar só | 1 |
| 4 | `@tanstack/react-router` | navegação com os filtros na URL: o "voltar" funciona e o link copiado abre a mesma visão | 1 |
| 5 | `@tanstack/react-query` | carregando, erro, vazio e cache iguais em toda tela | 1 |
| 6 | `zod` | regra de validação escrita uma vez para formulário, importação e tipos | 1 |
| 7 | shadcn/ui (copiado para dentro do projeto; traz Radix, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`) | janela, menu, balão e abas já com teclado e leitor de tela; feito à mão, é onde a acessibilidade costuma quebrar | 1 |
| 8 | `vitest` (desenvolvimento) | testes de regra e a bateria de isolamento | 1 |
| 9 | CLI `supabase` (desenvolvimento, pelo npm) | migrations, tipos gerados do banco, publicar funções; sem Docker | 1 |
| 10 | `react-hook-form` + `@hookform/resolvers` | formulário em etapas com rascunho e validação pelo zod | 2 |
| 11 | `@tanstack/react-table` | Data Manager: ordenar, filtrar, paginar, colunas configuráveis, edição na célula, com o nosso desenho | 2 |
| 12 | `@playwright/test` (desenvolvimento) | testa os fluxos críticos como uma pessoa usaria; usa o Edge já instalado | 2 |
| 13 | SheetJS (`xlsx`), instalado **do site oficial do SheetJS** | ler XLSX, XLS e CSV e gravar XLSX; carrega só na tela de importação. A versão do registro npm parou na 0.18.5 e tem falhas de segurança conhecidas | 3 |
| 14 | Resend, por HTTP dentro da Edge Function (sem pacote) | e-mail de aviso e SMTP próprio para os convites | 5 |
| 15 | `docxtemplater` + `pizzip` | preencher o modelo de contrato em Word da própria imobiliária com {campos} | 5 |
| 16 | `pg_cron` e `pg_net` (extensões do Postgres) | rotina diária e chamada da função de e-mail | 5 |
| 17 | `leaflet` + provedor de mapa com chave (MapTiler ou Stadia) | mapa geográfico; o servidor público do OpenStreetMap não serve para uso comercial | 6 |
| 18 | `@axe-core/playwright` (desenvolvimento) | varredura automática de acessibilidade | 7 |

**Ficam de fora, com o gatilho para entrar**
- **Next.js:** quando houver site público de anúncios.
- **Recharts:** os indicadores são número e a barra pintada atrás do rótulo (CSS puro). Entra se aparecer gráfico que não seja trivial.
- **Three.js / React Three Fiber:** o isométrico em SVG do `ambiente-mapa.js` já faz giro de 90°, zoom e planta, é leve e cada unidade vira elemento focável pelo teclado. Entra se o cliente exigir rotação livre ou o empreendimento passar de alguns milhares de unidades.
- **Biblioteca de datas:** conta de data no Postgres (somar um mês a 31/01 dá 28/02) e formato pelo `Intl` do navegador.
- **Docker:** a base de desenvolvimento é um projeto Supabase na nuvem.
- **Pacote de CEP:** ViaCEP por HTTP, sem chave.

---

## J. Critérios de aceite e plano de testes

**Camadas de teste**

| camada | ferramenta | o que prova | quando roda |
|---|---|---|---|
| Regras puras | vitest | rateio fecha no centavo; CPF/CNPJ pelo dígito verificador; coluna adivinhada; CSV com `;` e vírgula decimal; "vencido" no fuso certo | a cada mudança |
| Banco e isolamento | vitest + supabase-js na base `imobil-dev`, com um usuário de teste por papel | a matriz da seção F inteira: cada papel tenta o que não pode; trava de locação sobreposta; transição de status inválida recusada; auditoria gravada | a cada migration e antes de publicar |
| Fluxos | Playwright no Edge | fluxos 1 a 5 da seção D; celular com 390 px de largura real; nenhum erro de JavaScript | antes de publicar |
| QoL | Playwright | ordenar inverte e volta; contagem do filtro = linhas na tela; "Limpar" volta ao número de antes; exportar gera arquivo com as N linhas | antes de publicar |
| Acessibilidade | axe + uma passada só com teclado | foco visível, rótulos, contraste de pelo menos 4,5:1 | fim de cada marco |
| Volume | 5.000 unidades e 50.000 lançamentos fictícios | listas paginadas no servidor; visão geral abre em até 2 s | Marcos 4 e 7 |

**Critérios de aceite** (cada um dá para conferir com sim ou não)

| # | critério | marco |
|---|---|---|
| 1 | Com o token de um usuário da organização A, consultar `units` da B pelo console do navegador devolve 0 linhas; gravar com o `organization_id` da B dá erro | 1 |
| 2 | Proprietário independente não vê nenhum menu de imobiliária | 1 |
| 3 | Arquivar unidade com locação vigente é bloqueado, e a mensagem diz o motivo | 2 |
| 4 | CPF com dígito errado é recusado no formulário e na importação: "CPF inválido: dígito verificador não confere" | 2 e 3 |
| 5 | CSV salvo pelo Excel brasileiro (`;`, vírgula decimal, acento em Windows-1252) importa sem caractere quebrado | 3 |
| 6 | Desfazer importação recusa, listando o que impede, quando algum registro do lote já foi usado | 3 |
| 7 | Segunda locação vigente sobreposta na mesma unidade é recusada pelo banco, inclusive por chamada direta à API | 4 |
| 8 | Vencimento no dia 31 cai em 28 ou 29 de fevereiro; cobrança que vence hoje só aparece vencida depois da meia-noite de Brasília | 4 |
| 9 | Rateio de R$ 1.000,01 em 50/50 soma exatamente R$ 1.000,01 | 4 e 5 |
| 10 | Cada indicador da visão geral tem "i" com a fórmula e bate com a soma feita direto na tabela | 4 |
| 11 | Documento "interno" não abre pelo portal do proprietário nem pelo link direto; o link assinado expira | 4 e 5 |
| 12 | Rotina de renovação rodada 2 vezes no mesmo dia gera 1 tarefa e 1 e-mail; falha fica em `automation_runs` com o motivo | 5 |
| 13 | Unidade clicada no 3D abre o mesmo registro da tabela; o 3D só carrega quando a aba é aberta | 6 |
| 14 | Toda tabela com os QoL da seção C; toda tela em 1680, 1366, 1024 e 390 px sem rolagem lateral da página | todos |

Ao fim de cada marco: testes, lint e build rodados com o resultado real informado; README e `docs/` atualizados.

---

## K. Dúvidas bloqueantes e premissas

**Bloqueiam o Marco 1**
1. **Quem é o primeiro usuário real?** (a) você ou alguém próximo como proprietário independente; (b) uma imobiliária específica; (c) ninguém ainda. Muda a ordem dos Marcos 4 e 5 e decide se PIX/boleto entra no MVP. Recomendo (a).
2. **Custo:** o desenvolvimento cabe no plano grátis (Supabase, hospedagem do site, Resend). Antes do primeiro dado real de cliente: Supabase pago (cerca de US$ 25/mês, pelo backup diário), domínio e e-mail com domínio. Pode?

**Premissas** (valem se você não disser o contrário)
1. "Fazer de primeira" = cada marco certo na entrega.
2. Um app só para os dois públicos (seção B).
3. Só Brasil: BRL, pt-BR, CPF/CNPJ, CEP, fuso `America/Sao_Paulo`.
4. Assinatura eletrônica, cobrança bancária e índice automático ficam como adaptador documentado, com modo de demonstração que não finge validade jurídica.
5. "Funcionário" do briefing = colaborador da imobiliária.
6. "Imobil" é nome provisório.
7. Comentário didático em pt-BR em todo arquivo: por que cada função existe e o passo a passo.
8. A mensalidade que os seus clientes pagariam (planos do SaaS) fica fora do MVP; existe só a coluna `plan`.

---

## L. Decisões de 04/11 e a fase 1 (template)

1. Aprovadas as 3 mudanças: isolamento testado desde o começo; sem Next.js, Recharts e Three.js de saída; validar com proprietário. Ainda sem usuário real: os dois perfis entram.
2. **Fase 1 = template completo da interface com dados fictícios** e camada de dados pronta para o banco. Supabase, login real, e-mail, arquivos guardados e rotinas no horário ficam para a fase 2.
3. **Power BI = a Visão geral dentro do visual HTML Content**, pelo mesmo caminho do `gera_powerbi.py` do portfólio: HTML único sem internet, medida DAX em pedaços de 30 mil caracteres que monta os dados com `CONCATENATEX`, CSVs de exemplo no formato do esquema. Segmentação do Power BI filtra os dados antes do painel desenhar.

**Como "pronto para o backend" fica concreto**
- Tela → gancho de dados (React Query) → repositório → fonte. Hoje a fonte é `mock` (memória do navegador + `localStorage`); na fase 2, `supabase`. As telas não sabem qual é.
- O repositório fictício aplica as mesmas regras que o banco vai aplicar: escopo por organização e papel (espelho da RLS), locação sobreposta recusada, transição de status, validação, auditoria.
- `src/data/types.ts` segue as 27 tabelas da seção E (uuid, `organization_id`, centavos, datas ISO).
- No lugar do login, o seletor **"Ver como"** troca a persona: admin, colaborador, proprietário convidado, inquilino, prestador, proprietário independente.
- Faixa "Dados de demonstração" sempre visível.

| etapa | o que entra |
|---|---|
| T1 Fundação | projeto, tokens e moldura, rotas de todos os módulos, dados fictícios, seletor de persona, permissões, tabela com os QoL, estados, testes das regras |
| T2 Imóveis e pessoas | lista, detalhe, espelho, cadastro em etapas, unidades, pessoas, proprietários com % |
| T3 Contratos e financeiro | contratos (etapas, linha do tempo, transições), lançamentos (Previsto, Vencido, Recebido, Pago), baixa, repasse, documentos |
| T4 Visão geral, relatórios e Power BI | indicadores, alertas, relatórios com exportação, Visão geral no Power BI |
| T5 Manutenção e processos | chamados, orçamento, vistorias, processos, tarefas, avisos (rotina simulada e idempotente) |
| T6 Portais e configurações | portais do proprietário, inquilino e prestador; empresa, usuários, papéis, status e cores, modelos, auditoria |
| T7 Dados | Data Manager, assistente de importação, exportação, modelos de planilha |
| T8 Mapa | geográfico + isométrico ligado às unidades |
| T9 Qualidade | todas as telas em 4 larguras, acessibilidade, README e docs |

Cada etapa termina com lint, testes e build rodados e o resultado informado.

**Estado em 05/11/2026:** T1 a T8 concluídas (fundação por Claude; os módulos por 6 agentes em paralelo). Integração feita: 218 testes, tipos, lint e build limpos; varredura de telas em `tests/varredura.py`. Decisões novas: `DECISOES.md` 019 a 028.

**Estado em 06/11/2026 (rodada 2, pedidos do Fernando):** direção visual nova; `Imobil.html` de dois cliques; menu com 9 itens; maquete na Visão geral; modelos novos de prédio (condomínio de 3 blocos, prédio largo de 3 andares, casas em fileira); equipe do prédio com foto, rotinas de manutenção, comunicados e e-mails simulados, tudo no histórico; chamado de área comum. Depois, "muita bagunça": Imóveis ficou com duas abas (Mapa e Unidades), o mapa trocou de fundo e agrupa pinos, e as fichas, Configurações e Tarefas perderam abas (DECISOES 029 a 037). 283 testes, tipos, lint e build limpos.

**Rodada 3 (06/11/2026):** "ainda tá tudo confuso" virou a lógica de navegação do CONVENCOES; Imóveis virou tela única com o mapa em cima e a tabela embaixo; a Visão geral usa o mapa de ruas; os dados de demonstração viraram os 4 empreendimentos de `exemplos.ts`; vaga de garagem virou unidade; cada imóvel tem o 3D da implantação dele, com "Mostrar no mapa" (DECISOES 038 a 043). 311 testes, tipos, lint e build limpos.
