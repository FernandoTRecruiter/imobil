/* =============================================================================
   hover.ts: "qual imóvel está com o mouse em cima" (linha da tabela ou pino), FORA do estado da
   página.

   Por que existe (07/11/2026, "tá muito travado"): o id acendido morava no estado da página
   Imóveis, e cada linha que o mouse cruzava redesenhava a página inteira (indicadores, barra,
   tabela, ficha curta): uns 55 ms por linha medidos no modo de desenvolvimento. Com este canal,
   quem ESCREVE (a tabela, o pino) não desenha nada, e só quem LÊ (o mapa) desenha de novo.

   Como se usa: a tela cria um canal (useHoverChannel), passa canal.set para quem acende e o
   próprio canal para o mapa; o mapa lê com useHovered.
   ============================================================================= */
import { useState, useSyncExternalStore } from 'react'

export interface HoverChannel {
  get: () => string | null
  /** Acende (id) ou apaga (null). Repetir o mesmo id não avisa ninguém. */
  set: (id: string | null) => void
  subscribe: (fn: () => void) => () => void
}

export function createHoverChannel(): HoverChannel {
  let current: string | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: (id) => {
      if (id === current) return
      current = id
      listeners.forEach((fn) => fn())
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

/** Um canal por tela, criado uma vez (o mesmo objeto em todos os desenhos). */
export function useHoverChannel(): HoverChannel {
  const [channel] = useState(createHoverChannel)
  return channel
}

/** O id acendido agora. Só o componente que chama este gancho desenha de novo quando ele muda. */
export function useHovered(channel: HoverChannel): string | null {
  return useSyncExternalStore(channel.subscribe, channel.get, channel.get)
}
