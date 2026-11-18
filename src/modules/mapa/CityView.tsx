/* =============================================================================
   Mapa da cidade: um pino por imóvel do resultado. Usado na página Imóveis (o foco da tela, com
   a ficha curta à direita, a barra de busca e filtros em cima e a tabela com os dados das MESMAS
   coisas embaixo) e na Visão geral (com o painel de alertas ou a ficha curta ao lado). Este arquivo só DESENHA: quem decide quais pinos aparecem é a
   página, com a mesma busca e os mesmos filtros da tabela (listMapPins, no repo.ts).

   Como se usa (06/11, segunda rodada; balão revisto em 07/11): passar o mouse no pino só ACENDE
   o pino (contorno), sem balão. CLICAR ESCOLHE o imóvel (onSelect): o pino fica marcado, quem usa o
   mapa mostra o básico dele num painel ao lado, e abre o balão com o nome e os números. O balão
   segue a regra do 3D (balao.ts): fica enquanto o mouse está nele ou no pino, some 2 s depois que
   sai dos dois; Esc ou clique no mapa vazio fecham; a escolha continua. Pino de GRUPO continua
   aproximando no clique, sem balão. Mudar de página é sempre um botão explícito ("Abrir imóvel"),
   nunca o clique no pino (pedido do Fernando: "não quero mudança direto de aba/página por
   interações simples"). Escolher por fora (linha da tabela) também marca o pino e traz ele para a
   vista (e fecha o balão de outro imóvel). Passar o mouse numa linha da tabela acende o pino do
   imóvel (hoverId).
   O número do pino é escolhido embaixo do mapa (Unidades ou Ocupação). Com a tabela de
   unidades aberta, "Unidades" conta só as unidades daquele imóvel que estão na tabela.

   Peças:
   - Leaflet (biblioteca de mapa) desenha o fundo com azulejos (imagens 256 x 256 que formam
     o mapa). Os azulejos vêm da Esri (mapa de ruas com nomes, bairros e parques; versão
     cinza-escura no tema escuro). Ver a nota em TILES sobre o que já foi tentado.
   - Pinos que ficariam um em cima do outro viram um pino de GRUPO (cluster.ts) com quantos
     imóveis estão ali; clicar aproxima o mapa até eles se separarem. Os grupos são refeitos
     a cada zoom.
   - Se nenhum azulejo carregar em 6 segundos (ou vierem 4 erros antes do primeiro), o mapa
     cai num FUNDO NEUTRO em SVG, com os pinos na posição relativa e o aviso. Para testar sem
     depender da rede: no console, localStorage.setItem('imobil:mapa:sem-azulejos', 'true').

   Rapidez e movimento (07/11/2026, "tá muito travado"):
   - o "mouse em cima" chega por um canal (hover.ts) e não pelo estado da página: passar o mouse
     nas linhas da tabela redesenha só este mapa, não a página inteira;
   - os pinos só são refeitos quando muda o RESULTADO (a lista de pinos), o número do pino ou o
     zoom; quem usa o mapa passa a mesma lista enquanto o resultado não muda (useMemo na página);
   - escolher pela tabela (ou por outro lugar fora do mapa) leva o mapa até o pino com movimento
     curto (300 ms); escolher clicando no pino não mexe no mapa, porque a pessoa já está olhando
     para ele (a mesma regra do 3D). Imóvel dentro de um pino de grupo: o mapa aproxima até ele.
   ============================================================================= */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { CloudOff, X } from 'lucide-react'
import { readJSON, writeJSON } from '@/lib/storage'
import { plural } from '@/lib/text'
import { InfoTip } from '@/components/ui/InfoTip'
import { Card } from '@/components/ui/Layout'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { useBalloon } from './balao'
import { groupNearby } from './cluster'
import { useHovered, type HoverChannel } from './hover'
import { MAP_H } from './MapPage'
import type { MapPin } from './repo'

type Badge = 'unidades' | 'ocupacao'

