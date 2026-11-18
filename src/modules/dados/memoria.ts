/* =============================================================================
   memoria.ts: escolhas da tela de Dados lembradas no navegador (aba aberta do Data Manager).

   Arquivo próprio para a importação poder abrir o Data Manager já filtrado sem carregar a
   tela inteira dele junto (cada rota é baixada separada).
   ============================================================================= */
import { readJSON, writeJSON } from '@/lib/storage'
import type { DmEntity } from './repo'

export const ENTITY_KEY = 'imobil:dados:entidade'

/** Abre o Data Manager na entidade pedida, mostrando só o que veio de planilha. */
export function openDataManagerOn(entity: DmEntity): void {
  writeJSON(ENTITY_KEY, entity)
  const key = `imobil:list:dados:${entity}` // mesmo formato de chave do useListState
  const cur = readJSON<{ filters: Record<string, string[]>; sort: unknown; pageSize: number }>(key)
  writeJSON(key, { filters: { origin: ['importada'] }, sort: cur?.sort ?? null, pageSize: cur?.pageSize ?? 25 })
}
