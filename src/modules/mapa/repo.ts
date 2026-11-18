/* =============================================================================
   repo.ts do Mapa: o que a página Imóveis (tabela de imóveis e pinos do mapa da cidade) e o
   3D precisam ler (e a única gravação: aprovar a planta que veio da importação automática).

   Escopo (o espelho da RLS):
   - imóveis e unidades passam por see.* (via toPropertyRows e toUnitRows, as mesmas
     visões da tela de Imóveis: a ocupação aqui é a mesma de lá);
   - buildings, floors, building_models e floorplan_elements NÃO têm regra própria no
     scope.ts. A regra fica escrita aqui: entra só o bloco que tem pelo menos uma unidade
     visível para a sessão, e só a planta de unidade visível. O proprietário convidado vê o
     VOLUME do prédio (andares e quantas unidades por andar, o que qualquer um vê da rua),
     mas código, situação e pessoas só das unidades dele.
   Na fase 2 essas regras viram políticas de RLS nas mesmas tabelas.
   ============================================================================= */
import { z } from 'zod'
import type { Session } from '@/auth/session'
import { can } from '@/auth/permissions'
import { AccessError, audit, connect, nowIso, RuleError } from '@/data/api'
import { runList, type ListConfig, type ListParams, type ListResult } from '@/data/query'
import type { Db } from '@/data/db'
import type { BuildingModel, FloorplanElement, Id, IsoDate, UnitStatus } from '@/data/types'
import { isSpot, listUnits, toPropertyRows, toUnitRows, type PropertyRow, type UnitRow } from '@/data/views/units'
import { see, type Scope } from '@/data/scope'
import { upsertRows } from '@/data/store'

export const STATUS_ORDER: UnitStatus[] = ['occupied', 'available', 'reserved', 'maintenance', 'blocked']

/* ---------------------------------------------------------------- lista de imóveis e pinos do mapa */

/** Um imóvel da tabela "Imóveis" (página Imóveis), com a contagem de unidades por situação. */
export interface MapPropertyRow extends PropertyRow {
  /** Quantas unidades em cada situação (o filtro "Situação" da tabela de imóveis). */
  status_counts: Record<UnitStatus, number>
}

const emptyCounts = (): Record<UnitStatus, number> => ({ available: 0, occupied: 0, reserved: 0, maintenance: 0, blocked: 0 })

/** Unidade sem bloco vira, na cena do 3D do próprio imóvel, um "bloco" de mentira com este id. */
const looseBuildingId = (propertyId: Id) => `avulso:${propertyId}`

/**
 * Busca, filtros e ordens da tabela de imóveis. Ficam numa constante porque a tabela (uma página)
 * e os pinos do mapa (o resultado inteiro) passam pela MESMA regra: o mapa nunca mostra um
 * imóvel que a tabela, com os mesmos filtros, não mostraria.
 * Filtros: kind (tipo), status (imóvel com pelo menos uma unidade nessa situação), portfolio
 * (carteira), district (bairro), manager (responsável). Ordens: name, units, occupancy, rent_roll.
 */
const PROPERTY_LIST: ListConfig<MapPropertyRow> = {
  search: (r) => [r.name, r.address.street, r.address.number, r.address.district, r.owners_label],
  filters: {
    kind: (r) => r.kind,
    status: (r) => STATUS_ORDER.filter((st) => r.status_counts[st] > 0),
    portfolio: (r) => r.portfolio_id,
    district: (r) => r.address.district,
    manager: (r) => r.manager_user_id,
  },
  sorts: { name: (r) => r.name, units: (r) => r.units_total, occupancy: (r) => r.occupancy_pct, rent_roll: (r) => r.rent_roll_cents },
  defaultSort: (a, b) => b.units_total - a.units_total || a.name.localeCompare(b.name, 'pt-BR'),
}