/**
 * Fundo do mapa: camadas de azulejos por tema (a segunda, quando existe, são só os nomes por cima).
 * O que já foi tentado, porque os dois falharam do mesmo jeito enganoso (06/11):
 *   - servidor do OpenStreetMap: mantido por voluntários, barra quem pede muito ou sem origem;
 *   - CARTO: passou a exigir chave.
 * Os dois devolvem uma IMAGEM escrita "Access blocked" ou "API KEY REQUIRED", com resposta de
 * sucesso, então o aviso de "mapa indisponível" (que só olha erro) nunca disparava.
 * A Esri respondeu normal e aceita pedido vindo de qualquer página (inclusive do Imobil.html
 * aberto do disco). O crédito é o texto oficial do próprio serviço.
 * Google Maps dentro do app só pela API oficial, com chave e faturamento do Google Cloud:
 * puxar a imagem direto do servidor do Google fora da API é proibido pelos termos dele.
 */
// atalho: azulejos da Esri sem chave servem para a demonstração; antes de vender o produto, usar provedor com chave e contrato (Google Maps Platform, Esri, MapTiler ou Stadia), item 17 do plano.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const TILES: Record<'light' | 'dark', string[]> = {
  light: [`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`],
  dark: [`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
}
const ATTRIBUTION = 'Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, METI, NGCC, &copy; colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> e comunidade GIS'
const NO_TILES_KEY = 'imobil:mapa:sem-azulejos'
const BADGE_KEY = 'imobil:mapa:selo'
/** Até este zoom, clicar no grupo aproxima; daqui para cima os imóveis estão no mesmo ponto e o clique abre a lista deles. */
const GROUP_MAX_ZOOM = 18

/** Faixa de ocupação que dá a cor do pino (a mesma legenda embaixo do mapa). */
export function occupancyBand(pct: number): 'alta' | 'media' | 'baixa' {
  return pct >= 90 ? 'alta' : pct >= 60 ? 'media' : 'baixa'
}
/** Ocupação de um grupo: ocupadas ÷ alugáveis somadas (a mesma conta do imóvel, sem média de porcentagens). */
function groupOccupancy(pins: MapPin[]): number {
  const occupied = pins.reduce((a, r) => a + r.units_occupied, 0)
  const rentable = pins.reduce((a, r) => a + r.units_rentable, 0)
  return rentable ? (occupied / rentable) * 100 : 0
}
/** "3 unidades" ou, nos pinos de vagas de garagem, "3 vagas" (o pino diz o que conta). */
const unitsText = (n: number, r?: MapPin) => plural(n, ...(r?.noun ?? (['unidade', 'unidades'] as [string, string])))
/** Vaga de garagem não "ocupa": é alugada. */
const occWord = (r: MapPin) => (r.noun ? 'alugado' : 'ocupado')
/** O número que o pino conta: as unidades da tabela de unidades (quando é ela que está aberta) ou todas as do imóvel. */
const unitsOf = (r: MapPin) => r.matched ?? r.units_total
const badgeText = (r: MapPin, b: Badge) => (b === 'unidades' ? String(unitsOf(r)) : `${Math.round(r.occupancy_pct)}%`)
/** Os números do imóvel em uma linha: "3 de 64 unidades na lista · 86% ocupado" (ou "64 unidades · 86% ocupado"). */
function pinNumbers(r: MapPin): string {
  const units = r.matched !== null && r.matched !== r.units_total ? `${r.matched} de ${unitsText(r.units_total, r)} na lista` : unitsText(r.units_total, r)
  return `${units} · ${Math.round(r.occupancy_pct)}% ${occWord(r)}`
}
const pinLabel = (r: MapPin) => `${r.name}: ${pinNumbers(r).replace(' · ', ', ')}. Escolher o imóvel`
function groupLabel(pins: MapPin[], action: string): string {
  const names = pins.slice(0, 3).map((r) => r.name)
  const rest = pins.length - names.length
  return `${pins.length} imóveis próximos: ${names.join(', ')}${rest ? ` e mais ${rest}` : ''}. ${action}`
}
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const darkTheme = () => document.documentElement.dataset.theme === 'dark'

interface Props {
  /** Pinos do resultado da busca e dos filtros; undefined = ainda carregando. */
  pins: MapPin[] | undefined
  error?: unknown
  onRetry?: () => void
  /** Clicar no pino de um imóvel (ou no nome dele na lista de um grupo): ESCOLHER o imóvel (não navega). */
  onSelect: (propertyId: string) => void
  /** Imóvel escolhido: o pino dele fica marcado e, se estiver fora da vista, o mapa anda até ele. */
  selectedId?: string | null
  /** Canal do "mouse em cima" (linha da tabela ou pino): o mapa lê e escreve nele (hover.ts). */
  hover: HoverChannel
  /** Altura do quadro do mapa, quando a tela que usa precisa de outra. Padrão: MAP_H (MapPage). */
  mapClassName?: string
}

export function CityView({ pins, error, onRetry, onSelect, selectedId = null, hover, mapClassName = MAP_H }: Props) {
  const [badge, setBadge] = useState<Badge>(() => readJSON<Badge>(BADGE_KEY) ?? 'unidades')
  const [noTiles, setNoTiles] = useState<boolean>(() => readJSON<boolean>(NO_TILES_KEY) === true)
  const chooseBadge = (b: Badge) => {
    setBadge(b)
    writeJSON(BADGE_KEY, b)
  }
  const mapProps: MapProps = { pins: pins ?? [], hover, selectedId, badge, onSelect }

  return (
    <section className="flex flex-col gap-2" aria-label="Mapa dos imóveis">
      {/* O teto da altura evita o mapa gigante quando a janela é muito alta (como na foto da página inteira).
          isolate: as camadas do Leaflet (z 400 a 1000) ficam presas dentro do cartão; sem isso, ao rolar a
          página, os azulejos passavam por cima da barra do topo, que é grudada (z 30 e 40). */}
      <Card className={cn('relative isolate overflow-hidden', mapClassName)}>
        {error ? (
          <div className="grid h-full place-items-center p-4">
            <ErrorState error={error} onRetry={onRetry} />
          </div>
        ) : !pins ? (
          <Skeleton className="h-full rounded-none" />
        ) : noTiles ? (
          <FallbackMap {...mapProps} />
        ) : (
          <GeoMap {...mapProps} onFail={() => setNoTiles(true)} />
        )}
        {pins && pins.length === 0 && !error && (
          // Por cima dos azulejos (o Leaflet põe as camadas em z 400) e no meio do quadro, longe dos outros avisos.
          <p role="status" className="pointer-events-none absolute top-1/2 left-1/2 z-[500] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-center text-sm text-muted shadow-card">
            Nenhum imóvel com a busca e os filtros ligados.
          </p>
        )}
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <PinLegend />
        <BadgeToggle badge={badge} onChange={chooseBadge} />
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- embaixo do mapa: legenda e número do pino */

function PinLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <span className="flex items-center gap-1">
        Cor do pino: ocupação
        <InfoTip>Ocupação = unidades ocupadas ÷ unidades alugáveis (bloqueada não conta). A mesma conta da tabela de imóveis.</InfoTip>
      </span>
      {(['alta', 'media', 'baixa'] as const).map((b) => (
        <span key={b} className="flex items-center gap-1.5">
          <span className={cn('size-3 rounded-full', `mapa-dot-${b}`)} aria-hidden="true" />
          {b === 'alta' ? '90% ou mais' : b === 'media' ? '60% a 89%' : 'abaixo de 60%'}
        </span>
      ))}
      <span>· contorno duplo: imóveis próximos</span>
    </p>
  )
}

/** Unidades ou Ocupação no pino. A escolha fica lembrada no navegador. */
function BadgeToggle({ badge, onChange }: { badge: Badge; onChange: (b: Badge) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span id="mapa-numero">Número no pino</span>
      <div className="inline-flex h-8 items-center rounded-lg border border-border bg-surface p-0.5" role="group" aria-labelledby="mapa-numero">
        {(['unidades', 'ocupacao'] as Badge[]).map((b) => (
          <button key={b} type="button" aria-pressed={badge === b} onClick={() => onChange(b)} className={cn('h-7 rounded-md px-2.5 transition-colors duration-150 ease-out', badge === b ? 'bg-surface-2 font-medium text-text' : 'hover:text-text')}>
            {b === 'unidades' ? 'Unidades' : 'Ocupação'}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Lista de um grupo que não se separa nem de perto (imóveis no mesmo endereço): cada nome escolhe o imóvel. */
function GroupList({ pins, onSelect }: { pins: MapPin[]; onSelect: (propertyId: string) => void }) {
  return (
    <div className="flex flex-col gap-1 text-text">
      <p className="px-1 text-xs text-muted">{pins.length} imóveis neste ponto</p>
      {pins.map((r) => (
        <button key={r.id} type="button" onClick={() => onSelect(r.id)} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2">
          <span className="min-w-0 truncate font-medium">{r.name}</span>
          <span className="num shrink-0 text-xs text-muted">{unitsOf(r)}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- mapa com azulejos (Leaflet) */

interface MapProps {
  pins: MapPin[]
  hover: HoverChannel
  selectedId: string | null
  badge: Badge
  onSelect: (propertyId: string) => void
}

/** Conteúdo do balão, montado com textContent: nome de imóvel é dado digitado, e HTML montado com ele abriria brecha. */
function tooltipEl(title: string, lines: string[]): HTMLElement {
  const el = document.createElement('div')
  const strong = document.createElement('strong')
  strong.textContent = title
  el.append(strong)
  for (const line of lines) {
    const p = document.createElement('div')
    p.textContent = line
    el.append(p)
  }
  return el
}

/**
 * Lado do balão em volta do pino, para não cobrir o pino nem sair do quadro do mapa: em cima (o de
 * sempre); embaixo, se em cima não cabe; à direita ou à esquerda, se centrado ele passaria da borda.
 * O Leaflet não faz essa conta sozinho (só escolhe entre direita e esquerda).
 */
function placeTip(map: L.Map, tip: L.Tooltip, latlng: L.LatLngTuple) {
  const el = tip.getElement()
  if (!el) return
  const p = map.latLngToContainerPoint(latlng)
  const box = map.getSize()
  const w = el.offsetWidth
  const h = el.offsetHeight
  const centered = p.x - w / 2 >= 8 && p.x + w / 2 <= box.x - 8
  const dir: L.Direction = centered ? (p.y - 18 - h >= 8 ? 'top' : 'bottom') : p.x < box.x / 2 ? 'right' : 'left'
  if (tip.options.direction === dir) return
  // Afasta do meio do pino: meia altura (16 px) em cima e embaixo, meia largura (22 px) dos lados, mais um respiro.
  const off: Record<string, [number, number]> = { top: [0, -18], bottom: [0, 18], right: [26, 0], left: [-26, 0] }
  tip.options.direction = dir
  tip.options.offset = L.point(off[dir])
  tip.update()
}

function GeoMap({ pins, hover, selectedId, badge, onSelect, onFail }: MapProps & { onFail: () => void }) {
  const hoverId = useHovered(hover)
  const divRef = useRef<HTMLDivElement>(null)
  /** O último imóvel escolhido CLICANDO no mapa (pino ou lista do grupo): esse não move o mapa. */
  const pickedOnMap = useRef<string | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const popupRef = useRef<L.Popup | null>(null)
  /** id do imóvel → pino em que ele aparece (vários imóveis de um grupo apontam para o mesmo pino). */
  const markers = useRef(new Map<string, L.Marker>())
  const cb = useRef({ onSelect, onFail })
  const [groupEl] = useState(() => document.createElement('div'))
  const [openGroup, setOpenGroup] = useState<MapPin[] | null>(null)
  const [zoomTick, setZoomTick] = useState(0) // muda a cada zoom: os grupos são refeitos
  const placed = useMemo(() => pins.filter((r) => r.lat !== null && r.lng !== null), [pins])
  const idsKey = placed.map((r) => r.id).join(',')
  /** O balão do clique (balao.ts): o alvo é o id do imóvel. */
  const { state: tipState, fading: tipFading, open: openTip, part: tipPart, close: closeTip } = useBalloon<string>()
  /** O balão aberto agora, para os ouvintes do Leaflet (criados uma vez por leva de pinos) saberem de qual imóvel ele é. */
  const openId = useRef<string | null>(null)
  /** O balão no mapa (um "tooltip" do Leaflet solto, preso à posição do imóvel, não ao pino: sobrevive ao refazer dos pinos). */
  const tipRef = useRef<{ id: string; tip: L.Tooltip } | null>(null)

  // As funções de quem chama mudam a cada desenho; o Leaflet guarda a da 1ª vez. A ref leva sempre a atual.
  useEffect(() => {
    cb.current = { onSelect, onFail }
    openId.current = tipState?.target ?? null
  })

  // A escolha mudou por fora (linha da tabela, endereço): o balão de outro imóvel fecha.
  const [prevSel, setPrevSel] = useState(selectedId)
  if (prevSel !== selectedId) {
    setPrevSel(selectedId)
    if (tipState && tipState.target !== selectedId) closeTip()
  }

  // 1. Monta o mapa uma vez (e desmonta ao sair: no modo estrito do React isso roda duas vezes, e tudo bem).
  useEffect(() => {
    const div = divRef.current
    if (!div) return
    const calm = reducedMotion()
    const pinsById = markers.current // a mesma lista que a limpeza vai esvaziar
    const map = L.map(div, { zoomControl: false, zoomAnimation: !calm, fadeAnimation: !calm, markerZoomAnimation: !calm, attributionControl: true })
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(map)
    map.setView([-19.92, -43.94], 12)
    // Falha dos azulejos: nenhum carregou em 6 s, ou 4 erros antes do primeiro.
    let loaded = 0
    let failed = 0
    TILES[darkTheme() ? 'dark' : 'light'].forEach((url, i) => {
      // Só a primeira camada (o fundo) conta para a falha e leva o crédito; a de nomes vai por cima.
      const layer = L.tileLayer(url, { maxZoom: 19, attribution: i === 0 ? ATTRIBUTION : undefined })
      if (i === 0) {
        layer.on('tileload', () => loaded++)
        layer.on('tileerror', () => {
          failed++
          if (failed >= 4 && loaded === 0) cb.current.onFail()
        })
      }
      layer.addTo(map)
    })
    const timer = setTimeout(() => loaded === 0 && cb.current.onFail(), 6000)
    layerRef.current = L.layerGroup().addTo(map)
    const popup = L.popup({ maxWidth: 300, minWidth: 240, autoPan: !calm, autoPanPadding: [24, 24], className: 'mapa-popup' }).setContent(groupEl)
    popupRef.current = popup
    map.on('popupclose', () => setOpenGroup(null))
    map.on('zoomend', () => setZoomTick((n) => n + 1))
    // Clique no mapa vazio fecha o balão (o clique DENTRO do balão também chega aqui: esse não fecha).
    map.on('click', (e: L.LeafletMouseEvent) => {
      const el = tipRef.current?.tip.getElement()
      const t = e.originalEvent?.target
      if (el && t instanceof Node && el.contains(t)) return
      closeTip()
    })
    mapRef.current = map
    const tips = tipRef
    return () => {
      clearTimeout(timer)
      map.remove()
      mapRef.current = null
      layerRef.current = null
      tips.current = null
      pinsById.clear()
    }
  }, [groupEl, closeTip])

  // 2. Pinos: refeitos quando muda o resultado (busca, filtro, categoria), o número do pino ou o zoom.
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    markers.current.clear()
    // Os pinos velhos saíram sem avisar "mouse saiu": o balão passa a contar os 2 s (o pino novo,
    // com o mouse em cima, segura de novo assim que o mouse mexer).
    tipPart('anchor', false)
    // Passo 1: a posição de cada imóvel em pixels no zoom de agora, e os grupos dos que ficariam empilhados.
    const groups = groupNearby(placed, (r) => map.latLngToLayerPoint([r.lat!, r.lng!]), (r) => r.units_total)
    for (const g of groups) {
      const lead = g.items[0]
      const many = g.items.length > 1
      // Passo 2: o pino. Sozinho: o número escolhido embaixo do mapa. Grupo: quantos imóveis, com contorno duplo.
      const band = occupancyBand(many ? groupOccupancy(g.items) : lead.occupancy_pct)
      const html = `<span class="mapa-pin" data-occ="${band}"${many ? ' data-grupo' : ''}>${many ? g.items.length : badgeText(lead, badge)}</span>`
      const m = L.marker([lead.lat!, lead.lng!], { icon: L.divIcon({ className: 'mapa-pin-wrap', html, iconSize: [44, 32], iconAnchor: [22, 16] }), keyboard: true, riseOnHover: true })
      // Passo 3: o clique. Sozinho: escolhe o imóvel (não navega) e abre o balão nele (Enter no pino
      // com foco também chega como clique: aí é o foco que segura o balão). Grupo: aproxima até
      // separar; no mesmo ponto, lista os imóveis. Grupo não abre balão.
      m.on('click', (e: L.LeafletMouseEvent) => {
        if (!many) {
          pickedOnMap.current = lead.id
          cb.current.onSelect(lead.id)
          return openTip(lead.id, e.originalEvent instanceof KeyboardEvent ? { focus: true } : { anchor: true })
        }
        const bounds = L.latLngBounds(g.items.map((r) => [r.lat!, r.lng!] as [number, number]))
        if (map.getZoom() < GROUP_MAX_ZOOM) {
          map.fitBounds(bounds, { padding: [80, 80], maxZoom: GROUP_MAX_ZOOM, animate: !reducedMotion() })
          return
        }
        setOpenGroup(g.items)
        popupRef.current?.setLatLng(m.getLatLng()).openOn(map)
      })
      // Mouse em cima: SÓ acende. O pino sozinho acende pelo canal (a linha da tabela acende junto);
      // o de grupo, direto no DOM (não há uma linha só para acender). No pino do balão, segura ele aberto.
      const pinEl = () => m.getElement()?.querySelector('.mapa-pin')
      m.on('mouseover', () => {
        hover.set(many ? null : lead.id)
        if (many) pinEl()?.setAttribute('data-hover-grupo', '')
        else tipPart('anchor', openId.current === lead.id)
      })
      m.on('mouseout', () => {
        hover.set(null)
        pinEl()?.removeAttribute('data-hover-grupo')
        tipPart('anchor', false)
      })
      m.addTo(layer)
      const el = m.getElement()
      el?.setAttribute('role', 'button')
      el?.setAttribute('aria-label', many ? groupLabel(g.items, 'Aproximar o mapa') : pinLabel(lead))
      if (!many) {
        el?.addEventListener('focus', () => tipPart('focus', openId.current === lead.id))
        el?.addEventListener('blur', () => tipPart('focus', false))
      }
      for (const r of g.items) markers.current.set(r.id, m)
    }
  }, [placed, badge, zoomTick, hover, openTip, tipPart])

  // 2b. O balão no mapa. Passo a passo:
  //     a. o balão aberto é de outro imóvel (ou fechou): tira o velho;
  //     b. abriu: cria o balão solto na posição do imóvel, com o nome e os números, ouve o mouse
  //        nele (segura aberto) e escolhe o lado (placeTip);
  //     c. já aberto: atualiza os números (o filtro pode ter mudado) e o esmaecer; imóvel que
  //        saiu do resultado fecha o balão.
  useEffect(() => {
    const map = mapRef.current
    const id = tipState?.target ?? null
    if (tipRef.current && tipRef.current.id !== id) {
      tipRef.current.tip.remove()
      tipRef.current = null
    }
    if (!map || !id) return
    const r = placed.find((x) => x.id === id)
    if (!r) return closeTip()
    const content = tooltipEl(r.name, [pinNumbers(r)])
    if (!tipRef.current) {
      const latlng: L.LatLngTuple = [r.lat!, r.lng!]
      // permanent: o balão do Leaflet comum fecha sozinho em qualquer clique; quem fecha este é a regra do balão.
      const tip = L.tooltip({ permanent: true, interactive: true, direction: 'top', offset: [0, -18], opacity: 1, className: 'mapa-dica' }).setLatLng(latlng).setContent(content)
      tip.openOn(map)
      const el = tip.getElement()
      el?.setAttribute('role', 'status')
      el?.addEventListener('pointerenter', () => tipPart('balloon', true))
      el?.addEventListener('pointerleave', () => tipPart('balloon', false))
      placeTip(map, tip, latlng)
      tipRef.current = { id, tip }
    } else tipRef.current.tip.setContent(content)
    tipRef.current.tip.getElement()?.toggleAttribute('data-saindo', tipFading)
  }, [tipState, tipFading, placed, tipPart, closeTip])

  // Esc fecha o balão (só ele: a escolha fica). Na captura, antes de outro Esc da página.
  const tipOpen = !!tipState
  useEffect(() => {
    if (!tipOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      closeTip()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tipOpen, closeTip])

  // 3. Enquadra todos os pinos quando muda QUAIS imóveis aparecem.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !idsKey) return
    const pts = placed.map((r) => [r.lat!, r.lng!] as [number, number])
    map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 15, animate: !reducedMotion() })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- de propósito: só a lista de ids (o mesmo imóvel com outro número não reenquadra)
  }, [idsKey])

  // 4. Mouse numa linha da tabela (ou num pino): acende o pino em que o imóvel está (o dele ou o do grupo).
  //    O escolhido fica marcado (data-sel) e por cima dos outros; o acendido do mouse, por cima de tudo.
  useEffect(() => {
    const lit = hoverId ? markers.current.get(hoverId) : undefined
    const sel = selectedId ? markers.current.get(selectedId) : undefined
    for (const m of new Set(markers.current.values())) {
      const pin = m.getElement()?.querySelector('.mapa-pin')
      pin?.toggleAttribute('data-hover', m === lit)
      pin?.toggleAttribute('data-sel', m === sel)
      m.setZIndexOffset(m === lit ? 1000 : m === sel ? 500 : 0)
    }
  }, [hoverId, selectedId, placed, badge, zoomTick])

  // 5. Escolheu outro imóvel. Passo a passo:
  //    a. clicado no próprio mapa (pino sozinho): não mexe, a pessoa já está olhando para ele;
  //    b. o imóvel está dentro de um pino de GRUPO: aproxima (2 níveis, com voo curto) até ele aparecer;
  //    c. senão (linha da tabela, link com ?imovel=): se o pino está fora da vista, o mapa anda o
  //       mínimo para mostrá-lo, sem mudar o zoom (panInside, do Leaflet), em 300 ms.
  useEffect(() => {
    const map = mapRef.current
    const r = selectedId ? placed.find((x) => x.id === selectedId) : undefined
    const fromMap = pickedOnMap.current === selectedId
    pickedOnMap.current = null
    if (!map || !r) return
    const animate = !reducedMotion()
    const marker = markers.current.get(r.id)
    const grouped = !!marker && [...markers.current].some(([id, m]) => m === marker && id !== r.id)
    if (grouped && map.getZoom() < GROUP_MAX_ZOOM) {
      map.flyTo([r.lat!, r.lng!], Math.min(GROUP_MAX_ZOOM, map.getZoom() + 2), { animate, duration: 0.45 })
      return
    }
    if (fromMap) return
    map.panInside([r.lat!, r.lng!], { padding: [48, 48], animate, duration: 0.3 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- de propósito: só quando muda o escolhido (filtro novo não arrasta o mapa)
  }, [selectedId])

  return (
    <>
      <div ref={divRef} className="mapa-leaflet h-full w-full" role="region" aria-label="Mapa da cidade com os imóveis" />
      {openGroup &&
        createPortal(
          <GroupList
            pins={openGroup}
            onSelect={(id) => {
              mapRef.current?.closePopup()
              pickedOnMap.current = id
              onSelect(id)
            }}
          />,
          groupEl,
        )}
    </>
  )
}

/* ---------------------------------------------------------------- fundo neutro (sem azulejos) */

/**
 * Sem os azulejos: os mesmos pinos num quadro neutro. A conta é uma projeção simples
 * (equirretangular): longitude vira x e latitude vira y, com a longitude encolhida pelo
 * cosseno da latitude (perto do equador o grau de longitude tem quase o mesmo tamanho do de
 * latitude; em Belo Horizonte, cerca de 94%). Para alguns quilômetros de cidade, basta.
 */
export function relativePositions(pts: { lat: number; lng: number }[], w = 1000, h = 620, pad = 70): [number, number][] {
  if (!pts.length) return []
  const lats = pts.map((p) => p.lat)
  const lngs = pts.map((p) => p.lng)
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)]
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const spanX = Math.max((maxLng - minLng) * k, 1e-6)
  const spanY = Math.max(maxLat - minLat, 1e-6)
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY)
  const ox = (w - spanX * scale) / 2
  const oy = (h - spanY * scale) / 2
  return pts.map((p) => [ox + (p.lng - minLng) * k * scale, oy + (maxLat - p.lat) * scale])
}

/**
 * Tamanho do quadro em px. O fundo neutro desenha na MESMA proporção do quadro: o mapa largo
 * (largura toda, pouco mais de um terço de altura) não fica com os pinos espremidos no meio.
 */
function useBoxSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1000, h: 620 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setSize({ w: el.clientWidth, h: el.clientHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

// atalho: o fundo neutro (sem azulejos) não tem o balão do clique; clicar escolhe e a ficha ao lado mostra o imóvel. Fazer se o fundo neutro deixar de ser só o plano B da rede.
function FallbackMap({ pins, hover, selectedId, badge, onSelect }: MapProps) {
  const hoverId = useHovered(hover)
  const [boxRef, { w, h }] = useBoxSize()
  const [openGroup, setOpenGroup] = useState<MapPin[] | null>(null)
  const placed = pins.filter((r) => r.lat !== null && r.lng !== null)
  const pos = relativePositions(
    placed.map((r) => ({ lat: r.lat!, lng: r.lng! })),
    w,
    h,
    Math.min(70, w / 6, h / 6),
  )
  const at = new Map(placed.map((r, i) => [r.id, { x: pos[i][0], y: pos[i][1] }]))
  // Sem zoom, o grupo não se desfaz: clicar nele lista os imóveis no canto do quadro.
  const groups = groupNearby(placed, (r) => at.get(r.id)!, (r) => r.units_total, 46)
  // Nome do bairro no meio dos imóveis dele (ajuda a ler a posição relativa).
  const districts = new Map<string, [number, number, number]>()
  placed.forEach((r, i) => {
    const d = districts.get(r.district) ?? [0, 0, 0]
    districts.set(r.district, [d[0] + pos[i][0], d[1] + pos[i][1], d[2] + 1])
  })
  const activate = (items: MapPin[]) => (items.length > 1 ? setOpenGroup(items) : onSelect(items[0].id))
  return (
    <div ref={boxRef} className="relative h-full w-full bg-surface-2">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="group" aria-label="Posição relativa dos imóveis (sem mapa de fundo)">
        <defs>
          <pattern id="fb-ruas" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
            <path d="M0 0H56M0 0V56" stroke="var(--border)" strokeWidth="6" fill="none" />
          </pattern>
        </defs>
        <rect x="-200" y="-200" width={w + 400} height={h + 400} fill="url(#fb-ruas)" />
        <g aria-hidden="true">
          {[...districts].map(([name, [x, y, n]]) => (
            <text key={name} x={x / n} y={y / n + 34} textAnchor="middle" className="fill-[var(--muted)] text-[13px] font-medium">
              {name}
            </text>
          ))}
        </g>
        {groups.map((g) => {
          const lead = g.items[0]
          const many = g.items.length > 1
          return (
            <g
              key={lead.id}
              transform={`translate(${g.at.x} ${g.at.y})`}
              role="button"
              tabIndex={0}
              aria-label={many ? groupLabel(g.items, 'Ver a lista') : pinLabel(lead)}
              className="fb-pin cursor-pointer"
              data-occ={occupancyBand(many ? groupOccupancy(g.items) : lead.occupancy_pct)}
              data-grupo={many || undefined}
              data-hover={g.items.some((r) => r.id === hoverId) || undefined}
              data-sel={g.items.some((r) => r.id === selectedId) || undefined}
              onClick={() => activate(g.items)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  activate(g.items)
                }
              }}
              onMouseEnter={() => hover.set(many ? null : lead.id)}
              onMouseLeave={() => hover.set(null)}
            >
              <rect x={-22} y={-16} width={44} height={32} rx={16} />
              <text textAnchor="middle" dominantBaseline="central">
                {many ? g.items.length : badgeText(lead, badge)}
              </text>
            </g>
          )
        })}
      </svg>
      <p role="status" className="absolute top-3 right-3 left-3 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted shadow-card sm:right-auto">
        <CloudOff className="size-4 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold text-text">Mapa de fundo indisponível nesta rede.</strong> Os pinos mostram a posição relativa dos imóveis.
        </span>
      </p>
      {openGroup && (
        <div className="absolute right-3 bottom-3 left-3 rounded-2xl border border-border bg-surface p-3 shadow-pop sm:right-auto sm:w-[300px]">
          <button type="button" className="absolute top-2 right-2 grid size-7 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Fechar a lista" onClick={() => setOpenGroup(null)}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
          <GroupList
            pins={openGroup}
            onSelect={(id) => {
              setOpenGroup(null)
              onSelect(id)
            }}
          />
        </div>
      )}
    </div>
  )
}
