/* =============================================================================
   Aviso rápido (toast) no canto: não rouba o foco, é anunciado pelo leitor de tela
   (aria-live) e pode trazer "Desfazer" no lugar de uma pergunta de confirmação.
   Movimento (07/11): o aviso sobe 8 px e aparece (220 ms); quem já estava na pilha não anima de novo.
   ============================================================================= */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { cn } from './cn'

interface ToastItem {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
  action?: { label: string; onClick: () => void }
}
interface ToastApi {
  success: (message: string, action?: ToastItem['action']) => void
  error: (message: string) => void
  info: (message: string) => void
}

const Ctx = createContext<ToastApi | null>(null)
let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const remove = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), [])
  const push = useCallback(
    (kind: ToastItem['kind'], message: string, action?: ToastItem['action']) => {
      const id = ++seq
      setItems((l) => [...l.slice(-3), { id, kind, message, action }])
      setTimeout(() => remove(id), action ? 6000 : 4000)
    },
    [remove],
  )
  const api: ToastApi = {
    success: (m, a) => push('success', m, a),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  }
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite" role="status">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-pop">
            {t.kind === 'error' ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-300" aria-hidden="true" /> : <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />}
            <p className="min-w-0 flex-1">{t.message}</p>
            {t.action && (
              <button
                className={cn('font-semibold text-sky-300 hover:underline')}
                onClick={() => {
                  t.action!.onClick()
                  remove(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="text-white/60 hover:text-white" onClick={() => remove(t.id)} aria-label="Fechar aviso">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('useToast precisa do ToastProvider')
  return api
}
