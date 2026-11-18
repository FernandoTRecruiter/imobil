/* =============================================================================
   Dados > Importar: valida a planilha linha a linha, grava em lote e desfaz o lote.

   Fluxo 3 da seção D do plano: tipo -> arquivo -> mapeamento -> regras -> validação e prévia
   -> gravar -> relatório + "Desfazer". Este arquivo é a parte que conversa com o banco:
     planImport  : lê cada linha, confere valor, duplicado e referência, e diz o que VAI acontecer;
     runImport   : faz o mesmo plano de novo (a tela pode estar velha) e grava o que passou;
     previewUndo : diz o que o desfazer apagaria e o que impede;
     undoImport  : apaga o que o lote criou e devolve o "antes" do que ele atualizou.

   Por que o plano roda duas vezes: a prévia é só uma promessa. Entre validar e gravar, alguém
   pode ter cadastrado a mesma pessoa; gravar com o plano velho criaria CPF repetido.

   Desfazer apaga de verdade (deleteRows) o que o lote criou: esses registros nunca deviam ter
   existido. A trilha fica no próprio lote (undone_at) e na auditoria. Por isso o desfazer
   só vale enquanto NADA do lote foi usado (contrato, chamado, lançamento, dono ligado depois);
   no banco da fase 2 a própria chave estrangeira recusaria o DELETE.
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { can, hasFeature } from '@/auth/permissions'
import { AccessError, audit, connect, diff, nowIso, RuleError } from '@/data/api'
import type { Db } from '@/data/db'
import { runList, type ListParams, type ListResult } from '@/data/query'
import { see, type Scope } from '@/data/scope'
import { deleteRows, upsertRows } from '@/data/store'
import type { Address, Building, Floor, Id, ImportBatch, ImportUpdatedRecord, IsoDate, Person, Property, PropertyOwner, Unit } from '@/data/types'
import { formatDateTime } from '@/lib/dates'
import { formatDocument, normalizeDocument } from '@/lib/documents'
import { newId } from '@/lib/random'
import { normalize } from '@/lib/text'
import {
  EXAMPLE_MARK, fieldsFor, IMPORT_KIND_LABEL, isErr, readArea, readCep, readDate, readDocument, readEmail, readInt, readMoney, readPersonKind,
  readPhone, readPropertyKind, readStatus, readTags, readText, readUf, readUnitKind, type FieldDef, type ImportKind, type Read,
} from './campos'
import { cellText, isEmptyCell, MAX_ROWS, type Cell } from './planilha'
import { activeTeam, changedAfter, moment, shortList, usesOfPerson, usesOfProperty, usesOfUnit, vendorTagRemovalBlock, type TeamMember } from './regras'

/* ---------------------------------------------------------------- contrato com a tela */

export interface ImportRules {
  /** Célula vazia: ignorar (fica vazio, ou mantém o atual ao atualizar) ou usar o padrão do campo. */
  empty: 'ignore' | 'default'
  defaults: Record<string, string>
  /** Registro que já existe: pular a linha, atualizar o existente ou criar outro mesmo assim. */
  duplicate: 'skip' | 'update' | 'create'
}

export interface ImportInput {
  kind: ImportKind
  /** Só para "unidades de um imóvel": o imóvel que recebe as unidades. */
  propertyId: Id | null
  fileName: string
  headers: string[]
  /** Linhas de dados (sem o cabeçalho). */
  rows: Cell[][]
  /** Número da linha no arquivo de cada item de rows (para a prévia apontar a linha do Excel). */
  lines: number[]
  /** Campo -> índice da coluna (null = não importar). */
  mapping: Record<string, number | null>
  rules: ImportRules
}

export type RowLevel = 'ok' | 'warning' | 'error'
export type RowAction = 'create' | 'update' | 'skip' | 'none'

export interface RowMessage {
  column: string
  message: string
  level: 'error' | 'warning'
}

export interface PlannedRow {
  line: number
  level: RowLevel
  action: RowAction
  label: string
  messages: RowMessage[]
}

export interface ImportCounts {
  total: number
  ok: number
  warning: number
  error: number
  create: number
  update: number
  skip: number
}

export interface ImportPlan {
  rows: PlannedRow[]
  counts: ImportCounts
}

/* ---------------------------------------------------------------- portas */

/** Importar pede "importar dados" E a permissão do cadastro de destino (a planilha não dá mais poder que a tela). */
function requireImport(s: Session, kind: ImportKind): void {
  if (!can(s, 'data:import')) throw new AccessError('Importar pede a permissão "Importar e editar em massa". Quem administra a conta libera em Configurações.')
  if (kind === 'people' && !can(s, 'people:edit')) throw new AccessError('Importar pessoas pede também a permissão "Pessoas: editar".')
  if (kind !== 'people' && !can(s, 'properties:edit')) throw new AccessError('Importar imóveis e unidades pede também a permissão "Imóveis: editar".')
}

const cellSchema = z.union([z.string().max(5000, 'Célula com mais de 5.000 caracteres: confira a planilha.'), z.number(), z.boolean(), z.null()])

const inputSchema = z
  .object({
    kind: z.enum(['people', 'properties', 'units'], { error: 'Tipo de importação inválido.' }),
    propertyId: z.string().nullable(),
    fileName: z.string().trim().min(1, 'Arquivo sem nome.').max(200),
    headers: z.array(z.string()).max(200, 'Mais de 200 colunas: apague as colunas que não vão ser importadas.'),
    rows: z.array(z.array(cellSchema)).min(1, 'A planilha não tem linhas de dados abaixo do cabeçalho.').max(MAX_ROWS, `Mais de ${MAX_ROWS.toLocaleString('pt-BR')} linhas: divida a planilha em partes.`),
    lines: z.array(z.number().int()),
    mapping: z.record(z.string(), z.number().int().min(0).nullable()),
    rules: z.object({
      empty: z.enum(['ignore', 'default']),
      defaults: z.record(z.string(), z.string().max(200, 'Valor padrão acima de 200 caracteres.')),
      duplicate: z.enum(['skip', 'update', 'create']),
    }),
  })
  .refine((i) => i.lines.length === i.rows.length, 'A lista de linhas não bate com os dados: escolha o arquivo de novo.')