/**
 * Imóveis que a sessão enxerga (escopo dentro de toPropertyRows e toUnitRows), sem os arquivados,
 * cada um com a contagem das suas unidades (não arquivadas) por situação. Vaga não conta: a mesma
 * regra do units_total da camada de dados (sem isso, "alugáveis" = total menos bloqueadas
 * misturava vaga bloqueada com apartamento).
 */
function propertyRows(db: Db, sc: Scope, today: IsoDate): MapPropertyRow[] {
  const counts = new Map<Id, Record<UnitStatus, number>>()
  for (const u of toUnitRows(db, sc, today)) {
    if (u.deleted_at || isSpot(u)) continue
    const c = counts.get(u.property_id) ?? emptyCounts()
    c[u.status]++
    counts.set(u.property_id, c)
  }
  return toPropertyRows(db, sc, today)
    .filter((p) => !p.deleted_at)
    .map((p) => ({ ...p, status_counts: counts.get(p.id) ?? emptyCounts() }))
}

/** A tabela "Imóveis" da página Imóveis: um imóvel por linha, já buscada, filtrada, ordenada e paginada. */
export async function listMapProperties(s: Session, params: ListParams): Promise<ListResult<MapPropertyRow>> {
  const { db, sc } = await connect(s)
  return runList(propertyRows(db, sc, s.today), params, PROPERTY_LIST)
}

/** Um pino do mapa da cidade: onde o imóvel fica e os números que o pino e a dica mostram. */
export interface MapPin {
  id: Id
  name: string
  district: string
  lat: number | null
  lng: number | null
  units_total: number
  units_occupied: number
  /** Alugáveis = todas menos as bloqueadas (a ocupação de um GRUPO de pinos soma ocupadas e alugáveis). */
  units_rentable: number
  occupancy_pct: number
  /**
   * Na tabela "Unidades": quantas unidades DESTE imóvel estão no resultado (com "Disponível"
   * ligado, as disponíveis dele). Na tabela "Imóveis": null (o pino mostra o total do imóvel).
   */
  matched: number | null
  /** O que o pino conta, no singular e no plural; sem ele, "unidade/unidades". Os pinos de VAGAS dizem "vaga/vagas". */
  noun?: [string, string]
}

/** A categoria da tabela embaixo do mapa: um imóvel por linha ou uma unidade por linha. */
export type ListKind = 'imoveis' | 'unidades'

const toPin = (r: MapPropertyRow, matched: number | null): MapPin => ({
  id: r.id, name: r.name, district: r.address.district, lat: r.lat, lng: r.lng,
  units_total: r.units_total, units_occupied: r.units_occupied, units_rentable: r.units_total - r.status_counts.blocked,
  occupancy_pct: r.occupancy_pct, matched,
})

/**
 * Pinos do mapa para a MESMA busca e os MESMOS filtros da tabela que está embaixo dele.
 * A página e a ordem não importam: o mapa mostra o resultado inteiro, não só a página aberta.
 * Passo a passo:
 * 1. "imoveis": os imóveis que passam na regra da tabela de imóveis (PROPERTY_LIST);
 * 2. "unidades": as unidades que passam na regra da tabela de unidades (listUnits, a mesma da
 *    tabela, inclusive o "arquivadas só se pedir"); cada imóvel que tem pelo menos uma delas
 *    vira pino, com quantas são (matched). Assim "Disponível" mostra ONDE estão as vagas.
 * Na fase 2 o passo 2 vira um GROUP BY property_id na mesma consulta da tabela, sem trazer as linhas.
 */
export async function listMapPins(s: Session, kind: ListKind, params: Pick<ListParams, 'search' | 'filters'>): Promise<MapPin[]> {
  const { db, sc } = await connect(s)
  const all = { search: params.search, filters: params.filters, page: 1, pageSize: Number.MAX_SAFE_INTEGER }
  const props = propertyRows(db, sc, s.today)
  if (kind === 'imoveis') return runList(props, all, PROPERTY_LIST).rows.map((r) => toPin(r, null))
  const matched = new Map<Id, number>()
  for (const u of (await listUnits(s, all)).rows) matched.set(u.property_id, (matched.get(u.property_id) ?? 0) + 1)
  return props.filter((p) => matched.has(p.id)).map((p) => toPin(p, matched.get(p.id)!))
}

