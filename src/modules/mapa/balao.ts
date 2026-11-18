/* =============================================================================
   balao.ts: o BALÃO dos mapas (3D do imóvel e mapa da cidade): quando abre, quando fica, quando
   some e onde se põe.

   A regra (07/11/2026, pedido do Fernando: "o balão só pode aparecer quando eu clicar no imóvel;
   se eu colocar o mouse em cima do balão e tirar o mouse, o balão some sozinho depois de 2 segundos"):
   1. passar o mouse só ACENDE a coisa (contorno). Balão nenhum;
   2. clicar (ou Enter) escolhe a coisa, como sempre, E abre o balão nela;
   3. o balão fica aberto enquanto o mouse está nele OU na coisa clicada (o foco do teclado na
      coisa conta como "mouse em cima"); saiu dos dois, 2 s depois ele esmaece e some. Voltar antes
      zera a conta;
   4. Esc ou clique no vazio fecham na hora. A escolha continua: só o balão vai embora.

   Por que uma máquina de estados pura (balloonReducer): o tempo entra como número (now), então o
   teste anda o relógio à mão, sem esperar 2 s de verdade. O gancho useBalloon só liga a máquina
   aos relógios do navegador.
   ============================================================================= */
import { useCallback, useEffect, useReducer, useRef } from 'react'

/** Quanto o balão espera, depois que o mouse sai dele e da coisa clicada. */
export const BALLOON_HIDE_MS = 2000
/** Quanto dura o esmaecer (com "reduzir movimento" ligado, zero: some direto). */
export const BALLOON_FADE_MS = 180

export interface BalloonState<T> {
  target: T
  /** Mouse (ou foco) no balão ou na coisa clicada. */
  inside: boolean
  /** Quando começa a esmaecer (null = não está contando). */
  fadeAt: number | null
  /** Quando some de vez (null = não está esmaecendo). */
  closeAt: number | null
  fadeMs: number
}

export type BalloonEvent<T> =
  | { type: 'open'; target: T; inside: boolean; now: number; fadeMs: number }
  | { type: 'inside'; inside: boolean; now: number }
  | { type: 'tick'; now: number }
  | { type: 'close' }

/**
 * A máquina do balão (null = fechado). Passo a passo de cada evento:
 * - open: abre na coisa; se o mouse já não estiver nela (veio do teclado e o foco saiu), começa a contar;
 * - inside: entrou (zera a conta e para o esmaecer) ou saiu (conta 2 s a partir de agora);
 * - tick: o relógio chegou na hora de esmaecer (passa a esmaecer) ou de sumir (fecha);
 * - close: Esc ou clique no vazio.
 * Evento que não muda nada devolve o MESMO estado: a tela não se desenha de novo à toa.
 */
export function balloonReducer<T>(s: BalloonState<T> | null, e: BalloonEvent<T>): BalloonState<T> | null {
  switch (e.type) {
    case 'open':
      return { target: e.target, inside: e.inside, fadeAt: e.inside ? null : e.now + BALLOON_HIDE_MS, closeAt: null, fadeMs: e.fadeMs }
    case 'close':
      return null
    case 'inside':
      if (!s || s.inside === e.inside) return s
      return e.inside ? { ...s, inside: true, fadeAt: null, closeAt: null } : { ...s, inside: false, fadeAt: e.now + BALLOON_HIDE_MS, closeAt: null }
    case 'tick':
      if (!s) return s
      if (s.closeAt !== null && e.now >= s.closeAt) return null
      if (s.fadeAt !== null && e.now >= s.fadeAt) return s.fadeMs > 0 ? { ...s, fadeAt: null, closeAt: s.fadeAt + s.fadeMs } : null
      return s
  }
}

/** A próxima hora em que o relógio tem de bater (null = nada a esperar). */
export const balloonNextAt = <T>(s: BalloonState<T> | null): number | null => (s ? (s.closeAt ?? s.fadeAt) : null)

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** As partes que contam como "mouse em cima": a coisa clicada, o próprio balão e o foco do teclado na coisa. */
export type BalloonPart = 'anchor' | 'balloon' | 'focus'