function checkInput(input: ImportInput): ImportInput {
  const r = inputSchema.safeParse(input)
  if (!r.success) throw new RuleError(r.error.issues[0]?.message ?? 'Dados da importação inválidos.')
  return r.data as ImportInput
}

/* ---------------------------------------------------------------- leitura de uma linha */

interface PlanCtx {
  db: Db
  sc: Scope
  s: Session
  input: ImportInput
  byKey: Map<string, FieldDef>
}

/**
 * Ajudante de UMA linha: pega a célula de um campo (com a regra de vazio), guarda as mensagens
 * e diz o nome da coluna como está NO ARQUIVO da pessoa (é ele que ela procura no Excel).
 */
function rowReader(ctx: PlanCtx, cells: Cell[]) {
  const { input, byKey } = ctx
  const messages: RowMessage[] = []
  const colIndex = (key: string) => input.mapping[key] ?? null
  const col = (key: string) => {
    const i = colIndex(key)
    return (i !== null && input.headers[i]) || byKey.get(key)?.label || key
  }
  /** Célula do campo; vazia + regra "usar padrão" = o padrão escolhido na tela. */
  const get = (key: string): Cell => {
    const i = colIndex(key)
    const c = i === null ? '' : (cells[i] ?? '')
    if (!isEmptyCell(c)) return c
    const d = input.rules.empty === 'default' ? input.rules.defaults[key]?.trim() : ''
    return d || ''
  }
  const error = (key: string, message: string) => messages.push({ column: col(key), message, level: 'error' })
  const warn = (key: string, message: string) => messages.push({ column: col(key), message, level: 'warning' })
  /** Lê com um leitor de campos.ts: erro e aviso viram mensagem; devolve o valor (ou undefined). */
  const take = <T,>(key: string, r: Read<T>): T | undefined => {
    if (isErr(r)) {
      error(key, r.error)
      return undefined
    }
    if (r.warning) warn(key, r.warning)
    return r.value
  }
  /** Campo obrigatório para criar que veio vazio: a mensagem diz se faltou a coluna ou o valor. */
  const missing = (key: string) => {
    const label = byKey.get(key)?.label ?? key
    error(key, colIndex(key) === null ? `${label} não tem coluna escolhida: volte ao Mapeamento ou defina um padrão nas Regras.` : `${label} vazio: preencha na planilha ou defina um padrão nas Regras.`)
  }
  const has = (key: string) => !isEmptyCell(get(key))
  const hasError = () => messages.some((m) => m.level === 'error')
  return { messages, get, take, error, warn, missing, has, hasError }
}
type RowReader = ReturnType<typeof rowReader>

function finish(r: RowReader, line: number, action: RowAction, label: string): PlannedRow {
  const err = r.hasError()
  return { line, level: err ? 'error' : r.messages.length ? 'warning' : 'ok', action: err ? 'none' : action, label, messages: r.messages }
}

/** Regra de duplicado comum aos três tipos. Devolve a ação (ou 'none' com a mensagem de erro já anotada). */
function duplicateAction(r: RowReader, key: string, rules: ImportRules, found: { who: string } | null, dupLine: number | undefined, createAllowed: boolean, createRefusal: string): RowAction {
  if (dupLine !== undefined) {
    if (rules.duplicate === 'create' && createAllowed) {
      r.warn(key, `Repete a linha ${dupLine} do arquivo: importada mesmo assim (regra).`)
      return 'create'
    }
    if (rules.duplicate === 'create') {
      r.error(key, `Repete a linha ${dupLine} do arquivo: ${createRefusal} Apague uma das linhas.`)
      return 'none'
    }
    r.warn(key, `Repete a linha ${dupLine} do arquivo: esta linha foi pulada.`)
    return 'skip'
  }
  if (!found) return 'create'
  if (rules.duplicate === 'skip') {
    r.warn(key, `Já existe: ${found.who}. Linha pulada (regra: pular).`)
    return 'skip'
  }
  if (rules.duplicate === 'update') return 'update'
  if (createAllowed) {
    r.warn(key, `Já existe ${found.who}: importado mesmo assim (regra).`)
    return 'create'
  }
  r.error(key, `Já existe ${found.who}: ${createRefusal} Nas Regras, escolha pular ou atualizar.`)
  return 'none'
}

/* ---------------------------------------------------------------- operações (o que gravar) */

type PersonData = Pick<Person, 'kind' | 'name' | 'document' | 'email' | 'phone' | 'tags' | 'address' | 'notes'>
type UnitData = Pick<Unit, 'code' | 'kind' | 'area_m2' | 'bedrooms' | 'bathrooms' | 'parking_spots' | 'asking_rent_cents' | 'manual_status' | 'notes'> & Pick<Unit, 'building_id' | 'floor_id' | 'position'>
type UnitPatch = Partial<Pick<Unit, 'area_m2' | 'bedrooms' | 'bathrooms' | 'parking_spots' | 'asking_rent_cents' | 'manual_status' | 'notes'>>
type PropertyData = Pick<Property, 'kind' | 'name' | 'address' | 'portfolio_id' | 'manager_user_id' | 'notes'>

type Op =
  | { kind: 'people'; action: 'create'; data: PersonData }
  | { kind: 'people'; action: 'update'; id: Id; data: Partial<PersonData> }
  | { kind: 'properties'; action: 'create'; property: PropertyData; unit: UnitData; owner: { personId: Id; since: IsoDate } | null }
  | { kind: 'properties'; action: 'update'; id: Id; unitId: Id; property: Partial<PropertyData>; unit: UnitPatch }
  | { kind: 'units'; action: 'create'; propertyId: Id; unit: UnitData }
  | { kind: 'units'; action: 'update'; id: Id; unit: UnitPatch }

interface Planned {
  row: PlannedRow
  op: Op | null
}

/** Tira undefined de um objeto (no "atualizar", campo vazio não entra: mantém o valor atual). */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

/* ---------------------------------------------------------------- pessoas */

