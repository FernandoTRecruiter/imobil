# Convenções: como se faz um módulo no Imobil

Leia antes de mexer em qualquer tela. O repositório de referência é `src/modules/documentos/repo.ts`; a tela de lista de referência é `src/modules/contratos/ContratosPessoasPage.tsx` (lista, filtro, exportação, linha que abre, ficha curta, detalhes). Copie a forma deles.

## Pastas

```
src/
  data/        o "banco": tipos (types.ts = contrato com o banco da fase 2), dados fictícios (seed/),
               store (memória + patch), escopo (scope.ts = espelho da RLS), regras (rules.ts),
               lista (query.ts), rótulos (labels.ts), ganchos (hooks.ts), conexão (api.ts)
  auth/        sessão, persona, permissões (matriz F do plano)
  app/         moldura, menu, "Ver como", Guard
  components/ui/  peças compartilhadas (Button, Field, DataTable, ListToolbar, Dialog, Layout...)
  lib/         regras puras: dinheiro, datas, CPF/CNPJ, busca, CSV, estado de lista
  modules/<módulo>/  repo.ts + páginas + componentes do módulo + <módulo>.test.ts
  routes/      só liga endereço à página (gerado; mexa só no do seu módulo, e só para validateSearch)
```

## Repositório do módulo (`repo.ts`)

1. Toda função recebe a `Session` e começa por `const { db, sc } = await connect(s)`.
2. **Nunca leia `db.<tabela>` sem filtrar pelo escopo** (`see.unit(sc, u)`, `see.contract(sc, k)`, `see.entry(sc, e)`...). É isso que vira RLS na fase 2. Tabela sem regra em `see`: filtre por `organization_id === s.org.id` e pelo papel, e escreva a regra no próprio repo com comentário.
3. Listas devolvem `runList(linhasEnriquecidas, params, config)`: busca, filtros com contagem, ordenação e paginação acontecem aqui, não na tela.
4. Gravação: conferir permissão (`can(s, 'x:edit')` ou `sc.all`) → validar com zod (a tela também valida, mas o repo é a porta que não pode faltar) → regra de negócio (`RuleError` com causa e conserto) → `upsertRows` → `audit(...)` → devolver a linha.
5. Nada é apagado de verdade em cadastro, contrato, pagamento ou auditoria: use `deleted_at`, status de encerramento ou cancelamento.
6. Ganchos para a tela: `useRepo('chave', (s) => listarX(s, params), [params])` e `useRepoMutation(gravarX, { success: 'Texto.' })`.

## Regras de dado que não se reinventam

| assunto | onde está | regra |
|---|---|---|
| dinheiro | `lib/money.ts` | centavos inteiros; `formatBRL`, `parseBRL`, `applyPct`, `splitByShares` (rateio que fecha) |
| datas | `lib/dates.ts` | `'AAAA-MM-DD'` sem fuso; "hoje" é `s.today`; vencimento mensal por `dueDateFor` |
| vencido | `data/rules.ts` | `entryState(e, s.today)`: nunca gravado |
| ocupada | `data/rules.ts` | `occupiedUnitIds(db, s.today)` + `effectiveUnitStatus`: vem do contrato vigente |
| status de contrato | `data/rules.ts` | só por `CONTRACT_TRANSITIONS`; cada mudança vira `contract_events` |
| locação sobreposta | `data/rules.ts` | `leasesOverlap` com `HOLDING_STATUSES` |
| donos da unidade | `property_owners` | da unidade (`unit_id`) ou, se não houver, do imóvel inteiro (`unit_id` vazio) |
| rótulos | `data/labels.ts` | todo código do banco tem texto em pt-BR aqui |

## Tela

