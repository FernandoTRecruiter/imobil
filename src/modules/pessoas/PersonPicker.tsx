/* =============================================================================
   Escolher uma pessoa já cadastrada: busca por nome, CPF ou CNPJ e botão "Adicionar".

   A busca vai ao repositório a cada pausa de digitação (200 ms) e traz só 6 resultados:
   com milhares de pessoas, carregar a lista inteira num <select> travaria a tela, e na
   fase 2 cada letra viraria uma consulta ao banco.
   ============================================================================= */
import { useEffect, useId, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useRepo } from '@/data/hooks'
import { listPeople, type PersonRow } from '@/data/views/contracts'
import { maskDocument, onlyDigits } from '@/lib/documents'

/** "529.982" vira "529982": o documento é guardado sem pontuação, então a busca também tira. */
function searchTerm(input: string): string {
  const t = input.trim()
  return /^[\d.\-/\s]+$/.test(t) ? onlyDigits(t) : t
}

export function PersonPicker({ exclude, onPick, label = 'Buscar pessoa já cadastrada' }: { exclude: Set<string>; onPick: (p: PersonRow) => void; label?: string }) {
  const inputId = useId()
  const [input, setInput] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTerm(searchTerm(input)), 200)
    return () => clearTimeout(t)
  }, [input])
  const enabled = term.length >= 2
  const q = useRepo('pessoas:busca', (s) => listPeople(s, { search: term, pageSize: 6 }), [term], { enabled })

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-[13px] font-medium">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          id={inputId}
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          // Enter aqui só busca: dentro do cadastro de imóvel, ele avançaria a etapa sem querer.
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault()
          }}
          placeholder="Nome, CPF ou CNPJ"
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-sm hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
        />
      </div>
      <div aria-live="polite">
        {!enabled && <p className="text-xs text-muted">Digite pelo menos 2 letras do nome ou números do documento.</p>}
        {enabled && q.isFetching && !q.data && <p className="text-xs text-muted">Buscando…</p>}
        {enabled && q.data && q.data.rows.length === 0 && <p className="text-xs text-muted">Ninguém encontrado com "{input.trim()}". Cadastre a pessoa pelo botão ao lado.</p>}
        {enabled && q.data && q.data.rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-border">
            {q.data.rows.map((p) => {
              const already = exclude.has(p.id)
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="num block text-xs text-muted">
                      {p.kind} · {p.document ? maskDocument(p.document) : 'sem documento'}
                    </span>
                  </span>
                  <Button size="sm" variant={already ? 'ghost' : 'secondary'} disabled={already} onClick={() => onPick(p)} icon={already ? undefined : <Plus className="size-4" aria-hidden="true" />} aria-label={already ? `${p.name} já está na lista` : `Adicionar ${p.name}`}>
                    {already ? 'Na lista' : 'Adicionar'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {enabled && q.data && q.data.total > q.data.rows.length && <p className="mt-1 text-xs text-muted">Mostrando 6 de {q.data.total}: refine a busca.</p>}
      </div>
    </div>
  )
}