function planPeople(ctx: PlanCtx): Planned[] {
  const { db, sc, input } = ctx
  const existing = new Map<string, Person>()
  for (const p of db.people) if (see.person(sc, p)) existing.set(normalizeDocument(p.document), p)
  const seen = new Map<string, number>()

  return input.rows.map((cells, i) => {
    const line = input.lines[i]
    const r = rowReader(ctx, cells)
    // 1. A chave: o documento (CPF/CNPJ é único dentro da organização).
    const doc = r.has('document') ? r.take('document', readDocument(r.get('document'))) : undefined
    if (!r.has('document')) r.missing('document')
    const match = doc ? existing.get(doc) : undefined
    const dupLine = doc ? seen.get(doc) : undefined
    if (doc && dupLine === undefined) seen.set(doc, line)
    // Sem documento a linha já tem erro, mas segue sendo lida como "criar" para a prévia mostrar
    // TODOS os problemas dela de uma vez (e não um por rodada de correção).
    const action = doc
      ? duplicateAction(r, 'document', input.rules, match ? { who: `${match.name}${match.deleted_at ? ' (arquivada)' : ''} com este CPF/CNPJ` } : null, dupLine, false, 'a conta não aceita dois cadastros com o mesmo documento.')
      : 'create'
    const fallbackLabel = doc ? formatDocument(doc) : `Linha ${line}`
    if (action === 'skip' || action === 'none') return { row: finish(r, line, action, match?.name ?? fallbackLabel), op: null }

    // 2. Os outros campos.
    // "|| undefined": célula vazia não entra no "atualizar" (senão apagaria o nome que já existe).
    const name = r.take('name', readText(r.get('name'), 'Nome', 120)) || undefined
    if (!name && action === 'create') r.missing('name')
    else if (name && name.length < 2) r.error('name', 'Nome com menos de 2 letras: escreva o nome completo.')
    const declared = r.take('kind', readPersonKind(r.get('kind'))) ?? undefined
    // O tipo sai do tamanho do documento (11 = CPF = PF; 14 = CNPJ = PJ); a coluna só confere.
    const kind: 'PF' | 'PJ' | undefined = doc ? (doc.length === 11 ? 'PF' : 'PJ') : declared
    if (doc && declared && declared !== kind) r.error('kind', `Tipo ${declared} com ${kind === 'PF' ? 'CPF: CPF é de pessoa física (PF)' : 'CNPJ: CNPJ é de pessoa jurídica (PJ)'}. Corrija o tipo ou o documento.`)
    const email = r.take('email', readEmail(r.get('email'))) || undefined
    const phone = r.take('phone', readPhone(r.get('phone'))) || undefined
    const tags = r.take('tags', readTags(r.get('tags'))) ?? undefined
    if (action === 'update' && match && tags) {
      const block = vendorTagRemovalBlock(db, match, tags)
      if (block) r.error('tags', `${block}.`)
    }
    const street = r.take('street', readText(r.get('street'), 'Rua', 120)) || undefined
    const parts = {
      cep: r.take('cep', readCep(r.get('cep'))) || undefined,
      number: r.take('number', readText(r.get('number'), 'Número', 20)) || undefined,
      complement: r.take('complement', readText(r.get('complement'), 'Complemento', 60)) || undefined,
      district: r.take('district', readText(r.get('district'), 'Bairro', 80)) || undefined,
      city: r.take('city', readText(r.get('city'), 'Cidade', 80)) || undefined,
      state: r.take('state', readUf(r.get('state'))) || undefined,
    }
    if (!street && Object.values(parts).some(Boolean)) r.warn('street', 'Endereço sem rua: os outros campos do endereço ficaram de fora.')
    const notes = r.take('notes', readText(r.get('notes'), 'Observações', 1000)) || undefined
    if (notes === EXAMPLE_MARK || name === 'Pessoa Exemplo Fictícia') r.error('name', 'Linha de exemplo do modelo: apague-a da planilha antes de importar.')

    const label = name || match?.name || fallbackLabel
    if (r.hasError() || !doc || !kind) return { row: finish(r, line, action, label), op: null }

    if (action === 'create') {
      const address: Address | null = street
        ? { cep: parts.cep ?? '', street, number: parts.number ?? '', complement: parts.complement ?? '', district: parts.district ?? '', city: parts.city ?? '', state: parts.state ?? '' }
        : null
      return {
        row: finish(r, line, 'create', label),
        op: { kind: 'people', action: 'create', data: { kind, name: name!, document: doc, email: email ?? '', phone: phone ?? '', tags: tags ?? [], address, notes: notes ?? '' } },
      }
    }
    // Atualizar: só o que veio preenchido; endereço novo se a rua veio (as partes vazias ficam as de antes).
    const prev = match!.address
    const address = street
      ? { cep: parts.cep ?? prev?.cep ?? '', street, number: parts.number ?? prev?.number ?? '', complement: parts.complement ?? prev?.complement ?? '', district: parts.district ?? prev?.district ?? '', city: parts.city ?? prev?.city ?? '', state: parts.state ?? prev?.state ?? '' }
      : undefined
    return { row: finish(r, line, 'update', label), op: { kind: 'people', action: 'update', id: match!.id, data: defined({ name, email, phone, tags, address, notes }) } }
  })
}

/* ---------------------------------------------------------------- imóveis avulsos */

/** Chave de endereço: rua + número + complemento sem acento, caixa e pontuação ("R." vira "rua"). */
export function addressKey(street: string, number: string, complement: string): string {
  const st = normalize(street).replace(/^r\.?\s+/, 'rua ').replace(/^av\.?\s+/, 'avenida ').replace(/[^a-z0-9]+/g, ' ').trim()
  const clean = (s: string) => normalize(s).replace(/[^a-z0-9]+/g, '')
  return `${st}|${clean(number)}|${clean(complement)}`
}

/** "Rua das Acácias" -> "Acácias" (para o nome automático "Casa Acácias, 450", igual ao dos dados de exemplo). */
function shortStreet(street: string): string {
  return street.replace(/^(Rua|R\.|Avenida|Av\.?|Travessa|Alameda|Praça) (das |dos |da |do |de )?/i, '')
}

function findTeam(team: TeamMember[], text: string): TeamMember | undefined {
  const t = normalize(text)
  return team.find((m) => m.email.toLowerCase() === text.toLowerCase().trim() || normalize(m.name) === t)
}

