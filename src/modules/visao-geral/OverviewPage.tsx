/* =============================================================================
   Visão geral (equipe): um painel só, direto ao ponto, com os números MACRO da conta.

   Pedido do Fernando (07/11/2026): uma visão geral "mais única", um painel direto ao ponto com os
   números macro, com o desempenho dos colaboradores além de clientes e financeiro, e sem o mapa.
   O mapa de ruas continua em Imóveis.

   Anatomia, de cima para baixo:
   1. cabeçalho "Visão geral" + nome da conta, linha de apoio e o botão Relatórios;
   2. filtros numa linha (período, empreendimento, carteira, responsável) e, no fim dela, com que
      período as setas comparam;
   3. quatro blocos lado a lado (Carteira, Financeiro, Clientes, Manutenção): número de destaque
      com seta e tendência, e até quatro linhas cada. Em 1366 x 768 os quatro cabem acima da dobra;
   4. "Pede atenção": os alertas que levam à lista já filtrada, em faixa de largura cheia;
   5. Equipe (admin) ou "Meu desempenho" (os outros colaboradores); conta sem equipe não tem.

   O que cada número diz sai de figures.ts e a conta de macro.ts e desempenho.ts: os mesmos do HTML do
   Power BI. A tela só desenha (Blocos.tsx) e põe a moldura do app: o "i" (InfoTip) e o link.
   Clicar num número com a seta ↗ abre a lista daquele número já filtrada (o link diz para onde);
   número sem seta não leva a lugar nenhum. Nada troca de página sem a pessoa pedir.
   ============================================================================= */
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ChartColumn } from 'lucide-react'
import { Guard } from '@/app/Guard'
import { useSession } from '@/auth/SessionProvider'
import { can, hasFeature } from '@/auth/permissions'
import { useRepo } from '@/data/hooks'
import { formatDate } from '@/lib/dates'
import { readJSON, writeJSON } from '@/lib/storage'
import { plural } from '@/lib/text'
import { Button } from '@/components/ui/Button'
import { InfoTip } from '@/components/ui/InfoTip'
import { PageHeader } from '@/components/ui/Layout'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States'
import { cn } from '@/components/ui/cn'
import { MacroBlock, STRETCHED, type BlockShell } from './Blocos'
import { TeamSection } from './Equipe'
import { FilterSelect } from './FilterSelect'
import { compareInfo, compareLabel, macroBlocks } from './figures'
import { PERIOD_KEYS, PERIOD_LABEL, type PeriodKey } from './metrics'
import { AlertList, rememberList } from './Painel'
import { DEFAULT_FILTERS, getOverview, type ListTarget, type OverviewData, type OverviewFilters } from './repo'

export function OverviewPage() {
  const s = useSession()
  return (
    <Guard action="overview:view" what="a visão geral">
      {/* key: trocar de persona remonta a tela e os filtros lembrados passam a ser os da nova conta. */}
      <OverviewBody key={`${s.user.id}:${s.org.id}`} />
    </Guard>
  )
}

function OverviewBody() {
  const s = useSession()
  const storeKey = `imobil:visao-geral:${s.org.id}`
  const [filters, setFilters] = useState<OverviewFilters>(() => ({ ...DEFAULT_FILTERS, ...(readJSON<Partial<OverviewFilters>>(storeKey) ?? {}) }))
  const q = useRepo('visao-geral', (sess) => getOverview(sess, filters), [filters])

  const change = (patch: Partial<OverviewFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    writeJSON(storeKey, next)
  }

  const m = q.data?.overview
  const support = m
    ? `${plural(m.occupancy.units, 'unidade', 'unidades')} em ${plural(m.byProperty.length, 'imóvel', 'imóveis')} · dados de ${formatDate(s.today)}`
    : `Dados de ${formatDate(s.today)}`

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Visão geral"
        muted={s.org.name}
        description={support}
        actions={
          can(s, 'reports:view') && (
            <Link
              to="/relatorios"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-sm font-medium transition-colors duration-150 hover:border-border-strong hover:bg-surface-2"
            >
              <ChartColumn className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Relatórios
            </Link>
          )
        }
      />
      <FilterBar filters={q.data?.filters ?? filters} data={q.data} onChange={change} />
      {q.isLoading ? (
        <LoadingBlocks />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.unitsInAccount === 0 ? (
        <EmptyState
          title="Nenhum imóvel cadastrado ainda"
          description="Os números aparecem assim que houver imóveis e contratos."
          action={
            <Link to="/imoveis/novo" className="font-medium text-primary hover:underline">
              Cadastrar o primeiro imóvel
            </Link>
          }
        />
      ) : q.data ? (
        // Filtro novo: a tela de antes fica, esmaecida, até a nova chegar (sem esqueleto a cada troca).
        <div className={cn('flex flex-col gap-3 transition-opacity duration-200 ease-out', q.isFetching && 'opacity-70')} aria-busy={q.isFetching || undefined}>
          <Content data={q.data} />
        </div>
      ) : null}
    </div>
  )
}

