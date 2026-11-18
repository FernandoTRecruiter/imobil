/* =============================================================================
   A área de trabalho da ficha do imóvel (/imoveis/$propertyId), de cima para baixo:
     1. UMA linha de filtros (Bloco, Isolar andar, Situação, Quartos), que vale para o desenho e
        para a tabela de unidades ao mesmo tempo;
     2. o desenho 3D, o FOCO da tela (uns 2/3 da largura) e, à direita, o painel curto que a
        ficha manda (o resumo do imóvel ou a ficha da unidade escolhida); abaixo de 1280 px o
        painel desce para baixo do desenho;
     3. os detalhes (abas), que a ficha também manda; a tabela das unidades, montada aqui com os
        mesmos filtros do desenho, é entregue a ela para ir na aba Unidades.

   Gestos (07/11/2026, pedido do Fernando: "não quero mudança direto de aba/página por interações
   simples"): clicar numa unidade, no desenho ou na linha da tabela, ESCOLHE a unidade (anel no
   desenho, ficha ao lado, detalhes embaixo); clicar de novo nela, ou Esc, solta. Nada de abrir
   outra página. Passar o mouse só acende a mesma unidade do outro lado (a linha da tabela ou o
   anel no desenho). O balão com o resumo curto só abre no CLIQUE no desenho e some 2 s depois que
   o mouse sai dele (IsoCanvas e balao.ts); com o balão aberto, o primeiro Esc fecha só o balão.
   Girar e trocar 3D/planta andam no desenho (giro suave, no IsoCanvas); aqui só chegam o giro e o
   modo novos, no fim (onViewChange).
   A escolha mora no endereço (?unidade=), quem cuida dele é a ficha; aqui chega pronta.
   Escolha que veio de fora do desenho (linha de tabela, endereço) aproxima o desenho da unidade
   (a ficha rola a página até o desenho antes, com revealMap); a que veio de um clique no desenho
   não mexe no zoom (a pessoa já está olhando para ela).

   Mais leve e mais baixo (07/11/2026, "tá muito travado" e "deixa mais slim"):
   - os filtros cabem numa linha de 32 px (o nome de Bloco e Isolar andar vai dentro da própria
     caixa; Situação e Quartos ficam com o rótulo ao lado), e o desenho começa mais perto do topo;
   - a tabela das unidades NÃO se desenha de novo quando a escolha muda: a linha escolhida é marcada
     direto no DOM (markPicked), como a linha acesa pelo mouse. Antes, cada escolha redesenhava as
     120 linhas do Mount Juic.

   Este arquivo só é baixado quando o 3D abre (import dinâmico no MapPage).
   ============================================================================= */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject, type SyntheticEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, X } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { can } from '@/auth/permissions'
import { useRepo } from '@/data/hooks'
import { UNIT_STATUS } from '@/data/labels'
import type { SortDir } from '@/data/query'
import type { UnitStatus } from '@/data/types'
import type { UnitRow } from '@/data/views/units'
import { csvMoney } from '@/lib/csv'
import { downloadTable, type ExportFormat } from '@/lib/exportar'
import { ExportMenu } from '@/components/ui/ExportMenu'
import { formatDate } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { normalize, plural } from '@/lib/text'
import { UNIT_STATUS_VAR, UnitStatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Select } from '@/components/ui/Field'
import { InfoTip } from '@/components/ui/InfoTip'
import { Card } from '@/components/ui/Layout'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import type { Rot, ViewMode } from './iso'
import { IsoCanvas, type IsoFilters, type MapTarget } from './IsoCanvas'
import { layoutFor } from './implantacao'
import { countByStatus, isSpot, trailCrumbs } from './layout'
import { ASIDE_H, CANVAS_H, Loading3d } from './MapPage'
import { getMapScene, STATUS_ORDER, type MapScene } from './repo'

export interface PropertySceneProps {
  propertyId: string
  /** A unidade (ou vaga) escolhida, lida do endereço (?unidade=); null = nada escolhido. */
  selected: string | null
  /** Escolher (id) ou soltar (null). Quem chama grava no endereço. */
  onSelect: (id: string | null) => void
  /** O painel curto à direita do desenho (resumo do imóvel ou ficha da unidade). */
  aside: ReactNode
  /** A área de detalhes embaixo; recebe a tabela das unidades (null quando não há unidade para desenhar). */
  details: (unitsTable: ReactNode) => ReactNode
}