function planProperties(ctx: PlanCtx): Planned[] {
  const { db, sc, s, input } = ctx
  const agency = hasFeature(s, 'portfolios')
  const existing = new Map<string, Property>()
  for (const p of db.properties) if (see.property(sc, p)) existing.set(addressKey(p.address.street, p.address.number, p.address.complement), p)
  const portfolios = db.portfolios.filter((p) => p.organization_id === s.org.id)
  const team = activeTeam(db, s.org.id)
  const peopleByDoc = new Map<string, Person>()
  for (const p of db.people) if (see.person(sc, p)) peopleByDoc.set(normalizeDocument(p.document), p)
  const seen = new Map<string, number>()

  return input.rows.map((cells, i) => {
    const line = input.lines[i]
    const r = rowReader(ctx, cells)
    // 1. A chave: rua + número + complemento.
    const street = r.take('street', readText(r.get('street'), 'Rua', 120))
    const number = r.take('number', readText(r.get('number'), 'Número', 20))
    const complement = r.take('complement', readText(r.get('complement'), 'Complemento', 60)) ?? ''
    if (!street) r.missing('street')
    if (!number) r.missing('number')
    const key = street && number ? addressKey(street, number, complement) : null
    const match = key ? existing.get(key) : undefined
    const dupLine = key ? seen.get(key) : undefined
    if (key && dupLine === undefined) seen.set(key, line)
    const addressLabel = street ? `${street}, ${number ?? 's/n'}${complement ? ` ${complement}` : ''}` : `Linha ${line}`
    // Sem rua ou número a linha já tem erro; segue lida como "criar" para mostrar todos os problemas.
    let action: RowAction = key ? duplicateAction(r, 'street', input.rules, match ? { who: `"${match.name}"${match.deleted_at ? ' (arquivado)' : ''} neste endereço` } : null, dupLine, true, '') : 'create'
    if (action === 'skip' || action === 'none') return { row: finish(r, line, action, match?.name ?? addressLabel), op: null }

    // Atualizar um imóvel só faz sentido com UMA unidade (avulso); condomínio se atualiza pela importação de unidades.
    const matchUnits = match ? db.units.filter((u) => u.property_id === match.id && !u.deleted_at) : []
    if (action === 'update' && matchUnits.length !== 1) {
      r.error('street', `"${match!.name}" tem ${matchUnits.length} unidades: atualize-as pela importação de unidades.`)
      action = 'none'
    }

    // 2. Tipo, nome, endereço.
    const kind = r.take('kind', readPropertyKind(r.get('kind'))) ?? undefined
    if (!kind && action === 'create' && !r.has('kind')) r.missing('kind') // valor não reconhecido já virou erro no take
    if (kind && action === 'update' && match && kind.property !== match.kind) r.warn('kind', 'O tipo do imóvel não muda pela importação: ficou o que já estava.')
    const name = r.take('name', readText(r.get('name'), 'Nome do imóvel', 120)) || undefined
    const cep = r.take('cep', readCep(r.get('cep'))) || undefined
    const district = r.take('district', readText(r.get('district'), 'Bairro', 80)) || undefined
    const city = r.take('city', readText(r.get('city'), 'Cidade', 80)) || undefined
    const state = r.take('state', readUf(r.get('state'))) || undefined
    if (action === 'create') {
      if (!district) r.missing('district')
      if (!city) r.missing('city')
      if (!state && !r.has('state')) r.missing('state')
    }

    // 3. Carteira e responsável (só imobiliária): a referência precisa existir.
    let portfolioId: Id | null | undefined
    let managerId: Id | null | undefined
    if (agency) {
      const pt = cellText(r.get('portfolio'))
      if (pt) {
        const found = portfolios.find((p) => normalize(p.name) === normalize(pt))
        if (found) portfolioId = found.id
        else r.error('portfolio', `Carteira "${pt}" não existe: use ${shortList(portfolios.map((p) => p.name)) || 'uma carteira cadastrada'} ou crie em Configurações > Carteiras.`)
      }
      const mt = cellText(r.get('manager'))
      if (mt) {
        const found = findTeam(team, mt)
        if (found) managerId = found.userId
        else r.error('manager', `"${mt}" não é da equipe ativa: use o e-mail de quem tem acesso${team[0] ? ` (ex.: ${team[0].email})` : ''}.`)
      }
    }

    // 4. A unidade única do imóvel avulso.
    const unitCode = r.take('unit_code', readText(r.get('unit_code'), 'Código da unidade', 20)) || kind?.code
    const area = r.take('area', readArea(r.get('area'))) ?? undefined
    if (area === undefined && action === 'create' && !r.has('area')) r.missing('area')
    const bedrooms = r.take('bedrooms', readInt(r.get('bedrooms'), 'Quartos', 50)) ?? undefined
    const bathrooms = r.take('bathrooms', readInt(r.get('bathrooms'), 'Banheiros', 50)) ?? undefined
    const parking = r.take('parking', readInt(r.get('parking'), 'Vagas', 100)) ?? undefined
    const rent = r.take('rent', readMoney(r.get('rent'), 'Aluguel pedido')) ?? undefined

    // 5. Proprietário: pessoa que JÁ existe (referência inexistente = erro com o conserto).
    let owner: { personId: Id; since: IsoDate } | null = null
    if (r.has('owner')) {
      const od = r.take('owner', readDocument(r.get('owner'), 'Proprietário'))
      const person = od ? peopleByDoc.get(od) : undefined
      if (od && !person) r.error('owner', `Proprietário ${formatDocument(od)} não está cadastrado: importe a pessoa antes (Importar > Pessoas) ou corrija o documento.`)
      else if (person?.deleted_at) r.error('owner', `${person.name} está arquivada: restaure o cadastro antes de ligar como proprietária.`)
      const since = r.take('owner_since', readDate(r.get('owner_since'), 'Proprietário desde', s.today)) ?? s.today
      if (action === 'update') r.warn('owner', 'Proprietário não muda pela importação: ligue pela tela do imóvel.')
      else if (person && !person.deleted_at) owner = { personId: person.id, since }
    } else if (r.has('owner_since')) {
      r.warn('owner_since', 'Data de posse sem proprietário: ignorada.')
    }
    const notes = r.take('notes', readText(r.get('notes'), 'Observações', 2000)) || undefined
    if (notes === EXAMPLE_MARK || name === 'Casa Exemplo, 100') r.error('name', 'Linha de exemplo do modelo: apague-a da planilha antes de importar.')

    const autoName = kind && street ? `${kind.label} ${shortStreet(street)}, ${number}${complement ? ` ${complement}` : ''}` : undefined
    const label = name || match?.name || autoName || addressLabel
    if (r.hasError() || action === 'none') return { row: finish(r, line, 'none', label), op: null }

    if (action === 'create') {
      const address: Address = { cep: cep ?? '', street: street!, number: number!, complement, district: district!, city: city!, state: state! }
      return {
        row: finish(r, line, 'create', label),
        op: {
          kind: 'properties', action: 'create', owner,
          property: { kind: kind!.property, name: name || autoName!, address, portfolio_id: portfolioId ?? null, manager_user_id: managerId ?? null, notes: notes ?? '' },
          unit: {
            code: unitCode!, kind: kind!.unit, area_m2: area!, bedrooms: bedrooms ?? 0, bathrooms: bathrooms ?? 0, parking_spots: parking ?? 0,
            asking_rent_cents: rent ?? null, manual_status: 'available', notes: '', building_id: null, floor_id: null, position: null,
          },
        },
      }
    }
    const m = match!
    const address = { ...m.address, ...defined({ cep, district, city, state }) }
    return {
      row: finish(r, line, 'update', label),
      op: {
        kind: 'properties', action: 'update', id: m.id, unitId: matchUnits[0].id,
        property: defined({ name, address, portfolio_id: portfolioId, manager_user_id: managerId, notes }),
        unit: defined({ area_m2: area, bedrooms, bathrooms, parking_spots: parking, asking_rent_cents: rent }),
      },
    }
  })
}