/* ---------------------------------------------------------------- 3D: a cena */

export interface SceneFloor {
  id: Id | null
  level: number
  label: string
  /** Quantas unidades o andar tem (contagem da estrutura, sem dado de unidade): decide o tamanho de cada "caixa". */
  slots: number
  /** Só as unidades que a sessão enxerga. */
  units: UnitRow[]
}

export interface SceneBuilding {
  id: string
  name: string
  property_id: Id
  template: BuildingModel['template']
  width: number
  depth: number
  site_x: number
  site_y: number
  /** De baixo para cima. */
  floors: SceneFloor[]
  /** Andares só de volume embaixo (apartamento avulso: o prédio em volta, que não é cadastrado). */
  base_floors: number
}

/** Estacionamento à parte (vagas sem bloco), agrupado pela área (`zone`: "Estacionamento externo"). */
export interface SceneLot {
  zone: string
  units: UnitRow[]
}

/** A cena de UM imóvel: a chave é o id dele (empreendimento com blocos ou imóvel avulso). */
export interface MapScene {
  key: string
  title: string
  property_id: Id
  buildings: SceneBuilding[]
  /** Vagas sem bloco (estacionamento externo). Vaga de garagem dentro do prédio fica no andar de subsolo do bloco. */
  lots: SceneLot[]
  units: UnitRow[]
}

/** A área da vaga ("Estacionamento externo"); vaga sem área cadastrada cai num "Estacionamento" genérico. */
export function zoneOf(u: Pick<UnitRow, 'zone'>): string {
  return u.zone?.trim() || 'Estacionamento'
}

/** Vagas sem bloco agrupadas pela área, na ordem do nome da área. */
function lotsOf(units: UnitRow[]): SceneLot[] {
  const by = new Map<string, UnitRow[]>()
  for (const u of units) by.set(zoneOf(u), [...(by.get(zoneOf(u)) ?? []), u])
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([zone, us]) => ({ zone, units: us }))
}

/**
 * Unidade sem bloco vira um "bloco" de mentira na cena: uma casa (com telhado) ou um apartamento
 * (com o prédio em volta, que não é cadastrado e fica só como volume neutro).
 * Agrupa por imóvel porque a regra vale para os dois casos: o imóvel avulso inteiro e a unidade
 * sem bloco dentro de um empreendimento (que vai para baixo dos blocos, a partir de startY).
 */
function looseBuildings(units: UnitRow[], startY: number): SceneBuilding[] {
  const byProp = new Map<Id, UnitRow[]>()
  for (const u of units) byProp.set(u.property_id, [...(byProp.get(u.property_id) ?? []), u])
  const props = [...byProp.entries()].sort((a, b) => a[1][0].property_name.localeCompare(b[1][0].property_name, 'pt-BR'))
  const cols = Math.max(1, Math.ceil(Math.sqrt(props.length)))
  return props.map(([propertyId, us], i) => {
    const house = us.every((u) => u.kind === 'house')
    return {
      id: looseBuildingId(propertyId),
      name: us[0].property_name,
      property_id: propertyId,
      template: house ? 'house' : 'tower',
      width: 2,
      depth: 2,
      site_x: (i % cols) * 4,
      site_y: startY + Math.floor(i / cols) * 4,
      floors: [{ id: null, level: house ? 0 : 2, label: house ? 'Térreo' : 'Unidade', slots: us.length, units: us }],
      base_floors: house ? 0 : 2,
    }
  })
}

