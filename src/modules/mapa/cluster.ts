/* =============================================================================
   Agrupar pinos que ficariam um em cima do outro no mapa.

   Por que existe: com a cidade inteira na tela, imóveis a poucas quadras viram pinos
   empilhados, e o de cima esconde o de baixo (aconteceu no mapa em 06/11). Os mapas
   conhecidos resolvem com um pino de GRUPO que mostra quantos imóveis estão ali; clicar
   nele aproxima o mapa até os pinos se separarem.

   Como funciona (guloso, simples de ler): cada pino, do maior imóvel para o menor, entra
   no primeiro grupo cujo centro esteja a menos de `gap` pixels nos dois eixos; se nenhum
   servir, abre um grupo novo. As posições são em PIXELS da tela no zoom atual, por isso o
   agrupamento é refeito a cada zoom (de perto os grupos se desfazem sozinhos).
   Para algumas centenas de imóveis a conta é instantânea; com milhares, trocar por uma
   grade (dividir a tela em quadrados) deixa linear.
   ============================================================================= */

export interface Point {
  x: number
  y: number
}

export interface Group<T> {
  /** Posição do primeiro (maior) imóvel do grupo: o pino fica onde ele está. */
  at: Point
  items: T[]
}

/**
 * Junta os itens cujos pontos na tela ficariam a menos de `gap` px um do outro.
 * `weight` decide quem ancora o grupo (o maior vem primeiro e o pino fica sobre ele).
 */
export function groupNearby<T>(items: T[], pos: (t: T) => Point, weight: (t: T) => number, gap = 40): Group<T>[] {
  // atalho: busca linear nos grupos (quadrática no pior caso), basta para centenas de pinos; com milhares, usar grade.
  const groups: Group<T>[] = []
  const ordered = [...items].sort((a, b) => weight(b) - weight(a))
  for (const it of ordered) {
    const p = pos(it)
    const g = groups.find((x) => Math.abs(x.at.x - p.x) < gap && Math.abs(x.at.y - p.y) < gap)
    if (g) g.items.push(it)
    else groups.push({ at: { x: p.x, y: p.y }, items: [it] }) // copia só x e y: o ponto de quem chama pode ser outro objeto (o do Leaflet)
  }
  return groups
}
