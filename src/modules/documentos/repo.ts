/* =============================================================================
   Documentos: MÓDULO DE REFERÊNCIA do repositório. Os outros módulos seguem este formato:
     1. tipo da linha "enriquecida" (o que a tabela mostra, já com nomes e links);
     2. listar = connect(s) -> filtrar pelo escopo (see.*) -> enriquecer -> runList;
     3. gravar = conferir permissão -> validar -> gravar -> auditar -> devolver a linha;
     4. regra que recusa = RuleError com causa e conserto.

   ONDE O DOCUMENTO APARECE (07/11/2026): documento sempre pertence a alguma coisa (contrato,
   imóvel, unidade, chamado, vistoria, pessoa), por isso não tem mais tela própria nem item no
   menu. Ele é mostrado e anexado onde mora: na linha aberta do contrato e da pessoa (Contratos e
   pessoas), na aba "Documentos e histórico" do imóvel e da unidade, no chamado. O portal do
   proprietário e do inquilino vê a lista inteira dele em "Meus contratos" (listDocuments).

   ARQUIVOS: no modo de demonstração só o REGISTRO do documento é guardado; o arquivo não.
   Na fase 2: bucket privado no Supabase Storage, caminho começando pelo id da organização
   e download por link assinado que expira em poucos minutos.
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { AccessError, audit, connect, nowIso, RuleError } from '@/data/api'
import { runList, type ListParams, type ListResult } from '@/data/query'
import { see } from '@/data/scope'
import { upsertRows } from '@/data/store'
import type { Db } from '@/data/db'
import type { DocumentFile, Id } from '@/data/types'
import { newId } from '@/lib/random'

export type LinkKind = 'contract' | 'unit' | 'property' | 'person' | 'maintenance' | 'inspection'
export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  contract: 'Contrato', unit: 'Unidade', property: 'Imóvel', person: 'Pessoa', maintenance: 'Chamado', inspection: 'Vistoria',
}

export interface DocumentRow extends DocumentFile {
  linkKind: LinkKind
  linkLabel: string
  linkHref: string
  visibilityKey: 'internal' | 'owner' | 'lessee' | 'both'
}

export const VISIBILITY_LABEL: Record<DocumentRow['visibilityKey'], string> = {
  internal: 'Só a equipe', owner: 'Proprietário', lessee: 'Inquilino', both: 'Proprietário e inquilino',
}

/**
 * Liga o documento à entidade dele, com nome legível e endereço da tela. Contrato e pessoa usam o
 * endereço de antes (/contratos/<id>, /pessoas/<id>), que leva à escolha em "Contratos e pessoas":
 * o link da tabela é um caminho, sem "?" (o roteador trata o "?" dentro do caminho como parte dele).
 */
function linkOf(db: Db, d: DocumentFile): Pick<DocumentRow, 'linkKind' | 'linkLabel' | 'linkHref'> {
  if (d.contract_id) return { linkKind: 'contract', linkLabel: db.contracts.find((k) => k.id === d.contract_id)?.code ?? 'Contrato', linkHref: `/contratos/${d.contract_id}` }
  if (d.inspection_id) {
    const i = db.inspections.find((x) => x.id === d.inspection_id)
    // Só o código da unidade: a tela já escreve o tipo ("Vistoria") antes do rótulo.
    return { linkKind: 'inspection', linkLabel: db.units.find((u) => u.id === i?.unit_id)?.code ?? '', linkHref: `/vistorias/${d.inspection_id}` }
  }
  if (d.maintenance_id) return { linkKind: 'maintenance', linkLabel: db.maintenance_requests.find((r) => r.id === d.maintenance_id)?.code ?? 'Chamado', linkHref: `/manutencao/${d.maintenance_id}` }
  if (d.unit_id) return { linkKind: 'unit', linkLabel: db.units.find((u) => u.id === d.unit_id)?.code ?? 'Unidade', linkHref: `/unidades/${d.unit_id}` }
  if (d.property_id) return { linkKind: 'property', linkLabel: db.properties.find((p) => p.id === d.property_id)?.name ?? 'Imóvel', linkHref: `/imoveis/${d.property_id}` }
  return { linkKind: 'person', linkLabel: db.people.find((p) => p.id === d.person_id)?.name ?? 'Pessoa', linkHref: `/pessoas/${d.person_id}` }
}

