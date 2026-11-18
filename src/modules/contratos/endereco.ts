/* =============================================================================
   Endereço da tela "Contratos e pessoas" (07/11/2026) e dos endereços antigos que caem nela.

   Pedido do Fernando: "pessoas e contratos podia ser quase a mesma coisa? ... uma tabela única que
   tem contratos que tu expande e mostra as pessoas envolvidas". A tela juntou as duas, mas com a
   troca "Mostrar: Contratos | Pessoas": só contratos faria sumir quem não tem contrato (dono de
   unidade vaga, prestador, ex-fiador, interessado).

   O endereço guarda a categoria e a escolha de cada uma (o Voltar e o link copiado funcionam):
     /contratos                          contratos, nada escolhido
     /contratos?contrato=<id>            contratos, este escolhido (linha aberta, ficha curta, detalhes)
     /contratos?lista=pessoas&pessoa=<id> pessoas, esta escolhida
     &aba=<aba>                          a aba dos detalhes de baixo (só troca no clique da aba)

   Endereços de antes, que muitos links do app e avisos guardados ainda usam:
     /contratos/<id>      -> /contratos?contrato=<id>
     /pessoas             -> /contratos?lista=pessoas
     /pessoas/<id>?aba=x  -> /contratos?lista=pessoas&pessoa=<id>&aba=<aba de hoje>
   As rotas antigas só redirecionam (beforeLoad): o id não precisa da sessão para virar endereço novo;
   quem confere se a pessoa pode ver o contrato é o repositório, depois, como em qualquer outro link.
   ============================================================================= */

export type Lista = 'contratos' | 'pessoas'
export const LISTAS: Lista[] = ['contratos', 'pessoas']

export interface ContratosSearch {
  /** Categoria da tabela. Vazio = contratos (o menu e os atalhos da Visão geral abrem nos contratos). */
  lista?: Lista
  /** Contrato escolhido (linha aberta na tabela, ficha curta ao lado, detalhes embaixo). */
  contrato?: string
  /** Pessoa escolhida, na categoria Pessoas. */
  pessoa?: string
  /** Aba dos detalhes de baixo. Valor desconhecido a tela troca pela primeira. */
  aba?: string
}

/** Id que veio do endereço: texto curto e não vazio (dado de fora; o repositório confere o acesso depois). */
const idParam = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : undefined)

/**
 * Lê o endereço (dado de fora: só passa o que é conhecido; o resto é ignorado sem quebrar a tela).
 * "lista=contratos" é o padrão e sai do endereço, para o mesmo lugar não ter dois endereços.
 */
export function parseContratosSearch(search: Record<string, unknown>): ContratosSearch {
  const out: ContratosSearch = {}
  if (search.lista === 'pessoas') out.lista = 'pessoas'
  const contrato = idParam(search.contrato)
  if (contrato) out.contrato = contrato
  const pessoa = idParam(search.pessoa)
  if (pessoa) out.pessoa = pessoa
  if (typeof search.aba === 'string' && search.aba.length > 0 && search.aba.length <= 40) out.aba = search.aba
  return out
}

/** /contratos/<id> (a página antiga do contrato): o mesmo contrato, escolhido e aberto na tabela. */
export function contractRedirect(contractId: string): ContratosSearch {
  return { contrato: contractId }
}

/**
 * ?aba= da página antiga da pessoa para a aba de hoje. "imoveis" (e os nomes de antes dela:
 * unidades, contratos) não existe mais: unidades, contratos e vagas da pessoa estão na linha aberta
 * da tabela; o endereço cai na primeira aba dos detalhes.
 */
export const PERSON_OLD_TABS: Record<string, string | null> = { imoveis: null, unidades: null, contratos: null, chamados: 'financeiro', financeiro: 'financeiro', historico: 'historico' }

/** /pessoas/<id>?aba=... (a página antiga da pessoa): a pessoa escolhida em Contratos e pessoas. */
export function personRedirect(personId: string, aba?: string): ContratosSearch {
  // Object.hasOwn e não PERSON_OLD_TABS[aba] direto: "?aba=constructor" acharia uma função herdada do objeto.
  const tab = aba !== undefined && Object.hasOwn(PERSON_OLD_TABS, aba) ? PERSON_OLD_TABS[aba] : null
  return { lista: 'pessoas', pessoa: personId, ...(tab ? { aba: tab } : {}) }
}
