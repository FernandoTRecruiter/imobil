/* =============================================================================
   usePanZoom: zoom (roda do mouse, pinça com dois dedos, botões +/-) e arrastar o desenho.

   O desenho inteiro fica dentro de um <g transform="translate(x y) scale(k)">. Este gancho
   só cuida de k, x e y; quem desenha não precisa saber de mouse nem de dedo.

   Três armadilhas evitadas:
   1. Arrastar não pode virar clique: só depois de andar 4 px é "arrasto"; aí a unidade
      embaixo do dedo não é escolhida ao soltar (wasDrag).
   2. "Capturar" o ponteiro logo no toque mudaria o alvo do clique para o SVG inteiro
      (o clique na unidade se perderia). Por isso a captura só começa quando vira arrasto.
   3. A roda do mouse rolaria a página junto. O ouvinte é registrado à mão com
      passive: false, porque o do React não deixa cancelar a rolagem.

   Câmera suave (07/11/2026, "tá muito travado"): enquadrar (escolha vinda da tabela, bloco em
   foco, botão "Enquadrar", + e -) não SALTA mais: animateTo leva a câmera até lá em uns 260 ms,
   com saída suave. Qualquer gesto da pessoa (roda, arrastar, pinça) interrompe a animação na
   hora: a mão manda. Com "reduzir movimento" ligado no sistema, salta como antes.
   ============================================================================= */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { zoomAt, type PanZoom } from './iso'

export const IDENTITY: PanZoom = { k: 1, x: 0, y: 0 }

/** Duração padrão da câmera: o bastante para o olho seguir para onde foi, curto para não esperar. */
export const CAMERA_MS = 260

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Um quadro do caminho de "from" até "to" (e = 0 no começo, 1 no fim). Duas escolhas evitam que o
 * desenho "escorregue" para o lado no meio do zoom:
 *   1. o zoom anda em escala logarítmica (de 1 para 4 passa por 2 na metade, não por 2,5): cada
 *      quadro aproxima na mesma proporção, que é o que o olho percebe como velocidade constante;
 *   2. quem anda em linha reta é o PONTO DO DESENHO no centro do quadro (c = (centro - t) / k), e
 *      o deslocamento sai dele. Interpolar x e y direto faria o alvo descrever uma curva.
 */
export function lerpView(from: PanZoom, to: PanZoom, e: number, cx: number, cy: number): PanZoom {
  if (e <= 0) return from
  if (e >= 1) return to
  const k = from.k * Math.pow(to.k / from.k, e)
  const fx = (cx - from.x) / from.k
  const fy = (cy - from.y) / from.k
  const tx = (cx - to.x) / to.k
  const ty = (cy - to.y) / to.k
  const px = fx + (tx - fx) * e
  const py = fy + (ty - fy) * e
  return { k, x: cx - k * px, y: cy - k * py }
}

/** Saída suave (ease-out cúbica): rápido no começo, assenta devagar no alvo. */
export const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)

/** Ponto da janela (clientX/Y) no quadro do SVG (viewBox). */
function toSvgPoint(svg: SVGSVGElement, cx: number, cy: number): [number, number] {
  const m = svg.getScreenCTM()
  if (!m) return [cx, cy]
  const p = new DOMPoint(cx, cy).matrixTransform(m.inverse())
  return [p.x, p.y]
}