- Anatomia única: `PageHeader` → (faixa de `KpiTile`) → `ListToolbar` → `DataTable` → `Pagination`. Detalhe: `DetailHeader` → `Tabs` → `Section` + `DescriptionList` + `Timeline`.
- Envolva a página em `<Guard action="...">`. Botão de ação some quando `can(s, ...)` é falso, mas a regra de verdade está no repo.
- Toda lista: ordenar pelo cabeçalho (`sortable`, `firstDir: 'desc'` para número e data), busca sem acento, filtro com contagem (das `facets`), "Limpar", contador "N de M", exportar o que está filtrado (`onExport(format)` + `downloadTable` de `lib/exportar.ts`; valor com `csvMoney` e "(R$)" no nome da coluna), escolhas lembradas (`useListState`).
- Barra de lista (07/11/2026): sempre a `ListToolbar`, uma linha: [`leading` = troca de categoria com `Segmented`] busca, "Filtros" (painel; caixa sim/não da tela vai em `toggles`, nunca solta na linha), extras da tela (`children`: só ação, como "Novo contrato"), "N de M", "Colunas" (`columns` de `useColumnChooser('<tabela>', colunas)`: coluna nova que não é essencial nasce `optional`, a que nomeia a linha é `locked`, e toda coluna diz o que vira no arquivo em `export`) e "Exportar" (menu .xlsx ou CSV, com `exportColumnsOf(colunas à vista)`). Nada de outro botão de exportar com outro nome; importar é ação à parte, no cabeçalho. Comparar: `compareColumn` + `CompareTray` + `CompareDialog` (`components/ui/Compare.tsx`), números de `compare-model.ts`.
- Estados: carregando (`Skeleton`/`PageSkeleton`), vazio com ação (`EmptyState`), erro com "Tentar de novo" (`ErrorState`), sem acesso (`Guard`).
- Gravar: botão com `loading` (evita envio duplo); sucesso em toast; apagar/arquivar com "Desfazer" no toast ou `ConfirmDialog` com o nome do que muda.
- Formulário: `react-hook-form` + `zodResolver`, `mode: 'onBlur'`, `Field` com rótulo visível e erro que diz causa e conserto ("CPF com 10 dígitos: falta um").
- Cor só pelos tokens (`bg-surface`, `text-muted`, `text-primary`, `var(--st-...)`). Uma cor de destaque (azul). Cor de situação sempre com texto junto.
- Larguras: 1680, 1366, 1024 e 390 px sem rolagem lateral da PÁGINA (tabela larga rola dentro da moldura). Use `hideBelow` nas colunas secundárias.
- Acessibilidade: rótulo em todo controle, `aria-label` em botão só de ícone, alvo de clique de pelo menos 24 px, foco visível.
- Gráfico: sem biblioteca. Comparação por categoria = `BarList` (barra atrás do rótulo). Série no tempo = SVG simples do próprio módulo, com resumo em texto.

## Lógica de navegação (06/11/2026, depois do "tá tudo confuso")

1. **Uma ficha por coisa.** Imóvel, unidade, pessoa e contrato têm UM lugar cada: o imóvel na página dele (`/imoveis/$id`), a unidade escolhida nela (`?unidade=`), o contrato e a pessoa escolhidos em "Contratos e pessoas" (`/contratos?contrato=`, `?lista=pessoas&pessoa=`). Nada de painel lateral ou cartão que repete a ficha em outro lugar: duas versões da mesma informação fazem a pessoa perguntar "qual é a certa?". Documento não tem lugar próprio: aparece onde pertence (contrato, imóvel, unidade, chamado, pessoa).
2. **O mapa é o foco.** Mapa ou 3D grande; à direita, a ficha CURTA do que está escolhido (ou o resumo do todo, sem escolha); embaixo, as tabelas e o histórico detalhados. Os três leem o mesmo resultado.
3. **Clicar escolhe; abrir é explícito** (06/11, "não quero mudança de página por interações simples"). Pino, linha da tabela ou unidade do 3D ACENDEM a coisa, enchem a ficha curta e trocam os detalhes de baixo, sem sair da página. Trocar de página só pelo botão "Abrir imóvel" (ou link para outra coisa: pessoa, contrato). A escolha fica no endereço (`?imovel=`, `?unidade=`), gravada com replace. A unidade não tem página própria: `/unidades/<id>` abre o imóvel com ela escolhida.
4. **Um filtro só por tela**, acima do desenho, valendo para o desenho e para a tabela.
5. **Aba só para o que é secundário e grande, e só troca no clique da própria aba.** Até 4 abas; abas que respondem à mesma pergunta viram seções da mesma aba. Escolher outra coisa volta à primeira aba dela; nada pula de aba sozinho. Endereço antigo de aba cai na aba que recebeu o conteúdo.

## Direção visual (05/11/2026)