function LoadingBlocks() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Carregando a visão geral">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[248px] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  )
}

/* ---------------------------------------------------------------- filtros */

function FilterBar({ filters, data, onChange }: { filters: OverviewFilters; data?: OverviewData; onChange: (p: Partial<OverviewFilters>) => void }) {
  const s = useSession()
  // Quais filtros existem sai da SESSÃO (não do dado): assim a barra não muda de tamanho quando os dados chegam.
  const portfolios = hasFeature(s, 'portfolios')
  const managers = hasFeature(s, 'team')
  const dirty = filters.period !== DEFAULT_FILTERS.period || !!filters.property || !!filters.portfolio || !!filters.manager
  const m = data?.overview
  return (
    // Grade de 4 até 1280 px; na tela larga, uma linha só, com a comparação encostada à direita.
    <div className="grid grid-cols-2 items-end gap-x-3 gap-y-2 sm:grid-cols-4 xl:flex xl:flex-wrap xl:items-center xl:gap-x-5" role="group" aria-label="Filtros da visão geral">
      <FilterSelect compact label="Período" value={filters.period} onChange={(v) => onChange({ period: v as PeriodKey })} options={PERIOD_KEYS.map((k) => ({ value: k, label: PERIOD_LABEL[k] }))} />
      <FilterSelect compact label="Empreendimento" value={filters.property} onChange={(v) => onChange({ property: v })} all="Todos" options={data?.options.properties} />
      {portfolios && <FilterSelect compact label="Carteira" value={filters.portfolio} onChange={(v) => onChange({ portfolio: v })} all="Todas" options={data?.options.portfolios} />}
      {managers && <FilterSelect compact label="Responsável" value={filters.manager} onChange={(v) => onChange({ manager: v })} all="Todos" options={data?.options.managers} />}
      {dirty && (
        <Button variant="ghost" className="col-span-2 justify-self-start sm:col-span-1" onClick={() => onChange(DEFAULT_FILTERS)}>
          Limpar
        </Button>
      )}
      {m && (
        <p className="col-span-2 flex min-h-6 items-center gap-1 text-xs text-muted sm:col-span-4 xl:ml-auto">
          Setas comparam com {compareLabel(m)}
          <InfoTip label="Com o que as setas comparam">{compareInfo(m)}</InfoTip>
        </p>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- blocos, alertas e equipe */

/**
 * O link de um número: grava o filtro da lista de destino (rememberList) e abre a tela dela.
 * Imóveis e Manutenção têm parte do endereço que escolhe a categoria ou a aba; por isso cada um tem
 * o seu Link (o roteador confere o endereço de cada rota pelo tipo).
 */
function TargetLink({ target: t, children }: { target: ListTarget; children: ReactNode }) {
  const common = { onClick: () => rememberList(t), className: cn('rounded-sm text-text', STRETCHED), title: t.action }
  const said = t.action ? <span className="sr-only"> ({t.action})</span> : null
  if (t.to === '/imoveis') {
    return (
      <Link to="/imoveis" search={t.search?.lista ? { lista: t.search.lista } : {}} {...common}>
        {children}
        {said}
      </Link>
    )
  }
  if (t.to === '/manutencao') {
    return (
      <Link to="/manutencao" search={t.search?.aba ? { aba: t.search.aba } : {}} {...common}>
        {children}
        {said}
      </Link>
    )
  }
  return (
    <Link to={t.to} {...common}>
      {children}
      {said}
    </Link>
  )
}

function Content({ data }: { data: OverviewData }) {
  const s = useSession()
  const blocks = macroBlocks(data.overview, data.show)
  const shell: BlockShell = {
    info: (text, label) => <InfoTip label={label}>{text}</InfoTip>,
    link: (fig, label) => {
      const t = fig.link ? data.links[fig.link] : undefined
      return t ? <TargetLink target={t}>{label}</TargetLink> : null
    },
  }
  return (
    <>
      {/* Quatro colunas a partir de 1280 px (os quatro blocos acima da dobra em 1366 x 768);
          duas no tablete; uma no celular. */}
      <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {blocks.map((b) => (
          <MacroBlock key={b.key} block={b} shell={shell} />
        ))}
      </div>

      <section aria-labelledby="pede-atencao" className="rounded-2xl border border-border bg-surface shadow-card">
        <div className="flex min-h-10 items-center gap-1.5 px-4 pt-1.5">
          <h2 id="pede-atencao" className="text-[15px] font-medium">
            Pede atenção
          </h2>
          <span className="num text-xs text-faint">{data.alerts.length}</span>
          <InfoTip label="Sobre os alertas">Cada alerta abre a lista já filtrada, no recorte dos filtros acima.</InfoTip>
        </div>
        <div className="px-4 pb-2">
          <AlertList alerts={data.alerts} className="gap-x-6 sm:grid-cols-2 xl:grid-cols-3" />
        </div>
      </section>

      <TeamSection team={data.team} money={data.show.money} when={PERIOD_LABEL[data.filters.period].toLowerCase()} meId={s.user.id} />
    </>
  )
}