export function IsoView(props: PropertySceneProps) {
  const { propertyId } = props
  const q = useRepo('mapa:cena', (s) => getMapScene(s, propertyId), [propertyId])
  const scene = q.data?.key === propertyId ? q.data : undefined // a cena de outro imóvel não vale enquanto esta carrega
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!scene) return <Loading3d />
  if (!scene.units.length)
    return (
      <Workspace aside={props.aside}>
        <EmptyState title="Nenhuma unidade para mostrar" description="Este imóvel não tem unidade ativa que você possa ver." />
        {props.details(null)}
      </Workspace>
    )
  return <SceneView key={scene.key} scene={scene} {...props} />
}

/** Desenho (ou o aviso no lugar dele) e o painel lado a lado a partir de 1280 px; abaixo disso, um embaixo do outro. */
function Workspace({ aside, children }: { aside: ReactNode; children: [ReactNode, ReactNode] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">{children[0]}</div>
        <div className={cn('min-w-0', ASIDE_H)}>{aside}</div>
      </div>
      {children[1]}
    </div>
  )
}

/** Rótulo ao lado do grupo de botões (Situação, Quartos), na mesma linha deles. */
const LABEL = 'flex min-h-6 shrink-0 items-center gap-0.5 text-[13px] text-muted'

/**
 * Marca a linha da unidade escolhida na tabela (data-selrow e aria-current no link do código), sem
 * redesenhar a tabela. Chamada quando a escolha muda (pela tela) e depois de cada desenho da tabela
 * (ordem ou filtro novos podem ter trazido a linha de volta).
 */
function markPicked(root: Element | null, id: string | null): void {
  if (!root) return
  root.querySelectorAll('[data-selrow]').forEach((el) => {
    if (el.getAttribute('data-unit') === id) return
    el.removeAttribute('data-selrow')
    el.removeAttribute('aria-current')
  })
  if (!id) return
  const el = root.querySelector(`[data-unit="${CSS.escape(id)}"]`)
  el?.setAttribute('data-selrow', '')
  el?.setAttribute('aria-current', 'true')
}

/**
 * A cena carregada. A "key" do componente é o imóvel: trocar de imóvel monta tudo de novo,
 * e giro e filtros voltam ao começo sem código de limpeza.
 */