- **Produto:** cuida dos imóveis alugados de quem é dono ou administra. **Caráter:** exato, sereno, de prancheta.
- **Mundo:** maquete branca de arquiteto sobre a prancha. Neutros cinza-papel (`--bg`, `--surface`, `--maq-*`), linha fina, um azul de planta (`--primary`) só para ação principal, seleção e "ocupada".
- **Momentos** (onde a cor pode ser rica): o mapa da carteira (Imóveis) e o 3D de cada imóvel, na ficha dele. A Visão geral é um painel de números (blocos de `visao-geral/Blocos.tsx`), sem mapa desde 07/11. O resto (menu, barra, cartões) fica quieto.
- **Assinatura:** o marco de ocupação, um círculo `--ink` com o % em Geist Mono (`.num`), no topo de cada prédio, pino e bloco. Um só desenho, sempre igual.
- Fonte Geist (texto) + Geist Mono (números, via `.num`). Peso 400/500 (no tema, "semibold" = 500 e "bold" = 600). Nada de caixa alta espaçada, letra apertada, pílula em tudo (controle raio 8, cartão 12, etiqueta 6), gradiente, brilho, vidro, emoji, `animate-pulse`, `transition-all`, `hover:scale`, exclamação ou saudação. Ícone lucide com `strokeWidth={1.5}`, na cor do texto. Título diz o que é ("Carteira", não "Bem-vindo").
- Menu (7 itens): Visão geral (com botão Relatórios), Imóveis (mapa em cima, tabela Imóveis | Unidades | Vagas embaixo; o 3D fica na ficha de cada imóvel), Contratos e pessoas (tabela Contratos | Pessoas cuja linha abre; Documentos saiu do menu e mora em cada coisa), Financeiro, Manutenção, Tarefas, Configurações (com botões para Dados).

## Peças que já resolvem armadilhas (use, não reinvente)

- **Indicador clicável**: `KpiTile` com `onClick` e `info` juntos é seguro (o cartão inteiro clica, o "i" é botão separado) e os números ficam na mesma linha.
- **Abrir outra tela já filtrada**: `writeJSON('imobil:list:<chave>', { filters, sort: null, pageSize: 25 })` antes de navegar; dentro da mesma tela, `list.replaceFilters(...)` troca todos os filtros de uma vez.
- **Abrir em aba ou categoria**: as telas de detalhe aceitam `?aba=` e Imóveis aceita `?lista=imoveis|unidades|vagas` (endereço antigo com `?modo=` ou `?imovel=` ainda funciona).
- **Vaga de garagem**: é unidade do tipo `parking` (contrato, cobrança e ficha de unidade), mas nunca entra em conta de unidade, ocupação ou vacância (`isSpot` em `data/views/units.ts`; `lite.ts` já a tira da Visão geral e do Power BI). Lista de unidades sem vaga: recorte `spot: ['nao']` na consulta, nunca na lista lembrada. Tabela de vagas: `VagasTable` (`modules/imoveis`).
- **Arquivados**: `listUnits` e `listPeople` escondem arquivados por padrão, mas contam (o filtro `archived: ['sim']` mostra).
- **Situação da unidade**: rótulo por `UNIT_STATUS[...]` lido na hora de desenhar e cor por `UNIT_STATUS_VAR`; as duas seguem o que a organização configurou (`data/appearance.ts`).
- **Campo com largura própria**: passe `className="w-40"` no `Input`/`Select`; o `w-full` padrão sai sozinho.

## Texto (tela, comentário, documentação)

- pt-BR. "Colaborador", nunca "funcionário". Termo técnico traduzido na primeira vez.
- Sem travessão (o caractere U+2014), sem "não é X, é Y", sem frase de efeito no fim, sem "vale ressaltar".
- Legenda curta; a fórmula vai no "i" (`InfoTip`), nunca em parágrafo de aviso.
- Dados fictícios: nunca escreva nome de empresa ou pessoa real.

## Comentário de código

Cabeçalho de cada arquivo com o que ele resolve e por quê; passo a passo numerado nas funções longas; comentário explica o PORQUÊ e a armadilha que a escolha evita. Legível antes de curto.

## Testes

`src/modules/<módulo>/<módulo>.test.ts` com Vitest: `resetForTest('2026-11-04')` + `buildSession(db, USER.x)` (fixe `s.today`). Teste as regras do módulo e o escopo (quem não pode ver não vê). Rodar: `npx vitest run src/modules/<módulo>`.

## Comandos

`npm run dev` (desenvolvimento) · `npm test` · `npm run lint` · `npm run build` · `npm run check` (os três).
