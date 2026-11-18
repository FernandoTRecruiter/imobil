/* =============================================================================
   Mapa e 3D: as duas vistas desenhadas do app, cada uma onde a pergunta dela mora.
   1. Mapa da cidade (CityView), na página Imóveis: onde cada imóvel fica.
   2. 3D do imóvel (IsoView), na aba Unidades da ficha do imóvel (/imoveis/$propertyId):
      o desenho é o foco, com o painel curto ao lado e os detalhes (abas) embaixo.

   Cada vista é baixada só quando abre (import dinâmico + Suspense): quem nunca abre o 3D
   não baixa o desenho, e quem só usa o 3D não baixa o Leaflet.
   ============================================================================= */
import { lazy, Suspense, type ComponentProps } from 'react'
import { Skeleton } from '@/components/ui/States'
import './mapa.css'

const CityView = lazy(() => import('./CityView').then((m) => ({ default: m.CityView })))
const IsoView = lazy(() => import('./IsoView').then((m) => ({ default: m.IsoView })))

/**
 * Altura do desenho (07/11/2026, "o mapa, que é o principal, fica menor que 3 heroes"): no
 * computador, a janela MENOS o que fica em cima dele (barras, cabeçalho, filtros: uns 300 px), entre
 * 420 e 760 px; no celular, 320 px. Em 1366 x 768 dá 468 px (61% da janela). Por que o teto: só a
 * janela esticaria o desenho sem fim numa janela alta (e na foto de página inteira, que aumenta a
 * janela), empurrando a tabela para longe. dvh (e não vh): no celular a barra do navegador some e
 * volta, e o desenho não pula junto.
 * O mesmo valor nos três lugares (mapa da cidade, 3D, painel ao lado), escrito por extenso em cada
 * classe porque o Tailwind só gera a classe que aparece inteira no código.
 * Mora aqui (e não no IsoView) porque o esqueleto de carregamento abaixo usa a mesma altura e
 * este arquivo é baixado antes do 3D: o quadro não pula quando o desenho chega.
 */
export const CANVAS_H = 'h-80 md:h-[clamp(420px,calc(100dvh-300px),760px)]'
/** Mapa da cidade (Imóveis e Visão geral): a mesma altura do 3D, a partir de 1024 px. */
export const MAP_H = 'h-80 lg:h-[clamp(420px,calc(100dvh-300px),760px)]'

/**
 * Traz o desenho para a tela, se ele estiver fora (a escolha veio de uma tabela lá embaixo).
 * Chamar ANTES de trocar o endereço e sem animação: o roteador guarda a posição da página na
 * hora da troca e a devolve logo depois; uma rolagem animada (ou feita depois) seria desfeita.
 */
export function revealMap(): void {
  const el = document.querySelector('[data-iso-card]')
  if (!el) return
  const r = el.getBoundingClientRect()
  if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center' })
}

/** O painel curto à direita do desenho (a partir de 1280 px) tem a altura do desenho e rola por dentro. */
export const ASIDE_H = 'xl:h-[clamp(420px,calc(100dvh-300px),760px)]'

function Loading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label={label}>
      <Skeleton className={MAP_H} />
      <Skeleton className="h-8 w-full max-w-xl" />
    </div>
  )
}

/** Esqueleto do 3D (filtros, desenho com o painel ao lado e começo dos detalhes), o mesmo enquanto baixa o código e enquanto lê a cena. */
export function Loading3d() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Carregando o imóvel em 3D">
      <Skeleton className="h-8 w-full max-w-3xl" />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className={CANVAS_H} />
        <Skeleton className={`h-64 ${ASIDE_H}`} />
      </div>
      <Skeleton className="h-40" />
    </div>
  )
}

export function CityMap(props: ComponentProps<typeof CityView>) {
  return (
    <Suspense fallback={<Loading label="Carregando o mapa da cidade" />}>
      <CityView {...props} />
    </Suspense>
  )
}

export function Property3d(props: ComponentProps<typeof IsoView>) {
  return (
    <Suspense fallback={<Loading3d />}>
      <IsoView {...props} />
    </Suspense>
  )
}
