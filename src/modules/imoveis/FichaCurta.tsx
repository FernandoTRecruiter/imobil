/* =============================================================================
   FichaCurta: o painel curto ao lado do mapa (página Imóveis e Visão geral).

   Pedido do Fernando (06/11/2026): "não quero mudança direto de aba/página por interações
   simples. quero que o mapa seja sempre o foco, tabela pequena à direita com informações simples".
   Por isso clicar num pino ou numa linha só ESCOLHE, e este painel mostra o básico do escolhido.
   Mudar de página é sempre um botão com o nome do destino ("Abrir imóvel", "Abrir no imóvel").

   Três estados, a mesma moldura (cartão, linha pequena, título, lista de 4 a 8 itens, ações):
     1. nada escolhido: ResumoRecorte, o resumo dos imóveis que estão no mapa agora;
     2. imóvel escolhido: o básico dele, com "Abrir imóvel" (vai para /imoveis/<id>);
     3. unidade ou vaga escolhida (linha da tabela de unidades ou de vagas, ou unidade disponível da
        Visão geral): o básico dela, com "Abrir no imóvel" (a página do imóvel já com ela escolhida).
   "Limpar escolha" volta ao estado 1 (ou, na Visão geral, ao painel de alertas).

   Os dados saem de resumo.ts (imóvel e recorte) e de getUnit (unidade): o escopo fica lá.

   Troca suave (07/11/2026, "tá muito travado"): trocar de imóvel (ou de unidade) NÃO remonta o
   painel. O conteúdo de antes fica na tela, esmaecido, enquanto o novo chega (o useRepo guarda a
   leitura anterior); quando chega, o novo entra com um fade curto. A moldura (cartão, rodapé com os
   botões) não se mexe, e o esqueleto só aparece na primeira leitura.
   ============================================================================= */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ExternalLink, X } from 'lucide-react'