/**
 * A cena do 3D de UM imóvel (a chave é o id dele). Serve aos dois casos:
 *   - empreendimento: os blocos de verdade, andar por andar;
 *   - imóvel avulso (casa ou apartamento sem bloco): só ele, numa cena própria.
 * Até 06/11/2026 os avulsos de endereços diferentes eram desenhados juntos num terreno inventado
 * ("Imóveis avulsos"); a ficha de cada imóvel agora mostra só o que é dele.
 * Passo a passo:
 * 1. o imóvel e as unidades visíveis (escopo) dele;
 * 2. blocos, andares e modelos SÓ dos blocos que têm unidade visível (regra escrita aqui);
 * 3. andar por andar, de baixo para cima, com a contagem de unidades do andar (estrutura);
 * 4. unidade sem bloco vira casa ou apartamento avulso: no imóvel avulso é a cena inteira (no
 *    começo do terreno); no empreendimento, fica abaixo dos blocos;
 * 5. vaga sem bloco vai para o estacionamento da cena, agrupada pela área (zone).
 */
export async function getMapScene(s: Session, key: string): Promise<MapScene> {
  const { db, sc } = await connect(s)
  const property = toPropertyRows(db, sc, s.today).find((p) => p.id === key && !p.deleted_at)
  if (!property) throw new AccessError('Imóvel não encontrado ou fora do seu acesso.')
  const mine = toUnitRows(db, sc, s.today).filter((u) => u.property_id === key && !u.deleted_at)
  const visibleBuildings = new Set(mine.map((u) => u.building_id).filter((b): b is Id => !!b))
  // Regra escrita aqui (as tabelas de estrutura não têm regra no scope.ts): só bloco com unidade visível.
  const blocks = db.buildings.filter((b) => b.organization_id === s.org.id && visibleBuildings.has(b.id))
  const models = new Map(db.building_models.filter((m) => m.organization_id === s.org.id && visibleBuildings.has(m.building_id)).map((m) => [m.building_id, m]))
  // Contagem de unidades por andar: é estrutura (o volume do prédio), não dado de unidade.
  const perFloor = new Map<Id, number>()
  for (const u of db.units) if (u.floor_id && !u.deleted_at && u.organization_id === s.org.id) perFloor.set(u.floor_id, (perFloor.get(u.floor_id) ?? 0) + 1)
  const buildings: SceneBuilding[] = blocks
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((b) => {
      const floors = db.floors.filter((f) => f.building_id === b.id && f.organization_id === s.org.id).sort((x, y) => x.level - y.level)
      const m = models.get(b.id)
      const upf = m?.units_per_floor ?? Math.max(1, ...floors.map((f) => perFloor.get(f.id) ?? 0))
      return {
        id: b.id, name: b.name, property_id: b.property_id,
        template: m?.template ?? 'tower', width: m?.width ?? Math.ceil(upf / 2) * 2, depth: m?.depth ?? 2,
        site_x: b.site_x, site_y: b.site_y, base_floors: 0,
        floors: floors.map((f) => ({
          id: f.id, level: f.level, label: f.label, slots: perFloor.get(f.id) || upf,
          units: mine.filter((u) => u.floor_id === f.id).sort((x, y) => (x.position ?? 99) - (y.position ?? 99) || x.code.localeCompare(y.code, 'pt-BR', { numeric: true })),
        })),
      }
    })
  // Sem bloco nenhum (imóvel avulso), a casa ou o apartamento começa no canto do terreno; com
  // blocos, fica 3 células abaixo deles (sem isso o avulso sobraria num terreno vazio de 3 células).
  // Vaga sem bloco não é imóvel avulso: vai para o estacionamento da cena (lots), não vira "prédio".
  const startY = buildings.length ? Math.max(...buildings.map((b) => b.site_y + b.depth)) + 3 : 0
  buildings.push(...looseBuildings(mine.filter((u) => !u.building_id && u.kind !== 'parking'), startY))
  return { key, title: property.name, property_id: property.id, units: mine, buildings, lots: lotsOf(mine.filter((u) => !u.building_id && u.kind === 'parking')) }
}

