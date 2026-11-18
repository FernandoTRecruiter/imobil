# Arquitetura

## Em uma frase

Um site que roda no navegador (SPA) e conversa com uma camada de dados; hoje essa camada são dados fictícios no próprio navegador, na fase 2 é o Supabase (Postgres + login + arquivos). As telas não mudam na troca.

## Camadas

```
Tela (src/modules/*/Page.tsx)
  │  usa ganchos: useRepo / useRepoMutation (React Query: carregando, erro, cache)
  ▼
Repositório (src/modules/*/repo.ts)
  │  connect(sessão) -> escopo (espelho da RLS) -> regras -> lista paginada / gravação + auditoria
  ▼
Fonte de dados (VITE_DATA_SOURCE)
  ├─ mock (hoje): store.ts = semente + patch no localStorage
  └─ supabase (fase 2): mesma assinatura de função, consulta no Postgres com RLS
```

## Por onde o dado é alimentado

| fase | de onde vem | onde fica |
|---|---|---|
| 1 (template) | gerador com semente fixa (`src/data/seed/`), ancorado na data de hoje | memória do navegador; só o que você alterou vai para o `localStorage` |
| 2 | cadastro na tela, importação de planilha | Postgres do Supabase (região São Paulo), arquivos no Storage privado |

## Segurança (o que vira o quê na fase 2)

| hoje (fase 1) | fase 2 |
|---|---|
| `scope.ts` (`see.unit`, `see.contract`...) | políticas de RLS chamando funções `can_see_*` (SECURITY DEFINER, `search_path` vazio) |
| `organization_id` em toda linha + teste de isolamento | o mesmo + chave estrangeira composta `(id, organization_id)` |
| `rules.ts` (transições, sobreposição) | função do banco para mudar status; `EXCLUDE` com intervalo de datas |
| `audit()` no repositório | gatilho no banco grava `audit_logs` |
| documento: só o registro | bucket privado, caminho `org/doc/arquivo`, link assinado de poucos minutos |
| "Ver como" | Supabase Auth (convite por e-mail com SMTP próprio) |
| rotina simulada | `pg_cron` diário + Edge Function de e-mail, com `dedupe_key` |

## Trocar o mock pelo Supabase (fase 2)

1. Criar o projeto (região São Paulo) e rodar as migrations geradas a partir de `src/data/types.ts`.
2. Escrever as políticas de RLS a partir de `src/data/scope.ts` (uma por regra de `see`).
3. Em cada `repo.ts`, trocar o corpo de cada função pela consulta Supabase com o mesmo retorno (`ListResult` para listas).
4. `VITE_DATA_SOURCE=supabase` no `.env.local`. A bateria de isolamento passa a rodar contra o banco de desenvolvimento.

## Power BI

A Visão geral roda dentro do visual **HTML Content** do Power BI: `npm run powerbi` monta um HTML único (sem internet, 338 KB) e a medida DAX em 12 pedaços de até 30 mil caracteres; a medida transforma as tabelas do modelo (Unidades, Vagas, Contratos, Lancamentos, Chamados, Tarefas, Rotinas; nenhuma com coluna de pessoa) em JSON com `CONCATENATEX`, e as segmentações do relatório filtram os dados antes do painel desenhar. As fórmulas e os blocos são os MESMOS do app (`src/modules/visao-geral/metrics.ts` e `macro.ts`, funções puras; `figures.ts` e `Blocos.tsx`): os CSVs de exemplo dão os mesmos números da tela. Mesmo caminho do `gera_powerbi.py` do portfólio. Passo a passo em `powerbi/LEIA-ME.md`; ainda não foi aberto dentro de um Power BI de verdade.

## Aparência por organização

Cor da marca e cores/rótulos de situação (Configurações) valem no app inteiro e no portal: `src/data/appearance.ts` troca as variáveis de CSS só no tema claro, aplicado na abertura, na troca de persona e ao salvar. Na fase 2, com leitura assíncrona do banco, vira um provedor React com carregamento.
