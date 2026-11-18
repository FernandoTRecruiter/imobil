/* =============================================================================
   text.ts: busca sem acento e com vários termos (QoL da casa).
   "joao silva" acha "João da Silva": cada termo precisa aparecer, em qualquer ordem.
   ============================================================================= */

/** Tira acento e caixa: "Ação" -> "acao". NFD separa a letra do acento; a regex apaga o acento. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

/** Todos os termos da busca precisam aparecer em algum dos campos. */
export function matchesSearch(query: string, fields: (string | number | null | undefined)[]): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const hay = normalize(fields.filter((f) => f !== null && f !== undefined).join(' '))
  return terms.every((t) => hay.includes(t))
}

/** "1 imóvel" / "3 imóveis": plural certo na contagem. */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`
}

/** Iniciais para o avatar: "Ana Paula Souza" -> "AS". */
export function initials(name: string): string {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}