/* ---------------------------------------------------------------- planta da unidade */

/*
 * Planta interna da unidade (cômodos): sem tela desde 06/11/2026. O Fernando pediu o 3D só do
 * lado de fora ("não é para detalhar e criar o interior"), e a tela da planta (Floorplan.tsx)
 * saiu. Ficam a leitura e a aprovação, que são a porta da importação de planta da fase 2 (a IA
 * grava rascunho, a pessoa aprova), com teste no mapa.test.ts.
 */
export const FLOORPLAN_SOURCE: Record<FloorplanElement['source'], string> = {
  template: 'Modelo do empreendimento',
  manual: 'Desenhada à mão',
  ai_import: 'Importação automática',
}

export interface UnitFloorplan {
  unit_id: Id
  code: string
  elements: FloorplanElement[]
  /** draft = algum cômodo ainda em rascunho; null = sem planta. */
  review: FloorplanElement['review_status'] | null
  source: FloorplanElement['source'] | null
}

export async function getUnitFloorplan(s: Session, unitId: Id): Promise<UnitFloorplan> {
  const { db, sc } = await connect(s)
  const u = db.units.find((x) => x.id === unitId)
  if (!u || !see.unit(sc, u)) throw new AccessError('Unidade não encontrada ou fora do seu acesso.')
  // Planta sem regra no scope.ts: a unidade acima já passou pelo escopo; aqui só a mesma organização.
  const elements = db.floorplan_elements.filter((e) => e.unit_id === u.id && e.organization_id === s.org.id)
  const draft = elements.find((e) => e.review_status === 'draft')
  return { unit_id: u.id, code: u.code, elements, review: elements.length ? (draft ? 'draft' : 'approved') : null, source: (draft ?? elements[0])?.source ?? null }
}

export const approveFloorplanSchema = z.object({ unitId: z.string().trim().min(1, 'Escolha a unidade da planta.') })
export type ApproveFloorplanInput = z.infer<typeof approveFloorplanSchema>

/**
 * Aprovar a planta (a revisão humana do plano: a importação grava rascunho, a pessoa aprova).
 * Ordem da casa: permissão -> validação (zod) -> regra -> gravar -> auditar.
 */
export async function approveFloorplan(s: Session, input: ApproveFloorplanInput): Promise<{ unit_id: Id; code: string; count: number }> {
  const { db, sc } = await connect(s)
  if (!can(s, 'properties:edit')) throw new AccessError('Aprovar planta pede a permissão de editar imóveis. Quem administra a conta pode liberar em Configurações.')
  const { unitId } = approveFloorplanSchema.parse(input)
  const u = db.units.find((x) => x.id === unitId)
  if (!u || !see.unit(sc, u)) throw new AccessError('Unidade não encontrada ou fora do seu acesso.')
  const drafts = db.floorplan_elements.filter((e) => e.unit_id === u.id && e.organization_id === s.org.id && e.review_status === 'draft')
  if (!drafts.length) throw new RuleError(`A planta da ${u.code} não tem rascunho para aprovar: ela já foi aprovada ou ainda não existe.`)
  const now = nowIso()
  upsertRows('floorplan_elements', drafts.map((e) => ({ ...e, review_status: 'approved' as const, updated_at: now })))
  // A planta é o conjunto de cômodos da unidade: a auditoria fica no histórico da UNIDADE.
  audit(s, 'units', u.id, 'approve', `Aprovou a planta da ${u.code} (${drafts.length} cômodos; origem: ${FLOORPLAN_SOURCE[drafts[0].source]})`, {
    review_status: { from: 'draft', to: 'approved' },
  })
  return { unit_id: u.id, code: u.code, count: drafts.length }
}

