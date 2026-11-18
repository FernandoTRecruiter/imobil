/* =============================================================================
   Editor de donos e fatias (passo Proprietários do cadastro e janela "Editar fatias").

   Controlado: recebe a lista e devolve a lista nova em onChange; quem usa liga ao formulário
   (react-hook-form, pelo useController) e o zod confere a soma de 100 na hora de avançar.

   Por que a fatia é um campo de TEXTO e não type="number": no Brasil se digita "33,33".
   O campo numérico do navegador ora aceita a vírgula, ora apaga o valor, dependendo do
   idioma do sistema. Aqui o texto é lido trocando vírgula por ponto.
   ============================================================================= */
import { useState } from 'react'
import { Check, Divide, Trash2, UserPlus } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can } from '@/auth/permissions'
import { Button } from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'
import { PersonDialog } from '@/modules/pessoas/PersonDialog'
import { PersonPicker } from '@/modules/pessoas/PersonPicker'
import { formatPct, sharesSum, type OwnerShareInput } from './schemas'

/** "33,5" -> 33.5; "abc" -> NaN (o zod transforma NaN em "Informe a fatia em %"). */
function parseShare(text: string): number {
  const t = text.replace('%', '').replace(',', '.').trim()
  return t === '' ? Number.NaN : Number(t)
}

function shareText(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false }) : ''
}

/** Divide 100 em partes iguais com 2 casas; o resto do arredondamento vai para a última (33,33 + 33,33 + 33,34). */
function evenShares(n: number): number[] {
  const base = Math.floor(10000 / n) / 100
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? Math.round((100 - base * (n - 1)) * 100) / 100 : base))
}

export function OwnersEditor({ value, onChange, error, rowErrors }: { value: OwnerShareInput[]; onChange: (v: OwnerShareInput[]) => void; error?: string; rowErrors?: (string | undefined)[] }) {
  const s = useSession()
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const sum = sharesSum(value)
  const exclude = new Set(value.map((o) => o.person_id))

  /**
   * Quem entra fica com o que falta para 100%. Se não falta nada (as fatias já fecham), divide
   * igualmente entre todos: entrar com 0% seria recusado na hora de avançar.
   */
  const add = (p: { id: string; name: string }) => {
    if (exclude.has(p.id)) return
    const rest = Math.round((100 - sum) * 100) / 100
    const next = [...value, { person_id: p.id, name: p.name, share_pct: value.length ? rest : 100 }]
    if (value.length && rest <= 0) {
      const parts = evenShares(next.length)
      setTexts({})
      onChange(next.map((o, i) => ({ ...o, share_pct: parts[i] })))
      return
    }
    onChange(next)
  }
  const remove = (id: string) => {
    onChange(value.filter((o) => o.person_id !== id))
    setTexts((t) => {
      const next = { ...t }
      delete next[id]
      return next
    })
  }
  const setShare = (id: string, text: string) => {
    setTexts((t) => ({ ...t, [id]: text }))
    onChange(value.map((o) => (o.person_id === id ? { ...o, share_pct: parseShare(text) } : o)))
  }
  const split = () => {
    const parts = evenShares(value.length)
    setTexts({})
    onChange(value.map((o, i) => ({ ...o, share_pct: parts[i] })))
  }

  return (
    <div className="flex flex-col gap-4">
      {value.length > 0 ? (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-xl border border-border" aria-label="Proprietários e fatias">
            {value.map((o, i) => {
              const inputId = `fatia-${o.person_id}`
              const err = rowErrors?.[i]
              return (
                <li key={o.person_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1 basis-40 truncate text-sm font-medium">{o.name}</span>
                  <label htmlFor={inputId} className="sr-only">
                    Fatia de {o.name} em %
                  </label>
                  <span className="relative">
                    <input
                      id={inputId}
                      inputMode="decimal"
                      value={texts[o.person_id] ?? shareText(o.share_pct)}
                      onChange={(e) => setShare(o.person_id, e.target.value)}
                      aria-invalid={!!err}
                      aria-describedby={err ? `${inputId}-err` : undefined}
                      className="num h-9 w-24 rounded-lg border border-border bg-surface pr-7 pl-3 text-right text-sm hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none aria-[invalid=true]:border-danger"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted" aria-hidden="true">
                      %
                    </span>
                  </span>
                  <button type="button" onClick={() => remove(o.person_id)} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger-fg" aria-label={`Remover ${o.name}`}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                  {err && (
                    <p id={`${inputId}-err`} className="w-full text-xs font-medium text-danger-fg" role="alert">
                      {err}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={cn('num flex items-center gap-1.5 text-sm', sum === 100 ? 'text-success-fg' : 'text-warning-fg')} aria-live="polite">
              {sum === 100 && <Check className="size-4" aria-hidden="true" />}
              Soma das fatias: <strong>{formatPct(sum)}</strong>
              {sum !== 100 && <span>· {sum < 100 ? `faltam ${formatPct(Math.round((100 - sum) * 100) / 100)}` : `sobram ${formatPct(Math.round((sum - 100) * 100) / 100)}`}</span>}
            </p>
            {value.length > 1 && (
              <Button size="sm" variant="ghost" icon={<Divide className="size-4" aria-hidden="true" />} onClick={split}>
                Dividir igualmente
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Nenhum proprietário ainda. Busque uma pessoa cadastrada ou cadastre uma nova.</p>
      )}
      {error && (
        <p className="text-sm font-medium text-danger-fg" role="alert">
          {error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
        <PersonPicker exclude={exclude} onPick={(p) => add(p)} />
        {can(s, 'people:edit') && (
          <Button className="sm:mt-[26px]" icon={<UserPlus className="size-4" aria-hidden="true" />} onClick={() => setCreating(true)}>
            Cadastrar pessoa
          </Button>
        )}
      </div>
      {creating && <PersonDialog title="Cadastrar proprietário" onClose={() => setCreating(false)} onSaved={(p) => add(p)} />}
    </div>
  )
}
