/* =============================================================================
   store.ts: o "banco" do modo de demonstração, dentro do navegador.

   Como funciona, em 3 peças:
   1. SEMENTE: ao abrir, o banco é gerado de novo pela semente (sempre igual para a mesma data).
   2. PATCH: o que você cria, altera ou apaga fica guardado à parte, só a diferença
      (tabela -> linhas novas ou alteradas e ids apagados). Guardar o banco inteiro passaria
      do limite de alguns MB do localStorage; a diferença cabe com folga.
   3. REAPLICAR: banco = semente + patch. "Restaurar dados de demonstração" apaga o patch.

   Se você não mexeu em nada e o dia virou, os dados são gerados de novo com a data de hoje
   (senão o aluguel de "amanhã" viraria "vencido" com o passar dos dias).
   Na fase 2 este arquivo some: quem guarda é o Supabase.
   ============================================================================= */
import { todayIn } from '@/lib/dates'
import { emptyDb, TABLES, type Db, type Row, type TableName } from './db'
import { seedDb } from './seed'
import type { Id, IsoDate } from './types'

// v2 (05/11): modelos novos e tabelas novas mudaram os ids dos dados fictícios; o patch da v1 não serve mais.
// v3 (06/11): os dados viraram os 4 exemplos (seed/exemplos.ts) e a unidade ganhou "zone"; todo id mudou,
// e um patch da v2 aplicado por cima criaria linhas soltas (contrato de unidade que não existe mais).
const KEY = 'imobil:demo:v3'
const VERSION = 3

type Patch = Partial<Record<TableName, { upserts: Record<Id, unknown>; deletes: Id[] }>>
interface Saved {
  version: number
  ref: IsoDate
  patch: Patch
}

let db: Db | null = null
let saved: Saved = { version: VERSION, ref: todayIn(), patch: {} }
let persistOk = true
let timer: ReturnType<typeof setTimeout> | null = null

function readSaved(): Saved | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Saved
    return s.version === VERSION ? s : null
  } catch {
    return null // navegador sem localStorage (janela privada, bloqueio): a demonstração roda só em memória
  }
}

function writeSaved(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(saved))
      persistOk = true
    } catch {
      persistOk = false // a tela avisa: "suas alterações valem só até fechar a aba"
    }
  }, 250)
}

function isEmptyPatch(p: Patch): boolean {
  return Object.values(p).every((t) => !t || (Object.keys(t.upserts).length === 0 && t.deletes.length === 0))
}

function applyPatch(target: Db, patch: Patch): void {
  for (const table of TABLES) {
    const t = patch[table]
    if (!t) continue
    const rows = target[table] as { id?: Id }[]
    const gone = new Set(t.deletes)
    const kept = rows.filter((r) => !r.id || !gone.has(r.id))
    const index = new Map(kept.map((r, i) => [r.id, i]))
    for (const [id, row] of Object.entries(t.upserts)) {
      const i = index.get(id)
      if (i === undefined) kept.push(row as { id: Id })
      else kept[i] = row as { id: Id }
    }
    ;(target[table] as unknown[]) = kept
  }
}

/** O banco do modo de demonstração (montado na primeira chamada). */
export function getDb(): Db {
  if (db) return db
  const today = todayIn()
  const s = readSaved()
  if (s && !(s.ref !== today && isEmptyPatch(s.patch))) saved = s
  else saved = { version: VERSION, ref: today, patch: s && s.ref === today ? s.patch : {} }
  db = seedDb(saved.ref)
  applyPatch(db, saved.patch)
  return db
}

/** A parte do patch de uma tabela (criada vazia na primeira vez). */
function patchOf(table: TableName): { upserts: Record<Id, unknown>; deletes: Id[] } {
  let t = saved.patch[table]
  if (!t) {
    t = { upserts: {}, deletes: [] }
    saved.patch[table] = t
  }
  return t
}

/** Grava (cria ou substitui pelo id) linhas de uma tabela e registra a diferença. */
export function upsertRows<T extends TableName>(table: T, rows: Row<T>[]): void {
  const d = getDb()
  const list = d[table] as unknown as { id: Id }[]
  const t = patchOf(table)
  for (const row of rows as unknown as { id: Id }[]) {
    const i = list.findIndex((r) => r.id === row.id)
    if (i === -1) list.push(row)
    else list[i] = row
    t.upserts[row.id] = row
    t.deletes = t.deletes.filter((x) => x !== row.id)
  }
  writeSaved()
}

/** Apaga linhas (só para o que pode sumir de verdade; cadastro usa exclusão lógica). */
export function deleteRows(table: TableName, ids: Id[]): void {
  const d = getDb()
  const gone = new Set(ids)
  ;(d[table] as unknown as { id: Id }[]) = (d[table] as unknown as { id: Id }[]).filter((r) => !gone.has(r.id))
  const t = patchOf(table)
  for (const id of ids) {
    delete t.upserts[id]
    if (!t.deletes.includes(id)) t.deletes.push(id)
  }
  writeSaved()
}

/** Volta aos dados de demonstração originais, com a data de hoje. */
export function resetDb(): void {
  saved = { version: VERSION, ref: todayIn(), patch: {} }
  db = seedDb(saved.ref)
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch {
    /* sem localStorage: nada a limpar */
  }
}

export function demoInfo(): { ref: IsoDate; edited: boolean; persistOk: boolean } {
  getDb()
  return { ref: saved.ref, edited: !isEmptyPatch(saved.patch), persistOk }
}

/** Para testes: banco novo, sem tocar no navegador. */
export function resetForTest(ref: IsoDate): Db {
  saved = { version: VERSION, ref, patch: {} }
  db = seedDb(ref)
  return db
}

export { emptyDb }
