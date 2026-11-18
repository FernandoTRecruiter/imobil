/* =============================================================================
   IsoCanvas: o desenho 3D (SVG) de uma cena, com zoom, arrastar, girar, selos e balão.

   Camadas, de baixo para cima:
   1. chão (prancha, ruas, lote, gramado, piso, piscina, quadra), linhas pintadas, VAGAS (no
      chão, com a cor da situação), textos (nome da rua, da área, do lazer) e sombras;
   2. lajes de subsolo em raio X (a garagem dentro do prédio, abaixo do chão);
   3. corpos pintados do fundo para a frente (aria-hidden: o leitor de tela não lê faces);
   4. selos dos blocos (ocupação %), focáveis: Enter foca o bloco. Só em bloco com mais de uma
      unidade: numa casa ou num apartamento avulso o "100%" só repetiria a cor da unidade;
   5. ANÉIS: o contorno de cada bloco (acende com o mouse no bloco) e o de cada unidade e vaga,
      transparente, na ORDEM DE LEITURA (bloco, andar de cima para baixo, posição; depois as
      vagas). O da unidade recebe o Tab e o Enter. Como fica por cima de tudo, o foco aparece mesmo
      na unidade escondida atrás de outra (o "raio X" do anel). O clique do mouse atravessa o anel e
      cai na forma.
   Por cima do SVG, só durante o giro: um <canvas> opaco que pinta o giro quadro a quadro (giro.ts
   e giroCanvas.ts).

   Gestos (07/11/2026, pedidos do Fernando: "não quero mudança de página por interações simples" e
   "o balão só pode aparecer quando eu clicar"):
   - passar o mouse ACENDE: a unidade ou vaga ganha o anel (e a linha da tabela de baixo acende,
     onHoverUnit); o bloco ganha o contorno. Nenhum balão. A linha da tabela com o mouse em cima
     chega aqui como "highlighted" e acende o anel do mesmo jeito;
   - clicar (ou Enter) numa unidade a ESCOLHE (onPickUnit: a tela mostra a ficha ao lado) e abre o
     balão com o resumo curto, apontando para ela; no selo ou no volume do bloco, foca o bloco e
     abre o balão do bloco. O balão fica enquanto o mouse está nele ou na coisa clicada e some 2 s
     depois que sai dos dois (balao.ts). Esc ou clique no vazio fecham o balão; a escolha fica.

   Escolhida (target): anel de foco na unidade (vaga de subsolo: a laje do subsolo acende). O
   enquadramento (zoom no alvo) só acontece quando a tela pede (targetSeq muda): escolher no
   próprio desenho não mexe no zoom.

   Nível de detalhe: com o desenho pequeno na tela (empreendimento grande visto inteiro), os
   códigos ficariam com 4 px e virariam ruído. Abaixo de um tamanho, eles somem (atributo no
   SVG, sem redesenhar as faces) e voltam ao aproximar.

   Rapidez (07/11/2026, "tá muito travado"; medido: escolher uma unidade custava ~280 ms de
   desenho no modo de desenvolvimento):
   - as faces (Scene) e o chão (Ground) só recebem a unidade escolhida quando algum filtro pode
     apagá-la (bloco, quartos, situação). Sem filtro, escolher não muda nenhuma face, e as
     centenas de faces não se desenham de novo;
   - a laje do subsolo só recebe o foco quando o alvo está mesmo no subsolo;
   - cada anel é uma peça memo: escolher outra unidade redesenha DOIS anéis (o que saiu e o que
     entrou), não os duzentos.
   Câmera: enquadrar a escolha (vinda da tabela) ou o bloco anda até lá em ~260 ms (animateTo, no
   usePanZoom).

   Giro suave (07/11/2026, "girar ele tinha que ser algo smooth"): os botões de girar e o "Planta"
   não saltam mais. O terreno gira de verdade em ~400 ms (a conta de cada quadro: giro.ts; a pintura:
   giroCanvas.ts, num canvas opaco por cima do SVG parado) e termina EXATAMENTE no desenho de 90
   graus, que entra no lugar do canvas no mesmo quadro. O giro mantém o que a pessoa estava olhando:
   o ponto no meio do quadro continua no meio, com o mesmo zoom (olhando o desenho inteiro, termina
   no desenho inteiro). Clicar de novo no meio do giro estende o caminho a partir de onde ele está
   (sem voltar). Com "reduzir movimento" ligado, salta como antes (o enquadramento é o mesmo).
   ============================================================================= */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { Maximize, Minus, Plus, RotateCcw, RotateCw } from 'lucide-react'
import { UNIT_STATUS } from '@/data/labels'
import type { UnitStatus } from '@/data/types'
import type { UnitRow } from '@/data/views/units'
import { UNIT_STATUS_VAR } from '@/components/ui/Badge'
import { cn } from '@/components/ui/cn'
import { formatDate } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { centroid, fitRect, ZOOM_MAX, type PanZoom, type Pt, type Rot, type ViewMode } from './iso'
import { occupancyOf, slabKey, typologySummary, typologyText, unitAriaLabel, unitName, type BuildingBox, type Layout, type Shape } from './layout'
import { draw, sceneView, targetRect, type Drawing, type MapTarget, type Painted } from './draw'
import { IDENTITY, usePanZoom } from './usePanZoom'
import { zoneOf } from './repo'
import { easeInOut, easeOutTurn, endOfTurn, frameOfSvg, isWhole, meet, pivotAt, RETARGET_MS, rotOf, svgPoint, TURN_MS, tweenAt, type Pivot, type Size, type SvgView, type Tween } from './giro'
import { buildTurnScene, paintTurn, type Look, type TurnScene } from './giroCanvas'
import { placeBalloon, useBalloon, type Rect } from './balao'

