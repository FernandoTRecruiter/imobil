/* =============================================================================
   Compare: marcar de 2 a 4 linhas e ver lado a lado (07/11/2026, "deixar eu comparar imóveis
   e unidades").

   As peças:
     - useCompare(chave): as marcadas de uma lista ('imoveis', 'unidades'). Ficam na memória da
       aba do navegador (não no endereço nem no disco): marcar não é escolher. A escolha (?imovel=,
       ?unidade=) continua sendo do clique na linha; marcar NÃO muda a página nem a escolha;
     - compareColumn: a coluna da caixa de marcar, primeira da tabela. O clique na caixa não
       chega à linha (a linha continua escolhendo como antes);
     - CompareTray: a faixa pequena no rodapé da tela ("3 escolhidos · Comparar · Limpar");
     - CompareDialog: a janela larga com uma coluna por coisa e uma linha por indicador. Por que
       janela e não seção embaixo: a página já tem mapa, ficha e tabela; uma seção a mais empurraria
       o resultado para longe de onde a pessoa clicou. A janela abre em cima, fecha no Esc e devolve
       o foco ao botão.
   A marca do melhor e do pior é discreta (cor do texto) e vem com a legenda em texto.
   ============================================================================= */
import { useSyncExternalStore, type MouseEvent } from 'react'
import { X } from 'lucide-react'
import type { CsvColumn } from '@/lib/csv'
import { downloadTable } from '@/lib/exportar'
import { Button } from './Button'
import type { Column } from './DataTable'
import { Dialog } from './Dialog'
import { ExportMenu } from './ExportMenu'
import { InfoTip } from './InfoTip'
import { cn } from './cn'
import type { CompareRow } from './compare-model'

/** Quantas coisas cabem lado a lado (mais que 4 colunas não se lê numa tela de notebook). */
export const COMPARE_MAX = 4

/* ---------------------------------------------------------------- as marcadas (memória da aba) */

const marked = new Map<string, string[]>()
const listeners = new Set<() => void>()
const EMPTY: string[] = []

function setMarked(key: string, ids: string[]): void {
  marked.set(key, ids)
  listeners.forEach((l) => l())
}

/** Marca ou desmarca (sem passar do máximo). Exportada para o teste. */
export function toggleMarked(key: string, id: string): void {
  const cur = marked.get(key) ?? EMPTY
  if (cur.includes(id)) setMarked(key, cur.filter((x) => x !== id))
  else if (cur.length < COMPARE_MAX) setMarked(key, [...cur, id])
}

export function clearMarked(key: string): void {
  setMarked(key, EMPTY)
}

export function getMarked(key: string): string[] {
  return marked.get(key) ?? EMPTY
}

export interface CompareState {
  ids: string[]
  has: (id: string) => boolean
  toggle: (id: string) => void
  remove: (id: string) => void
  clear: () => void
  /** Já tem o máximo: as outras caixas ficam desligadas. */
  full: boolean
}

export function useCompare(key: string): CompareState {
  const ids = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => getMarked(key),
  )
  return {
    ids,
    has: (id) => ids.includes(id),
    toggle: (id) => toggleMarked(key, id),
    remove: (id) => setMarked(key, getMarked(key).filter((x) => x !== id)),
    clear: () => clearMarked(key),
    full: ids.length >= COMPARE_MAX,
  }
}

/* ---------------------------------------------------------------- a coluna da caixa */

/** O clique na caixa não pode chegar à linha (a linha escolhe; marcar é outra coisa). */
const stop = (e: MouseEvent) => e.stopPropagation()

/**
 * A primeira coluna da tabela: a caixa de marcar para comparar. data-comparar avisa quem escuta
 * o clique da linha por fora (a página Imóveis escolhe na captura) que este clique não é dela.
 */
export function compareColumn<T>(compare: CompareState, idOf: (r: T) => string, nameOf: (r: T) => string): Column<T> {
  return {
    key: 'comparar',
    header: '',
    locked: true,
    className: 'w-10 px-2',
    cell: (r) => {
      const id = idOf(r)
      const on = compare.has(id)
      return (
        <label data-comparar="" className="grid size-7 cursor-pointer place-items-center rounded-md hover:bg-surface-2" onClick={stop} title={!on && compare.full ? `Até ${COMPARE_MAX} para comparar` : 'Marcar para comparar'}>
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={on} disabled={!on && compare.full} onChange={() => compare.toggle(id)} aria-label={`Comparar ${nameOf(r)}`} />
        </label>
      )
    },
  }
}