/**
 * O balão de uma tela. Devolve o estado e três ações:
 * - open(alvo, { anchor, focus }): clique (mouse em cima da coisa) ou Enter (foco nela);
 * - part(parte, sim/não): o mouse entrou ou saiu de uma parte; a máquina só fica sabendo quando o
 *   "está em alguma delas" muda (sair da coisa para o balão, passando pelo vão, não conta 2 s);
 * - close(): Esc, clique no vazio, a escolha mudou por fora.
 * As três são estáveis (mesma função a cada desenho): podem ir em efeito e em memo.
 */
export function useBalloon<T>() {
  const [state, dispatch] = useReducer(balloonReducer<T>, null)
  const parts = useRef({ anchor: false, balloon: false, focus: false })
  const open = useCallback((target: T, how: { anchor?: boolean; focus?: boolean }) => {
    parts.current = { anchor: !!how.anchor, balloon: false, focus: !!how.focus }
    dispatch({ type: 'open', target, inside: !!(how.anchor || how.focus), now: performance.now(), fadeMs: reducedMotion() ? 0 : BALLOON_FADE_MS })
  }, [])
  const part = useCallback((which: BalloonPart, on: boolean) => {
    if (parts.current[which] === on) return
    parts.current = { ...parts.current, [which]: on }
    const p = parts.current
    dispatch({ type: 'inside', inside: p.anchor || p.balloon || p.focus, now: performance.now() })
  }, [])
  const close = useCallback(() => dispatch({ type: 'close' }), [])
  // O relógio: um só por vez, na próxima hora da máquina. O "now" é a hora marcada (no mínimo):
  // se o navegador acordar 1 ms antes, a máquina ainda assim anda (e não fica parada esperando).
  useEffect(() => {
    const at = balloonNextAt(state)
    if (at === null) return
    const id = window.setTimeout(() => dispatch({ type: 'tick', now: Math.max(performance.now(), at) }), Math.max(0, at - performance.now()))
    return () => window.clearTimeout(id)
  }, [state])
  return { state, fading: !!state && state.closeAt !== null, open, part, close }
}

/* ---------------------------------------------------------------- onde o balão se põe */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export type BalloonSide = 'above' | 'below' | 'right' | 'left'

/**
 * Onde pôr o balão (px, dentro da área do desenho) sem cobrir a coisa que ele explica (anchor).
 * Passo a passo:
 * 1. a folga de cada lado: acima, abaixo, à direita e à esquerda da coisa, menos o vão e a margem;
 * 2. o primeiro lado onde o balão cabe inteiro, nesta ordem: acima (o de sempre), abaixo, direita,
 *    esquerda. Acima e abaixo, ele centra na coisa e encosta para dentro da área no outro eixo;
 * 3. não coube em lado nenhum (coisa enorme, quase do tamanho do desenho): o lado de cima ou de
 *    baixo com mais folga, preso dentro da área (aí pode cobrir uma parte da coisa: não há lugar livre).
 */
export function placeBalloon(anchor: Rect, box: { w: number; h: number }, area: { w: number; h: number }, gap = 12, margin = 8): { left: number; top: number; side: BalloonSide } {
  const clampX = (x: number) => Math.min(Math.max(x, margin), Math.max(margin, area.w - margin - box.w))
  const clampY = (y: number) => Math.min(Math.max(y, margin), Math.max(margin, area.h - margin - box.h))
  const room = {
    above: anchor.y - gap - margin,
    below: area.h - margin - (anchor.y + anchor.h + gap),
    right: area.w - margin - (anchor.x + anchor.w + gap),
    left: anchor.x - gap - margin,
  }
  const fits: Record<BalloonSide, boolean> = { above: room.above >= box.h, below: room.below >= box.h, right: room.right >= box.w, left: room.left >= box.w }
  const side = (['above', 'below', 'right', 'left'] as BalloonSide[]).find((s) => fits[s]) ?? (room.above >= room.below ? 'above' : 'below')
  const cx = anchor.x + anchor.w / 2
  const cy = anchor.y + anchor.h / 2
  if (side === 'right') return { side, left: anchor.x + anchor.w + gap, top: clampY(cy - box.h / 2) }
  if (side === 'left') return { side, left: anchor.x - gap - box.w, top: clampY(cy - box.h / 2) }
  const top = side === 'above' ? anchor.y - gap - box.h : anchor.y + anchor.h + gap
  return { side, left: clampX(cx - box.w / 2), top: fits[side] ? top : clampY(top) }
}