function visibilityKey(d: DocumentFile): DocumentRow['visibilityKey'] {
  return d.visible_to_owner && d.visible_to_lessee ? 'both' : d.visible_to_owner ? 'owner' : d.visible_to_lessee ? 'lessee' : 'internal'
}

/** Lista com escopo. Para exportar, chame com pageSize enorme: o filtro é o mesmo da tela. */
export async function listDocuments(s: Session, params: ListParams): Promise<ListResult<DocumentRow>> {
  const { db, sc } = await connect(s)
  const rows: DocumentRow[] = db.documents.filter((d) => see.document(sc, d)).map((d) => ({ ...d, ...linkOf(db, d), visibilityKey: visibilityKey(d) }))
  return runList(rows, params, {
    search: (r) => [r.name, r.linkLabel],
    filters: { vinculo: (r) => r.linkKind, visibilidade: (r) => r.visibilityKey },
    sorts: { name: (r) => r.name, link: (r) => r.linkLabel, size: (r) => r.size, created_at: (r) => r.created_at },
    defaultSort: (a, b) => (a.created_at < b.created_at ? 1 : -1),
  })
}

/** Um grupo de opções do "Pertence a" (Imóvel, Contratos, Unidades), na ordem em que aparece. */
export interface AttachGroup {
  label: string
  options: { value: string; label: string }[]
}

/**
 * Onde dá para pendurar um documento, a partir de um lugar (a aba "Documentos e histórico" do
 * imóvel ou da unidade): o próprio imóvel, os contratos e as unidades dele, ou a unidade e os
 * contratos dela. Só o que a sessão enxerga; unidade arquivada fica de fora.
 * O valor de cada opção é "tipo:id", o mesmo formato que uploadDocument recebe.
 */
export async function listAttachTargets(s: Session, around: { propertyId: Id } | { unitId: Id }): Promise<AttachGroup[]> {
  const { db, sc } = await connect(s)
  const unitCode = new Map(db.units.map((u) => [u.id, u.code]))
  if ('unitId' in around) {
    const u = db.units.find((x) => x.id === around.unitId && see.unit(sc, x))
    if (!u) throw new AccessError('Unidade não encontrada ou fora do seu acesso.')
    const contracts = db.contracts.filter((k) => k.unit_id === u.id && see.contract(sc, k)).sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
    return [
      { label: 'Unidade', options: [{ value: `unit:${u.id}`, label: `Unidade ${u.code}` }] },
      { label: 'Contratos', options: contracts.map((k) => ({ value: `contract:${k.id}`, label: `Contrato ${k.code}` })) },
    ].filter((g) => g.options.length)
  }
  const p = db.properties.find((x) => x.id === around.propertyId && see.property(sc, x))
  if (!p) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  const contracts = db.contracts.filter((k) => k.property_id === p.id && see.contract(sc, k)).sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }))
  const units = db.units.filter((u) => u.property_id === p.id && !u.deleted_at && see.unit(sc, u)).sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }))
  return [
    { label: 'Imóvel', options: [{ value: `property:${p.id}`, label: `Imóvel ${p.name}` }] },
    { label: 'Contratos', options: contracts.map((k) => ({ value: `contract:${k.id}`, label: `Contrato ${k.code}${k.unit_id ? ` (${unitCode.get(k.unit_id) ?? ''})` : ''}` })) },
    { label: 'Unidades', options: units.map((u) => ({ value: `unit:${u.id}`, label: `Unidade ${u.code}` })) },
  ].filter((g) => g.options.length)
}

export const uploadSchema = z.object({
  name: z.string().trim().min(3, 'Dê um nome com pelo menos 3 letras.').max(120, 'Nome longo demais: até 120 caracteres.'),
  target: z.string().regex(/^(contract|unit|property|person):.+/, 'Escolha a que o documento pertence.'),
  owner: z.boolean(),
  lessee: z.boolean(),
  size: z.number().int().min(0).max(20 * 1024 * 1024, 'Arquivo acima de 20 MB: reduza ou divida.'),
  mime: z.string(),
})
export type UploadInput = z.infer<typeof uploadSchema>