/* ---------------------------------------------------------------- a faixa do rodapé */

/**
 * "3 imóveis escolhidos · Comparar · Limpar", grudada no rodapé da tela enquanto há marcada.
 * O espaço em branco antes dela (h-16) impede que a faixa cubra a paginação no fim da página.
 */
export function CompareTray({ compare, noun, onCompare }: { compare: CompareState; noun: [string, string]; onCompare: () => void }) {
  const n = compare.ids.length
  if (!n) return null
  return (
    <>
      <div className="h-16" aria-hidden="true" />
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        <div className="pointer-events-auto flex animate-pop-in items-center gap-2 rounded-xl border border-border bg-surface py-1.5 pr-1.5 pl-3.5 text-sm shadow-pop" role="region" aria-label="Comparar">
          <p aria-live="polite" className="whitespace-nowrap">
            <span className="num">{n}</span> {n === 1 ? `${noun[0]} escolhido` : `${noun[1]} escolhidos`}
            {n < 2 && <span className="text-muted max-sm:hidden"> · marque mais um</span>}
          </p>
          <Button size="sm" variant="primary" disabled={n < 2} onClick={onCompare} title={n < 2 ? 'Marque de 2 a 4 para comparar' : undefined}>
            Comparar
          </Button>
          <Button size="sm" variant="ghost" onClick={compare.clear}>
            Limpar
          </Button>
        </div>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- a janela */

export interface CompareItem {
  id: string
  name: string
  sub?: string
}

/**
 * A janela do Comparar. Uma coluna por coisa (com o X que tira ela da comparação) e uma linha por
 * indicador; números em fonte mono. Exportar baixa o mesmo, uma linha por coisa (compare-model).
 */
export function CompareDialog<T>({
  title,
  items,
  rows,
  loading,
  onClose,
  onRemove,
  fileName,
  exportColumns,
  exportRows,
}: {
  title: string
  items: CompareItem[]
  rows: CompareRow[]
  loading?: boolean
  onClose: () => void
  onRemove: (id: string) => void
  fileName: string
  exportColumns: CsvColumn<T>[]
  exportRows: T[]
}) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      title={title}
      description="Em verde, o melhor de cada linha; em vermelho, o pior. Linhas sem lado bom (área, quartos, nomes) não são marcadas."
      footer={
        <>
          <ExportMenu size="md" total={exportRows.length} onExport={(f) => downloadTable(fileName, exportRows, exportColumns, f, 'Comparação')} />
          <Button variant="primary" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-muted">Calculando…</p>
      ) : (
        // A tabela larga rola dentro da janela, nunca a página.
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 border-b border-border bg-surface-2 px-3 py-2 text-left text-xs font-medium text-muted">
                  Indicador
                </th>
                {items.map((it) => (
                  <th key={it.id} scope="col" className="min-w-36 border-b border-l border-border bg-surface-2 px-3 py-2 text-left align-top">
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium text-text">{it.name}</span>
                        {it.sub && <span className="text-xs font-normal text-muted">{it.sub}</span>}
                      </span>
                      {items.length > 2 && (
                        <button type="button" className="grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-surface hover:text-text" onClick={() => onRemove(it.id)} aria-label={`Tirar ${it.name} da comparação`}>
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="bg-surface">
                  <th scope="row" className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-2 text-left text-[13px] font-normal whitespace-nowrap text-muted">
                    <span className="inline-flex items-center gap-1">
                      {r.label}
                      {r.info && <InfoTip>{r.info}</InfoTip>}
                    </span>
                  </th>
                  {r.cells.map((c, i) => (
                    <td
                      key={items[i]?.id ?? i}
                      className={cn(
                        'border-b border-l border-border px-3 py-2',
                        typeof c.raw === 'number' && 'num',
                        c.raw === null || c.raw === '' ? 'text-faint' : c.mark === 'best' ? 'font-medium text-success-fg' : c.mark === 'worst' ? 'text-danger-fg' : 'text-text',
                      )}
                    >
                      {c.text}
                      {c.mark && <span className="sr-only"> ({c.mark === 'best' ? 'melhor' : 'pior'} da linha)</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  )
}
