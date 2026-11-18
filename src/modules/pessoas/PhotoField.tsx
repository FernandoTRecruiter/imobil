/* =============================================================================
   Campo de foto (opcional): escolher, ver como fica e tirar.

   Usado na ficha da pessoa (PersonDialog), no cadastro rápido da equipe do prédio e na etapa
   "Equipe do prédio" do cadastro de imóvel. Controlado: recebe a foto (texto data:) e devolve a
   nova em onChange; quem usa guarda no formulário.
   A foto escolhida é reduzida no navegador (foto.ts) ANTES de chegar ao formulário: o que o
   formulário guarda já é a versão de 160 px.
   ============================================================================= */
import { useId, useState, type ChangeEvent } from 'react'
import { Camera, LoaderCircle, X } from 'lucide-react'
import { cn } from '@/components/ui/cn'
import { PhotoError, reducePhoto } from './foto'

export function PhotoField({ value, onChange, label = 'Foto', className }: { value: string | null | undefined; onChange: (photo: string | null) => void; label?: string; className?: string }) {
  const inputId = useId()
  const hintId = `${inputId}-dica`
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Limpa o campo: sem isso, escolher de novo o MESMO arquivo (depois de um erro) não dispara nada.
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      onChange(await reducePhoto(file))
    } catch (err) {
      setError(err instanceof PhotoError ? err.message : 'Não deu para usar esta foto. Escolha outra imagem.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-[13px] font-medium text-text">
        {label}
        <span className="ml-1.5 font-normal text-faint">opcional</span>
      </span>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt={`${label} escolhida`} className="size-16 shrink-0 rounded-full border border-border object-cover" />
        ) : (
          <span className="grid size-16 shrink-0 place-items-center rounded-full border border-dashed border-border-strong text-muted" aria-hidden="true">
            <Camera className="size-5" strokeWidth={1.5} />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* O input de arquivo fica invisível (o do navegador não segue o desenho do app), mas
                continua focável pelo Tab: o rótulo, que parece botão, ganha o contorno de foco. */}
            <label
              className={cn(
                'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:border-border-strong hover:bg-surface-2',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]',
                busy && 'pointer-events-none opacity-55',
              )}
            >
              <input type="file" accept="image/*" className="sr-only" aria-describedby={hintId} disabled={busy} onChange={(e) => void pick(e)} />
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Camera className="size-4" strokeWidth={1.5} aria-hidden="true" />}
              {busy ? 'Reduzindo…' : value ? 'Trocar foto' : 'Escolher foto'}
            </label>
            {value && !busy && (
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  onChange(null)
                }}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-muted hover:bg-surface-2 hover:text-text"
              >
                <X className="size-3.5" aria-hidden="true" />
                Tirar foto
              </button>
            )}
          </div>
          {error ? (
            <p id={hintId} className="text-xs font-medium text-danger-fg" role="alert">
              {error}
            </p>
          ) : (
            <p id={hintId} className="text-xs text-muted">
              JPG, PNG ou WebP até 5 MB. A foto é recortada em quadrado e reduzida.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