export interface IsoFilters {
  /** Bloco em foco: os outros ficam cinza. */
  building: string | null
  /** Andar isolado (de um bloco): os de cima ficam quase transparentes. */
  isolate: { building: string; level: number } | null
  bedrooms: number[]
  status: UnitStatus | null
}

export type { MapTarget }

interface Props {
  sceneKey: string
  title: string
  layout: Layout
  units: Map<string, UnitRow>
  rot: Rot
  mode: ViewMode
  filters: IsoFilters
  /** Unidade com o anel aceso (a linha da tabela que está com o mouse em cima). */
  highlighted: string | null
  /** Bloco para enquadrar (zoom) ao abrir ou ao escolher; null = cena inteira. */
  zoomTo: string | null
  /** A unidade escolhida (anel de foco) e o número do pedido de enquadrar (muda = zoom no alvo). */
  target: MapTarget | null
  targetSeq: number
  /** Clique ou Enter numa unidade: a tela escolhe (ou solta, se já era a escolhida). */
  onPickUnit: (id: string) => void
  /** Mouse (ou foco do teclado) entrou numa unidade; null = saiu. */
  onHoverUnit: (id: string | null) => void
  onSelectBuilding: (id: string) => void
  /** O giro (ou a passagem 3D/planta) terminou: o giro e o modo novos (a tela guarda os dois). */
  onViewChange: (rot: Rot, mode: ViewMode) => void
  /** Trilha (Imóvel › Bloco › Andar), desenhada no canto de cima. */
  trail: ReactNode
}

/** A unidade passa nos filtros de quartos e de situação destacada? */
export function passes(u: UnitRow, f: IsoFilters): boolean {
  return (!f.bedrooms.length || f.bedrooms.includes(u.bedrooms)) && (!f.status || u.status === f.status)
}

