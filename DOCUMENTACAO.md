# Imobil: documentação do projeto

> O Imobil é um projeto pessoal de produto (SaaS, programa vendido por assinatura) para quem cuida de imóveis alugados: a imobiliária e o proprietário que administra sozinho. Hoje é um modelo completo das telas com dados fictícios, pronto para ligar num banco de verdade (Supabase) na fase 2. O projeto tem dois aplicativos: o Imobil (gestão de imóveis, contratos, cobranças e manutenção) e o Condomínio (o dia a dia do prédio pelo celular do morador, com o painel da administração).
>
> Como funciona, em passos: 1) os dados fictícios nascem de uma semente fixa (sempre os mesmos) e cada mudança feita na tela fica guardada no navegador; 2) cada tela pede os dados a um "repositório", que aplica as mesmas regras de acesso que o banco vai aplicar (cada pessoa vê só o que é dela); 3) o mapa ou o 3D fica em destaque, a ficha curta do que foi escolhido fica ao lado e os detalhes ficam embaixo; 4) clicar só escolhe, e trocar de página é sempre um botão explícito; 5) `npm run arquivo` gera um arquivo único (Imobil.html) que abre com dois cliques, sem servidor.

## Os aplicativos

| app | pasta | para quem | estado |
|---|---|---|---|
| Imobil | `imobil/` (raiz) | imobiliária, proprietário, inquilino, prestador | fase 1 concluída, rodadas de ajuste 2 a 5 (06/11) |
| Condomínio | `imobil/condominio/` | morador (celular) e equipe do condomínio (portaria, zeladoria, síndico, com poderes marcados pelo síndico) | versão 2, enxuta e com banco de verdade (17/11) |

Os dois são separados (cada um roda sozinho), com o mesmo jeito de construir e o mesmo desenho, para a integração futura: o condomínio do app Condomínio é um imóvel do Imobil, e as unidades, as pessoas e as vagas usam os mesmos códigos.

## Imobil

- **Para abrir:** a demonstração em `docs/demo/index.html` (no GitHub Pages ou com dois cliques), ou `npm run arquivo`, que gera o `Imobil.html`. Para mexer no código: `npm install` e `npm run dev`.
- **Dados de exemplo:** 4 empreendimentos (`src/data/seed/exemplos.ts`, fonte única dos dados e do 3D): Condomínio Luar, Condomínio Mount Juic e Lynx Residence na imobiliária; Edifício Le Plaza na conta da proprietária independente.
- **Telas:** Visão geral (painel de números macro com a comparação com o período anterior, o que pede atenção e o desempenho da equipe; sem mapa), Imóveis (mapa, ficha curta, tabela de imóveis, unidades ou vagas), ficha do imóvel (3D da implantação e, embaixo, unidades e vagas, contratos, manutenção, documentos e histórico), Contratos e pessoas (tabela de contratos ou de pessoas cuja linha abre com as partes e os documentos, ficha curta ao lado), Financeiro, Manutenção, Tarefas, Configurações, e os portais do proprietário, do inquilino e do prestador (documentos em "Meus contratos"). Documento não tem tela própria: fica no contrato, no imóvel, na unidade, no chamado ou na pessoa.
- **Onde ler mais:** `README.md` (como rodar e quem é cada persona), `docs/PLANO.md` (o plano e o estado), `docs/CONVENCOES.md` (como se faz uma tela, a lógica de navegação e a direção visual), `docs/DECISOES.md` (cada escolha e o porquê), `docs/ARQUITETURA.md` (camadas e a troca para o banco), `powerbi/LEIA-ME.md` (a Visão geral no Power BI).

## Condomínio

- **Estado (17/11):** versão 2, refeita enxuta a partir da primeira: menos telas, banco de verdade (`condominio/supabase/schema.sql`, testado num Postgres local) e 77 testes.
- **O que faz:** o morador entra com e-mail e senha (convite) ou com apartamento e código; reserva lavanderia (blocos de 1 hora) e diária (manhã ou tarde), faz denúncia anônima ou identificada e acompanha a resposta, e lê avisos e perguntas frequentes. A equipe tem calendário com feriados de Belo Horizonte, solicitações com números que filtram, moradores (cadastro com e-mail, CPF e vaga, histórico, acesso), funcionários com poderes, avisos do app com prévia e e-mails em massa, agendados ou repetidos.
- **Para abrir:** a demonstração em `docs/demo/condominio/` (morador) e `docs/demo/condominio/equipe.html` (equipe), no GitHub Pages ou com dois cliques. Para mexer no código: dentro de `condominio/`, `npm install` e `npm run dev` (http://localhost:5190).
- **Onde ler mais:** `condominio/LEIA-ME.md`, `condominio/docs/PUBLICAR.md` (Supabase, Netlify e Resend do zero), `condominio/docs/MANUAL-DA-ADMINISTRACAO.md`, `condominio/docs/ACESSO-POR-EMAIL.md`.

## Limites desta fase

- **Imobil:** sem banco nem login de verdade (o seletor "Ver como" troca a pessoa); pagamento simulado; notificação só dentro do app; mapa de ruas da Esri só para demonstração (o Google Maps dentro do app pede chave paga).
- **Condomínio:** a demonstração roda no navegador com dados fictícios e não manda e-mail (o convite mostra um link de demonstração). O banco e as funções do servidor estão prontos para o Supabase, mas ainda não rodaram num Supabase de verdade.
