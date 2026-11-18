/* =============================================================================
   tema.ts: tema claro ou escuro, lembrado neste navegador.

   Como funciona: o styles.css já tem as cores do tema escuro em [data-theme='dark'];
   trocar o tema é só trocar o atributo data-theme da página (document.documentElement).
   localStorage sempre em try/catch: em janela privada ou com o armazenamento bloqueado o
   tema troca do mesmo jeito, só não é lembrado depois.
   ============================================================================= */
export type Theme = 'light' | 'dark'

const KEY = 'imobil:tema'

export function readTheme(): Theme {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(t: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t
}

export function saveTheme(t: Theme): void {
  applyTheme(t)
  try {
    globalThis.localStorage?.setItem(KEY, t)
  } catch {
    /* sem armazenamento: o tema vale até fechar a aba */
  }
}