export function usePanZoom(svgRef: RefObject<SVGSVGElement | null>, view: { x: number; y: number; w: number; h: number }, initial: PanZoom | (() => PanZoom) = IDENTITY) {
  const [t, setT] = useState<PanZoom>(initial)
  const [dragging, setDragging] = useState(false)
  const pointers = useRef(new Map<number, [number, number]>())
  const moved = useRef(false)
  const pinch = useRef<number | null>(null)
  /** A câmera de agora, para a animação saber de onde parte (o estado só é lido no desenho). */
  const current = useRef(t)
  useEffect(() => {
    current.current = t
  }, [t])
  /** Quadro de animação pendente (null = parada). */
  const frame = useRef<number | null>(null)
  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])
  useEffect(() => stop, [stop]) // saiu da tela no meio da animação: nada continua rodando

  /**
   * Leva a câmera até "to". Passo a passo: 1. para a animação anterior; 2. sem movimento (reduzir
   * movimento ou ms = 0), salta; 3. senão, a cada quadro do navegador calcula o ponto do caminho
   * (lerpView com a saída suave) até o tempo acabar.
   */
  const animateTo = useCallback(
    (to: PanZoom, ms = CAMERA_MS) => {
      stop()
      if (ms <= 0 || reducedMotion()) {
        current.current = to
        setT(to)
        return
      }
      const from = current.current
      const cx = view.x + view.w / 2
      const cy = view.y + view.h / 2
      const start = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / ms)
        const next = lerpView(from, to, easeOut(p), cx, cy)
        current.current = next
        setT(next)
        frame.current = p < 1 ? requestAnimationFrame(step) : null
      }
      frame.current = requestAnimationFrame(step)
    },
    [stop, view],
  )

  // Roda do mouse: zoom em volta do ponto debaixo do cursor.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Durante o giro suave (IsoCanvas) a roda não mexe: o fim do giro já tem o zoom calculado.
      if (svg.hasAttribute('data-turning')) return
      stop() // a mão manda: a roda interrompe a câmera animada
      const [qx, qy] = toSvgPoint(svg, e.clientX, e.clientY)
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016))
      setT((cur) => zoomAt(cur, factor, qx, qy))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [svgRef, stop])

  const onPointerDown = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    stop() // tocar no desenho interrompe a câmera animada
    pointers.current.set(e.pointerId, [e.clientX, e.clientY])
    if (pointers.current.size === 1) moved.current = false
    pinch.current = null
  }, [stop])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current
      const last = pointers.current.get(e.pointerId)
      if (!svg || !last) return
      const ctm = svg.getScreenCTM()
      const scale = ctm ? ctm.a : 1 // px da tela por unidade do quadro
      if (pointers.current.size >= 2) {
        // Pinça: a distância entre os dois dedos manda no zoom; o meio deles fica parado.
        pointers.current.set(e.pointerId, [e.clientX, e.clientY])
        const [p, q] = [...pointers.current.values()]
        const dist = Math.hypot(p[0] - q[0], p[1] - q[1])
        if (pinch.current) {
          const [mx, my] = toSvgPoint(svg, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
          const factor = dist / pinch.current
          setT((cur) => zoomAt(cur, factor, mx, my))
        }
        pinch.current = dist
        moved.current = true
        return
      }
      const dx = e.clientX - last[0]
      const dy = e.clientY - last[1]
      if (!moved.current && Math.hypot(dx, dy) < 4) return
      if (!moved.current) {
        moved.current = true
        setDragging(true)
        svg.setPointerCapture(e.pointerId)
      }
      pointers.current.set(e.pointerId, [e.clientX, e.clientY])
      setT((cur) => ({ ...cur, x: cur.x + dx / scale, y: cur.y + dy / scale }))
    },
    [svgRef],
  )

  const onPointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) setDragging(false)
  }, [])

  /** Botões +/-: zoom em volta do centro do quadro, com a câmera curta (180 ms: o clique repete rápido). */
  const zoomBy = useCallback((factor: number) => animateTo(zoomAt(current.current, factor, view.x + view.w / 2, view.y + view.h / 2), 180), [view, animateTo])

  return {
    t,
    setT,
    animateTo,
    /** Para a câmera animada (troca de giro ou de modo salta direto; nenhum quadro velho pode vir depois). */
    stop,
    dragging,
    zoomBy,
    /** O último gesto foi arrasto (e não clique)? Lido no clique, nunca no desenho. */
    wasDrag: () => moved.current,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  }
}