/** Tamanho do SVG na tela (ResizeObserver): decide o nível de detalhe e o tamanho do selo. */
function useSize(ref: RefObject<Element | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** O que o balão explica: uma unidade (ou vaga) ou um bloco. */
interface Pin {
  unit: string | null
  building: string | null
}

/** O giro em andamento (fora do estado do React: muda a cada quadro e ninguém desenha por isso). */
interface TurnRun {
  /** Para onde vai, em quartos de volta (inteiro; pode passar de 3 ou ser negativo) e o modo de destino. */
  quarters: number
  mode: ViewMode
  pivot: Pivot
  /** O começo do primeiro clique: a regra do fim (endOfTurn) vale sobre ele, mesmo redirecionado. */
  start: { whole: boolean; at: Pt; scale: number }
  tween: Tween
  scene: TurnScene
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  dpr: number
  raf: number
  /** O que fazer ao chegar (trocado a cada redirecionamento: leva as funções mais novas da tela). */
  finish: () => void
}

export function IsoCanvas(props: Props) {
  const { layout, units, rot, mode, filters, highlighted, zoomTo, sceneKey, onHoverUnit, target, targetSeq } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // A conta cara (faces, ordem de pintura) só refaz quando muda cena, giro ou modo.
  const drawing = useMemo(() => draw(layout, units, rot, mode), [layout, units, rot, mode])
  /**
   * Enquadramento: o alvo do "mostrar no mapa" (com uma folga em volta, para ver onde ele fica),
   * senão o bloco escolhido, senão a cena inteira.
   */
  const fitOf = (d: Drawing, b: string | null, t: MapTarget | null) => {
    const tr = targetRect(d, layout, t)
    if (tr) {
      const ctx = 0.3
      const w = Math.max(tr.w, d.view.w * ctx)
      const h = Math.max(tr.h, d.view.h * ctx)
      return fitRect(d.view, { x: tr.x - (w - tr.w) / 2, y: tr.y - (h - tr.h) / 2, w, h }, ZOOM_MAX)
    }
    const rect = b ? d.buildingRects.get(b) : undefined
    return rect ? fitRect(d.view, rect) : IDENTITY
  }
  // O enquadramento inicial é calculado uma vez (função: o useState só chama no primeiro desenho).
  const pz = usePanZoom(svgRef, drawing.view, () => fitOf(drawing, zoomTo, target))
  const { animateTo, stop } = pz
  const size = useSize(svgRef)
  const balloon = useBalloon<Pin>()
  const { open: openBalloon, part: balloonPart, close: closeBalloon } = balloon
  /** Giro em andamento: o canvas aparece por cima do SVG. */
  const [turning, setTurning] = useState(false)
  /** O zoom que o giro calculou para o desenho novo (vale quando o desenho com esse giro e modo chegar). */
  const [settle, setSettle] = useState<{ geoKey: string; pz: PanZoom } | null>(null)
  const turnRef = useRef<TurnRun | null>(null)

  // Mudou cena, giro, modo, o bloco a enquadrar ou veio pedido de enquadrar o alvo: volta o zoom
  // ao começo (ou enquadra). Escolher uma unidade no desenho NÃO está aqui: não mexe no zoom.
  // É o padrão "ajustar estado quando a entrada muda", feito durante o desenho e não num efeito.
  // Passo a passo:
  //   1. mudou a FORMA porque um giro acabou: usa o zoom que o giro calculou (o mesmo do último
  //      quadro pintado: a troca não pula);
  //   2. mudou a FORMA por outro motivo (cena): salta já, no mesmo quadro do desenho novo;
  //   3. mudou só o ALVO (bloco, pedido de enquadrar): guarda o destino em "aim", e o efeito abaixo
  //      anda a câmera até lá (animação não pode começar durante o desenho).
  const geoKey = `${sceneKey}|${rot}|${mode}`
  const fitKey = `${geoKey}|${zoomTo ?? ''}|${targetSeq}`
  const [prevFit, setPrevFit] = useState({ fitKey, geoKey })
  const [aim, setAim] = useState<{ to: PanZoom } | null>(null)
  if (prevFit.fitKey !== fitKey) {
    if (prevFit.geoKey !== geoKey && settle?.geoKey === geoKey) pz.setT(settle.pz)
    else {
      const next = fitOf(drawing, zoomTo, target)
      if (prevFit.geoKey === geoKey) setAim({ to: next })
      else pz.setT(next)
    }
    setPrevFit({ fitKey, geoKey })
  }
  // A forma mudou no meio de uma animação: nenhum quadro antigo pode chegar depois do salto.
  useLayoutEffect(() => stop(), [geoKey, stop])
  useEffect(() => {
    if (aim) animateTo(aim.to)
  }, [aim, animateTo])
  // Saiu da tela no meio do giro: nenhum quadro continua rodando.
  useEffect(() => {
    const run = turnRef
    return () => {
      if (run.current) cancelAnimationFrame(run.current.raf)
      run.current = null
    }
  }, [])

  // Escala do desenho na tela: px por unidade do quadro (encaixe "meet") vezes o zoom.
  const fit = size.w && size.h ? Math.min(size.w / drawing.view.w, size.h / drawing.view.h) : 1
  const scale = fit * pz.t.k
  // Selo, nome do bloco e textos do chão com tamanho de TELA quase fixo: crescem devagar com a
  // escala (raiz), entre 70% e 120% do tamanho base. Sem o teto, o selo virava um disco enorme no
  // zoom do cartão pequeno; sem o piso, sumia no empreendimento grande visto no celular.
  const badgeGrow = Math.min(1.2, Math.max(0.7, 1.3 * Math.sqrt(scale)))
  const badgeScale = badgeGrow / (scale || 1)

  // Rótulo do leitor de tela de cada unidade, uma vez por cena (o texto usa toLocaleString, que
  // é caro: feito a cada passada de mouse, era a maior parte do custo do 3D).
  const labels = useMemo(() => new Map([...units].map(([id, u]) => [id, unitAriaLabel(u)])), [units])
  const shapeByKey = useMemo(() => new Map(layout.shapes.map((s) => [s.key, s])), [layout])
  // A unidade com o mouse em cima (no desenho ou na linha da tabela) ganha o anel pelo DOM: os
  // anéis são memo e não re-desenham a cada passada de mouse.
  useEffect(() => {
    if (!highlighted) return
    const el = svgRef.current?.querySelector(`.iso-ring[data-u="${CSS.escape(highlighted)}"]`)
    el?.setAttribute('data-sel', '')
    return () => el?.removeAttribute('data-sel')
  }, [highlighted, drawing])
  // Anel do alvo: a unidade ou vaga (o anel dela, na camada de anéis) ou o contorno do andar
  // inteiro. Subsolo não leva anel por cima: ele passaria na frente da torre; quem acende é a
  // própria laje, desenhada embaixo dos prédios (o prédio continua cobrindo o que está atrás).
  const targetUnit = target && 'unitId' in target ? target.unitId : null
  const targetSlab = targetUnit ? layout.units.get(targetUnit)?.slab : target && 'level' in target ? slabKey(target.buildingId, target.level) : undefined
  const underground = !!targetSlab && layout.slabs.some((s) => s.key === targetSlab)
  const targetRing = targetSlab && !underground ? drawing.levelRings.get(targetSlab) : undefined
  const multi = layout.buildings.length > 1
  // O que as faces e o chão precisam saber da escolha (ver "Rapidez" no cabeçalho): a unidade só
  // quando um filtro pode apagá-la; a laje só quando ela é mesmo do subsolo.
  const canDim = !!filters.building || filters.bedrooms.length > 0 || !!filters.status
  const dimFocus = canDim ? targetUnit : null
  const slabFocus = underground ? (targetSlab ?? null) : null

  // A escolha mudou por fora (linha da tabela, Esc, endereço): o balão de outra unidade fecha.
  const [prevPick, setPrevPick] = useState(targetUnit)
  if (prevPick !== targetUnit) {
    setPrevPick(targetUnit)
    const t = balloon.state?.target
    if (t?.unit && t.unit !== targetUnit) closeBalloon()
  }
  // Esc fecha o balão (e só ele: a escolha fica; o próximo Esc, já sem balão, solta a escolha na
  // tela de cima). Ouvido na captura, antes do Esc da tela, que respeita o defaultPrevented.
  const balloonOpen = !!balloon.state
  useEffect(() => {
    if (!balloonOpen) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      closeBalloon()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [balloonOpen, closeBalloon])

  /* ------------------------------------------------------------ o giro suave */

  /** Como cada corpo aparece (a mesma classe e os mesmos atributos do Scene): o giro lê a cor disso. */
  const lookOf = (s: Shape): Look => {
    const u = s.unitId ? units.get(s.unitId) : undefined
    const ghost = !!filters.isolate && s.buildingId === filters.isolate.building && s.level !== null && s.level > filters.isolate.level
    return { cls: classOf(s), attrs: { 'data-tone': s.tone, 'data-st': u?.status, 'data-dim': dimOf(u, s.buildingId, filters, dimFocus) ? '' : undefined }, ghost }
  }
  const spotLook = (unitId: string | null) => {
    const u = unitId ? units.get(unitId) : undefined
    return { cls: cn('iso-spot', !u && 'iso-spot-n'), attrs: { 'data-st': u?.status, 'data-dim': dimOf(u, null, filters, dimFocus) ? '' : undefined } }
  }

  /**
   * Altura do que está no meio do quadro (andares): a do corpo pintado lá (o meio dele), a do topo
   * do bloco (selo) ou 0 (chão, vaga). É a altura que o giro mantém parada no meio da tela: girar
   * olhando o alto da torre não joga o alto da torre para o lado.
   */
  const heightAtCenter = (svg: SVGSVGElement): number => {
    const r = svg.getBoundingClientRect()
    for (const el of document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)) {
      if (!svg.contains(el)) continue
      const badge = el.closest('[data-badge]')?.getAttribute('data-badge')
      if (badge) return layout.buildings.find((b) => b.id === badge)?.top ?? 0
      const g = el.closest('[data-corpos] > g')
      if (g?.parentElement) {
        const p = drawing.painted[Array.prototype.indexOf.call(g.parentElement.children, g)]
        const s = p ? shapeByKey.get(p.key) : undefined
        if (s) return (s.body.z0 + s.body.z1) / 2
      }
      return 0
    }
    return 0
  }

  /**
   * Girar (dq = +1 direita, -1 esquerda) e/ou trocar 3D e planta (toggle). Passo a passo:
   * 1. destino: quartos de volta inteiros a partir do giro de agora (ou do destino do giro em
   *    andamento: clicar de novo estende o caminho) e o modo;
   * 2. pivô (só no primeiro clique): vendo o desenho inteiro, o meio do terreno; aproximado, o ponto
   *    do meio do quadro, na altura do que está lá;
   * 3. fim (endOfTurn): o último quadro e o zoom do SVG novo, já com o quadro (viewBox) do desenho
   *    novo, que sai barato (sceneView, sem montar as faces);
   * 4. sem movimento (reduzir movimento ligado, ou sem canvas): troca direto, com o mesmo fim;
   * 5. giro em andamento: só redireciona, partindo do quadro de agora (nada volta para trás);
   * 6. giro novo: lê as cores (sonda), pinta o primeiro quadro (igual ao SVG), mostra o canvas e
   *    anda a cada quadro do navegador; no fim, troca pelo SVG novo (finish).
   */
  const startTurn = (dq: -1 | 0 | 1, toggle: boolean) => {
    const svg = svgRef.current
    const canvas = canvasRef.current
    const run = turnRef.current
    // 1. Destino.
    const quarters = (run ? run.quarters : rot) + dq
    const baseMode = run ? run.mode : mode
    const nextMode: ViewMode = toggle ? (baseMode === '3d' ? 'planta' : '3d') : baseMode
    const nextRot = rotOf(quarters)
    const el: Size = { w: svg?.clientWidth ?? 0, h: svg?.clientHeight ?? 0 }
    const sv: SvgView = { rot, mode, site: layout.site, view: drawing.view, size: el, pz: pz.t }
    // 2. Pivô e começo.
    let pivot: Pivot
    if (run) pivot = run.pivot
    else if (isWhole(pz.t) || !svg || !el.w || !el.h) {
      const [x, y] = centroid(layout.frame)
      pivot = { x, y, z: 0 }
    } else pivot = pivotAt(sv, el.w / 2, el.h / 2, heightAtCenter(svg))
    const start = run ? run.start : { whole: isWhole(pz.t), at: el.w ? svgPoint(sv, pivot.x, pivot.y, pivot.z) : ([0, 0] as Pt), scale: el.w ? meet(drawing.view, el).s * pz.t.k : 1 }
    // 3. Fim.
    const end = el.w && el.h ? endOfTurn({ ...start, pivot, quarters, mode: nextMode, site: layout.site, view: sceneView(layout, nextRot, nextMode), size: el }) : null
    const commit = () => {
      if (!end || (nextRot === rot && nextMode === mode)) {
        // Voltou ao mesmo giro (direita e esquerda em seguida) ou não havia tamanho: nada a trocar no desenho.
        setSettle(null)
        if (end) pz.setT(end.pz)
      } else setSettle({ geoKey: `${sceneKey}|${nextRot}|${nextMode}`, pz: end.pz })
      props.onViewChange(nextRot, nextMode)
    }
    const finish = () => {
      setTurning(false)
      commit()
    }
    // 4. Sem movimento.
    const ctx = canvas?.getContext('2d')
    if (!end || !svg || !canvas || !ctx || reducedMotion()) {
      if (run) cancelAnimationFrame(run.raf)
      turnRef.current = null
      stop()
      finish()
      return
    }
    const now = performance.now()
    // 5. Redirecionar.
    if (run) {
      run.quarters = quarters
      run.mode = nextMode
      run.tween = { from: tweenAt(run.tween, now).frame, to: end.frame, start: now, ms: RETARGET_MS, ease: easeOutTurn }
      run.finish = finish
      return
    }
    // 6. Giro novo.
    stop()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(el.w * dpr)
    canvas.height = Math.round(el.h * dpr)
    const focus = targetUnit && !underground ? (layout.units.get(targetUnit)?.bodies ?? []) : []
    const scene = buildTurnScene(svg, { layout, lookOf, spotLook, focusSlab: slabFocus, focus })
    const tween: Tween = { from: frameOfSvg(sv, pivot), to: end.frame, start: now, ms: TURN_MS, ease: easeInOut }
    paintTurn(ctx, scene, tween.from, pivot, el.w, el.h, dpr)
    const step = (t: number) => {
      const r = turnRef.current
      if (!r) return
      const { frame, done } = tweenAt(r.tween, t)
      paintTurn(r.ctx, r.scene, frame, r.pivot, r.w, r.h, r.dpr)
      if (!done) {
        r.raf = requestAnimationFrame(step)
        return
      }
      turnRef.current = null
      r.finish()
    }
    turnRef.current = { quarters, mode: nextMode, pivot, start, tween, scene, ctx, w: el.w, h: el.h, dpr, raf: requestAnimationFrame(step), finish }
    setTurning(true)
  }

  /* ------------------------------------------------------------ mouse, teclado e balão */

  /** A coisa debaixo do mouse (ou com o foco) é a que o balão explica? */
  const isAnchor = (el: Element | null, t: Pin | undefined): boolean => {
    if (!el || !t) return false
    if (t.unit) return el.closest('[data-u]')?.getAttribute('data-u') === t.unit
    return !!t.building && el.closest('[data-b]')?.getAttribute('data-b') === t.building
  }
  /** Contorno do bloco com o mouse em cima, direto no DOM (os anéis são memo; nada se desenha de novo). */
  const litBuilding = useRef<string | null>(null)
  const lightBuilding = (id: string | null) => {
    if (litBuilding.current === id) return
    const svg = svgRef.current
    if (litBuilding.current) svg?.querySelector(`[data-bring="${CSS.escape(litBuilding.current)}"]`)?.removeAttribute('data-sel')
    litBuilding.current = id
    if (id) svg?.querySelector(`[data-bring="${CSS.escape(id)}"]`)?.setAttribute('data-sel', '')
  }

  /** Escolher a unidade e abrir o balão nela; clicar na que já era a escolhida solta (e o balão vai junto). */
  const pickUnit = (u: string, how: { anchor?: boolean; focus?: boolean }) => {
    const wasPicked = targetUnit === u
    props.onPickUnit(u)
    if (wasPicked) closeBalloon()
    else openBalloon({ unit: u, building: null }, how)
  }
  const pickBuilding = (b: string, how: { anchor?: boolean; focus?: boolean }) => {
    props.onSelectBuilding(b)
    openBalloon({ unit: null, building: b }, how)
  }

  // Clique: unidade é escolhida; selo ou volume do bloco põe o bloco em foco; no vazio, fecha o
  // balão. Arrastar não é clique, e nada responde enquanto o desenho gira.
  const onClick = (e: MouseEvent) => {
    if (pz.wasDrag() || turnRef.current) return
    const el = (e.target as Element).closest('[data-u],[data-badge],[data-b]')
    if (!el) return closeBalloon()
    const u = el.getAttribute('data-u')
    const b = el.getAttribute('data-badge') ?? el.getAttribute('data-b')
    if (u) pickUnit(u, { anchor: true })
    else if (b) pickBuilding(b, { anchor: true })
  }
  // Teclado: unidade e selo são botões (Enter ou espaço): escolhe e abre o balão, como o clique.
  const onKeyDown = (e: KeyboardEvent) => {
    const el = e.target as Element
    const u = el.getAttribute('data-u')
    const b = el.getAttribute('data-badge')
    if (u && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      pickUnit(u, { focus: true })
    } else if (b && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      pickBuilding(b, { focus: true })
    }
  }
  // Mouse em cima: SÓ acende (anel da unidade ou vaga e a linha da tabela; contorno do bloco).
  // E conta para o balão: estar na coisa clicada segura ele aberto.
  const onPointerOver = (e: PointerEvent) => {
    if (pz.dragging || turnRef.current) return
    const el = e.target as Element
    const u = el.closest('[data-u]')?.getAttribute('data-u') ?? null
    onHoverUnit(u)
    lightBuilding(u ? null : (el.closest('[data-b]')?.getAttribute('data-b') ?? null))
    balloonPart('anchor', isAnchor(el, balloon.state?.target))
  }
  const onPointerLeave = () => {
    onHoverUnit(null)
    lightBuilding(null)
    balloonPart('anchor', false)
  }
  // Foco do teclado: acende como o mouse e, na coisa do balão, segura ele aberto.
  const onFocus = (e: FocusEvent) => {
    const el = e.target as Element
    onHoverUnit(el.getAttribute('data-u'))
    balloonPart('focus', isAnchor(el, balloon.state?.target))
  }
  const onBlur = () => {
    onHoverUnit(null)
    balloonPart('focus', false)
  }

  // Onde o balão aponta, em px do quadro: a unidade (ou vaga) inteira; o bloco, pelo selo (com o
  // nome embaixo dele) ou, sem selo, pelo bloco inteiro. Segue o zoom e o arrasto (é refeito a cada desenho).
  const m = meet(drawing.view, size.w && size.h ? size : { w: 1, h: 1 })
  const toScreen = (x: number, y: number): Pt => [m.s * (pz.t.k * x + pz.t.x) + m.ox, m.s * (pz.t.k * y + pz.t.y) + m.oy]
  const rectOnScreen = (r: { x: number; y: number; w: number; h: number }): Rect => {
    const [x, y] = toScreen(r.x, r.y)
    return { x, y, w: r.w * scale, h: r.h * scale }
  }
  const anchorOf = (t: Pin): Rect | null => {
    if (t.unit) {
      const r = drawing.unitRects.get(t.unit)
      return r ? rectOnScreen(r) : null
    }
    const bb = t.building ? layout.buildings.find((x) => x.id === t.building) : undefined
    const badge = bb && bb.units.length >= 2 ? drawing.badges.find((x) => x.id === bb.id) : undefined
    if (badge) {
      const [cx, cy] = toScreen(badge.x, badge.y)
      const r = 17 * badgeGrow
      return { x: cx - r, y: cy - r, w: 2 * r, h: (multi && bb?.tag ? 17 + 32 : 34) * badgeGrow }
    }
    const r = t.building ? drawing.buildingRects.get(t.building) : undefined
    return r ? rectOnScreen(r) : null
  }
  const pin = balloon.state && !turning && size.w ? anchorOf(balloon.state.target) : null
  // Coisa fora do quadro (arrastou para longe): o balão espera escondido, sem apontar para o nada.
  const pinVisible = !!pin && pin.x + pin.w > 0 && pin.x < size.w && pin.y + pin.h > 0 && pin.y < size.h

  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        className="iso-svg"
        data-drag={pz.dragging || undefined}
        data-far={scale < 0.8 || undefined}
        data-vfar={scale < 1.3 || undefined}
        data-turning={turning || undefined}
        viewBox={`${drawing.view.x} ${drawing.view.y} ${drawing.view.w} ${drawing.view.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={`Desenho ${mode === '3d' ? '3D' : 'em planta'} de ${props.title}. Tab percorre as unidades e as vagas; Enter escolhe, mostra a ficha ao lado e o resumo num balão.`}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPointerOver={onPointerOver}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        {...pz.handlers}
        onPointerDown={(e) => {
          if (!turnRef.current) pz.handlers.onPointerDown(e)
        }}
      >
        <defs>
          <filter id="iso-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <g transform={`translate(${pz.t.x} ${pz.t.y}) scale(${pz.t.k})`}>
          <Ground drawing={drawing} units={units} filters={filters} focusUnit={dimFocus} />
          {/* Textos do chão entre o chão e os prédios (o prédio da frente ainda cobre o nome da rua),
              com o mesmo tamanho na tela em qualquer zoom, como o selo: crescer junto viraria letreiro. */}
          <g aria-hidden="true">
            {drawing.texts.map((t) => (
              <text key={t.key} className={`iso-tx t-${t.kind}`} transform={`translate(${t.x} ${t.y}) scale(${badgeScale})`} style={{ fontSize: t.kind === 'rua' ? 12 : t.kind === 'zona' ? 11 : 10 }}>
                {t.text}
              </text>
            ))}
          </g>
          {/* key = giro e modo: o giro novo MONTA as faces de novo em vez de reaproveitar as velhas.
              Reaproveitada, a face trocava de degrau de luz (f-0 para f-3) e a transição de cor do
              CSS esmaecia 150 ms entre as duas logo depois do canvas sair: a costura aparecia. */}
          <Scene key={geoKey} drawing={drawing} units={units} filters={filters} mode={mode} focusUnit={dimFocus} focusSlab={slabFocus} />
          <g>
            {drawing.badges.map((b) => {
              const bb = layout.buildings.find((x) => x.id === b.id)!
              // Bloco de uma unidade só (casa, apartamento avulso): o selo diria "100%" ou "0%", o
              // mesmo que a cor da unidade já diz. Sem selo; o clique na unidade mostra o balão dela.
              if (bb.units.length < 2) return null
              const occ = occupancyOf(bb.units)
              const free = bb.units.filter((u) => u.status === 'available').length
              const dim = !!filters.building && filters.building !== b.id
              return (
                <g
                  key={b.id}
                  className="iso-badge"
                  data-badge={b.id}
                  data-b={b.id}
                  data-dim={dim || undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={`${bb.name}: ${occ}% ocupado, ${free} ${free === 1 ? 'disponível' : 'disponíveis'}. Enter foca o bloco e mostra o resumo.`}
                  transform={`translate(${b.x} ${b.y}) scale(${badgeScale})`}
                >
                  <circle r={17} />
                  <text>{occ}%</text>
                  {multi && bb.tag && (
                    <text className="iso-tag" y={27}>
                      {bb.tag}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
          <g>
            {targetRing && <path className="iso-ring" data-focus d={targetRing} aria-hidden="true" />}
            <Rings layout={layout} drawing={drawing} labels={labels} filters={filters} targetUnit={targetUnit} />
          </g>
        </g>
      </svg>

      {/* O giro em andamento (opaco, cobre o SVG parado; o clique e o mouse atravessam). */}
      <canvas ref={canvasRef} className="iso-giro" hidden={!turning} aria-hidden="true" />

      {/* Trilha no canto de cima. */}
      <div className="pointer-events-none absolute top-2 left-2 right-2 flex">{props.trail}</div>

      {/* Controles: girar, planta, zoom (canto de baixo, como na referência). */}
      <div className="absolute right-2 bottom-2 flex flex-col gap-1.5">
        <ControlGroup>
          <IconButton label="Girar 90° para a esquerda" onClick={() => startTurn(-1, false)} icon={<RotateCcw className="size-4" aria-hidden="true" />} />
          <IconButton label="Girar 90° para a direita" onClick={() => startTurn(1, false)} icon={<RotateCw className="size-4" aria-hidden="true" />} />
        </ControlGroup>
        <ControlGroup>
          <button
            type="button"
            className="h-9 w-12 text-xs font-semibold transition-colors duration-150 hover:bg-surface-2"
            aria-pressed={mode === 'planta'}
            onClick={() => startTurn(0, true)}
            title={mode === 'planta' ? 'Voltar ao 3D' : 'Ver de cima (planta)'}
          >
            {mode === 'planta' ? '3D' : 'Planta'}
          </button>
        </ControlGroup>
        <ControlGroup>
          <IconButton label="Aproximar" onClick={() => pz.zoomBy(1.3)} icon={<Plus className="size-4" aria-hidden="true" />} />
          <IconButton label="Afastar" onClick={() => pz.zoomBy(1 / 1.3)} icon={<Minus className="size-4" aria-hidden="true" />} />
          <IconButton label={target ? 'Enquadrar o destaque' : 'Enquadrar tudo'} onClick={() => animateTo(fitOf(drawing, zoomTo, target))} icon={<Maximize className="size-4" aria-hidden="true" />} />
        </ControlGroup>
      </div>

      {balloon.state && pin && pinVisible && (
        <Balloon key={`${balloon.state.target.unit ?? ''}|${balloon.state.target.building ?? ''}`} anchor={pin} area={size} fading={balloon.fading} onPart={(on) => balloonPart('balloon', on)}>
          <BalloonBody pin={balloon.state.target} layout={layout} units={units} />
        </Balloon>
      )}
    </div>
  )
}

function ControlGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card [&>*+*]:border-t [&>*+*]:border-border">{children}</div>
}

function IconButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="grid size-9 w-12 place-items-center text-text transition-colors duration-150 hover:bg-surface-2" aria-label={label} title={label} onClick={onClick}>
      {icon}
    </button>
  )
}

/**
 * Os anéis: primeiro o contorno de cada bloco (só acende com o mouse no bloco; não recebe foco: quem
 * recebe é o selo), depois os das unidades e vagas, na ordem de leitura: recebem o Tab e o Enter.
 * memo: só a cena, o giro, o filtro e o alvo re-desenham (o destaque do mouse entra pelo DOM, na
 * tela de cima). Cada anel é memo também: trocar a escolhida redesenha só o anel que saiu e o que entrou.
 */
const Rings = memo(function Rings({ layout, drawing, labels, filters, targetUnit }: { layout: Layout; drawing: Drawing; labels: Map<string, string>; filters: IsoFilters; targetUnit: string | null }) {
  return (
    <>
      {layout.buildings.map((b) => (
        <path key={`bloco:${b.id}`} className="iso-ring" data-bring={b.id} d={drawing.buildingRings.get(b.id)} aria-hidden="true" />
      ))}
      {layout.tabOrder.map((id) => {
        const place = layout.units.get(id)
        const label = labels.get(id)
        if (!label || !place) return null
        const ghost = !!filters.isolate && place.buildingId === filters.isolate.building && place.level !== null && place.level > filters.isolate.level
        return <Ring key={id} id={id} d={drawing.rings.get(id)} label={label} ghost={ghost} focused={targetUnit === id} />
      })}
    </>
  )
})

const Ring = memo(function Ring({ id, d, label, ghost, focused }: { id: string; d: string | undefined; label: string; ghost: boolean; focused: boolean }) {
  return (
    <path
      className="iso-ring"
      d={d}
      data-u={id}
      data-focus={focused || undefined}
      role="button"
      aria-pressed={focused}
      tabIndex={ghost ? -1 : 0}
      aria-hidden={ghost || undefined}
      aria-label={label}
    />
  )
})

/** Classe da forma pelo que ela é: unidade (cor da situação), volume neutro, apoio, vizinho, árvore. O giro usa a mesma (lê a cor dela). */
function classOf(p: Pick<Painted, 'kind' | 'unitId'>): string {
  if (p.kind === 'tree') return 'iso-tree'
  if (p.kind === 'ctx') return 'iso-ctx'
  if (p.kind === 'volume') return 'iso-vol'
  if (p.unitId) return cn('iso-u', p.kind === 'roof' && 'iso-roof')
  return cn('iso-slot', p.kind === 'roof' && 'iso-roof')
}

/** Fora do filtro fica cinza; o alvo do "mostrar no mapa" nunca (a pessoa pediu para ver ele). */
function dimOf(u: UnitRow | undefined, buildingId: string | null, filters: IsoFilters, focusUnit: string | null): boolean {
  return u && u.id !== focusUnit ? !passes(u, filters) || (!!filters.building && filters.building !== buildingId) : false
}

/**
 * O chão: prancha, ruas, gramado, linhas pintadas e as vagas. memo: zoom e mouse não redesenham;
 * só filtro, alvo e a conta do desenho.
 */
const Ground = memo(function Ground({ drawing, units, filters, focusUnit }: { drawing: Drawing; units: Map<string, UnitRow>; filters: IsoFilters; focusUnit: string | null }) {
  return (
    <g aria-hidden="true">
      {drawing.ground.map((g) => (
        <path key={g.key} d={g.d} className={`g-${g.kind}`} />
      ))}
      {drawing.lines.map((l) => (
        <path key={l.key} d={l.d} className={`l-${l.kind}`} />
      ))}
      {drawing.spots.map((s) => {
        const u = s.unitId ? units.get(s.unitId) : undefined
        return (
          <g key={s.key} className={cn('iso-spot', !u && 'iso-spot-n')} data-u={u?.id} data-st={u?.status} data-dim={dimOf(u, null, filters, focusUnit) || undefined}>
            <path d={s.d} />
            {s.label && (
              <text className="iso-lb-v" x={s.label.x} y={s.label.y}>
                {s.label.text}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
})

/**
 * Sombras, subsolos e corpos pintados. memo: passar o mouse (balão) e dar zoom não redesenham
 * centenas de faces; só filtro, bloco em foco, andar isolado, alvo e a conta do desenho.
 */
const Scene = memo(function Scene({ drawing, units, filters, mode, focusUnit, focusSlab }: { drawing: Drawing; units: Map<string, UnitRow>; filters: IsoFilters; mode: ViewMode; focusUnit: string | null; focusSlab: string | null }) {
  const ghostOf = (p: Painted) => !!filters.isolate && p.buildingId === filters.isolate.building && p.level !== null && p.level > filters.isolate.level
  const hasTop = useMemo(() => new Set(drawing.painted.filter((p) => p.labels.t && p.unitId).map((p) => p.unitId!)), [drawing])
  return (
    <>
      <g aria-hidden="true">
        <g filter="url(#iso-blur)">
          {drawing.shadows.map((d, i) => (
            <path key={i} d={d} className="iso-sombra" />
          ))}
        </g>
        {drawing.slabs.map((sl) => (
          <g key={sl.key} className="iso-sub" data-focus={focusSlab === sl.key || undefined}>
            {sl.faces.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
        ))}
      </g>
      {/* data-corpos: o giro acha aqui o corpo do meio do quadro (o filho de mesma posição em drawing.painted). */}
      <g aria-hidden="true" data-corpos="">
        {drawing.painted.map((p) => {
          const u = p.unitId ? units.get(p.unitId) : undefined
          const ghost = ghostOf(p)
          if (p.tree)
            return (
              <g key={p.key} className="iso-tree">
                {p.tree.trunk && <path d={p.tree.trunk} className="tr" />}
                <circle cx={p.tree.cx} cy={p.tree.cy} r={p.tree.r} className="cr" />
                <circle cx={p.tree.cx - p.tree.r * 0.28} cy={p.tree.cy - p.tree.r * 0.3} r={p.tree.r * 0.55} className="hl" />
              </g>
            )
          // Código: no topo quando o topo está à mostra (último andar, andar isolado ou planta); se não, numa parede que dá para fora.
          const isolatedHere = !!filters.isolate && p.buildingId === filters.isolate.building && p.level === filters.isolate.level
          const top = !!p.unitId && hasTop.has(p.unitId) && (mode === 'planta' || isolatedHere || drawing.openTop.has(p.unitId))
          const lb = p.kind === 'unit' ? (top ? p.labels.t : p.labels.side) : undefined
          return (
            <g key={p.key} className={classOf(p)} data-tone={p.tone} data-u={p.unitId ?? undefined} data-b={p.buildingId ?? undefined} data-st={u?.status} data-dim={dimOf(u, p.buildingId, filters, focusUnit) || undefined} data-ghost={ghost || undefined}>
              {p.faces.map((f, i) => (
                <path key={i} d={f.d} className={`f f-${f.shade}`} />
              ))}
              {lb && !ghost && (
                <text className="iso-lb" x={lb.x} y={lb.y}>
                  {lb.text}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </>
  )
})

/**
 * O balão do clique, posto ao lado da coisa que ele explica sem cobri-la (placeBalloon: acima,
 * senão abaixo, à direita ou à esquerda) e sempre dentro do desenho. Passo a passo:
 * 1. o primeiro desenho sai escondido, só para medir a altura (o conteúdo muda de coisa para coisa);
 * 2. medido (antes de a tela pintar), ele se põe no lugar;
 * 3. mouse em cima segura ele aberto (onPart); "fading" esmaece antes de sumir.
 * A "key" de quem usa é a coisa: outra coisa monta outro balão (e mede de novo).
 */
function Balloon({ anchor, area, fading, onPart, children }: { anchor: Rect; area: Size; fading: boolean; onPart: (on: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setBox((b) => (b && b.w === el.offsetWidth && b.h === el.offsetHeight ? b : { w: el.offsetWidth, h: el.offsetHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const place = box ? placeBalloon(anchor, box, area) : null
  return (
    <div
      ref={ref}
      role="status"
      className={cn('iso-balao absolute z-10 w-[248px] rounded-xl border border-border bg-surface p-3 text-xs shadow-pop', place && 'animate-fade-in')}
      data-saindo={fading || undefined}
      data-lado={place?.side}
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? undefined : 'hidden' }}
      onPointerEnter={() => onPart(true)}
      onPointerLeave={() => onPart(false)}
    >
      {children}
    </div>
  )
}

/**
 * O que vai no balão. Duas formas:
 *   - unidade, vaga (ou o volume de um bloco que só tem uma unidade, como a casa ou o apartamento
 *     avulso): o resumo curto; o resto está na ficha ao lado, que o clique já abriu;
 *   - selo ou volume de um bloco com várias unidades: ocupação e resumo por tipologia.
 */
function BalloonBody({ pin, layout, units }: { pin: Pin; layout: Layout; units: Map<string, UnitRow> }) {
  const b = pin.building ? layout.buildings.find((bb) => bb.id === pin.building) : undefined
  const u = pin.unit ? units.get(pin.unit) : b?.units.length === 1 ? b.units[0] : undefined
  if (u) return <UnitSummary u={u} />
  return b ? <BuildingSummary b={b} /> : null
}

/** Resumo curto da unidade (ou vaga): situação, tipologia (ou a área do estacionamento), quem aluga e até quando, quanto paga. */
function UnitSummary({ u }: { u: UnitRow }) {
  const spot = u.kind === 'parking'
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{spot ? `Vaga ${u.code}` : unitName(u)}</p>
      <p className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: UNIT_STATUS_VAR[u.status] }} aria-hidden="true" />
        {UNIT_STATUS[u.status]} · {spot ? (u.floor_label ?? zoneOf(u)) : typologyText(u)}
        {!spot && u.bedrooms > 0 ? ` · ${u.area_m2.toLocaleString('pt-BR')} m²` : ''}
      </p>
      {u.lease ? (
        <p>
          {u.lease.lessee_name || 'Locatário não informado'} até {formatDate(u.lease.end_date)} · <span className="num">{formatBRL(u.lease.rent_cents)}</span>
        </p>
      ) : (
        <p className="text-muted">
          Sem locação vigente
          {u.asking_rent_cents ? (
            <>
              {' '}
              · pedido <span className="num">{formatBRL(u.asking_rent_cents)}</span>
            </>
          ) : null}
        </p>
      )}
    </div>
  )
}

/** Resumo do bloco: ocupação e quantas de cada nº de quartos (e quantas disponíveis). */
function BuildingSummary({ b }: { b: BuildingBox }) {
  const rows = typologySummary(b.units)
  return (
    <>
      <p className="text-sm font-semibold">{b.name}</p>
      <p className="text-muted">
        {b.units.length} {b.units.length === 1 ? 'unidade' : 'unidades'} · {occupancyOf(b.units)}% ocupado
      </p>
      {rows.length > 0 && (
        <table className="mt-2 w-full">
          <caption className="sr-only">Resumo por tipologia de {b.name}</caption>
          <thead>
            <tr className="text-[11px] text-muted">
              <th scope="col" className="pb-1 text-left font-semibold">Tipologia</th>
              <th scope="col" className="pb-1 text-right font-semibold">Total</th>
              <th scope="col" className="pb-1 text-right font-semibold">Disponíveis</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="py-1">{r.label}</td>
                <td className="num py-1 text-right">{r.total}</td>
                <td className={cn('num py-1 text-right font-semibold', r.available ? 'text-success-fg' : 'text-muted')}>{r.available}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-1.5 text-muted">Clique numa unidade para ver a ficha dela ao lado.</p>
    </>
  )
}
