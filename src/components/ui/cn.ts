/** Junta classes CSS ignorando vazio/falso: cn('a', cond && 'b') -> 'a b'. Dispensa a biblioteca clsx. */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
