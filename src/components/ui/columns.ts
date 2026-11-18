/* =============================================================================
   columns.ts: o botão "Colunas" das tabelas principais (pedido de 07/11/2026: "faltou algumas
   colunas que acho interessante como tempo de contrato, tempo total que é cliente, número de
   dependentes, se tem animais de estimação").

   A ideia: a tabela continua enxuta por padrão (as colunas de hoje), e as colunas novas ficam
   a um clique, no menu "Colunas". A escolha fica lembrada POR TABELA no navegador, na chave
   imobil:colunas:<tabela>, e vale também para o "Exportar" (o arquivo sai com as colunas à vista).

   O que se guarda são só as DIFERENÇAS do padrão ({ on, off }), não a lista inteira:
     - on:  colunas opcionais que a pessoa ligou;
     - off: colunas do padrão que a pessoa desligou.
   Por que assim: se amanhã uma coluna nova entrar no padrão, quem já escolheu colunas também
   passa a vê-la. Com a lista inteira guardada, a coluna nova ficaria escondida para sempre.
   Coluna "locked" (a que diz o que é a linha) nunca some.
   ============================================================================= */
import { useState } from 'react'
import type { CsvColumn } from '@/lib/csv'
import { readJSON, writeJSON } from '@/lib/storage'

/** O mínimo que uma coluna precisa ter para entrar no menu (a Column da DataTable e a da ExpandTable servem). */
export interface ChoosableColumn {
  key: string
  header: string
  optional?: boolean
  locked?: boolean
  menuLabel?: string
}

export interface ColumnPrefs {
  on: string[]
  off: string[]
}

const EMPTY: ColumnPrefs = { on: [], off: [] }

/** Chave do navegador onde a escolha de uma tabela fica guardada. */
export const columnsKey = (table: string) => `imobil:colunas:${table}`

/** A coluna aparece? Travada sempre; desligada pela pessoa, não; ligada pela pessoa, sim; senão, o padrão (não opcional). */
export function isColumnVisible(c: ChoosableColumn, prefs: ColumnPrefs): boolean {
  if (c.locked) return true
  if (prefs.off.includes(c.key)) return false
  if (prefs.on.includes(c.key)) return true
  return !c.optional
}

/** Liga ou desliga uma coluna e devolve as diferenças novas (sem repetir chave e sem guardar o que já é o padrão). */
export function toggleColumnPref(prefs: ColumnPrefs, c: ChoosableColumn): ColumnPrefs {
  if (c.locked) return prefs
  const on = prefs.on.filter((k) => k !== c.key)
  const off = prefs.off.filter((k) => k !== c.key)
  const showNow = isColumnVisible(c, prefs)
  // Desligar: só precisa de marca se a coluna aparece por padrão. Ligar: só se ela é opcional.
  if (showNow && !c.optional) off.push(c.key)
  if (!showNow && c.optional) on.push(c.key)
  return { on, off }
}

/** Lê a escolha guardada (dado de fora: só passa lista de textos; o resto vira "padrão"). */
export function readColumnPrefs(table: string): ColumnPrefs {
  const raw = readJSON<Partial<ColumnPrefs>>(columnsKey(table))
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return raw && typeof raw === 'object' ? { on: list(raw.on), off: list(raw.off) } : EMPTY
}

/** As colunas do arquivo exportado: as de cada coluna à vista, na ordem da tela. */
export function exportColumnsOf<T>(columns: { export?: CsvColumn<T>[] }[]): CsvColumn<T>[] {
  return columns.flatMap((c) => c.export ?? [])
}

/** O que o botão "Colunas" recebe: os itens do menu e as duas ações. */
export interface ColumnChooserState {
  items: { key: string; label: string; visible: boolean; locked: boolean }[]
  toggle: (key: string) => void
  reset: () => void
  /** A escolha difere do padrão (liga o "Restaurar padrão"). */
  changed: boolean
}

/**
 * Estado das colunas de uma tabela. Devolve as colunas à vista (na ordem declarada) e o estado do
 * menu. As colunas sem nome (caixa de comparar) não entram no menu, mas continuam à vista.
 */
export function useColumnChooser<C extends ChoosableColumn>(table: string, columns: C[]): { visible: C[]; chooser: ColumnChooserState } {
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => readColumnPrefs(table))
  const save = (next: ColumnPrefs) => {
    setPrefs(next)
    writeJSON(columnsKey(table), next)
  }
  const visible = columns.filter((c) => isColumnVisible(c, prefs))
  const items = columns
    .filter((c) => (c.menuLabel ?? c.header).trim() !== '')
    .map((c) => ({ key: c.key, label: c.menuLabel ?? c.header, visible: isColumnVisible(c, prefs), locked: !!c.locked }))
  return {
    visible,
    chooser: {
      items,
      toggle: (key) => {
        const c = columns.find((x) => x.key === key)
        if (c) save(toggleColumnPref(prefs, c))
      },
      reset: () => save(EMPTY),
      changed: prefs.on.length > 0 || prefs.off.length > 0,
    },
  }
}