/** O que cada tipo de "Pertence a" grava no documento (uma coluna de vínculo por tipo). */
type AttachKind = 'contract' | 'unit' | 'property' | 'person'
const LINK_COLUMN: Record<AttachKind, 'contract_id' | 'unit_id' | 'property_id' | 'person_id'> = { contract: 'contract_id', unit: 'unit_id', property: 'property_id', person: 'person_id' }

/**
 * Envia (registra) um documento pendurado num contrato, unidade, imóvel ou pessoa. Passo a passo:
 *   1. só a equipe da conta envia (o portal só vê);
 *   2. valida de novo (a tela não é a única porta);
 *   3. o registro escolhido existe E a sessão o enxerga (id de outra conta é recusado, sem dizer qual);
 *   4. grava com "quem vê" e audita.
 * Chamado e vistoria têm o anexo deles (attachToRequest e a vistoria), com regras próprias.
 */
export async function uploadDocument(s: Session, input: UploadInput): Promise<DocumentFile> {
  const { db, sc } = await connect(s)
  if (!sc.all) throw new AccessError('Só a equipe da conta envia documentos.') // passo 1
  const data = uploadSchema.parse(input) // passo 2
  const cut = data.target.indexOf(':')
  const kind = data.target.slice(0, cut) as AttachKind
  const id = data.target.slice(cut + 1) as Id
  // Passo 3.
  const exists =
    kind === 'contract' ? db.contracts.some((k) => k.id === id && see.contract(sc, k))
    : kind === 'unit' ? db.units.some((u) => u.id === id && !u.deleted_at && see.unit(sc, u))
    : kind === 'property' ? db.properties.some((p) => p.id === id && !p.deleted_at && see.property(sc, p))
    : db.people.some((p) => p.id === id && see.person(sc, p))
  if (!exists) throw new RuleError('O registro escolhido não existe mais ou é de outra conta.')
  // Passo 4.
  const docId = newId()
  const row: DocumentFile = {
    id: docId, organization_id: s.org.id, created_at: nowIso(), updated_at: nowIso(), created_by: s.user.id, deleted_at: null,
    name: data.name, mime: data.mime || 'application/octet-stream', size: data.size, visible_to_owner: data.owner, visible_to_lessee: data.lessee,
    property_id: null, unit_id: null, contract_id: null, person_id: null, maintenance_id: null, inspection_id: null,
    [LINK_COLUMN[kind]]: id,
    storage_path: `${s.org.id}/${docId}/${data.name}`,
  }
  upsertRows('documents', [row])
  audit(s, 'documents', row.id, 'create', `Enviou o documento "${row.name}"`)
  return row
}

export async function setVisibility(s: Session, args: { id: Id; owner: boolean; lessee: boolean }): Promise<void> {
  const { db, sc } = await connect(s)
  const d = db.documents.find((x) => x.id === args.id)
  if (!d || !see.document(sc, d)) throw new AccessError()
  if (!sc.all) throw new AccessError('Só a equipe da conta muda quem vê o documento.')
  upsertRows('documents', [{ ...d, visible_to_owner: args.owner, visible_to_lessee: args.lessee, updated_at: nowIso() }])
  audit(s, 'documents', d.id, 'update', `Mudou a visibilidade de "${d.name}" para: ${VISIBILITY_LABEL[visibilityKey({ ...d, visible_to_owner: args.owner, visible_to_lessee: args.lessee })]}`)
}

/** Arquivar = exclusão lógica (some da lista, a auditoria continua). Desfazer devolve. */
export async function archiveDocument(s: Session, args: { id: Id; restore?: boolean }): Promise<DocumentFile> {
  const { db, sc } = await connect(s)
  const d = db.documents.find((x) => x.id === args.id)
  if (!d || d.organization_id !== s.org.id || !sc.all) throw new AccessError()
  const row = { ...d, deleted_at: args.restore ? null : nowIso(), updated_at: nowIso() }
  upsertRows('documents', [row])
  audit(s, 'documents', d.id, args.restore ? 'restore' : 'archive', `${args.restore ? 'Restaurou' : 'Arquivou'} "${d.name}"`)
  return row
}