/* ---------------------------------------------------------------- unidades de um imóvel */

/** "A" acha "Bloco A"; "bloco a" acha "Bloco A". */
function matchBuilding(buildings: Building[], text: string): Building | undefined {
  const t = normalize(text)
  return buildings.find((b) => normalize(b.name) === t) ?? buildings.find((b) => normalize(b.name).endsWith(` ${t}`))
}

/** "3", "3º andar" e "3 andar" acham o nível 3; "Térreo" acha o nível 0; senão, pelo nome. */
function matchFloor(floors: Floor[], text: string): Floor | undefined {
  const t = normalize(text)
  const num = /^(-?\d+)/.exec(t)
  if (num) return floors.find((f) => f.level === Number(num[1]))
  if (t === 'terreo' || t === 't') return floors.find((f) => f.level === 0)
  return floors.find((f) => normalize(f.label) === t)
}

function planUnits(ctx: PlanCtx): Planned[] {
  const { db, sc, s, input } = ctx
  const prop = db.properties.find((p) => p.id === input.propertyId && see.property(sc, p) && !p.deleted_at)
  if (!prop) throw new RuleError('Escolha o imóvel que recebe as unidades (passo 1): ele não existe, está arquivado ou é de outra conta.')
  const buildings = db.buildings.filter((b) => b.property_id === prop.id && b.organization_id === s.org.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const floorsOf = new Map<Id, Floor[]>(buildings.map((b) => [b.id, db.floors.filter((f) => f.building_id === b.id).sort((x, y) => x.level - y.level)]))
  const existing = new Map<string, Unit>()
  const maxPos = new Map<string, number>() // andar (ou "solta") -> maior posição já usada
  for (const u of db.units) {
    if (u.property_id !== prop.id || !see.unit(sc, u) || u.deleted_at) continue
    existing.set(normalize(u.code), u)
    const k = u.floor_id ?? 'solta'
    maxPos.set(k, Math.max(maxPos.get(k) ?? 0, u.position ?? 0))
  }
  const names = buildings.map((b) => b.name)
  const seen = new Map<string, number>()

  return input.rows.map((cells, i) => {
    const line = input.lines[i]
    const r = rowReader(ctx, cells)
    // 1. A chave: o código da unidade dentro do imóvel.
    const code = r.take('code', readText(r.get('code'), 'Código', 20))
    if (!code) r.missing('code')
    const key = code ? normalize(code) : null
    const match = key ? existing.get(key) : undefined
    const dupLine = key ? seen.get(key) : undefined
    if (key && dupLine === undefined) seen.set(key, line)
    const action = key
      ? duplicateAction(r, 'code', input.rules, match ? { who: `a unidade ${match.code} neste imóvel` } : null, dupLine, false, 'dois códigos iguais no mesmo imóvel confundem contrato e espelho.')
      : 'create' // sem código já há erro; segue lida para a prévia mostrar todos os problemas da linha
    if (action === 'skip' || action === 'none') return { row: finish(r, line, action, code || `Linha ${line}`), op: null }

    // 2. Tipo e lugar (bloco, andar, posição): o bloco e o andar precisam EXISTIR no imóvel.
    const kind = r.take('kind', readUnitKind(r.get('kind'))) ?? undefined
    if (!kind && action === 'create' && !r.has('kind')) r.missing('kind')
    let building: Building | null = null
    let floor: Floor | null = null
    const bText = cellText(r.get('building'))
    const fText = cellText(r.get('floor'))
    if (action === 'update') {
      if (bText || fText) r.warn('building', 'Bloco e andar não mudam pela importação: só medidas, aluguel, situação e observações.')
    } else if (!buildings.length) {
      if (bText || fText) r.warn('building', 'Este imóvel não tem blocos nem andares: bloco e andar foram ignorados.')
    } else {
      if (!bText) {
        if (buildings.length === 1) building = buildings[0]
        else r.error('building', `Bloco vazio: este imóvel tem ${names.join(' e ')}; informe qual.`)
      } else {
        building = matchBuilding(buildings, bText) ?? null
        if (!building) r.error('building', `Bloco "${bText}" não existe neste imóvel (existem: ${names.join(', ')}): corrija o nome ou crie o bloco na tela do imóvel.`)
      }
      if (building) {
        const floors = floorsOf.get(building.id) ?? []
        const range = floors.length ? `vai de ${floors[0].label} a ${floors[floors.length - 1].label}` : 'sem andares'
        if (!fText) r.error('floor', `Andar vazio: informe o andar no ${building.name} (ex.: 3 ou Térreo).`)
        else {
          floor = matchFloor(floors, fText) ?? null
          if (!floor) r.error('floor', `Andar "${fText}" não existe no ${building.name} (${range}): corrija ou crie o andar na tela do imóvel.`)
        }
      }
    }
    const position = r.take('position', readInt(r.get('position'), 'Posição no andar', 200)) ?? undefined
    if (position === 0) r.error('position', 'Posição começa em 1.')

    // 3. Medidas, aluguel, situação.
    const area = r.take('area', readArea(r.get('area'))) ?? undefined
    if (area === undefined && action === 'create' && !r.has('area')) r.missing('area')
    const bedrooms = r.take('bedrooms', readInt(r.get('bedrooms'), 'Quartos', 50)) ?? undefined
    const bathrooms = r.take('bathrooms', readInt(r.get('bathrooms'), 'Banheiros', 50)) ?? undefined
    const parking = r.take('parking', readInt(r.get('parking'), 'Vagas', 100)) ?? undefined
    const rent = r.take('rent', readMoney(r.get('rent'), 'Aluguel pedido')) ?? undefined
    const status = r.take('status', readStatus(r.get('status'))) ?? undefined
    const notes = r.take('notes', readText(r.get('notes'), 'Observações', 1000)) || undefined
    if (notes === EXAMPLE_MARK) r.error('notes', 'Linha de exemplo do modelo: apague-a da planilha antes de importar.')
    if (r.hasError() || !code || (!kind && action === 'create')) return { row: finish(r, line, 'none', code || `Linha ${line}`), op: null }

    if (action === 'update') {
      return {
        row: finish(r, line, 'update', code),
        op: { kind: 'units', action: 'update', id: match!.id, unit: defined({ area_m2: area, bedrooms, bathrooms, parking_spots: parking, asking_rent_cents: rent, manual_status: status, notes }) },
      }
    }
    // Posição: a informada ou depois da última do andar (contando as criadas nesta mesma planilha).
    const slot = floor?.id ?? 'solta'
    const pos = position ?? (maxPos.get(slot) ?? 0) + 1
    maxPos.set(slot, Math.max(maxPos.get(slot) ?? 0, pos))
    return {
      row: finish(r, line, 'create', code),
      op: {
        kind: 'units', action: 'create', propertyId: prop.id,
        unit: {
          code, kind: kind!, area_m2: area!, bedrooms: bedrooms ?? 0, bathrooms: bathrooms ?? 0, parking_spots: parking ?? 0, asking_rent_cents: rent ?? null,
          manual_status: status ?? 'available', notes: notes ?? '', building_id: building?.id ?? null, floor_id: floor?.id ?? null, position: buildings.length ? pos : null,
        },
      },
    }
  })
}

/* ---------------------------------------------------------------- plano */

function countOf(rows: PlannedRow[]): ImportCounts {
  const c: ImportCounts = { total: rows.length, ok: 0, warning: 0, error: 0, create: 0, update: 0, skip: 0 }
  for (const r of rows) {
    c[r.level]++
    if (r.action === 'create' || r.action === 'update' || r.action === 'skip') c[r.action]++
  }
  return c
}

function planAll(db: Db, sc: Scope, s: Session, input: ImportInput): { plan: ImportPlan; ops: Op[] } {
  const fields = fieldsFor(input.kind, hasFeature(s, 'portfolios'))
  const ctx: PlanCtx = { db, sc, s, input, byKey: new Map(fields.map((f) => [f.key, f])) }
  const planned = input.kind === 'people' ? planPeople(ctx) : input.kind === 'properties' ? planProperties(ctx) : planUnits(ctx)
  const rows = planned.map((p) => p.row)
  return { plan: { rows, counts: countOf(rows) }, ops: planned.flatMap((p) => (p.op ? [p.op] : [])) }
}

/** Valida sem gravar: é a prévia da tela (passo 5). */
export async function validateImport(s: Session, input: ImportInput): Promise<ImportPlan> {
  requireImport(s, input.kind)
  const { db, sc } = await connect(s)
  return planAll(db, sc, s, checkInput(input)).plan
}

/* ---------------------------------------------------------------- gravar */

export interface ImportResult {
  batch: ImportBatch
  plan: ImportPlan
}

/**
 * Grava o lote. Passo a passo:
 * 1. permissão e formato da entrada; 2. plano de novo; 3. nada a gravar = recusa;
 * 4. cria o lote e os registros com import_batch_id (o fio que permite desfazer);
 * 5. no "atualizar", guarda a versão de antes em updated_records; 6. auditoria do lote e de cada registro.
 */
export async function runImport(s: Session, input: ImportInput): Promise<ImportResult> {
  requireImport(s, input.kind)
  const { db, sc } = await connect(s)
  const data = checkInput(input)
  const { plan, ops } = planAll(db, sc, s, data)
  if (!ops.length) throw new RuleError('Nada para importar: todas as linhas têm erro ou foram puladas. Corrija a planilha ou mude as Regras e valide de novo.')

  const batchId = newId()
  const now = nowIso()
  const stamp = () => ({ id: newId(), organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id })
  const people: Person[] = []
  const properties: Property[] = []
  const units: Unit[] = []
  const owners: PropertyOwner[] = []
  const updates: { table: 'people' | 'properties' | 'units'; before: Person | Property | Unit; after: Person | Property | Unit }[] = []

  for (const op of ops) {
    if (op.kind === 'people' && op.action === 'create') {
      people.push({ ...stamp(), deleted_at: null, ...op.data, vendor_categories: [], user_id: null, import_batch_id: batchId })
    } else if (op.kind === 'people') {
      const before = db.people.find((p) => p.id === op.id)!
      updates.push({ table: 'people', before, after: { ...before, ...op.data, updated_at: now } })
    } else if (op.kind === 'properties' && op.action === 'create') {
      const p: Property = { ...stamp(), deleted_at: null, ...op.property, lat: null, lng: null, import_batch_id: batchId }
      properties.push(p)
      // zone vazio: a planilha não traz área de fora dos blocos (a vaga importada fica sem área até alguém editar).
      units.push({ ...stamp(), deleted_at: null, property_id: p.id, features: [], zone: null, import_batch_id: batchId, ...op.unit })
      if (op.owner) owners.push({ ...stamp(), property_id: p.id, unit_id: null, person_id: op.owner.personId, share_pct: 100, since: op.owner.since, until: null })
    } else if (op.kind === 'properties') {
      const before = db.properties.find((p) => p.id === op.id)!
      updates.push({ table: 'properties', before, after: { ...before, ...op.property, updated_at: now } })
      const ub = db.units.find((u) => u.id === op.unitId)!
      if (Object.keys(op.unit).length) updates.push({ table: 'units', before: ub, after: { ...ub, ...op.unit, updated_at: now } })
    } else if (op.action === 'create') {
      units.push({ ...stamp(), deleted_at: null, property_id: op.propertyId, features: [], zone: null, import_batch_id: batchId, ...op.unit })
    } else {
      const before = db.units.find((u) => u.id === op.id)!
      updates.push({ table: 'units', before, after: { ...before, ...op.unit, updated_at: now } })
    }
  }

  // Atualização que não muda nada (mesmos valores) não entra no lote nem na auditoria.
  const realUpdates = updates.filter((u) => diff(u.before, u.after))
  const updatedOf = <T,>(t: 'people' | 'properties' | 'units') => realUpdates.filter((u) => u.table === t).map((u) => u.after as T)
  const peopleOut = [...people, ...updatedOf<Person>('people')]
  const propertiesOut = [...properties, ...updatedOf<Property>('properties')]
  const unitsOut = [...units, ...updatedOf<Unit>('units')]
  if (peopleOut.length) upsertRows('people', peopleOut)
  if (propertiesOut.length) upsertRows('properties', propertiesOut)
  if (unitsOut.length) upsertRows('units', unitsOut)
  if (owners.length) upsertRows('property_owners', owners)

  const updatedRecords: ImportUpdatedRecord[] = realUpdates.map((u) => ({ table: u.table, id: u.before.id, before: u.before as unknown as Record<string, unknown> }))
  const mapping: Record<string, string> = {}
  for (const [field, idx] of Object.entries(data.mapping)) if (idx !== null && data.headers[idx]) mapping[data.headers[idx]] = field
  const batch: ImportBatch = {
    id: batchId, organization_id: s.org.id, created_at: now, updated_at: now, created_by: s.user.id,
    entity: data.kind, file_name: data.fileName, mapping,
    rows_total: plan.counts.total, rows_ok: plan.counts.ok, rows_warning: plan.counts.warning, rows_error: plan.counts.error,
    errors: plan.rows.flatMap((r) => r.messages.map((m) => ({ row: r.line, column: m.column, message: m.message, level: m.level }))),
    undone_at: null,
    ...(updatedRecords.length ? { updated_records: updatedRecords } : {}),
  }
  upsertRows('import_batches', [batch])

  const what = data.kind === 'people' ? `${people.length} pessoas` : data.kind === 'properties' ? `${properties.length} imóveis (com ${units.length} unidades)` : `${units.length} unidades`
  audit(s, 'import_batches', batchId, 'import', `Importou ${what} de ${data.fileName}: ${realUpdates.length} atualizados, ${plan.counts.skip} pulados, ${plan.counts.error} linhas com erro`)
  for (const p of people) audit(s, 'people', p.id, 'import', `Criada pela importação de ${data.fileName}`)
  for (const p of properties) audit(s, 'properties', p.id, 'import', `Criado pela importação de ${data.fileName}`)
  for (const u of units) audit(s, 'units', u.id, 'import', `Criada pela importação de ${data.fileName}`)
  for (const u of realUpdates) audit(s, u.table, u.before.id, 'import', `Atualizado pela importação de ${data.fileName}`, diff(u.before, u.after))
  return { batch, plan }
}

/* ---------------------------------------------------------------- desfazer */

export interface UndoPreview {
  batchId: Id
  fileName: string
  created: { people: number; properties: number; units: number; owners: number }
  updated: number
  /** O que impede o desfazer (vazio = pode desfazer). */
  blockers: string[]
}

interface UndoPlan {
  preview: UndoPreview
  batch: ImportBatch
  people: Person[]
  properties: Property[]
  units: Unit[]
  owners: PropertyOwner[]
  restore: { table: ImportUpdatedRecord['table']; current: Person | Property | Unit; before: Record<string, unknown> }[]
}

function planUndo(db: Db, sc: Scope, s: Session, batchId: Id): UndoPlan {
  const batch = db.import_batches.find((b) => b.id === batchId && b.organization_id === s.org.id)
  if (!batch) throw new AccessError('Importação não encontrada nesta conta.')
  const blockers: string[] = []
  if (batch.undone_at) blockers.push(`este lote já foi desfeito em ${formatDateTime(batch.undone_at, s.org.timezone)}`)
  const mine = <T extends { organization_id: Id; import_batch_id?: Id | null }>(rows: T[]) => rows.filter((r) => r.organization_id === s.org.id && r.import_batch_id === batch.id)
  const people = mine(db.people).filter((p) => see.person(sc, p))
  const properties = mine(db.properties).filter((p) => see.property(sc, p))
  const units = mine(db.units).filter((u) => see.unit(sc, u))
  const propIds = new Set(properties.map((p) => p.id))
  const propName = new Map(db.properties.map((p) => [p.id, p.name]))

  for (const p of people) {
    const uses = usesOfPerson(db, p, batch)
    if (uses.length) blockers.push(`${p.name}: ${uses.join(', ')}`)
  }
  for (const u of units) {
    const uses = usesOfUnit(db, u, batch)
    if (uses.length) blockers.push(`${propName.get(u.property_id) ?? 'Imóvel'} · ${u.code}: ${uses.join(', ')}`)
  }
  for (const p of properties) {
    const uses = usesOfProperty(db, p, batch)
    if (uses.length) blockers.push(`${p.name}: ${uses.join(', ')}`)
  }
  // Dono ligado PELO lote (mesmo horário ou antes) sai junto com o imóvel; o ligado depois já é um "uso" (acima).
  const owners = db.property_owners.filter((o) => propIds.has(o.property_id) && moment(o.created_at) <= moment(batch.created_at))

  const restore: UndoPlan['restore'] = []
  for (const rec of batch.updated_records ?? []) {
    const table = db[rec.table] as (Person | Property | Unit)[]
    const current = table.find((x) => x.id === rec.id)
    if (!current) continue // registro apagado depois: não há o que devolver
    const later = changedAfter(current, batch, s.org.timezone)
    const label = 'code' in current ? `${propName.get(current.property_id) ?? ''} · ${current.code}` : current.name
    if (later) blockers.push(`${label}: ${later}`)
    else restore.push({ table: rec.table, current, before: rec.before })
  }

  return {
    batch, people, properties, units, owners, restore,
    preview: {
      batchId: batch.id, fileName: batch.file_name,
      created: { people: people.length, properties: properties.length, units: units.length, owners: owners.length },
      updated: (batch.updated_records ?? []).length,
      blockers,
    },
  }
}

export async function previewUndo(s: Session, batchId: Id): Promise<UndoPreview> {
  if (!can(s, 'data:import')) throw new AccessError('Desfazer importação pede a permissão "Importar e editar em massa".')
  const { db, sc } = await connect(s)
  return planUndo(db, sc, s, batchId).preview
}

/** Desfaz o lote inteiro ou nada: com qualquer uso depois da importação, recusa listando o que impede. */
export async function undoImport(s: Session, batchId: Id): Promise<UndoPreview> {
  const { db, sc } = await connect(s)
  const pre = db.import_batches.find((b) => b.id === batchId && b.organization_id === s.org.id)
  requireImport(s, pre?.entity === 'people' ? 'people' : 'properties')
  const plan = planUndo(db, sc, s, batchId)
  const { blockers } = plan.preview
  if (blockers.length) {
    throw new RuleError(
      `Não dá para desfazer: ${blockers.length === 1 ? 'um registro do lote já foi usado' : `${blockers.length} registros do lote já foram usados`} depois da importação (${shortList(blockers, 4)}). ` +
        'O desfazer só apaga o que ninguém usou; corrija esses registros pelo Data Manager ou pela tela de cada um.',
    )
  }
  const now = nowIso()
  const { batch } = plan
  if (plan.units.length) deleteRows('units', plan.units.map((u) => u.id))
  if (plan.owners.length) deleteRows('property_owners', plan.owners.map((o) => o.id))
  if (plan.properties.length) deleteRows('properties', plan.properties.map((p) => p.id))
  if (plan.people.length) deleteRows('people', plan.people.map((p) => p.id))
  for (const r of plan.restore) {
    // A versão de antes volta inteira (é a foto guardada no lote), só com o horário da mudança novo.
    const back = { ...r.before, updated_at: now } as unknown as typeof r.current
    if (r.table === 'people') upsertRows('people', [back as Person])
    else if (r.table === 'properties') upsertRows('properties', [back as Property])
    else upsertRows('units', [back as Unit])
    audit(s, r.table, r.current.id, 'undo', `Valores de antes devolvidos ao desfazer a importação de ${batch.file_name}`, diff(r.current, back))
  }
  upsertRows('import_batches', [{ ...batch, undone_at: now, updated_at: now }])
  const total = plan.people.length + plan.properties.length + plan.units.length
  audit(s, 'import_batches', batch.id, 'undo', `Desfez a importação de ${batch.file_name}: ${total} registros removidos, ${plan.restore.length} devolvidos ao que eram`)
  for (const p of plan.people) audit(s, 'people', p.id, 'undo', `Removida ao desfazer a importação de ${batch.file_name}`)
  for (const p of plan.properties) audit(s, 'properties', p.id, 'undo', `Removido ao desfazer a importação de ${batch.file_name}`)
  for (const u of plan.units) audit(s, 'units', u.id, 'undo', `Removida ao desfazer a importação de ${batch.file_name}`)
  return plan.preview
}

/* ---------------------------------------------------------------- lotes anteriores */

export interface BatchRow extends ImportBatch {
  who: string
  kind_label: string
  state: 'ativo' | 'desfeito'
  /** Quantos registros do lote ainda existem (imóveis, unidades e pessoas). */
  alive: number
}

/** Filtros: entity, state. Ordens: created_at, file_name, rows_total. */
export async function listBatches(s: Session, params: ListParams): Promise<ListResult<BatchRow>> {
  if (!can(s, 'data:import')) throw new AccessError('Ver importações pede a permissão "Importar e editar em massa".')
  const { db } = await connect(s)
  const users = new Map(db.profiles.map((p) => [p.id, p.full_name]))
  const alive = new Map<Id, number>()
  for (const t of [db.people, db.properties, db.units] as { organization_id: Id; import_batch_id?: Id | null }[][])
    for (const r of t) if (r.organization_id === s.org.id && r.import_batch_id) alive.set(r.import_batch_id, (alive.get(r.import_batch_id) ?? 0) + 1)
  // import_batches não tem regra em see: o filtro é a organização (só quem importa chega aqui).
  const rows: BatchRow[] = db.import_batches
    .filter((b) => b.organization_id === s.org.id)
    .map((b) => ({
      ...b, who: b.created_by ? (users.get(b.created_by) ?? 'Usuário') : 'Sistema',
      kind_label: b.entity in IMPORT_KIND_LABEL ? IMPORT_KIND_LABEL[b.entity as ImportKind] : b.entity,
      state: b.undone_at ? 'desfeito' : 'ativo', alive: alive.get(b.id) ?? 0,
    }))
  return runList(rows, params, {
    search: (r) => [r.file_name, r.who, r.kind_label],
    filters: { entity: (r) => r.entity, state: (r) => r.state },
    sorts: { created_at: (r) => r.created_at, file_name: (r) => r.file_name, rows_total: (r) => r.rows_total, who: (r) => r.who },
    defaultSort: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  })
}

/* ---------------------------------------------------------------- contexto da tela */

export interface ImportContext {
  agency: boolean
  canPeople: boolean
  canProperties: boolean
  portfolios: string[]
  team: TeamMember[]
  /** Imóveis que podem receber unidades (com blocos e andares, para o modelo e a dica). */
  properties: { id: Id; name: string; units: number; buildings: { name: string; floors: string[] }[] }[]
}

export async function importContext(s: Session): Promise<ImportContext> {
  if (!can(s, 'data:import')) throw new AccessError('Importar pede a permissão "Importar e editar em massa".')
  const { db, sc } = await connect(s)
  const agency = hasFeature(s, 'portfolios')
  return {
    agency,
    canPeople: can(s, 'people:edit'),
    canProperties: can(s, 'properties:edit'),
    portfolios: agency ? db.portfolios.filter((p) => p.organization_id === s.org.id).map((p) => p.name) : [],
    team: activeTeam(db, s.org.id),
    properties: db.properties
      .filter((p) => see.property(sc, p) && !p.deleted_at)
      .map((p) => ({
        id: p.id, name: p.name, units: db.units.filter((u) => u.property_id === p.id && !u.deleted_at).length,
        buildings: db.buildings
          .filter((b) => b.property_id === p.id)
          .map((b) => ({ name: b.name, floors: db.floors.filter((f) => f.building_id === b.id).sort((x, y) => x.level - y.level).map((f) => f.label) })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  }
}