import { useSession } from '@/auth/SessionProvider'
import { hasFeature } from '@/auth/permissions'
import { UnitStatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DescriptionList } from '@/components/ui/Layout'
import { Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { useRepo } from '@/data/hooks'
import { PROPERTY_KIND, UNIT_KIND } from '@/data/labels'
import { getUnit, isSpot } from '@/data/views/units'
import { formatDate } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { plural } from '@/lib/text'
import { formatPctNumber } from './components'
import { getPropertyBrief, summarizeProperties, type BriefNumbers } from './resumo'

/** O que está escolhido no mapa: sempre um imóvel; às vezes também uma unidade (ou vaga) dele. */
export interface Escolha {
  propertyId: string
  unitId?: string
}

type Item = { label: string; value: ReactNode }

/** Número em Geist Mono (a regra da casa: mono só para número). */
const num = (v: ReactNode) => <span className="num">{v}</span>

/** Ocupação com a base: "86%" e, apagado, "55 de 64". Sem alugável, "Sem unidade alugável". */
function occupancy(n: Pick<BriefNumbers, 'units_occupied' | 'units_rentable'>): ReactNode {
  if (!n.units_rentable) return <span className="text-muted">Sem unidade alugável</span>
  const pct = Math.round((n.units_occupied / n.units_rentable) * 1000) / 10
  return (
    <>
      {num(formatPctNumber(pct))} <span className="text-muted">· {num(n.units_occupied)} de {num(n.units_rentable)}</span>
    </>
  )
}

const spots = (n: Pick<BriefNumbers, 'spots_rented' | 'spots_total'>): ReactNode =>
  n.spots_total ? (
    <>
      {num(n.spots_rented)} de {num(n.spots_total)}
    </>
  ) : (
    <span className="text-muted">Sem vagas</span>
  )

/**
 * A moldura comum dos três estados. A lista vem em duas colunas a partir de 640 px (no painel
 * estreito cabe "rótulo em cima, valor embaixo" lado a lado), e as ações ficam no rodapé.
 * contentKey: o id do que está na tela. Mudou, o conteúdo (título e lista) entra com fade; busy: o
 * conteúdo é de antes e o novo está chegando (esmaece). O rodapé fica fora dos dois: não pisca.
 */
function Frame({ label, eyebrow, title, sub, items, footer, className, contentKey, busy }: { label: string; eyebrow: ReactNode; title: ReactNode; sub?: ReactNode; items: Item[] | null; footer?: ReactNode; className?: string; contentKey?: string; busy?: boolean }) {
  return (
    <section aria-label={label} aria-busy={busy || undefined} className={cn('flex min-w-0 flex-col rounded-2xl border border-border bg-surface shadow-card', className)}>
      <div key={contentKey} className={cn('flex min-h-0 flex-1 animate-fade-in flex-col transition-opacity duration-200 ease-out', busy && 'opacity-60')}>
        <div className="px-4 pt-3">
          <p className="truncate text-xs text-muted">{eyebrow}</p>
          <h2 className="mt-0.5 text-lg leading-snug font-medium">{title}</h2>
          {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {items ? (
            <DescriptionList columns={2} items={items} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2" role="status" aria-label="Carregando">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          )}
        </div>
      </div>
      {footer && <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">{footer}</div>}
    </section>
  )
}

/** Rodapé dos estados 2 e 3: o único botão que muda de página e o "Limpar escolha". */
function Actions({ open, onClear }: { open?: { label: string; go: () => void; disabled?: boolean }; onClear: () => void }) {
  return (
    <>
      {open && (
        <Button size="sm" variant="primary" disabled={open.disabled} icon={<ExternalLink className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={open.go}>
          {open.label}
        </Button>
      )}
      <Button size="sm" variant="ghost" className="ml-auto" icon={<X className="size-4" strokeWidth={1.5} aria-hidden="true" />} onClick={onClear}>
        Limpar escolha
      </Button>
    </>
  )
}

/** Escolhido fora do acesso (link velho, outra persona): diz o que houve e deixa limpar. */
function NotFound({ what, onClear, className }: { what: string; onClear: () => void; className?: string }) {
  return (
    <Frame
      className={className}
      label={`${what} não encontrado`}
      eyebrow="Escolha"
      title={`${what} não encontrado`}
      sub="Ele não existe mais ou está fora do seu acesso."
      items={[]}
      footer={<Actions onClear={onClear} />}
    />
  )
}

/* ---------------------------------------------------------------- 2. imóvel escolhido */

function PropertyBriefPanel({ propertyId, onClear, canOpen, className }: { propertyId: string; onClear: () => void; canOpen: boolean; className?: string }) {
  const s = useSession()
  const navigate = useNavigate()
  const q = useRepo('ficha-curta:imovel', (sess) => getPropertyBrief(sess, propertyId), [propertyId])
  // A leitura anterior fica na tela, esmaecida, enquanto a nova chega (stale): troca sem piscar.
  const p = q.data
  const stale = !!p && p.id !== propertyId
  if (q.error && (!p || stale)) return <NotFound what="Imóvel" onClear={onClear} className={className} />
  const items: Item[] | null = p
    ? [
        { label: 'Unidades', value: num(p.units_total) },
        { label: 'Ocupação', value: occupancy(p) },
        { label: 'Disponíveis', value: num(p.units_available) },
        { label: 'Vagas alugadas', value: spots(p) },
        { label: 'Aluguel em vigor', value: num(formatBRL(p.rent_roll_cents)) },
        // Sem "finance:view" o repositório nem calcula (null): a linha não existe para quem não vê dinheiro.
        ...(p.overdue_cents !== null ? [{ label: 'Vencido', value: <span className={cn('num', p.overdue_cents > 0 && 'text-danger-fg')}>{formatBRL(p.overdue_cents)}</span> }] : []),
        // Proprietário independente não tem equipe: sem a linha Responsável (a mesma regra da tabela).
        ...(hasFeature(s, 'team') ? [{ label: 'Responsável', value: p.manager_name ?? <span className="text-muted">Sem responsável</span> }] : []),
      ]
    : null
  return (
    <Frame
      className={className}
      contentKey={p?.id}
      busy={stale}
      label={p ? `Imóvel escolhido: ${p.name}` : 'Imóvel escolhido'}
      eyebrow={p ? `${p.district} · ${PROPERTY_KIND[p.kind]}` : 'Imóvel escolhido'}
      title={p ? p.name : <Skeleton className="h-6 w-48" />}
      sub={p?.street_line}
      items={items}
      footer={<Actions onClear={onClear} open={canOpen ? { label: 'Abrir imóvel', go: () => void navigate({ to: '/imoveis/$propertyId', params: { propertyId } }) } : undefined} />}
    />
  )
}

/* ---------------------------------------------------------------- 3. unidade (ou vaga) escolhida */

function UnitBriefPanel({ unitId, onClear, canOpen, className }: { unitId: string; onClear: () => void; canOpen: boolean; className?: string }) {
  const navigate = useNavigate()
  const q = useRepo('ficha-curta:unidade', (sess) => getUnit(sess, unitId), [unitId])
  // Como no imóvel: a unidade de antes fica, esmaecida, até a nova chegar.
  const u = q.data
  const stale = !!u && u.id !== unitId
  if (q.error && (!u || stale)) return <NotFound what="Unidade" onClear={onClear} className={className} />
  const spot = u ? isSpot(u) : false
  // "Apartamento A-301"; quando o código já diz o tipo ("Casa 04"), só o código (sem "Casa Casa 04").
  const title = u ? (u.code.toLowerCase().startsWith(UNIT_KIND[u.kind].toLowerCase()) ? u.code : `${UNIT_KIND[u.kind]} ${u.code}`) : ''
  // Onde fica: a área de fora (vaga do estacionamento externo) ou o bloco e o andar.
  const place = u ? (u.zone ?? [u.building_name, u.floor_label].filter(Boolean).join(', ')) : ''
  const items: Item[] | null = u
    ? [
        { label: 'Situação', value: <UnitStatusBadge status={u.status} /> },
        { label: 'Locatário', value: u.lease?.lessee_name || <span className="text-muted">Sem locatário</span> },
        {
          label: spot ? 'Mensalidade' : 'Aluguel',
          value: u.lease ? (
            num(formatBRL(u.lease.rent_cents))
          ) : u.asking_rent_cents ? (
            <>
              {num(formatBRL(u.asking_rent_cents))} <span className="text-muted">pedido</span>
            </>
          ) : (
            <span className="text-muted">Sem preço</span>
          ),
        },
        { label: 'Fim do contrato', value: u.lease ? num(formatDate(u.lease.end_date)) : <span className="text-muted">Sem contrato vigente</span> },
        // Casa, apartamento ou sala: o tamanho ajuda a reconhecer; na vaga não diz nada.
        ...(!spot ? [{ label: 'Área', value: num(`${u.area_m2.toLocaleString('pt-BR')} m²`) }] : []),
        ...(!spot && u.bedrooms > 0 ? [{ label: 'Quartos', value: num(u.bedrooms) }] : []),
      ]
    : null
  // A página do imóvel abre com a unidade já escolhida no desenho e na tabela dela (?unidade=).
  const openInProperty = () => u && void navigate({ href: `/imoveis/${encodeURIComponent(u.property_id)}?unidade=${encodeURIComponent(u.id)}` })
  return (
    <Frame
      className={className}
      contentKey={u?.id}
      busy={stale}
      label={u ? `${spot ? 'Vaga' : 'Unidade'} escolhida: ${u.code}` : 'Unidade escolhida'}
      eyebrow={u ? [u.property_name, place].filter(Boolean).join(' · ') : 'Unidade escolhida'}
      title={u ? title : <Skeleton className="h-6 w-40" />}
      items={items}
      footer={<Actions onClear={onClear} open={canOpen && u ? { label: 'Abrir no imóvel', go: openInProperty, disabled: stale } : undefined} />}
    />
  )
}

/**
 * O painel de quem está escolhido: a unidade, quando há; senão o imóvel. Sem "key" de propósito: de
 * um imóvel para outro (ou de uma unidade para outra) o painel continua montado e só o conteúdo troca.
 */
export function FichaEscolha({ escolha, onClear, canOpen = true, className }: { escolha: Escolha; onClear: () => void; canOpen?: boolean; className?: string }) {
  return escolha.unitId ? (
    <UnitBriefPanel unitId={escolha.unitId} onClear={onClear} canOpen={canOpen} className={className} />
  ) : (
    <PropertyBriefPanel propertyId={escolha.propertyId} onClear={onClear} canOpen={canOpen} className={className} />
  )
}

/**
 * Abaixo de 1280 px a ficha curta fica EMBAIXO do mapa: ao escolher outra coisa, a página rola o
 * mínimo para mostrá-la (sem isso, no celular o toque no pino parecia não ter feito nada). Só quando
 * a escolha MUDA depois de aberta a tela: abrir um link com a escolha não rola a página sozinho.
 */
export function useRevealOnNarrow(ref: RefObject<HTMLElement | null>, key: string | null) {
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (!key || !ref.current || window.matchMedia('(min-width: 1280px)').matches) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ref.current.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' })
  }, [key, ref])
}

/* ---------------------------------------------------------------- 1. nada escolhido */

/**
 * Resumo dos imóveis que estão no mapa agora (os pinos: a mesma busca e os mesmos filtros da tabela).
 * `propertyIds` undefined = os pinos ainda estão chegando.
 */
export function ResumoRecorte({ propertyIds, filtered, className }: { propertyIds: string[] | undefined; filtered: boolean; className?: string }) {
  const key = propertyIds ? [...propertyIds].sort().join(',') : null
  const q = useRepo('ficha-curta:resumo', (sess) => summarizeProperties(sess, propertyIds ?? []), [key], { enabled: !!propertyIds })
  const r = q.data
  const items: Item[] | null = r
    ? [
        { label: 'Unidades', value: num(r.units_total) },
        { label: 'Ocupação', value: occupancy(r) },
        { label: 'Disponíveis', value: num(r.units_available) },
        { label: 'Vagas alugadas', value: spots(r) },
        { label: 'Aluguel em vigor', value: num(formatBRL(r.rent_roll_cents)) },
      ]
    : null
  return (
    <Frame
      className={className}
      contentKey={r ? String(r.properties) : undefined}
      busy={q.isPlaceholderData}
      label="Resumo dos imóveis no mapa"
      eyebrow={filtered ? 'Com a busca e os filtros ligados' : 'Todos os imóveis'}
      title={r ? plural(r.properties, 'imóvel', 'imóveis') : <Skeleton className="h-6 w-32" />}
      items={items}
      footer={<p className="text-xs text-muted">Clique num pino ou numa linha da tabela para ver o resumo dele aqui.</p>}
    />
  )
}
