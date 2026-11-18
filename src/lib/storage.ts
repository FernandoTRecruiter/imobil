/* Escolhas lembradas no navegador (filtro, ordem, aba). Sempre em try/catch: em janela privada ou
   com o armazenamento bloqueado o app funciona igual, só não lembra. */
export function readJSON<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    /* sem armazenamento: segue sem lembrar */
  }
}