function SceneView({ scene, selected, onSelect, aside, details }: PropertySceneProps & { scene: MapScene }) {
  const layout = useMemo(() => layoutFor(scene), [scene])
  const units = useMemo(() => new Map(scene.units.map((u) => [u.id, u])), [scene])
  const [rot, setRot] = useState<Rot>(0)
  const [mode, setMode] = useState<ViewMode>('3d')
  const [building, setBuilding] = useState<string | null>(null)
  const [zoomTo, setZoomTo] = useState<string | null>(null)
  const [level, setLevel] = useState<number | null>(null)
  const [bedrooms, setBedrooms] = useState<number[]>([])
  const [status, setStatus] = useState<UnitStatus | null>(null)
  /** Unidade com o mouse (ou o foco) em cima, no desenho ou na tabela: acende nos dois. */
  const [hover, setHover] = useState<string | null>(null)
  /** Pedidos de enquadrar a escolhida (conta; a primeira escolha, vinda do endereço, já enquadra). */
  const [frameSeq, setFrameSeq] = useState(selected ? 1 : 0)
  /** A última escolha feita NO desenho: essa não mexe no zoom. */
  const [mapPick, setMapPick] = useState<string | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const ids = useId()

  // O que a cena tem decide quais filtros aparecem: Bloco só com mais de um bloco; Isolar andar
  // só se algum bloco tem mais de um andar (casa e apartamento avulso não têm o que isolar).
  const manyBlocks = layout.buildings.length > 1
  const hasFloors = layout.buildings.some((b) => b.levels.length > 1)
  const homes = useMemo(() => scene.units.filter((u) => !isSpot(u)), [scene])
  const hasBlocks = homes.some((u) => u.building_id)
  // Andar isolado vale para o bloco em foco (ou o único bloco da cena).
  const isoBuilding = building ?? (manyBlocks ? null : (layout.buildings[0]?.id ?? null))
  const isoBox = layout.buildings.find((b) => b.id === isoBuilding)
  const focusBox = layout.buildings.find((b) => b.id === building)
  const filters: IsoFilters = useMemo(
    () => ({ building, isolate: isoBuilding && level !== null ? { building: isoBuilding, level } : null, bedrooms, status }),
    [building, isoBuilding, level, bedrooms, status],
  )
  const target: MapTarget | null = useMemo(() => (selected && layout.units.has(selected) ? { unitId: selected } : null), [selected, layout])

  // A escolha mudou ("ajustar estado quando a entrada muda", durante o desenho). Passo a passo:
  //   1. se o bloco em foco ou o andar isolado esconderiam a escolhida, solta os dois;
  //   2. escolha que não veio de um clique no desenho pede para enquadrar.
  const [prevSelected, setPrevSelected] = useState(selected)
  if (selected !== prevSelected) {
    setPrevSelected(selected)
    const place = selected ? layout.units.get(selected) : undefined
    if (place) {
      if (building && place.buildingId !== building) {
        setBuilding(null)
        setLevel(null)
        setZoomTo(null)
      } else if (level !== null && (place.buildingId !== isoBuilding || (place.level !== null && place.level > level))) setLevel(null)
      if (selected !== mapPick) setFrameSeq((n) => n + 1)
    }
    setMapPick(null)
  }
  // Esc solta a escolha (menos quando uma janela está aberta: o Esc é dela).
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"]')) return
      onSelect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, onSelect])
  // A linha da unidade com o mouse em cima NO DESENHO acende na tabela. Marca a célula direto
  // no DOM: re-desenhar as 100+ linhas a cada passada de mouse seria o trabalho mais caro da tela.
  useEffect(() => {
    if (!hover) return
    const el = tableRef.current?.querySelector(`[data-unit="${CSS.escape(hover)}"]`)
    el?.setAttribute('data-hl', '')
    return () => el?.removeAttribute('data-hl')
  }, [hover])

  /** Clique numa unidade do desenho: escolhe; na já escolhida, solta. */
  const pickOnMap = (id: string) => {
    if (id === selected) return onSelect(null)
    setMapPick(id)
    onSelect(id)
  }
  // Clique na linha da tabela: o mesmo, mas esta escolha enquadra (ela pode estar longe na tela).
  // Lida pela referência mais nova (a tabela é memo e guarda a função do primeiro desenho).
  const selectedRef = useRef(selected)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  const pickInTable = useCallback((id: string) => onSelectRef.current(id === selectedRef.current ? null : id), [])
  // A escolha mudou: marca a linha dela na tabela (a tabela é memo e não se desenha por isso).
  useEffect(() => markPicked(tableRef.current, selected), [selected])

  // As unidades na ordem do desenho (bloco, andar de cima para baixo, posição): é a ordem da
  // tabela sem ordenação e a do Tab no desenho. Unidade que não coube no desenho (sem andar
  // conhecido) vai para o fim: a tabela, que é o caminho acessível, nunca perde ninguém.
  const ordered = useMemo(() => {
    const drawn = new Set(layout.tabOrder)
    return [...layout.tabOrder.map((id) => units.get(id)!).filter((u) => u && !isSpot(u)), ...homes.filter((u) => !drawn.has(u.id))]
  }, [layout, units, homes])

  // Filtros, passo a passo: lugar (bloco e andar) e quartos dão a base; a contagem de cada
  // situação sai da base, então o número no botão é exatamente o que aparece ao ligá-lo; a
  // situação ligada filtra por último. Guardadas (useMemo): a tabela é memo e só re-desenha
  // quando as linhas mudam de verdade.
  const base = useMemo(
    () =>
      ordered.filter((u) => {
        const place = layout.units.get(u.id)
        if (building && place?.buildingId !== building) return false
        if (level !== null && !(place?.buildingId === isoBuilding && place?.level === level)) return false
        return !bedrooms.length || bedrooms.includes(u.bedrooms)
      }),
    [ordered, layout, building, level, isoBuilding, bedrooms],
  )
  const counts = countByStatus(base)
  const rows = useMemo(() => (status ? base.filter((u) => u.status === status) : base), [base, status])
  const bedroomOptions = [...new Set(homes.map((u) => u.bedrooms).filter((n) => n > 0))].sort((a, b) => a - b)
  const anyFilter = !!building || level !== null || bedrooms.length > 0 || !!status

  const chooseBuilding = (id: string | null, zoom = true) => {
    setBuilding(id)
    setLevel(null)
    if (zoom) setZoomTo(id)
  }
  const clearAll = () => {
    chooseBuilding(null)
    setBedrooms([])
    setStatus(null)
  }

  // Trilha: Imóvel › Bloco › Andar. Subir na trilha solta o que estava abaixo; nome repetido em
  // seguida (o "bloco" do imóvel avulso tem o nome do imóvel) vira um elo só (trailCrumbs).
  const levelLabel = level !== null ? isoBox?.levels.find((l) => l.level === level)?.label : undefined
  const crumbs = trailCrumbs<{ label: string; onClick?: () => void }>([
    { label: scene.title, onClick: building || level !== null ? () => chooseBuilding(null) : undefined },
    ...(focusBox ? [{ label: focusBox.name, onClick: level !== null ? () => setLevel(null) : undefined }] : []),
    ...(levelLabel ? [{ label: levelLabel }] : []),
  ])
  const trail = (
    <nav aria-label="Trilha" className="pointer-events-auto max-w-full overflow-hidden rounded-xl border border-border bg-surface px-1 py-1 shadow-card">
      <ol className="flex min-w-0 flex-wrap items-center gap-0.5 text-xs">
        {crumbs.map((c, i) => (
          <Crumb key={i} first={i === 0} onClick={c.onClick} current={i === crumbs.length - 1}>
            {c.label}
          </Crumb>
        ))}
      </ol>
    </nav>
  )

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Filtros numa linha só (quando cabe): o nome de Bloco e Isolar andar vai dentro da caixa. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Filtros do desenho e da tabela">
        {manyBlocks && (
          <label className="flex min-w-0 items-center">
            <span className="sr-only">Bloco</span>
            <Select className="h-8 w-auto min-w-36" value={building ?? ''} onChange={(e) => chooseBuilding(e.target.value || null)}>
              <option value="">Todos os blocos ({layout.buildings.length})</option>
              {layout.buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        {hasFloors && (
          <div className="flex min-w-0 items-center gap-0.5">
            <label className="flex min-w-0 items-center">
              <span className="sr-only">Isolar andar</span>
              <Select className="h-8 w-auto min-w-40" value={level ?? ''} disabled={!isoBox} onChange={(e) => setLevel(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">{isoBox ? 'Todos os andares' : 'Isolar andar'}</option>
              {isoBox?.levels
                .slice()
                .reverse()
                .map((l) => (
                    <option key={l.level} value={l.level}>
                      {l.label}
                    </option>
                  ))}
              </Select>
            </label>
            <InfoTip label="Como funciona o isolar andar">Os andares de cima do bloco ficam quase transparentes, e a tabela mostra só o andar escolhido. Escolha um bloco antes, se o imóvel tiver mais de um.</InfoTip>
          </div>
        )}
        <div role="group" aria-labelledby={`${ids}-st`} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span id={`${ids}-st`} className={LABEL}>
            Situação
            <InfoTip label="Como funciona o filtro de situação">Clique numa situação para ver só ela, no desenho e na tabela; clique de novo para ver todas. O número é quantas unidades aparecem com os outros filtros ligados (as vagas têm a tabela própria).</InfoTip>
          </span>
          <div className="flex flex-wrap gap-1">
            {STATUS_ORDER.map((st) => (
              <button
                key={st}
                type="button"
                aria-pressed={status === st}
                onClick={() => setStatus(status === st ? null : st)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-[border-color,background-color,color] duration-150 ease-out',
                  status === st ? 'border-text bg-surface-2' : 'border-border bg-surface hover:border-border-strong',
                  status && status !== st && 'text-muted',
                )}
              >
                <span className="size-2.5 rounded-full" style={{ background: UNIT_STATUS_VAR[st] }} aria-hidden="true" />
                {UNIT_STATUS[st]}
                <span className="num text-muted">{counts[st]}</span>
              </button>
            ))}
          </div>
        </div>
        {bedroomOptions.length > 0 && (
          <div role="group" aria-labelledby={`${ids}-q`} className="flex min-w-0 items-center gap-1.5">
            <span id={`${ids}-q`} className={LABEL}>
              Quartos
            </span>
            <div className="flex flex-wrap gap-1">
              {bedroomOptions.map((n) => {
                const on = bedrooms.includes(n)
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={on}
                    aria-label={plural(n, 'quarto', 'quartos')}
                    onClick={() => setBedrooms(on ? bedrooms.filter((x) => x !== n) : [...bedrooms, n].sort((a, b) => a - b))}
                    className={cn('num inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-medium transition-[border-color,background-color,color] duration-150 ease-out', on ? 'border-primary bg-primary text-on-primary' : 'border-border bg-surface hover:border-border-strong')}
                  >
                    {n}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {anyFilter && (
          <Button size="sm" className="animate-fade-in" icon={<X className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={clearAll}>
            Limpar filtros
          </Button>
        )}
      </div>

      <Workspace aside={aside}>
        {/* O desenho. scroll-mt: ao rolar até ele, o cabeçalho fixo não cobre a trilha. */}
        <div data-iso-card className="scroll-mt-24">
          <Card className={cn(CANVAS_H, 'iso-board overflow-hidden')}>
            <IsoCanvas
              sceneKey={scene.key}
              title={scene.title}
              layout={layout}
              units={units}
              rot={rot}
              mode={mode}
              filters={filters}
              highlighted={hover}
              zoomTo={zoomTo}
              target={target}
              targetSeq={frameSeq}
              onPickUnit={pickOnMap}
              onHoverUnit={setHover}
              onSelectBuilding={(id) => chooseBuilding(id)}
              onViewChange={(r, m) => {
                setRot(r)
                setMode(m)
              }}
              trail={trail}
            />
          </Card>
        </div>
        {details(
          <div ref={tableRef}>
            <UnitTable propertyId={scene.property_id} title={scene.title} rows={rows} total={homes.length} hasBlocks={hasBlocks} selectedRef={selectedRef} onHover={setHover} onPick={pickInTable} />
          </div>,
        )}
      </Workspace>
    </div>
  )
}

function Crumb({ children, onClick, current, first }: { children: ReactNode; onClick?: () => void; current?: boolean; first?: boolean }) {
  return (
    <li className="flex min-w-0 items-center gap-0.5">
      {!first && <ChevronRight className="size-3.5 shrink-0 text-muted" aria-hidden="true" />}
      {onClick ? (
        <button type="button" className="max-w-[16rem] truncate rounded-lg px-2 py-1 font-medium text-primary hover:bg-surface-2" onClick={onClick}>
          {children}
        </button>
      ) : (
        <span className="max-w-[16rem] truncate px-2 py-1 font-medium" aria-current={current ? 'location' : undefined}>
          {children}
        </span>
      )}
    </li>
  )
}

/* ---------------------------------------------------------------- a tabela das unidades (aba Unidades) */

type SortKey = 'code' | 'place' | 'status' | 'bedrooms' | 'area' | 'owners' | 'lessee' | 'rent' | 'end'
/** Valor de cada coluna para ordenar; null = vazio (vai sempre para o fim, nos dois sentidos). */
const SORTS: Record<SortKey, (u: UnitRow) => string | number | null> = {
  code: (u) => u.code,
  place: (u) => `${u.building_name ?? ''} ${String(100 + (u.floor_level ?? 0)).padStart(4, '0')}`,
  status: (u) => UNIT_STATUS[u.status],
  bedrooms: (u) => u.bedrooms,
  area: (u) => u.area_m2,
  owners: (u) => u.owners_label || null,
  lessee: (u) => u.lease?.lessee_name || null,
  rent: (u) => u.lease?.rent_cents ?? u.asking_rent_cents,
  end: (u) => u.lease?.end_date ?? null,
}

/** "Bloco A · 3º andar": o que o código sozinho não diz. */
const placeOf = (u: UnitRow) => [u.building_name, u.floor_label].filter(Boolean).join(' · ')

/** Unidade da linha em que o evento aconteceu (a célula do código leva data-unit). */
const rowUnit = (e: SyntheticEvent) => (e.target as Element).closest('tr')?.querySelector('[data-unit]')?.getAttribute('data-unit') ?? null

/**
 * Clique "simples" num link (botão esquerdo, sem Ctrl, Shift, Alt ou Cmd): vira escolha na mesma
 * tela. Com tecla de atalho, o navegador faz o de sempre (abrir em outra aba), por isso o link existe.
 */
export function plainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey
}

/**
 * Tabela das unidades que passam nos filtros de cima, com a ordenação da casa (1º clique,
 * 2º inverte, 3º volta à ordem do desenho). Uma unidade por linha; clicar na linha ESCOLHE a
 * unidade (a mesma escolha do clique no desenho). O código é um link para a mesma ficha com a
 * unidade escolhida (?unidade=): o teclado chega nele e Ctrl+clique abre noutra aba.
 * Sem paginação de propósito: é a mesma lista do desenho (o maior imóvel tem poucas centenas
 * de unidades) e a moldura da tabela rola por dentro.
 * memo: o mouse no desenho NÃO re-desenha a tabela (a linha acende pelo DOM, na tela de cima), e a
 * escolha também não: a linha escolhida é marcada por markPicked (pela tela e depois de cada desenho daqui).
 */
const UnitTable = memo(function UnitTable({ propertyId, title, rows, total, hasBlocks, selectedRef, onHover, onPick }: { propertyId: string; title: string; rows: UnitRow[]; total: number; hasBlocks: boolean; selectedRef: RefObject<string | null>; onHover: (id: string | null) => void; onPick: (id: string) => void }) {
  const s = useSession()
  const rootRef = useRef<HTMLDivElement>(null)
  // Depois de cada desenho (ordem nova, filtro novo): a linha escolhida pode ter voltado à tabela.
  useEffect(() => markPicked(rootRef.current, selectedRef.current))
  const linkPeople = can(s, 'people:view')
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null)
  const toggle = (key: string, firstDir: SortDir) =>
    setSort(!sort || sort.key !== key ? { key, dir: firstDir } : sort.dir === firstDir ? { key, dir: firstDir === 'asc' ? 'desc' : 'asc' } : null)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const fn = SORTS[sort.key as SortKey]
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = fn(a)
      const vb = fn(b)
      if (va === null) return vb === null ? 0 : 1
      if (vb === null) return -1
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true })) * dir
    })
  }, [rows, sort])

  // O clique num link de dentro da linha não pode disparar também o clique da linha.
  const stop = (e: SyntheticEvent) => e.stopPropagation()
  const columns: Column<UnitRow>[] = [
    {
      key: 'code', header: 'Unidade', sortable: true, firstDir: 'asc',
      cell: (u) => (
        <span className="flex min-w-0 flex-col">
          {/* data-unit: a tabela acha a unidade da linha; data-hl (posto pela tela): a linha acende quando o mouse está nela NO DESENHO. */}
          <Link
            to="/imoveis/$propertyId"
            params={{ propertyId }}
            search={{ unidade: u.id }}
            replace
            resetScroll={false}
            className="w-fit font-medium hover:underline"
            data-unit={u.id}
            onClick={(e) => {
              stop(e)
              if (!plainClick(e)) return
              e.preventDefault()
              onPick(u.id)
            }}
          >
            {u.code}
          </Link>
          {/* No celular a coluna "Bloco e andar" some: o lugar vem embaixo do código. */}
          {hasBlocks && placeOf(u) && <span className="text-xs text-muted md:hidden">{placeOf(u)}</span>}
        </span>
      ),
    },
    ...(hasBlocks ? [{ key: 'place', header: 'Bloco e andar', sortable: true, firstDir: 'asc', hideBelow: 'md', cell: placeOf } satisfies Column<UnitRow>] : []),
    { key: 'status', header: 'Situação', sortable: true, firstDir: 'asc', cell: (u) => <UnitStatusBadge status={u.status} /> },
    { key: 'bedrooms', header: 'Quartos', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'sm', cell: (u) => u.bedrooms },
    { key: 'area', header: 'Área', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'lg', cell: (u) => `${u.area_m2.toLocaleString('pt-BR')} m²` },
    { key: 'owners', header: 'Dono', sortable: true, firstDir: 'asc', hideBelow: 'lg', className: 'max-w-48', cell: (u) => (u.owners_label ? <span className="line-clamp-2">{u.owners_label}</span> : <span className="text-muted">Sem dono</span>) },
    {
      key: 'lessee', header: 'Locatário', sortable: true, firstDir: 'asc', hideBelow: 'md', className: 'max-w-56',
      cell: (u) =>
        !u.lease ? (
          <span className="text-muted">Sem locação</span>
        ) : u.lease.lessee_id && linkPeople ? (
          <Link to="/pessoas/$personId" params={{ personId: u.lease.lessee_id }} className="line-clamp-2 hover:underline" onClick={stop}>
            {u.lease.lessee_name}
          </Link>
        ) : (
          <span className="line-clamp-2">{u.lease.lessee_name}</span>
        ),
    },
    {
      key: 'rent', header: 'Aluguel', sortable: true, firstDir: 'desc', align: 'right',
      cell: (u) =>
        u.lease ? (
          formatBRL(u.lease.rent_cents)
        ) : u.asking_rent_cents ? (
          <span className="flex flex-col items-end text-muted" title="Valor pedido no anúncio (sem contrato vigente)">
            <span className="whitespace-nowrap">{formatBRL(u.asking_rent_cents)}</span>
            <span className="font-sans text-[11px]">pedido</span>
          </span>
        ) : null,
    },
    { key: 'end', header: 'Fim do contrato', sortable: true, firstDir: 'desc', align: 'right', hideBelow: 'md', cell: (u) => formatDate(u.lease?.end_date) },
  ]

  // O que está na tela (filtros e ordem), em planilha ou CSV: a mesma porta das outras listas (lib/exportar).
  const exportUnits = (format: ExportFormat) => {
    const slug = normalize(title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    return downloadTable(
      `unidades-${slug || 'imovel'}`,
      sorted,
      [
        { label: 'Unidade', value: (u) => u.code },
        { label: 'Bloco', value: (u) => u.building_name },
        { label: 'Andar', value: (u) => u.floor_label },
        { label: 'Situação', value: (u) => UNIT_STATUS[u.status] },
        { label: 'Quartos', value: (u) => u.bedrooms },
        { label: 'Área (m²)', value: (u) => u.area_m2.toLocaleString('pt-BR') },
        { label: 'Dono', value: (u) => u.owners_label },
        { label: 'Locatário', value: (u) => u.lease?.lessee_name },
        { label: 'Aluguel (R$)', value: (u) => csvMoney(u.lease?.rent_cents) },
        { label: 'Aluguel pedido (R$)', value: (u) => (u.lease ? '' : csvMoney(u.asking_rent_cents)) },
        { label: 'Fim do contrato', value: (u) => formatDate(u.lease?.end_date) },
      ],
      format,
      'Unidades',
    )
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" aria-live="polite">
          <span className="num">{rows.length.toLocaleString('pt-BR')}</span> de <span className="num">{total.toLocaleString('pt-BR')}</span> {total === 1 ? 'unidade' : 'unidades'}
          {rows.length < total ? ' com os filtros acima' : ''}
        </p>
        <ExportMenu size="sm" total={rows.length} disabled={!rows.length} onExport={exportUnits} />
      </div>
      {/* Mouse ou foco do teclado numa linha acende a unidade no desenho (o anel da unidade). */}
      <div className="iso-table" onPointerOver={(e) => onHover(rowUnit(e))} onPointerLeave={() => onHover(null)} onFocus={(e) => onHover(rowUnit(e))} onBlur={() => onHover(null)}>
        <DataTable
          caption={`Unidades de ${title}`}
          columns={columns}
          rows={sorted}
          rowKey={(u) => u.id}
          sort={sort}
          onSort={toggle}
          onRowClick={(u) => onPick(u.id)}
          empty={<EmptyState title="Nenhuma unidade com estes filtros" description="Desligue um filtro ou clique em Limpar filtros para ver todas." />}
        />
      </div>
    </div>
  )
})
